/**
 * Marketplace Inventory Relay Consumer (ADR-026 §2.3) — projects inventory
 * adjustments from the marketplace outbox into delivery-owned snapshots:
 *   marketplace_outbox event → relay → delivery_inventory_observations.
 *
 * Reliability guarantees (same contract as the dispatch relay, ADR-026 §2.4):
 *  - Idempotency: a consumed `event_id` with a terminal status is never
 *    re-processed. Duplicate delivery is a no-op.
 *  - Ordering: per-(store, product) sequence guard — an older
 *    redelivered adjustment is `skipped_stale` and cannot regress the
 *    snapshot. Terminal-consumed events of EVERY kind (applied or ignored)
 *    advance the checkpoint.
 *  - Retry + failure: a retryable failure leaves the row `pending` (the
 *    checkpoint does NOT advance) so the next poll retries. After
 *    `maxAttempts` the row is `poisoned` and the checkpoint advances past
 *    it — a poison event never blocks the stream.
 *  - Poison: unknown event versions, invalid payloads
 *    (MarketplacePayloadError) are dead-lettered — a wrong snapshot must
 *    never advance quietly.
 *  - Checkpoint: (occurred_at, event_id) of the last terminally-consumed
 *    row. Delivery-owned; the relay never writes `marketplace_outbox`.
 *  - Replay: `replayInventoryFrom(null)` resets the checkpoint — idempotency
 *    makes already-applied events no-ops; `rebuildInventoryObservations()`
 *    additionally clears the snapshot and re-reads from zero.
 *  - Version compatibility: only `event_version === "v1"` is consumed.
 *  - Observability: every event emits a structured log line — ومنذُ المراجعةِ 16/N
 *    يحملُ سطرُ كلِّ فرقٍ مُطبَّقٍ **حكمَ التضاربِ** معَهُ: رايةٌ مرفوعةٌ
 *    بنوعِها وعددِ الطلباتِ، أو رفضٌ بمفردةِ رفضٍ مسمّاةٍ لا بسكوتٍ
 *    (ADR-026 §4.18).
 *
 * والرايةُ **تُعلِمُ ولا تحكُمُ**: لا إلغاءَ طلبٍ ولا إفراجَ حجزٍ ولا منعَ
 * انتقالٍ يُشتَقُّ منها في أيِّ موضعٍ من هذا المرحّلِ (السببُ في رأسِ
 * `domain/inventory-conflict.ts`).
 *
 * Boundary rule (ADR-026 §2.3): delivery stores SNAPSHOTS not balances —
 * the observation is the latest adjustment seen, never a running total.
 * The relay NEVER writes to `marketplace_outbox` (no `published_at`).
 */

import {
  classifyMarketplaceInventoryEvent,
  MarketplacePayloadError,
  isInventoryTerminal,
  ZERO_INVENTORY_CHECKPOINT,
  type InventoryConsumedStatus,
  type MarketplaceOutboxRow,
  type InventoryRelayCheckpoint,
} from "./domain/marketplace-inventory-events.js";
import type {
  MarketplaceInventoryEventSource,
  InventoryObservationStore,
  MirrorContext,
} from "./ports.js";
import type { BatchOutcome, RelayLogEntry } from "./relay.js";

export const SUPPORTED_INVENTORY_EVENT_VERSION = "v1";

export interface InventoryRelayConfig {
  readonly consumerId: string;
  readonly batchSize: number;
  readonly maxAttempts: number;
}

export const DEFAULT_INVENTORY_RELAY_CONFIG: InventoryRelayConfig = {
  consumerId: "delivery-marketplace-inventory-relay-v1",
  batchSize: 100,
  maxAttempts: 5,
};

export interface InventoryRelayDeps {
  readonly events: MarketplaceInventoryEventSource;
  readonly store: InventoryObservationStore;
  readonly config?: Partial<InventoryRelayConfig>;
  readonly log?: (entry: RelayLogEntry) => void;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Process one batch of marketplace inventory events. Returns the outcome and
 * the new checkpoint. Idempotent: re-running with the same events is a no-op
 * for already-terminal rows.
 */
export async function runInventoryRelayBatch(deps: InventoryRelayDeps): Promise<BatchOutcome> {
  const cfg = { ...DEFAULT_INVENTORY_RELAY_CONFIG, ...deps.config };
  const log = deps.log ?? (() => {});
  const checkpoint = await deps.store.getInventoryCheckpoint(cfg.consumerId);
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
      advancedTo = { last_occurred_at: row.occurred_at, last_event_id: row.event_id };
      await deps.store.writeInventoryCheckpoint(cfg.consumerId, advancedTo);
    }
  }

  return { processed: rows.length, applied, skipped, poisoned, advancedTo };
}

type RowOutcome = "applied" | "skipped" | "poisoned" | "pending";

async function processRow(
  deps: InventoryRelayDeps,
  cfg: InventoryRelayConfig,
  row: MarketplaceOutboxRow,
  log: (e: RelayLogEntry) => void,
): Promise<RowOutcome> {
  // 1. Idempotency: a terminally-consumed event is a no-op.
  const existing = await deps.store.getInventoryConsumed(row.event_id);
  if (existing && isInventoryTerminal(existing.status)) {
    log({ event_id: row.event_id, event_type: row.event_type, status: existing.status, attempt: existing.attempt_count, detail: "duplicate delivery — already terminal", ts: now() });
    return existing.status === "poisoned" ? "poisoned" : "skipped";
  }
  const attempt = (existing?.attempt_count ?? 0) + 1;

  // 2. Version compatibility: only v1; anything else is poison.
  if (row.event_version !== SUPPORTED_INVENTORY_EVENT_VERSION) {
    return poison(deps, row, attempt, `unsupported event_version: ${row.event_version}`, log);
  }

  // 3. Classify — invalid payloads of projectable kinds throw → poison.
  let classification: ReturnType<typeof classifyMarketplaceInventoryEvent>;
  try {
    classification = classifyMarketplaceInventoryEvent(row);
  } catch (err) {
    if (err instanceof MarketplacePayloadError) return poison(deps, row, attempt, err.message, log);
    throw err;
  }
  if (classification.kind === "ignored") {
    return finish(deps, row, "ignored", attempt, classification.reason, log, "skipped");
  }

  // 4. Observe — upsert the snapshot, guarded by sequence. Retryable
  //    failures keep the row pending (checkpoint does NOT advance) so the
  //    next poll retries; after maxAttempts → poison.
  const context: MirrorContext = { eventId: row.event_id, occurredAt: row.occurred_at, traceId: row.trace_id };
  try {
    const result = await deps.store.observeInventoryAdjustment(classification.event, context);
    if (result.observation === "skipped_stale") {
      return finish(deps, row, "skipped_stale", attempt, `older sequence ${classification.event.adjustment_sequence} — snapshot not regressed`, log, "skipped");
    }
    // حكمُ التضاربِ يدخلُ سطرَ السجلِّ ولا يدخلُ `BatchOutcome`: ذاكَ نوعٌ
    // **مُشترَكٌ** معَ مرحّلِ الإرسالِ (`relay.ts`)، وتوسيعُهُ بحقلٍ لا معنى لهُ
    // هناكَ إعادةُ هيكلةٍ تمسُّ مساراً لا علاقةَ لهُ بهذهِ المراجعةِ. والسطرُ هوَ
    // ما يُقرأُ في حادثةٍ، والجدولُ هوَ المصدرُ المُعتمَدُ لا عدّادٌ في ذاكرةٍ.
    const verdict = result.conflict.conflict
      ? `conflict ${result.conflict.report.kind} — ${result.conflict.report.affectedOrderCount} order(s), ${result.conflict.report.affectedUnitsTotal} reserved unit(s), changes_order_state=false`
      : `no conflict (${result.conflict.dismissedBecause})`;
    return finish(deps, row, "applied", attempt, `observed sequence ${classification.event.adjustment_sequence} → qty ${classification.event.quantity_after}; ${verdict}`, log, "applied");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (attempt > cfg.maxAttempts) {
      return poison(deps, row, attempt, msg, log);
    }
    await deps.store.markInventoryConsumed(row.event_id, row, "pending", attempt, msg);
    log({ event_id: row.event_id, event_type: row.event_type, status: "pending", attempt, detail: "retryable failure", ts: now() });
    return "pending";
  }
}

async function finish(
  deps: InventoryRelayDeps,
  row: MarketplaceOutboxRow,
  status: InventoryConsumedStatus,
  attempt: number,
  detail: string,
  log: (e: RelayLogEntry) => void,
  outcome: RowOutcome,
): Promise<RowOutcome> {
  await deps.store.markInventoryConsumed(row.event_id, row, status, attempt, null);
  log({ event_id: row.event_id, event_type: row.event_type, status, attempt, detail, ts: now() });
  return outcome;
}

async function poison(
  deps: InventoryRelayDeps,
  row: MarketplaceOutboxRow,
  attempt: number,
  detail: string,
  log: (e: RelayLogEntry) => void,
): Promise<RowOutcome> {
  await deps.store.markInventoryConsumed(row.event_id, row, "poisoned", attempt, detail);
  log({ event_id: row.event_id, event_type: row.event_type, status: "poisoned", attempt, detail, ts: now() });
  return "poisoned";
}

/**
 * Replay: reset the checkpoint so idempotency makes already-applied events
 * no-ops. Safe to call repeatedly.
 */
export async function replayInventoryFrom(deps: InventoryRelayDeps, checkpoint: InventoryRelayCheckpoint | null): Promise<void> {
  await deps.store.writeInventoryCheckpoint(deps.config?.consumerId ?? DEFAULT_INVENTORY_RELAY_CONFIG.consumerId, checkpoint ?? ZERO_INVENTORY_CHECKPOINT);
}

/**
 * Full rebuild: clear observations + consumed ledger + checkpoint, then
 * re-process from zero. delivery_outbox history is NOT cleared — append-only
 * by design; consumers dedupe by event_id.
 */
export async function rebuildInventoryObservations(deps: InventoryRelayDeps): Promise<void> {
  await deps.store.clearInventoryObservations();
  await replayInventoryFrom(deps, null);
}
