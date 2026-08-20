/**
 * Geography service error contract.
 *
 * Mirrors the stable error catalog in services/geography/contracts/errors.md.
 * Error codes are stable (their meaning never changes after release); new
 * codes are only ever added. Each error carries its stable `code`, its error
 * `class` (maps to an HTTP status), and a human-readable message.
 *
 * Canonical source = errors.md. If the contract changes, update this file.
 */

/** Error classes (map to HTTP status, per errors.md). */
export type GeographyErrorClass =
  | "validation_error" // 400
  | "not_found" // 404
  | "conflict" // 409
  | "unprocessable" // 422
  | "service_unavailable"; // 503

/** Stable geography error codes (per errors.md catalog). */
export type GeographyErrorCode =
  | "GEO_INVALID_PUBLIC_ID"
  | "GEO_UNSUPPORTED_LOCALE"
  | "GEO_INVALID_REQUEST_BODY"
  | "GEO_COUNTRY_NOT_FOUND"
  | "GEO_REGION_NOT_FOUND"
  | "GEO_CITY_NOT_FOUND"
  | "GEO_DISTRICT_NOT_FOUND"
  | "GEO_ZONE_NOT_FOUND"
  | "GEO_USER_LOCATION_NOT_FOUND"
  | "GEO_LOCATION_INACTIVE"
  | "GEO_INVALID_HIERARCHY"
  | "GEO_IDENTITY_NOT_FOUND"
  | "GEO_INTERNAL_ERROR";

const HTTP_BY_CLASS: Record<GeographyErrorClass, number> = {
  validation_error: 400,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  service_unavailable: 503,
};

/**
 * Typed geography domain error. Carries the stable `code` + `class` so the HTTP
 * layer (added in MR 5) can map directly without re-classifying.
 */
export class GeographyError extends Error {
  readonly code: GeographyErrorCode;
  readonly class: GeographyErrorClass;
  readonly httpStatus: number;
  readonly traceId?: string;

  constructor(
    code: GeographyErrorCode,
    message: string,
    options: { class?: GeographyErrorClass; traceId?: string } = {},
  ) {
    super(message);
    this.name = "GeographyError";
    this.code = code;
    this.class = options.class ?? classOf(code);
    this.httpStatus = HTTP_BY_CLASS[this.class];
    this.traceId = options.traceId;
  }
}

/** Default error class for a code, per the errors.md catalog. */
function classOf(code: GeographyErrorCode): GeographyErrorClass {
  switch (code) {
    case "GEO_INVALID_PUBLIC_ID":
    case "GEO_UNSUPPORTED_LOCALE":
    case "GEO_INVALID_REQUEST_BODY":
      return "validation_error";
    case "GEO_COUNTRY_NOT_FOUND":
    case "GEO_REGION_NOT_FOUND":
    case "GEO_CITY_NOT_FOUND":
    case "GEO_DISTRICT_NOT_FOUND":
    case "GEO_ZONE_NOT_FOUND":
    case "GEO_USER_LOCATION_NOT_FOUND":
    case "GEO_IDENTITY_NOT_FOUND":
      return "not_found";
    case "GEO_LOCATION_INACTIVE":
      return "conflict";
    case "GEO_INVALID_HIERARCHY":
      return "unprocessable";
    case "GEO_INTERNAL_ERROR":
      return "service_unavailable";
  }
}
