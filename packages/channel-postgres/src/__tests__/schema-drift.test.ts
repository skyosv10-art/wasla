/**
 * Drift guard: the Drizzle projection must match the canonical DDL.
 *
 * `packages/channel-core/contracts/schema.sql` is the source of truth
 * (ADR-004/006). A Drizzle schema that silently falls behind it is the classic
 * failure of this pattern — queries compile, then fail (or worse, read the wrong
 * column) at runtime. This test parses the contract and compares column sets,
 * table names and the two idempotency indexes, so drift breaks the build instead
 * of production.
 *
 * It needs no database, which is why it lives in the default unit suite.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { channelDeliveries, channelOutbox, channelUpdates } from "../schema.js";

const SCHEMA_SQL = readFileSync(
  resolve(process.cwd(), "../channel-core/contracts/schema.sql"),
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
    .filter((line) => /^[a-z_]+\s+(UUID|TEXT|JSONB|INTEGER|TIMESTAMPTZ)/u.test(line))
    .map((line) => line.split(/\s+/u)[0] as string);
}

/** Column names of a Drizzle table, as they exist in Postgres. */
function drizzleColumns(table: typeof channelUpdates | typeof channelDeliveries | typeof channelOutbox): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

const CASES = [
  { name: "channel_updates", table: channelUpdates },
  { name: "channel_deliveries", table: channelDeliveries },
  { name: "channel_outbox", table: channelOutbox },
] as const;

describe("Drizzle projection ↔ canonical DDL", () => {
  it.each(CASES)("$name is projected under its contract name", ({ name, table }) => {
    expect(getTableName(table)).toBe(name);
  });

  it.each(CASES)("$name exposes exactly the contract's columns", ({ name, table }) => {
    expect([...drizzleColumns(table)].sort()).toEqual([...ddlColumns(name)].sort());
  });

  it("keeps both idempotency indexes of the contract", () => {
    expect(SCHEMA_SQL).toContain(
      "ux_channel_updates_dedup\n    ON channel_updates (channel, bot, channel_update_id)",
    );
    expect(SCHEMA_SQL).toContain(
      "ux_channel_deliveries_idempotency\n    ON channel_deliveries (channel, idempotency_key)",
    );
  });

  it("stays channel-neutral: no channel-native column names", () => {
    const columns = CASES.flatMap(({ table }) => drizzleColumns(table));
    for (const column of columns) {
      expect(column).not.toMatch(/telegram|chat_id|inline_keyboard|web_app/u);
    }
  });

  it("declares no foreign key to identity (ADR-001: chat_ref is opaque)", () => {
    const columns = CASES.flatMap(({ table }) => drizzleColumns(table));
    expect(columns).not.toContain("wasla_public_id");
    expect(SCHEMA_SQL).not.toMatch(/REFERENCES\s+identity_users/u);
  });
});
