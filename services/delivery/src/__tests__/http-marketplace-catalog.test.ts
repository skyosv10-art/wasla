/**
 * محوّلُ كتالوجِ السوقِ عبرَ HTTP — المراجعةُ 8/N (ADR-026 §4.9-2 → §4.11).
 *
 * ما تُثبِتُهُ هذه الاختباراتُ ليسَ «أنَّ fetch يُنادى»، بل الحدودَ التي لو
 * انزلقتْ لَأنتجتْ عطباً صامتاً:
 *
 *  1. `404` ⇒ «لا متجرَ/لا منتجَ» (رفضٌ دائمٌ)، وكلُّ ما ليسَ جواباً ⇒ 503.
 *  2. لا لقطةَ جزئيّةٌ: إخفاقُ نداءِ منتجٍ واحدٍ يُسقِطُ الدفعةَ كلَّها.
 *  3. منتجٌ من متجرٍ آخرَ = غيرُ موجودٍ — وإلّا بُنِيَ طلبٌ من كتالوجَينِ.
 *  4. كلُّ نداءٍ موقَّعٌ، والتوقيعُ مربوطٌ بالمسارِ الذي يُنادى.
 */

import { describe, expect, it } from "vitest";

import { DeliveryError } from "../domain/errors.js";
import {
  DELIVERY_MARKETPLACE_SCOPES,
  HttpMarketplaceCatalogPort,
  MARKETPLACE_FAILURE_REASONS,
} from "../infrastructure/http-marketplace-catalog.js";
import type { StoreSlug } from "@wasla/contracts-delivery";

const SLUG = "matjar-alfawakih" as StoreSlug;
const STORE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_STORE_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";

interface Call {
  readonly url: string;
  readonly path: string;
  readonly headers: Record<string, string>;
}

/** موقِّعٌ مُزيَّفٌ يشهدُ على الطريقةِ والمسارِ اللذَينِ وُقِّعا فعلاً. */
function stubSigner(): (method: string, path: string) => Record<string, string> {
  return (method, path) => ({
    "x-wasla-service-token": `token:${method}:${path}`,
    "x-wasla-service-scopes": DELIVERY_MARKETPLACE_SCOPES.join(" "),
  });
}

function storeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    store_id: STORE_ID,
    store_slug: SLUG,
    owner_public_id: "WS-0000000009",
    title_ar: "متجرُ الفواكهِ",
    category_slug: "grocery",
    state: "approved",
    state_sequence: 3,
    is_slug_locked: true,
    first_approved_at: "2026-09-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function productBody(
  productId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    product_id: productId,
    store_id: STORE_ID,
    store_slug: SLUG,
    sku: `SKU-${productId.slice(0, 4)}`,
    title_ar: "تفّاحٌ",
    category_slug: "grocery",
    price_minor_units: 1250,
    currency_code: "SAR",
    state: "published",
    moderation_state: "approved",
    moderation_sequence: 2,
    quantity_on_hand: 7,
    is_visible: true,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

type Responder = (path: string) => { status: number; body?: unknown; raw?: string } | Error;

function buildPort(
  responder: Responder,
  options: { timeoutMs?: number; maxConcurrency?: number } = {},
): { port: HttpMarketplaceCatalogPort; calls: Call[]; inFlightPeak: () => number } {
  const calls: Call[] = [];
  let inFlight = 0;
  let peak = 0;

  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace("http://marketplace:8090", "");
    calls.push({ url, path, headers: (init?.headers ?? {}) as Record<string, string> });

    inFlight += 1;
    peak = Math.max(peak, inFlight);
    // فاصلٌ حقيقيٌّ في حلقةِ الحوادثِ: بلا انتظارٍ لا يُقاسُ التوازي.
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;

    const outcome = responder(path);
    if (outcome instanceof Error) throw outcome;
    const raw = outcome.raw ?? JSON.stringify(outcome.body ?? {});
    return {
      status: outcome.status,
      json: async () => JSON.parse(raw) as unknown,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return {
    port: new HttpMarketplaceCatalogPort({
      baseUrl: "http://marketplace:8090/",
      signRequest: stubSigner(),
      fetchImpl,
      ...options,
    }),
    calls,
    inFlightPeak: () => peak,
  };
}

async function expectFailure(
  run: () => Promise<unknown>,
  reason: (typeof MARKETPLACE_FAILURE_REASONS)[number],
): Promise<void> {
  await expect(run()).rejects.toThrowError(DeliveryError);
  try {
    await run();
    expect.unreachable("كانَ يجبُ أن يَصعدَ خطأٌ");
  } catch (error) {
    const err = error as DeliveryError;
    expect(err.code).toBe("DELIVERY_MARKETPLACE_UNAVAILABLE");
    expect(err.httpStatus).toBe(503);
    expect(err.details.actual).toBe(reason);
  }
}

describe("HttpMarketplaceCatalogPort · resolving the store by its published slug", () => {
  it("reads the store over the slug path and signs THAT path", async () => {
    const { port, calls } = buildPort(() => ({ status: 200, body: storeBody() }));
    const store = await port.getStoreBySlug(SLUG);

    expect(store).toEqual({ storeId: STORE_ID, orderable: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(`/stores/${SLUG}`);
    // الرمزُ مربوطٌ بالطريقةِ والمسارِ (ADR-021 §4): رمزٌ عامٌّ كانَ يُعادُ استعمالُهُ.
    expect(calls[0]?.headers["x-wasla-service-token"]).toBe(`token:GET:/stores/${SLUG}`);
    expect(calls[0]?.headers["x-wasla-service-scopes"]).toContain("marketplace:store:read");
  });

  it("percent-encodes the slug instead of pasting it into the path", async () => {
    const { port, calls } = buildPort(() => ({ status: 404 }));
    await port.getStoreBySlug("a/b" as StoreSlug);
    expect(calls[0]?.path).toBe("/stores/a%2Fb");
  });

  it("404 is an ANSWER (null), not an outage", async () => {
    const { port } = buildPort(() => ({ status: 404 }));
    expect(await port.getStoreBySlug(SLUG)).toBeNull();
  });

  it("only an approved store with a locked slug is orderable", async () => {
    for (const state of ["draft", "pending_review", "rejected", "suspended", "archived"]) {
      const { port } = buildPort(() => ({ status: 200, body: storeBody({ state }) }));
      expect(await port.getStoreBySlug(SLUG)).toEqual({ storeId: STORE_ID, orderable: false });
    }
    // موافَقٌ عليهِ وslug غيرُ مقفولٍ: مرجعٌ قد يتغيّرُ، ودفترُنا يحفظُهُ نصّاً.
    const { port } = buildPort(() => ({
      status: 200,
      body: storeBody({ is_slug_locked: false }),
    }));
    expect(await port.getStoreBySlug(SLUG)).toEqual({ storeId: STORE_ID, orderable: false });
  });

  it("refuses a body describing a DIFFERENT store rather than binding the order to it", async () => {
    const { port } = buildPort(() => ({
      status: 200,
      body: storeBody({ store_slug: "matjar-akhar" }),
    }));
    await expectFailure(() => port.getStoreBySlug(SLUG), "marketplace_contract_drift");
  });

  it("refuses a body with no store_id — a snapshot needs the internal id", async () => {
    const { port } = buildPort(() => ({ status: 200, body: storeBody({ store_id: undefined }) }));
    await expectFailure(() => port.getStoreBySlug(SLUG), "marketplace_contract_drift");
  });

  it("separates «we don't know» into causes an operator can act on", async () => {
    const cases: ReadonlyArray<[Responder, (typeof MARKETPLACE_FAILURE_REASONS)[number]]> = [
      [() => ({ status: 401 }), "marketplace_denied_identity"],
      [() => ({ status: 403 }), "marketplace_denied_identity"],
      [() => ({ status: 400 }), "marketplace_rejected_request"],
      [() => ({ status: 422 }), "marketplace_rejected_request"],
      [() => ({ status: 500 }), "marketplace_error_status"],
      [() => ({ status: 503 }), "marketplace_error_status"],
      [() => ({ status: 200, raw: "<html>not json</html>" }), "marketplace_unreadable_body"],
      [() => ({ status: 200, raw: "\"a string is not an object\"" }), "marketplace_unreadable_body"],
      [() => new TypeError("connect ECONNREFUSED"), "marketplace_unreachable"],
    ];
    for (const [responder, reason] of cases) {
      const { port } = buildPort(responder);
      await expectFailure(() => port.getStoreBySlug(SLUG), reason);
    }
  });

  it("reports a timeout as a timeout, and never leaks the DSN or the exception text", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const { port } = buildPort(() => abortError, { timeoutMs: 5 });
    await expectFailure(() => port.getStoreBySlug(SLUG), "marketplace_timeout");

    try {
      await port.getStoreBySlug(SLUG);
    } catch (error) {
      const err = error as DeliveryError;
      expect(JSON.stringify(err.details)).not.toContain("aborted");
      expect(MARKETPLACE_FAILURE_REASONS).toContain(err.details.actual);
    }
  });
});

describe("HttpMarketplaceCatalogPort · price snapshots", () => {
  it("returns one snapshot per product, in the ORDER the cart asked for", async () => {
    const { port, calls } = buildPort((path) => ({
      status: 200,
      body: productBody(path.replace("/products/", "")),
    }));
    const snapshots = await port.getProductSnapshots(STORE_ID, [PRODUCT_B, PRODUCT_A]);

    expect(snapshots.map((s) => s.productId)).toEqual([PRODUCT_B, PRODUCT_A]);
    expect(snapshots[0]?.unitPriceMinorUnits).toBe(1250);
    expect(calls.map((c) => c.path)).toEqual([`/products/${PRODUCT_B}`, `/products/${PRODUCT_A}`]);
  });

  it("asks once for a product the cart repeats", async () => {
    const { port, calls } = buildPort((path) => ({
      status: 200,
      body: productBody(path.replace("/products/", "")),
    }));
    const snapshots = await port.getProductSnapshots(STORE_ID, [PRODUCT_A, PRODUCT_A, PRODUCT_A]);
    expect(calls).toHaveLength(1);
    expect(snapshots).toHaveLength(1);
  });

  it("omits — never invents — a product the store does not sell", async () => {
    const { port } = buildPort((path) =>
      path.includes(PRODUCT_B)
        ? { status: 200, body: productBody(PRODUCT_B, { store_id: OTHER_STORE_ID }) }
        : { status: 200, body: productBody(PRODUCT_A) },
    );
    const snapshots = await port.getProductSnapshots(STORE_ID, [PRODUCT_A, PRODUCT_B]);
    // السطرُ الغائبُ يرفضُهُ المجالُ برفضِهِ هو، لا برفضٍ يخترعُهُ المحوّلُ.
    expect(snapshots.map((s) => s.productId)).toEqual([PRODUCT_A]);
  });

  it("omits an invisible product and a missing one alike", async () => {
    const { port } = buildPort((path) =>
      path.includes(PRODUCT_A)
        ? { status: 200, body: productBody(PRODUCT_A, { is_visible: false }) }
        : { status: 404 },
    );
    expect(await port.getProductSnapshots(STORE_ID, [PRODUCT_A, PRODUCT_B])).toEqual([]);
  });

  it("refuses an unreadable price instead of silently dropping the line", async () => {
    const drifts: ReadonlyArray<Record<string, unknown>> = [
      { currency_code: "USD" },
      { price_minor_units: 12.5 },
      { price_minor_units: 0 },
      { price_minor_units: "1250" },
      { sku: "" },
    ];
    for (const overrides of drifts) {
      const { port } = buildPort(() => ({
        status: 200,
        body: productBody(PRODUCT_A, overrides),
      }));
      await expectFailure(
        () => port.getProductSnapshots(STORE_ID, [PRODUCT_A]),
        "marketplace_contract_drift",
      );
    }
  });

  it("fails the WHOLE batch when one product call fails — no partial snapshot", async () => {
    const { port } = buildPort((path) =>
      path.includes(PRODUCT_B) ? { status: 500 } : { status: 200, body: productBody(PRODUCT_A) },
    );
    // لو عادتْ لقطةُ A وحدَها لَرفضَ المجالُ سطرَ B بـ«منتجٌ غيرُ معروفٍ»:
    // خطأٌ دائمٌ عن عطلٍ عابرٍ.
    await expectFailure(
      () => port.getProductSnapshots(STORE_ID, [PRODUCT_A, PRODUCT_B]),
      "marketplace_error_status",
    );
  });

  it("caps how many product calls are in flight at once", async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `${i}1111111-1111-4111-8111-111111111111`);
    const { port, inFlightPeak, calls } = buildPort(
      (path) => ({ status: 200, body: productBody(path.replace("/products/", "")) }),
      { maxConcurrency: 2 },
    );
    const snapshots = await port.getProductSnapshots(STORE_ID, ids);
    expect(snapshots).toHaveLength(9);
    expect(calls).toHaveLength(9);
    // سلّةٌ كبيرةٌ لا تُصبحُ فيضاً على حدِّ السوقِ.
    expect(inFlightPeak()).toBeLessThanOrEqual(2);
  });

  it("asks nothing when the cart has no lines", async () => {
    const { port, calls } = buildPort(() => ({ status: 500 }));
    expect(await port.getProductSnapshots(STORE_ID, [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

/**
 * الوصلُ الكاملُ: طلبٌ يدخلُ عبرَ HTTP فيُوضَعُ فعلاً.
 *
 * هذه هي الجملةُ التي لم يكن يستطيعُ أحدٌ كتابتَها قبلَ المراجعةِ 8/N: كانَ
 * `POST /store-orders` يُجيبُ 503 دائماً لأنَّ المنفذَ لا يمكنُ وصلُهُ (§4.9-2).
 * ولذلك تُختَبَرُ السلسلةُ كلُّها — مسارٌ ⇢ مجالٌ ⇢ منفذٌ ⇢ حدُّ السوقِ — لا
 * المحوّلُ وحدَه: عقدٌ متطابقٌ في وحدتَينِ منفصلتَينِ لا يُثبِتُ أنّهما مربوطتانِ.
 */
describe("HttpMarketplaceCatalogPort · wired into the HTTP boundary (§4.11)", () => {
  it("places an order for a slug — the answer that was 503 for seven reviews", async () => {
    const { buildDeliveryHttpApp } = await import("../http/app.js");
    const { FakeStoreOrderStore, FakeReservationPort, FakeReservationStore, CUSTOMER_REF, uuidSequence } = await import(
      "./store-order-fakes.js"
    );

    const seen: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      const path = String(input).replace("http://marketplace:8090", "");
      seen.push(path);
      const body = path.startsWith("/stores/")
        ? storeBody()
        : productBody(path.replace("/products/", ""));
      return { status: 200, json: async () => body } as unknown as Response;
    }) as unknown as typeof fetch;

    const store = new FakeStoreOrderStore();
    const app = buildDeliveryHttpApp({
      readPort: store,
      writePort: store,
      catalogPort: new HttpMarketplaceCatalogPort({
        baseUrl: "http://marketplace:8090",
        signRequest: stubSigner(),
        fetchImpl,
      }),
      reservationPort: new FakeReservationPort(),
      reservationStore: new FakeReservationStore(),
      newUuid: uuidSequence(),
      now: () => "2026-09-10T10:00:00.000Z",
    });

    const res = await app.fastify.inject({
      method: "POST",
      url: "/store-orders",
      headers: { "idempotency-key": "idem-catalog-00000001" },
      payload: {
        customer_ref: CUSTOMER_REF,
        store_slug: SLUG,
        items: [{ product_id: PRODUCT_A, quantity: 2 }],
        delivery_fee_minor_units: 500,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.store_slug).toBe(SLUG);
    // السعرُ من لقطةِ السوقِ لا من المنادي: 1250 × 2 + 500.
    expect(body.items_total_minor_units).toBe(2500);
    expect(body.total_minor_units).toBe(3000);
    expect(seen).toEqual([`/stores/${SLUG}`, `/products/${PRODUCT_A}`]);
    await app.close();
  });

  it("400s an unknown slug and 503s an outage — the two must not merge", async () => {
    const { buildDeliveryHttpApp } = await import("../http/app.js");
    const { FakeStoreOrderStore, FakeReservationPort, FakeReservationStore, CUSTOMER_REF, uuidSequence } = await import(
      "./store-order-fakes.js"
    );

    const cases: ReadonlyArray<[number, number, string]> = [
      [404, 400, "DELIVERY_VALIDATION_FAILED"],
      [500, 503, "DELIVERY_MARKETPLACE_UNAVAILABLE"],
    ];
    let key = 0;
    for (const [marketplaceStatus, expectedStatus, expectedCode] of cases) {
      const fetchImpl = (async () =>
        ({ status: marketplaceStatus, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
      const store = new FakeStoreOrderStore();
      const app = buildDeliveryHttpApp({
        readPort: store,
        writePort: store,
        catalogPort: new HttpMarketplaceCatalogPort({
          baseUrl: "http://marketplace:8090",
          signRequest: stubSigner(),
          fetchImpl,
        }),
        reservationPort: new FakeReservationPort(),
        reservationStore: new FakeReservationStore(),
        newUuid: uuidSequence(),
        now: () => "2026-09-10T10:00:00.000Z",
      });
      key += 1;
      const res = await app.fastify.inject({
        method: "POST",
        url: "/store-orders",
        headers: { "idempotency-key": `idem-catalog-0000000${key}` },
        payload: {
          customer_ref: CUSTOMER_REF,
          store_slug: SLUG,
          items: [{ product_id: PRODUCT_A, quantity: 1 }],
          delivery_fee_minor_units: 500,
        },
      });
      expect(res.statusCode).toBe(expectedStatus);
      expect(res.json().error_code).toBe(expectedCode);
      // لا طلبَ يُكتَبُ في الحالتَينِ: الرفضُ قبلَ أيِّ سطرٍ في الدفترِ.
      expect(store.orders.size).toBe(0);
      await app.close();
    }
  });
});
