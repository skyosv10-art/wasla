/**
 * services/billing/src/ports.ts
 *
 * Port interfaces for the billing service (ADR-050).
 * Implementation lands in later reviews (3/N → N/N).
 */

import type { BillingFeeType, BillingSettlementState } from "@wasla/contracts-billing";
import type { Invoice } from "./domain/model.js";
import type { OrderOutboxRow, RelayCheckpoint } from "./domain/consumed-events.js";

// ── Invoice Store ────────────────────────────────────────────────────────────

export interface InvoiceStore {
  save(invoice: Invoice): Promise<void>;
  findById(id: string): Promise<Invoice | null>;
  findByStore(storePublicId: string, limit: number, cursor?: string): Promise<{ items: Invoice[]; nextCursor: string | null }>;
}

// ── Payment Gateway (Tap) ────────────────────────────────────────────────────

export interface PaymentGatewayPort {
  createCharge(params: {
    invoice_id: string;
    amount_cents: number;
    currency: string;
  }): Promise<{ payment_ref: string; payment_url: string }>;

  capture(paymentRef: string): Promise<{ captured: boolean }>;

  refund(paymentRef: string, amount_cents: number): Promise<{ refunded: boolean }>;
}

// ── Event Publisher ──────────────────────────────────────────────────────────

export interface BillingEventPublisher {
  publishInvoiceIssued(event: {
    invoice_id: string;
    store_public_id: string;
    period: string;
  }): Promise<void>;

  publishFeeSettled(event: {
    settlement_id: string;
    fee_type: BillingFeeType;
    period: string;
  }): Promise<void>;

  publishPayoutRequested(event: {
    payout_id: string;
    partner_public_id: string;
    amount_cents: number;
  }): Promise<void>;
}

// ── Settlement Service ───────────────────────────────────────────────────────

export interface SettlementPort {
  settle(params: {
    invoice_id: string;
    fee_type: BillingFeeType;
    amount_cents: number;
    period: string;
  }): Promise<{ settlement_id: string; state: BillingSettlementState }>;

  findById(settlementId: string): Promise<{ settlement_id: string; state: BillingSettlementState } | null>;

  /** List settlements with optional state filter and cursor pagination. */
  listSettlements(params: {
    state?: BillingSettlementState;
    limit?: number;
    cursor?: string;
  }): Promise<{
    items: { settlement_id: string; state: BillingSettlementState; invoice_id: string; fee_type: BillingFeeType; amount_cents: number; period: string }[];
    nextCursor: string | null;
  }>;
}

// ── Clock ────────────────────────────────────────────────────────────────────

export interface Clock {
  now(): Date;
}

// ── ID Generator ─────────────────────────────────────────────────────────────

export interface IdGenerator {
  newInvoiceId(): string;
  newSettlementId(): string;
  newPayoutId(): string;
}

// ── Relay ports (ADR-050 §3 — fee settlement from order_completed) ──────────

/**
 * Reads events from `order_outbox` for the billing relay.
 * Same contract as support/delivery/search relays (ADR-025 §2.3).
 */
export interface OrderEventSource {
  readAfter(checkpoint: RelayCheckpoint | null, limit: number): Promise<readonly OrderOutboxRow[]>;
}

/**
 * Stores the relay's checkpoint — (occurred_at, event_id) of the last
 * terminally-consumed row. Billing-owned; one row per consumer.
 */
export interface RelayCheckpointStore {
  getCheckpoint(consumerId: string): Promise<RelayCheckpoint | null>;
  writeCheckpoint(consumerId: string, checkpoint: RelayCheckpoint): Promise<void>;
}

/**
 * Terminal status recorded in the consumed-events ledger. `pending` is never
 * recorded: a retryable failure leaves no row, so the event is read again.
 */
export type LedgerStatus = "settled" | "ignored" | "ignored_foreign" | "poisoned";

export interface LedgerEntry {
  readonly consumerId: string;
  readonly eventId: string;
  readonly status: LedgerStatus;
  readonly reason?: string;
  readonly settlementId?: string;
}

/**
 * Consumed-events ledger (M5-17P). Keyed by (consumer_id, event_id): the
 * idempotency proof that does NOT depend on the checkpoint. A redelivered
 * event after checkpoint loss finds its row and is a no-op, not a second
 * settlement. Poisoned events are recorded here with their reason — the
 * ledger is the dead-letter record.
 */
export interface ConsumedEventLedger {
  has(consumerId: string, eventId: string): Promise<boolean>;
  /** Records a terminal outcome. Returns false when the row already exists. */
  record(entry: LedgerEntry): Promise<boolean>;
}

/** Ports bound to one atomic unit of work. */
export interface RelayTxPorts {
  readonly invoices: InvoiceStore;
  readonly settlements: SettlementPort;
  readonly publisher: BillingEventPublisher;
  readonly ledger: ConsumedEventLedger;
}

/**
 * Runs `fn` so that every write through `tx` commits together or not at all.
 * Postgres: one transaction on one connection. A throw rolls back.
 */
export interface RelayTransactionRunner {
  run<T>(fn: (tx: RelayTxPorts) => Promise<T>): Promise<T>;
}

/**
 * Consumer lock — prevents concurrent relay batches for the same consumer.
 * The lock is held for the duration of `fn` and released always.
 */
export interface RelayConsumerLock {
  withConsumerLock<T>(consumerId: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * Relay dependencies — all ports the relay needs to function.
 * The relay is a pure orchestrator: it reads events, classifies them, and
 * settles each one inside a single transaction (invoice + settlement +
 * outbox event + ledger row). The checkpoint is an optimisation; the
 * ledger is the idempotency guarantee.
 */
export interface RelayDeps {
  readonly events: OrderEventSource;
  readonly transaction: RelayTransactionRunner;
  /** Read-side view of the ledger (outside any transaction). */
  readonly ledger: ConsumedEventLedger;
  readonly checkpoint: RelayCheckpointStore;
  readonly lock: RelayConsumerLock;
  readonly idGen: IdGenerator;
  readonly clock: Clock;
}

// ── In-memory stubs (for tests) ──────────────────────────────────────────────

export class InMemoryInvoiceStore implements InvoiceStore {
  private readonly invoices = new Map<string, Invoice>();

  async save(invoice: Invoice): Promise<void> {
    this.invoices.set(invoice.id, { ...invoice });
  }

  async findById(id: string): Promise<Invoice | null> {
    const invoice = this.invoices.get(id);
    return invoice ? { ...invoice } : null;
  }

  async findByStore(
    storePublicId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: Invoice[]; nextCursor: string | null }> {
    const all = [...this.invoices.values()]
      .filter((i) => i.store_public_id === storePublicId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    const startIdx = cursor ? all.findIndex((i) => i.id === cursor) + 1 : 0;
    const items = all.slice(startIdx, startIdx + limit);
    const nextCursor = items.length === limit ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }
}

export class InMemoryPaymentGateway implements PaymentGatewayPort {
  async createCharge(params: {
    invoice_id: string;
    amount_cents: number;
    currency: string;
  }): Promise<{ payment_ref: string; payment_url: string }> {
    return {
      payment_ref: `tap_${params.invoice_id}_${Date.now()}`,
      payment_url: `https://pay.tap.example.com/${params.invoice_id}`,
    };
  }

  async capture(_paymentRef: string): Promise<{ captured: boolean }> {
    return { captured: true };
  }

  async refund(_paymentRef: string, _amount_cents: number): Promise<{ refunded: boolean }> {
    return { refunded: true };
  }
}

export class InMemoryEventPublisher implements BillingEventPublisher {
  readonly events: Array<{ type: string; payload: Record<string, unknown> }> = [];

  async publishInvoiceIssued(event: { invoice_id: string; store_public_id: string; period: string }): Promise<void> {
    this.events.push({ type: "billing.invoice_issued", payload: { ...event } });
  }

  async publishFeeSettled(event: { settlement_id: string; fee_type: BillingFeeType; period: string }): Promise<void> {
    this.events.push({ type: "billing.fee_settled", payload: { ...event } });
  }

  async publishPayoutRequested(event: { payout_id: string; partner_public_id: string; amount_cents: number }): Promise<void> {
    this.events.push({ type: "billing.payout_requested", payload: { ...event } });
  }
}

export class InMemorySettlement implements SettlementPort {
  private readonly settlements = new Map<string, { settlement_id: string; state: BillingSettlementState; invoice_id: string; fee_type: BillingFeeType; amount_cents: number; period: string }>();

  async settle(params: {
    invoice_id: string;
    fee_type: BillingFeeType;
    amount_cents: number;
    period: string;
  }): Promise<{ settlement_id: string; state: BillingSettlementState }> {
    const settlement_id = `set_${params.invoice_id}_${Date.now()}`;
    const result = { settlement_id, state: "settled" as BillingSettlementState, invoice_id: params.invoice_id, fee_type: params.fee_type, amount_cents: params.amount_cents, period: params.period };
    this.settlements.set(settlement_id, result);
    return result;
  }

  async findById(settlementId: string): Promise<{ settlement_id: string; state: BillingSettlementState } | null> {
    const s = this.settlements.get(settlementId);
    return s ? { settlement_id: s.settlement_id, state: s.state } : null;
  }

  async listSettlements(params: {
    state?: BillingSettlementState;
    limit?: number;
    cursor?: string;
  }): Promise<{
    items: { settlement_id: string; state: BillingSettlementState; invoice_id: string; fee_type: BillingFeeType; amount_cents: number; period: string }[];
    nextCursor: string | null;
  }> {
    let all = [...this.settlements.values()];
    if (params.state) {
      all = all.filter((s) => s.state === params.state);
    }
    // Sort by settlement_id for stable ordering
    all.sort((a, b) => a.settlement_id.localeCompare(b.settlement_id));

    // Cursor-based pagination
    let startIdx = 0;
    if (params.cursor) {
      startIdx = all.findIndex((s) => s.settlement_id > params.cursor!);
      if (startIdx < 0) startIdx = all.length;
    }

    const limit = params.limit ?? 20;
    const items = all.slice(startIdx, startIdx + limit);
    const nextCursor = startIdx + limit < all.length ? items[items.length - 1]?.settlement_id ?? null : null;

    return { items, nextCursor };
  }
}

// ── In-memory relay stubs (for tests) ────────────────────────────────────────

export class InMemoryOrderEventSource implements OrderEventSource {
  private readonly rows: OrderOutboxRow[];

  constructor(rows: OrderOutboxRow[]) {
    this.rows = [...rows].sort((a, b) => {
      if (a.occurred_at < b.occurred_at) return -1;
      if (a.occurred_at > b.occurred_at) return 1;
      return a.event_id < b.event_id ? -1 : 1;
    });
  }

  async readAfter(_checkpoint: RelayCheckpoint | null, limit: number): Promise<readonly OrderOutboxRow[]> {
    // Returns all rows up to limit — stale detection is the relay's job.
    return this.rows.slice(0, limit);
  }
}

export class InMemoryRelayCheckpointStore implements RelayCheckpointStore {
  private readonly checkpoints = new Map<string, RelayCheckpoint>();

  async getCheckpoint(consumerId: string): Promise<RelayCheckpoint | null> {
    return this.checkpoints.get(consumerId) ?? null;
  }

  async writeCheckpoint(consumerId: string, checkpoint: RelayCheckpoint): Promise<void> {
    this.checkpoints.set(consumerId, { ...checkpoint });
  }
}

export class InMemoryConsumedEventLedger implements ConsumedEventLedger {
  readonly entries = new Map<string, LedgerEntry>();

  private key(consumerId: string, eventId: string): string {
    return `${consumerId}\u0000${eventId}`;
  }

  async has(consumerId: string, eventId: string): Promise<boolean> {
    return this.entries.has(this.key(consumerId, eventId));
  }

  async record(entry: LedgerEntry): Promise<boolean> {
    const k = this.key(entry.consumerId, entry.eventId);
    if (this.entries.has(k)) return false;
    this.entries.set(k, { ...entry });
    return true;
  }

  /** Test helper — poisoned entries (the dead-letter view). */
  poisoned(): LedgerEntry[] {
    return [...this.entries.values()].filter((e) => e.status === "poisoned");
  }
}

/**
 * In-memory transaction runner. It does NOT roll back — atomicity is a
 * property of the Postgres runner and is proven by the integration suite
 * (`relay-reconciliation.integration.test.ts`), not claimed here.
 */
export class InMemoryRelayTransactionRunner implements RelayTransactionRunner {
  constructor(private readonly ports: RelayTxPorts) {}

  async run<T>(fn: (tx: RelayTxPorts) => Promise<T>): Promise<T> {
    return fn(this.ports);
  }
}

export class InMemoryRelayConsumerLock implements RelayConsumerLock {
  async withConsumerLock<T>(_consumerId: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
