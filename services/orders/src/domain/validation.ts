/**
 * Domain validation for the Order Engine.
 *
 * Split from the HTTP layer on purpose: MR 4/6 will reject malformed JSON and
 * unknown enum members at the edge (400), while everything here answers a
 * different question — "this is well-formed, is it acceptable?" (422). Keeping
 * the second question in the domain means the in-memory store, Postgres and
 * HTTP all refuse the same payloads, which is what makes port parity testable.
 *
 * Every rule below has a counterpart CHECK constraint in schema.sql. That is
 * deliberate duplication: the domain gives a coded, explainable error, and the
 * database guarantees no other writer can bypass it.
 */

import {
  ORDER_REASON_CODES,
  ORDER_STATUSES,
  STOPS_PER_ORDER,
  WASLA_PUBLIC_ID_PATTERN,
} from "@wasla/contracts-order";

import { OrderError, type OrderErrorCode, type OrderErrorDetails } from "./errors.js";
import type {
  Money,
  OrderActorType,
  OrderIntakeCommand,
  OrderReasonCode,
  OrderStatus,
  ShipmentDetails,
  Stop,
} from "./model.js";
import { requiresReasonCode } from "./state-machine.js";

const REASON_CODE_SET = new Set<string>(ORDER_REASON_CODES);
const STATUS_SET = new Set<string>(ORDER_STATUSES);

/** Max length of a stop label, matching the contract. */
const STOP_LABEL_MAX = 60;
/** Max length of a shipment description, matching the contract. */
const SHIPMENT_DESCRIPTION_MAX = 300;
/** Max shipment weight in kg, matching the contract and the NUMERIC(7,2) column. */
const SHIPMENT_WEIGHT_MAX = 3000;

/** Raise a coded domain error. Never returns, so callers read as guards. */
function fail(
  code: OrderErrorCode,
  message: string,
  traceId?: string,
  details?: OrderErrorDetails,
): never {
  throw new OrderError(code, message, { traceId, details });
}

/** Is this a known status? Used where a status arrives as plain text. */
export function isKnownStatus(value: string): value is OrderStatus {
  return STATUS_SET.has(value);
}

/** Is this a known reason code? The catalog is closed (ADR-010 decision 7). */
export function isKnownReasonCode(value: string): value is OrderReasonCode {
  return REASON_CODE_SET.has(value);
}

/**
 * A reason code must exist in the closed catalog.
 *
 * Rejecting an unknown code rather than storing it keeps every analytics query
 * over `status_reason_code` complete: a free-text reason would silently create
 * a bucket nobody can aggregate.
 */
export function assertReasonCodeKnown(
  reasonCode: string | null | undefined,
  traceId?: string,
): void {
  if (reasonCode == null) return;
  if (!isKnownReasonCode(reasonCode)) {
    fail(
      "ORDER_REASON_CODE_UNKNOWN",
      `كود السبب ${reasonCode} غير موجود في الكتالوج المُقفل`,
      traceId,
      { field: "reason_code", actual: reasonCode },
    );
  }
}

/**
 * A terminal state demands a reason. An order never ends "just like that":
 * without a reason, the support answer to "why was my order cancelled?" is a
 * shrug, and the cancellation-reason report is unbuildable after the fact.
 */
export function assertReasonCodeForTarget(
  toStatus: OrderStatus,
  reasonCode: OrderReasonCode | null,
  traceId?: string,
): void {
  if (requiresReasonCode(toStatus) && reasonCode == null) {
    fail(
      "ORDER_REASON_CODE_REQUIRED",
      `الحالة النهائية ${toStatus} تستلزم كود سبب`,
      traceId,
      { to: toStatus, field: "reason_code" },
    );
  }
}

/**
 * `system` carries no actor ref; anyone else must carry one.
 *
 * This is the one actor rule the domain enforces. It is a shape rule, verifiable
 * without authentication — unlike "is this really that customer?", which Phase 06
 * cannot answer and therefore does not pretend to (see state-machine.ts).
 * `ck_order_status_history_actor_ref` enforces the same shape in the database.
 */
export function assertActorRefShape(
  actorType: OrderActorType,
  actorRef: string | null,
  traceId?: string,
): void {
  if (actorType === "system") {
    if (actorRef != null) {
      fail(
        "ORDER_ACTOR_REF_FORBIDDEN",
        "الفاعل system لا يحمل مُعرّفاً",
        traceId,
        { field: "actor_ref", expected: "null", actual: actorRef },
      );
    }
    return;
  }
  if (actorRef == null) {
    fail(
      "ORDER_ACTOR_REF_REQUIRED",
      `الفاعل ${actorType} يستلزم مُعرّفاً عاماً`,
      traceId,
      { field: "actor_ref", expected: "WS-##########" },
    );
  }
  if (!WASLA_PUBLIC_ID_PATTERN.test(actorRef)) {
    fail(
      "ORDER_VALIDATION_FAILED",
      `مُعرّف الفاعل ${actorRef} لا يطابق صيغة المُعرّف العام`,
      traceId,
      { field: "actor_ref", expected: "WS-##########", actual: actorRef },
    );
  }
}

/** An opaque public id reference must at least look like one. */
export function assertPublicIdShape(
  field: string,
  value: string,
  traceId?: string,
): void {
  if (!WASLA_PUBLIC_ID_PATTERN.test(value)) {
    fail(
      "ORDER_VALIDATION_FAILED",
      `${field} لا يطابق صيغة المُعرّف العام`,
      traceId,
      { field, expected: "WS-##########", actual: value },
    );
  }
}

function assertMoney(money: Money, traceId?: string): void {
  if (!Number.isInteger(money.amountMinor) || money.amountMinor < 0) {
    fail(
      "ORDER_VALIDATION_FAILED",
      "المبلغ يجب أن يكون عدداً صحيحاً غير سالب بالوحدات الصغرى",
      traceId,
      { field: "offered_price.amount_minor", actual: String(money.amountMinor) },
    );
  }
  if (!/^[A-Z]{3}$/.test(money.currency)) {
    fail(
      "ORDER_VALIDATION_FAILED",
      "العملة يجب أن تكون رمزاً من ثلاثة أحرف كبيرة",
      traceId,
      { field: "offered_price.currency", actual: money.currency },
    );
  }
}

/**
 * `customer_offer` requires an amount; `negotiable` forbids one.
 *
 * Enforced because the pair is what the whole pricing story rests on: an offer
 * without a number is not an offer, and a number under `negotiable` would be
 * read by Phase 07 as an agreed price nobody agreed to.
 * Mirrors `ck_orders_price_mode_amount`.
 */
export function assertPriceMode(
  priceMode: OrderIntakeCommand["priceMode"],
  offeredPrice: Money | null,
  traceId?: string,
): void {
  if (priceMode === "customer_offer" && offeredPrice == null) {
    fail(
      "ORDER_PRICE_MODE_MISMATCH",
      "وضع customer_offer يستلزم مبلغاً معروضاً",
      traceId,
      { field: "offered_price", expected: "Money" },
    );
  }
  if (priceMode === "negotiable" && offeredPrice != null) {
    fail(
      "ORDER_PRICE_MODE_MISMATCH",
      "وضع negotiable لا يحمل مبلغاً معروضاً",
      traceId,
      { field: "offered_price", expected: "null" },
    );
  }
  if (offeredPrice != null) assertMoney(offeredPrice, traceId);
}

/**
 * Exactly one pickup then one dropoff, in that order (ADR-009 decision 3).
 *
 * The sequence matters and is stored: `ux_order_stops_order_sequence` makes the
 * pair addressable, and a matching engine that cannot tell which end is which
 * cannot compute anything.
 */
export function assertStops(stops: readonly Stop[], traceId?: string): void {
  if (stops.length !== STOPS_PER_ORDER) {
    fail(
      "ORDER_STOPS_INVALID",
      `الطلب يستلزم ${STOPS_PER_ORDER} نقطتين بالضبط`,
      traceId,
      { field: "stops", expected: String(STOPS_PER_ORDER), actual: String(stops.length) },
    );
  }
  if (stops[0]!.kind !== "pickup" || stops[1]!.kind !== "dropoff") {
    fail(
      "ORDER_STOPS_INVALID",
      "الترتيب المطلوب: نقطة انطلاق ثم نقطة وصول",
      traceId,
      { field: "stops", expected: "pickup,dropoff" },
    );
  }
  for (const [index, stop] of stops.entries()) {
    if (!stop.zoneId) {
      fail(
        "ORDER_STOPS_INVALID",
        "كل نقطة تستلزم منطقة — نقطة بلا منطقة غير قابلة للمطابقة",
        traceId,
        { field: `stops[${index}].zone_id` },
      );
    }
    if (stop.label != null && stop.label.length > STOP_LABEL_MAX) {
      fail(
        "ORDER_VALIDATION_FAILED",
        `اسم النقطة أطول من ${STOP_LABEL_MAX} حرفاً`,
        traceId,
        { field: `stops[${index}].label` },
      );
    }
    if (stop.coordinates != null) {
      const { latitude, longitude } = stop.coordinates;
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        fail(
          "ORDER_VALIDATION_FAILED",
          "إحداثيات النقطة خارج المدى الصالح",
          traceId,
          { field: `stops[${index}].coordinates` },
        );
      }
    }
  }
}

/**
 * Shipment details belong to `delivery` only.
 *
 * A ride carrying a parcel weight is a data error that becomes a matching error:
 * Phase 07 would filter vehicles by a weight the trip does not have.
 * Mirrors `ck_orders_shipment_only_delivery`.
 */
export function assertShipment(
  orderType: OrderIntakeCommand["orderType"],
  shipment: ShipmentDetails | null,
  traceId?: string,
): void {
  if (shipment == null) return;
  if (orderType !== "delivery") {
    fail(
      "ORDER_SHIPMENT_NOT_ALLOWED",
      "تفاصيل الشحنة مسموحة لطلبات التوصيل فقط",
      traceId,
      { field: "shipment", expected: "null" },
    );
  }
  if (
    shipment.description != null &&
    shipment.description.length > SHIPMENT_DESCRIPTION_MAX
  ) {
    fail(
      "ORDER_VALIDATION_FAILED",
      `وصف الشحنة أطول من ${SHIPMENT_DESCRIPTION_MAX} حرفاً`,
      traceId,
      { field: "shipment.description" },
    );
  }
  if (
    shipment.weightKg != null &&
    (shipment.weightKg < 0 || shipment.weightKg > SHIPMENT_WEIGHT_MAX)
  ) {
    fail(
      "ORDER_VALIDATION_FAILED",
      `وزن الشحنة خارج المدى 0..${SHIPMENT_WEIGHT_MAX}`,
      traceId,
      { field: "shipment.weight_kg", actual: String(shipment.weightKg) },
    );
  }
}

/** An ISO-8601 instant. Stored as `timestamptz`; parsed here so a bad one never lands. */
export function assertInstant(field: string, value: string, traceId?: string): void {
  if (Number.isNaN(Date.parse(value))) {
    fail("ORDER_VALIDATION_FAILED", `${field} ليس تاريخاً صالحاً`, traceId, {
      field,
      actual: value,
    });
  }
}

/** Everything the engine checks before an order may exist. */
export function assertIntakeCommand(command: OrderIntakeCommand): void {
  const traceId = command.traceId;
  assertPublicIdShape("customer_public_id", command.customerPublicId, traceId);
  assertInstant("requested_at", command.requestedAt, traceId);
  assertPriceMode(command.priceMode, command.offeredPrice, traceId);
  assertStops(command.stops, traceId);
  assertShipment(command.orderType, command.shipment, traceId);
  if (!command.idempotencyKey) {
    fail("ORDER_VALIDATION_FAILED", "مفتاح التكرار إلزامي", traceId, {
      field: "idempotency_key",
    });
  }
}
