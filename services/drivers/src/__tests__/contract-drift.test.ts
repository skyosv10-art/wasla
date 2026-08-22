/**
 * Drift guards — the tests whose only job is to fail when two files that must agree
 * stop agreeing.
 *
 * The direction matters and is deliberately BOTH ways:
 *   - a code the calculator can emit that the doc/contract does not list, and
 *   - a code the doc/contract lists that the calculator can never emit.
 * A one-way guard lets the contract grow a promise nothing keeps, which is the more
 * expensive of the two failures because a client will have written a branch for it.
 *
 * They read the contract and the documentation FROM DISK, and assert only on stable
 * structural tokens — never on Arabic prose. An earlier guard in `services/matching`
 * matched on wording and produced false failures every time an explanation was
 * improved, which taught people to ignore it.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DRIVER_DOCUMENT_TYPES,
  DRIVER_ELIGIBILITY_STATES,
  DRIVER_ERROR_CODES,
  DRIVER_EVENT_TYPES,
  ELIGIBILITY_REASON_CODES,
} from "@wasla/contracts-driver";
import { REASON_REPORT_ORDER } from "../domain/eligibility.js";
import { ELIGIBILITY_TRIGGERS, VEHICLE_SCOPED_DOCUMENT_TYPES } from "../domain/model.js";
import {
  candidacyPublicationToWire,
  driverDocumentToWire,
  driverProfileToWire,
  eligibilityTickToWire,
  eligibilityToWire,
  healthToWire,
  serviceZoneToWire,
  vehicleToWire,
} from "../mappers.js";

const here = dirname(fileURLToPath(import.meta.url));
const contracts = (name: string): string => readFileSync(resolve(here, "../../contracts", name), "utf8");
const doc = (name: string): string => readFileSync(resolve(here, "../../../../docs", name), "utf8");

/** The ```text block of DRIVER_CORE.md §2 — the formal definition, structure only. */
function formalDefinition(): string {
  const source = doc("03-domain/DRIVER_CORE.md");
  const start = source.indexOf("eligibility(driver, policy, now) =");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("```", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("حارس التباعد: أكواد الأسباب", () => {
  it("ترتيب التبليغ هو الكتالوج المنشور نفسه، لا نسخة منه", () => {
    expect([...REASON_REPORT_ORDER]).toEqual([...ELIGIBILITY_REASON_CODES]);
  });

  it("كلّ كود سبب مذكور في errors.md، وكلّ مذكور فيه مُصدَّر", () => {
    const catalogue = contracts("errors.md");
    for (const code of ELIGIBILITY_REASON_CODES) {
      expect(catalogue, `errors.md لا يذكر ${code}`).toContain(code);
    }
    // The other direction: a code documented but not exported is a promise to a
    // client that nothing in this service can keep.
    const documented = [...catalogue.matchAll(/\b([A-Z][A-Z_]{5,})\b/g)]
      .map((match) => match[1] as string)
      .filter((token) => /^(PROFILE|NO|DOCUMENT)_/.test(token));
    for (const token of new Set(documented)) {
      expect([...ELIGIBILITY_REASON_CODES], `${token} موثّق وغير مُصدَّر`).toContain(token);
    }
  });

  it("كلّ حالة أهليّة وكلّ مُحرّك مذكور في التعريف الرسميّ أو في العقد", () => {
    const formal = formalDefinition();
    for (const state of DRIVER_ELIGIBILITY_STATES) {
      expect(formal, `التعريف الرسميّ لا يذكر الحالة ${state}`).toContain(state);
    }
    // Triggers live in the schema, not in the formal function: they say what CAUSED
    // an evaluation, not what it decided.
    const schema = contracts("schema.sql");
    for (const trigger of ELIGIBILITY_TRIGGERS) {
      expect(schema, `schema.sql لا يذكر المُحرّك ${trigger}`).toContain(`'${trigger}'`);
    }
  });

  it("شروط التعريف الرسميّ كلّها ممثّلة بكود سبب", () => {
    const formal = formalDefinition();
    // Each structural token in the formal definition must have a reason code that
    // reports its failure, or a driver can be refused for a condition we cannot name.
    const bindings: readonly (readonly [string, string])[] = [
      ["require_primary_vehicle", "NO_PRIMARY_VEHICLE"],
      ["require_service_zone", "NO_SERVICE_ZONE"],
      ["service_kinds", "NO_SERVICE_KIND"],
      ["verification_status", "PROFILE_NOT_VERIFIED"],
      ["document_grace_days", "DOCUMENT_EXPIRED"],
      ["'suspended'", "PROFILE_SUSPENDED"],
    ];
    for (const [token, code] of bindings) {
      expect(formal, `التعريف الرسميّ لا يذكر ${token}`).toContain(token);
      expect([...ELIGIBILITY_REASON_CODES]).toContain(code);
    }
  });

  it("أنواع الوثائق المرتبطة بمركبة هي ما ينصّ عليه قيد النطاق في القاعدة", () => {
    const schema = contracts("schema.sql");
    const constraint = schema.slice(schema.indexOf("ck_driver_documents_vehicle_scope"));
    const block = constraint.slice(0, constraint.indexOf(")"));
    for (const type of VEHICLE_SCOPED_DOCUMENT_TYPES) {
      expect(block, `القيد لا يذكر ${type}`).toContain(type);
    }
    const vehicleScoped: readonly string[] = VEHICLE_SCOPED_DOCUMENT_TYPES;
    for (const type of DRIVER_DOCUMENT_TYPES) {
      if (vehicleScoped.includes(type)) continue;
      // A personal document inside the vehicle-scope constraint would silently start
      // requiring a vehicle id, and the driver would be told to name a car for his
      // national id.
      expect(block, `${type} شخصيّة ووردت في قيد نطاق المركبة`).not.toContain(type);
    }
  });

  it("كلّ نوع حدث مُصدَّر موصوف في events.json والعكس", () => {
    // The registry is a JSON Schema document, so each event is a `$defs` entry whose
    // `event_type` is pinned with `const`. Reading the `const` rather than the key
    // name is what makes this guard catch a RENAMED wire value, which is the change
    // that actually breaks subscribers.
    const registry = JSON.parse(contracts("events.json")) as {
      $defs: Record<string, { properties?: { event_type?: { const?: string } } }>;
    };
    const described = Object.values(registry.$defs)
      .map((definition) => definition.properties?.event_type?.const)
      .filter((value): value is string => typeof value === "string");
    const exported = Object.values(DRIVER_EVENT_TYPES);
    expect([...described].sort()).toEqual([...exported].sort());
  });

  it("كلّ كود خطأ مُصدَّر موثّق في errors.md والعكس", () => {
    const catalogue = contracts("errors.md");
    for (const code of DRIVER_ERROR_CODES) {
      expect(catalogue, `errors.md لا يذكر ${code}`).toContain(code);
    }
    const documented = new Set(
      [...catalogue.matchAll(/\bDRIVER_[A-Z_]+\b/g)].map((match) => match[0]),
    );
    for (const token of documented) {
      expect([...DRIVER_ERROR_CODES], `${token} موثّق وغير مُصدَّر`).toContain(token);
    }
  });
});

describe("حارس التباعد: المُطابِقات مقابل OpenAPI", () => {
  const spec = contracts("api.openapi.yml");

  /** The `required:` list of one schema, read as plain YAML tokens. */
  function requiredKeys(schemaName: string): string[] {
    const start = spec.indexOf(`    ${schemaName}:`);
    expect(start, `المخطّط ${schemaName} غير موجود`).toBeGreaterThan(-1);
    const rest = spec.slice(start);
    const requiredAt = rest.indexOf("required:");
    expect(requiredAt).toBeGreaterThan(-1);
    const block = rest.slice(requiredAt, rest.indexOf("properties:", requiredAt));
    return [...block.matchAll(/[-[,]\s*([a-z_]+)/g)].map((match) => match[1] as string);
  }

  /**
   * The DECLARED property names of one schema — the other direction of the same guard.
   *
   * Read at a fixed indent (schemas at 4, their properties at 8) instead of with a
   * YAML parser, for the same reason `requiredKeys` does: adding a parser dependency
   * to a guard makes the guard something to keep working, and the file's shape is
   * enforced by `repo-structure` anyway. A nested `description: |` block cannot be
   * mistaken for a property because its continuation lines are indented deeper and
   * carry no `key:` at column 8.
   */
  function propertyKeys(schemaName: string): string[] {
    const start = spec.indexOf(`    ${schemaName}:`);
    expect(start, `المخطّط ${schemaName} غير موجود`).toBeGreaterThan(-1);
    const rest = spec.slice(start + 1);
    const nextSchema = rest.search(/\n {4}[A-Za-z]/);
    const block = nextSchema === -1 ? rest : rest.slice(0, nextSchema);
    const propertiesAt = block.indexOf("      properties:");
    expect(propertiesAt, `${schemaName} بلا properties`).toBeGreaterThan(-1);
    return [...block.slice(propertiesAt).matchAll(/\n {8}([a-z_]+):/g)].map(
      (match) => match[1] as string,
    );
  }

  // `object` rather than `Record<string, unknown>`: the wire types are closed
  // interfaces on purpose, and widening them here just to satisfy the table would
  // hand every one of them an index signature it must not have.
  const cases: readonly (readonly [string, object])[] = [
    [
      "DriverProfile",
      driverProfileToWire({
        waslaPublicId: "WS-1000000001",
        displayName: null,
        preferredLocale: "ar",
        status: "active",
        verificationStatus: "unverified",
        declaredAvailability: "offline",
        workCityZoneId: null,
        serviceKinds: ["ride"],
        suspensionReasonCode: null,
        eligibilityPolicyVersion: 1,
        eligibilityRecheckAt: null,
        lastPublishedState: null,
        lastPublishedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ],
    ["ServiceZone", serviceZoneToWire({ zoneId: "z", preferenceRank: 1, createdAt: "t" })],
    [
      "Vehicle",
      vehicleToWire({
        id: "v",
        waslaPublicId: "WS-1000000001",
        vehicleClass: "sedan",
        status: "active",
        isPrimary: true,
        make: null,
        model: null,
        modelYear: null,
        color: null,
        plateNumber: null,
        idempotencyKey: "k",
        createdAt: "t",
        updatedAt: "t",
      }),
    ],
    [
      "DriverDocument",
      driverDocumentToWire({
        id: "d",
        waslaPublicId: "WS-1000000001",
        documentType: "national_id",
        status: "pending",
        vehicleId: null,
        storageRef: "s3://x",
        issuedAt: null,
        expiresAt: null,
        reviewedAt: null,
        reviewedBy: null,
        rejectionReasonCode: null,
        idempotencyKey: "k",
        createdAt: "t",
        updatedAt: "t",
      }),
    ],
    [
      "EligibilityTickResult",
      eligibilityTickToWire({
        recheckedDrivers: 0,
        changedDrivers: 0,
        published: 0,
        publishFailures: 0,
      }),
    ],
    ["HealthStatus", healthToWire({ status: "ok", persistence: "memory", lastTickAt: null })],
    [
      "EligibilityView",
      eligibilityToWire("WS-1000000001", {
        state: "eligible",
        reasonCodes: [],
        deficits: [],
        policyVersion: 1,
        evaluatedAt: "t",
        recheckAt: null,
      }),
    ],
  ];

  for (const [schemaName, wire] of cases) {
    it(`${schemaName}: كلّ حقل مطلوب في العقد يُنتجه المُطابِق`, () => {
      const produced = Object.keys(wire);
      for (const key of requiredKeys(schemaName)) {
        // A required field the mapper never emits is a 200 response that fails the
        // client's own validation — the worst kind, because our logs show success.
        expect(produced, `${schemaName}.${key} مطلوب ولا يُنتجه المُطابِق`).toContain(key);
      }
    });

    it(`${schemaName}: كلّ حقل يُنتجه المُطابِق مُعلَن في العقد`, () => {
      // The direction that was missing until Phase 05 · MR 4/6, and it was missing
      // where it mattered: every schema here declares `additionalProperties: false`,
      // so ONE extra key makes a correct `200` fail a strict client's validation —
      // and our own logs record a success. `vehicleToWire` and `driverDocumentToWire`
      // were both emitting `wasla_public_id`, undeclared, for three MRs.
      const declared = propertyKeys(schemaName);
      for (const key of Object.keys(wire)) {
        expect(declared, `${schemaName}.${key} يُنتَج وغير مُعلَن في العقد`).toContain(key);
      }
    });
  }

  it("سجلّ النشر يخرج بمفاتيح snake_case فقط", () => {
    const wire = candidacyPublicationToWire({
      waslaPublicId: "WS-1000000001",
      eligibilityState: "eligible",
      availabilityState: "available",
      serviceKinds: ["ride"],
      zoneIds: [],
      vehicleClass: "sedan",
      outcome: "published",
      failureCode: null,
      attemptedAt: "t",
    });
    for (const key of Object.keys(wire)) {
      // One camelCase key escaping here is a field the HTTP layer will then handle
      // "just this once", and the boundary stops being a boundary.
      expect(key, `${key} ليس snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
