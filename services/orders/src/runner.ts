/**
 * The transaction seam between the HTTP layer and the adapters (MR 4/6).
 *
 * MR 3/6 settled atomicity with `PostgresOrderUnitOfWork`: a status change, its
 * audit row and its event commit together or not at all. That guarantee lives in
 * a callback (`uow.run(shared, ({ deps }) => ...)`), while a use case is a plain
 * function over `OrderDependencies`. Something has to decide, per request,
 * whether the use case runs inside a transaction — and that decision must NOT be
 * made in the route handlers: a single handler that forgot to open one would
 * silently reintroduce the partial write the whole phase exists to forbid.
 *
 * So the HTTP layer never receives dependencies. It receives a runner with two
 * methods, and the choice is made by the shape of the operation:
 *
 *   - `write(...)` — for anything that mutates: intake, transition, assignment
 *     record and resolve. On Postgres this opens ONE transaction and binds the
 *     repository, the outbox and the public-id generator to it.
 *   - `read(...)`  — for the two GET routes. No transaction: a read of the order
 *     plus its history and assignments is a snapshot the caller asked for, and
 *     wrapping it in a transaction would buy consistency it cannot use while
 *     holding a connection for the whole response.
 *
 * The in-memory runner implements both as a direct call, because the in-memory
 * store has no transaction to open. That asymmetry is the point of the seam: the
 * routes are written once and behave identically on both adapters, which is what
 * the port-conformance suite already proves for the use cases themselves.
 *
 * Not a port (`ports.ts`): the domain does not know that persistence has
 * transactions. This is a composition concern, so it sits at service level where
 * both `http/` and `infrastructure/` may import it without either depending on
 * the other.
 */

import type { OrderDependencies } from "./ports.js";

/** Work to run against a set of dependencies, transactional or not. */
export type OrderWork<T> = (deps: OrderDependencies) => Promise<T>;

/**
 * Runs use-case work with the right transaction boundary for the adapter in use.
 *
 * Implementations: `createDirectRunner` (in-memory, dev and tests) and
 * `PostgresOrderRunner` (infrastructure/drizzle/runner.ts).
 */
export interface OrderRunner {
  /** Run mutating work as ONE unit. Everything inside commits or rolls back. */
  write<T>(work: OrderWork<T>): Promise<T>;
  /** Run read-only work without opening a transaction. */
  read<T>(work: OrderWork<T>): Promise<T>;
}

/**
 * A runner over one fixed set of dependencies, with no transaction.
 *
 * Used by the in-memory wiring and by every HTTP test: the in-memory repository
 * applies each write immediately, so `write` and `read` are the same call. It is
 * deliberately NOT used with the Postgres adapters — the type would allow it,
 * but the composition root (http/server.ts) is the only place that chooses, and
 * it chooses `PostgresOrderRunner` whenever a database is configured.
 */
export function createDirectRunner(deps: OrderDependencies): OrderRunner {
  return {
    async write<T>(work: OrderWork<T>): Promise<T> {
      return work(deps);
    },
    async read<T>(work: OrderWork<T>): Promise<T> {
      return work(deps);
    },
  };
}
