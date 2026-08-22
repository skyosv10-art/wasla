/**
 * Negotiation policy — the bounds as DATA, in a numbered frozen version.
 *
 * These constants mirror the seed of `services/negotiations/contracts/schema.sql`
 * §1 and are guarded against it by a drift test that parses the DDL's `INSERT`.
 * They live here, and not only in the database, so the whole domain suite can run
 * without Postgres — the same reason `SEEDED_POLICIES` exists in Driver Core and
 * `SEEDED_RULESETS` in matching.
 *
 * ## Why the numbers are declared and not defaulted
 *
 *   - **500..500000 minor units** (5..5000 SAR) — the range of a city ride or
 *     delivery. A one-riyal offer and a million-riyal offer are both abuse, not
 *     negotiation, and refusing them at the boundary keeps the abuse out of the
 *     audit trail rather than in it.
 *   - **5 rounds** — more is haggling, fewer forbids a reasonable counter.
 *   - **120s per round, 900s per thread** — this is the countdown both parties
 *     see, so it is a product number, and a product number belongs in a versioned
 *     row rather than in a constant somebody tunes during an incident.
 *   - **1000 chars, 100 messages** — the chat is a negotiation aid, not a
 *     messenger. The ceiling exists so a thread cannot become a channel.
 *
 * A different number is **version 2 plus an ADR**, never an edit here: every
 * thread stores its `policyVersion`, and that is what makes an old decision still
 * explainable under the rules that made it.
 */

import { NEGOTIATION_LAUNCH_POLICY_LABEL, NEGOTIATION_LAUNCH_POLICY_VERSION } from "@wasla/contracts-negotiation";

import type { NegotiationPolicy } from "./model.js";
import { policyNotFound, policyNotFrozen } from "./errors.js";

export const LAUNCH_POLICY_VERSION = NEGOTIATION_LAUNCH_POLICY_VERSION;
export const LAUNCH_POLICY_LABEL = NEGOTIATION_LAUNCH_POLICY_LABEL;

export const SEEDED_POLICIES: readonly NegotiationPolicy[] = Object.freeze([
  Object.freeze({
    policyVersion: LAUNCH_POLICY_VERSION,
    label: LAUNCH_POLICY_LABEL,
    currency: "SAR",
    minAmountMinor: 500,
    maxAmountMinor: 500_000,
    maxRounds: 5,
    roundTtlSeconds: 120,
    threadTtlSeconds: 900,
    maxMessageLength: 1000,
    maxMessagesPerThread: 100,
    isFrozen: true,
    createdAt: "1970-01-01T00:00:00.000Z",
  }),
]) as readonly NegotiationPolicy[];

export function findSeededPolicy(policyVersion: number): NegotiationPolicy | null {
  return SEEDED_POLICIES.find((policy) => policy.policyVersion === policyVersion) ?? null;
}

/**
 * The policy a thread may be opened or advanced with.
 *
 * An unfrozen version is refused rather than used, for the reason spelled out in
 * `policyNotFrozen`: a thread whose rules can still change under it cannot be
 * explained afterwards, and «why was this refused?» is the question this whole
 * versioning scheme exists to answer.
 */
export function requireUsablePolicy(
  policy: NegotiationPolicy | null,
  policyVersion: number,
): NegotiationPolicy {
  if (policy === null) throw policyNotFound(policyVersion);
  if (!policy.isFrozen) throw policyNotFrozen(policyVersion);
  return policy;
}

/**
 * Is the round budget spent?
 *
 * Compares against `roundCount` — the number of rounds ever CREATED — and not
 * against the count of rounds still alive. An expired round consumed a turn: it
 * held the counterparty's attention for its whole TTL, and letting it be replaced
 * for free would make `max_rounds` a limit on patience rather than on time.
 */
export function roundBudgetExhausted(policy: NegotiationPolicy, roundCount: number): boolean {
  return roundCount >= policy.maxRounds;
}

/** Is the amount inside the policy's declared bounds? */
export function amountWithinBounds(policy: NegotiationPolicy, amountMinor: number): boolean {
  return amountMinor >= policy.minAmountMinor && amountMinor <= policy.maxAmountMinor;
}
