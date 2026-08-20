/**
 * Postgres integration test for the Geography persistence layer (MR 4).
 *
 * Verifies against a real Postgres: the Saudi seed loads, the hierarchy list
 * use cases return localized rows, locale fallback (ar) works for zones missing
 * en/ur translations, and the setUserLocation → history → outbox flow behaves
 * correctly (create → change → idempotent-same-zone no-op) — all wired through
 * the PostgresGeographyRepository / PostgresOutbox adapters.
 *
 * Excluded from the default `pnpm -r test` (see vitest.config.ts). Run with:
 *   DATABASE_URL=postgres://... pnpm --filter @wasla/geography-service test:integration
 *
 * Skipped entirely when DATABASE_URL is unset (no DB available, e.g. CI before
 * MR 6 wires a GitLab postgres service for geography).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createDb,
  PostgresGeographyRepository,
  PostgresOutbox,
  SystemClock,
  CryptoIdGenerator,
  listCountries,
  listRegions,
  listCities,
  listDistricts,
  listZones,
  getZone,
  setUserLocation,
  getUserLocation,
  getUserLocationHistory,
  type Db,
  type IdentityLookupPort,
  type UseCaseDeps,
} from "../index.js";

const DATABASE_URL = process.env.DATABASE_URL;
// The test runs from the package root (pnpm --filter ... test:integration),
// so resolve the canonical DDL + seed relative to the working directory.
const SCHEMA_SQL_PATH = resolve(process.cwd(), "contracts/schema.sql");
const SEED_SQL_PATH = resolve(process.cwd(), "contracts/seeds/saudi-arabia.sql");

const ENABLED = Boolean(DATABASE_URL);

// Saudi fixture UUIDs (match contracts/seeds/saudi-arabia.sql + in-memory).
const SA = "11111111-1111-1111-1111-111111111111";
const MADINAH_REGION = "22222222-2222-2222-2222-222222222222";
const MADINAH_CITY = "33333333-3333-3333-3333-333333333333";
const AL_HARA = "44444444-4444-4444-4444-444444444444";
const HARA_EAST = "66666666-6666-6666-6666-666666666666";
const QUBA_NORTH = "77777777-7777-7777-7777-777777777777";

const GEO_TABLES =
  "geo_outbox, geo_user_location_history, geo_user_locations, " +
  "geo_zone_names, geo_district_names, geo_city_names, geo_region_names, " +
  "geo_country_names, geo_zones, geo_districts, geo_cities, geo_regions, geo_countries";

describe.skipIf(!ENABLED)("Geography Postgres integration", () => {
  let db: Db;
  let close: () => Promise<void>;
  let deps: UseCaseDeps;

  beforeAll(async () => {
    const { pool, db: d } = createDb({ connectionString: DATABASE_URL! });
    db = d;
    close = () => pool.end();

    // Clean slate + apply the canonical DDL + the Saudi seed.
    await pool.query(`DROP TABLE IF EXISTS ${GEO_TABLES} CASCADE`);
    const schemaSql = await readFile(SCHEMA_SQL_PATH, "utf-8");
    await pool.query(schemaSql);
    const seedSql = await readFile(SEED_SQL_PATH, "utf-8");
    await pool.query(seedSql);

    const repo = new PostgresGeographyRepository(db);
    const outbox = new PostgresOutbox(db);
    const clock = new SystemClock();
    const idGen = new CryptoIdGenerator();
    // Fake identity lookup: every well-formed wasla_public_id "exists".
    // The cross-service wiring against the real identity service is exercised
    // in the Phase 02 Exit Gate E2E (MR 7), not here.
    const identityLookup: IdentityLookupPort = {
      async identityExists() {
        return true;
      },
    };
    deps = { repo, outbox, clock, idGen, identityLookup };
  });

  afterAll(async () => {
    await close();
  });

  it("loads the Saudi seed hierarchy with localized names", async () => {
    const countries = await listCountries(deps, "en");
    const sa = countries.find((c) => c.code === "SA");
    expect(sa).toBeDefined();
    expect(sa!.name).toBe("Saudi Arabia");

    const regions = await listRegions(deps, SA, "ar");
    expect(regions.map((r) => r.code)).toContain("MD");
    const md = regions.find((r) => r.code === "MD")!;
    expect(md.name).toBe("منطقة المدينة");

    const cities = await listCities(deps, MADINAH_REGION, "en");
    expect(cities.map((c) => c.code)).toContain("MAD");

    const districts = await listDistricts(deps, MADINAH_CITY, "en");
    expect(districts.map((d) => d.code).sort()).toEqual(["HRA", "QBA"]);

    const zones = await listZones(deps, AL_HARA, "en");
    expect(zones.map((z) => z.code)).toEqual(["HRE"]);
  });

  it("falls back to ar for zones missing en/ur translations", async () => {
    // Hara East has only an ar name → en/ur fall back to ar.
    const en = await getZone(deps, HARA_EAST, "en");
    expect(en.name).toBe("الحرة الشرقية");
    const ur = await getZone(deps, HARA_EAST, "ur");
    expect(ur.name).toBe("الحرة الشرقية");
    const ar = await getZone(deps, HARA_EAST, "ar");
    expect(ar.name).toBe("الحرة الشرقية");
    // Path is fully populated.
    expect(ar.path.country.code).toBe("SA");
    expect(ar.path.region.code).toBe("MD");
    expect(ar.path.city.code).toBe("MAD");
    expect(ar.path.district.code).toBe("HRA");
  });

  it("creates a user location (first assignment, version 1, set event)", async () => {
    const waslaPublicId = "WS-1000000001";
    const res = await setUserLocation(deps, {
      waslaPublicId,
      zoneId: HARA_EAST,
      source: "customer_bot",
    });
    expect(res.created).toBe(true);
    expect(res.location.version).toBe(1);
    expect(res.location.zone.id).toBe(HARA_EAST);

    const loc = await getUserLocation(deps, { waslaPublicId, locale: "en" });
    expect(loc.zone.id).toBe(HARA_EAST);
    // Hara East has no en name → falls back to ar.
    expect(loc.zone.name).toBe("الحرة الشرقية");
  });

  it("records a change with history + changed event (idempotent after)", async () => {
    const waslaPublicId = "WS-1000000002";
    const eventsBefore = (await deps.outbox.unread()).length;
    // First location: Hara East.
    await setUserLocation(deps, {
      waslaPublicId,
      zoneId: HARA_EAST,
      source: "customer_bot",
    });
    // Change to Quba North.
    const change = await setUserLocation(deps, {
      waslaPublicId,
      zoneId: QUBA_NORTH,
      source: "customer_bot",
    });
    expect(change.created).toBe(false);
    expect(change.location.version).toBe(2);

    const history = await getUserLocationHistory(deps, { waslaPublicId });
    expect(history).toHaveLength(2);
    // First assignment: old_zone null (initial set).
    expect(history[0].old_zone).toBe(null);
    expect(history[0].new_zone.id).toBe(HARA_EAST);
    // Change: Hara East → Quba North.
    expect(history[1].old_zone!.id).toBe(HARA_EAST);
    expect(history[1].new_zone.id).toBe(QUBA_NORTH);

    // Outbox: set (first) + changed (second) = 2 NEW events since baseline.
    // (unread() returns all unpublished events across all users; use a delta.)
    const events = await deps.outbox.unread();
    expect(events.length).toBe(eventsBefore + 2);
    expect(events.slice(-2).map((e) => e.event_type)).toEqual([
      "geo.user_location.set",
      "geo.user_location.changed",
    ]);

    // Idempotent same-zone: no new history, no new event, version stable.
    const eventsBeforeIdempotent = (await deps.outbox.unread()).length;
    const again = await setUserLocation(deps, {
      waslaPublicId,
      zoneId: QUBA_NORTH,
      source: "customer_bot",
    });
    expect(again.created).toBe(false);
    expect(again.location.version).toBe(2);
    expect(await getUserLocationHistory(deps, { waslaPublicId })).toHaveLength(2);
    expect((await deps.outbox.unread()).length).toBe(eventsBeforeIdempotent);
  });
});
