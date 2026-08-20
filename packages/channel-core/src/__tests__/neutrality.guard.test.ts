/**
 * Architecture guard: this package must stay channel-agnostic (ADR-007).
 *
 * A human reviewer forgets; this test does not. It reads every source file in
 * the package and fails if channel-specific vocabulary or a dependency on the
 * channel adapter appears. Comments are stripped first, because prose may
 * legitimately explain *why* a concept is excluded.
 *
 * The one accepted exception is the channel *name* re-exported by the contracts
 * package (`IMPLEMENTED_CHANNEL`) — it is data, and it never appears as a
 * literal here, which is exactly what this test enforces.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Substrings that would prove channel knowledge leaked into the core. */
const FORBIDDEN_SUBSTRINGS = [
  "telegram",
  "chat_id",
  "web_app",
  "bot_token",
  "inline_keyboard",
  "api.telegram.org",
  "getupdates",
  "setwebhook",
  "editmessagetext",
  "answercallbackquery",
  "grammy",
  "telegraf",
];

/** Packages the core is forbidden from importing (dependency direction). */
const FORBIDDEN_IMPORTS = ["@wasla/telegram-adapter", "node-telegram", "telegraf", "grammy"];

/** This guard file necessarily contains the needles, so it excludes itself. */
const SELF = fileURLToPath(import.meta.url);

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (entry.name.endsWith(".ts") && path !== SELF) {
      found.push(path);
    }
  }
  return found;
}

/** Remove block and line comments so documentation prose is not scanned. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const files = sourceFiles(SRC_ROOT);

describe("channel-core neutrality", () => {
  it("scans a non-trivial number of files", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of files) {
    const relative = file.slice(SRC_ROOT.length + 1);

    it(`keeps ${relative} free of channel-specific vocabulary`, () => {
      const code = stripComments(readFileSync(file, "utf8")).toLowerCase();
      const hits = FORBIDDEN_SUBSTRINGS.filter((needle) => code.includes(needle));
      expect(hits, `${relative} leaks channel knowledge`).toEqual([]);
    });

    it(`keeps ${relative} free of forbidden imports`, () => {
      const code = readFileSync(file, "utf8");
      const hits = FORBIDDEN_IMPORTS.filter((needle) => code.includes(needle));
      expect(hits, `${relative} imports downstream of the core`).toEqual([]);
    });
  }

  it("declares no runtime dependency beyond the contracts and error packages", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(SRC_ROOT, "..", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      "@wasla/contracts-channel",
      "@wasla/errors",
    ]);
  });
});
