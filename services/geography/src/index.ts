/**
 * @wasla/geography-service — WASLA Geography & Localization domain core (Phase 02).
 *
 * Pure domain model, ports, in-memory adapters and use cases. Contract-First:
 * the API DTO and event types come from @wasla/contracts-geography (the
 * OpenAPI + JSON Schema source of truth). No HTTP or persistence runtime is
 * included here — Fastify (MR 5) and Drizzle/Postgres (MR 4) adapters arrive
 * in later MRs.
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
