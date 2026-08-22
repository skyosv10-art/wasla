/**
 * Public surface of the dispatch service.
 *
 * MR 4/6 is the pure domain: state machines, the tick, the write paths and in-memory
 * adapters. No Postgres and no HTTP — those arrive in MR 5/6 together with the
 * `dispatch-db-integration` CI job, and the exit-gate package follows in MR 6/6.
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
