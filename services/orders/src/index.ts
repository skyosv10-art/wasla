/**
 * @wasla/orders-service — WASLA Order Engine domain (Phase 06).
 *
 * MR 2/6 delivers the pure core: the transition table, the domain model, the
 * ports, the use cases and the in-memory adapters. Nothing here opens a socket
 * or a connection — the Postgres adapters arrive in MR 3/6 behind these same
 * ports, and the HTTP layer on 8087 in MR 4/6.
 *
 * What this service owns, and nothing else does: the order lifecycle. Every
 * status change goes through `transitionOrder`, is checked against the published
 * 72-edge table, writes an audit row and emits an event — in one unit. That is
 * the whole promise of the phase, and `docs/03-domain/ORDER_ENGINE.md` is the
 * table's published form, kept in step by a conformance test in both directions.
 *
 * What it deliberately does not own (ADR-010): who gets an offer (Phase 07),
 * money movement (Phase 12), driver data (Phase 05), channels (Phase 03). Every
 * cross-service id it stores is opaque.
 *
 * Contract First (ADR-004): the API DTOs, event types, error catalog and reason
 * catalog come from @wasla/contracts-order, drift-guarded against the contract
 * files in services/orders/contracts/.
 */

export * from "./domain/state-machine.js";
export * from "./domain/agreed-price.js";
export * from "./domain/model.js";
export * from "./domain/errors.js";
export * from "./domain/validation.js";
export * from "./domain/events.js";
export * from "./ports.js";
export * from "./mappers.js";
export * from "./infrastructure/in-memory.js";
export * from "./use-cases/ingest-order.js";
export * from "./use-cases/transition-order.js";
export * from "./use-cases/manage-assignments.js";
export * from "./use-cases/read-order.js";
export * from "./use-cases/record-agreed-price.js";

// --- Composition seam and HTTP layer (MR 4/6) --------------------------
//
// `runner.ts` is exported because it is the seam a caller must satisfy to build
// the app; the Drizzle runner because it is the production implementation of it.
// The Fastify pieces are exported for the same reason the customers service
// exports its own: the exit-gate package (MR 6/6) builds the app in-process and
// drives it with `app.inject`, without a port and without a container.
export { createDirectRunner } from "./runner.js";
export type { OrderRunner, OrderWork } from "./runner.js";
export { PostgresOrderRunner } from "./infrastructure/drizzle/runner.js";
// The exit gate (MR 6/6) lifts the engine onto Postgres the same way the
// bootstrap does, and reads the outbox to prove an event was really appended.
// Both are therefore part of the surface a composition root needs; the
// repository and the public-id generator are not, because nothing outside this
// service may build them without going through the runner.
export { createOrderDb } from "./infrastructure/drizzle/db.js";
export type { Db, DbConfig } from "./infrastructure/drizzle/db.js";
export { PostgresOrderOutbox } from "./infrastructure/drizzle/repository.js";
export { PostgresOrderUnitOfWork } from "./infrastructure/drizzle/transaction.js";
export { createOrderApp } from "./http/app.js";
export type { CreateOrderAppOptions, OrderHealthDescriptor } from "./http/app.js";
export { sendOrderError } from "./http/errors.js";
export type { OrderErrorBody } from "./http/errors.js";
export {
  assertIdempotencyKeyAgreement,
  assertRequestIdLength,
  requireCustomerScope,
  requireIdempotencyKey,
  toAgreedPriceRecord,
  toAssignmentDriver,
  toAssignmentId,
  toAssignmentResolution,
  toIntakeRequest,
  toOrderRef,
  toTransitionRequest,
} from "./http/requests.js";
export type { AssignmentResolutionBody, OrderRef, RequestHeaders } from "./http/requests.js";
