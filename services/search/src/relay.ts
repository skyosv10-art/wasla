/**
 * Relay Consumer (ADR-025 §2.3) — orchestrates the end-to-end projection:
 *   marketplace_outbox event → relay → search read model → correct state.
 *
 * Reliability guarantees (review 2/N requirements 3–11):
 *  - Idempotency (req 3,4): a consumed `outbox_id` with a terminal status is
 *    never re-processed. Duplicate delivery is a no-op.
 *  - Ordering (req 5): stale-sequence events (per aggregate) are skipped
 *    (`skipped_stale`) so a delayed/redelivered event cannot regress state.
 *  - Retry (req 6) + failure handling (req 7): a retryable failure leaves the
 *    row `pending` (checkpoint does NOT advance) so the next poll retries.
 *    After `maxAttempts` the row is `poisoned` (dead-letter) and the
 *    checkpoint advances past it — a poison event never blocks the stream.
 *  - Poison / dead-letter (req 8): unknown event versions and unrecoverable
 *    failures are `poisoned` (terminal) and logged with `last_error`.
 *  - Checkpoint (req 9): progress is the last (created_at, outbox_id) that
 *    reached a terminal status. The relay owns it; it never writes to
 *    `marketplace_outbox.published_at`.
 *  - Replay (req 10): `replayFrom(checkpoint=null)` resets the checkpoint so
 *    idempotency makes already-applied events no-ops; `rebuildAll()` clears
 *    the index + projection state + ledger + checkpoint and re-reads from zero.
 *  - Version compatibility (req 11): only `event_version === "v1"` is
 *    projected; anything else is poisoned (never silently dropped).
 *  - Observability (req 12): every event emits a structured log line.
 */

import type {
  MarketplaceEventSource,
  CatalogReadPort,
  ProjectionStore,
} from "./ports.js";
import type {
  MarketplaceOutboxRow,
  RelayCheckpoint,
  ConsumedStatus,
  CatalogProduct,
} from "./domain/consumed-events.js";
import type { ProjectableEvent } from "./domain/consumed-events.js";
import { classifyEvent } from "./domain/consumed-events.js";
import { project } from "./domain/projector.js";

export const SUPPORTED_EVENT_VERSION = "v1";

export interface RelayConfig {
  readonly consumerId: string;
  readonly batchSize: number;
  readonly maxAttempts: number;
}

export const DEFAULT_RELAY_CONFIG: RelayConfig = {
  consumerId: "search-relay-v1",
  batchSize: 100,
  maxAttempts: 5,
};

export interface RelayDeps {
  readonly events: MarketplaceEventSource;
  readonly catalog: CatalogReadPort;
  readonly store: ProjectionStore;
  readonly config?: Partial<RelayConfig>;
  readonly log?: (entry: RelayLogEntry) => void;
}

export interface RelayLogEntry {
  readonly outbox_id: string;
  readonly event_type: string;
  readonly status: ConsumedStatus;
  readonly attempt: number;
  readonly detail?: string;
  readonly ts: string;
}

export interface BatchOutcome {
  readonly processed: number;
  readonly applied: number;
  readonly skipped: number;
  readonly poisoned: number;
  readonly advancedTo: RelayCheckpoint | null;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Process one batch of outbox events. Returns the outcome and the new
 * checkpoint. Idempotent: re-running with the same events is a no-op for
 * already-terminal rows.
 */
export async function runRelayBatch(deps: RelayDeps): Promise<BatchOutcome> {
  const cfg = { ...DEFAULT_RELAY_CONFIG, ...deps.config };
  const log = deps.log ?? (() => {});
  const checkpoint = await deps.store.getCheckpoint(cfg.consumerId);
  const rows = await deps.events.readAfter(checkpoint, cfg.batchSize);

  let applied = 0;
  let skipped = 0;
  let poisoned = 0;
  let advancedTo = checkpoint;

  for (const row of rows) {
    const outcome = await processRow(deps, cfg, row, log);
    if (outcome === "applied") applied += 1;
    else if (outcome === "poisoned") poisoned += 1;
    else if (outcome === "skipped") skipped += 1;
    if (outcome !== "pending") {
      advancedTo = { last_outbox_id: row.outbox_id, last_created_at: row.created_at };
      await deps.store.writeCheckpoint(cfg.consumerId, advancedTo);
    }
  }

  return {
    processed: rows.length,
    applied,
    skipped,
    poisoned,
    advancedTo,
  };
}

type RowOutcome = "applied" | "skipped" | "poisoned" | "pending";

async function processRow(
  deps: RelayDeps,
  cfg: RelayConfig,
  row: MarketplaceOutboxRow,
  log: (e: RelayLogEntry) => void,
): Promise<RowOutcome> {
  // 1. Idempotency: a terminal consumed row is a no-op (duplicate delivery).
  const existing = await deps.store.getConsumed(row.outbox_id);
  if (existing && isTerminal(existing.status)) {
    log({ outbox_id: row.outbox_id, event_type: row.event_type, status: existing.status, attempt: existing.attempt_count, detail: "duplicate delivery — already terminal", ts: now() });
    return existing.status === "poisoned" ? "poisoned" : "skipped";
  }

  // 2. Version compatibility (req 11): only v1 is projected; else poison.
  if (row.event_version !== SUPPORTED_EVENT_VERSION) {
    const attempt = (existing?.attempt_count ?? 0) + 1;
    await deps.store.markConsumed(row.outbox_id, row, "poisoned", attempt, `unsupported event_version: ${row.event_version}`);
    log({ outbox_id: row.outbox_id, event_type: row.event_type, status: "poisoned", attempt, detail: `unsupported event_version: ${row.event_version}`, ts: now() });
    return "poisoned";
  }

  // 3. Classify: ignored event types are terminal no-ops (event coverage).
  const classification = classifyEvent(row);
  if (classification.kind === "ignored") {
    await deps.store.markConsumed(row.outbox_id, row, "ignored", 1, classification.reason);
    log({ outbox_id: row.outbox_id, event_type: row.event_type, status: "ignored", attempt: 1, detail: classification.reason, ts: now() });
    return "skipped";
  }

  // 4. Project + execute. Retryable failures keep the row pending (checkpoint
  //    does NOT advance) so the next poll retries; after maxAttempts → poison.
  const attempt = (existing?.attempt_count ?? 0) + 1;
  try {
    const result = await applyEvent(deps, row, classification.event);
    await deps.store.markConsumed(row.outbox_id, row, result, attempt, null);
    log({ outbox_id: row.outbox_id, event_type: row.event_type, status: result, attempt, ts: now() });
    return result === "skipped_stale" ? "skipped" : "applied";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (attempt > cfg.maxAttempts) {
      await deps.store.markConsumed(row.outbox_id, row, "poisoned", attempt, msg);
      log({ outbox_id: row.outbox_id, event_type: row.event_type, status: "poisoned", attempt, detail: msg, ts: now() });
      return "poisoned";
    }
    // Leave pending: checkpoint does NOT advance — retry next poll.
    await deps.store.markConsumed(row.outbox_id, row, "pending", attempt, msg);
    log({ outbox_id: row.outbox_id, event_type: row.event_type, status: "pending", attempt, detail: "retryable failure", ts: now() });
    return "pending";
  }
}

async function applyEvent(
  deps: RelayDeps,
  row: MarketplaceOutboxRow,
  event: ProjectableEvent,
): Promise<ConsumedStatus> {
  const d = event.data as unknown as Record<string, unknown>;
  const storeId = (d.store_id as string) ?? null;
  const productId = (d.product_id as string) ?? null;

  const currentStore = storeId ? await deps.store.getStoreProjection(storeId) : null;
  const currentProduct = productId ? await deps.store.getProductProjection(productId) : null;

  const result = project(event, currentStore, currentProduct);

  if (result.stale) return "skipped_stale";

  // Retry-safety (req 6,7): for a product that just became visible and has no
  // index doc yet, fetch the catalog datum BEFORE mutating projection state.
  // A transient catalog failure then leaves the projection untouched, so the
  // next retry still sees the product as not-yet-visible and re-fetches.
  let catalogForNewDoc: CatalogProduct | null = null;
  if (result.indexEffect.kind === "became_visible") {
    const pid = result.indexEffect.product_id;
    const projection = result.productStateUpsert ?? currentProduct;
    if (projection && !(await deps.store.hasIndexDoc(pid))) {
      catalogForNewDoc = await deps.catalog.getProduct(pid); // may throw — state not yet mutated
      if (!catalogForNewDoc) throw new Error(`catalog product not found: ${pid}`);
    }
  }

  // Mutate projection state + index together (after the catalog fetch).
  if (result.storeStateUpsert) await deps.store.upsertStoreState(result.storeStateUpsert);
  if (result.productStateUpsert) await deps.store.upsertProductState(result.productStateUpsert);

  const storeState = result.storeStateUpsert?.store_state ?? currentStore?.store_state ?? "draft";

  switch (result.indexEffect.kind) {
    case "none":
      break;
    case "became_visible": {
      const pid = result.indexEffect.product_id;
      const projection = result.productStateUpsert ?? currentProduct;
      if (!projection) break;
      if (catalogForNewDoc) {
        await deps.store.upsertIndexDoc(catalogForNewDoc, projection, storeState);
      } else {
        await deps.store.refreshProductStateColumns(pid, projection);
      }
      break;
    }
    case "refresh_product": {
      const pid = result.indexEffect.product_id;
      const projection = result.productStateUpsert ?? currentProduct;
      if (projection) await deps.store.refreshProductStateColumns(pid, projection);
      break;
    }
    case "archive_product": {
      const pid = result.indexEffect.product_id;
      const projection = result.productStateUpsert ?? currentProduct;
      await deps.store.archiveProductDoc(pid, (projection?.archived_at) ?? row.occurred_at);
      break;
    }
    case "store_state_changed": {
      const sid = result.indexEffect.store_id;
      const newStore = result.storeStateUpsert;
      if (newStore) await deps.store.updateStoreStateOnDocs(sid, newStore.store_state);
      break;
    }
  }

  return "applied";
}

function isTerminal(status: ConsumedStatus): boolean {
  return status !== "pending";
}

/**
 * Replay (req 10): reset the checkpoint so idempotency makes already-applied
 * events no-ops. Safe to call repeatedly.
 */
export async function replayFrom(deps: RelayDeps, checkpoint: RelayCheckpoint | null): Promise<void> {
  await deps.store.writeCheckpoint(deps.config?.consumerId ?? DEFAULT_RELAY_CONFIG.consumerId, checkpoint ?? { last_outbox_id: "00000000-0000-0000-0000-000000000000", last_created_at: new Date(0).toISOString() });
}

/**
 * Full rebuild (req 10): clear index + projection state + consumed ledger +
 * checkpoint, then re-process from zero. The next `runRelayBatch` re-reads the
 * entire outbox and rebuilds the read model.
 */
export async function rebuildAll(deps: RelayDeps): Promise<void> {
  await deps.store.clearAll();
  await replayFrom(deps, null);
}
