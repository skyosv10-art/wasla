/**
 * Eligibility policy — the conditions as DATA, in a numbered frozen version.
 *
 * Precedent: `matching_rulesets` (ADR-011 decision 6). The reason is not
 * flexibility, it is auditability: when someone asks in three months "why was
 * this driver eligible in August?", the answer must be readable under August's
 * rules. A hard-coded `if` in a calculator cannot answer that question, because
 * the code that made the decision no longer exists in the repository.
 *
 * These constants mirror the seed of `services/drivers/contracts/schema.sql`
 * §5 and are guarded against it by a drift test that parses the DDL defaults.
 * They live here, and not only in the database, so that the domain suite can run
 * without Postgres — the same reason `SEEDED_RULESETS` exists in matching.
 *
 * Version 1 requires THREE documents and not five: `vehicle_insurance` and
 * `vehicle_photo` are in the closed type catalogue but not required at launch.
 * Requiring a document nobody can supply yet makes every driver silently
 * ineligible, which looks exactly like a broken calculator.
 */

import type { DocumentType, EligibilityPolicy } from "./model.js";
import { policyNotFound, policyNotFrozen } from "./errors.js";

/** The launch policy. Frozen: a change is a version 2 and a migration. */
export const LAUNCH_POLICY_VERSION = 1;
export const LAUNCH_POLICY_LABEL = "saudi-launch-v1";

const LAUNCH_REQUIRED_DOCUMENTS: readonly DocumentType[] = [
  "national_id",
  "driving_license",
  "vehicle_registration",
];

export const SEEDED_POLICIES: readonly EligibilityPolicy[] = Object.freeze([
  Object.freeze({
    version: LAUNCH_POLICY_VERSION,
    label: LAUNCH_POLICY_LABEL,
    requiredDocumentsRide: Object.freeze([...LAUNCH_REQUIRED_DOCUMENTS]),
    requiredDocumentsDelivery: Object.freeze([...LAUNCH_REQUIRED_DOCUMENTS]),
    requirePrimaryVehicle: true,
    requireServiceZone: true,
    /** Zero is DECLARED, not forgotten: version 1 does not forgive. */
    documentGraceDays: 0,
    isFrozen: true,
    createdAt: "1970-01-01T00:00:00.000Z",
  }),
]) as readonly EligibilityPolicy[];

export function findSeededPolicy(version: number): EligibilityPolicy | null {
  return SEEDED_POLICIES.find((policy) => policy.version === version) ?? null;
}

/**
 * The policy a decision may be computed with.
 *
 * An unfrozen version is refused rather than used: computing against a row that
 * can still be edited produces a log entry whose `policy_version` no longer
 * describes the rules that were applied — the audit trail then lies while looking
 * complete, which is worse than having no trail at all.
 */
export function requireUsablePolicy(policy: EligibilityPolicy | null, version: number): EligibilityPolicy {
  if (policy === null) throw policyNotFound(version);
  if (!policy.isFrozen) throw policyNotFrozen(version);
  return policy;
}

/**
 * The union of documents required by the service kinds the driver actually
 * accepts — not the union of everything the policy knows.
 *
 * A delivery-only driver must not be blocked by a requirement that exists for
 * rides, and a driver who accepts both must satisfy both. The union (rather than
 * the intersection) is the fail-closed reading of "∀ accepted service kind" in
 * DRIVER_CORE.md §2.
 */
export function requiredDocumentsFor(
  policy: EligibilityPolicy,
  serviceKinds: readonly string[],
): readonly DocumentType[] {
  const required = new Set<DocumentType>();
  if (serviceKinds.includes("ride")) {
    for (const type of policy.requiredDocumentsRide) required.add(type);
  }
  if (serviceKinds.includes("delivery")) {
    for (const type of policy.requiredDocumentsDelivery) required.add(type);
  }
  // Deterministic order: the reason list is compared between two evaluations to
  // decide whether anything CHANGED, and a set iterated in insertion order would
  // make "ride+delivery" and "delivery+ride" look like different answers.
  return [...required].sort();
}
