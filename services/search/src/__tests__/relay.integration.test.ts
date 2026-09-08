/**
 * Relay integration test (review 2/N, req 15,16). End-to-end with PostgreSQL:
 *   marketplace_outbox event → relay → search read model → correct state.
 *
 * Uses the real Postgres adapters (PostgresMarketplaceEventSource +
 * PostgresProjectionStore) with a fake catalog port (the marketplace HTTP
 * service is not running; ADR-025 sanctions GET /products/{productId} as the
 * read port — tested in isolation, here stubbed). SKIPS when DATABASE_URL is
 * unset (see docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md).
 *
 * Regression: duplicate delivery (idempotency), reorder (stale sequence),
 * and full replay (rebuildAll).
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  PG_ENABLED,
  setupPostgres,
  resetData,
  seedOutboxEvent,
  T0,
  type PgFixture,
} from "./pg-harness.js";
import { PostgresMarketplaceEventSource } from "../infrastructure/marketplace-event-source.js";
import { PostgresProjectionStore } from "../infrastructure/projection-store.js";
import { runRelayBatch, rebuildAll, DEFAULT_RELAY_CONFIG } from "../relay.js";
import type { CatalogReadPort } from "../ports.js";
import type { CatalogProduct } from "../domain/consumed-events.js";

const STORE_ID = "11111111-1111-1111-1111-111111111111";
const PRODUCT_ID = "22222222-2222-2222-2222-222222222222";

const catalogProduct: CatalogProduct = {
  product_id: PRODUCT_ID, store_id: STORE_ID, store_slug: "acme", sku: "sku-1",
  category_slug: "electronics", title_ar: "هاتف ذكي", title_en: "Smart Phone",
  price_minor_units: 50000, currency_code: "SAR",
};

class FakeCatalog implements CatalogReadPort {
  private data = new Map<string, CatalogProduct>();
  set(p: CatalogProduct) { this.data.set(p.product_id, p); }
  async getProduct(id: string) { return this.data.get(id) ?? null; }
}

async function seedHappyPath(pool: PgFixture["pool"]): Promise<string[]> {
  const ids: string[] = [];
  const ts = (n: number) => new Date(Date.parse(T0) + n * 60_000).toISOString();
  const e1 = await seedOutboxEvent(pool, { event_type: "marketplace.store_registered", aggregate_type: "store", aggregate_id: STORE_ID, occurred_at: ts(0), created_at: ts(0), payload: { store_id: STORE_ID, store_slug: "acme", owner_public_id: "WS-0000000001", category_slug: "electronics", to_state: "pending_review", state_sequence: 1, actor_type: "owner", occurred_for: ts(0) } });
  ids.push(e1.outbox_id);
  const e2 = await seedOutboxEvent(pool, { event_type: "marketplace.store_approved", aggregate_type: "store", aggregate_id: STORE_ID, occurred_at: ts(1), created_at: ts(1), payload: { store_id: STORE_ID, store_slug: "acme", owner_public_id: "WS-0000000001", category_slug: "electronics", from_state: "pending_review", to_state: "approved", state_sequence: 2, actor_type: "moderator", occurred_for: ts(1) } });
  ids.push(e2.outbox_id);
  const e3 = await seedOutboxEvent(pool, { event_type: "marketplace.product_created", aggregate_type: "product", aggregate_id: PRODUCT_ID, occurred_at: ts(2), created_at: ts(2), payload: { product_id: PRODUCT_ID, store_id: STORE_ID, store_slug: "acme", sku: "sku-1", category_slug: "electronics", state: "draft", moderation_state: "pending", created_by_public_id: "WS-0000000001", occurred_for: ts(2) } });
  ids.push(e3.outbox_id);
  const e4 = await seedOutboxEvent(pool, { event_type: "marketplace.product_moderated", aggregate_type: "product", aggregate_id: PRODUCT_ID, occurred_at: ts(3), created_at: ts(3), payload: { product_id: PRODUCT_ID, store_id: STORE_ID, store_slug: "acme", from_state: "pending", to_state: "approved", moderation_sequence: 1, actor_type: "moderator", occurred_for: ts(3) } });
  ids.push(e4.outbox_id);
  const e5 = await seedOutboxEvent(pool, { event_type: "marketplace.product_published", aggregate_type: "product", aggregate_id: PRODUCT_ID, occurred_at: ts(4), created_at: ts(4), payload: { product_id: PRODUCT_ID, store_id: STORE_ID, store_slug: "acme", category_slug: "electronics", from_state: "draft", to_state: "published", store_state: "approved", quantity_on_hand: 5, actor_public_id: "WS-0000000001", occurred_for: ts(4) } });
  ids.push(e5.outbox_id);
  return ids;
}

(PG_ENABLED ? describe : describe.skip)("relay integration — PostgreSQL end-to-end", () => {
  let pool: PgFixture["pool"];
  let close: () => Promise<void>;
  let store: PostgresProjectionStore;
  let catalog: FakeCatalog;

  beforeEach(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool; close = fixture.close;
    store = new PostgresProjectionStore(pool);
    catalog = new FakeCatalog(); catalog.set(catalogProduct);
    await resetData(pool);
  });
  afterEach(async () => { await close(); });

  it("projects a visible index doc with correct state (outbox → relay → read model)", async () => {
    await seedHappyPath(pool);
    const deps = { events: new PostgresMarketplaceEventSource(pool), catalog, store, config: DEFAULT_RELAY_CONFIG };
    const outcome = await runRelayBatch(deps);
    expect(outcome.applied).toBe(5);
    const docs = await store.listVisibleIndexDocs();
    expect(docs.length).toBe(1);
    expect(docs[0].title_ar).toBe("هاتف ذكي");
    expect(docs[0].price_minor_units).toBe(50000);
    expect(docs[0].category_slug).toBe("electronics");
  });

  it("duplicate delivery is idempotent (re-running is a no-op)", async () => {
    await seedHappyPath(pool);
    const deps = { events: new PostgresMarketplaceEventSource(pool), catalog, store, config: DEFAULT_RELAY_CONFIG };
    const first = await runRelayBatch(deps);
    expect(first.applied).toBe(5);
    const second = await runRelayBatch(deps);
    expect(second.processed).toBe(0); // checkpoint already at the tail
    expect(second.applied).toBe(0);
    const docs = await store.listVisibleIndexDocs();
    expect(docs.length).toBe(1);
  });

  it("reorder: an older-sequence event delivered late is skipped_stale", async () => {
    await seedHappyPath(pool);
    // Append an out-of-order older store event (state_sequence 1, after seq 2).
    await seedOutboxEvent(pool, { event_type: "marketplace.store_registered", aggregate_type: "store", aggregate_id: STORE_ID, payload: { store_id: STORE_ID, store_slug: "acme", owner_public_id: "WS-0000000001", category_slug: "electronics", to_state: "pending_review", state_sequence: 1, actor_type: "owner", occurred_for: T0 } });
    const deps = { events: new PostgresMarketplaceEventSource(pool), catalog, store, config: DEFAULT_RELAY_CONFIG };
    const outcome = await runRelayBatch(deps);
    expect(outcome.skipped).toBeGreaterThanOrEqual(1); // the stale event
    const docs = await store.listVisibleIndexDocs();
    expect(docs.length).toBe(1); // state not regressed
  });

  it("rebuildAll (replay) clears and re-projects from zero", async () => {
    await seedHappyPath(pool);
    const deps = { events: new PostgresMarketplaceEventSource(pool), catalog, store, config: DEFAULT_RELAY_CONFIG };
    await runRelayBatch(deps);
    await rebuildAll(deps); // clear + reset checkpoint
    const outcome = await runRelayBatch(deps);
    expect(outcome.applied).toBe(5);
    const docs = await store.listVisibleIndexDocs();
    expect(docs.length).toBe(1);
  });
});
