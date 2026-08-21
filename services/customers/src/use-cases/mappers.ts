/**
 * Domain → API DTO mappers.
 *
 * The published contract is snake_case and the domain is camelCase, and that is
 * deliberate: the wire shape may not drag naming conventions into the domain,
 * and the domain may not leak fields the contract does not publish. Keeping the
 * translation in one file means the HTTP layer (MR 4/6) and the bot (MR 5/6)
 * cannot each invent their own.
 *
 * `toOrderIntakeRequest` is the exception worth naming: it maps to the handover
 * contract the order engine will read (Phase 06), which is why it exists here
 * rather than inside the adapter.
 */

import type {
  Coordinates as CoordinatesDto,
  CustomerProfile as CustomerProfileDto,
  Money as MoneyDto,
  OrderIntakeRequest as OrderIntakeRequestDto,
  OrderRequest as OrderRequestDto,
  OrderRequestPreview as OrderRequestPreviewDto,
  SavedPlace as SavedPlaceDto,
  ShipmentDetails as ShipmentDetailsDto,
  Stop as StopDto,
} from "@wasla/contracts-customer";

import type {
  Coordinates,
  CustomerOrderRequest,
  CustomerProfile,
  Money,
  SavedPlace,
  ShipmentDetails,
  Stop,
  ZoneReference,
} from "../domain/model.js";
import type { OrderIntakeRequestInput } from "../ports.js";
import type { PreviewOrderRequestResult } from "./order-requests.js";

function toCoordinatesDto(
  coordinates: Coordinates | null,
): CoordinatesDto | undefined {
  return coordinates === null
    ? undefined
    : { latitude: coordinates.latitude, longitude: coordinates.longitude };
}

function toMoneyDto(money: Money | null): MoneyDto | undefined {
  return money === null
    ? undefined
    : { amount_minor: money.amountMinor, currency: money.currency };
}

function toShipmentDto(
  shipment: ShipmentDetails | null,
): ShipmentDetailsDto | undefined {
  if (shipment === null) return undefined;
  return {
    ...(shipment.shipmentType === undefined
      ? {}
      : { shipment_type: shipment.shipmentType }),
    ...(shipment.description === undefined
      ? {}
      : { description: shipment.description }),
    ...(shipment.weightKg === undefined ? {} : { weight_kg: shipment.weightKg }),
  };
}

export function toCustomerProfileDto(profile: CustomerProfile): CustomerProfileDto {
  return {
    wasla_public_id: profile.waslaPublicId,
    display_name: profile.displayName,
    preferred_locale: profile.preferredLocale,
    default_zone_id: profile.defaultZoneId,
    status: profile.status,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  };
}

/**
 * `zone_path` is a display convenience resolved from geography when available.
 * It is never stored: the zone id is the truth, and a stale copy of a renamed
 * path would be worse than no path at all.
 */
export function toSavedPlaceDto(
  place: SavedPlace,
  zonePath?: string | null,
): SavedPlaceDto {
  return {
    id: place.id,
    label: place.label,
    zone_id: place.zoneId,
    zone_path: zonePath ?? null,
    address_text: place.addressText,
    coordinates: toCoordinatesDto(place.coordinates),
    last_used_at: place.lastUsedAt,
    created_at: place.createdAt,
  };
}

export function toStopDto(stop: Stop, zonePath?: string | null): StopDto {
  return {
    kind: stop.kind,
    sequence: stop.sequence,
    zone_id: stop.zoneId,
    ...(zonePath === undefined || zonePath === null ? {} : { zone_path: zonePath }),
    label: stop.label,
    coordinates: toCoordinatesDto(stop.coordinates),
    source: stop.source,
    saved_place_id: stop.savedPlaceId,
  };
}

/** Map stops with an optional zone-path lookup keyed by zone id. */
function toStopDtos(
  stops: readonly Stop[],
  zones: readonly ZoneReference[] = [],
): StopDto[] {
  const paths = new Map(zones.map((zone) => [zone.zoneId, zone.path ?? null]));
  return stops.map((stop) => toStopDto(stop, paths.get(stop.zoneId) ?? null));
}

export function toOrderRequestDto(
  request: CustomerOrderRequest,
  zones: readonly ZoneReference[] = [],
): OrderRequestDto {
  return {
    id: request.id,
    wasla_public_id: request.waslaPublicId,
    ...(request.orderPublicId === null
      ? {}
      : { order_public_id: request.orderPublicId }),
    status: request.status,
    order_type: request.orderType,
    vehicle_class: request.vehicleClass,
    price_mode: request.priceMode,
    offered_price: toMoneyDto(request.offeredPrice),
    stops: toStopDtos(request.stops, zones),
    shipment: toShipmentDto(request.shipment),
    notes: request.notes,
    submitted_at: request.submittedAt,
    created_at: request.createdAt,
  };
}

/** The preview DTO: `valid` is a constant `true` because an invalid draft throws. */
export function toOrderRequestPreviewDto(
  preview: PreviewOrderRequestResult,
): OrderRequestPreviewDto {
  return {
    valid: true,
    order_type: preview.request.orderType,
    vehicle_class: preview.request.vehicleClass,
    price_mode: preview.request.priceMode,
    offered_price: toMoneyDto(preview.request.offeredPrice),
    stops: toStopDtos(preview.stops, preview.zones),
    shipment: toShipmentDto(preview.request.shipment),
    notes: preview.request.notes,
    warnings: [...preview.warnings],
  };
}

/** The handover payload, in the exact shape the order engine's contract defines. */
export function toOrderIntakeRequestDto(
  request: OrderIntakeRequestInput,
): OrderIntakeRequestDto {
  return {
    order_request_id: request.orderRequestId,
    customer_public_id: request.customerPublicId,
    order_type: request.orderType,
    vehicle_class: request.vehicleClass,
    price_mode: request.priceMode,
    offered_price: toMoneyDto(request.offeredPrice),
    stops: toStopDtos(request.stops),
    shipment: toShipmentDto(request.shipment),
    notes: request.notes,
    requested_at: request.requestedAt,
    idempotency_key: request.idempotencyKey,
  };
}
