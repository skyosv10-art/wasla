/**
 * Geography domain model — internal entities mirroring the data contract
 * (services/geography/contracts/schema.sql). These are persistence-agnostic
 * domain entities in camelCase; the repository port (../ports) abstracts how
 * they're stored. The API DTO shapes (snake_case) come from
 * @wasla/contracts-geography; use-case mappers convert between them.
 */

/** Geo entity status (schema.sql status CHECK constraint). */
export type GeoStatus = "active" | "inactive";

/** Source of a user-location change (matches events.json + OpenAPI enum). */
export type LocationSource =
  | "customer_bot"
  | "driver_bot"
  | "partner_bot"
  | "admin"
  | "system";

/** Supported locale (ar = default/fallback, en, ur). */
export type Locale = "ar" | "en" | "ur";

/** Hierarchy level — used to key localized names per entity type. */
export type GeoLevel = "country" | "region" | "city" | "district" | "zone";

/**
 * A localized name across all supported locales. `ar` is required (it is the
 * fallback when a requested locale is missing a name).
 */
export interface LocalizedName {
  ar: string;
  en: string | null;
  ur: string | null;
}

/** A country (geo_countries row). */
export interface Country {
  readonly id: string;
  readonly code: string;
  readonly iso3: string | null;
  readonly status: GeoStatus;
  readonly version: number;
}

/** A region within a country (geo_regions row). */
export interface Region {
  readonly id: string;
  readonly countryId: string;
  readonly code: string;
  readonly status: GeoStatus;
  readonly version: number;
}

/** A city within a region (geo_cities row). */
export interface City {
  readonly id: string;
  readonly regionId: string;
  readonly code: string;
  readonly status: GeoStatus;
  readonly version: number;
}

/** A district within a city (geo_districts row). */
export interface District {
  readonly id: string;
  readonly cityId: string;
  readonly code: string;
  readonly status: GeoStatus;
  readonly version: number;
}

/** A zone within a district (geo_zones row). */
export interface Zone {
  readonly id: string;
  readonly districtId: string;
  readonly code: string;
  readonly status: GeoStatus;
  readonly version: number;
}

/** A localized name row for a geo entity (geo_*_names rows). */
export interface GeoName {
  readonly level: GeoLevel;
  readonly entityId: string;
  readonly locale: Locale;
  readonly name: string;
}

/** The current location assignment for a user (geo_user_locations row). */
export interface UserLocationAssignment {
  readonly waslaPublicId: string;
  readonly zoneId: string;
  readonly source: LocationSource;
  readonly effectiveAt: string;
  /** Optimistic concurrency version. */
  readonly version: number;
}

/** A user-location change history row (geo_user_location_history row). */
export interface UserLocationHistoryEntry {
  readonly id: number;
  readonly waslaPublicId: string;
  readonly oldZoneId: string | null;
  readonly newZoneId: string;
  readonly changedAt: string;
  readonly source: LocationSource;
}
