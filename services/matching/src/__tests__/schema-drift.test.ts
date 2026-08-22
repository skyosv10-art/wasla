/**
 * Drift guard: the Drizzle projection must match the canonical DDL.
 *
 * `services/matching/contracts/schema.sql` is the source of truth (ADR-011). A
 * Drizzle projection that silently falls behind it is the classic failure of
 * this pattern — the queries keep compiling, then fail at runtime, or worse, read
 * the wrong column and return a plausible answer. This test reads the contract
 * from disk AT RUNTIME (the same discipline as `ruleset-drift.test.ts`) and
 * compares table names and column sets, so drift breaks the build instead of
 * production.
 *
 * It also pins the invariants of ADR-011 that a well-meaning refactor is most
 * likely to erase: no foreign key across a service boundary, the frozen ruleset,
 * the monotonic counts, the unique rank, and the absence of candidate ids in any
 * event payload column.
 *
 * Needs no database, which is why it lives in the default unit suite.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  driverCandidacy,
  matchingDecisionCandidates,
  matchingDecisions,
  matchingIdempotency,
  matchingOutbox,
  matchingRulesets,
} from "../infrastructure/drizzle/schema.js";

// Resolved from this file, not from cwd: the suite must read the same contract
// whether it is run from the service, from the repo root, or from CI.
const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHEMA_SQL = readFileSync(path.join(serviceRoot, "contracts", "schema.sql"), "utf8");

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
      /^[a-z_]+\s+(UUID|TEXT|JSONB|INTEGER|SMALLINT|TIMESTAMPTZ|NUMERIC|BIGINT|BOOLEAN|TEXT\[\]|UUID\[\])/u.test(
        line,
      ),
    )
    .map((line) => line.split(/\s+/u)[0] as string);
}

type AnyTable =
  | typeof driverCandidacy
  | typeof matchingRulesets
  | typeof matchingDecisions
  | typeof matchingDecisionCandidates
  | typeof matchingOutbox
  | typeof matchingIdempotency;

/** Column names of a Drizzle table, as they exist in Postgres. */
function drizzleColumns(table: AnyTable): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

const CASES = [
  { name: "driver_candidacy", table: driverCandidacy },
  { name: "matching_rulesets", table: matchingRulesets },
  { name: "matching_decisions", table: matchingDecisions },
  { name: "matching_decision_candidates", table: matchingDecisionCandidates },
  { name: "matching_outbox", table: matchingOutbox },
  { name: "matching_idempotency", table: matchingIdempotency },
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

  it("declares no foreign key across a service boundary (ADR-011: opaque refs)", () => {
    // The only REFERENCES are decisions → rulesets and candidates → decisions.
    // A reference to identity, geography or the order engine would let a slow
    // neighbour block a ranking, and would make this service undeployable alone.
    const references = [...SCHEMA_SQL.matchAll(/REFERENCES\s+(\w+)/gu)].map(
      (match) => match[1] as string,
    );
    expect([...references].sort()).toEqual(["matching_decisions", "matching_rulesets"]);
    expect(SCHEMA_SQL).toMatch(/driver_public_id\s+TEXT\s+PRIMARY KEY[\s\S]*?WS-/u);
  });

  it("keeps the two ruleset guards that would otherwise reorder every driver", () => {
    expect(SCHEMA_SQL).toContain("ck_ruleset_weights_sum_100");
    expect(SCHEMA_SQL).toContain("ck_ruleset_frozen_at");
  });

  it("keeps the counts monotonic and an empty result explained", () => {
    // returned <= eligible <= considered, and zero candidates always carries a
    // reason code — the two properties the audit row exists to guarantee.
    expect(SCHEMA_SQL).toContain("ck_decision_counts_monotonic");
    expect(SCHEMA_SQL).toContain("ck_decision_empty_has_reason");
  });

  it("keeps a rank unique inside one decision", () => {
    // A repeated rank means the ranking was not deterministic; the constraint is
    // what makes that impossible at the storage level rather than unlikely.
    expect(SCHEMA_SQL).toContain("CONSTRAINT ux_decision_rank UNIQUE (decision_id, rank)");
  });

  it("stores no driver-identifying or customer-written column in the outbox projection", () => {
    // Event privacy (ADR-011 decision 8): an evaluation event carries counts, not
    // candidate ids and not scores. The payload contents are drift-guarded in
    // @wasla/contracts-matching; here we pin the COLUMNS.
    for (const column of drizzleColumns(matchingOutbox)) {
      expect(column).not.toMatch(/driver|score|candidate|notes|label|phone|latitude|longitude/u);
    }
  });

  it("keeps the idempotency key length identical to the domain validator", () => {
    // `assertIdempotencyKey` refuses anything outside 8..128. A key the
    // application accepts and the database refuses is a 500 with no explicable
    // cause.
    expect(SCHEMA_SQL).toMatch(
      /char_length\(idempotency_key\) BETWEEN 8 AND 128/u,
    );
  });
});
