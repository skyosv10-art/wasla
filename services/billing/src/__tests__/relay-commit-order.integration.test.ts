/**
 * RISK-0012 (CLM-0416 · ADR-057): billing reads `delivery_outbox` in COMMIT order.
 *
 * `outbox_id` (BIGSERIAL) is allocated at insert: a transaction that inserted first
 * and committed last shows an id the relay has already passed. `commit_sequence`
 * is assigned at commit by delivery's deferred trigger, so that event is read next.
 *
 * SKIPS when DATABASE_URL is unset.
 */

import type { Pool, PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresDeliveryEventSource } from "../infrastructure/pg/relay-stores.js";
import { newPool, PG_ENABLED, resetData, resetSchema } from "./pg-harness.js";

const INSERT = `INSERT INTO delivery_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload)
                VALUES ($1::uuid, 'store_order.created', 'v1', 'store_order', $2, '{}'::jsonb)`;
const uuid = (n: number) => `ffffffff-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe.skipIf(!PG_ENABLED)("RISK-0012 — billing relay source reads in commit order (PostgreSQL)", () => {
  let pool: Pool;
  let held: PoolClient | null = null;

  beforeAll(async () => {
    pool = newPool();
    await resetSchema(pool);
  });
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    await resetData(pool);
  });
  afterEach(async () => {
    if (held) {
      await held.query("ROLLBACK").catch(() => undefined);
      held.release();
      held = null;
    }
  });

  it("late commit: the insert-time id says «behind», the commit-time sequence says «ahead», and the event is read", async () => {
    held = await pool.connect();
    await held.query("BEGIN");
    await held.query(INSERT, [uuid(1), "SO-1"]);

    const t2 = await pool.connect();
    try {
      await t2.query("SET statement_timeout = '5s'");
      await t2.query(INSERT, [uuid(2), "SO-2"]);
    } finally {
      t2.release();
    }

    const source = new PostgresDeliveryEventSource(pool);
    const first = await source.readAfter(null, 50);
    expect(first.map((r) => r.event_id)).toEqual([uuid(2)]);
    const cp = { last_commit_sequence: first[0]!.commit_sequence, last_occurred_at: first[0]!.occurred_at, last_event_id: first[0]!.event_id };

    await held.query("COMMIT");
    held.release();
    held = null;

    const ids = await pool.query<{ event_id: string; outbox_id: string; commit_sequence: string }>(
      `SELECT event_id::text, outbox_id::text, commit_sequence::text FROM delivery_outbox ORDER BY event_id`,
    );
    const [e1, e2] = ids.rows;
    expect(BigInt(e1!.outbox_id)).toBeLessThan(BigInt(e2!.outbox_id));
    expect(BigInt(e1!.commit_sequence)).toBeGreaterThan(BigInt(e2!.commit_sequence));

    const second = await source.readAfter(cp, 50);
    expect(second.map((r) => r.event_id)).toEqual([uuid(1)]);
  });
});
