import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = join(__dirname, "..", "..", "contracts");

describe("boundary — no PII in contracts (ADR-049 §8)", () => {
  const files = ["api.openapi.yml", "events.json", "errors.md", "schema.sql"];

  for (const file of files) {
    it(`${file} contains no chat_id, telegram, whatsapp, phone, or free_text fields`, () => {
      const content = readFileSync(join(contractsDir, file), "utf-8");
      expect(content).not.toMatch(/chat_id|telegram|whatsapp/i);
      expect(content).not.toMatch(/phone_number|phone\b/i);
      expect(content).not.toMatch(/free_text|message_body/i);
    });
  }
});

describe("boundary — no cross-service FK (ADR-049 §1)", () => {
  it("schema.sql has no REFERENCES to tables outside support service", () => {
    const schema = readFileSync(join(contractsDir, "schema.sql"), "utf-8");
    // support_evidence references support_tickets (same service) — allowed
    // No REFERENCES to customers, orders, drivers, etc.
    const forbiddenRefs = /REFERENCES\s+(?!support_tickets\b)\w+/gi;
    const matches = schema.match(forbiddenRefs);
    // Only support_tickets FK is allowed
    if (matches) {
      for (const m of matches) {
        expect(m).toMatch(/REFERENCES\s+support_tickets/i);
      }
    }
  });
});

describe("boundary — port 8095 uniqueness (ADR-049 §6)", () => {
  it("api.openapi.yml uses port 8095", () => {
    const openapi = readFileSync(join(contractsDir, "api.openapi.yml"), "utf-8");
    expect(openapi).toContain("8095");
  });
});

describe("boundary — no punitive event types (ADR-049 §1)", () => {
  it("events.json event_type enum has no subject_suspended or subject_blocked", () => {
    const events = JSON.parse(readFileSync(join(contractsDir, "events.json"), "utf-8"));
    const eventTypes = events.$defs.EventEnvelope.properties.event_type.enum;
    expect(eventTypes).not.toContain("support.subject_suspended");
    expect(eventTypes).not.toContain("support.subject_blocked");
    expect(eventTypes).not.toContain("support.ticket_punished");
  });
});
