/**
 * Drift guards for the Order Engine contract.
 *
 * These tests are not testing code — they are testing that four documents and
 * one TypeScript surface still say the same thing:
 *
 *   errors.md  ·  schema.sql  ·  api.openapi.yml  ·  index.ts
 *   + the customer contract that hands orders over (ADR-009 / ADR-010)
 *
 * A contract that drifts from its documentation is worse than no contract: the
 * consumer trusts the document and the producer obeys the code.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ORDER_ERROR_CODES,
  ORDER_ERROR_CODE_CLASS,
  ORDER_ERROR_CLASS_STATUS,
  ORDER_REASON_CODES,
  ORDER_STATUSES,
  ORDER_INITIAL_STATUS,
  ORDER_TERMINAL_STATUSES,
  ORDER_DRIVER_BOUND_STATUSES,
  ORDER_PRE_ASSIGNMENT_STATUSES,
  ORDER_TRANSIENT_STATUSES,
  ORDER_PUBLIC_ID_PATTERN,
  WASLA_PUBLIC_ID_PATTERN,
  STOPS_PER_ORDER,
  ORDER_SERVICE_PORT,
  ORDER_TYPES,
  ORDER_VEHICLE_CLASSES,
  ORDER_PRICE_MODES,
  ORDER_STOP_KINDS,
  ORDER_STOP_SOURCES,
  ORDER_ACTOR_TYPES,
  ORDER_ASSIGNMENT_STATES,
  ORDER_ASSIGNMENT_RESOLUTIONS,
  ORDER_SHIPMENT_TYPES,
  httpStatusForOrderError,
} from "../index.js";

const CONTRACTS_DIR = resolve(__dirname, "../../../../../services/orders/contracts");
const CUSTOMER_CONTRACTS_DIR = resolve(__dirname, "../../../../../services/customers/contracts");

const errorsMd = readFileSync(resolve(CONTRACTS_DIR, "errors.md"), "utf8");
const schemaSql = readFileSync(resolve(CONTRACTS_DIR, "schema.sql"), "utf8");
const openApiYml = readFileSync(resolve(CONTRACTS_DIR, "api.openapi.yml"), "utf8");
const customerOpenApiYml = readFileSync(
  resolve(CUSTOMER_CONTRACTS_DIR, "api.openapi.yml"),
  "utf8",
);

/** Every `| `UPPER_CASE` | col2 | ...` markdown table row, as [code, col2]. */
function markdownCodeRows(md: string): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const line of md.split("\n")) {
    const match = /^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*([^|]*?)\s*\|/.exec(line.trim());
    if (match) rows.push([match[1]!, match[2]!]);
  }
  return rows;
}

/** Values inside a named SQL CHECK constraint, extracted from single quotes. */
function sqlCheckValues(sql: string, constraintName: string): string[] {
  const start = sql.indexOf(`CONSTRAINT ${constraintName} CHECK (`);
  expect(start, `constraint ${constraintName} must exist in schema.sql`).toBeGreaterThan(-1);
  const body = sql.slice(start, sql.indexOf("\n    ),", start) + 1);
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe("error catalog ↔ errors.md", () => {
  const documented = markdownCodeRows(errorsMd).filter(([, col2]) => /^\d{3}$/.test(col2));

  it("documents exactly the codes the package exports", () => {
    expect(documented.map(([code]) => code).sort()).toEqual([...ORDER_ERROR_CODES].sort());
  });

  it("gives every code the HTTP status implied by its class", () => {
    for (const [code, status] of documented) {
      expect(httpStatusForOrderError(code as never), `status of ${code}`).toBe(Number(status));
    }
  });

  it("classes every exported code (no code without a class)", () => {
    for (const code of ORDER_ERROR_CODES) {
      expect(ORDER_ERROR_CODE_CLASS[code], `class of ${code}`).toBeDefined();
    }
  });

  it("uses only documented error classes", () => {
    for (const cls of Object.values(ORDER_ERROR_CODE_CLASS)) {
      expect(Object.keys(ORDER_ERROR_CLASS_STATUS)).toContain(cls);
    }
  });

  it("prefixes every code with ORDER_ (the code says which service answered)", () => {
    for (const code of ORDER_ERROR_CODES) expect(code.startsWith("ORDER_")).toBe(true);
  });
});

describe("reason-code catalog ↔ errors.md", () => {
  const documented = markdownCodeRows(errorsMd)
    .filter(([, col2]) => /^`[a-z_]+`/.test(col2))
    .map(([code]) => code);

  it("is a closed catalog matching the documented tables exactly", () => {
    expect([...new Set(documented)].sort()).toEqual([...ORDER_REASON_CODES].sort());
  });

  it("has no duplicate codes", () => {
    expect(new Set(ORDER_REASON_CODES).size).toBe(ORDER_REASON_CODES.length);
  });

  it("maps every reason code to a status that exists in the lifecycle", () => {
    for (const [code, col2] of markdownCodeRows(errorsMd).filter(([, c]) =>
      /^`[a-z_]+`/.test(c),
    )) {
      const status = /^`([a-z_]+)`/.exec(col2)![1]!;
      expect(ORDER_STATUSES as readonly string[], `status of ${code}`).toContain(status);
    }
  });

  it("gives every terminal status at least one reason code (no dead end without a why)", () => {
    const statusesWithReason = new Set(
      markdownCodeRows(errorsMd)
        .filter(([, c]) => /^`[a-z_]+`/.test(c))
        .map(([, c]) => /^`([a-z_]+)`/.exec(c)![1]!),
    );
    for (const terminal of ORDER_TERMINAL_STATUSES) {
      expect(statusesWithReason, `reason code for ${terminal}`).toContain(terminal);
    }
  });
});

describe("lifecycle constants ↔ schema.sql", () => {
  it("lists the same statuses as the orders.status CHECK", () => {
    const start = schemaSql.indexOf("CHECK (status IN (");
    expect(start).toBeGreaterThan(-1);
    const body = schemaSql.slice(start, schemaSql.indexOf(")),", start));
    const inSql = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(inSql.sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it("defaults the column to the one initial status", () => {
    expect(schemaSql).toContain(`DEFAULT '${ORDER_INITIAL_STATUS}'`);
  });

  it("has no draft state anywhere (an unreachable state is an impossible state)", () => {
    expect(ORDER_STATUSES as readonly string[]).not.toContain("draft");
    expect(schemaSql).not.toMatch(/'draft'/);
    expect(openApiYml).not.toMatch(/- draft\b/);
  });

  it("matches the terminal list in ck_orders_terminal_needs_reason", () => {
    expect(sqlCheckValues(schemaSql, "ck_orders_terminal_needs_reason").sort()).toEqual(
      [...ORDER_TERMINAL_STATUSES].sort(),
    );
  });

  it("keeps driver-bound, pre-assignment, transient and terminal sets disjoint", () => {
    const groups = [
      ORDER_DRIVER_BOUND_STATUSES,
      ORDER_PRE_ASSIGNMENT_STATUSES,
      ORDER_TRANSIENT_STATUSES,
      ORDER_TERMINAL_STATUSES,
    ];
    const seen = new Set<string>();
    for (const group of groups) {
      for (const status of group) {
        expect(seen, `${status} classified twice`).not.toContain(status);
        seen.add(status);
      }
    }
  });

  it("classifies every status except the post-completion pair", () => {
    const classified = new Set<string>([
      ...ORDER_DRIVER_BOUND_STATUSES,
      ...ORDER_PRE_ASSIGNMENT_STATUSES,
      ...ORDER_TRANSIENT_STATUSES,
      ORDER_TERMINAL_STATUSES,
    ].flat() as string[]);
    const unclassified = ORDER_STATUSES.filter((s) => !classified.has(s));
    expect(unclassified.sort()).toEqual(["payment_disputed", "under_review"]);
  });

  it("declares transient states that are NOT terminal (§15.1 vs §16 resolved)", () => {
    for (const status of ORDER_TRANSIENT_STATUSES) {
      expect(ORDER_TERMINAL_STATUSES as readonly string[]).not.toContain(status);
    }
  });
});

describe("opaque identifiers", () => {
  it("mints order ids as ORD- + 10 digits, in the schema and in the package", () => {
    expect(schemaSql).toContain("order_public_id ~ '^ORD-[0-9]{10}$'");
    expect(ORDER_PUBLIC_ID_PATTERN.test("ORD-0000000042")).toBe(true);
    expect(ORDER_PUBLIC_ID_PATTERN.test("ORD-42")).toBe(false);
    expect(ORDER_PUBLIC_ID_PATTERN.test("WS-0000000042")).toBe(false);
  });

  it("takes the id from a database sequence, not from application logic", () => {
    expect(schemaSql).toContain("CREATE SEQUENCE IF NOT EXISTS order_public_id_seq");
  });

  it("treats driver and customer references as opaque WS- ids", () => {
    expect(schemaSql).toContain("driver_public_id ~ '^WS-[0-9]{10}$'");
    expect(schemaSql).toContain("customer_public_id ~ '^WS-[0-9]{10}$'");
    expect(WASLA_PUBLIC_ID_PATTERN.test("WS-0000000001")).toBe(true);
  });

  it("adds no foreign key to another service's table (driver / customer / zone)", () => {
    const foreignKeys = [...schemaSql.matchAll(/REFERENCES\s+([a-z_]+)\s*\(/g)].map(
      (m) => m[1]!,
    );
    for (const table of foreignKeys) {
      expect(
        ["orders", "order_assignments"],
        `unexpected FK target ${table}: cross-service FKs are forbidden (§37)`,
      ).toContain(table);
    }
  });
});

describe("intake contract mirrors the customer contract (ADR-009 handover)", () => {
  /** The `required: [...]` line of a named schema in an OpenAPI text file. */
  function requiredFields(yml: string, schemaName: string): string[] {
    const start = yml.indexOf(`    ${schemaName}:`);
    expect(start, `${schemaName} must exist`).toBeGreaterThan(-1);
    const section = yml.slice(start, start + 3000);
    const match = /required:\s*\n?\s*\[([^\]]+)\]/.exec(section);
    expect(match, `${schemaName} must declare required fields`).not.toBeNull();
    return match![1]!
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
  }

  /** The members of a named string enum in an OpenAPI text file. */
  function enumMembers(yml: string, schemaName: string): string[] {
    const start = yml.indexOf(`    ${schemaName}:`);
    expect(start, `${schemaName} must exist`).toBeGreaterThan(-1);
    const section = yml.slice(start, start + 800);
    const match = /enum:\s*\[([^\]]+)\]/.exec(section);
    expect(match, `${schemaName} must be a closed enum`).not.toBeNull();
    return match![1]!
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
  }

  it("requires the same fields on OrderIntakeRequest", () => {
    expect(requiredFields(openApiYml, "OrderIntakeRequest").sort()).toEqual(
      requiredFields(customerOpenApiYml, "OrderIntakeRequest").sort(),
    );
  });

  it("returns the same fields in OrderIntakeResult", () => {
    expect(requiredFields(openApiYml, "OrderIntakeResult").sort()).toEqual(
      requiredFields(customerOpenApiYml, "OrderIntakeResult").sort(),
    );
  });

  it.each(["OrderType", "VehicleClass", "PriceMode", "StopKind", "StopSource"])(
    "keeps the %s enum identical on both sides of the boundary",
    (schemaName) => {
      expect(enumMembers(openApiYml, schemaName)).toEqual(
        enumMembers(customerOpenApiYml, schemaName),
      );
    },
  );

  it("accepts exactly two stops (pickup + dropoff)", () => {
    expect(STOPS_PER_ORDER).toBe(2);
    expect(openApiYml).toContain("minItems: 2");
    expect(openApiYml).toContain("maxItems: 2");
  });

  it("keeps the shipment shape aligned (same optional fields)", () => {
    for (const field of ["shipment_type", "description", "weight_kg"]) {
      expect(openApiYml, `ShipmentDetails.${field}`).toContain(field);
      expect(customerOpenApiYml, `customer ShipmentDetails.${field}`).toContain(field);
    }
  });

  it("stores the same vehicle classes it accepts (schema ↔ api)", () => {
    const start = schemaSql.indexOf("CHECK (vehicle_class IN (");
    const body = schemaSql.slice(start, schemaSql.indexOf(")),", start));
    const inSql = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(inSql.sort()).toEqual(enumMembers(openApiYml, "VehicleClass").sort());
  });
});

describe("write-path invariants declared in the contract", () => {
  it("makes Idempotency-Key required on writes (§43)", () => {
    expect(openApiYml).toContain("name: Idempotency-Key");
    expect(schemaSql).toContain("idempotency_key       TEXT        NOT NULL");
  });

  it("detects key reuse by a stored payload fingerprint, not by field comparison", () => {
    expect(schemaSql).toContain("payload_fingerprint");
    expect(ORDER_ERROR_CODES).toContain("ORDER_IDEMPOTENCY_KEY_REUSED");
  });

  it("audits every transition in its own table with a per-order sequence", () => {
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS order_status_history");
    expect(schemaSql).toContain("ux_order_status_history_order_sequence");
  });

  it("rejects a transition to the same state (that is not a transition)", () => {
    expect(schemaSql).toContain("ck_order_status_history_progresses");
  });

  it("keeps an outbox table so no state change is published out of band", () => {
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS order_outbox");
    expect(schemaSql).toContain("published_at");
  });

  it("keeps money as integer minor units everywhere", () => {
    expect(schemaSql).toContain("offered_amount_minor  BIGINT");
    expect(schemaSql).not.toMatch(/NUMERIC\(\d+,\s*\d+\)\s+.*amount/i);
    expect(openApiYml).toContain("amount_minor");
  });

  it("exposes exactly one transition route (not one route per state)", () => {
    const transitionRoutes = [...openApiYml.matchAll(/^  \/orders\/.*transitions.*:$/gm)];
    expect(transitionRoutes).toHaveLength(1);
  });

  it("serves the port declared for the service", () => {
    expect(ORDER_SERVICE_PORT).toBe(8087);
    expect(openApiYml).toContain("http://localhost:8087");
  });
});

/**
 * The enum catalogs exported as values (MR 4/6) must equal the enums written in
 * api.openapi.yml. `satisfies` already prevents a member that is not in the
 * generated union; it cannot prevent a MISSING member — and a short catalog at
 * the HTTP edge rejects, with a 400, a payload the published contract accepts.
 * That failure mode is invisible in types and visible only here.
 */
describe("enum catalogs ↔ api.openapi.yml", () => {
  /** Members of a named schema's `enum`, inline (`[a, b]`) or block (`- a`). */
  function ymlEnum(schemaName: string): string[] {
    const start = openApiYml.indexOf(`    ${schemaName}:`);
    expect(start, `${schemaName} must exist in api.openapi.yml`).toBeGreaterThan(-1);
    const section = openApiYml.slice(start, openApiYml.indexOf("\n\n    ", start + 1));
    const inline = /enum:\s*\[([^\]]+)\]/.exec(section);
    if (inline) {
      return inline[1]!
        .split(",")
        .map((member) => member.trim())
        .filter(Boolean);
    }
    const blockStart = section.indexOf("enum:");
    expect(blockStart, `${schemaName} must declare an enum`).toBeGreaterThan(-1);
    return [...section.slice(blockStart).matchAll(/^\s+-\s+([a-z_]+)\s*$/gm)].map(
      (match) => match[1]!,
    );
  }

  const cases: Array<[string, readonly string[]]> = [
    ["OrderType", ORDER_TYPES],
    ["VehicleClass", ORDER_VEHICLE_CLASSES],
    ["PriceMode", ORDER_PRICE_MODES],
    ["StopKind", ORDER_STOP_KINDS],
    ["StopSource", ORDER_STOP_SOURCES],
    ["ActorType", ORDER_ACTOR_TYPES],
    ["AssignmentState", ORDER_ASSIGNMENT_STATES],
    ["ShipmentDetails", ORDER_SHIPMENT_TYPES],
  ];

  for (const [schemaName, catalog] of cases) {
    it(`lists exactly the members of ${schemaName}`, () => {
      expect([...catalog].sort()).toEqual(ymlEnum(schemaName).sort());
    });
  }

  it("keeps the order of stop kinds meaningful (pickup then dropoff)", () => {
    expect(ORDER_STOP_KINDS).toEqual(["pickup", "dropoff"]);
  });

  it("treats `offered` as a starting state and never as a resolution", () => {
    expect(ORDER_ASSIGNMENT_RESOLUTIONS as readonly string[]).not.toContain("offered");
    expect([...ORDER_ASSIGNMENT_RESOLUTIONS, "offered"].sort()).toEqual(
      [...ORDER_ASSIGNMENT_STATES].sort(),
    );
  });

  it("names `system` as the only actor without a personal reference", () => {
    expect(ORDER_ACTOR_TYPES).toContain("system");
    expect(openApiYml).toContain("إلزامي لكل `actor_type` غير `system`");
  });
});
