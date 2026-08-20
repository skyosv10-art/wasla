/**
 * Fastify HTTP app factory for the Geography & Localization service (MR 5).
 *
 * Wires the 9 contract endpoints (services/geography/contracts/api.openapi.yml)
 * to the use cases. The factory takes the shared UseCaseDeps (hexagonal wiring)
 * so tests inject in-memory adapters while the bootstrap (server.ts) wires the
 * Drizzle/Postgres adapters.
 *
 * Contract-First: request/response shapes come from @wasla/contracts-geography.
 * Domain validation lives in the use cases (they throw stable error codes);
 * this layer only validates request shape (locale + PUT body) and throws the
 * stable validation codes GEO_UNSUPPORTED_LOCALE / GEO_INVALID_REQUEST_BODY.
 *
 * Routes (per the OpenAPI contract):
 *   GET  /health                                     (liveness, not in contract)
 *   GET  /geo/countries
 *   GET  /geo/countries/:countryId/regions
 *   GET  /geo/regions/:regionId/cities
 *   GET  /geo/cities/:cityId/districts
 *   GET  /geo/districts/:districtId/zones
 *   GET  /geo/zones/:zoneId
 *   GET  /geo/users/:waslaPublicId/location
 *   PUT  /geo/users/:waslaPublicId/location
 *   GET  /geo/users/:waslaPublicId/location/history
 */

import Fastify, { type FastifyInstance } from "fastify";

import type { SetUserLocationRequest } from "@wasla/contracts-geography";

import { GeographyError } from "../domain/errors.js";
import type { UseCaseDeps, UseCaseLocale } from "../use-cases/deps.js";
import {
  listCountries,
  listRegions,
  listCities,
  listDistricts,
  listZones,
  getZone,
} from "../use-cases/list-hierarchy.js";
import { getUserLocation } from "../use-cases/get-user-location.js";
import { getUserLocationHistory } from "../use-cases/get-user-location-history.js";
import { setUserLocation } from "../use-cases/set-user-location.js";

import { sendGeographyError } from "./errors.js";

/** Supported locales (ar = default/fallback per ADR-006). */
const SUPPORTED_LOCALES: readonly UseCaseLocale[] = ["ar", "en", "ur"];

/** Allowed `source` values (OpenAPI SetUserLocationRequest.source enum). */
const ALLOWED_SOURCES: readonly SetUserLocationRequest["source"][] = [
  "customer_bot",
  "driver_bot",
  "partner_bot",
  "admin",
  "system",
];

export interface CreateGeographyAppOptions {
  deps: UseCaseDeps;
  /** Enable Fastify's request logger (pino). Off by default for tests. */
  logger?: boolean;
}

/**
 * Parse the `locale` query parameter. Missing → `ar` (default). Anything
 * outside ar/en/ur → GEO_UNSUPPORTED_LOCALE (400), per errors.md.
 */
function parseLocale(raw: unknown): UseCaseLocale {
  if (raw === undefined || raw === null || raw === "") {
    return "ar";
  }
  if (
    typeof raw === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(raw)
  ) {
    return raw as UseCaseLocale;
  }
  throw new GeographyError(
    "GEO_UNSUPPORTED_LOCALE",
    `locale '${String(raw)}' is not supported (expected one of ar, en, ur)`,
  );
}

/**
 * Validate the PUT body shape before handing it to the use case. Only the
 * request *shape* is checked here: existence of the zone and the identity is
 * the use case's job (it owns the stable not-found codes).
 */
function parseSetLocationBody(raw: unknown): SetUserLocationRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new GeographyError(
      "GEO_INVALID_REQUEST_BODY",
      "request body must be a JSON object with zone_id and source",
    );
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.zone_id !== "string" || body.zone_id.length === 0) {
    throw new GeographyError(
      "GEO_INVALID_REQUEST_BODY",
      "zone_id is required and must be a non-empty string",
    );
  }
  if (
    typeof body.source !== "string" ||
    !(ALLOWED_SOURCES as readonly string[]).includes(body.source)
  ) {
    throw new GeographyError(
      "GEO_INVALID_REQUEST_BODY",
      `source is required and must be one of ${ALLOWED_SOURCES.join(", ")}`,
    );
  }

  return {
    zone_id: body.zone_id,
    source: body.source as SetUserLocationRequest["source"],
  };
}

/** Build the Geography Fastify app without starting to listen. */
export function createGeographyApp(
  options: CreateGeographyAppOptions,
): FastifyInstance {
  const { deps } = options;
  const app = Fastify({ logger: options.logger ?? false });

  app.setErrorHandler((error, request, reply) => {
    sendGeographyError(reply, error, request.id);
  });

  // Per-request deps: propagate the Fastify request id as the event trace_id so
  // outbox envelopes are correlated with the HTTP request (Observability DoD).
  const withTrace = (traceId: string): UseCaseDeps => ({ ...deps, traceId });

  // GET /health — liveness probe (not part of the contract API surface).
  app.get("/health", async (_request, reply) => {
    return reply.status(200).send({ status: "ok" });
  });

  // --- hierarchy -----------------------------------------------------------

  app.get("/geo/countries", async (request, reply) => {
    const locale = parseLocale((request.query as { locale?: string }).locale);
    const countries = await listCountries(deps, locale);
    return reply.status(200).send(countries);
  });

  app.get("/geo/countries/:countryId/regions", async (request, reply) => {
    const { countryId } = request.params as { countryId: string };
    const locale = parseLocale((request.query as { locale?: string }).locale);
    const regions = await listRegions(deps, countryId, locale);
    return reply.status(200).send(regions);
  });

  app.get("/geo/regions/:regionId/cities", async (request, reply) => {
    const { regionId } = request.params as { regionId: string };
    const locale = parseLocale((request.query as { locale?: string }).locale);
    const cities = await listCities(deps, regionId, locale);
    return reply.status(200).send(cities);
  });

  app.get("/geo/cities/:cityId/districts", async (request, reply) => {
    const { cityId } = request.params as { cityId: string };
    const locale = parseLocale((request.query as { locale?: string }).locale);
    const districts = await listDistricts(deps, cityId, locale);
    return reply.status(200).send(districts);
  });

  app.get("/geo/districts/:districtId/zones", async (request, reply) => {
    const { districtId } = request.params as { districtId: string };
    const locale = parseLocale((request.query as { locale?: string }).locale);
    const zones = await listZones(deps, districtId, locale);
    return reply.status(200).send(zones);
  });

  app.get("/geo/zones/:zoneId", async (request, reply) => {
    const { zoneId } = request.params as { zoneId: string };
    const locale = parseLocale((request.query as { locale?: string }).locale);
    const zone = await getZone(deps, zoneId, locale);
    return reply.status(200).send(zone);
  });

  // --- user location -------------------------------------------------------

  app.get("/geo/users/:waslaPublicId/location", async (request, reply) => {
    const { waslaPublicId } = request.params as { waslaPublicId: string };
    const locale = parseLocale((request.query as { locale?: string }).locale);
    const location = await getUserLocation(deps, { waslaPublicId, locale });
    return reply.status(200).send(location);
  });

  // PUT → 201 on the first assignment, 200 on a change (or an idempotent
  // re-set of the same zone), per the OpenAPI contract.
  app.put("/geo/users/:waslaPublicId/location", async (request, reply) => {
    const { waslaPublicId } = request.params as { waslaPublicId: string };
    const locale = parseLocale((request.query as { locale?: string }).locale);
    const body = parseSetLocationBody(request.body);
    const result = await setUserLocation(withTrace(request.id), {
      waslaPublicId,
      zoneId: body.zone_id,
      source: body.source,
      locale,
    });
    return reply.status(result.created ? 201 : 200).send(result.location);
  });

  app.get(
    "/geo/users/:waslaPublicId/location/history",
    async (request, reply) => {
      const { waslaPublicId } = request.params as { waslaPublicId: string };
      const locale = parseLocale((request.query as { locale?: string }).locale);
      const history = await getUserLocationHistory(deps, {
        waslaPublicId,
        locale,
      });
      return reply.status(200).send(history);
    },
  );

  return app;
}
