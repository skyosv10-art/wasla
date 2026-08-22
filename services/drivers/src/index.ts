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
 * ## What is IN this package as of MR 5/6, and what is not
 *
 * The pure layer (MR 2/6) — model, calculator, state machines, ports and in-memory
 * adapters that simulate the database constraints by name; the Drizzle/Postgres
 * adapters, the transaction boundary and the `DriverRunner` seam (MR 3/6); the HTTP
 * layer on port 8090 (MR 4/6); and, as of MR 5/6, the two **outbound** adapters that
 * end this service's isolation — `HttpCandidacyPort` to matching (8088) and
 * `HttpZoneCatalogPort` to geography (8081) — plus the driver bot's chat surface,
 * which lives in `bots/driver-bot` and reaches these use cases in process.
 *
 * What remains is one MR, and it is named rather than implied:
 *
 *   - MR 6/6 — the Phase 05 exit gate: HTTP over real Postgres, and the end-to-end
 *     path proving a registered driver becomes a candidate matching can see.
 *
 * So the boundary that still holds today: nothing here has been proven against a
 * live matching service. The outbound adapters are proven against injected answers
 * (`src/__tests__/outbound-ports.test.ts`) — every status, every silence — which
 * settles the *decisions* but not the wire.
 *
 * The order was deliberate: the decision rules are the part that has to be right, and
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
// Ports and the in-memory adapters. The in-memory ones are not "until MR 3/6":
// they are the fixtures the whole truth table is proven on, and the fallback the
// HTTP server uses when a dependency URL is unset (visibly, with a warning).
// ---------------------------------------------------------------------------
export * from "./ports.js";
export * from "./infrastructure/in-memory.js";

// ---------------------------------------------------------------------------
// Outbound HTTP adapters (MR 5/6): the driver's verdict leaving the service, and
// the zone catalog it is checked against. Exported because the composition roots
// that assemble a deployment — `http/server.ts` here, and any future host — must
// be able to name them; and because MR 6/6 asserts on them from outside.
// ---------------------------------------------------------------------------
export * from "./infrastructure/http-candidacy.js";
export * from "./infrastructure/http-zone-catalog.js";
export * from "./infrastructure/outbound-wiring.js";

// ---------------------------------------------------------------------------
// Postgres adapters (MR 3/6). `schema.js` is NOT re-exported: its table objects
// are an implementation detail of these adapters, and a caller holding them could
// write a driver row without passing through a use case.
// ---------------------------------------------------------------------------
export * from "./infrastructure/drizzle/db.js";
export * from "./infrastructure/drizzle/repository.js";
export * from "./infrastructure/drizzle/transaction.js";
export * from "./runner.js";

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
export * from "./use-cases/read-driver.js";

// ---------------------------------------------------------------------------
// HTTP layer (MR 4/6). `createDriverApp` is exported and `server.js` is NOT: the
// app is a value a test or the exit-gate harness of MR 6/6 builds and injects into,
// while the server is a process that binds a port and reads the environment. Exporting
// the module that ends in `await main()` would start a listener on import.
// ---------------------------------------------------------------------------
export * from "./http/app.js";
export { sendDriverError } from "./http/errors.js";
export type { DriverErrorBody } from "./http/errors.js";
