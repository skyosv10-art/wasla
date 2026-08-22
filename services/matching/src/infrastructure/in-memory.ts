/**
 * In-memory adapters (MR 2/6).
 *
 * They exist so the domain can be proven without a database — the whole suite
 * runs in milliseconds — and so MR 3/6 has a parity target: the Postgres
 * repository must make the same use-case tests pass with no change to
 * `src/use-cases/`, which is the written criterion inherited from Phase 06
 * (ORDER_PERSISTENCE.md).
 *
 * They therefore imitate the CONSTRAINTS of schema.sql, not just its columns:
 *  - the counters cannot go negative and `offers_accepted <= offers_received`,
 *  - `updated_at` is stamped by the store, never accepted from the caller,
 *  - a full replacement keeps `created_at` and the counters of the existing row:
 *    the projection replaces what the writer declares, and the writer does not
 *    own the matching history (§3 of MATCHING_DISPATCH).
 */

import type { MatchingDomainEvent } from "@wasla/contracts-matching";

import type {
  AvailabilityState,
  Candidacy,
  MatchingDecision,
  Ruleset,
  ZoneLineage,
} from "../domain/model.js";
import { SEEDED_RULESETS } from "../domain/ruleset.js";
import { candidacyNotFound } from "../domain/errors.js";
import type {
  CandidacyRepository,
  Clock,
  DecisionRepository,
  IdGenerator,
  IdempotencyStore,
  MatchingDependencies,
  Outbox,
  RulesetRepository,
  UpsertCandidacyInput,
  ZoneHierarchyPort,
} from "../ports.js";

export class InMemoryCandidacyRepository implements CandidacyRepository {
  private readonly rows = new Map<string, Candidacy>();

  async find(driverPublicId: string): Promise<Candidacy | null> {
    return this.rows.get(driverPublicId) ?? null;
  }

  async listForEvaluation(): Promise<Candidacy[]> {
    return [...this.rows.values()];
  }

  async replace(input: UpsertCandidacyInput): Promise<Candidacy> {
    const existing = this.rows.get(input.driverPublicId);
    const row: Candidacy = {
      driverPublicId: input.driverPublicId,
      availabilityState: input.availabilityState,
      eligibilityState: input.eligibilityState,
      eligibilitySource: input.eligibilitySource,
      serviceKinds: [...input.serviceKinds],
      vehicleClass: input.vehicleClass,
      zoneIds: [...input.zoneIds],
      lastOfferedAt: existing?.lastOfferedAt ?? null,
      lastAssignedAt: existing?.lastAssignedAt ?? null,
      offersReceived: existing?.offersReceived ?? 0,
      offersAccepted: existing?.offersAccepted ?? 0,
      ordersCompleted: existing?.ordersCompleted ?? 0,
      updatedAt: input.updatedAt,
      createdAt: existing?.createdAt ?? input.updatedAt,
      updatedBy: input.updatedBy,
    };
    this.rows.set(row.driverPublicId, row);
    return row;
  }

  async setAvailability(
    driverPublicId: string,
    state: AvailabilityState,
    changedAt: string,
  ): Promise<Candidacy> {
    const existing = this.rows.get(driverPublicId);
    if (existing === undefined) throw candidacyNotFound();
    const row: Candidacy = { ...existing, availabilityState: state, updatedAt: changedAt };
    this.rows.set(driverPublicId, row);
    return row;
  }

  /**
   * Test/seed helper for the matching history columns the service itself writes
   * elsewhere (offers received, acceptance, completion, fairness stamps). Not part
   * of the port: no use case may set them through this door.
   */
  seed(row: Candidacy): void {
    this.rows.set(row.driverPublicId, {
      ...row,
      offersReceived: Math.max(row.offersReceived, 0),
      offersAccepted: Math.min(Math.max(row.offersAccepted, 0), Math.max(row.offersReceived, 0)),
      ordersCompleted: Math.max(row.ordersCompleted, 0),
    });
  }
}

export class InMemoryRulesetRepository implements RulesetRepository {
  private readonly versions = new Map<number, Ruleset>();

  constructor(seeded: readonly Ruleset[] = SEEDED_RULESETS) {
    for (const ruleset of seeded) this.versions.set(ruleset.version, ruleset);
  }

  async find(version: number): Promise<Ruleset | null> {
    return this.versions.get(version) ?? null;
  }

  /** The newest FROZEN version: an editable ruleset must never become the default. */
  async findActive(): Promise<Ruleset | null> {
    const frozen = [...this.versions.values()].filter((ruleset) => ruleset.isFrozen);
    if (frozen.length === 0) return null;
    return frozen.reduce((newest, ruleset) => (ruleset.version > newest.version ? ruleset : newest));
  }

  async list(): Promise<Ruleset[]> {
    return [...this.versions.values()].sort((left, right) => left.version - right.version);
  }

  /** Test helper: add a version (e.g. an unfrozen one) without a migration. */
  put(ruleset: Ruleset): void {
    this.versions.set(ruleset.version, ruleset);
  }
}

export class InMemoryDecisionRepository implements DecisionRepository {
  private readonly decisions = new Map<string, MatchingDecision>();

  async append(decision: MatchingDecision): Promise<MatchingDecision> {
    // Append-only: an existing id is a generator bug, not an update.
    if (this.decisions.has(decision.id)) {
      throw new Error(`decision ${decision.id} already exists — decisions are append-only`);
    }
    this.decisions.set(decision.id, decision);
    return decision;
  }

  async find(decisionId: string): Promise<MatchingDecision | null> {
    return this.decisions.get(decisionId) ?? null;
  }

  async count(): Promise<number> {
    return this.decisions.size;
  }
}

/** A hierarchy stub fed with explicit lineages — geography stays behind its port. */
export class InMemoryZoneHierarchy implements ZoneHierarchyPort {
  private readonly lineages = new Map<string, ZoneLineage>();

  constructor(lineages: readonly ZoneLineage[] = []) {
    for (const lineage of lineages) this.lineages.set(lineage.zoneId, lineage);
  }

  async resolve(zoneIds: readonly string[]): Promise<Map<string, ZoneLineage>> {
    const result = new Map<string, ZoneLineage>();
    for (const zoneId of zoneIds) {
      const lineage = this.lineages.get(zoneId);
      if (lineage !== undefined) result.set(zoneId, lineage);
    }
    return result;
  }

  put(lineage: ZoneLineage): void {
    this.lineages.set(lineage.zoneId, lineage);
  }
}

export class InMemoryOutbox implements Outbox {
  private readonly events: MatchingDomainEvent[] = [];

  async append(event: MatchingDomainEvent): Promise<void> {
    this.events.push(event);
  }

  async unread(): Promise<MatchingDomainEvent[]> {
    return [...this.events];
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly keys = new Map<string, string>();

  async find(key: string): Promise<string | null> {
    return this.keys.get(key) ?? null;
  }

  async remember(key: string, payloadFingerprint: string): Promise<void> {
    this.keys.set(key, payloadFingerprint);
  }
}

/** A clock that only moves when a test moves it — no hidden `Date.now()`. */
export class FixedClock implements Clock {
  constructor(private current: string) {}

  now(): string {
    return this.current;
  }

  set(iso: string): void {
    this.current = iso;
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(Date.parse(this.current) + seconds * 1000).toISOString();
  }
}

/** Deterministic uuids so a failing test names the same ids every run. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  uuid(): string {
    this.counter += 1;
    const suffix = this.counter.toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${suffix}`;
  }
}

export interface InMemoryMatchingDependencies extends MatchingDependencies {
  readonly candidacy: InMemoryCandidacyRepository;
  readonly rulesets: InMemoryRulesetRepository;
  readonly decisions: InMemoryDecisionRepository;
  readonly zones: InMemoryZoneHierarchy;
  readonly outbox: InMemoryOutbox;
  readonly idempotency: InMemoryIdempotencyStore;
  readonly clock: FixedClock;
  readonly ids: SequentialIdGenerator;
}

/** One wiring used by every test — and by the HTTP layer's memory mode in MR 5/6. */
export function createInMemoryDependencies(
  options: { readonly now?: string; readonly lineages?: readonly ZoneLineage[] } = {},
): InMemoryMatchingDependencies {
  return {
    candidacy: new InMemoryCandidacyRepository(),
    rulesets: new InMemoryRulesetRepository(),
    decisions: new InMemoryDecisionRepository(),
    zones: new InMemoryZoneHierarchy(options.lineages ?? []),
    outbox: new InMemoryOutbox(),
    idempotency: new InMemoryIdempotencyStore(),
    clock: new FixedClock(options.now ?? "2026-08-22T00:00:00.000Z"),
    ids: new SequentialIdGenerator(),
  };
}
