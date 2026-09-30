/**
 * RISK-0012 (CLM-0416 · ADR-057): search reads `marketplace_outbox` in COMMIT order.
 *
 * The old key (created_at, outbox_id) tied inside one transaction — `now()` is the
 * transaction start — and fell to a random UUID; and no insert-time key can see an
 * event whose transaction committed after a later one was already read.
 *
 * SKIPS when DATABASE_URL is unset.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";

import { PG_ENABLED, resetData, setupPostgres, type PgFixture } from "./pg-harness.js";
import { PostgresMarketplaceEventSource } from "../infrastructure/marketplace-event-source.js";

const INSERT = `INSERT INTO marketplace_outbox (outbox_id, event_type, event_version, aggregate_type, aggregate_id, payload, occurred_at)
                VALUES ($1::uuid, 'marketplace.store_registered', 'v1', 'store', $1, '{}'::jsonb, now())`;
const uuid = (n: number) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, "0")}`;

(PG_ENABLED ? describe : describe.skip)("RISK-0012 — search relay source reads in commit order (PostgreSQL)", () => {
  let fixture: PgFixture;
  let held: PoolClient | null = null;

  beforeEach(async () => {
    fixture = await setupPostgres();
    await resetData(fixture.pool);
  });
  afterEach(async () => {
    if (held) {
      await held.query("ROLLBACK").catch(() => undefined);
      held.release();
      held = null;
    }
    await fixture.close();
  });

  it("intra-transaction order: 12 rows of one transaction come back in insertion order", async () => {
    const c = await fixture.pool.connect();
    try {
      await c.query("BEGIN");
      for (let i = 12; i >= 1; i--) await c.query(INSERT, [uuid(i)]);
      await c.query("COMMIT");
    } finally {
      c.release();
    }
    const rows = await new PostgresMarketplaceEventSource(fixture.pool).readAfter(null, 50);
    expect(rows.map((r) => r.outbox_id)).toEqual(Array.from({ length: 12 }, (_, k) => uuid(12 - k)));
  });

  it("late commit: a row inserted first and committed last is read after the checkpoint, not skipped", async () => {
    held = await fixture.pool.connect();
    await held.query("BEGIN");
    await held.query(INSERT, [uuid(1)]);

    const t2 = await fixture.pool.connect();
    try {
      await t2.query("SET statement_timeout = '5s'");
      await t2.query(INSERT, [uuid(2)]);
    } finally {
      t2.release();
    }

    const source = new PostgresMarketplaceEventSource(fixture.pool);
    const first = await source.readAfter(null, 50);
    expect(first.map((r) => r.outbox_id)).toEqual([uuid(2)]);
    const cp = { last_commit_sequence: first[0]!.commit_sequence, last_outbox_id: first[0]!.outbox_id, last_created_at: first[0]!.created_at };

    await held.query("COMMIT");
    held.release();
    held = null;

    const second = await source.readAfter(cp, 50);
    expect(second.map((r) => r.outbox_id)).toEqual([uuid(1)]);
  });
});
