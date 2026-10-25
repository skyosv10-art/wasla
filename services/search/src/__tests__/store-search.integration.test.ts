/**
 * Store-name search — PostgreSQL integration (G-S9.7 · CLM-0649 · ADR-025 §6).
 *
 * End to end inside the search service, on real Postgres:
 *   marketplace_outbox events → relay (signed-store-port double) →
 *   search_store_index + consumed state → StoreSearchReader → HTTP route
 *   behind real service-identity verification.
 *
 * What this does NOT prove (recorded in the CLM-0649 evidence): the browser →
 * Channel Edge → search hop. That path needs T1 (isolated environment) and an
 * edge that mints/passes the service identity; it is not claimed here.
 *
 * SKIPS when DATABASE_URL is unset.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PG_ENABLED, resetData, seedOutboxEvent, setupPostgres, T0, type PgFixture } from "./pg-harness.js";
import { PostgresMarketplaceEventSource } from "../infrastructure/marketplace-event-source.js";
import { PostgresProjectionStore } from "../infrastructure/projection-store.js";
import {
  buildStoreSearchSql,
  STORE_ELIGIBILITY_SQL,
  StoreSearchReader,
} from "../infrastructure/store-search-reader.js";
import { DEFAULT_RELAY_CONFIG, rebuildAll, runRelayBatch, type RelayDeps } from "../relay.js";
import type { CatalogReadPort } from "../ports.js";
import type { CatalogProduct } from "../domain/consumed-events.js";
import { normalizeStoreName, parseStoreSearchRequest } from "../domain/store-search.js";
import { FakeStoreCatalog } from "./support/fake-store-catalog.js";
import { SEARCH_SCOPES } from "../http/service-identity.js";
import { buildEnforcedApp, fakeEmptyReadPort, inject, rawInject, signFor } from "./service-identity-support.js";

const OWNER = "WS-0000000001";

/** Deterministic UUIDs per (kind, n). */
const sid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pid = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

class FakeProducts implements CatalogReadPort {
  private readonly data = new Map<string, CatalogProduct>();
  set(p: CatalogProduct) {
    this.data.set(p.product_id, p);
  }
  async getProduct(id: string) {
    return this.data.get(id) ?? null;
  }
}

/** Seeds marketplace events with strictly increasing timestamps. */
class World {
  private tick = 0;
  private readonly seq = new Map<string, number>();
  readonly products = new FakeProducts();
  readonly stores = new FakeStoreCatalog();
  readonly outboxIds: string[] = [];

  constructor(private readonly pool: PgFixture["pool"]) {}

  private ts(): string {
    this.tick += 1;
    return new Date(Date.parse(T0) + this.tick * 60_000).toISOString();
  }

  private next(key: string): number {
    const n = (this.seq.get(key) ?? 0) + 1;
    this.seq.set(key, n);
    return n;
  }

  private async emit(event_type: string, aggregate_type: string, aggregate_id: string, payload: Record<string, unknown>) {
    const at = this.ts();
    const row = await seedOutboxEvent(this.pool, {
      event_type,
      aggregate_type,
      aggregate_id,
      occurred_at: at,
      created_at: at,
      payload: { ...payload, occurred_for: at },
    });
    this.outboxIds.push(row.outbox_id);
    return row;
  }

  /** Register a store with names in the fake signed read port. */
  async store(n: number, slug: string, names: { ar: string; en?: string | null; ur?: string | null }, category = "groceries") {
    this.stores.set({
      store_id: sid(n),
      store_slug: slug,
      title_ar: names.ar,
      title_en: names.en ?? null,
      title_ur: names.ur ?? null,
    });
    await this.emit("marketplace.store_registered", "store", sid(n), {
      store_id: sid(n), store_slug: slug, owner_public_id: OWNER, category_slug: category,
      to_state: "pending_review", state_sequence: this.next(`s${n}`), actor_type: "owner",
    });
    return { n, slug, category };
  }

  async storeDecision(s: { n: number; slug: string; category: string }, type: string, from: string, to: string) {
    await this.emit(`marketplace.store_${type}`, "store", sid(s.n), {
      store_id: sid(s.n), store_slug: s.slug, owner_public_id: OWNER, category_slug: s.category,
      from_state: from, to_state: to, state_sequence: this.next(`s${s.n}`), actor_type: "moderator",
    });
  }

  /** A product that ends visible: created → moderated(approved) → published(qty). */
  async visibleProduct(s: { n: number; slug: string; category: string }, p: number, qty = 5) {
    this.products.set({
      product_id: pid(p), store_id: sid(s.n), store_slug: s.slug, sku: `sku-${p}`,
      category_slug: s.category, title_ar: `منتج ${p}`, title_en: `Product ${p}`,
      price_minor_units: 1000, currency_code: "SAR",
    });
    await this.emit("marketplace.product_created", "product", pid(p), {
      product_id: pid(p), store_id: sid(s.n), store_slug: s.slug, sku: `sku-${p}`, category_slug: s.category,
      state: "draft", moderation_state: "pending", created_by_public_id: OWNER,
    });
    await this.emit("marketplace.product_moderated", "product", pid(p), {
      product_id: pid(p), store_id: sid(s.n), store_slug: s.slug, from_state: "pending", to_state: "approved",
      moderation_sequence: this.next(`m${p}`), actor_type: "moderator",
    });
    await this.emit("marketplace.product_published", "product", pid(p), {
      product_id: pid(p), store_id: sid(s.n), store_slug: s.slug, category_slug: s.category,
      from_state: "draft", to_state: "published", store_state: "approved", quantity_on_hand: qty, actor_public_id: OWNER,
    });
  }

  async inventory(s: { n: number }, p: number, delta: number, after: number) {
    await this.emit("marketplace.inventory_adjusted", "product", pid(p), {
      adjustment_id: crypto.randomUUID(), product_id: pid(p), store_id: sid(s.n), quantity_delta: delta,
      quantity_after: after, reason_code: delta < 0 ? "sale" : "restock", adjustment_sequence: this.next(`i${p}`),
      actor_public_id: OWNER,
    });
  }

  async archiveProduct(s: { n: number; slug: string }, p: number) {
    await this.emit("marketplace.product_archived", "product", pid(p), {
      product_id: pid(p), store_id: sid(s.n), store_slug: s.slug, from_state: "published", to_state: "archived",
      actor_public_id: OWNER,
    });
  }
}

async function drain(deps: RelayDeps): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const out = await runRelayBatch(deps);
    if (out.processed === 0) return;
  }
  throw new Error("relay did not drain");
}

(PG_ENABLED ? describe : describe.skip)("store-name search — PostgreSQL (G-S9.7 · ADR-025 §6)", () => {
  let pool: PgFixture["pool"];
  let close: () => Promise<void>;
  let world: World;
  let deps: RelayDeps;
  let reader: StoreSearchReader;

  const search = (raw: Record<string, unknown>) => reader.searchStores(parseStoreSearchRequest(raw));
  const slugs = async (raw: Record<string, unknown>) => (await search(raw)).items.map((i) => i.store_slug);

  beforeEach(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    close = fixture.close;
    await resetData(pool);
    world = new World(pool);
    deps = {
      events: new PostgresMarketplaceEventSource(pool),
      catalog: world.products,
      storeCatalog: world.stores,
      store: new PostgresProjectionStore(pool),
      config: DEFAULT_RELAY_CONFIG,
    };
    reader = new StoreSearchReader(pool);
  });
  afterEach(async () => {
    await close();
  });

  async function approvedWithProduct(n: number, slug: string, names: { ar: string; en?: string | null; ur?: string | null }) {
    const s = await world.store(n, slug, names);
    await world.storeDecision(s, "approved", "pending_review", "approved");
    await world.visibleProduct(s, n * 10 + 1);
    return s;
  }

  // ── eligibility ──────────────────────────────────────────────────────────

  it("an approved store with a visible product is found; the relay fetched its names once", async () => {
    await approvedWithProduct(1, "baqala-noor", { ar: "بقالة النور", en: "Noor Grocery" });
    await drain(deps);
    expect(await slugs({ q: "النور" })).toEqual(["baqala-noor"]);
    expect(world.stores.calls).toEqual(["baqala-noor"]);
    const row = await pool.query(`SELECT * FROM search_store_index`);
    expect(Object.keys(row.rows[0]).sort()).toEqual(
      ["name_norm_ar", "name_norm_en", "name_norm_ur", "store_id", "store_slug", "title_ar", "title_en", "title_ur"].sort(),
    );
  });

  it("a suspended store is excluded even with a visible product", async () => {
    const s = await approvedWithProduct(1, "baqala-noor", { ar: "بقالة النور" });
    await world.storeDecision(s, "suspended", "approved", "suspended");
    await drain(deps);
    expect(await slugs({ q: "النور" })).toEqual([]);
  });

  it("an archived store is excluded", async () => {
    const s = await approvedWithProduct(1, "baqala-noor", { ar: "بقالة النور" });
    await world.storeDecision(s, "suspended", "approved", "suspended");
    await world.storeDecision(s, "archived", "suspended", "archived");
    await drain(deps);
    expect(await slugs({ q: "النور" })).toEqual([]);
  });

  it("an approved store with no visible product is excluded (draft · moderation pending · zero stock)", async () => {
    const a = await world.store(1, "no-products", { ar: "متجر بلا منتجات" });
    await world.storeDecision(a, "approved", "pending_review", "approved");
    const b = await world.store(2, "zero-stock", { ar: "متجر مخزونه صفر" });
    await world.storeDecision(b, "approved", "pending_review", "approved");
    await world.visibleProduct(b, 21, 0);
    await drain(deps);
    expect(await slugs({ q: "متجر" })).toEqual([]);
  });

  it("a store never approved (pending_review) is excluded and its names are never fetched", async () => {
    await world.store(1, "pending-one", { ar: "متجر قيد المراجعة" });
    await drain(deps);
    expect(await slugs({ q: "متجر" })).toEqual([]);
    expect(world.stores.calls).toEqual([]);
  });

  it("losing the last visible product removes the store (stock → 0), restocking brings it back", async () => {
    const s = await approvedWithProduct(1, "baqala-noor", { ar: "بقالة النور" });
    await drain(deps);
    expect(await slugs({ q: "النور" })).toEqual(["baqala-noor"]);
    await world.inventory(s, 11, -5, 0);
    await drain(deps);
    expect(await slugs({ q: "النور" })).toEqual([]);
    await world.inventory(s, 11, 3, 3);
    await drain(deps);
    expect(await slugs({ q: "النور" })).toEqual(["baqala-noor"]);
  });

  it("archiving the last visible product removes the store", async () => {
    const s = await approvedWithProduct(1, "baqala-noor", { ar: "بقالة النور" });
    await world.archiveProduct(s, 11);
    await drain(deps);
    expect(await slugs({ q: "النور" })).toEqual([]);
  });

  // ── language, fallback, normalization ────────────────────────────────────

  it("matches across ar/en/ur names and returns the title in the requested locale", async () => {
    await approvedWithProduct(1, "noor", { ar: "بقالة النور", en: "Noor Grocery", ur: "نور کریانہ" });
    await drain(deps);
    for (const q of ["النور", "noor gro", "کریانہ"]) {
      expect(await slugs({ q }), q).toEqual(["noor"]);
    }
    expect((await search({ q: "noor", locale: "ar" })).items[0]!.title).toBe("بقالة النور");
    expect((await search({ q: "noor", locale: "en" })).items[0]!.title).toBe("Noor Grocery");
    expect((await search({ q: "noor", locale: "ur" })).items[0]!.title).toBe("نور کریانہ");
  });

  it("falls back to the Arabic title when the requested locale has no name", async () => {
    await approvedWithProduct(1, "ar-only", { ar: "متجر عربي فقط" });
    await drain(deps);
    expect((await search({ q: "عربي", locale: "en" })).items[0]!.title).toBe("متجر عربي فقط");
    expect((await search({ q: "عربي", locale: "ur" })).items[0]!.title).toBe("متجر عربي فقط");
  });

  it("declared Arabic folding: hamza forms, alef maqsura, teh marbuta, diacritics, case", async () => {
    await approvedWithProduct(1, "amal", { ar: "مكتبة الأمل", en: "AMAL Books" });
    await approvedWithProduct(2, "huda", { ar: "صيدلية الهدى" });
    await drain(deps);
    expect(await slugs({ q: "الامل" })).toEqual(["amal"]);
    expect(await slugs({ q: "مكتبه" })).toEqual(["amal"]);
    expect(await slugs({ q: "الهدي" })).toEqual(["huda"]);
    expect(await slugs({ q: "صَيدَلِيّة" })).toEqual(["huda"]);
    expect(await slugs({ q: "amal books" })).toEqual(["amal"]);
  });

  // ── literal metacharacters ───────────────────────────────────────────────

  it("treats %, _ and \\ in the query literally", async () => {
    await approvedWithProduct(1, "pct", { ar: "خصم 50% اليوم" });
    await approvedWithProduct(2, "under", { ar: "متجر_سريع" });
    await approvedWithProduct(3, "slash", { ar: "متجر\\مائل" });
    await approvedWithProduct(4, "plain", { ar: "متجر عادي جدا" });
    await drain(deps);
    expect(await slugs({ q: "%%" })).toEqual([]);
    expect(await slugs({ q: "50%" })).toEqual(["pct"]);
    expect(await slugs({ q: "__" })).toEqual([]);
    expect(await slugs({ q: "متجر_" })).toEqual(["under"]);
    expect(await slugs({ q: "\\م" })).toEqual(["slash"]);
  });

  // ── deterministic order + paging ─────────────────────────────────────────

  it("orders exact → prefix → contains, ties by store_slug ascending — stable across calls", async () => {
    await approvedWithProduct(1, "c-contains", { ar: "سوق الورد" });
    await approvedWithProduct(2, "b-prefix", { ar: "الورد للزهور" });
    await approvedWithProduct(3, "a-prefix", { ar: "الوردة الحمراء" });
    await approvedWithProduct(4, "z-exact", { ar: "الورد" });
    await drain(deps);
    const first = await slugs({ q: "الورد" });
    expect(first).toEqual(["z-exact", "a-prefix", "b-prefix", "c-contains"]);
    expect(await slugs({ q: "الورد" })).toEqual(first);
  });

  it("pages with a true total, including a page past the last match", async () => {
    for (let n = 1; n <= 5; n += 1) await approvedWithProduct(n, `shop-${n}`, { ar: `محل رقم ${n}` });
    await drain(deps);
    const p1 = await search({ q: "محل", page_size: "2" });
    const p3 = await search({ q: "محل", page_size: "2", page: "3" });
    const p9 = await search({ q: "محل", page_size: "2", page: "9" });
    expect(p1).toMatchObject({ page: 1, page_size: 2, total: 5 });
    expect(p1.items.map((i) => i.store_slug)).toEqual(["shop-1", "shop-2"]);
    expect(p3.items.map((i) => i.store_slug)).toEqual(["shop-5"]);
    expect(p9).toMatchObject({ items: [], page: 9, total: 5 });
  });

  // ── bounds of the approved decision (CLM-0652 · ADR-025 §6.8) ────────────

  it("q bounds on PostgreSQL: one character finds by containment; a 200-character name is matched exactly", async () => {
    const long = "ب".repeat(199) + "ن";
    await approvedWithProduct(1, "baqala-noor", { ar: "بقالة النور" });
    await approvedWithProduct(2, "long-name", { ar: long });
    await approvedWithProduct(3, "maktaba", { ar: "مكتبة" });
    await drain(deps);
    expect(await slugs({ q: "ن" })).toEqual(["baqala-noor", "long-name"]);
    expect(await slugs({ q: long })).toEqual(["long-name"]);
    expect(() => parseStoreSearchRequest({ q: long + "ب" })).toThrow(/200/);
  });

  it("paging: default page_size 20, page_size 1 and 50, pages past the end and a page at 2^53-1 (bigint offset) keep the true total", async () => {
    const N = 52;
    for (let n = 1; n <= N; n += 1) await approvedWithProduct(n, `shop-${String(n).padStart(2, "0")}`, { ar: `محل رقم ${n}` });
    await drain(deps);
    const dflt = await search({ q: "محل" });
    expect(dflt).toMatchObject({ page: 1, page_size: 20, total: N });
    expect(dflt.items).toHaveLength(20);
    const one = await search({ q: "محل", page_size: "1" });
    expect(one.items.map((i) => i.store_slug)).toEqual(["shop-01"]);
    const fifty = await search({ q: "محل", page_size: "50" });
    expect(fifty.items).toHaveLength(50);
    const fiftySecond = await search({ q: "محل", page_size: "50", page: "2" });
    expect(fiftySecond.items.map((i) => i.store_slug)).toEqual(["shop-51", "shop-52"]);
    // Pages beyond the old 50-page cap are valid now; past the last match → empty, true total.
    expect(await search({ q: "محل", page: "51" })).toMatchObject({ items: [], page: 51, total: N });
    const huge = await search({ q: "محل", page_size: "50", page: String(Number.MAX_SAFE_INTEGER) });
    expect(huge).toMatchObject({ items: [], page: Number.MAX_SAFE_INTEGER, page_size: 50, total: N });
  });

  // ── rebuild · duplicate delivery · stale event ───────────────────────────

  it("rebuildAll + replay refills the store-name model from events and the read port — no manual data", async () => {
    await approvedWithProduct(1, "baqala-noor", { ar: "بقالة النور" });
    await drain(deps);
    await rebuildAll(deps);
    expect((await pool.query(`SELECT count(*)::int AS n FROM search_store_index`)).rows[0].n).toBe(0);
    expect(await slugs({ q: "النور" })).toEqual([]);
    await drain(deps);
    expect(await slugs({ q: "النور" })).toEqual(["baqala-noor"]);
    expect(world.stores.calls).toEqual(["baqala-noor", "baqala-noor"]);
  });

  it("duplicate delivery is a no-op: re-running the relay neither duplicates nor refetches", async () => {
    await approvedWithProduct(1, "baqala-noor", { ar: "بقالة النور" });
    await drain(deps);
    await drain(deps);
    expect((await pool.query(`SELECT count(*)::int AS n FROM search_store_index`)).rows[0].n).toBe(1);
    expect(world.stores.calls).toEqual(["baqala-noor"]);
    expect((await search({ q: "النور" })).total).toBe(1);
  });

  it("a stale store event (older state_sequence) cannot re-approve a suspended store", async () => {
    const s = await approvedWithProduct(1, "baqala-noor", { ar: "بقالة النور" });
    await world.storeDecision(s, "suspended", "approved", "suspended"); // seq 3
    await drain(deps);
    // Replay an older approval (seq 2) as a new outbox row.
    await seedOutboxEvent(pool, {
      event_type: "marketplace.store_approved", aggregate_type: "store", aggregate_id: sid(1),
      occurred_at: new Date().toISOString(), created_at: new Date().toISOString(),
      payload: {
        store_id: sid(1), store_slug: "baqala-noor", owner_public_id: OWNER, category_slug: "groceries",
        from_state: "pending_review", to_state: "approved", state_sequence: 2, actor_type: "moderator",
        occurred_for: new Date().toISOString(),
      },
    });
    await drain(deps);
    expect(await slugs({ q: "النور" })).toEqual([]);
  });

  it("a failed name fetch leaves the approval pending and the projection untouched; retry applies it", async () => {
    const s = await world.store(1, "baqala-noor", { ar: "بقالة النور" });
    await world.storeDecision(s, "approved", "pending_review", "approved");
    world.stores.failNext = 1;
    await runRelayBatch(deps);
    const state = await pool.query(`SELECT store_state FROM search_marketplace_store_state WHERE store_id = $1`, [sid(1)]);
    expect(state.rows[0]?.store_state).toBe("pending_review");
    await world.visibleProduct(s, 11);
    await drain(deps);
    expect(await slugs({ q: "النور" })).toEqual(["baqala-noor"]);
  });

  // ── mutation sentinels: each predicate is load-bearing ───────────────────

  describe("mutation sentinels — a reader without the predicate leaks", () => {
    async function seedMixed() {
      const suspended = await approvedWithProduct(1, "suspended-one", { ar: "متجر موقوف" });
      await world.storeDecision(suspended, "suspended", "approved", "suspended");
      const empty = await world.store(2, "empty-one", { ar: "متجر فارغ" });
      await world.storeDecision(empty, "approved", "pending_review", "approved");
      await approvedWithProduct(3, "good-one", { ar: "متجر جيد" });
      await drain(deps);
    }

    it("without `store_state = 'approved'` the suspended store appears — the real reader hides it", async () => {
      await seedMixed();
      const mutated = new StoreSearchReader(pool, {
        eligibilitySql: STORE_ELIGIBILITY_SQL.replace("ss.store_state = 'approved'", "TRUE"),
      });
      const leaked = (await mutated.searchStores(parseStoreSearchRequest({ q: "متجر" }))).items.map((i) => i.store_slug);
      expect(leaked).toContain("suspended-one");
      expect(await slugs({ q: "متجر" })).toEqual(["good-one"]);
    });

    it("without the visible-product EXISTS the empty approved store appears — the real reader hides it", async () => {
      await seedMixed();
      const cut = STORE_ELIGIBILITY_SQL.slice(0, STORE_ELIGIBILITY_SQL.indexOf("AND EXISTS"));
      expect(buildStoreSearchSql(cut)).not.toMatch(/EXISTS/);
      const mutated = new StoreSearchReader(pool, { eligibilitySql: cut });
      const leaked = (await mutated.searchStores(parseStoreSearchRequest({ q: "متجر" }))).items.map((i) => i.store_slug);
      expect(leaked).toContain("empty-one");
      expect(await slugs({ q: "متجر" })).toEqual(["good-one"]);
    });

    it("without LIKE escaping `%%` matches every store — the real reader matches none", async () => {
      await seedMixed();
      const mutated = new StoreSearchReader(pool, { escape: (s) => s });
      const leaked = await mutated.searchStores(parseStoreSearchRequest({ q: "%%" }));
      expect(leaked.total).toBeGreaterThan(0);
      expect((await search({ q: "%%" })).total).toBe(0);
    });
  });

  // ── through the HTTP route with real service identity ────────────────────

  it("GET /search/stores over the real reader: three public fields only, scope enforced", async () => {
    await approvedWithProduct(1, "baqala-noor", { ar: "بقالة النور", en: "Noor Grocery" });
    await drain(deps);
    const { fastify, close: closeApp } = buildEnforcedApp({ searchReadPort: fakeEmptyReadPort(), storeSearchReadPort: reader });
    try {
      const q = encodeURIComponent("النور");
      const ok = await inject(fastify, { method: "GET", url: "/search/stores", query: { q: "النور", locale: "en" } });
      expect(ok.statusCode).toBe(200);
      const body = ok.json() as { items: Array<Record<string, unknown>>; total: number };
      expect(body.items).toEqual([{ store_slug: "baqala-noor", title: "Noor Grocery", category_slug: "groceries" }]);
      expect(JSON.stringify(body)).not.toMatch(/owner_public_id|store_state|title_ar|name_norm|store_id|WS-/);

      const target = `/search/stores?q=${q}`;
      const wrongScope = await fastify.inject({
        method: "GET",
        url: target,
        headers: signFor("GET", target, { scopes: [SEARCH_SCOPES.productsRead] }),
      });
      expect(wrongScope.statusCode).toBe(403);

      const anonymous = await rawInject(fastify, { method: "GET", url: target });
      expect(anonymous.statusCode).toBe(401);

      // Bounds through the route (CLM-0652): edges accepted, outside rejected, undeclared keys rejected.
      for (const query of <Array<Record<string, string>>>[{ q: "ن" }, { q: "ب".repeat(200) }, { q: "نور", page: "1" }, { q: "نور", page: "1000" }, { q: "نور", page_size: "1" }, { q: "نور", page_size: "50" }]) {
        const r = await inject(fastify, { method: "GET", url: "/search/stores", query });
        expect(r.statusCode, JSON.stringify(query).slice(0, 60)).toBe(200);
      }
      const noSize = await inject(fastify, { method: "GET", url: "/search/stores", query: { q: "نور" } });
      expect((noSize.json() as { page_size: number }).page_size).toBe(20);
      for (const [query, code] of [
        [{ q: "ب".repeat(201) }, "SEARCH_QUERY_TOO_LONG"],
        [{ q: "نور", page: "0" }, "SEARCH_PAGE_OUT_OF_RANGE"],
        [{ q: "نور", page: "-1" }, "SEARCH_PAGE_OUT_OF_RANGE"],
        [{ q: "نور", page: "2.5" }, "SEARCH_PAGE_OUT_OF_RANGE"],
        [{ q: "نور", page_size: "51" }, "SEARCH_PAGE_SIZE_INVALID"],
        [{ q: "نور", sort: "relevance" }, "SEARCH_UNKNOWN_PARAMETER"],
      ] as const) {
        const r = await inject(fastify, { method: "GET", url: "/search/stores", query });
        expect(r.statusCode).toBe(400);
        expect((r.json() as { code: string }).code).toBe(code);
      }
    } finally {
      await closeApp();
    }
  });

  it("normalizeStoreName is the single fold used by index and query", () => {
    expect(normalizeStoreName("مكتبة الأمل")).toBe(normalizeStoreName("مكتبه الامل"));
  });
});
