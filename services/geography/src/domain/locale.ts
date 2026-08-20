/**
 * Locale fallback helper — used by use-case mappers to resolve a single
 * display name for a requested locale, falling back to the default locale
 * (`ar`) when the requested locale is missing a name.
 *
 * Per ADR-006: ar is the default/fallback locale. The repository returns the
 * full LocalizedName (all locales); the use-case layer applies this fallback
 * so the in-memory and Drizzle adapters behave identically.
 */

import {
  DEFAULT_LOCALE,
  type SupportedLocale,
} from "@wasla/contracts-geography";
import type { Locale, LocalizedName } from "./model.js";

/**
 * Resolve a single display name for the requested locale.
 *
 * - Returns the name for the requested locale if present and non-null.
 * - Otherwise falls back to the default locale (`ar`).
 * - Throws if neither the requested locale nor the default exists — this is a
 *   data-integrity violation (every entity must have an `ar` name per the
 *   schema.sql NOT NULL constraint on geo_*_names.name for locale='ar').
 */
export function resolveLocalizedName(
  names: LocalizedName,
  locale: Locale,
): string {
  const requested = names[locale];
  if (requested !== null && requested !== undefined) {
    return requested;
  }
  const fallback = names[DEFAULT_LOCALE as Locale];
  if (fallback !== null && fallback !== undefined) {
    return fallback;
  }
  // Should be unreachable given the schema contract; surface as a clear error.
  throw new Error(
    `localization invariant violated: no name for locale '${locale}' or default '${DEFAULT_LOCALE}'`,
  );
}

/**
 * Coerce a contracts-level SupportedLocale into the domain Locale. Both are
 * the same literal union; this exists to keep the domain self-contained.
 */
export function toDomainLocale(locale: SupportedLocale): Locale {
  return locale;
}
