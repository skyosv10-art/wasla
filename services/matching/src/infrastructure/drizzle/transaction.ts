/**
 * Unit of Work: the atomicity boundary of the matching service.
 *
 * `contracts/schema.sql` §5 promises that an event is written **in the
 * transaction of the change itself** — "an event published after the transaction
 * succeeds, in a second call, is lost at the first outage". But a use case makes
 * three separate port calls (`candidacy.replace()` → `idempotency.remember()` →
 * `outbox.append()`), so an adapter that opened and committed its own
 * transaction per call could never cover the following two. Phase 06 settled the
 * same problem for the order engine (ORDER_PERSISTENCE.md); this file settles it
 * here, by the same pattern, for the same reason.
 *
 * The Unit of Work opens ONE Drizzle transaction and hands the SAME handle to all
 * five adapters. The use case is then run unchanged inside the callback: its
 * separate calls share the transaction, so the row + the key + the event commit
 * or roll back together. This is a composition helper OUTSIDE `src/use-cases/` —
 * it does not change a single use-case file, which is the binding criterion of
 * this MR.
 *
 * `zones`, `clock` and `ids` are passed in from outside: none of them is
 * transactional. `zones` in particular is a port onto ANOTHER service
 * (geography, ADR-006) — putting it inside the transaction would mean holding a
 * Postgres connection open across a network call to a service that may be slow,
 * which is how a pool is exhausted by a dependency that is merely degraded.
 *
 * The discriminating proof is the atomicity test: make `outbox.append()` throw
 * after `candidacy.replace()` has succeeded, then assert that the candidacy row,
 * the idempotency key AND the event are all absent. An adapter with an internal
 * transaction cannot produce that outcome.
 */

import type {
  Clock,
  IdGenerator,
  MatchingDependencies,
  ZoneHierarchyPort,
} from "../../ports.js";
import type { Db } from "./db.js";
import {
  PostgresCandidacyRepository,
  PostgresDecisionRepository,
  PostgresIdempotencyStore,
  PostgresMatchingOutbox,
  PostgresRulesetRepository,
} from "./repository.js";

/**
 * The non-transactional dependencies the caller owns.
 *
 * Kept as an input rather than built here so the composition root decides
 * between a real clock and a fixed one, and between a real geography port and a
 * stub — without the Unit of Work knowing that either choice exists.
 */
export interface MatchingSharedDeps {
  readonly zones: ZoneHierarchyPort;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** The transaction-bound dependencies, in the exact shape a use case expects. */
export interface MatchingUnitOfWorkDeps extends MatchingDependencies {
  readonly candidacy: PostgresCandidacyRepository;
  readonly rulesets: PostgresRulesetRepository;
  readonly decisions: PostgresDecisionRepository;
  readonly outbox: PostgresMatchingOutbox;
  readonly idempotency: PostgresIdempotencyStore;
}

export interface MatchingUnitOfWorkContext {
  /** The shared transaction handle, for adapters that need it directly. */
  readonly db: Db;
  /** The deps a use case expects, all bound to the same transaction. */
  readonly deps: MatchingUnitOfWorkDeps;
}

/** Build the five adapters against one handle (a tx, or the root connection). */
export function bindMatchingAdapters(
  db: Db,
  shared: MatchingSharedDeps,
): MatchingUnitOfWorkDeps {
  return {
    candidacy: new PostgresCandidacyRepository(db),
    rulesets: new PostgresRulesetRepository(db),
    decisions: new PostgresDecisionRepository(db),
    outbox: new PostgresMatchingOutbox(db),
    idempotency: new PostgresIdempotencyStore(db),
    zones: shared.zones,
    clock: shared.clock,
    ids: shared.ids,
  };
}

/**
 * Run a unit of work inside a single Postgres transaction.
 *
 * `run` receives the assembled deps and may call any use case against them. If
 * `run` throws, the transaction rolls back and every write is undone.
 */
export class PostgresMatchingUnitOfWork {
  constructor(private readonly db: Db) {}

  async run<T>(
    shared: MatchingSharedDeps,
    run: (context: MatchingUnitOfWorkContext) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const deps = bindMatchingAdapters(tx, shared);
      return run({ db: tx, deps });
    });
  }

  /**
   * Read path: the same adapters bound to the root connection, with NO
   * transaction.
   *
   * `GET /candidacy/{id}` and `GET /decisions/{id}` read and do not write.
   * Wrapping a read in a transaction would hold a pooled connection for the whole
   * response in exchange for a consistency guarantee the caller cannot observe —
   * it receives one JSON document either way.
   */
  read<T>(
    shared: MatchingSharedDeps,
    run: (deps: MatchingUnitOfWorkDeps) => Promise<T>,
  ): Promise<T> {
    return run(bindMatchingAdapters(this.db, shared));
  }
}
