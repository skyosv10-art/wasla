/**
 * Wire → domain request mapping for the Customer Core HTTP layer (MR 4/6).
 *
 * This is the exact inverse of use-cases/mappers.ts: that file turns domain
 * objects into the snake_case DTOs the contract publishes, this one turns the
 * snake_case request bodies back into the camelCase drafts the domain accepts.
 * Both directions live outside the domain on purpose — the wire naming
 * convention is not allowed to reach the model, and the model is not allowed to
 * decide what the wire looks like (ADR-004 Contract First).
 *
 * The division of labour with domain/validation.ts is deliberate and narrow:
 *
 *  - here: **shape** only — «is the body a JSON object», «is `stops` an array»,
 *    «is `offered_price` an object when present» — thrown as
 *    CUSTOMER_INVALID_REQUEST_BODY;
 *  - there: every rule with meaning — enums, lengths, UUID format, price
 *    coherence, stop count, coordinate ranges — thrown with its own documented
 *    code (including the 422 codes).
 *
 * Nothing is validated twice, and nothing is validated *only* here: the bot in
 * MR 5/6 calls the use cases directly, so a rule enforced at this layer alone
 * would be a rule the bot bypasses.
 *
 * Key presence is preserved, not normalized: `PUT /profile` treats an absent key
 * as «leave as is» and an explicit `null` as «clear it», so this mapper must not
 * turn absence into null (`"display_name" in body` rather than a value check).
 */

import { CustomerError } from "../domain/errors.js";
import type {
  CustomerProfilePatch,
  OrderRequestDraft,
  SavedPlaceDraft,
  ShipmentDetails,
  StopDraft,
} from "../domain/model.js";

function invalidBody(message: string): CustomerError {
  return new CustomerError("CUSTOMER_INVALID_REQUEST_BODY", message);
}

/** Every request body must be a JSON object — not null, not an array. */
function asObject(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw invalidBody(`${what} يجب أن يكون كائن JSON`);
  }
  return raw as Record<string, unknown>;
}

/**
 * A nested object that may be absent or explicitly null. Present-but-not-object
 * is rejected here (shape), while the contents are validated by the domain.
 */
function asOptionalObject(
  raw: unknown,
  what: string,
): Record<string, unknown> | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw invalidBody(`${what} يجب أن يكون كائن JSON`);
  }
  return raw as Record<string, unknown>;
}

/** `{ amount_minor, currency }` → `{ amountMinor, currency }` (unchecked values). */
function toMoneyDraft(raw: unknown): unknown {
  const money = asOptionalObject(raw, "offered_price");
  if (money === undefined || money === null) return money;
  return { amountMinor: money.amount_minor, currency: money.currency };
}

/** Coordinates share their field names with the wire; only the shape is checked. */
function toCoordinatesDraft(raw: unknown, field: string): unknown {
  const coordinates = asOptionalObject(raw, field);
  if (coordinates === undefined || coordinates === null) return coordinates;
  return { latitude: coordinates.latitude, longitude: coordinates.longitude };
}

function toShipmentDraft(raw: unknown): ShipmentDetails | null | undefined {
  const shipment = asOptionalObject(raw, "shipment");
  if (shipment === undefined || shipment === null) return shipment;
  const draft: Record<string, unknown> = {};
  if ("shipment_type" in shipment) draft.shipmentType = shipment.shipment_type;
  if ("description" in shipment) draft.description = shipment.description;
  if ("weight_kg" in shipment) draft.weightKg = shipment.weight_kg;
  return draft as ShipmentDetails;
}

/**
 * `UpsertCustomerProfileRequest` → `CustomerProfilePatch`.
 *
 * A missing body is an empty patch (a no-op upsert that still creates the
 * profile with its defaults), which is why it is not an error: the contract
 * marks every field optional.
 */
export function toProfilePatch(raw: unknown): CustomerProfilePatch {
  const body = raw === undefined || raw === null ? {} : asObject(raw, "جسم الطلب");
  const patch: {
    displayName?: unknown;
    preferredLocale?: unknown;
    defaultZoneId?: unknown;
  } = {};

  if ("display_name" in body) patch.displayName = body.display_name;
  if ("preferred_locale" in body) patch.preferredLocale = body.preferred_locale;
  if ("default_zone_id" in body) patch.defaultZoneId = body.default_zone_id;

  return patch as CustomerProfilePatch;
}

/** `CreateSavedPlaceRequest` → `SavedPlaceDraft`. */
export function toSavedPlaceDraft(raw: unknown): SavedPlaceDraft {
  const body = asObject(raw, "جسم الطلب");
  return {
    label: body.label,
    zoneId: body.zone_id,
    addressText: body.address_text ?? null,
    coordinates: toCoordinatesDraft(body.coordinates, "coordinates"),
  } as SavedPlaceDraft;
}

/** `StopInput` → `StopDraft`. */
function toStopDraft(raw: unknown, index: number): StopDraft {
  const stop = asObject(raw, `النقطة رقم ${index + 1}`);
  return {
    kind: stop.kind,
    zoneId: stop.zone_id,
    label: stop.label ?? null,
    coordinates: toCoordinatesDraft(stop.coordinates, `stops[${index}].coordinates`),
    source: stop.source,
    savedPlaceId: stop.saved_place_id ?? null,
  } as StopDraft;
}

/**
 * `OrderRequestInput` → `OrderRequestDraft`.
 *
 * `stops` must be an array to be mapped at all; its *length* is the domain's
 * business, because too many stops has its own code
 * (CUSTOMER_MULTI_STOP_NOT_SUPPORTED, 422) that this layer must not flatten into
 * a generic 400.
 */
export function toOrderRequestDraft(raw: unknown): OrderRequestDraft {
  const body = asObject(raw, "جسم الطلب");
  if (!Array.isArray(body.stops)) {
    throw invalidBody("الحقل stops يجب أن يكون مصفوفة");
  }

  const draft: Record<string, unknown> = {
    orderType: body.order_type,
    vehicleClass: body.vehicle_class,
    priceMode: body.price_mode,
    stops: body.stops.map(toStopDraft),
    notes: body.notes ?? null,
  };
  if ("offered_price" in body) draft.offeredPrice = toMoneyDraft(body.offered_price);
  if ("shipment" in body) draft.shipment = toShipmentDraft(body.shipment);

  // The cast is deliberately through `unknown`: this layer only rearranges keys
  // and never claims the values are valid — `domain/validation.ts` decides that,
  // and it is the only place allowed to.
  return draft as unknown as OrderRequestDraft;
}

/**
 * The `limit` query parameter of `GET /order-requests`.
 *
 * Absent → undefined (the use case applies its own default). A non-numeric or
 * out-of-range value is rejected rather than clamped: silently returning 20 rows
 * for `limit=abc` hides a caller bug, and the contract already publishes the
 * bounds (1..50).
 */
export function toListLimit(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw invalidBody("قيمة limit يجب أن تكون عدداً صحيحاً بين 1 و50");
  }
  return limit;
}

/**
 * The `Idempotency-Key` header of the two write endpoints.
 *
 * Absence is rejected here because the header is a transport concern the domain
 * cannot see, and it maps to its own documented code
 * (CUSTOMER_MISSING_IDEMPOTENCY_KEY, 400) rather than to a generic invalid body.
 * The key's *length* bounds stay in the domain (assertIdempotencyKey), so the
 * bot gets the same rejection without going through HTTP.
 */
export function requireIdempotencyKey(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new CustomerError(
      "CUSTOMER_MISSING_IDEMPOTENCY_KEY",
      "ترويسة Idempotency-Key مطلوبة",
    );
  }
  return raw;
}
