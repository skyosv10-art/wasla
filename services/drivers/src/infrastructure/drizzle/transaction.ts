/**
 * The transaction boundary for Driver Core (Phase 05 · MR 3/6).
 *
 * The problem this file exists to solve, stated once:
 *
 * A single driver write is never a single row. Reviewing one document supersedes the
 * previous copy, writes the decision, recomputes and rewrites the derived
 * `verification_status`, recomputes eligibility — which rewrites
 * `eligibility_recheck_at`, appends an eligibility log row, appends a second outbox
 * event, pushes a projection to matching, appends a publication row and rewrites
 * `last_published_state`. That is up to nine writes across six tables reached through
 * six separate PORT calls, and the ports were designed in MR 2/6 without any of them
 * knowing about a transaction.
 *
 * If each adapter opened its own transaction, none of them could cover the calls that
 * follow it, and a crash or a thrown error in the middle would commit a prefix. The
 * prefixes are not harmless:
 *  - a document `superseded` with no replacement row = a driver who lost a verified
 *    paper by submitting a new one,
 *  - a verified document with no eligibility log row = a state change with no
 *    explanation, which is the single thing this service was built to make impossible,
 *  - an eligibility log row with no outbox event = matching never hears about a driver
 *    who became eligible, and he waits for orders that are never offered.
 *
 * So the boundary is the APPLICATION OPERATION, not the repository call.
 * `PostgresDriverUnitOfWork.run()` opens one transaction, binds all nine storage
 * adapters to that same handle, and hands the use case a complete
 * `DriverDependencies`. The use case is unchanged and unaware — which is the binding
 * criterion for this MR.
 *
 * Two things are deliberately NOT inside the transaction, and both are read from
 * `shared` rather than rebuilt per transaction:
 *  - `candidacy` — the outbound HTTP call to matching (MR 5/6). Holding a Postgres
 *    transaction open across a network call to another service makes our lock
 *    duration depend on their latency; a slow matching would become our lock storm.
 *    The design already tolerates this: a failed publication does NOT roll back the
 *    local change (recompute-eligibility.ts), it is recorded with its failure code.
 *  - `zoneCatalog`, `clock`, `ids` — a lookup and two pure sources with nothing to
 *    commit.
 *
 * `read()` is the counterpart: a read-only operation runs with NO transaction at all.
 * Wrapping a `GET` in `BEGIN`/`COMMIT` costs a round trip and holds a snapshot for no
 * reader's benefit.
 */

import type {
  CandidacyProjectionPort,
  Clock,
  DriverDependencies,
  IdGenerator,
  ZoneCatalogPort,
} from "../../ports.js";
import type { Db, DbOrTx } from "./db.js";
import {
  PostgresCandidacyPublicationRepository,
  PostgresDocumentRepository,
  PostgresDriverIdempotencyStore,
  PostgresDriverOutbox,
  PostgresDriverProfileRepository,
  PostgresEligibilityLogRepository,
  PostgresEligibilityPolicyRepository,
  PostgresServiceZoneRepository,
  PostgresVehicleRepository,
} from "./repository.js";

/**
 * The dependencies that do NOT belong to a transaction.
 *
 * Everything here is either a network port or a pure source. They are supplied once
 * when the service starts and reused by every operation.
 */
export interface DriverSharedDeps {
  readonly candidacy: CandidacyProjectionPort;
  readonly zoneCatalog: ZoneCatalogPort;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** A fully wired dependency set whose storage adapters share one handle. */
export type DriverUnitOfWorkDeps = DriverDependencies;

export interface DriverUnitOfWorkContext {
  readonly db: DbOrTx;
  readonly deps: DriverUnitOfWorkDeps;
}

/**
 * Bind all nine storage adapters to ONE handle.
 *
 * The handle may be the root database or an open transaction; `DbOrTx` is the same
 * type for both (db.ts), which is what lets one set of adapter classes serve the
 * transactional and the read-only path without a second implementation.
 */
export function bindDriverAdapters(db: DbOrTx, shared: DriverSharedDeps): DriverUnitOfWorkDeps {
  return {
    profiles: new PostgresDriverProfileRepository(db),
    zones: new PostgresServiceZoneRepository(db),
    vehicles: new PostgresVehicleRepository(db),
    documents: new PostgresDocumentRepository(db),
    policies: new PostgresEligibilityPolicyRepository(db),
    eligibilityLog: new PostgresEligibilityLogRepository(db),
    publications: new PostgresCandidacyPublicationRepository(db),
    outbox: new PostgresDriverOutbox(db),
    idempotency: new PostgresDriverIdempotencyStore(db),
    candidacy: shared.candidacy,
    zoneCatalog: shared.zoneCatalog,
    clock: shared.clock,
    ids: shared.ids,
  };
}

/**
 * One transaction per application operation.
 *
 * Nothing outside this class may call `db.transaction` for a driver write: a second
 * place that opens transactions is a second answer to "what commits together", and
 * the first question after an incident is which one ran.
 */
export class PostgresDriverUnitOfWork {
  constructor(private readonly db: Db) {}

  /** Run a write operation inside one transaction. */
  async run<T>(
    shared: DriverSharedDeps,
    operation: (context: DriverUnitOfWorkContext) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const deps = bindDriverAdapters(tx, shared);
      return operation({ db: tx, deps });
    });
  }

  /** Run a read-only operation with no transaction. */
  async read<T>(
    shared: DriverSharedDeps,
    operation: (context: DriverUnitOfWorkContext) => Promise<T>,
  ): Promise<T> {
    const deps = bindDriverAdapters(this.db, shared);
    return operation({ db: this.db, deps });
  }
}
