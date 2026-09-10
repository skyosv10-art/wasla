/**
 * The readiness response, assembled from probed checks (review 7/N, §4.10-2).
 *
 * A separate pure function rather than inline in the route because the rule it
 * encodes is the whole point of the route, and a rule buried in a handler is a
 * rule that gets tested by hand once:
 *
 *   `status` is derived ONLY from checks that were actually performed.
 *
 * ## Wired is not probed — three answers, not two (review 8/N)
 *
 * Until review 8/N the catalog port could not be wired at all (§4.9-2), and
 * `not_claimed` said `marketplace_catalog_not_wired`. It is wired now (§4.11),
 * and the honest report changed with the fact instead of quietly emptying:
 *
 *   - not wired  → `marketplace_catalog_not_wired`  (placement will 503)
 *   - wired      → `marketplace_catalog_not_probed` (placement MAY work; this
 *                   route did not ask the marketplace and says so)
 *
 * Emptying `not_claimed` on wiring would have been the exact lie this field
 * exists to prevent: a green readiness implying a dependency was verified when
 * nothing verified it. And probing marketplace here was rejected deliberately —
 * every orchestrator heartbeat would become load on another service's boundary,
 * and a marketplace outage would evict this service from rotation even though
 * reads and cancellation need no marketplace at all.
 *
 * Either way the entry is never an `ok: false` check: a check that can never be
 * green gets a readiness route deleted from the deployment gate within a week,
 * which is how a service ends up with no gate at all.
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
  readonly not_claimed: readonly ("marketplace_catalog_not_wired" | "marketplace_catalog_not_probed")[];
}

export function buildReadinessResponse(
  checks: readonly ReadinessCheckResult[],
  catalogWired: boolean,
): ReadinessResponseBody {
  const ready = checks.length > 0 && checks.every((check) => check.ok);
  return {
    status: ready ? "ready" : "unavailable",
    checks,
    not_claimed: [catalogWired ? "marketplace_catalog_not_probed" : "marketplace_catalog_not_wired"],
  };
}
