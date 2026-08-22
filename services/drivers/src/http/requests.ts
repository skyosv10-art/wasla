/**
 * Request parsing: `snake_case` wire → the `camelCase` inputs the use cases declare.
 *
 * ## What this layer checks, and what it deliberately does NOT
 *
 * It checks only what the transport can know: the body is an object, its keys are
 * declared in the contract, the path ids have the published shape, the headers are
 * single-valued and within length. Field MEANING is not re-checked here — `documentType`
 * against the closed set, `expiresAt` after `issuedAt`, zone rank sequencing — because
 * `src/domain/validation.ts` already owns those and a second copy is a second answer.
 * The day a rule changes, this file must not be one of the places that has to agree.
 *
 * The division shows up in the status codes: everything this file rejects is a `400`
 * (the caller's request is misshapen), while the domain's own refusals can be `422`
 * (the request was understood and refused). A transport that pre-validated meanings
 * would turn `422`s into `400`s and tell every caller "fix your syntax" for a rule
 * about the world.
 *
 * ## Why `onlyKeys` and not "ignore what you do not know"
 *
 * Every request schema in `contracts/api.openapi.yml` declares
 * `additionalProperties: false`. Silently dropping an unknown key is the failure mode
 * that costs the most later: a client sends `expires_at` to a route that never read it,
 * gets `200`, and believes the expiry was recorded. Rejecting the key says so at the
 * first attempt, while the caller is still looking at the request.
 *
 * The key lists are EXPORTED so `__tests__/http-contract.test.ts` can compare them with
 * the properties declared in the OpenAPI file. A whitelist that silently falls behind
 * the contract rejects requests the contract permits, which is the same class of bug in
 * the opposite direction.
 */

import {
  validationFailed,
  idempotencyKeyRequired,
  type DriverError,
} from "../domain/errors.js";
import { WASLA_PUBLIC_ID_PATTERN } from "../domain/validation.js";

const IDEMPOTENCY_MIN = 8;
const IDEMPOTENCY_MAX = 128;
const REQUEST_ID_MAX = 128;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RequestHeaders = Record<string, string | string[] | undefined>;

function invalid(field: string, expected = "صيغة العقد"): never {
  throw validationFailed(field, expected) as DriverError;
}

/**
 * One header value, or nothing.
 *
 * A duplicated header is refused rather than resolved. Node joins repeats with a comma,
 * and a comma is not a legitimate character in an idempotency key or a trace id we
 * generate, so its presence is proof of duplication rather than of content — which
 * means "take the first" would be a guess about which of two callers' keys wins.
 */
function singleHeader(headers: RequestHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) invalid(name, "ترويسة واحدة");
  if (value === undefined) return undefined;
  if (value.includes(",")) invalid(name, "ترويسة واحدة");
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The idempotency key of a retryable write.
 *
 * A MISSING key and a MALFORMED key are different codes, and the difference is the
 * caller's next move: `DRIVER_IDEMPOTENCY_KEY_REQUIRED` says "add the header",
 * `DRIVER_VALIDATION_FAILED` says "the header you sent is not a key". Both are `400`,
 * so collapsing them would have cost nothing in status and everything in the one
 * sentence a client reads when integrating.
 */
export function requireIdempotencyKey(headers: RequestHeaders): string {
  const key = singleHeader(headers, "Idempotency-Key");
  if (key === undefined) throw idempotencyKeyRequired();
  if (key.length < IDEMPOTENCY_MIN || key.length > IDEMPOTENCY_MAX) {
    invalid("Idempotency-Key", `طول بين ${IDEMPOTENCY_MIN} و${IDEMPOTENCY_MAX}`);
  }
  return key;
}

/**
 * The trace header is bounded, and that is a storage rule not a taste.
 *
 * `request.id` becomes `trace_id` in every answer AND is passed to the domain, where it
 * is written into `driver_eligibility_log`. An unbounded caller-supplied header would
 * therefore be an unbounded write into an audit table.
 */
export function assertRequestIdLength(headers: RequestHeaders): void {
  const requestId = singleHeader(headers, "x-request-id");
  if (requestId !== undefined && requestId.length > REQUEST_ID_MAX) {
    invalid("x-request-id", `طول لا يتجاوز ${REQUEST_ID_MAX}`);
  }
}

function object(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) invalid("body", "كائن JSON");
  return raw as Record<string, unknown>;
}

function onlyKeys(body: Record<string, unknown>, keys: readonly string[]): void {
  const unknown = Object.keys(body).find((key) => !keys.includes(key));
  if (unknown !== undefined) invalid(unknown, "حقل معلن في العقد");
}

/** `minProperties: 1` — an empty patch is a request that asks for nothing. */
function atLeastOneKey(body: Record<string, unknown>): void {
  if (Object.keys(body).length === 0) invalid("body", "حقل واحد على الأقل");
}

/**
 * The routes that declare no `requestBody` reject a non-empty one.
 *
 * `reinstate` and the eligibility tick carry no body ON PURPOSE (the contract says so
 * for each). Accepting and ignoring a body would let a caller send
 * `{"reason_code": "..."}` to `reinstate` and believe a reason was recorded, when
 * reinstatement removes a decision and has no reason of its own.
 */
export function assertNoBody(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  if (typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 0) return;
  invalid("body", "جسم فارغ");
}

/** The public driver id from the path — the same pattern the domain enforces. */
export function toWaslaPublicId(raw: unknown): string {
  if (typeof raw !== "string" || !WASLA_PUBLIC_ID_PATTERN.test(raw)) {
    invalid("waslaPublicId", "WS-<10 أرقام>");
  }
  return raw;
}

export function toPathUuid(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !UUID.test(raw)) invalid(field, "UUID");
  return raw;
}

// ---------------------------------------------------------------------------
// Scalar shape readers.
//
// These exist because some use-case inputs are declared with CONCRETE types
// (`workCityZoneId: string | null`, `declared: DeclaredAvailability`,
// `modelYear: number | null`) rather than `unknown`. Where an input is `unknown` the
// domain validates it and this layer must not; where it is concrete the domain TRUSTS
// its caller, and the only caller from outside the process is this file. Casting a
// parsed JSON value into a concrete type without checking it would make the type
// annotation a lie and hand the repository a number where a zone id belongs.
// ---------------------------------------------------------------------------

/** `undefined` = key absent; `null` = present and null, which callers may mean. */
export function nullableString(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null || typeof value === "string") return value;
  return invalid(key, "نص أو null");
}

export function nullableInteger(
  body: Record<string, unknown>,
  key: string,
): number | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null || (typeof value === "number" && Number.isInteger(value))) return value;
  return invalid(key, "عدد صحيح أو null");
}

export function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (typeof value === "boolean") return value;
  return invalid(key, "قيمة منطقية");
}

/**
 * A value from a closed set the DOMAIN does not re-check.
 *
 * `declareAvailability` takes `DeclaredAvailability`, not `unknown`: TypeScript is the
 * only thing standing between `{"declared_availability": "busy"}` and a stored value
 * the state machine never expected — and TypeScript is erased at the boundary. So the
 * check happens here, once, with the closed set imported from the contracts package
 * rather than written out again.
 */
export function oneOf<T extends string>(
  body: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = body[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    invalid(key, allowed.join(" | "));
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// Body whitelists — one per request schema in the OpenAPI file, exported so the
// drift guard can read them.
// ---------------------------------------------------------------------------

export const DRIVER_REGISTRATION_KEYS = [
  "wasla_public_id",
  "display_name",
  "preferred_locale",
  "work_city_zone_id",
  "service_kinds",
] as const;

export const DRIVER_PROFILE_PATCH_KEYS = [
  "display_name",
  "preferred_locale",
  "work_city_zone_id",
  "service_kinds",
] as const;

export const VEHICLE_REGISTRATION_KEYS = [
  "vehicle_class",
  "make",
  "model",
  "model_year",
  "color",
  "plate_number",
  "is_primary",
] as const;

export const VEHICLE_PATCH_KEYS = ["status", "is_primary"] as const;

export const DOCUMENT_SUBMISSION_KEYS = [
  "document_type",
  "storage_ref",
  "vehicle_id",
  "issued_at",
  "expires_at",
] as const;

export const DOCUMENT_REVIEW_KEYS = ["decision", "reviewed_by", "rejection_reason_code"] as const;

export const AVAILABILITY_UPDATE_KEYS = ["declared_availability"] as const;

export const SUSPENSION_REQUEST_KEYS = ["reason_code"] as const;

export const ZONE_REPLACEMENT_KEYS = ["zones"] as const;

export const ZONE_ITEM_KEYS = ["zone_id", "preference_rank"] as const;

export function toDriverRegistrationBody(raw: unknown): Record<string, unknown> {
  const body = object(raw);
  onlyKeys(body, DRIVER_REGISTRATION_KEYS);
  return body;
}

/**
 * The profile patch, where present-and-null is NOT the same as absent.
 *
 * `updateProfile` distinguishes them: `display_name: null` clears the name,
 * `display_name` absent leaves it alone. That is why the returned object is built with
 * `"key" in body` tests instead of `body.key !== undefined` — the second reading turns
 * an explicit null into "unchanged", and a driver who asked to remove his display name
 * would get a `200` and keep it.
 */
export function toProfilePatchBody(raw: unknown): Record<string, unknown> {
  const body = object(raw);
  onlyKeys(body, DRIVER_PROFILE_PATCH_KEYS);
  atLeastOneKey(body);
  return body;
}

export function toVehicleRegistrationBody(raw: unknown): Record<string, unknown> {
  const body = object(raw);
  onlyKeys(body, VEHICLE_REGISTRATION_KEYS);
  return body;
}

export function toVehiclePatchBody(raw: unknown): Record<string, unknown> {
  const body = object(raw);
  onlyKeys(body, VEHICLE_PATCH_KEYS);
  atLeastOneKey(body);
  return body;
}

export function toDocumentSubmissionBody(raw: unknown): Record<string, unknown> {
  const body = object(raw);
  onlyKeys(body, DOCUMENT_SUBMISSION_KEYS);
  return body;
}

export function toDocumentReviewBody(raw: unknown): Record<string, unknown> {
  const body = object(raw);
  onlyKeys(body, DOCUMENT_REVIEW_KEYS);
  return body;
}

export function toAvailabilityBody(raw: unknown): Record<string, unknown> {
  const body = object(raw);
  onlyKeys(body, AVAILABILITY_UPDATE_KEYS);
  return body;
}

export function toSuspensionBody(raw: unknown): Record<string, unknown> {
  const body = object(raw);
  onlyKeys(body, SUSPENSION_REQUEST_KEYS);
  return body;
}

/**
 * The zone replacement list.
 *
 * The nested items are whitelisted too, which is the reason this function is not a
 * one-liner: `additionalProperties: false` applies to each item, and a top-level-only
 * check would accept `{"zone_id": ..., "preference_rank": 1, "primary": true}` and
 * silently drop a key the caller believed in. Rank sequencing and uniqueness are NOT
 * checked here — `assertZonePreferences` in the domain owns them and answers `422`.
 */
export function toZonesBody(raw: unknown): readonly { zoneId: string; preferenceRank: number }[] {
  const body = object(raw);
  onlyKeys(body, ZONE_REPLACEMENT_KEYS);
  const zones = body.zones;
  if (!Array.isArray(zones)) invalid("zones", "مصفوفة");
  return zones.map((entry, index) => {
    const item = object(entry);
    onlyKeys(item, ZONE_ITEM_KEYS);
    const zoneId = item.zone_id;
    const rank = item.preference_rank;
    if (typeof zoneId !== "string") invalid(`zones[${index}].zone_id`, "نص");
    if (typeof rank !== "number" || !Number.isInteger(rank)) {
      invalid(`zones[${index}].preference_rank`, "عدد صحيح");
    }
    return { zoneId: zoneId as string, preferenceRank: rank as number };
  });
}
