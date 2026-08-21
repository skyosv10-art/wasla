import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MATCHING_EVENT_TYPES } from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(resolve(__dirname, "../../../../../services/matching/contracts/events.json"), "utf8")) as { $id: string; $defs: Record<string, any> };
const EVENT_DEFS = ["DriverCandidacyUpdatedV1", "DriverAvailabilityChangedV1", "MatchingEvaluatedV1"] as const;
const FORBIDDEN = ["chat_id", "telegram", "telegram_id", "phone", "latitude", "longitude", "lat", "lng", "coordinates", "notes", "label", "description", "driver_name", "score", "score_bp", "candidates"];
function propertyNames(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) { for (const item of node) propertyNames(item, found); return found; }
  if (node && typeof node === "object") for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "properties" && value && typeof value === "object") for (const name of Object.keys(value as Record<string, unknown>)) found.add(name);
    propertyNames(value, found);
  }
  return found;
}

describe("matching events ↔ events.json", () => {
  it("defines exactly the events exported by the package", () => {
    expect(Object.keys(contract.$defs).filter((name) => name.endsWith("V1")).sort()).toEqual([...EVENT_DEFS].sort());
    expect(EVENT_DEFS.map((name) => contract.$defs[name].properties.event_type.const).sort()).toEqual(Object.values(MATCHING_EVENT_TYPES).sort());
  });
  it("closes every event payload", () => {
    for (const name of EVENT_DEFS) expect(contract.$defs[name].properties.data.additionalProperties, name).toBe(false);
  });
  it("has a stable matching event contract id and producer", () => {
    expect(contract.$id).toBe("https://wasla.local/matching/events/v1");
    expect(contract.$defs.EventEnvelope.properties.producer.const).toBe("matching-service");
  });
  it("finds no forbidden private or competitive field in any payload", () => {
    for (const name of EVENT_DEFS) {
      const names = propertyNames(contract.$defs[name].properties.data);
      for (const forbidden of FORBIDDEN) expect([...names], `${name} leaks ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("ADR-011 decision 8: matching.evaluated is aggregate-only", () => {
  const data = contract.$defs.MatchingEvaluatedV1.properties.data;
  it("carries count fields as integers only", () => {
    const counts = data.properties.counts;
    expect(counts.additionalProperties).toBe(false);
    for (const name of ["considered", "eligible", "returned", "excluded"]) {
      if (counts.properties[name]) expect(counts.properties[name].type).toBe("integer");
    }
  });
  it("carries neither a candidate array nor any score field", () => {
    const names = propertyNames(data);
    expect([...names]).not.toContain("candidates");
    expect([...names]).not.toContain("score");
    expect([...names]).not.toContain("score_bp");
  });
});
