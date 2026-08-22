/**
 * `@wasla/negotiations-service` — the negotiation domain, with no I/O in it.
 *
 * ## What this package is, and what MR 2/6 deliberately leaves out
 *
 * Everything here is pure: entities, the two state machines, the frozen policy, the
 * event factories, the ports, in-memory adapters that enforce every named database
 * constraint, and the nine use cases. There is **no Postgres, no Fastify, no fetch**.
 * You can run the whole suite on a laptop with nothing installed and get the same
 * answers CI gets.
 *
 * That split is the same one every service in this repo has followed since Phase 03,
 * and the reason is not tidiness. A domain that can only be exercised through HTTP and
 * a database is a domain whose rules are tested at three layers of indirection, so the
 * tests become slow, then flaky, then deleted — and the rules they protected become
 * folklore. Here `MAX_ROUNDS_REACHED`, self-accept refusal, turn-taking, the round
 * budget, expiry semantics and the hand-off retry ladder are each asserted directly.
 *
 * Landing later, per HANDOFF §14:
 *
 *   - **MR 3/6** — Drizzle/Postgres repositories against `schema.sql`, plus the
 *     `negotiations-db-integration` CI job. The parity suite runs these same use cases
 *     against both adapters, which is what turns «the in-memory store simulates the
 *     constraints» from a claim into a check.
 *   - **MR 4/6** — the Fastify server on port 8091, `/health`, and `onlyKeys()` on every
 *     response.
 *   - **MR 5/6** — the real `AgreedPricePort` over HTTP, the bot flows, and the declared
 *     `orders` migration (`agreed_amount_minor` and friends).
 *   - **MR 6/6** — the exit-gate E2E package and its CI job.
 *
 * ## The one rule a reader must not miss
 *
 * A failed price hand-off NEVER invalidates an agreement, and this service publishes no
 * error code for it: no `502`, no `bad_gateway` class anywhere (ADR-013 decision 2 ·
 * `domain/errors.ts` header · `use-cases/handoff.ts`). Two people agreed on a price; a
 * network fault between two of our own services has no standing to retract that, and a
 * response saying otherwise would tell a driver already on his way that there was no
 * deal.
 */

export * from "./domain/model.js";
export * from "./domain/errors.js";
export * from "./domain/policy.js";
export * from "./domain/money.js";
export * from "./domain/expiry.js";
export * from "./domain/validation.js";
export * from "./domain/state-machine.js";
export * as negotiationEvents from "./domain/events.js";
export type { EventMeta } from "./domain/events.js";

export * from "./ports.js";
export * from "./infrastructure/in-memory.js";

export * from "./use-cases/shared.js";
export * from "./use-cases/expiry-core.js";
export * from "./use-cases/handoff.js";
export * from "./use-cases/open-thread.js";
export * from "./use-cases/propose-round.js";
export * from "./use-cases/accept-round.js";
export * from "./use-cases/reject-round.js";
export * from "./use-cases/post-message.js";
export * from "./use-cases/cancel-thread.js";
export * from "./use-cases/read-negotiation.js";
export * from "./use-cases/run-tick.js";
