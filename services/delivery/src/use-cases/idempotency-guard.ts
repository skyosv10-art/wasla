/**
 * The read-side half of the idempotency handshake (review 7/N · ADR-026 §4.10).
 *
 * ## Why a pre-check exists at all, when the write already checks
 *
 * The transactional check inside the write port is what makes the guarantee
 * ATOMIC, but it runs too late to give a correct ANSWER on one important path:
 * the retry of a successful cancellation. That request re-reads an order that
 * is already `cancelled`, and `cancelled → cancelled` is not an edge in §3.1,
 * so the domain would refuse it with `DELIVERY_INVALID_TRANSITION` (409) and
 * the caller would never reach the write port that holds its stored response.
 * A client retrying after a lost response would conclude the cancellation
 * failed, when it succeeded.
 *
 * So both checks are load-bearing and neither replaces the other:
 *   - this one: "has this exact request already been answered?" → replay
 *   - the write's: "did someone else answer it while I worked?" → atomicity
 *
 * ## Why the fingerprint is compared in both places too
 *
 * The reuse refusal (`DELIVERY_IDEMPOTENCY_KEY_REUSED`) must not depend on
 * WHICH check saw the key first, or the same client mistake would get 409 on
 * one path and a wrong 200 on another.
 */

import { DeliveryError } from "../domain/errors.js";
import type { IdempotencyIntent, IdempotentReplay, StoreOrderReadPort } from "../ports.js";

export async function resolveIdempotentReplay(
  readPort: StoreOrderReadPort,
  intent: IdempotencyIntent | undefined,
  traceId: string | null,
): Promise<IdempotentReplay | null> {
  if (intent === undefined) return null;
  const stored = await readPort.findIdempotentResponse(intent.key);
  if (stored === null) return null;
  if (stored.fingerprint !== intent.fingerprint) {
    throw new DeliveryError(
      "DELIVERY_IDEMPOTENCY_KEY_REUSED",
      "المفتاحُ نفسُهُ مُستعمَلٌ لطلبٍ مختلفٍ — ولِّد مفتاحاً جديداً",
      { traceId: traceId ?? undefined, details: { field: "Idempotency-Key" } },
    );
  }
  return { kind: "replayed", status: stored.status, body: stored.body };
}
