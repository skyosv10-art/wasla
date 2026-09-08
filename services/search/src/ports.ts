/**
 * Relay infrastructure ports (ADR-025 §2.3). The relay depends on these
 * abstractions, not on marketplace internals or a specific DB driver:
 *
 *  - `MarketplaceEventSource`: reads `marketplace_outbox` rows AFTER a
 *    checkpoint offset. The relay never writes to `marketplace_outbox`
 *    (no `markPublished`) — GAP-3: progress is owned by search.
 *  - `CatalogReadPort`: the SANCTIONED read port for catalog data
 *    (GET /products/{productId}). Events carry no title/price (ADR-016
 *    decisions 4 & 10); the relay fetches them here when a product becomes
 *    visible. Tested with a fake in unit tests; HTTP adapter in prod.
 *  - `ProjectionStore`: writes search-owned projection state + index docs +
 *    consumed-event ledger + checkpoint. Idempotent upserts everywhere.
 */

import type { MarketplaceOutboxRow, RelayCheckpoint, CatalogProduct, ConsumedStatus } from "./domain/consumed-events.js";
import type { StoreProjection, ProductProjection } from "./domain/projector.js";

export interface MarketplaceEventSource {
  /** Read up to `limit` outbox rows strictly after the checkpoint (or from zero). */
  readAfter(checkpoint: RelayCheckpoint | null, limit: number): Promise<readonly MarketplaceOutboxRow[]>;
}

export interface CatalogReadPort {
  /** Fetch the catalog datum for a product (title/price/sku/category). */
  getProduct(productId: string): Promise<CatalogProduct | null>;
}

export interface ProjectionStore {
  getCheckpoint(consumerId: string): Promise<RelayCheckpoint | null>;
  writeCheckpoint(consumerId: string, checkpoint: RelayCheckpoint): Promise<void>;

  getStoreProjection(storeId: string): Promise<StoreProjection | null>;
  getProductProjection(productId: string): Promise<ProductProjection | null>;

  upsertStoreState(row: StoreProjection): Promise<void>;
  upsertProductState(row: ProductProjection): Promise<void>;

  hasIndexDoc(productId: string): Promise<boolean>;
  upsertIndexDoc(catalog: CatalogProduct, projection: ProductProjection, storeState: string): Promise<void>;
  refreshProductStateColumns(productId: string, projection: ProductProjection): Promise<void>;
  updateStoreStateOnDocs(storeId: string, storeState: string): Promise<void>;
  archiveProductDoc(productId: string, archivedAt: string): Promise<void>;

  /** Idempotency ledger: returns the consumed record if already seen. */
  getConsumed(outboxId: string): Promise<{ status: ConsumedStatus; attempt_count: number } | null>;
  markConsumed(outboxId: string, row: Pick<MarketplaceOutboxRow, "event_type" | "aggregate_type" | "aggregate_id">, status: ConsumedStatus, attemptCount: number, lastError?: string | null): Promise<void>;

  /** Full rebuild: clear index, projection state, consumed ledger, checkpoint. */
  clearAll(): Promise<void>;
}
