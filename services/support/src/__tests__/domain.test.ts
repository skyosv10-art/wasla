import { describe, it, expect } from "vitest";
import {
  SUPPORT_TICKET_STATES,
  SUPPORT_TICKET_TYPES,
  SUPPORT_RESOLUTION_REASONS,
  SUPPORT_EVIDENCE_TYPES,
  SUPPORT_ESCALATION_LEVELS,
  SUPPORT_TICKET_TRANSITIONS,
  SUPPORT_ERROR_CODES,
  canTransition,
  supportErrors,
  isSupportError,
} from "../index.js";

describe("ticket lifecycle — no skipping (ADR-049 §2)", () => {
  it("allows open → investigating", () => {
    expect(canTransition("open", "investigating")).toBe(true);
  });

  it("allows investigating → escalated", () => {
    expect(canTransition("investigating", "escalated")).toBe(true);
  });

  it("allows investigating → resolved", () => {
    expect(canTransition("investigating", "resolved")).toBe(true);
  });

  it("allows escalated → resolved", () => {
    expect(canTransition("escalated", "resolved")).toBe(true);
  });

  it("allows resolved → closed", () => {
    expect(canTransition("resolved", "closed")).toBe(true);
  });

  it("forbids skipping: open → resolved", () => {
    expect(canTransition("open", "resolved")).toBe(false);
  });

  it("forbids skipping: open → escalated", () => {
    expect(canTransition("open", "escalated")).toBe(false);
  });

  it("forbids skipping: investigating → closed", () => {
    expect(canTransition("investigating", "closed")).toBe(false);
  });

  it("forbids transition from closed (terminal state)", () => {
    expect(canTransition("closed", "open")).toBe(false);
    expect(canTransition("closed", "investigating")).toBe(false);
  });

  it("forbids backward: resolved → investigating", () => {
    expect(canTransition("resolved", "investigating")).toBe(false);
  });

  it("has exactly 5 states", () => {
    expect(SUPPORT_TICKET_STATES).toHaveLength(5);
  });
});

describe("ticket types — closed list (ADR-049 §3)", () => {
  it("has exactly 4 types", () => {
    expect(SUPPORT_TICKET_TYPES).toHaveLength(4);
  });
});

describe("resolution reasons — closed list (ADR-049 §4)", () => {
  it("has exactly 4 reasons", () => {
    expect(SUPPORT_RESOLUTION_REASONS).toHaveLength(4);
  });
});

describe("evidence types — closed list (ADR-049 §4)", () => {
  it("has exactly 3 types", () => {
    expect(SUPPORT_EVIDENCE_TYPES).toEqual(["photo", "message", "order_log"]);
  });
});

describe("escalation levels — 3-tier (ADR-049 §5)", () => {
  it("has exactly 3 levels in order", () => {
    expect(SUPPORT_ESCALATION_LEVELS).toEqual([
      "support_agent",
      "support_supervisor",
      "admin",
    ]);
  });
});

describe("SupportError", () => {
  it("creates evidence required error with correct code and status", () => {
    const err = supportErrors.evidenceRequired("ticket-123");
    expect(err.code).toBe("SUPPORT_EVIDENCE_REQUIRED");
    expect(err.httpStatus).toBe(409);
    expect(err.details?.ticket_id).toBe("ticket-123");
    expect(err.details?.constraint).toBe("support_evidence_gate");
  });

  it("creates invalid transition error", () => {
    const err = supportErrors.invalidTransition("open", "resolved");
    expect(err.code).toBe("SUPPORT_INVALID_STATE_TRANSITION");
    expect(err.httpStatus).toBe(409);
    expect(err.details?.from).toBe("open");
    expect(err.details?.to).toBe("resolved");
  });

  it("creates resolution reason required error", () => {
    const err = supportErrors.resolutionReasonRequired("ticket-456");
    expect(err.code).toBe("SUPPORT_RESOLUTION_REASON_REQUIRED");
    expect(err.httpStatus).toBe(422);
  });

  it("creates ticket not found error", () => {
    const err = supportErrors.ticketNotFound("ticket-789");
    expect(err.code).toBe("SUPPORT_TICKET_NOT_FOUND");
    expect(err.httpStatus).toBe(404);
  });

  it("creates ticket already closed error", () => {
    const err = supportErrors.ticketAlreadyClosed("ticket-000");
    expect(err.code).toBe("SUPPORT_TICKET_ALREADY_CLOSED");
    expect(err.httpStatus).toBe(409);
  });

  it("isSupportError returns true for SupportError instances", () => {
    const err = supportErrors.evidenceRequired("x");
    expect(isSupportError(err)).toBe(true);
    expect(isSupportError(new Error("plain"))).toBe(false);
  });

  it("does not produce punitive error codes (ADR-049 §1)", () => {
    // No SUPPORT_SUBJECT_SUSPENDED or SUPPORT_SUBJECT_BLOCKED in the catalog
    const codes = SUPPORT_ERROR_CODES as readonly string[];
    expect(codes).not.toContain("SUPPORT_SUBJECT_SUSPENDED");
    expect(codes).not.toContain("SUPPORT_SUBJECT_BLOCKED");
  });
});

describe("transitions table — completeness", () => {
  it("every state has an entry in the transitions table", () => {
    for (const state of SUPPORT_TICKET_STATES) {
      expect(SUPPORT_TICKET_TRANSITIONS[state]).toBeDefined();
    }
  });

  it("closed state has no outgoing transitions", () => {
    expect(SUPPORT_TICKET_TRANSITIONS.closed).toEqual([]);
  });
});
