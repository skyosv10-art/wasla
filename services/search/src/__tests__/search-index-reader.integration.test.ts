/**
 * SearchIndexReader integration test (review 3/N). End-to-end with PostgreSQL:
 *   seed search_product_index rows → SearchIndexReader.search → correct results.
 *
 * Verifies the two-stage contract: the visibility WHERE hides non-visible docs
 * (out-of-stock / unapproved), the text match narrows candidates, and the domain
 * ranking scores + paginates. SKIPS when DATABASE_URL is unset, like the relay
 * integration test (see docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md).
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  PG_ENABLED,
  setupPostgres,
  resetData,
  type PgFixture,
} from "./pg-harness.js";
import { SearchIndexReader } from "../infrastructure/search-index-reader.js";
import { SearchIndexHealthProbe } from "../infrastructure/search-index-health-probe.js";

const VISIBLE_ID = "11111111-1111-1111-1111-111111111111";
const HIDDEN_ID = "22222222-2222-2222-2222-222222222222";
const STORE_ID = "33333333-3333-3333-3333-333333333333";

describe.runIf(PG_ENABLED)("SearchIndexReader (integration)", () => {
  let fixture: PgFixture;

  beforeEach(async () => {
    fixture = await setupPostgres();
    await resetData(fixture.pool);
  });

  afterEach(async () => {
    await fixture.close();
  });

  async function seedRow(row: Record<string, unknown>): Promise<void> {
    const cols = Object.keys(row);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    await fixture.pool.query(
      `INSERT INTO search_product_index (${cols.join(", ")}) VALUES (${placeholders})`,
      cols.map((c) => row[c]),
    );
  }

  function visibleProduct(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      product_id: VISIBLE_ID,
      store_id: STORE_ID,
      store_slug: "acme",
      sku: "sku-1",
      category_slug: "electronics",
      title_ar: "سماعة بلوتوث",
      title_en: "Bluetooth Headphones",
      price_minor_units: 15000,
      currency_code: "SAR",
      store_state: "approved",
      product_state: "published",
      moderation_state: "approved",
      quantity_on_hand: 5,
      indexed_at: "2026-03-01T00:00:00.000Z",
      archived_at: null,
      ...overrides,
    };
  }

  it("returns a visible product matching the query", async () => {
    await seedRow(visibleProduct());
    const reader = new SearchIndexReader(fixture.pool);

    const page = await reader.search({
      q: "سماعة",
      locale: "ar",
      categorySlug: null,
      page: 1,
      pageSize: 20,
      sort: "relevance",
    });

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].product_id).toBe(VISIBLE_ID);
    expect(page.items[0].title_ar).toBe("سماعة بلوتوث");
    expect(page.items[0].score).toBeGreaterThan(0);
    expect(page.page).toBe(1);
    expect(page.page_size).toBe(20);
  });

  it("hides a product that is out of stock (visibility WHERE)", async () => {
    await seedRow(visibleProduct({ quantity_on_hand: 0 }));
    const reader = new SearchIndexReader(fixture.pool);

    const page = await reader.search({
      q: "سماعة",
      locale: "ar",
      categorySlug: null,
      page: 1,
      pageSize: 20,
      sort: "relevance",
    });

    expect(page.total).toBe(0);
    expect(page.items).toHaveLength(0);
  });

  it("hides a product with unapproved moderation state", async () => {
    await seedRow(visibleProduct({ moderation_state: "pending" }));
    const reader = new SearchIndexReader(fixture.pool);

    const page = await reader.search({
      q: "سماعة",
      locale: "ar",
      categorySlug: null,
      page: 1,
      pageSize: 20,
      sort: "relevance",
    });

    expect(page.total).toBe(0);
  });

  it("filters by category_slug when provided", async () => {
    await seedRow(visibleProduct({ category_slug: "electronics" }));
    await seedRow(
      visibleProduct({
        product_id: HIDDEN_ID,
        sku: "sku-2",
        category_slug: "books",
        title_ar: "سماعة كتاب",
      }),
    );
    const reader = new SearchIndexReader(fixture.pool);

    const page = await reader.search({
      q: "سماعة",
      locale: "ar",
      categorySlug: "electronics",
      page: 1,
      pageSize: 20,
      sort: "relevance",
    });

    expect(page.total).toBe(1);
    expect(page.items[0].product_id).toBe(VISIBLE_ID);
  });

  it("paginates results", async () => {
    for (let i = 0; i < 3; i += 1) {
      await seedRow(
        visibleProduct({
          product_id: `11111111-1111-1111-1111-11111111111${i}`,
          sku: `sku-${i}`,
          title_ar: `سماعة بلوتوث ${i}`,
        }),
      );
    }
    const reader = new SearchIndexReader(fixture.pool);

    const first = await reader.search({
      q: "سماعة",
      locale: "ar",
      categorySlug: null,
      page: 1,
      pageSize: 2,
      sort: "relevance",
    });
    expect(first.total).toBe(3);
    expect(first.items).toHaveLength(2);

    const second = await reader.search({
      q: "سماعة",
      locale: "ar",
      categorySlug: null,
      page: 2,
      pageSize: 2,
      sort: "relevance",
    });
    expect(second.items).toHaveLength(1);
    expect(second.page).toBe(2);
  });

  it("sorts by price ascending", async () => {
    await seedRow(visibleProduct({ price_minor_units: 30000, sku: "a" }));
    await seedRow(
      visibleProduct({
        product_id: HIDDEN_ID,
        sku: "b",
        price_minor_units: 10000,
        title_ar: "سماعة رخيصة",
      }),
    );
    const reader = new SearchIndexReader(fixture.pool);

    const page = await reader.search({
      q: "سماعة",
      locale: "ar",
      categorySlug: null,
      page: 1,
      pageSize: 20,
      sort: "price_asc",
    });

    expect(page.total).toBe(2);
    expect(page.items[0].price_minor_units).toBe(10000);
    expect(page.items[1].price_minor_units).toBe(30000);
  });

  /*
   * RISK-0029. The old reader answered `total = candidates.length` under a hard
   * `LIMIT 500`, so a 2000-document corpus reported `total = 500`. These tests
   * use a deliberately TINY ranking window (10) so the same lie is reproducible
   * with 40 rows instead of 2000 — the defect was never about the number 500,
   * it was about the count being taken after the limit.
   */
  it("reports an EXACT total for matches beyond the ranking window", async () => {
    for (let i = 0; i < 40; i += 1) {
      await seedRow(
        visibleProduct({
          product_id: `11111111-1111-1111-1111-1111111${String(i).padStart(5, "0")}`,
          sku: `sku-${i}`,
          title_ar: `سماعة بلوتوث ${i}`,
        }),
      );
    }
    const reader = new SearchIndexReader(fixture.pool, { rankingWindow: 10 });

    const page = await reader.search({
      q: "سماعة",
      locale: "ar",
      categorySlug: null,
      page: 1,
      pageSize: 5,
      sort: "relevance",
    });

    // The window bounded the WORK (10 rows scored) — not the TRUTH.
    expect(page.total).toBe(40);
    expect(page.items).toHaveLength(5);
  });

  it("refuses a page that ends beyond the ranking window instead of truncating", async () => {
    for (let i = 0; i < 40; i += 1) {
      await seedRow(
        visibleProduct({
          product_id: `11111111-1111-1111-1111-2222222${String(i).padStart(5, "0")}`,
          sku: `sku-${i}`,
          title_ar: `سماعة بلوتوث ${i}`,
        }),
      );
    }
    const reader = new SearchIndexReader(fixture.pool, { rankingWindow: 10 });

    // page 3 × size 5 ends at row 15 > window 10.
    await expect(
      reader.search({
        q: "سماعة",
        locale: "ar",
        categorySlug: null,
        page: 3,
        pageSize: 5,
        sort: "relevance",
      }),
    ).rejects.toMatchObject({
      name: "SearchValidationError",
      code: "SEARCH_PAGE_OUT_OF_RANGE",
    });
  });

  it("serves the last page that fits exactly inside the window", async () => {
    for (let i = 0; i < 40; i += 1) {
      await seedRow(
        visibleProduct({
          product_id: `11111111-1111-1111-1111-3333333${String(i).padStart(5, "0")}`,
          sku: `sku-${i}`,
          title_ar: `سماعة بلوتوث ${i}`,
        }),
      );
    }
    const reader = new SearchIndexReader(fixture.pool, { rankingWindow: 10 });

    const page = await reader.search({
      q: "سماعة",
      locale: "ar",
      categorySlug: null,
      page: 2,
      pageSize: 5,
      sort: "relevance",
    });

    expect(page.items).toHaveLength(5);
    expect(page.total).toBe(40);
  });

  it("relevance order is stable across two identical requests", async () => {
    for (let i = 0; i < 12; i += 1) {
      await seedRow(
        visibleProduct({
          product_id: `11111111-1111-1111-1111-4444444${String(i).padStart(5, "0")}`,
          sku: `sku-${i}`,
          title_ar: "سماعة بلوتوث",
        }),
      );
    }
    const reader = new SearchIndexReader(fixture.pool);
    const query = {
      q: "سماعة",
      locale: "ar" as const,
      categorySlug: null,
      page: 1,
      pageSize: 12,
      sort: "relevance" as const,
    };

    const a = await reader.search(query);
    const b = await reader.search(query);

    // Equal scores must not reorder between calls, or pagination drops rows.
    expect(a.items.map((i) => i.product_id)).toEqual(
      b.items.map((i) => i.product_id),
    );
  });

  /*
   * RISK-0030. A readiness probe is only worth its name if it goes red on a
   * read model that is actually missing — so the unreachable case drops the
   * table rather than mocking a rejection.
   */
  it("readiness probe reports the index reachable with a document count", async () => {
    await seedRow(visibleProduct());
    const probe = new SearchIndexHealthProbe(fixture.pool, { error: () => {} });

    const health = await probe.probe();

    expect(health).toEqual({ index_reachable: true, indexed_documents: 1 });
  });

  it("readiness probe reports UNREACHABLE when the read model is missing", async () => {
    await fixture.pool.query("DROP TABLE IF EXISTS search_product_index CASCADE");
    const probe = new SearchIndexHealthProbe(fixture.pool, { error: () => {} });

    const health = await probe.probe();

    expect(health).toEqual({ index_reachable: false, indexed_documents: null });
  });
});
