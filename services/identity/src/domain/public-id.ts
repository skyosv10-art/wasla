/**
 * Wasla Public ID — the visible, permanent user identifier.
 *
 * Contract (services/identity/contracts/schema.sql + api.openapi.yml):
 *   pattern: ^WS-[0-9]{10}$   (e.g. WS-0000010427)
 *
 * Generation strategy (documented here as a public contract decision):
 *   "WS-" + zero-padded(10 digits) sequence number, sourced from a
 *   monotonic PublicIdSequence port. Uniqueness is enforced by a DB unique
 *   constraint in the persistence layer (MR 2); the in-memory sequence is a
 *   deterministic stand-in for tests. Sequential (not random) by design:
 *   the schema.sql defines a Postgres sequence for this column.
 *
 * The sequence number is never derived from Telegram IDs (ADR-001: Wasla
 * identity is decoupled from Telegram).
 */

/** Canonical regex for a Wasla Public ID. */
export const WASLA_PUBLIC_ID_PATTERN = /^WS-[0-9]{10}$/;

/** True if `value` matches the Wasla Public ID contract format. */
export function isValidWaslaPublicId(value: unknown): value is string {
  return typeof value === "string" && WASLA_PUBLIC_ID_PATTERN.test(value);
}

/**
 * Format a sequence number as a Wasla Public ID: "WS-" + 10 zero-padded digits.
 * Throws if n is not a positive integer within the 10-digit range.
 */
export function formatWaslaPublicId(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 9_999_999_999) {
    throw new RangeError(
      `Wasla Public ID sequence out of range: ${n} (expected 1..9999999999)`,
    );
  }
  return `WS-${String(n).padStart(10, "0")}`;
}
