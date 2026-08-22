/**
 * Shape validation for everything that enters the domain.
 *
 * Two rules, both from the governing documents:
 *  - a validation error NAMES the field and never repeats its value
 *    (contracts/errors.md §"ما لا يُعاد في أي خطأ"),
 *  - a closed list in the contract is a closed list in the code: an unknown
 *    vehicle class or service kind is 422 with its own code, not a generic 400,
 *    because the caller needs to know that the value was well-formed and still
 *    unacceptable.
 */

import { MatchingError, validationFailed } from "./errors.js";
import {
  AVAILABILITY_STATES,
  CANDIDACY_WRITERS,
  DRIVER_PUBLIC_ID_PATTERN,
  ELIGIBILITY_SOURCES,
  ELIGIBILITY_STATES,
  MATCHING_ACTOR_TYPES,
  ORDER_PUBLIC_ID_PATTERN,
  SERVICE_KINDS,
  VEHICLE_CLASSES,
  type AvailabilityState,
  type CandidacyWriter,
  type EligibilitySource,
  type EligibilityState,
  type MatchingActorType,
  type ServiceKind,
  type VehicleClass,
} from "./model.js";

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function assertUuid(value: unknown, field: string, traceId?: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw validationFailed(field, "uuid", traceId);
  }
  return value;
}

export function assertDriverPublicId(value: unknown, field: string, traceId?: string): string {
  if (typeof value !== "string" || !DRIVER_PUBLIC_ID_PATTERN.test(value)) {
    throw validationFailed(field, "WS-##########", traceId);
  }
  return value;
}

export function assertOrderPublicId(value: unknown, field: string, traceId?: string): string {
  if (typeof value !== "string" || !ORDER_PUBLIC_ID_PATTERN.test(value)) {
    throw validationFailed(field, "ORD-##########", traceId);
  }
  return value;
}

export function assertIsoTimestamp(value: unknown, field: string, traceId?: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw validationFailed(field, "ISO-8601 date-time", traceId);
  }
  return value;
}

/**
 * A service kind outside the closed list is 422 with its own code.
 *
 * The list must stay identical to the order contract: a missing member hides a
 * valid candidate, and an extra one produces an offer that cannot be fulfilled.
 */
export function assertServiceKind(value: unknown, field: string, traceId?: string): ServiceKind {
  if (typeof value !== "string" || !SERVICE_KINDS.includes(value as ServiceKind)) {
    throw new MatchingError(
      "MATCHING_SERVICE_KIND_UNKNOWN",
      `نوع الخدمة في ${field} خارج القائمة المُقفلة`,
      { traceId, details: { field, expected: SERVICE_KINDS.join("|") } },
    );
  }
  return value as ServiceKind;
}

export function assertVehicleClass(value: unknown, field: string, traceId?: string): VehicleClass {
  if (typeof value !== "string" || !VEHICLE_CLASSES.includes(value as VehicleClass)) {
    throw new MatchingError(
      "MATCHING_VEHICLE_CLASS_UNKNOWN",
      `صنف المركبة في ${field} خارج القائمة المُقفلة`,
      { traceId, details: { field, expected: VEHICLE_CLASSES.join("|") } },
    );
  }
  return value as VehicleClass;
}

export function assertAvailabilityState(
  value: unknown,
  field: string,
  traceId?: string,
): AvailabilityState {
  if (typeof value !== "string" || !AVAILABILITY_STATES.includes(value as AvailabilityState)) {
    throw validationFailed(field, AVAILABILITY_STATES.join("|"), traceId);
  }
  return value as AvailabilityState;
}

export function assertEligibilityState(
  value: unknown,
  field: string,
  traceId?: string,
): EligibilityState {
  if (typeof value !== "string" || !ELIGIBILITY_STATES.includes(value as EligibilityState)) {
    throw validationFailed(field, ELIGIBILITY_STATES.join("|"), traceId);
  }
  return value as EligibilityState;
}

export function assertEligibilitySource(
  value: unknown,
  field: string,
  traceId?: string,
): EligibilitySource {
  if (typeof value !== "string" || !ELIGIBILITY_SOURCES.includes(value as EligibilitySource)) {
    throw validationFailed(field, ELIGIBILITY_SOURCES.join("|"), traceId);
  }
  return value as EligibilitySource;
}

export function assertActorType(value: unknown, field: string, traceId?: string): MatchingActorType {
  if (typeof value !== "string" || !MATCHING_ACTOR_TYPES.includes(value as MatchingActorType)) {
    throw validationFailed(field, MATCHING_ACTOR_TYPES.join("|"), traceId);
  }
  return value as MatchingActorType;
}

/** `dispatch` may evaluate and flip availability, but it never writes a candidacy row. */
export function writerFromActor(actor: MatchingActorType): CandidacyWriter {
  return CANDIDACY_WRITERS.includes(actor as CandidacyWriter)
    ? (actor as CandidacyWriter)
    : "unknown";
}

export function assertIntegerInRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
  traceId?: string,
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw validationFailed(field, `integer ${min}..${max}`, traceId);
  }
  return value;
}

/** An idempotency key is mandatory on every write (§43) and has a declared length. */
export function assertIdempotencyKey(value: unknown, traceId?: string): string {
  // Whitespace counts as absent: a key of ten spaces is not an identity, and
  // treating it as one would make every such request a retry of the first.
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MatchingError(
      "MATCHING_IDEMPOTENCY_KEY_REQUIRED",
      "كل كتابة تحتاج مفتاح منع تكرار",
      { traceId, details: { field: "Idempotency-Key" } },
    );
  }
  if (value.length < 8 || value.length > 128) {
    throw validationFailed("Idempotency-Key", "8..128 characters", traceId);
  }
  return value;
}

/**
 * A deterministic payload fingerprint.
 *
 * Deliberately ignores the trace id and the key itself, so retrying the same
 * logical write with fresh tracing is still a retry. Sorted keys, so field order
 * in the incoming JSON cannot turn one payload into two.
 */
export function fingerprint(payload: unknown): string {
  return stableStringify(payload);
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
