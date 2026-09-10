/**
 * Delivery HTTP boundary — Fastify app (ADR-026 §4.2, lifted for the network
 * edge in review 6/N · contracts/api.openapi.yml).
 *
 * Exactly the six routes the contract publishes, no more: a route that is not
 * in the contract is a private API nobody documented, and the first client that
 * finds it makes it permanent.
 *
 *   POST /store-orders                               → 201 (Idempotency-Key)
 *   GET  /store-orders/{orderPublicId}               → 200
 *   POST /store-orders/{orderPublicId}/cancellation  → 200 (Idempotency-Key)
 *   GET  /store-orders/{orderPublicId}/delivery-task → 200
 *   GET  /delivery/health                            → 200 (liveness)
 *   GET  /delivery/ready                             → 200/503 (readiness)
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
 * ## Liveness AND readiness — two routes because they answer two questions
 *
 * `GET /delivery/health` stays dependency-free: it answers "is this process
 * alive?", and coupling it to the database would let a database blink trigger
 * restarts. `GET /delivery/ready` (added to the contract in review 7/N,
 * §4.9-4 lifted) answers "should traffic come here?" by actually probing the
 * database. RISK-0030 is the precedent being avoided: `health: ok` while every
 * read answered 503.
 *
 * Readiness answers `ReadinessResponse` on 503 as well as 200 — the single
 * declared exception to "every failure is an `ErrorResponse`" (errors.md rule
 * 6), because an unready dependency is a state to report, not a defect to
 * translate. And what is not probed is not claimed: with no catalog port the
 * response lists `marketplace_catalog_not_wired` in `not_claimed` while still
 * reporting 200 if the database answers, because reads and cancellation ARE
 * servable then. Letting an unwireable dependency pin readiness at 503 forever
 * would make the route useless and it would be turned off — which is how a
 * service ends up with no readiness check at all.
 *
 * ## The idempotency key is required, and parsed here — not in the use case
 *
 * Both writes demand `Idempotency-Key` (§4.10). The header and the request
 * fingerprint are wire concerns, so the HTTP layer builds the intent and hands
 * it inward; the use cases and the store never read a header. A replay is
 * answered with the STORED status and body plus `Idempotent-Replay: true`, so
 * a client can tell "created" from "already created" without diffing bodies.
 */

import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";

import { DeliveryError } from "../domain/errors.js";
import type {
  IdempotencyIntent,
  ReadinessProbePort,
  StoreOrderCatalogPort,
  StoreOrderReadPort,
  StoreOrderWritePort,
} from "../ports.js";
import { assertIdempotencyKey, deriveRequestFingerprint } from "../domain/idempotency.js";
import { sendDeliveryError } from "./errors.js";
import { toDeliveryTaskResponse, toStoreOrderResponse } from "./mappers.js";
import { parseCancelBody, parseOrderPublicIdParam, parsePlaceStoreOrderBody } from "./requests.js";
import { buildReadinessResponse } from "./readiness.js";
import { placeStoreOrder } from "../use-cases/place-store-order.js";
import { cancelStoreOrder } from "../use-cases/cancel-store-order.js";

export interface DeliveryHttpDeps {
  readonly readPort: StoreOrderReadPort;
  readonly writePort: StoreOrderWritePort;
  /** Absent → `POST /store-orders` answers 503 (see the file header). */
  readonly catalogPort?: StoreOrderCatalogPort;
  /** Absent → `GET /delivery/ready` answers 503 `probe_not_wired`: an
   *  un-probed dependency is never reported as healthy. */
  readonly readinessPort?: ReadinessProbePort;
  /** Injected for determinism in tests; defaults to the real clock/uuid. */
  readonly newUuid?: () => string;
  readonly now?: () => string;
}

export interface DeliveryHttpApp {
  readonly fastify: FastifyInstance;
  readonly close: () => Promise<void>;
}

/**
 * Replay a stored first response: its status, its body, plus an explicit
 * header. Without the header a client cannot distinguish "created now" from
 * "created earlier", and a retry that silently looks like a fresh 201 hides
 * the very duplicate the key prevented.
 */
function sendReplay(reply: FastifyReply, status: number, body: unknown): FastifyReply {
  return reply.status(status).header("Idempotent-Replay", "true").send(body);
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
    // The fingerprint hashes the PARSED input, not the raw body: two byte-wise
    // different bodies that mean the same request (key order, whitespace) are
    // the same request, and an honest retry must not be refused as a reuse.
    const idempotency: IdempotencyIntent = {
      key: assertIdempotencyKey(request.headers["idempotency-key"]),
      route: "POST /store-orders",
      fingerprint: deriveRequestFingerprint("POST /store-orders", null, input),
      responseStatus: 201,
      buildResponseBody: (written) => toStoreOrderResponse(written),
    };
    const result = await placeStoreOrder(
      { catalogPort: deps.catalogPort, writePort: deps.writePort, newUuid, now },
      input,
      traceId,
      idempotency,
    );
    if (result.kind === "replayed") return sendReplay(reply, result.status, result.body);
    return reply.status(201).send(toStoreOrderResponse(result.order));
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
    const route = "POST /store-orders/{orderPublicId}/cancellation" as const;
    const idempotency: IdempotencyIntent = {
      key: assertIdempotencyKey(request.headers["idempotency-key"]),
      route,
      // The order's public id is part of the fingerprint: the same key on a
      // DIFFERENT order with the same body must be a reuse, not a replay.
      fingerprint: deriveRequestFingerprint(route, publicId, { reason_code: reasonCode }),
      responseStatus: 200,
      buildResponseBody: (written) => toStoreOrderResponse(written),
    };
    const result = await cancelStoreOrder(
      { readPort: deps.readPort, writePort: deps.writePort, newUuid, now },
      publicId,
      reasonCode,
      traceId,
      idempotency,
    );
    if (result.kind === "replayed") return sendReplay(reply, result.status, result.body);
    return reply.status(200).send(toStoreOrderResponse(result.order));
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

  // Readiness: a real probe. 503 carries the readiness body, not an error body
  // (contracts/api.openapi.yml · errors.md rule 6).
  app.get("/delivery/ready", async (_request, reply) => {
    const checks =
      deps.readinessPort === undefined
        ? // No probe wired → nothing was measured → nothing is claimed. A
          // "ready" answer here would be the RISK-0030 lie in a new place.
          ([{ name: "database", ok: false, detail: "probe_not_wired" }] as const)
        : await deps.readinessPort.probe();
    const body = buildReadinessResponse(checks, deps.catalogPort !== undefined);
    return reply.status(body.status === "ready" ? 200 : 503).send(body);
  });

  return {
    fastify: app,
    close: async () => {
      await app.close();
    },
  };
}
