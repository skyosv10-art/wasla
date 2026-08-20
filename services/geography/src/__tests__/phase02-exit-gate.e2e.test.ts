/**
 * Phase 02 Exit Gate E2E test (MR 7).
 *
 * The Phase 02 Exit Gate is: "a user changes their location without creating a
 * new account, and every module uses Geo IDs + i18n (AR/EN/UR)".
 *
 * This is the only test in the repository that wires BOTH services together the
 * way production does:
 *
 *   identity Fastify app  → Postgres (identity_*)   [listening on 127.0.0.1]
 *   geography Fastify app → Postgres (geo_*)        [app.inject]
 *                         → HttpIdentityLookupPort → the identity app over HTTP
 *
 * The identity service really listens on an ephemeral port so the production
 * HttpIdentityLookupPort adapter is exercised over real HTTP (not a fake), which
 * is what proves the cross-service contract: geography holds no FK to
 * identity_users and only knows the opaque wasla_public_id (ADR-006).
 *
 * Gated by DATABASE_URL; runs in CI via the `geography-db-integration` job.
 * Excluded from the default `pnpm -r test` run (see vitest.config.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";

import {
  createDb as createIdentityDb,
  ensurePublicIdSequence,
  PostgresIdentityRepository,
  PostgresOutbox as PostgresIdentityOutbox,
  PostgresPublicIdSequence,
  SystemClock as IdentitySystemClock,
  CryptoIdGenerator as IdentityIdGenerator,
  createIdentityApp,
} from "@wasla/identity-service";

import {
  createDb,
  PostgresGeographyRepository,
  PostgresOutbox,
  SystemClock,
  CryptoIdGenerator,
  HttpIdentityLookupPort,
  createGeographyApp,
} from "../index.js";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = Boolean(DATABASE_URL);

// The test runs from the geography package root (pnpm --filter ... ), so the
// identity contract lives one directory up. Both DDL files are the canonical
// source of truth for their own service's tables.
const GEO_SCHEMA_SQL = resolve(process.cwd(), "contracts/schema.sql");
const GEO_SEED_SQL = resolve(process.cwd(), "contracts/seeds/saudi-arabia.sql");
const IDENTITY_SCHEMA_SQL = resolve(
  process.cwd(),
  "../identity/contracts/schema.sql",
);

// Saudi fixture UUIDs (match contracts/seeds/saudi-arabia.sql).
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

const IDENTITY_TABLES =
  "identity_outbox, identity_recovery_requests, identity_history, " +
  "identity_links, identity_users";

const TELEGRAM_USER_ID = 920100200;

describe.skipIf(!ENABLED)("Phase 02 Exit Gate E2E (identity + geography)", () => {
  let identityPool: import("pg").Pool;
  let geoPool: import("pg").Pool;
  let identityApp: import("fastify").FastifyInstance;
  let geoApp: import("fastify").FastifyInstance;
  let geoOutbox: PostgresOutbox;

  beforeAll(async () => {
    // --- identity: schema + app listening on an ephemeral port --------------
    const identityCreated = createIdentityDb({
      connectionString: DATABASE_URL!,
    });
    identityPool = identityCreated.pool;
    await identityPool.query(
      `DROP TABLE IF EXISTS ${IDENTITY_TABLES} CASCADE`,
    );
    await identityPool.query(await readFile(IDENTITY_SCHEMA_SQL, "utf-8"));
    await ensurePublicIdSequence(identityCreated.db);

    identityApp = createIdentityApp({
      deps: {
        repo: new PostgresIdentityRepository(identityCreated.db),
        outbox: new PostgresIdentityOutbox(identityCreated.db),
        publicIdSeq: new PostgresPublicIdSequence(identityCreated.db),
        clock: new IdentitySystemClock(),
        idGen: new IdentityIdGenerator(),
      },
    });
    // Real HTTP listener so HttpIdentityLookupPort is exercised for real.
    await identityApp.listen({ port: 0, host: "127.0.0.1" });
    const address = identityApp.server.address() as AddressInfo;
    const identityBaseUrl = `http://127.0.0.1:${address.port}`;

    // --- geography: schema + seed + app wired to identity over HTTP ---------
    const geoCreated = createDb({ connectionString: DATABASE_URL! });
    geoPool = geoCreated.pool;
    await geoPool.query(`DROP TABLE IF EXISTS ${GEO_TABLES} CASCADE`);
    await geoPool.query(await readFile(GEO_SCHEMA_SQL, "utf-8"));
    await geoPool.query(await readFile(GEO_SEED_SQL, "utf-8"));

    geoOutbox = new PostgresOutbox(geoCreated.db);
    geoApp = createGeographyApp({
      deps: {
        repo: new PostgresGeographyRepository(geoCreated.db),
        outbox: geoOutbox,
        clock: new SystemClock(),
        idGen: new CryptoIdGenerator(),
        identityLookup: new HttpIdentityLookupPort({
          baseUrl: identityBaseUrl,
        }),
      },
    });
  });

  afterAll(async () => {
    await geoApp.close();
    await identityApp.close();
    await geoPool.end();
    await identityPool.end();
  });

  it("Exit Gate: a user changes location without creating a new account", async () => {
    // 1. The user exists only in identity (created from Telegram).
    const created = await identityApp.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: {
        telegram_user_id: TELEGRAM_USER_ID,
        telegram_username: "phase02_gate",
        source: "customer_bot",
      },
    });
    expect(created.statusCode).toBe(201);
    const identityBody = created.json<{
      wasla_public_id: string;
      internal_uuid: string;
    }>();
    const publicId = identityBody.wasla_public_id;
    const internalUuid = identityBody.internal_uuid;
    expect(publicId).toMatch(/^WS-[0-9]{10}$/);

    // 2. First location set → 201. Geography resolves the identity over HTTP.
    const firstSet = await geoApp.inject({
      method: "PUT",
      url: `/geo/users/${publicId}/location`,
      payload: { zone_id: HARA_EAST, source: "customer_bot" },
    });
    expect(firstSet.statusCode).toBe(201);
    expect(firstSet.json<{ version: number }>().version).toBe(1);

    // 3. The user moves to another zone → 200, still the SAME account.
    const changed = await geoApp.inject({
      method: "PUT",
      url: `/geo/users/${publicId}/location`,
      payload: { zone_id: QUBA_NORTH, source: "customer_bot" },
    });
    expect(changed.statusCode).toBe(200);
    const changedBody = changed.json<{
      wasla_public_id: string;
      zone: { id: string };
      version: number;
    }>();
    expect(changedBody.wasla_public_id).toBe(publicId);
    expect(changedBody.zone.id).toBe(QUBA_NORTH);
    expect(changedBody.version).toBe(2);

    // 4. Identity is untouched by the move: same Public ID + internal_uuid,
    //    and no second account was created (resolve is idempotent).
    const identityAfter = await identityApp.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: {
        telegram_user_id: TELEGRAM_USER_ID,
        telegram_username: "phase02_gate",
        source: "customer_bot",
      },
    });
    expect(identityAfter.statusCode).toBe(200);
    const afterBody = identityAfter.json<{
      wasla_public_id: string;
      internal_uuid: string;
      created: boolean;
    }>();
    expect(afterBody.created).toBe(false);
    expect(afterBody.wasla_public_id).toBe(publicId);
    expect(afterBody.internal_uuid).toBe(internalUuid);

    // 5. A Telegram username change keeps identity AND location stable.
    const renamed = await identityApp.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: {
        telegram_user_id: TELEGRAM_USER_ID,
        telegram_username: "phase02_gate_renamed",
        source: "customer_bot",
      },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json<{ wasla_public_id: string }>().wasla_public_id).toBe(
      publicId,
    );

    const locationAfterRename = await geoApp.inject({
      method: "GET",
      url: `/geo/users/${publicId}/location`,
    });
    expect(locationAfterRename.statusCode).toBe(200);
    expect(
      locationAfterRename.json<{ zone: { id: string } }>().zone.id,
    ).toBe(QUBA_NORTH);

    // 6. History records the move: first entry has no old zone, second carries
    //    the previous zone → the account moved, it was not recreated.
    const history = await geoApp.inject({
      method: "GET",
      url: `/geo/users/${publicId}/location/history`,
    });
    expect(history.statusCode).toBe(200);
    const entries = history.json() as Array<{
      old_zone: { id: string } | null;
      new_zone: { id: string };
    }>;
    expect(entries).toHaveLength(2);
    expect(entries[0]?.old_zone).toBeNull();
    expect(entries[0]?.new_zone.id).toBe(HARA_EAST);
    expect(entries[1]?.old_zone?.id).toBe(HARA_EAST);
    expect(entries[1]?.new_zone.id).toBe(QUBA_NORTH);

    // 7. Outbox carries both geography events for this user, keyed by the
    //    opaque wasla_public_id (the aggregate id).
    const events = await geoOutbox.unread();
    const mine = events.filter((e) => e.aggregate.id === publicId);
    expect(mine.map((e) => e.event_type)).toEqual([
      "geo.user_location.set",
      "geo.user_location.changed",
    ]);
  });

  it("Exit Gate: every hierarchy level is served with Geo IDs + AR/EN/UR names", async () => {
    // ar (default), en and ur must all resolve; ar is the documented fallback
    // for rows without a translation (Al Hara / Hara East in the seed).
    const countriesAr = await geoApp.inject({ url: "/geo/countries" });
    expect(countriesAr.statusCode).toBe(200);
    const sa = countriesAr
      .json<Array<{ id: string; code: string; name: string }>>()
      .find((c) => c.code === "SA");
    expect(sa?.id).toBe(SA);
    expect(sa?.name).toBe("المملكة العربية السعودية");

    const countriesEn = await geoApp.inject({
      url: "/geo/countries?locale=en",
    });
    expect(
      countriesEn
        .json<Array<{ code: string; name: string }>>()
        .find((c) => c.code === "SA")?.name,
    ).toBe("Saudi Arabia");

    const regionsUr = await geoApp.inject({
      url: `/geo/countries/${SA}/regions?locale=ur`,
    });
    expect(regionsUr.statusCode).toBe(200);
    const region = regionsUr
      .json<Array<{ id: string; name: string }>>()
      .find((r) => r.id === MADINAH_REGION);
    expect(region?.name).toBe("مدینہ علاقہ");

    const citiesEn = await geoApp.inject({
      url: `/geo/regions/${MADINAH_REGION}/cities?locale=en`,
    });
    expect(
      citiesEn.json<Array<{ id: string }>>().map((c) => c.id),
    ).toContain(MADINAH_CITY);

    // Al Hara has no en/ur translation in the seed → falls back to ar.
    const districtsEn = await geoApp.inject({
      url: `/geo/cities/${MADINAH_CITY}/districts?locale=en`,
    });
    const alHara = districtsEn
      .json<Array<{ id: string; name: string }>>()
      .find((d) => d.id === AL_HARA);
    expect(alHara?.name).toBe("حي الحرة");

    // Zone detail exposes the full hierarchy path by Geo IDs.
    const zone = await geoApp.inject({ url: `/geo/zones/${QUBA_NORTH}?locale=en` });
    expect(zone.statusCode).toBe(200);
    const zoneBody = zone.json<{
      id: string;
      name: string;
      path: {
        district: { id: string };
        city: { id: string };
        region: { id: string };
        country: { id: string };
      };
    }>();
    expect(zoneBody.id).toBe(QUBA_NORTH);
    expect(zoneBody.name).toBe("Quba North");
    expect(zoneBody.path.city.id).toBe(MADINAH_CITY);
    expect(zoneBody.path.region.id).toBe(MADINAH_REGION);
    expect(zoneBody.path.country.id).toBe(SA);
  });

  it("Exit Gate: a location cannot be assigned to an unknown identity (404)", async () => {
    // Well-formed but non-existent Public ID: the real identity service answers
    // 404 over HTTP, so geography refuses to create a dangling location.
    const orphan = await geoApp.inject({
      method: "PUT",
      url: "/geo/users/WS-9999999999/location",
      payload: { zone_id: HARA_EAST, source: "customer_bot" },
    });
    expect(orphan.statusCode).toBe(404);
    expect(orphan.json<{ code: string }>().code).toBe(
      "GEO_IDENTITY_NOT_FOUND",
    );

    const missing = await geoApp.inject({
      url: "/geo/users/WS-9999999999/location",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ code: string }>().code).toBe(
      "GEO_USER_LOCATION_NOT_FOUND",
    );
  });
});
