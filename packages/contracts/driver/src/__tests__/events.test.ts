import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DRIVER_EVENT_TYPES, ELIGIBILITY_REASON_CODES } from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(resolve(__dirname, "../../../../../services/drivers/contracts/events.json"), "utf8")) as { $id: string; $defs: Record<string, any> };

const EVENT_DEFS = [
  "DriverRegisteredV1", "DriverProfileUpdatedV1", "DriverServiceZonesChangedV1",
  "DriverVehicleRegisteredV1", "DriverVehicleStatusChangedV1",
  "DriverDocumentSubmittedV1", "DriverDocumentReviewedV1",
  "DriverAvailabilityDeclaredV1", "DriverEligibilityChangedV1",
  "DriverSuspendedV1", "DriverReinstatedV1",
] as const;

/**
 * الحقول الممنوعة في أي حمولة (ADR-012 القرار 8). الحارس آليّ لأنّ الانضباط اليدويّ
 * ينهار عند أول تعديل مستعجل، و`storage_ref` هنا خاصّةً: تسريبه يجعل ناقل الأحداث طريقاً
 * جانبياً إلى ملفّات هوية لا يملك المستهلك صلاحية قراءتها.
 */
const FORBIDDEN = [
  "chat_id", "telegram", "telegram_id", "telegram_user_id", "phone", "phone_number",
  "full_name", "display_name", "driver_name", "national_id", "national_id_number",
  "license_number", "plate_number", "plate", "storage_ref", "document_url", "file_url",
  "iban", "bank_account", "latitude", "longitude", "lat", "lng", "coordinates",
  "notes", "address",
];

function propertyNames(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) { for (const item of node) propertyNames(item, found); return found; }
  if (node && typeof node === "object") for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "properties" && value && typeof value === "object") for (const name of Object.keys(value as Record<string, unknown>)) found.add(name);
    propertyNames(value, found);
  }
  return found;
}

describe("driver events ↔ events.json", () => {
  it("defines exactly the events exported by the package", () => {
    expect(Object.keys(contract.$defs).filter((name) => name.endsWith("V1")).sort()).toEqual([...EVENT_DEFS].sort());
    expect(EVENT_DEFS.map((name) => contract.$defs[name].properties.event_type.const).sort()).toEqual(Object.values(DRIVER_EVENT_TYPES).sort());
  });
  it("closes every event payload", () => {
    for (const name of EVENT_DEFS) expect(contract.$defs[name].properties.data.additionalProperties, name).toBe(false);
  });
  it("pins every event to the envelope and to version v1", () => {
    for (const name of EVENT_DEFS) {
      expect(contract.$defs[name].allOf, name).toEqual([{ $ref: "#/$defs/EventEnvelope" }]);
      expect(contract.$defs[name].properties.event_version.const, name).toBe("v1");
    }
  });
  it("has a stable driver event contract id and producer", () => {
    expect(contract.$id).toBe("https://wasla.local/drivers/events/v1");
    expect(contract.$defs.EventEnvelope.properties.producer.const).toBe("drivers-service");
  });
  it("finds no forbidden private field in any payload", () => {
    for (const name of EVENT_DEFS) {
      const names = propertyNames(contract.$defs[name].properties.data);
      for (const forbidden of FORBIDDEN) expect([...names], `${name} leaks ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("ADR-012 decision 2: eligibility is derived and always explains itself", () => {
  const data = contract.$defs.DriverEligibilityChangedV1.properties.data;
  it("requires reasons, policy version and trigger on every change", () => {
    for (const field of ["to_state", "reasons", "policy_version", "trigger"]) {
      expect(data.required, field).toContain(field);
    }
  });
  it("closes the reason vocabulary against the package catalog", () => {
    expect([...contract.$defs.EligibilityReasonCode.enum].sort()).toEqual([...ELIGIBILITY_REASON_CODES].sort());
  });
  it("keeps the derived state vocabulary closed", () => {
    expect(contract.$defs.EligibilityState.enum).toEqual(["eligible", "ineligible", "suspended", "unknown"]);
  });
});

describe("ADR-012 decision 4: busy is never a driver word", () => {
  it("omits busy from the declared availability vocabulary", () => {
    expect(contract.$defs.DeclaredAvailability.enum).toEqual(["available", "offline"]);
  });
  it("carries no availability_state field in any payload", () => {
    for (const name of EVENT_DEFS) {
      expect([...propertyNames(contract.$defs[name].properties.data)], name).not.toContain("availability_state");
    }
  });
});
