/**
 * Postgres-backed Geography repository + outbox, implementing the ports
 * (../../ports.ts) with drizzle-orm/node-postgres. Enforces schema.sql
 * constraints (PK on geo_user_locations.wasla_public_id; FK zone_id→geo_zones).
 *
 * The canonical DDL is schema.sql (ADR-004/006); this adapter only reads/
 * writes against it. Per ADR-006, the repository returns each entity paired
 * with its full LocalizedName (all locales); the use-case layer applies the
 * locale fallback (resolveLocalizedName) so behavior matches the in-memory
 * adapter.
 */

import { asc, eq, inArray, sql } from "drizzle-orm";

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
  GeoStatus,
  LocationSource,
  GeoLevel,
} from "../../domain/model.js";
import type {
  GeographyRepository,
  Outbox,
  SetUserLocationInput,
  RecordHistoryInput,
  WithNames,
  ZoneDetailRecord,
} from "../../ports.js";

import {
  geoCountries,
  geoRegions,
  geoCities,
  geoDistricts,
  geoZones,
  geoCountryNames,
  geoRegionNames,
  geoCityNames,
  geoDistrictNames,
  geoZoneNames,
  geoUserLocations,
  geoUserLocationHistory,
  geoOutbox,
} from "./schema.js";
import type { Db } from "./db.js";

// --- localized names per level (explicit per-level query; drizzle tables are
//     nominal per-table, so we switch on the level rather than indirecting) ---

interface NameRow {
  entityId: string;
  locale: string;
  name: string;
}

async function loadNames(
  db: Db,
  level: GeoLevel,
  ids: string[],
): Promise<Map<string, LocalizedName>> {
  const out = new Map<string, LocalizedName>();
  if (ids.length === 0) return out;

  let rows: NameRow[];
  switch (level) {
    case "country":
      rows = await db
        .select({ entityId: geoCountryNames.countryId, locale: geoCountryNames.locale, name: geoCountryNames.name })
        .from(geoCountryNames)
        .where(inArray(geoCountryNames.countryId, ids));
      break;
    case "region":
      rows = await db
        .select({ entityId: geoRegionNames.regionId, locale: geoRegionNames.locale, name: geoRegionNames.name })
        .from(geoRegionNames)
        .where(inArray(geoRegionNames.regionId, ids));
      break;
    case "city":
      rows = await db
        .select({ entityId: geoCityNames.cityId, locale: geoCityNames.locale, name: geoCityNames.name })
        .from(geoCityNames)
        .where(inArray(geoCityNames.cityId, ids));
      break;
    case "district":
      rows = await db
        .select({ entityId: geoDistrictNames.districtId, locale: geoDistrictNames.locale, name: geoDistrictNames.name })
        .from(geoDistrictNames)
        .where(inArray(geoDistrictNames.districtId, ids));
      break;
    case "zone":
      rows = await db
        .select({ entityId: geoZoneNames.zoneId, locale: geoZoneNames.locale, name: geoZoneNames.name })
        .from(geoZoneNames)
        .where(inArray(geoZoneNames.zoneId, ids));
      break;
  }

  for (const r of rows!) {
    let entry = out.get(r.entityId);
    if (!entry) {
      entry = { ar: "", en: null, ur: null };
      out.set(r.entityId, entry);
    }
    if (r.locale === "ar") entry.ar = r.name;
    else if (r.locale === "en") entry.en = r.name;
    else if (r.locale === "ur") entry.ur = r.name;
  }
  return out;
}

// --- row → domain mappers (cast text-with-check columns to union types) ---

function mapCountry(row: typeof geoCountries.$inferSelect): Country {
  return {
    id: row.id,
    code: row.code,
    iso3: row.iso3,
    status: row.status as GeoStatus,
    version: row.version,
  };
}

function mapRegion(row: typeof geoRegions.$inferSelect): Region {
  return {
    id: row.id,
    countryId: row.countryId,
    code: row.code,
    status: row.status as GeoStatus,
    version: row.version,
  };
}

function mapCity(row: typeof geoCities.$inferSelect): City {
  return {
    id: row.id,
    regionId: row.regionId,
    code: row.code,
    status: row.status as GeoStatus,
    version: row.version,
  };
}

function mapDistrict(row: typeof geoDistricts.$inferSelect): District {
  return {
    id: row.id,
    cityId: row.cityId,
    code: row.code,
    status: row.status as GeoStatus,
    version: row.version,
  };
}

function mapZone(row: typeof geoZones.$inferSelect): Zone {
  return {
    id: row.id,
    districtId: row.districtId,
    code: row.code,
    status: row.status as GeoStatus,
    version: row.version,
  };
}

// --- repository ---

export class PostgresGeographyRepository implements GeographyRepository {
  constructor(private readonly db: Db) {}

  async listCountries(): Promise<WithNames<Country>[]> {
    const rows = await this.db.select().from(geoCountries).orderBy(geoCountries.code);
    const names = await loadNames(this.db, "country", rows.map((r) => r.id));
    return rows.map((r) => ({ ...mapCountry(r), names: names.get(r.id)! }));
  }

  async listRegions(countryId: string): Promise<WithNames<Region>[]> {
    const rows = await this.db
      .select()
      .from(geoRegions)
      .where(eq(geoRegions.countryId, countryId))
      .orderBy(geoRegions.code);
    const names = await loadNames(this.db, "region", rows.map((r) => r.id));
    return rows.map((r) => ({ ...mapRegion(r), names: names.get(r.id)! }));
  }

  async listCities(regionId: string): Promise<WithNames<City>[]> {
    const rows = await this.db
      .select()
      .from(geoCities)
      .where(eq(geoCities.regionId, regionId))
      .orderBy(geoCities.code);
    const names = await loadNames(this.db, "city", rows.map((r) => r.id));
    return rows.map((r) => ({ ...mapCity(r), names: names.get(r.id)! }));
  }

  async listDistricts(cityId: string): Promise<WithNames<District>[]> {
    const rows = await this.db
      .select()
      .from(geoDistricts)
      .where(eq(geoDistricts.cityId, cityId))
      .orderBy(geoDistricts.code);
    const names = await loadNames(this.db, "district", rows.map((r) => r.id));
    return rows.map((r) => ({ ...mapDistrict(r), names: names.get(r.id)! }));
  }

  async listZones(districtId: string): Promise<WithNames<Zone>[]> {
    const rows = await this.db
      .select()
      .from(geoZones)
      .where(eq(geoZones.districtId, districtId))
      .orderBy(geoZones.code);
    const names = await loadNames(this.db, "zone", rows.map((r) => r.id));
    return rows.map((r) => ({ ...mapZone(r), names: names.get(r.id)! }));
  }

  async findRegion(regionId: string): Promise<WithNames<Region> | null> {
    const rows = await this.db
      .select()
      .from(geoRegions)
      .where(eq(geoRegions.id, regionId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    const names = await loadNames(this.db, "region", [r.id]);
    return { ...mapRegion(r), names: names.get(r.id)! };
  }

  async findCity(cityId: string): Promise<WithNames<City> | null> {
    const rows = await this.db
      .select()
      .from(geoCities)
      .where(eq(geoCities.id, cityId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    const names = await loadNames(this.db, "city", [r.id]);
    return { ...mapCity(r), names: names.get(r.id)! };
  }

  async findDistrict(districtId: string): Promise<WithNames<District> | null> {
    const rows = await this.db
      .select()
      .from(geoDistricts)
      .where(eq(geoDistricts.id, districtId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    const names = await loadNames(this.db, "district", [r.id]);
    return { ...mapDistrict(r), names: names.get(r.id)! };
  }

  async findZone(zoneId: string): Promise<WithNames<Zone> | null> {
    const rows = await this.db
      .select()
      .from(geoZones)
      .where(eq(geoZones.id, zoneId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    const names = await loadNames(this.db, "zone", [r.id]);
    return { ...mapZone(r), names: names.get(r.id)! };
  }

  async getZoneDetail(zoneId: string): Promise<ZoneDetailRecord | null> {
    const zoneRows = await this.db
      .select()
      .from(geoZones)
      .where(eq(geoZones.id, zoneId))
      .limit(1);
    const z = zoneRows[0];
    if (!z) return null;

    const dRows = await this.db
      .select()
      .from(geoDistricts)
      .where(eq(geoDistricts.id, z.districtId))
      .limit(1);
    const d = dRows[0];
    if (!d) return null;

    const cRows = await this.db
      .select()
      .from(geoCities)
      .where(eq(geoCities.id, d.cityId))
      .limit(1);
    const c = cRows[0];
    if (!c) return null;

    const rRows = await this.db
      .select()
      .from(geoRegions)
      .where(eq(geoRegions.id, c.regionId))
      .limit(1);
    const r = rRows[0];
    if (!r) return null;

    const coRows = await this.db
      .select()
      .from(geoCountries)
      .where(eq(geoCountries.id, r.countryId))
      .limit(1);
    const co = coRows[0];
    if (!co) return null;

    const [zoneNames, districtNames, cityNames, regionNames, countryNames] =
      await Promise.all([
        loadNames(this.db, "zone", [z.id]),
        loadNames(this.db, "district", [d.id]),
        loadNames(this.db, "city", [c.id]),
        loadNames(this.db, "region", [r.id]),
        loadNames(this.db, "country", [co.id]),
      ]);

    return {
      zone: { ...mapZone(z), names: zoneNames.get(z.id)! },
      path: {
        country: { ...mapCountry(co), names: countryNames.get(co.id)! },
        region: { ...mapRegion(r), names: regionNames.get(r.id)! },
        city: { ...mapCity(c), names: cityNames.get(c.id)! },
        district: { ...mapDistrict(d), names: districtNames.get(d.id)! },
      },
    };
  }

  async findUserLocation(
    waslaPublicId: string,
  ): Promise<UserLocationAssignment | null> {
    const rows = await this.db
      .select()
      .from(geoUserLocations)
      .where(eq(geoUserLocations.waslaPublicId, waslaPublicId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      waslaPublicId: r.waslaPublicId,
      zoneId: r.zoneId,
      source: r.source as LocationSource,
      effectiveAt: r.effectiveAt.toISOString(),
      version: r.version,
    };
  }

  async setUserLocation(
    input: SetUserLocationInput,
  ): Promise<UserLocationAssignment> {
    // Upsert: insert or, on conflict (wasla_public_id), bump version + update.
    const rows = await this.db
      .insert(geoUserLocations)
      .values({
        waslaPublicId: input.waslaPublicId,
        zoneId: input.zoneId,
        source: input.source,
        effectiveAt: new Date(input.effectiveAt),
      })
      .onConflictDoUpdate({
        target: geoUserLocations.waslaPublicId,
        set: {
          zoneId: input.zoneId,
          source: input.source,
          effectiveAt: new Date(input.effectiveAt),
          version: sql`${geoUserLocations.version} + 1`,
        },
      })
      .returning();
    const r = rows[0]!;
    return {
      waslaPublicId: r.waslaPublicId,
      zoneId: r.zoneId,
      source: r.source as LocationSource,
      effectiveAt: r.effectiveAt.toISOString(),
      version: r.version,
    };
  }

  async recordUserLocationHistory(
    input: RecordHistoryInput,
  ): Promise<UserLocationHistoryEntry> {
    const rows = await this.db
      .insert(geoUserLocationHistory)
      .values({
        waslaPublicId: input.waslaPublicId,
        oldZoneId: input.oldZoneId,
        newZoneId: input.newZoneId,
        source: input.source,
        changedAt: new Date(input.changedAt),
      })
      .returning();
    const r = rows[0]!;
    return {
      id: r.id,
      waslaPublicId: r.waslaPublicId,
      oldZoneId: r.oldZoneId,
      newZoneId: r.newZoneId,
      changedAt: r.changedAt.toISOString(),
      source: r.source as LocationSource,
    };
  }

  async listUserLocationHistory(
    waslaPublicId: string,
  ): Promise<UserLocationHistoryEntry[]> {
    const rows = await this.db
      .select()
      .from(geoUserLocationHistory)
      .where(eq(geoUserLocationHistory.waslaPublicId, waslaPublicId))
      .orderBy(asc(geoUserLocationHistory.id));
    return rows.map((r) => ({
      id: r.id,
      waslaPublicId: r.waslaPublicId,
      oldZoneId: r.oldZoneId,
      newZoneId: r.newZoneId,
      changedAt: r.changedAt.toISOString(),
      source: r.source as LocationSource,
    }));
  }
}

// --- outbox ---

export class PostgresOutbox implements Outbox {
  constructor(private readonly db: Db) {}

  async append(event: GeographyEvent): Promise<void> {
    await this.db.insert(geoOutbox).values({
      eventId: event.event_id,
      eventType: event.event_type,
      eventVersion: event.event_version,
      aggregateId: event.aggregate.id,
      payload: event.payload,
      occurredAt: new Date(event.occurred_at),
    });
  }

  async unread(): Promise<GeographyEvent[]> {
    const rows = await this.db
      .select()
      .from(geoOutbox)
      .where(sql`${geoOutbox.publishedAt} IS NULL`)
      .orderBy(asc(geoOutbox.id));
    // Payload is stored as JSONB; reconstruct the event envelope.
    return rows.map((r) => {
      const payload = r.payload as Record<string, unknown>;
      return {
        event_id: r.eventId,
        event_type: r.eventType,
        event_version: r.eventVersion,
        occurred_at: r.occurredAt.toISOString(),
        producer: "geography-service",
        aggregate: { type: "user", id: r.aggregateId },
        payload,
      } as GeographyEvent;
    });
  }
}
