/**
 * PostgresProjectionStore — writes search-owned projection state, the
 * searchable index, the consumed-event idempotency ledger, and the relay
 * checkpoint. All writes are idempotent upserts (ON CONFLICT DO UPDATE/NOTHING)
 * so duplicate delivery and replay are safe (review 2/N req 3,4,10).
 */

import type { Pool, PoolClient } from "pg";
import type { CatalogStore, ProjectionStore } from "../ports.js";
import { normalizeStoreName } from "../domain/store-search.js";
import type {
  MarketplaceOutboxRow,
  RelayCheckpoint,
  CatalogProduct,
  ConsumedStatus,
} from "../domain/consumed-events.js";
import type { StoreProjection, ProductProjection } from "../domain/projector.js";

/**
 * G-S9.20 · CLM-0655 — namespace of the search relay's consumer lock.
 * Advisory locks are per database and the key is `(namespace, hashtext(consumerId))`
 * (the same two-int scheme as delivery's relay, M5-13R). A namespace distinct
 * from delivery's (42626) keeps the two services' locks apart even when they
 * share one database. Arbitrary on purpose; must not be reused for another purpose.
 */
export const SEARCH_RELAY_ADVISORY_LOCK_NAMESPACE = 42627;

export class PostgresProjectionStore implements ProjectionStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Session-level advisory lock held for the whole batch (checkpoint read →
   * last checkpoint write). A transaction-level lock would release at the
   * first COMMIT — mid-batch, exactly where the race lived (RISK-0070). The
   * lock belongs to the leased session, so lock and unlock run on the same
   * client; the batch's own queries go through the pool on other connections.
   * Hence a pool of fewer than 2 connections would wait on itself forever:
   * refused up front instead of hanging.
   */
  async withConsumerLock<T>(consumerId: string, fn: () => Promise<T>): Promise<T> {
    const max = (this.pool as unknown as { options?: { max?: unknown } }).options?.max;
    if (typeof max === "number" && max < 2) {
      throw new Error(
        `search relay consumer lock needs a pool of at least 2 connections (got max=${max}): ` +
          "the lock holds one session for the whole batch while the batch queries through the pool",
      );
    }
    const ns = SEARCH_RELAY_ADVISORY_LOCK_NAMESPACE;
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1, hashtext($2))", [ns, consumerId]);
      try {
        return await fn();
      } finally {
        await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [ns, consumerId]);
      }
    } finally {
      client.release();
    }
  }

  async getCheckpoint(consumerId: string): Promise<RelayCheckpoint | null> {
    const r = await this.pool.query<{ last_commit_sequence: string; last_outbox_id: string; last_created_at: string }>(
      `SELECT last_commit_sequence::text AS last_commit_sequence, last_outbox_id::text, last_created_at::text
         FROM search_relay_checkpoint WHERE consumer_id = $1`,
      [consumerId],
    );
    return r.rows.length ? r.rows[0] : null;
  }

  async writeCheckpoint(consumerId: string, cp: RelayCheckpoint): Promise<void> {
    await this.pool.query(
      `INSERT INTO search_relay_checkpoint (consumer_id, last_commit_sequence, last_outbox_id, last_created_at)
       VALUES ($1, $2::bigint, $3::uuid, $4::timestamptz)
       ON CONFLICT (consumer_id)
       DO UPDATE SET last_commit_sequence = EXCLUDED.last_commit_sequence,
                     last_outbox_id = EXCLUDED.last_outbox_id,
                     last_created_at = EXCLUDED.last_created_at`,
      [consumerId, cp.last_commit_sequence, cp.last_outbox_id, cp.last_created_at],
    );
  }

  async getStoreProjection(storeId: string): Promise<StoreProjection | null> {
    const r = await this.pool.query(
      `SELECT store_id::text, store_slug, category_slug, store_state, state_sequence
         FROM search_marketplace_store_state WHERE store_id = $1::uuid`,
      [storeId],
    );
    return (r.rows[0] as StoreProjection | undefined) ?? null;
  }

  async getProductProjection(productId: string): Promise<ProductProjection | null> {
    const r = await this.pool.query(
      `SELECT product_id::text, store_id::text, store_slug, sku, category_slug,
              product_state, moderation_state, moderation_sequence,
              quantity_on_hand, adjustment_sequence, archived_at::text AS archived_at
         FROM search_marketplace_product_state WHERE product_id = $1::uuid`,
      [productId],
    );
    return (r.rows[0] as ProductProjection | undefined) ?? null;
  }

  async upsertStoreState(row: StoreProjection): Promise<void> {
    await this.pool.query(
      `INSERT INTO search_marketplace_store_state
         (store_id, store_slug, category_slug, store_state, state_sequence)
       VALUES ($1::uuid, $2, $3, $4, $5)
       ON CONFLICT (store_id)
       DO UPDATE SET store_slug = EXCLUDED.store_slug,
                     category_slug = EXCLUDED.category_slug,
                     store_state = EXCLUDED.store_state,
                     state_sequence = EXCLUDED.state_sequence`,
      [row.store_id, row.store_slug, row.category_slug, row.store_state, row.state_sequence],
    );
  }

  async upsertProductState(row: ProductProjection): Promise<void> {
    await this.pool.query(
      `INSERT INTO search_marketplace_product_state
         (product_id, store_id, store_slug, sku, category_slug,
          product_state, moderation_state, moderation_sequence,
          quantity_on_hand, adjustment_sequence, archived_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz)
       ON CONFLICT (product_id)
       DO UPDATE SET store_id = EXCLUDED.store_id,
                     store_slug = EXCLUDED.store_slug,
                     sku = EXCLUDED.sku,
                     category_slug = EXCLUDED.category_slug,
                     product_state = EXCLUDED.product_state,
                     moderation_state = EXCLUDED.moderation_state,
                     moderation_sequence = EXCLUDED.moderation_sequence,
                     quantity_on_hand = EXCLUDED.quantity_on_hand,
                     adjustment_sequence = EXCLUDED.adjustment_sequence,
                     archived_at = EXCLUDED.archived_at`,
      [
        row.product_id, row.store_id, row.store_slug, row.sku, row.category_slug,
        row.product_state, row.moderation_state, row.moderation_sequence,
        row.quantity_on_hand, row.adjustment_sequence,
        row.archived_at,
      ],
    );
  }

  async hasIndexDoc(productId: string): Promise<boolean> {
    const r = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM search_product_index WHERE product_id = $1::uuid`,
      [productId],
    );
    return Number(r.rows[0]?.n ?? "0") > 0;
  }

  async upsertIndexDoc(catalog: CatalogProduct, projection: ProductProjection, storeState: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO search_product_index
         (product_id, store_id, store_slug, sku, category_slug,
          title_ar, title_en, price_minor_units, currency_code,
          store_state, product_state, moderation_state, quantity_on_hand)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (product_id)
       DO UPDATE SET store_id = EXCLUDED.store_id,
                     store_slug = EXCLUDED.store_slug,
                     sku = EXCLUDED.sku,
                     category_slug = EXCLUDED.category_slug,
                     title_ar = EXCLUDED.title_ar,
                     title_en = EXCLUDED.title_en,
                     price_minor_units = EXCLUDED.price_minor_units,
                     currency_code = EXCLUDED.currency_code,
                     store_state = EXCLUDED.store_state,
                     product_state = EXCLUDED.product_state,
                     moderation_state = EXCLUDED.moderation_state,
                     quantity_on_hand = EXCLUDED.quantity_on_hand`,
      [
        catalog.product_id, catalog.store_id, catalog.store_slug, catalog.sku, catalog.category_slug,
        catalog.title_ar, catalog.title_en, catalog.price_minor_units, catalog.currency_code,
        storeState, projection.product_state, projection.moderation_state, projection.quantity_on_hand,
      ],
    );
  }

  async refreshProductStateColumns(productId: string, projection: ProductProjection): Promise<void> {
    await this.pool.query(
      `UPDATE search_product_index
          SET product_state = $2,
              moderation_state = $3,
              quantity_on_hand = $4
        WHERE product_id = $1::uuid`,
      [productId, projection.product_state, projection.moderation_state, projection.quantity_on_hand],
    );
  }

  async updateStoreStateOnDocs(storeId: string, storeState: string): Promise<void> {
    await this.pool.query(
      `UPDATE search_product_index SET store_state = $2 WHERE store_id = $1::uuid`,
      [storeId, storeState],
    );
  }

  async archiveProductDoc(productId: string, archivedAt: string): Promise<void> {
    await this.pool.query(
      `UPDATE search_product_index SET archived_at = $2::timestamptz WHERE product_id = $1::uuid`,
      [productId, archivedAt],
    );
  }

  async getConsumed(outboxId: string): Promise<{ status: ConsumedStatus; attempt_count: number } | null> {
    const r = await this.pool.query<{ status: ConsumedStatus; attempt_count: string }>(
      `SELECT status, attempt_count::text AS attempt_count FROM search_relay_consumed_events WHERE outbox_id = $1::uuid`,
      [outboxId],
    );
    if (!r.rows.length) return null;
    return { status: r.rows[0].status, attempt_count: Number(r.rows[0].attempt_count) };
  }

  async markConsumed(
    outboxId: string,
    row: Pick<MarketplaceOutboxRow, "event_type" | "aggregate_type" | "aggregate_id">,
    status: ConsumedStatus,
    attemptCount: number,
    lastError: string | null = null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO search_relay_consumed_events
         (outbox_id, event_type, aggregate_type, aggregate_id, status, attempt_count, last_error)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (outbox_id)
       DO UPDATE SET status = EXCLUDED.status,
                     attempt_count = EXCLUDED.attempt_count,
                     last_error = EXCLUDED.last_error`,
      [outboxId, row.event_type, row.aggregate_type, row.aggregate_id, status, attemptCount, lastError],
    );
  }

  // ── store-name read model (G-S9.7 · ADR-025 §6) ──
  async hasStoreDoc(storeId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM search_store_index WHERE store_id = $1::uuid`, [storeId]);
    return (r.rowCount ?? 0) > 0;
  }

  async upsertStoreDoc(store: CatalogStore): Promise<void> {
    const norm = (v: string | null): string | null => (v === null ? null : normalizeStoreName(v));
    await this.pool.query(
      `INSERT INTO search_store_index
         (store_id, store_slug, title_ar, title_en, title_ur, name_norm_ar, name_norm_en, name_norm_ur)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (store_id)
       DO UPDATE SET store_slug = EXCLUDED.store_slug,
                     title_ar = EXCLUDED.title_ar,
                     title_en = EXCLUDED.title_en,
                     title_ur = EXCLUDED.title_ur,
                     name_norm_ar = EXCLUDED.name_norm_ar,
                     name_norm_en = EXCLUDED.name_norm_en,
                     name_norm_ur = EXCLUDED.name_norm_ur`,
      [
        store.store_id, store.store_slug, store.title_ar, store.title_en, store.title_ur,
        normalizeStoreName(store.title_ar), norm(store.title_en), norm(store.title_ur),
      ],
    );
  }

  async clearAll(): Promise<void> {
    await this.pool.query(
      `TRUNCATE search_relay_checkpoint, search_relay_consumed_events,
                 search_product_index, search_marketplace_product_state,
                 search_marketplace_store_state, search_store_index, search_outbox RESTART IDENTITY CASCADE`,
    );
  }

  /** Test helper: list visible index docs (the query-time visibility filter). */
  async listVisibleIndexDocs(): Promise<readonly CatalogProduct[]> {
    const r = await this.pool.query(
      `SELECT product_id::text, store_id::text, store_slug, sku, category_slug,
              title_ar, title_en, price_minor_units, currency_code
         FROM search_product_index
        WHERE store_state = 'approved'
          AND product_state = 'published'
          AND moderation_state = 'approved'
          AND quantity_on_hand > 0
          AND archived_at IS NULL
        ORDER BY product_id ASC`,
      [],
    );
    return r.rows as readonly CatalogProduct[];
  }
}
