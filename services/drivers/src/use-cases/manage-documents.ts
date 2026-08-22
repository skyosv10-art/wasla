/**
 * Document writes: submit and review.
 *
 * The two halves of the only human step in this service. Everything else here is a
 * function over data; a reviewer looking at a licence is not, which is exactly why
 * the decision is recorded with WHO made it and WHEN, and why a refusal carries a
 * code the driver can be told.
 */

import type { DriverDocument } from "../domain/model.js";
import { isVehicleScopedDocument } from "../domain/model.js";
import {
  documentNotFound,
  driverNotFound,
  driverSuspended,
  idempotencyKeyReused,
  primaryVehicleRequired,
  validationFailed,
  vehicleNotFound,
  vehicleRetired,
} from "../domain/errors.js";
import {
  assertDocumentDatesShape,
  assertDocumentType,
  assertIdempotencyKey,
  assertReasonCode,
  assertReviewer,
  assertStorageRef,
} from "../domain/validation.js";
import { assertReviewable, assertSupersedable, deriveVerificationStatus } from "../domain/documents.js";
import { driverDocumentReviewed, driverDocumentSubmitted } from "../domain/events.js";
import { requiredDocumentsFor, requireUsablePolicy } from "../domain/policy.js";
import type { DriverDependencies } from "../ports.js";
import { recomputeEligibility } from "./recompute-eligibility.js";

export interface SubmitDocumentInput {
  readonly documentType: unknown;
  readonly storageRef: unknown;
  readonly idempotencyKey: unknown;
  readonly vehicleId?: string | null;
  readonly issuedAt?: string | null;
  readonly expiresAt?: string | null;
  readonly traceId?: string | null;
}

/**
 * Submit a document, superseding the live copy of the same type.
 *
 * A new version does not overwrite the old row and does not delete it: the old copy
 * becomes `superseded`, because an audit asks what was accepted on the day the
 * decision was made and a deleted row cannot answer.
 *
 * The `storageRef` is a pointer into the file store. It is validated for shape and
 * then never logged, never published in an event and never returned in an error.
 */
export async function submitDocument(
  deps: DriverDependencies,
  waslaPublicId: string,
  input: SubmitDocumentInput,
): Promise<DriverDocument> {
  const profile = await deps.profiles.find(waslaPublicId);
  if (profile === null) throw driverNotFound();
  if (profile.status === "suspended") throw driverSuspended();

  const documentType = assertDocumentType(input.documentType);
  const storageRef = assertStorageRef(input.storageRef);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const { issuedAt, expiresAt } = assertDocumentDatesShape(input.issuedAt ?? null, input.expiresAt ?? null);

  // ck_driver_documents_vehicle_scope, enforced here so the caller gets a named
  // field instead of a constraint name from a dead transaction.
  const needsVehicle = isVehicleScopedDocument(documentType);
  const vehicleId = input.vehicleId ?? null;
  if (needsVehicle && vehicleId === null) throw primaryVehicleRequired();
  if (!needsVehicle && vehicleId !== null) throw validationFailed("vehicleId", "null لوثيقة شخصية");
  if (vehicleId !== null) {
    const vehicle = await deps.vehicles.find(waslaPublicId, vehicleId);
    if (vehicle === null) throw vehicleNotFound();
    // Papers for a car that is out of service are papers nobody will ever act on,
    // and accepting them makes the driver wait for a review that cannot help him.
    if (vehicle.status === "retired") throw vehicleRetired();
  }

  const fingerprint = JSON.stringify([documentType, storageRef, vehicleId, issuedAt, expiresAt]);
  const memoryKey = `document:${waslaPublicId}:${idempotencyKey}`;
  const existing = await deps.documents.findByIdempotencyKey(waslaPublicId, idempotencyKey);
  if (existing !== null) {
    const remembered = await deps.idempotency.find(memoryKey);
    if (remembered !== null && remembered !== fingerprint) throw idempotencyKeyReused();
    return existing;
  }

  const now = deps.clock.now();
  const live = await deps.documents.findLive(waslaPublicId, documentType, vehicleId);
  if (live !== null) {
    assertSupersedable(live);
    // Superseded BEFORE the new row is created: `ux_driver_documents_one_live_per_type`
    // permits exactly one live copy, and the other order fails on Postgres while
    // passing in memory.
    await deps.documents.saveAll([{ ...live, status: "superseded", updatedAt: now }]);
  }

  const document = await deps.documents.create({
    id: deps.ids.uuid(),
    waslaPublicId,
    documentType,
    storageRef,
    vehicleId,
    issuedAt,
    expiresAt,
    idempotencyKey,
    createdAt: now,
  });

  await deps.idempotency.remember(memoryKey, fingerprint);
  await syncVerificationStatus(deps, waslaPublicId, now);
  await deps.outbox.append(
    driverDocumentSubmitted(document, {
      eventId: deps.ids.uuid(),
      occurredAt: now,
      traceId: input.traceId ?? null,
    }),
  );
  await recomputeEligibility(deps, waslaPublicId, {
    trigger: "document_submitted",
    traceId: input.traceId ?? null,
  });
  return document;
}

export interface ReviewDocumentInput {
  readonly status: "verified" | "rejected";
  readonly reviewedBy: unknown;
  readonly rejectionReasonCode?: unknown;
  readonly expiresAt?: string | null;
  readonly traceId?: string | null;
}

/**
 * Record a reviewer's decision on a pending document.
 *
 * Terminal in both directions: a reviewed document is never re-reviewed in place. A
 * driver whose paper was refused submits a NEW one, which supersedes it. Re-deciding
 * the same row would erase what the first reviewer saw, and
 * `ck_driver_documents_review_coherence` refuses it in the database as well.
 *
 * The reviewer may set or correct `expires_at` at review time — the date printed on
 * the paper is something only the person looking at it can read, and forcing the
 * driver's self-declared date to stand would let him grant himself another year.
 */
export async function reviewDocument(
  deps: DriverDependencies,
  waslaPublicId: string,
  documentId: string,
  input: ReviewDocumentInput,
): Promise<DriverDocument> {
  const profile = await deps.profiles.find(waslaPublicId);
  if (profile === null) throw driverNotFound();
  // NOTE: a suspension does NOT block a review. Reviewing is an operator action, and
  // a queue that silently refuses work on suspended files leaves papers unexamined
  // exactly for the drivers whose files are already under question.

  const document = await deps.documents.find(waslaPublicId, documentId);
  if (document === null) throw documentNotFound();
  assertReviewable(document);

  if (input.status !== "verified" && input.status !== "rejected") {
    throw validationFailed("status", "verified | rejected");
  }
  const reviewedBy = assertReviewer(input.reviewedBy);
  const rejectionReasonCode =
    input.status === "rejected" ? assertReasonCode(input.rejectionReasonCode, "rejectionReasonCode") : null;
  if (input.status === "verified" && input.rejectionReasonCode !== undefined && input.rejectionReasonCode !== null) {
    throw validationFailed("rejectionReasonCode", "null لقرار قبول");
  }

  const { expiresAt } = assertDocumentDatesShape(
    document.issuedAt,
    input.expiresAt === undefined ? document.expiresAt : input.expiresAt,
  );

  const now = deps.clock.now();
  const [reviewed] = await deps.documents.saveAll([
    {
      ...document,
      status: input.status,
      reviewedAt: now,
      reviewedBy,
      rejectionReasonCode,
      expiresAt,
      updatedAt: now,
    },
  ]);
  const row = reviewed ?? document;

  await syncVerificationStatus(deps, waslaPublicId, now);
  await deps.outbox.append(
    driverDocumentReviewed(row, {
      eventId: deps.ids.uuid(),
      occurredAt: now,
      traceId: input.traceId ?? null,
    }),
  );
  await recomputeEligibility(deps, waslaPublicId, {
    trigger: "document_reviewed",
    traceId: input.traceId ?? null,
  });
  return row;
}

/**
 * Recompute `verification_status` from the documents and store it.
 *
 * It is a cached projection with exactly one writer — this function — for the reason
 * given in `domain/documents.ts`: a summary somebody has to remember to update is a
 * summary that will disagree with its inputs.
 */
async function syncVerificationStatus(
  deps: DriverDependencies,
  waslaPublicId: string,
  at: string,
): Promise<void> {
  const profile = await deps.profiles.find(waslaPublicId);
  if (profile === null) return;
  const version = profile.eligibilityPolicyVersion;
  const policy = requireUsablePolicy(await deps.policies.find(version), version);
  const documents = await deps.documents.list(waslaPublicId);
  const derived = deriveVerificationStatus(documents, requiredDocumentsFor(policy, profile.serviceKinds));
  if (derived !== profile.verificationStatus) {
    await deps.profiles.update(waslaPublicId, { verificationStatus: derived }, at);
  }
}
