/**
 * `@wasla/drivers-service` — the public surface of the driver domain.
 *
 * ## Why this package exists (PUSH_DOCUMENTATION_RULE §7)
 *
 * Driver eligibility was, until this phase, an opinion each service formed for itself:
 * matching read a projection it did not own, dispatch assumed whatever matching said,
 * and nobody could answer "why is this driver not receiving orders?" from one place.
 * This package is that one place. It holds the profile, the vehicles, the documents,
 * and the single function that turns them into a verdict — plus the log that says
 * when the verdict changed and what caused it.
 *
 * ## What is IN this MR (2/6) and what is not
 *
 * This is the PURE layer: the model, the calculator, the state machines, the ports,
 * and in-memory adapters that simulate the database constraints by name. There is no
 * `pg`, no `drizzle` and no `fastify` dependency, so **this service cannot boot yet**,
 * and that is the declared boundary rather than an omission:
 *
 *   - MR 3/6 — the Postgres adapters and the migration,
 *   - MR 4/6 — the HTTP layer over these use cases,
 *   - MR 5/6 — the operations endpoints and the tick route,
 *   - MR 6/6 — the matching integration and the end-to-end path.
 *
 * The order is deliberate: the decision rules are the part that has to be right, and
 * they are cheapest to argue about while no transport or table has been committed to.
 *
 * ## The invariant everything else rests on
 *
 * **No state change without a re-decision.** Every write use case ends in
 * `recomputeEligibility`, which is the only function that decides, logs, and
 * publishes. A second decider would be a second answer, and after an incident the
 * first question is always which one ran.
 */

// ---------------------------------------------------------------------------
// Domain model and closed value sets (re-exported from @wasla/contracts-driver,
// never retyped here — a second copy of a closed set is a second source of truth).
// ---------------------------------------------------------------------------
export * from "./domain/model.js";
export * from "./domain/errors.js";
export * from "./domain/eligibility.js";
export * from "./domain/documents.js";
export * from "./domain/vehicles.js";
export * from "./domain/policy.js";
export * from "./domain/validation.js";
export * from "./domain/events.js";

// ---------------------------------------------------------------------------
// Ports and the in-memory adapters that stand behind them until MR 3/6.
// ---------------------------------------------------------------------------
export * from "./ports.js";
export * from "./infrastructure/in-memory.js";

// ---------------------------------------------------------------------------
// Use cases — the whole write surface of the service.
// ---------------------------------------------------------------------------
export * from "./use-cases/recompute-eligibility.js";
export * from "./use-cases/register-driver.js";
export * from "./use-cases/manage-profile.js";
export * from "./use-cases/manage-vehicles.js";
export * from "./use-cases/manage-documents.js";
export * from "./use-cases/read-eligibility.js";

// ---------------------------------------------------------------------------
// Wire mapping — the single camelCase ⇄ snake_case boundary.
// ---------------------------------------------------------------------------
export * from "./mappers.js";
