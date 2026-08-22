/**
 * In-memory adapters.
 *
 * These are not stubs. Every uniqueness rule and every check constraint declared in
 * `services/dispatch/contracts/schema.sql` is enforced here too, and named in the
 * comment next to it. A store that accepts writes Postgres would refuse turns the
 * pure-domain suite into an argument about a world that does not exist — and the bug
 * would then be found in MR 5/6 with a Drizzle stack trace instead of here with a
 * one-line test.
 *
 * The same use-case tests run against the Drizzle adapters in MR 5/6, so "it worked in
 * memory" can never mean "it works".
 *
 * Sorting is deterministic everywhere. `Map` iteration order is insertion order, which
 * a real index does not promise, so every list sorts explicitly before returning.
 */

import {
  jobAlreadyExists,
  matchingResultInvalid,
  offerSuperseded,
  reasonCodeRequired,
  reasonCodeUnknown,
  validationFailed,
  waveAlreadyOpen,
} from "../domain/errors.js";
import type { AnyDispatchEvent } from "../domain/events.js";
import {
  PAYLOAD_FINGERPRINT_LENGTH,
  type DispatchJob,
  type DispatchJobStatus,
  type DispatchOffer,
  type DispatchReasonCode,
  type DispatchRules,
  type DispatchWave,
  type DispatchWaveStatus,
} from "../domain/model.js";
import {
  allowedJobReasonCodes,
  allowedOfferReasonCodes,
  allowedWaveReasonCodes,
  isJobTransitionAllowed,
  isOfferTransitionAllowed,
  isTerminalJobStatus,
  isWaveTransitionAllowed,
  jobStatusRequiresReasonCode,
  waveStatusRequiresReasonCode,
} from "../domain/state-machine.js";
import type {
  Clock,
  IdGenerator,
  IdempotencyStore,
  InsertJobInput,
  InsertOfferInput,
  InsertWaveInput,
  JobRepository,
  OfferRepository,
  Outbox,
  ResolveOfferInput,
  RulesProvider,
  WaveRepository,
} from "../ports.js";

/**
 * The named unique indexes and constraints this store stands in for.
 *
 * Exported so `__tests__/contract-drift.test.ts` can prove each one still exists in
 * `contracts/schema.sql`, and that no new one was added there without an in-memory
 * counterpart. Without that check, this file's promise of "the same rules as Postgres"
 * would decay quietly into a comment.
 */
export const DISPATCH_INDEX_NAMES: readonly string[] = [
  "ux_dispatch_jobs_idempotency_key",
  "ux_dispatch_waves_job_number",
  "ux_dispatch_waves_one_open_job",
  "ux_dispatch_offers_job_driver",
  "ux_dispatch_offers_one_accepted_job",
];

/**
 * A clock the test moves by hand.
 *
 * The whole time model depends on time being an argument, so the test clock is not a
 * convenience — it is the only way to assert what happens exactly at a deadline rather
 * than "usually, on a fast machine".
 */
export class FixedClock implements Clock {
  private current: number;

  constructor(iso = "2026-01-01T00:00:00.000Z") {
    this.current = Date.parse(iso);
  }

  now(): string {
    return new Date(this.current).toISOString();
  }

  /** Move forward by whole seconds. */
  advanceSeconds(seconds: number): void {
    this.current += seconds * 1000;
  }

  set(iso: string): void {
    this.current = Date.parse(iso);
  }
}

/**
 * Deterministic ids.
 *
 * Valid UUID *shape* with a counter inside, so a failing assertion names
 * `...-000000000007` and the reader can count which write it was. Random UUIDs make
 * every failure message unrepeatable.
 */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = "00000000-0000-4000-8000") {}

  uuid(): string {
    this.counter += 1;
    return `${this.prefix}-${String(this.counter).padStart(12, "0")}`;
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, string>();

  async find(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }

  async remember(key: string, payloadFingerprint: string): Promise<void> {
    this.entries.set(key, payloadFingerprint);
  }
}

export class InMemoryOutbox implements Outbox {
  private readonly events: AnyDispatchEvent[] = [];

  async append(event: AnyDispatchEvent): Promise<void> {
    this.events.push(event);
  }

  async unread(): Promise<AnyDispatchEvent[]> {
    return [...this.events];
  }
}

/** Configuration read at job creation. Static here; MR 5/6 reads it from env. */
export class StaticRulesProvider implements RulesProvider {
  constructor(private rules: DispatchRules) {}

  async current(): Promise<DispatchRules> {
    return this.rules;
  }

  /** Used to prove a mid-flight rules change cannot move an existing job's deadlines. */
  replace(rules: DispatchRules): void {
    this.rules = rules;
  }
}

export class InMemoryJobRepository implements JobRepository {
  private readonly rows = new Map<string, DispatchJob>();

  async find(jobId: string): Promise<DispatchJob | null> {
    return this.rows.get(jobId) ?? null;
  }

  async findByOrderId(orderId: string): Promise<DispatchJob | null> {
    return [...this.rows.values()].find((job) => job.orderId === orderId) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<DispatchJob | null> {
    return [...this.rows.values()].find((job) => job.createdIdempotencyKey === key) ?? null;
  }

  async insert(input: InsertJobInput): Promise<DispatchJob> {
    if (input.payloadFingerprint.length !== PAYLOAD_FINGERPRINT_LENGTH) {
      // CHECK (char_length(payload_fingerprint) = 64) — inline and unnamed in the DDL.
      throw validationFailed("payload_fingerprint", `${PAYLOAD_FINGERPRINT_LENGTH} characters`);
    }
    if (Date.parse(input.escalationExpiresAt) < Date.parse(input.expiresAt)) {
      // ck_dispatch_jobs_deadline_order
      throw validationFailed("escalation_expires_at", ">= expires_at");
    }
    for (const existing of this.rows.values()) {
      // dispatch_jobs.order_id UNIQUE · order_public_id UNIQUE · ux_dispatch_jobs_idempotency_key
      if (existing.orderId === input.orderId) throw jobAlreadyExists();
      if (existing.orderPublicId === input.orderPublicId) throw jobAlreadyExists();
      if (existing.createdIdempotencyKey === input.createdIdempotencyKey) throw jobAlreadyExists();
    }
    const job: DispatchJob = {
      id: input.id,
      orderId: input.orderId,
      orderPublicId: input.orderPublicId,
      zoneId: input.zoneId,
      orderType: input.orderType,
      vehicleClass: input.vehicleClass,
      status: "pending",
      statusReasonCode: null,
      rules: { ...input.rules },
      expiresAt: input.expiresAt,
      escalationExpiresAt: input.escalationExpiresAt,
      createdIdempotencyKey: input.createdIdempotencyKey,
      payloadFingerprint: input.payloadFingerprint,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.rows.set(job.id, job);
    return job;
  }

  async updateStatus(
    jobId: string,
    status: DispatchJobStatus,
    reasonCode: DispatchReasonCode | null,
    changedAt: string,
  ): Promise<DispatchJob> {
    const current = this.rows.get(jobId);
    if (current === undefined) throw validationFailed("job_id", "an existing job");
    if (!isJobTransitionAllowed(current.status, status)) {
      throw validationFailed("status", `a legal move from ${current.status}`);
    }
    // ck_dispatch_jobs_terminal_needs_reason
    if (jobStatusRequiresReasonCode(status) && reasonCode === null) {
      throw reasonCodeRequired(status);
    }
    if (reasonCode !== null && !allowedJobReasonCodes(status).includes(reasonCode)) {
      throw reasonCodeUnknown(status);
    }
    const next: DispatchJob = {
      ...current,
      status,
      statusReasonCode: reasonCode,
      updatedAt: changedAt,
    };
    this.rows.set(jobId, next);
    return next;
  }

  async listActive(): Promise<DispatchJob[]> {
    return [...this.rows.values()]
      .filter((job) => !isTerminalJobStatus(job.status))
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt),
      );
  }
}

export class InMemoryWaveRepository implements WaveRepository {
  private readonly rows = new Map<string, DispatchWave>();

  async find(waveId: string): Promise<DispatchWave | null> {
    return this.rows.get(waveId) ?? null;
  }

  async findOpenForJob(jobId: string): Promise<DispatchWave | null> {
    return (
      [...this.rows.values()].find((wave) => wave.jobId === jobId && wave.status === "open") ?? null
    );
  }

  async listForJob(jobId: string): Promise<DispatchWave[]> {
    return [...this.rows.values()]
      .filter((wave) => wave.jobId === jobId)
      .sort((left, right) => left.waveNumber - right.waveNumber);
  }

  async countForJob(jobId: string): Promise<number> {
    return [...this.rows.values()].filter((wave) => wave.jobId === jobId).length;
  }

  async insert(input: InsertWaveInput): Promise<DispatchWave> {
    if (input.waveNumber < 1) throw validationFailed("wave_number", "integer >= 1");
    for (const existing of this.rows.values()) {
      if (existing.jobId !== input.jobId) continue;
      // ux_dispatch_waves_job_number
      if (existing.waveNumber === input.waveNumber) throw waveAlreadyOpen(input.waveNumber);
      // ux_dispatch_waves_one_open_job — the partial unique index that makes "one open
      // wave per job" true under concurrent ticks instead of true-if-nobody-races.
      if (existing.status === "open") throw waveAlreadyOpen(existing.waveNumber);
    }
    const wave: DispatchWave = {
      id: input.id,
      jobId: input.jobId,
      waveNumber: input.waveNumber,
      status: "open",
      reasonCode: null,
      openedAt: input.openedAt,
      expiresAt: input.expiresAt,
      completedAt: null,
      createdAt: input.openedAt,
      updatedAt: input.openedAt,
    };
    this.rows.set(wave.id, wave);
    return wave;
  }

  async updateStatus(
    waveId: string,
    status: DispatchWaveStatus,
    reasonCode: DispatchReasonCode | null,
    changedAt: string,
  ): Promise<DispatchWave> {
    const current = this.rows.get(waveId);
    if (current === undefined) throw validationFailed("wave_id", "an existing wave");
    if (!isWaveTransitionAllowed(current.status, status)) {
      throw validationFailed("status", `a legal move from ${current.status}`);
    }
    // ck_dispatch_waves_terminal_needs_reason
    if (waveStatusRequiresReasonCode(status) && reasonCode === null) {
      throw reasonCodeRequired(status);
    }
    if (reasonCode !== null && !allowedWaveReasonCodes(status).includes(reasonCode)) {
      throw reasonCodeUnknown(status);
    }
    const next: DispatchWave = {
      ...current,
      status,
      reasonCode,
      // ck_dispatch_waves_state_timestamp — null exactly while open.
      completedAt: status === "open" ? null : changedAt,
      updatedAt: changedAt,
    };
    this.rows.set(waveId, next);
    return next;
  }
}

export class InMemoryOfferRepository implements OfferRepository {
  private readonly rows = new Map<string, DispatchOffer>();

  async find(offerId: string): Promise<DispatchOffer | null> {
    return this.rows.get(offerId) ?? null;
  }

  async listForJob(jobId: string): Promise<DispatchOffer[]> {
    return this.sorted((offer) => offer.jobId === jobId);
  }

  async listForWave(waveId: string): Promise<DispatchOffer[]> {
    return this.sorted((offer) => offer.waveId === waveId);
  }

  async listOfferedDriverIds(jobId: string): Promise<string[]> {
    return this.sorted((offer) => offer.jobId === jobId).map((offer) => offer.driverPublicId);
  }

  async insert(input: InsertOfferInput): Promise<DispatchOffer> {
    for (const existing of this.rows.values()) {
      // ux_dispatch_offers_job_driver — includes rejected and timed-out offers on
      // purpose: it is what stops wave 3 from re-asking the driver who declined in
      // wave 1, even if the exclusion list we sent to matching was wrong.
      if (existing.jobId === input.jobId && existing.driverPublicId === input.driverPublicId) {
        throw matchingResultInvalid("no driver offered twice within one job");
      }
    }
    const offer: DispatchOffer = {
      id: input.id,
      jobId: input.jobId,
      waveId: input.waveId,
      orderAssignmentId: input.orderAssignmentId,
      driverPublicId: input.driverPublicId,
      status: "offered",
      reasonCode: null,
      offeredAt: input.offeredAt,
      expiresAt: input.expiresAt,
      respondedAt: null,
      resolvedAt: null,
      createdAt: input.offeredAt,
      updatedAt: input.offeredAt,
    };
    this.rows.set(offer.id, offer);
    return offer;
  }

  async resolve(offerId: string, input: ResolveOfferInput): Promise<DispatchOffer> {
    const current = this.rows.get(offerId);
    if (current === undefined) throw validationFailed("offer_id", "an existing offer");
    if (!isOfferTransitionAllowed(current.status, input.status)) {
      throw validationFailed("status", `a legal move from ${current.status}`);
    }
    // ck_dispatch_offers_terminal_needs_reason is satisfied by the type of `ResolveOfferInput`
    // (a resolution always carries a reason); what still needs checking is that the code
    // is one the catalog allows for THIS outcome.
    if (!allowedOfferReasonCodes(input.status).includes(input.reasonCode)) {
      throw reasonCodeUnknown(input.status);
    }
    assertOfferTimestamps(input);
    if (input.status === "accepted") {
      // ux_dispatch_offers_one_accepted_job — a second acceptance is a lost race, not a
      // validation problem, so it reads the same as a race lost inside the order engine.
      const alreadyAccepted = [...this.rows.values()].some(
        (offer) => offer.jobId === current.jobId && offer.status === "accepted",
      );
      if (alreadyAccepted) throw offerSuperseded();
    }
    const next: DispatchOffer = {
      ...current,
      status: input.status,
      reasonCode: input.reasonCode,
      respondedAt: input.respondedAt,
      resolvedAt: input.resolvedAt,
      updatedAt: input.resolvedAt,
    };
    this.rows.set(offerId, next);
    return next;
  }

  private sorted(predicate: (offer: DispatchOffer) => boolean): DispatchOffer[] {
    return [...this.rows.values()]
      .filter(predicate)
      .sort((left, right) =>
        left.offeredAt === right.offeredAt
          ? left.id.localeCompare(right.id)
          : left.offeredAt.localeCompare(right.offeredAt),
      );
  }
}

/**
 * The offer timestamp matrix from `schema.sql` (ck_dispatch_offers_state_timestamp).
 *
 * `accepted` and `rejected` are answers a person gave, so both `responded_at` and
 * `resolved_at` are set. `timed_out`, `superseded` and `cancelled` are things that
 * happened *to* the offer, so `responded_at` stays null — which is what makes
 * "how many drivers actually answered" a countable number rather than a guess.
 */
export function assertOfferTimestamps(input: ResolveOfferInput): void {
  const answered = input.status === "accepted" || input.status === "rejected";
  if (answered && input.respondedAt === null) {
    throw validationFailed("responded_at", `set when status is ${input.status}`);
  }
  if (!answered && input.respondedAt !== null) {
    throw validationFailed("responded_at", `null when status is ${input.status}`);
  }
}

/** Every store a use case needs, wired together. */
export interface InMemoryStores {
  readonly jobs: InMemoryJobRepository;
  readonly waves: InMemoryWaveRepository;
  readonly offers: InMemoryOfferRepository;
  readonly outbox: InMemoryOutbox;
  readonly idempotency: InMemoryIdempotencyStore;
}

export function createInMemoryStores(): InMemoryStores {
  return {
    jobs: new InMemoryJobRepository(),
    waves: new InMemoryWaveRepository(),
    offers: new InMemoryOfferRepository(),
    outbox: new InMemoryOutbox(),
    idempotency: new InMemoryIdempotencyStore(),
  };
}
