/**
 * In-memory adapters for the Geography domain.
 *
 * Used by unit tests (and the future Fastify layer's app.inject tests in MR 5).
 * They enforce the same constraints as schema.sql so use-case behavior is
 * identical to the Postgres-backed repository (added in MR 4).
 *
 * The Saudi fixture here is TypeScript test data (fixed UUIDs + ar/en/ur names,
 * including a missing-translation case to exercise locale fallback). The SQL
 * seed for Postgres arrives separately in MR 4 (contracts/seeds/saudi-arabia.sql);
 * both should stay in sync as the canonical Saudi hierarchy.
 */

import { randomUUID } from "node:crypto";

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
  GeoLevel,
} from "../domain/model.js";
import type {
  Clock,
  IdGenerator,
  IdentityLookupPort,
  Outbox,
  GeographyRepository,
  SetUserLocationInput,
  RecordHistoryInput,
  WithNames,
  ZoneDetailRecord,
} from "../ports.js";

// ---------------------------------------------------------------------------
// Shared infrastructure primitives
// ---------------------------------------------------------------------------

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class CryptoIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}

export class InMemoryOutbox implements Outbox {
  private readonly events: GeographyEvent[] = [];
  async append(event: GeographyEvent): Promise<void> {
    this.events.push(event);
  }
  async unread(): Promise<GeographyEvent[]> {
    return [...this.events];
  }
  /** Test helper: drain and return all appended events. */
  drain(): GeographyEvent[] {
    const out = [...this.events];
    this.events.length = 0;
    return out;
  }
}

/**
 * In-process identity lookup. Without a `knownIds` set it assumes every
 * (format-valid) identity exists — the production adapter (MR 5) calls the
 * identity service over HTTP. Pass a `knownIds` set to simulate missing
 * identities for the GEO_IDENTITY_NOT_FOUND failure path.
 */
export class InMemoryIdentityLookupPort implements IdentityLookupPort {
  private readonly known: Set<string> | null;
  constructor(knownIds?: Iterable<string>) {
    this.known = knownIds ? new Set(knownIds) : null;
  }
  async identityExists(waslaPublicId: string): Promise<boolean> {
    return this.known === null ? true : this.known.has(waslaPublicId);
  }
}

// ---------------------------------------------------------------------------
// Saudi fixture (fixed UUIDs so tests can reference entities directly)
// ---------------------------------------------------------------------------

/** Fixed UUIDs for the Saudi test fixture. */
export const SAUDI_FIXTURE_IDS = {
  country: "11111111-1111-1111-1111-111111111111",
  region: "22222222-2222-2222-2222-222222222222",
  city: "33333333-3333-3333-3333-333333333333",
  districtAlHara: "44444444-4444-4444-4444-444444444444",
  districtQuba: "55555555-5555-5555-5555-555555555555",
  zoneHaraEast: "66666666-6666-6666-6666-666666666666",
  zoneQubaNorth: "77777777-7777-7777-7777-777777777777",
} as const;

interface SeedCountry {
  entity: Country;
  names: LocalizedName;
}
interface SeedRegion {
  entity: Region;
  names: LocalizedName;
}
interface SeedCity {
  entity: City;
  names: LocalizedName;
}
interface SeedDistrict {
  entity: District;
  names: LocalizedName;
}
interface SeedZone {
  entity: Zone;
  names: LocalizedName;
}

/** The Saudi fixture: Country SA → Madinah region → Madinah city → 2 districts → 2 zones. */
export function saudiFixture(): {
  countries: SeedCountry[];
  regions: SeedRegion[];
  cities: SeedCity[];
  districts: SeedDistrict[];
  zones: SeedZone[];
} {
  const I = SAUDI_FIXTURE_IDS;
  return {
    countries: [
      {
        entity: { id: I.country, code: "SA", iso3: "SAU", status: "active", version: 1 },
        names: { ar: "المملكة العربية السعودية", en: "Saudi Arabia", ur: "سعودی عرب" },
      },
    ],
    regions: [
      {
        entity: { id: I.region, countryId: I.country, code: "MD", status: "active", version: 1 },
        names: { ar: "منطقة المدينة", en: "Madinah Region", ur: "مدینہ علاقہ" },
      },
    ],
    cities: [
      {
        entity: { id: I.city, regionId: I.region, code: "MAD", status: "active", version: 1 },
        names: { ar: "المدينة المنورة", en: "Madinah", ur: "مدینہ منورہ" },
      },
    ],
    districts: [
      {
        entity: { id: I.districtAlHara, cityId: I.city, code: "HRA", status: "active", version: 1 },
        names: { ar: "حي الحرة", en: "Al-Hara District", ur: null },
      },
      {
        entity: { id: I.districtQuba, cityId: I.city, code: "QBA", status: "active", version: 1 },
        names: { ar: "حي قباء", en: "Quba District", ur: "قباء" },
      },
    ],
    zones: [
      {
        // en + ur deliberately null → exercises locale fallback to `ar`.
        entity: { id: I.zoneHaraEast, districtId: I.districtAlHara, code: "HRE", status: "active", version: 1 },
        names: { ar: "الحرة الشرقية", en: null, ur: null },
      },
      {
        entity: { id: I.zoneQubaNorth, districtId: I.districtQuba, code: "QBN", status: "active", version: 1 },
        names: { ar: "قباء الشمالية", en: "Quba North", ur: "قباء شمالی" },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// In-memory repository
// ---------------------------------------------------------------------------

export class InMemoryGeographyRepository implements GeographyRepository {
  private countries = new Map<string, Country>();
  private regions = new Map<string, Region>();
  private cities = new Map<string, City>();
  private districts = new Map<string, District>();
  private zones = new Map<string, Zone>();
  private names = new Map<string, LocalizedName>(); // key = `${level}:${entityId}`
  private locations = new Map<string, UserLocationAssignment>();
  private history: UserLocationHistoryEntry[] = [];
  private historySeq = 0;

  constructor() {
    this.seed();
  }

  private nameKey(level: GeoLevel, entityId: string): string {
    return `${level}:${entityId}`;
  }

  private seed(): void {
    const f = saudiFixture();
    for (const c of f.countries) {
      this.countries.set(c.entity.id, c.entity);
      this.names.set(this.nameKey("country", c.entity.id), c.names);
    }
    for (const r of f.regions) {
      this.regions.set(r.entity.id, r.entity);
      this.names.set(this.nameKey("region", r.entity.id), r.names);
    }
    for (const c of f.cities) {
      this.cities.set(c.entity.id, c.entity);
      this.names.set(this.nameKey("city", c.entity.id), c.names);
    }
    for (const d of f.districts) {
      this.districts.set(d.entity.id, d.entity);
      this.names.set(this.nameKey("district", d.entity.id), d.names);
    }
    for (const z of f.zones) {
      this.zones.set(z.entity.id, z.entity);
      this.names.set(this.nameKey("zone", z.entity.id), z.names);
    }
  }

  private namesOf(level: GeoLevel, entityId: string): LocalizedName {
    const n = this.names.get(this.nameKey(level, entityId));
    if (!n) throw new Error(`no names for ${level} ${entityId}`);
    return n;
  }

  async listCountries(): Promise<WithNames<Country>[]> {
    return [...this.countries.values()].map((entity) => ({
      ...entity,
      names: this.namesOf("country", entity.id),
    }));
  }

  async listRegions(countryId: string): Promise<WithNames<Region>[]> {
    return [...this.regions.values()]
      .filter((r) => r.countryId === countryId)
      .map((entity) => ({
        ...entity,
        names: this.namesOf("region", entity.id),
      }));
  }

  async listCities(regionId: string): Promise<WithNames<City>[]> {
    return [...this.cities.values()]
      .filter((c) => c.regionId === regionId)
      .map((entity) => ({
        ...entity,
        names: this.namesOf("city", entity.id),
      }));
  }

  async listDistricts(cityId: string): Promise<WithNames<District>[]> {
    return [...this.districts.values()]
      .filter((d) => d.cityId === cityId)
      .map((entity) => ({
        ...entity,
        names: this.namesOf("district", entity.id),
      }));
  }

  async listZones(districtId: string): Promise<WithNames<Zone>[]> {
    return [...this.zones.values()]
      .filter((z) => z.districtId === districtId)
      .map((entity) => ({
        ...entity,
        names: this.namesOf("zone", entity.id),
      }));
  }

  async findZone(zoneId: string): Promise<WithNames<Zone> | null> {
    const entity = this.zones.get(zoneId);
    if (!entity) return null;
    return { ...entity, names: this.namesOf("zone", entity.id) };
  }

  async findRegion(regionId: string): Promise<WithNames<Region> | null> {
    const entity = this.regions.get(regionId);
    if (!entity) return null;
    return { ...entity, names: this.namesOf("region", entity.id) };
  }

  async findCity(cityId: string): Promise<WithNames<City> | null> {
    const entity = this.cities.get(cityId);
    if (!entity) return null;
    return { ...entity, names: this.namesOf("city", entity.id) };
  }

  async findDistrict(districtId: string): Promise<WithNames<District> | null> {
    const entity = this.districts.get(districtId);
    if (!entity) return null;
    return { ...entity, names: this.namesOf("district", entity.id) };
  }

  async getZoneDetail(zoneId: string): Promise<ZoneDetailRecord | null> {
    const zone = this.zones.get(zoneId);
    if (!zone) return null;
    const district = this.districts.get(zone.districtId);
    if (!district) return null;
    const city = this.cities.get(district.cityId);
    if (!city) return null;
    const region = this.regions.get(city.regionId);
    if (!region) return null;
    const country = this.countries.get(region.countryId);
    if (!country) return null;
    return {
      zone: { ...zone, names: this.namesOf("zone", zone.id) },
      path: {
        country: { ...country, names: this.namesOf("country", country.id) },
        region: { ...region, names: this.namesOf("region", region.id) },
        city: { ...city, names: this.namesOf("city", city.id) },
        district: { ...district, names: this.namesOf("district", district.id) },
      },
    };
  }

  async findUserLocation(
    waslaPublicId: string,
  ): Promise<UserLocationAssignment | null> {
    return this.locations.get(waslaPublicId) ?? null;
  }

  async setUserLocation(
    input: SetUserLocationInput,
  ): Promise<UserLocationAssignment> {
    const existing = this.locations.get(input.waslaPublicId);
    const version = existing ? existing.version + 1 : 1;
    const assignment: UserLocationAssignment = {
      waslaPublicId: input.waslaPublicId,
      zoneId: input.zoneId,
      source: input.source,
      effectiveAt: input.effectiveAt,
      version,
    };
    this.locations.set(input.waslaPublicId, assignment);
    return assignment;
  }

  async recordUserLocationHistory(
    input: RecordHistoryInput,
  ): Promise<UserLocationHistoryEntry> {
    const entry: UserLocationHistoryEntry = {
      id: ++this.historySeq,
      waslaPublicId: input.waslaPublicId,
      oldZoneId: input.oldZoneId,
      newZoneId: input.newZoneId,
      changedAt: input.changedAt,
      source: input.source,
    };
    this.history.push(entry);
    return entry;
  }

  async listUserLocationHistory(
    waslaPublicId: string,
  ): Promise<UserLocationHistoryEntry[]> {
    return this.history
      .filter((h) => h.waslaPublicId === waslaPublicId)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }
}

/** Build the default in-memory geography deps for tests / bootstrap. */
export function createInMemoryGeographyDeps(overrides?: {
  identityLookup?: IdentityLookupPort;
}) {
  const repo = new InMemoryGeographyRepository();
  return {
    repo,
    outbox: new InMemoryOutbox(),
    clock: new SystemClock(),
    idGen: new CryptoIdGenerator(),
    identityLookup: overrides?.identityLookup ?? new InMemoryIdentityLookupPort(),
  };
}

// Re-export the source type so consumers don't need a separate import.
export type { LocationSource };
