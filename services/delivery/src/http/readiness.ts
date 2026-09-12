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
 * ## FOUR answers now — an observation is neither a claim nor a gate (review 15/N)
 *
 * Review 15/N lifts the last §4 debt that needed no owner decision: the wired
 * catalog IS asked now (`domain/dependency-probe.ts` · §4.17). Both objections
 * above still hold, so the probe result enters the body as a **dependency
 * observation** — never as a `check`:
 *
 *   - wired + observed → `not_claimed: []` and one `dependencies` entry
 *     carrying `ok`, a closed-vocabulary `detail`, `observed_at` and `age_ms`.
 *
 * `status` is untouched by it, and the entry says so on the wire
 * (`gates_readiness: false`) rather than leaving the reader to infer it. Three
 * reasons this is a separate field and not a fourth `check`:
 *
 *   1. A `check` gates `status` by construction here. Adding marketplace to
 *      `checks` would evict this service from rotation on another service's
 *      outage — the exact outcome review 8/N refused.
 *   2. `age_ms` is meaningless for a gating check (it is probed per request)
 *      and essential for an observation (it is cached with a TTL).
 *   3. An orchestrator reads `status`; a human on an incident reads the
 *      observation. Merging them makes one of the two readers wrong.
 *
 * ## Why an empty check list is NOT ready
 *
 * "No checks failed" must never be reachable by performing no checks — that is
 * RISK-0030 (`health: ok` while every read answered 503) rewritten as a bug in
 * a helper. And an observation is NOT a check: `checks: []` with a green
 * marketplace observation is still `unavailable`, because nothing this service
 * owns was proven.
 */

import type { DependencyObservation } from "../domain/dependency-probe.js";
import type { ReadinessCheckResult } from "../ports.js";

/** رصدُ تبعيّةٍ كما يظهرُ على السلكِ — `snake_case` كسائرِ الجسمِ. */
export interface DependencyObservationBody {
  readonly name: "marketplace_catalog";
  readonly ok: boolean;
  readonly detail?: string;
  readonly observed_at: string;
  readonly age_ms: number;
  /**
   * مُعلَنٌ ثابتاً `false` لا محسوباً: من يقرأُ الجسمَ يجبُ أن يعرفَ **من الجسمِ**
   * أنَّ هذا الرصدَ لا يُغيّرُ `status`، لا أن يستنبطَهُ من وثيقةٍ قد لا يقرأُها.
   */
  readonly gates_readiness: false;
}

export interface ReadinessResponseBody {
  readonly status: "ready" | "unavailable";
  readonly checks: readonly ReadinessCheckResult[];
  readonly not_claimed: readonly ("marketplace_catalog_not_wired" | "marketplace_catalog_not_probed")[];
  readonly dependencies: readonly DependencyObservationBody[];
}

export function buildReadinessResponse(
  checks: readonly ReadinessCheckResult[],
  catalogWired: boolean,
  observation?: DependencyObservation,
): ReadinessResponseBody {
  const ready = checks.length > 0 && checks.every((check) => check.ok);
  const observed = catalogWired && observation !== undefined;
  return {
    status: ready ? "ready" : "unavailable",
    checks,
    not_claimed: observed
      ? []
      : [catalogWired ? "marketplace_catalog_not_probed" : "marketplace_catalog_not_wired"],
    dependencies: observed ? [toDependencyBody(observation)] : [],
  };
}

function toDependencyBody(observation: DependencyObservation): DependencyObservationBody {
  return {
    name: observation.name,
    ok: observation.ok,
    ...(observation.detail === undefined ? {} : { detail: observation.detail }),
    observed_at: observation.observedAt.toISOString(),
    age_ms: observation.ageMs,
    gates_readiness: false,
  };
}
