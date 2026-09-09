/**
 * The coarse mirror (ADR-026 §2.4) — a PURE decision function:
 * (current delivery task, classified dispatch event) → mirror decision.
 *
 * No I/O, no clock, no store: every guarantee above this layer (ordering,
 * idempotency, watermark, terminal-task no-regression) is the relay's job;
 * every legality below it is the state machine's job. This function only
 * decides WHAT the coarse mirror means, so it can be tested edge by edge
 * against the canonical tables of ADR-026 §3.3 (see dispatch-mirror.test.ts).
 *
 * The decisive rule (review 2/N, advisor-ratified): a dispatch OUTCOME
 * (assignment, exhaustion, cancellation) that has no legal transition from
 * the current task state is `unmappable` — the relay POISONS it. A mirror
 * that stays wrong while the checkpoint advances quietly is the one failure
 * this design refuses. Benign non-effects (wave mechanics, single rejected
 * or timed-out offers before assignment) are `ignored` with a reason — the
 * mirror is coarse on purpose and must not rebuild offer/wave logic.
 */

import type { DeliveryTaskState } from "@wasla/contracts-delivery";

import type { ProjectableDispatchEvent } from "./consumed-events.js";
import { isDeliveryTaskTransitionAllowed } from "./state-machine.js";

/** Domestic closed reason for a dispatch-side job cancellation (§2.6: closed catalogs). */
export const DISPATCH_JOB_CANCELLED_REASON = "DELIVERY_NOT_FEASIBLE" as const;

/** Which delivery domain event the mirror emits for a transition (never for non-effects). */
export type MirrorEmission =
  | { readonly eventKind: "driver_assigned"; readonly reason: "dispatch_offer_accepted" | "reassignment_cycle" }
  | { readonly eventKind: "status_changed"; readonly reason: "offer_timed_out" | "reassignment_cycle" | "offers_exhausted" }
  | { readonly eventKind: "task_cancelled"; readonly reason: typeof DISPATCH_JOB_CANCELLED_REASON };

/** A state-changing mirror decision — applied atomically by the store. */
export interface MirrorTransition {
  readonly kind: "transition";
  readonly to: DeliveryTaskState;
  /** Ledger reason — provenance, kept verbatim from dispatch where one exists. */
  readonly ledgerReason: string;
  /** The domain event to append to delivery_outbox in the same transaction. */
  readonly emit: MirrorEmission;
  /** Set on assignment: the courier is an opaque WS ref (§2.6). */
  readonly courierRef?: string;
  /** Set on assignment: when dispatch says the offer was accepted. */
  readonly assignedAt?: string;
}

export type MirrorDecision =
  | MirrorTransition
  | { readonly kind: "ignored"; readonly reason: string }
  | { readonly kind: "unmappable"; readonly reason: string };

/** The task view the mirror needs — deliberately narrow, no store leakage. */
export interface MirrorTask {
  readonly state: DeliveryTaskState;
}

/**
 * Project one classified dispatch event onto the coarse mirror.
 * Pre-conditions the RELAY guarantees before calling this:
 *  - the job is bound to this task (`dispatch_job_ref`),
 *  - the event is not stale against the task's dispatch watermark,
 *  - the task is not in a terminal state.
 */
export function projectDispatchEvent(task: MirrorTask, event: ProjectableDispatchEvent): MirrorDecision {
  switch (event.kind) {
    case "job_created":
      // The binding already happened at delegation time — creation confirms
      // nothing new for the coarse mirror. (Routing by job_id is the relay's
      // job; this is a terminal no-op, recorded as ignored.)
      return { kind: "ignored", reason: "job creation confirms the delegation; binding is the wire's duty (ADR-026 §2.4)" };

    case "wave_opened":
      // ADR-026 §3.3: timed_out → reassigned is "دورةُ عرضٍ جديدةٌ" — the
      // new wave IS that cycle. From every other state a wave is dispatch
      // mechanics the mirror must not rebuild.
      if (task.state === "timed_out" && isDeliveryTaskTransitionAllowed("timed_out", "reassigned")) {
        return {
          kind: "transition",
          to: "reassigned",
          ledgerReason: `reassignment_cycle:wave-${event.wave_number}`,
          emit: { eventKind: "status_changed", reason: "reassignment_cycle" },
        };
      }
      return { kind: "ignored", reason: "wave mechanics — the coarse mirror does not rebuild them (ADR-026 §2.4)" };

    case "offer_accepted": {
      const from = task.state;
      const legal =
        (from === "dispatch_requested" || from === "reassigned") &&
        isDeliveryTaskTransitionAllowed(from, "driver_assigned");
      if (!legal) {
        return {
          kind: "unmappable",
          reason: `offer_accepted has no legal edge from ${from} (ADR-026 §3.3) — a second or late acceptance is a contradiction`,
        };
      }
      return {
        kind: "transition",
        to: "driver_assigned",
        ledgerReason: "dispatch_offer_accepted",
        emit: { eventKind: "driver_assigned", reason: from === "reassigned" ? "reassignment_cycle" : "dispatch_offer_accepted" },
        courierRef: event.driver_public_id,
        assignedAt: event.accepted_at,
      };
    }

    case "offer_timed_out": {
      // The ADR §3.3 edge is driver_assigned → timed_out. Dispatch semantics
      // say an ACCEPTED offer cannot time out, so this edge is defensive —
      // but it is the canonical table, and the mirror follows the table.
      // Everywhere else a timed-out offer is wave noise.
      if (task.state === "driver_assigned" && isDeliveryTaskTransitionAllowed("driver_assigned", "timed_out")) {
        return {
          kind: "transition",
          to: "timed_out",
          ledgerReason: "offer_timed_out",
          emit: { eventKind: "status_changed", reason: "offer_timed_out" },
        };
      }
      return { kind: "ignored", reason: "a timed-out offer before assignment is wave noise (ADR-026 §2.4)" };
    }

    case "job_exhausted": {
      const from = task.state;
      const legal =
        (from === "dispatch_requested" || from === "reassigned") &&
        isDeliveryTaskTransitionAllowed(from, "exhausted");
      if (!legal) {
        return {
          kind: "unmappable",
          reason: `job_exhausted (NO_DRIVER_AVAILABLE) has no legal edge from ${from} (ADR-026 §3.3) — exhaustion with a driver assigned or mid-cycle is a contradiction`,
        };
      }
      return {
        kind: "transition",
        to: "exhausted",
        ledgerReason: "offers_exhausted:NO_DRIVER_AVAILABLE",
        emit: { eventKind: "status_changed", reason: "offers_exhausted" },
      };
    }

    case "job_cancelled": {
      const from = task.state;
      const legal =
        (from === "dispatch_requested" || from === "driver_assigned") &&
        isDeliveryTaskTransitionAllowed(from, "cancelled");
      if (!legal) {
        return {
          kind: "unmappable",
          reason: `job_cancelled has no legal edge from ${from} (ADR-026 §3.3) — cancellation mid-cycle is unrepresented in the canonical machine`,
        };
      }
      // The domestic event carries a CLOSED catalog reason (§2.6); the
      // transition ledger keeps dispatch's original reason verbatim (capped
      // at the ledger's 64-char column: dispatch ReasonCode is 3–64).
      return {
        kind: "transition",
        to: "cancelled",
        ledgerReason: `dispatch_job_cancelled:${event.reason_code}`.slice(0, 64),
        emit: { eventKind: "task_cancelled", reason: DISPATCH_JOB_CANCELLED_REASON },
      };
    }
  }
}
