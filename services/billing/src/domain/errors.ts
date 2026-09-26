/**
 * services/billing/src/domain/errors.ts
 *
 * BillingError + 9 factory functions (ADR-050 §errors).
 * Each factory is the ONLY way to create that error code —
 * the constructor is private, so no code can invent a code.
 */

import {
  type BillingErrorCode,
  httpStatusForBillingError,
} from "@wasla/contracts-billing";

export class BillingError extends Error {
  readonly code: BillingErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  private constructor(
    code: BillingErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BillingError";
    this.code = code;
    this.httpStatus = httpStatusForBillingError(code);
    if (details) this.details = details;
  }

  static validationFailed(message: string, details?: Record<string, unknown>): BillingError {
    return new BillingError("BILLING_VALIDATION_FAILED", message, details);
  }

  static invoiceNotFound(invoiceId: string): BillingError {
    return new BillingError(
      "BILLING_INVOICE_NOT_FOUND",
      `Invoice ${invoiceId} not found`,
      { invoice_id: invoiceId },
    );
  }

  static invalidStateTransition(from: string, to: string): BillingError {
    return new BillingError(
      "BILLING_INVALID_STATE_TRANSITION",
      `Invalid invoice transition: ${from} → ${to} (ADR-050 §2)`,
      { from, to },
    );
  }

  static invoiceAlreadyClosed(invoiceId: string): BillingError {
    return new BillingError(
      "BILLING_INVOICE_ALREADY_CLOSED",
      `Invoice ${invoiceId} is already closed`,
      { invoice_id: invoiceId },
    );
  }

  static invoiceAlreadyVoid(invoiceId: string): BillingError {
    return new BillingError(
      "BILLING_INVOICE_ALREADY_VOID",
      `Invoice ${invoiceId} is already void`,
      { invoice_id: invoiceId },
    );
  }

  static feeNotFound(feeId: string): BillingError {
    return new BillingError(
      "BILLING_FEE_NOT_FOUND",
      `Fee ${feeId} not found`,
      { fee_id: feeId },
    );
  }

  static settlementFailed(reason: string): BillingError {
    return new BillingError(
      "BILLING_SETTLEMENT_FAILED",
      `Settlement failed: ${reason}`,
      { reason },
    );
  }

  static paymentGatewayError(operation: string, reason: string): BillingError {
    return new BillingError(
      "BILLING_PAYMENT_GATEWAY_ERROR",
      `Payment gateway error during ${operation}: ${reason}`,
      { operation, reason },
    );
  }

  static refundNotAllowed(invoiceId: string, reason: string): BillingError {
    return new BillingError(
      "BILLING_REFUND_NOT_ALLOWED",
      `Refund not allowed for invoice ${invoiceId}: ${reason}`,
      { invoice_id: invoiceId, reason },
    );
  }
}
