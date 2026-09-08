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

  it("schema uses integer halalas for price, not floating point (ADR-016 decision 4)", () => {
    expect(schemaCode).toMatch(/price_minor_units\s+INTEGER/);
    expect(schemaCode).toMatch(/currency_code\s+TEXT\s+NOT NULL CHECK \(currency_code = 'SAR'\)/);
  });

  it("api declares the search endpoint and health check", () => {
    expect(api).toMatch(/\/search\/products/);
    expect(api).toMatch(/\/search\/health/);
    expect(api).toMatch(/operationId: searchProducts/);
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
