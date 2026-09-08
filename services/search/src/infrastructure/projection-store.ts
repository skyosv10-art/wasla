/**
 * PostgresProjectionStore — writes search-owned projection state, the
 * searchable index, the consumed-event idempotency ledger, and the relay
 * checkpoint. All writes are idempotent upserts (ON CONFLICT DO UPDATE/NOTHING)
 * so duplicate delivery and replay are safe (review 2/N req 3,4,10).
 */

import type { Pool } from "pg";
import type { ProjectionStore } from "../ports.js";
import type {
  MarketplaceOutboxRow,
  RelayCheckpoint,
  CatalogProduct,
  ConsumedStatus,
} from "../domain/consumed-events.js";
import type { StoreProjection, ProductProjection } from "../domain/projector.js";

export class PostgresProjectionStore implements ProjectionStore {
  constructor(private readonly pool: Pool) {}

  async getCheckpoint(consumerId: string): Promise<RelayCheckpoint | null> {
    const r = await this.pool.query<{ last_outbox_id: string; last_created_at: string }>(
      `SELECT last_outbox_id::text, last_created_at::text FROM search_relay_checkpoint WHERE consumer_id = $1`,
      [consumerId],
    );
    return r.rows.length ? r.rows[0] : null;
  }

  async writeCheckpoint(consumerId: string, cp: RelayCheckpoint): Promise<void> {
    await this.pool.query(
      `INSERT INTO search_relay_checkpoint (consumer_id, last_outbox_id, last_created_at)
       VALUES ($1, $2::uuid, $3::timestamptz)
       ON CONFLICT (consumer_id)
       DO UPDATE SET last_outbox_id = EXCLUDED.last_outbox_id,
                     last_created_at = EXCLUDED.last_created_at`,
      [consumerId, cp.last_outbox_id, cp.last_created_at],
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

  async clearAll(): Promise<void> {
    await this.pool.query(
      `TRUNCATE search_relay_checkpoint, search_relay_consumed_events,
                 search_product_index, search_marketplace_product_state,
                 search_marketplace_store_state, search_outbox RESTART IDENTITY CASCADE`,
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
