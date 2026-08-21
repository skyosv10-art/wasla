/**
 * Unit of Work: the atomicity boundary for the Order Engine.
 *
 * ADR-010 §127 promises that every status change + audit row + outbox event is
 * ONE transaction. The use cases call `repository.insertOrder(...)` /
 * `repository.applyTransition(...)` and then `outbox.append(...)` as separate
 * calls, so a repository that opened and committed its own transaction on each
 * call could never cover the subsequent `outbox.append()`. The customer service
 * carried exactly this as documented debt; the order engine settles it here.
 *
 * The Unit of Work opens one Drizzle transaction and hands the SAME transaction
 * handle to both `PostgresOrderRepository` and `PostgresOrderOutbox` (and to the
 * `PostgresOrderPublicIdGenerator`). Use cases are then run unchanged inside the
 * callback: their separate `repository` / `outbox` calls share the transaction,
 * so the triple write commits or rolls back together. This adds a composition
 * helper outside `src/use-cases/` — it does not change a single use-case file,
 * which is the binding MR 3/6 criterion.
 *
 * The discriminating proof is the atomicity test: make `outbox.append()` throw
 * after `repository.applyTransition()` has succeeded, and assert the order's
 * status, the audit row, AND the event are all absent after the rollback. A
 * repository-internal transaction could not produce that outcome.
 */

import type {
  Clock,
  IdGenerator,
  OrderDependencies,
  OrderPublicIdGenerator,
  OrderRepository,
  Outbox,
} from "../../ports.js";
import type { Db } from "./db.js";
import {
  PostgresOrderOutbox,
  PostgresOrderPublicIdGenerator,
  PostgresOrderRepository,
} from "./repository.js";

/**
 * The shared, clock-and-id-bearing pieces the Unit of Work assembles inside the
 * transaction. `repository`, `outbox` and `publicIds` are rebuilt per transaction
 * so they share the tx handle; `clock` and `ids` are reused as-is because they
 * are not transactional.
 */
export interface OrderUnitOfWorkDeps extends OrderDependencies {
  readonly repository: OrderRepository;
  readonly outbox: Outbox;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly publicIds: OrderPublicIdGenerator;
}

export interface OrderUnitOfWorkContext {
  /** The shared transaction handle, for adapters that need it directly. */
  readonly db: Db;
  /** The deps a use case expects, all bound to the same transaction. */
  readonly deps: OrderUnitOfWorkDeps;
}

/**
 * A factory for the non-transactional deps (`clock`, `ids`). Kept as a function
 * so the caller controls determinism (a fixed clock for tests, a real clock for
 * production) without the Unit of Work knowing about either.
 */
export interface OrderSharedDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * Run a unit of work inside a single Postgres transaction.
 *
 * `run` receives the assembled deps — repository, outbox and publicIds all bound
 * to the same tx — and may call any use case against them. If `run` throws, the
 * transaction rolls back and every write (status, audit row, event) is undone.
 */
export class PostgresOrderUnitOfWork {
  constructor(private readonly db: Db) {}

  async run<T>(
    shared: OrderSharedDeps,
    run: (context: OrderUnitOfWorkContext) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const repository = new PostgresOrderRepository(tx);
      const outbox = new PostgresOrderOutbox(tx);
      const publicIds = new PostgresOrderPublicIdGenerator(tx);
      const deps: OrderUnitOfWorkDeps = {
        repository,
        outbox,
        clock: shared.clock,
        ids: shared.ids,
        publicIds,
      };
      return run({ db: tx, deps });
    });
  }
}
