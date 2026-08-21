/**
 * Customer Core error contract.
 *
 * The catalog itself is NOT redefined here: the stable codes, their classes and
 * the HTTP status derived from each class live in @wasla/contracts-customer,
 * which is drift-guarded against services/customers/contracts/errors.md. This
 * file only wraps them in a throwable typed error, so a use case raises a
 * contract code and the HTTP layer (MR 4/6) maps it without re-classifying.
 *
 * Tests assert `code` — never the Arabic message copy.
 */

import {
  CUSTOMER_ERROR_CODE_CLASS,
  httpStatusForCustomerError,
  type CustomerErrorClass,
  type CustomerErrorCode,
} from "@wasla/contracts-customer";

import type { IntakeFailureReason } from "./model.js";

export type { CustomerErrorCode, CustomerErrorClass };

/** A domain error carrying a stable contract code. */
export class CustomerError extends Error {
  readonly code: CustomerErrorCode;
  readonly class: CustomerErrorClass;
  readonly httpStatus: number;
  readonly traceId?: string;
  /** Set when the error came from a failed handover, for logs and events. */
  readonly reasonCode?: IntakeFailureReason;

  constructor(
    code: CustomerErrorCode,
    message: string,
    options: { traceId?: string; reasonCode?: IntakeFailureReason } = {},
  ) {
    super(message);
    this.name = "CustomerError";
    this.code = code;
    this.class = CUSTOMER_ERROR_CODE_CLASS[code];
    this.httpStatus = httpStatusForCustomerError(code);
    this.traceId = options.traceId;
    this.reasonCode = options.reasonCode;
  }
}

/** Narrowing helper for callers that catch broadly. */
export function isCustomerError(value: unknown): value is CustomerError {
  return value instanceof CustomerError;
}

/**
 * Thrown by an OrderIntakePort adapter when the handover did not happen.
 *
 * It carries the operational `reasonCode` (unavailable / rejected / timeout)
 * while the customer always sees one code (503 CUSTOMER_ORDER_INTAKE_UNAVAILABLE):
 * the distinction is for operating the system, not for the customer.
 */
export class OrderIntakeFailure extends Error {
  readonly reasonCode: IntakeFailureReason;

  constructor(reasonCode: IntakeFailureReason, message?: string) {
    super(message ?? reasonCode);
    this.name = "OrderIntakeFailure";
    this.reasonCode = reasonCode;
  }
}

/** Narrowing helper: distinguishes a handover failure from a bug. */
export function isOrderIntakeFailure(value: unknown): value is OrderIntakeFailure {
  return value instanceof OrderIntakeFailure;
}
