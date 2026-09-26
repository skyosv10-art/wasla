/**
 * Order Relay Consumer (ADR-050 §3) — settles fees on completed orders.
 *
 *   order_outbox event → relay → fee settlement + draft invoice + checkpoint.
 *
 * The relay is a pure orchestrator: it reads events from `order_outbox`
 * (via OrderEventSource), classifies them, creates fee settlements
 * (via SettlementPort), creates draft invoices (via InvoiceStore), publishes
 * billing events (via BillingEventPublisher), and writes the checkpoint
 * (via RelayCheckpointStore). All I/O is through ports.
 *
 * Reliability guarantees (same contract as support/delivery/search relays):
 *  - Idempotency: a consumed `event_id` with a terminal status is never
 *    re-processed. Duplicate delivery is a no-op (skipped_stale).
 *  - Ordering: per-stream watermark (occurred_at, event_id) — an older
 *    redelivered event is `skipped_stale` and cannot regress.
 *  - Foreign events: non-`order.status_changed` events are `ignored_foreign`.
 *  - Non-trigger states: order transitions to non-terminal or non-completed
 *    states are `ignored`.
 *  - Poison: invalid payloads, unknown versions → dead-lettered.
 *  - Checkpoint: (occurred_at, event_id) of the last terminally-consumed
 *    row. Billing-owned; the relay never writes `order_outbox`.
 *  - Version: only `event_version === "v1"` is consumed.
 *  - Settlement semantics: the relay creates a fee settlement for the
 *    completed order and a draft invoice. The billing admin decides
 *    whether to issue, void, or close it (ADR-050 §3).
 *
 * Referenced: ADR-050 §3 · ADR-025 §2.3 (relay pattern) · ADR-026 §2.4
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
import { createInvoice } from "./domain/model.js";

export const SUPPORTED_EVENT_VERSION = "v1";

/** The fee rate for store_variable fees (basis points: 250 = 2.5%). */
export const STORE_VARIABLE_FEE_BPS = 250;

export interface RelayConfig {
  readonly consumerId: string;
  readonly batchSize: number;
  readonly maxAttempts: number;
}

export const DEFAULT_RELAY_CONFIG: RelayConfig = {
  consumerId: "billing-order-relay-v1",
  batchSize: 100,
  maxAttempts: 5,
};

/** Result of processing a single event. */
export interface ConsumedEventResult {
  readonly event_id: string;
  readonly status: ConsumedStatus;
  readonly reason?: string;
  readonly settlement_id?: string;
  readonly invoice_id?: string;
}

/** Result of a relay batch. */
export interface RelayBatchResult {
  readonly processed: number;
  readonly settled: number;
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
 * Returns a summary of the batch: how many events were processed, how many
 * resulted in fee settlement, how many were ignored, poisoned, or stale.
 */
export async function runRelayBatch(
  deps: RelayDeps,
  cfg: RelayConfig,
): Promise<RelayBatchResult> {
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

  let settled = 0;
  let ignored = 0;
  let poisoned = 0;
  let skippedStale = 0;
  let lastTerminal: RelayCheckpoint = currentCheckpoint;

  for (const row of rows) {
    const result = await processEvent(deps, cfg, row, lastTerminal);

    if (result.status === "settled") settled++;
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
    settled,
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

  // Settle — create fee settlement + draft invoice for the completed order.
  const event = classification.event;
  const now = deps.clock.now();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Calculate fee: store_variable = order_total * fee_bps / 10000
  const feeAmount = Math.max(1, Math.floor(event.order_total_cents * STORE_VARIABLE_FEE_BPS / 10000));

  // Create draft invoice first (the settlement references it)
  const invoiceId = deps.idGen.newInvoiceId();
  const invoice = createInvoice({
    id: invoiceId,
    store_public_id: event.store_public_id,
    period,
    fee_type: "store_variable",
    amount_cents: feeAmount,
    now,
  });
  await deps.invoices.save(invoice);

  // Create settlement
  const settlement = await deps.settlements.settle({
    invoice_id: invoiceId,
    fee_type: "store_variable",
    amount_cents: feeAmount,
    period,
  });

  // Publish fee_settled event
  await deps.publisher.publishFeeSettled({
    settlement_id: settlement.settlement_id,
    fee_type: "store_variable",
    period,
  });

  return {
    event_id: row.event_id,
    status: "settled",
    settlement_id: settlement.settlement_id,
    invoice_id: invoiceId,
  };
}
