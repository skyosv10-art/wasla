/**
 * Wire → domain request mapping for the Order Engine HTTP layer (MR 4/6).
 *
 * The exact inverse of mappers.ts: that file turns domain objects into the
 * snake_case DTOs the contract publishes, this one turns request bodies and
 * headers into the shapes `intakeCommandFromWire` / `transitionCommandFromWire`
 * and the use cases accept. Both directions live outside the domain: the wire
 * naming convention never reaches the model, and the model never decides what
 * the wire looks like (ADR-004 Contract First).
 *
 * The division of labour with domain/validation.ts is the one that file already
 * declared in its header, and it is narrow:
 *
 *  - HERE: **shape and closed enums** — «is the body a JSON object», «is `stops`
 *    an array», «is `order_type` a member of the published enum», «is the
 *    `Idempotency-Key` header present and within 8..128». All of it answers 400
 *    `ORDER_VALIDATION_FAILED`, because the caller sent something the contract
 *    does not describe;
 *  - THERE: every rule with meaning — price coherence, stop pair, shipment
 *    placement, reason catalog, actor shape, lengths, coordinate ranges — each
 *    with its own documented code, most of them 422.
 *
 * Nothing is validated twice, and nothing that has meaning is validated ONLY
 * here: Phase 07 will call these use cases in-process, so a rule enforced at this
 * layer alone would be a rule the matching engine bypasses. The enum check is the
 * one thing that must live at the edge — a TypeScript union cannot reject a
 * string that arrives at runtime — and even that check reads its members from the
 * contract package (`ORDER_TYPES`, …), never from a literal copied into this
 * file.
 *
 * Header rules, and why they are enforced before anything else:
 *
 *  - `Idempotency-Key` is mandatory on EVERY write (§43). The system's entry
 *    point is a bot and a double tap is an ordinary event, so a write without a
 *    key is refused rather than accepted-and-hoped-about. Refused at the edge
 *    with 400 because the catalog has no separate «missing key» code: the key is
 *    a contract-declared request parameter, and its absence is a malformed
 *    request, not a business conflict (409 is reserved for a REUSED key);
 *  - `X-Customer-Public-Id` is mandatory on the two read routes and scopes them
 *    to the owner. Another customer's order answers 404, never 403 — see app.ts;
 *  - `x-request-id` is optional and becomes `trace_id`. It is length-checked
 *    (≤128) because it is stored in the audit row and in the event envelope, and
 *    an over-long value would otherwise surface as a database CHECK violation,
 *    i.e. as a 503 for what is plainly a caller mistake.
 */

import {
  ORDER_ACTOR_TYPES,
  ORDER_ASSIGNMENT_RESOLUTIONS,
  ORDER_PRICE_MODES,
  ORDER_SHIPMENT_TYPES,
  ORDER_STOP_KINDS,
  ORDER_STOP_SOURCES,
  ORDER_TYPES,
  ORDER_VEHICLE_CLASSES,
  ORDER_PUBLIC_ID_PATTERN,
  type AgreedPriceRecord,
  type OrderIntakeRequest,
  type TransitionRequest,
} from "@wasla/contracts-order";

import { OrderError } from "../domain/errors.js";
import type { OrderAssignmentState, OrderReasonCode } from "../domain/model.js";
import {
  assertPublicIdShape,
  assertReasonCodeKnown,
  isKnownStatus,
} from "../domain/validation.js";

/** Bounds the contract declares on the two headers this layer reads. */
const IDEMPOTENCY_KEY_MIN = 8;
const IDEMPOTENCY_KEY_MAX = 128;
const REQUEST_ID_MAX = 128;

/** A UUID in any version — the format the contract gives every id it accepts. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Raw Fastify headers: a value may be absent, a string, or repeated. */
export type RequestHeaders = Record<string, string | string[] | undefined>;

function invalid(message: string, field?: string, traceId?: string): OrderError {
  return new OrderError("ORDER_VALIDATION_FAILED", message, {
    traceId,
    details: field == null ? undefined : { field },
  });
}

/**
 * A header as a single string.
 *
 * A repeated header is refused rather than resolved by taking the first value:
 * two `Idempotency-Key` values mean the caller does not know which write it is
 * making, and picking one for it would turn ambiguity into a silent choice.
 */
function singleHeader(
  headers: RequestHeaders,
  name: string,
  traceId?: string,
): string | undefined {
  const raw = headers[name.toLowerCase()];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) {
    throw invalid(`الترويسة ${name} مُكرَّرة`, name, traceId);
  }
  const value = raw.trim();
  return value.length === 0 ? undefined : value;
}

/** The mandatory `Idempotency-Key` of a write, within its contract bounds. */
export function requireIdempotencyKey(
  headers: RequestHeaders,
  traceId?: string,
): string {
  const key = singleHeader(headers, "Idempotency-Key", traceId);
  if (key === undefined) {
    throw invalid(
      "ترويسة Idempotency-Key إلزامية على كل كتابة",
      "Idempotency-Key",
      traceId,
    );
  }
  if (key.length < IDEMPOTENCY_KEY_MIN || key.length > IDEMPOTENCY_KEY_MAX) {
    throw invalid(
      `طول Idempotency-Key يجب أن يكون بين ${IDEMPOTENCY_KEY_MIN} و${IDEMPOTENCY_KEY_MAX}`,
      "Idempotency-Key",
      traceId,
    );
  }
  return key;
}

/**
 * The body's optional `idempotency_key` must not contradict the header.
 *
 * The contract declares the key in both places: as the mandatory
 * `Idempotency-Key` header and as an optional body field mirrored from the
 * customer contract. Two different values in one request means the caller
 * disagrees with itself about which write this is, and silently preferring one
 * would decide, on its behalf, whether a retry is a retry. The header wins when
 * they agree, because it is the parameter the contract marks required.
 */
export function assertIdempotencyKeyAgreement(
  raw: unknown,
  headerKey: string,
  traceId?: string,
): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
  const bodyKey = (raw as Record<string, unknown>).idempotency_key;
  if (bodyKey === undefined || bodyKey === null) return;
  if (typeof bodyKey !== "string" || bodyKey !== headerKey) {
    throw new OrderError(
      "ORDER_VALIDATION_FAILED",
      "idempotency_key في الجسم يخالف ترويسة Idempotency-Key",
      {
        traceId,
        details: { field: "idempotency_key", expected: headerKey },
      },
    );
  }
}

/** The mandatory owner scope of a read, checked for public-id shape. */
export function requireCustomerScope(
  headers: RequestHeaders,
  traceId?: string,
): string {
  const scope = singleHeader(headers, "X-Customer-Public-Id", traceId);
  if (scope === undefined) {
    throw invalid(
      "ترويسة X-Customer-Public-Id إلزامية على القراءة",
      "X-Customer-Public-Id",
      traceId,
    );
  }
  assertPublicIdShape("X-Customer-Public-Id", scope, traceId);
  return scope;
}

/**
 * The optional `x-request-id`, length-checked.
 *
 * Fastify has already turned the header (or its own generated id) into
 * `request.id`; this function only refuses a caller-supplied value the audit
 * column cannot store.
 */
export function assertRequestIdLength(
  headers: RequestHeaders,
  traceId?: string,
): void {
  const requestId = singleHeader(headers, "x-request-id", traceId);
  if (requestId !== undefined && requestId.length > REQUEST_ID_MAX) {
    throw invalid(
      `طول x-request-id يتجاوز ${REQUEST_ID_MAX}`,
      "x-request-id",
      traceId,
    );
  }
}

/**
 * How the caller referenced the order in the path.
 *
 * The contract types `{orderId}` as a UUID, and a UUID is what this service
 * hands out internally. But `POST /orders/intake` answers with
 * `order_public_id` ONLY (`OrderIntakeResult`), so the customers service — the
 * one caller that exists — never learns the UUID and could not read back the
 * order it just created. `getOrderDetailByPublicId` exists in MR 2/6 for exactly
 * that reason, so the path accepts both forms.
 *
 * This is a **declared, contract-compatible superset**: every request the
 * published contract describes is served unchanged, and `ORD-##########` is
 * additionally accepted. It is recorded as declared deviation 2 in
 * docs/04-api/ORDER_HTTP.md together with the follow-up (widen the contract's
 * `orderId` schema, or add `order_id` to `OrderIntakeResult`, in MR 5/6 —
 * whichever the handover proves it needs). Anything that is neither form is a
 * 400, never a 404: a malformed id is a caller mistake, and answering «not
 * found» would let a typo look like a deleted order.
 */
export type OrderRef =
  | { readonly kind: "id"; readonly value: string }
  | { readonly kind: "publicId"; readonly value: string };

export function toOrderRef(raw: unknown, traceId?: string): OrderRef {
  if (typeof raw !== "string" || raw.length === 0) {
    throw invalid("مُعرّف الطلب مفقود", "orderId", traceId);
  }
  if (UUID_PATTERN.test(raw)) return { kind: "id", value: raw };
  if (ORDER_PUBLIC_ID_PATTERN.test(raw)) return { kind: "publicId", value: raw };
  throw invalid(
    "مُعرّف الطلب يجب أن يكون UUID أو ORD-##########",
    "orderId",
    traceId,
  );
}

/** An assignment id from the path. UUID only — it is never published in another form. */
export function toAssignmentId(raw: unknown, traceId?: string): string {
  if (typeof raw !== "string" || !UUID_PATTERN.test(raw)) {
    throw invalid("مُعرّف الإسناد يجب أن يكون UUID", "assignmentId", traceId);
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Body shapes
// ---------------------------------------------------------------------------

function asObject(raw: unknown, what: string, traceId?: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw invalid(`${what} يجب أن يكون كائن JSON`, what, traceId);
  }
  return raw as Record<string, unknown>;
}

function requireString(
  body: Record<string, unknown>,
  field: string,
  traceId?: string,
): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(`${field} إلزامي ويجب أن يكون نصاً`, field, traceId);
  }
  return value;
}

function optionalString(
  body: Record<string, unknown>,
  field: string,
  traceId?: string,
): string | null {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw invalid(`${field} يجب أن يكون نصاً`, field, traceId);
  }
  return value;
}

/** A member of a closed contract enum, or 400 naming the field. */
function requireEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  catalog: readonly T[],
  traceId?: string,
): T {
  const value = requireString(body, field, traceId);
  if (!(catalog as readonly string[]).includes(value)) {
    throw new OrderError(
      "ORDER_VALIDATION_FAILED",
      `${field} = ${value} ليس عضواً في القائمة المُقفلة`,
      { traceId, details: { field, expected: catalog.join("|"), actual: value } },
    );
  }
  return value as T;
}

/** A member of a closed enum, or `null` when absent. Present-but-unknown is 400. */
function optionalEnum<T extends string>(
  source: Record<string, unknown>,
  field: string,
  catalog: readonly T[],
  traceId?: string,
): T | null {
  const value = source[field];
  if (value === undefined || value === null) return null;
  return requireEnum(source, field, catalog, traceId);
}

function optionalNumber(
  source: Record<string, unknown>,
  field: string,
  traceId?: string,
): number | null {
  const value = source[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(`${field} يجب أن يكون عدداً`, field, traceId);
  }
  return value;
}

/** The record endpoint closes its body so a misspelled financial field is never ignored. */
function assertOnlyFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
  traceId?: string,
): void {
  for (const field of Object.keys(body)) {
    if (!allowed.includes(field)) {
      throw invalid(`${field} ليس حقلاً منشوراً في هذا الجسم`, field, traceId);
    }
  }
}

/** `POST /orders/agreed-prices` body → a complete negotiation record. */
export function toAgreedPriceRecord(raw: unknown, traceId?: string): AgreedPriceRecord {
  const body = asObject(raw, "جسم السعر المتفق عليه", traceId);
  assertOnlyFields(
    body,
    [
      "order_public_id",
      "negotiation_id",
      "driver_public_id",
      "amount_minor",
      "currency",
      "agreed_at",
    ],
    traceId,
  );
  const orderPublicId = requireString(body, "order_public_id", traceId);
  if (!ORDER_PUBLIC_ID_PATTERN.test(orderPublicId)) {
    throw invalid("order_public_id يجب أن يكون ORD-##########", "order_public_id", traceId);
  }
  const negotiationId = requireString(body, "negotiation_id", traceId);
  if (!UUID_PATTERN.test(negotiationId)) {
    throw invalid("negotiation_id يجب أن يكون UUID", "negotiation_id", traceId);
  }
  const amountMinor = body.amount_minor;
  if (
    typeof amountMinor !== "number" ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 1
  ) {
    throw invalid("amount_minor يجب أن يكون عدداً صحيحاً موجباً", "amount_minor", traceId);
  }
  const currency = requireString(body, "currency", traceId);
  if (!/^[A-Z]{3}$/u.test(currency)) {
    throw invalid("currency يجب أن تكون رمز ISO من ثلاثة أحرف كبيرة", "currency", traceId);
  }
  const agreedAt = requireString(body, "agreed_at", traceId);
  if (Number.isNaN(Date.parse(agreedAt))) {
    throw invalid("agreed_at يجب أن يكون تاريخاً ووقتاً صالحين", "agreed_at", traceId);
  }
  const driverPublicId = requireString(body, "driver_public_id", traceId);
  assertPublicIdShape("driver_public_id", driverPublicId, traceId);
  return {
    order_public_id: orderPublicId,
    negotiation_id: negotiationId,
    driver_public_id: driverPublicId,
    amount_minor: amountMinor,
    currency,
    agreed_at: agreedAt,
  };
}

/**
 * `POST /orders/intake` body → the contract DTO, shape-checked only.
 *
 * The result is handed to `intakeCommandFromWire` and then to
 * `assertIntakeCommand`, which owns every rule with meaning. This function's
 * whole job is to guarantee the mapper never reads a field of the wrong kind —
 * a `stops` that is a string, an `offered_price` that is a number — because that
 * would surface deep inside the domain as a type error, i.e. as a 503 for a
 * malformed request.
 */
export function toIntakeRequest(raw: unknown, traceId?: string): OrderIntakeRequest {
  const body = asObject(raw, "جسم الطلب", traceId);

  const rawStops = body.stops;
  if (!Array.isArray(rawStops)) {
    throw invalid("stops يجب أن تكون مصفوفة", "stops", traceId);
  }
  const stops = rawStops.map((rawStop, index) => {
    const stop = asObject(rawStop, `stops[${index}]`, traceId);
    return {
      kind: requireEnum(stop, "kind", ORDER_STOP_KINDS, traceId),
      zone_id: requireString(stop, "zone_id", traceId),
      label: optionalString(stop, "label", traceId),
      source: requireEnum(stop, "source", ORDER_STOP_SOURCES, traceId),
      saved_place_id: optionalString(stop, "saved_place_id", traceId),
      latitude: optionalNumber(stop, "latitude", traceId),
      longitude: optionalNumber(stop, "longitude", traceId),
    };
  });

  let offeredPrice: OrderIntakeRequest["offered_price"] = null;
  if (body.offered_price !== undefined && body.offered_price !== null) {
    const money = asObject(body.offered_price, "offered_price", traceId);
    const amountMinor = money.amount_minor;
    if (typeof amountMinor !== "number") {
      throw invalid(
        "offered_price.amount_minor يجب أن يكون عدداً",
        "offered_price.amount_minor",
        traceId,
      );
    }
    offeredPrice = {
      amount_minor: amountMinor,
      currency: requireString(money, "currency", traceId),
    };
  }

  let shipment: OrderIntakeRequest["shipment"] = null;
  if (body.shipment !== undefined && body.shipment !== null) {
    const details = asObject(body.shipment, "shipment", traceId);
    shipment = {
      shipment_type: optionalEnum(
        details,
        "shipment_type",
        ORDER_SHIPMENT_TYPES,
        traceId,
      ),
      description: optionalString(details, "description", traceId),
      weight_kg: optionalNumber(details, "weight_kg", traceId),
    };
  }

  return {
    order_request_id: requireString(body, "order_request_id", traceId),
    customer_public_id: requireString(body, "customer_public_id", traceId),
    order_type: requireEnum(body, "order_type", ORDER_TYPES, traceId),
    vehicle_class: requireEnum(body, "vehicle_class", ORDER_VEHICLE_CLASSES, traceId),
    price_mode: requireEnum(body, "price_mode", ORDER_PRICE_MODES, traceId),
    offered_price: offeredPrice,
    stops,
    shipment,
    notes: optionalString(body, "notes", traceId),
    requested_at: requireString(body, "requested_at", traceId),
  };
}

/**
 * `POST /orders/{orderId}/transitions` body → the contract DTO.
 *
 * `to_status` is checked against the lifecycle here, at the edge, because an
 * unknown status is a malformed request (400) and not an illegal transition
 * (409): the pair (`current`, `"shipped"`) is not «refused by the table», it is
 * a status that does not exist. Conflating the two would tell the caller its
 * order is in the wrong state when in fact its vocabulary is.
 *
 * `reason_code` is passed through as text: `transitionCommandFromWire` checks it
 * against the closed catalog and raises the documented
 * `ORDER_REASON_CODE_UNKNOWN`.
 */
export function toTransitionRequest(raw: unknown, traceId?: string): TransitionRequest {
  const body = asObject(raw, "جسم الطلب", traceId);
  const toStatus = requireString(body, "to_status", traceId);
  if (!isKnownStatus(toStatus)) {
    throw new OrderError(
      "ORDER_VALIDATION_FAILED",
      `to_status = ${toStatus} ليس حالة معروفة`,
      { traceId, details: { field: "to_status", actual: toStatus } },
    );
  }
  const reasonCode = optionalString(body, "reason_code", traceId);
  return {
    to_status: toStatus,
    actor_type: requireEnum(body, "actor_type", ORDER_ACTOR_TYPES, traceId),
    actor_ref: optionalString(body, "actor_ref", traceId),
    ...(reasonCode == null ? {} : { reason_code: reasonCode }),
  };
}

/** `POST /orders/{orderId}/assignments` body → the driver reference it records. */
export function toAssignmentDriver(raw: unknown, traceId?: string): string {
  const body = asObject(raw, "جسم الطلب", traceId);
  const driverPublicId = requireString(body, "driver_public_id", traceId);
  assertPublicIdShape("driver_public_id", driverPublicId, traceId);
  return driverPublicId;
}

/** The resolution `PATCH .../assignments/{assignmentId}` asks for. */
export interface AssignmentResolutionBody {
  readonly state: Exclude<OrderAssignmentState, "offered">;
  readonly reasonCode: OrderReasonCode | null;
}

/**
 * `PATCH` body → the resolution.
 *
 * `offered` is refused by the enum itself: it is where an offer starts, so
 * "resolve it to offered" is not a state change the contract describes.
 *
 * The reason code is checked against the closed catalog here — the same check
 * `transitionCommandFromWire` performs for a transition — because the contract
 * types it as plain text and `ResolveAssignmentCommand` types it as a catalog
 * member: without the check, an unknown code would be carried inward as if it
 * were one.
 */
export function toAssignmentResolution(
  raw: unknown,
  traceId?: string,
): AssignmentResolutionBody {
  const body = asObject(raw, "جسم الطلب", traceId);
  const reasonCode = optionalString(body, "reason_code", traceId);
  assertReasonCodeKnown(reasonCode, traceId);
  return {
    state: requireEnum(body, "assignment_state", ORDER_ASSIGNMENT_RESOLUTIONS, traceId),
    reasonCode: reasonCode as OrderReasonCode | null,
  };
}
