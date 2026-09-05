/**
 * Drift guard: the domain must still agree with `services/dispatch/contracts/`.
 *
 * The contracts are the source of truth (ADR-011, ADR-004). This service copies a few
 * facts out of them into runtime constants — id patterns, length bounds, index names,
 * status sets — because a database CHECK is not reachable from a unit test and a
 * regex in `model.ts` is. Every one of those copies is a chance for the two to part
 * ways silently: the code keeps compiling, the tests keep passing, and the mismatch
 * surfaces as a constraint violation in production or, worse, as a value the database
 * accepts and nobody meant.
 *
 * So the contracts are read from disk AT RUNTIME here, from a path resolved relative to
 * this file rather than the working directory, and compared with what the domain
 * believes. Same discipline as `services/matching/src/__tests__/schema-drift.test.ts`.
 * No database needed, which is why it lives in the default unit suite.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DISPATCH_API_PATHS,
  DISPATCH_ERROR_CODES,
  DISPATCH_EVENT_TYPES,
  DISPATCH_REASON_CODES,
} from "@wasla/contracts-dispatch";
import { describe, expect, it } from "vitest";

import { DispatchError } from "../domain/errors.js";
import {
  DRIVER_PUBLIC_ID_PATTERN,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  ORDER_PUBLIC_ID_PATTERN,
  PAYLOAD_FINGERPRINT_LENGTH,
  REASON_CODE_MAX_LENGTH,
  REASON_CODE_MIN_LENGTH,
  DISPATCH_ORDER_TYPES,
  DISPATCH_VEHICLE_CLASSES,
  JOB_STATUS_REASON_CODES,
  OFFER_STATUS_REASON_CODES,
  WAVE_STATUS_REASON_CODES,
} from "../domain/model.js";
import {
  DERIVED_TERMINAL_JOB_STATUSES,
  JOB_TRANSITIONS,
  OFFER_TRANSITIONS,
  WAVE_TRANSITIONS,
} from "../domain/state-machine.js";
import { DISPATCH_INDEX_NAMES } from "../infrastructure/in-memory.js";
import { createSignedDispatchApp as createDispatchApp } from "./service-identity-support.js";
import { createDirectRunner } from "../runner.js";
import { createHarness } from "./harness.js";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string): string =>
  readFileSync(path.join(serviceRoot, "contracts", file), "utf8");

const SCHEMA_SQL = read("schema.sql");
const ERRORS_MD = read("errors.md");
const OPENAPI = read("api.openapi.yml");
const EVENTS_JSON = read("events.json");

/**
 * The values of every `CHECK (col IN (...))` constraint on a column name, in file order
 * and regardless of how the DDL wraps or comments the list. `status` appears three times
 * — jobs, then waves, then offers — so the caller picks by position.
 */
function checkInValues(column: string): string[][] {
  const matches = [
    ...SCHEMA_SQL.matchAll(new RegExp(`CHECK \\(${column} IN \\(([\\s\\S]*?)\\)\\s*\\)`, "gu")),
  ];
  if (matches.length === 0) {
    throw new Error(`لم يُعثر على قيد CHECK للعمود ${column} في schema.sql`);
  }
  return matches.map((match) =>
    [...(match[1] as string).matchAll(/'([a-z_]+)'/gu)].map((entry) => entry[1] as string),
  );
}

const [JOB_STATUSES_DDL, WAVE_STATUSES_DDL, OFFER_STATUSES_DDL] = checkInValues("status");

describe("drift — status sets", () => {
  it("reaches exactly the job statuses the DDL allows", () => {
    const used = new Set(JOB_TRANSITIONS.flatMap((rule) => [rule.from, rule.to] as string[]));
    // Both directions matter: a status in the DDL that no transition reaches is a state
    // the database would accept and the domain could never produce or leave.
    expect([...used].sort()).toEqual([...(JOB_STATUSES_DDL ?? [])].sort());
  });

  it("reaches exactly the wave statuses the DDL allows", () => {
    const used = new Set(WAVE_TRANSITIONS.flatMap((rule) => [rule.from, rule.to] as string[]));
    expect([...used].sort()).toEqual([...(WAVE_STATUSES_DDL ?? [])].sort());
  });

  it("reaches exactly the offer statuses the DDL allows", () => {
    const used = new Set(OFFER_TRANSITIONS.flatMap((rule) => [rule.from, rule.to] as string[]));
    expect([...used].sort()).toEqual([...(OFFER_STATUSES_DDL ?? [])].sort());
  });

  it("keeps the terminal job statuses aligned with the terminal-needs-reason constraint", () => {
    // The DDL demands a reason for every terminal status; the domain must therefore know
    // a reason code for each one, or a legal transition would write an illegal row.
    for (const status of DERIVED_TERMINAL_JOB_STATUSES) {
      expect(Object.keys(JOB_STATUS_REASON_CODES)).toContain(status);
    }
    expect(SCHEMA_SQL).toContain("ck_dispatch_jobs_terminal_needs_reason");
  });

  it("uses exactly the order types and vehicle classes the DDL allows", () => {
    expect([...DISPATCH_ORDER_TYPES].sort()).toEqual([...checkInValues("order_type")[0]].sort());
    // "economy" is not a vehicle class here, however natural it sounds; this is the test
    // that says so out loud.
    expect([...DISPATCH_VEHICLE_CLASSES].sort()).toEqual(
      [...checkInValues("vehicle_class")[0]].sort(),
    );
  });
});

describe("drift — copied shapes and bounds", () => {
  it("copies the public id patterns from the DDL", () => {
    // Written as the DDL writes them, so a widened pattern on either side fails here
    // instead of letting an id shape through that the other layer rejects.
    expect(SCHEMA_SQL).toContain(`driver_public_id ~ '${DRIVER_PUBLIC_ID_PATTERN.source}'`);
    expect(SCHEMA_SQL).toContain(`order_public_id ~ '${ORDER_PUBLIC_ID_PATTERN.source}'`);
  });

  it("copies the length bounds from the DDL", () => {
    expect(SCHEMA_SQL).toContain(
      `char_length(created_idempotency_key) BETWEEN ${IDEMPOTENCY_KEY_MIN_LENGTH} AND ${IDEMPOTENCY_KEY_MAX_LENGTH}`,
    );
    expect(SCHEMA_SQL).toContain(
      `char_length(payload_fingerprint) = ${PAYLOAD_FINGERPRINT_LENGTH}`,
    );
    expect(SCHEMA_SQL).toContain(
      `char_length(status_reason_code) BETWEEN ${REASON_CODE_MIN_LENGTH} AND ${REASON_CODE_MAX_LENGTH}`,
    );
  });

  it("names indexes that actually exist in the DDL", () => {
    // The in-memory store raises conflicts named after the real indexes, so a test that
    // passes here keeps meaning the same thing once Drizzle replaces it (MR 5/6).
    expect(DISPATCH_INDEX_NAMES.length).toBeGreaterThan(0);
    for (const name of DISPATCH_INDEX_NAMES) {
      expect(SCHEMA_SQL).toContain(name);
    }

    // And the other direction: a uniqueness rule added to the DDL without an in-memory
    // counterpart would make this suite pass while Postgres rejects the same writes.
    const declared = new Set(
      [...SCHEMA_SQL.matchAll(/(ux_dispatch_[a-z_]+)/gu)].map((entry) => entry[1] as string),
    );
    expect([...declared].filter((name) => !DISPATCH_INDEX_NAMES.includes(name))).toEqual([]);
  });
});

describe("drift — error catalog", () => {
  it("throws only codes the catalog declares", () => {
    // Read from the errors.md table rather than from the TypeScript constant: the table
    // is the document a reviewer reads, and a code missing from it is undocumented.
    const documented = [...ERRORS_MD.matchAll(/`(DISPATCH_[A-Z_]+)`/gu)].map(
      (entry) => entry[1] as string,
    );
    const thrown = [
      ...readFileSync(path.join(serviceRoot, "src", "domain", "errors.ts"), "utf8").matchAll(
        /new DispatchError\(\s*"(DISPATCH_[A-Z_]+)"/gu,
      ),
    ].map((entry) => entry[1] as string);

    expect(thrown.length).toBeGreaterThan(0);
    for (const code of thrown) {
      expect(documented).toContain(code);
      expect(DISPATCH_ERROR_CODES as readonly string[]).toContain(code);
    }
  });

  it("has a factory for every declared code, so none is dead documentation", () => {
    const thrown = new Set(
      [
        ...readFileSync(path.join(serviceRoot, "src", "domain", "errors.ts"), "utf8").matchAll(
          /new DispatchError\(\s*"(DISPATCH_[A-Z_]+)"/gu,
        ),
      ].map((entry) => entry[1] as string),
    );
    expect([...DISPATCH_ERROR_CODES].filter((code) => !thrown.has(code))).toEqual([]);
  });

  it("carries the code, not a message, as the machine-readable fact", () => {
    const error = new DispatchError("DISPATCH_JOB_NOT_FOUND", "أي رسالة");
    // Messages are Arabic and may be reworded any day; every assertion in this suite
    // therefore reads `code`.
    expect(error.code).toBe("DISPATCH_JOB_NOT_FOUND");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("drift — reason codes", () => {
  it("uses only codes from the closed catalog, and uses all of them", () => {
    const used = new Set<string>([
      ...Object.values(OFFER_STATUS_REASON_CODES).flat(),
      ...Object.values(WAVE_STATUS_REASON_CODES).flat(),
      ...Object.values(JOB_STATUS_REASON_CODES).flat(),
    ]);

    for (const code of used) {
      expect(DISPATCH_REASON_CODES as readonly string[]).toContain(code);
      expect(ERRORS_MD).toContain(code);
    }
    // Every declared code is reachable from some outcome. A code nobody can produce is a
    // promise to analysts that the data will never keep.
    expect([...DISPATCH_REASON_CODES].filter((code) => !used.has(code))).toEqual([]);
  });
});

describe("drift — API and events", () => {
  it("declares every path the OpenAPI document declares", () => {
    for (const apiPath of DISPATCH_API_PATHS) {
      expect(OPENAPI).toContain(`  ${apiPath}:`);
    }
  });

  it("uses the event types the JSON Schema declares, with no version suffix", () => {
    for (const type of Object.values(DISPATCH_EVENT_TYPES)) {
      expect(EVENTS_JSON).toContain(`"const": "${type}"`);
      // `dispatch.offer_sent`, not `dispatch.offer_sent.v1`: the version lives in
      // `event_version`, and duplicating it in the type would give a consumer two places
      // to read it and one of them to get wrong.
      expect(type).not.toMatch(/\.v[0-9]+$/u);
    }
  });

  it("registers the offer-detail GET route that the contract declares", async () => {
    const contractPath = "/dispatch/offers/{offer_id}";
    // The path first has to be part of the generated contract surface, then the
    // running Fastify application must recognise its colon-parametric equivalent.
    expect(DISPATCH_API_PATHS).toContain(contractPath);
    expect(OPENAPI).toContain(`  ${contractPath}:`);

    const app = createDispatchApp({ runner: createDirectRunner(createHarness().deps) });
    expect(app.hasRoute({ method: "GET", url: "/dispatch/offers/:offer_id" })).toBe(true);
    await app.close();
  });
});
