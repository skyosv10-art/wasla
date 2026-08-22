/**
 * Drift guard: the Drizzle projection must match the canonical DDL.
 *
 * `services/drivers/contracts/schema.sql` is the source of truth (ADR-011). A Drizzle
 * projection that silently falls behind it is the classic failure of this pattern — the
 * queries keep compiling, then fail at runtime, or worse, read the wrong column and
 * return a plausible answer. This test reads the contract from disk AT RUNTIME (the
 * same discipline as `contract-drift.test.ts`) and compares table names and column
 * sets in BOTH directions, so drift breaks the build instead of production.
 *
 * It carries forward the guard MR 5a/6 of dispatch had to invent: `in-memory.ts`
 * documents each of its hand-written checks with the NAME of the database constraint
 * that will enforce the same rule in production, and `repository.ts` translates
 * Postgres constraint names back into domain errors by that same literal. A name that
 * does not exist in the DDL is worse than no name: the next reader trusts it, greps
 * for it, finds nothing, and has to re-derive from scratch which promise the code is
 * mirroring. Worse still in `repository.ts`, where a misspelled name is a `switch`
 * branch that never runs — the 23505 falls through to a raw driver error instead of the
 * intended domain error, and the API answers 500 where it promised 409. The last test
 * below makes every such mention checkable.
 *
 * Needs no database, which is why it lives in the default unit suite.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  driverCandidacyPublications,
  driverDocuments,
  driverEligibilityLog,
  driverEligibilityPolicies,
  driverIdempotency,
  driverOutbox,
  driverProfiles,
  driverServiceZones,
  driverVehicles,
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

/**
 * Column names declared for one table in the DDL, in declaration order.
 *
 * `DATE` and `BIGSERIAL` are in the type alternation and the sibling services' copies
 * of this helper do not have them — drivers is the first service to store a calendar
 * day (`issued_at`, `expires_at`) and the second to use an append-only BIGSERIAL log.
 * Omitting them would silently drop those four columns from the comparison, and a
 * drift guard that skips the columns it does not recognise is a guard that reports
 * success for the columns it never looked at.
 */
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
      /^[a-z_]+\s+(UUID|TEXT|JSONB|INTEGER|SMALLINT|TIMESTAMPTZ|DATE|BIGSERIAL|NUMERIC|BIGINT|BOOLEAN|TEXT\[\]|UUID\[\])/u.test(
        line,
      ),
    )
    .map((line) => line.split(/\s+/u)[0] as string);
}

type AnyTable =
  | typeof driverProfiles
  | typeof driverServiceZones
  | typeof driverVehicles
  | typeof driverDocuments
  | typeof driverEligibilityPolicies
  | typeof driverEligibilityLog
  | typeof driverCandidacyPublications
  | typeof driverOutbox
  | typeof driverIdempotency;

/** Column names of a Drizzle table, as they exist in Postgres. */
function drizzleColumns(table: AnyTable): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

const CASES = [
  { name: "driver_profiles", table: driverProfiles },
  { name: "driver_service_zones", table: driverServiceZones },
  { name: "driver_vehicles", table: driverVehicles },
  { name: "driver_documents", table: driverDocuments },
  { name: "driver_eligibility_policies", table: driverEligibilityPolicies },
  { name: "driver_eligibility_log", table: driverEligibilityLog },
  { name: "driver_candidacy_publications", table: driverCandidacyPublications },
  { name: "driver_outbox", table: driverOutbox },
  { name: "driver_idempotency", table: driverIdempotency },
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
    // which is exactly how `driver_idempotency` would have been missed had this test
    // existed before the table did.
    const declared = [...SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gu)].map(
      (match) => match[1] as string,
    );
    expect([...declared].sort()).toEqual(CASES.map((entry) => entry.name).sort());
  });

  it("declares no foreign key across a service boundary (ADR-011: opaque refs)", () => {
    // The only REFERENCES are inside this service: everything → driver_profiles, and
    // documents → driver_vehicles. `work_city_zone_id` and `zone_ids` point at
    // geography's zones and `reviewed_by` at an identity operator, and all three stay
    // opaque on purpose: a real FK would make this service undeployable alone, and
    // would let a slow neighbour block a driver's document review.
    const references = [...SCHEMA_SQL.matchAll(/REFERENCES\s+(\w+)/gu)].map(
      (match) => match[1] as string,
    );
    expect([...new Set(references)].sort()).toEqual(["driver_profiles", "driver_vehicles"]);
  });

  it("keeps one primary vehicle and one live document per type", () => {
    // The two partial unique indexes are the entire concurrency story of this
    // service: without the first, two concurrent `PATCH /vehicles` calls leave a
    // driver with two primary vehicles and the eligibility calculator picks one at
    // random; without the second, a driver holds two live copies of the same paper
    // and a reviewer's rejection of one leaves the other standing.
    expect(SCHEMA_SQL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS ux_driver_vehicles_one_primary[\s\S]*?WHERE is_primary/u,
    );
    expect(SCHEMA_SQL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS ux_driver_documents_one_live_per_type[\s\S]*?WHERE status IN \('pending','verified'\)/u,
    );
  });

  it("scopes the one-live-per-type index by vehicle through a stable COALESCE", () => {
    // A driver-level paper has vehicle_id NULL, and NULL is distinct from NULL in a
    // unique index — so without the COALESCE to the nil UUID, a driver could hold any
    // number of live national_id documents. The literal is part of the contract, not
    // an implementation detail: `repository.findLive` reproduces the SAME expression,
    // and the two drifting apart would let the application read one row while the
    // index protected another.
    expect(SCHEMA_SQL).toContain("COALESCE(vehicle_id, '00000000-0000-0000-0000-000000000000'");
    expect(REPOSITORY_TS).toContain("00000000-0000-0000-0000-000000000000");
  });

  it("refuses a state change with no reason", () => {
    // ck_eligibility_log_reasons: a non-eligible verdict with an empty `reasons` array
    // is the exact failure this whole service was built to make impossible — a driver
    // who is refused work with no answer to "why".
    expect(SCHEMA_SQL).toContain("ck_eligibility_log_reasons");
    expect(IN_MEMORY_TS).toContain("ck_eligibility_log_reasons");
  });

  it("keeps a retired vehicle from being the primary one", () => {
    expect(SCHEMA_SQL).toContain("ck_driver_vehicles_retired_not_primary");
  });

  it("keeps the idempotency key length identical to the domain validator", () => {
    // `assertIdempotencyKey` refuses anything outside 8..128, and both per-row columns
    // carry that same bound. The general table added in this MR is deliberately WIDER
    // (8..192) because it stores NAMESPACED keys — `vehicle:WS-1000000001:<key>` — and
    // 128 there would reject a caller-legal 128-character key with a constraint
    // violation the caller could never explain. §9 of the DDL documents the arithmetic.
    expect(SCHEMA_SQL).toMatch(/char_length\(idempotency_key\) BETWEEN 8 AND 128/u);
    expect(SCHEMA_SQL).toMatch(/char_length\(idempotency_key\) BETWEEN 8 AND 192/u);
  });

  it("stores no driver-written text in the outbox projection", () => {
    // Event privacy: an outbox row carries ids, a type and a payload. A column named
    // after a phone number, an address or a display name would make the relay a
    // data-leak path — and driver documents are the most sensitive data this platform
    // holds.
    for (const column of drizzleColumns(driverOutbox)) {
      expect(column).not.toMatch(/phone|address|latitude|longitude|notes|name/u);
    }
  });

  it("keeps the storage reference opaque and stores no document bytes", () => {
    // `storage_ref` is a pointer into object storage, never the file. A BYTEA column
    // here would put national IDs in the same backup stream as the operational
    // database, with a retention policy chosen for rows rather than for identity
    // papers.
    expect(SCHEMA_SQL).not.toMatch(/\bBYTEA\b/u);
  });

  it("names only constraints that exist, in both infrastructure adapters", () => {
    // Every ck_/ux_/ix_/trg_ token mentioned in a comment or a branch of the two
    // adapters must be a real object in the DDL. The pattern is deliberately NOT
    // anchored to a `_driver_` infix: this service names constraints after the concept
    // they protect (`ck_policy_required_documents_known`,
    // `ck_candidacy_publication_outcome`), and a guard that only checked the
    // `*_driver_*` ones would have silently skipped four of the twelve simulated in
    // `in-memory.ts`.
    const declared = new Set(
      [...SCHEMA_SQL.matchAll(/\b((?:ck|ux|ix|trg)_[a-z_]+)\b/gu)].map((match) => match[1] as string),
    );
    const mentioned = new Set(
      [...IN_MEMORY_TS.matchAll(/\b((?:ck|ux|ix|trg)_[a-z_]+)\b/gu)].map(
        (match) => match[1] as string,
      ),
    );
    for (const match of REPOSITORY_TS.matchAll(/\b((?:ck|ux|ix|trg)_[a-z_]+)\b/gu)) {
      mentioned.add(match[1] as string);
    }

    expect(mentioned.size).toBeGreaterThan(10);
    expect([...mentioned].filter((name) => !declared.has(name))).toEqual([]);
  });
});
