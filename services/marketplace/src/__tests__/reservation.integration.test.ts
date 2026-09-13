/**
 * مسارُ الحجزِ والإفراجِ على قاعدةٍ حقيقيّة — من الطلبِ إلى الدفترِ إلى الجواب.
 *
 * يُفحَص: الحجزُ يُنقص الرصيدَ ويُكتب في الدفتر، وعدمُ الكفاية يُعاد 409، والإعادةُ تُعيد
 * الجوابَ المحفوظ، والإفراجُ يُعيد الكميّةَ إلى الرصيد.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MarketplaceCatalogService } from "../app/catalog.js";
import { MarketplaceProductService } from "../app/products.js";
import { MarketplaceStoreService } from "../app/stores.js";
import { MarketplaceUnitOfWork } from "../db/unit-of-work.js";
import type { Clock } from "../domain/time.js";
import { createSignedMarketplaceApp } from "./service-identity-support.js";
import {
  MODERATOR,
  OWNER,
  PG_ENABLED,
  countRows,
  resetData,
  seedLeafCategory,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";

const NOW = "2026-09-01T00:00:00.000Z";
const fixedClock: Clock = { now: () => NOW };

const CATEGORY = "electronics-phones";
const SLUG = "madinah-electronics";

let keySeed = 0;
const write = () => ({
  "idempotency-key": `idem-res-${String(++keySeed).padStart(8, "0")}`,
  "content-type": "application/json",
});

const registerBody = (slug = SLUG, owner = OWNER) => ({
  owner_public_id: owner,
  store_slug: slug,
  title_ar: "إلكترونيات المدينة",
  category_slug: CATEGORY,
});

const productBody = (sku: string, initialQuantity?: number) => ({
  sku,
  title_ar: "هاتف",
  category_slug: CATEGORY,
  price_minor_units: 249900,
  currency_code: "SAR",
  created_by_public_id: OWNER,
  ...(initialQuantity === undefined ? {} : { initial_quantity: initialQuantity }),
});

describe.skipIf(!PG_ENABLED)("مسارُ الحجزِ والإفراجِ فوق Postgres", () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let productId: string;
  let productId2: string;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
    await seedLeafCategory(pg.stores, CATEGORY);
    const uow = new MarketplaceUnitOfWork(pg.db);
    const deps = { uow, clock: fixedClock };
    app = createSignedMarketplaceApp({
      mode: "postgres",
      services: {
        stores: new MarketplaceStoreService(deps),
        products: new MarketplaceProductService(deps),
        catalog: new MarketplaceCatalogService(deps),
      },
    });
    await app.ready();

    // سجّل المتجر واعتمده
    const registered = await app.inject({
      method: "POST",
      url: "/stores",
      headers: write(),
      payload: registerBody(),
    });
    expect(registered.statusCode, registered.body).toBe(201);
    await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/review-requests`,
      headers: write(),
      payload: { requested_by_public_id: OWNER },
    });
    await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/decisions`,
      headers: write(),
      payload: { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
    });

    // أنشئ منتجَين بمخزونٍ ابتدائيّ
    const created = await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/products`,
      headers: write(),
      payload: productBody("SKU-RES-1", 10),
    });
    expect(created.statusCode, created.body).toBe(201);
    productId = created.json().product_id as string;

    const created2 = await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/products`,
      headers: write(),
      payload: productBody("SKU-RES-2", 5),
    });
    expect(created2.statusCode, created2.body).toBe(201);
    productId2 = created2.json().product_id as string;
  });

  afterEach(async () => {
    await app?.close();
  });

  afterAll(async () => {
    await pg?.close();
  });

  it("الحجزُ يُنقص الرصيدَ ويُكتب في الدفترِ بسبَب `reservation`", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/inventory/reserve`,
      headers: write(),
      payload: {
        order_public_id: "ORDER-001",
        items: [
          { product_id: productId, quantity: 3 },
          { product_id: productId2, quantity: 2 },
        ],
        idempotency_key: "reserve-key-001",
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const body = response.json();
    expect(body.order_public_id).toBe("ORDER-001");
    expect(body.store_id).toBeDefined();
    expect(body.results).toHaveLength(2);
    expect(body.results[0].product_id).toBe(productId);
    expect(body.results[0].quantity_delta).toBe(-3);
    expect(body.results[0].quantity_after).toBe(7);
    expect(body.results[0].reason_code).toBe("reservation");
    expect(body.results[1].product_id).toBe(productId2);
    expect(body.results[1].quantity_delta).toBe(-2);
    expect(body.results[1].quantity_after).toBe(3);

    // تحقّق من الرصيد بعد الحجز
    const inventory = await app.inject({ method: "GET", url: `/products/${productId}/inventory` });
    expect(inventory.json().quantity_on_hand).toBe(7);
    const inventory2 = await app.inject({ method: "GET", url: `/products/${productId2}/inventory` });
    expect(inventory2.json().quantity_on_hand).toBe(3);
  });

  it("عدمُ الكفاية يُعاد 409 ولا يُكتبُ شيءٌ", async () => {
    const before = await countRows(pg.pool, "inventory_adjustments");
    const response = await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/inventory/reserve`,
      headers: write(),
      payload: {
        order_public_id: "ORDER-002",
        items: [{ product_id: productId, quantity: 100 }],
        idempotency_key: "reserve-key-002",
      },
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe("INVENTORY_RESERVATION_CONFLICT");
    // لم يُكتب صفٌّ جديد
    expect(await countRows(pg.pool, "inventory_adjustments")).toBe(before);
  });

  it("الإعادةُ بنفسِ المفتاحِ تُعيد الجوابَ المحفوظ", async () => {
    const headers = write();
    const payload = {
      order_public_id: "ORDER-003",
      items: [{ product_id: productId, quantity: 2 }],
      idempotency_key: "reserve-key-003",
    };
    const first = await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/inventory/reserve`,
      headers,
      payload,
    });
    expect(first.statusCode, first.body).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/inventory/reserve`,
      headers,
      payload,
    });
    // الإعادةُ تُعيد نفسَ الجوابِ المحفوظِ بحالته (201)
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());

    // لم يُكتب صفٌّ ثانٍ
    const ledger = await app.inject({
      method: "GET",
      url: `/products/${productId}/inventory?include_ledger=true`,
    });
    // صفّان: initial_stock + reservation
    expect(ledger.json().adjustments).toHaveLength(2);
  });

  it("الإفراجُ يُعيد الكميّةَ إلى الرصيدِ بسبَب `reservation_release`", async () => {
    // احجز أوّلاً
    await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/inventory/reserve`,
      headers: write(),
      payload: {
        order_public_id: "ORDER-004",
        items: [{ product_id: productId, quantity: 4 }],
        idempotency_key: "reserve-key-004",
      },
    });

    // أفرج
    const response = await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/inventory/release`,
      headers: write(),
      payload: {
        order_public_id: "ORDER-004",
        items: [{ product_id: productId, quantity: 4 }],
        idempotency_key: "release-key-004",
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().results).toHaveLength(1);
    expect(response.json().results[0].quantity_delta).toBe(4);
    expect(response.json().results[0].quantity_after).toBe(10);
    expect(response.json().results[0].reason_code).toBe("reservation_release");

    // الرصيد عاد إلى 10
    const inventory = await app.inject({ method: "GET", url: `/products/${productId}/inventory` });
    expect(inventory.json().quantity_on_hand).toBe(10);
  });

  it("منتجٌ لا يخصُّ المتجرَ يُعاد 404", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/inventory/reserve`,
      headers: write(),
      payload: {
        order_public_id: "ORDER-005",
        items: [{ product_id: "00000000-0000-4000-8000-000000000999", quantity: 1 }],
        idempotency_key: "reserve-key-005",
      },
    });
    expect(response.statusCode, response.body).toBe(404);
    expect(response.json().error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("متجرٌ مجهولٌ يُعاد 404", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/stores/no-such-store/inventory/reserve",
      headers: write(),
      payload: {
        order_public_id: "ORDER-006",
        items: [{ product_id: productId, quantity: 1 }],
        idempotency_key: "reserve-key-006",
      },
    });
    expect(response.statusCode, response.body).toBe(404);
    expect(response.json().error.code).toBe("STORE_NOT_FOUND");
  });

  it("جسمٌ ناقصُ الحقولِ يُعاد 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/inventory/reserve`,
      headers: write(),
      payload: { order_public_id: "ORDER-007" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("MARKETPLACE_VALIDATION_FAILED");
  });
});
