/**
 * Every named constraint in the negotiation DDL, raised on purpose, by name.
 *
 * Two kinds of rule live in the schema and they are tested differently:
 *
 *   - **Caller-reachable** rules (a driver accepting his own offer, two threads on one
 *     dispatch offer) surface as published `NegotiationError` codes, because a caller can
 *     legitimately hit them and deserves an answer he can act on.
 *   - **Coherence** rules (`state = 'open'` implies no close reason) can only be violated
 *     by this service writing an incoherent row. They raise `NegotiationConstraintViolation`,
 *     which has NO published code, so the HTTP layer cannot map it to a tidy 4xx and
 *     nobody can be told to «retry» a bug.
 *
 * The list below is checked against the enforcement table at the bottom of the file: adding
 * a constraint to the DDL without a test here fails the coverage assertion. That is what
 * keeps this file honest as the schema grows, instead of drifting into a museum of the
 * rules somebody happened to remember on the day.
 */

import { describe, expect, it } from "vitest";

import { isNegotiationError } from "../domain/errors.js";
import {
  InMemoryPolicyRepository,
  NegotiationConstraintViolation,
} from "../infrastructure/in-memory.js";
import { acceptRound } from "../use-cases/accept-round.js";
import { openThread } from "../use-cases/open-thread.js";
import { postMessage } from "../use-cases/post-message.js";
import { proposeRound } from "../use-cases/propose-round.js";
import {
  CUSTOMER_ID,
  DRIVER_ID,
  OFFER_ID,
  ORDER_ID,
  START,
  key,
  openInput,
  withOpenThread,
} from "./helpers.js";

/**
 * Every named rule of the negotiation schema: 22 CHECK/UNIQUE constraints plus the two
 * partial unique indexes that enforce turn-taking (`_one_pending`, `_one_accepted`).
 *
 * Hand-mirrored on purpose: MR 3/6 introduces the Drizzle schema and will assert this
 * list against the generated migration, so a rename in either place becomes a red test
 * rather than a rule that quietly stops being enforced in one of the two.
 */
const DDL_CONSTRAINTS = Object.freeze([
  "ck_negotiation_policies_amount_bounds",
  "ck_negotiation_policies_ttl_order",
  "ux_negotiation_threads_order_driver",
  "ux_negotiation_threads_dispatch_offer",
  "ck_negotiation_threads_open_is_clean",
  "ck_negotiation_threads_closed_has_reason",
  "ck_negotiation_threads_agreed_names_round",
  "ck_negotiation_threads_round_counters",
  "ck_negotiation_threads_agreed_round_exists",
  "ux_negotiation_rounds_thread_no",
  "ck_negotiation_rounds_state_timestamp",
  "ck_negotiation_rounds_no_self_resolution",
  "ux_negotiation_rounds_one_pending",
  "ux_negotiation_rounds_one_accepted",
  "ux_negotiation_messages_thread_seq",
  "ck_negotiation_messages_body_or_code",
  "ck_negotiation_messages_redaction",
  "ux_negotiation_agreements_order_driver",
  "ck_negotiation_agreements_handed_off_at",
  "ck_negotiation_agreements_terminal_no_retry",
  "ck_negotiation_agreements_failure_named",
  "ux_negotiation_price_handoffs_attempt",
  "ck_negotiation_price_handoffs_completion",
  "ck_negotiation_price_handoffs_failure_named",
] as const);

/** Assert that a coherence rule fired, and that it named itself. */
async function expectConstraint(operation: Promise<unknown>, constraint: string): Promise<void> {
  try {
    await operation;
  } catch (error) {
    if (!(error instanceof NegotiationConstraintViolation)) {
      throw new Error(`expected constraint ${constraint}, got ${String(error)}`);
    }
    expect(error.constraint).toBe(constraint);
    // No published code: this must not be reachable through the HTTP error map.
    expect(isNegotiationError(error)).toBe(false);
    return;
  }
  throw new Error(`expected constraint ${constraint}, but the write succeeded`);
}

/** Assert a published code AND the constraint it names in `details`. */
async function expectCodeAndConstraint(
  operation: Promise<unknown>,
  code: string,
  constraint: string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    if (!isNegotiationError(error)) throw new Error(`expected ${code}, got ${String(error)}`);
    expect(error.code).toBe(code);
    expect((error.details as { constraint?: string } | undefined)?.constraint).toBe(constraint);
    return;
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

/** Assert a coherence rule that fires synchronously, on the way into a constructor. */
function expectConstraintSync(operation: () => unknown, constraint: string): void {
  try {
    operation();
  } catch (error) {
    if (!(error instanceof NegotiationConstraintViolation)) {
      throw new Error(`expected constraint ${constraint}, got ${String(error)}`);
    }
    expect(error.constraint).toBe(constraint);
    return;
  }
  throw new Error(`expected constraint ${constraint}, but the value was accepted`);
}

/** A policy row shaped like the launch seed, so a test can break exactly one field. */
function policyFixture(overrides: Record<string, unknown>) {
  return {
    policyVersion: 90,
    label: "fixture",
    currency: "SAR",
    minAmountMinor: 500,
    maxAmountMinor: 500000,
    maxRounds: 5,
    roundTtlSeconds: 120,
    threadTtlSeconds: 900,
    maxMessageLength: 1000,
    maxMessagesPerThread: 100,
    isFrozen: true,
    createdAt: START,
    ...overrides,
  } as never;
}

async function agreedFixture() {
  const { deps, thread } = await withOpenThread();
  await proposeRound(
    deps,
    thread.id,
    { proposed_by: "driver", amount_minor: 4000, currency: "SAR", expected_round_no: 0 },
    { idempotencyKey: key("p") },
  );
  const result = await acceptRound(
    deps,
    thread.id,
    1,
    { acting_party: "customer" },
    { idempotencyKey: key("a") },
  );
  return { deps, thread: result.thread };
}

/** An agreement whose hand-off failed, so `handedOffAt` is still null. */
async function failedHandoffFixture() {
  const { deps, thread } = await withOpenThread();
  deps.agreedPrice.mode = "throw";
  await proposeRound(
    deps,
    thread.id,
    { proposed_by: "driver", amount_minor: 4000, currency: "SAR", expected_round_no: 0 },
    { idempotencyKey: key("p") },
  );
  const result = await acceptRound(
    deps,
    thread.id,
    1,
    { acting_party: "customer" },
    { idempotencyKey: key("a") },
  );
  return { deps, thread: result.thread };
}

// ---------------------------------------------------------------------------
// The enforcement table. One entry per DDL constraint, no exceptions.
// ---------------------------------------------------------------------------

const CHECKS: Record<string, () => Promise<void>> = {
  // --- policies ------------------------------------------------------------
  async ck_negotiation_policies_amount_bounds() {
    // Checked when the repository is seeded: a fixture the database would refuse must not
    // be able to prove behaviour in a test either.
    expectConstraintSync(
      () => new InMemoryPolicyRepository([policyFixture({ policyVersion: 99, minAmountMinor: 5000, maxAmountMinor: 500 })]),
      "ck_negotiation_policies_amount_bounds",
    );
  },

  async ck_negotiation_policies_ttl_order() {
    // A round TTL longer than the thread's makes the round's own deadline unreachable, so
    // «expired» could only ever be the thread's doing.
    expectConstraintSync(
      () =>
        new InMemoryPolicyRepository([
          policyFixture({ policyVersion: 98, roundTtlSeconds: 1000, threadTtlSeconds: 900 }),
        ]),
      "ck_negotiation_policies_ttl_order",
    );
  },

  // --- threads -------------------------------------------------------------
  async ux_negotiation_threads_order_driver() {
    const { deps } = await withOpenThread();
    deps.offers.put({
      dispatchOfferId: "22222222-2222-4222-8222-222222222222",
      orderPublicId: ORDER_ID,
      driverPublicId: DRIVER_ID,
      serviceKind: "ride",
      active: true,
      negotiable: true,
    });
    // Same order, same driver, a different offer: still one live negotiation between the
    // same two people, and two would let a driver hold two prices at once.
    await expectCodeAndConstraint(
      openThread(
        deps,
        openInput({ dispatch_offer_id: "22222222-2222-4222-8222-222222222222" }) as never,
        { idempotencyKey: key() },
      ),
      "NEGOTIATION_THREAD_ALREADY_EXISTS",
      "ux_negotiation_threads_order_driver",
    );
  },

  async ux_negotiation_threads_dispatch_offer() {
    const { deps, thread } = await withOpenThread();
    // Reached at the repository, because the use case's own lookup catches this first: the
    // index is the line that holds when two requests race. A DIFFERENT order and driver,
    // so the pair index cannot be what fires — the offer is what is already taken.
    await expectCodeAndConstraint(
      deps.threads.create({
        id: "33333333-3333-4333-8333-333333333333",
        orderPublicId: "ORD-1000000002",
        customerPublicId: CUSTOMER_ID,
        driverPublicId: "WS-3000000002",
        dispatchOfferId: OFFER_ID,
        serviceKind: "ride",
        policyVersion: thread.policyVersion,
        currency: "SAR",
        openingAmountMinor: 3000,
        openedBy: "customer",
        expiresAt: "2026-08-23T00:15:00.000Z",
        nextTickAt: "2026-08-23T00:15:00.000Z",
        createdAt: START,
      }),
      "NEGOTIATION_THREAD_ALREADY_EXISTS",
      "ux_negotiation_threads_dispatch_offer",
    );
  },

  async ck_negotiation_threads_open_is_clean() {
    const { deps, thread } = await withOpenThread();
    // An open thread carrying a close reason is a negotiation that is both over and not.
    await expectConstraint(
      deps.threads.update(
        thread.id,
        { state: "open", closeReasonCode: "declined_by_driver" },
        START,
        thread.version,
      ),
      "ck_negotiation_threads_open_is_clean",
    );
  },

  async ck_negotiation_threads_closed_has_reason() {
    const { deps, thread } = await withOpenThread();
    // «Closed, reason unknown» is the row that makes a funnel unanswerable.
    await expectConstraint(
      deps.threads.update(
        thread.id,
        { state: "declined", closeReasonCode: null, closedAt: START, nextTickAt: null },
        START,
        thread.version,
      ),
      "ck_negotiation_threads_closed_has_reason",
    );
  },

  async ck_negotiation_threads_agreed_names_round() {
    const { deps, thread } = await withOpenThread();
    await proposeRound(
      deps,
      thread.id,
      { proposed_by: "driver", amount_minor: 4000, currency: "SAR", expected_round_no: 0 },
      { idempotencyKey: key("p") },
    );
    const fresh = (await deps.threads.find(thread.id))!;
    // `agreed` without a round number is «they agreed on something».
    await expectConstraint(
      deps.threads.update(
        thread.id,
        {
          state: "agreed",
          closeReasonCode: "agreed",
          agreedRoundNo: null,
          closedAt: START,
          nextTickAt: null,
        },
        START,
        fresh.version,
      ),
      "ck_negotiation_threads_agreed_names_round",
    );
  },

  async ck_negotiation_threads_agreed_round_exists() {
    const { deps, thread } = await withOpenThread();
    // Naming round 7 when no round 7 was ever proposed.
    await expectConstraint(
      deps.threads.update(
        thread.id,
        {
          state: "agreed",
          closeReasonCode: "agreed",
          agreedRoundNo: 7,
          closedAt: START,
          nextTickAt: null,
        },
        START,
        thread.version,
      ),
      "ck_negotiation_threads_agreed_round_exists",
    );
  },

  async ck_negotiation_threads_round_counters() {
    const { deps, thread } = await withOpenThread();
    // «Currently at round 2, of which one exists» — the row that makes any per-round join
    // return nothing for a round the thread claims to be on.
    await expectConstraint(
      deps.threads.update(thread.id, { roundCount: 1, currentRoundNo: 2 }, START, thread.version),
      "ck_negotiation_threads_round_counters",
    );
  },

  // --- rounds --------------------------------------------------------------
  async ux_negotiation_rounds_thread_no() {
    const { deps, thread } = await withOpenThread();
    await proposeRound(
      deps,
      thread.id,
      { proposed_by: "driver", amount_minor: 4000, currency: "SAR", expected_round_no: 0 },
      { idempotencyKey: key("p") },
    );
    // Round numbers are the vocabulary of the whole feature: «I accept round 1» is only
    // unambiguous while there is exactly one round 1.
    await expectConstraint(
      deps.rounds.create({
        id: "44444444-4444-4444-8444-444444444444",
        threadId: thread.id,
        roundNo: 1,
        proposedBy: "customer",
        amountMinor: 3000,
        currency: "SAR",
        expiresAt: "2026-08-23T00:02:00.000Z",
        createdAt: START,
      }),
      "ux_negotiation_rounds_thread_no",
    );
  },

  async ck_negotiation_rounds_state_timestamp() {
    const { deps, thread } = await withOpenThread();
    await proposeRound(
      deps,
      thread.id,
      { proposed_by: "driver", amount_minor: 4000, currency: "SAR", expected_round_no: 0 },
      { idempotencyKey: key("p") },
    );
    // Resolved without a moment: «he refused» with no answer to «when».
    await expectConstraint(
      deps.rounds.resolve(thread.id, 1, {
        state: "rejected",
        resolvedBy: "customer",
        respondedAt: null,
      }),
      "ck_negotiation_rounds_state_timestamp",
    );
  },

  async ck_negotiation_rounds_no_self_resolution() {
    const { deps, thread } = await withOpenThread();
    await proposeRound(
      deps,
      thread.id,
      { proposed_by: "driver", amount_minor: 4000, currency: "SAR", expected_round_no: 0 },
      { idempotencyKey: key("p") },
    );
    await expectCodeAndConstraint(
      acceptRound(deps, thread.id, 1, { acting_party: "driver" }, { idempotencyKey: key() }),
      "NEGOTIATION_SELF_ACCEPT_FORBIDDEN",
      "ck_negotiation_rounds_no_self_resolution",
    );
  },

  async ux_negotiation_rounds_one_pending() {
    const { deps, thread } = await withOpenThread();
    await proposeRound(
      deps,
      thread.id,
      { proposed_by: "driver", amount_minor: 4000, currency: "SAR", expected_round_no: 0 },
      { idempotencyKey: key("p") },
    );
    // Proposing again while your own offer is still on the table: turn-taking, enforced
    // by a partial unique index rather than by hope.
    await expectCodeAndConstraint(
      proposeRound(
        deps,
        thread.id,
        { proposed_by: "driver", amount_minor: 3900, currency: "SAR", expected_round_no: 1 },
        { idempotencyKey: key() },
      ),
      "NEGOTIATION_TURN_VIOLATION",
      "ux_negotiation_rounds_one_pending",
    );
  },

  async ux_negotiation_rounds_one_accepted() {
    const { deps, thread } = await agreedFixture();
    await expectCodeAndConstraint(
      acceptRound(deps, thread.id, 1, { acting_party: "customer" }, { idempotencyKey: key() }),
      "NEGOTIATION_ALREADY_AGREED",
      "ux_negotiation_rounds_one_accepted",
    );
  },

  // --- messages ------------------------------------------------------------
  async ux_negotiation_messages_thread_seq() {
    const { deps, thread } = await withOpenThread();
    await postMessage(
      deps,
      thread.id,
      { author_role: "customer", body: "مرحباً" },
      { idempotencyKey: key("m") },
    );
    await expectConstraint(
      deps.messages.create({
        id: "55555555-5555-4555-8555-555555555555",
        threadId: thread.id,
        sequenceNo: 1,
        authorRole: "driver",
        body: "أهلاً",
        sourceLocale: "ar",
        systemCode: null,
        roundNo: null,
        createdAt: START,
      }),
      "ux_negotiation_messages_thread_seq",
    );
  },

  async ck_negotiation_messages_body_or_code() {
    const { deps, thread } = await withOpenThread();
    // Neither text nor a system code: a bubble with nothing to render.
    await expectConstraint(
      deps.messages.create({
        id: "66666666-6666-4666-8666-666666666666",
        threadId: thread.id,
        sequenceNo: 1,
        authorRole: "system",
        body: null,
        sourceLocale: "ar",
        systemCode: null,
        roundNo: null,
        createdAt: START,
      }),
      "ck_negotiation_messages_body_or_code",
    );
  },

  async ck_negotiation_messages_redaction() {
    const { deps, thread } = await withOpenThread();
    const { message } = await postMessage(
      deps,
      thread.id,
      { author_role: "customer", body: "رقمي 0500000000" },
      { idempotencyKey: key("m") },
    );
    // An emptied body with no reason recorded is indistinguishable from a bug that lost
    // the text, so the row is refused rather than written.
    await expectConstraint(
      deps.messages.redact(thread.id, message.id, null as unknown as string, START),
      "ck_negotiation_messages_redaction",
    );
  },

  // --- agreements ----------------------------------------------------------
  async ux_negotiation_agreements_order_driver() {
    const { deps, thread } = await agreedFixture();
    // A second agreement for the same order and driver, on another thread: two prices for
    // one job, which is the one thing this table exists to make impossible.
    await expectCodeAndConstraint(
      deps.agreements.create({
        threadId: "77777777-7777-4777-8777-777777777777",
        orderPublicId: ORDER_ID,
        driverPublicId: DRIVER_ID,
        roundNo: 1,
        amountMinor: 9900,
        currency: "SAR",
        acceptedBy: "customer",
        policyVersion: thread.policyVersion,
        agreedAt: START,
        nextHandoffAt: null,
      }),
      "NEGOTIATION_ALREADY_AGREED",
      "ux_negotiation_agreements_order_driver",
    );
  },

  async ck_negotiation_agreements_handed_off_at() {
    const { deps, thread } = await agreedFixture();
    // `handed_off` with no moment: the state that makes «when did the order get the
    // price» unanswerable.
    await expectConstraint(
      deps.agreements.update(thread.id, { handoffState: "handed_off", handedOffAt: null }, START),
      "ck_negotiation_agreements_handed_off_at",
    );
  },

  async ck_negotiation_agreements_terminal_no_retry() {
    const { deps, thread } = await failedHandoffFixture();
    // A terminal outcome with a retry pencilled in would ask the same refused question
    // until somebody noticed the traffic.
    await expectConstraint(
      deps.agreements.update(
        thread.id,
        { handoffState: "rejected", lastErrorCode: "ORDER_NOT_ACCEPTING_PRICE", nextHandoffAt: "2026-08-23T01:00:00.000Z" },
        START,
      ),
      "ck_negotiation_agreements_terminal_no_retry",
    );
  },

  async ck_negotiation_agreements_failure_named() {
    const { deps, thread } = await failedHandoffFixture();
    // Failed, cause unnamed: nobody can tell a refusal from an outage afterwards.
    await expectConstraint(
      deps.agreements.update(
        thread.id,
        { handoffState: "abandoned", lastErrorCode: null, nextHandoffAt: null },
        START,
      ),
      "ck_negotiation_agreements_failure_named",
    );
  },

  // --- price hand-offs -----------------------------------------------------
  async ux_negotiation_price_handoffs_attempt() {
    const { deps, thread } = await agreedFixture();
    await expectConstraint(
      deps.handoffs.begin({
        id: "88888888-8888-4888-8888-888888888888",
        threadId: thread.id,
        attemptNo: 1,
        amountMinor: 4000,
        currency: "SAR",
        requestedAt: START,
      }),
      "ux_negotiation_price_handoffs_attempt",
    );
  },

  async ck_negotiation_price_handoffs_completion() {
    const { deps, thread } = await agreedFixture();
    const [attempt] = await deps.handoffs.list(thread.id);
    // An outcome with no completion moment — the attempt row's whole value is that it
    // says when the answer came.
    await expectConstraint(
      deps.handoffs.complete(attempt!.id, {
        outcome: "accepted",
        responseStatus: 200,
        errorCode: null,
        completedAt: null as unknown as string,
      }),
      "ck_negotiation_price_handoffs_completion",
    );
  },

  async ck_negotiation_price_handoffs_failure_named() {
    const { deps, thread } = await agreedFixture();
    deps.clock.advanceSeconds(1);
    const second = await deps.handoffs.begin({
      id: "99999999-9999-4999-8999-999999999999",
      threadId: thread.id,
      attemptNo: 2,
      amountMinor: 4000,
      currency: "SAR",
      requestedAt: deps.clock.now(),
    });
    await expectConstraint(
      deps.handoffs.complete(second.id, {
        outcome: "unavailable",
        responseStatus: null,
        errorCode: null,
        completedAt: deps.clock.now(),
      }),
      "ck_negotiation_price_handoffs_failure_named",
    );
  },
};

describe("named DDL constraints", () => {
  it("covers every constraint in the schema, with no test-only extras", () => {
    // The guard that keeps this file from drifting: a new CONSTRAINT with no entry here
    // fails, and an entry naming a constraint that no longer exists fails too.
    expect(Object.keys(CHECKS).sort()).toEqual([...DDL_CONSTRAINTS].sort());
    expect(DDL_CONSTRAINTS).toHaveLength(24);
  });

  for (const [constraint, check] of Object.entries(CHECKS)) {
    it(`enforces ${constraint}`, check);
  }
});
