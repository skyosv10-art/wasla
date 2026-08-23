/**
 * Drift guard: the Drizzle projection must match the canonical DDL.
 *
 * `services/orders/contracts/schema.sql` is the source of truth (ADR-010). A
 * Drizzle schema that silently falls behind it is the classic failure of this
 * pattern — queries keep compiling, then fail at runtime, or worse, read the
 * wrong column and return a plausible answer. This test parses the contract and
 * compares table names and column sets, so drift breaks the build instead of
 * production.
 *
 * It also pins the invariants of ADR-010 that a well-meaning refactor is most
 * likely to erase: no foreign key to identity/geography/drivers, the
 * assignment/status coupling, the one-offer-per-driver rule, and the absence of
 * raw customer text in the outbox projection.
 *
 * Needs no database, which is why it lives in the default unit suite.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getTableColumns, getTableName } from "drizzle-orm";
import { ORDER_ERROR_CODES } from "@wasla/contracts-order";
import { describe, expect, it } from "vitest";

import {
  orders,
  orderAssignments,
  orderOutbox,
  orderStatusHistory,
  orderStops,
} from "../infrastructure/drizzle/schema.js";

// The suite runs from the package root, so the contract resolves from cwd.
const SCHEMA_SQL = readFileSync(
  resolve(process.cwd(), "contracts/schema.sql"),
  "utf8",
);
const DRIZZLE_SCHEMA = readFileSync(
  resolve(process.cwd(), "src/infrastructure/drizzle/schema.ts"),
  "utf8",
);
const ERRORS_MD = readFileSync(resolve(process.cwd(), "contracts/errors.md"), "utf8");

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
      /^[a-z_]+\s+(UUID|TEXT|JSONB|INTEGER|SMALLINT|TIMESTAMPTZ|NUMERIC|BIGINT|BIGSERIAL)/u.test(
        line,
      ),
    )
    .map((line) => line.split(/\s+/u)[0] as string);
}

type AnyTable =
  | typeof orders
  | typeof orderStops
  | typeof orderStatusHistory
  | typeof orderAssignments
  | typeof orderOutbox;

/** Column names of a Drizzle table, as they exist in Postgres. */
function drizzleColumns(table: AnyTable): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

const CASES = [
  { name: "orders", table: orders },
  { name: "order_stops", table: orderStops },
  { name: "order_status_history", table: orderStatusHistory },
  { name: "order_assignments", table: orderAssignments },
  { name: "order_outbox", table: orderOutbox },
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

  it("keeps the idempotency and request id uniqueness the use cases rely on", () => {
    // Both are read back by findOrderByIdempotencyKey / findOrderByRequestId;
    // without them a retried request would create a second order instead of
    // returning the first.
    expect(SCHEMA_SQL).toMatch(/ux_orders_idempotency_key/u);
    // order_request_id is declared UNIQUE inline on the column (not as a named
    // index), so we assert the column-level UNIQUE constraint instead.
    expect(SCHEMA_SQL).toMatch(/order_request_id\s+UUID\s+NOT NULL\s+UNIQUE/u);
  });

  it("keeps the agreed-price columns, checks and unique negotiation index in both mirrors", () => {
    for (const column of [
      "agreed_amount_minor",
      "agreed_currency",
      "agreed_at",
      "agreed_negotiation_id",
    ]) {
      expect(ddlColumns("orders")).toContain(column);
      expect(drizzleColumns(orders)).toContain(column);
    }
    for (const invariant of [
      "ck_orders_agreed_price_complete",
      "ck_orders_agreed_price_only_negotiable",
      "ux_orders_agreed_negotiation",
    ]) {
      expect(SCHEMA_SQL).toContain(invariant);
      expect(DRIZZLE_SCHEMA).toContain(invariant);
    }
  });

  it("documents exactly the agreed-price error codes the runtime catalog exports", () => {
    for (const code of [
      "ORDER_PRICE_NOT_NEGOTIABLE",
      "ORDER_NOT_OPEN_FOR_AGREED_PRICE",
      "ORDER_AGREED_PRICE_ALREADY_SET",
      "ORDER_AGREED_PRICE_MISMATCH",
    ]) {
      expect(ERRORS_MD).toContain(`\`${code}\``);
      expect(ORDER_ERROR_CODES).toContain(code);
    }
  });

  it("declares no foreign key to identity, geography or drivers (ADR-010: opaque refs)", () => {
    // The service must not be able to block on another service's database. The
    // only REFERENCES are to orders(id) (stops, history, assignments) and the
    // mutual orders.active_assignment_id → order_assignments(id).
    const references = [...SCHEMA_SQL.matchAll(/REFERENCES\s+(\w+)/gu)].map(
      (match) => match[1] as string,
    );
    expect(references).toEqual(["orders", "orders", "orders", "order_assignments"]);
    expect(SCHEMA_SQL).toMatch(/customer_public_id\s+TEXT[\s\S]*?CHECK[\s\S]*?WS-/u);
    expect(SCHEMA_SQL).toMatch(/driver_public_id\s+TEXT[\s\S]*?CHECK[\s\S]*?WS-/u);
  });

  it("keeps the assignment/status coupling CHECK (ADR-010 decision 3.8)", () => {
    // ck_orders_assignment_matches_status is what makes a driver-bound state
    // without an active assignment impossible at the storage level.
    expect(SCHEMA_SQL).toContain("ck_orders_assignment_matches_status");
  });

  it("keeps the one-offer-per-driver uniqueness", () => {
    // findAssignmentByDriver relies on this; without it a duplicate offer would
    // double-count a decline.
    expect(SCHEMA_SQL).toMatch(/ux_order_assignments_order_driver/u);
  });

  it("stores no customer-written text in the outbox projection", () => {
    // Event privacy (ADR-010 decision 7): zone-level only, no raw coordinates,
    // no user text. The payload column is checked by events-privacy tests in
    // @wasla/contracts-order.
    const columns = drizzleColumns(orderOutbox);
    for (const column of columns) {
      expect(column).not.toMatch(/notes|description|label|address|latitude|longitude/u);
    }
  });

  it("mints order_public_id from a database sequence, never the application", () => {
    // PostgresOperatorPublicIdGenerator calls nextval on this sequence; if the
    // sequence were renamed, the public id would be minted from nowhere.
    expect(SCHEMA_SQL).toMatch(/CREATE SEQUENCE IF NOT EXISTS order_public_id_seq/u);
    expect(SCHEMA_SQL).toMatch(/order_public_id\s+TEXT[\s\S]*?ORD-/u);
  });
});
