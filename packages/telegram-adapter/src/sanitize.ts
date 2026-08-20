/**
 * Normalisation of untrusted channel input (ADR-007 rule 8, SECURITY_RULES).
 *
 * Everything a user can type — display names, message text, contact data — is
 * cleaned *here*, at the outer edge, so no code above the adapter has to wonder
 * whether a string is safe to log, store or render.
 *
 * The rules are intentionally boring: strip control characters, collapse
 * whitespace, cap length. No escaping and no HTML awareness: escaping belongs to
 * the sink (SQL parameters, JSON encoding, Mini App rendering), and doing it here
 * would corrupt legitimate Arabic text.
 */

/**
 * Control characters removed from every inbound string.
 *
 * Includes the bidirectional overrides (U+202A–U+202E, U+2066–U+2069): in an
 * Arabic-first product they can visually reorder a label or a name in logs and
 * in the Mini App, which is a spoofing surface rather than content.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

const WHITESPACE_RUN = /\s+/g;

/** Cleans an untrusted single-line string; returns undefined when nothing is left. */
export function cleanLine(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(CONTROL_CHARACTERS, "").replace(WHITESPACE_RUN, " ").trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.slice(0, maxLength);
}

/**
 * Cleans untrusted multi-line text, preserving line breaks.
 *
 * Message bodies keep their structure (an address typed over three lines must
 * stay readable), so only control characters other than newline are removed.
 */
export function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .split("\n")
    .map((line) => line.replace(CONTROL_CHARACTERS, "").replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.slice(0, maxLength);
}

/** BCP-47 subset accepted for `language_code` (`ar`, `ar-SA`, `en`). */
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})?$/;

/**
 * Validates a locale hint from the channel.
 *
 * Rejected instead of coerced: a wrong locale silently changes which language a
 * customer is answered in, and the caller has a safe default without it.
 */
export function cleanLanguageCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  return LANGUAGE_CODE.test(candidate) ? candidate : undefined;
}
