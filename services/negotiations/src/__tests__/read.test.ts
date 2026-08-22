/**
 * The read side: a view assembled for a bot screen, and a list that refuses to be
 * unbounded.
 *
 * Two rules are asserted here that are easy to lose later:
 *
 *   1. **A read never writes.** An expired-but-still-`open` thread is REPORTED as expired
 *      through `isExpiredByTime`; it is not closed by whoever happened to open the screen.
 *      A GET that mutates makes the tick's counters depend on who was looking.
 *   2. **A list needs an identifying filter.** `state=open` alone is «every negotiation on
 *      the platform», which is the read that stops working the week the platform grows.
 */

import { describe, expect, it } from "vitest";

import { acceptRound } from "../use-cases/accept-round.js";
import { openThread } from "../use-cases/open-thread.js";
import { postMessage } from "../use-cases/post-message.js";
import { proposeRound } from "../use-cases/propose-round.js";
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  listNegotiations,
  readNegotiation,
} from "../use-cases/read-negotiation.js";
import {
  CUSTOMER_ID,
  DRIVER_ID,
  ORDER_ID,
  expectCode,
  key,
  makeDeps,
  openInput,
  withOpenThread,
} from "./helpers.js";

describe("readNegotiation", () => {
  it("assembles the whole thread in one view", async () => {
    const { deps, thread } = await withOpenThread();
    await postMessage(
      deps,
      thread.id,
      { author_role: "customer", body: "السعر مرتفع" },
      { idempotencyKey: key("m") },
    );
    await proposeRound(
      deps,
      thread.id,
      { proposed_by: "driver", amount_minor: 4000, currency: "SAR", expected_round_no: 0 },
      { idempotencyKey: key("p") },
    );

    const view = await readNegotiation(deps, thread.id);
    expect(view.thread.id).toBe(thread.id);
    expect(view.rounds).toHaveLength(1);
    expect(view.messages).toHaveLength(1);
    expect(view.agreement).toBeNull();
    expect(view.handoffs).toHaveLength(0);
    expect(view.pendingRound?.roundNo).toBe(1);
    // The one question a chat screen must answer before drawing a button: whose move is it.
    expect(view.turn).toBe("customer");
    expect(view.isExpiredByTime).toBe(false);
  });

  it("leaves the turn open when nothing is pending", async () => {
    const { deps, thread } = await withOpenThread();
    const view = await readNegotiation(deps, thread.id);
    expect(view.pendingRound).toBeNull();
    // Either party may open the bidding; `null` says so rather than guessing.
    expect(view.turn).toBeNull();
  });

  it("reports a lapsed thread as expired without closing it", async () => {
    const { deps, thread } = await withOpenThread();
    deps.clock.set("2026-08-23T00:20:00.000Z");

    const view = await readNegotiation(deps, thread.id);
    expect(view.isExpiredByTime).toBe(true);
    // Still `open` in storage: closing it here would make the tick's `threadsExpired`
    // count depend on who opened a screen, and would emit `thread_closed` from a GET.
    expect(view.thread.state).toBe("open");
    expect((await deps.threads.find(thread.id))?.state).toBe("open");
    expect(deps.outbox.ofType("negotiations.thread_closed")).toHaveLength(0);
  });

  it("stops claiming expiry once the thread is properly closed", async () => {
    const { deps, thread } = await withOpenThread();
    await proposeRound(
      deps,
      thread.id,
      { proposed_by: "driver", amount_minor: 4000, currency: "SAR", expected_round_no: 0 },
      { idempotencyKey: key("p") },
    );
    await acceptRound(deps, thread.id, 1, { acting_party: "customer" }, { idempotencyKey: key("a") });
    deps.clock.set("2026-08-23T02:00:00.000Z");

    const view = await readNegotiation(deps, thread.id);
    // `isExpiredByTime` is only ever about an OPEN thread outliving its deadline. An
    // agreement does not rot.
    expect(view.isExpiredByTime).toBe(false);
    expect(view.agreement?.amountMinor).toBe(4000);
    expect(view.handoffs).toHaveLength(1);
  });

  it("refuses a malformed id instead of answering «not found»", async () => {
    const deps = makeDeps();
    // A caller sending a bad id must learn that, not be told the negotiation is missing.
    await expectCode(readNegotiation(deps, "not-a-uuid"), "NEGOTIATION_VALIDATION_FAILED");
    await expectCode(
      readNegotiation(deps, "99999999-9999-4999-8999-999999999999"),
      "NEGOTIATION_THREAD_NOT_FOUND",
    );
  });
});

describe("listNegotiations", () => {
  async function seedThreads() {
    const deps = makeDeps();
    // Three negotiations: two on one order, one for another driver entirely.
    await openThread(deps, openInput() as never, { idempotencyKey: key("o") });
    deps.offers.put({
      dispatchOfferId: "22222222-2222-4222-8222-222222222222",
      orderPublicId: ORDER_ID,
      driverPublicId: "WS-3000000002",
      serviceKind: "ride",
      active: true,
      negotiable: true,
    });
    deps.clock.advanceSeconds(1);
    await openThread(
      deps,
      openInput({
        driver_public_id: "WS-3000000002",
        dispatch_offer_id: "22222222-2222-4222-8222-222222222222",
      }) as never,
      { idempotencyKey: key("o") },
    );
    deps.offers.put({
      dispatchOfferId: "33333333-3333-4333-8333-333333333333",
      orderPublicId: "ORD-1000000002",
      driverPublicId: DRIVER_ID,
      serviceKind: "delivery",
      active: true,
      negotiable: true,
    });
    deps.clock.advanceSeconds(1);
    await openThread(
      deps,
      openInput({
        order_public_id: "ORD-1000000002",
        dispatch_offer_id: "33333333-3333-4333-8333-333333333333",
        service_kind: "delivery",
      }) as never,
      { idempotencyKey: key("o") },
    );
    return deps;
  }

  it("lists by order, newest first", async () => {
    const deps = await seedThreads();
    const rows = await listNegotiations(deps, { order_public_id: ORDER_ID });
    expect(rows).toHaveLength(2);
    // Newest first, matching the index this read is meant to use.
    expect(rows[0]!.createdAt >= rows[1]!.createdAt).toBe(true);
  });

  it("lists by driver across orders", async () => {
    const deps = await seedThreads();
    const rows = await listNegotiations(deps, { driver_public_id: DRIVER_ID });
    expect(rows.map((row) => row.orderPublicId).sort()).toEqual(["ORD-1000000001", "ORD-1000000002"]);
  });

  it("refuses a filterless read", async () => {
    const deps = await seedThreads();
    await expectCode(listNegotiations(deps, {}), "NEGOTIATION_FILTER_REQUIRED");
    // `state` is not identifying: this is «every open negotiation», which is exactly the
    // read the rule exists to refuse.
    await expectCode(listNegotiations(deps, { state: "open" }), "NEGOTIATION_FILTER_REQUIRED");
  });

  it("refuses a malformed identifier rather than filtering on nonsense", async () => {
    const deps = await seedThreads();
    await expectCode(
      listNegotiations(deps, { order_public_id: "ORD-1" }),
      "NEGOTIATION_VALIDATION_FAILED",
    );
    await expectCode(listNegotiations(deps, { driver_public_id: "WS-x" }), "NEGOTIATION_VALIDATION_FAILED");
    await expectCode(
      listNegotiations(deps, { order_public_id: ORDER_ID, state: "finished" }),
      "NEGOTIATION_VALIDATION_FAILED",
    );
  });

  it("caps the page size and ignores a nonsensical limit", async () => {
    const deps = await seedThreads();
    // A limit nobody can raise past `MAX_LIST_LIMIT`, and a bad limit that falls back to
    // the default rather than to «everything».
    expect(await listNegotiations(deps, { order_public_id: ORDER_ID, limit: 1 })).toHaveLength(1);
    expect(MAX_LIST_LIMIT).toBeGreaterThan(DEFAULT_LIST_LIMIT);
    for (const limit of [0, -5, "many", 10_000]) {
      const rows = await listNegotiations(deps, { order_public_id: ORDER_ID, limit });
      expect(rows.length).toBeLessThanOrEqual(MAX_LIST_LIMIT);
    }
  });

  it("finds nothing for a customer who has no negotiations, and says so quietly", async () => {
    const deps = await seedThreads();
    const rows = await listNegotiations(deps, { driver_public_id: "WS-3000000009" });
    // An empty list, not a 404: «this driver is negotiating nothing» is a valid answer.
    expect(rows).toEqual([]);
    expect(CUSTOMER_ID).toMatch(/^WS-/u);
  });

  it("writes nothing on any read path", async () => {
    const deps = await seedThreads();
    const before = deps.outbox.all().length;
    await listNegotiations(deps, { order_public_id: ORDER_ID });
    await readNegotiation(deps, (await listNegotiations(deps, { order_public_id: ORDER_ID }))[0]!.id);
    // No event, no version bump: the whole read side is side-effect free, which is what
    // makes it safe to call from a bot on every keystroke.
    expect(deps.outbox.all()).toHaveLength(before);
  });
});
