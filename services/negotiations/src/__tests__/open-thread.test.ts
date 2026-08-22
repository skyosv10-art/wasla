/**
 * Opening a thread: the shape checks, the offer checks, and the two uniqueness rules.
 *
 * The order of refusals is asserted, not just the refusals themselves — see
 * «shape before offer» below. A test that only checks each rule in isolation would pass
 * while a refactor moved the dispatch call in front of the validators, and the symptom
 * would be a `503` answering a malformed request.
 */

import { describe, expect, it } from "vitest";

import { openThread } from "../use-cases/open-thread.js";
import {
  CUSTOMER_ID,
  DRIVER_ID,
  OFFER_ID,
  ORDER_ID,
  START,
  expectCode,
  key,
  makeDeps,
  openInput,
} from "./helpers.js";

describe("openThread", () => {
  it("opens a thread with no rounds, the frozen policy, and a thread deadline", async () => {
    const deps = makeDeps();
    const { thread } = await openThread(deps, openInput() as never, { idempotencyKey: key() });

    expect(thread.state).toBe("open");
    expect(thread.policyVersion).toBe(1);
    // The opening amount is NOT round 1: making it one would spend a fifth of the round
    // budget before either party spoke, and would let the opener accept his own number.
    expect(thread.roundCount).toBe(0);
    expect(thread.currentRoundNo).toBe(0);
    expect(thread.agreedRoundNo).toBeNull();
    expect(thread.openingAmountMinor).toBe(3000);
    // thread_ttl_seconds = 900 from the frozen launch policy.
    expect(thread.expiresAt).toBe("2026-08-23T00:15:00.000Z");
    expect(thread.nextTickAt).toBe(thread.expiresAt);
    expect(thread.closedAt).toBeNull();
    expect(thread.closeReasonCode).toBeNull();
  });

  it("stores an opening note as a message and never as a thread column", async () => {
    const deps = makeDeps();
    const { thread, openingMessage } = await openThread(
      deps,
      openInput({ opening_note: "أستطيع الوصول بعد عشر دقائق" }) as never,
      { idempotencyKey: key() },
    );

    expect(openingMessage?.sequenceNo).toBe(1);
    expect(openingMessage?.authorRole).toBe("customer");
    expect(openingMessage?.body).toBe("أستطيع الوصول بعد عشر دقائق");
    expect(await deps.messages.count(thread.id)).toBe(1);
    // And the thread itself has no note field to store it in.
    expect(Object.keys(thread)).not.toContain("openingNote");
  });

  it("refuses a malformed order id before it ever calls dispatch", async () => {
    const deps = makeDeps();
    // Dispatch is down. A correctly ordered implementation never notices, because the
    // request is refused on shape first — the difference between a `400` the client can
    // fix and a `503` that teaches him to retry forever.
    deps.offers.unavailable = true;
    await expectCode(
      openThread(deps, openInput({ order_public_id: "ORD-1" }) as never, { idempotencyKey: key() }),
      "NEGOTIATION_VALIDATION_FAILED",
    );
  });

  it("answers 503 when dispatch cannot be reached, not 422", async () => {
    const deps = makeDeps();
    deps.offers.unavailable = true;
    const error = await expectCode(
      openThread(deps, openInput() as never, { idempotencyKey: key() }),
      "NEGOTIATION_UNAVAILABLE",
    );
    expect(error.code).toBe("NEGOTIATION_UNAVAILABLE");
  });

  it("refuses an unknown or inactive offer", async () => {
    const deps = makeDeps();
    await expectCode(
      openThread(
        deps,
        openInput({ dispatch_offer_id: "22222222-2222-4222-8222-222222222222" }) as never,
        { idempotencyKey: key() },
      ),
      "NEGOTIATION_OFFER_NOT_ACTIVE",
    );

    const stale = makeDeps();
    stale.offers.put({
      dispatchOfferId: OFFER_ID,
      orderPublicId: ORDER_ID,
      driverPublicId: DRIVER_ID,
      serviceKind: "ride",
      active: false,
      negotiable: true,
    });
    await expectCode(
      openThread(stale, openInput() as never, { idempotencyKey: key() }),
      "NEGOTIATION_OFFER_NOT_ACTIVE",
    );
  });

  it("refuses an order whose price mode does not allow negotiation", async () => {
    const deps = makeDeps();
    deps.offers.put({
      dispatchOfferId: OFFER_ID,
      orderPublicId: ORDER_ID,
      driverPublicId: DRIVER_ID,
      serviceKind: "ride",
      active: true,
      negotiable: false,
    });
    await expectCode(
      openThread(deps, openInput() as never, { idempotencyKey: key() }),
      "NEGOTIATION_ORDER_NOT_NEGOTIABLE",
    );
  });

  it("trusts the offer over the request body about who the parties are", async () => {
    const deps = makeDeps();
    // Shape-valid, and belonging to a different driver than the offer names. Accepting it
    // would bind an unrelated driver to this order.
    await expectCode(
      openThread(deps, openInput({ driver_public_id: "WS-3000000099" }) as never, {
        idempotencyKey: key(),
      }),
      "NEGOTIATION_PARTY_MISMATCH",
    );
  });

  it("refuses a thread whose two parties are the same person", async () => {
    const deps = makeDeps();
    deps.offers.put({
      dispatchOfferId: OFFER_ID,
      orderPublicId: ORDER_ID,
      driverPublicId: CUSTOMER_ID,
      serviceKind: "ride",
      active: true,
      negotiable: true,
    });
    await expectCode(
      openThread(deps, openInput({ driver_public_id: CUSTOMER_ID }) as never, {
        idempotencyKey: key(),
      }),
      "NEGOTIATION_PARTY_MISMATCH",
    );
  });

  it("refuses an amount outside the frozen policy bounds and returns the bounds", async () => {
    const deps = makeDeps();
    const low = await expectCode(
      openThread(deps, openInput({ opening_amount_minor: 100 }) as never, {
        idempotencyKey: key(),
      }),
      "NEGOTIATION_AMOUNT_OUT_OF_BOUNDS",
    );
    // The client is told what IS allowed; the number the user typed is not echoed back
    // into logs with a longer retention than the negotiation.
    expect(low.details?.minAmountMinor).toBe(500);
    expect(low.details?.maxAmountMinor).toBe(500_000);
    expect(low.details?.constraint).toBe("ck_negotiation_policies_amount_bounds");

    await expectCode(
      openThread(deps, openInput({ opening_amount_minor: 900_000 }) as never, {
        idempotencyKey: key(),
      }),
      "NEGOTIATION_AMOUNT_OUT_OF_BOUNDS",
    );
  });

  it("refuses a currency the policy does not price in", async () => {
    const deps = makeDeps();
    await expectCode(
      openThread(deps, openInput({ currency: "USD" }) as never, { idempotencyKey: key() }),
      "NEGOTIATION_CURRENCY_MISMATCH",
    );
  });

  it("refuses an unsupported locale", async () => {
    const deps = makeDeps();
    await expectCode(
      openThread(deps, openInput({ source_locale: "fr" }) as never, { idempotencyKey: key() }),
      "NEGOTIATION_LOCALE_UNSUPPORTED",
    );
  });

  it("requires an idempotency key, and refuses one reused with a different payload", async () => {
    const deps = makeDeps();
    await expectCode(
      openThread(deps, openInput() as never, {}),
      "NEGOTIATION_VALIDATION_FAILED",
    );

    const shared = key("shared");
    await openThread(deps, openInput() as never, { idempotencyKey: shared });
    await expectCode(
      openThread(
        deps,
        openInput({
          dispatch_offer_id: "33333333-3333-4333-8333-333333333333",
          opening_amount_minor: 4000,
        }) as never,
        { idempotencyKey: shared },
      ),
      "NEGOTIATION_IDEMPOTENCY_KEY_REUSED",
    );
  });

  it("replays the identical request instead of raising a conflict", async () => {
    const deps = makeDeps();
    const shared = key("replay");
    const first = await openThread(deps, openInput() as never, { idempotencyKey: shared });
    const second = await openThread(deps, openInput() as never, { idempotencyKey: shared });

    // A client whose response was lost to a timeout is not making a mistake, and
    // «already exists» would send him looking for a bug that is not there.
    expect(second.replay).toBe(true);
    expect(second.thread.id).toBe(first.thread.id);
    expect(deps.outbox.ofType("negotiations.thread_opened")).toHaveLength(1);
  });

  it("refuses a second thread on the same offer, and on the same order+driver pair", async () => {
    const deps = makeDeps();
    await openThread(deps, openInput() as never, { idempotencyKey: key() });
    await expectCode(
      openThread(deps, openInput() as never, { idempotencyKey: key() }),
      "NEGOTIATION_THREAD_ALREADY_EXISTS",
    );

    // Same order and driver, a different offer id: refused by
    // `ux_negotiation_threads_order_driver` rather than allowed as a fresh start.
    const otherOffer = "44444444-4444-4444-8444-444444444444";
    deps.offers.put({
      dispatchOfferId: otherOffer,
      orderPublicId: ORDER_ID,
      driverPublicId: DRIVER_ID,
      serviceKind: "ride",
      active: true,
      negotiable: true,
    });
    await expectCode(
      openThread(deps, openInput({ dispatch_offer_id: otherOffer }) as never, {
        idempotencyKey: key(),
      }),
      "NEGOTIATION_THREAD_ALREADY_EXISTS",
    );
  });

  it("emits thread_opened with occurred_for set to the creation moment", async () => {
    const deps = makeDeps();
    await openThread(deps, openInput() as never, { idempotencyKey: key() });
    const [event] = deps.outbox.ofType("negotiations.thread_opened");
    expect(event?.data.occurred_for).toBe(START);
    expect(event?.producer).toBe("negotiations-service");
  });
});
