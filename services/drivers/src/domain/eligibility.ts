/**
 * The eligibility calculator — the whole reason this service exists.
 *
 * A pure function of `(snapshot, policy, now)`. No clock read, no store read, no
 * randomness, no I/O: given the same three inputs it returns the same answer
 * forever, which is what makes the `driver_eligibility_log` row reproducible and
 * what lets a test move time forward without waiting.
 *
 * It implements DRIVER_CORE.md §2 literally, and a drift test reads that formal
 * block from disk and fails if the document and this file part ways.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * DECISION: this calculator returns **all** the reasons, not the first one.
 * ───────────────────────────────────────────────────────────────────────────
 * The Phase 05 MR plan said "first cause wins", copying `services/matching`. That
 * is right for matching and wrong here, and the difference is who reads the
 * answer:
 *  - matching evaluates thousands of rows to answer one dispatcher's question,
 *    so one cause per rejected row is enough and cheaper;
 *  - driver core answers ONE driver about HIMSELF. A driver told only
 *    `DOCUMENT_MISSING` uploads one paper, waits for review, and is refused again
 *    for the zone he was never told about. Repeat three times and he stops
 *    trying — which is the failure this service is supposed to prevent.
 * So the reason list is the complete, ordered, deduped checklist.
 *
 * THE ONE EXCEPTION: `PROFILE_SUSPENDED` short-circuits and is returned alone.
 * Listing missing documents beside a suspension tells the driver that documents
 * will lift it. They will not — only an operator can — and a driver who spends a
 * week supplying papers against a suspension has been actively misled by us.
 *
 * ORDER IS PART OF THE CONTRACT: the codes are emitted in the published order of
 * `ELIGIBILITY_REASON_CODES` (a single list, not a second one maintained here).
 * That order is not cosmetic: `reasons` goes into an append-only log row and into
 * `drivers.eligibility_changed`, and change detection compares the previous
 * reasons with the new ones. A set iterated in insertion order would make the
 * same state look different between two runs and emit an event for nothing.
 */

import { ELIGIBILITY_REASON_CODES } from "@wasla/contracts-driver";

import type {
  DocumentType,
  DriverDocument,
  DriverSnapshot,
  EligibilityPolicy,
  EligibilityReasonCode,
  EligibilityState,
  ServiceKind,
  Vehicle,
} from "./model.js";
import { isVehicleScopedDocument } from "./model.js";
import { requiredDocumentsFor } from "./policy.js";

const MS_PER_DAY = 86_400_000;

/**
 * Reporting order = the published catalogue order.
 *
 * Deliberately derived rather than restated: two orderings of nine codes in two
 * files is a divergence waiting for its first reader.
 */
export const REASON_REPORT_ORDER: readonly EligibilityReasonCode[] = ELIGIBILITY_REASON_CODES;

/**
 * One unsatisfied condition, with the item it is about.
 *
 * The API contract carries only `reason_codes: string[]`, so nine codes have to
 * cover any number of documents; `DOCUMENT_MISSING` twice would be noise. The
 * deficits keep the per-document detail for the log, for support, and for the
 * documents endpoint — the codes are the CLASS of the action needed, the deficits
 * are the items.
 */
export interface EligibilityDeficit {
  readonly code: EligibilityReasonCode;
  readonly documentType?: DocumentType;
}

export interface EligibilityDecision {
  readonly state: EligibilityState;
  /** Ordered, deduped, and never empty unless the state is `eligible`. */
  readonly reasonCodes: readonly EligibilityReasonCode[];
  readonly deficits: readonly EligibilityDeficit[];
  readonly policyVersion: number;
  readonly evaluatedAt: string;
  /**
   * The earliest FUTURE instant at which this answer could change with nobody
   * doing anything — i.e. the next document expiry (plus the policy's grace).
   * `null` when no verified document has an expiry date.
   */
  readonly recheckAt: string | null;
}

/** The state matching sees for a driver who has no profile here yet: fail-closed. */
export function unknownEligibility(policyVersion: number, evaluatedAt: string): EligibilityDecision {
  return {
    state: "unknown",
    // `unknown` is NOT "not checked yet, give him a chance" — it is "we do not
    // know, so nothing is offered to him". It carries no reason codes because
    // there is no profile to have a deficiency.
    reasonCodes: [],
    deficits: [],
    policyVersion,
    evaluatedAt,
    recheckAt: null,
  };
}

/** The active primary vehicle, if there is exactly one usable one. */
export function findPrimaryVehicle(vehicles: readonly Vehicle[]): Vehicle | null {
  return vehicles.find((vehicle) => vehicle.isPrimary && vehicle.status === "active") ?? null;
}

/** `pending` and `verified` are live; `rejected` and `superseded` are history. */
export function isLiveDocument(document: DriverDocument): boolean {
  return document.status === "pending" || document.status === "verified";
}

/**
 * A DATE column read as the instant `T00:00:00Z`.
 *
 * The service has no timezone of its own — zones here are geography, not clocks
 * (ADR-006) — so "end of the expiry day" would need a timezone this service is
 * not entitled to pick. Comparing the date as a UTC instant is a rule any reader
 * can reproduce, and it errs early rather than late: fail-closed, consistently
 * with everything else in this file. The lever for tolerance is
 * `document_grace_days` in a new policy version, which is exactly where a
 * business decision about leniency belongs.
 */
export function expiryInstant(expiresAt: string): number {
  return Date.parse(`${expiresAt}T00:00:00.000Z`);
}

/**
 * Is a verified document still within its validity, given the policy's grace?
 *
 * DRIVER_CORE.md §2: `expires_at IS NULL ∨ expires_at > now − grace_days`.
 * A document with no expiry date never expires; that is data, and the reviewer
 * who accepted it without one made that decision knowingly.
 */
export function isWithinValidity(
  document: DriverDocument,
  policy: EligibilityPolicy,
  nowMs: number,
): boolean {
  if (document.expiresAt === null) return true;
  return expiryInstant(document.expiresAt) > nowMs - policy.documentGraceDays * MS_PER_DAY;
}

/**
 * The single most actionable reason for one required document type.
 *
 * Precedence — **expired, then pending, then rejected, then missing** — is ordered
 * by what the driver has to DO, not by severity.
 *
 * `pending` outranks `rejected` deliberately, even though a refusal sounds worse:
 * the one-live-per-type index allows a pending copy to exist beside an older
 * rejected one, and in that state the driver has already done his part and has
 * nothing to do but wait. Telling him "rejected" would send him to upload a
 * replacement the index then refuses, and he would read that refusal as the system
 * being broken. `missing` is last for the same reason: it is what we say only when
 * there is nothing of that type at all, since telling a waiting driver "missing"
 * invites exactly the same duplicate upload.
 */
function documentDeficit(
  type: DocumentType,
  documents: readonly DriverDocument[],
  policy: EligibilityPolicy,
  nowMs: number,
): EligibilityDeficit | null {
  const ofType = documents.filter((document) => document.documentType === type);
  const verified = ofType.find((document) => document.status === "verified");
  if (verified !== undefined) {
    if (isWithinValidity(verified, policy, nowMs)) return null;
    return { code: "DOCUMENT_EXPIRED", documentType: type };
  }
  if (ofType.some((document) => document.status === "pending")) {
    return { code: "DOCUMENT_PENDING", documentType: type };
  }
  if (ofType.some((document) => document.status === "rejected")) {
    return { code: "DOCUMENT_REJECTED", documentType: type };
  }
  return { code: "DOCUMENT_MISSING", documentType: type };
}

/**
 * The documents that count for a decision, scoped the way the database scopes
 * them (`ux_driver_documents_one_live_per_type`).
 *
 * Vehicle-scoped documents are matched against the PRIMARY vehicle only. Without
 * this, a driver keeps a verified registration on the car he retired last month
 * and stays eligible on a car nobody ever checked — a verified document
 * attributed to the wrong object is worse than a missing one, because it looks
 * like diligence.
 *
 * When there is no primary vehicle, vehicle-scoped requirements are NOT reported
 * as missing documents: the deficiency is `NO_PRIMARY_VEHICLE`, and adding
 * "registration missing" beside it points the driver at a paper he cannot
 * meaningfully supply yet.
 */
function relevantDocuments(
  documents: readonly DriverDocument[],
  primaryVehicle: Vehicle | null,
  type: DocumentType,
): readonly DriverDocument[] {
  if (!isVehicleScopedDocument(type)) {
    return documents.filter((document) => document.vehicleId === null);
  }
  if (primaryVehicle === null) return [];
  return documents.filter((document) => document.vehicleId === primaryVehicle.id);
}

/**
 * The next instant at which time alone could change the answer.
 *
 * Computed over every verified document that has an expiry, required or not: an
 * extra recheck costs one evaluation, while a missed one keeps an unqualified
 * driver eligible until somebody notices. Flip instants already in the past are
 * skipped — their change is what THIS evaluation just recorded, and returning one
 * would make the tick pick the same driver forever.
 */
export function nextRecheckAt(
  documents: readonly DriverDocument[],
  policy: EligibilityPolicy,
  nowMs: number,
): string | null {
  const graceMs = policy.documentGraceDays * MS_PER_DAY;
  let earliest: number | null = null;
  for (const document of documents) {
    if (document.status !== "verified" || document.expiresAt === null) continue;
    const flipsAt = expiryInstant(document.expiresAt) + graceMs;
    if (flipsAt <= nowMs) continue;
    if (earliest === null || flipsAt < earliest) earliest = flipsAt;
  }
  return earliest === null ? null : new Date(earliest).toISOString();
}

/** Order by the published catalogue, then dedupe. Never the other way round. */
function orderedCodes(deficits: readonly EligibilityDeficit[]): readonly EligibilityReasonCode[] {
  const present = new Set(deficits.map((deficit) => deficit.code));
  return REASON_REPORT_ORDER.filter((code) => present.has(code));
}

/**
 * eligibility(driver, policy, now) — DRIVER_CORE.md §2.
 *
 * `now` is injected, never read: a calculator that calls `Date.now()` cannot be
 * tested for expiry without waiting for a real month to pass, and a test that
 * cannot be written is a rule that is not enforced.
 */
export function evaluateEligibility(
  snapshot: DriverSnapshot,
  policy: EligibilityPolicy,
  now: string,
): EligibilityDecision {
  const nowMs = Date.parse(now);
  const { profile, zones, vehicles, documents } = snapshot;
  const recheckAt = nextRecheckAt(documents, policy, nowMs);

  // Suspension overrides everything and is returned ALONE — see the header.
  if (profile.status === "suspended") {
    return {
      state: "suspended",
      reasonCodes: ["PROFILE_SUSPENDED"],
      deficits: [{ code: "PROFILE_SUSPENDED" }],
      policyVersion: policy.version,
      evaluatedAt: now,
      recheckAt,
    };
  }

  const primaryVehicle = findPrimaryVehicle(vehicles);
  const liveDocuments = documents.filter(isLiveDocument);
  // Rejected documents stay visible to the per-type precedence above, so that a
  // driver whose paper was refused is told REJECTED and not MISSING.
  const decidedDocuments = documents.filter((document) => document.status === "rejected");
  const considered = [...liveDocuments, ...decidedDocuments];

  const deficits: EligibilityDeficit[] = [];

  // Structural conditions, in the order of the formal definition.
  if (policy.requirePrimaryVehicle && primaryVehicle === null) {
    deficits.push({ code: "NO_PRIMARY_VEHICLE" });
  }
  if (policy.requireServiceZone && zones.length === 0) deficits.push({ code: "NO_SERVICE_ZONE" });
  if (profile.serviceKinds.length === 0) deficits.push({ code: "NO_SERVICE_KIND" });

  // Document conditions, per accepted service kind. With no service kind the
  // required set is empty by construction: we cannot say which papers are needed
  // for work the driver has not agreed to do, and `NO_SERVICE_KIND` above is the
  // one action that unblocks the question.
  const required = requiredDocumentsFor(policy, profile.serviceKinds as readonly ServiceKind[]);
  for (const type of required) {
    if (isVehicleScopedDocument(type) && primaryVehicle === null) continue;
    const deficit = documentDeficit(type, relevantDocuments(considered, primaryVehicle, type), policy, nowMs);
    if (deficit !== null) deficits.push(deficit);
  }

  // `PROFILE_NOT_VERIFIED` is a FALLBACK, not a parallel reason.
  //
  // `verification_status` is derived from the document review process
  // (`deriveVerificationStatus`), so whenever it is not `verified` there is almost
  // always a specific document reason already in the list. Emitting both would
  // hand the driver a checklist whose first line — "your file is not verified" — he
  // can do nothing about, ahead of the lines he can. It IS emitted when nothing
  // more specific was found, which is what keeps the promise that an `ineligible`
  // verdict never carries an empty reason list: an administratively `rejected`
  // file whose papers are all in order still has to say something.
  if (profile.verificationStatus !== "verified" && deficits.length === 0) {
    deficits.push({ code: "PROFILE_NOT_VERIFIED" });
  }

  // No deficit left implies `verification_status = 'verified'`, because the
  // fallback above would otherwise have added one.
  if (deficits.length === 0) {
    return {
      state: "eligible",
      reasonCodes: [],
      deficits: [],
      policyVersion: policy.version,
      evaluatedAt: now,
      recheckAt,
    };
  }

  return {
    state: "ineligible",
    reasonCodes: orderedCodes(deficits),
    deficits,
    policyVersion: policy.version,
    evaluatedAt: now,
    recheckAt,
  };
}

/**
 * Did anything change since the last recorded decision?
 *
 * State AND reasons, because a driver moving from "missing licence" to "licence
 * pending review" stays `ineligible` while the only thing he cares about — what
 * to do next — has changed. Comparing state alone would keep that silent.
 * The reason arrays are compared in order, which is safe precisely because
 * `orderedCodes` makes the order a function of the content.
 */
export function eligibilityChanged(
  previousState: EligibilityState | null,
  previousReasons: readonly EligibilityReasonCode[],
  decision: EligibilityDecision,
): boolean {
  if (previousState !== decision.state) return true;
  if (previousReasons.length !== decision.reasonCodes.length) return true;
  return previousReasons.some((code, index) => code !== decision.reasonCodes[index]);
}
