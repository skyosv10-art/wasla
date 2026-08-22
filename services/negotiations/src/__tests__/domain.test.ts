/**
 * The pure domain: transitions, turn-taking, policy, money and time arithmetic.
 *
 * Everything in this file is synchronous and dependency-free — no clock, no repository,
 * no `await`. That is the point of separating the domain from the use cases: these rules
 * can be read and tested as statements about negotiation, not as behaviour of a service.
 */

import { describe, expect, it } from "vitest";

import {
  NEGOTIATION_CLOSE_REASON_CODES,
  NEGOTIATION_ROUND_STATES,
  NEGOTIATION_THREAD_STATES,
} from "@wasla/contracts-negotiation";

import { addSeconds, computeNextTickAt, dueMomentFor, earlier, isDue } from "../domain/expiry.js";
import { assertAmountMinor, assertCurrency, money, sameMoney } from "../domain/money.js";
import {
  LAUNCH_POLICY_VERSION,
  SEEDED_POLICIES,
  amountWithinBounds,
  findSeededPolicy,
  requireUsablePolicy,
  roundBudgetExhausted,
} from "../domain/policy.js";
import {
  ROUND_TRANSITIONS,
  THREAD_CLOSE_REASONS,
  THREAD_TRANSITIONS,
  canTransitionRound,
  canTransitionThread,
  declineReasonFor,
  partyOf,
  turnBelongsTo,
} from "../domain/state-machine.js";
import { isNegotiationError } from "../domain/errors.js";
import { CUSTOMER_ID, DRIVER_ID, START } from "./helpers.js";

const LAUNCH = SEEDED_POLICIES[0]!;

describe("thread transitions", () => {
  it("lets an open thread reach every ending, and lets no ending move again", () => {
    expect([...THREAD_TRANSITIONS.open].sort()).toEqual(
      ["agreed", "cancelled", "declined", "expired"].sort(),
    );
    for (const state of ["agreed", "declined", "expired", "cancelled"] as const) {
      // Every close is final. A reopened negotiation would let a settled fare change
      // after the fact, which is the one thing the parties must be able to rely on.
      expect(THREAD_TRANSITIONS[state]).toEqual([]);
      expect(canTransitionThread(state, "open")).toBe(false);
    }
  });

  it("covers every published thread state, in both directions", () => {
    // A state added to the contract with no transition entry would silently be
    // unreachable, or worse, reachable and unclosable.
    expect(Object.keys(THREAD_TRANSITIONS).sort()).toEqual(
      [...NEGOTIATION_THREAD_STATES].sort(),
    );
  });

  it("binds each ending to the reasons that can produce it", () => {
    expect(THREAD_CLOSE_REASONS.agreed).toEqual(["agreed"]);
    expect([...THREAD_CLOSE_REASONS.declined].sort()).toEqual(
      ["declined_by_customer", "declined_by_driver", "max_rounds_reached"].sort(),
    );
    expect(THREAD_CLOSE_REASONS.expired).toEqual(["thread_expired"]);
    expect([...THREAD_CLOSE_REASONS.cancelled].sort()).toEqual(
      ["cancelled_by_dispatch", "order_withdrawn"].sort(),
    );
    // Every published reason belongs to exactly one ending: a reason usable under two
    // states makes «why did this fail» unanswerable by grouping on either column.
    const mapped = Object.values(THREAD_CLOSE_REASONS).flatMap((reasons) => [...reasons]);
    expect(mapped.sort()).toEqual([...NEGOTIATION_CLOSE_REASON_CODES].sort());
    expect(new Set(mapped).size).toBe(mapped.length);
  });

  it("names the refusing party in the reason", () => {
    // «Declined» alone would erase who walked away, which is the difference between a
    // driver problem and a pricing problem.
    expect(declineReasonFor("customer")).toBe("declined_by_customer");
    expect(declineReasonFor("driver")).toBe("declined_by_driver");
  });
});

describe("round transitions", () => {
  it("resolves a pending round exactly once, four ways", () => {
    expect([...ROUND_TRANSITIONS.pending].sort()).toEqual(
      ["accepted", "expired", "rejected", "superseded"].sort(),
    );
    for (const state of ["accepted", "rejected", "superseded", "expired"] as const) {
      expect(ROUND_TRANSITIONS[state]).toEqual([]);
      expect(canTransitionRound(state, "accepted")).toBe(false);
    }
    expect(Object.keys(ROUND_TRANSITIONS).sort()).toEqual([...NEGOTIATION_ROUND_STATES].sort());
  });

  it("gives the turn to whoever did not propose", () => {
    expect(turnBelongsTo({ proposedBy: "driver" } as never)).toBe("customer");
    expect(turnBelongsTo({ proposedBy: "customer" } as never)).toBe("driver");
    // With nothing on the table either party may open — `null` says that instead of
    // inventing a default that would make one side always go first.
    expect(turnBelongsTo(null)).toBeNull();
  });

  it("recognises the thread's two parties by public id, and nobody else", () => {
    const thread = { customerPublicId: CUSTOMER_ID, driverPublicId: DRIVER_ID } as never;
    expect(partyOf(thread, CUSTOMER_ID)).toBe("customer");
    expect(partyOf(thread, DRIVER_ID)).toBe("driver");
    // A third party acting on someone else's negotiation gets `null`, which the use cases
    // turn into PARTY_MISMATCH rather than guessing a role for him.
    expect(partyOf(thread, "WS-9000000009")).toBeNull();
  });
});

describe("policy", () => {
  it("seeds the launch policy frozen, in one currency", () => {
    expect(LAUNCH.policyVersion).toBe(LAUNCH_POLICY_VERSION);
    expect(LAUNCH.currency).toBe("SAR");
    expect(LAUNCH.maxRounds).toBe(5);
    expect(LAUNCH.roundTtlSeconds).toBe(120);
    expect(LAUNCH.threadTtlSeconds).toBe(900);
    expect(LAUNCH.maxMessageLength).toBe(1000);
    expect(LAUNCH.maxMessagesPerThread).toBe(100);
    // Frozen: a live edit of `max_rounds` would change the rules of negotiations already
    // in flight, and the row a thread points at must keep meaning what it meant.
    expect(LAUNCH.isFrozen).toBe(true);
    expect(findSeededPolicy(LAUNCH_POLICY_VERSION)).not.toBeNull();
    expect(findSeededPolicy(999)).toBeNull();
  });

  it("refuses a missing policy and an unfrozen one, differently", () => {
    try {
      requireUsablePolicy(null, 7);
      throw new Error("expected POLICY_NOT_FOUND");
    } catch (error) {
      expect(isNegotiationError(error) && error.code).toBe("NEGOTIATION_POLICY_NOT_FOUND");
    }
    try {
      requireUsablePolicy({ ...LAUNCH, isFrozen: false }, LAUNCH.policyVersion);
      throw new Error("expected POLICY_NOT_FROZEN");
    } catch (error) {
      // A separate code, because the fix is different: one is «seed the row», the other
      // is «this row is still being edited and must not price a real trip».
      expect(isNegotiationError(error) && error.code).toBe("NEGOTIATION_POLICY_NOT_FROZEN");
    }
  });

  it("bounds amounts inclusively at both ends", () => {
    expect(amountWithinBounds(LAUNCH, 500)).toBe(true);
    expect(amountWithinBounds(LAUNCH, 500000)).toBe(true);
    expect(amountWithinBounds(LAUNCH, 499)).toBe(false);
    expect(amountWithinBounds(LAUNCH, 500001)).toBe(false);
  });

  it("spends the round budget by count, not by number", () => {
    expect(roundBudgetExhausted(LAUNCH, 4)).toBe(false);
    expect(roundBudgetExhausted(LAUNCH, 5)).toBe(true);
    // Counting rounds and not the highest round number: an expired round is spent even
    // though nobody answered it.
    expect(roundBudgetExhausted(LAUNCH, 6)).toBe(true);
  });
});

describe("money", () => {
  it("accepts only positive integer minor units", () => {
    expect(assertAmountMinor(4000)).toBe(4000);
    for (const bad of [0, -1, 1.5, "4000", null, undefined, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      // No floats, ever: 0.1 + 0.2 in a fare is a complaint nobody can reproduce.
      expect(() => assertAmountMinor(bad)).toThrow();
    }
  });

  it("accepts only a three-letter upper-case currency", () => {
    expect(assertCurrency("SAR")).toBe("SAR");
    for (const bad of ["sar", "SARX", "SR", 1, null]) {
      expect(() => assertCurrency(bad)).toThrow();
    }
  });

  it("compares money only within one currency", () => {
    expect(sameMoney(money(4000, "SAR"), money(4000, "SAR"))).toBe(true);
    expect(sameMoney(money(4000, "SAR"), money(4001, "SAR"))).toBe(false);
    // Same number, different currency: not the same money. Comparing bare integers is
    // how a 40-riyal fare becomes a 40-dollar one.
    expect(sameMoney(money(4000, "SAR"), money(4000, "AED"))).toBe(false);
  });
});

describe("time", () => {
  it("treats a deadline of exactly now as passed", () => {
    expect(isDue(START, START)).toBe(true);
    expect(isDue("2026-08-23T00:00:00.001Z", START)).toBe(false);
    expect(isDue("2026-08-22T23:59:59.999Z", START)).toBe(true);
  });

  it("adds seconds and refuses nonsense", () => {
    expect(addSeconds(START, 120)).toBe("2026-08-23T00:02:00.000Z");
    expect(addSeconds(START, 0)).toBe(START);
    expect(() => addSeconds(START, -1)).toThrow();
    expect(() => addSeconds(START, 1.5)).toThrow();
    expect(() => addSeconds("not-a-time", 1)).toThrow();
  });

  it("takes the earlier of two moments, treating null as «no deadline»", () => {
    expect(earlier(START, "2026-08-23T00:02:00.000Z")).toBe(START);
    expect(earlier("2026-08-23T00:02:00.000Z", START)).toBe(START);
    expect(earlier(null, START)).toBe(START);
    expect(earlier(START, null)).toBe(START);
    expect(earlier(null, null)).toBeNull();
  });

  it("ticks at the nearest thing that matters, and never for a closed thread", () => {
    expect(
      computeNextTickAt({
        threadState: "open",
        threadExpiresAt: "2026-08-23T00:15:00.000Z",
        pendingRoundExpiresAt: "2026-08-23T00:02:00.000Z",
      }),
    ).toBe("2026-08-23T00:02:00.000Z");
    expect(
      computeNextTickAt({
        threadState: "open",
        threadExpiresAt: "2026-08-23T00:15:00.000Z",
        pendingRoundExpiresAt: null,
      }),
    ).toBe("2026-08-23T00:15:00.000Z");
    // Closed threads leave the sweep's index. Otherwise it grows for ever and the tick
    // gets slower every day the platform is used.
    expect(
      computeNextTickAt({
        threadState: "agreed",
        threadExpiresAt: "2026-08-23T00:15:00.000Z",
        pendingRoundExpiresAt: "2026-08-23T00:02:00.000Z",
      }),
    ).toBeNull();
  });

  it("dates an expiry to the deadline and not to the sweep", () => {
    // The whole reason `occurred_for` exists: an outage must not re-date every deadline
    // it delayed to the moment the service came back.
    expect(dueMomentFor("2026-08-23T00:02:00.000Z")).toBe("2026-08-23T00:02:00.000Z");
  });
});
