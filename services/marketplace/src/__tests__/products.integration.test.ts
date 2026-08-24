/**
 * المنتجُ على قاعدةٍ حقيقيّة: اعتدالٌ مُشتقٌّ من دفترٍ، ونشرٌ يحكمُه قيدٌ لا نيّة.
 *
 * والمفحوصُ هنا ما لا يُفحَص في الذاكرة:
 *
 *  - `ux_products_store_sku`: رمزُ الصنفِ فريدٌ **في المتجرِ** لا في السوقِ كلِّه — ولو كان
 *    الفحصُ في الكودِ لمرّ متجرانِ يكتبان نفسَ الرمزِ في نفسِ اللحظة.
 *  - `ck_products_published_moderated`: منتجٌ منشورٌ اعتدالُه غيرُ معتمَدٍ **مستحيلٌ في القاعدة**.
 *    وهذا خطُّ الدفاعِ الثاني وراءَ `assertProductPublishable`: لو دخل مسارٌ ينسى الفحصَ لسقطت
 *    الكتابةُ لا صمَتت، وتُترجَم إلى `PRODUCT_NOT_MODERATED` لا إلى 500.
 *  - الظهورُ لا يُخزَّن: لا عمودَ `is_visible` في العقدِ ولا في المرآة، والفحصُ يُثبت ذلك بقراءةِ
 *    أعمدةِ الجدولِ من القاعدة نفسِها (القرار 3 · §19.2/3).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { deriveProductModerationState, deriveStoreState } from "../domain/state.js";
import { draftProduct, draftStore } from "../domain/catalog.js";
import { MarketplaceUnitOfWork } from "../db/unit-of-work.js";
import {
  MODERATOR,
  OWNER,
  PG_ENABLED,
  T0,
  T1,
  countRows,
  rejectingConstraint,
  resetData,
  seedLeafCategory,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";

const CATEGORY = { slug: "electronics-phones", depth: 2, isActive: true } as const;

describe.runIf(PG_ENABLED)("استمراريّةُ المنتج", () => {
  let pg: PgFixture;
  let categoryId: string;
  let storeId: string;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
    categoryId = await seedLeafCategory(pg.stores);
    const store = await pg.stores.resources.insertStore(
      draftStore({
        ownerPublicId: OWNER,
        slug: "medina-dates",
        titleAr: "متجرُ تمورِ المدينة",
        categoryId,
        category: CATEGORY,
        activeStoreCount: 0,
      }),
    );
    storeId = store.storeId;
    await pg.stores.ledger.appendStoreReview(storeId, {
      decision: "review_requested",
      actorType: "owner",
      actorPublicId: OWNER,
      fromState: "draft",
      toState: "pending_review",
      stateSequence: 2,
      decidedAt: T0,
    });
    await pg.stores.ledger.appendStoreReview(storeId, {
      decision: "approved",
      actorType: "moderator",
      actorPublicId: MODERATOR,
      fromState: "pending_review",
      toState: "approved",
      stateSequence: 3,
      decidedAt: T0,
    });
    await pg.stores.projection.projectStoreState(
      storeId,
      deriveStoreState(await pg.stores.ledger.listStoreReviews(storeId)),
    );
  });

  async function createProduct(sku = "SKU-0001", store = storeId): Promise<string> {
    const product = await pg.stores.resources.insertProduct(
      draftProduct({
        storeId: store,
        storeState: "approved",
        sku,
        titleAr: "عجوةُ المدينةِ كيلو",
        categoryId,
        category: CATEGORY,
        priceMinorUnits: 4500,
        createdByPublicId: OWNER,
      }),
    );
    return product.productId;
  }

  it("المنتجُ يُنشَأ مسوّدةً باعتدالٍ `pending` وتسلسلٍ صفريّ", async () => {
    const productId = await createProduct();
    const product = await pg.stores.resources.findProductById(productId);
    expect(product?.state).toBe("draft");
    expect(product?.moderationState).toBe("pending");
    expect(product?.priceMinorUnits).toBe(4500);
    expect(product?.currencyCode).toBe("SAR");
  });

  it("ورمزُ الصنفِ فريدٌ في المتجرِ لا في السوق", async () => {
    await createProduct("SKU-0001");
    await expect(createProduct("SKU-0001")).rejects.toMatchObject({
      code: "PRODUCT_SKU_TAKEN",
    });

    const other = await pg.stores.resources.insertStore(
      draftStore({
        ownerPublicId: "WS-1000000007",
        slug: "another-store",
        titleAr: "متجرٌ آخرُ للتجربة",
        categoryId,
        category: CATEGORY,
        activeStoreCount: 0,
      }),
    );
    // متجرٌ آخرُ يُعتمَد بدفترِه كذلك — لا اختصارَ يكتب العمودَ بلا قرار.
    await pg.stores.ledger.appendStoreReview(other.storeId, {
      decision: "review_requested",
      actorType: "owner",
      actorPublicId: "WS-1000000007",
      fromState: "draft",
      toState: "pending_review",
      stateSequence: 2,
      decidedAt: T0,
    });
    await pg.stores.ledger.appendStoreReview(other.storeId, {
      decision: "approved",
      actorType: "moderator",
      actorPublicId: MODERATOR,
      fromState: "pending_review",
      toState: "approved",
      stateSequence: 3,
      decidedAt: T0,
    });
    await pg.stores.projection.projectStoreState(
      other.storeId,
      deriveStoreState(await pg.stores.ledger.listStoreReviews(other.storeId)),
    );
    // نفسُ الرمزِ في متجرٍ آخرَ مقبولٌ: التفرّدُ مُركَّبٌ (store_id, sku).
    await expect(createProduct("SKU-0001", other.storeId)).resolves.toMatch(/^[0-9a-f-]{36}$/u);
    expect(await countRows(pg.pool, "products")).toBe(2);
  });

  it("واعتدالُ المنتجِ إسقاطٌ يساوي اشتقاقَ دفترِه", async () => {
    const productId = await createProduct();
    const uow = new MarketplaceUnitOfWork(pg.db);
    await uow.write(async ({ stores }) => {
      await stores.ledger.appendProductReview(productId, {
        decision: "approved",
        actorType: "moderator",
        actorPublicId: MODERATOR,
        fromState: "pending",
        toState: "approved",
        moderationSequence: 2,
        decidedAt: T1,
      });
      const ledger = await stores.ledger.listProductReviews(productId);
      return stores.projection.projectProductModeration(
        productId,
        deriveProductModerationState(ledger),
      );
    });

    const ledger = await pg.stores.ledger.listProductReviews(productId);
    const derived = deriveProductModerationState(ledger);
    const product = await pg.stores.resources.findProductById(productId);
    expect(product?.moderationState).toBe(derived.moderationState);
    expect(product?.moderationSequence).toBe(derived.moderationSequence);
    expect(derived.moderationState).toBe("approved");
  });

  it("ومنتجٌ منشورٌ غيرُ معتمَدِ الاعتدالِ مستحيلٌ في القاعدة", async () => {
    const productId = await createProduct();
    await expect(pg.stores.projection.projectProductState(productId, "published")).rejects.toMatchObject(
      { code: "PRODUCT_NOT_MODERATED" },
    );
    expect((await pg.stores.resources.findProductById(productId))?.state).toBe("draft");
  });

  it("ورفضُ اعتدالِ منتجٍ منشورٍ يسقط بالرمزِ نفسِه — لا يمرّ بصمت", async () => {
    const productId = await createProduct();
    await pg.stores.projection.projectProductModeration(productId, {
      moderationState: "approved",
      moderationSequence: 2,
    });
    await pg.stores.projection.projectProductState(productId, "published");
    await expect(
      pg.stores.projection.projectProductModeration(productId, {
        moderationState: "rejected",
        moderationSequence: 3,
      }),
    ).rejects.toMatchObject({ code: "PRODUCT_NOT_MODERATED" });
  });

  it("ولا عمودَ ظهورٍ في الجدولِ أصلاً", async () => {
    const result = await pg.pool.query<{ readonly column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'products'`,
    );
    const columns = result.rows.map((row) => row.column_name);
    expect(columns).not.toContain("is_visible");
    expect(columns).not.toContain("visibility");
    expect(columns).not.toContain("next_review_at");
    expect(columns).not.toContain("is_stale");
  });

  it("وسباقُ تسلسلِ اعتدالٍ يسقط باسمِ الفهرس", async () => {
    const productId = await createProduct();
    const entry = {
      decision: "approved",
      actorType: "moderator",
      actorPublicId: MODERATOR,
      fromState: "pending",
      toState: "approved",
      moderationSequence: 2,
      decidedAt: T1,
    } as const;
    await pg.stores.ledger.appendProductReview(productId, entry);
    expect(await rejectingConstraint(pg.stores.ledger.appendProductReview(productId, entry))).toBe(
      "ux_product_reviews_sequence",
    );
  });

  it("وقائمةُ منتجاتِ المتجرِ مرتّبةٌ برمزِ الصنف", async () => {
    await createProduct("SKU-0003");
    await createProduct("SKU-0001");
    await createProduct("SKU-0002");
    const listed = await pg.stores.resources.listProductsByStore(storeId);
    expect(listed.map((product) => product.sku)).toEqual(["SKU-0001", "SKU-0002", "SKU-0003"]);
  });
});
