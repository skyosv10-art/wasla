/**
 * The readiness response, assembled from probed checks (review 7/N, §4.10-2).
 *
 * A separate pure function rather than inline in the route because the rule it
 * encodes is the whole point of the route, and a rule buried in a handler is a
 * rule that gets tested by hand once:
 *
 *   `status` is derived ONLY from checks that were actually performed.
 *
 * ## Why an unwired dependency is not a failed check
 *
 * The marketplace catalog port cannot be wired today (§4.9-2: marketplace
 * publishes no public store ref). If that appeared as `ok: false`, readiness
 * would be permanently 503 — and a readiness route that can never be green is
 * removed from the deployment gate within a week, leaving the service with no
 * gate at all. It is reported in `not_claimed` instead: visible, unclaimed, and
 * not confused with a measurement. Reads and cancellation genuinely are
 * servable while placement is not, and that is what the body says.
 *
 * ## Why an empty check list is NOT ready
 *
 * "No checks failed" must never be reachable by performing no checks — that is
 * RISK-0030 (`health: ok` while every read answered 503) rewritten as a bug in
 * a helper.
 */

import type { ReadinessCheckResult } from "../ports.js";

export interface ReadinessResponseBody {
  readonly status: "ready" | "unavailable";
  readonly checks: readonly ReadinessCheckResult[];
  readonly not_claimed: readonly "marketplace_catalog_not_wired"[];
}

export function buildReadinessResponse(
  checks: readonly ReadinessCheckResult[],
  catalogWired: boolean,
): ReadinessResponseBody {
  const ready = checks.length > 0 && checks.every((check) => check.ok);
  return {
    status: ready ? "ready" : "unavailable",
    checks,
    not_claimed: catalogWired ? [] : ["marketplace_catalog_not_wired"],
  };
}
