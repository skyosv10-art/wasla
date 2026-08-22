/**
 * The tick: what time does to negotiations, driven by a clock the test moves.
 *
 * Not one `sleep` in this file. Every deadline is evaluated against the injected clock,
 * which is the only reason a suite covering a 900-second thread TTL can run in
 * milliseconds — and therefore the only reason it will still be here in a year.
 */

import { describe, expect, it } from "vitest";

import { acceptRound } from "../use-cases/accept-round.js";
import { cancelThread } from "../use-cases/cancel-thread.js";
import { proposeRound } from "../use-cases/propose-round.js";
import { runTick } from "../use-cases/run-tick.js";
import { expectCode, key, withOpenThread } from "./helpers.js";

async function withPendingRound() {
  const { deps, thread } = await withOpenThread();
  const { round } = await proposeRound(
    deps,
    thread.id,
    { proposed_by: "driver", amount_minor: 4000, currency: "SAR", expected_round_no: 0 },
    { idempotencyKey: key("prop") },
  );
  return { deps, thread, round };
}

describe("runTick", () => {
  it("does nothing and says so when nothing is due", async () => {
    const { deps } = await withPendingRound();
    const result = await runTick(deps);
    expect(result).toMatchObject({
      roundsExpired: 0,
      threadsExpired: 0,
      threadsClosedMaxRounds: 0,
      handoffsAttempted: 0,
      handoffFailures: 0,
    });
    expect(result.tickedAt).toBe("2026-08-23T00:00:00.000Z");
  });

  it("expires a lapsed round, dating the event to the deadline and not to the sweep", async () => {
    const { deps, thread, round } = await withPendingRound();
    // The sweep runs late — an hour late, as it would after an outage.
    deps.clock.set("2026-08-23T01:00:00.000Z");
    const result = await runTick(deps);

    expect(result.roundsExpired).toBe(1);
    const expired = await deps.rounds.find(thread.id, 1);
    expect(expired?.state).toBe("expired");
    // Nobody resolved it; time did. Naming a party would record a refusal that never
    // happened (`ck_negotiation_rounds_state_timestamp`).
    expect(expired?.resolvedBy).toBeNull();

    const [event] = deps.outbox.ofType("negotiations.round_expired");
    expect(event?.data.occurred_for).toBe(round.expiresAt);
    expect(event?.occurred_at).toBe("2026-08-23T01:00:00.000Z");
  });

  it("is idempotent — a second run finds nothing left to do", async () => {
    const { deps } = await withPendingRound();
    deps.clock.advanceSeconds(200);
    const first = await runTick(deps);
    const second = await runTick(deps);
    expect(first.roundsExpired).toBe(1);
    // This is what lets a scheduler retry without coordination.
    expect(second.roundsExpired).toBe(0);
    expect(second.threadsExpired).toBe(0);
  });

  it("does not refund an expired round against the budget", async () => {
    const { deps, thread } = await withPendingRound();
    deps.clock.advanceSeconds(200);
    await runTick(deps);
    const after = await deps.threads.find(thread.id);
    // The round consumed the counterparty's attention for its whole TTL. A refund would
    // make `max_rounds` a limit on patience rather than on turns.
    expect(after?.roundCount).toBe(1);
    expect(after?.currentRoundNo).toBe(1);
    expect(after?.state).toBe("open");
  });

  it("lets the other party propose once a stale round has lapsed", async () => {
    const { deps, thread } = await withPendingRound();
    deps.clock.advanceSeconds(200);
    const { round } = await proposeRound(
      deps,
      thread.id,
      { proposed_by: "customer", amount_minor: 3600, currency: "SAR", expected_round_no: 1 },
      { idempotencyKey: key("prop") },
    );
    // Round 1 was expired on the way in rather than left blocking the turn.
    expect(round.roundNo).toBe(2);
    expect((await deps.rounds.find(thread.id, 1))?.state).toBe("expired");
  });

  it("closes a thread whose own deadline has passed", async () => {
    const { deps, thread } = await withPendingRound();
    deps.clock.set("2026-08-23T00:20:00.000Z");
    const result = await runTick(deps);

    expect(result.roundsExpired).toBe(1);
    expect(result.threadsExpired).toBe(1);
    const closed = await deps.threads.find(thread.id);
    expect(closed?.state).toBe("expired");
    expect(closed?.closeReasonCode).toBe("thread_expired");
    // A finished negotiation waits for nothing, and the sweep's partial index must not
    // grow forever.
    expect(closed?.nextTickAt).toBeNull();

    const [event] = deps.outbox.ofType("negotiations.thread_closed");
    expect(event?.data.occurred_for).toBe(thread.expiresAt);
  });

  it("blames the budget, not the clock, when rounds run out", async () => {
    const { deps, thread } = await withOpenThread();
    const parties = ["driver", "customer", "driver", "customer", "driver"] as const;
    for (let index = 0; index < parties.length; index += 1) {
      await proposeRound(
        deps,
        thread.id,
        {
          proposed_by: parties[index]!,
          amount_minor: 4000 + index * 100,
          currency: "SAR",
          expected_round_no: index,
        },
        { idempotencyKey: key("prop") },
      );
    }
    // The fifth round lapses. Nothing is pending and the budget is spent.
    deps.clock.advanceSeconds(200);
    const result = await runTick(deps);

    expect(result.roundsExpired).toBe(1);
    expect(result.threadsClosedMaxRounds).toBe(1);
    const closed = await deps.threads.find(thread.id);
    expect(closed?.state).toBe("declined");
    // Not `thread_expired`: the negotiation ran out of turns, and a funnel that read this
    // as a timeout would go looking for a latency problem.
    expect(closed?.closeReasonCode).toBe("max_rounds_reached");
  });

  it("leaves an agreed thread alone", async () => {
    const { deps, thread } = await withPendingRound();
    await acceptRound(deps, thread.id, 1, { acting_party: "customer" }, { idempotencyKey: key("a") });
    deps.clock.set("2026-08-23T02:00:00.000Z");
    const result = await runTick(deps);

    expect(result.threadsExpired).toBe(0);
    expect(result.roundsExpired).toBe(0);
    expect((await deps.threads.find(thread.id))?.state).toBe("agreed");
  });

  it("expires the pending round when the thread is cancelled, without calling it a refusal", async () => {
    const { deps, thread } = await withPendingRound();
    const result = await cancelThread(
      deps,
      thread.id,
      { reason_code: "cancelled_by_dispatch" },
      { idempotencyKey: key("c") },
    );

    expect(result.thread.state).toBe("cancelled");
    expect(result.thread.closeReasonCode).toBe("cancelled_by_dispatch");
    const round = await deps.rounds.find(thread.id, 1);
    // The round is settled so it cannot read as «still awaiting an answer» forever, and
    // no party is recorded as having refused anything.
    expect(round?.state).toBe("expired");
    expect(round?.resolvedBy).toBeNull();
  });

  it("refuses to cancel a thread that already agreed", async () => {
    const { deps, thread } = await withPendingRound();
    await acceptRound(deps, thread.id, 1, { acting_party: "customer" }, { idempotencyKey: key("a") });
    // Withdrawing the order is the order engine's business; it is not a retroactive edit
    // of what two people settled on.
    await expectCode(
      cancelThread(deps, thread.id, { reason_code: "order_withdrawn" }, { idempotencyKey: key() }),
      "NEGOTIATION_ALREADY_AGREED",
    );
  });

  it("refuses a cancel reason that belongs to a rejection", async () => {
    const { deps, thread } = await withPendingRound();
    await expectCode(
      cancelThread(deps, thread.id, { reason_code: "declined_by_driver" }, { idempotencyKey: key() }),
      "NEGOTIATION_VALIDATION_FAILED",
    );
  });

  it("replays an identical cancel", async () => {
    const { deps, thread } = await withPendingRound();
    const shared = key("c-replay");
    await cancelThread(deps, thread.id, { reason_code: "order_withdrawn" }, { idempotencyKey: shared });
    const second = await cancelThread(
      deps,
      thread.id,
      { reason_code: "order_withdrawn" },
      { idempotencyKey: shared },
    );
    expect(second.replay).toBe(true);
    expect(deps.outbox.ofType("negotiations.thread_closed")).toHaveLength(1);
  });

  it("keeps its batch bounded", async () => {
    const { deps } = await withPendingRound();
    deps.clock.advanceSeconds(200);
    // An unbounded sweep is a request whose duration grows with the platform, and the
    // first time it exceeds the scheduler's timeout it stops running — silently.
    const result = await runTick(deps, { limit: 1 });
    expect(result.roundsExpired).toBe(1);
  });
});
