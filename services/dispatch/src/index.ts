/**
 * Public surface of the dispatch service.
 *
 * MR 4/6 is the pure domain: state machines, the tick, the write paths and in-memory
 * adapters. MR 5a/6 adds the Postgres adapters and the unit of work below, with the
 * `dispatch-db-integration` CI job. HTTP (port 8089) and the real matching/order
 * clients are MR 5b/6; the exit-gate package follows in MR 6/6.
 *
 * The fake order engine and fake matching port are NOT exported here. They live in
 * `src/__tests__/harness.ts` because the fake engine validates transitions against the
 * real table from `@wasla/orders-service`, which is a devDependency — exporting it would
 * put a test dependency on the production import path.
 */
export * from "./domain/model.js";
export * from "./domain/state-machine.js";
export * from "./domain/errors.js";
export * from "./domain/validation.js";
export * from "./domain/deadlines.js";
export * from "./domain/keys.js";
export * from "./domain/events.js";
export * from "./ports.js";
export * from "./mappers.js";
export * from "./infrastructure/in-memory.js";
export * from "./use-cases/order-engine.js";
export * from "./use-cases/idempotency.js";
export * from "./use-cases/create-job.js";
export * from "./use-cases/tick.js";
export * from "./use-cases/accept-offer.js";
export * from "./use-cases/reject-offer.js";
export * from "./use-cases/cancel-job.js";
export * from "./use-cases/read-job.js";
export * from "./runner.js";
export * from "./run-tick.js";
export * from "./infrastructure/http-order-engine.js";
export * from "./infrastructure/http-matching.js";
export * from "./http/app.js";
export * from "./http/service-identity.js";

// Postgres adapters (Phase 07 · MR 5a/6). Exported so the HTTP layer of MR 5b/6 —
// and the exit-gate harness of MR 6/6 — can bind real storage without knowing how
// the tables are shaped. The repositories themselves are deliberately NOT exported:
// callers get them from `bindDispatchAdapters`, which is the only way to obtain a
// set that shares one transaction, and sharing one transaction is what keeps a wave
// from being committed without its offers.
export { createDispatchDb } from "./infrastructure/drizzle/db.js";
export type { Db, DbConfig, DbOrTx } from "./infrastructure/drizzle/db.js";
export { PostgresDispatchOutbox } from "./infrastructure/drizzle/repository.js";
export {
  bindDispatchAdapters,
  PostgresDispatchUnitOfWork,
} from "./infrastructure/drizzle/transaction.js";
export type {
  DispatchSharedDeps,
  DispatchUnitOfWorkContext,
  DispatchUnitOfWorkDeps,
} from "./infrastructure/drizzle/transaction.js";
