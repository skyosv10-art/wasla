/**
 * Negotiation & Chat domain model.
 *
 * The rows of `services/negotiations/contracts/schema.sql` as TypeScript, in
 * camelCase. The snake_case wire shape is a mapping concern and lives in
 * `mappers.ts` (MR 4/6), so the domain never learns two names for one field.
 *
 * ## What is deliberately NOT retyped here
 *
 * Every closed value set — parties, thread states, round states, close reasons,
 * handoff states, service kinds, error codes — is **re-exported** from
 * `@wasla/contracts-negotiation`, never redeclared. A second copy of a closed set
 * is a second source of truth, and the copy is always the one that forgets to add
 * the new member. The contracts package is itself drift-guarded against the DDL
 * (MR 1/6), so a set that is right here is right in the database too.
 *
 * ## What the model refuses to represent
 *
 * There is no `isExpired` and no `remainingSeconds` field anywhere (ADR-013
 * decision 5). Expiry is a comparison between a stored `expiresAt` and an
 * injected clock, computed in `expiry.ts`. A stored boolean would be true only
 * until the next second, and the first reader to trust it would be a bot showing
 * a countdown that never reaches zero.
 *
 * There is no field on the thread carrying the agreed price's fate: `Agreement`
 * is its own entity with its own `handoffState`, because «what did they agree on»
 * and «did the order engine hear about it» are two questions with two answers,
 * and one column cannot hold both (ADR-013 decision 2).
 *
 * There is no `orderState`, no `paymentStatus`, no `rating`, and no
 * `suggestedAmountMinor`. Their owners are other phases, and a field here would
 * be a claim this service cannot keep true.
 */

import type {
  NegotiationAuthorRole,
  NegotiationClosedState,
  NegotiationCloseReasonCode,
  NegotiationHandoffOutcome,
  NegotiationHandoffState,
  NegotiationLocale,
  NegotiationParty,
  NegotiationRoundState,
  NegotiationServiceKind,
  NegotiationThreadState,
} from "@wasla/contracts-negotiation";

export type {
  NegotiationAuthorRole,
  NegotiationClosedState,
  NegotiationCloseReasonCode,
  NegotiationHandoffOutcome,
  NegotiationHandoffState,
  NegotiationLocale,
  NegotiationParty,
  NegotiationRoundState,
  NegotiationServiceKind,
  NegotiationThreadState,
};

export {
  NEGOTIATION_AUTHOR_ROLES,
  NEGOTIATION_CANCEL_REASON_CODES,
  NEGOTIATION_CLOSE_REASON_CODES,
  NEGOTIATION_HANDOFF_OUTCOMES,
  NEGOTIATION_HANDOFF_STATES,
  NEGOTIATION_PARTIES,
  NEGOTIATION_ROUND_STATES,
  NEGOTIATION_SERVICE_KINDS,
  NEGOTIATION_THREAD_STATES,
  NEGOTIATION_SERVICE_PORT,
} from "@wasla/contracts-negotiation";

/**
 * The thread states a `thread_closed` event may carry.
 *
 * `agreed` is absent by design: it has its own event, so a consumer subscribing to
 * «a deal happened» never has to filter a stream of «a deal did not happen».
 */
export type NegotiationClosedThreadState = NegotiationClosedState;

/** The three locales the launch supports, mirroring `ck` on `source_locale`. */
export const NEGOTIATION_LOCALES: readonly NegotiationLocale[] = ["ar", "en", "ur"] as const;

/**
 * `negotiation_policies` — the bounds as DATA in a numbered frozen version.
 *
 * Precedent: `driver_eligibility_policies` (ADR-012) and `matching_rulesets`
 * (ADR-011 decision 6). The point is not configurability, it is answerability:
 * when someone asks in three months «why was a 3 riyal counter-offer refused in
 * August?», the answer has to be readable under August's numbers, and a hard-coded
 * `if` cannot answer that because the code that decided no longer exists.
 */
export interface NegotiationPolicy {
  readonly policyVersion: number;
  readonly label: string;
  readonly currency: string;
  readonly minAmountMinor: number;
  readonly maxAmountMinor: number;
  readonly maxRounds: number;
  readonly roundTtlSeconds: number;
  readonly threadTtlSeconds: number;
  readonly maxMessageLength: number;
  readonly maxMessagesPerThread: number;
  readonly isFrozen: boolean;
  readonly createdAt: string;
}

/**
 * `negotiation_threads` — one order × one driver, bound to one dispatch offer.
 *
 * `orderPublicId`, `customerPublicId`, `driverPublicId` and `dispatchOfferId` are
 * **opaque references**, not foreign keys: each lives in another service and
 * another database (ADR-009 §1). Shape is checked here; existence is checked
 * through a port.
 */
export interface NegotiationThread {
  readonly id: string;
  readonly orderPublicId: string;
  readonly customerPublicId: string;
  readonly driverPublicId: string;
  readonly dispatchOfferId: string;
  readonly serviceKind: NegotiationServiceKind;
  readonly state: NegotiationThreadState;
  readonly closeReasonCode: NegotiationCloseReasonCode | null;
  readonly policyVersion: number;
  readonly currency: string;
  readonly openingAmountMinor: number;
  readonly openedBy: NegotiationParty;
  readonly roundCount: number;
  readonly currentRoundNo: number;
  readonly agreedRoundNo: number | null;
  readonly expiresAt: string;
  /** Nearest due moment this thread means: min(pending round expiry, thread expiry). */
  readonly nextTickAt: string | null;
  readonly closedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Optimistic write counter: two simultaneous accepts must not make two agreements. */
  readonly version: number;
}

/** `negotiation_rounds` — one amount proposed by one party at one moment. */
export interface NegotiationRound {
  readonly id: string;
  readonly threadId: string;
  readonly roundNo: number;
  readonly proposedBy: NegotiationParty;
  readonly amountMinor: number;
  readonly currency: string;
  readonly state: NegotiationRoundState;
  /** Who settled it. `null` on `pending`, and on `superseded`/`expired` by design. */
  readonly resolvedBy: NegotiationParty | null;
  readonly expiresAt: string;
  readonly respondedAt: string | null;
  readonly createdAt: string;
}

/**
 * `negotiation_messages` — content, and the only place content lives.
 *
 * A redaction empties `body` and keeps the row: deleting a message loses the
 * sequence and makes «he told me X» unexaminable, which protects nobody.
 */
export interface NegotiationMessage {
  readonly id: string;
  readonly threadId: string;
  readonly sequenceNo: number;
  readonly authorRole: NegotiationAuthorRole;
  readonly body: string | null;
  readonly sourceLocale: NegotiationLocale;
  readonly systemCode: string | null;
  readonly roundNo: number | null;
  readonly redactedAt: string | null;
  readonly redactionReasonCode: string | null;
  readonly createdAt: string;
}

/**
 * `negotiation_agreements` — one row per agreed thread, keyed BY the thread.
 *
 * `handoffState` is the single source of truth for «does the order know its
 * price», and it is deliberately separate from the thread's `agreed` state: the
 * agreement happened between two people, and the network's inability to relay it
 * is not a retraction (ADR-013 decision 2).
 */
export interface NegotiationAgreement {
  readonly threadId: string;
  readonly orderPublicId: string;
  readonly driverPublicId: string;
  readonly roundNo: number;
  readonly amountMinor: number;
  readonly currency: string;
  readonly acceptedBy: NegotiationParty;
  readonly policyVersion: number;
  readonly agreedAt: string;
  readonly handoffState: NegotiationHandoffState;
  readonly handoffAttempts: number;
  readonly handedOffAt: string | null;
  readonly nextHandoffAt: string | null;
  readonly lastErrorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * `negotiation_price_handoffs` — one row per ATTEMPT, written before its outcome
 * is known.
 *
 * `outcome === null` is not a gap, it is the record of an attempt that started
 * and never finished — a crash mid-call. Precedent:
 * `driver_candidacy_publications` (Phase 05 · MR 5/6), where recording after
 * success is exactly what hid a silent drift behind a clean audit trail.
 */
export interface NegotiationPriceHandoff {
  readonly id: string;
  readonly threadId: string;
  readonly attemptNo: number;
  readonly amountMinor: number;
  readonly currency: string;
  readonly requestedAt: string;
  readonly outcome: NegotiationHandoffOutcome | null;
  readonly responseStatus: number | null;
  readonly errorCode: string | null;
  readonly completedAt: string | null;
}

/** The counters `POST /negotiations/tick` answers with. */
export interface NegotiationTickResult {
  readonly tickedAt: string;
  readonly roundsExpired: number;
  readonly threadsExpired: number;
  readonly threadsClosedMaxRounds: number;
  readonly handoffsAttempted: number;
  readonly handoffsSucceeded: number;
  readonly handoffFailures: number;
}

/** The other party. Used by turn-taking and by self-accept refusal. */
export function counterparty(party: NegotiationParty): NegotiationParty {
  return party === "customer" ? "driver" : "customer";
}

/** Thread states that accept no further action. */
export const NEGOTIATION_TERMINAL_THREAD_STATES: readonly NegotiationThreadState[] = Object.freeze([
  "agreed",
  "declined",
  "expired",
  "cancelled",
]);

export function isThreadOpen(thread: NegotiationThread): boolean {
  return thread.state === "open";
}
