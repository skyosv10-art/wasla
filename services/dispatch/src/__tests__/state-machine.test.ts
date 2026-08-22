/**
 * The three state machines.
 *
 * These tests assert the *shape* of the tables, including the moves that must NOT
 * exist. A missing transition is invisible in normal use — the code simply never takes
 * it — so the only way it stays absent is a test that names it.
 */
import { DISPATCH_REASON_CODES } from "@wasla/contracts-dispatch";
import { describe, expect, it } from "vitest";

import {
  JOB_STATUS_REASON_CODES,
  OFFER_STATUS_REASON_CODES,
  WAVE_STATUS_REASON_CODES,
  type DispatchJobStatus,
  type DispatchOfferStatus,
} from "../domain/model.js";
import {
  DERIVED_TERMINAL_JOB_STATUSES,
  DERIVED_TERMINAL_OFFER_STATUSES,
  DERIVED_TERMINAL_WAVE_STATUSES,
  JOB_TRANSITIONS,
  JOB_TRANSITION_COUNT,
  OFFER_TRANSITIONS,
  OFFER_TRANSITION_COUNT,
  WAVE_TRANSITIONS,
  WAVE_TRANSITION_COUNT,
  allowedJobReasonCodes,
  allowedOfferReasonCodes,
  isJobTransitionAllowed,
  isOfferTransitionAllowed,
  isTerminalJobStatus,
  isWaveTransitionAllowed,
  jobStatusRequiresReasonCode,
  jobTransitionTriggers,
  offerTransitionTriggers,
} from "../domain/state-machine.js";

const JOB_STATUSES: readonly DispatchJobStatus[] = [
  "pending",
  "dispatching",
  "escalated_community",
  "assigned",
  "exhausted",
  "cancelled",
];

describe("job transitions", () => {
  it("has exactly the eight documented moves", () => {
    expect(JOB_TRANSITION_COUNT).toBe(8);
  });

  it("derives assigned, exhausted and cancelled as the terminal statuses", () => {
    expect([...DERIVED_TERMINAL_JOB_STATUSES]).toEqual(["assigned", "exhausted", "cancelled"]);
  });

  it("cannot escalate a job that was never dispatched", () => {
    // The whole reason the tick treats `expires_at` as a ceiling on ADDITIONAL waves:
    // a job must have been offered to at least one machine wave before humans are asked.
    expect(isJobTransitionAllowed("pending", "escalated_community")).toBe(false);
  });

  it("cannot revive a terminal job", () => {
    for (const from of DERIVED_TERMINAL_JOB_STATUSES) {
      for (const to of JOB_STATUSES) {
        expect(isJobTransitionAllowed(from, to)).toBe(false);
      }
    }
  });

  it("cannot move a job backwards into dispatching", () => {
    expect(isJobTransitionAllowed("escalated_community", "dispatching")).toBe(false);
    expect(isJobTransitionAllowed("dispatching", "pending")).toBe(false);
  });

  it("lets only the tick start dispatching, and only a driver assign", () => {
    expect([...jobTransitionTriggers("pending", "dispatching")]).toEqual(["tick"]);
    expect([...jobTransitionTriggers("dispatching", "assigned")]).toEqual(["driver"]);
    expect([...jobTransitionTriggers("dispatching", "escalated_community")]).toEqual(["tick"]);
    expect([...jobTransitionTriggers("escalated_community", "exhausted")]).toEqual(["tick"]);
  });

  it("lets only the requester cancel, from every live status", () => {
    for (const rule of JOB_TRANSITIONS.filter((candidate) => candidate.to === "cancelled")) {
      expect([...rule.triggers]).toEqual(["requester"]);
    }
    const cancellableFrom = JOB_TRANSITIONS.filter((rule) => rule.to === "cancelled").map(
      (rule) => rule.from,
    );
    expect(cancellableFrom.sort()).toEqual(["dispatching", "escalated_community", "pending"]);
  });

  it("demands a reason on every terminal status and on escalation", () => {
    for (const status of DERIVED_TERMINAL_JOB_STATUSES) {
      expect(jobStatusRequiresReasonCode(status)).toBe(true);
      expect(allowedJobReasonCodes(status).length).toBeGreaterThan(0);
    }
    // Not terminal, so the schema does not demand it — but an operator still needs it.
    expect(jobStatusRequiresReasonCode("escalated_community")).toBe(false);
    expect([...allowedJobReasonCodes("escalated_community")]).toEqual(["ALL_WAVES_EXHAUSTED"]);
  });

  it("offers no reason codes for the live statuses", () => {
    expect(allowedJobReasonCodes("pending")).toHaveLength(0);
    expect(allowedJobReasonCodes("dispatching")).toHaveLength(0);
  });

  it("marks exactly the statuses with no outgoing move as terminal", () => {
    for (const status of JOB_STATUSES) {
      const hasOutgoing = JOB_TRANSITIONS.some((rule) => rule.from === status);
      expect(isTerminalJobStatus(status)).toBe(!hasOutgoing);
    }
  });
});

describe("wave transitions", () => {
  it("has exactly the two documented moves", () => {
    expect(WAVE_TRANSITION_COUNT).toBe(2);
    expect([...DERIVED_TERMINAL_WAVE_STATUSES]).toEqual(["completed", "cancelled"]);
  });

  it("cannot reopen a completed wave", () => {
    // Reopening would break `ux_dispatch_waves_one_open_job` the moment the next wave
    // exists, and the index is the only reason "one open wave" survives two ticks.
    expect(isWaveTransitionAllowed("completed", "open")).toBe(false);
    expect(isWaveTransitionAllowed("cancelled", "open")).toBe(false);
    expect(isWaveTransitionAllowed("completed", "cancelled")).toBe(false);
  });

  it("lets a driver's acceptance complete a wave without waiting for a tick", () => {
    const rule = WAVE_TRANSITIONS.find((candidate) => candidate.to === "completed");
    expect(rule?.triggers).toContain("driver");
    expect(rule?.triggers).toContain("tick");
  });
});

describe("offer transitions", () => {
  it("has one live status and five terminal outcomes", () => {
    expect(OFFER_TRANSITION_COUNT).toBe(5);
    expect([...DERIVED_TERMINAL_OFFER_STATUSES]).toEqual([
      "accepted",
      "rejected",
      "timed_out",
      "superseded",
      "cancelled",
    ]);
    expect(OFFER_TRANSITIONS.every((rule) => rule.from === "offered")).toBe(true);
  });

  it("cannot move a resolved offer anywhere", () => {
    const statuses: readonly DispatchOfferStatus[] = [
      "offered",
      "accepted",
      "rejected",
      "timed_out",
      "superseded",
      "cancelled",
    ];
    for (const from of DERIVED_TERMINAL_OFFER_STATUSES) {
      for (const to of statuses) {
        expect(isOfferTransitionAllowed(from, to)).toBe(false);
      }
    }
  });

  it("lets only the tick time an offer out", () => {
    expect([...offerTransitionTriggers("offered", "timed_out")]).toEqual(["tick"]);
  });

  it("never lets a driver be recorded as having declined when they did not answer", () => {
    // `rejected` is driver-only; `superseded`, `timed_out` and `cancelled` are things
    // that happened to the offer. Mixing them would put "declined" on the record of a
    // driver whose only mistake was losing a race by a millisecond.
    expect([...offerTransitionTriggers("offered", "rejected")]).toEqual(["driver"]);
    expect(offerTransitionTriggers("offered", "cancelled")).not.toContain("driver");
    expect([...allowedOfferReasonCodes("superseded")]).toEqual(["OFFER_SUPERSEDED"]);
    expect([...allowedOfferReasonCodes("timed_out")]).toEqual(["OFFER_TIMED_OUT"]);
  });
});

describe("reason code catalogues", () => {
  it("uses only codes the contract declares", () => {
    const known = new Set<string>(DISPATCH_REASON_CODES);
    const used = [
      ...Object.values(OFFER_STATUS_REASON_CODES).flat(),
      ...Object.values(WAVE_STATUS_REASON_CODES).flat(),
      ...Object.values(JOB_STATUS_REASON_CODES).flat(),
    ];
    expect(used.length).toBeGreaterThan(0);
    for (const code of used) {
      expect(known.has(code)).toBe(true);
    }
  });

  it("never allows a reason code on a live status", () => {
    expect(allowedOfferReasonCodes("offered")).toHaveLength(0);
  });
});
