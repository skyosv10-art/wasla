import { describe, it, expect } from "vitest";
import {
  SUPPORT_TICKET_STATES,
  SUPPORT_TICKET_TYPES,
  SUPPORT_RESOLUTION_REASONS,
  SUPPORT_EVIDENCE_TYPES,
  SUPPORT_ESCALATION_LEVELS,
  SUPPORT_EVENT_TYPES,
  SUPPORT_FORBIDDEN_EVENT_TYPES,
  SUPPORT_EVENT_FORBIDDEN_FIELDS,
  SUPPORT_ERROR_CODES,
  SUPPORT_SERVICE_PORT,
  httpStatusForSupportError,

} from "../index.js";

describe("support contracts — frozen arrays", () => {
  it("exposes exactly 5 ticket states in lifecycle order", () => {
    expect(SUPPORT_TICKET_STATES).toEqual([
      "open",
      "investigating",
      "escalated",
      "resolved",
      "closed",
    ]);
  });

  it("exposes exactly 4 ticket types", () => {
    expect(SUPPORT_TICKET_TYPES).toHaveLength(4);
    expect(SUPPORT_TICKET_TYPES).toContain("order_issue");
    expect(SUPPORT_TICKET_TYPES).toContain("behavior_complaint");
    expect(SUPPORT_TICKET_TYPES).toContain("payment_dispute");
    expect(SUPPORT_TICKET_TYPES).toContain("service_quality");
  });

  it("exposes exactly 4 resolution reasons", () => {
    expect(SUPPORT_RESOLUTION_REASONS).toHaveLength(4);
  });

  it("exposes exactly 3 evidence types", () => {
    expect(SUPPORT_EVIDENCE_TYPES).toEqual(["photo", "message", "order_log"]);
  });

  it("exposes exactly 3 escalation levels in tier order", () => {
    expect(SUPPORT_ESCALATION_LEVELS).toEqual([
      "support_agent",
      "support_supervisor",
      "admin",
    ]);
  });

  it("exposes exactly 3 event types", () => {
    expect(SUPPORT_EVENT_TYPES).toHaveLength(3);
    expect(SUPPORT_EVENT_TYPES).toContain("support.ticket_opened");
    expect(SUPPORT_EVENT_TYPES).toContain("support.ticket_escalated");
    expect(SUPPORT_EVENT_TYPES).toContain("support.ticket_resolved");
  });

  it("forbids punitive event types (ADR-049 §1 — service does not punish)", () => {
    expect(SUPPORT_FORBIDDEN_EVENT_TYPES).toContain("support.ticket_punished");
    expect(SUPPORT_FORBIDDEN_EVENT_TYPES).toContain("support.subject_suspended");
    expect(SUPPORT_FORBIDDEN_EVENT_TYPES).toContain("support.subject_blocked");
  });

  it("forbids PII fields in events (ADR-049 §8)", () => {
    expect(SUPPORT_EVENT_FORBIDDEN_FIELDS).toContain("chat_id");
    expect(SUPPORT_EVENT_FORBIDDEN_FIELDS).toContain("telegram");
    expect(SUPPORT_EVENT_FORBIDDEN_FIELDS).toContain("phone");
    expect(SUPPORT_EVENT_FORBIDDEN_FIELDS).toContain("name");
    expect(SUPPORT_EVENT_FORBIDDEN_FIELDS).toContain("free_text");
  });

  it("exposes exactly 7 error codes", () => {
    expect(SUPPORT_ERROR_CODES).toHaveLength(7);
  });

  it("uses port 8095 — no collision with prior phases", () => {
    expect(SUPPORT_SERVICE_PORT).toBe(8095);
  });
});

describe("httpStatusForSupportError", () => {
  it("maps validation errors to 422", () => {
    expect(httpStatusForSupportError("SUPPORT_VALIDATION_FAILED")).toBe(422);
    expect(httpStatusForSupportError("SUPPORT_RESOLUTION_REASON_REQUIRED")).toBe(422);
  });

  it("maps not-found errors to 404", () => {
    expect(httpStatusForSupportError("SUPPORT_TICKET_NOT_FOUND")).toBe(404);
    expect(httpStatusForSupportError("SUPPORT_EVIDENCE_NOT_FOUND")).toBe(404);
  });

  it("maps state/evidence constraint errors to 409", () => {
    expect(httpStatusForSupportError("SUPPORT_EVIDENCE_REQUIRED")).toBe(409);
    expect(httpStatusForSupportError("SUPPORT_INVALID_STATE_TRANSITION")).toBe(409);
    expect(httpStatusForSupportError("SUPPORT_TICKET_ALREADY_CLOSED")).toBe(409);
  });
});
