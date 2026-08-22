/**
 * In-memory adapters — the database's rules without the database.
 *
 * ## Why these are not «temporary until MR 3/6»
 *
 * They are the fixtures the whole truth table is proven on, they let the domain
 * suite run in milliseconds on a machine with no Postgres, and in MR 4/6 they are
 * the visible fallback the HTTP server uses when `DATABASE_URL` is unset — which is
 * why `/health` reports `persistence: "memory"` rather than pretending.
 *
 * ## The rule that makes them worth having
 *
 * **Every named constraint in `schema.sql` is enforced here, by its name.** All
 * twenty-two `CONSTRAINT` clauses plus the two partial unique indexes
 * (`ux_negotiation_rounds_one_pending`, `ux_negotiation_rounds_one_accepted`) have a
 * guard below that raises the constraint's name. The alternative — a permissive
 * store — produces a suite that passes in memory and a migration that fails in
 * staging, and the difference is discovered by whoever is on call.
 *
 * Two kinds of guard, deliberately distinguished:
 *
 *   - A constraint a **caller** can reach raises the published domain error, with
 *     the constraint named in `details.constraint`:
 *     `ux_negotiation_threads_order_driver` → `NEGOTIATION_THREAD_ALREADY_EXISTS`,
 *     `ck_negotiation_rounds_no_self_resolution` → `NEGOTIATION_SELF_ACCEPT_FORBIDDEN`,
 *     `ux_negotiation_rounds_one_pending` → `NEGOTIATION_TURN_VIOLATION`,
 *     `ux_negotiation_rounds_one_accepted` → `NEGOTIATION_ALREADY_AGREED`.
 *   - A **coherence** constraint no caller can reach through a use case
 *     (`ck_negotiation_threads_open_is_clean` and friends) raises
 *     `NegotiationConstraintViolation`, which is a **bug signal, not an API error**.
 *     Giving it a published error code would invite a client to handle it, and
 *     nothing a client does can cause it.
 */

import type { NegotiationDomainEvent } from "@wasla/contracts-negotiation";

import {
  alreadyAgreed,
  roundNotFound,
  selfAcceptForbidden,
  threadNotFound,
  threadAlreadyExists,
  turnViolation,
  roundStale,
} from "../domain/errors.js";
import { isDue, toEpochMillis } from "../domain/expiry.js";
import type {
  NegotiationAgreement,
  NegotiationMessage,
  NegotiationPolicy,
  NegotiationPriceHandoff,
  NegotiationRound,
  NegotiationThread,
} from "../domain/model.js";
import { SEEDED_POLICIES } from "../domain/policy.js";
import type {
  AgreedPriceHandoffResult,
  AgreedPricePort,
  AgreementRepository,
  Clock,
  CreateAgreementInput,
  CreateMessageInput,
  CreateRoundInput,
  CreateThreadInput,
  DispatchOfferPort,
  DispatchOfferSnapshot,
  HandoffMutation,
  IdGenerator,
  IdempotencyStore,
  MessageRepository,
  NegotiationDependencies,
  NegotiationPolicyRepository,
  Outbox,
  PriceHandoffRepository,
  RoundRepository,
  RoundResolution,
  ThreadFilter,
  ThreadMutation,
  ThreadRepository,
} from "../ports.js";

/**
 * A database coherence constraint that a caller cannot reach.
 *
 * Not a `NegotiationError`: it has no published code and must not be mapped to an
 * HTTP status by the error handler's catch-all. If this is ever thrown in
 * production, the answer is a fix here, not a retry there.
 */
export class NegotiationConstraintViolation extends Error {
  readonly constraint: string;

  constructor(constraint: string) {
    super(`constraint violated: ${constraint}`);
    this.name = "NegotiationConstraintViolation";
    this.constraint = constraint;
  }
}

function assertConstraint(condition: boolean, constraint: string): void {
  if (!condition) throw new NegotiationConstraintViolation(constraint);
}

// ---------------------------------------------------------------------------
// Clock and ids
// ---------------------------------------------------------------------------

/**
 * A clock a test moves by hand.
 *
 * The whole expiry design exists so that time can be tested without `sleep`: a
 * suite that waits is a suite somebody deletes when it makes CI slow, and the tick
 * is exactly the behaviour that must not lose its tests.
 */
export class MutableClock implements Clock {
  private current: string;

  constructor(initial = "2026-08-23T00:00:00.000Z") {
    this.current = initial;
  }

  now(): string {
    return this.current;
  }

  set(iso: string): void {
    this.current = iso;
  }

  advanceSeconds(seconds: number): string {
    this.current = new Date(toEpochMillis(this.current) + seconds * 1000).toISOString();
    return this.current;
  }
}

/**
 * Deterministic ids.
 *
 * Real UUID v4 shape (so `assertUuid` accepts them) with a counter in the tail, so a
 * failing assertion names `...-000000000007` instead of a value that differs on
 * every run and cannot be searched for in a log.
 */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = "00000000-0000-4000-8000") {}

  uuid(): string {
    this.counter += 1;
    return `${this.prefix}-${String(this.counter).padStart(12, "0")}`;
  }
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export class InMemoryPolicyRepository implements NegotiationPolicyRepository {
  private readonly rows: NegotiationPolicy[];

  constructor(policies: readonly NegotiationPolicy[] = SEEDED_POLICIES) {
    for (const policy of policies) {
      // The seed's own constraints, checked on the way in: a fixture that violates
      // them would let a test prove behaviour the database would never permit.
      assertConstraint(
        policy.maxAmountMinor > policy.minAmountMinor,
        "ck_negotiation_policies_amount_bounds",
      );
      assertConstraint(
        policy.threadTtlSeconds >= policy.roundTtlSeconds,
        "ck_negotiation_policies_ttl_order",
      );
    }
    this.rows = [...policies];
  }

  async find(policyVersion: number): Promise<NegotiationPolicy | null> {
    return this.rows.find((row) => row.policyVersion === policyVersion) ?? null;
  }

  /** The highest frozen version. An unfrozen row is never «active». */
  async findActive(): Promise<NegotiationPolicy | null> {
    const frozen = this.rows.filter((row) => row.isFrozen);
    if (frozen.length === 0) return null;
    return frozen.reduce((best, row) => (row.policyVersion > best.policyVersion ? row : best));
  }

  async list(): Promise<NegotiationPolicy[]> {
    return [...this.rows];
  }
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export class InMemoryThreadRepository implements ThreadRepository {
  private readonly rows = new Map<string, NegotiationThread>();

  async find(threadId: string): Promise<NegotiationThread | null> {
    return this.rows.get(threadId) ?? null;
  }

  async findByOrderAndDriver(
    orderPublicId: string,
    driverPublicId: string,
  ): Promise<NegotiationThread | null> {
    for (const row of this.rows.values()) {
      if (row.orderPublicId === orderPublicId && row.driverPublicId === driverPublicId) return row;
    }
    return null;
  }

  async findByDispatchOffer(dispatchOfferId: string): Promise<NegotiationThread | null> {
    for (const row of this.rows.values()) {
      if (row.dispatchOfferId === dispatchOfferId) return row;
    }
    return null;
  }

  async create(input: CreateThreadInput): Promise<NegotiationThread> {
    // ux_negotiation_threads_order_driver — reachable by a caller, so a published
    // conflict rather than a bug signal.
    if ((await this.findByOrderAndDriver(input.orderPublicId, input.driverPublicId)) !== null) {
      throw threadAlreadyExists();
    }
    // ux_negotiation_threads_dispatch_offer — same offer, second thread.
    if ((await this.findByDispatchOffer(input.dispatchOfferId)) !== null) {
      throw threadAlreadyExists("ux_negotiation_threads_dispatch_offer");
    }
    const row: NegotiationThread = {
      id: input.id,
      orderPublicId: input.orderPublicId,
      customerPublicId: input.customerPublicId,
      driverPublicId: input.driverPublicId,
      dispatchOfferId: input.dispatchOfferId,
      serviceKind: input.serviceKind,
      state: "open",
      closeReasonCode: null,
      policyVersion: input.policyVersion,
      currency: input.currency,
      openingAmountMinor: input.openingAmountMinor,
      openedBy: input.openedBy,
      roundCount: 0,
      currentRoundNo: 0,
      agreedRoundNo: null,
      expiresAt: input.expiresAt,
      nextTickAt: input.nextTickAt,
      closedAt: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      version: 1,
    };
    this.assertThreadConstraints(row);
    this.rows.set(row.id, row);
    return row;
  }

  async update(
    threadId: string,
    mutation: ThreadMutation,
    at: string,
    expectedVersion: number,
  ): Promise<NegotiationThread> {
    const current = this.rows.get(threadId);
    if (current === undefined) throw threadNotFound();
    // The optimistic guard. Raised as ROUND_STALE and not as a bug: two clients
    // racing to accept is normal, and the loser must be told to re-read rather than
    // shown an internal error.
    if (current.version !== expectedVersion) {
      throw roundStale(expectedVersion, current.version);
    }
    const next: NegotiationThread = {
      ...current,
      ...mutation,
      updatedAt: at,
      version: current.version + 1,
    };
    this.assertThreadConstraints(next);
    this.rows.set(threadId, next);
    return next;
  }

  async list(filter: ThreadFilter, limit: number): Promise<NegotiationThread[]> {
    const matches = [...this.rows.values()].filter((row) => {
      if (filter.orderPublicId !== undefined && row.orderPublicId !== filter.orderPublicId) {
        return false;
      }
      if (filter.driverPublicId !== undefined && row.driverPublicId !== filter.driverPublicId) {
        return false;
      }
      if (filter.state !== undefined && row.state !== filter.state) return false;
      return true;
    });
    // Newest first, matching `ix_negotiation_threads_order (…, created_at DESC)`.
    matches.sort((left, right) => toEpochMillis(right.createdAt) - toEpochMillis(left.createdAt));
    return matches.slice(0, limit);
  }

  async listDueForTick(now: string, limit: number): Promise<NegotiationThread[]> {
    // The partial index's predicate, honoured: only open threads with a due moment.
    const due = [...this.rows.values()].filter(
      (row) => row.state === "open" && row.nextTickAt !== null && isDue(row.nextTickAt, now),
    );
    due.sort((left, right) => toEpochMillis(left.nextTickAt!) - toEpochMillis(right.nextTickAt!));
    return due.slice(0, limit);
  }

  /** All seven thread constraints, by name. */
  private assertThreadConstraints(row: NegotiationThread): void {
    assertConstraint(
      row.state !== "open" ||
        (row.closedAt === null && row.agreedRoundNo === null && row.closeReasonCode === null),
      "ck_negotiation_threads_open_is_clean",
    );
    assertConstraint(
      row.state === "open" ||
        (row.closedAt !== null && row.closeReasonCode !== null && row.nextTickAt === null),
      "ck_negotiation_threads_closed_has_reason",
    );
    assertConstraint(
      row.state === "open" ||
        (row.state === "agreed" && row.agreedRoundNo !== null && row.closeReasonCode === "agreed") ||
        (row.state !== "agreed" && row.agreedRoundNo === null && row.closeReasonCode !== "agreed"),
      "ck_negotiation_threads_agreed_names_round",
    );
    assertConstraint(
      row.currentRoundNo <= row.roundCount,
      "ck_negotiation_threads_round_counters",
    );
    assertConstraint(
      row.agreedRoundNo === null || row.agreedRoundNo <= row.currentRoundNo,
      "ck_negotiation_threads_agreed_round_exists",
    );
  }
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

export class InMemoryRoundRepository implements RoundRepository {
  private readonly rows: NegotiationRound[] = [];

  async list(threadId: string): Promise<NegotiationRound[]> {
    return this.rows
      .filter((row) => row.threadId === threadId)
      .sort((left, right) => left.roundNo - right.roundNo);
  }

  async find(threadId: string, roundNo: number): Promise<NegotiationRound | null> {
    return this.rows.find((row) => row.threadId === threadId && row.roundNo === roundNo) ?? null;
  }

  async findPending(threadId: string): Promise<NegotiationRound | null> {
    return this.rows.find((row) => row.threadId === threadId && row.state === "pending") ?? null;
  }

  async findAccepted(threadId: string): Promise<NegotiationRound | null> {
    return this.rows.find((row) => row.threadId === threadId && row.state === "accepted") ?? null;
  }

  async create(input: CreateRoundInput): Promise<NegotiationRound> {
    // ux_negotiation_rounds_thread_no
    if ((await this.find(input.threadId, input.roundNo)) !== null) {
      throw new NegotiationConstraintViolation("ux_negotiation_rounds_thread_no");
    }
    // ux_negotiation_rounds_one_pending — a caller CAN reach this by proposing out
    // of turn, so it is a published conflict naming whose turn it is.
    const pending = await this.findPending(input.threadId);
    if (pending !== null) {
      throw turnViolation(pending.proposedBy === "customer" ? "driver" : "customer");
    }
    const row: NegotiationRound = {
      id: input.id,
      threadId: input.threadId,
      roundNo: input.roundNo,
      proposedBy: input.proposedBy,
      amountMinor: input.amountMinor,
      currency: input.currency,
      state: "pending",
      resolvedBy: null,
      expiresAt: input.expiresAt,
      respondedAt: null,
      createdAt: input.createdAt,
    };
    this.assertRoundConstraints(row);
    this.rows.push(row);
    return row;
  }

  async resolve(
    threadId: string,
    roundNo: number,
    resolution: RoundResolution,
  ): Promise<NegotiationRound> {
    const index = this.rows.findIndex(
      (row) => row.threadId === threadId && row.roundNo === roundNo,
    );
    if (index === -1) throw roundNotFound();
    const next: NegotiationRound = { ...this.rows[index]!, ...resolution };
    // ux_negotiation_rounds_one_accepted
    if (next.state === "accepted") {
      const existing = await this.findAccepted(threadId);
      if (existing !== null && existing.roundNo !== roundNo) throw alreadyAgreed();
    }
    this.assertRoundConstraints(next);
    this.rows[index] = next;
    return next;
  }

  async listPendingDue(now: string, limit: number): Promise<NegotiationRound[]> {
    const due = this.rows.filter((row) => row.state === "pending" && isDue(row.expiresAt, now));
    due.sort((left, right) => toEpochMillis(left.expiresAt) - toEpochMillis(right.expiresAt));
    return due.slice(0, limit);
  }

  private assertRoundConstraints(row: NegotiationRound): void {
    // ck_negotiation_rounds_no_self_resolution — reachable by a caller, so the
    // published code, with the constraint named in its details.
    if (row.resolvedBy !== null && row.resolvedBy === row.proposedBy) throw selfAcceptForbidden();
    const timestampCoherent =
      (row.state === "pending" && row.respondedAt === null && row.resolvedBy === null) ||
      ((row.state === "accepted" || row.state === "rejected") &&
        row.respondedAt !== null &&
        row.resolvedBy !== null) ||
      ((row.state === "superseded" || row.state === "expired") && row.resolvedBy === null);
    assertConstraint(timestampCoherent, "ck_negotiation_rounds_state_timestamp");
  }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export class InMemoryMessageRepository implements MessageRepository {
  private readonly rows: NegotiationMessage[] = [];

  async list(threadId: string): Promise<NegotiationMessage[]> {
    return this.rows
      .filter((row) => row.threadId === threadId)
      .sort((left, right) => left.sequenceNo - right.sequenceNo);
  }

  async count(threadId: string): Promise<number> {
    return this.rows.filter((row) => row.threadId === threadId).length;
  }

  async create(input: CreateMessageInput): Promise<NegotiationMessage> {
    // ux_negotiation_messages_thread_seq
    const clash = this.rows.some(
      (row) => row.threadId === input.threadId && row.sequenceNo === input.sequenceNo,
    );
    assertConstraint(!clash, "ux_negotiation_messages_thread_seq");
    const row: NegotiationMessage = {
      id: input.id,
      threadId: input.threadId,
      sequenceNo: input.sequenceNo,
      authorRole: input.authorRole,
      body: input.body,
      sourceLocale: input.sourceLocale,
      systemCode: input.systemCode,
      roundNo: input.roundNo,
      redactedAt: null,
      redactionReasonCode: null,
      createdAt: input.createdAt,
    };
    this.assertMessageConstraints(row);
    this.rows.push(row);
    return row;
  }

  async redact(
    threadId: string,
    messageId: string,
    reasonCode: string,
    at: string,
  ): Promise<NegotiationMessage> {
    const index = this.rows.findIndex((row) => row.threadId === threadId && row.id === messageId);
    if (index === -1) throw threadNotFound();
    const next: NegotiationMessage = {
      ...this.rows[index]!,
      // The row survives; the text does not. See `MessageRepository.redact`.
      body: null,
      redactedAt: at,
      redactionReasonCode: reasonCode,
    };
    this.assertMessageConstraints(next);
    this.rows[index] = next;
    return next;
  }

  private assertMessageConstraints(row: NegotiationMessage): void {
    const bodyOrCode =
      ((row.authorRole === "customer" || row.authorRole === "driver") &&
        row.systemCode === null &&
        (row.body !== null || row.redactedAt !== null)) ||
      (row.authorRole === "system" && row.systemCode !== null && row.body === null);
    assertConstraint(bodyOrCode, "ck_negotiation_messages_body_or_code");
    const redaction =
      (row.redactedAt === null && row.redactionReasonCode === null) ||
      (row.redactedAt !== null && row.redactionReasonCode !== null && row.body === null);
    assertConstraint(redaction, "ck_negotiation_messages_redaction");
  }
}

// ---------------------------------------------------------------------------
// Agreements
// ---------------------------------------------------------------------------

export class InMemoryAgreementRepository implements AgreementRepository {
  private readonly rows = new Map<string, NegotiationAgreement>();

  async find(threadId: string): Promise<NegotiationAgreement | null> {
    return this.rows.get(threadId) ?? null;
  }

  async findByOrder(orderPublicId: string): Promise<NegotiationAgreement | null> {
    for (const row of this.rows.values()) {
      if (row.orderPublicId === orderPublicId) return row;
    }
    return null;
  }

  async create(input: CreateAgreementInput): Promise<NegotiationAgreement> {
    // ux_negotiation_agreements_order_driver — deliberately duplicating the thread's
    // own unique constraint, because this table is read alone often enough that its
    // integrity must not depend on remembering another table's index.
    for (const row of this.rows.values()) {
      if (row.orderPublicId === input.orderPublicId && row.driverPublicId === input.driverPublicId) {
        throw alreadyAgreed("ux_negotiation_agreements_order_driver");
      }
    }
    const agreement: NegotiationAgreement = {
      threadId: input.threadId,
      orderPublicId: input.orderPublicId,
      driverPublicId: input.driverPublicId,
      roundNo: input.roundNo,
      amountMinor: input.amountMinor,
      currency: input.currency,
      acceptedBy: input.acceptedBy,
      policyVersion: input.policyVersion,
      agreedAt: input.agreedAt,
      handoffState: "pending",
      handoffAttempts: 0,
      handedOffAt: null,
      nextHandoffAt: input.nextHandoffAt,
      lastErrorCode: null,
      createdAt: input.agreedAt,
      updatedAt: input.agreedAt,
    };
    this.assertAgreementConstraints(agreement);
    this.rows.set(agreement.threadId, agreement);
    return agreement;
  }

  async update(
    threadId: string,
    mutation: HandoffMutation,
    at: string,
  ): Promise<NegotiationAgreement> {
    const current = this.rows.get(threadId);
    if (current === undefined) throw threadNotFound();
    const next: NegotiationAgreement = { ...current, ...mutation, updatedAt: at };
    this.assertAgreementConstraints(next);
    this.rows.set(threadId, next);
    return next;
  }

  async listHandoffDue(now: string, limit: number): Promise<NegotiationAgreement[]> {
    const due = [...this.rows.values()].filter(
      (row) =>
        row.handoffState === "pending" && row.nextHandoffAt !== null && isDue(row.nextHandoffAt, now),
    );
    due.sort((left, right) => toEpochMillis(left.nextHandoffAt!) - toEpochMillis(right.nextHandoffAt!));
    return due.slice(0, limit);
  }

  private assertAgreementConstraints(row: NegotiationAgreement): void {
    assertConstraint(
      (row.handoffState === "handed_off" &&
        row.handedOffAt !== null &&
        row.nextHandoffAt === null) ||
        (row.handoffState !== "handed_off" && row.handedOffAt === null),
      "ck_negotiation_agreements_handed_off_at",
    );
    assertConstraint(
      (row.handoffState !== "rejected" && row.handoffState !== "abandoned") ||
        row.nextHandoffAt === null,
      "ck_negotiation_agreements_terminal_no_retry",
    );
    assertConstraint(
      (row.handoffState !== "rejected" && row.handoffState !== "abandoned") ||
        row.lastErrorCode !== null,
      "ck_negotiation_agreements_failure_named",
    );
  }
}

// ---------------------------------------------------------------------------
// Price hand-off attempts
// ---------------------------------------------------------------------------

export class InMemoryPriceHandoffRepository implements PriceHandoffRepository {
  private readonly rows: NegotiationPriceHandoff[] = [];

  async begin(input: {
    readonly id: string;
    readonly threadId: string;
    readonly attemptNo: number;
    readonly amountMinor: number;
    readonly currency: string;
    readonly requestedAt: string;
  }): Promise<NegotiationPriceHandoff> {
    // ux_negotiation_price_handoffs_attempt
    const clash = this.rows.some(
      (row) => row.threadId === input.threadId && row.attemptNo === input.attemptNo,
    );
    assertConstraint(!clash, "ux_negotiation_price_handoffs_attempt");
    const row: NegotiationPriceHandoff = {
      ...input,
      // Written before the outcome is known — that is the whole point of `begin`.
      outcome: null,
      responseStatus: null,
      errorCode: null,
      completedAt: null,
    };
    this.assertHandoffConstraints(row);
    this.rows.push(row);
    return row;
  }

  async complete(
    id: string,
    outcome: {
      readonly outcome: NegotiationPriceHandoff["outcome"];
      readonly responseStatus: number | null;
      readonly errorCode: string | null;
      readonly completedAt: string;
    },
  ): Promise<NegotiationPriceHandoff> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) throw threadNotFound();
    const next: NegotiationPriceHandoff = { ...this.rows[index]!, ...outcome };
    this.assertHandoffConstraints(next);
    this.rows[index] = next;
    return next;
  }

  async list(threadId: string): Promise<NegotiationPriceHandoff[]> {
    return this.rows
      .filter((row) => row.threadId === threadId)
      .sort((left, right) => right.attemptNo - left.attemptNo);
  }

  private assertHandoffConstraints(row: NegotiationPriceHandoff): void {
    assertConstraint(
      (row.outcome === null && row.completedAt === null) ||
        (row.outcome !== null && row.completedAt !== null),
      "ck_negotiation_price_handoffs_completion",
    );
    assertConstraint(
      row.outcome === null || row.outcome === "accepted" || row.errorCode !== null,
      "ck_negotiation_price_handoffs_failure_named",
    );
  }
}

// ---------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------

export class InMemoryOutbox implements Outbox {
  private readonly events: NegotiationDomainEvent[] = [];

  async append(event: NegotiationDomainEvent): Promise<void> {
    this.events.push(event);
  }

  async unread(): Promise<NegotiationDomainEvent[]> {
    return [...this.events];
  }

  /** Test convenience: every event emitted, in order — used by the privacy sweep. */
  all(): NegotiationDomainEvent[] {
    return [...this.events];
  }

  /** Test convenience: every event of one type, in order. */
  ofType<T extends NegotiationDomainEvent["event_type"]>(
    type: T,
  ): Extract<NegotiationDomainEvent, { event_type: T }>[] {
    return this.events.filter((event) => event.event_type === type) as Extract<
      NegotiationDomainEvent,
      { event_type: T }
    >[];
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly rows = new Map<string, { scope: string; payloadFingerprint: string }>();

  async find(key: string): Promise<{ scope: string; payloadFingerprint: string } | null> {
    return this.rows.get(key) ?? null;
  }

  async remember(key: string, scope: string, payloadFingerprint: string): Promise<void> {
    this.rows.set(key, { scope, payloadFingerprint });
  }
}

/**
 * A dispatch offer catalogue a test fills by hand.
 *
 * `unavailable` is a separate switch from «absent», because the two produce
 * different statuses (`503` vs `422`) and the suite has to be able to prove that a
 * dispatch outage does not read to a client as «your offer id is wrong».
 */
export class StubDispatchOfferPort implements DispatchOfferPort {
  private readonly offers = new Map<string, DispatchOfferSnapshot>();
  unavailable = false;

  put(snapshot: DispatchOfferSnapshot): void {
    this.offers.set(snapshot.dispatchOfferId, snapshot);
  }

  async describe(dispatchOfferId: string): Promise<DispatchOfferSnapshot | null> {
    if (this.unavailable) throw new Error("dispatch unreachable");
    return this.offers.get(dispatchOfferId) ?? null;
  }
}

/**
 * A scripted `AgreedPricePort`.
 *
 * `mode` covers the three answers that matter: the order engine accepted, it
 * refused (a decision, never retried), or the call itself failed (an outage, which
 * the tick retries). The third is a **throw**, exactly as a real transport failure
 * would be, so the suite proves the caller records `unavailable` and still keeps the
 * agreement.
 */
export class StubAgreedPricePort implements AgreedPricePort {
  mode: "accept" | "reject" | "throw" = "accept";
  readonly calls: {
    orderPublicId: string;
    threadId: string;
    amountMinor: number;
    attemptNo: number;
  }[] = [];

  async handOff(input: {
    readonly orderPublicId: string;
    readonly threadId: string;
    readonly driverPublicId: string;
    readonly amountMinor: number;
    readonly currency: string;
    readonly agreedAt: string;
    readonly attemptNo: number;
  }): Promise<AgreedPriceHandoffResult> {
    this.calls.push({
      orderPublicId: input.orderPublicId,
      threadId: input.threadId,
      amountMinor: input.amountMinor,
      attemptNo: input.attemptNo,
    });
    if (this.mode === "throw") throw new Error("order engine unreachable");
    if (this.mode === "reject") {
      return { outcome: "rejected", responseStatus: 409, errorCode: "ORDER_NOT_ACCEPTING_PRICE" };
    }
    return { outcome: "accepted", responseStatus: 200, errorCode: null };
  }
}

/** The whole dependency set, in memory, wired and ready. */
export interface InMemoryNegotiationDependencies extends NegotiationDependencies {
  readonly threads: InMemoryThreadRepository;
  readonly rounds: InMemoryRoundRepository;
  readonly messages: InMemoryMessageRepository;
  readonly agreements: InMemoryAgreementRepository;
  readonly handoffs: InMemoryPriceHandoffRepository;
  readonly policies: InMemoryPolicyRepository;
  readonly offers: StubDispatchOfferPort;
  readonly agreedPrice: StubAgreedPricePort;
  readonly outbox: InMemoryOutbox;
  readonly idempotency: InMemoryIdempotencyStore;
  readonly clock: MutableClock;
  readonly ids: SequentialIdGenerator;
}

export function createInMemoryNegotiationDependencies(
  overrides: { readonly clock?: MutableClock } = {},
): InMemoryNegotiationDependencies {
  return {
    threads: new InMemoryThreadRepository(),
    rounds: new InMemoryRoundRepository(),
    messages: new InMemoryMessageRepository(),
    agreements: new InMemoryAgreementRepository(),
    handoffs: new InMemoryPriceHandoffRepository(),
    policies: new InMemoryPolicyRepository(),
    offers: new StubDispatchOfferPort(),
    agreedPrice: new StubAgreedPricePort(),
    outbox: new InMemoryOutbox(),
    idempotency: new InMemoryIdempotencyStore(),
    clock: overrides.clock ?? new MutableClock(),
    ids: new SequentialIdGenerator(),
  };
}
