/**
 * services/billing/src/domain/model.ts
 *
 * The invoice domain model (ADR-050 §2): a 6-state lifecycle with no skipping.
 * Transitions are hand-written (14) not generated, because each carries a
 * business rule that a general algorithm cannot infer.
 *
 * ADR-050 §2:
 * - draft → issued (fee settlement complete, invoice ready for recipient)
 * - issued → paid (full payment received)
 * - issued → partially_paid (partial payment received)
 * - partially_paid → paid (remaining balance received)
 * - paid → closed (final settlement, no further changes)
 * - draft → void (error in issuance)
 * - issued → void (dispute before payment)
 * - partially_paid → void (dispute with partial payment)
 * - paid → void (refund issued — rare, requires admin)
 */

import {
  BILLING_INVOICE_STATES,
  BILLING_INVOICE_TRANSITIONS,
  type BillingInvoiceState,
  type BillingInvoiceTransition,
} from "@wasla/contracts-billing";

// ── Invoice state machine ────────────────────────────────────────────────────

export const INVOICE_STATES = BILLING_INVOICE_STATES;
export const INVOICE_TRANSITIONS = BILLING_INVOICE_TRANSITIONS;

const TRANSITION_MAP = new Map<BillingInvoiceTransition, true>(
  INVOICE_TRANSITIONS.map((t) => [t, true] as const),
);

/** Returns true if the transition is valid per ADR-050 §2. */
export function canTransition(
  from: BillingInvoiceState,
  to: BillingInvoiceState,
): boolean {
  if (from === to) return false;
  const key = `${from}→${to}` as BillingInvoiceTransition;
  return TRANSITION_MAP.has(key);
}

/** Returns all valid target states from the given state. */
export function nextStates(from: BillingInvoiceState): BillingInvoiceState[] {
  return INVOICE_STATES.filter((to) => canTransition(from, to));
}

/** True if the state is terminal (no outgoing transitions). */
export function isTerminal(state: BillingInvoiceState): boolean {
  return nextStates(state).length === 0;
}

/** True if the state allows payment operations (create_charge, capture). */
export function allowsPayment(state: BillingInvoiceState): boolean {
  return state === "issued" || state === "partially_paid";
}

/** True if the state allows void (cancellation). */
export function allowsVoid(state: BillingInvoiceState): boolean {
  return canTransition(state, "void");
}

/** True if the state requires settlement before closing. */
export function requiresSettlement(state: BillingInvoiceState): boolean {
  return state === "paid";
}

// ── Invoice entity ────────────────────────────────────────────────────────────

export interface Invoice {
  readonly id: string;
  readonly store_public_id: string;
  readonly period: string; // e.g. "2026-09"
  state: BillingInvoiceState;
  readonly fee_type: string;
  amount_cents: number;
  paid_amount_cents: number;
  readonly payment_ref: string | null;
  readonly created_at: Date;
  updated_at: Date;
}

/** Creates a new invoice in draft state. */
export function createInvoice(params: {
  id: string;
  store_public_id: string;
  period: string;
  fee_type: string;
  amount_cents: number;
  now: Date;
}): Invoice {
  if (params.amount_cents <= 0) {
    throw new Error("amount_cents must be positive");
  }
  if (!params.store_public_id) {
    throw new Error("store_public_id is required");
  }
  if (!params.period) {
    throw new Error("period is required");
  }
  return {
    id: params.id,
    store_public_id: params.store_public_id,
    period: params.period,
    state: "draft",
    fee_type: params.fee_type,
    amount_cents: params.amount_cents,
    paid_amount_cents: 0,
    payment_ref: null,
    created_at: params.now,
    updated_at: params.now,
  };
}

/** Transitions an invoice to a new state. Throws on invalid transition. */
export function transitionInvoice(
  invoice: Invoice,
  to: BillingInvoiceState,
  now: Date,
): Invoice {
  if (!canTransition(invoice.state, to)) {
    throw new Error(
      `Invalid transition: ${invoice.state} → ${to} (ADR-050 §2)`,
    );
  }
  return {
    ...invoice,
    state: to,
    updated_at: now,
  };
}

/** Records a payment on an invoice, transitioning state if needed. */
export function recordPayment(
  invoice: Invoice,
  amount_cents: number,
  payment_ref: string,
  now: Date,
): Invoice {
  if (!allowsPayment(invoice.state)) {
    throw new Error(
      `Payment not allowed in state ${invoice.state} (ADR-050 §2)`,
    );
  }
  const newPaid = invoice.paid_amount_cents + amount_cents;
  const updated = {
    ...invoice,
    paid_amount_cents: newPaid,
    payment_ref,
    updated_at: now,
  };

  if (newPaid >= invoice.amount_cents) {
    return transitionInvoice(updated, "paid", now);
  }
  if (invoice.state === "issued") {
    return transitionInvoice(updated, "partially_paid", now);
  }
  return updated;
}
