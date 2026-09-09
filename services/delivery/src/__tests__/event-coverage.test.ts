/**
 * Event-coverage contract test (review 2/N — ADR-026 §2.4).
 *
 * Reads the canonical dispatch `events.json` (JSON Schema) and proves that
 * EVERY event type declared in the dispatch contract is explicitly
 * classified by the delivery relay's `classifyDispatchEvent`. A new dispatch
 * event type that the relay does not yet handle FAILS this test — it is
 * never silently dropped.
 *
 * Also proves the routing-key invariant: every dispatch event payload
 * requires `job_id` (the only legal join to a delivery task, per the
 * ORD-/WS- referential mismatch finding), and the dispatch-internal trio
 * (offer_sent, offer_rejected, escalated) is explicitly `ignored` with a
 * reason — not dropped.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyDispatchEvent,
  DISPATCH_EVENT_TYPES,
  type DispatchOutboxRow,
} from "../domain/consumed-events.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const eventsPath = resolve(__dirname, "../../../dispatch/contracts/events.json");
const eventsRaw = readFileSync(eventsPath, "utf8");
const events = JSON.parse(eventsRaw) as {
  $defs?: Record<string, { properties?: { event_type?: { const?: string }; data?: { required?: string[] } } }>;
};

/** Extract every event_type const declared in events.json $defs. */
function declaredEventTypes(): string[] {
  const defs = events.$defs ?? {};
  const types: string[] = [];
  for (const def of Object.values(defs)) {
    const t = def.properties?.event_type?.const;
    if (typeof t === "string") types.push(t);
  }
  return types.sort();
}

/** Every event type whose payload schema requires job_id. */
function typesRequiringJobId(): string[] {
  const defs = events.$defs ?? {};
  const types: string[] = [];
  for (const def of Object.values(defs)) {
    const t = def.properties?.event_type?.const;
    if (typeof t === "string" && def.properties?.data?.required?.includes("job_id")) types.push(t);
  }
  return types.sort();
}

function sampleRow(eventType: string): DispatchOutboxRow {
  return {
    event_id: "00000000-0000-0000-0000-000000000001",
    event_type: eventType as DispatchOutboxRow["event_type"],
    event_version: "v1",
    aggregate_type: "dispatch_job",
    aggregate_id: "00000000-0000-0000-0000-000000000000",
    occurred_at: "2026-01-01T00:00:00.000Z",
    trace_id: null,
    // job_id is required by every dispatch payload — the routing key; the
    // remaining fields satisfy every event kind's validators.
    data: {
      job_id: "00000000-0000-0000-0000-000000000000",
      reason_code: "REASON",
      driver_public_id: "WS-0123456789",
      wave_number: 1,
      offer_count: 0,
      accepted_at: "2026-01-01T00:00:00.000Z",
      timed_out_at: "2026-01-01T00:00:00.000Z",
      exhausted_at: "2026-01-01T00:00:00.000Z",
      cancelled_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("event coverage — every dispatch event type is explicitly classified", () => {
  it("the TS const list matches the dispatch events.json schema exactly (drift guard)", () => {
    const schema = declaredEventTypes();
    const ts = [...DISPATCH_EVENT_TYPES].sort();
    expect(schema).toEqual(ts);
  });

  it("every declared event type is classified (none silently dropped)", () => {
    for (const eventType of declaredEventTypes()) {
      const classification = classifyDispatchEvent(sampleRow(eventType));
      expect(classification.kind).toMatch(/^(projectable|ignored)$/);
      if (classification.kind === "ignored") {
        expect(classification.reason).toBeTruthy();
      }
    }
  });

  it("every dispatch payload requires job_id — the routing key is contractual", () => {
    expect(typesRequiringJobId()).toEqual(declaredEventTypes());
  });

  it("dispatch-internal lifecycle events are explicitly ignored with a reason, never dropped", () => {
    for (const eventType of ["dispatch.offer_sent", "dispatch.offer_rejected", "dispatch.escalated"]) {
      const classification = classifyDispatchEvent(sampleRow(eventType));
      expect(classification.kind).toBe("ignored");
      expect(classification.kind === "ignored" && classification.reason).toBeTruthy();
    }
  });
});
