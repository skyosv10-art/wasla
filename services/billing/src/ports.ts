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
 * Dead-letter store for poisoned events (invalid payload, unknown version,
 * unmappable outcome). A poison event never blocks the stream.
 */
export interface RelayDeadLetterStore {
  writeDeadLetter(
    consumerId: string,
    event: OrderOutboxRow,
    reason: string,
    attempts: number,
  ): Promise<void>;
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
 * The relay is a pure orchestrator: it reads events, classifies them,
 * creates fee settlements, and writes the checkpoint. All I/O is through ports.
 */
export interface RelayDeps {
  readonly events: OrderEventSource;
  readonly settlements: SettlementPort;
  readonly invoices: InvoiceStore;
  readonly publisher: BillingEventPublisher;
  readonly checkpoint: RelayCheckpointStore;
  readonly deadLetter: RelayDeadLetterStore;
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
  private readonly settlements = new Map<string, { settlement_id: string; state: BillingSettlementState }>();

  async settle(params: {
    invoice_id: string;
    fee_type: BillingFeeType;
    amount_cents: number;
    period: string;
  }): Promise<{ settlement_id: string; state: BillingSettlementState }> {
    const settlement_id = `set_${params.invoice_id}_${Date.now()}`;
    const result = { settlement_id, state: "settled" as BillingSettlementState };
    this.settlements.set(settlement_id, result);
    return result;
  }

  async findById(settlementId: string): Promise<{ settlement_id: string; state: BillingSettlementState } | null> {
    return this.settlements.get(settlementId) ?? null;
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

export class InMemoryRelayDeadLetterStore implements RelayDeadLetterStore {
  readonly deadLetters: Array<{ consumerId: string; event: OrderOutboxRow; reason: string; attempts: number }> = [];

  async writeDeadLetter(
    consumerId: string,
    event: OrderOutboxRow,
    reason: string,
    attempts: number,
  ): Promise<void> {
    this.deadLetters.push({ consumerId, event, reason, attempts });
  }
}

export class InMemoryRelayConsumerLock implements RelayConsumerLock {
  async withConsumerLock<T>(_consumerId: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
