import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHANNEL_ERRORS,
  CHANNEL_ERROR_CLASS_STATUS,
  RETRYABLE_CHANNEL_ERROR_CODES,
  MAX_DELIVERY_ATTEMPTS,
  isChannelErrorCode,
  statusForChannelError,
} from "../index.js";
import type { ChannelErrorCode } from "../index.js";

/**
 * Drift-guard tests for the error catalogue.
 *
 * errors.md is the canonical source (stable codes, add-only). These tests parse
 * its markdown table and assert the exported CHANNEL_ERRORS map matches it code
 * for code, class for class, retryable for retryable — so a code added to the
 * doc without the map (or vice-versa) fails CI instead of drifting silently.
 */

const errorsDocPath = resolve(
  __dirname,
  "../../../../channel-core/contracts/errors.md",
);
const errorsDoc = readFileSync(errorsDocPath, "utf8");

type DocRow = { code: string; class: string; retryable: boolean };

/** Parse the "كتالوج الأكواد" table rows: | `CODE` | `class` | ✅/❌ | … | … | */
function parseCatalogue(): DocRow[] {
  const rows: DocRow[] = [];
  for (const line of errorsDoc.split("\n")) {
    const match = line.match(
      /^\|\s*`(CHANNEL_[A-Z_]+)`\s*\|\s*`([a-z_]+)`\s*\|\s*(✅|❌)\s*\|/,
    );
    if (match) {
      rows.push({ code: match[1], class: match[2], retryable: match[3] === "✅" });
    }
  }
  return rows;
}

const docRows = parseCatalogue();

describe("@wasla/contracts-channel — error catalogue drift guard", () => {
  it("parses a non-trivial catalogue from errors.md", () => {
    expect(docRows.length).toBeGreaterThanOrEqual(14);
  });

  it("exports exactly the codes documented in errors.md", () => {
    const docCodes = docRows.map((r) => r.code).sort();
    const codeCodes = Object.keys(CHANNEL_ERRORS).sort();
    expect(codeCodes).toEqual(docCodes);
  });

  it("matches the class of every documented code", () => {
    for (const row of docRows) {
      const entry = CHANNEL_ERRORS[row.code as ChannelErrorCode];
      expect(entry.class, `class of ${row.code}`).toBe(row.class);
    }
  });

  it("matches the retryable flag of every documented code", () => {
    for (const row of docRows) {
      const entry = CHANNEL_ERRORS[row.code as ChannelErrorCode];
      expect(entry.retryable, `retryable of ${row.code}`).toBe(row.retryable);
    }
  });

  it("documents an HTTP status for every error class in use", () => {
    for (const row of docRows) {
      expect(CHANNEL_ERROR_CLASS_STATUS).toHaveProperty(row.class);
    }
  });

  it("derives the retryable set from the catalogue", () => {
    expect([...RETRYABLE_CHANNEL_ERROR_CODES].sort()).toEqual(
      [
        "CHANNEL_IDENTITY_BOOTSTRAP_FAILED",
        "CHANNEL_RATE_LIMITED",
        "CHANNEL_TRANSPORT_ERROR",
      ].sort(),
    );
  });

  it("keeps the retry policy in the doc aligned with MAX_DELIVERY_ATTEMPTS", () => {
    expect(errorsDoc).toContain(`${MAX_DELIVERY_ATTEMPTS} (\`channel_deliveries.max_attempts\`)`);
  });

  it("maps codes to their contract HTTP status", () => {
    expect(statusForChannelError("CHANNEL_UNAUTHORIZED_WEBHOOK")).toBe(401);
    expect(statusForChannelError("CHANNEL_UNKNOWN_BOT")).toBe(404);
    expect(statusForChannelError("CHANNEL_DEEP_LINK_TOO_LONG")).toBe(422);
    expect(statusForChannelError("CHANNEL_RATE_LIMITED")).toBe(429);
    expect(statusForChannelError("CHANNEL_TRANSPORT_ERROR")).toBe(503);
  });

  it("guards against unknown codes at runtime", () => {
    expect(isChannelErrorCode("CHANNEL_RATE_LIMITED")).toBe(true);
    expect(isChannelErrorCode("TELEGRAM_FLOOD_WAIT")).toBe(false);
  });

  it("never exposes a telegram-specific error code (adapter maps them)", () => {
    for (const code of Object.keys(CHANNEL_ERRORS)) {
      expect(code.startsWith("CHANNEL_")).toBe(true);
      expect(code).not.toMatch(/TELEGRAM/);
    }
  });
});
