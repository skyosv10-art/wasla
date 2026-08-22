/**
 * The document lifecycle, as a state machine with an explicit table.
 *
 * ```text
 *   (new) ──submit──▶ pending ──verify──▶ verified ──replace──▶ superseded
 *                        │                    │
 *                        └────reject────▶ rejected
 *                        └────replace───▶ superseded
 * ```
 *
 * Three properties are worth stating out loud, because each one is a bug someone
 * would otherwise write:
 *
 * 1. **There is no `expired` state.** Expiry is `expires_at` compared to an
 *    injected clock (ADR-012 decision 5). A stored `expired` state has to be
 *    written by something, and between two runs of that something the row says
 *    "verified" about a licence that ran out on Tuesday.
 *
 * 2. **`rejected` and `verified` are terminal.** A refused document is never
 *    re-reviewed in place: the driver submits a NEW document, which supersedes
 *    the old one. Re-deciding a row in place erases what the first reviewer saw,
 *    and `ck_driver_documents_review_coherence` refuses it in the database too.
 *
 * 3. **Replacement supersedes, never deletes.** An audit asks "what was accepted
 *    on the day the decision was made?", and a deleted row cannot answer.
 */

import type {
  DocumentStatus,
  DocumentType,
  DriverDocument,
  VerificationStatus,
} from "./model.js";
import { documentAlreadyReviewed, documentTransitionRefused } from "./errors.js";

/**
 * The allowed transitions, as data rather than nested `if`s.
 *
 * A table can be read, printed in a test, and compared against the CHECK
 * constraint. A chain of conditionals can only be re-read hopefully.
 */
export const DOCUMENT_TRANSITIONS: Readonly<Record<DocumentStatus, readonly DocumentStatus[]>> =
  Object.freeze({
    pending: Object.freeze(["verified", "rejected", "superseded"]),
    verified: Object.freeze(["superseded"]),
    rejected: Object.freeze(["superseded"]),
    superseded: Object.freeze([]),
  }) as Readonly<Record<DocumentStatus, readonly DocumentStatus[]>>;

export function canTransitionDocument(from: DocumentStatus, to: DocumentStatus): boolean {
  return DOCUMENT_TRANSITIONS[from].includes(to);
}

/**
 * The review gate.
 *
 * A review is only ever applied to a `pending` document. Anything else is a
 * conflict and not a validation error: the payload was fine, the world moved.
 */
export function assertReviewable(document: DriverDocument): void {
  if (document.status !== "pending") throw documentAlreadyReviewed();
}

/** The supersede gate: only a live document has anything to supersede. */
export function assertSupersedable(document: DriverDocument): void {
  if (!canTransitionDocument(document.status, "superseded")) {
    throw documentTransitionRefused(document.status, "superseded");
  }
}

/**
 * `verification_status` DERIVED from the documents, never typed by a caller.
 *
 * schema.sql §1 calls it "the result of reviewing the documents", and a result that
 * somebody has to remember to write is a result that will disagree with its inputs
 * within a week. So the review path recomputes it from the document set every time,
 * and the column is a cached projection with exactly one writer.
 *
 * It is kept SEPARATE from `status` (`active` · `suspended`) deliberately: suspending
 * a verified driver must stay visible AS a suspension, not be expressed by pushing
 * his verification back to `unverified`, which would erase why he was blocked.
 *
 * The ladder, evaluated over the REQUIRED types only — an optional paper under
 * review must not hold the whole file in `pending_review`:
 *  - `verified`       every required type has a verified live copy;
 *  - `pending_review` something required is waiting for a reviewer;
 *  - `rejected`       nothing is waiting and something required was refused — the
 *                     driver's move, not ours;
 *  - `unverified`     nothing has been submitted yet.
 */
export function deriveVerificationStatus(
  documents: readonly DriverDocument[],
  requiredTypes: readonly DocumentType[],
): VerificationStatus {
  if (requiredTypes.length === 0) {
    // Nothing is required (no service kind chosen yet), so nothing has been
    // verified. Reporting `verified` here would let `NO_SERVICE_KIND` be the only
    // thing between an empty file and eligibility.
    return "unverified";
  }
  const relevant = documents.filter((document) => requiredTypes.includes(document.documentType));
  if (relevant.length === 0) return "unverified";

  const satisfied = requiredTypes.every((type) =>
    relevant.some((document) => document.documentType === type && document.status === "verified"),
  );
  if (satisfied) return "verified";
  if (relevant.some((document) => document.status === "pending")) return "pending_review";
  if (relevant.some((document) => document.status === "rejected")) return "rejected";
  return "unverified";
}
