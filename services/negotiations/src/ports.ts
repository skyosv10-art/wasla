/**
 * Ports (hexagonal boundaries) for the Negotiation & Chat domain.
 *
 * Use cases depend on these interfaces only. Adapters live in `./infrastructure`:
 * the in-memory stores here (MR 2/6), the Drizzle/Postgres repositories in MR 3/6
 * with a parity suite running the same use-case tests against both — so «it worked
 * in memory» can never mean «it works» — and the outbound HTTP adapters in MR 5/6.
 *
 * ## Dependency direction (ADR-013)
 *
 *   - Negotiation reads a dispatch offer through `DispatchOfferPort` and hands a
 *     price to the order engine through `AgreedPricePort`. **Nothing else.**
 *   - There is deliberately **no port here that can write `orders`**. Not a
 *     repository, not a generic «order client», not a table object. The one thing
 *     that leaves toward the order engine is one amount through one method, because
 *     two services writing one table is how a boundary stops existing while both
 *     diagrams still show it (ADR-013 decision 2 · precedent `OrderIntakePort`,
 *     ADR-009 §3 · `CandidacyProjectionPort`, ADR-012 decision 3).
 *   - Nothing here can read a payment, a rating, or a channel id.
 */

import type { NegotiationDomainEvent } from "@wasla/contracts-negotiation";

import type {
  NegotiationAgreement,
  NegotiationCloseReasonCode,
  NegotiationHandoffState,
  NegotiationLocale,
  NegotiationMessage,
  NegotiationParty,
  NegotiationPolicy,
  NegotiationPriceHandoff,
  NegotiationRound,
  NegotiationRoundState,
  NegotiationServiceKind,
  NegotiationThread,
  NegotiationThreadState,
} from "./domain/model.js";

/** Wall-clock time as an ISO-8601 string. The domain never calls `Date.now()`. */
export interface Clock {
  now(): string;
}

/** UUID generator (thread ids, round ids, message ids, event ids). */
export interface IdGenerator {
  uuid(): string;
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export interface CreateThreadInput {
  readonly id: string;
  readonly orderPublicId: string;
  readonly customerPublicId: string;
  readonly driverPublicId: string;
  readonly dispatchOfferId: string;
  readonly serviceKind: NegotiationServiceKind;
  readonly policyVersion: number;
  readonly currency: string;
  readonly openingAmountMinor: number;
  readonly openedBy: NegotiationParty;
  readonly expiresAt: string;
  readonly nextTickAt: string | null;
  readonly createdAt: string;
}

/**
 * The columns a use case may change on a thread.
 *
 * Deliberately NOT `Partial<NegotiationThread>`: `createdAt`, `orderPublicId`,
 * `policyVersion`, `openingAmountMinor` and `version` are service-owned. A patch
 * type that can reach them lets a caller re-date a thread, move it to another
 * order, or re-price its own opening after the fact.
 */
export interface ThreadMutation {
  readonly state?: NegotiationThreadState;
  readonly closeReasonCode?: NegotiationCloseReasonCode | null;
  readonly roundCount?: number;
  readonly currentRoundNo?: number;
  readonly agreedRoundNo?: number | null;
  readonly nextTickAt?: string | null;
  readonly closedAt?: string | null;
}

export interface ThreadFilter {
  readonly orderPublicId?: string;
  readonly driverPublicId?: string;
  readonly state?: NegotiationThreadState;
}

export interface ThreadRepository {
  find(threadId: string): Promise<NegotiationThread | null>;
  findByOrderAndDriver(
    orderPublicId: string,
    driverPublicId: string,
  ): Promise<NegotiationThread | null>;
  findByDispatchOffer(dispatchOfferId: string): Promise<NegotiationThread | null>;
  create(input: CreateThreadInput): Promise<NegotiationThread>;
  /**
   * Apply a mutation, bumping `version`.
   *
   * `expectedVersion` is the optimistic guard: two simultaneous accepts read the
   * same thread, and exactly one of them may write it. The adapter raises
   * `NEGOTIATION_ROUND_STALE` when the version has moved, rather than returning a
   * boolean nobody checks.
   */
  update(
    threadId: string,
    mutation: ThreadMutation,
    at: string,
    expectedVersion: number,
  ): Promise<NegotiationThread>;
  /**
   * A filter is REQUIRED, and the type says so: every field being optional would
   * make `{}` — every negotiation on the platform — the easiest call to write. The
   * use case refuses an empty filter with `NEGOTIATION_FILTER_REQUIRED`; this
   * signature is the reminder, not the guard.
   */
  list(filter: ThreadFilter, limit: number): Promise<NegotiationThread[]>;
  /**
   * Open threads whose `nextTickAt` has come due — the sweep's index
   * (`ix_negotiation_threads_tick_due`). Bounded by `limit`, because a tick that
   * scans everything is a tick that stops running the day the platform grows.
   */
  listDueForTick(now: string, limit: number): Promise<NegotiationThread[]>;
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

export interface CreateRoundInput {
  readonly id: string;
  readonly threadId: string;
  readonly roundNo: number;
  readonly proposedBy: NegotiationParty;
  readonly amountMinor: number;
  readonly currency: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface RoundResolution {
  readonly state: NegotiationRoundState;
  readonly resolvedBy: NegotiationParty | null;
  readonly respondedAt: string | null;
}

export interface RoundRepository {
  list(threadId: string): Promise<NegotiationRound[]>;
  find(threadId: string, roundNo: number): Promise<NegotiationRound | null>;
  /** The one round awaiting an answer, if any (`ux_negotiation_rounds_one_pending`). */
  findPending(threadId: string): Promise<NegotiationRound | null>;
  findAccepted(threadId: string): Promise<NegotiationRound | null>;
  create(input: CreateRoundInput): Promise<NegotiationRound>;
  resolve(
    threadId: string,
    roundNo: number,
    resolution: RoundResolution,
  ): Promise<NegotiationRound>;
  /** Pending rounds past their deadline — `ix_negotiation_rounds_pending_due`. */
  listPendingDue(now: string, limit: number): Promise<NegotiationRound[]>;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface CreateMessageInput {
  readonly id: string;
  readonly threadId: string;
  readonly sequenceNo: number;
  readonly authorRole: NegotiationMessage["authorRole"];
  readonly body: string | null;
  readonly sourceLocale: NegotiationLocale;
  readonly systemCode: string | null;
  readonly roundNo: number | null;
  readonly createdAt: string;
}

export interface MessageRepository {
  list(threadId: string): Promise<NegotiationMessage[]>;
  count(threadId: string): Promise<number>;
  create(input: CreateMessageInput): Promise<NegotiationMessage>;
  /**
   * Redaction empties the body and keeps the row.
   *
   * There is **no delete** on this port, and that is the decision: a deleted
   * message loses the sequence and makes «he told me X» unexaminable, so a
   * complaint can no longer be checked in either direction.
   */
  redact(
    threadId: string,
    messageId: string,
    reasonCode: string,
    at: string,
  ): Promise<NegotiationMessage>;
}

// ---------------------------------------------------------------------------
// Agreements and the price hand-off record
// ---------------------------------------------------------------------------

export interface CreateAgreementInput {
  readonly threadId: string;
  readonly orderPublicId: string;
  readonly driverPublicId: string;
  readonly roundNo: number;
  readonly amountMinor: number;
  readonly currency: string;
  readonly acceptedBy: NegotiationParty;
  readonly policyVersion: number;
  readonly agreedAt: string;
  readonly nextHandoffAt: string | null;
}

export interface HandoffMutation {
  readonly handoffState?: NegotiationHandoffState;
  readonly handoffAttempts?: number;
  readonly handedOffAt?: string | null;
  readonly nextHandoffAt?: string | null;
  readonly lastErrorCode?: string | null;
}

export interface AgreementRepository {
  find(threadId: string): Promise<NegotiationAgreement | null>;
  findByOrder(orderPublicId: string): Promise<NegotiationAgreement | null>;
  create(input: CreateAgreementInput): Promise<NegotiationAgreement>;
  update(threadId: string, mutation: HandoffMutation, at: string): Promise<NegotiationAgreement>;
  /** Agreements whose retry is due — `ix_negotiation_agreements_handoff_due`. */
  listHandoffDue(now: string, limit: number): Promise<NegotiationAgreement[]>;
}

/**
 * Append-then-complete: every hand-off ATTEMPT is recorded **before** its outcome
 * is known.
 *
 * `begin` writes the row; `complete` fills the outcome. The two-step shape is not
 * ceremony — a row written only after success hides the attempt that crashed
 * mid-call, which is precisely the silent drift that a clean audit trail concealed
 * in Phase 05 · MR 5/6 (`driver_candidacy_publications`).
 */
export interface PriceHandoffRepository {
  begin(input: {
    readonly id: string;
    readonly threadId: string;
    readonly attemptNo: number;
    readonly amountMinor: number;
    readonly currency: string;
    readonly requestedAt: string;
  }): Promise<NegotiationPriceHandoff>;
  complete(
    id: string,
    outcome: {
      readonly outcome: NegotiationPriceHandoff["outcome"];
      readonly responseStatus: number | null;
      readonly errorCode: string | null;
      readonly completedAt: string;
    },
  ): Promise<NegotiationPriceHandoff>;
  list(threadId: string): Promise<NegotiationPriceHandoff[]>;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * Policy catalogue. Read-only in this phase: version 1 is seeded and frozen by
 * `schema.sql`, and a new version is a migration, not an API call.
 */
export interface NegotiationPolicyRepository {
  find(policyVersion: number): Promise<NegotiationPolicy | null>;
  findActive(): Promise<NegotiationPolicy | null>;
  list(): Promise<NegotiationPolicy[]>;
}

// ---------------------------------------------------------------------------
// Outbound ports — the only two things that leave this service
// ---------------------------------------------------------------------------

export interface DispatchOfferSnapshot {
  readonly dispatchOfferId: string;
  readonly orderPublicId: string;
  readonly driverPublicId: string;
  readonly serviceKind: NegotiationServiceKind;
  /** Is the offer still standing? A thread is never opened on a dead offer. */
  readonly active: boolean;
  /** Does the order accept a negotiated price at all (`price_mode`)? */
  readonly negotiable: boolean;
}

/**
 * The dispatch offer this negotiation stands on (ADR-013 decision 1).
 *
 * `describe` returns `null` for «no such offer» and throws when it cannot answer.
 * The distinction matters: an absent offer is a `422` telling the caller his input
 * is wrong, while an unreachable dispatch service is a `503` telling him to retry.
 * Collapsing them makes a client stop retrying a request that was valid.
 */
export interface DispatchOfferPort {
  describe(dispatchOfferId: string): Promise<DispatchOfferSnapshot | null>;
}

export interface AgreedPriceHandoffResult {
  readonly outcome: "accepted" | "rejected";
  readonly responseStatus: number | null;
  readonly errorCode: string | null;
}

/**
 * The one outbound write: the agreed amount reaching the order engine.
 *
 * ## Three things about this signature are deliberate
 *
 * **It takes an amount, not an order.** There is no `updateOrder`, no patch object,
 * no field list. The order engine owns what it does with the number; this service
 * owns the number.
 *
 * **It returns an outcome instead of throwing on refusal.** `rejected` means the
 * order engine said no — a decision to record, not our failure, and one that is
 * never retried (`rejected` is terminal on the agreement). It throws only when the
 * transport itself failed, which the caller records as `unavailable` and the tick
 * retries.
 *
 * **A throw does NOT invalidate the agreement.** The accept has already answered
 * `2xx` with its agreement before this port is ever called; a failure here moves
 * `handoff_state` and nothing else. There is no error code in the published
 * catalogue for it, by decision (ADR-013 decision 2). The caller that «helpfully»
 * turns this throw into a `502` on the accept response is the bug this comment
 * exists to prevent: it would tell two people who agreed that they did not, while
 * one of them is already driving.
 *
 * The real HTTP adapter lands in MR 5/6 together with the order engine's
 * `agreed_amount_minor` columns — the declared debt in HANDOFF §14.
 */
export interface AgreedPricePort {
  handOff(
    input: {
      readonly orderPublicId: string;
      readonly threadId: string;
      readonly driverPublicId: string;
      readonly amountMinor: number;
      readonly currency: string;
      readonly agreedAt: string;
      readonly attemptNo: number;
    },
    options?: { readonly traceId?: string | null },
  ): Promise<AgreedPriceHandoffResult>;
}

// ---------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------

/**
 * Domain event outbox. Use cases append within the same logical operation as the
 * write; a relay publishes later (Phase 09). Kept separate from the repositories so
 * the domain owns event ordering without knowing about a broker.
 */
export interface Outbox {
  append(event: NegotiationDomainEvent): Promise<void>;
  unread(): Promise<NegotiationDomainEvent[]>;
}

/**
 * Idempotency memory for writes.
 *
 * Storing the fingerprint is what lets a retry (same key, same payload) succeed
 * while a caller bug (same key, different payload) is refused with `409` instead of
 * silently overwriting. `scope` mirrors the DDL's enumeration so one key reused
 * across two different operations is a visible conflict rather than a coincidence.
 */
export interface IdempotencyStore {
  find(key: string): Promise<{ scope: string; payloadFingerprint: string } | null>;
  remember(key: string, scope: string, payloadFingerprint: string): Promise<void>;
}

/** Everything a use case needs, passed explicitly rather than imported. */
export interface NegotiationDependencies {
  readonly threads: ThreadRepository;
  readonly rounds: RoundRepository;
  readonly messages: MessageRepository;
  readonly agreements: AgreementRepository;
  readonly handoffs: PriceHandoffRepository;
  readonly policies: NegotiationPolicyRepository;
  readonly offers: DispatchOfferPort;
  readonly agreedPrice: AgreedPricePort;
  readonly outbox: Outbox;
  readonly idempotency: IdempotencyStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}
