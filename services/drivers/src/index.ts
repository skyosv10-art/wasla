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
 * ## What is IN this package as of MR 6/6 — Phase 05 is closed
 *
 * The pure layer (MR 2/6) — model, calculator, state machines, ports and in-memory
 * adapters that simulate the database constraints by name; the Drizzle/Postgres
 * adapters, the transaction boundary and the `DriverRunner` seam (MR 3/6); the HTTP
 * layer on port 8090 (MR 4/6); and, as of MR 5/6, the two **outbound** adapters that
 * end this service's isolation — `HttpCandidacyPort` to matching (8088) and
 * `HttpZoneCatalogPort` to geography (8081) — plus the driver bot's chat surface,
 * which lives in `bots/driver-bot` and reaches these use cases in process.
 *
 * MR 6/6 closed the phase, and it closed the exact gap this header used to declare.
 * That gap read: "nothing here has been proven against a live matching service; the
 * outbound adapters are proven against injected answers, which settles the decisions
 * but not the wire." The wire is now settled. `packages/driver-e2e` stands **seven**
 * real Fastify listeners up in one process behind one injected clock, wires this
 * service to them through its **production** outbound adapters, and drives the whole
 * path over public HTTP: a driver registers, is reviewed, becomes eligible with a
 * `driver_core` verdict matching itself reports back, receives a real dispatch offer,
 * then leaves the pool on a **single** eligibility tick when a document expires.
 * See docs/12-testing/PHASE05_EXIT_GATE_E2E.md.
 *
 * The injected-answer tests did not become redundant — they cover statuses and
 * silences a live service will not produce on demand. What they could not do was
 * prove the wire, and that is the division of labour, not duplication.
 *
 * ## The one thing the gate found — read this before touching http-candidacy.ts
 *
 * The gate failed on first run, and it was right. The outbound idempotency key was
 * `drv-{driverId}-{attemptMillis}-{contentHash}`, so its whole defence was one
 * millisecond deep. A driver publishing `offline → available → offline` inside a
 * single clock tick produced two publications with identical content AND identical
 * millis — hence an identical key — so matching correctly replayed its stored answer
 * instead of applying the write. Matching's row stayed stale while
 * `driver_candidacy_publications` recorded `published`. A silent drift with a clean
 * audit trail: exactly what that file's own comment was written to prevent, let back
 * in through clock resolution. The key now carries a per-instance attempt sequence.
 *
 * The lesson generalises beyond this file: **clock resolution is not a uniqueness
 * guarantee.** Any replay key derived from time needs a tiebreaker, and any test
 * asserting such a key must freeze the clock — advancing it between attempts proves
 * only that timestamps move.
 *
 * ## What is still owed, named rather than implied
 *
 *   - Phase 09 — a periodic caller for `POST /drivers/eligibility/tick`, the outbox
 *     relay, and `driver_idempotency` pruning. The tick is a route that works and
 *     nothing calls it on a schedule yet.
 *   - Phase 12 — real document upload behind `storage_ref`.
 *   - Phase 10 — `reviewed_by` as an admin identity rather than a validated string.
 *   - ADR-012 decision 4 — the read/write race on matching's candidacy row needs
 *     `If-Match`/ETag in **another** service; out of Phase 05 scope by decision.
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
// be able to name them; and because the Phase 05 exit gate asserts on them from
// outside, through a matching service that is actually listening.
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
// app is a value a test or the Phase 05 exit-gate harness builds and injects into,
// while the server is a process that binds a port and reads the environment. Exporting
// the module that ends in `await main()` would start a listener on import.
// ---------------------------------------------------------------------------
export * from "./http/app.js";
export { sendDriverError } from "./http/errors.js";
export type { DriverErrorBody } from "./http/errors.js";
