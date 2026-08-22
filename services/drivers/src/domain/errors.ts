/**
 * Driver Core error contract.
 *
 * The catalog itself is NOT redefined here: the stable codes, their classes and
 * the HTTP status derived from each class live in @wasla/contracts-driver, which
 * is drift-guarded against services/drivers/contracts/errors.md. This file only
 * wraps them in a throwable typed error, so a use case raises a contract code and
 * the HTTP layer (MR 5/6) maps it without re-classifying.
 *
 * Tests assert `code` — never the Arabic message copy.
 *
 * And the rule this service exists to protect: **ineligibility is not an error.**
 * A driver who is missing a document gets a 200 with `eligibility_state:
 * "ineligible"` and a reason list he can act on. Nothing in this file may be
 * thrown for it: an ineligible driver is a normal, expected, extremely frequent
 * state of the system, and turning it into a 4xx teaches every client to treat
 * the answer as a failure instead of reading the reasons.
 *
 * Privacy (errors.md §"ما لا يُعاد في أي خطأ"): no message and no `details` field
 * here may carry a document number, a plate number, a `storage_ref`, a phone or a
 * name. `field` names the field; it never echoes the value.
 */

import {
  DRIVER_ERROR_CODE_CLASS,
  httpStatusForDriverError,
  type DriverErrorClass,
  type DriverErrorCode,
} from "@wasla/contracts-driver";

export type { DriverErrorClass, DriverErrorCode };

/**
 * Structured, machine-readable detail carried alongside the code.
 *
 * Named optional fields rather than a free bag, precisely so that "just put the
 * value in the details" is not reachable by accident.
 */
export interface DriverErrorDetails {
  readonly field?: string;
  readonly expected?: string;
  readonly documentType?: string;
  readonly policyVersion?: number;
  readonly constraint?: string;
}

/** A domain error carrying a stable contract code. */
export class DriverError extends Error {
  readonly code: DriverErrorCode;
  readonly class: DriverErrorClass;
  readonly httpStatus: number;
  readonly traceId?: string;
  readonly details: DriverErrorDetails;

  constructor(
    code: DriverErrorCode,
    message: string,
    options: { traceId?: string; details?: DriverErrorDetails } = {},
  ) {
    super(message);
    this.name = "DriverError";
    this.code = code;
    this.class = DRIVER_ERROR_CODE_CLASS[code];
    this.httpStatus = httpStatusForDriverError(code);
    this.traceId = options.traceId;
    this.details = options.details ?? {};
  }
}

/** Narrowing helper for callers that catch broadly. */
export function isDriverError(value: unknown): value is DriverError {
  return value instanceof DriverError;
}

/** A shape rejection that names the field and never repeats its value. */
export function validationFailed(field: string, expected: string): DriverError {
  return new DriverError("DRIVER_VALIDATION_FAILED", `حقل غير صالح: ${field}`, {
    details: { field, expected },
  });
}

export function idempotencyKeyRequired(): DriverError {
  return new DriverError(
    "DRIVER_IDEMPOTENCY_KEY_REQUIRED",
    "مفتاح المعالجة الواحدة مطلوب لهذه الكتابة",
    { details: { field: "idempotencyKey" } },
  );
}

export function driverNotFound(): DriverError {
  return new DriverError("DRIVER_NOT_FOUND", "لا يوجد ملفّ سائق بهذا المعرّف");
}

export function driverAlreadyExists(): DriverError {
  return new DriverError("DRIVER_ALREADY_EXISTS", "يوجد ملفّ سائق بهذا المعرّف مسبقاً");
}

export function vehicleNotFound(): DriverError {
  return new DriverError("DRIVER_VEHICLE_NOT_FOUND", "لا توجد مركبة بهذا المعرّف لهذا السائق");
}

export function documentNotFound(): DriverError {
  return new DriverError("DRIVER_DOCUMENT_NOT_FOUND", "لا توجد وثيقة بهذا المعرّف لهذا السائق");
}

export function policyNotFound(version: number): DriverError {
  return new DriverError("DRIVER_POLICY_NOT_FOUND", "نسخة سياسة الأهليّة غير معروفة", {
    details: { policyVersion: version },
  });
}

export function zoneUnknown(field = "zoneIds"): DriverError {
  return new DriverError("DRIVER_ZONE_UNKNOWN", "نطاق غير معروف في شجرة الجغرافيا", {
    details: { field },
  });
}

export function unknownDocumentType(): DriverError {
  return new DriverError("DRIVER_DOCUMENT_TYPE_UNKNOWN", "نوع وثيقة غير معروف", {
    details: { field: "documentType" },
  });
}

export function unknownVehicleClass(): DriverError {
  return new DriverError("DRIVER_VEHICLE_CLASS_UNKNOWN", "صنف مركبة غير معروف", {
    details: { field: "vehicleClass" },
  });
}

export function unknownServiceKind(): DriverError {
  return new DriverError("DRIVER_SERVICE_KIND_UNKNOWN", "نوع خدمة غير معروف", {
    details: { field: "serviceKinds" },
  });
}

export function idempotencyKeyReused(): DriverError {
  return new DriverError(
    "DRIVER_IDEMPOTENCY_KEY_REUSED",
    "مفتاح المعالجة الواحدة مستخدم بحمولة مختلفة",
    { details: { field: "idempotencyKey" } },
  );
}

/**
 * Refused transitions.
 *
 * Each carries `constraint`: the name of the database constraint that would have
 * refused the same write, so a reader can find the second line of defence instead
 * of assuming the rule lives only in TypeScript. When the two disagree, the
 * database wins and the bug is here.
 */
export function documentAlreadyReviewed(): DriverError {
  return new DriverError(
    "DRIVER_DOCUMENT_ALREADY_REVIEWED",
    "لا تُراجَع وثيقة صدر فيها قرار: النسخة الجديدة وثيقة جديدة",
    { details: { constraint: "ck_driver_documents_review_coherence" } },
  );
}

/**
 * A refused document transition other than a double review.
 *
 * It reuses `DRIVER_DOCUMENT_ALREADY_REVIEWED` deliberately: the published error
 * catalogue (MR 1/6) has exactly one document-conflict code, and this path is not
 * reachable from the API — the submit path only ever supersedes a document it
 * just selected as live. Adding a code to a published contract for an unreachable
 * branch buys a client-visible change and no information, so the refused
 * transition is named in `expected` instead.
 */
export function documentTransitionRefused(from: string, to: string): DriverError {
  return new DriverError(
    "DRIVER_DOCUMENT_ALREADY_REVIEWED",
    "انتقال غير مسموح لحالة الوثيقة",
    { details: { expected: `${from} ↛ ${to}`, constraint: "ux_driver_documents_one_live_per_type" } },
  );
}

/** An expiry date that contradicts the issue date, or a date-shaped non-date. */
export function documentExpiryInvalid(field = "expiresAt"): DriverError {
  return new DriverError(
    "DRIVER_DOCUMENT_EXPIRY_INVALID",
    "تاريخ انتهاء الوثيقة غير متّسق مع تاريخ إصدارها",
    { details: { field, constraint: "ck_driver_documents_dates" } },
  );
}

/** Writing to, or through, a retired vehicle. */
export function vehicleRetired(): DriverError {
  return new DriverError("DRIVER_VEHICLE_RETIRED", "المركبة مُخرَجة من الخدمة", {
    details: { constraint: "ck_driver_vehicles_retired_not_primary" },
  });
}

/** A vehicle-scoped document with no vehicle to scope it to. */
export function primaryVehicleRequired(): DriverError {
  return new DriverError(
    "DRIVER_PRIMARY_VEHICLE_REQUIRED",
    "هذه العملية تحتاج مركبة أساسية عاملة",
    { details: { constraint: "ux_driver_vehicles_one_primary" } },
  );
}

/**
 * The write path is closed while a profile is suspended (§7).
 *
 * Not because the data would be wrong, but because a suspended driver editing
 * his file looks like progress to him while nothing he does can lift the
 * suspension — only an operator can.
 */
export function driverSuspended(): DriverError {
  return new DriverError("DRIVER_SUSPENDED", "الملفّ موقوف: لا تُقبل هذه العملية أثناء الإيقاف");
}

export function driverNotSuspended(): DriverError {
  return new DriverError("DRIVER_NOT_SUSPENDED", "الملفّ غير موقوف: لا شيء يُرفع عنه");
}

export function policyNotFrozen(version: number): DriverError {
  return new DriverError(
    "DRIVER_POLICY_NOT_FROZEN",
    "لا يُحسَب قرار بنسخة سياسة غير مُجمَّدة",
    { details: { policyVersion: version, constraint: "is_frozen" } },
  );
}

/**
 * The projection write into matching failed.
 *
 * A 502 and not a 500: the local state change SUCCEEDED and was persisted, and
 * what failed is our push to a service behind us (ADR-012 decision 3). Reporting
 * it as our own failure would invite the caller to retry a write that already
 * happened.
 */
export function candidacyPublishFailed(): DriverError {
  return new DriverError(
    "DRIVER_CANDIDACY_PUBLISH_FAILED",
    "تعذّر نشر إسقاط الترشيح إلى خدمة المطابقة",
  );
}
