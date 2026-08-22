/**
 * Postgres adapters for the matching ports (Phase 07 · MR 3/6).
 *
 * Five adapters against the canonical DDL in
 * `services/matching/contracts/schema.sql`:
 * `PostgresCandidacyRepository`, `PostgresRulesetRepository`,
 * `PostgresDecisionRepository`, `PostgresMatchingOutbox` and
 * `PostgresIdempotencyStore`.
 *
 * The binding criterion inherited from Phase 06 (ORDER_PERSISTENCE.md) and
 * repeated for this MR: **no use case changes when the in-memory adapters are
 * swapped for these.** Nothing under `src/use-cases/` is touched by this MR, and
 * the property is proven — not asserted — by
 * `src/__tests__/port-conformance.integration.test.ts`, which runs one set of
 * scenarios twice, once per adapter, and compares the results to each other.
 *
 * Atomicity (schema.sql §5): every adapter takes a `DbOrTx` handle instead of
 * opening its own transaction. `PostgresMatchingUnitOfWork` (transaction.ts)
 * hands the SAME tx to all five, so the row write + the idempotency key + the
 * outbox event commit or roll back together. An adapter with an internal
 * transaction could never cover the `outbox.append()` that the use case makes as
 * a separate call afterwards.
 *
 * Four deliberate choices, each with a cheaper wrong version:
 *
 *  1. **`listForEvaluation` returns EVERY row, unfiltered.** It is tempting to
 *     push (available · eligible · fresh) into SQL and use `ix_candidacy_ready`.
 *     That would change the meaning of `counts.considered`, which the contract
 *     defines as every row that took part, and it would move the documented
 *     filter ORDER — and therefore the `empty_reason_code` an operator reads —
 *     from tested domain code into a query plan. The pushdown is declared debt
 *     for Phase 09, when the row count justifies it and the counts can be
 *     computed in SQL alongside it.
 *
 *  2. **`replace` is a full replacement that preserves what the writer does not
 *     own.** `ON CONFLICT DO UPDATE` overwrites the declared columns and leaves
 *     `created_at` and the matching-history columns (counters, `last_offered_at`,
 *     `last_assigned_at`) untouched: the driver bot declares availability and
 *     zones, it does not own the offer history. Overwriting them with defaults
 *     would silently reset every driver's fairness input on a routine PUT.
 *
 *  3. **`TIMESTAMPTZ` becomes an ISO string here, once.** `pg` returns `Date`
 *     objects; letting one escape into the domain would make `updatedAt`
 *     sometimes a string and sometimes a Date, and the freshness comparison would
 *     start depending on which adapter produced the row.
 *
 *  4. **Constraint violations are translated into `MatchingError`.** Postgres
 *     raises SQLSTATE 23505/23514 where the in-memory adapter throws a domain
 *     error. A caller must not have to know which adapter it holds, so the
 *     constraints the use cases rely on surface with the same code from both.
 */

import { asc, eq, inArray, sql } from "drizzle-orm";

import type { MatchingDomainEvent } from "@wasla/contracts-matching";

import { MatchingError, validationFailed } from "../../domain/errors.js";
import type {
  AvailabilityState,
  Candidacy,
  CandidacyWriter,
  EligibilitySource,
  EligibilityState,
  MatchingDecision,
  MatchingEmptyReasonCode,
  RankedCandidate,
  Ruleset,
  ServiceKind,
  TiebreakReason,
  VehicleClass,
} from "../../domain/model.js";
import { candidacyNotFound } from "../../domain/errors.js";
import type {
  CandidacyRepository,
  DecisionRepository,
  IdempotencyStore,
  Outbox,
  RulesetRepository,
  UpsertCandidacyInput,
} from "../../ports.js";
import type { DbOrTx } from "./db.js";
import {
  driverCandidacy,
  matchingDecisionCandidates,
  matchingDecisions,
  matchingIdempotency,
  matchingOutbox,
  matchingRulesets,
} from "./schema.js";

// --------------------------------------------------------------------------- //
// Column ⇄ domain conversions                                                //
// --------------------------------------------------------------------------- //

/** `pg` returns TIMESTAMPTZ as a Date; the domain speaks ISO-8601 strings. */
function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** Non-null variant for the columns the contract declares NOT NULL. */
function toIsoRequired(value: Date): string {
  return value.toISOString();
}

interface CandidacyRow {
  driverPublicId: string;
  availabilityState: string;
  eligibilityState: string;
  eligibilitySource: string;
  serviceKinds: string[];
  vehicleClass: string | null;
  zoneIds: string[];
  lastOfferedAt: Date | null;
  lastAssignedAt: Date | null;
  offersReceived: number;
  offersAccepted: number;
  ordersCompleted: number;
  updatedAt: Date;
  createdAt: Date;
  updatedBy: string;
}

/**
 * Rebuild the domain row from the stored one.
 *
 * The closed lists are re-asserted by the CHECK constraints, so the casts here
 * describe what the database already guarantees rather than trusting the caller.
 */
function toCandidacy(row: CandidacyRow): Candidacy {
  return {
    driverPublicId: row.driverPublicId,
    availabilityState: row.availabilityState as AvailabilityState,
    eligibilityState: row.eligibilityState as EligibilityState,
    eligibilitySource: row.eligibilitySource as EligibilitySource,
    serviceKinds: row.serviceKinds as ServiceKind[],
    vehicleClass: row.vehicleClass as VehicleClass | null,
    zoneIds: row.zoneIds,
    lastOfferedAt: toIso(row.lastOfferedAt),
    lastAssignedAt: toIso(row.lastAssignedAt),
    offersReceived: row.offersReceived,
    offersAccepted: row.offersAccepted,
    ordersCompleted: row.ordersCompleted,
    updatedAt: toIsoRequired(row.updatedAt),
    createdAt: toIsoRequired(row.createdAt),
    updatedBy: row.updatedBy as CandidacyWriter,
  };
}

/**
 * SQLSTATE of the violation, found by walking the error's cause chain.
 *
 * Drizzle does NOT rethrow the driver's error: it wraps it in its own
 * `DrizzleQueryError` whose message is the failed SQL, and hangs the real
 * `pg.DatabaseError` — the one carrying `code` and `constraint` — on `cause`.
 * Reading `error.code` directly therefore finds nothing, and every constraint
 * violation escapes untranslated as an opaque "Failed query: insert into …". The
 * order engine hit the same wall in Phase 06 and walks the chain for the same
 * reason (`postgresCode` in services/orders); the depth bound keeps a cyclic
 * `cause` from spinning.
 */
function sqlState(error: unknown): string | undefined {
  let cursor: unknown = error;
  for (let depth = 0; depth < 4 && cursor !== null && cursor !== undefined; depth += 1) {
    if (typeof cursor !== "object") return undefined;
    const code = (cursor as { code?: unknown }).code;
    // A SQLSTATE is exactly five characters; Node's own error codes
    // ("ECONNREFUSED", "ERR_…") are not, and must not be mistaken for one.
    if (typeof code === "string" && code.length === 5) return code;
    const cause = (cursor as { cause?: unknown }).cause;
    if (cause === cursor) return undefined;
    cursor = cause;
  }
  return undefined;
}

/**
 * Name of the violated constraint, when the driver exposes it.
 *
 * Used only to keep the constraint identifiable in the message of an untranslated
 * failure: a bare "Failed query" forces the reader to reproduce the write to
 * learn which promise of the DDL was broken.
 */
function constraintName(error: unknown): string | undefined {
  let cursor: unknown = error;
  for (let depth = 0; depth < 4 && cursor !== null && cursor !== undefined; depth += 1) {
    if (typeof cursor !== "object") return undefined;
    const constraint = (cursor as { constraint?: unknown }).constraint;
    if (typeof constraint === "string") return constraint;
    const cause = (cursor as { cause?: unknown }).cause;
    if (cause === cursor) return undefined;
    cursor = cause;
  }
  return undefined;
}

/**
 * Re-throw a database error with the violated constraint named in its message.
 *
 * Anything not translated into a domain error still has to be READABLE. Drizzle's
 * own message is the SQL text, which says what was attempted but not which
 * invariant refused it.
 */
function rethrowNamed(error: unknown): never {
  const constraint = constraintName(error);
  if (constraint !== undefined && error instanceof Error) {
    error.message = `${constraint}: ${error.message}`;
  }
  throw error;
}

/**
 * Translate a CHECK violation into the same domain error the pure validators
 * raise, so a caller sees one contract regardless of adapter. Anything else is
 * re-thrown with its constraint named: hiding an unknown database failure behind
 * a validation error would send the reader to the wrong file.
 */
function translateCheck<T>(field: string, expected: string, error: unknown): T {
  if (sqlState(error) === "23514") throw validationFailed(field, expected);
  return rethrowNamed(error);
}

// --------------------------------------------------------------------------- //
// 1) driver_candidacy                                                        //
// --------------------------------------------------------------------------- //

export class PostgresCandidacyRepository implements CandidacyRepository {
  constructor(private readonly db: DbOrTx) {}

  async find(driverPublicId: string): Promise<Candidacy | null> {
    const rows = await this.db
      .select()
      .from(driverCandidacy)
      .where(eq(driverCandidacy.driverPublicId, driverPublicId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toCandidacy(row);
  }

  /**
   * Every row that could take part, unordered and UNFILTERED (choice 1 above).
   * The hard filters and their order live in the domain, and `counts.considered`
   * counts what this returns.
   */
  async listForEvaluation(): Promise<Candidacy[]> {
    const rows = await this.db.select().from(driverCandidacy);
    return rows.map(toCandidacy);
  }

  async replace(input: UpsertCandidacyInput): Promise<Candidacy> {
    const updatedAt = new Date(input.updatedAt);
    try {
      const rows = await this.db
        .insert(driverCandidacy)
        .values({
          driverPublicId: input.driverPublicId,
          availabilityState: input.availabilityState,
          eligibilityState: input.eligibilityState,
          eligibilitySource: input.eligibilitySource,
          serviceKinds: [...input.serviceKinds],
          vehicleClass: input.vehicleClass,
          zoneIds: [...input.zoneIds],
          updatedBy: input.updatedBy,
          updatedAt,
          createdAt: updatedAt,
        })
        .onConflictDoUpdate({
          target: driverCandidacy.driverPublicId,
          // Exactly the declared columns. `created_at` and the history columns
          // are absent on purpose (choice 2 above).
          set: {
            availabilityState: input.availabilityState,
            eligibilityState: input.eligibilityState,
            eligibilitySource: input.eligibilitySource,
            serviceKinds: [...input.serviceKinds],
            vehicleClass: input.vehicleClass,
            zoneIds: [...input.zoneIds],
            updatedBy: input.updatedBy,
            updatedAt,
          },
        })
        .returning();
      return toCandidacy(rows[0] as CandidacyRow);
    } catch (error) {
      return translateCheck("driverPublicId", "WS-0000000000 shape", error);
    }
  }

  /**
   * Availability only — the narrow path for the most frequent write.
   *
   * `UPDATE … RETURNING` with no row means no candidacy: a row born from an
   * availability call would be a candidate with no eligibility and no zones,
   * which is precisely the "unknown is a candidate" failure the model forbids.
   */
  async setAvailability(
    driverPublicId: string,
    state: AvailabilityState,
    changedAt: string,
  ): Promise<Candidacy> {
    const rows = await this.db
      .update(driverCandidacy)
      .set({ availabilityState: state, updatedAt: new Date(changedAt) })
      .where(eq(driverCandidacy.driverPublicId, driverPublicId))
      .returning();
    const row = rows[0];
    if (row === undefined) throw candidacyNotFound();
    return toCandidacy(row);
  }

  /**
   * Test/seed door for the matching-history columns the SERVICE writes elsewhere
   * (offers received, acceptance, completion, fairness stamps). Deliberately NOT
   * part of the port — the mirror of `InMemoryCandidacyRepository.seed` — so no
   * use case can set them through this door.
   */
  async seed(row: Candidacy): Promise<void> {
    const offersReceived = Math.max(row.offersReceived, 0);
    const values = {
      driverPublicId: row.driverPublicId,
      availabilityState: row.availabilityState,
      eligibilityState: row.eligibilityState,
      eligibilitySource: row.eligibilitySource,
      serviceKinds: [...row.serviceKinds],
      vehicleClass: row.vehicleClass,
      zoneIds: [...row.zoneIds],
      lastOfferedAt: row.lastOfferedAt === null ? null : new Date(row.lastOfferedAt),
      lastAssignedAt: row.lastAssignedAt === null ? null : new Date(row.lastAssignedAt),
      offersReceived,
      offersAccepted: Math.min(Math.max(row.offersAccepted, 0), offersReceived),
      ordersCompleted: Math.max(row.ordersCompleted, 0),
      updatedAt: new Date(row.updatedAt),
      createdAt: new Date(row.createdAt),
      updatedBy: row.updatedBy,
    };
    await this.db
      .insert(driverCandidacy)
      .values(values)
      .onConflictDoUpdate({ target: driverCandidacy.driverPublicId, set: values });
  }
}

// --------------------------------------------------------------------------- //
// 2) matching_rulesets                                                       //
// --------------------------------------------------------------------------- //

interface RulesetRow {
  version: number;
  label: string;
  wEta: number;
  wDistance: number;
  wZoneProximity: number;
  wCompletion: number;
  wRating: number;
  wAcceptance: number;
  wFairness: number;
  candidacyFreshnessSeconds: number;
  maxCandidates: number;
  fairnessHorizonSeconds: number;
  isFrozen: boolean;
  createdAt: Date;
  frozenAt: Date | null;
}

function toRuleset(row: RulesetRow): Ruleset {
  return {
    version: row.version,
    label: row.label,
    weights: {
      eta: row.wEta,
      distance: row.wDistance,
      zoneProximity: row.wZoneProximity,
      completion: row.wCompletion,
      rating: row.wRating,
      acceptance: row.wAcceptance,
      fairness: row.wFairness,
    },
    candidacyFreshnessSeconds: row.candidacyFreshnessSeconds,
    maxCandidates: row.maxCandidates,
    fairnessHorizonSeconds: row.fairnessHorizonSeconds,
    isFrozen: row.isFrozen,
    createdAt: toIsoRequired(row.createdAt),
    frozenAt: toIso(row.frozenAt),
  };
}

/**
 * Read-only in this phase: version 1 is seeded and frozen by schema.sql, and a
 * new version is a migration, not an API call (ADR-011 decision 6).
 */
export class PostgresRulesetRepository implements RulesetRepository {
  constructor(private readonly db: DbOrTx) {}

  async find(version: number): Promise<Ruleset | null> {
    const rows = await this.db
      .select()
      .from(matchingRulesets)
      .where(eq(matchingRulesets.version, version))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRuleset(row);
  }

  /** The newest FROZEN version: an editable ruleset must never become the default. */
  async findActive(): Promise<Ruleset | null> {
    const rows = await this.db
      .select()
      .from(matchingRulesets)
      .where(eq(matchingRulesets.isFrozen, true))
      .orderBy(sql`${matchingRulesets.version} DESC`)
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRuleset(row);
  }

  async list(): Promise<Ruleset[]> {
    const rows = await this.db
      .select()
      .from(matchingRulesets)
      .orderBy(asc(matchingRulesets.version));
    return rows.map(toRuleset);
  }

  /**
   * Migration/test door: add a version (e.g. an unfrozen one, to prove it cannot
   * rank). Outside the port — the mirror of `InMemoryRulesetRepository.put` — so
   * no use case can create a ruleset at runtime.
   */
  async put(ruleset: Ruleset): Promise<void> {
    const values = {
      version: ruleset.version,
      label: ruleset.label,
      wEta: ruleset.weights.eta,
      wDistance: ruleset.weights.distance,
      wZoneProximity: ruleset.weights.zoneProximity,
      wCompletion: ruleset.weights.completion,
      wRating: ruleset.weights.rating,
      wAcceptance: ruleset.weights.acceptance,
      wFairness: ruleset.weights.fairness,
      candidacyFreshnessSeconds: ruleset.candidacyFreshnessSeconds,
      maxCandidates: ruleset.maxCandidates,
      fairnessHorizonSeconds: ruleset.fairnessHorizonSeconds,
      isFrozen: ruleset.isFrozen,
      createdAt: new Date(ruleset.createdAt),
      frozenAt: ruleset.frozenAt === null ? null : new Date(ruleset.frozenAt),
    };
    try {
      await this.db
        .insert(matchingRulesets)
        .values(values)
        .onConflictDoUpdate({ target: matchingRulesets.version, set: values });
    } catch (error) {
      // The weights-sum and frozen_at guards are the two that reorder or
      // invalidate every future ranking; a bare "Failed query" would hide which.
      return rethrowNamed(error);
    }
  }
}

// --------------------------------------------------------------------------- //
// 3) matching_decisions + matching_decision_candidates                       //
// --------------------------------------------------------------------------- //

/**
 * Append-only audit store: a decision is never updated and never deleted.
 *
 * The head row and its score rows are two INSERTs, and they must not be
 * separable: a decision without its candidates would answer "why this driver?"
 * with silence. Both therefore run inside whichever transaction the Unit of Work
 * opened; when there is none (a read-only composition), the second INSERT is
 * still one statement, so a partial write requires a crash between two
 * statements of the same connection — which is exactly why the write path is a
 * transaction and the atomicity test pins it.
 */
export class PostgresDecisionRepository implements DecisionRepository {
  constructor(private readonly db: DbOrTx) {}

  async append(decision: MatchingDecision): Promise<MatchingDecision> {
    try {
      await this.db.insert(matchingDecisions).values({
        id: decision.id,
        orderId: decision.orderId,
        orderPublicId: decision.orderPublicId,
        dispatchJobId: decision.dispatchJobId,
        rulesetVersion: decision.rulesetVersion,
        requestedAt: new Date(decision.requestedAt),
        evaluatedAt: new Date(decision.evaluatedAt),
        orderType: decision.orderType,
        vehicleClass: decision.vehicleClass,
        pickupZoneId: decision.pickupZoneId,
        excludedCount: decision.counts.excluded,
        consideredCount: decision.counts.considered,
        eligibleCount: decision.counts.eligible,
        returnedCount: decision.counts.returned,
        emptyReasonCode: decision.emptyReasonCode,
        createdAt: new Date(decision.createdAt),
      });
    } catch (error) {
      // A duplicate id is a generator bug, not an update. Same meaning as the
      // in-memory adapter's throw, so a caller cannot tell the two apart.
      if (sqlState(error) === "23505") {
        throw new MatchingError(
          "MATCHING_VALIDATION_FAILED",
          `decision ${decision.id} already exists — decisions are append-only`,
          { details: { field: "decision_id" } },
        );
      }
      // Any other refusal is a broken invariant of the DDL (monotonic counts, an
      // unexplained empty result); name it so the reader is not left with the SQL.
      return rethrowNamed(error);
    }

    if (decision.candidates.length > 0) {
      await this.db.insert(matchingDecisionCandidates).values(
        decision.candidates.map((candidate) => ({
          decisionId: decision.id,
          rank: candidate.rank,
          driverPublicId: candidate.driverPublicId,
          scoreBp: candidate.scoreBp,
          zoneProximityBp: candidate.components.zoneProximityBp,
          completionBp: candidate.components.completionBp,
          acceptanceBp: candidate.components.acceptanceBp,
          fairnessBp: candidate.components.fairnessBp,
          tiebreakBy: candidate.tiebreakBy,
        })),
      );
    }
    return decision;
  }

  async find(decisionId: string): Promise<MatchingDecision | null> {
    const rows = await this.db
      .select()
      .from(matchingDecisions)
      .where(eq(matchingDecisions.id, decisionId))
      .limit(1);
    const head = rows[0];
    if (head === undefined) return null;

    // Ordered by rank, always: the audit answer is a ranking, and a ranking read
    // back in storage order is not one.
    const candidateRows = await this.db
      .select()
      .from(matchingDecisionCandidates)
      .where(eq(matchingDecisionCandidates.decisionId, decisionId))
      .orderBy(asc(matchingDecisionCandidates.rank));

    const candidates: RankedCandidate[] = candidateRows.map((row) => ({
      rank: row.rank,
      driverPublicId: row.driverPublicId,
      scoreBp: row.scoreBp,
      components: {
        zoneProximityBp: row.zoneProximityBp,
        completionBp: row.completionBp,
        acceptanceBp: row.acceptanceBp,
        fairnessBp: row.fairnessBp,
      },
      tiebreakBy: (row.tiebreakBy ?? "score") as TiebreakReason,
    }));

    return {
      id: head.id,
      orderId: head.orderId,
      orderPublicId: head.orderPublicId,
      dispatchJobId: head.dispatchJobId,
      rulesetVersion: head.rulesetVersion,
      requestedAt: toIsoRequired(head.requestedAt),
      evaluatedAt: toIsoRequired(head.evaluatedAt),
      orderType: head.orderType as ServiceKind,
      vehicleClass: head.vehicleClass as VehicleClass,
      pickupZoneId: head.pickupZoneId,
      counts: {
        considered: head.consideredCount,
        eligible: head.eligibleCount,
        returned: head.returnedCount,
        excluded: head.excludedCount,
      },
      emptyReasonCode: head.emptyReasonCode as MatchingEmptyReasonCode | null,
      candidates,
      createdAt: toIsoRequired(head.createdAt),
    };
  }

  /** Row count — used by tests and by the operations path (MR 5/6). */
  async count(): Promise<number> {
    const rows = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(matchingDecisions);
    return rows[0]?.value ?? 0;
  }
}

// --------------------------------------------------------------------------- //
// 4) matching_outbox                                                         //
// --------------------------------------------------------------------------- //

export class PostgresMatchingOutbox implements Outbox {
  constructor(private readonly db: DbOrTx) {}

  async append(event: MatchingDomainEvent): Promise<void> {
    await this.db.insert(matchingOutbox).values({
      eventId: event.event_id,
      eventType: event.event_type,
      eventVersion: event.event_version,
      aggregateType: event.aggregate.type,
      aggregateId: event.aggregate.id,
      payload: event as unknown as Record<string, unknown>,
      traceId: event.trace_id ?? null,
      occurredAt: new Date(event.occurred_at),
    });
  }

  /**
   * Appended-but-unpublished events, in append order.
   *
   * `occurred_at` alone is not an order: two events of one operation share the
   * clock reading of that operation, and the ranking of a candidacy update
   * against its own availability change would then be arbitrary. `event_id` is
   * the tie-break, which the deterministic generator makes monotonic in tests
   * and which is at least stable in production.
   */
  async unread(): Promise<MatchingDomainEvent[]> {
    const rows = await this.db
      .select()
      .from(matchingOutbox)
      .where(sql`${matchingOutbox.publishedAt} IS NULL`)
      .orderBy(asc(matchingOutbox.occurredAt), asc(matchingOutbox.eventId));
    return rows.map((row) => row.payload as unknown as MatchingDomainEvent);
  }

  /** Mark rows as published. Used by the relay (Phase 09) and by tests. */
  async markPublished(
    eventIds: readonly string[],
    publishedAt: string,
  ): Promise<number> {
    if (eventIds.length === 0) return 0;
    const rows = await this.db
      .update(matchingOutbox)
      .set({ publishedAt: new Date(publishedAt) })
      .where(inArray(matchingOutbox.eventId, [...eventIds]))
      .returning({ eventId: matchingOutbox.eventId });
    return rows.length;
  }
}

// --------------------------------------------------------------------------- //
// 5) matching_idempotency                                                    //
// --------------------------------------------------------------------------- //

/**
 * Idempotency memory (§43).
 *
 * `remember` is an upsert on purpose: the same key with the same fingerprint is a
 * retry, and a retry must not fail on a primary-key violation after the use case
 * has already decided that it is a retry. A DIFFERENT fingerprint never reaches
 * here — the use case reads `find` first and raises 409 — so the upsert cannot
 * silently overwrite one caller's key with another's payload.
 */
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: DbOrTx) {}

  async find(key: string): Promise<string | null> {
    const rows = await this.db
      .select({ fingerprint: matchingIdempotency.payloadFingerprint })
      .from(matchingIdempotency)
      .where(eq(matchingIdempotency.idempotencyKey, key))
      .limit(1);
    return rows[0]?.fingerprint ?? null;
  }

  async remember(key: string, payloadFingerprint: string): Promise<void> {
    try {
      await this.db
        .insert(matchingIdempotency)
        .values({ idempotencyKey: key, payloadFingerprint })
        .onConflictDoUpdate({
          target: matchingIdempotency.idempotencyKey,
          set: { payloadFingerprint },
        });
    } catch (error) {
      return translateCheck("Idempotency-Key", "8..128 characters", error);
    }
  }
}
