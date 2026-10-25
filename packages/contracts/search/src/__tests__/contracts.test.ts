import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = resolve(__dirname, "../../../../../services/search/contracts");

const schema = readFileSync(resolve(base, "schema.sql"), "utf8");
const api = readFileSync(resolve(base, "api.openapi.yml"), "utf8");
const eventsRaw = readFileSync(resolve(base, "events.json"), "utf8");
const events = JSON.parse(eventsRaw) as unknown;

/** Strip SQL comments so prose that mentions forbidden names in negation context is ignored. */
const schemaCode = schema.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

describe("search contracts — foundational invariants (ADR-025)", () => {
  it("schema declares the derived index table", () => {
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS search_product_index/);
  });

  it("schema declares an outbox for index lifecycle events", () => {
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS search_outbox/);
  });

  it("schema enables pg_trgm for Arabic/approximate matching", () => {
    expect(schemaCode).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  });

  it("schema has NO is_visible column — visibility is derived, never stored (ADR-025 §2.2)", () => {
    // The word may appear in prose comments (already stripped above). In code it must not.
    expect(schemaCode).not.toMatch(/is_visible/);
    expect(schemaCode).not.toMatch(/is_public/);
  });

  it("index carries state columns so visibility is derived at read time (ADR-025 §2.2)", () => {
    expect(schemaCode).toMatch(/store_state\s+TEXT\s+NOT NULL/);
    expect(schemaCode).toMatch(/product_state\s+TEXT\s+NOT NULL/);
    expect(schemaCode).toMatch(/moderation_state\s+TEXT\s+NOT NULL/);
    expect(schemaCode).toMatch(/quantity_on_hand\s+INTEGER\s+NOT NULL/);
  });

  it("index uses category_slug from the catalog port, not a fabricated category_id", () => {
    expect(schemaCode).toMatch(/category_slug\s+TEXT\s+NOT NULL/);
    expect(schemaCode).not.toMatch(/category_id/);
  });

  it("index uses sku (catalog identity), not a fabricated product_slug", () => {
    expect(schemaCode).toMatch(/\bsku\s+TEXT\s+NOT NULL/);
    expect(schemaCode).not.toMatch(/product_slug/);
  });

  it("schema declares projection state tables owned by search (ADR-025 §2.3)", () => {
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS search_marketplace_store_state/);
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS search_marketplace_product_state/);
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS search_relay_consumed_events/);
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS search_relay_checkpoint/);
  });

  it("relay state columns enforce a closed status set for idempotency and dead-letter", () => {
    expect(schemaCode).toMatch(/CHECK \(status IN \('pending','applied','skipped','skipped_stale','ignored','poisoned'\)\)/);
    expect(schemaCode).toMatch(/attempt_count\s+INTEGER\s+NOT NULL DEFAULT 0/);
  });

  it("schema uses integer halalas for price, not floating point (ADR-016 decision 4)", () => {
    expect(schemaCode).toMatch(/price_minor_units\s+INTEGER/);
    expect(schemaCode).toMatch(/currency_code\s+TEXT\s+NOT NULL CHECK \(currency_code = 'SAR'\)/);
  });

  it("api declares the search endpoint and health check", () => {
    expect(api).toMatch(/\/search\/products/);
    expect(api).toMatch(/\/search\/health/);
    expect(api).toMatch(/operationId: searchProducts/);
  });

  it("api result exposes sku and category_slug (catalog port identity, not fabricated ids)", () => {
    expect(api).toMatch(/sku:/);
    expect(api).toMatch(/category_slug:/);
    expect(api).not.toMatch(/category_id:/);
    expect(api).not.toMatch(/product_slug:/);
  });

  it("api price is integer halalas (catalog datum, not a transaction)", () => {
    expect(api).toMatch(/price_minor_units:/);
    expect(api).toMatch(/currency_code:\s*\{ type: string, const: SAR \}/);
  });

  it("events contract is a valid JSON Schema with versioned envelopes", () => {
    const e = events as { $schema?: string; $defs?: Record<string, unknown> };
    expect(e.$schema).toMatch(/json-schema/);
    expect(e.$defs?.EventEnvelope).toBeDefined();
    expect(e.$defs?.SearchIndexRebuiltV1).toBeDefined();
    expect(e.$defs?.SearchIndexDegradedV1).toBeDefined();
  });

  it("events producer is search-service (not marketplace — those are consumed, not produced)", () => {
    const e = events as { $defs?: { EventEnvelope?: { properties?: { producer?: { const?: string } } } } };
    expect(e.$defs?.EventEnvelope?.properties?.producer?.const).toBe("search-service");
  });
});

// ── G-S9.7 · CLM-0649 · ADR-025 §6: GET /search/stores ────────────────────
import {
  STORE_SEARCH_LIMITS,
  STORE_SEARCH_LOCALES,
  STORE_SEARCH_QUERY_KEYS,
  STORE_SEARCH_RESULT_FIELDS,
} from "../store-search.js";

/** The OpenAPI text block of one top-level path (until the next path key). */
function pathBlock(path: string): string {
  const start = api.indexOf(`\n  ${path}:\n`);
  if (start < 0) return "";
  const rest = api.slice(start + 1);
  const next = rest.slice(1).search(/\n  \/[^\n]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
function schemaBlock(name: string): string {
  const start = api.indexOf(`\n    ${name}:\n`);
  if (start < 0) return "";
  const rest = api.slice(start + 1);
  const next = rest.slice(1).search(/\n    [A-Za-z]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe("search contracts — store-name search (G-S9.7 · ADR-025 §6)", () => {
  const block = pathBlock("/search/stores");

  it("api declares GET /search/stores with operationId searchStores and its own scope", () => {
    expect(block).toMatch(/operationId: searchStores/);
    expect(block).toMatch(/ServiceAuth: \['search:stores:read'\]/);
  });

  it("declares exactly the query keys the constants list — no state/owner filter", () => {
    const names = [...block.matchAll(/- name: (\w+)/g)].map((m) => m[1]);
    expect(names).toEqual([...STORE_SEARCH_QUERY_KEYS]);
    expect(block).not.toMatch(/owner_public_id|store_state|name: state/);
  });

  /** One `- name: <key>` parameter block, up to the next parameter or `responses:`. */
  const param = (key: string): string => {
    const at = block.indexOf(`- name: ${key}\n`);
    if (at < 0) return "";
    const rest = block.slice(at + 1);
    const end = rest.search(/\n {8}- name: |\n {6}responses:/);
    return end < 0 ? rest : rest.slice(0, end);
  };
  const num = (b: string, field: string): number | undefined => {
    const m = b.match(new RegExp(`\\n\\s+${field}: (\\d+)`));
    return m ? Number(m[1]) : undefined;
  };

  it("the shared constants ARE the approved decision (CLM-0652 · ADR-025 §6.8) — q 1..200 · page ≥ 1 · page_size 1..50 = 20", () => {
    // Literal on purpose: these numbers are the owner's decision, the one place a
    // drifted constant that also drags OpenAPI along is still caught.
    expect({ ...STORE_SEARCH_LIMITS }).toEqual({
      qMinLength: 1,
      qMaxLength: 200,
      pageMin: 1,
      pageSizeMin: 1,
      pageSizeMax: 50,
      pageSizeDefault: 20,
    });
  });

  it("OpenAPI q / page / page_size bounds match the shared constants exactly", () => {
    const q = param("q");
    expect(num(q, "minLength")).toBe(STORE_SEARCH_LIMITS.qMinLength);
    expect(num(q, "maxLength")).toBe(STORE_SEARCH_LIMITS.qMaxLength);
    const page = param("page");
    expect(num(page, "minimum")).toBe(STORE_SEARCH_LIMITS.pageMin);
    expect(num(page, "default")).toBe(1);
    // No upper bound by decision — a `maximum` here would be a new policy.
    expect(num(page, "maximum")).toBeUndefined();
    const size = param("page_size");
    expect(num(size, "minimum")).toBe(STORE_SEARCH_LIMITS.pageSizeMin);
    expect(num(size, "maximum")).toBe(STORE_SEARCH_LIMITS.pageSizeMax);
    expect(num(size, "default")).toBe(STORE_SEARCH_LIMITS.pageSizeDefault);
  });

  it("the response page wrapper carries the same bounds (page unbounded, page_size ≤ 50)", () => {
    const pg = schemaBlock("StoreSearchPage");
    expect(pg).toMatch(/page: \{ type: integer, minimum: 1 \}/);
    expect(pg).toMatch(new RegExp(`page_size: \\{ type: integer, minimum: ${STORE_SEARCH_LIMITS.pageSizeMin}, maximum: ${STORE_SEARCH_LIMITS.pageSizeMax} \\}`));
  });

  it("the customer app's StoreSearch mirrors the same bounds (it cannot import this package — no app depends on @wasla/* today)", () => {
    const app = readFileSync(resolve(__dirname, "../../../../../apps/customer-mini-app/src/components/StoreSearch.tsx"), "utf8");
    const constant = (name: string): number | undefined => {
      const m = app.match(new RegExp(`export const ${name} = (\\d+);`));
      return m ? Number(m[1]) : undefined;
    };
    expect(constant("STORE_SEARCH_MIN_LENGTH")).toBe(STORE_SEARCH_LIMITS.qMinLength);
    expect(constant("STORE_SEARCH_MAX_LENGTH")).toBe(STORE_SEARCH_LIMITS.qMaxLength);
    expect(constant("STORE_SEARCH_PAGE_SIZE")).toBe(STORE_SEARCH_LIMITS.pageSizeDefault);
  });

  it("locale enum is ar/en/ur, default ar", () => {
    const loc = schemaBlock("StoreSearchLocale");
    expect(loc).toMatch(new RegExp(`enum: \\[${STORE_SEARCH_LOCALES.join(", ")}\\]`));
    expect(loc).toMatch(/default: ar/);
  });

  it("the public result is exactly store_slug/title/category_slug — closed to extra fields", () => {
    const res = schemaBlock("StoreSearchResult");
    expect(res).toMatch(/additionalProperties: false/);
    expect(res).toMatch(new RegExp(`required: \\[${STORE_SEARCH_RESULT_FIELDS.join(", ")}\\]`));
    const props = [...res.matchAll(/^ {8}(\w+): \{/gm)].map((m) => m[1]);
    expect(props).toEqual([...STORE_SEARCH_RESULT_FIELDS]);
    expect(res).not.toMatch(/^\s+owner_public_id:/m);
  });

  it("the page wrapper is closed too", () => {
    expect(schemaBlock("StoreSearchPage")).toMatch(/additionalProperties: false/);
  });

  it("schema has the derived store-name table and still no visibility flag", () => {
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS search_store_index/);
    const table = schemaCode.slice(schemaCode.indexOf("CREATE TABLE IF NOT EXISTS search_store_index"));
    const body = table.slice(0, table.indexOf(");"));
    expect(body).not.toMatch(/owner_public_id|is_visible|is_public|store_state|reviewed_at|staff/);
    expect(body).toMatch(/title_ar\s+TEXT\s+NOT NULL/);
    expect(body).toMatch(/title_en\s+TEXT/);
    expect(body).toMatch(/title_ur\s+TEXT/);
  });
});
