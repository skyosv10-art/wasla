/**
 * Store-name search — unit tests (G-S9.7 · CLM-0649 · ADR-025 §6).
 * Request parsing, folding, escaping, title fallback, the signed marketplace
 * read port, the relay's fetch-before-mutate for store names, and the HTTP
 * route's validation + public projection. PostgreSQL behaviour (eligibility,
 * order, rebuild, replay) is in store-search.integration.test.ts.
 */

import { describe, expect, it } from "vitest";
import { createServiceRequestSigner, SERVICE_AUTH_HEADER, verifyServiceToken } from "@wasla/service-auth";
import { STORE_SEARCH_LIMITS, STORE_SEARCH_RESULT_FIELDS } from "@wasla/contracts-search";

import {
  escapeLike,
  localizedTitle,
  normalizeStoreName,
  parseStoreSearchRequest,
  StoreSearchValidationError,
} from "../domain/store-search.js";
import {
  HttpMarketplaceCatalogReadPort,
  composeMarketplaceCatalogReadPort,
  MarketplaceCatalogError,
  SEARCH_MARKETPLACE_SCOPES,
} from "../infrastructure/http-marketplace-catalog.js";
import { DEFAULT_RELAY_CONFIG, runRelayBatch, type RelayDeps } from "../relay.js";
import type {
  CatalogStore,
  MarketplaceEventSource,
  ProjectionStore,
  SearchStoresReadPort,
} from "../ports.js";
import type { MarketplaceOutboxRow, RelayCheckpoint, ConsumedStatus } from "../domain/consumed-events.js";
import type { StoreProjection, ProductProjection } from "../domain/projector.js";
import { FakeStoreCatalog } from "./support/fake-store-catalog.js";
import { buildEnforcedApp, createTestKeyRegistry, fakeEmptyReadPort, inject } from "./service-identity-support.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof StoreSearchValidationError ? e.code : `other:${(e as Error).message}`;
  }
}

describe("parseStoreSearchRequest — bounds come from the shared contract", () => {
  // Bounds are the owner's decision (CLM-0652 · ADR-025 §6.8): q 1..200 · page ≥ 1
  // (no upper bound) · page_size 1..50 = 20. Literals here on purpose: a test that
  // only read STORE_SEARCH_LIMITS would follow a drifted constant.
  it("defaults: locale ar · page 1 · page_size 20 (absent page_size selects 20)", () => {
    expect(parseStoreSearchRequest({ q: "  النور " })).toEqual({ q: "النور", locale: "ar", page: 1, pageSize: 20 });
  });

  it("q: one character after trim is valid if it stays non-empty after normalization", () => {
    expect(parseStoreSearchRequest({ q: " ن " }).q).toBe("ن");
    expect(parseStoreSearchRequest({ q: "a" }).q).toBe("a");
    // A single tatweel / single diacritic normalizes to nothing → empty, as for /search/products.
    expect(codeOf(() => parseStoreSearchRequest({ q: "ـ" }))).toBe("SEARCH_QUERY_EMPTY");
    expect(codeOf(() => parseStoreSearchRequest({ q: "ً" }))).toBe("SEARCH_QUERY_EMPTY");
    expect(codeOf(() => parseStoreSearchRequest({}))).toBe("SEARCH_QUERY_EMPTY");
    expect(codeOf(() => parseStoreSearchRequest({ q: "   " }))).toBe("SEARCH_QUERY_EMPTY");
    expect(codeOf(() => parseStoreSearchRequest({ q: "" }))).toBe("SEARCH_QUERY_EMPTY");
    expect(codeOf(() => parseStoreSearchRequest({ q: ["ab", "cd"] }))).toBe("SEARCH_QUERY_EMPTY");
  });

  it("q: 200 characters accepted, 201 rejected (after trim)", () => {
    expect(codeOf(() => parseStoreSearchRequest({ q: "ب".repeat(200) }))).toBeUndefined();
    expect(codeOf(() => parseStoreSearchRequest({ q: `  ${"ب".repeat(200)}  ` }))).toBeUndefined();
    expect(codeOf(() => parseStoreSearchRequest({ q: "ب".repeat(201) }))).toBe("SEARCH_QUERY_TOO_LONG");
  });

  it("counts characters, not UTF-16 units (200 emoji are 200, not 400; 201 are too long)", () => {
    expect(codeOf(() => parseStoreSearchRequest({ q: "🙂".repeat(200) }))).toBeUndefined();
    expect(codeOf(() => parseStoreSearchRequest({ q: "🙂".repeat(201) }))).toBe("SEARCH_QUERY_TOO_LONG");
  });

  it("page: integer ≥ 1 with no upper bound; zero, negative and non-integers rejected", () => {
    expect(parseStoreSearchRequest({ q: "نور", page: "1" }).page).toBe(1);
    expect(parseStoreSearchRequest({ q: "نور", page: "51" }).page).toBe(51);
    expect(parseStoreSearchRequest({ q: "نور", page: "100000" }).page).toBe(100000);
    expect(parseStoreSearchRequest({ q: "نور", page: String(Number.MAX_SAFE_INTEGER) }).page).toBe(Number.MAX_SAFE_INTEGER);
    for (const bad of ["0", "-1", "-0", "1.5", "2.0", "1e3", "abc", "", " 1", "0x10", "9007199254740993"]) {
      expect(codeOf(() => parseStoreSearchRequest({ q: "نور", page: bad })), bad).toBe("SEARCH_PAGE_OUT_OF_RANGE");
    }
    expect(codeOf(() => parseStoreSearchRequest({ q: "نور", page: ["1", "2"] }))).toBe("SEARCH_PAGE_OUT_OF_RANGE");
  });

  it("page_size: 1 and 50 accepted; 0, 51, negative and non-integers rejected", () => {
    expect(parseStoreSearchRequest({ q: "نور", page_size: "1" }).pageSize).toBe(1);
    expect(parseStoreSearchRequest({ q: "نور", page_size: "50" }).pageSize).toBe(50);
    expect(parseStoreSearchRequest({ q: "نور", page_size: "20" }).pageSize).toBe(20);
    for (const bad of ["0", "51", "-1", "1.5", "x", ""]) {
      expect(codeOf(() => parseStoreSearchRequest({ q: "نور", page_size: bad })), bad).toBe("SEARCH_PAGE_SIZE_INVALID");
    }
  });

  it("the parser enforces exactly the shared constants (package ↔ service)", () => {
    const L = STORE_SEARCH_LIMITS;
    expect(codeOf(() => parseStoreSearchRequest({ q: "ب".repeat(L.qMaxLength) }))).toBeUndefined();
    expect(codeOf(() => parseStoreSearchRequest({ q: "ب".repeat(L.qMaxLength + 1) }))).toBe("SEARCH_QUERY_TOO_LONG");
    expect(codeOf(() => parseStoreSearchRequest({ q: "نور", page_size: String(L.pageSizeMax) }))).toBeUndefined();
    expect(codeOf(() => parseStoreSearchRequest({ q: "نور", page_size: String(L.pageSizeMax + 1) }))).toBe("SEARCH_PAGE_SIZE_INVALID");
    expect(parseStoreSearchRequest({ q: "نور" }).pageSize).toBe(L.pageSizeDefault);
  });

  it("locale ar/en/ur only", () => {
    expect(parseStoreSearchRequest({ q: "نور", locale: "ur" }).locale).toBe("ur");
    expect(codeOf(() => parseStoreSearchRequest({ q: "نور", locale: "fr" }))).toBe("SEARCH_UNSUPPORTED_LOCALE");
  });

  it("undeclared keys are rejected by name, never ignored", () => {
    for (const key of ["state", "owner_public_id", "store_state", "category_slug", "limit", "name"]) {
      expect(codeOf(() => parseStoreSearchRequest({ q: "نور", [key]: "x" })), key).toBe("SEARCH_UNKNOWN_PARAMETER");
    }
  });
});

describe("normalizeStoreName — declared folding (ADR-025 §6.4)", () => {
  it.each([
    ["أحمد", "احمد"], ["إسلام", "اسلام"], ["آمنة", "امنه"], ["ٱلنور", "النور"],
    ["مستشفى", "مستشفي"], ["کریانہ", "كريانه"], ["مؤسسة", "موسسه"], ["مسائل", "مسايل"],
    ["  مَكْتَبَةُ   النُّور ", "مكتبه النور"], ["ـمتـجـر", "متجر"], ["ACME Store", "acme store"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeStoreName(input)).toBe(expected);
  });
});

describe("escapeLike + localizedTitle", () => {
  it("escapes %, _ and \\ (and nothing else)", () => {
    expect(escapeLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
    expect(escapeLike("النور")).toBe("النور");
  });

  it("returns the requested locale or falls back to Arabic (null or blank)", () => {
    const names = { title_ar: "النور", title_en: "Noor", title_ur: "  " };
    expect(localizedTitle(names, "en")).toBe("Noor");
    expect(localizedTitle(names, "ur")).toBe("النور");
    expect(localizedTitle({ ...names, title_en: null }, "en")).toBe("النور");
  });
});

// ── the signed marketplace read port ──────────────────────────────────────

function signer() {
  return createServiceRequestSigner({
    serviceName: "search",
    audience: "marketplace",
    scopes: SEARCH_MARKETPLACE_SCOPES,
    keys: createTestKeyRegistry(),
  });
}

function fakeFetch(status: number, body: unknown, seen: Array<{ url: string; headers: Record<string, string> }>): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

const STORE_RESOURCE = {
  store_id: "a0000000-0000-4000-8000-000000000001",
  store_slug: "baqala-noor",
  owner_public_id: "WS-0000000001",
  category_slug: "groceries",
  title_ar: "بقالة النور",
  title_en: "Noor Grocery",
  title_ur: null,
  state: "approved",
  state_sequence: 2,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

describe("HttpMarketplaceCatalogReadPort — signed, names only", () => {
  it("scopes are exactly product:read + store:read", () => {
    expect([...SEARCH_MARKETPLACE_SCOPES]).toEqual(["marketplace:product:read", "marketplace:store:read"]);
  });

  it("GET /stores/{slug} carries a service token and returns only the names", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const port = new HttpMarketplaceCatalogReadPort({ baseUrl: "http://mk/", signRequest: signer(), fetchImpl: fakeFetch(200, STORE_RESOURCE, seen) });
    const store = await port.getStore("baqala-noor");
    expect(store).toEqual({ store_id: STORE_RESOURCE.store_id, store_slug: "baqala-noor", title_ar: "بقالة النور", title_en: "Noor Grocery", title_ur: null });
    expect(Object.keys(store!)).not.toContain("owner_public_id");
    expect(seen[0]!.url).toBe("http://mk/stores/baqala-noor");
    // The token verifies for marketplace, bound to GET + this exact path, with the granted scopes.
    const principal = verifyServiceToken(seen[0]!.headers[SERVICE_AUTH_HEADER]!, {
      audience: "marketplace", method: "GET", path: "/stores/baqala-noor", keys: createTestKeyRegistry(), now: new Date(),
    });
    expect(principal.serviceName).toBe("search");
    expect([...principal.scopes].sort()).toEqual(["marketplace:product:read", "marketplace:store:read"]);
    expect(() => verifyServiceToken(seen[0]!.headers[SERVICE_AUTH_HEADER]!, {
      audience: "marketplace", method: "GET", path: "/stores/other", keys: createTestKeyRegistry(), now: new Date(),
    })).toThrow();
  });

  it("GET /products/{id} is signed too (G-S9.19 — the old port sent no identity)", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const port = new HttpMarketplaceCatalogReadPort({
      baseUrl: "http://mk",
      signRequest: signer(),
      fetchImpl: fakeFetch(200, { product_id: "p", store_id: "s", store_slug: "x", sku: "k", category_slug: "c", title_ar: "ع", title_en: null, price_minor_units: 100 }, seen),
    });
    expect((await port.getProduct("p"))?.sku).toBe("k");
    const principal = verifyServiceToken(seen[0]!.headers[SERVICE_AUTH_HEADER]!, {
      audience: "marketplace", method: "GET", path: "/products/p", keys: createTestKeyRegistry(), now: new Date(),
    });
    expect(principal.serviceName).toBe("search");
  });

  it("404 → null; 401/403 → denied; 500 → error status; bad shape → drift — all but 404 throw", async () => {
    const port = (status: number, body: unknown) =>
      new HttpMarketplaceCatalogReadPort({ baseUrl: "http://mk", signRequest: signer(), fetchImpl: fakeFetch(status, body, []) });
    expect(await port(404, {}).getStore("x")).toBeNull();
    await expect(port(401, {}).getStore("x")).rejects.toMatchObject({ reason: "marketplace_denied_identity" });
    await expect(port(403, {}).getStore("x")).rejects.toMatchObject({ reason: "marketplace_denied_identity" });
    await expect(port(500, {}).getStore("x")).rejects.toMatchObject({ reason: "marketplace_error_status" });
    await expect(port(200, { ...STORE_RESOURCE, title_ar: "" }).getStore("x")).rejects.toBeInstanceOf(MarketplaceCatalogError);
    await expect(port(200, [STORE_RESOURCE]).getStore("x")).rejects.toMatchObject({ reason: "marketplace_unreadable_body" });
  });

  it("production composition signs as `search` → audience `marketplace` with exactly the granted scopes", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const port = composeMarketplaceCatalogReadPort({ baseUrl: "http://mk", keys: createTestKeyRegistry(), fetchImpl: fakeFetch(404, {}, seen) });
    expect(await port.getStore("s")).toBeNull();
    const principal = verifyServiceToken(seen[0]!.headers[SERVICE_AUTH_HEADER]!, {
      audience: "marketplace", method: "GET", path: "/stores/s", keys: createTestKeyRegistry(), now: new Date(),
    });
    expect(principal.serviceName).toBe("search");
    expect([...principal.scopes].sort()).toEqual([...SEARCH_MARKETPLACE_SCOPES].sort());
  });

  it("network failure → unreachable (throws, so the relay keeps the event pending)", async () => {
    const port = new HttpMarketplaceCatalogReadPort({
      baseUrl: "http://mk",
      signRequest: signer(),
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await expect(port.getStore("x")).rejects.toMatchObject({ reason: "marketplace_unreachable" });
  });
});

// ── relay: fetch names before mutating ────────────────────────────────────

const STORE_ID = "a0000000-0000-4000-8000-000000000001";

class MemEvents implements MarketplaceEventSource {
  constructor(private readonly rows: MarketplaceOutboxRow[]) {}
  async readAfter(cp: RelayCheckpoint | null, limit: number): Promise<readonly MarketplaceOutboxRow[]> {
    if (!cp) return this.rows.slice(0, limit);
    return this.rows.filter((r) => BigInt(r.commit_sequence) > BigInt(cp.last_commit_sequence)).slice(0, limit);
  }
}

class MemStore implements ProjectionStore {
  checkpoint: RelayCheckpoint | null = null;
  consumed = new Map<string, { status: ConsumedStatus; attempts: number; error?: string | null }>();
  stores = new Map<string, StoreProjection>();
  storeDocs = new Map<string, CatalogStore>();
  async getCheckpoint() { return this.checkpoint; }
  async writeCheckpoint(_c: string, cp: RelayCheckpoint) { this.checkpoint = cp; }
  async getStoreProjection(id: string) { return this.stores.get(id) ?? null; }
  async getProductProjection(): Promise<ProductProjection | null> { return null; }
  async upsertStoreState(r: StoreProjection) { this.stores.set(r.store_id, r); }
  async upsertProductState() {}
  async hasIndexDoc() { return false; }
  async upsertIndexDoc() {}
  async refreshProductStateColumns() {}
  async updateStoreStateOnDocs() {}
  async archiveProductDoc() {}
  async hasStoreDoc(id: string) { return this.storeDocs.has(id); }
  async upsertStoreDoc(s: CatalogStore) { this.storeDocs.set(s.store_id, s); }
  async getConsumed(id: string) {
    const c = this.consumed.get(id);
    return c ? { status: c.status, attempt_count: c.attempts } : null;
  }
  async markConsumed(id: string, _row: unknown, status: ConsumedStatus, attempts: number, error?: string | null) {
    this.consumed.set(id, { status, attempts, error });
  }
  async clearAll() {}
}

function storeRow(n: number, type: string, from: string | null, to: string, seq: number, slug = "baqala-noor"): MarketplaceOutboxRow {
  return {
    outbox_id: `00000000-0000-4000-8000-00000000000${n}`,
    event_type: `marketplace.store_${type}`,
    event_version: "v1",
    aggregate_type: "store",
    aggregate_id: STORE_ID,
    data: { store_id: STORE_ID, store_slug: slug, owner_public_id: "WS-0000000001", category_slug: "groceries", from_state: from, to_state: to, state_sequence: seq, actor_type: "moderator", occurred_for: "2026-10-01T00:00:00Z" },
    occurred_at: "2026-10-01T00:00:00Z",
    created_at: `2026-10-01T00:0${n}:00Z`,
    commit_sequence: String(n),
    trace_id: null,
  } as unknown as MarketplaceOutboxRow;
}

function relayDeps(rows: MarketplaceOutboxRow[], stores: FakeStoreCatalog, mem: MemStore): RelayDeps {
  return { events: new MemEvents(rows), catalog: { getProduct: async () => null }, storeCatalog: stores, store: mem, config: { ...DEFAULT_RELAY_CONFIG, maxAttempts: 3 } };
}

const NAMES: CatalogStore = { store_id: STORE_ID, store_slug: "baqala-noor", title_ar: "بقالة النور", title_en: null, title_ur: null };

describe("relay — store names are fetched on approval, before any mutation", () => {
  it("registered → no fetch; approved → one fetch and a doc", async () => {
    const stores = new FakeStoreCatalog().set(NAMES);
    const mem = new MemStore();
    await runRelayBatch(relayDeps([storeRow(1, "registered", null, "pending_review", 1), storeRow(2, "approved", "pending_review", "approved", 2)], stores, mem));
    expect(stores.calls).toEqual(["baqala-noor"]);
    expect(mem.storeDocs.get(STORE_ID)?.title_ar).toBe("بقالة النور");
  });

  it("a failed fetch leaves the event pending and the store state unchanged", async () => {
    const stores = new FakeStoreCatalog().set(NAMES);
    stores.failNext = 1;
    const mem = new MemStore();
    await runRelayBatch(relayDeps([storeRow(1, "registered", null, "pending_review", 1), storeRow(2, "approved", "pending_review", "approved", 2)], stores, mem));
    expect(mem.stores.get(STORE_ID)?.store_state).toBe("pending_review");
    expect(mem.storeDocs.size).toBe(0);
    expect(mem.consumed.get("00000000-0000-4000-8000-000000000002")?.status).not.toBe("applied");
  });

  it("404 from marketplace is not a silent empty name — the event does not apply", async () => {
    const mem = new MemStore();
    await runRelayBatch(relayDeps([storeRow(2, "approved", "pending_review", "approved", 2)], new FakeStoreCatalog(), mem));
    expect(mem.storeDocs.size).toBe(0);
    expect(mem.consumed.get("00000000-0000-4000-8000-000000000002")?.status).not.toBe("applied");
  });

  it("contract drift (resource slug ≠ event slug) is refused", async () => {
    const stores = new FakeStoreCatalog().set({ ...NAMES, store_slug: "baqala-noor", store_id: "a0000000-0000-4000-8000-0000000000ff" });
    const mem = new MemStore();
    await runRelayBatch(relayDeps([storeRow(2, "approved", "pending_review", "approved", 2)], stores, mem));
    expect(mem.storeDocs.size).toBe(0);
    expect(mem.consumed.get("00000000-0000-4000-8000-000000000002")?.error ?? "").toMatch(/drift/);
  });

  it("a doc already present is not refetched (re-approval after suspension)", async () => {
    const stores = new FakeStoreCatalog().set(NAMES);
    const mem = new MemStore();
    await runRelayBatch(
      relayDeps([
        storeRow(1, "approved", "pending_review", "approved", 2),
        storeRow(2, "suspended", "approved", "suspended", 3),
        storeRow(3, "approved", "suspended", "approved", 4),
      ], stores, mem),
    );
    expect(stores.calls).toEqual(["baqala-noor"]);
  });
});

// ── HTTP route: validation + projection ──────────────────────────────────

describe("GET /search/stores — HTTP", () => {
  const leakyPort: SearchStoresReadPort = {
    async searchStores(q) {
      // A port that returns more than it should: the route must still emit three fields.
      return {
        items: [{ store_slug: "s", title: "t", category_slug: "c", owner_public_id: "WS-1", store_state: "approved" } as never],
        page: q.page,
        page_size: q.pageSize,
        total: 1,
      };
    },
  };

  it("emits exactly the public projection even if the port over-returns", async () => {
    const { fastify, close } = buildEnforcedApp({ searchReadPort: fakeEmptyReadPort(), storeSearchReadPort: leakyPort });
    try {
      const res = await inject(fastify, { method: "GET", url: "/search/stores", query: { q: "نور" } });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<Record<string, unknown>> };
      expect(Object.keys(body).sort()).toEqual(["items", "page", "page_size", "total"]);
      expect(Object.keys(body.items[0]!)).toEqual([...STORE_SEARCH_RESULT_FIELDS]);
      expect(res.body).not.toMatch(/owner_public_id|store_state/);
    } finally {
      await close();
    }
  });

  it.each([
    [{ q: "ـ" }, "SEARCH_QUERY_EMPTY"],
    [{ q: "ب".repeat(201) }, "SEARCH_QUERY_TOO_LONG"],
    [{ q: "نور", owner_public_id: "WS-1" }, "SEARCH_UNKNOWN_PARAMETER"],
    [{ q: "نور", state: "approved" }, "SEARCH_UNKNOWN_PARAMETER"],
    [{ q: "نور", page: "0" }, "SEARCH_PAGE_OUT_OF_RANGE"],
    [{ q: "نور", page: "-3" }, "SEARCH_PAGE_OUT_OF_RANGE"],
    [{ q: "نور", page: "1.5" }, "SEARCH_PAGE_OUT_OF_RANGE"],
    [{ q: "نور", page_size: "0" }, "SEARCH_PAGE_SIZE_INVALID"],
    [{ q: "نور", page_size: "51" }, "SEARCH_PAGE_SIZE_INVALID"],
    [{ q: "نور", locale: "fr" }, "SEARCH_UNSUPPORTED_LOCALE"],
  ])("400 %j → %s", async (query, code) => {
    const { fastify, close } = buildEnforcedApp({ searchReadPort: fakeEmptyReadPort(), storeSearchReadPort: leakyPort });
    try {
      const res = await inject(fastify, { method: "GET", url: "/search/stores", query });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { code: string }).code).toBe(code);
    } finally {
      await close();
    }
  });

  it("503 — not an empty page — when no store search port is composed", async () => {
    const { fastify, close } = buildEnforcedApp({ searchReadPort: fakeEmptyReadPort() });
    try {
      const res = await inject(fastify, { method: "GET", url: "/search/stores", query: { q: "نور" } });
      expect(res.statusCode).toBe(503);
    } finally {
      await close();
    }
  });
});
