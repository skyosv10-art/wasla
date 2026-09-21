/**
 * M2-07 — Crash/retry/dedupe proof for the search relay.
 *
 * The search relay does NOT use `FOR UPDATE SKIP LOCKED` like the delivery relay.
 * Instead it relies on terminal idempotency: `getConsumed` + `ON CONFLICT DO UPDATE`
 * + the `outbox_id` PRIMARY KEY on `search_relay_consumed_events`. This test
 * proves that those mechanisms produce no duplicate durable effects under
 * concurrent processing and after crash recovery.
 *
 * ## What this proves (M2-07 §11 — search relay crash/retry/dedupe)
 *
 *   - Two relay instances processing the same outbox events concurrently leave
 *     exactly one consumed-events row per `outbox_id` and correct final
 *     projection state — no duplicate index docs.
 *   - A crash mid-batch (consumed-events reset to `pending`, checkpoint reset)
 *     recovers cleanly: the relay re-reads, re-processes, and the idempotent
 *     projections produce the same state — no duplicates.
 *   - A direct INSERT of a duplicate `outbox_id` into
 *     `search_relay_consumed_events` is rejected by the PRIMARY KEY constraint.
 *
 * ## Why this is integration, not unit
 *
 *   The `ON CONFLICT DO UPDATE` upsert and the PRIMARY KEY enforcement are
 *   PostgreSQL behaviors. In-memory fakes cannot reproduce concurrent
 *   `markConsumed` races or PK violations.
 *
 * SKIPS when DATABASE_URL is unset.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  PG_ENABLED,
  setupPostgres,
  resetData,
  seedOutboxEvent,
  T0,
  type PgFixture,
} from "./pg-harness.js";
import { PostgresMarketplaceEventSource } from "../infrastructure/marketplace-event-source.js";
import { PostgresProjectionStore } from "../infrastructure/projection-store.js";
import { runRelayBatch, DEFAULT_RELAY_CONFIG } from "../relay.js";
import type { CatalogReadPort } from "../ports.js";
import type { CatalogProduct } from "../domain/consumed-events.js";
import type { Pool } from "pg";

const STORE_ID = "11111111-1111-1111-1111-111111111111";
const PRODUCT_ID = "22222222-2222-2222-2222-222222222222";

const catalogProduct: CatalogProduct = {
  product_id: PRODUCT_ID,
  store_id: STORE_ID,
  store_slug: "acme",
  sku: "sku-1",
  category_slug: "electronics",
  title_ar: "هاتف ذكي",
  title_en: "Smart Phone",
  price_minor_units: 50000,
  currency_code: "SAR",
};

class FakeCatalog implements CatalogReadPort {
  private data = new Map<string, CatalogProduct>();
  set(p: CatalogProduct) {
    this.data.set(p.product_id, p);
  }
  async getProduct(id: string) {
    return this.data.get(id) ?? null;
  }
}

/**
 * Seed a minimal happy-path event sequence for a single store+product.
 * Returns the outbox_ids in order.
 */
async function seedHappyPath(pool: Pool): Promise<string[]> {
  const ids: string[] = [];
  const ts = (n: number) => new Date(Date.parse(T0) + n * 60_000).toISOString();

  const e1 = await seedOutboxEvent(pool, {
    event_type: "marketplace.store_registered",
    aggregate_type: "store",
    aggregate_id: STORE_ID,
    occurred_at: ts(0),
    created_at: ts(0),
    payload: {
      store_id: STORE_ID,
      store_slug: "acme",
      owner_public_id: "WS-0000000001",
      category_slug: "electronics",
      to_state: "pending_review",
      state_sequence: 1,
      actor_type: "owner",
      occurred_for: ts(0),
    },
  });
  ids.push(e1.outbox_id);

  const e2 = await seedOutboxEvent(pool, {
    event_type: "marketplace.store_approved",
    aggregate_type: "store",
    aggregate_id: STORE_ID,
    occurred_at: ts(1),
    created_at: ts(1),
    payload: {
      store_id: STORE_ID,
      store_slug: "acme",
      owner_public_id: "WS-0000000001",
      category_slug: "electronics",
      from_state: "pending_review",
      to_state: "approved",
      state_sequence: 2,
      actor_type: "moderator",
      occurred_for: ts(1),
    },
  });
  ids.push(e2.outbox_id);

  const e3 = await seedOutboxEvent(pool, {
    event_type: "marketplace.product_created",
    aggregate_type: "product",
    aggregate_id: PRODUCT_ID,
    occurred_at: ts(2),
    created_at: ts(2),
    payload: {
      product_id: PRODUCT_ID,
      store_id: STORE_ID,
      store_slug: "acme",
      sku: "sku-1",
      category_slug: "electronics",
      state: "draft",
      moderation_state: "pending",
      created_by_public_id: "WS-0000000001",
      occurred_for: ts(2),
    },
  });
  ids.push(e3.outbox_id);

  const e4 = await seedOutboxEvent(pool, {
    event_type: "marketplace.product_moderated",
    aggregate_type: "product",
    aggregate_id: PRODUCT_ID,
    occurred_at: ts(3),
    created_at: ts(3),
    payload: {
      product_id: PRODUCT_ID,
      store_id: STORE_ID,
      store_slug: "acme",
      from_state: "pending",
      to_state: "approved",
      moderation_sequence: 1,
      actor_type: "moderator",
      occurred_for: ts(3),
    },
  });
  ids.push(e4.outbox_id);

  const e5 = await seedOutboxEvent(pool, {
    event_type: "marketplace.product_published",
    aggregate_type: "product",
    aggregate_id: PRODUCT_ID,
    occurred_at: ts(4),
    created_at: ts(4),
    payload: {
      product_id: PRODUCT_ID,
      store_id: STORE_ID,
      store_slug: "acme",
      category_slug: "electronics",
      from_state: "draft",
      to_state: "published",
      store_state: "approved",
      quantity_on_hand: 5,
      actor_public_id: "WS-0000000001",
      occurred_for: ts(4),
    },
  });
  ids.push(e5.outbox_id);

  return ids;
}

describe.skipIf(!PG_ENABLED)(
  "M2-07 search crash/retry/dedupe proof — concurrent relay, crash recovery, PK dedupe",
  () => {
    let pool: Pool;
    let fixture: PgFixture;
    let catalog: FakeCatalog;

    beforeEach(async () => {
      fixture = await setupPostgres();
      pool = fixture.pool;
      catalog = new FakeCatalog();
      catalog.set(catalogProduct);
      await resetData(pool);
    });

    afterEach(async () => {
      await fixture.close();
    });

    it("two concurrent relay instances leave one consumed-events row per outbox_id and correct projection state", async () => {
      const outboxIds = await seedHappyPath(pool);

      // Two independent relay instances sharing the same pool/DB.
      const eventsA = new PostgresMarketplaceEventSource(pool);
      const storeA = new PostgresProjectionStore(pool);
      const eventsB = new PostgresMarketplaceEventSource(pool);
      const storeB = new PostgresProjectionStore(pool);

      const depsA = {
        events: eventsA,
        catalog,
        store: storeA,
        config: DEFAULT_RELAY_CONFIG,
      };
      const depsB = {
        events: eventsB,
        catalog,
        store: storeB,
        config: DEFAULT_RELAY_CONFIG,
      };

      // Run both batches concurrently — the pool serializes the SQL.
      // The search relay uses getConsumed + ON CONFLICT DO UPDATE, not
      // FOR UPDATE SKIP LOCKED. So both instances may read the same events,
      // but markConsumed upserts on the same outbox_id, and the idempotency
      // check (getConsumed) prevents re-processing terminal rows.
      await Promise.all([runRelayBatch(depsA), runRelayBatch(depsB)]);

      // Exactly one consumed-events row per outbox_id — no duplicates.
      const rows = await pool.query(
        `SELECT outbox_id::text, status FROM search_relay_consumed_events ORDER BY outbox_id`,
      );
      expect(rows.rows.length, "one row per outbox_id — no duplicates").toBe(
        outboxIds.length,
      );
      for (const row of rows.rows) {
        // Every row must be in a terminal status (applied, skipped, etc.)
        // — never stuck in "pending" after both instances finished.
        expect(row.status, `event ${row.outbox_id} is terminal`).not.toBe(
          "pending",
        );
      }

      // The projection must have exactly one index doc — not two.
      // Both instances project into the same tables via upserts
      // (ON CONFLICT DO UPDATE/NOTHING), so the final state is the same
      // as a single instance.
      const docs = await storeA.listVisibleIndexDocs();
      expect(docs.length, "exactly one index doc — no duplicates").toBe(1);
      expect(docs[0].title_ar).toBe("هاتف ذكي");
      expect(docs[0].price_minor_units).toBe(50000);
    });

    it("crash mid-batch: consumed-events reset to pending and checkpoint reset — relay recovers and projections are idempotent", async () => {
      // Seed events for the crash recovery test.
      await seedHappyPath(pool);

      // First relay instance: process all events normally.
      const events = new PostgresMarketplaceEventSource(pool);
      const s = new PostgresProjectionStore(pool);
      const deps = {
        events,
        catalog,
        store: s,
        config: DEFAULT_RELAY_CONFIG,
      };

      const outcome1 = await runRelayBatch(deps);
      expect(outcome1.applied, "first batch applied 5 events").toBe(5);

      // Verify projection state exists.
      const docs1 = await s.listVisibleIndexDocs();
      expect(docs1.length, "one index doc after first batch").toBe(1);

      // Simulate a crash: reset consumed-events to pending (as if the
      // transaction was rolled back) and delete the checkpoint.
      await pool.query(
        `UPDATE search_relay_consumed_events
            SET status = 'pending', attempt_count = 1, last_error = null,
                acknowledged_at = null, acknowledged_by = null,
                acknowledgement_reason = null,
                consumed_at = now()`,
      );
      await pool.query(`DELETE FROM search_relay_checkpoint`);

      // Recovery: a new relay instance re-reads from the zero checkpoint.
      // The getConsumed check finds rows in 'pending' (non-terminal), so
      // it re-processes them. But the projections are idempotent upserts,
      // so re-applying produces the same state — no duplicates.
      const events2 = new PostgresMarketplaceEventSource(pool);
      const s2 = new PostgresProjectionStore(pool);
      const deps2 = {
        events: events2,
        catalog,
        store: s2,
        config: DEFAULT_RELAY_CONFIG,
      };

      await runRelayBatch(deps2);

      // After recovery: still exactly one index doc (idempotent upserts).
      const docs2 = await s2.listVisibleIndexDocs();
      expect(docs2.length, "still one index doc after recovery").toBe(1);
      expect(docs2[0].title_ar).toBe("هاتف ذكي");
      expect(docs2[0].price_minor_units).toBe(50000);

      // After recovery: still exactly 5 consumed-events rows (no duplicates).
      const rows = await pool.query(
        `SELECT COUNT(*)::int AS count FROM search_relay_consumed_events`,
      );
      expect(rows.rows[0].count, "no duplicate consumed-events rows").toBe(5);

      // Every consumed-event must be terminal after recovery.
      const pendingRows = await pool.query(
        `SELECT COUNT(*)::int AS count FROM search_relay_consumed_events WHERE status = 'pending'`,
      );
      expect(
        pendingRows.rows[0].count,
        "no pending rows after recovery",
      ).toBe(0);
    });

    it("dedupe: outbox_id PRIMARY KEY rejects a duplicate consumed-events row", async () => {
      const outboxIds = await seedHappyPath(pool);

      const events = new PostgresMarketplaceEventSource(pool);
      const s = new PostgresProjectionStore(pool);
      const deps = {
        events,
        catalog,
        store: s,
        config: DEFAULT_RELAY_CONFIG,
      };

      // Process the first event — this inserts a row into
      // search_relay_consumed_events.
      await runRelayBatch(deps);

      // Attempt to insert a duplicate consumed-events row directly.
      // The outbox_id is PRIMARY KEY, so a duplicate INSERT must be rejected.
      const firstOutboxId = outboxIds[0];
      await expect(
        pool.query(
          `INSERT INTO search_relay_consumed_events
             (outbox_id, event_type, aggregate_type, aggregate_id, status,
              attempt_count, last_error, consumed_at)
           VALUES ($1::uuid, 'marketplace.store_registered', 'store', $2,
                   'pending', 1, null, now())`,
          [firstOutboxId, STORE_ID],
        ),
      ).rejects.toThrow(); // PRIMARY KEY violation
    });
  },
);
