/**
 * `@wasla/negotiations-service` — the negotiation domain, with no I/O in it.
 *
 * ## What this package is, and what MR 2/6 deliberately leaves out
 *
 * The domain is pure: entities, the two state machines, the frozen policy, the event
 * factories, the ports, in-memory adapters that enforce every named database constraint,
 * and the nine use cases; MR 3/6 added the Drizzle/Postgres adapters beside them, behind
 * the very same ports, and MR 4/6 added the Fastify layer ON TOP of both — never inside
 * either. There is still **no fetch** here.
 *
 * You can still run the whole suite on a laptop with nothing installed and get the same
 * answers CI gets: `createNegotiationApp` takes a `NegotiationRunner`, and
 * `createDirectNegotiationRunner` builds one over the in-memory dependencies, so the
 * HTTP tests use `app.inject` with no port, no database and no sleep.
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
 *   - **MR 3/6 (landed)** — Drizzle/Postgres repositories against `schema.sql`, the
 *     `PostgresNegotiationUnitOfWork` transaction boundary, and the
 *     `negotiations-db-integration` CI job. The parity suite runs these same use cases
 *     against both adapters, which is what turned «the in-memory store simulates the
 *     constraints» from a claim into a check: see `docs/02-architecture/NEGOTIATION_PERSISTENCE.md`.
 *   - **MR 4/6 (landed)** — the Fastify layer on port 8091: the ten contract paths plus
 *     `/health`, `src/runner.ts` as the only transaction seam, `onlyKeys()` on every
 *     request body, and one error handler that is the sole author of a status code. See
 *     `docs/04-api/NEGOTIATION_HTTP.md`.
 *   - **MR 5/6 (landed)** — the real `DispatchOfferPort` (dispatch 8089 + orders 8087,
 *     because the snapshot spans two ownerships) and `AgreedPricePort` (orders 8087) over
 *     HTTP, chosen from the environment in `infrastructure/outbound-wiring.ts`; the bot
 *     flows; and the declared `orders` migration (`agreed_amount_minor` and friends).
 *     With no URLs configured, `infrastructure/runtime.ts` still wires two ports that
 *     REFUSE by name rather than pretend to succeed. See `docs/04-api/NEGOTIATION_HTTP.md`.
 *     There is now a `fetch` in this package — in those two adapters and nowhere else.
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
export * from "./infrastructure/drizzle/db.js";
export * from "./infrastructure/drizzle/repository.js";
export * from "./infrastructure/drizzle/transaction.js";
export * from "./infrastructure/runtime.js";
export * from "./infrastructure/http-dispatch-offer.js";
export * from "./infrastructure/http-agreed-price.js";
export * from "./infrastructure/outbound-wiring.js";

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

export * from "./runner.js";
export * from "./mappers.js";
export * from "./http/app.js";
export {
  sendNegotiationError,
  toWireDetails,
  NEGOTIATION_INTERNAL_ERROR_CODE,
  type NegotiationErrorBody,
  type NegotiationErrorWireDetails,
} from "./http/errors.js";
export * from "./http/requests.js";
// `http/server.js` غائبٌ عن هذه القائمة عن قصد: آخر سطر فيه `await main()`، فاستيرادُ
// الحزمة لقراءة نوعٍ منها كان سيرفع خادماً على المنفذ 8091.

