/**
 * Domain errors for the Audit service.
 *
 * The catalogue is small: validation rejects an event before it is written,
 * and everything else is an internal failure. There is no "not found" —
 * the list route returns an empty page, not a 404.
 */

export type AuditErrorCode =
  | "AUDIT_INVALID_EVENT"
  | "AUDIT_INVALID_REQUEST_BODY"
  | "AUDIT_INTERNAL_ERROR";

const ERROR_HTTP_STATUS: Record<AuditErrorCode, number> = {
  AUDIT_INVALID_EVENT: 400,
  AUDIT_INVALID_REQUEST_BODY: 400,
  AUDIT_INTERNAL_ERROR: 503,
};

export class AuditError extends Error {
  readonly httpStatus: number;
  readonly traceId: string | null;

  constructor(
    readonly code: AuditErrorCode,
    message: string,
    options: { traceId?: string } = {},
  ) {
    super(message);
    this.name = "AuditError";
    this.httpStatus = ERROR_HTTP_STATUS[code];
    this.traceId = options.traceId ?? null;
  }
}
