/**
 * Identity service error contract.
 *
 * Mirrors the stable error catalog in services/identity/contracts/errors.md.
 * Error codes are stable (their meaning never changes after release); new
 * codes are only ever added. Each error carries its stable `code`, its error
 * `class` (maps to an HTTP status), and a human-readable message.
 *
 * Canonical source = errors.md. If the contract changes, update this file.
 */

/** Error classes (map to HTTP status, per errors.md). */
export type IdentityErrorClass =
  | "validation_error" // 400
  | "not_found" // 404
  | "conflict" // 409
  | "unprocessable" // 422
  | "service_unavailable"; // 503

/** Stable identity error codes (per errors.md catalog). */
export type IdentityErrorCode =
  | "IDENTITY_INVALID_PUBLIC_ID"
  | "IDENTITY_MISSING_TELEGRAM_ID"
  | "IDENTITY_NOT_FOUND"
  | "IDENTITY_LINK_ALREADY_LINKED"
  | "IDENTITY_LINK_INVALID_PROVIDER"
  | "IDENTITY_USERNAME_NO_CHANGE"
  | "IDENTITY_RECOVERY_METHOD_INVALID"
  | "IDENTITY_USER_SUSPENDED"
  // جلساتُ البشر (M1-02 · ADR-019)
  | "IDENTITY_SESSION_REPLAY"
  | "IDENTITY_SESSION_NOT_FOUND"
  | "IDENTITY_INTERNAL_ERROR";

const HTTP_BY_CLASS: Record<IdentityErrorClass, number> = {
  validation_error: 400,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  service_unavailable: 503,
};

/**
 * Typed identity domain error. Carries the stable `code` + `class` so the HTTP
 * layer (added in a later MR) can map directly without re-classifying.
 */
export class IdentityError extends Error {
  readonly code: IdentityErrorCode;
  readonly class: IdentityErrorClass;
  readonly httpStatus: number;
  readonly traceId?: string;

  constructor(
    code: IdentityErrorCode,
    message: string,
    options: { class: IdentityErrorClass; traceId?: string } = {
      class: classOf(code),
    },
  ) {
    super(message);
    this.name = "IdentityError";
    this.code = code;
    this.class = options.class;
    this.httpStatus = HTTP_BY_CLASS[this.class];
    this.traceId = options.traceId;
  }
}

/** Default error class for a code, per the errors.md catalog. */
function classOf(code: IdentityErrorCode): IdentityErrorClass {
  switch (code) {
    case "IDENTITY_INVALID_PUBLIC_ID":
    case "IDENTITY_MISSING_TELEGRAM_ID":
      return "validation_error";
    case "IDENTITY_NOT_FOUND":
      return "not_found";
    case "IDENTITY_LINK_ALREADY_LINKED":
    case "IDENTITY_USER_SUSPENDED":
    // إعادةُ استعمالِ init-data ليست خطأً في المُدخَلِ بل تعارضٌ مع واقعٍ
    // مُسجَّلٍ: هذه الرسالةُ استُعمِلت مرّةً. و409 تقول ذلك بلا أن تُفصِح
    // للمهاجمِ عن سببٍ أدقّ.
    case "IDENTITY_SESSION_REPLAY":
      return "conflict";
    case "IDENTITY_SESSION_NOT_FOUND":
      return "not_found";
    case "IDENTITY_LINK_INVALID_PROVIDER":
    case "IDENTITY_USERNAME_NO_CHANGE":
    case "IDENTITY_RECOVERY_METHOD_INVALID":
      return "unprocessable";
    case "IDENTITY_INTERNAL_ERROR":
      return "service_unavailable";
  }
}
