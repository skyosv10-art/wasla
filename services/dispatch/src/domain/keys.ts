/**
 * Deterministic idempotency keys for calls we make to the order engine.
 *
 * `errors.md` requires that a retry after a 5xx, a disconnect or a timeout reuses
 * the *same* key, derived from the operation's own identity rather than minted per
 * attempt. A fresh random key on retry is how one offer becomes two assignments on
 * the same order — and the order engine would be right to accept both, because
 * from its side they are two different writes.
 *
 * Derived, not stored: a stored key is one more row to keep consistent, and a
 * derivation is verifiable by reading this file.
 *
 * The keys are readable on purpose. They land in the order engine's logs, and an
 * on-call engineer reading `dispatch:offer:<uuid>:accept` learns which offer
 * caused it without a join. Length stays inside the 8..128 bound the engine
 * declares: the longest prefix here plus a 36-character UUID is well under it.
 */

/** Assignment-level operations dispatch performs for a single offer. */
export type OfferEngineAction =
  | "register"
  | "accept"
  | "reject"
  | "timeout"
  | "supersede"
  | "cancel";

export const OFFER_ENGINE_ACTIONS: readonly OfferEngineAction[] = [
  "register",
  "accept",
  "reject",
  "timeout",
  "supersede",
  "cancel",
];

/**
 * One key per (offer, action).
 *
 * Not per offer alone: registering an assignment and later resolving it are two
 * different writes on the engine's side, and sharing one key would make the second
 * look like a retry of the first and be dropped.
 */
export function offerEngineKey(offerId: string, action: OfferEngineAction): string {
  return `dispatch:offer:${offerId}:${action}`;
}

/**
 * One key per (job, target status, attempt sequence).
 *
 * Order transitions repeat legitimately — `searching → offered` happens once per
 * wave — so the wave number is part of the identity. Without it, wave 2's
 * `offered` transition would be swallowed as a retry of wave 1's and the order
 * would stop reflecting that anyone was still being asked.
 */
export function orderTransitionKey(jobId: string, to: string, sequence: number): string {
  return `dispatch:order:${jobId}:${to}:${sequence}`;
}
