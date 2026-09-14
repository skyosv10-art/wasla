/**
 * Dispatch Relay Consumer (ADR-026 §2.4) — orchestrates the coarse mirror:
 *   dispatch_outbox event → relay → delivery_task state + delivery.* event.
 *
 * Reliability guarantees (same contract as the search relay, ADR-025 §2.3):
 *  - Idempotency: a consumed `event_id` with a terminal status is never
 *    re-processed. Duplicate delivery is a no-op.
 *  - Ordering: per-task watermark (occurred_at, event_id) — an older
 *    redelivered event is `skipped_stale` and cannot regress the mirror.
 *    Terminal-consumed events of EVERY kind (applied or ignored) advance the
 *    bound task's watermark; a terminal task state refuses every further
 *    dispatch event.
 *  - Foreign jobs: events whose job is not bound to any delivery task are
 *    terminally `ignored_foreign` — dispatch serves the whole platform, and
 *    most of its events are transport orders' business, not ours.
 *  - Retry + failure: a retryable failure leaves the row `pending` (the
 *    checkpoint does NOT advance) so the next poll retries. After
 *    `maxAttempts` the row is `poisoned` and the checkpoint advances past
 *    it — a poison event never blocks the stream.
 *  - Poison: unknown event versions, invalid payloads (bad routing key or
 *    DispatchPayloadError), and UNMAPPABLE OUTCOMES (a bound dispatch
 *    result with no legal edge from the current task state) are
 *    dead-lettered — a wrong mirror must never advance quietly.
 *  - Checkpoint: (occurred_at, event_id) of the last terminally-consumed
 *    row. Delivery-owned; the relay never writes `dispatch_outbox`.
 *  - Replay: `replayFrom(null)` resets the checkpoint — idempotency makes
 *    already-applied events no-ops; `rebuildAll()` additionally clears the
 *    mirror state and re-reads from zero.
 *  - Version compatibility: only `event_version === "v1"` is consumed.
 *  - Observability: every event emits a structured log line.
 *
 * Payload validation scope: the routing key `job_id` is validated for EVERY
 * event (routing is meaningless without it); full payload validation applies
 * to projectable kinds — dispatch-internal ignored kinds carry no mirror
 * effect to validate.
 */

import {
  classifyDispatchEvent,
  DispatchPayloadError,
  isTerminal,
  ZERO_CHECKPOINT,
  type ConsumedStatus,
  type DispatchOutboxRow,
  type RelayCheckpoint,
} from "./domain/consumed-events.js";
import { projectDispatchEvent } from "./domain/dispatch-mirror.js";
import { isDeliveryTaskTerminal } from "./domain/state-machine.js";
import type { DeliveryTaskState } from "@wasla/contracts-delivery";
import type {
  DispatchEventSource,
  MirrorContext,
  RelayConsumerLock,
  TaskMirrorStore,
} from "./ports.js";

export const SUPPORTED_EVENT_VERSION = "v1";

export interface RelayConfig {
  readonly consumerId: string;
  readonly batchSize: number;
  readonly maxAttempts: number;
}

export const DEFAULT_RELAY_CONFIG: RelayConfig = {
  consumerId: "delivery-dispatch-relay-v1",
  batchSize: 100,
  maxAttempts: 5,
};

export interface RelayDeps {
  readonly events: DispatchEventSource;
  readonly store: TaskMirrorStore;
  /**
   * إلزاميٌّ لا اختياريٌّ (M5-13R · §4.24-ب): دفعةٌ بلا قفلِ مُستهلِكٍ تستطيعُ أن
   * تكتبَ نقطتَها فوقَ إرجاعِ إعادةٍ التزمَ للتوّ — فيُبطِلَ عملًا وقعَ فعلاً.
   * والحقلُ هنا إلزاميٌّ فنسيانُهُ خطأُ ترجمةٍ (التعليلُ الكاملُ في `ports.ts`).
   */
  readonly lock: RelayConsumerLock;
  readonly config?: Partial<RelayConfig>;
  readonly log?: (entry: RelayLogEntry) => void;
}

export interface RelayLogEntry {
  readonly event_id: string;
  readonly event_type: string;
  readonly status: ConsumedStatus;
  readonly attempt: number;
  readonly detail?: string;
  readonly ts: string;
}

export interface BatchOutcome {
  readonly processed: number;
  readonly applied: number;
  readonly skipped: number; // stale + ignored + foreign
  readonly poisoned: number;
  readonly advancedTo: RelayCheckpoint | null;
}

function now(): string {
  return new Date().toISOString();
}

/** Lexicographic (occurred_at, event_id) comparison — the stream's order. */
function isAfter(a: RelayCheckpoint, b: RelayCheckpoint | null): boolean {
  if (!b) return true;
  if (a.last_occurred_at !== b.last_occurred_at) return a.last_occurred_at > b.last_occurred_at;
  return a.last_event_id > b.last_event_id;
}

/** Routing key of any dispatch event — validated for every kind. */
function extractJobId(row: DispatchOutboxRow): string {
  const v = row.data.job_id;
  if (typeof v !== "string" || v.length === 0) {
    throw new DispatchPayloadError("payload.job_id must be a non-empty string (routing key)");
  }
  return v;
}

/**
 * Process one batch of dispatch outbox events. Returns the outcome and the
 * new checkpoint. Idempotent: re-running with the same events is a no-op for
 * already-terminal rows.
 *
 * **الدفعةُ كلُّها داخلَ قفلِ المُستهلِكِ** (M5-13R · §4.24-ب): من قراءةِ نقطةِ
 * التقدُّمِ حتى آخرِ كتابةٍ فوقَها — فلا تلتقي معاملةُ إعادةٍ مع دفعةٍ في منتصفِها،
 * ولو التقيا لَكتبَتِ الدفعةُ نقطتَها فوقَ إرجاعٍ التزمَ للتوّ. والحيازةُ نطاقُها
 * نطاقُ `withConsumerLock` فلا يُنسى إطلاقُها في نداءٍ بعيدٍ.
 */
export async function runRelayBatch(deps: RelayDeps): Promise<BatchOutcome> {
  const cfg = { ...DEFAULT_RELAY_CONFIG, ...deps.config };
  return deps.lock.withConsumerLock(cfg.consumerId, () => runRelayBatchLocked(deps, cfg));
}

async function runRelayBatchLocked(
  deps: RelayDeps,
  cfg: RelayConfig,
): Promise<BatchOutcome> {
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
      advancedTo = { last_occurred_at: row.occurred_at, last_event_id: row.event_id };
      await deps.store.writeCheckpoint(cfg.consumerId, advancedTo);
    }
  }

  return { processed: rows.length, applied, skipped, poisoned, advancedTo };
}

type RowOutcome = "applied" | "skipped" | "poisoned" | "pending";

async function processRow(
  deps: RelayDeps,
  cfg: RelayConfig,
  row: DispatchOutboxRow,
  log: (e: RelayLogEntry) => void,
): Promise<RowOutcome> {
  // 1. Idempotency: a terminally-consumed event is a no-op.
  const existing = await deps.store.getConsumed(row.event_id);
  if (existing && isTerminal(existing.status)) {
    log({ event_id: row.event_id, event_type: row.event_type, status: existing.status, attempt: existing.attempt_count, detail: "duplicate delivery — already terminal", ts: now() });
    return existing.status === "poisoned" ? "poisoned" : "skipped";
  }
  const attempt = (existing?.attempt_count ?? 0) + 1;

  // 2. Version compatibility: only v1; anything else is poison.
  if (row.event_version !== SUPPORTED_EVENT_VERSION) {
    return poison(deps, row, attempt, `unsupported event_version: ${row.event_version}`, log);
  }

  // 3. Routing key — validated for EVERY kind (see module doc).
  let jobId: string;
  try {
    jobId = extractJobId(row);
  } catch (err) {
    if (err instanceof DispatchPayloadError) return poison(deps, row, attempt, err.message, log);
    throw err;
  }

  // 4. Route by JOB BINDING — the only legal join (ORD-/WS- mismatch, §2.4).
  const bound = await deps.store.getTaskByJobRef(jobId);
  if (bound.length === 0) {
    return finish(deps, row, "ignored_foreign", attempt, `job ${jobId} is not bound to any delivery task`, log, "skipped");
  }
  // A dispatch job maps to at most one delivery task (one delegation per
  // order in this phase — delivery_tasks.order_id UNIQUE).
  const task = bound[0];

  // 5. Terminal task: the mirror never regresses out of a terminal state.
  if (isDeliveryTaskTerminal(task.state as DeliveryTaskState)) {
    return finish(deps, row, "skipped_stale", attempt, `task ${task.taskId} is terminal (${task.state}) — no regression`, log, "skipped");
  }

  // 6. Per-task watermark: an older redelivered event cannot regress state —
  //    checked for every bound event, ignored kinds included.
  const watermark: RelayCheckpoint = { last_occurred_at: row.occurred_at, last_event_id: row.event_id };
  if (!isAfter(watermark, task.lastDispatchEvent)) {
    return finish(deps, row, "skipped_stale", attempt, "older than the task's dispatch watermark — no regression", log, "skipped");
  }

  // 7. Classify — invalid payloads of projectable kinds throw → poison.
  let classification: ReturnType<typeof classifyDispatchEvent>;
  try {
    classification = classifyDispatchEvent(row);
  } catch (err) {
    if (err instanceof DispatchPayloadError) return poison(deps, row, attempt, err.message, log);
    throw err;
  }
  if (classification.kind === "ignored") {
    // Terminal no-op for a bound task: the watermark advances so a LATER
    // redelivered outcome can still be caught as stale (guarantee: ordering).
    await deps.store.recordConsumedNoOp(task.taskId, { eventId: row.event_id, occurredAt: row.occurred_at, traceId: row.trace_id });
    return finish(deps, row, "ignored", attempt, classification.reason, log, "skipped");
  }

  // 8. Project + apply. Retryable failures keep the row pending (checkpoint
  //    does NOT advance) so the next poll retries; after maxAttempts → poison.
  const context: MirrorContext = { eventId: row.event_id, occurredAt: row.occurred_at, traceId: row.trace_id };
  try {
    const decision = projectDispatchEvent({ state: task.state as DeliveryTaskState }, classification.event);
    if (decision.kind === "ignored") {
      await deps.store.recordConsumedNoOp(task.taskId, context);
      return finish(deps, row, "ignored", attempt, decision.reason, log, "skipped");
    }
    if (decision.kind === "unmappable") {
      return poison(deps, row, attempt, decision.reason, log);
    }
    await deps.store.applyMirrorTransition(task.taskId, decision, context);
    return finish(deps, row, "applied", attempt, `${task.state} → ${decision.to}`, log, "applied");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (attempt > cfg.maxAttempts) {
      return poison(deps, row, attempt, msg, log);
    }
    await deps.store.markConsumed(row.event_id, row, "pending", attempt, msg);
    log({ event_id: row.event_id, event_type: row.event_type, status: "pending", attempt, detail: "retryable failure", ts: now() });
    return "pending";
  }
}

async function finish(
  deps: RelayDeps,
  row: DispatchOutboxRow,
  status: ConsumedStatus,
  attempt: number,
  detail: string,
  log: (e: RelayLogEntry) => void,
  outcome: RowOutcome,
): Promise<RowOutcome> {
  await deps.store.markConsumed(row.event_id, row, status, attempt, null);
  log({ event_id: row.event_id, event_type: row.event_type, status, attempt, detail, ts: now() });
  return outcome;
}

async function poison(
  deps: RelayDeps,
  row: DispatchOutboxRow,
  attempt: number,
  detail: string,
  log: (e: RelayLogEntry) => void,
): Promise<RowOutcome> {
  await deps.store.markConsumed(row.event_id, row, "poisoned", attempt, detail);
  log({ event_id: row.event_id, event_type: row.event_type, status: "poisoned", attempt, detail, ts: now() });
  return "poisoned";
}

/**
 * Replay: reset the checkpoint so idempotency makes already-applied events
 * no-ops. Safe to call repeatedly.
 *
 * **تحتَ قفلِ المُستهلِكِ** — وإلّا كانتْ إعادةُ ترتيبٍ تُبطِلُها دفعةٌ جاريةٌ بنفسِ
 * السباقِ الذي يُبطِلُ إعادةَ السمِّ (§4.24-ب): نفسُ الجُرحِ لا يُرقَّعُ في موضعٍ
 * ويُترَكُ مفتوحاً في الآخرِ.
 */
export async function replayFrom(deps: RelayDeps, checkpoint: RelayCheckpoint | null): Promise<void> {
  const consumerId = deps.config?.consumerId ?? DEFAULT_RELAY_CONFIG.consumerId;
  await deps.lock.withConsumerLock(consumerId, () =>
    deps.store.writeCheckpoint(consumerId, checkpoint ?? ZERO_CHECKPOINT),
  );
}

/**
 * Full rebuild: clear mirror state + consumed ledger + checkpoint, then
 * re-process from zero. delivery_outbox history is NOT cleared — append-only
 * by design; consumers dedupe by event_id.
 */
export async function rebuildAll(deps: RelayDeps): Promise<void> {
  await deps.store.clearMirrorState();
  await replayFrom(deps, null);
}
