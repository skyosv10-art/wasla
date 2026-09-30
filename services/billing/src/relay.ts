/**
 * Billing Relay Consumer (ADR-050 §3 · M5-17P · M5-17Q) — settles the
 * store_variable fee of every DELIVERED store order exactly once.
 *
 *   delivery_outbox store_order.* → relay → snapshot / fee settlement +
 *   draft invoice + billing.fee_settled outbox row + ledger row + checkpoint.
 *
 * Source (owner decision 2026-09-27, M5-17Q): the relay reads `store_order.*`
 * from `delivery_outbox` (read-only). `store_order.created` carries the money
 * snapshot (ADR-026 §2.6) which billing records in its own projection
 * (`billing_store_order_snapshots`); `store_order.item_substituted` adjusts it;
 * `store_order.fulfillment_state_changed → delivered` settles it. No field is
 * added to `services/orders` (ADR-050 Consequence 3).
 *
 * Reliability guarantees (same contract as support/delivery/search relays):
 *  - Idempotency: the consumed-events ledger (consumer_id, event_id) is
 *    written in the SAME transaction as every effect, so duplicate delivery —
 *    even after checkpoint loss — is a no-op (skipped_stale). The snapshot's
 *    settlement link makes settlement once PER ORDER as well.
 *  - Atomicity: snapshot/invoice/settlement/outbox/ledger commit together or
 *    not at all; a retryable failure stops the batch without advancing the
 *    checkpoint.
 *  - Ordering: per-stream watermark (occurred_at, event_id); the producer
 *    writes `store_order.created` before any later transition of the order.
 *  - Foreign events: `delivery_task` aggregates are `ignored_foreign`.
 *  - Poison: invalid payloads, unknown versions, a delivered order with no
 *    recorded snapshot → dead-lettered in the ledger with the reason.
 *  - Settlement semantics: a draft invoice + settled fee; the billing admin
 *    decides whether to issue, void, or close it (ADR-050 §3).
 *
 * Referenced: ADR-050 §3 · ADR-025 §2.3 (relay pattern) · ADR-026 §2.4/§2.6
 */

import {
  classifyDeliveryEvent,
  isBefore,
  isTerminal,
  ZERO_CHECKPOINT,
  type Classification,
  type ConsumedStatus,
  type DeliveryOutboxRow,
  type RelayCheckpoint,
} from "./domain/consumed-events.js";
import type { RelayDeps, RelayTxPorts } from "./ports.js";
import { createInvoice } from "./domain/model.js";

export const SUPPORTED_EVENT_VERSION = "v1";

/** The fee rate for store_variable fees (basis points: 250 = 2.5%). */
export const STORE_VARIABLE_FEE_BPS = 250;

/**
 * The store_variable fee of one delivered order. The base is the order's
 * ITEMS total (the store's sale, after substitutions) — the delivery fee is
 * not the store's revenue and is not charged a store fee (M5-17Q).
 */
export function storeVariableFee(itemsTotalMinorUnits: number): number {
  return Math.max(1, Math.floor((itemsTotalMinorUnits * STORE_VARIABLE_FEE_BPS) / 10000));
}

export interface RelayConfig {
  readonly consumerId: string;
  readonly batchSize: number;
  readonly maxAttempts: number;
}

export const DEFAULT_RELAY_CONFIG: RelayConfig = {
  consumerId: "billing-delivery-relay-v1",
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
  /** Snapshot events recorded (store_order.created / item_substituted). */
  readonly recorded: number;
  readonly ignored: number;
  readonly poisoned: number;
  readonly skipped_stale: number;
  /** 1 when the batch stopped on a retryable failure (rolled back, retried next batch). */
  readonly pending: number;
  readonly checkpoint: RelayCheckpoint;
}

/**
 * Process one batch of delivery outbox events. Called by the tick scheduler
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
  let recorded = 0;
  let ignored = 0;
  let poisoned = 0;
  let skippedStale = 0;
  let pending = 0;
  let lastTerminal: RelayCheckpoint = currentCheckpoint;

  for (const row of rows) {
    const result = await processEvent(deps, cfg, row, currentCheckpoint);
    processed++;

    if (result.status === "settled") settled++;
    else if (result.status === "recorded") recorded++;
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
      last_commit_sequence: row.commit_sequence,
      last_occurred_at: row.occurred_at,
      last_event_id: row.event_id,
    };
    // Monotonic: an older (stale) row never moves the checkpoint backwards.
    if (isBefore(lastTerminal, position)) {
      lastTerminal = position;
    }
  }

  if (lastTerminal.last_commit_sequence !== currentCheckpoint.last_commit_sequence) {
    await deps.checkpoint.writeCheckpoint(cfg.consumerId, lastTerminal);
  }

  return {
    processed,
    settled,
    recorded,
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
  row: DeliveryOutboxRow,
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

function pendingResult(row: DeliveryOutboxRow, err: unknown): ConsumedEventResult {
  return {
    event_id: row.event_id,
    status: "pending",
    reason: err instanceof Error ? err.message : "unknown error",
  };
}

async function processEvent(
  deps: RelayDeps,
  cfg: RelayConfig,
  row: DeliveryOutboxRow,
  checkpoint: RelayCheckpoint,
): Promise<ConsumedEventResult> {
  // Stale check — at or before the checkpoint is already consumed.
  const rowCheckpoint: RelayCheckpoint = {
    last_commit_sequence: row.commit_sequence,
    last_occurred_at: row.occurred_at,
    last_event_id: row.event_id,
  };
  if (!isBefore(checkpoint, rowCheckpoint)) {
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
  let classification: Classification;
  try {
    classification = classifyDeliveryEvent(row);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown classification error";
    return recordTerminal(deps, cfg, row, "poisoned", reason);
  }

  if (classification.kind === "ignored" || classification.kind === "ignored_foreign") {
    return recordTerminal(deps, cfg, row, classification.kind, classification.reason);
  }

  try {
    return await deps.transaction.run((tx) => applyInTransaction(deps, cfg, row, classification, tx));
  } catch (err) {
    if (err instanceof AlreadyConsumed) {
      return { event_id: row.event_id, status: "skipped_stale", reason: "already consumed (ledger)" };
    }
    return pendingResult(row, err);
  }
}

type EffectClassification = Exclude<Classification, { kind: "ignored" } | { kind: "ignored_foreign" }>;

/**
 * Every effect of one event plus its ledger row — inside ONE transaction.
 * Data gaps (missing/duplicate snapshot, negative total) are terminal
 * outcomes recorded in the ledger, never a retry loop.
 */
async function applyInTransaction(
  deps: RelayDeps,
  cfg: RelayConfig,
  row: DeliveryOutboxRow,
  classification: EffectClassification,
  tx: RelayTxPorts,
): Promise<ConsumedEventResult> {
  const terminal = async (
    status: "recorded" | "ignored" | "poisoned",
    reason: string,
  ): Promise<ConsumedEventResult> => {
    const fresh = await tx.ledger.record({ consumerId: cfg.consumerId, eventId: row.event_id, status, reason });
    if (!fresh) throw new AlreadyConsumed();
    return { event_id: row.event_id, status, reason };
  };

  if (classification.kind === "snapshot") {
    const inserted = await tx.snapshots.insert(classification.snapshot, row.event_id);
    if (!inserted) return terminal("poisoned", `duplicate store_order.created for order ${classification.snapshot.order_id}`);
    return terminal("recorded", `snapshot recorded for ${classification.snapshot.order_public_id}`);
  }

  const snapshot = await tx.snapshots.find(classification.order_id);

  if (classification.kind === "adjust") {
    if (!snapshot) return terminal("poisoned", `no store_order.created snapshot for order ${classification.order_id}`);
    if (snapshot.settlement_id) return terminal("poisoned", `substitution after settlement for order ${classification.order_id}`);
    const next = snapshot.items_total_minor_units + classification.price_delta_minor_units;
    if (next < 0) return terminal("poisoned", `substitution makes items total negative for order ${classification.order_id}`);
    await tx.snapshots.setItemsTotal(classification.order_id, next);
    return terminal("recorded", `items total adjusted by ${classification.price_delta_minor_units}`);
  }

  // settle — the order is delivered.
  if (!snapshot) return terminal("poisoned", `no store_order.created snapshot for order ${classification.order_id}`);
  if (snapshot.settlement_id) return terminal("ignored", `order already settled (${snapshot.settlement_id})`);
  if (snapshot.items_total_minor_units === 0) return terminal("ignored", "zero items total — no store fee");

  const now = deps.clock.now();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const feeAmount = storeVariableFee(snapshot.items_total_minor_units);

  const invoiceId = deps.idGen.newInvoiceId();
  const invoice = createInvoice({
    id: invoiceId,
    // The store reference billing stores is the marketplace store UUID carried
    // by the delivery event — the only stable store identity on it (M5-17Q).
    store_public_id: snapshot.store_id,
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

  await tx.snapshots.markSettled(classification.order_id, settlement.settlement_id);

  const fresh = await tx.ledger.record({
    consumerId: cfg.consumerId,
    eventId: row.event_id,
    status: "settled",
    settlementId: settlement.settlement_id,
  });
  if (!fresh) throw new AlreadyConsumed();

  return {
    event_id: row.event_id,
    status: "settled",
    settlement_id: settlement.settlement_id,
    invoice_id: invoiceId,
  };
}
