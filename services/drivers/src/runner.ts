/**
 * The composition seam between an adapter and a use case (Phase 05 · MR 3/6).
 *
 * Every use case in `src/use-cases/` takes `DriverDependencies` as its first argument
 * and knows nothing else. In memory that is trivially satisfiable: one object, handed
 * to everybody. On Postgres it is not, because the dependency set has to be rebuilt
 * per operation around a transaction handle (infrastructure/drizzle/transaction.ts).
 *
 * `DriverRunner` is the one-line interface that hides that difference:
 *
 *     const driver = await runner.write((deps) => submitDocument(deps, id, input));
 *
 * The same call works against the in-memory environment (`createDirectRunner`) and
 * against Postgres (`PostgresDriverRunner`). This file lives at `src/runner.ts` and
 * NOT inside `src/use-cases/`, and that placement is the point: the binding criterion
 * for this MR is that no file under `src/use-cases/` changes to make the Postgres
 * adapters pass. A helper that composes transactions is infrastructure concern; if it
 * sat among the use cases, the domain would be one import away from knowing that a
 * transaction exists.
 *
 * MR 4/6 (the HTTP layer on port 8090) receives a `DriverRunner` and nothing else, so
 * no route handler will ever be in a position to open a transaction — the mistake that
 * `write`/`read` here makes unavailable rather than merely discouraged.
 */

import type { DriverDependencies } from "./ports.js";
import type { Db } from "./infrastructure/drizzle/db.js";
import type { DriverSharedDeps } from "./infrastructure/drizzle/transaction.js";
import { PostgresDriverUnitOfWork } from "./infrastructure/drizzle/transaction.js";

/** A unit of application work expressed purely against the ports. */
export type DriverWork<T> = (deps: DriverDependencies) => Promise<T>;

export interface DriverRunner {
  /** Run work that writes — atomically, when the adapter supports it. */
  write<T>(work: DriverWork<T>): Promise<T>;
  /** Run work that only reads. No transaction is opened. */
  read<T>(work: DriverWork<T>): Promise<T>;
}

/**
 * A runner over one fixed dependency set — the in-memory environment, or any test
 * double.
 *
 * `write` and `read` are the same call here, and that is honest rather than lazy: the
 * in-memory stores have no transaction to open, so pretending otherwise would hide
 * exactly the difference the parity suite exists to measure.
 */
export function createDirectRunner(deps: DriverDependencies): DriverRunner {
  return {
    async write<T>(work: DriverWork<T>): Promise<T> {
      return work(deps);
    },
    async read<T>(work: DriverWork<T>): Promise<T> {
      return work(deps);
    },
  };
}

/** A runner that opens one Postgres transaction per write. */
export class PostgresDriverRunner implements DriverRunner {
  private readonly unitOfWork: PostgresDriverUnitOfWork;

  constructor(
    db: Db,
    private readonly shared: DriverSharedDeps,
  ) {
    this.unitOfWork = new PostgresDriverUnitOfWork(db);
  }

  async write<T>(work: DriverWork<T>): Promise<T> {
    return this.unitOfWork.run(this.shared, async ({ deps }) => work(deps));
  }

  async read<T>(work: DriverWork<T>): Promise<T> {
    return this.unitOfWork.read(this.shared, async ({ deps }) => work(deps));
  }
}
