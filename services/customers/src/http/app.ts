/**
 * Fastify HTTP app factory for the Customer Core service (MR 4/6).
 *
 * Wires the 7 contract paths of services/customers/contracts/api.openapi.yml to
 * the use cases delivered in MR 2/6, over the ports whose Postgres adapters
 * arrived in MR 3/6. The factory takes the shared `UseCaseDeps` (hexagonal
 * wiring), so tests inject the in-memory adapters through `app.inject` while the
 * bootstrap (server.ts) wires Drizzle/Postgres and the real order-engine
 * adapter. The factory never listens — that is server.ts's single job.
 *
 * Routes (exactly the published contract, nothing more):
 *   GET    /health                                                (ops)
 *   GET    /customers/:waslaPublicId/profile
 *   PUT    /customers/:waslaPublicId/profile
 *   GET    /customers/:waslaPublicId/places
 *   POST   /customers/:waslaPublicId/places                       (Idempotency-Key)
 *   DELETE /customers/:waslaPublicId/places/:placeId
 *   POST   /customers/:waslaPublicId/order-requests/preview
 *   GET    /customers/:waslaPublicId/order-requests
 *   POST   /customers/:waslaPublicId/order-requests               (Idempotency-Key)
 *   GET    /customers/:waslaPublicId/order-requests/:orderRequestId
 *
 * What this layer does NOT do, on purpose:
 *  - it does not validate meaning (enums, lengths, price coherence, stop count):
 *    those live in the domain, because the bot (MR 5/6) calls the use cases
 *    directly and must be rejected identically;
 *  - it does not classify errors: `CustomerError` already carries the contract
 *    code and the status derived from its documented class (see errors.ts);
 *  - it does not own a database connection: the pool belongs to server.ts.
 *
 * Status codes come from the contract, not from convention: a replayed
 * `Idempotency-Key` answers 200 with the stored entity while a fresh write
 * answers 201, so the caller can tell «created» from «already existed» without
 * comparing bodies (§43).
 */

import Fastify, { type FastifyInstance } from "fastify";

import { SAVED_PLACES_LIMIT } from "@wasla/contracts-customer";

import type { ZoneReference } from "../domain/model.js";
import type { GeographyPort } from "../ports.js";
import type { UseCaseDeps } from "../use-cases/deps.js";
import {
  getCustomerProfile,
  upsertCustomerProfile,
} from "../use-cases/customer-profile.js";
import {
  toCustomerProfileDto,
  toOrderRequestDto,
  toOrderRequestPreviewDto,
  toSavedPlaceDto,
} from "../use-cases/mappers.js";
import {
  getOrderRequest,
  listOrderRequests,
  previewOrderRequest,
  submitOrderRequest,
} from "../use-cases/order-requests.js";
import {
  listSavedPlaces,
  removeSavedPlace,
  savePlace,
} from "../use-cases/saved-places.js";

import { sendCustomerError } from "./errors.js";
import {
  requireIdempotencyKey,
  toListLimit,
  toOrderRequestDraft,
  toProfilePatch,
  toSavedPlaceDraft,
} from "./requests.js";

/** What `/health` reports about the adapters this process actually wired. */
export interface CustomerHealthDescriptor {
  /** `postgres` when DATABASE_URL was set, `memory` for the dev fallback. */
  persistence: "postgres" | "memory";
  /** `configured` only when a real order-engine adapter is wired (Phase 06). */
  orderIntake: "configured" | "unconfigured";
}

export interface CreateCustomerAppOptions {
  deps: UseCaseDeps;
  /** Enable Fastify's request logger (pino). Off by default for tests. */
  logger?: boolean;
  /**
   * Reported by `/health`. Defaults to the honest Phase 04 state: in-memory
   * persistence and no order-engine adapter — a build that cannot complete a
   * handover says so instead of claiming to be healthy.
   */
  health?: CustomerHealthDescriptor;
}

const DEFAULT_HEALTH: CustomerHealthDescriptor = {
  persistence: "memory",
  orderIntake: "unconfigured",
};

/**
 * Resolve zone paths for display, best effort.
 *
 * `zone_path` is a convenience the bot prints; the zone id is the truth and the
 * path is never stored (see mappers.ts). So a geography lookup that fails must
 * not fail a read of the customer's own local data: the path comes back null and
 * the row is still returned. The alternative — 503 on a saved-place list because
 * a display string could not be resolved — would make an unrelated service an
 * availability dependency of every read.
 *
 * One lookup per distinct zone: `GeographyPort` has no batch method because
 * nothing needed one until now. That cost is declared in the architecture doc
 * rather than hidden behind a silent loop.
 */
async function resolveZones(
  geography: GeographyPort,
  zoneIds: readonly string[],
): Promise<ZoneReference[]> {
  const distinct = [...new Set(zoneIds)];
  const resolved = await Promise.all(
    distinct.map(async (zoneId) => {
      try {
        return await geography.findZone(zoneId);
      } catch {
        return null;
      }
    }),
  );
  return resolved.filter((zone): zone is ZoneReference => zone !== null);
}

/** Build the Customer Core Fastify app without starting to listen. */
export function createCustomerApp(
  options: CreateCustomerAppOptions,
): FastifyInstance {
  const { deps } = options;
  const health = options.health ?? DEFAULT_HEALTH;
  // `requestIdHeader` is off by default in Fastify 5, which would make every
  // request id local to this process. Honouring `x-request-id` lets a caller —
  // the bot in MR 5/6, or the gateway later — pass one correlation id that ends
  // up in the outbox envelopes of this service, so a customer complaint can be
  // followed across services instead of stopping at our door. An absent header
  // still yields Fastify's own generated id, so nothing depends on the caller.
  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: "x-request-id",
  });

  app.setErrorHandler((error, request, reply) => {
    sendCustomerError(reply, error, request.id);
  });

  // Per-request deps: the Fastify request id becomes the event `trace_id`, so an
  // outbox envelope can be traced back to the HTTP call that produced it.
  const withTrace = (traceId: string): UseCaseDeps => ({ ...deps, traceId });

  // --- ops -----------------------------------------------------------------

  // Readiness, per the contract's /health schema. `degraded` when no order-engine
  // adapter is wired: reads and writes work, but a handover cannot succeed, and
  // reporting `ok` in that state would hide the one thing Phase 04 exists to do.
  app.get("/health", async (_request, reply) => {
    return reply.status(200).send({
      status: health.orderIntake === "configured" ? "ok" : "degraded",
      service: "customers-service",
      persistence: health.persistence,
      order_intake: health.orderIntake,
    });
  });

  // --- profile -------------------------------------------------------------

  app.get("/customers/:waslaPublicId/profile", async (request, reply) => {
    const { waslaPublicId } = request.params as { waslaPublicId: string };
    const profile = await getCustomerProfile(deps, { waslaPublicId });
    return reply.status(200).send(toCustomerProfileDto(profile));
  });

  app.put("/customers/:waslaPublicId/profile", async (request, reply) => {
    const { waslaPublicId } = request.params as { waslaPublicId: string };
    const result = await upsertCustomerProfile(withTrace(request.id), {
      waslaPublicId,
      patch: toProfilePatch(request.body),
    });
    return reply
      .status(result.created ? 201 : 200)
      .send(toCustomerProfileDto(result.profile));
  });

  // --- saved places --------------------------------------------------------

  app.get("/customers/:waslaPublicId/places", async (request, reply) => {
    const { waslaPublicId } = request.params as { waslaPublicId: string };
    const places = await listSavedPlaces(deps, { waslaPublicId });
    const zones = await resolveZones(
      deps.geography,
      places.map((place) => place.zoneId),
    );
    const paths = new Map(zones.map((zone) => [zone.zoneId, zone.path ?? null]));
    return reply.status(200).send({
      items: places.map((place) =>
        toSavedPlaceDto(place, paths.get(place.zoneId) ?? null),
      ),
      limit: SAVED_PLACES_LIMIT,
    });
  });

  app.post("/customers/:waslaPublicId/places", async (request, reply) => {
    const { waslaPublicId } = request.params as { waslaPublicId: string };
    const idempotencyKey = requireIdempotencyKey(
      request.headers["idempotency-key"],
    );
    const result = await savePlace(withTrace(request.id), {
      waslaPublicId,
      idempotencyKey,
      draft: toSavedPlaceDraft(request.body),
    });
    const zones = await resolveZones(deps.geography, [result.place.zoneId]);
    return reply
      .status(result.replayed ? 200 : 201)
      .send(toSavedPlaceDto(result.place, zones[0]?.path ?? null));
  });

  // 204 with no body. Deleting an already-deleted place is a 404 rather than a
  // silent success: the customer asked to remove something that is not theirs or
  // no longer exists, and owner-scoped reads answer 404 not 403 (ADR-009).
  app.delete(
    "/customers/:waslaPublicId/places/:placeId",
    async (request, reply) => {
      const { waslaPublicId, placeId } = request.params as {
        waslaPublicId: string;
        placeId: string;
      };
      await removeSavedPlace(withTrace(request.id), { waslaPublicId, placeId });
      return reply.status(204).send();
    },
  );

  // --- order requests ------------------------------------------------------

  // Preview writes nothing and calls no engine: same validation, no side effect.
  app.post(
    "/customers/:waslaPublicId/order-requests/preview",
    async (request, reply) => {
      const { waslaPublicId } = request.params as { waslaPublicId: string };
      const preview = await previewOrderRequest(deps, {
        waslaPublicId,
        draft: toOrderRequestDraft(request.body),
      });
      return reply.status(200).send(toOrderRequestPreviewDto(preview));
    },
  );

  app.get("/customers/:waslaPublicId/order-requests", async (request, reply) => {
    const { waslaPublicId } = request.params as { waslaPublicId: string };
    const limit = toListLimit((request.query as { limit?: unknown }).limit);
    const requests = await listOrderRequests(deps, {
      waslaPublicId,
      ...(limit === undefined ? {} : { limit }),
    });
    const zones = await resolveZones(
      deps.geography,
      requests.flatMap((item) => item.stops.map((stop) => stop.zoneId)),
    );
    return reply.status(200).send({
      items: requests.map((item) => toOrderRequestDto(item, zones)),
    });
  });

  // A failed handover throws CUSTOMER_ORDER_INTAKE_UNAVAILABLE (503) *after* the
  // request row and its failure event were written, so the customer sees an error
  // and the request is still visible in the list — fail-closed, not fail-silent.
  app.post("/customers/:waslaPublicId/order-requests", async (request, reply) => {
    const { waslaPublicId } = request.params as { waslaPublicId: string };
    const idempotencyKey = requireIdempotencyKey(
      request.headers["idempotency-key"],
    );
    const result = await submitOrderRequest(withTrace(request.id), {
      waslaPublicId,
      idempotencyKey,
      draft: toOrderRequestDraft(request.body),
    });
    const zones = await resolveZones(
      deps.geography,
      result.orderRequest.stops.map((stop) => stop.zoneId),
    );
    return reply
      .status(result.replayed ? 200 : 201)
      .send(toOrderRequestDto(result.orderRequest, zones));
  });

  app.get(
    "/customers/:waslaPublicId/order-requests/:orderRequestId",
    async (request, reply) => {
      const { waslaPublicId, orderRequestId } = request.params as {
        waslaPublicId: string;
        orderRequestId: string;
      };
      const orderRequest = await getOrderRequest(deps, {
        waslaPublicId,
        orderRequestId,
      });
      const zones = await resolveZones(
        deps.geography,
        orderRequest.stops.map((stop) => stop.zoneId),
      );
      return reply.status(200).send(toOrderRequestDto(orderRequest, zones));
    },
  );

  return app;
}
