/**
 * The Postgres `OrderRunner` (MR 4/6).
 *
 * Adapts the Unit of Work delivered in MR 3/6 to the seam the HTTP layer talks
 * to (../../runner.ts), without touching a single use case — which was the
 * binding criterion of MR 3/6 and stays binding here.
 *
 *   - `write` delegates to `PostgresOrderUnitOfWork.run`, so the repository, the
 *     outbox and the public-id generator handed to the use case are all bound to
 *     ONE transaction. Rolling back therefore undoes the status change, the audit
 *     row AND the event together, which is the guarantee the atomicity
 *     integration test discriminates.
 *   - `read` binds the same adapters to the root connection instead. No
 *     transaction is opened: `GET /orders/{id}` reads the order, its history and
 *     its assignments, and does not write. Wrapping a read in a transaction would
 *     hold a pooled connection for the whole response for a consistency
 *     guarantee the caller cannot observe (it receives one JSON document either
 *     way).
 *
 * `clock` and `ids` come from outside: they are not transactional, and the
 * composition root owns the choice between a real clock and a fixed one.
 */

import type { OrderDependencies } from "../../ports.js";
import type { OrderRunner, OrderWork } from "../../runner.js";
import type { Db } from "./db.js";
import {
  PostgresOrderOutbox,
  PostgresOrderPublicIdGenerator,
  PostgresOrderRepository,
} from "./repository.js";
import {
  PostgresOrderUnitOfWork,
  type OrderSharedDeps,
} from "./transaction.js";

export class PostgresOrderRunner implements OrderRunner {
  private readonly unitOfWork: PostgresOrderUnitOfWork;

  constructor(
    private readonly db: Db,
    private readonly shared: OrderSharedDeps,
  ) {
    this.unitOfWork = new PostgresOrderUnitOfWork(db);
  }

  async write<T>(work: OrderWork<T>): Promise<T> {
    return this.unitOfWork.run(this.shared, ({ deps }) => work(deps));
  }

  async read<T>(work: OrderWork<T>): Promise<T> {
    const deps: OrderDependencies = {
      repository: new PostgresOrderRepository(this.db),
      outbox: new PostgresOrderOutbox(this.db),
      clock: this.shared.clock,
      ids: this.shared.ids,
      publicIds: new PostgresOrderPublicIdGenerator(this.db),
    };
    return work(deps);
  }
}
