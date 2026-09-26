/**
 * Billing types for admin portal.
 *
 * M5-17 review 6/N: Billing admin screen — list invoices + settlements,
 * view invoice details, issue, void, record payment.
 * Calls the billing service via the admin API client.
 */

export type BillingInvoiceState = "draft" | "issued" | "paid" | "partially_paid" | "closed" | "void";
export type BillingFeeType = "store_fixed" | "store_variable" | "subscription" | "payout";
export type BillingSettlementState = "settled" | "pending" | "failed";

export interface BillingInvoiceResource {
  readonly id: string;
  readonly store_public_id: string;
  readonly period: string;
  readonly state: BillingInvoiceState;
  readonly fee_type: BillingFeeType;
  readonly amount_cents: number;
  readonly paid_amount_cents: number;
  readonly payment_ref: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface BillingSettlementResource {
  readonly settlement_id: string;
  readonly state: BillingSettlementState;
  readonly invoice_id: string;
  readonly fee_type: BillingFeeType;
  readonly amount_cents: number;
  readonly period: string;
}

export interface InvoiceListResponse {
  readonly items: readonly BillingInvoiceResource[];
  readonly next_cursor: string | null;
}

export interface SettlementListResponse {
  readonly items: readonly BillingSettlementResource[];
  readonly next_cursor: string | null;
}

export interface CreateInvoiceRequest {
  readonly store_public_id: string;
  readonly period: string;
  readonly fee_type: BillingFeeType;
  readonly amount_cents: number;
}

export interface RecordPaymentRequest {
  readonly amount_cents: number;
  readonly payment_ref: string;
}
