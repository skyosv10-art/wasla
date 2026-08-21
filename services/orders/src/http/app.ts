/**
 * Fastify HTTP app factory for the Order Engine service (MR 4/6).
 *
 * Wires the seven published paths of services/orders/contracts/api.openapi.yml to
 * the use cases of MR 2/6, over the ports whose Postgres adapters and Unit of
 * Work arrived in MR 3/6. The factory takes an `OrderRunner` (../runner.ts), not
 * dependencies: the runner decides the transaction boundary, so tests inject the
 * in-memory adapters through `app.inject` while the bootstrap (server.ts) wires
 * Drizzle/Postgres — and no route handler can forget to open a transaction. The
 * factory never listens; that is server.ts's single job.
 *
 * Routes — exactly the published contract, nothing more:
 *   GET   /health                                             (ops)
 *   POST  /orders/intake                                      (Idempotency-Key)
 *   GET   /orders/:orderId                                    (X-Customer-Public-Id)
 *   GET   /orders/:orderId/history                            (X-Customer-Public-Id)
 *   POST  /orders/:orderId/transitions                        (Idempotency-Key)
 *   POST  /orders/:orderId/assignments                        (Idempotency-Key)
 *   PATCH /orders/:orderId/assignments/:assignmentId          (Idempotency-Key)
 *
 * Three properties of this layer are decisions, not conventions:
 *
 * 1. **Owner scoping answers 404, never 403.** Reading another customer's order
 *    returns `ORDER_NOT_FOUND` — the same answer as an id that does not exist.
 *    403 would confirm that the order exists, which turns the read route into an
 *    existence oracle: `order_public_id` is sequential (`ORD-` + a database
 *    sequence, ADR-010 decision 5), so a caller could walk it and count the
 *    platform's orders. The contract states this on the `CustomerScope` parameter
 *    («لا نُثبت وجود ما لا يُقرأ»), and it is asserted by a test rather than left
 *    to a reviewer's memory.
 *
 * 2. **`Idempotency-Key` is mandatory on every write.** The system's entry point
 *    is a bot: a double tap is an ordinary event, not an anomaly. The key is
 *    required before the body is even mapped, so a retry can never be
 *    indistinguishable from a new order.
 *
 * 3. **Status codes come from the contract.** Intake answers 201 for a fresh
 *    order and 200 when a replayed key returned the stored one, so the caller can
 *    tell «created» from «already existed» without comparing bodies. A recorded
 *    assignment is 201 (a new record); a resolved one is 200 (an existing record
 *    changed state); a transition is 200 (the order already existed).
 *
 * What this layer deliberately does NOT do:
 *  - it does not classify errors — `OrderError` already carries the contract code
 *    and the status its class implies (errors.ts);
 *  - it does not validate meaning — enums and shapes here (requests.ts), every
 *    rule with meaning in the domain, because Phase 07 will call the same use
 *    cases in-process and must be refused identically;
 *  - it does not own a connection or a transaction — the runner does;
 *  - it does not authenticate. Phase 06 enforces the SHAPE of an actor
 *    (`actor_ref` present for a person, absent for `system`) and cannot verify
 *    that a caller is who it claims: no identity is presented at this boundary
 *    yet. The gap is declared here and in ORDER_HTTP.md rather than papered over
 *    with a check that only looks like authentication.
 */

import Fastify, { type FastifyInstance } from "fastify";

import { OrderError } from "../domain/errors.js";
import type { OrderDetail } from "../domain/model.js";
import {
  assignmentToWire,
  intakeCommandFromWire,
  orderToWire,
  statusHistoryEntryToWire,
  transitionCommandFromWire,
} from "../mappers.js";
import type { OrderDependencies } from "../ports.js";
import type { OrderRunner } from "../runner.js";
import { ingestOrder } from "../use-cases/ingest-order.js";
import {
  recordAssignment,
  resolveAssignment,
} from "../use-cases/manage-assignments.js";
import {
  getOrderDetail,
  getOrderDetailByPublicId,
} from "../use-cases/read-order.js";
import { transitionOrder } from "../use-cases/transition-order.js";

import { sendOrderError } from "./errors.js";
import {
  assertIdempotencyKeyAgreement,
  assertRequestIdLength,
  requireCustomerScope,
  requireIdempotencyKey,
  toAssignmentDriver,
  toAssignmentId,
  toAssignmentResolution,
  toIntakeRequest,
  toOrderRef,
  toTransitionRequest,
  type OrderRef,
} from "./requests.js";

/** What `/health` reports about the adapters this process actually wired. */
export interface OrderHealthDescriptor {
  /** `postgres` when DATABASE_URL was set, `memory` for the dev fallback. */
  persistence: "postgres" | "memory";
}

export interface CreateOrderAppOptions {
  /** The transaction seam: in-memory direct, or the Postgres Unit of Work. */
  runner: OrderRunner;
  /** Enable Fastify's request logger (pino). Off by default for tests. */
  logger?: boolean;
  /**
   * Reported by `/health`. Defaults to the honest dev state: in-memory
   * persistence, which the contract requires be reported as `degraded` — a
   * service that answers `ok` while it cannot durably store an order hides an
   * outage.
   */
  health?: OrderHealthDescriptor;
}

const DEFAULT_HEALTH: OrderHealthDescriptor = { persistence: "memory" };

/**
 * Resolve the internal id of an order referenced either way.
 *
 * Runs inside the caller's unit of work, so a write does its lookup and its
 * mutation in ONE transaction: resolving in a separate read first would leave a
 * window in which the order could change between the two.
 */
async function resolveOrderId(
  deps: OrderDependencies,
  ref: OrderRef,
  traceId: string,
): Promise<string> {
  if (ref.kind === "id") return ref.value;
  const order = await deps.repository.findOrderByPublicId(ref.value);
  if (!order) {
    throw new OrderError("ORDER_NOT_FOUND", `الطلب ${ref.value} غير موجود`, {
      traceId,
    });
  }
  return order.id;
}

/** Read an order with its history and assignments, by either reference form. */
async function readDetail(
  deps: OrderDependencies,
  ref: OrderRef,
  traceId: string,
): Promise<OrderDetail> {
  return ref.kind === "id"
    ? getOrderDetail(deps, ref.value, { traceId })
    : getOrderDetailByPublicId(deps, ref.value, { traceId });
}

/**
 * Owner scoping: an order belonging to another customer does not exist.
 *
 * Raised as `ORDER_NOT_FOUND` with the same message shape as a genuinely missing
 * order, so the two are indistinguishable in the response AND in the logs.
 */
function assertOwner(detail: OrderDetail, scope: string, traceId: string): void {
  if (detail.order.customerPublicId !== scope) {
    throw new OrderError("ORDER_NOT_FOUND", `الطلب ${detail.order.id} غير موجود`, {
      traceId,
    });
  }
}

/** Build the Order Engine Fastify app without starting to listen. */
export function createOrderApp(options: CreateOrderAppOptions): FastifyInstance {
  const { runner } = options;
  const health = options.health ?? DEFAULT_HEALTH;

  // `requestIdHeader` is off by default in Fastify 5, which would make every
  // request id local to this process. Honouring `x-request-id` lets the
  // customers service (MR 5/6) pass ONE correlation id that ends up in this
  // service's audit rows and outbox envelopes, so a customer complaint can be
  // followed across the handover instead of stopping at our door. An absent
  // header still yields Fastify's own id, so nothing depends on the caller.
  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: "x-request-id",
  });

  app.setErrorHandler((error, request, reply) => {
    sendOrderError(reply, error, request.id);
  });

  // --- ops -----------------------------------------------------------------

  // `ok` only with durable storage, per the contract's /health description.
  app.get("/health", async (_request, reply) => {
    return reply.status(200).send({
      status: health.persistence === "postgres" ? "ok" : "degraded",
      service: "orders-service",
      persistence: health.persistence,
    });
  });

  // --- intake --------------------------------------------------------------

  app.post("/orders/intake", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const idempotencyKey = requireIdempotencyKey(request.headers, traceId);
    assertIdempotencyKeyAgreement(request.body, idempotencyKey, traceId);
    const command = intakeCommandFromWire(toIntakeRequest(request.body, traceId), {
      idempotencyKey,
      traceId,
    });

    const outcome = await runner.write((deps) => ingestOrder(deps, command));

    // 201 fresh · 200 replayed: the caller learns which happened without
    // comparing bodies, and the Phase 04 exit gate asserts this from the
    // handing-over side.
    return reply.status(outcome.replayed ? 200 : 201).send({
      order_public_id: outcome.orderPublicId,
      accepted_at: outcome.acceptedAt,
    });
  });

  // --- reads ---------------------------------------------------------------

  app.get("/orders/:orderId", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const scope = requireCustomerScope(request.headers, traceId);
    const ref = toOrderRef((request.params as { orderId?: unknown }).orderId, traceId);

    const detail = await runner.read((deps) => readDetail(deps, ref, traceId));
    assertOwner(detail, scope, traceId);

    return reply.status(200).send(orderToWire(detail.order, detail.activeAssignment));
  });

  app.get("/orders/:orderId/history", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const scope = requireCustomerScope(request.headers, traceId);
    const ref = toOrderRef((request.params as { orderId?: unknown }).orderId, traceId);

    const detail = await runner.read((deps) => readDetail(deps, ref, traceId));
    assertOwner(detail, scope, traceId);

    // Oldest first — the repository port guarantees the order, and the audit
    // trail is only readable as a story if it is told in sequence.
    return reply
      .status(200)
      .send({ items: detail.statusHistory.map(statusHistoryEntryToWire) });
  });

  // --- transitions ---------------------------------------------------------

  app.post("/orders/:orderId/transitions", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const idempotencyKey = requireIdempotencyKey(request.headers, traceId);
    const ref = toOrderRef((request.params as { orderId?: unknown }).orderId, traceId);
    const command = transitionCommandFromWire(
      toTransitionRequest(request.body, traceId),
      { idempotencyKey, traceId },
    );

    // The transition, its audit row, its event AND the read-back of the bound
    // assignment all happen in one unit: the response describes the state the
    // transaction committed, not a state re-read afterwards.
    const detail = await runner.write(async (deps) => {
      const orderId = await resolveOrderId(deps, ref, traceId);
      const outcome = await transitionOrder(deps, orderId, command);
      return getOrderDetail(deps, outcome.order.id, { traceId });
    });

    return reply.status(200).send(orderToWire(detail.order, detail.activeAssignment));
  });

  // --- assignments ---------------------------------------------------------

  app.post("/orders/:orderId/assignments", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const idempotencyKey = requireIdempotencyKey(request.headers, traceId);
    const ref = toOrderRef((request.params as { orderId?: unknown }).orderId, traceId);
    const driverPublicId = toAssignmentDriver(request.body, traceId);

    const assignment = await runner.write(async (deps) => {
      const orderId = await resolveOrderId(deps, ref, traceId);
      return recordAssignment(deps, orderId, {
        driverPublicId,
        idempotencyKey,
        traceId,
      });
    });

    return reply.status(201).send(assignmentToWire(assignment));
  });

  app.patch("/orders/:orderId/assignments/:assignmentId", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    // Required for symmetry with every other write, even though the resolution
    // command has no replay slot of its own (see the declared limitation in
    // docs/04-api/ORDER_HTTP.md): a write that takes no key today would have to
    // become breaking to take one tomorrow.
    requireIdempotencyKey(request.headers, traceId);
    const params = request.params as { orderId?: unknown; assignmentId?: unknown };
    const ref = toOrderRef(params.orderId, traceId);
    const assignmentId = toAssignmentId(params.assignmentId, traceId);
    const resolution = toAssignmentResolution(request.body, traceId);

    const assignment = await runner.write(async (deps) => {
      const orderId = await resolveOrderId(deps, ref, traceId);
      return resolveAssignment(deps, orderId, {
        assignmentId,
        state: resolution.state,
        reasonCode: resolution.reasonCode,
        traceId,
      });
    });

    return reply.status(200).send(assignmentToWire(assignment));
  });

  return app;
}
