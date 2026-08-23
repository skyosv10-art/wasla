/**
 * PHASE 08 EXIT GATE — negotiations × the order engine × dispatch × the customer core.
 *
 * ROADMAP §3 closes this phase on one sentence: **two parties negotiate a price over
 * real HTTP, agree on it, and the ORDER ENGINE ends up holding that number — and the
 * agreement survives when the engine does not.** Every assertion below is a piece of
 * that sentence, and none of it is checked from inside a process:
 *
 *   - nothing is read from a store, and no row is hand-built. The order was created by a
 *     customer through the Customer Core, the offer was produced by a real dispatch wave,
 *     the thread was opened on that offer, and the price is verified with
 *     `GET /orders/lookup` — the same route every other service would use;
 *   - time moves only when a test moves the injected clock and calls a tick explicitly.
 *     There is no `sleep` in this file;
 *   - negotiations' two outbound ports come from the production wiring functions, so a
 *     green run says the deployed composition works, not that a composition written here
 *     works.
 *
 * The four scenarios HANDOFF §14 requires, in order:
 *
 *   1. **Happy path** — intake → wave → offer → thread → round → accept → the engine
 *      holds the agreed price, keyed to the negotiation.
 *   2. **Replay** — the same `Idempotency-Key` twice on accept: one agreement, one price,
 *      one hand-off attempt. `201` then `200`.
 *   3. **Terminal rejection** — two live offers on one order, two agreements. The engine
 *      accepts the first and REFUSES the second; the second agreement stays valid,
 *      `handoff_state = rejected`, accept still answered `201`, and no `502` anywhere.
 *   4. **The engine is unreachable** — accept while the engine is down: `201`, agreement
 *      `pending` with a retry moment; then the engine comes back, the clock crosses the
 *      backoff, one tick, and the price is delivered.
 *
 * Two guards ride along because the gate found them: a thread cannot be opened on a
 * `customer_offer` order (proving `negotiable` is read from the engine's `price_mode`
 * rather than assumed), and `/health` reports which store this run actually used.
 *
 * Reasoning, findings, and the declared deviations: docs/12-testing/PHASE08_EXIT_GATE_E2E.md.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acceptRound,
  callNegotiations,
  lookupOrder,
  MAX_ROUNDS,
  negotiationTick,
  nextKey,
  openThread,
  openThreadOrThrow,
  orderWithOffers,
  POLICY_CURRENCY,
  proposeRound,
  readAgreement,
  readRounds,
  readThread,
  startGate,
  type GateContext,
} from "../harness.js";

/** Two drivers, so the wave can produce two offers on one order when a test needs it. */
const DRIVER_A = "WS-0700000001";
const DRIVER_B = "WS-0700000002";

/** The amount the two parties settle on, in minor units — 55.00 SAR. */
const AGREED_MINOR = 5500;

let gate: GateContext;

beforeEach(async () => {
  gate = await startGate();
});

afterEach(async () => {
  await gate.close();
});

/**
 * Drive one thread to an accepted agreement over HTTP and nothing else.
 *
 * The driver proposes round 1 and the customer accepts it, because the counterparty is
 * the only party allowed to accept (`assertMayPropose` + self-accept refusal). The
 * accept's idempotency key is returned so the replay scenario can send the exact same one.
 */
async function agreeOnce(
  order: Awaited<ReturnType<typeof orderWithOffers>>["order"],
  offer: Awaited<ReturnType<typeof orderWithOffers>>["offers"][number],
  amountMinor = AGREED_MINOR,
): Promise<{ threadId: string; acceptKey: string; accepted: Record<string, unknown> }> {
  const thread = await openThreadOrThrow(gate, order, offer);
  const threadId = thread.id as string;

  const proposed = await proposeRound(gate, threadId, {
    proposedBy: "driver",
    amountMinor,
    expectedRoundNo: 0,
  });
  expect(proposed.status).toBe(201);
  expect(proposed.body.round_no).toBe(1);

  const acceptKey = nextKey("gate-accept");
  const accepted = await acceptRound(gate, threadId, 1, "customer", acceptKey);
  expect(accepted.status).toBe(201);
  return { threadId, acceptKey, accepted: accepted.body };
}

describe("Phase 08 exit gate · the price crosses four services", () => {
  it("declares which store it ran against, and answers /health from it", async () => {
    const health = await callNegotiations(gate, { method: "GET", path: "/health" });

    expect(health.status).toBe(200);
    // The check is `persistence`, not `ok`: a suite that cannot say WHICH store it
    // proved has not proved the one CI cares about. The value comes from the app, and
    // the harness derived the same value from the environment — they must agree, or the
    // run is reporting a composition it did not build.
    expect(health.body.persistence).toBe(gate.persistence);
  });

  // -- Scenario 1 ------------------------------------------------------------
  it("scenario 1 · happy path: intake → wave → thread → accept → the engine holds the price", async () => {
    const { order, offers } = await orderWithOffers(gate, [DRIVER_A]);
    const offer = offers[0]!;

    // The order starts with NO price. Asserted, not assumed: if intake had smuggled one
    // in, the rest of this scenario would be verifying a number nobody negotiated.
    const before = await lookupOrder(gate, order.orderPublicId);
    expect(before.price_mode).toBe("negotiable");
    expect(before.agreed_price).toBeNull();
    expect(before.agreed_negotiation_id).toBeNull();

    const { threadId, accepted } = await agreeOnce(order, offer);

    // The agreement, as the accepting party was told about it.
    expect(accepted.thread_id).toBe(threadId);
    expect(accepted.order_public_id).toBe(order.orderPublicId);
    expect(accepted.driver_public_id).toBe(offer.driverPublicId);
    expect(accepted.round_no).toBe(1);
    expect(accepted.amount_minor).toBe(AGREED_MINOR);
    expect(accepted.currency).toBe(POLICY_CURRENCY);
    expect(accepted.accepted_by).toBe("customer");
    // Handed off inside the accept, because the engine was reachable. `handed_off` here
    // and not `pending` is the whole difference between this scenario and scenario 4.
    expect(accepted.handoff_state).toBe("handed_off");
    expect(accepted.handoff_attempts).toBe(1);
    expect(accepted.handed_off_at).toEqual(expect.any(String));
    expect(accepted.next_handoff_at).toBeNull();
    expect(accepted.last_error_code).toBeNull();

    // The thread agrees with the agreement.
    const thread = await readThread(gate, threadId);
    expect(thread.state).toBe("agreed");
    expect(thread.agreed_round_no).toBe(1);
    expect(thread.round_count).toBe(1);

    // THE GATE'S QUESTION. Answered by the engine's own service-facing route.
    const after = await lookupOrder(gate, order.orderPublicId);
    expect(after.agreed_price).toEqual({ amount_minor: AGREED_MINOR, currency: POLICY_CURRENCY });
    expect(after.agreed_negotiation_id).toBe(threadId);
    expect(after.agreed_at).toEqual(expect.any(String));
    // Recording a price is not a lifecycle move (ADR-013): the order is still where
    // dispatch left it. A gate that let the status drift here would have hidden a
    // negotiation service quietly driving the engine's state machine.
    expect(after.status).toBe(before.status);
    expect(after.price_mode).toBe("negotiable");
  });

  it("scenario 1b · the negotiated number is the one both parties last saw, after a counter", async () => {
    const { order, offers } = await orderWithOffers(gate, [DRIVER_A]);
    const offer = offers[0]!;
    const thread = await openThreadOrThrow(gate, order, offer);
    const threadId = thread.id as string;

    // Opening creates NO round: the opening amount is context, not an offer on the table.
    expect(thread.round_count).toBe(0);
    // `0`, not `null`: the counter is «how many rounds has this thread reached», and a
    // thread that has reached none has reached zero. Learned here — the earlier
    // expectation of `null` was this suite's assumption, not the contract's.
    expect(thread.current_round_no).toBe(0);
    expect(await readRounds(gate, threadId)).toHaveLength(0);

    // Round 1 by the customer, round 2 as the driver's counter, then the customer accepts
    // the counter. Turn-taking is the service's rule; the gate only has to respect it.
    expect((await proposeRound(gate, threadId, { proposedBy: "customer", amountMinor: 4000, expectedRoundNo: 0 })).status).toBe(201);
    const counter = await proposeRound(gate, threadId, {
      proposedBy: "driver",
      amountMinor: 6200,
      expectedRoundNo: 1,
    });
    expect(counter.status).toBe(201);
    expect(counter.body.round_no).toBe(2);

    const accepted = await acceptRound(gate, threadId, 2, "customer", nextKey("gate-accept"));
    expect(accepted.status).toBe(201);
    expect(accepted.body.amount_minor).toBe(6200);
    expect(accepted.body.round_no).toBe(2);

    // The engine holds 6200 — the counter — and never 4000. The check that would catch a
    // service handing over the FIRST amount it ever saw instead of the accepted one.
    const looked = await lookupOrder(gate, order.orderPublicId);
    expect(looked.agreed_price).toEqual({ amount_minor: 6200, currency: POLICY_CURRENCY });

    const rounds = await readRounds(gate, threadId);
    expect(rounds.map((round) => round.round_no)).toEqual([1, 2]);
    expect(rounds).toHaveLength(2);
    expect(MAX_ROUNDS).toBeGreaterThan(2);
  });

  // -- Scenario 2 ------------------------------------------------------------
  it("scenario 2 · the same accept key twice: one agreement, one price, one hand-off", async () => {
    const { order, offers } = await orderWithOffers(gate, [DRIVER_A]);
    const { threadId, acceptKey, accepted } = await agreeOnce(order, offers[0]!);

    // The same key, the same body, as a retrying bot or a re-delivered webhook sends it.
    const replay = await acceptRound(gate, threadId, 1, "customer", acceptKey);

    // `200`, not `201`: the second call created nothing.
    expect(replay.status).toBe(200);
    // Byte-for-byte the same agreement, `handoff_attempts` included. A replay that
    // re-attempted the hand-off would show 2 here — and would have written to the order
    // engine twice for one agreement.
    expect(replay.body).toEqual(accepted);
    expect(replay.body.handoff_attempts).toBe(1);

    const agreement = await readAgreement(gate, threadId);
    expect(agreement.amount_minor).toBe(AGREED_MINOR);
    expect(agreement.handoff_attempts).toBe(1);

    // One thread on this order, one agreement, one price.
    const listed = await callNegotiations(gate, {
      method: "GET",
      path: `/negotiations?orderPublicId=${encodeURIComponent(order.orderPublicId)}`,
    });
    expect(listed.status).toBe(200);
    expect((listed.body.threads as unknown[]).length).toBe(1);

    const looked = await lookupOrder(gate, order.orderPublicId);
    expect(looked.agreed_price).toEqual({ amount_minor: AGREED_MINOR, currency: POLICY_CURRENCY });
    expect(looked.agreed_negotiation_id).toBe(threadId);

    // And a THIRD call, after a tick, still changes nothing. The tick sweeps agreements
    // that need a hand-off; a `handed_off` one is not one of them, and a tick that
    // re-delivered it would overwrite the engine's price with the same call it already
    // answered — the failure `negotiation-{threadId}` as the idempotency key prevents.
    const ticked = await negotiationTick(gate);
    expect(ticked.status).toBe(200);
    expect(ticked.body.handoffs_attempted).toBe(0);
    expect((await readAgreement(gate, threadId)).handoff_attempts).toBe(1);
  });

  // -- Scenario 3 ------------------------------------------------------------
  it("scenario 3 · the engine refuses the second agreement, and the agreement survives it", async () => {
    // Two drivers and `waveSize: 2` produce two live offers on ONE order, which is the
    // only way to reach this state over public HTTP: two threads, both legitimate, both
    // agreed — and one order that can hold exactly one price.
    const { order, offers } = await orderWithOffers(gate, [DRIVER_A, DRIVER_B]);
    expect(offers).toHaveLength(2);

    const first = await agreeOnce(order, offers[0]!, AGREED_MINOR);
    expect(first.accepted.handoff_state).toBe("handed_off");

    // The second thread agrees on a DIFFERENT amount, so the engine's refusal is a
    // decision about a conflicting price and not an idempotent replay of the same one.
    const second = await agreeOnce(order, offers[1]!, AGREED_MINOR + 700);

    // The accept is still `201`. This is the invariant ADR-013 decision 2 exists for:
    // two people agreed, and a refusal downstream has no standing to retract that. A
    // `502`/`bad_gateway` here would tell a driver already on his way there was no deal.
    expect(second.accepted.handoff_state).toBe("rejected");
    expect(second.accepted.amount_minor).toBe(AGREED_MINOR + 700);
    // Named by the engine, carried through verbatim — `ORDER_AGREED_PRICE_ALREADY_SET`
    // is the engine's code, not a code negotiations invented for «it did not work».
    expect(second.accepted.last_error_code).toBe("ORDER_AGREED_PRICE_ALREADY_SET");
    // Terminal: a decision is not retried. No retry moment, and nothing handed off.
    expect(second.accepted.next_handoff_at).toBeNull();
    expect(second.accepted.handed_off_at).toBeNull();
    expect(second.accepted.handoff_attempts).toBe(1);

    // The second agreement is still readable and still says what the two parties agreed.
    const rejectedAgreement = await readAgreement(gate, second.threadId);
    expect(rejectedAgreement.amount_minor).toBe(AGREED_MINOR + 700);
    expect(rejectedAgreement.handoff_state).toBe("rejected");
    const secondThread = await readThread(gate, second.threadId);
    expect(secondThread.state).toBe("agreed");
    // `agreed` — the thread closed BECAUSE the parties agreed, and the engine's refusal
    // did not rewrite that reason. A `handoff_failed` reason here would be the service
    // telling the two parties their own agreement was the thing that failed.
    expect(secondThread.close_reason_code).toBe("agreed");

    // A tick does not reopen a decision. `rejected` is terminal, so the sweep must not
    // pick it up — otherwise the engine gets asked the same question five times.
    const ticked = await negotiationTick(gate);
    expect(ticked.status).toBe(200);
    expect(ticked.body.handoffs_attempted).toBe(0);

    // And the engine still holds the FIRST price, untouched by the second agreement.
    const looked = await lookupOrder(gate, order.orderPublicId);
    expect(looked.agreed_price).toEqual({ amount_minor: AGREED_MINOR, currency: POLICY_CURRENCY });
    expect(looked.agreed_negotiation_id).toBe(first.threadId);
  });

  // -- Scenario 4 ------------------------------------------------------------
  it("scenario 4 · the engine is down at accept time: pending with a retry moment, then delivered", async () => {
    const { order, offers } = await orderWithOffers(gate, [DRIVER_A]);
    const offer = offers[0]!;

    // The thread is opened while the engine is still up, because opening READS the
    // engine (`price_mode` lives there) and a closed door there is a different failure —
    // `503 NEGOTIATION_UNAVAILABLE`, which is the honest answer when nothing is known.
    const thread = await openThreadOrThrow(gate, order, offer);
    const threadId = thread.id as string;
    expect((await proposeRound(gate, threadId, { proposedBy: "driver", amountMinor: AGREED_MINOR, expectedRoundNo: 0 })).status).toBe(201);

    // Now the engine goes away. Its stores survive, so what this reproduces is a
    // restart — the listener is gone, the orders are not.
    await gate.stopOrderEngine();

    const accepted = await acceptRound(gate, threadId, 1, "customer", nextKey("gate-accept"));

    // `201`, and the agreement exists. Not `502`, not `503`: the agreement did not
    // depend on the engine being up, and the caller is not told otherwise.
    expect(accepted.status).toBe(201);
    expect(accepted.body.amount_minor).toBe(AGREED_MINOR);
    expect(accepted.body.handoff_state).toBe("pending");
    expect(accepted.body.handoff_attempts).toBe(1);
    expect(accepted.body.handed_off_at).toBeNull();
    expect(accepted.body.last_error_code).toBe("HANDOFF_TRANSPORT_ERROR");
    // A retry MOMENT, not a promise: 30s after the first failure (`30 * 2^(n-1)`).
    const nextHandoffAt = accepted.body.next_handoff_at as string;
    expect(nextHandoffAt).toEqual(expect.any(String));
    expect(Date.parse(nextHandoffAt)).toBe(Date.parse(gate.clock.now()) + 30_000);

    // A tick BEFORE that moment must do nothing. Otherwise the backoff is decoration and
    // a downstream outage becomes a retry storm.
    const early = await negotiationTick(gate);
    expect(early.body.handoffs_attempted).toBe(0);
    expect((await readAgreement(gate, threadId)).handoff_state).toBe("pending");

    // The engine comes back on the same address, and time crosses the backoff. The clock
    // moves; nothing sleeps.
    await gate.startOrderEngine();
    gate.clock.advanceSeconds(30);

    const ticked = await negotiationTick(gate);
    expect(ticked.status).toBe(200);
    expect(ticked.body.handoffs_attempted).toBe(1);
    expect(ticked.body.handoffs_succeeded).toBe(1);
    expect(ticked.body.handoff_failures).toBe(0);

    const delivered = await readAgreement(gate, threadId);
    expect(delivered.handoff_state).toBe("handed_off");
    expect(delivered.handoff_attempts).toBe(2);
    expect(delivered.handed_off_at).toEqual(expect.any(String));
    expect(delivered.next_handoff_at).toBeNull();
    expect(delivered.last_error_code).toBeNull();

    // And the price the two parties agreed on before the outage is the price the engine
    // holds after it — same order, same number, keyed to the same negotiation.
    const looked = await lookupOrder(gate, order.orderPublicId);
    expect(looked.agreed_price).toEqual({ amount_minor: AGREED_MINOR, currency: POLICY_CURRENCY });
    expect(looked.agreed_negotiation_id).toBe(threadId);
  });

  // -- The guard the gate discovered ---------------------------------------
  it("refuses to open a thread on a customer_offer order, reading price_mode from the engine", async () => {
    // A priced order, created the same way through the Customer Core. `customer_offer`
    // REQUIRES an amount, exactly as `negotiable` forbids one.
    const { order, offers } = await orderWithOffers(gate, [DRIVER_A], {
      price_mode: "customer_offer",
      offered_price: { amount_minor: 4500, currency: POLICY_CURRENCY },
    });

    const refused = await openThread(gate, order, offers[0]!);

    // `422`, and the code names the reason. This is the check that keeps `negotiable`
    // a fact READ from the order engine: dispatch's offer looks identical in both runs,
    // so the only thing that can produce this refusal is the engine's `price_mode`.
    expect(refused.status).toBe(422);
    // The envelope is `{ error: { code, … }, trace_id }` — the contract's shape, checked
    // through it rather than around it (`contracts/errors.md`: the consumer contracts on
    // `error.code`, never on the message text).
    expect((refused.body.error as Record<string, unknown>).code).toBe(
      "NEGOTIATION_ORDER_NOT_NEGOTIABLE",
    );
    expect(refused.body.trace_id).toEqual(expect.any(String));

    // No thread was created, and no price reached the order.
    const listed = await callNegotiations(gate, {
      method: "GET",
      path: `/negotiations?orderPublicId=${encodeURIComponent(order.orderPublicId)}`,
    });
    expect(listed.body.threads).toEqual([]);
    expect((await lookupOrder(gate, order.orderPublicId)).agreed_price).toBeNull();
  });
});

describe("Phase 08 exit gate · the wiring itself", () => {
  it("answers 503 NEGOTIATION_UNAVAILABLE when ORDERS_SERVICE_URL is not configured", async () => {
    // Its own gate, wired the way a half-configured deployment is wired: this is the
    // ONLY way to reach the refusing ports without writing a port here. What is being
    // proved is that `configuredDispatchOffers` returns a refuser rather than a stub
    // that quietly succeeds — a missing environment variable must be a loud 503, never
    // a negotiation over facts nobody verified.
    const unwired = await startGate({ withoutOrdersUrl: true });
    try {
      // The order and the offer still need a reachable engine, so they are built through
      // the FIRST gate; only the negotiation service under test is half-wired.
      const { order, offers } = await orderWithOffers(gate, [DRIVER_A]);
      const refused = await callNegotiations(unwired, {
        method: "POST",
        path: "/negotiations",
        idempotencyKey: nextKey("gate-unwired"),
        body: {
          order_public_id: order.orderPublicId,
          customer_public_id: order.customerPublicId,
          driver_public_id: offers[0]!.driverPublicId,
          dispatch_offer_id: offers[0]!.offerId,
          service_kind: "ride",
          opening_amount_minor: AGREED_MINOR,
          currency: POLICY_CURRENCY,
          opened_by: "customer",
          opening_note: null,
          source_locale: "ar",
        },
      });

      // `503`, not `422`: nothing is KNOWN about the offer, and an unprocessable answer
      // would have claimed a fact was checked and refused. The distinction is the one
      // the port's header draws — `null` means «looked, not there», a throw means
      // «could not look».
      expect(refused.status).toBe(503);
      expect((refused.body.error as Record<string, unknown>).code).toBe(
        "NEGOTIATION_UNAVAILABLE",
      );
    } finally {
      await unwired.close();
    }
  });
});
