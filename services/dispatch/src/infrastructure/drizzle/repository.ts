/**
 * Postgres adapters for the dispatch ports (Phase 07 · MR 5a/6).
 *
 * Five adapters against the canonical DDL in
 * `services/dispatch/contracts/schema.sql`: `PostgresJobRepository`,
 * `PostgresWaveRepository`, `PostgresOfferRepository`, `PostgresDispatchOutbox`
 * and `PostgresDispatchIdempotencyStore`.
 *
 * The binding criterion published in advance for this MR (HANDOFF §11,
 * DISPATCH_CORE_DOMAIN §9): **the same use-case tests must pass against these
 * adapters, and no logic under `src/use-cases/` may change to make them pass.**
 * `port-conformance.integration.test.ts` runs one set of scenarios twice — once
 * per adapter — and compares the two outcomes to each other rather than to a
 * hand-written expectation, so a difference cannot be absorbed by editing an
 * assertion. The one place the criterion bent, and why, is
 * DISPATCH_PERSISTENCE.md §2: `dispatch_waves.expires_at` is `NOT NULL` and the
 * value existed only inside an event payload, so the port gained the field and the
 * tick passes it. That is a contract gap this MR found, not a design change.
 *
 * Atomicity (schema.sql §4): every adapter takes a `DbOrTx` handle instead of
 * opening its own transaction. `PostgresDispatchUnitOfWork` (transaction.ts) hands
 * the SAME tx to all five, so a tick's wave row, its offer rows, the job status
 * change and every outbox event commit or roll back together. This matters more
 * here than in any other service: a wave row committed without its offers is an
 * `open` wave that nothing will ever close, and `ux_dispatch_waves_one_open_job`
 * then blocks that job's every future wave — a permanent stall produced by a
 * partial success.
 *
 * Four deliberate choices, each with a cheaper wrong version:
 *
 *  1. **State transitions are validated in the adapter against the SAME domain
 *     tables the in-memory store uses, after `SELECT … FOR UPDATE`.** The cheap
 *     version is a bare `UPDATE … SET status`, which lets the database's CHECK
 *     constraints catch illegal *rows* but not illegal *moves* — `assigned` →
 *     `pending` satisfies every constraint in the DDL. The row lock also closes a
 *     read-then-write race the in-memory store cannot have and Postgres can: two
 *     concurrent resolutions of one offer.
 *
 *  2. **Constraint violations are translated into the same `DispatchError` the
 *     in-memory store raises.** Postgres answers a duplicate with SQLSTATE 23505
 *     and a broken CHECK with 23514; a caller must not have to know which adapter
 *     it holds, so `ux_dispatch_offers_one_accepted_job` surfaces as
 *     `DISPATCH_OFFER_SUPERSEDED` from both.
 *
 *  3. **`TIMESTAMPTZ` becomes an ISO string here, once.** `pg` returns `Date`
 *     objects; letting one escape would make `expiresAt` sometimes a string and
 *     sometimes a Date, and `isDue()` would start depending on which adapter
 *     produced the row.
 *
 *  4. **The rules snapshot is folded back from five flat columns.** The DDL stores
 *     them flat so each one can carry its own CHECK; the domain reads one frozen
 *     `rules` object. The translation lives here rather than in the domain,
 *     because the domain must not know that the snapshot was ever a set of columns.
 */

import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";

import {
  jobAlreadyExists,
  matchingResultInvalid,
  offerSuperseded,
  reasonCodeRequired,
  reasonCodeUnknown,
  validationFailed,
  waveAlreadyOpen,
} from "../../domain/errors.js";
import type { AnyDispatchEvent } from "../../domain/events.js";
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
} from "../../domain/model.js";
import {
  allowedJobReasonCodes,
  allowedOfferReasonCodes,
  allowedWaveReasonCodes,
  DERIVED_TERMINAL_JOB_STATUSES,
  isJobTransitionAllowed,
  isOfferTransitionAllowed,
  isWaveTransitionAllowed,
  jobStatusRequiresReasonCode,
  waveStatusRequiresReasonCode,
} from "../../domain/state-machine.js";
import type {
  IdempotencyStore,
  InsertJobInput,
  InsertOfferInput,
  InsertWaveInput,
  JobRepository,
  OfferRepository,
  Outbox,
  ResolveOfferInput,
  WaveRepository,
} from "../../ports.js";
import { assertOfferTimestamps } from "../in-memory.js";
import type { DbOrTx } from "./db.js";
import {
  dispatchIdempotency,
  dispatchJobs,
  dispatchOffers,
  dispatchOutbox,
  dispatchWaves,
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

type JobRow = typeof dispatchJobs.$inferSelect;
type WaveRow = typeof dispatchWaves.$inferSelect;
type OfferRow = typeof dispatchOffers.$inferSelect;

/**
 * Fold the five flat snapshot columns back into the domain's `rules` object.
 *
 * The casts describe what the CHECK constraints already guarantee rather than
 * trusting the caller.
 */
function toRules(row: JobRow): DispatchRules {
  return {
    rulesetVersion: row.rulesetVersion,
    waveSize: row.waveSize,
    offerTimeoutSeconds: row.offerTimeoutSeconds,
    maxWaves: row.maxWaves,
    escalationTimeoutSeconds: row.escalationTimeoutSeconds,
  };
}

function toJob(row: JobRow): DispatchJob {
  return {
    id: row.id,
    orderId: row.orderId,
    orderPublicId: row.orderPublicId,
    zoneId: row.zoneId,
    orderType: row.orderType as OrderType,
    vehicleClass: row.vehicleClass as VehicleClass,
    status: row.status as DispatchJobStatus,
    statusReasonCode: row.statusReasonCode as DispatchReasonCode | null,
    rules: toRules(row),
    expiresAt: toIsoRequired(row.expiresAt),
    escalationExpiresAt: toIsoRequired(row.escalationExpiresAt),
    createdIdempotencyKey: row.createdIdempotencyKey,
    payloadFingerprint: row.payloadFingerprint,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

function toWave(row: WaveRow): DispatchWave {
  return {
    id: row.id,
    jobId: row.jobId,
    waveNumber: row.waveNumber,
    status: row.status as DispatchWaveStatus,
    reasonCode: row.reasonCode as DispatchReasonCode | null,
    openedAt: toIsoRequired(row.openedAt),
    expiresAt: toIsoRequired(row.expiresAt),
    completedAt: toIso(row.completedAt),
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

function toOffer(row: OfferRow): DispatchOffer {
  return {
    id: row.id,
    jobId: row.jobId,
    waveId: row.waveId,
    orderAssignmentId: row.orderAssignmentId,
    driverPublicId: row.driverPublicId,
    status: row.status as DispatchOfferStatus,
    reasonCode: row.reasonCode as DispatchReasonCode | null,
    offeredAt: toIsoRequired(row.offeredAt),
    expiresAt: toIsoRequired(row.expiresAt),
    respondedAt: toIso(row.respondedAt),
    resolvedAt: toIso(row.resolvedAt),
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

// --------------------------------------------------------------------------- //
// Driver error translation                                                   //
// --------------------------------------------------------------------------- //

/**
 * SQLSTATE of the violation, found by walking the error's cause chain.
 *
 * Drizzle does NOT rethrow the driver's error: it wraps it in its own
 * `DrizzleQueryError` whose message is the failed SQL, and hangs the real
 * `pg.DatabaseError` — the one carrying `code` and `constraint` — on `cause`.
 * Reading `error.code` directly therefore finds nothing, and every constraint
 * violation escapes untranslated as an opaque "Failed query: insert into …". The
 * order engine (Phase 06) and matching (MR 3/6) walk the chain for the same
 * reason; the depth bound keeps a cyclic `cause` from spinning.
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

/** Name of the violated constraint, when the driver exposes it. */
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
 * own message is the SQL text, which says what was attempted but not which promise
 * of the DDL refused it.
 */
function rethrowNamed(error: unknown): never {
  const constraint = constraintName(error);
  if (constraint !== undefined && error instanceof Error) {
    error.message = `${constraint}: ${error.message}`;
  }
  throw error;
}

/** SQLSTATE 23505 — unique violation. */
const UNIQUE_VIOLATION = "23505";
/** SQLSTATE 23514 — check violation. */
const CHECK_VIOLATION = "23514";

// --------------------------------------------------------------------------- //
// 1) dispatch_jobs                                                           //
// --------------------------------------------------------------------------- //

export class PostgresJobRepository implements JobRepository {
  constructor(private readonly db: DbOrTx) {}

  async find(jobId: string): Promise<DispatchJob | null> {
    const rows = await this.db
      .select()
      .from(dispatchJobs)
      .where(eq(dispatchJobs.id, jobId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toJob(row);
  }

  async findByOrderId(orderId: string): Promise<DispatchJob | null> {
    const rows = await this.db
      .select()
      .from(dispatchJobs)
      .where(eq(dispatchJobs.orderId, orderId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toJob(row);
  }

  async findByIdempotencyKey(key: string): Promise<DispatchJob | null> {
    const rows = await this.db
      .select()
      .from(dispatchJobs)
      .where(eq(dispatchJobs.createdIdempotencyKey, key))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toJob(row);
  }

  async insert(input: InsertJobInput): Promise<DispatchJob> {
    try {
      const [row] = await this.db
        .insert(dispatchJobs)
        .values({
          id: input.id,
          orderId: input.orderId,
          orderPublicId: input.orderPublicId,
          zoneId: input.zoneId,
          orderType: input.orderType,
          vehicleClass: input.vehicleClass,
          status: "pending",
          statusReasonCode: null,
          rulesetVersion: input.rules.rulesetVersion,
          waveSize: input.rules.waveSize,
          offerTimeoutSeconds: input.rules.offerTimeoutSeconds,
          maxWaves: input.rules.maxWaves,
          escalationTimeoutSeconds: input.rules.escalationTimeoutSeconds,
          expiresAt: new Date(input.expiresAt),
          escalationExpiresAt: new Date(input.escalationExpiresAt),
          createdIdempotencyKey: input.createdIdempotencyKey,
          payloadFingerprint: input.payloadFingerprint,
          createdAt: new Date(input.createdAt),
          updatedAt: new Date(input.createdAt),
        })
        .returning();
      return toJob(row!);
    } catch (error) {
      // All three unique keys of this table mean the same thing to a caller: this
      // order already has a dispatch job. `order_id`, `order_public_id` and the
      // idempotency key are three routes to one conclusion, and the in-memory
      // store answers all three with `jobAlreadyExists` too.
      if (sqlState(error) === UNIQUE_VIOLATION) throw jobAlreadyExists();
      if (sqlState(error) === CHECK_VIOLATION) {
        const constraint = constraintName(error) ?? "";
        if (constraint.includes("deadline_order")) {
          throw validationFailed("escalation_expires_at", ">= expires_at");
        }
        if (constraint.includes("payload_fingerprint")) {
          throw validationFailed("payload_fingerprint", "64 characters");
        }
        if (constraint.includes("created_idempotency_key")) {
          throw validationFailed("Idempotency-Key", "8..128 characters");
        }
      }
      return rethrowNamed(error);
    }
  }

  /**
   * Status plus reason, written together.
   *
   * `FOR UPDATE` locks the row for the rest of the transaction, so the transition
   * check below cannot be overtaken by a concurrent writer between the read and
   * the write. Without it, two ticks could both read `dispatching` and both write
   * a terminal status, and the DDL would accept the second one.
   */
  async updateStatus(
    jobId: string,
    status: DispatchJobStatus,
    reasonCode: DispatchReasonCode | null,
    // Underscore-prefixed because this adapter deliberately does NOT write it: the
    // job table has no domain-owned status timestamp, and `updated_at` belongs to
    // `trg_dispatch_jobs_updated_at`. Same precedent as the order engine's
    // `setActiveAssignment(_updatedAt)`. The wave adapter below DOES use its
    // `changedAt`, for `completed_at`.
    _changedAt: string,
  ): Promise<DispatchJob> {
    const locked = await this.db
      .select()
      .from(dispatchJobs)
      .where(eq(dispatchJobs.id, jobId))
      .limit(1)
      .for("update");
    const current = locked[0];
    if (current === undefined) throw validationFailed("job_id", "an existing job");
    if (!isJobTransitionAllowed(current.status as DispatchJobStatus, status)) {
      throw validationFailed("status", `a legal move from ${current.status}`);
    }
    // ck_dispatch_jobs_terminal_needs_reason
    if (jobStatusRequiresReasonCode(status) && reasonCode === null) {
      throw reasonCodeRequired(status);
    }
    if (reasonCode !== null && !allowedJobReasonCodes(status).includes(reasonCode)) {
      throw reasonCodeUnknown(status);
    }
    try {
      const [row] = await this.db
        .update(dispatchJobs)
        // `updated_at` is deliberately absent: `trg_dispatch_jobs_updated_at` owns
        // it (schema.sql §6). `changedAt` is still the decision time, and it is
        // recorded in the columns the domain owns.
        .set({ status, statusReasonCode: reasonCode })
        .where(eq(dispatchJobs.id, jobId))
        .returning();
      return toJob(row!);
    } catch (error) {
      return rethrowNamed(error);
    }
  }

  /**
   * Every job the tick still has work for.
   *
   * "Not terminal" rather than "due now", exactly as the port documents: the tick
   * decides what is due from stored deadlines, and a repository that pre-filtered
   * by time would become a second place where the time model lives — and the one
   * that disagrees after a clock skew.
   */
  async listActive(): Promise<DispatchJob[]> {
    const rows = await this.db
      .select()
      .from(dispatchJobs)
      .where(notInArray(dispatchJobs.status, [...DERIVED_TERMINAL_JOB_STATUSES]))
      .orderBy(asc(dispatchJobs.createdAt), asc(dispatchJobs.id));
    return rows.map(toJob);
  }
}

// --------------------------------------------------------------------------- //
// 2) dispatch_waves                                                          //
// --------------------------------------------------------------------------- //

export class PostgresWaveRepository implements WaveRepository {
  constructor(private readonly db: DbOrTx) {}

  async find(waveId: string): Promise<DispatchWave | null> {
    const rows = await this.db
      .select()
      .from(dispatchWaves)
      .where(eq(dispatchWaves.id, waveId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toWave(row);
  }

  async findOpenForJob(jobId: string): Promise<DispatchWave | null> {
    const rows = await this.db
      .select()
      .from(dispatchWaves)
      .where(and(eq(dispatchWaves.jobId, jobId), eq(dispatchWaves.status, "open")))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toWave(row);
  }

  async listForJob(jobId: string): Promise<DispatchWave[]> {
    const rows = await this.db
      .select()
      .from(dispatchWaves)
      .where(eq(dispatchWaves.jobId, jobId))
      .orderBy(asc(dispatchWaves.waveNumber));
    return rows.map(toWave);
  }

  async countForJob(jobId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(dispatchWaves)
      .where(eq(dispatchWaves.jobId, jobId));
    return rows[0]?.total ?? 0;
  }

  async insert(input: InsertWaveInput): Promise<DispatchWave> {
    try {
      const [row] = await this.db
        .insert(dispatchWaves)
        .values({
          id: input.id,
          jobId: input.jobId,
          waveNumber: input.waveNumber,
          status: "open",
          reasonCode: null,
          openedAt: new Date(input.openedAt),
          expiresAt: new Date(input.expiresAt),
          completedAt: null,
          createdAt: new Date(input.openedAt),
          updatedAt: new Date(input.openedAt),
        })
        .returning();
      return toWave(row!);
    } catch (error) {
      if (sqlState(error) === UNIQUE_VIOLATION) {
        const constraint = constraintName(error) ?? "";
        // `ux_dispatch_waves_one_open_job`: report the number of the wave that is
        // actually open, not the number we tried to open — the caller's log line
        // is then about the wave it has to wait for.
        if (constraint.includes("one_open_job")) {
          const open = await this.findOpenForJob(input.jobId);
          throw waveAlreadyOpen(open?.waveNumber ?? input.waveNumber);
        }
        throw waveAlreadyOpen(input.waveNumber);
      }
      if (sqlState(error) === CHECK_VIOLATION) {
        const constraint = constraintName(error) ?? "";
        if (constraint.includes("wave_number")) {
          throw validationFailed("wave_number", "integer >= 1");
        }
      }
      return rethrowNamed(error);
    }
  }

  async updateStatus(
    waveId: string,
    status: DispatchWaveStatus,
    reasonCode: DispatchReasonCode | null,
    changedAt: string,
  ): Promise<DispatchWave> {
    const locked = await this.db
      .select()
      .from(dispatchWaves)
      .where(eq(dispatchWaves.id, waveId))
      .limit(1)
      .for("update");
    const current = locked[0];
    if (current === undefined) throw validationFailed("wave_id", "an existing wave");
    if (!isWaveTransitionAllowed(current.status as DispatchWaveStatus, status)) {
      throw validationFailed("status", `a legal move from ${current.status}`);
    }
    // ck_dispatch_waves_terminal_needs_reason
    if (waveStatusRequiresReasonCode(status) && reasonCode === null) {
      throw reasonCodeRequired(status);
    }
    if (reasonCode !== null && !allowedWaveReasonCodes(status).includes(reasonCode)) {
      throw reasonCodeUnknown(status);
    }
    try {
      const [row] = await this.db
        .update(dispatchWaves)
        .set({
          status,
          reasonCode,
          // ck_dispatch_waves_state_timestamp — null exactly while open. This one
          // IS written from `changedAt`: it is the domain's record of when the
          // round closed, unlike `updated_at`, which the trigger owns.
          completedAt: status === "open" ? null : new Date(changedAt),
        })
        .where(eq(dispatchWaves.id, waveId))
        .returning();
      return toWave(row!);
    } catch (error) {
      return rethrowNamed(error);
    }
  }
}

// --------------------------------------------------------------------------- //
// 3) dispatch_offers                                                         //
// --------------------------------------------------------------------------- //

export class PostgresOfferRepository implements OfferRepository {
  constructor(private readonly db: DbOrTx) {}

  async find(offerId: string): Promise<DispatchOffer | null> {
    const rows = await this.db
      .select()
      .from(dispatchOffers)
      .where(eq(dispatchOffers.id, offerId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toOffer(row);
  }

  async listForJob(jobId: string): Promise<DispatchOffer[]> {
    const rows = await this.db
      .select()
      .from(dispatchOffers)
      .where(eq(dispatchOffers.jobId, jobId))
      .orderBy(asc(dispatchOffers.offeredAt), asc(dispatchOffers.id));
    return rows.map(toOffer);
  }

  async listForWave(waveId: string): Promise<DispatchOffer[]> {
    const rows = await this.db
      .select()
      .from(dispatchOffers)
      .where(eq(dispatchOffers.waveId, waveId))
      .orderBy(asc(dispatchOffers.offeredAt), asc(dispatchOffers.id));
    return rows.map(toOffer);
  }

  /**
   * Every driver already offered this job — the exclusion list sent to matching.
   *
   * Includes resolved offers on purpose: a driver who declined in wave 1 must not
   * be asked again in wave 3, and `ux_dispatch_offers_job_driver` would refuse the
   * row anyway. Sending the list keeps that refusal from being how we find out.
   */
  async listOfferedDriverIds(jobId: string): Promise<string[]> {
    const rows = await this.db
      .select({ driverPublicId: dispatchOffers.driverPublicId })
      .from(dispatchOffers)
      .where(eq(dispatchOffers.jobId, jobId))
      .orderBy(asc(dispatchOffers.offeredAt), asc(dispatchOffers.id));
    return rows.map((row) => row.driverPublicId);
  }

  async insert(input: InsertOfferInput): Promise<DispatchOffer> {
    try {
      const [row] = await this.db
        .insert(dispatchOffers)
        .values({
          id: input.id,
          jobId: input.jobId,
          waveId: input.waveId,
          orderAssignmentId: input.orderAssignmentId,
          driverPublicId: input.driverPublicId,
          status: "offered",
          reasonCode: null,
          offeredAt: new Date(input.offeredAt),
          expiresAt: new Date(input.expiresAt),
          respondedAt: null,
          resolvedAt: null,
          createdAt: new Date(input.offeredAt),
          updatedAt: new Date(input.offeredAt),
        })
        .returning();
      return toOffer(row!);
    } catch (error) {
      // ux_dispatch_offers_job_driver — the same conclusion the in-memory store
      // reaches: matching handed us a driver this job has already asked.
      if (sqlState(error) === UNIQUE_VIOLATION) {
        throw matchingResultInvalid("no driver offered twice within one job");
      }
      if (sqlState(error) === CHECK_VIOLATION) {
        const constraint = constraintName(error) ?? "";
        if (constraint.includes("driver_public_id")) {
          throw validationFailed("driver_public_id", "^WS-[0-9]{10}$");
        }
      }
      return rethrowNamed(error);
    }
  }

  async resolve(offerId: string, input: ResolveOfferInput): Promise<DispatchOffer> {
    const locked = await this.db
      .select()
      .from(dispatchOffers)
      .where(eq(dispatchOffers.id, offerId))
      .limit(1)
      .for("update");
    const current = locked[0];
    if (current === undefined) throw validationFailed("offer_id", "an existing offer");
    if (!isOfferTransitionAllowed(current.status as DispatchOfferStatus, input.status)) {
      throw validationFailed("status", `a legal move from ${current.status}`);
    }
    // ck_dispatch_offers_terminal_needs_reason is satisfied by the type of
    // `ResolveOfferInput`; what still needs checking is that the code is one the
    // catalog allows for THIS outcome.
    if (!allowedOfferReasonCodes(input.status).includes(input.reasonCode)) {
      throw reasonCodeUnknown(input.status);
    }
    // Shared with the in-memory store rather than reimplemented: two copies of the
    // timestamp matrix is one copy too many, and the second would drift.
    assertOfferTimestamps(input);
    try {
      const [row] = await this.db
        .update(dispatchOffers)
        .set({
          status: input.status,
          reasonCode: input.reasonCode,
          respondedAt: input.respondedAt === null ? null : new Date(input.respondedAt),
          resolvedAt: new Date(input.resolvedAt),
        })
        .where(eq(dispatchOffers.id, offerId))
        .returning();
      return toOffer(row!);
    } catch (error) {
      // ux_dispatch_offers_one_accepted_job — a second acceptance is a lost race,
      // not a validation problem, so it reads the same as a race lost inside the
      // order engine. This is the guard the in-memory store fakes with a scan; here
      // it is the database's, and it holds under real concurrency.
      if (sqlState(error) === UNIQUE_VIOLATION) throw offerSuperseded();
      return rethrowNamed(error);
    }
  }
}

// --------------------------------------------------------------------------- //
// 4) dispatch_outbox                                                         //
// --------------------------------------------------------------------------- //

export class PostgresDispatchOutbox implements Outbox {
  constructor(private readonly db: DbOrTx) {}

  async append(event: AnyDispatchEvent): Promise<void> {
    try {
      await this.db.insert(dispatchOutbox).values({
        eventId: event.event_id,
        eventType: event.event_type,
        eventVersion: event.event_version,
        aggregateType: event.aggregate.type,
        aggregateId: event.aggregate.id,
        payload: event as unknown as Record<string, unknown>,
        traceId: event.trace_id ?? null,
        occurredAt: new Date(event.occurred_at),
      });
    } catch (error) {
      return rethrowNamed(error);
    }
  }

  /**
   * Appended-but-unpublished events, in append order.
   *
   * `occurred_at` alone is not an order: every event of one tick shares that
   * tick's clock reading, so `dispatch.wave_opened` and the `dispatch.offer_sent`
   * events of the same wave would rank arbitrarily. `event_id` is the tie-break,
   * which the deterministic generator makes monotonic in tests and which is at
   * least stable in production.
   */
  async unread(): Promise<AnyDispatchEvent[]> {
    const rows = await this.db
      .select()
      .from(dispatchOutbox)
      .where(sql`${dispatchOutbox.publishedAt} IS NULL`)
      .orderBy(asc(dispatchOutbox.occurredAt), asc(dispatchOutbox.eventId));
    return rows.map((row) => row.payload as unknown as AnyDispatchEvent);
  }

  /** Mark rows as published. Used by the relay (Phase 09) and by tests. */
  async markPublished(eventIds: readonly string[], publishedAt: string): Promise<number> {
    if (eventIds.length === 0) return 0;
    const rows = await this.db
      .update(dispatchOutbox)
      .set({ publishedAt: new Date(publishedAt) })
      .where(inArray(dispatchOutbox.eventId, [...eventIds]))
      .returning({ eventId: dispatchOutbox.eventId });
    return rows.length;
  }
}

// --------------------------------------------------------------------------- //
// 5) dispatch_idempotency                                                    //
// --------------------------------------------------------------------------- //

/**
 * Idempotency memory (§43).
 *
 * `remember` is an upsert on purpose: the same key with the same fingerprint is a
 * retry, and a retry must not fail on a primary-key violation after the use case
 * has already decided that it IS a retry. A different fingerprint never reaches
 * here — the use case reads `find` first and raises 409 — so the upsert cannot
 * silently overwrite one caller's key with another's payload.
 */
export class PostgresDispatchIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: DbOrTx) {}

  async find(key: string): Promise<string | null> {
    const rows = await this.db
      .select({ fingerprint: dispatchIdempotency.payloadFingerprint })
      .from(dispatchIdempotency)
      .where(eq(dispatchIdempotency.idempotencyKey, key))
      .limit(1);
    return rows[0]?.fingerprint ?? null;
  }

  async remember(key: string, payloadFingerprint: string): Promise<void> {
    try {
      await this.db
        .insert(dispatchIdempotency)
        .values({ idempotencyKey: key, payloadFingerprint })
        .onConflictDoUpdate({
          target: dispatchIdempotency.idempotencyKey,
          set: { payloadFingerprint },
        });
    } catch (error) {
      if (sqlState(error) === CHECK_VIOLATION) {
        throw validationFailed("Idempotency-Key", "8..128 characters");
      }
      return rethrowNamed(error);
    }
  }
}
