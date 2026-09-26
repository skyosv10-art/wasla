/**
 * Support & Escalation Domain Errors (Phase 16 · ADR-049).
 *
 * The catalog is NOT redefined here: the 7 codes and their HTTP status live in
 * @wasla/contracts-support, guarded against errors.md. This file wraps them
 * in a throwable error only.
 *
 * Rules (ADR-049 §errors):
 * 1. No punitive codes — no SUBJECT_SUSPENDED, no SUBJECT_BLOCKED.
 * 2. No bad_gateway — the service consumes events, does not synchronously
 *    depend on another service's response.
 * 3. Redelivery is not an error.
 */

import {
  SUPPORT_ERROR_CODES,
  httpStatusForSupportError,
  type SupportErrorCode,
} from "@wasla/contracts-support";

export { SUPPORT_ERROR_CODES, httpStatusForSupportError };
export type { SupportErrorCode };

export class SupportError extends Error {
  readonly code: SupportErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, string>;

  constructor(
    code: SupportErrorCode,
    message: string,
    details?: Record<string, string>,
  ) {
    super(message);
    this.name = "SupportError";
    this.code = code;
    this.httpStatus = httpStatusForSupportError(code);
    this.details = details;
  }
}

export function isSupportError(error: unknown): error is SupportError {
  return error instanceof SupportError;
}

/** Pre-built error factories for common cases. */
export const supportErrors = {
  evidenceRequired: (ticketId: string) =>
    new SupportError(
      "SUPPORT_EVIDENCE_REQUIRED",
      "Cannot transition to investigating without evidence",
      { ticket_id: ticketId, constraint: "support_evidence_gate" },
    ),
  resolutionReasonRequired: (ticketId: string) =>
    new SupportError(
      "SUPPORT_RESOLUTION_REASON_REQUIRED",
      "Resolution requires a closed-list reason code",
      { ticket_id: ticketId, constraint: "support_resolution_gate" },
    ),
  invalidTransition: (from: string, to: string) =>
    new SupportError(
      "SUPPORT_INVALID_STATE_TRANSITION",
      `Invalid state transition: ${from} → ${to}`,
      { from, to, constraint: "support_no_skip" },
    ),
  ticketNotFound: (ticketId: string) =>
    new SupportError(
      "SUPPORT_TICKET_NOT_FOUND",
      "Ticket not found",
      { ticket_id: ticketId },
    ),
  ticketAlreadyClosed: (ticketId: string) =>
    new SupportError(
      "SUPPORT_TICKET_ALREADY_CLOSED",
      "Ticket is already closed",
      { ticket_id: ticketId },
    ),
  evidenceNotFound: (evidenceId: string) =>
    new SupportError(
      "SUPPORT_EVIDENCE_NOT_FOUND",
      "Evidence not found",
      { evidence_id: evidenceId },
    ),
  validationFailed: (field: string) =>
    new SupportError(
      "SUPPORT_VALIDATION_FAILED",
      "Validation failed",
      { field },
    ),
};
