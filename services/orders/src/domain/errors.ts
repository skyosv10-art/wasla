/**
 * Order Engine error contract.
 *
 * The catalog itself is NOT redefined here: the stable codes, their classes and
 * the HTTP status derived from each class live in @wasla/contracts-order, which
 * is drift-guarded against services/orders/contracts/errors.md. This file only
 * wraps them in a throwable typed error, so a use case raises a contract code
 * and the HTTP layer (MR 4/6) maps it without re-classifying.
 *
 * Tests assert `code` — never the Arabic message copy.
 */

import {
  ORDER_ERROR_CODE_CLASS,
  httpStatusForOrderError,
  type OrderErrorClass,
  type OrderErrorCode,
} from "@wasla/contracts-order";

import type { OrderStatus } from "./model.js";

export type { OrderErrorCode, OrderErrorClass };

/**
 * Structured, machine-readable detail carried alongside the code.
 *
 * Kept as named optional fields rather than a free `Record<string, unknown>`:
 * the transition error must always be able to answer "from where, to where?",
 * and a loose bag makes that a convention instead of a type.
 */
export interface OrderErrorDetails {
  readonly from?: OrderStatus;
  readonly to?: OrderStatus;
  readonly field?: string;
  readonly expected?: string;
  readonly actual?: string;
}

/** A domain error carrying a stable contract code. */
export class OrderError extends Error {
  readonly code: OrderErrorCode;
  readonly class: OrderErrorClass;
  readonly httpStatus: number;
  readonly traceId?: string;
  readonly details: OrderErrorDetails;

  constructor(
    code: OrderErrorCode,
    message: string,
    options: { traceId?: string; details?: OrderErrorDetails } = {},
  ) {
    super(message);
    this.name = "OrderError";
    this.code = code;
    this.class = ORDER_ERROR_CODE_CLASS[code];
    this.httpStatus = httpStatusForOrderError(code);
    this.traceId = options.traceId;
    this.details = options.details ?? {};
  }
}

/** Narrowing helper for callers that catch broadly. */
export function isOrderError(value: unknown): value is OrderError {
  return value instanceof OrderError;
}

/**
 * The rejection of a transition that is not in the published table.
 *
 * A dedicated constructor because this is the error the whole phase exists to
 * produce: it must always carry `from` and `to` so the caller learns which pair
 * was refused, not merely that something was refused.
 */
export function illegalTransition(
  from: OrderStatus,
  to: OrderStatus,
  traceId?: string,
): OrderError {
  return new OrderError(
    "ORDER_ILLEGAL_TRANSITION",
    `الانتقال من ${from} إلى ${to} غير مذكور في جدول الانتقالات`,
    { traceId, details: { from, to } },
  );
}
