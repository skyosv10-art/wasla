/**
 * Shape validation — the first gate of every use case.
 *
 * Shape before state, always: a request whose `order_public_id` is malformed must
 * be refused as a validation error even when the job it names is also in a state
 * that would refuse it. Otherwise the error the caller sees depends on which
 * check happens to run first, and a client cannot tell "fix your payload" apart
 * from "try later". The check order in each use case is a tested contract.
 *
 * Nothing here echoes the rejected value back; `errors.md` forbids it.
 */
import { createHash } from "node:crypto";

import {
  CANCEL_REQUEST_REASON_CODES,
  DISPATCH_ORDER_TYPES,
  DISPATCH_REASON_CODES,
  DISPATCH_VEHICLE_CLASSES,
  DRIVER_PUBLIC_ID_PATTERN,
  DRIVER_REJECTION_REASON_CODES,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  ORDER_PUBLIC_ID_PATTERN,
  REASON_CODE_MAX_LENGTH,
  REASON_CODE_MIN_LENGTH,
  type DispatchReasonCode,
  type DispatchRules,
  type OrderType,
  type VehicleClass,
} from "./model.js";
import { reasonCodeUnknown, validationFailed } from "./errors.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(field: string, value: unknown, traceId?: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw validationFailed(field, "uuid", traceId);
  }
  return value;
}

export function assertOrderPublicId(value: unknown, traceId?: string): string {
  if (typeof value !== "string" || !ORDER_PUBLIC_ID_PATTERN.test(value)) {
    throw validationFailed("order_public_id", "ORD-########## (10 digits)", traceId);
  }
  return value;
}

export function assertDriverPublicId(value: unknown, traceId?: string): string {
  if (typeof value !== "string" || !DRIVER_PUBLIC_ID_PATTERN.test(value)) {
    throw validationFailed("driver_public_id", "WS-########## (10 digits)", traceId);
  }
  return value;
}

export function assertOrderType(value: unknown, traceId?: string): OrderType {
  if (typeof value !== "string" || !DISPATCH_ORDER_TYPES.includes(value as OrderType)) {
    throw validationFailed("order_type", DISPATCH_ORDER_TYPES.join(" | "), traceId);
  }
  return value as OrderType;
}

export function assertVehicleClass(value: unknown, traceId?: string): VehicleClass {
  if (typeof value !== "string" || !DISPATCH_VEHICLE_CLASSES.includes(value as VehicleClass)) {
    throw validationFailed("vehicle_class", DISPATCH_VEHICLE_CLASSES.join(" | "), traceId);
  }
  return value as VehicleClass;
}

/**
 * An ISO-8601 instant in UTC.
 *
 * Refuses anything `Date` cannot parse, and refuses a parsable string that is not
 * the canonical form, because a timestamp that round-trips differently than it
 * arrived turns "did the deadline pass" into a question about string formats.
 */
export function assertInstant(field: string, value: unknown, traceId?: string): string {
  if (typeof value !== "string") throw validationFailed(field, "ISO-8601 instant", traceId);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw validationFailed(field, "ISO-8601 instant", traceId);
  if (new Date(parsed).toISOString() !== value) {
    throw validationFailed(field, "ISO-8601 instant in canonical UTC form", traceId);
  }
  return value;
}

/** Every write needs an idempotency key (§43); whitespace counts as absent. */
export function assertIdempotencyKey(value: unknown, traceId?: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationFailed("Idempotency-Key", "non-empty string", traceId);
  }
  if (value.length < IDEMPOTENCY_KEY_MIN_LENGTH || value.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw validationFailed(
      "Idempotency-Key",
      `${IDEMPOTENCY_KEY_MIN_LENGTH}..${IDEMPOTENCY_KEY_MAX_LENGTH} characters`,
      traceId,
    );
  }
  return value;
}

export function isKnownReasonCode(value: string): value is DispatchReasonCode {
  return (DISPATCH_REASON_CODES as readonly string[]).includes(value);
}

/** A reason code from the closed catalog, within the column's length bounds. */
export function assertReasonCode(field: string, value: unknown, traceId?: string): DispatchReasonCode {
  if (typeof value !== "string") throw validationFailed(field, "reason code", traceId);
  if (value.length < REASON_CODE_MIN_LENGTH || value.length > REASON_CODE_MAX_LENGTH) {
    throw validationFailed(field, `${REASON_CODE_MIN_LENGTH}..${REASON_CODE_MAX_LENGTH} characters`, traceId);
  }
  // Not a shape problem: the string is well-formed and simply is not a code we know, and
  // the contract has a dedicated 422 for exactly that.
  if (!isKnownReasonCode(value)) {
    throw reasonCodeUnknown(field, traceId, DISPATCH_REASON_CODES);
  }
  return value;
}

/** The three codes a driver may send. A wider set would let an app write analytics. */
export function assertDriverRejectionReasonCode(value: unknown, traceId?: string): DispatchReasonCode {
  const code = assertReasonCode("reason_code", value, traceId);
  if (!DRIVER_REJECTION_REASON_CODES.includes(code)) {
    throw reasonCodeUnknown("offer_rejected", traceId, DRIVER_REJECTION_REASON_CODES);
  }
  return code;
}

/** The three codes a requester may send when cancelling a job. */
export function assertCancelReasonCode(value: unknown, traceId?: string): DispatchReasonCode {
  const code = assertReasonCode("reason_code", value, traceId);
  if (!CANCEL_REQUEST_REASON_CODES.includes(code)) {
    throw reasonCodeUnknown("job_cancelled", traceId, CANCEL_REQUEST_REASON_CODES);
  }
  return code;
}

/**
 * The rules snapshot, validated against the same lower bounds as `schema.sql`.
 *
 * Validated even though it comes from our own configuration rather than a client:
 * a deploy that ships `offer_timeout_seconds: 0` would make every offer expire in
 * the same tick it was sent, and every driver would see a dead offer with nobody
 * able to name the cause.
 */
export function assertRules(value: unknown, traceId?: string): DispatchRules {
  if (typeof value !== "object" || value === null) throw validationFailed("rules", "object", traceId);
  const raw = value as Record<string, unknown>;
  const positiveInt = (field: string, minimum: number): number => {
    const candidate = raw[field];
    if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < minimum) {
      throw validationFailed(`rules.${field}`, `integer >= ${minimum}`, traceId);
    }
    return candidate;
  };
  return {
    rulesetVersion: positiveInt("rulesetVersion", 1),
    waveSize: positiveInt("waveSize", 1),
    offerTimeoutSeconds: positiveInt("offerTimeoutSeconds", 1),
    maxWaves: positiveInt("maxWaves", 1),
    escalationTimeoutSeconds: positiveInt("escalationTimeoutSeconds", 1),
  };
}

/**
 * A deterministic payload fingerprint, sha256 hex.
 *
 * Hashed rather than stored raw because `dispatch_jobs.payload_fingerprint` is
 * `char_length = 64`, and because the fingerprint's only job is equality — the
 * original payload is already stored in its own columns.
 *
 * Deliberately ignores the trace id and the key itself, so retrying the same
 * logical write with fresh tracing is still a retry. Sorted keys, so field order
 * in the incoming JSON cannot turn one payload into two.
 */
export function fingerprint(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(",")}}`;
}

/** Re-exported so use cases raise a validation error without importing two modules. */
export { validationFailed } from "./errors.js";
