/**
 * Shape validation for domain inputs.
 *
 * It repeats what `schema.sql` already CHECKs, on purpose: the database is the
 * last line of defence, not the first. A constraint violation surfacing from the
 * driver as a 500 tells the caller nothing about which field was wrong, and by
 * then the transaction is already dead. Here the same rule produces a 400 that
 * names the field.
 *
 * Every message and every `details` object names the FIELD and never the VALUE
 * (errors.md §"ما لا يُعاد في أي خطأ"): plate numbers, document numbers and
 * storage refs must not travel back out in an error string, where they end up in
 * logs that nobody classified as sensitive.
 */

import {
  DOCUMENT_TYPES,
  LOCALES,
  SERVICE_KINDS,
  VEHICLE_CLASSES,
  type DocumentType,
  type Locale,
  type ServiceKind,
  type VehicleClass,
} from "./model.js";
import {
  documentExpiryInvalid,
  unknownDocumentType,
  unknownServiceKind,
  unknownVehicleClass,
  validationFailed,
} from "./errors.js";

/** `WS-` plus ten digits — the same CHECK as `driver_profiles.wasla_public_id`. */
export const WASLA_PUBLIC_ID_PATTERN = /^WS-[0-9]{10}$/;

export function assertWaslaPublicId(value: unknown): string {
  if (typeof value !== "string" || !WASLA_PUBLIC_ID_PATTERN.test(value)) {
    throw validationFailed("waslaPublicId", "WS- ثمّ عشرة أرقام");
  }
  return value;
}

export function assertLocale(value: unknown): Locale {
  if (typeof value !== "string" || !(LOCALES as readonly string[]).includes(value)) {
    throw validationFailed("preferredLocale", LOCALES.join(" | "));
  }
  return value as Locale;
}

/**
 * Service kinds: a non-empty, deduplicated, sorted subset of the closed list.
 *
 * Sorted because the array is compared for equality when deciding whether a
 * profile CHANGED, and `["delivery","ride"]` and `["ride","delivery"]` describe
 * the same driver. Deduplicated because `["ride","ride"]` would otherwise pass
 * the subset CHECK and make a count meaningless.
 */
export function assertServiceKinds(value: unknown): readonly ServiceKind[] {
  if (!Array.isArray(value)) throw validationFailed("serviceKinds", "مصفوفة");
  for (const kind of value) {
    if (typeof kind !== "string" || !(SERVICE_KINDS as readonly string[]).includes(kind)) {
      throw unknownServiceKind();
    }
  }
  return [...new Set(value as ServiceKind[])].sort();
}

export function assertVehicleClass(value: unknown): VehicleClass {
  if (typeof value !== "string" || !(VEHICLE_CLASSES as readonly string[]).includes(value)) {
    throw unknownVehicleClass();
  }
  return value as VehicleClass;
}

export function assertDocumentType(value: unknown): DocumentType {
  if (typeof value !== "string" || !(DOCUMENT_TYPES as readonly string[]).includes(value)) {
    throw unknownDocumentType();
  }
  return value as DocumentType;
}

/** `char_length BETWEEN 8 AND 200` on `driver_documents.storage_ref`. */
export function assertStorageRef(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 200) {
    throw validationFailed("storageRef", "طول بين 8 و200 محرفاً");
  }
  return value;
}

/** `char_length BETWEEN 8 AND 128` — the same bound the unique index relies on. */
export function assertIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw validationFailed("idempotencyKey", "طول بين 8 و128 محرفاً");
  }
  return value;
}

const ISO_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * A DATE column, validated as a date and not merely as a date-SHAPED string.
 *
 * `2026-02-31` matches the pattern and is not a day. Postgres would refuse it;
 * accepting it here would put a `NaN` into an expiry comparison, and a `NaN`
 * comparison is `false`, which silently reads as "expired".
 */
export function assertDateOnly(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    throw validationFailed(field, "YYYY-MM-DD");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw validationFailed(field, "تاريخ ميلاديّ موجود فعلاً");
  }
  return value;
}

/** `ck_driver_documents_dates`: an expiry before its issue date is wrong data. */
export function assertDocumentDates(issuedAt: string | null, expiresAt: string | null): void {
  if (issuedAt === null || expiresAt === null) return;
  if (expiresAt <= issuedAt) throw documentExpiryInvalid();
}

/** `preference_rank BETWEEN 1 AND 50`, and no two zones share a rank. */
export function assertZonePreferences(zones: readonly { zoneId: string; preferenceRank: number }[]): void {
  const ranks = new Set<number>();
  const ids = new Set<string>();
  for (const zone of zones) {
    if (!Number.isInteger(zone.preferenceRank) || zone.preferenceRank < 1 || zone.preferenceRank > 50) {
      throw validationFailed("preferenceRank", "عدد صحيح بين 1 و50");
    }
    if (ranks.has(zone.preferenceRank)) {
      // ux_driver_service_zones_rank. Two zones at rank 1 make "his first choice"
      // a question with two answers, which the ordering then resolves by luck.
      throw validationFailed("preferenceRank", "رتبة فريدة لكل نطاق");
    }
    if (ids.has(zone.zoneId)) throw validationFailed("zoneIds", "نطاق فريد لكل صف");
    ranks.add(zone.preferenceRank);
    ids.add(zone.zoneId);
  }
}

/** `char_length(display_name) BETWEEN 2 AND 80` when present. */
export function assertDisplayName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.trim().length < 2 || value.length > 80) {
    throw validationFailed("displayName", "طول بين 2 و80 محرفاً");
  }
  return value;
}

/** `char_length(reason_code) BETWEEN 3 AND 64` on suspension and rejection. */
export function assertReasonCode(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 3 || value.length > 64) {
    throw validationFailed(field, "طول بين 3 و64 محرفاً");
  }
  return value;
}

/** `char_length(reviewed_by) BETWEEN 2 AND 64`. Who decided is part of the decision. */
export function assertReviewer(value: unknown): string {
  if (typeof value !== "string" || value.length < 2 || value.length > 64) {
    throw validationFailed("reviewedBy", "طول بين 2 و64 محرفاً");
  }
  return value;
}

export function assertDocumentDatesShape(
  issuedAt: unknown,
  expiresAt: unknown,
): { issuedAt: string | null; expiresAt: string | null } {
  const issued = issuedAt === null || issuedAt === undefined ? null : assertDateOnly(issuedAt, "issuedAt");
  const expires =
    expiresAt === null || expiresAt === undefined ? null : assertDateOnly(expiresAt, "expiresAt");
  assertDocumentDates(issued, expires);
  return { issuedAt: issued, expiresAt: expires };
}
