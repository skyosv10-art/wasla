/**
 * Money — integer minor units and an explicit currency, and nothing else.
 *
 * ADR-013 decision 4. This file is small on purpose: its whole job is to make the
 * two mistakes that ruin a negotiation service **unreachable**.
 *
 * ## Mistake one: a non-integer amount
 *
 * A negotiation compares amounts and, at the moment of agreement, asserts equality
 * between the accepted round and the row it writes. Binary fractions make that
 * equality a lie that only shows up after launch: `0.1 + 0.2 !== 0.3` is a
 * curiosity in a tutorial and a dispute in a payment. So the amount is a whole
 * number of minor units — halalas, cents — and `Number.isSafeInteger` is checked,
 * not assumed, because JSON gives us a `number` and a caller can put `12.5` in it.
 *
 * ## Mistake two: an implicit currency
 *
 * An amount without a currency is a number, not a price. Every row that stores an
 * amount stores its currency beside it, and this module refuses to compare or carry
 * one without the other. Conversion is deliberately absent: this service holds no
 * rate, and a service that converts silently is a service where the two parties
 * agreed to different numbers while both reading «accepted».
 */

import { validationFailed } from "./errors.js";

/** ISO-4217 alphabetic code, mirroring the `~ '^[A-Z]{3}$'` check in the DDL. */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * The upper bound is not cosmetic: `BIGINT` in Postgres accepts far more than
 * JavaScript can represent exactly, so the domain refuses anything above
 * `Number.MAX_SAFE_INTEGER` rather than let a value round on the way in and
 * compare unequal on the way out.
 */
export function assertAmountMinor(value: unknown, field = "amount_minor"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw validationFailed(field, "integer minor units");
  }
  if (value <= 0) throw validationFailed(field, "> 0");
  return value;
}

export function assertCurrency(value: unknown, field = "currency"): string {
  if (typeof value !== "string" || !CURRENCY_PATTERN.test(value)) {
    throw validationFailed(field, "ISO-4217 alphabetic code");
  }
  return value;
}

/**
 * An amount and its currency travelling together.
 *
 * A type rather than two arguments, so «which currency was that?» cannot be
 * answered by argument order at a call site three files away.
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

export function money(amountMinor: number, currency: string): Money {
  return Object.freeze({
    amountMinor: assertAmountMinor(amountMinor),
    currency: assertCurrency(currency),
  });
}

/**
 * Equality that refuses to compare across currencies.
 *
 * It returns `false` rather than throwing, because the caller that asks «is this
 * the same price?» about two different currencies has already been refused
 * upstream by `currencyMismatch`; this is the last guard, not the first.
 */
export function sameMoney(left: Money, right: Money): boolean {
  return left.currency === right.currency && left.amountMinor === right.amountMinor;
}
