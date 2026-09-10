/**
 * Delivery HTTP boundary — Fastify app (ADR-026 §4.2, lifted for the network
 * edge in review 6/N · contracts/api.openapi.yml).
 *
 * Exactly the five routes the contract publishes, no more: a route that is not
 * in the contract is a private API nobody documented, and the first client that
 * finds it makes it permanent.
 *
 *   POST /store-orders                               → 201
 *   GET  /store-orders/{orderPublicId}               → 200
 *   POST /store-orders/{orderPublicId}/cancellation  → 200
 *   GET  /store-orders/{orderPublicId}/delivery-task → 200
 *   GET  /delivery/health                            → 200 (liveness)
 *
 * ## Injected ports — this app never opens a database
 *
 * Every dependency arrives through `DeliveryHttpDeps`. Unit tests build the
 * app with fakes and assert real HTTP status codes and bodies; production
 * wiring lives in `server.ts`. An app that constructed its own `pg.Pool`
 * could not be tested without a database, and the tests that matter most
 * (does a refused cancellation really answer 409?) would silently not run.
 *
 * ## One error handler, no try/catch in handlers
 *
 * Handlers throw `DeliveryError` (or let a port throw) and a single
 * `setErrorHandler` translates through `sendDeliveryError`. Per-handler
 * try/catch would mean the same error translated in five places, and the
 * first route that forgot the body shape would answer something no client
 * can parse.
 *
 * ## The catalog port is OPTIONAL, and its absence is a 503 — not a fake
 *
 * `POST /store-orders` needs marketplace prices (§2.3). The store ref in this
 * contract is `WS-##########` while marketplace identifies stores by
 * `store_slug`/`store_id` and publishes no public store ref, so no HTTP
 * catalog adapter can be written today (ADR-026 §4.9-2). When no catalog port
 * is injected the route answers `503 DELIVERY_MARKETPLACE_UNAVAILABLE`:
 * placement is refused loudly instead of inventing prices, and reads and
 * cancellation — which need no catalog — work fully in production.
 *
 * ## Liveness only, by contract — and that is a KNOWN gap
 *
 * The contract publishes `GET /delivery/health` and no readiness route. This
 * app therefore ships liveness only: it takes no dependency and cannot be a
 * deployment gate. The search service learned this the hard way (RISK-0030:
 * `health: ok` while every read returned 503). We do NOT add an undeclared
 * `/delivery/ready` here — adding routes outside the contract is the drift
 * this whole review exists to avoid — but the gap is recorded in ADR-026
 * §4.9-4 as a contract revision to make, not a detail to discover in
 * production.
 */

import Fastify, { type FastifyInstance } from "fastify";

import { DeliveryError } from "../domain/errors.js";
import type { StoreOrderCatalogPort, StoreOrderReadPort, StoreOrderWritePort } from "../ports.js";
import { sendDeliveryError } from "./errors.js";
import { toDeliveryTaskResponse, toStoreOrderResponse } from "./mappers.js";
import { parseCancelBody, parseOrderPublicIdParam, parsePlaceStoreOrderBody } from "./requests.js";
import { placeStoreOrder } from "../use-cases/place-store-order.js";
import { cancelStoreOrder } from "../use-cases/cancel-store-order.js";

export interface DeliveryHttpDeps {
  readonly readPort: StoreOrderReadPort;
  readonly writePort: StoreOrderWritePort;
  /** Absent → `POST /store-orders` answers 503 (see the file header). */
  readonly catalogPort?: StoreOrderCatalogPort;
  /** Injected for determinism in tests; defaults to the real clock/uuid. */
  readonly newUuid?: () => string;
  readonly now?: () => string;
}

export interface DeliveryHttpApp {
  readonly fastify: FastifyInstance;
  readonly close: () => Promise<void>;
}

export function buildDeliveryHttpApp(deps: DeliveryHttpDeps): DeliveryHttpApp {
  const app = Fastify({
    // request.id becomes `trace_id` in every error body and every event.
    genReqId: () => crypto.randomUUID(),
  });

  const newUuid = deps.newUuid ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date().toISOString());

  app.setErrorHandler((error, request, reply) => {
    return sendDeliveryError(reply, error, String(request.id));
  });

  app.post("/store-orders", async (request, reply) => {
    const traceId = String(request.id);
    if (deps.catalogPort === undefined) {
      throw new DeliveryError(
        "DELIVERY_MARKETPLACE_UNAVAILABLE",
        "لا منفذَ كتالوجٍ مُركَّبٌ — لقطةُ السعرِ لا تُخترعُ (ADR-026 §2.3 · §4.9-2)",
        { traceId },
      );
    }
    const input = parsePlaceStoreOrderBody(request.body);
    const order = await placeStoreOrder(
      { catalogPort: deps.catalogPort, writePort: deps.writePort, newUuid, now },
      input,
      traceId,
    );
    return reply.status(201).send(toStoreOrderResponse(order));
  });

  app.get("/store-orders/:orderPublicId", async (request, reply) => {
    const publicId = parseOrderPublicIdParam(request.params);
    const order = await deps.readPort.getOrderByPublicId(publicId);
    if (order === null) {
      throw new DeliveryError("DELIVERY_ORDER_NOT_FOUND", "لا طلبَ بهذا المرجعِ", {
        traceId: String(request.id),
        details: { field: "orderPublicId", actual: publicId },
      });
    }
    return reply.status(200).send(toStoreOrderResponse(order));
  });

  app.post("/store-orders/:orderPublicId/cancellation", async (request, reply) => {
    const traceId = String(request.id);
    const publicId = parseOrderPublicIdParam(request.params);
    const reasonCode = parseCancelBody(request.body);
    const order = await cancelStoreOrder(
      { readPort: deps.readPort, writePort: deps.writePort, newUuid, now },
      publicId,
      reasonCode,
      traceId,
    );
    return reply.status(200).send(toStoreOrderResponse(order));
  });

  app.get("/store-orders/:orderPublicId/delivery-task", async (request, reply) => {
    const publicId = parseOrderPublicIdParam(request.params);
    const task = await deps.readPort.getTaskByOrderPublicId(publicId);
    if (task === null) {
      // One code for "no order" and "no task" would hide which is missing;
      // the catalog publishes both, so the route distinguishes them.
      const order = await deps.readPort.getOrderByPublicId(publicId);
      throw new DeliveryError(
        order === null ? "DELIVERY_ORDER_NOT_FOUND" : "DELIVERY_TASK_NOT_FOUND",
        order === null ? "لا طلبَ بهذا المرجعِ" : "لا مهمّةَ توصيلٍ لهذا الطلبِ",
        { traceId: String(request.id), details: { field: "orderPublicId", actual: publicId } },
      );
    }
    return reply.status(200).send(toDeliveryTaskResponse(task));
  });

  // Liveness: no dependency, no DB. Never fails while the process runs.
  app.get("/delivery/health", async () => {
    return { status: "ok" as const };
  });

  return {
    fastify: app,
    close: async () => {
      await app.close();
    },
  };
}
