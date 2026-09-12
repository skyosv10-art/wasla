/**
 * Marketplace inventory relay integration test (ADR-026 §2.3). End-to-end with
 * real PostgreSQL: marketplace_outbox event → relay
 * (PostgresMarketplaceInventoryEventSource + PostgresInventoryObservationStore)
 * → delivery_inventory_observations snapshot.
 *
 * These tests prove what the in-memory fakes CANNOT:
 *   • ATOMICITY — a mid-transaction failure leaves NOTHING behind (observation
 *     rolls back);
 *   • the ISO/checkpoint contract survives a real timestamptz round-trip;
 *   • idempotency after CHECKPOINT LOSS (ledger, not checkpoint, is the guard);
 *   • the sequence guard actually rejects stale adjustments on real Postgres;
 *   • CHECK constraints actually reject what the domain forbids.
 *
 * SKIPS when DATABASE_URL is unset (docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md).
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
const PRODUCT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const ADJUSTMENT_ID = "cccccccc-0000-0000-0000-000000000003";
const ACTOR = "WS-0000000123";
const T0 = "2026-09-09T10:00:00.000Z";
const ts = (n: number) => new Date(Date.parse(T0) + n * 60_000).toISOString();

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    adjustment_id: ADJUSTMENT_ID,
    product_id: PRODUCT_ID,
    store_id: STORE_ID,
    quantity_delta: 10,
    quantity_after: 100,
    reason_code: "restock",
    adjustment_sequence: 1,
    actor_public_id: ACTOR,
    occurred_for: T0,
    ...overrides,
  };
}

async function makeDeps(pool: PgFixture["pool"]): Promise<InventoryRelayDeps> {
  return {
    events: new PostgresMarketplaceInventoryEventSource(pool),
    store: new PostgresInventoryObservationStore(pool),
    config: { ...DEFAULT_INVENTORY_RELAY_CONFIG, batchSize: 10 },
  };
}

(PG_ENABLED ? describe : describe.skip)("marketplace inventory relay integration — PostgreSQL end-to-end", () => {
  let pool: PgFixture["pool"];
  let close: () => Promise<void>;
  let store: PostgresInventoryObservationStore;

  beforeEach(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    close = fixture.close;
    store = new PostgresInventoryObservationStore(pool);
    await resetData(pool);
  });
  afterEach(async () => {
    await pool.query(`DROP TRIGGER IF EXISTS abort_observation ON delivery_inventory_observations`).catch(() => undefined);
    await close();
  });

  /* ── the happy path: one event, observation upserted ── */

  it("applies a valid inventory_adjusted event: observation upserted + checkpoint advanced", async () => {
    const eventId = await seedMarketplaceEvent(pool, {
      payload: validPayload(),
      occurred_at: ts(0),
    });

    const outcome = await runInventoryRelayBatch(await makeDeps(pool));
    expect(outcome.applied).toBe(1);

    const obs = (await pool.query(
      `SELECT store_id::text, product_id::text, last_adjustment_id::text, last_marketplace_event_id::text,
              last_adjustment_sequence, observed_quantity_after, last_quantity_delta, last_reason_code,
              occurred_for::text AS occurred_for
         FROM delivery_inventory_observations WHERE store_id = $1::uuid AND product_id = $2::uuid`,
      [STORE_ID, PRODUCT_ID],
    )).rows[0];
    expect(obs).toMatchObject({
      store_id: STORE_ID,
      product_id: PRODUCT_ID,
      last_adjustment_id: ADJUSTMENT_ID,
      last_marketplace_event_id: eventId,
      last_adjustment_sequence: 1,
      observed_quantity_after: 100,
      last_quantity_delta: 10,
      last_reason_code: "restock",
    });

    expect((await store.getInventoryConsumed(eventId))?.status).toBe("applied");
    expect((await store.getInventoryCheckpoint(DEFAULT_INVENTORY_RELAY_CONFIG.consumerId))).toEqual({
      last_occurred_at: ts(0),
      last_event_id: eventId,
    });
  });

  /* ── idempotency: duplicate event_id → no-op ── */

  it("re-delivery of the same event_id is a no-op", async () => {
    await seedMarketplaceEvent(pool, {
      payload: validPayload(),
      occurred_at: ts(0),
    });
    await runInventoryRelayBatch(await makeDeps(pool));

    // "We lost the checkpoint" — the event is redelivered.
    await pool.query(`DELETE FROM delivery_inventory_relay_checkpoint`);

    const again = await runInventoryRelayBatch(await makeDeps(pool));
    expect(again.applied).toBe(0);
    expect(again.skipped).toBe(1);

    // No duplicate observation — one row, same data.
    const rows = (await pool.query(`SELECT count(*)::int AS n FROM delivery_inventory_observations`)).rows;
    expect(rows[0].n).toBe(1);
  });

  /* ── ordering: older adjustment_sequence → skipped_stale ── */

  it("skips_stale an older adjustment_sequence after a newer one applied", async () => {
    // First: sequence 2 (newer)
    await seedMarketplaceEvent(pool, {
      payload: validPayload({ adjustment_sequence: 2, quantity_after: 200, adjustment_id: "cccccccc-0000-0000-0000-000000000010" }),
      occurred_at: ts(0),
    });
    const first = await runInventoryRelayBatch(await makeDeps(pool));
    expect(first.applied).toBe(1);

    // Second: sequence 1 (older) — redelivered out of order
    const olderId = await seedMarketplaceEvent(pool, {
      payload: validPayload({ adjustment_sequence: 1, quantity_after: 50 }),
      occurred_at: ts(1),
    });

    const second = await runInventoryRelayBatch(await makeDeps(pool));
    expect(second.applied).toBe(0);
    expect(second.skipped).toBe(1);
    expect((await store.getInventoryConsumed(olderId))?.status).toBe("skipped_stale");

    // The observation was NOT regressed.
    const obs = (await pool.query(`SELECT observed_quantity_after, last_adjustment_sequence FROM delivery_inventory_observations`)).rows[0];
    expect(obs).toMatchObject({ observed_quantity_after: 200, last_adjustment_sequence: 2 });
  });

  /* ── newer sequence → updates observation ── */

  it("updates the observation when a newer sequence arrives", async () => {
    await seedMarketplaceEvent(pool, {
      payload: validPayload({ adjustment_sequence: 1, quantity_after: 100 }),
      occurred_at: ts(0),
    });
    await runInventoryRelayBatch(await makeDeps(pool));

    await seedMarketplaceEvent(pool, {
      payload: validPayload({
        adjustment_sequence: 2,
        quantity_after: 80,
        quantity_delta: -20,
        reason_code: "shrinkage",
        adjustment_id: "cccccccc-0000-0000-0000-000000000020",
      }),
      occurred_at: ts(1),
    });

    const second = await runInventoryRelayBatch(await makeDeps(pool));
    expect(second.applied).toBe(1);

    const obs = (await pool.query(`SELECT observed_quantity_after, last_quantity_delta, last_reason_code, last_adjustment_sequence FROM delivery_inventory_observations`)).rows[0];
    expect(obs).toMatchObject({ observed_quantity_after: 80, last_quantity_delta: -20, last_reason_code: "shrinkage", last_adjustment_sequence: 2 });
  });

  /* ── unsupported version → poisoned ── */

  it("poisons an event with an unsupported event_version", async () => {
    const badId = await seedMarketplaceEvent(pool, {
      payload: validPayload(),
      event_version: "v2",
      occurred_at: ts(0),
    });

    const outcome = await runInventoryRelayBatch(await makeDeps(pool));
    expect(outcome.poisoned).toBe(1);
    expect((await store.getInventoryConsumed(badId))?.status).toBe("poisoned");
  });

  /* ── invalid payload → poisoned ── */

  it("poisons an event with an invalid payload (quantity_delta = 0)", async () => {
    const badId = await seedMarketplaceEvent(pool, {
      payload: validPayload({ quantity_delta: 0 }),
      occurred_at: ts(0),
    });

    const outcome = await runInventoryRelayBatch(await makeDeps(pool));
    expect(outcome.poisoned).toBe(1);
    expect((await store.getInventoryConsumed(badId))?.status).toBe("poisoned");
  });

  /* ── RISK-0035: خصمُ الحجزِ بفاعلٍ نظاميٍّ يُطبَّقُ ولا يُسَمُّ ── */

  /*
   * هذا هوَ الصفُّ الذي كانَ **يُفقَدُ** قبلَ المراجعةِ 20/N: حدُّ السوقِ
   * يكتبُ خصمَ الحجزِ بـ`actor_public_id: "system:delivery"`، فيَسُمُّهُ المُصنِّفُ
   * **وتتقدَّمُ نقطةُ التقدُّمِ فوقَهُ** فلا إعادةَ ولا تنبيهَ.
   *
   * والدعوى توكِّدُ **أربعًا لا واحدةً**: أنَّ الصفَّ `applied` لا `poisoned`،
   * وأنَّ اللقطةَ **دَخلَت الدفترَ فعلاً** بالرّقمِ والسببِ والتّسلسلِ — فالقبولُ
   * وحدَهُ لا يُثبِتُ أنَّ الحدثَ وصلَ، وأنَّ نقطةَ التقدُّمِ تقدَّمَت إلى هذا الحدثِ
   * **بعدَ أن دَخلَ** لا فوقَهُ.
   */
  it("RISK-0035: يُطبِّقُ خصمَ حجزٍ بفاعلٍ نظاميٍّ `system:delivery` ولا يُسَمُّهُ", async () => {
    const eventId = await seedMarketplaceEvent(pool, {
      payload: validPayload({
        actor_public_id: "system:delivery",
        reason_code: "reservation",
        quantity_delta: -2,
        quantity_after: 7,
        adjustment_sequence: 1,
      }),
      occurred_at: ts(0),
    });

    const outcome = await runInventoryRelayBatch(await makeDeps(pool));
    expect({ applied: outcome.applied, poisoned: outcome.poisoned }).toEqual({
      applied: 1,
      poisoned: 0,
    });
    expect((await store.getInventoryConsumed(eventId))?.status).toBe("applied");

    const obs = (await pool.query(
      `SELECT last_adjustment_sequence, observed_quantity_after, last_quantity_delta, last_reason_code
         FROM delivery_inventory_observations WHERE store_id = $1::uuid AND product_id = $2::uuid`,
      [STORE_ID, PRODUCT_ID],
    )).rows[0];
    expect(obs, "لم تدخلِ اللقطةُ الدفترَ").toMatchObject({
      last_adjustment_sequence: 1,
      observed_quantity_after: 7,
      last_quantity_delta: -2,
      last_reason_code: "reservation",
    });

    expect(
      await store.getInventoryCheckpoint(DEFAULT_INVENTORY_RELAY_CONFIG.consumerId),
      "تقدَّمَت نقطةُ التقدُّمِ فوقَ الحدثِ لا إليهِ",
    ).toEqual({ last_occurred_at: ts(0), last_event_id: eventId });
  });

  /* ── event for a different product doesn't affect other observations ── */

  it("does not affect another product's observation when observing a different product", async () => {
    const OTHER_PRODUCT = "eeeeeeee-0000-0000-0000-000000000005";
    const OTHER_ADJ = "ffffffff-0000-0000-0000-000000000006";

    // Observe product A
    await seedMarketplaceEvent(pool, {
      payload: validPayload({ adjustment_sequence: 1, quantity_after: 100 }),
      occurred_at: ts(0),
    });
    await runInventoryRelayBatch(await makeDeps(pool));

    // Observe product B (different product_id)
    await seedMarketplaceEvent(pool, {
      payload: validPayload({
        product_id: OTHER_PRODUCT,
        adjustment_id: OTHER_ADJ,
        adjustment_sequence: 1,
        quantity_after: 50,
      }),
      occurred_at: ts(1),
    });
    await runInventoryRelayBatch(await makeDeps(pool));

    const rows = (await pool.query(`SELECT product_id::text, observed_quantity_after FROM delivery_inventory_observations ORDER BY product_id`)).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ product_id: PRODUCT_ID, observed_quantity_after: 100 });
    expect(rows[1]).toMatchObject({ product_id: OTHER_PRODUCT, observed_quantity_after: 50 });
  });

  /* ── atomicity: mid-transaction failure → no partial state ── */

  it("rolls back EVERYTHING when the transaction fails mid-flight, then retries clean", async () => {
    const eventId = await seedMarketplaceEvent(pool, {
      payload: validPayload({ adjustment_sequence: 1, quantity_after: 100 }),
      occurred_at: ts(0),
    });

    // Abort trigger on the observation table — fires mid-transaction.
    await pool.query(
      `CREATE OR REPLACE FUNCTION abort_observation() RETURNS trigger AS $$
         BEGIN RAISE EXCEPTION 'injected mid-transaction failure'; END;
       $$ LANGUAGE plpgsql;
       CREATE TRIGGER abort_observation BEFORE INSERT ON delivery_inventory_observations
         FOR EACH ROW EXECUTE FUNCTION abort_observation()`,
    );

    const outcome = await runInventoryRelayBatch(await makeDeps(pool));
    expect(outcome.applied).toBe(0);
    expect(outcome.poisoned).toBe(0); // maxAttempts 5: stays pending

    // NOTHING from the failed transaction survived:
    expect((await pool.query(`SELECT count(*)::int AS n FROM delivery_inventory_observations`)).rows[0].n).toBe(0);
    expect((await store.getInventoryCheckpoint(DEFAULT_INVENTORY_RELAY_CONFIG.consumerId))).toBeNull();
    expect((await store.getInventoryConsumed(eventId))?.status).toBe("pending");

    // The retry applies cleanly:
    await pool.query(`DROP TRIGGER abort_observation ON delivery_inventory_observations`);
    const retry = await runInventoryRelayBatch(await makeDeps(pool));
    expect(retry.applied).toBe(1);
    const obs = (await pool.query(`SELECT observed_quantity_after FROM delivery_inventory_observations`)).rows[0];
    expect(obs.observed_quantity_after).toBe(100);
  });
});
