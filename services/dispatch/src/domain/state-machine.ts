/**
 * The three state machines, declared as data.
 *
 * Declared once as tables so the legal moves are countable and testable, instead
 * of living implicitly inside a chain of `if` statements in the use cases. Every
 * table below mirrors a `CHECK` constraint in `services/dispatch/contracts/schema.sql`;
 * the drift guard reads that file from disk and fails if a status disappears from
 * one side without the other.
 *
 * `trigger` is documentation that the tests enforce, not a stored column: it says
 * who is allowed to cause a move. It matters because the entire time model rests
 * on "only the tick advances time" — if some HTTP handler could escalate a job
 * directly, deadlines would stop being the single explanation of what happened.
 */
import type { DispatchJobStatus, DispatchOfferStatus, DispatchReasonCode, DispatchWaveStatus } from "./model.js";
import { JOB_STATUS_REASON_CODES, OFFER_STATUS_REASON_CODES, WAVE_STATUS_REASON_CODES } from "./model.js";

/** Who may cause a transition. `tick` is the only one that reads a deadline. */
export type DispatchTrigger = "tick" | "driver" | "requester";

export const DISPATCH_TRIGGERS: readonly DispatchTrigger[] = ["tick", "driver", "requester"];

export interface JobTransitionRule {
  readonly from: DispatchJobStatus;
  readonly to: DispatchJobStatus;
  readonly triggers: readonly DispatchTrigger[];
}

/** Job lifecycle, MATCHING_DISPATCH §7. Six statuses, three of them terminal. */
export const JOB_TRANSITIONS: readonly JobTransitionRule[] = [
  { from: "pending", to: "dispatching", triggers: ["tick"] },
  { from: "pending", to: "cancelled", triggers: ["requester"] },
  { from: "dispatching", to: "assigned", triggers: ["driver"] },
  { from: "dispatching", to: "escalated_community", triggers: ["tick"] },
  { from: "dispatching", to: "cancelled", triggers: ["requester"] },
  { from: "escalated_community", to: "assigned", triggers: ["driver"] },
  { from: "escalated_community", to: "exhausted", triggers: ["tick"] },
  { from: "escalated_community", to: "cancelled", triggers: ["requester"] },
];

export interface WaveTransitionRule {
  readonly from: DispatchWaveStatus;
  readonly to: DispatchWaveStatus;
  readonly triggers: readonly DispatchTrigger[];
}

/**
 * Wave lifecycle.
 *
 * `open → completed` is triggered by the tick or by a driver's acceptance: an
 * acceptance is a decision, not a deadline, so it does not wait for a tick. A
 * wave whose offers were all rejected is *not* completed by the last rejection —
 * that is the tick's job, so that "what opens the next wave" has exactly one
 * answer. The price is that a fully-resolved wave sits idle until the next tick.
 */
export const WAVE_TRANSITIONS: readonly WaveTransitionRule[] = [
  { from: "open", to: "completed", triggers: ["tick", "driver"] },
  { from: "open", to: "cancelled", triggers: ["requester"] },
];

export interface OfferTransitionRule {
  readonly from: DispatchOfferStatus;
  readonly to: DispatchOfferStatus;
  readonly triggers: readonly DispatchTrigger[];
}

/** Offer lifecycle. One live status (`offered`), five terminal outcomes. */
export const OFFER_TRANSITIONS: readonly OfferTransitionRule[] = [
  { from: "offered", to: "accepted", triggers: ["driver"] },
  { from: "offered", to: "rejected", triggers: ["driver"] },
  { from: "offered", to: "timed_out", triggers: ["tick"] },
  // A sibling losing the race, or an engine that refused a second live
  // assignment for the same order — both are supersession, not rejection.
  { from: "offered", to: "superseded", triggers: ["tick", "driver"] },
  { from: "offered", to: "cancelled", triggers: ["requester"] },
];

export const JOB_TRANSITION_COUNT = JOB_TRANSITIONS.length;
export const WAVE_TRANSITION_COUNT = WAVE_TRANSITIONS.length;
export const OFFER_TRANSITION_COUNT = OFFER_TRANSITIONS.length;

/**
 * Terminal statuses are derived, never listed by hand.
 *
 * A hand-written list is a second source of truth that stays right until someone
 * adds a transition out of a status and forgets the list.
 */
export const DERIVED_TERMINAL_JOB_STATUSES: readonly DispatchJobStatus[] = (
  ["pending", "dispatching", "escalated_community", "assigned", "exhausted", "cancelled"] as const
).filter((status) => !JOB_TRANSITIONS.some((rule) => rule.from === status));

export const DERIVED_TERMINAL_WAVE_STATUSES: readonly DispatchWaveStatus[] = (
  ["open", "completed", "cancelled"] as const
).filter((status) => !WAVE_TRANSITIONS.some((rule) => rule.from === status));

export const DERIVED_TERMINAL_OFFER_STATUSES: readonly DispatchOfferStatus[] = (
  ["offered", "accepted", "rejected", "timed_out", "superseded", "cancelled"] as const
).filter((status) => !OFFER_TRANSITIONS.some((rule) => rule.from === status));

export function isTerminalJobStatus(status: DispatchJobStatus): boolean {
  return DERIVED_TERMINAL_JOB_STATUSES.includes(status);
}

export function isTerminalWaveStatus(status: DispatchWaveStatus): boolean {
  return DERIVED_TERMINAL_WAVE_STATUSES.includes(status);
}

export function isTerminalOfferStatus(status: DispatchOfferStatus): boolean {
  return DERIVED_TERMINAL_OFFER_STATUSES.includes(status);
}

export function isJobTransitionAllowed(from: DispatchJobStatus, to: DispatchJobStatus): boolean {
  return JOB_TRANSITIONS.some((rule) => rule.from === from && rule.to === to);
}

export function isWaveTransitionAllowed(from: DispatchWaveStatus, to: DispatchWaveStatus): boolean {
  return WAVE_TRANSITIONS.some((rule) => rule.from === from && rule.to === to);
}

export function isOfferTransitionAllowed(from: DispatchOfferStatus, to: DispatchOfferStatus): boolean {
  return OFFER_TRANSITIONS.some((rule) => rule.from === from && rule.to === to);
}

export function jobTransitionTriggers(
  from: DispatchJobStatus,
  to: DispatchJobStatus,
): readonly DispatchTrigger[] {
  return JOB_TRANSITIONS.find((rule) => rule.from === from && rule.to === to)?.triggers ?? [];
}

export function offerTransitionTriggers(
  from: DispatchOfferStatus,
  to: DispatchOfferStatus,
): readonly DispatchTrigger[] {
  return OFFER_TRANSITIONS.find((rule) => rule.from === from && rule.to === to)?.triggers ?? [];
}

/**
 * Does this target status demand a reason code?
 *
 * These three mirror `ck_dispatch_jobs_terminal_needs_reason`,
 * `ck_dispatch_waves_reason_required` and `ck_dispatch_offers_reason_required`.
 * A closed job with a null reason is a closed job nobody can explain, which is
 * the same as an unexplained cancellation in the support queue.
 */
export function jobStatusRequiresReasonCode(status: DispatchJobStatus): boolean {
  return status === "assigned" || status === "exhausted" || status === "cancelled";
}

export function waveStatusRequiresReasonCode(status: DispatchWaveStatus): boolean {
  return status !== "open";
}

export function offerStatusRequiresReasonCode(status: DispatchOfferStatus): boolean {
  return status !== "offered";
}

/** The reason codes allowed for a given target status, or `[]` when none are. */
export function allowedJobReasonCodes(status: DispatchJobStatus): readonly DispatchReasonCode[] {
  if (
    status === "escalated_community" ||
    status === "assigned" ||
    status === "exhausted" ||
    status === "cancelled"
  ) {
    return JOB_STATUS_REASON_CODES[status];
  }
  return [];
}

export function allowedWaveReasonCodes(status: DispatchWaveStatus): readonly DispatchReasonCode[] {
  return status === "open" ? [] : WAVE_STATUS_REASON_CODES[status];
}

export function allowedOfferReasonCodes(status: DispatchOfferStatus): readonly DispatchReasonCode[] {
  return status === "offered" ? [] : OFFER_STATUS_REASON_CODES[status];
}
