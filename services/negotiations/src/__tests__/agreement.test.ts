/**
 * The agreement, and the price hand-off that must never be able to undo it.
 *
 * The most important assertion in this file is the negative one: when the order engine
 * is unreachable, the accept still **succeeds**, the agreement still exists, and no
 * `502` and no `bad_gateway` class appears anywhere (ADR-013 decision 2). A regression
 * there would tell two people who agreed that they did not, while one of them is
 * already driving.
 */

import { describe, expect, it } from "vitest";

import { NEGOTIATION_ERROR_CODES } from "@wasla/contracts-negotiation";

import { MAX_HANDOFF_ATTEMPTS, handoffBackoffSeconds } from "../use-cases/handoff.js";
import { acceptRound } from "../use-cases/accept-round.js";
import { proposeRound } from "../use-cases/propose-round.js";
import { runTick } from "../use-cases/run-tick.js";
import { readAgreement } from "../use-cases/read-negotiation.js";
import { expectCode, key, withOpenThread } from "./helpers.js";

async function arrangePendingRound() {
  const { deps, thread } = await withOpenThread();
  const { round } = await proposeRound(
    deps,
    thread.id,
    {
      proposed_by: "driver",
      amount_minor: 4000,
      currency: "SAR",
      expected_round_no: 0,
    },
    { idempotencyKey: key("prop") },
  );
  return { deps, thread, round };
}

describe("acceptRound", () => {
  it("agrees the thread, names the round, and writes the agreement", async () => {
    const { deps, thread } = await arrangePendingRound();
    const result = await acceptRound(
      deps,
      thread.id,
      1,
      { acting_party: "customer" },
      { idempotencyKey: key("acc") },
    );

    expect(result.thread.state).toBe("agreed");
    expect(result.thread.closeReasonCode).toBe("agreed");
    // The agreed round is NAMED. «He accepted» is not an answer to «accepted what», and a
    // fare dispute is exactly where that question is asked.
    expect(result.thread.agreedRoundNo).toBe(1);
    expect(result.thread.nextTickAt).toBeNull();
    expect(result.round.state).toBe("accepted");
    expect(result.round.resolvedBy).toBe("customer");
    expect(result.agreement.amountMinor).toBe(4000);
    expect(result.agreement.currency).toBe("SAR");
    expect(result.agreement.roundNo).toBe(1);
    expect(result.agreement.policyVersion).toBe(1);
  });

  it("refuses the proposer accepting his own offer", async () => {
    const { deps, thread } = await arrangePendingRound();
    const error = await expectCode(
      acceptRound(deps, thread.id, 1, { acting_party: "driver" }, { idempotencyKey: key() }),
      "NEGOTIATION_SELF_ACCEPT_FORBIDDEN",
    );
    // The DDL is the second line of defence, and the error says where to find it.
    expect(error.details?.constraint).toBe("ck_negotiation_rounds_no_self_resolution");
  });

  it("tells a late second acceptance that it succeeded and it is late", async () => {
    const { deps, thread } = await arrangePendingRound();
    await acceptRound(
      deps,
      thread.id,
      1,
      { acting_party: "customer" },
      { idempotencyKey: key("acc") },
    );
    // A different key, so this is a genuine second request and not a replay.
    await expectCode(
      acceptRound(deps, thread.id, 1, { acting_party: "customer" }, { idempotencyKey: key() }),
      "NEGOTIATION_ALREADY_AGREED",
    );
  });

  it("replays an identical accept without a second hand-off", async () => {
    const { deps, thread } = await arrangePendingRound();
    const shared = key("replay");
    const first = await acceptRound(
      deps,
      thread.id,
      1,
      { acting_party: "customer" },
      { idempotencyKey: shared },
    );
    const second = await acceptRound(
      deps,
      thread.id,
      1,
      { acting_party: "customer" },
      { idempotencyKey: shared },
    );

    expect(second.replay).toBe(true);
    expect(second.agreement.threadId).toBe(first.agreement.threadId);
    // One agreement, one price leaving the service. A duplicate attempt would be a second
    // write to the order engine for a single agreement.
    expect(deps.agreedPrice.calls).toHaveLength(1);
    expect(deps.outbox.ofType("negotiations.agreed")).toHaveLength(1);
  });

  it("refuses an acceptance that arrives after the round deadline", async () => {
    const { deps, thread } = await arrangePendingRound();
    deps.clock.advanceSeconds(121);
    await expectCode(
      acceptRound(deps, thread.id, 1, { acting_party: "customer" }, { idempotencyKey: key() }),
      "NEGOTIATION_ROUND_EXPIRED",
    );
    // Expired on the way out, so the row tells the truth rather than staying `pending`
    // until some later sweep notices.
    expect((await deps.rounds.find(thread.id, 1))?.state).toBe("expired");
  });

  it("refuses an acceptance that arrives after the thread deadline, and closes the thread", async () => {
    const { deps, thread } = await arrangePendingRound();
    deps.clock.set("2026-08-23T00:16:00.000Z");
    await expectCode(
      acceptRound(deps, thread.id, 1, { acting_party: "customer" }, { idempotencyKey: key() }),
      "NEGOTIATION_THREAD_EXPIRED",
    );
    const closed = await deps.threads.find(thread.id);
    expect(closed?.state).toBe("expired");
    expect(closed?.closeReasonCode).toBe("thread_expired");
    // `occurred_for` is when the deadline passed, not when we noticed.
    const [event] = deps.outbox.ofType("negotiations.thread_closed");
    expect(event?.data.occurred_for).toBe(thread.expiresAt);
  });
});

describe("price hand-off", () => {
  it("hands the price off on acceptance and records it", async () => {
    const { deps, thread } = await arrangePendingRound();
    const result = await acceptRound(
      deps,
      thread.id,
      1,
      { acting_party: "customer" },
      { idempotencyKey: key("acc") },
    );

    expect(result.agreement.handoffState).toBe("handed_off");
    expect(result.agreement.handedOffAt).not.toBeNull();
    expect(result.agreement.nextHandoffAt).toBeNull();
    expect(deps.agreedPrice.calls[0]?.amountMinor).toBe(4000);
    expect(deps.outbox.ofType("negotiations.agreed_price_handed_off")).toHaveLength(1);

    const attempts = await deps.handoffs.list(thread.id);
    // The attempt row exists with its outcome filled in — written BEFORE the call, so an
    // attempt that crashed mid-flight would survive as `outcome: null`.
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe("accepted");
    expect(attempts[0]?.attemptNo).toBe(1);
  });

  it("keeps the agreement when the order engine is unreachable, and schedules a retry", async () => {
    const { deps, thread } = await arrangePendingRound();
    deps.agreedPrice.mode = "throw";
    const result = await acceptRound(
      deps,
      thread.id,
      1,
      { acting_party: "customer" },
      { idempotencyKey: key("acc") },
    );

    // The accept SUCCEEDED. This is the rule the whole file exists for.
    expect(result.thread.state).toBe("agreed");
    expect(result.agreement.amountMinor).toBe(4000);
    expect(result.agreement.handoffState).toBe("pending");
    expect(result.agreement.handoffAttempts).toBe(1);
    expect(result.agreement.lastErrorCode).toBe("HANDOFF_TRANSPORT_ERROR");
    expect(result.agreement.nextHandoffAt).toBe("2026-08-23T00:00:30.000Z");
    expect(result.handoff?.retryScheduled).toBe(true);

    const [failure] = deps.outbox.ofType("negotiations.price_handoff_failed");
    expect(failure?.data.outcome).toBe("unavailable");
    expect(failure?.data.retry_scheduled).toBe(true);
    // The agreement itself is still announced.
    expect(deps.outbox.ofType("negotiations.agreed")).toHaveLength(1);
  });

  it("publishes no error code for a failed hand-off — there is no bad_gateway class", async () => {
    // Asserted against the published catalogue rather than against a comment: the moment
    // somebody adds a `NEGOTIATION_PRICE_HANDOFF_FAILED` code, this test says why not.
    const codes = NEGOTIATION_ERROR_CODES as readonly string[];
    expect(codes.some((code) => code.includes("HANDOFF"))).toBe(false);
    expect(codes.some((code) => code.includes("GATEWAY"))).toBe(false);
  });

  it("treats a refusal by the order engine as terminal and never retries it", async () => {
    const { deps, thread } = await arrangePendingRound();
    deps.agreedPrice.mode = "reject";
    const result = await acceptRound(
      deps,
      thread.id,
      1,
      { acting_party: "customer" },
      { idempotencyKey: key("acc") },
    );

    expect(result.agreement.handoffState).toBe("rejected");
    // Terminal: retrying a decision just asks the same question until someone notices the
    // traffic. `ck_negotiation_agreements_terminal_no_retry` forbids the retry moment.
    expect(result.agreement.nextHandoffAt).toBeNull();
    expect(result.agreement.lastErrorCode).toBe("ORDER_NOT_ACCEPTING_PRICE");

    const tick = await runTick(deps);
    expect(tick.handoffsAttempted).toBe(0);
    expect(deps.agreedPrice.calls).toHaveLength(1);
  });

  it("retries with doubling backoff and abandons after the attempt cap", async () => {
    const { deps, thread } = await arrangePendingRound();
    deps.agreedPrice.mode = "throw";
    await acceptRound(
      deps,
      thread.id,
      1,
      { acting_party: "customer" },
      { idempotencyKey: key("acc") },
    );

    for (let attempt = 2; attempt <= MAX_HANDOFF_ATTEMPTS; attempt += 1) {
      const agreement = await deps.agreements.find(thread.id);
      deps.clock.set(agreement!.nextHandoffAt!);
      const tick = await runTick(deps);
      expect(tick.handoffsAttempted).toBe(1);
      expect(tick.handoffFailures).toBe(1);
    }

    const abandoned = await deps.agreements.find(thread.id);
    // `abandoned` means «a human must look», not «it never happened»: the agreement, the
    // amount and the two parties are all still there.
    expect(abandoned?.handoffState).toBe("abandoned");
    expect(abandoned?.handoffAttempts).toBe(MAX_HANDOFF_ATTEMPTS);
    expect(abandoned?.nextHandoffAt).toBeNull();
    expect(abandoned?.amountMinor).toBe(4000);
    expect((await deps.threads.find(thread.id))?.state).toBe("agreed");
    // Every attempt is on record, not just the last one.
    expect(await deps.handoffs.list(thread.id)).toHaveLength(MAX_HANDOFF_ATTEMPTS);
  });

  it("recovers on a later tick once the order engine answers", async () => {
    const { deps, thread } = await arrangePendingRound();
    deps.agreedPrice.mode = "throw";
    await acceptRound(
      deps,
      thread.id,
      1,
      { acting_party: "customer" },
      { idempotencyKey: key("acc") },
    );

    deps.agreedPrice.mode = "accept";
    deps.clock.set((await deps.agreements.find(thread.id))!.nextHandoffAt!);
    const tick = await runTick(deps);

    expect(tick.handoffsSucceeded).toBe(1);
    const healed = await deps.agreements.find(thread.id);
    expect(healed?.handoffState).toBe("handed_off");
    expect(healed?.lastErrorCode).toBeNull();
  });

  it("doubles the backoff from thirty seconds", () => {
    expect(handoffBackoffSeconds(1)).toBe(30);
    expect(handoffBackoffSeconds(2)).toBe(60);
    expect(handoffBackoffSeconds(3)).toBe(120);
    expect(handoffBackoffSeconds(4)).toBe(240);
  });

  it("answers AGREEMENT_NOT_FOUND on an open thread and THREAD_NOT_FOUND on a bad id", async () => {
    const { deps, thread } = await arrangePendingRound();
    await expectCode(readAgreement(deps, thread.id), "NEGOTIATION_AGREEMENT_NOT_FOUND");
    await expectCode(
      readAgreement(deps, "99999999-9999-4999-8999-999999999999"),
      "NEGOTIATION_THREAD_NOT_FOUND",
    );
  });
});
