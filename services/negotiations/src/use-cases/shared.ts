/**
 * Machinery every write use case needs, in one place.
 *
 * Three concerns live here — the idempotency guard, the event meta factory, and the
 * thread-closing routine — because each of them has exactly one correct
 * implementation and six call sites. Copying them would mean six chances to get the
 * fingerprint, the tick recomputation, or the close reason subtly different, and the
 * divergence would only show up as «why does cancelling leave a tick scheduled».
 */

import { createHash } from "node:crypto";

import { idempotencyKeyRequired, idempotencyKeyReused, messageLimitReached } from "../domain/errors.js";
import { computeNextTickAt } from "../domain/expiry.js";
import * as events from "../domain/events.js";
import type { EventMeta } from "../domain/events.js";
import type {
  NegotiationAuthorRole,
  NegotiationCloseReasonCode,
  NegotiationClosedThreadState,
  NegotiationLocale,
  NegotiationMessage,
  NegotiationPolicy,
  NegotiationThread,
} from "../domain/model.js";
import { assertThreadTransition } from "../domain/state-machine.js";
import { assertIdempotencyKey } from "../domain/validation.js";
import type { NegotiationDependencies } from "../ports.js";

/** Options every write accepts. */
export interface WriteOptions {
  readonly idempotencyKey?: unknown;
  readonly traceId?: string | null;
}

/**
 * A stable fingerprint of a request payload.
 *
 * Keys are sorted before hashing, so `{a,b}` and `{b,a}` — the same request from two
 * JSON serialisers — are one request rather than a false conflict. A JSON string
 * would work as a comparison too; it is hashed because the stored value would
 * otherwise be a copy of the payload, and payloads here contain chat notes.
 */
export function fingerprint(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

/**
 * The idempotency guard, in the only shape that is actually safe.
 *
 * Returns `"fresh"` for a key never seen, and raises `IDEMPOTENCY_KEY_REUSED` when
 * the key is known with a **different** payload or in a different scope. A repeat of
 * the identical request returns `"replay"`, and the caller answers from the stored
 * state instead of writing again.
 *
 * The reason the fingerprint is compared and not just the key: without it, a client
 * that reuses one key for two different proposals gets a silent success on the
 * second and never learns his second price was discarded. That failure is invisible
 * on both sides until someone argues about the fare.
 */
export async function guardIdempotency(
  deps: Pick<NegotiationDependencies, "idempotency">,
  scope: string,
  key: unknown,
  payload: unknown,
): Promise<"fresh" | "replay"> {
  const validated = assertIdempotencyKey(key);
  if (validated.length === 0) throw idempotencyKeyRequired();
  const digest = fingerprint(payload);
  const existing = await deps.idempotency.find(validated);
  if (existing === null) {
    await deps.idempotency.remember(validated, scope, digest);
    return "fresh";
  }
  if (existing.scope !== scope || existing.payloadFingerprint !== digest) {
    throw idempotencyKeyReused();
  }
  return "replay";
}

/** Event envelope meta from the injected clock and id generator — never `Date.now()`. */
export function metaFrom(
  deps: Pick<NegotiationDependencies, "clock" | "ids">,
  options: { readonly traceId?: string | null } = {},
  occurredAt?: string,
): EventMeta {
  return {
    eventId: deps.ids.uuid(),
    occurredAt: occurredAt ?? deps.clock.now(),
    traceId: options.traceId ?? null,
  };
}

/**
 * Close a thread and emit `thread_closed`, for every reason except agreement.
 *
 * `nextTickAt` is forced to `null` here and not left to the caller. A closed thread
 * that keeps a tick moment is a row the sweep visits forever, and
 * `ck_negotiation_threads_closed_has_reason` refuses it outright — so «I forgot to
 * clear it» is a crash in tests rather than a slow leak in production.
 */
export async function closeThread(
  deps: NegotiationDependencies,
  thread: NegotiationThread,
  input: {
    readonly state: NegotiationClosedThreadState;
    readonly reasonCode: NegotiationCloseReasonCode;
    readonly at: string;
    readonly occurredFor: string;
    readonly traceId?: string | null;
  },
): Promise<NegotiationThread> {
  assertThreadTransition(thread, input.state, input.reasonCode);
  const closed = await deps.threads.update(
    thread.id,
    {
      state: input.state,
      closeReasonCode: input.reasonCode,
      closedAt: input.at,
      nextTickAt: null,
    },
    input.at,
    thread.version,
  );
  await deps.outbox.append(
    events.threadClosed(closed, metaFrom(deps, { traceId: input.traceId }, input.at), {
      state: input.state,
      occurredFor: input.occurredFor,
    }),
  );
  return closed;
}

/**
 * Append one message and emit `message_posted`.
 *
 * Shared by `post-message` and by the optional notes on proposals and decisions,
 * because a note IS a message: giving it its own storage would mean two places to
 * search when a user reports what he was told, and two places to redact.
 *
 * The per-thread cap is enforced here and the append is **refused** when it is
 * reached, including for a note riding along with a proposal. The alternative —
 * dropping the note and letting the proposal through — is worse than a rejection: the
 * proposer would believe he explained his price, and nothing would say otherwise.
 */
export async function appendMessage(
  deps: NegotiationDependencies,
  thread: NegotiationThread,
  policy: NegotiationPolicy,
  input: {
    readonly authorRole: NegotiationAuthorRole;
    readonly body: string | null;
    readonly systemCode?: string | null;
    readonly roundNo?: number | null;
    readonly sourceLocale: NegotiationLocale;
    readonly at: string;
    readonly traceId?: string | null;
  },
): Promise<NegotiationMessage> {
  const count = await deps.messages.count(thread.id);
  if (count >= policy.maxMessagesPerThread) {
    throw messageLimitReached(policy.maxMessagesPerThread);
  }
  const message = await deps.messages.create({
    id: deps.ids.uuid(),
    threadId: thread.id,
    // Per-thread and gap-free: the sequence is what makes «read up to here» and «in
    // this order» answerable without trusting timestamps from two devices.
    sequenceNo: count + 1,
    authorRole: input.authorRole,
    body: input.body,
    sourceLocale: input.sourceLocale,
    systemCode: input.systemCode ?? null,
    roundNo: input.roundNo ?? null,
    createdAt: input.at,
  });
  await deps.outbox.append(
    events.messagePosted(message, metaFrom(deps, { traceId: input.traceId }, input.at)),
  );
  return message;
}

/**
 * Recompute and persist `next_tick_at` after anything that changes the deadlines.
 *
 * Derived from the rounds actually stored rather than from what the caller believes
 * is pending: the tick is the mechanism that closes an abandoned negotiation, and a
 * hand-maintained timestamp is a negotiation that stays open forever the first time
 * a branch forgets to update it.
 */
export async function refreshNextTick(
  deps: NegotiationDependencies,
  thread: NegotiationThread,
  at: string,
): Promise<NegotiationThread> {
  const pending = await deps.rounds.findPending(thread.id);
  const nextTickAt = computeNextTickAt({
    threadState: thread.state,
    threadExpiresAt: thread.expiresAt,
    pendingRoundExpiresAt: pending?.expiresAt ?? null,
  });
  if (nextTickAt === thread.nextTickAt) return thread;
  return deps.threads.update(thread.id, { nextTickAt }, at, thread.version);
}
