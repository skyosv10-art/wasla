/**
 * The write-idempotency handshake, shared by every write path.
 *
 * One implementation rather than four copies, because the three outcomes have to be
 * treated identically everywhere: an unseen key proceeds, a seen key with the same
 * payload replays the stored result, and a seen key with a different payload is a
 * caller bug that must be refused instead of silently overwriting somebody's row.
 *
 * The key is remembered *after* the write, never before: a key stored ahead of a write
 * that then fails would turn the honest retry into a replay of something that never
 * happened.
 */
import { idempotencyKeyReused } from "../domain/errors.js";
import type { IdempotencyStore } from "../ports.js";

export type IdempotencyDecision = "fresh" | "replay";

export async function classifyIdempotency(
  store: IdempotencyStore,
  key: string,
  payloadFingerprint: string,
  traceId?: string,
): Promise<IdempotencyDecision> {
  const remembered = await store.find(key);
  if (remembered === null) return "fresh";
  if (remembered !== payloadFingerprint) throw idempotencyKeyReused(traceId);
  return "replay";
}
