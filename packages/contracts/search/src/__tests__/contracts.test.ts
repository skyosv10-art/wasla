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
