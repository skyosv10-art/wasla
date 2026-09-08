/**
 * Relay unit tests (review 2/N) — reliability guarantees with in-memory fakes.
 *
 * Covers: end-to-end (outbox → relay → index doc), idempotency (duplicate
 * delivery), retry (retryable failure → pending → retry → applied), poison
 * (max attempts → dead-letter), version guard (unknown version → poisoned),
 * and stale ordering (skipped_stale). No database required.
 */

import { describe, expect, it } from "vitest";
import { runRelayBatch, DEFAULT_RELAY_CONFIG, type RelayDeps, type RelayLogEntry } from "../relay.js";
import type { MarketplaceEventSource, CatalogReadPort, ProjectionStore } from "../ports.js";
import type { MarketplaceOutboxRow, RelayCheckpoint, ConsumedStatus, CatalogProduct } from "../domain/consumed-events.js";
import type { StoreProjection, ProductProjection } from "../domain/projector.js";

// ── In-memory fakes ──────────────────────────────────────────────────

class FakeEventSource implements MarketplaceEventSource {
  private rows: MarketplaceOutboxRow[];
  constructor(rows: MarketplaceOutboxRow[]) { this.rows = [...rows]; }
  async readAfter(checkpoint: RelayCheckpoint | null, limit: number): Promise<readonly MarketplaceOutboxRow[]> {
    if (!checkpoint) return this.rows.slice(0, limit);
    const idx = this.rows.findIndex((r) => r.outbox_id === checkpoint!.last_outbox_id);
    return this.rows.slice(idx + 1, idx + 1 + limit);
  }
}

class FakeCatalog implements CatalogReadPort {
  public calls = 0;
  public failNTimes = 0;
  private data = new Map<string, CatalogProduct>();
  set(p: CatalogProduct) { this.data.set(p.product_id, p); }
  async getProduct(productId: string): Promise<CatalogProduct | null> {
    this.calls += 1;
    if (this.failNTimes > 0) { this.failNTimes -= 1; throw new Error("transient catalog failure"); }
    return this.data.get(productId) ?? null;
  }
}

class FakeStore implements ProjectionStore {
  checkpoint: RelayCheckpoint | null = null;
  consumed = new Map<string, { status: ConsumedStatus; attempts: number; error?: string | null }>();
  stores = new Map<string, StoreProjection>();
  products = new Map<string, ProductProjection>();
  docs = new Map<string, { catalog: CatalogProduct; storeState: string; projection: ProductProjection }>();
  logs: RelayLogEntry[] = [];

  async getCheckpoint() { return this.checkpoint; }
  async writeCheckpoint(_c: string, cp: RelayCheckpoint) { this.checkpoint = cp; }
  async getStoreProjection(id: string) { return this.stores.get(id) ?? null; }
  async getProductProjection(id: string) { return this.products.get(id) ?? null; }
  async upsertStoreState(r: StoreProjection) { this.stores.set(r.store_id, r); }
  async upsertProductState(r: ProductProjection) { this.products.set(r.product_id, r); }
  async hasIndexDoc(id: string) { return this.docs.has(id); }
  async upsertIndexDoc(catalog: CatalogProduct, projection: ProductProjection, storeState: string) {
    this.docs.set(catalog.product_id, { catalog, storeState, projection });
  }
  async refreshProductStateColumns(id: string, projection: ProductProjection) {
    const d = this.docs.get(id);
    if (d) this.docs.set(id, { ...d, projection });
  }
  async updateStoreStateOnDocs(storeId: string, storeState: string) {
    for (const d of this.docs.values()) if (d.catalog.store_id === storeId) d.storeState = storeState;
  }
  async archiveProductDoc(id: string, archivedAt: string) {
    const d = this.docs.get(id);
    if (d) this.docs.set(id, { ...d, projection: { ...d.projection, archived_at: archivedAt } });
  }
  async getConsumed(id: string) { return this.consumed.has(id) ? { status: this.consumed.get(id)!.status, attempt_count: this.consumed.get(id)!.attempts } : null; }
  async markConsumed(id: string, _row: unknown, status: ConsumedStatus, attempts: number, error?: string | null) {
    this.consumed.set(id, { status, attempts, error });
  }
  async clearAll() {
    this.checkpoint = null; this.consumed.clear(); this.stores.clear();
    this.products.clear(); this.docs.clear();
  }
}

function deps(rows: MarketplaceOutboxRow[], catalog: FakeCatalog, store: FakeStore): RelayDeps {
  return { events: new FakeEventSource(rows), catalog, store, config: { ...DEFAULT_RELAY_CONFIG, maxAttempts: 2 } };
}

// ── Fixtures ─────────────────────────────────────────────────────────

const STORE_ID = "11111111-1111-1111-1111-111111111111";
const PRODUCT_ID = "22222222-2222-2222-2222-222222222222";
const OID = (n: number) => `${String(n).padStart(8, "0")}-0000-0000-0000-000000000000`;

function row(n: number, eventType: string, data: Record<string, unknown>, aggregateType = "store"): MarketplaceOutboxRow {
  return {
    outbox_id: OID(n), event_type: eventType as MarketplaceOutboxRow["event_type"],
    event_version: "v1", aggregate_type: aggregateType, aggregate_id: STORE_ID,
    occurred_at: `2026-01-0${n}T00:00:00.000Z`, created_at: `2026-01-0${n}T00:00:00.000Z`,
    data,
  };
}

const happyPath: MarketplaceOutboxRow[] = [
  row(1, "marketplace.store_registered", { store_id: STORE_ID, store_slug: "acme", owner_public_id: "WS-0000000001", category_slug: "electronics", to_state: "pending_review", state_sequence: 1, actor_type: "owner", occurred_for: "2026-01-01T00:00:00Z" }),
  row(2, "marketplace.store_approved", { store_id: STORE_ID, store_slug: "acme", owner_public_id: "WS-0000000001", category_slug: "electronics", from_state: "pending_review", to_state: "approved", state_sequence: 2, actor_type: "moderator", occurred_for: "2026-01-02T00:00:00Z" }),
  row(3, "marketplace.product_created", { product_id: PRODUCT_ID, store_id: STORE_ID, store_slug: "acme", sku: "sku-1", category_slug: "electronics", state: "draft", moderation_state: "pending", created_by_public_id: "WS-0000000001", occurred_for: "2026-01-03T00:00:00Z" }, "product"),
  row(4, "marketplace.product_moderated", { product_id: PRODUCT_ID, store_id: STORE_ID, store_slug: "acme", to_state: "approved", moderation_sequence: 1, actor_type: "moderator", occurred_for: "2026-01-04T00:00:00Z" }, "product"),
  row(5, "marketplace.product_published", { product_id: PRODUCT_ID, store_id: STORE_ID, store_slug: "acme", category_slug: "electronics", from_state: "draft", to_state: "published", store_state: "approved", quantity_on_hand: 5, actor_public_id: "WS-0000000001", occurred_for: "2026-01-05T00:00:00Z" }, "product"),
];

const catalogProduct: CatalogProduct = {
  product_id: PRODUCT_ID, store_id: STORE_ID, store_slug: "acme", sku: "sku-1",
  category_slug: "electronics", title_ar: "هاتف ذكي", title_en: "Smart Phone",
  price_minor_units: 50000, currency_code: "SAR",
};

// ── Tests ────────────────────────────────────────────────────────────

describe("relay — end-to-end: outbox event → relay → search read model", () => {
  it("builds a visible index doc with correct state after the happy path", async () => {
    const catalog = new FakeCatalog(); catalog.set(catalogProduct);
    const store = new FakeStore();
    const outcome = await runRelayBatch(deps(happyPath, catalog, store));
    expect(outcome.applied).toBe(5);
    const doc = store.docs.get(PRODUCT_ID);
    expect(doc).toBeDefined();
    expect(doc?.catalog.title_ar).toBe("هاتف ذكي");
    expect(doc?.storeState).toBe("approved");
    expect(doc?.projection.product_state).toBe("published");
    expect(doc?.projection.moderation_state).toBe("approved");
    expect(doc?.projection.quantity_on_hand).toBe(5);
    expect(catalog.calls).toBe(1); // fetched once when became visible
  });
});

describe("relay — idempotency (duplicate delivery)", () => {
  it("re-running the same batch is a no-op for already-applied rows", async () => {
    const catalog = new FakeCatalog(); catalog.set(catalogProduct);
    const store = new FakeStore();
    await runRelayBatch(deps(happyPath, catalog, store));
    const callsAfterFirst = catalog.calls;
    // Re-read the SAME rows from zero (replay / duplicate delivery): the
    // checkpoint is reset so the identical rows are re-delivered.
    store.checkpoint = null;
    await runRelayBatch(deps(happyPath, catalog, store));
    expect(catalog.calls).toBe(callsAfterFirst); // not fetched again
    expect(store.docs.size).toBe(1);
    // every row is now terminal (applied / skipped_stale)
    for (const id of happyPath.map((r) => r.outbox_id)) {
      const c = store.consumed.get(id)!;
      expect(c.status === "applied" || c.status === "skipped_stale").toBe(true);
    }
  });
});

describe("relay — version compatibility (req 11)", () => {
  it("unknown event_version is poisoned, never silently dropped", async () => {
    const bad: MarketplaceOutboxRow = { ...row(9, "marketplace.product_created", {}, "product"), event_version: "v2" };
    const catalog = new FakeCatalog(); const store = new FakeStore();
    const outcome = await runRelayBatch(deps([bad], catalog, store));
    expect(outcome.poisoned).toBe(1);
    expect(store.consumed.get(OID(9))?.status).toBe("poisoned");
  });
});

describe("relay — retry + poison (req 6,7,8)", () => {
  it("transient catalog failure retries then succeeds", async () => {
    const catalog = new FakeCatalog(); catalog.set(catalogProduct); catalog.failNTimes = 1;
    const store = new FakeStore();
    const first = await runRelayBatch(deps(happyPath, catalog, store));
    // product_published failed once (pending), then retry on next batch.
    expect(first.processed).toBe(5);
    // run a second batch — the pending row is retried and now succeeds.
    await runRelayBatch(deps(happyPath, catalog, store));
    expect(catalog.calls).toBeGreaterThanOrEqual(1);
    expect(store.docs.get(PRODUCT_ID)).toBeDefined();
  });

  it("exhausting max attempts poisons the event (dead-letter) without blocking the stream", async () => {
    const catalog = new FakeCatalog(); catalog.failNTimes = 99; // never succeeds
    const store = new FakeStore();
    const d = deps(happyPath, catalog, store);
    // First batch: product_published goes pending (retryable). The checkpoint
    // does NOT advance past it, so it is retried.
    await runRelayBatch(d);
    const stalled = store.consumed.get(OID(5))?.status;
    expect(stalled === "pending" || stalled === "poisoned").toBe(true);
    // Keep retrying until poisoned.
    for (let i = 0; i < 5; i++) await runRelayBatch(d);
    expect(store.consumed.get(OID(5))?.status).toBe("poisoned");
  });
});

describe("relay — stale ordering (req 5)", () => {
  it("an older-sequence store event is skipped_stale, not applied", async () => {
    const catalog = new FakeCatalog(); const store = new FakeStore();
    // approved (seq 2) then an older registered (seq 1) delivered late.
    const reordered = [happyPath[1], happyPath[0]];
    await runRelayBatch(deps(reordered, catalog, store));
    expect(store.stores.get(STORE_ID)?.state_sequence).toBe(2);
    expect(store.consumed.get(OID(1))?.status).toBe("skipped_stale");
  });
});

describe("relay — store state change hides visible products (req: visibility derived)", () => {
  it("store_suspended updates store_state on docs so the WHERE filter hides them", async () => {
    const catalog = new FakeCatalog(); catalog.set(catalogProduct);
    const store = new FakeStore();
    await runRelayBatch(deps(happyPath, catalog, store));
    expect(store.docs.get(PRODUCT_ID)?.storeState).toBe("approved");
    const suspended: MarketplaceOutboxRow = row(6, "marketplace.store_suspended", { store_id: STORE_ID, store_slug: "acme", owner_public_id: "WS-0000000001", category_slug: "electronics", from_state: "approved", to_state: "suspended", state_sequence: 3, actor_type: "moderator", occurred_for: "2026-01-06T00:00:00Z" });
    await runRelayBatch(deps([...happyPath, suspended], catalog, store));
    expect(store.docs.get(PRODUCT_ID)?.storeState).toBe("suspended");
  });
});
