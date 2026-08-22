/**
 * Unit of Work: the atomicity boundary of the dispatch service.
 *
 * `contracts/schema.sql` §4 promises that an event is written **in the transaction
 * of the change itself** — an event published after the transaction succeeds, in a
 * second call, is lost at the first outage. But one dispatch operation makes many
 * separate port calls: a tick writes a wave, then N offers, then a job status
 * change, then N+2 outbox events. An adapter that opened and committed its own
 * transaction per call could never cover the calls that follow it.
 *
 * The failure that makes this non-negotiable here is specific: a wave row committed
 * without its offers is an `open` wave with nothing to resolve, and
 * `ux_dispatch_waves_one_open_job` then refuses every future wave for that job. The
 * job stalls until a human deletes a row. All-or-nothing is what prevents that.
 *
 * The Unit of Work opens ONE Drizzle transaction and hands the SAME handle to all
 * five adapters, then runs the use case unchanged inside the callback. This is a
 * composition helper OUTSIDE `src/use-cases/` — it does not change a single use-case
 * file, which is the binding criterion of this MR.
 *
 * `matching`, `orders`, `rules`, `clock` and `ids` are passed in from outside: none
 * of them is transactional, and two of them are ports onto ANOTHER service over the
 * network. Putting `orders.registerOffer()` inside the transaction is unavoidable —
 * the tick calls it between two writes — which is exactly why the transaction must
 * stay short and why `MATCHING`/`ORDER` clients carry their own timeouts (MR 5b/6):
 * a pooled Postgres connection is held for the duration of those calls, and a
 * merely-degraded dependency would otherwise exhaust the pool. The declared debt is
 * recorded in DISPATCH_PERSISTENCE.md §6.
 *
 * The discriminating proof is the atomicity test: make `outbox.append()` throw after
 * `waves.insert()` has succeeded, then assert that the wave, the offers and the
 * events are ALL absent. An adapter with an internal transaction cannot produce that
 * outcome.
 */

import type {
  Clock,
  DispatchDependencies,
  IdGenerator,
  MatchingPort,
  OrderEnginePort,
  RulesProvider,
} from "../../ports.js";
import type { Db } from "./db.js";
import {
  PostgresDispatchIdempotencyStore,
  PostgresDispatchOutbox,
  PostgresJobRepository,
  PostgresOfferRepository,
  PostgresWaveRepository,
} from "./repository.js";

/**
 * The non-transactional dependencies the caller owns.
 *
 * Kept as an input rather than built here so the composition root decides between a
 * real clock and a fixed one, and between real HTTP clients and fakes — without the
 * Unit of Work knowing that either choice exists.
 */
export interface DispatchSharedDeps {
  readonly matching: MatchingPort;
  readonly orders: OrderEnginePort;
  readonly rules: RulesProvider;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** The transaction-bound dependencies, in the exact shape a use case expects. */
export interface DispatchUnitOfWorkDeps extends DispatchDependencies {
  readonly jobs: PostgresJobRepository;
  readonly waves: PostgresWaveRepository;
  readonly offers: PostgresOfferRepository;
  readonly outbox: PostgresDispatchOutbox;
  readonly idempotency: PostgresDispatchIdempotencyStore;
}

export interface DispatchUnitOfWorkContext {
  /** The shared transaction handle, for adapters that need it directly. */
  readonly db: Db;
  /** The deps a use case expects, all bound to the same transaction. */
  readonly deps: DispatchUnitOfWorkDeps;
}

/** Build the five adapters against one handle (a tx, or the root connection). */
export function bindDispatchAdapters(
  db: Db,
  shared: DispatchSharedDeps,
): DispatchUnitOfWorkDeps {
  return {
    jobs: new PostgresJobRepository(db),
    waves: new PostgresWaveRepository(db),
    offers: new PostgresOfferRepository(db),
    outbox: new PostgresDispatchOutbox(db),
    idempotency: new PostgresDispatchIdempotencyStore(db),
    matching: shared.matching,
    orders: shared.orders,
    rules: shared.rules,
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
export class PostgresDispatchUnitOfWork {
  constructor(private readonly db: Db) {}

  async run<T>(
    shared: DispatchSharedDeps,
    run: (context: DispatchUnitOfWorkContext) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const deps = bindDispatchAdapters(tx, shared);
      return run({ db: tx, deps });
    });
  }

  /**
   * Read path: the same adapters bound to the root connection, with NO transaction.
   *
   * `GET /dispatch/jobs/{id}` and `GET /dispatch/jobs/{id}/offers` read and do not
   * write. Wrapping a read in a transaction would hold a pooled connection for the
   * whole response in exchange for a consistency guarantee the caller cannot
   * observe — it receives one JSON document either way.
   */
  read<T>(
    shared: DispatchSharedDeps,
    run: (deps: DispatchUnitOfWorkDeps) => Promise<T>,
  ): Promise<T> {
    return run(bindDispatchAdapters(this.db, shared));
  }
}
