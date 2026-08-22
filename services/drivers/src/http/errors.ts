/**
 * The one place a thrown error becomes an HTTP answer (Phase 05 · MR 4/6).
 *
 * ## The shape is NESTED here, and that is the contract's choice not a style drift
 *
 * `services/dispatch` and `services/customers` answer flat — `{code, message,
 * trace_id}`. Driver Core answers `{error: {code, message, details?}, trace_id}`
 * because `ErrorResponse` in `contracts/api.openapi.yml` declares it that way, and
 * `contracts/errors.md` repeats it in the first paragraph. Copying the neighbouring
 * service's shape would have been the more comfortable mistake: it compiles, the tests
 * a copier writes pass, and the break appears in a consumer we have not written yet.
 * The published contract outranks local consistency.
 *
 * ## Why no error is re-classified here
 *
 * The status comes from `DriverError.httpStatus`, which comes from the code's class in
 * `@wasla/contracts-driver`, which is drift-guarded against `errors.md`. This file
 * therefore cannot disagree with the catalogue about what a code means — the only way
 * to change a status is to change the class, in the one file that owns it.
 *
 * ## The two errors that are NOT ours
 *
 * Fastify raises `400`/`415` itself for a malformed or wrongly-typed body, before any
 * handler runs. Those become `DRIVER_VALIDATION_FAILED`, because from the caller's
 * side "your JSON is broken" is the same instruction as "your field is invalid".
 *
 * Everything else unclassified becomes `DRIVER_UNAVAILABLE` (503) and NOT a 500: an
 * unrecognised throw in this service is, in practice, a port that failed — the pool,
 * the zone catalogue, the outbox. `503` tells the caller retrying may work, which is
 * true, and it keeps `500` meaning "we have a bug we do not understand yet".
 *
 * Fastify's own route-level `404` is deliberately left in Fastify's shape and NOT
 * mapped to `DRIVER_NOT_FOUND`: "there is no such route" and "there is no driver with
 * that id" are different facts, and a client that retries the second on the first
 * will retry forever.
 */

import type { FastifyReply } from "fastify";

import { isDriverError, type DriverErrorDetails } from "../domain/errors.js";

export interface DriverErrorWireDetails {
  readonly field?: string;
  readonly expected?: string;
  readonly document_type?: string;
  readonly policy_version?: number;
  readonly constraint?: string;
}

export interface DriverErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: DriverErrorWireDetails;
  };
  readonly trace_id: string;
}

/**
 * `DriverErrorDetails` (camelCase, domain) → the declared `details` keys (snake_case).
 *
 * Written key by key rather than with a generic camel→snake conversion, because the
 * contract's `details` object is `additionalProperties: false` with a counted list of
 * properties: a generic converter would happily forward a new domain detail field the
 * day someone adds one, and the response would fail a strict client's validation
 * while our logs show `200`-shaped success. An explicit list fails to compile instead.
 *
 * Absent rather than `undefined`-valued: `JSON.stringify` drops `undefined`, but an
 * empty `details: {}` would still be sent, and an empty object in an error body reads
 * as "we know something and will not say it".
 */
export function toWireDetails(details: DriverErrorDetails): DriverErrorWireDetails | undefined {
  const wire: Record<string, string | number> = {};
  if (details.field !== undefined) wire.field = details.field;
  if (details.expected !== undefined) wire.expected = details.expected;
  if (details.documentType !== undefined) wire.document_type = details.documentType;
  if (details.policyVersion !== undefined) wire.policy_version = details.policyVersion;
  if (details.constraint !== undefined) wire.constraint = details.constraint;
  return Object.keys(wire).length === 0 ? undefined : (wire as DriverErrorWireDetails);
}

function isMalformedRequest(error: unknown): boolean {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 400 || statusCode === 415;
}

export function sendDriverError(reply: FastifyReply, error: unknown, traceId: string): void {
  if (isDriverError(error)) {
    const details = toWireDetails(error.details);
    reply.status(error.httpStatus).send({
      error: details === undefined
        ? { code: error.code, message: error.message }
        : { code: error.code, message: error.message, details },
      // `error.traceId` when the domain was told the trace, otherwise the request's:
      // one answer always carries a trace, because the first question about a failed
      // write is which attempt it was.
      trace_id: error.traceId ?? traceId,
    } satisfies DriverErrorBody);
    return;
  }
  if (isMalformedRequest(error)) {
    reply.status(400).send({
      error: { code: "DRIVER_VALIDATION_FAILED", message: "جسم الطلب غير صالح", details: { field: "body" } },
      trace_id: traceId,
    } satisfies DriverErrorBody);
    return;
  }
  reply.status(503).send({
    error: { code: "DRIVER_UNAVAILABLE", message: "منفذ إلزامي غير متاح" },
    trace_id: traceId,
  } satisfies DriverErrorBody);
}
