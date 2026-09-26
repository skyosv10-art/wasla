/**
 * @wasla/contracts-billing
 *
 * تبرير الحزمة (§7): تضع العقود الكنسية للفوترة والرسوم في سطح TypeScript واحد
 * كي لا ينسخ المستهلكون الحقيقة أو يبتكروا عقداً موازياً.
 *
 * These are Contract First artifacts (ADR-004), NOT a runtime implementation;
 * implementation lands in later MRs of Phase 17. ADR-050 binds this service to a
 * single shape: invoices have a 6-state lifecycle (decision 2), fees are 4 types
 * (decision 3), Tap payment gateway is called via create_charge/capture/refund
 * (decision 4), no financial fields in other services (decision 8 — same boundary
 * as ADR-016 §6), and no PII in events (decision 5).
 */

export const BILLING_SERVICE_PORT = 8096 as const;

// ── Invoice lifecycle (ADR-050 §2) ──────────────────────────────────────────

export const BILLING_INVOICE_STATES = [
  "draft",
  "issued",
  "paid",
  "partially_paid",
  "closed",
  "void",
] as const;

export const BILLING_INVOICE_TRANSITIONS = [
  "draft→issued",
  "issued→paid",
  "issued→partially_paid",
  "partially_paid→paid",
  "paid→closed",
  "draft→void",
  "issued→void",
  "partially_paid→void",
  "paid→void",
] as const;

// ── Fee types (ADR-050 §3) ──────────────────────────────────────────────────

export const BILLING_FEE_TYPES = [
  "store_fixed",
  "store_variable",
  "subscription",
  "payout",
] as const;

// ── Settlement states (ADR-050 §3) ──────────────────────────────────────────

export const BILLING_SETTLEMENT_STATES = [
  "pending",
  "settled",
  "failed",
] as const;

// ── Payment intent states (Tap) (ADR-050 §4) ────────────────────────────────

export const BILLING_PAYMENT_INTENT_STATES = [
  "created",
  "captured",
  "refunded",
  "failed",
] as const;

export const BILLING_PAYMENT_OPERATIONS = [
  "create_charge",
  "capture",
  "refund",
] as const;

// ── Events (ADR-050 §5) ──────────────────────────────────────────────────────

export const BILLING_EVENT_TYPES = [
  "billing.invoice_issued",
  "billing.fee_settled",
  "billing.payout_requested",
] as const;

export const BILLING_FORBIDDEN_EVENT_TYPES = [
  "billing.card_processed",
  "billing.payment_raw",
  "billing.card_number",
  "billing.cvv",
  "billing.token_used",
] as const;

export const BILLING_EVENT_FORBIDDEN_FIELDS = [
  "chat_id",
  "telegram",
  "whatsapp",
  "phone",
  "name",
  "coordinates",
  "card_number",
  "cvv",
  "card_token",
  "free_text",
] as const;

// ── Error codes ──────────────────────────────────────────────────────────────

export const BILLING_ERROR_CODES = [
  "BILLING_VALIDATION_FAILED",
  "BILLING_INVOICE_NOT_FOUND",
  "BILLING_INVALID_STATE_TRANSITION",
  "BILLING_INVOICE_ALREADY_CLOSED",
  "BILLING_INVOICE_ALREADY_VOID",
  "BILLING_FEE_NOT_FOUND",
  "BILLING_SETTLEMENT_FAILED",
  "BILLING_PAYMENT_GATEWAY_ERROR",
  "BILLING_REFUND_NOT_ALLOWED",
] as const;

// ── Types ────────────────────────────────────────────────────────────────────

export type BillingInvoiceState = (typeof BILLING_INVOICE_STATES)[number];
export type BillingInvoiceTransition = (typeof BILLING_INVOICE_TRANSITIONS)[number];
export type BillingFeeType = (typeof BILLING_FEE_TYPES)[number];
export type BillingSettlementState = (typeof BILLING_SETTLEMENT_STATES)[number];
export type BillingPaymentIntentState = (typeof BILLING_PAYMENT_INTENT_STATES)[number];
export type BillingPaymentOperation = (typeof BILLING_PAYMENT_OPERATIONS)[number];
export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number];
export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number];

/** HTTP status mapping for error codes (ADR-050 §errors). */
export function httpStatusForBillingError(code: BillingErrorCode): number {
  switch (code) {
    case "BILLING_VALIDATION_FAILED":
      return 422;
    case "BILLING_INVOICE_NOT_FOUND":
    case "BILLING_FEE_NOT_FOUND":
      return 404;
    case "BILLING_INVALID_STATE_TRANSITION":
    case "BILLING_INVOICE_ALREADY_CLOSED":
    case "BILLING_INVOICE_ALREADY_VOID":
    case "BILLING_REFUND_NOT_ALLOWED":
      return 409;
    case "BILLING_SETTLEMENT_FAILED":
    case "BILLING_PAYMENT_GATEWAY_ERROR":
      return 502;
    default:
      return 500;
  }
}
