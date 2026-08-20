/**
 * Rate-budget tests.
 *
 * Time is injected, so throttling is asserted instantly instead of waited for —
 * a test that sleeps a second per case would make this suite the slowest thing in
 * CI for no added confidence.
 */

import { describe, expect, it } from "vitest";

import { FixedClock } from "@wasla/channel-core";

import { RATE_DEFAULTS, TokenBucketRateLimiter } from "../rate-limit.js";

describe("TokenBucketRateLimiter · per-chat budget", () => {
  it("allows the first send and throttles the immediate second one in the same chat", () => {
    const clock = new FixedClock();
    const limiter = new TokenBucketRateLimiter(clock);

    expect(limiter.take("chat-1").allowed).toBe(true);
    const second = limiter.take("chat-1");
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("does not let one busy chat throttle another", () => {
    const limiter = new TokenBucketRateLimiter(new FixedClock());
    expect(limiter.take("chat-1").allowed).toBe(true);
    expect(limiter.take("chat-1").allowed).toBe(false);
    expect(limiter.take("chat-2").allowed).toBe(true);
  });

  it("refills as time passes", () => {
    const clock = new FixedClock();
    const limiter = new TokenBucketRateLimiter(clock);
    expect(limiter.take("chat-1").allowed).toBe(true);
    expect(limiter.take("chat-1").allowed).toBe(false);
    clock.advance(1000);
    expect(limiter.take("chat-1").allowed).toBe(true);
  });
});

describe("TokenBucketRateLimiter · global budget", () => {
  it("throttles across chats once the per-second budget is spent", () => {
    const limiter = new TokenBucketRateLimiter(new FixedClock(), { perSecond: 3, perChatPerSecond: 5 });
    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("b").allowed).toBe(true);
    expect(limiter.take("c").allowed).toBe(true);
    expect(limiter.take("d").allowed).toBe(false);
  });

  it("exposes documented defaults instead of magic numbers", () => {
    expect(RATE_DEFAULTS.perSecond).toBeLessThanOrEqual(30);
    expect(RATE_DEFAULTS.perChatPerSecond).toBe(1);
  });
});

describe("TokenBucketRateLimiter · channel-imposed cooldown wins", () => {
  it("stops sending for the cooldown Telegram demanded, then resumes", () => {
    const clock = new FixedClock();
    const limiter = new TokenBucketRateLimiter(clock, { perSecond: 100, perChatPerSecond: 100 });

    // Plenty of local budget left, but Telegram said 5 seconds — its answer must
    // outrank our estimate, otherwise we keep spending calls it will reject.
    limiter.penalise("chat-1", 5);
    expect(limiter.take("chat-1").allowed).toBe(false);

    clock.advance(4000);
    expect(limiter.take("chat-1").allowed).toBe(false);

    clock.advance(2000);
    expect(limiter.take("chat-1").allowed).toBe(true);
  });

  it("keeps working when a chat was never seen before", () => {
    const limiter = new TokenBucketRateLimiter(new FixedClock());
    limiter.penalise("unknown-chat", 1);
    expect(limiter.take("unknown-chat").allowed).toBe(false);
  });
});

describe("TokenBucketRateLimiter · memory bound", () => {
  it("forgets the least recently used chat instead of growing without limit", () => {
    // A per-chat bucket map with no ceiling is an unbounded allocation driven by
    // strangers messaging the bot.
    const limiter = new TokenBucketRateLimiter(new FixedClock(), {
      perSecond: 10_000,
      perChatPerSecond: 1,
      maxTrackedChats: 2,
    });
    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("b").allowed).toBe(true);
    expect(limiter.take("c").allowed).toBe(true);
    // "a" was evicted, so its bucket is fresh again — the safety margin is lost
    // for that chat, but the process stays bounded, which is the trade recorded here.
    expect(limiter.take("a").allowed).toBe(true);
  });
});
