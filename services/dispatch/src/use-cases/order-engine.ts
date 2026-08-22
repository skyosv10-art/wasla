/**
 * The order-engine protocol, in one place.
 *
 * Two things live here that would otherwise be scattered across five use cases: the
 * translation from a dispatch outcome to the engine's vocabulary, and the decision
 * of what a failed engine call means.
 *
 * ## Why the order's status follows the WAVE, not each offer
 *
 * A wave sends several offers at once, but the order engine has a single status. Its
 * table (ORDER_ENGINE.md §4.3) leaves `offered` only through `accepted` or through a
 * transient `driver_rejected` / `driver_timeout`. So if each offer pushed its own
 * transition, the first timeout in a wave of three would move the order to
 * `driver_timeout` and the other two would then be requesting an illegal move from a
 * status they never saw. The protocol is therefore per wave:
 *
 * | dispatch moment                      | order transition requested            |
 * |--------------------------------------|---------------------------------------|
 * | job created                          | `→ searching`                         |
 * | wave opened with ≥1 offer            | `→ offered` (once, keyed by wave)     |
 * | wave closed, someone rejected        | `→ driver_rejected` then `→ searching`|
 * | wave closed, only timeouts           | `→ driver_timeout` then `→ searching` |
 * | wave opened with 0 candidates        | nothing — the order stays `searching` |
 * | offer accepted                       | `→ accepted`                          |
 * | escalation window expired            | `→ no_driver_found`                   |
 *
 * Assignments stay per offer, because each offer has its own assignment row and no
 * such collision exists.
 *
 * ## Why a failed engine call is not always an exception
 *
 * Inside a tick, one unreachable engine must not stop every other job from
 * progressing, and it must not corrupt state either. So a failed call *defers*: the
 * local write is skipped, the row keeps its current status, and the stored deadline
 * makes the next tick try again. Nothing is lost because nothing was scheduled.
 *
 * On a single-job path (accept, reject, cancel, create) the caller is a person or a
 * service waiting for an answer, so the same failure is raised as 503 with the same
 * idempotency key safe to retry.
 */
import {
  engineUnavailable,
  orderEngineRejected,
  orderEngineTimeout,
} from "../domain/errors.js";
import type { DispatchOfferStatus } from "../domain/model.js";
import type { OrderEngineResult } from "../ports.js";

/** Order statuses dispatch is allowed to request. Nothing else is dispatch's business. */
export const ORDER_STATUS_SEARCHING = "searching" as const;
export const ORDER_STATUS_OFFERED = "offered" as const;
export const ORDER_STATUS_ACCEPTED = "accepted" as const;
export const ORDER_STATUS_DRIVER_REJECTED = "driver_rejected" as const;
export const ORDER_STATUS_DRIVER_TIMEOUT = "driver_timeout" as const;
export const ORDER_STATUS_NO_DRIVER_FOUND = "no_driver_found" as const;

/**
 * Dispatch offer outcome → order assignment state.
 *
 * Note `superseded → cancelled`: the engine has no notion of supersession, and
 * calling it a rejection would put "the driver said no" in the analytics of a driver
 * who never got to answer.
 */
export const OFFER_STATUS_TO_ASSIGNMENT_STATE: Record<
  Exclude<DispatchOfferStatus, "offered">,
  "accepted" | "rejected" | "expired" | "cancelled"
> = {
  accepted: "accepted",
  rejected: "rejected",
  timed_out: "expired",
  superseded: "cancelled",
  cancelled: "cancelled",
};

/**
 * Order reason codes dispatch sends. They belong to the ORDER catalog, not ours —
 * dispatch says `NO_DRIVER_AVAILABLE` on its own job while the order records
 * `ALL_CANDIDATES_DECLINED`, because the two catalogs answer to different readers.
 */
export const ORDER_REASON_DRIVER_DECLINED = "DRIVER_DECLINED" as const;
export const ORDER_REASON_OFFER_TIMED_OUT = "OFFER_TIMED_OUT" as const;
export const ORDER_REASON_SEARCH_RESUMED = "SEARCH_RESUMED" as const;
export const ORDER_REASON_ALL_CANDIDATES_DECLINED = "ALL_CANDIDATES_DECLINED" as const;

/**
 * The engine's error codes that mean "someone else already won this order".
 *
 * These are not failures of dispatch: they are the race being resolved by the only
 * component that can resolve it. The losing offer is closed as `superseded`.
 */
export const ENGINE_RACE_REJECTION_CODES: readonly string[] = [
  "ORDER_ASSIGNMENT_FORBIDDEN",
  "ORDER_ASSIGNMENT_DUPLICATE",
];

export function isRaceRejection(result: OrderEngineResult): boolean {
  return (
    result.outcome === "rejected" &&
    result.rejectionCode !== undefined &&
    ENGINE_RACE_REJECTION_CODES.includes(result.rejectionCode)
  );
}

/** What a batch caller (the tick) should do with an engine answer. */
export type EngineStep = "ok" | "deferred" | "rejected";

export function classifyEngineResult(result: OrderEngineResult): EngineStep {
  switch (result.outcome) {
    case "applied":
    case "already_applied":
      return "ok";
    case "rejected":
      return "rejected";
    case "unavailable":
    case "timeout":
      return "deferred";
  }
}

/**
 * Raise the right error for a single-job path.
 *
 * `timeout` and `unavailable` are kept apart because they are different
 * instructions: both are retryable, but only a timeout means the write may already
 * have landed, which is why the retry must reuse the derived key.
 */
export function assertEngineApplied(result: OrderEngineResult, traceId?: string): void {
  switch (result.outcome) {
    case "applied":
    case "already_applied":
      return;
    case "rejected":
      throw orderEngineRejected(traceId);
    case "timeout":
      throw orderEngineTimeout(traceId);
    case "unavailable":
      throw engineUnavailable(traceId);
  }
}
