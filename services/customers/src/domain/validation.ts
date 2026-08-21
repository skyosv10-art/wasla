/**
 * Pure validation for Customer Core inputs.
 *
 * Every rule here is a rule that also exists in the contracts: as an OpenAPI
 * constraint, a schema.sql CHECK, or a documented error code in errors.md. It
 * is restated in the domain because the HTTP layer is not the only entry point
 * (the bot calls use cases directly in MR 5/6), and a rule enforced only at the
 * edge is a rule that can be bypassed.
 *
 * These functions are pure: no clock, no ports, no I/O. They throw
 * CustomerError with a stable code and never mutate their input.
 */

import {
  SAVED_PLACES_LIMIT,
  STOPS_PER_ORDER_REQUEST,
  WASLA_PUBLIC_ID_PATTERN,
} from "@wasla/contracts-customer";

import { CustomerError } from "./errors.js";
import type {
  Coordinates,
  Locale,
  Money,
  OrderRequestDraft,
  OrderRequestWarning,
  OrderType,
  PriceMode,
  SavedPlaceDraft,
  ShipmentDetails,
  ShipmentType,
  StopDraft,
  StopKind,
  StopSource,
  VehicleClass,
} from "./model.js";

export { SAVED_PLACES_LIMIT, STOPS_PER_ORDER_REQUEST, WASLA_PUBLIC_ID_PATTERN };

const LOCALES: readonly Locale[] = ["ar", "en", "ur"];
const ORDER_TYPES: readonly OrderType[] = ["ride", "delivery"];
const PRICE_MODES: readonly PriceMode[] = ["customer_offer", "negotiable"];
const STOP_KINDS: readonly StopKind[] = ["pickup", "dropoff"];
const VEHICLE_CLASSES: readonly VehicleClass[] = [
  "sedan",
  "suv",
  "van",
  "pickup",
  "motorcycle",
  "truck_small",
];
const SHIPMENT_TYPES: readonly ShipmentType[] = [
  "parcel",
  "documents",
  "food",
  "goods",
  "other",
];
const STOP_SOURCES: readonly StopSource[] = [
  "map",
  "telegram_location",
  "link",
  "text_search",
  "saved_place",
  "manual_zone",
];

/** Ordered stop kinds for Phase 04: exactly pickup then dropoff. */
const REQUIRED_STOP_ORDER: readonly StopKind[] = ["pickup", "dropoff"];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const IDEMPOTENCY_KEY_MIN = 8;
const IDEMPOTENCY_KEY_MAX = 128;

const MAX_DISPLAY_NAME = 80;
const MAX_PLACE_LABEL = 60;
const MAX_ADDRESS_TEXT = 160;
const MAX_STOP_LABEL = 160;
const MAX_NOTES = 500;
const MAX_WEIGHT_KG = 3000;

function invalidBody(message: string): CustomerError {
  return new CustomerError("CUSTOMER_INVALID_REQUEST_BODY", message);
}

/** The opaque identity reference must look like one before anything else runs. */
export function assertWaslaPublicId(value: unknown): string {
  if (typeof value !== "string" || !WASLA_PUBLIC_ID_PATTERN.test(value)) {
    throw new CustomerError(
      "CUSTOMER_INVALID_PUBLIC_ID",
      "معرّف Wasla العام غير صالح",
    );
  }
  return value;
}

/**
 * The entry point is a bot, so pressing a button twice is ordinary. A write
 * without a key is rejected before it can create a duplicate (§43).
 */
export function assertIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CustomerError(
      "CUSTOMER_MISSING_IDEMPOTENCY_KEY",
      "ترويسة Idempotency-Key مطلوبة",
    );
  }
  const key = value.trim();
  if (key.length < IDEMPOTENCY_KEY_MIN || key.length > IDEMPOTENCY_KEY_MAX) {
    throw invalidBody("طول مفتاح Idempotency غير مقبول");
  }
  return key;
}

function assertUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw invalidBody(`قيمة ${field} ليست UUID صالحاً`);
  }
  return value;
}

function assertEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw invalidBody(`قيمة ${field} خارج القيم المسموحة`);
  }
  return value as T;
}

function assertText(
  value: unknown,
  field: string,
  max: number,
  { required = false }: { required?: boolean } = {},
): string | null {
  if (value === undefined || value === null) {
    if (required) throw invalidBody(`الحقل ${field} مطلوب`);
    return null;
  }
  if (typeof value !== "string") throw invalidBody(`الحقل ${field} ليس نصاً`);
  const text = value.trim();
  if (required && text.length === 0) throw invalidBody(`الحقل ${field} مطلوب`);
  if (text.length > max) throw invalidBody(`الحقل ${field} أطول من ${max}`);
  return text.length === 0 ? null : text;
}

/**
 * Coordinates are all-or-nothing and range-checked, mirroring the schema CHECK.
 * A half coordinate is a bug that would silently place a stop on the equator.
 */
function normalizeCoordinates(value: unknown): Coordinates | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") throw invalidBody("الإحداثية غير صالحة");
  const { latitude, longitude } = value as Partial<Coordinates>;
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    throw invalidBody("الإحداثية تتطلّب خط عرض وخط طول معاً");
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw invalidBody("خط العرض خارج المدى");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw invalidBody("خط الطول خارج المدى");
  }
  return { latitude, longitude };
}

/** Money must be a positive integer in minor units plus an ISO-4217 code. */
function normalizeMoney(value: unknown): Money {
  if (typeof value !== "object" || value === null) {
    throw invalidBody("المبلغ غير صالح");
  }
  const { amountMinor, currency } = value as Partial<Money>;
  if (typeof amountMinor !== "number" || !Number.isInteger(amountMinor)) {
    throw invalidBody("المبلغ يجب أن يكون عدداً صحيحاً بالوحدة الصغرى");
  }
  if (amountMinor <= 0) throw invalidBody("المبلغ يجب أن يكون أكبر من صفر");
  if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency)) {
    throw invalidBody("رمز العملة يجب أن يكون ثلاثة أحرف كبيرة (ISO-4217)");
  }
  return { amountMinor, currency };
}

/** Locale for a profile; `ar` is the documented default (ADR-006). */
export function normalizeLocale(value: unknown): Locale {
  return assertEnum(value, LOCALES, "preferred_locale");
}

/** A validated profile patch. Absent keys stay absent (they mean "unchanged"). */
export interface NormalizedProfilePatch {
  readonly displayName?: string | null;
  readonly preferredLocale?: Locale;
  readonly defaultZoneId?: string | null;
}

export function normalizeProfilePatch(input: unknown): NormalizedProfilePatch {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object") throw invalidBody("جسم الطلب غير صالح");
  const raw = input as Record<string, unknown>;
  const patch: {
    displayName?: string | null;
    preferredLocale?: Locale;
    defaultZoneId?: string | null;
  } = {};

  if ("displayName" in raw) {
    patch.displayName = assertText(raw.displayName, "display_name", MAX_DISPLAY_NAME);
  }
  if ("preferredLocale" in raw && raw.preferredLocale !== undefined) {
    patch.preferredLocale = normalizeLocale(raw.preferredLocale);
  }
  if ("defaultZoneId" in raw) {
    patch.defaultZoneId =
      raw.defaultZoneId === null || raw.defaultZoneId === undefined
        ? null
        : assertUuid(raw.defaultZoneId, "default_zone_id");
  }
  return patch;
}

/** A validated saved-place draft. */
export interface NormalizedPlaceDraft {
  readonly label: string;
  readonly zoneId: string;
  readonly addressText: string | null;
  readonly coordinates: Coordinates | null;
}

export function normalizePlaceDraft(input: SavedPlaceDraft): NormalizedPlaceDraft {
  const label = assertText(input?.label, "label", MAX_PLACE_LABEL, {
    required: true,
  });
  if (label === null) throw invalidBody("الحقل label مطلوب");
  return {
    label,
    zoneId: assertUuid(input?.zoneId, "zone_id"),
    addressText: assertText(input?.addressText, "address_text", MAX_ADDRESS_TEXT),
    coordinates: normalizeCoordinates(input?.coordinates),
  };
}

/** A validated order-request draft: shape, enums, price coherence, stop count. */
export interface NormalizedOrderRequest {
  readonly orderType: OrderType;
  readonly vehicleClass: VehicleClass;
  readonly priceMode: PriceMode;
  readonly offeredPrice: Money | null;
  readonly stops: readonly NormalizedStop[];
  readonly shipment: ShipmentDetails | null;
  readonly notes: string | null;
}

export interface NormalizedStop {
  readonly kind: StopKind;
  readonly zoneId: string;
  readonly label: string | null;
  readonly coordinates: Coordinates | null;
  readonly source: StopSource;
  readonly savedPlaceId: string | null;
}

function normalizeStop(input: StopDraft, index: number): NormalizedStop {
  if (typeof input !== "object" || input === null) {
    throw invalidBody(`النقطة رقم ${index + 1} غير صالحة`);
  }
  return {
    kind: assertEnum(input.kind, STOP_KINDS, "stops[].kind"),
    zoneId: assertUuid(input.zoneId, "stops[].zone_id"),
    label: assertText(input.label, "stops[].label", MAX_STOP_LABEL),
    coordinates: normalizeCoordinates(input.coordinates),
    source: assertEnum(input.source, STOP_SOURCES, "stops[].source"),
    savedPlaceId:
      input.savedPlaceId === null || input.savedPlaceId === undefined
        ? null
        : assertUuid(input.savedPlaceId, "stops[].saved_place_id"),
  };
}

function normalizeShipment(value: unknown): ShipmentDetails | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") throw invalidBody("تفاصيل الشحنة غير صالحة");
  const raw = value as Record<string, unknown>;
  const shipment: { shipmentType?: ShipmentType; weightKg?: number | null } = {};

  if (raw.shipmentType !== undefined && raw.shipmentType !== null) {
    shipment.shipmentType = assertEnum(
      raw.shipmentType,
      SHIPMENT_TYPES,
      "shipment.shipment_type",
    );
  }
  if (raw.weightKg !== undefined && raw.weightKg !== null) {
    const weight = raw.weightKg;
    if (typeof weight !== "number" || !Number.isFinite(weight)) {
      throw invalidBody("وزن الشحنة ليس عدداً");
    }
    if (weight < 0 || weight > MAX_WEIGHT_KG) {
      throw invalidBody("وزن الشحنة خارج المدى");
    }
    shipment.weightKg = weight;
  }
  // An empty object carries no information; treat it as absent so `ride`
  // requests are not rejected for a shipment that says nothing.
  return Object.keys(shipment).length === 0 ? null : shipment;
}

/**
 * Validate an order-request draft.
 *
 * Order of checks matters: shape first, then the two rules whose violation has
 * its own documented code (price coherence and stop count), so a caller gets
 * the specific 422 rather than a generic 400.
 */
export function normalizeOrderRequestDraft(
  input: OrderRequestDraft,
): NormalizedOrderRequest {
  if (typeof input !== "object" || input === null) {
    throw invalidBody("جسم الطلب غير صالح");
  }

  const orderType = assertEnum(input.orderType, ORDER_TYPES, "order_type");
  const vehicleClass = assertEnum(
    input.vehicleClass,
    VEHICLE_CLASSES,
    "vehicle_class",
  );
  const priceMode = assertEnum(input.priceMode, PRICE_MODES, "price_mode");

  if (!Array.isArray(input.stops)) throw invalidBody("الحقل stops مطلوب");

  // Multi-stop is deferred (§3.2), and it has its own code so the bot can say
  // "not yet" instead of "invalid request".
  if (input.stops.length > STOPS_PER_ORDER_REQUEST) {
    throw new CustomerError(
      "CUSTOMER_MULTI_STOP_NOT_SUPPORTED",
      "أكثر من نقطتين غير مدعوم في هذه المرحلة",
    );
  }
  if (input.stops.length < STOPS_PER_ORDER_REQUEST) {
    throw invalidBody("الطلب يتطلّب نقطة انطلاق ونقطة وصول");
  }

  const stops = input.stops.map(normalizeStop);
  const kinds = stops.map((stop) => stop.kind);
  if (
    kinds.length !== REQUIRED_STOP_ORDER.length ||
    kinds.some((kind, index) => kind !== REQUIRED_STOP_ORDER[index])
  ) {
    throw invalidBody("ترتيب النقاط يجب أن يكون: انطلاق ثم وصول");
  }

  // Price coherence (ADR-009 §6): one mode means one payload shape. A nullable
  // amount that means both "offered nothing" and "negotiating" is the bug this
  // rule prevents.
  let offeredPrice: Money | null = null;
  if (priceMode === "customer_offer") {
    if (input.offeredPrice === undefined || input.offeredPrice === null) {
      throw new CustomerError(
        "CUSTOMER_PRICE_MODE_MISMATCH",
        "وضع العرض يتطلّب مبلغاً",
      );
    }
    offeredPrice = normalizeMoney(input.offeredPrice);
  } else if (input.offeredPrice !== undefined && input.offeredPrice !== null) {
    throw new CustomerError(
      "CUSTOMER_PRICE_MODE_MISMATCH",
      "لا يمكن إرسال مبلغ في الوضع التفاوضي",
    );
  }

  const shipment = normalizeShipment(input.shipment);
  if (shipment !== null && orderType === "ride") {
    throw new CustomerError(
      "CUSTOMER_SHIPMENT_NOT_ALLOWED_FOR_RIDE",
      "تفاصيل الشحنة غير مسموحة في طلب مشوار",
    );
  }

  return {
    orderType,
    vehicleClass,
    priceMode,
    offeredPrice,
    stops,
    shipment,
    notes: assertText(input.notes, "notes", MAX_NOTES),
  };
}

/**
 * Non-blocking observations. These describe a state that may slow acceptance,
 * not an error: the preview shows them, and submission proceeds regardless.
 */
export function orderRequestWarnings(
  request: Pick<NormalizedOrderRequest, "priceMode" | "stops">,
): OrderRequestWarning[] {
  const warnings: OrderRequestWarning[] = [];
  const [first, second] = request.stops;
  if (first && second && first.zoneId === second.zoneId) {
    warnings.push("same_zone_pickup_and_dropoff");
  }
  if (request.priceMode === "negotiable") {
    warnings.push("no_price_offered");
  }
  return warnings;
}

/**
 * Canonical form of a request, used to decide whether a replayed idempotency
 * key carries the same payload. Built from the fields that define the request,
 * so the comparison works against a stored row as well as an incoming body —
 * which is why no fingerprint column exists in schema.sql.
 */
export function orderRequestFingerprint(request: {
  readonly orderType: OrderType;
  readonly vehicleClass: VehicleClass;
  readonly priceMode: PriceMode;
  readonly offeredPrice: Money | null;
  readonly stops: readonly NormalizedStop[];
  readonly shipment: ShipmentDetails | null;
  readonly notes: string | null;
}): string {
  return JSON.stringify([
    request.orderType,
    request.vehicleClass,
    request.priceMode,
    request.offeredPrice
      ? [request.offeredPrice.amountMinor, request.offeredPrice.currency]
      : null,
    request.stops.map((stop) => [
      stop.kind,
      stop.zoneId,
      stop.label,
      stop.coordinates ? [stop.coordinates.latitude, stop.coordinates.longitude] : null,
      stop.source,
      stop.savedPlaceId,
    ]),
    request.shipment
      ? [request.shipment.shipmentType ?? null, request.shipment.weightKg ?? null]
      : null,
    request.notes,
  ]);
}

/** Canonical form of a saved place, for the same idempotency comparison. */
export function placeFingerprint(place: {
  readonly label: string;
  readonly zoneId: string;
  readonly addressText: string | null;
  readonly coordinates: Coordinates | null;
}): string {
  return JSON.stringify([
    place.label.toLowerCase(),
    place.zoneId,
    place.addressText,
    place.coordinates ? [place.coordinates.latitude, place.coordinates.longitude] : null,
  ]);
}
