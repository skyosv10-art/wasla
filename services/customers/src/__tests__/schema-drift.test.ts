/**
 * Drift guard: the Drizzle projection must match the canonical DDL.
 *
 * `services/customers/contracts/schema.sql` is the source of truth (ADR-004 ·
 * ADR-009). A Drizzle schema that silently falls behind it is the classic
 * failure of this pattern — queries keep compiling, then fail at runtime, or
 * worse, read the wrong column and return a plausible answer. This test parses
 * the contract and compares table names and column sets, so drift breaks the
 * build instead of production.
 *
 * It also pins the four invariants of ADR-009 that a well-meaning refactor is
 * most likely to erase: no foreign key to identity, the exactly-two-stops
 * ordering, the price/shipment CHECKs, and the absence of raw customer text in
 * the outbox projection.
 *
 * Needs no database, which is why it lives in the default unit suite.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  customerOrderRequestStops,
  customerOrderRequests,
  customerOutbox,
  customerProfiles,
  customerSavedPlaces,
} from "../infrastructure/drizzle/schema.js";

// The suite runs from the package root, so the contract resolves from cwd.
const SCHEMA_SQL = readFileSync(
  resolve(process.cwd(), "contracts/schema.sql"),
  "utf8",
);

/** Column names declared for one table in the DDL, in declaration order. */
function ddlColumns(table: string): string[] {
  const match = new RegExp(
    `CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`,
    "u",
  ).exec(SCHEMA_SQL);
  if (match?.[1] === undefined) {
    throw new Error(`لم يُعثر على تعريف الجدول ${table} في العقد`);
  }

  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) =>
      /^[a-z_]+\s+(UUID|TEXT|JSONB|INTEGER|TIMESTAMPTZ|NUMERIC|BIGINT|BIGSERIAL)/u.test(
        line,
      ),
    )
    .map((line) => line.split(/\s+/u)[0] as string);
}

type AnyTable =
  | typeof customerProfiles
  | typeof customerSavedPlaces
  | typeof customerOrderRequests
  | typeof customerOrderRequestStops
  | typeof customerOutbox;

/** Column names of a Drizzle table, as they exist in Postgres. */
function drizzleColumns(table: AnyTable): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

const CASES = [
  { name: "customer_profiles", table: customerProfiles },
  { name: "customer_saved_places", table: customerSavedPlaces },
  { name: "customer_order_requests", table: customerOrderRequests },
  { name: "customer_order_request_stops", table: customerOrderRequestStops },
  { name: "customer_outbox", table: customerOutbox },
] as const;

describe("Drizzle projection ↔ canonical DDL", () => {
  it.each(CASES)("$name is projected under its contract name", ({ name, table }) => {
    expect(getTableName(table)).toBe(name);
  });

  it.each(CASES)("$name exposes exactly the contract's columns", ({ name, table }) => {
    expect([...drizzleColumns(table)].sort()).toEqual([...ddlColumns(name)].sort());
  });

  it("covers every table the contract declares", () => {
    const declared = [...SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gu)].map(
      (match) => match[1] as string,
    );
    expect([...declared].sort()).toEqual(CASES.map((c) => c.name).sort());
  });

  it("keeps the idempotency uniqueness the use cases rely on", () => {
    // Both are read back by findPlaceByIdempotencyKey /
    // findOrderRequestByIdempotencyKey; without them a retried request would
    // create a second order instead of returning the first.
    expect(SCHEMA_SQL).toMatch(
      /ux_customer_saved_places_idempotency\s*\n\s*ON customer_saved_places \(wasla_public_id, idempotency_key\)/u,
    );
    expect(SCHEMA_SQL).toMatch(
      /ux_customer_order_requests_idempotency\s*\n\s*ON customer_order_requests \(wasla_public_id, idempotency_key\)/u,
    );
  });

  it("keeps place labels unique case-insensitively per customer", () => {
    // findPlaceByLabel compares with lower(); a case-sensitive index would let
    // "المنزل" and "المنزل " style duplicates through in the ASCII case.
    expect(SCHEMA_SQL).toMatch(
      /ux_customer_saved_places_label\s*\n\s*ON customer_saved_places \(wasla_public_id, lower\(label\)\)/u,
    );
  });

  it("declares no foreign key to identity (ADR-009: wasla_public_id is opaque)", () => {
    // The service must not be able to block on the identity database.
    const references = [...SCHEMA_SQL.matchAll(/REFERENCES\s+(\w+)/gu)].map(
      (match) => match[1] as string,
    );
    expect(references).toEqual(["customer_order_requests"]);
    expect(SCHEMA_SQL).toMatch(/wasla_public_id\s+TEXT[\s\S]*?CHECK[\s\S]*?WS-/u);
  });

  it("keeps stops ordered and owned by their request", () => {
    expect(SCHEMA_SQL).toContain("ON DELETE CASCADE");
    expect(SCHEMA_SQL).toMatch(/PRIMARY KEY \(order_request_id, sequence\)/u);
    expect(drizzleColumns(customerOrderRequestStops)).toContain("sequence");
  });

  it("keeps the price and shipment CHECKs that the domain also enforces", () => {
    // Defence in depth: the domain validates, and the row still cannot exist in
    // an incoherent state if a future writer bypasses the use cases.
    expect(SCHEMA_SQL).toContain("ck_customer_order_requests_price_mode");
    expect(SCHEMA_SQL).toContain("ck_customer_order_requests_shipment_scope");
    expect(SCHEMA_SQL).toContain("ck_customer_order_requests_status_coherence");
  });

  it("stores no customer-written text in the outbox projection", () => {
    // Event privacy (ADR-009 §7): sub-district level, no raw coordinates, no
    // user text. The payload column is checked by events-privacy.test.ts.
    const columns = drizzleColumns(customerOutbox);
    for (const column of columns) {
      expect(column).not.toMatch(/notes|description|label|address|latitude|longitude/u);
    }
  });
});
