/**
 * Ports (hexagonal boundaries) for the dispatch domain.
 *
 * Use cases depend on these interfaces only. Adapters live in `./infrastructure`:
 * the in-memory stores here (MR 4/6) and the Drizzle/Postgres repositories plus the
 * real HTTP clients in MR 5/6, with the same use-case tests running against both —
 * so "it worked in memory" can never mean "it works".
 *
 * Dependency direction (ADR-011): dispatch is the coordinator. It calls matching to
 * ask *who*, and it calls the order engine to record *what was offered and what was
 * answered. Neither of them calls dispatch. Matching in particular must never learn
 * that an offer exists — the moment it does, "who are the candidates" and "who was
 * asked" become one function again, and the reason these are two services is gone.
 *
 * In MR 4/6 every port is in-memory or a recording fake. The one exception on
 * purpose: the fake order engine validates transitions with the *real* state table
 * imported from `@wasla/orders-service`, so the fake cannot lie about what the
 * engine would accept.
 */

import type {
  DispatchJob,
  DispatchJobStatus,
  DispatchOffer,
  DispatchOfferStatus,
  DispatchReasonCode,
  DispatchRules,
  DispatchWave,
  DispatchWaveStatus,
  OrderType,
  VehicleClass,
} from "./domain/model.js";
import type { AnyDispatchEvent } from "./domain/events.js";

/** Wall-clock time as an ISO-8601 string. The only time source in the service. */
export interface Clock {
  now(): string;
}

/** UUID generator (job, wave, offer and event ids). */
export interface IdGenerator {
  uuid(): string;
}

/** The row to insert when a job is created. */
export interface InsertJobInput {
  readonly id: string;
  readonly orderId: string;
  readonly orderPublicId: string;
  readonly zoneId: string;
  readonly orderType: OrderType;
  readonly vehicleClass: VehicleClass;
  readonly rules: DispatchRules;
  readonly expiresAt: string;
  readonly escalationExpiresAt: string;
  readonly createdIdempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly createdAt: string;
}

/**
 * Jobs.
 *
 * `findByOrderId` exists because "one order, one dispatch job" is the invariant the
 * unique index protects, and the use case must be able to answer a retry with the
 * existing job instead of a 409 the caller cannot act on.
 *
 * `listActive` is what the tick reads. Deliberately "not terminal" rather than "due
 * now": the tick decides what is due, from stored deadlines, and a repository that
 * pre-filtered by time would become a second place where the time model lives.
 */
export interface JobRepository {
  find(jobId: string): Promise<DispatchJob | null>;
  findByOrderId(orderId: string): Promise<DispatchJob | null>;
  findByIdempotencyKey(key: string): Promise<DispatchJob | null>;
  insert(input: InsertJobInput): Promise<DispatchJob>;
  /** Status plus reason, written together — a status without its reason is unexplainable. */
  updateStatus(
    jobId: string,
    status: DispatchJobStatus,
    reasonCode: DispatchReasonCode | null,
    changedAt: string,
  ): Promise<DispatchJob>;
  listActive(): Promise<DispatchJob[]>;
}

export interface InsertWaveInput {
  readonly id: string;
  readonly jobId: string;
  readonly waveNumber: number;
  readonly openedAt: string;
}

/**
 * Waves.
 *
 * `insert` must refuse a second open wave for the same job, mirroring the partial
 * unique index `ux_dispatch_waves_one_open_job`. Enforced by the store rather than
 * by an `if` in the use case, because under two concurrent ticks the `if` is a race
 * and the index is not.
 */
export interface WaveRepository {
  find(waveId: string): Promise<DispatchWave | null>;
  findOpenForJob(jobId: string): Promise<DispatchWave | null>;
  listForJob(jobId: string): Promise<DispatchWave[]>;
  /** How many waves this job has used, open or closed — the budget counter. */
  countForJob(jobId: string): Promise<number>;
  insert(input: InsertWaveInput): Promise<DispatchWave>;
  updateStatus(
    waveId: string,
    status: DispatchWaveStatus,
    reasonCode: DispatchReasonCode | null,
    changedAt: string,
  ): Promise<DispatchWave>;
}

export interface InsertOfferInput {
  readonly id: string;
  readonly jobId: string;
  readonly waveId: string;
  readonly driverPublicId: string;
  readonly orderAssignmentId: string | null;
  readonly offeredAt: string;
  readonly expiresAt: string;
}

/** How an offer was closed, with the timestamps the schema's matrix demands. */
export interface ResolveOfferInput {
  readonly status: Exclude<DispatchOfferStatus, "offered">;
  readonly reasonCode: DispatchReasonCode;
  /** Set only when a human answered — `accepted` and `rejected`. */
  readonly respondedAt: string | null;
  readonly resolvedAt: string;
}

/**
 * Offers.
 *
 * `insert` must refuse a repeat of `(jobId, driverPublicId)` — including a driver who
 * already rejected or timed out — mirroring `ux_dispatch_offers_job_driver`. That is
 * the guard that stops wave 3 from re-asking the driver who declined in wave 1, and
 * it holds even if the exclusion list we send to matching is wrong.
 *
 * `resolve` must refuse a second `accepted` per job, mirroring
 * `ux_dispatch_offers_one_accepted_job`.
 */
export interface OfferRepository {
  find(offerId: string): Promise<DispatchOffer | null>;
  listForJob(jobId: string): Promise<DispatchOffer[]>;
  listForWave(waveId: string): Promise<DispatchOffer[]>;
  /** Every driver already offered this job — the exclusion list sent to matching. */
  listOfferedDriverIds(jobId: string): Promise<string[]>;
  insert(input: InsertOfferInput): Promise<DispatchOffer>;
  resolve(offerId: string, input: ResolveOfferInput): Promise<DispatchOffer>;
}

/**
 * Domain event outbox. Use cases append within the same logical operation as the
 * write; a relay publishes later (Phase 09). Kept separate from the repositories so
 * the domain owns event ordering without knowing a broker exists.
 */
export interface Outbox {
  append(event: AnyDispatchEvent): Promise<void>;
  /** Appended (unpublished) events — used by tests and the future relay. */
  unread(): Promise<AnyDispatchEvent[]>;
}

/**
 * Idempotency memory for writes (§43).
 *
 * Stores the payload fingerprint, which is what lets a retry (same key, same
 * payload) succeed while a caller bug (same key, different payload) is refused with
 * 409 instead of silently overwriting a different order's job.
 */
export interface IdempotencyStore {
  find(key: string): Promise<string | null>;
  remember(key: string, payloadFingerprint: string): Promise<void>;
}

/** What dispatch asks matching for. No coordinates: the zone is the location. */
export interface CandidateRequest {
  readonly zoneId: string;
  readonly serviceKind: OrderType;
  readonly vehicleClass: VehicleClass;
  /** Wave size from the job's frozen snapshot. */
  readonly limit: number;
  /** Drivers already offered this job. Belt; `ux_dispatch_offers_job_driver` is braces. */
  readonly excludedDriverPublicIds: readonly string[];
}

/** One ranked candidate. Rank only — dispatch has no business reading a score. */
export interface CandidateRef {
  readonly driverPublicId: string;
  readonly rank: number;
}

/**
 * Matching's answer.
 *
 * `emptyReasonCode` is non-null exactly when there are no candidates, and an empty
 * answer is **not** an error: it is the normal shape of "nobody is available in this
 * zone right now", which leads to escalation, not to a 5xx page.
 *
 * `decisionId` is carried so an offer can be traced back to the evaluation that
 * produced it, without dispatch storing candidate identities or scores.
 */
export interface CandidateResult {
  readonly decisionId: string;
  readonly rulesetVersion: number;
  readonly evaluatedAt: string;
  readonly candidates: readonly CandidateRef[];
  readonly emptyReasonCode: string | null;
}

/**
 * Matching, as dispatch sees it.
 *
 * `markUnavailable` is a projection refresh after an acceptance, not part of the
 * decision: see `accept-offer.ts` for why a failure there does not fail the
 * acceptance.
 */
export interface MatchingPort {
  candidates(request: CandidateRequest): Promise<CandidateResult>;
  markUnavailable(driverPublicId: string, reasonCode: "OFFER_ACCEPTED", changedAt: string): Promise<void>;
}

/**
 * How an order-engine call came back.
 *
 * A closed classification rather than an HTTP status, because the domain must not
 * learn to read status codes — and because the four cases mean genuinely different
 * things to a customer:
 *
 * - `applied`        the engine did it.
 * - `already_applied` the engine had already done it (our retry, or a repeated
 *   legal transition). Success, not conflict.
 * - `rejected`       a final refusal (the engine's 409/422). Retrying the same key
 *   changes nothing; the outcome is written with a reason code.
 * - `unavailable`    the engine is down (5xx / disconnect). Retry with the same key.
 * - `timeout`        no answer arrived. A *recorded ambiguity*: the write may have
 *   landed, so the retry must reuse the same deterministic key rather than mint a
 *   new one, or one offer becomes two assignments.
 */
export type OrderEngineOutcome =
  | "applied"
  | "already_applied"
  | "rejected"
  | "unavailable"
  | "timeout";

export interface OrderEngineResult {
  readonly outcome: OrderEngineOutcome;
  /** Present when an assignment was created or found. */
  readonly assignmentId?: string;
  /** The engine's own error code when `outcome === "rejected"`. */
  readonly rejectionCode?: string;
}

/** Registering the assignment that backs one offer. */
export interface RegisterOfferInput {
  readonly orderId: string;
  readonly driverPublicId: string;
  readonly idempotencyKey: string;
  readonly traceId?: string;
}

/** Closing that assignment. The states are the engine's, not ours. */
export interface ResolveAssignmentInput {
  readonly orderId: string;
  readonly assignmentId: string;
  readonly state: "accepted" | "rejected" | "expired" | "cancelled";
  readonly reasonCode: string | null;
  readonly idempotencyKey: string;
  readonly traceId?: string;
}

/** Asking the engine to move the order's own status. */
export interface TransitionOrderInput {
  readonly orderId: string;
  readonly to: string;
  readonly reasonCode: string | null;
  readonly idempotencyKey: string;
  readonly traceId?: string;
}

/**
 * The order engine, as dispatch sees it.
 *
 * Dispatch does **not** copy the order state machine (ADR-010): it requests moves
 * and believes the answer. A local copy would be a second machine to keep in sync,
 * and the copy would be the one that is wrong.
 */
export interface OrderEnginePort {
  registerOffer(input: RegisterOfferInput): Promise<OrderEngineResult>;
  resolveAssignment(input: ResolveAssignmentInput): Promise<OrderEngineResult>;
  transitionOrder(input: TransitionOrderInput): Promise<OrderEngineResult>;
}

/**
 * The rules a new job is created under.
 *
 * A port, not a constant: MR 5/6 reads it from configuration. Deliberately not part
 * of `CreateDispatchJobRequest` — a caller able to set `maxWaves` could keep a
 * customer waiting all afternoon while every reading of the incident blamed
 * dispatch.
 */
export interface RulesProvider {
  current(): Promise<DispatchRules>;
}

/** Everything a use case needs, passed explicitly rather than imported. */
export interface DispatchDependencies {
  readonly jobs: JobRepository;
  readonly waves: WaveRepository;
  readonly offers: OfferRepository;
  readonly outbox: Outbox;
  readonly idempotency: IdempotencyStore;
  readonly matching: MatchingPort;
  readonly orders: OrderEnginePort;
  readonly rules: RulesProvider;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}
