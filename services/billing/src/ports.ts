/**
 * services/billing/src/ports.ts
 *
 * Port interfaces for the billing service (ADR-050).
 * Implementation lands in later reviews (3/N → N/N).
 */

import type { BillingInvoiceState, BillingFeeType, BillingSettlementState } from "@wasla/contracts-billing";
import type { Invoice } from "./domain/model.js";

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
    const items = [...this.invoices.values()]
      .filter((i) => i.store_public_id === storePublicId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit);
    return { items, nextCursor: null };
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
