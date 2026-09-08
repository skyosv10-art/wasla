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
});
