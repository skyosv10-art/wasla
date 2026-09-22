/**
 * M3-05 — the published bot role spec and the code agree, both ways.
 *
 * docs/01-product/BOT_ROLE_SPEC.md §2 is the product's word on which commands
 * each bot answers. `BOT_ALLOWED_COMMANDS` is the code's word, and the runtime
 * refuses to boot a bot outside it. This file reads the spec's tables and
 * requires the two to be the same set per bot, so neither can change alone:
 * a command added to the spec without code, or to the code without the spec,
 * fails here.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BOT_ALLOWED_COMMANDS, BOT_KINDS, type BotKind } from "../index.js";

const SPEC_PATH = resolve(__dirname, "../../../../../docs/01-product/BOT_ROLE_SPEC.md");

/** Headings of §2 subsections, per bot. Wording is part of the contract. */
const SECTION_HEADING: Record<BotKind, RegExp> = {
  customer: /^### 2\.\d+ Customer Bot\b/,
  driver: /^### 2\.\d+ Driver Bot\b/,
  partner: /^### 2\.\d+ Partner Bot\b/,
};

/**
 * Commands listed in the first column of the table under one §2 subsection.
 * Stops at the next heading, so a later section cannot leak rows in.
 */
function specCommands(markdown: string, bot: BotKind): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => SECTION_HEADING[bot].test(line));
  if (start < 0) throw new Error(`BOT_ROLE_SPEC.md has no §2 subsection for ${bot}`);
  const commands: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,3} /.test(line)) break;
    const cell = /^\|\s*`\/([a-z_]+)`\s*\|/.exec(line);
    if (cell) commands.push(cell[1]!);
  }
  return commands;
}

const spec = readFileSync(SPEC_PATH, "utf8");

describe("M3-05 · BOT_ROLE_SPEC.md §2 ⇔ BOT_ALLOWED_COMMANDS", () => {
  it("covers exactly the three bots", () => {
    expect(Object.keys(BOT_ALLOWED_COMMANDS).sort()).toEqual([...BOT_KINDS].sort());
  });

  for (const bot of BOT_KINDS) {
    it(`${bot}: the spec table lists exactly the allowed commands`, () => {
      const fromSpec = specCommands(spec, bot);
      expect(fromSpec.length).toBeGreaterThan(0);
      expect(new Set(fromSpec).size).toBe(fromSpec.length);
      expect([...fromSpec].sort()).toEqual([...BOT_ALLOWED_COMMANDS[bot]].sort());
    });

    it(`${bot}: /start is allowed (every bot launches its Mini App)`, () => {
      expect(BOT_ALLOWED_COMMANDS[bot]).toContain("start");
    });
  }

  it("no bot is allowed an admin verb (BOT_ROLE_SPEC §3.5, §4.4)", () => {
    const adminVerbs = ["admin", "suspend", "reinstate", "approve", "delete", "audit"];
    for (const bot of BOT_KINDS) {
      for (const verb of adminVerbs) expect(BOT_ALLOWED_COMMANDS[bot]).not.toContain(verb);
    }
  });

  it("the parser really reads the spec (a missing subsection is an error, not an empty set)", () => {
    expect(() => specCommands("# nothing here\n", "customer")).toThrow(/no §2 subsection/);
  });
});
