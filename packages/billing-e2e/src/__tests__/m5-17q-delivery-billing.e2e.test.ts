/**
 * بوّابةُ خروجِ M5-17Q (CLM-0376 · ADR-050 §3 وملحقُ التنفيذ):
 * **حدثُ اكتمالٍ حقيقيٌّ → فاتورةٌ + تسويةٌ مرّةً واحدةً بلا تسميم.**
 *
 * المنتِجُ هنا هوَ المنتِجُ الحقيقيُّ: حدُّ التوصيلِ (`buildDeliveryHttpApp`) بمسارِهِ
 * الموقَّعِ ومخزنِ طلباتِهِ (`StoreOrderStore`) على PostgreSQL — فصفوفُ
 * `delivery_outbox` يكتبُها `appendOutbox` نفسُهُ داخلَ معاملةِ كلِّ انتقال، لا
 * مُثبِّتٌ اختباريٌّ. والمستهلِكُ هوَ ما يُركِّبُهُ `services/billing/src/http/server.ts`
 * حرفيّاً: `PostgresDeliveryEventSource` + منافذُ المعاملةِ من `@wasla/billing-service/pg`.
 *
 * بديلانِ مُعلَنانِ فقط، وكلاهما **قبلَ** المنتِجِ لا فيه: منفذُ الكتالوجِ (سعرٌ ثابتٌ
 * لمتجرٍ واحدٍ) ومنفذُ حجزِ المخزونِ (يقبلُ دائماً). بوّابةُ السوقِ الحقيقيِّ لهما هيَ
 * `packages/delivery-e2e`؛ ودعوى هذهِ البوّابةِ هيَ الحدُّ **التوصيل ← الفوترة**.
 *
 * وما لا تُثبِتُهُ: الاستبدالُ (`store_order.item_substituted`) لا مسارَ HTTP لهُ بعدُ،
 * فتعديلُ الأساسِ مُثبَتٌ على صفوفٍ بشكلِ العقدِ في `services/billing` فقط.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_RELAY_CONFIG,
  runRelayBatch,
  storeVariableFee,
  type RelayDeps,
} from "@wasla/billing-service";
import {
  PostgresConsumedEventLedger,
  PostgresDeliveryEventSource,
  PostgresRelayCheckpointStore,
  PostgresRelayConsumerLock,
  PostgresRelayTransactionRunner,
  applyBillingSchema,
} from "@wasla/billing-service/pg";
import {
  DELIVERY_SCOPES,
  DELIVERY_SERVICE_AUDIENCE,
  PostgresReadinessProbe,
  StoreOrderStore,
  buildDeliveryHttpApp,
  type CatalogProductSnapshot,
  type DeliveryHttpApp,
  type DeliveryHttpDeps,
  type StoreOrderCatalogPort,
} from "@wasla/delivery-service";
import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
} from "@wasla/service-auth";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = typeof DATABASE_URL === "string" && DATABASE_URL.length > 0;

const REPO = resolve(process.cwd(), "../..");
const DELIVERY_SCHEMA_SQL = readFileSync(resolve(REPO, "services/delivery/contracts/schema.sql"), "utf8");
const DELIVERY_TABLES = [...DELIVERY_SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
const BILLING_TABLES = [
  "billing_store_order_snapshots",
  "billing_relay_consumed_events",
  "billing_relay_checkpoint",
  "billing_outbox",
  "billing_invoices",
  "billing_settlements",
  "billing_schema_migrations",
] as const;

const STORE_ID = "cccccccc-0000-4000-8000-00000000517a";
const STORE_SLUG = "madinah-billing-gate";
const PRODUCT_A = "aaaaaaaa-0000-4000-8000-00000000517a";
const PRODUCT_B = "aaaaaaaa-0000-4000-8000-00000000517b";
const PRICES: Record<string, number> = { [PRODUCT_A]: 4250, [PRODUCT_B]: 1199 };
const DELIVERY_FEE = 1500;
const CUSTOMER = "WS-7000000001";

type ReservationPort = NonNullable<DeliveryHttpDeps["reservationPort"]>;

/** الكتالوجُ قبلَ المنتِج: متجرٌ واحدٌ وسعرانِ ثابتان. */
class StaticCatalog implements StoreOrderCatalogPort {
  async getStoreBySlug(): Promise<{ storeId: string; orderable: boolean }> {
    return { storeId: STORE_ID, orderable: true };
  }
  async getProductSnapshots(_storeId: string, ids: readonly string[]): Promise<readonly CatalogProductSnapshot[]> {
    return ids
      .filter((id) => id in PRICES)
      .map((id) => ({ productId: id, sku: `SKU-${id.slice(-4)}`, unitPriceMinorUnits: PRICES[id] }));
  }
}

/** الحجزُ قبلَ المنتِج: يقبلُ دائماً؛ وسجلُّ الحجوزاتِ هوَ مخزنُ التوصيلِ الحقيقيّ. */
const acceptingReservations: ReservationPort = {
  async reserve() {
    return { reserved: true, reservationRef: `res-${randomUUID()}` };
  },
  async release() {
    return { released: true };
  },
};

const keys = new ServiceAuthKeyRegistry({
  keys: [{ kid: "billing-gate", secret: "billing-e2e-gate-secret-0123456789ab", status: "active" }],
  activeKid: "billing-gate",
});

let keyCounter = 0;
const nextKey = (p: string) => `idem-m517q-${p}-${String(++keyCounter).padStart(6, "0")}`;

interface Res {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly text: string;
}

async function call(app: DeliveryHttpApp, method: string, path: string, body?: unknown, key?: string): Promise<Res> {
  const headers: Record<string, string> = {
    ...serviceAuthHeaders({
      serviceName: "core",
      audience: DELIVERY_SERVICE_AUDIENCE,
      method,
      path,
      keys,
      now: new Date(),
      scopes: Object.values(DELIVERY_SCOPES),
    }),
  };
  if (key) headers["idempotency-key"] = key;
  const res = await app.fastify.inject({
    method: method as "GET" | "POST" | "PUT",
    url: path,
    headers,
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    /* non-JSON */
  }
  return { status: res.statusCode, body: parsed, text: res.body };
}

async function n(pool: pg.Pool, sql: string, params: unknown[] = []): Promise<number> {
  const r = await pool.query<{ n: string }>(sql, params);
  return Number(r.rows[0].n);
}

describe.skipIf(!ENABLED)("M5-17Q — delivery (real producer) → billing relay on one PostgreSQL", () => {
  let pool: pg.Pool;
  let source: pg.Pool;
  let app: DeliveryHttpApp;

  const relayDeps = (billing: pg.Pool = pool): RelayDeps => ({
    events: new PostgresDeliveryEventSource(source),
    transaction: new PostgresRelayTransactionRunner(billing),
    ledger: new PostgresConsumedEventLedger(billing),
    checkpoint: new PostgresRelayCheckpointStore(billing),
    lock: new PostgresRelayConsumerLock(billing),
    idGen: { newInvoiceId: randomUUID, newSettlementId: randomUUID, newPayoutId: randomUUID },
    clock: { now: () => new Date() },
  });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
    source = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
    await pool.query(`DROP TABLE IF EXISTS ${[...BILLING_TABLES, ...DELIVERY_TABLES].join(", ")} CASCADE`);
    await pool.query(DELIVERY_SCHEMA_SQL);
    await applyBillingSchema(pool);
    const store = new StoreOrderStore(pool);
    app = buildDeliveryHttpApp({
      serviceIdentity: { keys, replayGuard: new InMemoryServiceTokenReplayGuard() },
      readPort: store,
      writePort: store,
      readinessPort: new PostgresReadinessProbe(pool),
      idempotencySweepPort: store,
      catalogPort: new StaticCatalog(),
      reservationPort: acceptingReservations,
      reservationStore: store,
    });
    await app.fastify.ready();
  });

  afterAll(async () => {
    await app?.close();
    await source?.end();
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${[...BILLING_TABLES.filter((t) => t !== "billing_schema_migrations"), ...DELIVERY_TABLES].join(", ")} RESTART IDENTITY CASCADE`);
  });

  async function placeAndConfirm(items: { product_id: string; quantity: number }[]): Promise<Record<string, unknown>> {
    const placed = await call(app, "POST", "/store-orders", {
      customer_ref: CUSTOMER,
      store_slug: STORE_SLUG,
      items,
      delivery_fee_minor_units: DELIVERY_FEE,
    }, nextKey("place"));
    expect(placed.status, placed.text).toBe(201);
    const id = placed.body.public_id as string;
    const mirrored = await call(app, "PUT", `/store-orders/${id}/payment-mirror`, {
      payment_state: "authorized",
      reason_code: "AUTHORIZATION_SUCCEEDED",
      payment_ref: `PAY-${randomUUID().slice(0, 8)}`,
    }, nextKey("mirror"));
    expect(mirrored.status, mirrored.text).toBe(200);
    const confirmed = await call(app, "POST", `/store-orders/${id}/confirmation`, undefined, nextKey("confirm"));
    expect(confirmed.status, confirmed.text).toBe(200);
    return placed.body;
  }

  async function deliver(publicId: string): Promise<void> {
    for (const to of ["picking", "picked", "ready_for_delivery", "handed_to_courier", "delivered"]) {
      const body: Record<string, unknown> = { to_state: to };
      if (to === "delivered") Object.assign(body, { proof_type: "otp", proof_ref: `OTP-${publicId}` });
      const res = await call(app, "POST", `/store-orders/${publicId}/fulfillment-transition`, body, nextKey(`ft-${to}`));
      expect(res.status, res.text).toBe(200);
    }
  }

  it("a real delivered store order → exactly one invoice + one settlement + one fee_settled, zero poisoned", async () => {
    // سطرانِ (M5-13M · CLM-0378): قبلَ ترحيلِ التوصيلِ `0005` كانَ الطلبُ متعدِّدُ الأسطرِ يسقطُ
    // بـ500 على `UNIQUE (marketplace_reservation_ref)` فاقتصرَ هذا الاختبارُ على سطرٍ واحد.
    // والرسمُ يُقاسُ على مجموعِ الأصنافِ **كلِّها** (بلا توصيل) — لا على السطرِ الأوّل.
    const order = await placeAndConfirm([
      { product_id: PRODUCT_A, quantity: 3 },
      { product_id: PRODUCT_B, quantity: 2 },
    ]);
    const publicId = order.public_id as string;
    const itemsTotal = PRICES[PRODUCT_A] * 3 + PRICES[PRODUCT_B] * 2;
    expect((order.items as unknown[]).length).toBe(2);
    expect(order.items_total_minor_units).toBe(itemsTotal);
    await deliver(publicId);

    // المنتِجُ كتبَ الحدثَينِ اللذَينِ يستهلكُهما المُرحِّلُ — بلا يدٍ اختباريّة.
    const produced = await pool.query<{ event_type: string; to_state: string | null }>(
      `SELECT event_type, payload->>'to_state' AS to_state FROM delivery_outbox
        WHERE aggregate_type = 'store_order' ORDER BY outbox_id`,
    );
    expect(produced.rows[0].event_type).toBe("store_order.created");
    expect(produced.rows.some((r) => r.to_state === "delivered")).toBe(true);

    const result = await runRelayBatch(relayDeps(), DEFAULT_RELAY_CONFIG);
    expect(result).toMatchObject({ settled: 1, recorded: 1, poisoned: 0, pending: 0 });
    expect(result.processed).toBe(await n(pool, `SELECT count(*)::text AS n FROM delivery_outbox`));

    const fee = storeVariableFee(itemsTotal);
    const inv = await pool.query<{ amount_cents: string; store_public_id: string; state: string; fee_type: string }>(
      `SELECT amount_cents::text, store_public_id, state, fee_type FROM billing_invoices`,
    );
    expect(inv.rows).toEqual([{ amount_cents: String(fee), store_public_id: STORE_ID, state: "draft", fee_type: "store_variable" }]);
    expect(await n(pool, `SELECT count(*)::text AS n FROM billing_settlements WHERE amount_cents = $1 AND state = 'settled'`, [fee])).toBe(1);
    expect(await n(pool, `SELECT count(*)::text AS n FROM billing_outbox WHERE event_type = 'billing.fee_settled'`)).toBe(1);
    expect(
      await n(pool, `SELECT count(*)::text AS n FROM billing_store_order_snapshots WHERE order_public_id = $1 AND settlement_id IS NOT NULL`, [publicId]),
    ).toBe(1);
    expect(await n(pool, `SELECT count(*)::text AS n FROM billing_relay_consumed_events WHERE status = 'poisoned'`)).toBe(0);

    // إعادةُ التسليمِ الكاملِ بعدَ فقدِ نقطةِ التفتيشِ لا تُسوّي شيئاً ثانيةً.
    await pool.query(`DELETE FROM billing_relay_checkpoint`);
    const again = await runRelayBatch(relayDeps(), DEFAULT_RELAY_CONFIG);
    expect(again).toMatchObject({ settled: 0, recorded: 0, poisoned: 0 });
    expect(await n(pool, `SELECT count(*)::text AS n FROM billing_settlements`)).toBe(1);
    expect(await n(pool, `SELECT count(*)::text AS n FROM billing_invoices`)).toBe(1);
    expect(await n(pool, `SELECT count(*)::text AS n FROM billing_outbox`)).toBe(1);
  });

  it("delivered, cancelled and still-open orders reconcile: fees = invoices = settlements, one per delivered order", async () => {
    const delivered: number[] = [];
    for (const q of [1, 3]) {
      const o = await placeAndConfirm([{ product_id: PRODUCT_A, quantity: q }]);
      await deliver(o.public_id as string);
      delivered.push(PRICES[PRODUCT_A] * q);
    }
    const cancelled = await placeAndConfirm([
      { product_id: PRODUCT_B, quantity: 5 },
      { product_id: PRODUCT_A, quantity: 1 },
    ]);
    const c = await call(app, "POST", `/store-orders/${cancelled.public_id as string}/cancellation`, {
      reason_code: "CUSTOMER_CHANGED_MIND",
    }, nextKey("cancel"));
    expect(c.status, c.text).toBe(200);
    await placeAndConfirm([{ product_id: PRODUCT_B, quantity: 2 }]);

    // دفعتانِ متزامنتانِ على الصفوفِ نفسِها.
    const other = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
    try {
      const [a, b] = await Promise.all([
        runRelayBatch(relayDeps(), DEFAULT_RELAY_CONFIG),
        runRelayBatch(relayDeps(other), DEFAULT_RELAY_CONFIG),
      ]);
      expect(a.settled + b.settled).toBe(2);
      expect(a.poisoned + b.poisoned).toBe(0);
    } finally {
      await other.end();
    }
    await runRelayBatch(relayDeps(), DEFAULT_RELAY_CONFIG);

    const expected = delivered.reduce((s, b) => s + storeVariableFee(b), 0);
    const sums = await pool.query<{ inv: string; stl: string; n: string }>(
      `SELECT (SELECT coalesce(sum(amount_cents),0) FROM billing_invoices)::text AS inv,
              (SELECT coalesce(sum(amount_cents),0) FROM billing_settlements)::text AS stl,
              (SELECT count(*) FROM billing_settlements)::text AS n`,
    );
    expect(sums.rows[0]).toEqual({ inv: String(expected), stl: String(expected), n: "2" });
    expect(await n(pool, `SELECT count(*)::text AS n FROM billing_store_order_snapshots`)).toBe(4);
    expect(await n(pool, `SELECT count(*)::text AS n FROM billing_relay_consumed_events WHERE status = 'poisoned'`)).toBe(0);
    expect(await n(pool, `SELECT count(*)::text AS n FROM billing_relay_consumed_events WHERE status = 'settled'`)).toBe(2);
    // كلُّ صفٍّ كتبَهُ المنتِجُ صارَ نهائيّاً في الدفتر — لا شيءَ معلّق.
    expect(await n(pool, `SELECT count(*)::text AS n FROM billing_relay_consumed_events`)).toBe(
      await n(pool, `SELECT count(*)::text AS n FROM delivery_outbox`),
    );
  });

  it("ADR-050 Consequence 3: the orders contract carries no financial field", () => {
    const events = JSON.parse(readFileSync(resolve(REPO, "services/orders/contracts/events.json"), "utf8")) as {
      $defs: Record<string, unknown>;
    };
    const text = JSON.stringify(events.$defs.OrderStatusChangedV1 ?? {}).toLowerCase();
    expect(text.length).toBeGreaterThan(2);
    for (const word of ["amount", "total", "price", "fee", "minor_units", "cents", "currency"]) {
      expect(text, `OrderStatusChangedV1 must not carry "${word}"`).not.toContain(word);
    }
  });
});
