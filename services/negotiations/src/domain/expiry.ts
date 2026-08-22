/**
 * Time — a due moment compared to an injected clock, never a timer.
 *
 * ADR-013 decision 5, with precedents in ADR-011 decision 3 (matching) and
 * ADR-012 decision 5 (Driver Core). Nothing in this service schedules anything.
 * A round has an `expiresAt`; a thread has an `expiresAt`; whether either has
 * passed is a comparison, and the comparison happens in **two** places:
 *
 *   1. `POST /negotiations/tick` — the sweep that closes what nobody touched, so
 *      an abandoned thread does not sit open forever holding a dispatch offer.
 *   2. **Every action** — `expireIfDue` runs before accept, reject, propose and
 *      post, because relying on the tick alone leaves a window between the moment
 *      a price expires and the moment the sweep notices. In that window an expired
 *      price is still acceptable. That is a window on money, not on a screen, and
 *      it is exactly the kind of gap that is invisible in tests with a fast tick
 *      and obvious in production with a slow one.
 *
 * ## Why an ISO string and not a Date
 *
 * The whole service passes wall-clock time as an ISO-8601 string, matching every
 * other WASLA service. `Date` objects are mutable, carry a local timezone that
 * nothing in the domain wants, and print differently in two Node versions. The
 * comparison here parses to epoch millis and compares numbers.
 *
 * ## The `occurredFor` distinction
 *
 * When the tick expires a round at 12:05 that was due at 12:02, the event carries
 * **12:02**, not 12:05. A restart delays the discovery; it does not change when the
 * thing expired. Every expiry event in `events.json` therefore requires
 * `occurred_for`, and `dueMomentFor` below is what supplies it.
 */

import { validationFailed } from "./errors.js";

/** Parse to epoch millis, refusing anything that is not a real instant. */
export function toEpochMillis(iso: string, field = "timestamp"): number {
  const millis = Date.parse(iso);
  if (Number.isNaN(millis)) throw validationFailed(field, "ISO-8601 timestamp");
  return millis;
}

export function assertTimestamp(value: unknown, field = "timestamp"): string {
  if (typeof value !== "string") throw validationFailed(field, "ISO-8601 timestamp");
  toEpochMillis(value, field);
  return value;
}

/**
 * Has `dueAt` passed at `now`?
 *
 * Inclusive of the boundary: a deadline of exactly `now` **has** expired. The
 * alternative leaves a one-millisecond window in which a round is simultaneously
 * past its deadline and still acceptable, and every reader of that code has to
 * re-derive which side of the comparison won.
 */
export function isDue(dueAt: string, now: string): boolean {
  return toEpochMillis(dueAt, "expires_at") <= toEpochMillis(now, "now");
}

/** `now + seconds`, as an ISO string. The only arithmetic on time in the service. */
export function addSeconds(now: string, seconds: number): string {
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw validationFailed("seconds", "non-negative integer");
  }
  return new Date(toEpochMillis(now, "now") + seconds * 1000).toISOString();
}

/** The earlier of two instants, `null` meaning «no due moment of this kind». */
export function earlier(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return toEpochMillis(left) <= toEpochMillis(right) ? left : right;
}

/**
 * The thread's `next_tick_at`: the nearest moment this thread means something.
 *
 * min(pending round expiry, thread expiry) — and `null` once the thread is closed,
 * because nothing waits for a finished negotiation and an index full of closed rows
 * is a sweep that gets slower every day (`ix_negotiation_threads_tick_due` is a
 * partial index on `state = 'open'` for the same reason).
 */
export function computeNextTickAt(input: {
  readonly threadState: string;
  readonly threadExpiresAt: string;
  readonly pendingRoundExpiresAt: string | null;
}): string | null {
  if (input.threadState !== "open") return null;
  return earlier(input.pendingRoundExpiresAt, input.threadExpiresAt);
}

/**
 * The moment an expiry actually became true — the value events carry as
 * `occurred_for`.
 *
 * Deliberately `dueAt` and not `now`: see this file's header. Tests assert this
 * distinction, because it is the one that quietly disappears the first time
 * somebody «simplifies» an event factory to use the clock it already has.
 */
export function dueMomentFor(dueAt: string): string {
  return dueAt;
}
