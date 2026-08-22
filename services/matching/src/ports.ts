/**
 * Ports (hexagonal boundaries) for the matching domain.
 *
 * Use cases depend on these interfaces only. Adapters live in ./infrastructure:
 * the in-memory stores here (MR 2/6) and the Drizzle/Postgres repository in
 * MR 3/6, with a parity suite running the same use-case tests against both — so
 * "it worked in memory" can never mean "it works".
 *
 * Dependency direction (ADR-011): matching depends on geography for zone paths
 * and on NOTHING else. It never calls the order engine, never calls dispatch,
 * and does not know that an offer exists. Reversing any of those arrows would
 * turn the function into a coordinator and delete the reason this service is
 * separate.
 */

import type { MatchingDomainEvent } from "@wasla/contracts-matching";

import type {
  AvailabilityState,
  Candidacy,
  CandidacyWriter,
  EligibilitySource,
  EligibilityState,
  MatchingDecision,
  Ruleset,
  ServiceKind,
  VehicleClass,
  ZoneLineage,
} from "./domain/model.js";

/** Wall-clock time as an ISO-8601 string. */
export interface Clock {
  now(): string;
}

/** UUID generator (decision ids and event ids). */
export interface IdGenerator {
  uuid(): string;
}

/** The full-replacement input of `PUT /candidacy/{driverPublicId}`. */
export interface UpsertCandidacyInput {
  readonly driverPublicId: string;
  readonly availabilityState: AvailabilityState;
  readonly eligibilityState: EligibilityState;
  readonly eligibilitySource: EligibilitySource;
  readonly serviceKinds: readonly ServiceKind[];
  readonly vehicleClass: VehicleClass | null;
  readonly zoneIds: readonly string[];
  readonly updatedBy: CandidacyWriter;
  readonly updatedAt: string;
}

/**
 * The candidacy projection store.
 *
 * `replace` is a full replacement, never a merge: a partial merge on a projection
 * produces mixtures nobody intended — new availability with last week's zones —
 * and those mixtures are indistinguishable from a correct row afterwards.
 *
 * `updatedAt` is written by the SERVICE, not by the caller: it is the deciding
 * column of the fail-closed freshness filter, and a caller that can set it can
 * make a stale row look fresh.
 */
export interface CandidacyRepository {
  find(driverPublicId: string): Promise<Candidacy | null>;
  /** Every row that could take part in an evaluation, unordered. */
  listForEvaluation(): Promise<Candidacy[]>;
  replace(input: UpsertCandidacyInput): Promise<Candidacy>;
  /** Availability only — the narrow path for the most frequent write in the system. */
  setAvailability(
    driverPublicId: string,
    state: AvailabilityState,
    changedAt: string,
  ): Promise<Candidacy>;
}

/**
 * Ruleset catalogue. Read-only in this phase: version 1 is seeded and frozen by
 * schema.sql, and a new version is a migration, not an API call.
 */
export interface RulesetRepository {
  find(version: number): Promise<Ruleset | null>;
  /** The newest frozen version — the default the ranking uses. */
  findActive(): Promise<Ruleset | null>;
  list(): Promise<Ruleset[]>;
}

/** Append-only audit store: decisions are never updated and never deleted. */
export interface DecisionRepository {
  append(decision: MatchingDecision): Promise<MatchingDecision>;
  find(decisionId: string): Promise<MatchingDecision | null>;
}

/**
 * Zone hierarchy lookups (ADR-006), through a port rather than an FK.
 *
 * Returns `null` for an id absent from the hierarchy — which is 422
 * `MATCHING_ZONE_UNKNOWN` for a pickup zone, and a silently unusable served zone
 * for a driver: a driver must not lose a whole evaluation because one of the
 * zones on their row was retired last month.
 */
export interface ZoneHierarchyPort {
  resolve(zoneIds: readonly string[]): Promise<Map<string, ZoneLineage>>;
}

/**
 * Domain event outbox. Use cases append within the same logical operation as the
 * write; a relay publishes later (Phase 09). Kept separate from the repository so
 * the domain owns event ordering without knowing about a broker.
 */
export interface Outbox {
  append(event: MatchingDomainEvent): Promise<void>;
  /** Appended (unpublished) events — used by tests and the future relay. */
  unread(): Promise<MatchingDomainEvent[]>;
}

/**
 * Idempotency memory for writes (§43).
 *
 * A separate port from the repository because the two answer different
 * questions: the repository knows the current row, while this knows what a key
 * was used for. Storing the fingerprint is what lets a retry (same key, same
 * payload) succeed while a caller bug (same key, different payload) is refused
 * with 409 instead of silently overwriting someone else's row.
 */
export interface IdempotencyStore {
  find(key: string): Promise<string | null>;
  remember(key: string, payloadFingerprint: string): Promise<void>;
}

/** Everything a use case needs, passed explicitly rather than imported. */
export interface MatchingDependencies {
  readonly candidacy: CandidacyRepository;
  readonly rulesets: RulesetRepository;
  readonly decisions: DecisionRepository;
  readonly zones: ZoneHierarchyPort;
  readonly outbox: Outbox;
  readonly idempotency: IdempotencyStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}
