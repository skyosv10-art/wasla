/**
 * Replay classification for `POST /drivers` — the one write whose idempotency has no
 * row of its own to hold a key.
 *
 * ## The problem this file exists for
 *
 * The contract promises: same `Idempotency-Key` with the same payload returns the same
 * profile with `200`; a reused key with a DIFFERENT payload is `409`
 * `DRIVER_IDEMPOTENCY_KEY_REUSED`. Vehicles and documents keep their key in their own
 * table (`ux_driver_vehicles_idempotency`, `ux_driver_documents_idempotency`) and
 * `registerVehicle`/`submitDocument` already implement exactly this. `registerDriver`
 * does not: it takes no key, because `driver_profiles` has no idempotency column — the
 * `wasla_public_id` IS the natural key, so a duplicate registration is already refused
 * by `DRIVER_ALREADY_EXISTS`.
 *
 * ## Why the classification is here and not inside `registerDriver`
 *
 * The rejected alternative was to add `idempotencyKey` to `RegisterDriverInput`. It
 * would have changed the signature every caller and every test already uses, in the
 * domain layer, to satisfy a promise that only exists at HTTP: an in-process caller has
 * no network to retry over. Keeping it here means the domain keeps answering "this
 * driver already exists" — which is true — while the transport decides whether THIS
 * caller's retry was the same request as before.
 *
 * The consequence is stated rather than hidden: the classification and the registration
 * run inside ONE `runner.write`, so on Postgres they share the transaction and a
 * crash between remembering the key and creating the profile rolls back both. Running
 * them in two calls would have left a remembered key with no driver behind it — the
 * state in which every retry answers `409` for a driver that was never created.
 *
 * ## Why the fingerprint is a digest and not the payload
 *
 * `driver_idempotency` is a technical audit table (schema.sql §9), and the registration
 * payload contains `display_name` — a person's name. A readable fingerprint would copy
 * every registered driver's name into a table nobody thinks of as personal data, and
 * that is precisely the copy the privacy rule exists to prevent. A SHA-256 of the
 * canonical form compares equal for equal payloads and carries nothing back.
 */

import { createHash } from "node:crypto";

import { idempotencyKeyReused } from "../domain/errors.js";
import type { DriverDependencies } from "../ports.js";

/** Namespaced so a key reused across operations is not a collision between them. */
export function registrationKey(waslaPublicId: string, idempotencyKey: string): string {
  return `profile:${waslaPublicId}:${idempotencyKey}`;
}

/**
 * A stable digest of the request body.
 *
 * Keys are sorted before hashing: `{"a":1,"b":2}` and `{"b":2,"a":1}` are the same
 * request, and a retry that serialises its JSON in a different order must not be told
 * it changed its mind. Nested values are stringified as-is, which is enough because
 * every registration field is a scalar or an array of scalars.
 */
export function payloadFingerprint(body: Record<string, unknown>): string {
  const canonical = Object.keys(body)
    .sort()
    .map((key) => `${key}=${JSON.stringify(body[key])}`)
    .join("&");
  return createHash("sha256").update(canonical).digest("hex");
}

export type ReplayVerdict = "fresh" | "replay";

/**
 * Compare this key against what was remembered, and remember it when it is new.
 *
 * Throws `DRIVER_IDEMPOTENCY_KEY_REUSED` (409) when the key is known with a different
 * fingerprint. Silently succeeding would be the expensive failure: the caller believes
 * the second payload was applied, and the difference surfaces later as a driver whose
 * profile does not match what the operator typed.
 */
export async function classifyReplay(
  deps: DriverDependencies,
  key: string,
  fingerprint: string,
): Promise<ReplayVerdict> {
  const remembered = await deps.idempotency.find(key);
  if (remembered === null) {
    await deps.idempotency.remember(key, fingerprint);
    return "fresh";
  }
  if (remembered !== fingerprint) throw idempotencyKeyReused();
  return "replay";
}
