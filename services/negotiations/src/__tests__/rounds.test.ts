/**
 * Rounds: turn-taking, the optimistic guard, superseding, the budget, and rejection.
 *
 * These are the rules a user experiences as fairness. Each one is asserted here at the
 * use-case level — not through HTTP, not against a database — so a change in behaviour
 * fails in the file that explains why the behaviour exists.
 */

import { describe, expect, it } from "vitest";

import { proposeRound } from "../use-cases/propose-round.js";
import { rejectRound } from "../use-cases/reject-round.js";
import { acceptRound } from "../use-cases/accept-round.js";
import { expectCode, key, withOpenThread } from "./helpers.js";

async function propose(
  deps: Awaited<ReturnType<typeof withOpenThread>>["deps"],
  threadId: string,
  party: "customer" | "driver",
  amount: number,
  expectedRoundNo: number,
  note?: string,
) {
  return proposeRound(
    deps,
    threadId,
    {
      proposed_by: party,
      amount_minor: amount,
      currency: "SAR",
      expected_round_no: expectedRoundNo,
      note,
    },
    { idempotencyKey: key("prop") },
  );
}

describe("proposeRound", () => {
  it("creates round 1 with a deadline from the policy round TTL", async () => {
    const { deps, thread } = await withOpenThread();
    const { round, thread: updated } = await propose(deps, thread.id, "driver", 4000, 0);

    expect(round.roundNo).toBe(1);
    expect(round.state).toBe("pending");
    expect(round.resolvedBy).toBeNull();
    // round_ttl_seconds = 120.
    expect(round.expiresAt).toBe("2026-08-23T00:02:00.000Z");
    expect(updated.roundCount).toBe(1);
    expect(updated.currentRoundNo).toBe(1);
    // The tick must now wake at the round's deadline, which is nearer than the thread's.
    expect(updated.nextTickAt).toBe(round.expiresAt);
  });

  it("clamps a round deadline to the thread deadline so no countdown outlives its thread", async () => {
    const { deps, thread } = await withOpenThread();
    // 60 seconds before the thread expires; the round TTL of 120 would overshoot it.
    deps.clock.set("2026-08-23T00:14:00.000Z");
    const { round } = await propose(deps, thread.id, "driver", 4000, 0);
    expect(round.expiresAt).toBe(thread.expiresAt);
  });

  it("refuses a second proposal by the same party while his own offer is pending", async () => {
    const { deps, thread } = await withOpenThread();
    await propose(deps, thread.id, "driver", 4000, 0);
    const error = await expectCode(
      propose(deps, thread.id, "driver", 4200, 1),
      "NEGOTIATION_TURN_VIOLATION",
    );
    // The error names whose turn it is, so a client can say so instead of guessing.
    expect(error.details?.expected).toBe("customer");
  });

  it("lets the counterparty counter, superseding the offer it answers", async () => {
    const { deps, thread } = await withOpenThread();
    const first = await propose(deps, thread.id, "driver", 4000, 0);
    const second = await propose(deps, thread.id, "customer", 3500, 1);

    expect(second.round.roundNo).toBe(2);
    expect(second.supersededRoundNo).toBe(1);
    const superseded = await deps.rounds.find(thread.id, 1);
    // `superseded`, never `rejected`: he did not refuse the price, he replaced the
    // subject of the conversation. Calling it a rejection reverses the meaning of every
    // funnel built on these rows.
    expect(superseded?.state).toBe("superseded");
    expect(superseded?.resolvedBy).toBeNull();
    expect(first.round.roundNo).toBe(1);

    const [event] = deps.outbox.ofType("negotiations.round_proposed").slice(-1);
    expect(event?.data.supersedes_round_no).toBe(1);
  });

  it("refuses a proposal written against a round number that has moved", async () => {
    const { deps, thread } = await withOpenThread();
    await propose(deps, thread.id, "driver", 4000, 0);
    // The customer's screen still showed «no rounds yet».
    const error = await expectCode(
      propose(deps, thread.id, "customer", 3500, 0),
      "NEGOTIATION_ROUND_STALE",
    );
    expect(error.details?.expectedRoundNo).toBe(0);
    expect(error.details?.currentRoundNo).toBe(1);
  });

  it("spends the round budget on creations and refuses the sixth proposal", async () => {
    const { deps, thread } = await withOpenThread();
    const parties = ["driver", "customer", "driver", "customer", "driver"] as const;
    for (let index = 0; index < parties.length; index += 1) {
      await propose(deps, thread.id, parties[index]!, 4000 + index * 100, index);
    }
    const afterFive = await deps.threads.find(thread.id);
    expect(afterFive?.roundCount).toBe(5);

    const error = await expectCode(
      propose(deps, thread.id, "customer", 3900, 5),
      "NEGOTIATION_MAX_ROUNDS_REACHED",
    );
    expect(error.details?.maxRounds).toBe(5);
    // And the thread is STILL open: the offer on the table can be accepted. Closing on
    // the spot would destroy a live agreement to enforce a limit on proposals.
    expect((await deps.threads.find(thread.id))?.state).toBe("open");

    const accepted = await acceptRound(
      deps,
      thread.id,
      5,
      { acting_party: "customer" },
      { idempotencyKey: key("acc") },
    );
    expect(accepted.thread.state).toBe("agreed");
  });

  it("refuses a counter-offer in another currency and never converts it", async () => {
    const { deps, thread } = await withOpenThread();
    await expectCode(
      proposeRound(
        deps,
        thread.id,
        {
          proposed_by: "driver",
          amount_minor: 4000,
          currency: "USD",
          expected_round_no: 0,
        },
        { idempotencyKey: key() },
      ),
      "NEGOTIATION_CURRENCY_MISMATCH",
    );
  });

  it("refuses any proposal once the thread is closed", async () => {
    const { deps, thread } = await withOpenThread();
    await propose(deps, thread.id, "driver", 4000, 0);
    await rejectRound(
      deps,
      thread.id,
      1,
      { acting_party: "customer", close_thread: true },
      { idempotencyKey: key("rej") },
    );
    const error = await expectCode(
      propose(deps, thread.id, "driver", 4100, 1),
      "NEGOTIATION_THREAD_CLOSED",
    );
    expect(error.details?.threadState).toBe("declined");
  });

  it("attaches a proposal note to the chat as an ordinary message", async () => {
    const { deps, thread } = await withOpenThread();
    const { round, note } = await propose(deps, thread.id, "driver", 4000, 0, "الطريق مزدحم");
    expect(note?.roundNo).toBe(round.roundNo);
    expect(note?.body).toBe("الطريق مزدحم");
    expect(await deps.messages.count(thread.id)).toBe(1);
  });
});

describe("rejectRound", () => {
  it("records a rejection and declares that the thread remains open", async () => {
    const { deps, thread } = await withOpenThread();
    await propose(deps, thread.id, "driver", 4000, 0);
    const result = await rejectRound(
      deps,
      thread.id,
      1,
      { acting_party: "customer", close_thread: false },
      { idempotencyKey: key("rej") },
    );

    expect(result.round.state).toBe("rejected");
    expect(result.round.resolvedBy).toBe("customer");
    expect(result.threadClosed).toBe(false);
    expect(result.thread.state).toBe("open");
    // Nothing is pending, so the only deadline left is the thread's own.
    expect(result.thread.nextTickAt).toBe(result.thread.expiresAt);

    const [event] = deps.outbox.ofType("negotiations.round_rejected");
    // Declared, not inferred: «I refuse and I will counter» must be distinguishable from
    // «I refuse and I am done» by a consumer that never reads the thread.
    expect(event?.data.thread_remains_open).toBe(true);
  });

  it("closes the thread as declined_by_driver when the driver walks away", async () => {
    const { deps, thread } = await withOpenThread();
    await propose(deps, thread.id, "customer", 3000, 0);
    const result = await rejectRound(
      deps,
      thread.id,
      1,
      { acting_party: "driver", close_thread: true },
      { idempotencyKey: key("rej") },
    );

    expect(result.thread.state).toBe("declined");
    // Never `cancelled_*`: those mean the ORDER went away, and merging them makes
    // «customers refuse our prices» indistinguishable from «our orders disappear».
    expect(result.thread.closeReasonCode).toBe("declined_by_driver");
    expect(result.thread.closedAt).not.toBeNull();
    expect(result.thread.nextTickAt).toBeNull();

    const [closed] = deps.outbox.ofType("negotiations.thread_closed");
    expect(closed?.data.state).toBe("declined");
    expect(closed?.data.close_reason_code).toBe("declined_by_driver");
  });

  it("refuses the proposer rejecting his own round", async () => {
    const { deps, thread } = await withOpenThread();
    await propose(deps, thread.id, "driver", 4000, 0);
    await expectCode(
      rejectRound(
        deps,
        thread.id,
        1,
        { acting_party: "driver", close_thread: false },
        { idempotencyKey: key() },
      ),
      "NEGOTIATION_SELF_ACCEPT_FORBIDDEN",
    );
  });

  it("refuses a round that is no longer pending", async () => {
    const { deps, thread } = await withOpenThread();
    await propose(deps, thread.id, "driver", 4000, 0);
    await rejectRound(
      deps,
      thread.id,
      1,
      { acting_party: "customer", close_thread: false },
      { idempotencyKey: key() },
    );
    const error = await expectCode(
      rejectRound(
        deps,
        thread.id,
        1,
        { acting_party: "customer", close_thread: false },
        { idempotencyKey: key() },
      ),
      "NEGOTIATION_ROUND_NOT_PENDING",
    );
    expect(error.details?.roundState).toBe("rejected");
  });

  it("requires close_thread as a real boolean rather than coercing a missing field", async () => {
    const { deps, thread } = await withOpenThread();
    await propose(deps, thread.id, "driver", 4000, 0);
    await expectCode(
      rejectRound(
        deps,
        thread.id,
        1,
        { acting_party: "customer", close_thread: "false" },
        { idempotencyKey: key() },
      ),
      "NEGOTIATION_VALIDATION_FAILED",
    );
  });

  it("closes as max_rounds_reached when the last allowed round is rejected", async () => {
    const { deps, thread } = await withOpenThread();
    const parties = ["driver", "customer", "driver", "customer", "driver"] as const;
    for (let index = 0; index < parties.length; index += 1) {
      await propose(deps, thread.id, parties[index]!, 4000 + index * 100, index);
    }
    const result = await rejectRound(
      deps,
      thread.id,
      5,
      { acting_party: "customer", close_thread: false },
      { idempotencyKey: key() },
    );

    // He asked to keep it open, but there is nothing left to answer. The reason names the
    // budget and not the clock, so the funnel does not blame time for a spent budget.
    expect(result.threadClosed).toBe(true);
    expect(result.thread.state).toBe("declined");
    expect(result.thread.closeReasonCode).toBe("max_rounds_reached");
  });

  it("refuses an unknown round number", async () => {
    const { deps, thread } = await withOpenThread();
    await expectCode(
      rejectRound(
        deps,
        thread.id,
        7,
        { acting_party: "customer", close_thread: false },
        { idempotencyKey: key() },
      ),
      "NEGOTIATION_ROUND_NOT_FOUND",
    );
  });
});
