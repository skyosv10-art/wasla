import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DISPATCH_EVENT_TYPES } from "../index.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(resolve(__dirname, "../../../../../services/dispatch/contracts/events.json"), "utf8")) as { $defs: Record<string, any>; $id: string };
const EVENT_DEFS = ["DispatchJobCreatedV1", "DispatchWaveOpenedV1", "DispatchOfferSentV1", "DispatchOfferAcceptedV1", "DispatchOfferRejectedV1", "DispatchOfferTimedOutV1", "DispatchEscalatedV1", "DispatchJobExhaustedV1", "DispatchJobCancelledV1"] as const;
const FORBIDDEN = ["chat_id", "telegram", "telegram_id", "phone", "latitude", "longitude", "lat", "lng", "coordinates", "notes", "label", "description", "driver_name", "score", "score_bp", "candidates"];
function propertyNames(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) { for (const item of node) propertyNames(item, found); return found; }
  if (node && typeof node === "object") for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "properties" && value && typeof value === "object") for (const name of Object.keys(value as Record<string, unknown>)) found.add(name);
    propertyNames(value, found);
  }
  return found;
}
describe("dispatch events ↔ events.json", () => {
  it("defines exactly the events exported by the package", () => {
    expect(Object.keys(contract.$defs).filter((name) => name.endsWith("V1")).sort()).toEqual([...EVENT_DEFS].sort());
    expect(EVENT_DEFS.map((name) => contract.$defs[name].properties.event_type.const).sort()).toEqual(Object.values(DISPATCH_EVENT_TYPES).sort());
  });
  it("closes every event payload", () => { for (const name of EVENT_DEFS) expect(contract.$defs[name].properties.data.additionalProperties, name).toBe(false); });
  it("has a stable dispatch event contract id and producer", () => {
    expect(contract.$id).toBe("https://wasla.local/dispatch/events/v1");
    expect(contract.$defs.EventEnvelope.properties.producer.const).toBe("dispatch-service");
  });
  it("finds no forbidden private field in any payload", () => {
    for (const name of EVENT_DEFS) for (const forbidden of FORBIDDEN) expect([...propertyNames(contract.$defs[name].properties.data)], `${name} leaks ${forbidden}`).not.toContain(forbidden);
  });
});
