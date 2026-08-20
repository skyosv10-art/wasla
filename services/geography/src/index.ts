/**
 * @wasla/geography-service — WASLA Geography & Localization domain core (Phase 02).
 *
 * Domain model, ports, in-memory adapters, use cases, persistence and the HTTP
 * layer. Contract-First: the API DTO and event types come from
 * @wasla/contracts-geography (the OpenAPI + JSON Schema source of truth).
 * Adapters: Drizzle/Postgres persistence (MR 4) and the Fastify HTTP layer
 * (MR 5) are wired through the same ports.
 *
 * Phase 02 Exit Gate: "a user changes their location without creating a new
 * account, and every module uses Geo IDs + i18n (AR/EN/UR)" — covered by
 * setUserLocation + getUserLocationHistory + locale fallback + tests.
 */

export * from "./domain/model.js";
export * from "./domain/errors.js";
export * from "./domain/locale.js";
export * from "./domain/events.js";
export * from "./ports.js";
export * from "./infrastructure/in-memory.js";
export * from "./infrastructure/http-identity-lookup.js";

// Postgres adapters (MR 4). Imported lazily by the composition root; unit
// tests use the in-memory adapters and never touch pg/drizzle at runtime.
export * from "./infrastructure/drizzle/db.js";
export * from "./infrastructure/drizzle/schema.js";
export {
  PostgresGeographyRepository,
  PostgresOutbox,
} from "./infrastructure/drizzle/repository.js";

export type { UseCaseDeps, UseCaseLocale } from "./use-cases/deps.js";
export {
  listCountries,
  listRegions,
  listCities,
  listDistricts,
  listZones,
  getZone,
} from "./use-cases/list-hierarchy.js";
export { getUserLocation } from "./use-cases/get-user-location.js";
export type { GetUserLocationInput } from "./use-cases/get-user-location.js";
export { setUserLocation } from "./use-cases/set-user-location.js";
export type {
  SetUserLocationInput,
  SetUserLocationResult,
} from "./use-cases/set-user-location.js";
export { getUserLocationHistory } from "./use-cases/get-user-location-history.js";
export type { GetUserLocationHistoryInput } from "./use-cases/get-user-location-history.js";

// HTTP layer (MR 5). The Fastify app factory + contract error mapping. The
// bootstrap (src/http/server.ts) is intentionally not exported — it is an
// executable entrypoint, not a library surface.
export { createGeographyApp } from "./http/app.js";
export type { CreateGeographyAppOptions } from "./http/app.js";
export { sendGeographyError } from "./http/errors.js";
export type { GeographyErrorBody } from "./http/errors.js";
