/**
 * RISK-0060 (CLM-0454): every production database pool must carry the TLS setting.
 *
 * TLS lives in one place (`buildSslConfig` behind `withPgPoolDefaults` and
 * `pgSslFromEnv`). A pool built any other way connects in clear even when
 * `WASLA_PG_SSL_MODE=verify-full` is set, and once Supabase "Enforce SSL" is on it
 * cannot connect at all. This test reads every non-test source file under
 * `services/` and `packages/` and fails on a `new Pool(` / `new pg.Pool(` whose
 * argument does not go through one of the two entry points.
 *
 * Exempt: test files and `*-e2e` harnesses, which run against a local CI database.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const POOL_CALL = /new\s+(?:pg\.)?Pool\s*\(/g;
const TLS_ENTRY = /withPgPoolDefaults\s*\(|pgSslFromEnv\s*\(/;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "__tests__") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|mts|js|mjs)$/.test(name) && !/\.(test|spec)\./.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
}

/** The text of the call's argument list, balanced on parentheses. */
function callArgs(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(openParen + 1, i);
  }
  return src.slice(openParen + 1);
}

function poolsWithoutTls(src: string): number[] {
  const bad: number[] = [];
  for (const m of src.matchAll(POOL_CALL)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    if (!TLS_ENTRY.test(callArgs(src, open))) bad.push(src.slice(0, m.index).split("\n").length);
  }
  return bad;
}

describe("every production pool carries the TLS setting (RISK-0060)", () => {
  it("the detector bites: a bare pool is reported, wrapped pools are not", () => {
    expect(poolsWithoutTls("const p = new Pool({ connectionString, max: 1 });")).toEqual([1]);
    expect(poolsWithoutTls("x\nconst p = new pg.Pool({ connectionString });")).toEqual([2]);
    expect(poolsWithoutTls("new pg.Pool(\n  withPgPoolDefaults({ connectionString }),\n)")).toEqual([]);
    expect(poolsWithoutTls("new Pool({ connectionString, max: 1, ...pgSslFromEnv() })")).toEqual([]);
    // A TLS call outside the argument list does not excuse the pool.
    expect(poolsWithoutTls("pgSslFromEnv();\nnew Pool({ connectionString })")).toEqual([2]);
  });

  it("no pool under services/ or packages/ bypasses withPgPoolDefaults / pgSslFromEnv", () => {
    const files: string[] = [];
    for (const top of ["services", "packages"]) {
      for (const name of readdirSync(join(ROOT, top))) {
        if (name.endsWith("-e2e")) continue;
        const dir = join(ROOT, top, name);
        if (statSync(dir).isDirectory()) walk(dir, files);
      }
    }
    const offenders: string[] = [];
    let pools = 0;
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      pools += [...src.matchAll(POOL_CALL)].length;
      for (const line of poolsWithoutTls(src)) offenders.push(`${relative(ROOT, file)}:${line}`);
    }
    expect(offenders).toEqual([]);
    // Sanity: the walk found the pools it is meant to police.
    expect(pools).toBeGreaterThanOrEqual(30);
  });
});
