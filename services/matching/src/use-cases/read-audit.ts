/**
 * The audit reads: one decision, and the ruleset catalogue.
 *
 * `readDecision` is the ONLY path on which candidate ids and scores are returned
 * (ADR-011 decision 8). It is an operations path: it answers "why this driver and
 * not that one?" a month later, and it is never handed to a customer or a driver.
 * Whoever exposes it over HTTP in MR 5/6 keeps it that way.
 *
 * `listRulesets`, by contrast, is deliberately public information: whoever asks
 * "why were the drivers ordered like this?" should read the version, not the code.
 */

import { decisionNotFound } from "../domain/errors.js";
import type { MatchingDecision, Ruleset } from "../domain/model.js";
import { assertUuid } from "../domain/validation.js";
import type { MatchingDependencies } from "../ports.js";

export async function readDecision(
  deps: MatchingDependencies,
  decisionId: string,
  traceId?: string,
): Promise<MatchingDecision> {
  const id = assertUuid(decisionId, "decisionId", traceId);
  const decision = await deps.decisions.find(id);
  // Decisions are append-only: absence means a wrong id, never a deleted row.
  if (decision === null) throw decisionNotFound(traceId);
  return decision;
}

export async function listRulesets(deps: MatchingDependencies): Promise<Ruleset[]> {
  return deps.rulesets.list();
}
