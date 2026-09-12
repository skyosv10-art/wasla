/**
 * كشفُ تضاربِ المخزونِ — على قاعدةٍ حقيقيّةٍ (المراجعةُ 16/N · ADR-026 §4.18 · رفعُ دَينِ §4.8).
 *
 * ما تُثبِتُهُ هذه الاختباراتُ ولا تستطيعُ بدائلُ الذاكرةِ إثباتَهُ:
 *
 *   • **مسارُ الربطِ الحقيقيُّ**: الرصدُ يأتي بـ`store_id` والحجزُ يُخزَّنُ
 *     بـ`store_slug`، فالوصلةُ عبرَ `store_orders`. وبديلٌ في الذاكرةِ يُمرَّرُ
 *     إليهِ الحجزُ جاهزاً فلا يختبرُ الوصلةَ — وهيَ موضعُ الخطأِ الأوّلِ.
 *   • **الذَرِّيّةُ**: الرايةُ والرصدُ في معاملةٍ واحدةٍ — إخفاقٌ في الوسطِ لا يُبقي
 *     رايةً بلا رصدٍ ولا رصداً بلا رايةٍ.
 *   • **التماثُلُ**: إعادةُ تسليمِ الحدثِ لا تُضاعِفُ الرايةَ، و`DO NOTHING` لا يُلغي
 *     إقرارَ مُشغِّلٍ سابقاً.
 *   • **الحالةُ السليمةُ لا تُنتِجُ رايةً**: حجزُ التوصيلِ نفسُهُ يُنزِلُ الرصيدَ إلى
 *     صفرٍ ولا رايةَ — وهذا هوَ الفرقُ بينَ كشفٍ يُقرأُ وضجيجٍ يُهمَلُ.
 *   • **قيودُ `CHECK` تعملُ فعلاً**: ما يمنعُهُ النطاقُ تمنعُهُ القاعدةُ كذلكَ.
 *
 * يُتخطّى حينَ لا `DATABASE_URL` (docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md).
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import {
  PG_ENABLED,
  setupPostgres,
  resetData,
  seedMarketplaceEvent,
  type PgFixture,
} from "./pg-harness.js";
import { PostgresMarketplaceInventoryEventSource } from "../infrastructure/marketplace-inventory-event-source.js";
import { PostgresInventoryObservationStore } from "../infrastructure/inventory-observation-store.js";
import {
  runInventoryRelayBatch,
  DEFAULT_INVENTORY_RELAY_CONFIG,
  type InventoryRelayDeps,
} from "../marketplace-inventory-relay.js";

const STORE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const OTHER_STORE_ID = "aaaaaaaa-0000-0000-0000-0000000000ff";
const PRODUCT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const OTHER_PRODUCT_ID = "bbbbbbbb-0000-0000-0000-0000000000ff";
const ACTOR = "WS-0000000123";
const T0 = "2026-09-09T10:00:00.000Z";
const ts = (n: number) => new Date(Date.parse(T0) + n * 60_000).toISOString();

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    adjustment_id: "cccccccc-0000-0000-0000-000000000003",
    product_id: PRODUCT_ID,
    store_id: STORE_ID,
    quantity_delta: -3,
    quantity_after: 4,
    reason_code: "correction",
    adjustment_sequence: 1,
    actor_public_id: ACTOR,
    occurred_for: T0,
    ...overrides,
  };
}

function deps(pool: PgFixture["pool"]): InventoryRelayDeps {
  return {
    events: new PostgresMarketplaceInventoryEventSource(pool),
    store: new PostgresInventoryObservationStore(pool),
    config: { ...DEFAULT_INVENTORY_RELAY_CONFIG, batchSize: 10 },
  };
}

(PG_ENABLED ? describe : describe.skip)("كشفُ تضاربِ المخزونِ — PostgreSQL", () => {
  let pool: PgFixture["pool"];
  let close: () => Promise<void>;
  let store: PostgresInventoryObservationStore;
  let orderSeq = 0;

  /**
   * طلبٌ حقيقيٌّ + حجزٌ حقيقيٌّ — لا اختصارَ.
   *
   * `store_id` هوَ الوصلةُ الوحيدةُ بينَ الرصدِ والحجزِ، فطلبٌ مُلفَّقٌ بلا
   * `store_id` يجعلُ الاختبارَ يُثبِتُ شيئاً آخرَ غيرَ الذي يدَّعيهِ.
   */
  async function seedReservedOrder(options: {
    readonly storeId?: string;
    readonly productId?: string;
    readonly quantityReserved?: number;
    readonly status?: "active" | "released" | "consumed";
  } = {}): Promise<{ orderId: string; publicId: string }> {
    orderSeq += 1;
    const publicId = `WS-${String(orderSeq).padStart(10, "0")}`;
    const order = await pool.query<{ order_id: string }>(
      `INSERT INTO store_orders (order_id, public_id, customer_ref, store_id, store_slug,
                                 fulfillment_state, payment_state, inventory_state, currency_code,
                                 items_total_minor_units, delivery_fee_minor_units, total_minor_units)
       VALUES (gen_random_uuid(), $1, 'WS-0000000001', $2::uuid, 'matjar-alfawakih',
               'placed', 'pending', 'reserved', 'SAR', 1000, 500, 1500)
       RETURNING order_id::text`,
      [publicId, options.storeId ?? STORE_ID],
    );
    const orderId = order.rows[0]!.order_id;

    await pool.query(
      `INSERT INTO delivery_inventory_reservations
         (reservation_id, order_id, store_slug, product_id, sku, quantity_reserved,
          unit_price_minor_units, marketplace_reservation_ref, status)
       VALUES (gen_random_uuid(), $1::uuid, 'matjar-alfawakih', $2::uuid, 'SKU-1', $3,
               500, $4, $5)`,
      [
        orderId,
        options.productId ?? PRODUCT_ID,
        options.quantityReserved ?? 2,
        `res-${publicId}`,
        options.status ?? "active",
      ],
    );

    return { orderId, publicId };
  }

  async function conflictRows(): Promise<Record<string, unknown>[]> {
    const res = await pool.query(
      `SELECT adjustment_id::text, marketplace_event_id::text, store_id::text, product_id::text,
              conflict_kind, reason_code, quantity_delta, observed_quantity_after,
              adjustment_sequence, affected_order_count, affected_units_total,
              affected_order_public_ids, changes_order_state,
              acknowledged_at, acknowledged_by, trace_id
         FROM delivery_inventory_conflicts
        ORDER BY detected_at DESC, adjustment_id`,
    );
    return res.rows as Record<string, unknown>[];
  }

  beforeEach(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    close = fixture.close;
    store = new PostgresInventoryObservationStore(pool);
    orderSeq = 0;
    await resetData(pool);
  });

  afterEach(async () => {
    await pool
      .query(`DROP TRIGGER IF EXISTS abort_conflict ON delivery_inventory_conflicts`)
      .catch(() => undefined);
    await close();
  });

  /* ════════ الرايةُ ترتفعُ ════════ */

  it("تصحيحٌ نازلٌ على حجزٍ نشطٍ ⇒ صفُّ رايةٍ واحدٌ بالأرقامِ المقيسةِ", async () => {
    const order = await seedReservedOrder({ quantityReserved: 2 });
    const eventId = await seedMarketplaceEvent(pool, { payload: payload(), occurred_at: ts(0) });

    const outcome = await runInventoryRelayBatch(deps(pool));
    expect(outcome.applied).toBe(1);

    const rows = await conflictRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      adjustment_id: "cccccccc-0000-0000-0000-000000000003",
      marketplace_event_id: eventId,
      store_id: STORE_ID,
      product_id: PRODUCT_ID,
      conflict_kind: "downward_correction_while_reserved",
      reason_code: "correction",
      quantity_delta: -3,
      observed_quantity_after: 4,
      adjustment_sequence: 1,
      affected_order_count: 1,
      affected_units_total: 2,
      affected_order_public_ids: [order.publicId],
      // مُعلَنٌ في الصفِّ نفسِهِ لا في وثيقةٍ.
      changes_order_state: false,
      acknowledged_at: null,
      acknowledged_by: null,
    });
  });

  it("طلبانِ على المنتجِ ⇒ عددٌ 2 ومجموعٌ يجمعُهما ومراجعُ مرتَّبةٌ", async () => {
    const first = await seedReservedOrder({ quantityReserved: 2 });
    const second = await seedReservedOrder({ quantityReserved: 5 });
    await seedMarketplaceEvent(pool, {
      payload: payload({ reason_code: "shrinkage", quantity_delta: -1, quantity_after: 3 }),
      occurred_at: ts(0),
    });

    await runInventoryRelayBatch(deps(pool));

    const rows = await conflictRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      conflict_kind: "shrinkage_while_reserved",
      affected_order_count: 2,
      affected_units_total: 7,
      affected_order_public_ids: [first.publicId, second.publicId].sort(),
    });
  });

  it("`archive_zeroed` إلى صفرٍ ⇒ `stock_zeroed_while_reserved` والسببُ الأصليُّ محفوظٌ", async () => {
    await seedReservedOrder();
    await seedMarketplaceEvent(pool, {
      payload: payload({ reason_code: "archive_zeroed", quantity_delta: -4, quantity_after: 0 }),
      occurred_at: ts(0),
    });

    await runInventoryRelayBatch(deps(pool));

    const rows = await conflictRows();
    expect(rows[0]).toMatchObject({
      conflict_kind: "stock_zeroed_while_reserved",
      reason_code: "archive_zeroed",
    });
  });

  /* ════════ الرايةُ لا ترتفعُ — وهذا أهمُّ ════════ */

  it("حجزُ التوصيلِ نفسُهُ يُنزِلُ الرصيدَ إلى صفرٍ ⇒ رصدٌ ولا رايةَ", async () => {
    // الحالةُ التي كانت القاعدةُ الساذجةُ ستُطلِقُ عليها رايةً: ثلاثُ وحداتٍ،
    // ثلاثةٌ محجوزةٌ، `quantity_after = 0` — وهيَ صحّةٌ تامّةٌ.
    await seedReservedOrder({ quantityReserved: 3 });
    await seedMarketplaceEvent(pool, {
      payload: payload({ reason_code: "reservation", quantity_delta: -3, quantity_after: 0 }),
      occurred_at: ts(0),
    });

    const outcome = await runInventoryRelayBatch(deps(pool));
    expect(outcome.applied).toBe(1);

    // الرصدُ وقعَ…
    const obs = await pool.query(
      `SELECT observed_quantity_after FROM delivery_inventory_observations
        WHERE store_id = $1::uuid AND product_id = $2::uuid`,
      [STORE_ID, PRODUCT_ID],
    );
    expect(obs.rows[0]).toMatchObject({ observed_quantity_after: 0 });
    // …ولا رايةَ.
    expect(await conflictRows()).toHaveLength(0);
  });

  it("لا حجزَ نشطاً ⇒ لا رايةَ ولو أُفرِغَ المخزونُ", async () => {
    await seedMarketplaceEvent(pool, {
      payload: payload({ reason_code: "shrinkage", quantity_delta: -9, quantity_after: 0 }),
      occurred_at: ts(0),
    });

    await runInventoryRelayBatch(deps(pool));

    expect(await conflictRows()).toHaveLength(0);
  });

  it("حجزٌ مُفرَجٌ عنهُ ليسَ حجزاً نشطاً ⇒ لا رايةَ", async () => {
    await seedReservedOrder({ status: "released" });
    await seedMarketplaceEvent(pool, {
      payload: payload({ reason_code: "shrinkage", quantity_delta: -2, quantity_after: 0 }),
      occurred_at: ts(0),
    });

    await runInventoryRelayBatch(deps(pool));

    expect(await conflictRows()).toHaveLength(0);
  });

  it("حجزٌ على منتجٍ آخرَ أو متجرٍ آخرَ لا يُحسَبُ — الوصلةُ عبرَ `store_orders` تعملُ", async () => {
    await seedReservedOrder({ productId: OTHER_PRODUCT_ID });
    await seedReservedOrder({ storeId: OTHER_STORE_ID });
    await seedMarketplaceEvent(pool, {
      payload: payload({ reason_code: "shrinkage", quantity_delta: -2, quantity_after: 0 }),
      occurred_at: ts(0),
    });

    await runInventoryRelayBatch(deps(pool));

    expect(await conflictRows()).toHaveLength(0);
  });

  it("إعادةُ تخزينٍ ⇒ لا رايةَ ولو كانَ الحجزُ نشطاً", async () => {
    await seedReservedOrder();
    await seedMarketplaceEvent(pool, {
      payload: payload({ reason_code: "restock", quantity_delta: 50, quantity_after: 54 }),
      occurred_at: ts(0),
    });

    await runInventoryRelayBatch(deps(pool));

    expect(await conflictRows()).toHaveLength(0);
  });

  /* ════════ التماثُلُ والحارسُ والذَرِّيّةُ ════════ */

  it("إعادةُ تسليمِ الحدثِ ⇒ رايةٌ واحدةٌ لا اثنتانِ", async () => {
    await seedReservedOrder();
    const eventId = await seedMarketplaceEvent(pool, { payload: payload(), occurred_at: ts(0) });

    await runInventoryRelayBatch(deps(pool));
    // إعادةُ التسليمِ: يُمحى دفترُ المُستهلَكِ ويُرَدُّ المؤشِّرُ — كأنَّ الحدثَ لم يُقرأْ.
    await pool.query(`DELETE FROM delivery_inventory_relay_consumed_events WHERE event_id = $1::uuid`, [eventId]);
    await pool.query(`DELETE FROM delivery_inventory_relay_checkpoint`);
    await runInventoryRelayBatch(deps(pool));

    expect(await conflictRows()).toHaveLength(1);
  });

  it("`DO NOTHING` لا يُلغي إقرارَ مُشغِّلٍ عندَ إعادةِ تسليمٍ", async () => {
    await seedReservedOrder();
    const eventId = await seedMarketplaceEvent(pool, { payload: payload(), occurred_at: ts(0) });
    await runInventoryRelayBatch(deps(pool));

    // مُشغِّلٌ أقرَّ الرايةَ…
    await pool.query(
      `UPDATE delivery_inventory_conflicts
          SET acknowledged_at = now(), acknowledged_by = 'WS-0000000999'`,
    );
    // …ثمَّ أُعيدَ تسليمُ الحدثِ.
    await pool.query(`DELETE FROM delivery_inventory_relay_consumed_events WHERE event_id = $1::uuid`, [eventId]);
    await pool.query(`DELETE FROM delivery_inventory_relay_checkpoint`);
    await runInventoryRelayBatch(deps(pool));

    const rows = await conflictRows();
    expect(rows).toHaveLength(1);
    // الإقرارُ باقٍ: قرارُ إنسانٍ لا يُمحى بإعادةِ تسليمِ آلةٍ.
    expect(rows[0]?.acknowledged_by).toBe("WS-0000000999");
    expect(rows[0]?.acknowledged_at).not.toBeNull();
  });

  it("تخطٍّ لقِدَمِ المتتالِ لا يكتبُ رايةً أصلاً", async () => {
    await seedReservedOrder();
    // فرقٌ أحدثُ أوّلاً (متتالٌ 5) — ولا رايةَ لهُ لأنَّهُ إعادةُ تخزينٍ.
    await seedMarketplaceEvent(pool, {
      payload: payload({
        adjustment_id: "cccccccc-0000-0000-0000-00000000000a",
        reason_code: "restock",
        quantity_delta: 10,
        quantity_after: 14,
        adjustment_sequence: 5,
      }),
      occurred_at: ts(0),
    });
    await runInventoryRelayBatch(deps(pool));
    expect(await conflictRows()).toHaveLength(0);

    // ثمَّ فرقٌ قديمٌ (متتالٌ 2) هوَ نقصٌ مُشكِّكٌ: الحارسُ يتخطّاهُ،
    // فلا رصدَ يتراجعُ **ولا رايةَ تُكتَبُ**.
    await seedMarketplaceEvent(pool, {
      payload: payload({
        adjustment_id: "cccccccc-0000-0000-0000-00000000000b",
        reason_code: "shrinkage",
        quantity_delta: -4,
        quantity_after: 0,
        adjustment_sequence: 2,
      }),
      occurred_at: ts(1),
    });
    const outcome = await runInventoryRelayBatch(deps(pool));

    expect(outcome.skipped).toBe(1);
    expect(await conflictRows()).toHaveLength(0);
    const obs = await pool.query(
      `SELECT last_adjustment_sequence, observed_quantity_after
         FROM delivery_inventory_observations
        WHERE store_id = $1::uuid AND product_id = $2::uuid`,
      [STORE_ID, PRODUCT_ID],
    );
    expect(obs.rows[0]).toMatchObject({ last_adjustment_sequence: 5, observed_quantity_after: 14 });
  });

  it("ذَرِّيّةٌ: إخفاقُ إثباتِ الرايةِ يُرجِعُ الرصدَ كذلكَ — لا نصفَ حقيقةٍ", async () => {
    await seedReservedOrder();
    // مِزلاجٌ يُفشِلُ الكتابةَ في جدولِ الراياتِ وحدَهُ.
    await pool.query(
      `CREATE OR REPLACE FUNCTION abort_conflict_fn() RETURNS trigger AS $$
         BEGIN RAISE EXCEPTION 'conflict insert refused by test'; END;
       $$ LANGUAGE plpgsql`,
    );
    await pool.query(
      `CREATE TRIGGER abort_conflict BEFORE INSERT ON delivery_inventory_conflicts
         FOR EACH ROW EXECUTE FUNCTION abort_conflict_fn()`,
    );
    await seedMarketplaceEvent(pool, { payload: payload(), occurred_at: ts(0) });

    const outcome = await runInventoryRelayBatch(deps(pool));

    // الفرقُ لم يُطبَّقْ (يُعادُ في الجَولةِ التاليةِ)…
    expect(outcome.applied).toBe(0);
    // …ولا رصدَ بقيَ…
    const obs = await pool.query(`SELECT 1 FROM delivery_inventory_observations`);
    expect(obs.rowCount).toBe(0);
    // …ولا رايةَ.
    expect(await conflictRows()).toHaveLength(0);
  });

  /* ════════ قيودُ القاعدةِ ════════ */

  it("القاعدةُ ترفضُ ما يرفضُهُ النطاقُ: نوعٌ خارجُ القائمةِ · فرقٌ غيرُ سالبٍ · `changes_order_state = TRUE`", async () => {
    const base = {
      adjustment_id: "cccccccc-0000-0000-0000-0000000000c1",
      marketplace_event_id: "eeeeeeee-0000-0000-0000-0000000000c1",
      store_id: STORE_ID,
      product_id: PRODUCT_ID,
      conflict_kind: "shrinkage_while_reserved",
      reason_code: "shrinkage",
      quantity_delta: -1,
      observed_quantity_after: 0,
      adjustment_sequence: 1,
      affected_order_count: 1,
      affected_units_total: 1,
      affected_order_public_ids: ["WS-0000000001"],
      changes_order_state: false,
    };
    const insert = async (overrides: Record<string, unknown>): Promise<void> => {
      const row = { ...base, ...overrides };
      await pool.query(
        `INSERT INTO delivery_inventory_conflicts
           (adjustment_id, marketplace_event_id, store_id, product_id, conflict_kind,
            reason_code, quantity_delta, observed_quantity_after, adjustment_sequence,
            affected_order_count, affected_units_total, affected_order_public_ids,
            changes_order_state, occurred_for, detected_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11,
                 $12::text[], $13, now(), now())`,
        [
          row.adjustment_id,
          row.marketplace_event_id,
          row.store_id,
          row.product_id,
          row.conflict_kind,
          row.reason_code,
          row.quantity_delta,
          row.observed_quantity_after,
          row.adjustment_sequence,
          row.affected_order_count,
          row.affected_units_total,
          row.affected_order_public_ids,
          row.changes_order_state,
        ],
      );
    };

    // الصفُّ السليمُ يمرُّ — وإلّا كانَ الرفضُ لسببٍ آخرَ.
    await expect(insert({})).resolves.toBeUndefined();

    await expect(
      insert({ adjustment_id: "cccccccc-0000-0000-0000-0000000000c2", conflict_kind: "made_up_kind" }),
    ).rejects.toThrow();
    await expect(
      insert({ adjustment_id: "cccccccc-0000-0000-0000-0000000000c3", quantity_delta: 3 }),
    ).rejects.toThrow();
    await expect(
      insert({ adjustment_id: "cccccccc-0000-0000-0000-0000000000c4", changes_order_state: true }),
    ).rejects.toThrow();
    // طولُ المصفوفةِ يساوي العَدَّ — عددٌ لا تسنُدُهُ مراجعُ لا يُخزَّنُ.
    await expect(
      insert({ adjustment_id: "cccccccc-0000-0000-0000-0000000000c5", affected_order_count: 2 }),
    ).rejects.toThrow();
    // إقرارٌ نصفُهُ ناقصٌ لا يُخزَّنُ.
    await expect(
      pool.query(
        `UPDATE delivery_inventory_conflicts SET acknowledged_at = now() WHERE adjustment_id = $1::uuid`,
        [base.adjustment_id],
      ),
    ).rejects.toThrow();
  });

  /* ════════ القراءةُ ════════ */

  it("`listInventoryConflicts`: الأحدثُ أوّلاً · السقفُ يُطبَّقُ · غيرُ المُقَرِّ يُرشَّحُ", async () => {
    await seedReservedOrder();
    // ثلاثُ راياتٍ بلحظاتِ كشفٍ مختلفةٍ.
    for (const [index, seq] of [1, 2, 3].entries()) {
      await seedMarketplaceEvent(pool, {
        payload: payload({
          adjustment_id: `cccccccc-0000-0000-0000-00000000000${seq}`,
          reason_code: "shrinkage",
          quantity_delta: -1,
          quantity_after: 4 - seq,
          adjustment_sequence: seq,
        }),
        occurred_at: ts(index),
      });
      await runInventoryRelayBatch(deps(pool));
      // فَرْقُ لحظةٍ بينَ الكشوفِ حتّى يكونَ الترتيبُ مُلاحَظاً لا محظوظاً.
      await pool.query(
        `UPDATE delivery_inventory_conflicts
            SET detected_at = now() + ($1 || ' seconds')::interval
          WHERE adjustment_id = $2::uuid`,
        [String(seq), `cccccccc-0000-0000-0000-00000000000${seq}`],
      );
    }

    const all = await store.listInventoryConflicts({ unacknowledgedOnly: false, limit: 100 });
    expect(all).toHaveLength(3);
    // الأحدثُ كشفاً أوّلاً.
    expect(all.map((row) => row.adjustmentSequence)).toEqual([3, 2, 1]);
    // والحقولُ مقروءةٌ بأسماءِ النطاقِ لا بأسماءِ الأعمدةِ.
    expect(all[0]).toMatchObject({
      // المتتالُ 3 يُبقي `quantity_after = 1` — وسادةٌ باقيةٌ فالنوعُ «نقصٌ» لا «إفراغٌ».
      kind: "shrinkage_while_reserved",
      reasonCode: "shrinkage",
      affectedOrderCount: 1,
      changesOrderState: false,
      acknowledgedAt: null,
    });

    const capped = await store.listInventoryConflicts({ unacknowledgedOnly: false, limit: 2 });
    expect(capped).toHaveLength(2);
    expect(capped.map((row) => row.adjustmentSequence)).toEqual([3, 2]);

    await pool.query(
      `UPDATE delivery_inventory_conflicts
          SET acknowledged_at = now(), acknowledged_by = 'WS-0000000999'
        WHERE adjustment_sequence = 3`,
    );
    const unacked = await store.listInventoryConflicts({ unacknowledgedOnly: true, limit: 100 });
    expect(unacked.map((row) => row.adjustmentSequence)).toEqual([2, 1]);
  });

  it("`clearInventoryObservations` يمحو الراياتِ كذلكَ — إعادةُ بناءٍ لا تُبقي راياتِ ماضٍ", async () => {
    await seedReservedOrder();
    await seedMarketplaceEvent(pool, { payload: payload(), occurred_at: ts(0) });
    await runInventoryRelayBatch(deps(pool));
    expect(await conflictRows()).toHaveLength(1);

    await store.clearInventoryObservations();

    expect(await conflictRows()).toHaveLength(0);
  });
});
