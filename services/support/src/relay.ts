/**
 * Order Relay Consumer (ADR-049 §6) — suggests support tickets on terminal
 * order states.
 *
 *   order_outbox event → relay → support ticket (suggestion) + checkpoint.
 *
 * The relay is a pure orchestrator: it reads events from `order_outbox`
 * (via OrderEventSource), classifies them, creates suggested tickets
 * (via SupportTicketStore), publishes ticket_opened events (via
 * SupportEventPublisher), and writes the checkpoint (via
 * RelayCheckpointStore). All I/O is through ports.
 *
 * Reliability guarantees (same contract as delivery/search relays):
 *  - Idempotency: a consumed `event_id` with a terminal status is never
 *    re-processed. Duplicate delivery is a no-op (skipped_stale).
 *  - Ordering: per-stream watermark (occurred_at, event_id) — an older
 *    redelivered event is `skipped_stale` and cannot regress.
 *  - Foreign events: non-`order.status_changed` events are `ignored_foreign`.
 *  - Non-trigger states: terminal order states not in
 *    SUGGESTION_TRIGGER_STATES are `ignored`.
 *  - Poison: invalid payloads, unknown versions → dead-lettered.
 *  - Checkpoint: (occurred_at, event_id) of the last terminally-consumed
 *    row. Support-owned; the relay never writes `order_outbox`.
 *  - Version: only `event_version === "v1"` is consumed.
 *  - Suggestion semantics: the relay creates a ticket with type
 *    `order_issue` and state `open`. The support agent decides whether to
 *    investigate, escalate, or close it (ADR-049 §6: "لا إجبار — اقتراحٌ").
 *
 * Referenced: ADR-049 §6 · ADR-025 §2.3 (relay pattern) · ADR-026 §2.4
 */

import {
  classifyOrderEvent,
  isBefore,
  isTerminal,
  ZERO_CHECKPOINT,
  type ConsumedStatus,
  type OrderOutboxRow,
  type RelayCheckpoint,
} from "./domain/consumed-events.js";
import type { RelayDeps } from "./ports.js";
import type { SupportTicketDraft } from "./domain/model.js";

export const SUPPORTED_EVENT_VERSION = "v1";

export interface RelayConfig {
  readonly consumerId: string;
  readonly batchSize: number;
  readonly maxAttempts: number;
}

export const DEFAULT_RELAY_CONFIG: RelayConfig = {
  consumerId: "support-order-relay-v1",
  batchSize: 100,
  maxAttempts: 5,
};

/** Result of processing a single event. */
export interface ConsumedEventResult {
  readonly event_id: string;
  readonly status: ConsumedStatus;
  readonly reason?: string;
  readonly ticket_id?: string;
}

/** Result of a relay batch. */
export interface RelayBatchResult {
  readonly processed: number;
  readonly suggested: number;
  readonly ignored: number;
  readonly poisoned: number;
  readonly skipped_stale: number;
  readonly checkpoint: RelayCheckpoint;
}

/**
 * Process one batch of order outbox events. Called by the tick scheduler
 * or a manual trigger. The lock prevents concurrent batches for the same
 * consumer.
 *
 * Returns the batch result with updated checkpoint.
 */
export async function runRelayBatch(
  deps: RelayDeps,
  config: Partial<RelayConfig> = {},
): Promise<RelayBatchResult> {
  const cfg: RelayConfig = { ...DEFAULT_RELAY_CONFIG, ...config };

  return deps.lock.withConsumerLock(cfg.consumerId, async () => {
    return runRelayBatchLocked(deps, cfg);
  });
}

async function runRelayBatchLocked(
  deps: RelayDeps,
  cfg: RelayConfig,
): Promise<RelayBatchResult> {
  const currentCheckpoint =
    (await deps.checkpoint.getCheckpoint(cfg.consumerId)) ?? ZERO_CHECKPOINT;

  const rows = await deps.events.readAfter(currentCheckpoint, cfg.batchSize);

  let suggested = 0;
  let ignored = 0;
  let poisoned = 0;
  let skippedStale = 0;
  let lastTerminal: RelayCheckpoint = currentCheckpoint;

  for (const row of rows) {
    const result = await processEvent(deps, cfg, row, lastTerminal);

    if (result.status === "suggested") suggested++;
    else if (result.status === "ignored" || result.status === "ignored_foreign") ignored++;
    else if (result.status === "poisoned") poisoned++;
    else if (result.status === "skipped_stale") skippedStale++;

    if (isTerminal(result.status)) {
      lastTerminal = {
        last_occurred_at: row.occurred_at,
        last_event_id: row.event_id,
      };
    }
  }

  if (rows.length > 0) {
    await deps.checkpoint.writeCheckpoint(cfg.consumerId, lastTerminal);
  }

  return {
    processed: rows.length,
    suggested,
    ignored,
    poisoned,
    skipped_stale: skippedStale,
    checkpoint: lastTerminal,
  };
}

async function processEvent(
  deps: RelayDeps,
  cfg: RelayConfig,
  row: OrderOutboxRow,
  checkpoint: RelayCheckpoint,
): Promise<ConsumedEventResult> {
  // Version check — unknown versions are poisoned.
  if (row.event_version !== SUPPORTED_EVENT_VERSION) {
    await deps.deadLetter.writeDeadLetter(
      cfg.consumerId,
      row,
      `unsupported event_version: ${row.event_version} (expected ${SUPPORTED_EVENT_VERSION})`,
      1,
    );
    return { event_id: row.event_id, status: "poisoned", reason: "unsupported version" };
  }

  // Stale check — an older redelivered event is skipped.
  const rowCheckpoint: RelayCheckpoint = {
    last_occurred_at: row.occurred_at,
    last_event_id: row.event_id,
  };
  if (isBefore(rowCheckpoint, checkpoint) || (
    rowCheckpoint.last_occurred_at === checkpoint.last_occurred_at &&
    rowCheckpoint.last_event_id === checkpoint.last_event_id
  )) {
    return { event_id: row.event_id, status: "skipped_stale", reason: "already consumed" };
  }

  // Classify — validates payload and determines action.
  let classification;
  try {
    classification = classifyOrderEvent(row);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown classification error";
    await deps.deadLetter.writeDeadLetter(cfg.consumerId, row, reason, 1);
    return { event_id: row.event_id, status: "poisoned", reason };
  }

  if (classification.kind === "ignored") {
    return {
      event_id: row.event_id,
      status: classification.reason.includes("foreign") ? "ignored_foreign" : "ignored",
      reason: classification.reason,
    };
  }

  // Suggest — create a support ticket for the terminal order state.
  const event = classification.event;
  const draft: SupportTicketDraft = {
    ticket_type: "order_issue",
    reporter_public_id: event.customer_public_id,
    subject_public_id: null,
    order_public_id: event.order_public_id,
  };

  const ticket = await deps.tickets.createTicket(draft);

  // Publish ticket_opened event.
  await deps.publisher.publishTicketOpened(
    ticket.ticket_id,
    ticket.ticket_type,
    ticket.reporter_public_id,
  );

  return {
    event_id: row.event_id,
    status: "suggested",
    ticket_id: ticket.ticket_id,
  };
}
