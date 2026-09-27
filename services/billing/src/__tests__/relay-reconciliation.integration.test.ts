/**
 * بوّابةُ تسويةِ الفوترةِ على PostgreSQL حقيقي (M5-17P · CLM-0375 · ADR-050 §3).
 *
 * الدعوى: كلُّ حدثِ «طلبٍ مكتمل» في `order_outbox` يصيرُ **فاتورةً واحدةً وتسويةً واحدةً
 * وصفَّ صادرٍ واحداً** — لا أقلَّ ولا أكثر — ومجموعُ الرسومِ المُسوّاةِ يساوي مجموعَ
 * الفواتيرِ ويساوي ما يُحسَبُ من الأحداثِ نفسِها. وتُقاسُ الدعوى تحتَ ما يكسرُها في
 * الإنتاج: فقدُ نقطةِ التفتيش (إعادةُ تسليم)، وفشلُ قاعدةِ البياناتِ في منتصفِ المعاملة،
 * ودفعتانِ متزامنتان، وحدثٌ مسموم.
 *
 * الحدُّ المُعلَن: حمولةُ الأحداثِ هنا هيَ ما يطلبُهُ مُصنِّفُ المُرحِّل
 * (`store_public_id` · `order_total_cents`). عقدُ الطلباتِ الحاليُّ
 * (`OrderStatusChangedV1`) لا يحملُ هذينِ الحقلَين — فهذا الاختبارُ يُثبِتُ صحّةَ
 * الاستدامةِ والتسوية، لا توافقَ المنتِجِ الحقيقي. والفجوةُ مُعلَنةٌ في TASK_LOG.
 */

import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresInvoiceStore } from "../infrastructure/drizzle/repository.js";
import { createBillingDb } from "../infrastructure/drizzle/db.js";
import { PostgresSettlement } from "../infrastructure/pg/settlement-store.js";
import { DEFAULT_RELAY_CONFIG, STORE_VARIABLE_FEE_BPS, runRelayBatch } from "../relay.js";
import {
  PG_ENABLED,
  DATABASE_URL,
  PostgresOutboxPublisher,
  completedOrder,
  count,
  insertOrderEvent,
  newPool,
  postgresRelayDeps,
  resetData,
  resetSchema,
} from "./pg-harness.js";

const CONSUMER = DEFAULT_RELAY_CONFIG.consumerId;

function fee(total: number): number {
  return Math.max(1, Math.floor((total * STORE_VARIABLE_FEE_BPS) / 10000));
}

describe.skipIf(!PG_ENABLED)("billing relay — reconciliation gate on real Postgres", () => {
  let billing: Pool;
  let source: Pool;

  beforeAll(async () => {
    billing = newPool();
    source = newPool(2);
    await resetSchema(billing);
  });

  afterAll(async () => {
    await source?.end();
    await billing?.end();
  });

  beforeEach(async () => {
    await resetData(billing);
  });

  /** الأحداثُ المختلطة: 5 مكتملة · 2 ملغاة · 1 مسموم · 1 غريب. */
  async function seedMixed(): Promise<{ totals: number[]; lastEventId: string }> {
    const totals = [10000, 4000, 12345, 99, 250000];
    let minute = 0;
    const at = () => `2026-09-27T10:${String(minute++).padStart(2, "0")}:00.123456Z`;
    for (let i = 0; i < totals.length; i++) {
      await insertOrderEvent(source, { occurredAt: at(), data: completedOrder(i + 1, totals[i]) });
    }
    await insertOrderEvent(source, {
      occurredAt: at(),
      data: { ...completedOrder(10, 5000), to_status: "customer_cancelled" },
    });
    await insertOrderEvent(source, {
      occurredAt: at(),
      data: { ...completedOrder(11, 5000), to_status: "failed" },
    });
    const { store_public_id: _drop, ...noStore } = completedOrder(12, 7000);
    await insertOrderEvent(source, { occurredAt: at(), data: noStore });
    const lastEventId = await insertOrderEvent(source, {
      occurredAt: at(),
      eventType: "order.assignment_changed",
      data: completedOrder(13, 1),
    });
    return { totals, lastEventId };
  }

  it("fees = invoices = settlements = outbox rows, exactly one per completed order", async () => {
    const { totals, lastEventId } = await seedMixed();
    const result = await runRelayBatch(postgresRelayDeps(billing, source), DEFAULT_RELAY_CONFIG);

    expect(result).toMatchObject({ processed: 9, settled: 5, ignored: 3, poisoned: 1, pending: 0 });
    expect(result.checkpoint.last_event_id).toBe(lastEventId);

    const expected = totals.reduce((s, t) => s + fee(t), 0);
    const sums = await billing.query<{ inv: string; stl: string; n_inv: string; n_stl: string }>(
      `SELECT (SELECT coalesce(sum(amount_cents),0) FROM billing_invoices)::text    AS inv,
              (SELECT coalesce(sum(amount_cents),0) FROM billing_settlements)::text AS stl,
              (SELECT count(*) FROM billing_invoices)::text    AS n_inv,
              (SELECT count(*) FROM billing_settlements)::text AS n_stl`,
    );
    expect(Number(sums.rows[0].inv)).toBe(expected);
    expect(Number(sums.rows[0].stl)).toBe(expected);
    expect(Number(sums.rows[0].n_inv)).toBe(5);
    expect(Number(sums.rows[0].n_stl)).toBe(5);

    // كلُّ فاتورةٍ مربوطةٌ بتسويتِها، والمبلغانِ متساويان.
    expect(
      await count(
        billing,
        `SELECT count(*)::text AS n FROM billing_invoices i
           JOIN billing_settlements s ON s.settlement_id = i.settlement_id AND s.invoice_id = i.invoice_id
          WHERE s.amount_cents = i.amount_cents AND s.state = 'settled' AND i.state = 'draft'`,
      ),
    ).toBe(5);

    // صفُّ صادرٍ واحدٌ لكلِّ تسوية، ومفتاحُهُ التسويةُ نفسُها.
    expect(
      await count(
        billing,
        `SELECT count(*)::text AS n FROM billing_outbox o
           JOIN billing_settlements s ON s.settlement_id = o.aggregate_id
          WHERE o.event_type = 'billing.fee_settled' AND o.payload->>'settlement_id' = s.settlement_id::text`,
      ),
    ).toBe(5);
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_outbox`)).toBe(5);

    // الدفترُ: كلُّ حدثٍ نهائيٌّ مسجَّلٌ مرّةً، والمسمومُ بسببِهِ.
    const ledger = await billing.query<{ status: string; n: string }>(
      `SELECT status, count(*)::text AS n FROM billing_relay_consumed_events
        WHERE consumer_id = $1 GROUP BY status ORDER BY status`,
      [CONSUMER],
    );
    expect(Object.fromEntries(ledger.rows.map((r) => [r.status, Number(r.n)]))).toEqual({
      ignored: 2,
      ignored_foreign: 1,
      poisoned: 1,
      settled: 5,
    });
    const poisoned = await billing.query<{ reason: string }>(
      `SELECT reason FROM billing_relay_consumed_events WHERE status = 'poisoned'`,
    );
    expect(poisoned.rows[0].reason).toMatch(/store_public_id/);
  });

  it("checkpoint lost → full redelivery settles nothing twice", async () => {
    await seedMixed();
    const deps = postgresRelayDeps(billing, source);
    await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    await billing.query(`DELETE FROM billing_relay_checkpoint`);
    const again = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(again.settled).toBe(0);
    expect(again.poisoned).toBe(0);
    expect(again.skipped_stale).toBe(9);
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_settlements`)).toBe(5);
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_invoices`)).toBe(5);
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_outbox`)).toBe(5);
    // والنقطةُ أُعيدَ بناؤُها إلى آخرِ حدث.
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_relay_checkpoint`)).toBe(1);
  });

  it("database failure mid-transaction rolls back invoice + settlement + ledger; retry settles once", async () => {
    const eventId = await insertOrderEvent(source, {
      occurredAt: "2026-09-27T11:00:00.000001Z",
      data: completedOrder(1, 10000),
    });
    // فشلٌ حقيقيٌّ من القاعدة: الإدراجُ في الصادرِ يُرفَضُ بعدَ أن كُتبت الفاتورةُ والتسوية.
    await billing.query(`
      CREATE OR REPLACE FUNCTION m5_17p_fail_outbox() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'm5-17p injected outbox failure'; END $$ LANGUAGE plpgsql`);
    await billing.query(`
      CREATE TRIGGER m5_17p_fail_outbox BEFORE INSERT ON billing_outbox
      FOR EACH ROW EXECUTE FUNCTION m5_17p_fail_outbox()`);
    const deps = postgresRelayDeps(billing, source);
    try {
      const failed = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
      expect(failed.pending).toBe(1);
      expect(failed.settled).toBe(0);
      expect(await count(billing, `SELECT count(*)::text AS n FROM billing_invoices`)).toBe(0);
      expect(await count(billing, `SELECT count(*)::text AS n FROM billing_settlements`)).toBe(0);
      expect(await count(billing, `SELECT count(*)::text AS n FROM billing_relay_consumed_events`)).toBe(0);
      expect(await count(billing, `SELECT count(*)::text AS n FROM billing_relay_checkpoint`)).toBe(0);
    } finally {
      await billing.query(`DROP TRIGGER IF EXISTS m5_17p_fail_outbox ON billing_outbox`);
      await billing.query(`DROP FUNCTION IF EXISTS m5_17p_fail_outbox()`);
    }

    const retried = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(retried.settled).toBe(1);
    expect(retried.checkpoint.last_event_id).toBe(eventId);
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_settlements`)).toBe(1);
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_outbox`)).toBe(1);
  });

  it("two concurrent relay processes settle each completed order exactly once", async () => {
    for (let i = 0; i < 20; i++) {
      await insertOrderEvent(source, {
        occurredAt: `2026-09-27T12:00:${String(i).padStart(2, "0")}.000000Z`,
        data: completedOrder(i + 1, 1000 + i),
      });
    }
    const otherBilling = newPool();
    try {
      const [a, b] = await Promise.all([
        runRelayBatch(postgresRelayDeps(billing, source), DEFAULT_RELAY_CONFIG),
        runRelayBatch(postgresRelayDeps(otherBilling, source), DEFAULT_RELAY_CONFIG),
      ]);
      expect(a.settled + b.settled).toBe(20);
    } finally {
      await otherBilling.end();
    }
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_settlements`)).toBe(20);
    expect(
      await count(billing, `SELECT count(*)::text AS n FROM billing_relay_consumed_events WHERE status = 'settled'`),
    ).toBe(20);
  });

  it("checkpoint keeps microsecond precision — the last row is not re-read", async () => {
    const id = await insertOrderEvent(source, {
      occurredAt: "2026-09-27T13:00:00.654321Z",
      data: completedOrder(1, 5000),
    });
    const deps = postgresRelayDeps(billing, source);
    const first = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(first.checkpoint).toEqual({ last_occurred_at: "2026-09-27T13:00:00.654321Z", last_event_id: id });

    const second = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(second.processed).toBe(0);
  });

  it("ledger rejects a 'settled' row without a settlement (DB constraint)", async () => {
    await expect(
      billing.query(
        `INSERT INTO billing_relay_consumed_events (consumer_id, event_id, status)
         VALUES ('c', gen_random_uuid(), 'settled')`,
      ),
    ).rejects.toThrow(/billing_relay_settled_has_settlement/);
  });
});

describe.skipIf(!PG_ENABLED)("billing Postgres adapters used by the HTTP path", () => {
  let fixture: ReturnType<typeof createBillingDb>;

  beforeAll(async () => {
    fixture = createBillingDb({ connectionString: DATABASE_URL! });
    await resetSchema(fixture.pool);
  });

  afterAll(async () => {
    await fixture?.pool.end();
  });

  it("PostgresSettlement settles, links the invoice, finds and lists", async () => {
    const store = new PostgresInvoiceStore(fixture.db);
    const invoiceId = "0b6f5a4e-1d2c-4b3a-9f8e-7d6c5b4a3921";
    const now = new Date("2026-09-27T00:00:00Z");
    await store.save({
      id: invoiceId,
      store_public_id: "WS-0000000001",
      period: "2026-09",
      state: "draft",
      fee_type: "store_fixed",
      amount_cents: 1500,
      paid_amount_cents: 0,
      payment_ref: null,
      created_at: now,
      updated_at: now,
    });
    const settlements = new PostgresSettlement(fixture.pool);
    const s = await settlements.settle({ invoice_id: invoiceId, fee_type: "store_fixed", amount_cents: 1500, period: "2026-09" });
    expect(s.state).toBe("settled");
    expect(await settlements.findById(s.settlement_id)).toEqual(s);
    expect(await settlements.findById("not-a-uuid")).toBeNull();
    const listed = await settlements.listSettlements({ state: "settled", limit: 10 });
    expect(listed.items).toEqual([
      { settlement_id: s.settlement_id, state: "settled", invoice_id: invoiceId, fee_type: "store_fixed", amount_cents: 1500, period: "2026-09" },
    ]);
    const linked = await fixture.pool.query<{ settlement_id: string }>(
      `SELECT settlement_id::text AS settlement_id FROM billing_invoices WHERE invoice_id = $1`,
      [invoiceId],
    );
    expect(linked.rows[0].settlement_id).toBe(s.settlement_id);
    await expect(
      settlements.settle({ invoice_id: "11111111-2222-4333-8444-555555555555", fee_type: "store_fixed", amount_cents: 1, period: "2026-09" }),
    ).rejects.toThrow();
  });

  it("PostgresOutboxPublisher writes billing_outbox rows; non-UUID invoice ids read as not found", async () => {
    const publisher = new PostgresOutboxPublisher(fixture.pool);
    const invoiceId = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    await publisher.publishInvoiceIssued({ invoice_id: invoiceId, store_public_id: "WS-0000000001", period: "2026-09" });
    const rows = await fixture.pool.query<{ event_type: string; aggregate_id: string; payload: Record<string, unknown> }>(
      `SELECT event_type, aggregate_id::text AS aggregate_id, payload FROM billing_outbox`,
    );
    expect(rows.rows).toEqual([
      {
        event_type: "billing.invoice_issued",
        aggregate_id: invoiceId,
        payload: { invoice_id: invoiceId, store_public_id: "WS-0000000001", period: "2026-09" },
      },
    ]);
    expect(await new PostgresInvoiceStore(fixture.db).findById("INV-000000001")).toBeNull();
  });
});
