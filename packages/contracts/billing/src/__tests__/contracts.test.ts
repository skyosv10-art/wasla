import { describe, it, expect } from "vitest";
import {
  BILLING_SERVICE_PORT,
  BILLING_INVOICE_STATES,
  BILLING_INVOICE_TRANSITIONS,
  BILLING_FEE_TYPES,
  BILLING_SETTLEMENT_STATES,
  BILLING_PAYMENT_INTENT_STATES,
  BILLING_PAYMENT_OPERATIONS,
  BILLING_EVENT_TYPES,
  BILLING_FORBIDDEN_EVENT_TYPES,
  BILLING_EVENT_FORBIDDEN_FIELDS,
  BILLING_ERROR_CODES,
  httpStatusForBillingError,
} from "../index.js";

describe("billing contracts — port", () => {
  it("uses port 8096 (ADR-050 §6)", () => {
    expect(BILLING_SERVICE_PORT).toBe(8096);
  });
});

describe("billing contracts — invoice states (ADR-050 §2)", () => {
  it("has exactly 6 invoice states", () => {
    expect(BILLING_INVOICE_STATES).toHaveLength(6);
    expect([...BILLING_INVOICE_STATES]).toEqual([
      "draft",
      "issued",
      "paid",
      "partially_paid",
      "closed",
      "void",
    ]);
  });

  it("has 9 transitions — no skipping", () => {
    expect(BILLING_INVOICE_TRANSITIONS).toHaveLength(9);
    expect([...BILLING_INVOICE_TRANSITIONS]).toContain("draft→issued");
    expect([...BILLING_INVOICE_TRANSITIONS]).toContain("issued→paid");
    expect([...BILLING_INVOICE_TRANSITIONS]).toContain("issued→partially_paid");
    expect([...BILLING_INVOICE_TRANSITIONS]).toContain("partially_paid→paid");
    expect([...BILLING_INVOICE_TRANSITIONS]).toContain("paid→closed");
    expect([...BILLING_INVOICE_TRANSITIONS]).toContain("draft→void");
    expect([...BILLING_INVOICE_TRANSITIONS]).toContain("issued→void");
    expect([...BILLING_INVOICE_TRANSITIONS]).toContain("partially_paid→void");
    expect([...BILLING_INVOICE_TRANSITIONS]).toContain("paid→void");
  });
});

describe("billing contracts — fee types (ADR-050 §3)", () => {
  it("has exactly 4 fee types", () => {
    expect(BILLING_FEE_TYPES).toHaveLength(4);
    expect([...BILLING_FEE_TYPES]).toEqual([
      "store_fixed",
      "store_variable",
      "subscription",
      "payout",
    ]);
  });
});

describe("billing contracts — settlement states (ADR-050 §3)", () => {
  it("has exactly 3 settlement states", () => {
    expect(BILLING_SETTLEMENT_STATES).toHaveLength(3);
    expect([...BILLING_SETTLEMENT_STATES]).toEqual([
      "pending",
      "settled",
      "failed",
    ]);
  });
});

describe("billing contracts — payment intent (ADR-050 §4)", () => {
  it("has exactly 4 payment intent states", () => {
    expect(BILLING_PAYMENT_INTENT_STATES).toHaveLength(4);
    expect([...BILLING_PAYMENT_INTENT_STATES]).toEqual([
      "created",
      "captured",
      "refunded",
      "failed",
    ]);
  });

  it("has exactly 3 payment operations", () => {
    expect(BILLING_PAYMENT_OPERATIONS).toHaveLength(3);
    expect([...BILLING_PAYMENT_OPERATIONS]).toEqual([
      "create_charge",
      "capture",
      "refund",
    ]);
  });
});

describe("billing contracts — events (ADR-050 §5)", () => {
  it("has exactly 3 event types", () => {
    expect(BILLING_EVENT_TYPES).toHaveLength(3);
    expect([...BILLING_EVENT_TYPES]).toEqual([
      "billing.invoice_issued",
      "billing.fee_settled",
      "billing.payout_requested",
    ]);
  });

  it("forbids card/payment raw events", () => {
    expect(BILLING_FORBIDDEN_EVENT_TYPES).toContain("billing.card_processed");
    expect(BILLING_FORBIDDEN_EVENT_TYPES).toContain("billing.payment_raw");
    expect(BILLING_FORBIDDEN_EVENT_TYPES).toContain("billing.card_number");
    expect(BILLING_FORBIDDEN_EVENT_TYPES).toContain("billing.cvv");
    expect(BILLING_FORBIDDEN_EVENT_TYPES).toContain("billing.token_used");
  });

  it("forbids PII and card fields in events", () => {
    expect(BILLING_EVENT_FORBIDDEN_FIELDS).toContain("chat_id");
    expect(BILLING_EVENT_FORBIDDEN_FIELDS).toContain("phone");
    expect(BILLING_EVENT_FORBIDDEN_FIELDS).toContain("card_number");
    expect(BILLING_EVENT_FORBIDDEN_FIELDS).toContain("cvv");
    expect(BILLING_EVENT_FORBIDDEN_FIELDS).toContain("card_token");
  });
});

describe("billing contracts — error codes", () => {
  it("has exactly 9 error codes", () => {
    expect(BILLING_ERROR_CODES).toHaveLength(9);
  });

  it("maps validation errors to 422", () => {
    expect(httpStatusForBillingError("BILLING_VALIDATION_FAILED")).toBe(422);
  });

  it("maps not found to 404", () => {
    expect(httpStatusForBillingError("BILLING_INVOICE_NOT_FOUND")).toBe(404);
    expect(httpStatusForBillingError("BILLING_FEE_NOT_FOUND")).toBe(404);
  });

  it("maps state conflicts to 409", () => {
    expect(httpStatusForBillingError("BILLING_INVALID_STATE_TRANSITION")).toBe(409);
    expect(httpStatusForBillingError("BILLING_INVOICE_ALREADY_CLOSED")).toBe(409);
    expect(httpStatusForBillingError("BILLING_INVOICE_ALREADY_VOID")).toBe(409);
    expect(httpStatusForBillingError("BILLING_REFUND_NOT_ALLOWED")).toBe(409);
  });

  it("maps gateway errors to 502", () => {
    expect(httpStatusForBillingError("BILLING_SETTLEMENT_FAILED")).toBe(502);
    expect(httpStatusForBillingError("BILLING_PAYMENT_GATEWAY_ERROR")).toBe(502);
  });
});
