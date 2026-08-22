/**
 * Privacy, asserted mechanically rather than by review.
 *
 * The rule from ADR-013 decision 6 is that chat is content and events are not: an event
 * says a message was posted and how long it was, never what it said. The amount, by
 * contrast, MUST cross — a fare is the whole point of the negotiation and the order engine
 * cannot record what it never receives.
 *
 * The important test below is the exhaustive one: it drives a full negotiation, walks
 * EVERY key of EVERY emitted payload, and fails on any forbidden field. A reviewer
 * eyeballing a new event builder is the failure mode this replaces — that review happens
 * once, this runs on every commit.
 */

import { describe, expect, it } from "vitest";

import { NEGOTIATION_EVENT_FORBIDDEN_FIELDS } from "@wasla/contracts-negotiation";

import { acceptRound } from "../use-cases/accept-round.js";
import { postMessage } from "../use-cases/post-message.js";
import { proposeRound } from "../use-cases/propose-round.js";
import { rejectRound } from "../use-cases/reject-round.js";
import { runTick } from "../use-cases/run-tick.js";
import { key, makeDeps, withOpenThread } from "./helpers.js";

/** Every key at every depth of a payload, so a nested object cannot smuggle a body. */
function collectKeys(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
    return into;
  }
  if (value !== null && typeof value === "object") {
    for (const [name, nested] of Object.entries(value)) {
      into.push(name);
      collectKeys(nested, into);
    }
  }
  return into;
}

/** Every string anywhere in a payload, so a body cannot be smuggled under a clean name. */
function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") {
    into.push(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
    return into;
  }
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) collectStrings(nested, into);
  }
  return into;
}

const SECRET_BODY = "رقمي 0512345678 وموقعي عند البوابة الشمالية";

/** Drive a negotiation that emits all nine event types except the hand-off failure. */
async function driveFullNegotiation() {
  const { deps, thread } = await withOpenThread(makeDeps(), {
    opening_note: "أرجو تخفيض السعر قليلاً",
  });

  await postMessage(
    deps,
    thread.id,
    { author_role: "customer", body: SECRET_BODY },
    { idempotencyKey: key("m") },
  );
  await proposeRound(
    deps,
    thread.id,
    {
      proposed_by: "driver",
      amount_minor: 4500,
      currency: "SAR",
      expected_round_no: 0,
      note: SECRET_BODY,
    },
    { idempotencyKey: key("p") },
  );
  await rejectRound(
    deps,
    thread.id,
    1,
    { acting_party: "customer", close_thread: false, note: SECRET_BODY },
    { idempotencyKey: key("r") },
  );
  await proposeRound(
    deps,
    thread.id,
    { proposed_by: "customer", amount_minor: 4000, currency: "SAR", expected_round_no: 1 },
    { idempotencyKey: key("p") },
  );
  // Round 3 is left to lapse, so `round_expired` and `thread_closed` are emitted too.
  await proposeRound(
    deps,
    thread.id,
    { proposed_by: "driver", amount_minor: 4200, currency: "SAR", expected_round_no: 2 },
    { idempotencyKey: key("p") },
  );
  deps.clock.set("2026-08-23T00:20:00.000Z");
  await runTick(deps);

  return deps;
}

describe("event privacy", () => {
  it("emits no forbidden field in any payload of a full negotiation", async () => {
    const deps = await driveFullNegotiation();
    const forbidden = new Set<string>(NEGOTIATION_EVENT_FORBIDDEN_FIELDS as readonly string[]);
    expect(deps.outbox.all()).not.toHaveLength(0);

    for (const event of deps.outbox.all()) {
      for (const name of collectKeys(event)) {
        // Named, so a failure tells you which event and which key rather than «false is
        // not true».
        expect(
          forbidden.has(name),
          `الحدث ${event.event_type} يحمل الحقل الممنوع ${name}`,
        ).toBe(false);
      }
    }
  });

  it("lets no message body or note text leak into any payload, under any key", async () => {
    const deps = await driveFullNegotiation();
    for (const event of deps.outbox.all()) {
      for (const text of collectStrings(event)) {
        expect(text, `الحدث ${event.event_type} يحمل نص محتوى`).not.toContain("0512345678");
        expect(text).not.toContain("البوابة الشمالية");
        expect(text).not.toContain("أرجو تخفيض السعر");
      }
    }
  });

  it("carries the length of a message and not the message", async () => {
    const { deps, thread } = await withOpenThread();
    await postMessage(
      deps,
      thread.id,
      { author_role: "driver", body: SECRET_BODY },
      { idempotencyKey: key("m") },
    );
    const [event] = deps.outbox.ofType("negotiations.message_posted");

    // Enough to size a chat, notify a phone, and spot abuse; not enough to read.
    expect(event?.data.body_length).toBe(SECRET_BODY.length);
    expect(event?.data.author_role).toBe("driver");
    expect(event?.data.source_locale).toBe("ar");
    expect(Object.keys(event?.data ?? {})).not.toContain("body");
  });

  it("does carry the amount, because a fare nobody receives is not an agreement", async () => {
    const { deps, thread } = await withOpenThread();
    await proposeRound(
      deps,
      thread.id,
      { proposed_by: "driver", amount_minor: 4500, currency: "SAR", expected_round_no: 0 },
      { idempotencyKey: key("p") },
    );
    await acceptRound(deps, thread.id, 1, { acting_party: "customer" }, { idempotencyKey: key("a") });

    const [proposed] = deps.outbox.ofType("negotiations.round_proposed");
    expect(proposed?.data.amount_minor).toBe(4500);
    expect(proposed?.data.currency).toBe("SAR");

    const [agreed] = deps.outbox.ofType("negotiations.agreed");
    // Money in minor units with its currency beside it — never a float, and never a bare
    // number whose currency the consumer has to assume.
    expect(agreed?.data.amount_minor).toBe(4500);
    expect(agreed?.data.currency).toBe("SAR");
    expect(Number.isInteger(agreed?.data.amount_minor)).toBe(true);
  });

  it("stamps every payload with the moment the fact became true", async () => {
    const deps = await driveFullNegotiation();
    for (const event of deps.outbox.all()) {
      // `occurred_for` is the point of the whole envelope: without it a consumer cannot
      // tell a deadline that passed at 00:02 from a sweep that noticed at 00:20.
      expect(
        typeof event.data.occurred_for,
        `الحدث ${event.event_type} بلا occurred_for`,
      ).toBe("string");
      expect(event.producer).toBe("negotiations-service");
      expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/u);
    }
  });

  it("names the two parties by public id and nothing else about them", async () => {
    const deps = await driveFullNegotiation();
    const [opened] = deps.outbox.ofType("negotiations.thread_opened");
    expect(opened?.data.customer_public_id).toMatch(/^WS-[0-9]{10}$/u);
    expect(opened?.data.driver_public_id).toMatch(/^WS-[0-9]{10}$/u);
    // No display name, no phone, no chat id. Everything a consumer legitimately needs is
    // reachable from the public id through the service that owns it.
    const keys = Object.keys(opened?.data ?? {});
    expect(keys).not.toContain("display_name");
    expect(keys).not.toContain("phone");
    expect(keys).not.toContain("telegram_id");
  });

  it("keeps the forbidden list non-empty, so this file cannot pass vacuously", async () => {
    // A test that would still pass after the list was emptied by accident guards nothing.
    expect(NEGOTIATION_EVENT_FORBIDDEN_FIELDS.length).toBeGreaterThan(10);
    expect(NEGOTIATION_EVENT_FORBIDDEN_FIELDS).toContain("body");
    expect(NEGOTIATION_EVENT_FORBIDDEN_FIELDS).toContain("phone");
    expect(NEGOTIATION_EVENT_FORBIDDEN_FIELDS).not.toContain("amount_minor");
  });
});
