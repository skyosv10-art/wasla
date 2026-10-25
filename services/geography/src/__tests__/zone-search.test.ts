/**
 * G-S9.3 (CLM-0645) — `GET /geo/zones/search` over the HTTP boundary with the
 * in-memory adapter. The contract (api.openapi.yml) says: active zones only
 * (the rule customers enforces on an order's zone_id), match on any localized
 * zone name case-insensitively as a literal substring, ordered by code then id,
 * bounded by `limit`, names localized with `ar` fallback, and invalid input →
 * GEO_INVALID_SEARCH_QUERY (400). The Postgres adapter is held to the same
 * rules in postgres-repository.integration.test.ts.
 */
import { describe, expect, it } from "vitest";

import { GEO_SCOPES } from "../http/service-identity.js";
import {
  SAUDI_FIXTURE_IDS,
  InMemoryGeographyRepository,
  InMemoryIdentityLookupPort,
  InMemoryOutbox,
  SystemClock,
  CryptoIdGenerator,
} from "../infrastructure/in-memory.js";
import type { UseCaseDeps } from "../use-cases/deps.js";

import {
  buildSignedGeographyApp,
  createSignedGeographyApp,
  signFor,
} from "./service-identity-support.js";

const I = SAUDI_FIXTURE_IDS;
const SEARCH = "/geo/zones/search";

function build(repo = new InMemoryGeographyRepository()): UseCaseDeps {
  return {
    repo,
    outbox: new InMemoryOutbox(),
    clock: new SystemClock(),
    idGen: new CryptoIdGenerator(),
    identityLookup: new InMemoryIdentityLookupPort(),
  };
}

async function search(query: string, repo?: InMemoryGeographyRepository) {
  const app = createSignedGeographyApp({ deps: build(repo), logger: false });
  const res = await app.inject({ method: "GET", url: `${SEARCH}?${query}` });
  await app.close();
  return res;
}

const ids = (body: Array<{ id: string }>): string[] => body.map((z) => z.id);

describe("GET /geo/zones/search — results", () => {
  it("matches a zone by its Arabic name and returns the full localized path", async () => {
    const res = await search(`q=${encodeURIComponent("قباء")}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // «حي قباء» is a district name, not a zone name: only the zone QBN matches.
    expect(ids(body)).toEqual([I.zoneQubaNorth]);
    expect(body[0]).toMatchObject({
      id: I.zoneQubaNorth,
      code: "QBN",
      status: "active",
      name: "قباء الشمالية",
      path: {
        country: { code: "SA" },
        city: { id: I.city, name: "المدينة المنورة" },
        district: { id: I.districtQuba, name: "حي قباء" },
      },
    });
  });

  it("matches English names case-insensitively and localizes with locale=en", async () => {
    const res = await search("q=qUBA%20n&locale=en");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(ids(body)).toEqual([I.zoneQubaNorth]);
    expect(body[0].name).toBe("Quba North");
    expect(body[0].path.district.name).toBe("Quba District");
  });

  it("matches Urdu names", async () => {
    const res = await search(`q=${encodeURIComponent("شمالی")}&locale=ur`);
    expect(ids(res.json())).toEqual([I.zoneQubaNorth]);
    expect(res.json()[0].name).toBe("قباء شمالی");
  });

  it("falls back to the Arabic name when the requested locale has none (ADR-006)", async () => {
    const res = await search(`q=${encodeURIComponent("الحرة")}&locale=en`);
    const body = res.json();
    expect(ids(body)).toEqual([I.zoneHaraEast]);
    expect(body[0].name).toBe("الحرة الشرقية");
  });

  it("returns only active zones — the validity rule customers applies to an order's zone_id", async () => {
    const repo = new InMemoryGeographyRepository();
    repo.setZoneStatus(I.zoneQubaNorth, "inactive");
    const res = await search(`q=${encodeURIComponent("قباء")}`, repo);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    // …and the other zone is unaffected.
    const other = await search(`q=${encodeURIComponent("الحرة")}`, repo);
    expect(ids(other.json())).toEqual([I.zoneHaraEast]);
  });

  it("orders deterministically by code then id, and honours limit", async () => {
    // «ال» occurs in both zone names: الحرة الشرقية (HRE) · قباء الشمالية (QBN).
    const all = await search(`q=${encodeURIComponent("ال")}`);
    expect(ids(all.json())).toEqual([I.zoneHaraEast, I.zoneQubaNorth]);
    const one = await search(`q=${encodeURIComponent("ال")}&limit=1`);
    expect(ids(one.json())).toEqual([I.zoneHaraEast]);
  });

  it("trims q before matching", async () => {
    const res = await search(`q=${encodeURIComponent("  قباء  ")}`);
    expect(ids(res.json())).toEqual([I.zoneQubaNorth]);
  });

  it("treats LIKE metacharacters literally", async () => {
    for (const q of ["%%", "__", "\\\\", "%_"]) {
      const res = await search(`q=${encodeURIComponent(q)}`);
      expect(res.statusCode, q).toBe(200);
      expect(res.json(), q).toEqual([]);
    }
  });

  it("no match → 200 with an empty array (not 404)", async () => {
    const res = await search("q=zzzz");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("GET /geo/zones/search — validation (GEO_INVALID_SEARCH_QUERY · 400)", () => {
  const bad: Array<[string, string]> = [
    ["missing q", ""],
    ["empty q", "q="],
    ["one character after trimming", `q=${encodeURIComponent("  ق ")}`],
    ["65 characters", `q=${"a".repeat(65)}`],
    ["limit=0", "q=qu&limit=0"],
    ["limit=21", "q=qu&limit=21"],
    ["limit not a number", "q=qu&limit=ten"],
    ["limit not an integer", "q=qu&limit=1.5"],
    ["negative limit", "q=qu&limit=-1"],
  ];
  for (const [label, query] of bad) {
    it(`rejects ${label}`, async () => {
      const res = await search(query);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("GEO_INVALID_SEARCH_QUERY");
    });
  }

  it("accepts the bounds: 2 and 64 characters, limit 1 and 20", async () => {
    for (const query of ["q=qu", `q=${"a".repeat(64)}`, "q=qu&limit=1", "q=qu&limit=20"]) {
      const res = await search(query);
      expect(res.statusCode, query).toBe(200);
    }
  });

  it("an unsupported locale is still GEO_UNSUPPORTED_LOCALE", async () => {
    const res = await search("q=qu&locale=fr");
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("GEO_UNSUPPORTED_LOCALE");
  });
});

describe("GET /geo/zones/search — service identity (geography:zone:read)", () => {
  it("is not shadowed by /geo/zones/:zoneId", async () => {
    const res = await search("q=qu");
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("no identity → 401", async () => {
    const { app, rawInject } = buildSignedGeographyApp({ deps: build() });
    const res = await rawInject({ method: "GET", url: `${SEARCH}?q=qu` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("hierarchy-read only → 403; zone-read → 200", async () => {
    const { app, rawInject, keys } = buildSignedGeographyApp({ deps: build() });
    const url = `${SEARCH}?q=qu`;
    const denied = await rawInject({
      method: "GET",
      url,
      headers: signFor("GET", url, { keys, scopes: [GEO_SCOPES.hierarchyRead] }),
    });
    expect(denied.statusCode).toBe(403);
    const allowed = await rawInject({
      method: "GET",
      url,
      headers: signFor("GET", url, { keys, scopes: [GEO_SCOPES.zoneRead] }),
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });
});
