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
 *    re-processed. The consumed-events ledger (keyed by consumer_id, event_id)
 *    is written in the SAME transaction as the settlement, so duplicate
 *    delivery — even after checkpoint loss — is a no-op (skipped_stale).
 *  - Atomicity (M5-17P): invoice + settlement + outbox row + ledger row
 *    commit together or not at all; a retryable failure stops the batch
 *    without advancing the checkpoint.
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
  /** 1 when the batch stopped on a retryable failure (rolled back, retried next batch). */
  readonly pending: number;
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

  let processed = 0;
  let settled = 0;
  let ignored = 0;
  let poisoned = 0;
  let skippedStale = 0;
  let pending = 0;
  let lastTerminal: RelayCheckpoint = currentCheckpoint;

  for (const row of rows) {
    const result = await processEvent(deps, cfg, row, currentCheckpoint);
    processed++;

    if (result.status === "settled") settled++;
    else if (result.status === "ignored" || result.status === "ignored_foreign") ignored++;
    else if (result.status === "poisoned") poisoned++;
    else if (result.status === "skipped_stale") skippedStale++;

    if (!isTerminal(result.status)) {
      // Retryable failure: the transaction rolled back, no ledger row exists.
      // Stop here so the checkpoint never passes an unconsumed event.
      pending++;
      break;
    }

    const position: RelayCheckpoint = {
      last_occurred_at: row.occurred_at,
      last_event_id: row.event_id,
    };
    // Monotonic: an older (stale) row never moves the checkpoint backwards.
    if (isBefore(lastTerminal, position)) {
      lastTerminal = position;
    }
  }

  if (
    lastTerminal.last_occurred_at !== currentCheckpoint.last_occurred_at ||
    lastTerminal.last_event_id !== currentCheckpoint.last_event_id
  ) {
    await deps.checkpoint.writeCheckpoint(cfg.consumerId, lastTerminal);
  }

  return {
    processed,
    settled,
    ignored,
    poisoned,
    skipped_stale: skippedStale,
    pending,
    checkpoint: lastTerminal,
  };
}

/** Thrown inside a transaction when the ledger row already exists — rolls back. */
class AlreadyConsumed extends Error {
  constructor() {
    super("event already recorded in the consumed-events ledger");
  }
}

async function recordTerminal(
  deps: RelayDeps,
  cfg: RelayConfig,
  row: OrderOutboxRow,
  status: "ignored" | "ignored_foreign" | "poisoned",
  reason: string,
): Promise<ConsumedEventResult> {
  try {
    await deps.transaction.run(async (tx) => {
      const fresh = await tx.ledger.record({
        consumerId: cfg.consumerId,
        eventId: row.event_id,
        status,
        reason,
      });
      if (!fresh) throw new AlreadyConsumed();
    });
  } catch (err) {
    if (err instanceof AlreadyConsumed) {
      return { event_id: row.event_id, status: "skipped_stale", reason: "already consumed (ledger)" };
    }
    return pendingResult(row, err);
  }
  return { event_id: row.event_id, status, reason };
}

function pendingResult(row: OrderOutboxRow, err: unknown): ConsumedEventResult {
  return {
    event_id: row.event_id,
    status: "pending",
    reason: err instanceof Error ? err.message : "unknown error",
  };
}

async function processEvent(
  deps: RelayDeps,
  cfg: RelayConfig,
  row: OrderOutboxRow,
  checkpoint: RelayCheckpoint,
): Promise<ConsumedEventResult> {
  // Stale check — at or before the checkpoint is already consumed.
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

  // Ledger check — survives checkpoint loss (the idempotency guarantee).
  try {
    if (await deps.ledger.has(cfg.consumerId, row.event_id)) {
      return { event_id: row.event_id, status: "skipped_stale", reason: "already consumed (ledger)" };
    }
  } catch (err) {
    return pendingResult(row, err);
  }

  // Version check — unknown versions are poisoned.
  if (row.event_version !== SUPPORTED_EVENT_VERSION) {
    return recordTerminal(
      deps,
      cfg,
      row,
      "poisoned",
      `unsupported event_version: ${row.event_version} (expected ${SUPPORTED_EVENT_VERSION})`,
    );
  }

  // Classify — validates payload and determines action.
  let classification;
  try {
    classification = classifyOrderEvent(row);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown classification error";
    return recordTerminal(deps, cfg, row, "poisoned", reason);
  }

  if (classification.kind === "ignored") {
    const status = classification.reason.includes("foreign") ? "ignored_foreign" : "ignored";
    return recordTerminal(deps, cfg, row, status, classification.reason);
  }

  // Settle — invoice + settlement + fee_settled outbox row + ledger row,
  // all in ONE transaction: either the order is billed exactly once or not at all.
  const event = classification.event;
  const now = deps.clock.now();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  // Calculate fee: store_variable = order_total * fee_bps / 10000
  const feeAmount = Math.max(1, Math.floor(event.order_total_cents * STORE_VARIABLE_FEE_BPS / 10000));

  try {
    return await deps.transaction.run(async (tx) => {
      const invoiceId = deps.idGen.newInvoiceId();
      const invoice = createInvoice({
        id: invoiceId,
        store_public_id: event.store_public_id,
        period,
        fee_type: "store_variable",
        amount_cents: feeAmount,
        now,
      });
      await tx.invoices.save(invoice);

      const settlement = await tx.settlements.settle({
        invoice_id: invoiceId,
        fee_type: "store_variable",
        amount_cents: feeAmount,
        period,
      });

      await tx.publisher.publishFeeSettled({
        settlement_id: settlement.settlement_id,
        fee_type: "store_variable",
        period,
      });

      const fresh = await tx.ledger.record({
        consumerId: cfg.consumerId,
        eventId: row.event_id,
        status: "settled",
        settlementId: settlement.settlement_id,
      });
      if (!fresh) throw new AlreadyConsumed();

      return {
        event_id: row.event_id,
        status: "settled" as const,
        settlement_id: settlement.settlement_id,
        invoice_id: invoiceId,
      };
    });
  } catch (err) {
    if (err instanceof AlreadyConsumed) {
      return { event_id: row.event_id, status: "skipped_stale", reason: "already consumed (ledger)" };
    }
    return pendingResult(row, err);
  }
}
