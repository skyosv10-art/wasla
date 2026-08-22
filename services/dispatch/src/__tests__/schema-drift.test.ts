/**
 * Drift guard: the Drizzle projection must match the canonical DDL.
 *
 * `services/dispatch/contracts/schema.sql` is the source of truth (ADR-011). A
 * Drizzle projection that silently falls behind it is the classic failure of this
 * pattern — the queries keep compiling, then fail at runtime, or worse, read the
 * wrong column and return a plausible answer. This test reads the contract from disk
 * AT RUNTIME (the same discipline as `contract-drift.test.ts`) and compares table
 * names and column sets in BOTH directions, so drift breaks the build instead of
 * production.
 *
 * It adds one guard the sibling services do not have, because MR 5a/6 found the bug
 * it catches: `in-memory.ts` documents each of its hand-written checks with the name
 * of the database constraint that will enforce the same rule in production. Four of
 * those names did not exist in the DDL — invented, or renamed at some point and never
 * followed up. A comment naming a constraint that does not exist is worse than no
 * comment: the next reader trusts it, greps for it, finds nothing, and has to
 * re-derive from scratch which promise the code is mirroring. The last test below
 * makes every such mention checkable.
 *
 * Needs no database, which is why it lives in the default unit suite.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  dispatchIdempotency,
  dispatchJobs,
  dispatchOffers,
  dispatchOutbox,
  dispatchWaves,
} from "../infrastructure/drizzle/schema.js";

// Resolved from this file, not from cwd: the suite must read the same contract
// whether it is run from the service, from the repo root, or from CI.
const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHEMA_SQL = readFileSync(path.join(serviceRoot, "contracts", "schema.sql"), "utf8");
const IN_MEMORY_TS = readFileSync(
  path.join(serviceRoot, "src", "infrastructure", "in-memory.ts"),
  "utf8",
);
const REPOSITORY_TS = readFileSync(
  path.join(serviceRoot, "src", "infrastructure", "drizzle", "repository.ts"),
  "utf8",
);

/** Column names declared for one table in the DDL, in declaration order. */
function ddlColumns(table: string): string[] {
  const match = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`, "u").exec(
    SCHEMA_SQL,
  );
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
  | typeof dispatchJobs
  | typeof dispatchWaves
  | typeof dispatchOffers
  | typeof dispatchOutbox
  | typeof dispatchIdempotency;

/** Column names of a Drizzle table, as they exist in Postgres. */
function drizzleColumns(table: AnyTable): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

const CASES = [
  { name: "dispatch_jobs", table: dispatchJobs },
  { name: "dispatch_waves", table: dispatchWaves },
  { name: "dispatch_offers", table: dispatchOffers },
  { name: "dispatch_outbox", table: dispatchOutbox },
  { name: "dispatch_idempotency", table: dispatchIdempotency },
] as const;

describe("Drizzle projection ↔ canonical DDL", () => {
  it.each(CASES)("$name is projected under its contract name", ({ name, table }) => {
    expect(getTableName(table)).toBe(name);
  });

  it.each(CASES)("$name exposes exactly the contract's columns", ({ name, table }) => {
    expect([...drizzleColumns(table)].sort()).toEqual([...ddlColumns(name)].sort());
  });

  it("covers every table the contract declares", () => {
    // The direction that catches a table ADDED to the contract with no projection —
    // which is exactly how `dispatch_idempotency` would have been missed had this
    // test existed before the table did.
    const declared = [...SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gu)].map(
      (match) => match[1] as string,
    );
    expect([...declared].sort()).toEqual(CASES.map((entry) => entry.name).sort());
  });

  it("declares no foreign key across a service boundary (ADR-011: opaque refs)", () => {
    // The only REFERENCES are waves → jobs and offers → (jobs, waves). `order_id`,
    // `zone_id`, `driver_public_id` and `order_assignment_id` are opaque references
    // to other services: a real FK would let a slow neighbour block a tick, and
    // would make this service undeployable alone.
    const references = [...SCHEMA_SQL.matchAll(/REFERENCES\s+(\w+)/gu)].map(
      (match) => match[1] as string,
    );
    expect([...new Set(references)].sort()).toEqual(["dispatch_jobs", "dispatch_waves"]);
  });

  it("keeps one open wave per job and one accepted offer per job", () => {
    // The two partial unique indexes are the entire concurrency story of this
    // service: without the first, two ticks open two waves and the customer is
    // offered to twice as many drivers as the rules allow; without the second, two
    // drivers both believe they won the order.
    expect(SCHEMA_SQL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS ux_dispatch_waves_one_open_job[\s\S]*?WHERE status = 'open'/u,
    );
    expect(SCHEMA_SQL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS ux_dispatch_offers_one_accepted_job[\s\S]*?WHERE status = 'accepted'/u,
    );
  });

  it("keeps a driver from being offered the same job twice", () => {
    expect(SCHEMA_SQL).toContain(
      "CONSTRAINT ux_dispatch_offers_job_driver UNIQUE (job_id, driver_public_id)",
    );
  });

  it("keeps the deadline order the tick depends on", () => {
    // escalation_expires_at >= expires_at. Reversed, the job would escalate before
    // its own wave budget ran out, and the community stage would fire on a job that
    // still had a paid driver to ask.
    expect(SCHEMA_SQL).toContain("ck_dispatch_jobs_deadline_order");
  });

  it("keeps the idempotency key length identical to the domain validator", () => {
    // `assertIdempotencyKey` refuses anything outside 8..128. A key the application
    // accepts and the database refuses is a 500 with no explicable cause. Both
    // places that store one are checked: the job's creating key, and the general
    // table added in MR 5a/6.
    expect(SCHEMA_SQL).toMatch(/char_length\(created_idempotency_key\) BETWEEN 8 AND 128/u);
    expect(SCHEMA_SQL).toMatch(/char_length\(idempotency_key\) BETWEEN 8 AND 128/u);
  });

  it("stores no customer- or driver-written text in the outbox projection", () => {
    // Event privacy: an outbox row carries ids, a type and a payload. A column named
    // after a phone number or an address would make the relay a data-leak path.
    for (const column of drizzleColumns(dispatchOutbox)) {
      expect(column).not.toMatch(/phone|address|latitude|longitude|notes|name/u);
    }
  });

  it("names only constraints that exist, in both infrastructure adapters", () => {
    // Every ck_/ux_/ix_dispatch_* token mentioned in a comment or a branch of the
    // two adapters must be a real object in the DDL. This is the guard that would
    // have caught the four invented names MR 5a/6 had to correct by hand.
    const declared = new Set(
      [...SCHEMA_SQL.matchAll(/\b((?:ck|ux|ix|trg)_dispatch_[a-z_]+)\b/gu)].map(
        (match) => match[1] as string,
      ),
    );
    const mentioned = new Set(
      [...IN_MEMORY_TS.matchAll(/\b((?:ck|ux|ix|trg)_dispatch_[a-z_]+)\b/gu)].map(
        (match) => match[1] as string,
      ),
    );
    for (const match of REPOSITORY_TS.matchAll(/\b((?:ck|ux|ix|trg)_dispatch_[a-z_]+)\b/gu)) {
      mentioned.add(match[1] as string);
    }

    expect(mentioned.size).toBeGreaterThan(10);
    expect([...mentioned].filter((name) => !declared.has(name))).toEqual([]);
  });
});
