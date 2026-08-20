/**
 * @wasla/contracts-geography
 *
 * Typed Geography & Localization contracts:
 *  - API types generated from the OpenAPI source-of-truth via `openapi-typescript`.
 *  - Event types hand-derived from the JSON Schema Event Contract (events.json).
 *
 * These are Contract First artifacts (ADR-004) — NOT a runtime implementation.
 * Consumers (geography service, future services) import these types to stay
 * aligned with the published Geography API + Event contracts.
 *
 * Regenerate API types: pnpm --filter @wasla/contracts-geography generate
 */

export type * from "./api-types.js";
export type * from "./events-types.js";
export { GEOGRAPHY_EVENT_TYPES } from "./events-types.js";

// --- Shared primitives ------------------------------------------------
export type SupportedLocale = "ar" | "en" | "ur";

/** Direction metadata for RTL/LTR rendering. ar and ur are RTL; en is LTR. */
export const LOCALE_DIRECTION: Record<SupportedLocale, "rtl" | "ltr"> = {
  ar: "rtl",
  en: "ltr",
  ur: "rtl",
};

/** The default/fallback locale when a requested locale is missing a name. */
export const DEFAULT_LOCALE: SupportedLocale = "ar";

// --- API contract types (from OpenAPI) --------------------------------
import type { paths, components } from "./api-types.js";

/** All API paths and their operations. */
export type { paths };

/** A country in the geography hierarchy. */
export type Country = components["schemas"]["Country"];

/** A region within a country. */
export type Region = components["schemas"]["Region"];

/** A city within a region. */
export type City = components["schemas"]["City"];

/** A district within a city. */
export type District = components["schemas"]["District"];

/** A zone within a district. */
export type Zone = components["schemas"]["Zone"];

/** A zone with its full hierarchy path (localized). */
export type ZoneDetail = components["schemas"]["ZoneDetail"];

/** The current location of a user. */
export type UserLocation = components["schemas"]["UserLocation"];

/** Request body for setting/updating a user's location. */
export type SetUserLocationRequest = components["schemas"]["SetUserLocationRequest"];

/** A single user-location change history entry. */
export type UserLocationHistoryEntry =
  components["schemas"]["UserLocationHistoryEntry"];

/** A localized name across supported locales (ar required as fallback). */
export type LocalizedName = components["schemas"]["LocalizedName"];

// --- Event contract types (from events.json) --------------------------
import type {
  EventEnvelope,
  UserLocationSetV1,
  UserLocationChangedV1,
  GeographyEvent,
  GeographyEventType,
  GeographyEventByType,
} from "./events-types.js";

export type {
  EventEnvelope,
  UserLocationSetV1,
  UserLocationChangedV1,
  GeographyEvent,
  GeographyEventType,
  GeographyEventByType,
};
