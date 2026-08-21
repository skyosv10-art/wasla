/**
 * Customer Core domain event builders.
 *
 * One factory per event, so the privacy rule is enforced in one place instead of
 * at every call site: payloads carry zone-level location only — never raw
 * coordinates, never text the user authored (place label, address, notes,
 * shipment description, display name). Consumers (analytics, matching,
 * reputation) need the classification, not the content (§12.3 · §48).
 *
 * The presence of user text is still announced where it matters, as a boolean
 * (`has_display_name`, `has_coordinates`), which is information without
 * disclosure. The drift guard for this rule lives in the contracts package.
 */

import type {
  CustomerEvent,
  CustomerOrderRequestSubmissionFailedV1,
  CustomerOrderRequestSubmittedV1,
  CustomerPlaceRemovedV1,
  CustomerPlaceSavedV1,
  CustomerProfileCreatedV1,
  CustomerProfileUpdatedV1,
} from "@wasla/contracts-customer";

import {
  dropoffStop,
  pickupStop,
  type CustomerOrderRequest,
  type CustomerProfile,
  type CustomerProfileField,
  type IntakeFailureReason,
  type SavedPlace,
} from "./model.js";

/** Everything an event needs that the domain does not own. */
export interface EventContext {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly traceId?: string;
}

function envelope(
  ctx: EventContext,
  aggregateType: "customer" | "customer_order_request",
  aggregateId: string,
) {
  return {
    event_id: ctx.eventId,
    event_version: "v1" as const,
    occurred_at: ctx.occurredAt,
    producer: "customers-service" as const,
    aggregate: { type: aggregateType, id: aggregateId },
    ...(ctx.traceId === undefined ? {} : { trace_id: ctx.traceId }),
  };
}

export function customerProfileCreated(
  profile: CustomerProfile,
  ctx: EventContext,
): CustomerProfileCreatedV1 {
  return {
    ...envelope(ctx, "customer", profile.waslaPublicId),
    event_type: "customer.profile.created",
    payload: {
      wasla_public_id: profile.waslaPublicId,
      preferred_locale: profile.preferredLocale,
      default_zone_id: profile.defaultZoneId,
      // The value is never published — only whether one exists.
      has_display_name: profile.displayName !== null,
    },
  };
}

export function customerProfileUpdated(
  profile: CustomerProfile,
  changedFields: readonly CustomerProfileField[],
  ctx: EventContext,
): CustomerProfileUpdatedV1 {
  return {
    ...envelope(ctx, "customer", profile.waslaPublicId),
    event_type: "customer.profile.updated",
    payload: {
      wasla_public_id: profile.waslaPublicId,
      changed_fields: [...changedFields],
      preferred_locale: profile.preferredLocale,
      default_zone_id: profile.defaultZoneId,
    },
  };
}

export function customerPlaceSaved(
  place: SavedPlace,
  ctx: EventContext,
): CustomerPlaceSavedV1 {
  return {
    ...envelope(ctx, "customer", place.waslaPublicId),
    event_type: "customer.place.saved",
    payload: {
      wasla_public_id: place.waslaPublicId,
      place_id: place.id,
      zone_id: place.zoneId,
      // Label, address text and the coordinate pair itself stay out.
      has_coordinates: place.coordinates !== null,
    },
  };
}

export function customerPlaceRemoved(
  place: Pick<SavedPlace, "id" | "waslaPublicId">,
  ctx: EventContext,
): CustomerPlaceRemovedV1 {
  return {
    ...envelope(ctx, "customer", place.waslaPublicId),
    event_type: "customer.place.removed",
    payload: {
      wasla_public_id: place.waslaPublicId,
      place_id: place.id,
    },
  };
}

/**
 * The engine accepted the request.
 *
 * This announces a successful handover, not an order state: the order lifecycle
 * belongs to Phase 06 (§15), and `order_public_id` is a reference this service
 * received rather than minted.
 */
export function customerOrderRequestSubmitted(
  request: CustomerOrderRequest,
  ctx: EventContext,
): CustomerOrderRequestSubmittedV1 {
  const pickup = pickupStop(request.stops);
  const dropoff = dropoffStop(request.stops);
  if (!pickup || !dropoff) {
    throw new Error("order request must carry a pickup and a dropoff stop");
  }
  return {
    ...envelope(ctx, "customer_order_request", request.id),
    event_type: "customer.order_request.submitted",
    payload: {
      order_request_id: request.id,
      customer_public_id: request.waslaPublicId,
      order_public_id: request.orderPublicId,
      order_type: request.orderType,
      vehicle_class: request.vehicleClass,
      price_mode: request.priceMode,
      offered_amount_minor: request.offeredPrice?.amountMinor ?? null,
      currency: request.offeredPrice?.currency ?? null,
      // Zone level only: the stop label and coordinates are not published.
      pickup_zone_id: pickup.zoneId,
      dropoff_zone_id: dropoff.zoneId,
      shipment_type: request.shipment?.shipmentType ?? null,
    },
  };
}

/** The handover did not happen. Failure is announced, never swallowed (§53). */
export function customerOrderRequestSubmissionFailed(
  request: Pick<CustomerOrderRequest, "id" | "waslaPublicId">,
  reasonCode: IntakeFailureReason,
  ctx: EventContext,
): CustomerOrderRequestSubmissionFailedV1 {
  return {
    ...envelope(ctx, "customer_order_request", request.id),
    event_type: "customer.order_request.submission_failed",
    payload: {
      order_request_id: request.id,
      customer_public_id: request.waslaPublicId,
      reason_code: reasonCode,
    },
  };
}

export type { CustomerEvent };
