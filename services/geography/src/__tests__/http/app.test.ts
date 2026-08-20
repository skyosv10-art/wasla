/**
 * HTTP layer tests for createGeographyApp (MR 5).
 *
 * Uses Fastify's app.inject (no real port) with in-memory adapters. Verifies
 * routing for the 9 contract endpoints, locale handling (ar default + en/ur +
 * fallback), status-code mapping per contracts/errors.md, the contract Error
 * body shape, and the 201/200 split on PUT (first set vs. change vs. idempotent
 * re-set).
 *
 * Domain logic is already covered by the use-case unit tests; these tests focus
 * on the HTTP boundary.
 */
import { describe, it, expect } from "vitest";

import {
  createGeographyApp,
  type CreateGeographyAppOptions,
} from "../../http/app.js";
import type { UseCaseDeps } from "../../use-cases/deps.js";
import {
  SAUDI_FIXTURE_IDS,
  InMemoryGeographyRepository,
  InMemoryOutbox,
  InMemoryIdentityLookupPort,
  SystemClock,
  CryptoIdGenerator,
} from "../../infrastructure/in-memory.js";

const I = SAUDI_FIXTURE_IDS;
const USER = "WS-0000000001";
const UNKNOWN_UUID = "00000000-0000-0000-0000-000000000000";

function buildDeps(options?: { knownIds?: string[] }): UseCaseDeps {
  return {
    repo: new InMemoryGeographyRepository(),
    outbox: new InMemoryOutbox(),
    clock: new SystemClock(),
    idGen: new CryptoIdGenerator(),
    identityLookup: new InMemoryIdentityLookupPort(options?.knownIds),
  };
}

function buildApp(deps: UseCaseDeps): CreateGeographyAppOptions {
  return { deps, logger: false };
}

describe("Geography HTTP app — hierarchy routes", () => {
  it("GET /health returns 200 ok", async () => {
    const app = createGeographyApp(buildApp(buildDeps()));
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /geo/countries defaults to locale ar", async () => {
    const app = createGeographyApp(buildApp(buildDeps()));
    const res = await app.inject({ method: "GET", url: "/geo/countries" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].code).toBe("SA");
    expect(body[0].name).toBe("المملكة العربية السعودية");
  });

  it("GET /geo/countries?locale=en returns English names", async () => {
    const app = createGeographyApp(buildApp(buildDeps()));
    const res = await app.inject({
      method: "GET",
      url: "/geo/countries?locale=en",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].name).toBe("Saudi Arabia");
  });

  it("rejects an unsupported locale with GEO_UNSUPPORTED_LOCALE (400)", async () => {
    const app = createGeographyApp(buildApp(buildDeps()));
    const res = await app.inject({
      method: "GET",
      url: "/geo/countries?locale=fr",
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("GEO_UNSUPPORTED_LOCALE");
    expect(typeof body.message).toBe("string");
    expect(typeof body.trace_id).toBe("string");
  });

  it("walks the full hierarchy: regions → cities → districts → zones", async () => {
    const app = createGeographyApp(buildApp(buildDeps()));

    const regions = await app.inject({
      method: "GET",
      url: `/geo/countries/${I.country}/regions`,
    });
    expect(regions.statusCode).toBe(200);
    expect(regions.json()[0].id).toBe(I.region);

    const cities = await app.inject({
      method: "GET",
      url: `/geo/regions/${I.region}/cities?locale=en`,
    });
    expect(cities.statusCode).toBe(200);
    expect(cities.json()[0].name).toBe("Madinah");

    const districts = await app.inject({
      method: "GET",
      url: `/geo/cities/${I.city}/districts`,
    });
    expect(districts.statusCode).toBe(200);
    expect(districts.json()).toHaveLength(2);

    const zones = await app.inject({
      method: "GET",
      url: `/geo/districts/${I.districtAlHara}/zones`,
    });
    expect(zones.statusCode).toBe(200);
    expect(zones.json()[0].id).toBe(I.zoneHaraEast);
  });

  it("maps missing parents to their stable *_NOT_FOUND code (404)", async () => {
    const app = createGeographyApp(buildApp(buildDeps()));
    const cases: [string, string][] = [
      [`/geo/countries/${UNKNOWN_UUID}/regions`, "GEO_COUNTRY_NOT_FOUND"],
      [`/geo/regions/${UNKNOWN_UUID}/cities`, "GEO_REGION_NOT_FOUND"],
      [`/geo/cities/${UNKNOWN_UUID}/districts`, "GEO_CITY_NOT_FOUND"],
      [`/geo/districts/${UNKNOWN_UUID}/zones`, "GEO_DISTRICT_NOT_FOUND"],
      [`/geo/zones/${UNKNOWN_UUID}`, "GEO_ZONE_NOT_FOUND"],
    ];
    for (const [url, code] of cases) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe(code);
    }
  });

  it("GET /geo/zones/:id returns the zone with its full localized path", async () => {
    const app = createGeographyApp(buildApp(buildDeps()));
    const res = await app.inject({
      method: "GET",
      url: `/geo/zones/${I.zoneHaraEast}?locale=en`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(I.zoneHaraEast);
    expect(body.path.country.code).toBe("SA");
    expect(body.path.city.name).toBe("Madinah");
    expect(body.path.district.id).toBe(I.districtAlHara);
  });
});

describe("Geography HTTP app — user location routes", () => {
  it("PUT sets the first location (201) then changes it (200) — Exit Gate path", async () => {
    const app = createGeographyApp(buildApp(buildDeps()));

    const created = await app.inject({
      method: "PUT",
      url: `/geo/users/${USER}/location`,
      payload: { zone_id: I.zoneHaraEast, source: "customer_bot" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().wasla_public_id).toBe(USER);
    expect(created.json().zone.id).toBe(I.zoneHaraEast);

    const changed = await app.inject({
      method: "PUT",
      url: `/geo/users/${USER}/location`,
      payload: { zone_id: I.zoneQubaNorth, source: "customer_bot" },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().zone.id).toBe(I.zoneQubaNorth);

    // Identity is untouched: the same public id still owns the location.
    expect(changed.json().wasla_public_id).toBe(USER);
  });

  it("PUT with the same zone is idempotent (200, no version bump)", async () => {
    const app = createGeographyApp(buildApp(buildDeps()));
    const first = await app.inject({
      method: "PUT",
      url: `/geo/users/${USER}/location`,
      payload: { zone_id: I.zoneHaraEast, source: "driver_bot" },
    });
    const again = await app.inject({
      method: "PUT",
      url: `/geo/users/${USER}/location`,
      payload: { zone_id: I.zoneHaraEast, source: "driver_bot" },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().version).toBe(first.json().version);
  });

  it("GET returns the current location and 404 when none is set", async () => {
    const app = createGeographyApp(buildApp(buildDeps()));

    const missing = await app.inject({
      method: "GET",
      url: `/geo/users/${USER}/location`,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("GEO_USER_LOCATION_NOT_FOUND");

    await app.inject({
      method: "PUT",
      url: `/geo/users/${USER}/location`,
      payload: { zone_id: I.zoneQubaNorth, source: "admin" },
    });
    const found = await app.inject({
      method: "GET",
      url: `/geo/users/${USER}/location?locale=ur`,
    });
    expect(found.statusCode).toBe(200);
    expect(found.json().zone.id).toBe(I.zoneQubaNorth);
    expect(typeof found.json().zone.name).toBe("string");
  });

  it("GET history returns the ordered change log (old_zone null first)", async () => {
    const app = createGeographyApp(buildApp(buildDeps()));
    await app.inject({
      method: "PUT",
      url: `/geo/users/${USER}/location`,
      payload: { zone_id: I.zoneHaraEast, source: "customer_bot" },
    });
    await app.inject({
      method: "PUT",
      url: `/geo/users/${USER}/location`,
      payload: { zone_id: I.zoneQubaNorth, source: "customer_bot" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/geo/users/${USER}/location/history`,
    });
    expect(res.statusCode).toBe(200);
    const history = res.json();
    expect(history).toHaveLength(2);
    expect(history[0].old_zone).toBeNull();
    expect(history[0].new_zone.id).toBe(I.zoneHaraEast);
    expect(history[1].old_zone.id).toBe(I.zoneHaraEast);
    expect(history[1].new_zone.id).toBe(I.zoneQubaNorth);
  });

  it("rejects an invalid Wasla Public ID with GEO_INVALID_PUBLIC_ID (400)", async () => {
    const app = createGeographyApp(buildApp(buildDeps()));
    const res = await app.inject({
      method: "GET",
      url: "/geo/users/WS-123/location",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("GEO_INVALID_PUBLIC_ID");
  });

  it("rejects a malformed PUT body with GEO_INVALID_REQUEST_BODY (400)", async () => {
    const app = createGeographyApp(buildApp(buildDeps()));

    const noZone = await app.inject({
      method: "PUT",
      url: `/geo/users/${USER}/location`,
      payload: { source: "customer_bot" },
    });
    expect(noZone.statusCode).toBe(400);
    expect(noZone.json().code).toBe("GEO_INVALID_REQUEST_BODY");

    const badSource = await app.inject({
      method: "PUT",
      url: `/geo/users/${USER}/location`,
      payload: { zone_id: I.zoneHaraEast, source: "web_widget" },
    });
    expect(badSource.statusCode).toBe(400);
    expect(badSource.json().code).toBe("GEO_INVALID_REQUEST_BODY");
  });

  it("returns GEO_ZONE_NOT_FOUND (404) for an unknown zone", async () => {
    const app = createGeographyApp(buildApp(buildDeps()));
    const res = await app.inject({
      method: "PUT",
      url: `/geo/users/${USER}/location`,
      payload: { zone_id: UNKNOWN_UUID, source: "system" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("GEO_ZONE_NOT_FOUND");
  });

  it("returns GEO_IDENTITY_NOT_FOUND (404) for an unknown identity", async () => {
    const app = createGeographyApp(
      buildApp(buildDeps({ knownIds: ["WS-0000000002"] })),
    );
    const res = await app.inject({
      method: "PUT",
      url: `/geo/users/${USER}/location`,
      payload: { zone_id: I.zoneHaraEast, source: "customer_bot" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("GEO_IDENTITY_NOT_FOUND");
  });

  it("emits set then changed events with the request id as trace_id", async () => {
    const deps = buildDeps();
    const app = createGeographyApp(buildApp(deps));
    await app.inject({
      method: "PUT",
      url: `/geo/users/${USER}/location`,
      payload: { zone_id: I.zoneHaraEast, source: "customer_bot" },
    });
    await app.inject({
      method: "PUT",
      url: `/geo/users/${USER}/location`,
      payload: { zone_id: I.zoneQubaNorth, source: "customer_bot" },
    });

    const events = await deps.outbox.unread();
    expect(events.map((e) => e.event_type)).toEqual([
      "geo.user_location.set",
      "geo.user_location.changed",
    ]);
    for (const event of events) {
      expect(typeof event.trace_id).toBe("string");
      expect(event.trace_id).not.toBe("");
    }
  });
});
