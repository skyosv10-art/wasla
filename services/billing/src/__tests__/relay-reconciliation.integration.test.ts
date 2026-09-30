/**
 * بوّابةُ تسويةِ الفوترةِ على PostgreSQL حقيقي (M5-17P · M5-17Q · ADR-050 §3).
 *
 * الدعوى: كلُّ طلبِ متجرٍ **مُسلَّمٍ** في `delivery_outbox` (`store_order.created` ثمَّ
 * `store_order.fulfillment_state_changed → delivered`) يصيرُ **فاتورةً واحدةً وتسويةً
 * واحدةً وصفَّ صادرٍ واحداً** — لا أقلَّ ولا أكثر — ومجموعُ الرسومِ يساوي مجموعَ الفواتيرِ
 * ويساوي ما يُحسَبُ من لقطاتِ المالِ نفسِها. وتُقاسُ الدعوى تحتَ ما يكسرُها في الإنتاج:
 * فقدُ نقطةِ التفتيش، وفشلُ القاعدةِ في منتصفِ المعاملة، ودفعتانِ متزامنتان، وحدثٌ مسموم.
 *
 * `delivery_outbox` هنا بنصِّ DDL عقدِ التوصيل (`pg-harness.ts`)، والحمولاتُ بشكلِ
 * عقدِ الأحداثِ (`delivery-contract.test.ts`). والإثباتُ بالمنتِجِ الحقيقيِّ — مخزنُ طلباتِ
 * التوصيلِ نفسُهُ يكتبُ الصفوفَ — في `packages/billing-e2e`.
 */

import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresInvoiceStore } from "../infrastructure/drizzle/repository.js";
import { createBillingDb } from "../infrastructure/drizzle/db.js";
import { PostgresSettlement } from "../infrastructure/pg/settlement-store.js";
import { DEFAULT_RELAY_CONFIG, runRelayBatch, storeVariableFee } from "../relay.js";
import {
  STORE_ID,
  createdRow,
  deliveredRow,
  deliveryCompletedRow,
  orderRef,
  substitutedRow,
  ticker,
  transitionRow,
} from "./delivery-events.js";
import {
  PG_ENABLED,
  DATABASE_URL,
  PostgresOutboxPublisher,
  count,
  insertDeliveryEvent,
  newPool,
  postgresRelayDeps,
  resetData,
  resetSchema,
} from "./pg-harness.js";

const CONSUMER = DEFAULT_RELAY_CONFIG.consumerId;

describe.skipIf(!PG_ENABLED)("billing relay — reconciliation gate on real Postgres (delivery_outbox)", () => {
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

  /**
   * خمسةُ طلباتٍ مُسلَّمةٍ (أحدُها باستبدالٍ) · طلبٌ ملغى · طلبٌ عالقٌ في picking ·
   * حدثٌ مسمومٌ (إنشاءٌ بلا totals) · حدثُ مهمّةِ توصيلٍ غريب.
   */
  async function seedMixed(): Promise<{ bases: number[]; lastEventId: string; events: number }> {
    const tick = ticker();
    const items = [10000, 4000, 12345, 99, 250000];
    let events = 0;
    const put = async (row: Parameters<typeof insertDeliveryEvent>[1]) => {
      events++;
      return insertDeliveryEvent(source, row);
    };
    for (let i = 0; i < items.length; i++) {
      const o = orderRef(i + 1);
      await put(createdRow(o, items[i], 1500, { occurredAt: tick() }));
      await put(transitionRow(o, "confirmed", "picking", { occurredAt: tick() }));
    }
    await put(substitutedRow(orderRef(3), -2345, { occurredAt: tick() }));
    for (let i = 0; i < items.length; i++) await put(deliveredRow(orderRef(i + 1), { occurredAt: tick() }));

    const cancelled = orderRef(10);
    await put(createdRow(cancelled, 5000, 0, { occurredAt: tick() }));
    await put(transitionRow(cancelled, "placed", "cancelled", { occurredAt: tick() }));
    await put(createdRow(orderRef(11), 7000, 0, { occurredAt: tick() }));

    const bad = createdRow(orderRef(12), 7000, 0, { occurredAt: tick() });
    const { totals: _drop, ...noTotals } = bad.payload;
    await put({ ...bad, payload: noTotals });
    const lastEventId = await put(deliveryCompletedRow(orderRef(1), { occurredAt: tick() }));
    const bases = [10000, 4000, 12345 - 2345, 99, 250000];
    return { bases, lastEventId, events };
  }

  it("fees = invoices = settlements = outbox rows, exactly one per delivered order", async () => {
    const { bases, lastEventId, events } = await seedMixed();
    const result = await runRelayBatch(postgresRelayDeps(billing, source), DEFAULT_RELAY_CONFIG);

    // 5 created+5 picking+1 sub+5 delivered+2 cancelled-order+1 created+1 poisoned+1 foreign = 21
    expect(events).toBe(21);
    expect(result).toMatchObject({ processed: 21, settled: 5, recorded: 8, ignored: 7, poisoned: 1, pending: 0 });
    expect(result.checkpoint.last_event_id).toBe(lastEventId);

    const expected = bases.reduce((s, b) => s + storeVariableFee(b), 0);
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

    // كلُّ فاتورةٍ مربوطةٌ بتسويتِها وبلقطةِ طلبِها، والمرجعُ UUID المتجر.
    expect(
      await count(
        billing,
        `SELECT count(*)::text AS n FROM billing_invoices i
           JOIN billing_settlements s ON s.settlement_id = i.settlement_id AND s.invoice_id = i.invoice_id
           JOIN billing_store_order_snapshots o ON o.settlement_id = s.settlement_id
          WHERE s.amount_cents = i.amount_cents AND s.state = 'settled' AND i.state = 'draft'
            AND i.store_public_id = $1 AND o.store_id::text = $1`,
        [STORE_ID],
      ),
    ).toBe(5);

    // صفُّ صادرٍ واحدٌ لكلِّ تسوية.
    expect(
      await count(
        billing,
        `SELECT count(*)::text AS n FROM billing_outbox o
           JOIN billing_settlements s ON s.settlement_id = o.aggregate_id
          WHERE o.event_type = 'billing.fee_settled' AND o.payload->>'settlement_id' = s.settlement_id::text`,
      ),
    ).toBe(5);
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_outbox`)).toBe(5);

    // اللقطات: 7 طلباتٍ مُنشأة، 5 مُسوّاة، والملغى والعالقُ بلا تسوية.
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_store_order_snapshots`)).toBe(7);
    expect(
      await count(billing, `SELECT count(*)::text AS n FROM billing_store_order_snapshots WHERE settlement_id IS NOT NULL`),
    ).toBe(5);

    const ledger = await billing.query<{ status: string; n: string }>(
      `SELECT status, count(*)::text AS n FROM billing_relay_consumed_events
        WHERE consumer_id = $1 GROUP BY status ORDER BY status`,
      [CONSUMER],
    );
    expect(Object.fromEntries(ledger.rows.map((r) => [r.status, Number(r.n)]))).toEqual({
      ignored: 6,
      ignored_foreign: 1,
      poisoned: 1,
      recorded: 8,
      settled: 5,
    });
    const poisoned = await billing.query<{ reason: string }>(
      `SELECT reason FROM billing_relay_consumed_events WHERE status = 'poisoned'`,
    );
    expect(poisoned.rows[0].reason).toMatch(/totals/);
  });

  it("checkpoint lost → full redelivery settles nothing twice", async () => {
    const { events } = await seedMixed();
    const deps = postgresRelayDeps(billing, source);
    await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    await billing.query(`DELETE FROM billing_relay_checkpoint`);
    const again = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(again).toMatchObject({ settled: 0, recorded: 0, poisoned: 0, skipped_stale: events });
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_settlements`)).toBe(5);
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_invoices`)).toBe(5);
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_outbox`)).toBe(5);
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_relay_checkpoint`)).toBe(1);
  });

  it("database failure mid-transaction rolls back invoice + settlement + snapshot link + ledger; retry settles once", async () => {
    const o = orderRef(1);
    await insertDeliveryEvent(source, createdRow(o, 10000, 0, { occurredAt: "2026-09-27T11:00:00.000001Z" }));
    const deliveredId = await insertDeliveryEvent(source, deliveredRow(o, { occurredAt: "2026-09-27T11:00:01.000001Z" }));
    await billing.query(`
      CREATE OR REPLACE FUNCTION m5_17q_fail_outbox() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'm5-17q injected outbox failure'; END $$ LANGUAGE plpgsql`);
    await billing.query(`
      CREATE TRIGGER m5_17q_fail_outbox BEFORE INSERT ON billing_outbox
      FOR EACH ROW EXECUTE FUNCTION m5_17q_fail_outbox()`);
    const deps = postgresRelayDeps(billing, source);
    try {
      const failed = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
      expect(failed).toMatchObject({ recorded: 1, pending: 1, settled: 0 });
      expect(await count(billing, `SELECT count(*)::text AS n FROM billing_invoices`)).toBe(0);
      expect(await count(billing, `SELECT count(*)::text AS n FROM billing_settlements`)).toBe(0);
      expect(
        await count(billing, `SELECT count(*)::text AS n FROM billing_store_order_snapshots WHERE settlement_id IS NOT NULL`),
      ).toBe(0);
      expect(
        await count(billing, `SELECT count(*)::text AS n FROM billing_relay_consumed_events WHERE status = 'settled'`),
      ).toBe(0);
    } finally {
      await billing.query(`DROP TRIGGER IF EXISTS m5_17q_fail_outbox ON billing_outbox`);
      await billing.query(`DROP FUNCTION IF EXISTS m5_17q_fail_outbox()`);
    }

    const retried = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(retried.settled).toBe(1);
    expect(retried.checkpoint.last_event_id).toBe(deliveredId);
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_settlements`)).toBe(1);
    expect(await count(billing, `SELECT count(*)::text AS n FROM billing_outbox`)).toBe(1);
  });

  it("two concurrent relay processes settle each delivered order exactly once", async () => {
    const tick = ticker("2026-09-27T12:00:00.000000Z");
    for (let i = 0; i < 20; i++) {
      const o = orderRef(i + 1);
      await insertDeliveryEvent(source, createdRow(o, 1000 + i, 0, { occurredAt: tick() }));
      await insertDeliveryEvent(source, deliveredRow(o, { occurredAt: tick() }));
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
    const id = await insertDeliveryEvent(
      source,
      createdRow(orderRef(1), 5000, 0, { occurredAt: "2026-09-27T13:00:00.654321Z" }),
    );
    const deps = postgresRelayDeps(billing, source);
    const first = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    const seq = (await source.query<{ s: string }>(`SELECT commit_sequence::text AS s FROM delivery_outbox WHERE event_id = $1::uuid`, [id])).rows[0]!.s;
    expect(first.checkpoint).toEqual({ last_commit_sequence: seq, last_occurred_at: "2026-09-27T13:00:00.654321Z", last_event_id: id });

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

  it("snapshots reject a non-SAR currency and a negative total (DB constraints)", async () => {
    await expect(
      billing.query(
        `INSERT INTO billing_store_order_snapshots
           (order_id, order_public_id, store_id, store_slug, currency_code, items_total_minor_units, delivery_fee_minor_units, source_event_id)
         VALUES (gen_random_uuid(), 'WS-0000000001', gen_random_uuid(), 's-x', 'USD', 1, 0, gen_random_uuid())`,
      ),
    ).rejects.toThrow(/currency/);
    await expect(
      billing.query(
        `INSERT INTO billing_store_order_snapshots
           (order_id, order_public_id, store_id, store_slug, currency_code, items_total_minor_units, delivery_fee_minor_units, source_event_id)
         VALUES (gen_random_uuid(), 'WS-0000000001', gen_random_uuid(), 's-x', 'SAR', -1, 0, gen_random_uuid())`,
      ),
    ).rejects.toThrow(/items_total/);
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
