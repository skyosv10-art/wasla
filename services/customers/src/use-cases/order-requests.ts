/**
 * Order-request use cases: preview, submit, read.
 *
 * This is where the phase boundary lives (ADR-009 §3). The service validates an
 * intent and hands it over through `OrderIntakePort`; it never writes an order,
 * never mints `order_public_id`, and holds no order state — `status` here is the
 * state of the *handover*, not of the order.
 */

import { CustomerError, isOrderIntakeFailure } from "../domain/errors.js";
import {
  customerOrderRequestSubmissionFailed,
  customerOrderRequestSubmitted,
} from "../domain/events.js";
import type {
  CustomerOrderRequest,
  CustomerProfile,
  OrderRequestDraft,
  OrderRequestStatus,
  OrderRequestWarning,
  Stop,
  ZoneReference,
} from "../domain/model.js";
import {
  assertIdempotencyKey,
  assertWaslaPublicId,
  normalizeOrderRequestDraft,
  orderRequestFingerprint,
  orderRequestWarnings,
  type NormalizedOrderRequest,
} from "../domain/validation.js";
import type { OrderIntakeRequestInput } from "../ports.js";
import { eventContext, type UseCaseDeps } from "./deps.js";
import { requireActiveZone } from "./zones.js";

/** A customer must have a profile to order, and a suspended one may not order. */
async function requireOrderingProfile(
  deps: UseCaseDeps,
  waslaPublicId: string,
): Promise<CustomerProfile> {
  const profile = await deps.repo.findProfile(waslaPublicId);
  if (!profile) {
    throw new CustomerError(
      "CUSTOMER_PROFILE_NOT_FOUND",
      "لا يوجد ملف عميل لهذا المعرّف",
    );
  }
  if (profile.status !== "active") {
    throw new CustomerError("CUSTOMER_PROFILE_SUSPENDED", "ملف العميل موقوف");
  }
  return profile;
}

/**
 * Resolve everything a request references: the zone of each stop and, when a
 * stop came from a saved place, that the place belongs to this customer. Runs
 * before any write so a rejected request leaves nothing behind.
 */
async function resolveStops(
  deps: UseCaseDeps,
  waslaPublicId: string,
  request: NormalizedOrderRequest,
): Promise<{ stops: Stop[]; zones: ZoneReference[] }> {
  const zones: ZoneReference[] = [];
  const stops: Stop[] = [];

  for (const [index, stop] of request.stops.entries()) {
    zones.push(await requireActiveZone(deps.geography, stop.zoneId));

    if (stop.savedPlaceId !== null) {
      const place = await deps.repo.findPlace(waslaPublicId, stop.savedPlaceId);
      if (!place) {
        throw new CustomerError(
          "CUSTOMER_PLACE_NOT_FOUND",
          "المكان المحفوظ غير موجود",
        );
      }
    }

    stops.push({
      kind: stop.kind,
      // Sequence is the position in the ordered list, which is what makes
      // Multi-stop (Phase 13) a policy change rather than a migration.
      sequence: index + 1,
      zoneId: stop.zoneId,
      label: stop.label,
      coordinates: stop.coordinates,
      source: stop.source,
      savedPlaceId: stop.savedPlaceId,
    });
  }

  return { stops, zones };
}

/** Record that the saved places behind the stops were used, for bot ordering. */
async function touchUsedPlaces(
  deps: UseCaseDeps,
  waslaPublicId: string,
  stops: readonly Stop[],
  usedAt: string,
): Promise<void> {
  for (const stop of stops) {
    if (stop.savedPlaceId !== null) {
      await deps.repo.touchPlace(waslaPublicId, stop.savedPlaceId, usedAt);
    }
  }
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export interface PreviewOrderRequestResult {
  readonly valid: true;
  readonly request: NormalizedOrderRequest;
  readonly stops: readonly Stop[];
  readonly zones: readonly ZoneReference[];
  readonly warnings: readonly OrderRequestWarning[];
}

/**
 * Validate a request and report what would be sent — reads only, writes nothing.
 *
 * Its value is that the customer sees the request before committing to it. The
 * warnings (same zone for pickup and dropoff, no price offered) describe a state
 * that may slow acceptance; they never block submission, because both are
 * legitimate requests (§12.1).
 */
export async function previewOrderRequest(
  deps: UseCaseDeps,
  input: { waslaPublicId: string; draft: OrderRequestDraft },
): Promise<PreviewOrderRequestResult> {
  const waslaPublicId = assertWaslaPublicId(input.waslaPublicId);
  await requireOrderingProfile(deps, waslaPublicId);

  const request = normalizeOrderRequestDraft(input.draft);
  const { stops, zones } = await resolveStops(deps, waslaPublicId, request);

  return {
    valid: true,
    request,
    stops,
    zones,
    warnings: orderRequestWarnings(request),
  };
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export interface SubmitOrderRequestInput {
  readonly waslaPublicId: string;
  readonly idempotencyKey: string;
  readonly draft: OrderRequestDraft;
}

export interface SubmitOrderRequestResult {
  readonly orderRequest: CustomerOrderRequest;
  /** True when the key had already been used with the same payload. */
  readonly replayed: boolean;
}

function intakePayload(
  request: CustomerOrderRequest,
  requestedAt: string,
): OrderIntakeRequestInput {
  return {
    orderRequestId: request.id,
    customerPublicId: request.waslaPublicId,
    orderType: request.orderType,
    vehicleClass: request.vehicleClass,
    priceMode: request.priceMode,
    offeredPrice: request.offeredPrice,
    stops: request.stops,
    shipment: request.shipment,
    notes: request.notes,
    requestedAt,
    // The customer's key travels with the payload so the engine can deduplicate
    // on its own side too — a retried handover must not create two orders.
    idempotencyKey: request.idempotencyKey,
  };
}

/**
 * Submit a request to the order engine.
 *
 * Fail-closed (ADR-009 §3 · §53): if the handover does not happen, the request
 * is still stored with `submission_failed` plus its operational reason, a
 * failure event is emitted, and the caller gets 503. The rejected alternative —
 * storing it as if accepted — produces orders nobody owns and nobody is waiting
 * for.
 *
 * A replay of the same key with the same payload returns the stored request
 * without a second handover. A replay of a request whose handover *failed*
 * retries on the same row, because the customer's intent was recorded but never
 * delivered, and a retry that created a second row would be the duplicate the
 * key exists to prevent.
 */
export async function submitOrderRequest(
  deps: UseCaseDeps,
  input: SubmitOrderRequestInput,
): Promise<SubmitOrderRequestResult> {
  const waslaPublicId = assertWaslaPublicId(input.waslaPublicId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  await requireOrderingProfile(deps, waslaPublicId);

  const request = normalizeOrderRequestDraft(input.draft);
  const fingerprint = orderRequestFingerprint(request);

  const previous = await deps.repo.findOrderRequestByIdempotencyKey(
    waslaPublicId,
    idempotencyKey,
  );

  if (previous) {
    if (orderRequestFingerprint(previous) !== fingerprint) {
      throw new CustomerError(
        "CUSTOMER_IDEMPOTENCY_KEY_REUSED",
        "المفتاح نفسه استُعمل بحمولة مختلفة",
      );
    }
    if (previous.status === "submitted") {
      return { orderRequest: previous, replayed: true };
    }
    return {
      orderRequest: await retryHandover(deps, previous),
      replayed: true,
    };
  }

  const { stops } = await resolveStops(deps, waslaPublicId, request);
  const id = deps.idGen.uuid();
  const createdAt = deps.clock.now();

  // The handover is attempted before the row is written so a single insert can
  // record a completed attempt: either accepted with the engine's reference, or
  // failed with its reason. No row ever claims a handover that is still pending.
  const attempt = await attemptHandover(deps, {
    orderRequestId: id,
    customerPublicId: waslaPublicId,
    orderType: request.orderType,
    vehicleClass: request.vehicleClass,
    priceMode: request.priceMode,
    offeredPrice: request.offeredPrice,
    stops,
    shipment: request.shipment,
    notes: request.notes,
    requestedAt: createdAt,
    idempotencyKey,
  });

  const stored = await deps.repo.insertOrderRequest({
    id,
    waslaPublicId,
    idempotencyKey,
    status: attempt.status,
    orderType: request.orderType,
    vehicleClass: request.vehicleClass,
    priceMode: request.priceMode,
    offeredPrice: request.offeredPrice,
    stops,
    shipment: request.shipment,
    notes: request.notes,
    orderPublicId: attempt.orderPublicId,
    submittedAt: attempt.submittedAt,
    failureReasonCode: attempt.failureReasonCode,
    createdAt,
  });

  await touchUsedPlaces(deps, waslaPublicId, stops, createdAt);
  await emitOutcome(deps, stored);

  if (stored.status === "submission_failed") {
    throw intakeUnavailable(deps, stored.failureReasonCode);
  }
  return { orderRequest: stored, replayed: false };
}

interface HandoverAttempt {
  readonly status: OrderRequestStatus;
  readonly orderPublicId: string | null;
  readonly submittedAt: string | null;
  readonly failureReasonCode: CustomerOrderRequest["failureReasonCode"];
}

/** Call the port and translate its outcome — never let it throw past here. */
async function attemptHandover(
  deps: UseCaseDeps,
  payload: OrderIntakeRequestInput,
): Promise<HandoverAttempt> {
  try {
    const result = await deps.orderIntake.submitOrderRequest(payload);
    return {
      status: "submitted",
      orderPublicId: result.orderPublicId,
      submittedAt: result.acceptedAt,
      failureReasonCode: null,
    };
  } catch (error) {
    if (isOrderIntakeFailure(error)) {
      return {
        status: "submission_failed",
        orderPublicId: null,
        submittedAt: null,
        failureReasonCode: error.reasonCode,
      };
    }
    // An adapter that throws something else is a defect, not a known failure
    // mode; it must not be silently recorded as an unavailable engine.
    throw error;
  }
}

/** Retry the handover for a stored request that previously failed. */
async function retryHandover(
  deps: UseCaseDeps,
  stored: CustomerOrderRequest,
): Promise<CustomerOrderRequest> {
  const now = deps.clock.now();
  const attempt = await attemptHandover(deps, intakePayload(stored, now));
  const updated = await deps.repo.updateOrderRequestOutcome(stored.id, {
    status: attempt.status,
    orderPublicId: attempt.orderPublicId,
    submittedAt: attempt.submittedAt,
    failureReasonCode: attempt.failureReasonCode,
    updatedAt: now,
  });

  await emitOutcome(deps, updated);
  if (updated.status === "submission_failed") {
    throw intakeUnavailable(deps, updated.failureReasonCode);
  }
  return updated;
}

/** One event per completed attempt: accepted or failed, never neither. */
async function emitOutcome(
  deps: UseCaseDeps,
  request: CustomerOrderRequest,
): Promise<void> {
  if (request.status === "submitted") {
    await deps.outbox.append(
      customerOrderRequestSubmitted(request, eventContext(deps)),
    );
    return;
  }
  await deps.outbox.append(
    customerOrderRequestSubmissionFailed(
      request,
      request.failureReasonCode ?? "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
      eventContext(deps),
    ),
  );
}

/**
 * The customer always hears one code; the operational reason travels in the
 * error object and the event, because the distinction is for running the system,
 * not for the customer.
 */
function intakeUnavailable(
  deps: UseCaseDeps,
  reasonCode: CustomerOrderRequest["failureReasonCode"],
): CustomerError {
  return new CustomerError(
    "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
    "تعذّر تسليم الطلب إلى محرّك الطلبات",
    {
      ...(deps.traceId === undefined ? {} : { traceId: deps.traceId }),
      reasonCode: reasonCode ?? "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
    },
  );
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Read one request. Scoped to its owner: another customer's id is a 404. */
export async function getOrderRequest(
  deps: UseCaseDeps,
  input: { waslaPublicId: string; orderRequestId: string },
): Promise<CustomerOrderRequest> {
  const waslaPublicId = assertWaslaPublicId(input.waslaPublicId);
  const request = await deps.repo.findOrderRequest(
    waslaPublicId,
    input.orderRequestId,
  );
  if (!request) {
    throw new CustomerError(
      "CUSTOMER_ORDER_REQUEST_NOT_FOUND",
      "طلب العميل غير موجود",
    );
  }
  return request;
}

/** List a customer's requests, newest first. */
export async function listOrderRequests(
  deps: UseCaseDeps,
  input: {
    waslaPublicId: string;
    status?: OrderRequestStatus;
    limit?: number;
  },
): Promise<CustomerOrderRequest[]> {
  const waslaPublicId = assertWaslaPublicId(input.waslaPublicId);
  return deps.repo.listOrderRequests(waslaPublicId, {
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
}
