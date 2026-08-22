/**
 * The dispatch domain vocabulary.
 *
 * Three aggregates and nothing else: a job (one order being dispatched), a wave
 * (one round of simultaneous offers), an offer (one driver's turn to answer).
 * Everything the domain decides is a function of stored fields plus one injected
 * clock — there is no ambient `Date.now()` anywhere below `src/`.
 *
 * The status unions, order types and vehicle classes are imported from
 * `@wasla/contracts-dispatch` rather than re-declared. A second declaration would
 * be a second source of truth, and the drift guards would then only prove that
 * our copy agrees with itself.
 */
import type {
  DispatchJobStatus,
  DispatchOfferStatus,
  DispatchReasonCode,
  DispatchWaveStatus,
  OrderType,
  VehicleClass,
} from "@wasla/contracts-dispatch";

export type {
  DispatchJobStatus,
  DispatchOfferStatus,
  DispatchReasonCode,
  DispatchWaveStatus,
  OrderType,
  VehicleClass,
};

export { DISPATCH_REASON_CODES } from "@wasla/contracts-dispatch";

/**
 * Public id shapes, mirroring `schema.sql`.
 *
 * Duplicated as regexes here because the database check is not reachable from a
 * pure unit test; the drift guard in `__tests__/contract-drift.test.ts` reads
 * `schema.sql` from disk and fails if the two ever disagree.
 */
export const DRIVER_PUBLIC_ID_PATTERN = /^WS-[0-9]{10}$/;
export const ORDER_PUBLIC_ID_PATTERN = /^ORD-[0-9]{10}$/;

/** `dispatch_jobs.created_idempotency_key` length bounds, and the header's. */
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/** `dispatch_jobs.payload_fingerprint` is `char_length = 64` — a sha256 hex digest. */
export const PAYLOAD_FINGERPRINT_LENGTH = 64;

/** `ReasonCode` in the OpenAPI component: 3..64 characters. */
export const REASON_CODE_MIN_LENGTH = 3;
export const REASON_CODE_MAX_LENGTH = 64;

export const DISPATCH_ORDER_TYPES: readonly OrderType[] = ["ride", "delivery"];

export const DISPATCH_VEHICLE_CLASSES: readonly VehicleClass[] = [
  "sedan",
  "suv",
  "van",
  "pickup",
  "motorcycle",
  "truck_small",
];

/**
 * The rules a job was dispatched under, copied onto the job at creation.
 *
 * A snapshot, not a pointer: `ruleset_version` is recorded so an offer sent an
 * hour ago can still be explained after the live configuration changed. The
 * caller does not send these — `CreateDispatchJobRequest` has no `rules` field —
 * because a client able to ask for `max_waves: 1000` could keep a customer
 * waiting all day while every reading of the incident blamed dispatch.
 */
export interface DispatchRules {
  readonly rulesetVersion: number;
  readonly waveSize: number;
  readonly offerTimeoutSeconds: number;
  readonly maxWaves: number;
  readonly escalationTimeoutSeconds: number;
}

/** One order being dispatched. `orderId`/`zoneId` are opaque refs, never FKs. */
export interface DispatchJob {
  readonly id: string;
  readonly orderId: string;
  readonly orderPublicId: string;
  readonly zoneId: string;
  readonly orderType: OrderType;
  readonly vehicleClass: VehicleClass;
  readonly status: DispatchJobStatus;
  readonly statusReasonCode: DispatchReasonCode | null;
  readonly rules: DispatchRules;
  /** End of the automatic window. Stored, so no timer owns it. */
  readonly expiresAt: string;
  /** End of the community escalation, so a human task cannot last forever. */
  readonly escalationExpiresAt: string;
  readonly createdIdempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One round of simultaneous offers. At most one is `open` per job. */
export interface DispatchWave {
  readonly id: string;
  readonly jobId: string;
  readonly waveNumber: number;
  readonly status: DispatchWaveStatus;
  readonly reasonCode: DispatchReasonCode | null;
  readonly openedAt: string;
  /**
   * When this round's offers stop being answerable.
   *
   * Added in MR 5a/6, and not a convenience: `dispatch_waves.expires_at` is
   * `NOT NULL` in the contract and `ix_dispatch_waves_open_due` indexes it, so a
   * wave could not be persisted at all while the value existed only inside the
   * `dispatch.wave_opened` payload. It equals `computeOfferDeadline(openedAt,
   * job.rules)` — the same instant every offer of the wave carries — and it is
   * stored rather than derived so a reader of the row does not have to join the
   * job and repeat the arithmetic to learn whether the round is still live.
   */
  readonly expiresAt: string;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One driver's turn to answer. At most one is `accepted` per job. */
export interface DispatchOffer {
  readonly id: string;
  readonly jobId: string;
  readonly waveId: string;
  /** The assignment row the order engine created for this offer, if any. */
  readonly orderAssignmentId: string | null;
  readonly driverPublicId: string;
  readonly status: DispatchOfferStatus;
  readonly reasonCode: DispatchReasonCode | null;
  readonly offeredAt: string;
  /** Deadline copied from the job's snapshot at send time, never recomputed. */
  readonly expiresAt: string;
  readonly respondedAt: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Which reason code closes which outcome.
 *
 * A closed table rather than a free choice at each call site: the reason code is
 * the only thing analytics can group by afterwards, so two call sites writing
 * `DRIVER_DECLINED` and `DRIVER_UNAVAILABLE` for the same event would quietly
 * split one number into two.
 */
export const OFFER_STATUS_REASON_CODES: Record<
  Exclude<DispatchOfferStatus, "offered">,
  readonly DispatchReasonCode[]
> = {
  accepted: ["OFFER_ACCEPTED"],
  rejected: ["DRIVER_DECLINED", "DRIVER_UNAVAILABLE", "DRIVER_VEHICLE_ISSUE"],
  timed_out: ["OFFER_TIMED_OUT"],
  superseded: ["OFFER_SUPERSEDED"],
  cancelled: ["JOB_CANCELLED"],
};

export const WAVE_STATUS_REASON_CODES: Record<
  Exclude<DispatchWaveStatus, "open">,
  readonly DispatchReasonCode[]
> = {
  completed: ["OFFER_ACCEPTED", "WAVE_OFFERS_RESOLVED", "NO_DRIVER_AVAILABLE"],
  cancelled: ["JOB_CANCELLED"],
};

/**
 * `escalated_community` is not terminal, so `schema.sql` does not demand a reason
 * on it — but it carries one anyway, because "why is a human being asked about
 * this order" is exactly the question an operator opens the row to answer. The
 * codes match the `const` values declared for the events in `events.json`.
 */
export const JOB_STATUS_REASON_CODES: Record<
  "escalated_community" | "assigned" | "exhausted" | "cancelled",
  readonly DispatchReasonCode[]
> = {
  escalated_community: ["ALL_WAVES_EXHAUSTED"],
  assigned: ["OFFER_ACCEPTED"],
  exhausted: ["NO_DRIVER_AVAILABLE"],
  cancelled: ["JOB_CANCELLED", "ORDER_CANCELLED", "DISPATCH_CANCELLED_BY_REQUESTER", "ORDER_ENGINE_REJECTED"],
};

/** The three reason codes a driver may send when rejecting (closed enum in the API). */
export const DRIVER_REJECTION_REASON_CODES: readonly DispatchReasonCode[] =
  OFFER_STATUS_REASON_CODES.rejected;

/** The three reason codes a requester may send when cancelling a job. */
export const CANCEL_REQUEST_REASON_CODES: readonly DispatchReasonCode[] = [
  "ORDER_CANCELLED",
  "DISPATCH_CANCELLED_BY_REQUESTER",
  "ORDER_ENGINE_REJECTED",
];
