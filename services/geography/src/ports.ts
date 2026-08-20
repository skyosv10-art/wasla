/**
 * Ports (hexagonal boundaries) for the Geography domain.
 *
 * Use cases depend only on these interfaces. Concrete adapters live in
 * ./infrastructure (in-memory, for unit tests) and will be added in later
 * MRs (Drizzle/Postgres repository in MR 4, Fastify HTTP layer in MR 5).
 *
 * Locale policy (ADR-006): repository methods return each entity paired with
 * its full LocalizedName (all locales). The use-case layer applies the locale
 * fallback (resolveLocalizedName) so the in-memory and Drizzle adapters behave
 * identically — the fallback rule lives in the domain, not per-adapter.
 */

import type { GeographyEvent } from "@wasla/contracts-geography";

import type {
  Country,
  Region,
  City,
  District,
  Zone,
  LocalizedName,
  UserLocationAssignment,
  UserLocationHistoryEntry,
  LocationSource,
} from "./domain/model.js";

/** Wall-clock time as ISO-8601 string. */
export interface Clock {
  now(): string;
}

/** UUID generator (for event_id). */
export interface IdGenerator {
  uuid(): string;
}

/** An entity paired with its full set of localized names. */
export type WithNames<T> = T & { readonly names: LocalizedName };

/** A zone with its full parent path, each level carrying localized names. */
export interface ZoneDetailRecord {
  readonly zone: WithNames<Zone>;
  readonly path: {
    readonly country: WithNames<Country>;
    readonly region: WithNames<Region>;
    readonly city: WithNames<City>;
    readonly district: WithNames<District>;
  };
}

/** Input for upserting a user's location assignment. */
export interface SetUserLocationInput {
  readonly waslaPublicId: string;
  readonly zoneId: string;
  readonly source: LocationSource;
  readonly effectiveAt: string;
}

/** Input for recording a user-location change history entry. */
export interface RecordHistoryInput {
  readonly waslaPublicId: string;
  readonly oldZoneId: string | null;
  readonly newZoneId: string;
  readonly changedAt: string;
  readonly source: LocationSource;
}

/**
 * Geography repository port — the source of truth for the geo hierarchy,
 * localized names, user locations and history. Implementations must enforce
 * the schema.sql UNIQUE constraints (e.g. one location per wasla_public_id).
 */
export interface GeographyRepository {
  // --- hierarchy (each entity carries its localized names) ---
  listCountries(): Promise<WithNames<Country>[]>;
  listRegions(countryId: string): Promise<WithNames<Region>[]>;
  listCities(regionId: string): Promise<WithNames<City>[]>;
  listDistricts(cityId: string): Promise<WithNames<District>[]>;
  listZones(districtId: string): Promise<WithNames<Zone>[]>;
  findRegion(regionId: string): Promise<WithNames<Region> | null>;
  findCity(cityId: string): Promise<WithNames<City> | null>;
  findDistrict(districtId: string): Promise<WithNames<District> | null>;
  findZone(zoneId: string): Promise<WithNames<Zone> | null>;
  /** A zone with its full parent path + localized names, or null. */
  getZoneDetail(zoneId: string): Promise<ZoneDetailRecord | null>;

  // --- user location ---
  /** The current location assignment for a user, or null if none set. */
  findUserLocation(waslaPublicId: string): Promise<UserLocationAssignment | null>;
  /** Upsert a user's location (creates or updates; increments version). */
  setUserLocation(input: SetUserLocationInput): Promise<UserLocationAssignment>;
  /** Append a user-location change history entry. */
  recordUserLocationHistory(
    input: RecordHistoryInput,
  ): Promise<UserLocationHistoryEntry>;
  /** List a user's location change history (oldest first). */
  listUserLocationHistory(
    waslaPublicId: string,
  ): Promise<UserLocationHistoryEntry[]>;
}

/**
 * Cross-service identity lookup. Geography stores wasla_public_id as an opaque
 * reference (no FK to identity_users); this port validates that the referenced
 * identity exists before assigning a location, without coupling to identity
 * internals. Production: HTTP to the identity service; tests: in-process fake.
 */
export interface IdentityLookupPort {
  identityExists(waslaPublicId: string): Promise<boolean>;
}

/**
 * Domain event outbox. Use cases append events here within the same logical
 * operation; a relay (later MR) publishes them to Kafka. Kept separate from
 * the repository so the domain owns event ordering without coupling to a broker.
 */
export interface Outbox {
  append(event: GeographyEvent): Promise<void>;
  /** Read appended (unpublished) events — used by tests and the future relay. */
  unread(): Promise<GeographyEvent[]>;
}
