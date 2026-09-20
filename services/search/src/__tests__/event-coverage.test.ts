/**
 * Event-coverage contract test (review 2/N).
 *
 * Reads the canonical marketplace `events.json` (JSON Schema) and proves that
 * EVERY event type declared in the contract is explicitly classified by the
 * search relay's `classifyEvent`. A new marketplace event type that the relay
 * does not yet handle FAILS this test — it is never silently dropped.
 *
 * Also asserts the `store_staff_*` events are explicitly `ignored` (they do
 * not affect product visibility per ADR-016 decision 3) — not dropped.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyEvent, type MarketplaceOutboxRow } from "../domain/consumed-events.js";
import { MARKETPLACE_EVENT_TYPES } from "@wasla/contracts-marketplace";

const __dirname = dirname(fileURLToPath(import.meta.url));
const eventsPath = resolve(__dirname, "../../../marketplace/contracts/events.json");
const eventsRaw = readFileSync(eventsPath, "utf8");
const events = JSON.parse(eventsRaw) as { $defs?: Record<string, { properties?: { event_type?: { const?: string } } }> };

/** Extract the 13 event_type consts declared in events.json $defs. */
function declaredEventTypes(): string[] {
  const defs = events.$defs ?? {};
  const types: string[] = [];
  for (const def of Object.values(defs)) {
    const t = def.properties?.event_type?.const;
    if (typeof t === "string") types.push(t);
  }
  return types.sort();
}

function sampleRow(eventType: string): MarketplaceOutboxRow {
  return {
    outbox_id: "00000000-0000-0000-0000-000000000001",
    event_type: eventType as MarketplaceOutboxRow["event_type"],
    event_version: "v1",
    aggregate_type: "store",
    aggregate_id: "00000000-0000-0000-0000-000000000000",
    occurred_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    trace_id: null,
    data: { store_id: "s", store_slug: "s", category_slug: "c", occurred_for: "2026-01-01T00:00:00.000Z" },
  };
}

describe("event coverage — every marketplace event type is explicitly classified", () => {
  it("the TS const list matches the events.json schema exactly (drift guard)", () => {
    const schema = declaredEventTypes();
    const ts = [...MARKETPLACE_EVENT_TYPES].sort();
    expect(schema).toEqual(ts);
  });

  it("every declared event type is classified (none silently dropped)", () => {
    for (const eventType of declaredEventTypes()) {
      const row = sampleRow(eventType);
      const classification = classifyEvent(row);
      expect(classification.kind).toMatch(/^(projectable|ignored)$/);
      if (classification.kind === "ignored") {
        expect(classification.reason).toBeTruthy();
      }
    }
  });

  it("store_staff_* events are explicitly ignored with a reason, never dropped", () => {
    for (const eventType of declaredEventTypes().filter((t) => t.includes("store_staff"))) {
      const classification = classifyEvent(sampleRow(eventType));
      expect(classification.kind).toBe("ignored");
      expect(classification.kind === "ignored" && classification.reason).toContain("visibility");
    }
  });
});
