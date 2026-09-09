/**
 * Coarse-mirror mapping tests (review 2/N — ADR-026 §2.4/§3.3).
 *
 * Two families:
 *  1. LEGALITY — every (event kind, task state) pair the mirror maps to a
 *     transition is a legal edge in the canonical state machine, and every
 *     transition's emitted reason exists in the delivery events contract.
 *     Exhaustive: all 14 states × all 6 projectable kinds.
 *  2. SEMANTICS — the decisive cases: reassignment cycle, defensive timeout,
 *     exhaustion contradictions, unmappable outcomes, payload validation.
 */

import { describe, expect, it } from "vitest";
import {
  classifyDispatchEvent,
  DispatchPayloadError,
  type DispatchOutboxRow,
  type ProjectableDispatchEvent,
} from "../domain/consumed-events.js";
import {
  DISPATCH_JOB_CANCELLED_REASON,
  projectDispatchEvent,
} from "../domain/dispatch-mirror.js";
import { DELIVERY_TASK_STATES, DELIVERY_TASK_TERMINAL_STATES } from "@wasla/contracts-delivery";
import { isDeliveryTaskTransitionAllowed } from "../domain/state-machine.js";

const ALL_STATES = [...DELIVERY_TASK_STATES] as string[];

const EVENTS: Record<ProjectableDispatchEvent["kind"], ProjectableDispatchEvent> = {
  job_created: { kind: "job_created", job_id: "j-1" },
  wave_opened: { kind: "wave_opened", job_id: "j-1", wave_number: 2 },
  offer_accepted: { kind: "offer_accepted", job_id: "j-1", driver_public_id: "WS-0123456789", accepted_at: "2026-09-09T10:00:00.000Z" },
  offer_timed_out: { kind: "offer_timed_out", job_id: "j-1", driver_public_id: "WS-0123456789", timed_out_at: "2026-09-09T10:00:00.000Z" },
  job_exhausted: { kind: "job_exhausted", job_id: "j-1", exhausted_at: "2026-09-09T10:00:00.000Z" },
  job_cancelled: { kind: "job_cancelled", job_id: "j-1", reason_code: "DISPATCH_CANCELLED_BY_REQUESTER", cancelled_at: "2026-09-09T10:00:00.000Z" },
};

describe("mapping legality — the mirror only ever walks legal edges", () => {
  const kinds = Object.keys(EVENTS) as ProjectableDispatchEvent["kind"][];

  it.each(kinds)("every %s transition from ANY state is a legal machine edge", (kind) => {
    for (const state of ALL_STATES) {
      const decision = projectDispatchEvent({ state: state as never }, EVENTS[kind]);
      if (decision.kind === "transition") {
        expect(
          isDeliveryTaskTransitionAllowed(state as never, decision.to),
          `${kind}: ${state} → ${decision.to} is not a legal edge (ADR-026 §3.3)`,
        ).toBe(true);
      }
    }
  });

  it("no transition is produced from a terminal state (exhaustive over states × kinds)", () => {
    for (const state of DELIVERY_TASK_TERMINAL_STATES) {
      for (const kind of kinds) {
        const decision = projectDispatchEvent({ state: state as never }, EVENTS[kind]);
        expect(
          decision.kind,
          `${kind} from terminal ${state} must not transition`,
        ).not.toBe("transition");
      }
    }
  });

  it("every emitted reason is a legal delivery events-contract reason", () => {
    const legal = new Set([
      "dispatch_offer_accepted",
      "reassignment_cycle",
      "offer_timed_out",
      "offers_exhausted",
      DISPATCH_JOB_CANCELLED_REASON,
    ]);
    for (const kind of kinds) {
      for (const state of ALL_STATES) {
        const decision = projectDispatchEvent({ state: state as never }, EVENTS[kind]);
        if (decision.kind === "transition") {
          expect(legal.has(decision.emit.reason), `${kind} from ${state} emits illegal reason ${decision.emit.reason}`).toBe(true);
        }
      }
    }
  });

  it("ledger reasons fit the 64-char transition column", () => {
    const longReason = "X".repeat(64); // dispatch ReasonCode allows up to 64
    const decision = projectDispatchEvent(
      { state: "dispatch_requested" },
      { kind: "job_cancelled", job_id: "j-1", reason_code: longReason, cancelled_at: "2026-09-09T10:00:00.000Z" },
    );
    expect(decision.kind === "transition" && decision.ledgerReason.length <= 64).toBe(true);
  });
});

describe("mapping semantics — the decisive cases", () => {
  it("offer_accepted from dispatch_requested assigns the courier", () => {
    const d = projectDispatchEvent({ state: "dispatch_requested" }, EVENTS.offer_accepted);
    expect(d).toMatchObject({
      kind: "transition",
      to: "driver_assigned",
      courierRef: "WS-0123456789",
      assignedAt: "2026-09-09T10:00:00.000Z",
      emit: { eventKind: "driver_assigned", reason: "dispatch_offer_accepted" },
    });
  });

  it("offer_accepted from reassigned is the reassignment cycle", () => {
    const d = projectDispatchEvent({ state: "reassigned" }, EVENTS.offer_accepted);
    expect(d).toMatchObject({ kind: "transition", to: "driver_assigned", emit: { reason: "reassignment_cycle" } });
  });

  it("offer_accepted from any other state is unmappable — never a quiet skip", () => {
    for (const state of ["driver_assigned", "timed_out", "picked_up", "eligible"]) {
      const d = projectDispatchEvent({ state: state as never }, EVENTS.offer_accepted);
      expect(d.kind, `offer_accepted from ${state}`).toBe("unmappable");
    }
  });

  it("wave_opened from timed_out starts the reassignment cycle", () => {
    const d = projectDispatchEvent({ state: "timed_out" }, EVENTS.wave_opened);
    expect(d).toMatchObject({ kind: "transition", to: "reassigned", emit: { eventKind: "status_changed", reason: "reassignment_cycle" } });
  });

  it("wave_opened from any other state is ignored — the mirror does not rebuild wave mechanics", () => {
    for (const state of ["dispatch_requested", "driver_assigned", "reassigned"]) {
      const d = projectDispatchEvent({ state: state as never }, EVENTS.wave_opened);
      expect(d.kind, `wave_opened from ${state}`).toBe("ignored");
    }
  });

  it("offer_timed_out from driver_assigned times out (the defensive canonical edge)", () => {
    const d = projectDispatchEvent({ state: "driver_assigned" }, EVENTS.offer_timed_out);
    expect(d).toMatchObject({ kind: "transition", to: "timed_out", emit: { eventKind: "status_changed", reason: "offer_timed_out" } });
  });

  it("offer_timed_out before assignment is wave noise — ignored", () => {
    for (const state of ["dispatch_requested", "reassigned", "timed_out"]) {
      const d = projectDispatchEvent({ state: state as never }, EVENTS.offer_timed_out);
      expect(d.kind, `offer_timed_out from ${state}`).toBe("ignored");
    }
  });

  it("job_exhausted from dispatch_requested/reassigned exhausts; contradictions are unmappable", () => {
    for (const state of ["dispatch_requested", "reassigned"]) {
      expect(projectDispatchEvent({ state: state as never }, EVENTS.job_exhausted)).toMatchObject({
        kind: "transition",
        to: "exhausted",
        emit: { eventKind: "status_changed", reason: "offers_exhausted" },
      });
    }
    for (const state of ["driver_assigned", "timed_out"]) {
      const d = projectDispatchEvent({ state: state as never }, EVENTS.job_exhausted);
      expect(d.kind, `job_exhausted from ${state}`).toBe("unmappable");
    }
  });

  it("job_cancelled cancels with a closed domestic reason; the ledger keeps dispatch's code", () => {
    const d = projectDispatchEvent({ state: "dispatch_requested" }, EVENTS.job_cancelled);
    expect(d).toMatchObject({
      kind: "transition",
      to: "cancelled",
      ledgerReason: "dispatch_job_cancelled:DISPATCH_CANCELLED_BY_REQUESTER",
      emit: { eventKind: "task_cancelled", reason: DISPATCH_JOB_CANCELLED_REASON },
    });
    expect(projectDispatchEvent({ state: "driver_assigned" }, EVENTS.job_cancelled).kind).toBe("transition");
    for (const state of ["timed_out", "reassigned"]) {
      expect(projectDispatchEvent({ state: state as never }, EVENTS.job_cancelled).kind, `job_cancelled from ${state}`).toBe("unmappable");
    }
  });

  it("job_created is a terminal no-op — binding is the delegation wire's duty", () => {
    for (const state of ["dispatch_requested", "reassigned"]) {
      expect(projectDispatchEvent({ state: state as never }, EVENTS.job_created).kind).toBe("ignored");
    }
  });
});

describe("payload validation — invalid payloads throw, they never slip through", () => {
  const base: DispatchOutboxRow = {
    event_id: "e-1",
    event_type: "dispatch.offer_accepted",
    event_version: "v1",
    aggregate_type: "dispatch_offer",
    aggregate_id: "o-1",
    occurred_at: "2026-09-09T10:00:00.000Z",
    trace_id: null,
    data: { job_id: "j-1", offer_id: "of-1", driver_public_id: "WS-0123456789", reason_code: "OFFER_ACCEPTED", accepted_at: "2026-09-09T10:00:00.000Z" },
  };

  it("offer_accepted with a non-WS driver ref throws DispatchPayloadError", () => {
    expect(() => classifyDispatchEvent({ ...base, data: { ...base.data, driver_public_id: "ORD-1234567890" } })).toThrowError(
      expect.objectContaining({ name: "DispatchPayloadError" }),
    );
  });

  it("job_exhausted without exhausted_at throws", () => {
    const row: DispatchOutboxRow = { ...base, event_type: "dispatch.job_exhausted", data: { job_id: "j-1", order_public_id: "ORD-1234567890", reason_code: "NO_DRIVER_AVAILABLE" } };
    expect(() => classifyDispatchEvent(row)).toThrowError(DispatchPayloadError);
  });

  it("wave_opened with wave_number 0 throws", () => {
    const row: DispatchOutboxRow = { ...base, event_type: "dispatch.wave_opened", data: { job_id: "j-1", wave_id: "w-1", wave_number: 0, offer_count: 3, expires_at: "2026-09-09T10:05:00.000Z" } };
    expect(() => classifyDispatchEvent(row)).toThrowError(DispatchPayloadError);
  });

  it("offer_timed_out with a non-date timed_out_at throws", () => {
    const row: DispatchOutboxRow = { ...base, event_type: "dispatch.offer_timed_out", data: { job_id: "j-1", offer_id: "of-1", driver_public_id: "WS-0123456789", reason_code: "OFFER_TIMED_OUT", timed_out_at: "not-a-date" } };
    expect(() => classifyDispatchEvent(row)).toThrowError(DispatchPayloadError);
  });
});
