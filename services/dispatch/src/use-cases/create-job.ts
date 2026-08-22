/**
 * Create a dispatch job.
 *
 * The job is created in `pending` and **no wave is opened here**. Opening wave 1
 * inside the create call is the obvious shortcut and it breaks the one property the
 * whole service rests on: that time advances only in a tick. It would also mean a
 * retried create could produce a second wave, since a wave is not covered by the
 * create idempotency key.
 *
 * Check order — a tested contract, not an accident:
 *   1. shape of the idempotency key, then of the payload
 *   2. idempotency replay (same key, same payload → the original job)
 *   3. idempotency conflict (same key, different payload → 409)
 *   4. one order, one job (409)
 *   5. the order engine agrees the order is searchable
 *   6. local write + event
 *
 * Shape before state so a client can always tell "fix your payload" from "try
 * later", and the engine before the local write so a job never exists for an order
 * the engine refuses to search for — that job would be a promise nobody can keep.
 */
import { computeJobDeadlines } from "../domain/deadlines.js";
import { jobCreatedEvent } from "../domain/events.js";
import {
  engineUnavailable,
  idempotencyKeyReused,
  jobAlreadyExists,
  orderEngineRejected,
  orderEngineTimeout,
} from "../domain/errors.js";
import type { DispatchJob, OrderType, VehicleClass } from "../domain/model.js";
import { orderTransitionKey } from "../domain/keys.js";
import {
  assertIdempotencyKey,
  assertOrderPublicId,
  assertOrderType,
  assertRules,
  assertUuid,
  assertVehicleClass,
  fingerprint,
} from "../domain/validation.js";
import type { DispatchDependencies } from "../ports.js";

export interface CreateJobInput {
  readonly orderId: string;
  readonly orderPublicId: string;
  readonly zoneId: string;
  readonly orderType: OrderType;
  readonly vehicleClass: VehicleClass;
  readonly idempotencyKey: string;
  readonly traceId?: string;
}

export interface CreateJobResult {
  readonly job: DispatchJob;
  /** True when this call was a retry that returned the original job untouched. */
  readonly replayed: boolean;
}

/** The status the order engine must be in for dispatch to start searching. */
export const ORDER_STATUS_WHILE_SEARCHING = "searching" as const;

export async function createDispatchJob(
  deps: DispatchDependencies,
  input: CreateJobInput,
): Promise<CreateJobResult> {
  const traceId = input.traceId;

  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey, traceId);
  const orderId = assertUuid("order_id", input.orderId, traceId);
  const orderPublicId = assertOrderPublicId(input.orderPublicId, traceId);
  const zoneId = assertUuid("zone_id", input.zoneId, traceId);
  const orderType = assertOrderType(input.orderType, traceId);
  const vehicleClass = assertVehicleClass(input.vehicleClass, traceId);

  // The fingerprint covers the payload only — not the key and not the trace id — so
  // retrying the same logical write with fresh tracing is still a retry.
  const payloadFingerprint = fingerprint({
    orderId,
    orderPublicId,
    zoneId,
    orderType,
    vehicleClass,
  });

  const remembered = await deps.idempotency.find(idempotencyKey);
  if (remembered !== null) {
    if (remembered !== payloadFingerprint) throw idempotencyKeyReused(traceId);
    const existing = await deps.jobs.findByIdempotencyKey(idempotencyKey);
    // The key is remembered but the job is gone only if someone deleted a row by
    // hand; treating that as a fresh create would violate the unique index anyway.
    if (existing !== null) return { job: existing, replayed: true };
  }

  const duplicate = await deps.jobs.findByOrderId(orderId);
  if (duplicate !== null) throw jobAlreadyExists(traceId);

  const rules = assertRules(await deps.rules.current(), traceId);
  const jobId = deps.ids.uuid();
  const createdAt = deps.clock.now();
  const deadlines = computeJobDeadlines(createdAt, rules);

  const transition = await deps.orders.transitionOrder({
    orderId,
    to: ORDER_STATUS_WHILE_SEARCHING,
    reasonCode: null,
    idempotencyKey: orderTransitionKey(jobId, ORDER_STATUS_WHILE_SEARCHING, 0),
    traceId,
  });
  switch (transition.outcome) {
    case "applied":
    case "already_applied":
      break;
    case "rejected":
      throw orderEngineRejected(traceId);
    case "timeout":
      throw orderEngineTimeout(traceId);
    case "unavailable":
      throw engineUnavailable(traceId);
  }

  const job = await deps.jobs.insert({
    id: jobId,
    orderId,
    orderPublicId,
    zoneId,
    orderType,
    vehicleClass,
    rules,
    expiresAt: deadlines.expiresAt,
    escalationExpiresAt: deadlines.escalationExpiresAt,
    createdIdempotencyKey: idempotencyKey,
    payloadFingerprint,
    createdAt,
  });

  await deps.outbox.append(
    jobCreatedEvent(
      {
        job_id: job.id,
        order_id: job.orderId,
        order_public_id: job.orderPublicId,
        zone_id: job.zoneId,
        ruleset_version: job.rules.rulesetVersion,
        status: "pending",
        expires_at: job.expiresAt,
        escalation_expires_at: job.escalationExpiresAt,
      },
      { eventId: deps.ids.uuid(), occurredAt: createdAt, traceId },
    ),
  );

  // Remembered last: a key remembered before a failed write would turn the retry
  // into a replay of a job that does not exist.
  await deps.idempotency.remember(idempotencyKey, payloadFingerprint);

  return { job, replayed: false };
}
