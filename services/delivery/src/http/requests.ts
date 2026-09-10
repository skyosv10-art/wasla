/**
 * Delivery HTTP request parsing — the boundary where untyped JSON becomes a
 * domain input, or is refused (ADR-026 §2.6).
 *
 * ## No silent coercion, anywhere
 *
 * `"3"` is not `3`, `null` is not `0`, and a missing `delivery_fee_minor_units`
 * is not a free delivery. Every one of those coercions is a money bug that
 * survives review because it looks like convenience. A field that is not the
 * declared type is `DELIVERY_VALIDATION_FAILED` (400) with the field name in
 * `details`, so the client learns WHICH field, not merely that something was
 * wrong.
 *
 * ## What is checked here and what is checked in the domain
 *
 * Here: shape only — is this JSON the declared object, with the declared
 * types and no unknown extras where the contract says
 * `additionalProperties: false`. In the domain (`validation.ts`): meaning —
 * `WS-` refs, uuid shapes, `quantity >= 1`, fee `>= 0`. The split keeps HTTP
 * ignorant of domain rules and keeps the domain reachable from any entry
 * point with the same guarantees.
 *
 * `reason_code` is the one exception worth naming: the closed catalog lives
 * in the contract package, so the parser checks membership rather than
 * letting an unknown code reach a database CHECK and surface as a 500.
 */

import {
  PAYMENT_REASON_CODES,
  PAYMENT_STATES,
  STORE_ORDER_CANCEL_REASON_CODES,
} from "@wasla/contracts-delivery";
import type {
  PaymentReasonCode,
  PaymentState,
  StoreOrderCancelReasonCode,
  WaslaPublicId,
} from "@wasla/contracts-delivery";

import { DeliveryError } from "../domain/errors.js";
import type { OrderLineInput, PlaceOrderInput } from "../domain/validation.js";

function invalid(field: string, message: string, actual?: unknown): DeliveryError {
  return new DeliveryError("DELIVERY_VALIDATION_FAILED", message, {
    details: { field, actual: actual === undefined ? undefined : String(actual) },
  });
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(field, "الجسمُ يجبُ أن يكونَ كائنَ JSON");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw invalid(field, `${field} يجبُ أن يكونَ نصّاً`, value);
  }
  return value;
}

function asInteger(value: unknown, field: string): number {
  // `typeof NaN === "number"`, and JSON has no integer type — so the check is
  // explicitly Number.isInteger, not a truthiness test.
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw invalid(field, `${field} يجبُ أن يكونَ عدداً صحيحاً`, value);
  }
  return value;
}

/** Parse `POST /store-orders` body into the domain's `PlaceOrderInput`. */
export function parsePlaceStoreOrderBody(body: unknown): PlaceOrderInput {
  const raw = asObject(body, "body");

  const itemsRaw = raw.items;
  if (!Array.isArray(itemsRaw)) {
    throw invalid("items", "items يجبُ أن تكونَ مصفوفةً");
  }

  const items: OrderLineInput[] = itemsRaw.map((entry, index) => {
    const line = asObject(entry, `items[${index}]`);
    return {
      product_id: asString(line.product_id, `items[${index}].product_id`),
      quantity: asInteger(line.quantity, `items[${index}].quantity`),
    };
  });

  return {
    customer_ref: asString(raw.customer_ref, "customer_ref"),
    store_slug: asString(raw.store_slug, "store_slug"),
    items,
    // Required by the contract — absent is a validation failure, NOT zero.
    delivery_fee_minor_units: asInteger(raw.delivery_fee_minor_units, "delivery_fee_minor_units"),
  };
}

/**
 * Parse the `{orderPublicId}` path parameter.
 *
 * The `WS-` shape is enforced by the domain (`assertPublicId`), but a
 * non-string param cannot even reach it — Fastify hands params as strings, so
 * this guard is about the ABSENT case (a route mounted without the segment).
 */
export function parseOrderPublicIdParam(params: unknown): WaslaPublicId {
  const raw = asObject(params, "params");
  const value = asString(raw.orderPublicId, "orderPublicId");
  if (!/^WS-[0-9]{10}$/.test(value)) {
    throw invalid("orderPublicId", "مرجعُ الطلبِ يجبُ أن يكونَ بصيغةِ WS-##########", value);
  }
  return value as WaslaPublicId;
}

/** Parse `POST /store-orders/{id}/cancellation` body — closed reason set. */
export function parseCancelBody(body: unknown): StoreOrderCancelReasonCode {
  const raw = asObject(body, "body");
  const code = asString(raw.reason_code, "reason_code");
  if (!(STORE_ORDER_CANCEL_REASON_CODES as readonly string[]).includes(code)) {
    throw invalid("reason_code", "سببُ الإلغاءِ ليس من الكتالوجِ المغلقِ", code);
  }
  return code as StoreOrderCancelReasonCode;
}

/**
 * Parse `PUT /store-orders/{id}/payment-mirror` body (review 9/N · §2.2).
 *
 * Three rules the contract states and this parser enforces literally:
 *
 *  1. `payment_state` and `reason_code` are members of CLOSED catalogs. An
 *     unknown value must not reach a database CHECK and surface as a 500.
 *  2. `additionalProperties: false` is enforced HERE, not merely documented.
 *     A provider that sends `amount_minor_units` must be refused loudly:
 *     silently ignoring it is how an integrator concludes Wasla stored an
 *     amount it never stored (§2.2 — no money is processed in this service).
 *  3. A MISSING `payment_ref` is not `null`. Missing means "nothing new to
 *     say"; `null` means "no reference at the provider". The distinction is
 *     what stops a terse webhook from erasing an audit trail, so the parser
 *     preserves it (`undefined` vs `null`) instead of normalising.
 */
export function parsePaymentMirrorBody(body: unknown): {
  paymentState: PaymentState;
  reasonCode: PaymentReasonCode;
  paymentRef?: string | null;
} {
  const raw = asObject(body, "body");

  const allowed = new Set(["payment_state", "reason_code", "payment_ref"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw invalid(key, "حقلٌ غيرُ مُعلَنٍ في العقدِ — ولا حقلَ ماليَّ في مرآةِ الدفعِ (§2.2)", key);
    }
  }

  const state = asString(raw.payment_state, "payment_state");
  if (!(PAYMENT_STATES as readonly string[]).includes(state)) {
    throw invalid("payment_state", "حالةُ الدفعِ ليست من الكتالوجِ المغلقِ", state);
  }
  const reason = asString(raw.reason_code, "reason_code");
  if (!(PAYMENT_REASON_CODES as readonly string[]).includes(reason)) {
    throw invalid("reason_code", "سببُ المرآةِ ليس من الكتالوجِ المغلقِ", reason);
  }

  const parsed: { paymentState: PaymentState; reasonCode: PaymentReasonCode; paymentRef?: string | null } = {
    paymentState: state as PaymentState,
    reasonCode: reason as PaymentReasonCode,
  };

  if ("payment_ref" in raw) {
    const ref = raw.payment_ref;
    if (ref === null) return { ...parsed, paymentRef: null };
    const text = asString(ref, "payment_ref");
    if (text.length < 1 || text.length > 128) {
      throw invalid("payment_ref", "مرجعُ الدفعِ بطولِ 1..128 محرفاً", String(text.length));
    }
    return { ...parsed, paymentRef: text };
  }

  return parsed;
}
