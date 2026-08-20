/**
 * Local rate budget for outbound Telegram traffic (ADR-007 rule 10, phase plan MR 3).
 *
 * Telegram enforces roughly 30 messages/second per bot and about one message per
 * second in a single chat, and answers a violation with 429 plus a cooldown. We
 * throttle *before* calling, because a 429 costs a round trip, is counted
 * against the bot, and (in bursts) escalates into longer cooldowns.
 *
 * Design decision — **the limiter never sleeps.** When the budget is exhausted it
 * reports a cooldown, the adapter returns `CHANNEL_RATE_LIMITED` with
 * `retryAfterSeconds`, and the core requeues the delivery with its own backoff.
 * Blocking inside `send` would hold a webhook request open and hide queue depth;
 * this way a throttled message is visible as `queued` state with a due time.
 *
 * In-process only, by design: with several bot instances the true budget is
 * shared, which is what the deferred `channel_rate_budgets` table is for. Until
 * then this is a safety margin, not a guarantee — and Telegram's own `retry_after`
 * remains authoritative.
 */

import type { ClockPort } from "@wasla/channel-core";

/** Tunables, all overridable by the composition root. */
export interface RateLimitOptions {
  /** Messages per second across all chats of one bot. */
  readonly perSecond?: number;
  /** Messages per second inside a single chat. */
  readonly perChatPerSecond?: number;
  /** Chats tracked before the least-recently-used entry is dropped. */
  readonly maxTrackedChats?: number;
}

export const RATE_DEFAULTS = {
  perSecond: 25,
  perChatPerSecond: 1,
  maxTrackedChats: 5_000,
} as const;

/** Verdict for one send attempt. */
export type RateVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

interface Bucket {
  tokens: number;
  updatedAtMs: number;
}

/**
 * Token bucket over an injected clock.
 *
 * The clock is a port so retry timing is asserted in tests instead of waited
 * for — the same reason the core injects it (ADR-007 §2).
 */
export class TokenBucketRateLimiter {
  private readonly perSecond: number;
  private readonly perChatPerSecond: number;
  private readonly maxTrackedChats: number;
  private readonly global: Bucket;
  private readonly perChat = new Map<string, Bucket>();

  constructor(
    private readonly clock: ClockPort,
    options: RateLimitOptions = {},
  ) {
    this.perSecond = options.perSecond ?? RATE_DEFAULTS.perSecond;
    this.perChatPerSecond = options.perChatPerSecond ?? RATE_DEFAULTS.perChatPerSecond;
    this.maxTrackedChats = options.maxTrackedChats ?? RATE_DEFAULTS.maxTrackedChats;
    this.global = { tokens: this.perSecond, updatedAtMs: this.nowMs() };
  }

  private nowMs(): number {
    const parsed = Date.parse(this.clock.now());
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  /** Refills a bucket for the elapsed time and returns it, capped at its size. */
  private refill(bucket: Bucket, ratePerSecond: number, nowMs: number): Bucket {
    const elapsedSeconds = Math.max(0, (nowMs - bucket.updatedAtMs) / 1000);
    bucket.tokens = Math.min(ratePerSecond, bucket.tokens + elapsedSeconds * ratePerSecond);
    bucket.updatedAtMs = nowMs;
    return bucket;
  }

  private chatBucket(chatRef: string, nowMs: number): Bucket {
    const existing = this.perChat.get(chatRef);
    if (existing) {
      // Re-inserted so iteration order stays least-recently-used first.
      this.perChat.delete(chatRef);
      this.perChat.set(chatRef, existing);
      return existing;
    }
    if (this.perChat.size >= this.maxTrackedChats) {
      const oldest = this.perChat.keys().next();
      if (!oldest.done) this.perChat.delete(oldest.value);
    }
    const fresh: Bucket = { tokens: this.perChatPerSecond, updatedAtMs: nowMs };
    this.perChat.set(chatRef, fresh);
    return fresh;
  }

  /** Seconds until one token is available again, rounded up to a whole second. */
  private cooldownFor(bucket: Bucket, ratePerSecond: number): number {
    const missing = 1 - bucket.tokens;
    return Math.max(1, Math.ceil(missing / ratePerSecond));
  }

  /**
   * Consumes one token for `chatRef`, or reports how long to wait.
   *
   * Both buckets must allow the send; the global one is checked first because
   * exceeding it throttles every chat, so its cooldown is the binding one.
   */
  take(chatRef: string): RateVerdict {
    const nowMs = this.nowMs();
    const global = this.refill(this.global, this.perSecond, nowMs);
    if (global.tokens < 1) {
      return { allowed: false, retryAfterSeconds: this.cooldownFor(global, this.perSecond) };
    }
    const chat = this.refill(this.chatBucket(chatRef, nowMs), this.perChatPerSecond, nowMs);
    if (chat.tokens < 1) {
      return { allowed: false, retryAfterSeconds: this.cooldownFor(chat, this.perChatPerSecond) };
    }
    global.tokens -= 1;
    chat.tokens -= 1;
    return { allowed: true };
  }

  /**
   * Applies a cooldown the channel itself demanded (`retry_after`).
   *
   * Emptying both buckets makes Telegram's answer authoritative over our local
   * estimate: after a real 429 the next attempt waits, instead of spending
   * leftover local tokens on calls Telegram is already rejecting.
   *
   * The buckets are dated so that the *first* token becomes available exactly at
   * the end of the cooldown, not one refill tick later. Without that offset a
   * retry scheduled by the core for `now + retry_after` would be throttled again
   * by our own limiter, and the message would slip a whole backoff step for no
   * reason.
   */
  penalise(chatRef: string, retryAfterSeconds: number): void {
    const nowMs = this.nowMs();
    const untilMs = nowMs + Math.max(0, retryAfterSeconds) * 1000;
    this.global.tokens = 0;
    this.global.updatedAtMs = untilMs - 1000 / this.perSecond;
    const chat = this.chatBucket(chatRef, nowMs);
    chat.tokens = 0;
    chat.updatedAtMs = untilMs - 1000 / this.perChatPerSecond;
  }
}
