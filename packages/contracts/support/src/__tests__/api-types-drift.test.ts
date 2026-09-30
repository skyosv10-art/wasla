/**
 * CLM-0418 (§24-H): `src/api-types.ts` is GENERATED — this test regenerates it
 * with the package's own `generate` script (same CLI, same spec path) into a
 * temp file and requires byte equality. Measured before this guard existed:
 * 11 of 13 generated files had drifted from their OpenAPI source, and one
 * generate path (identity) pointed outside the repository.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("api-types.ts is in sync with the OpenAPI source", () => {
  it("regenerating with the package's generate script changes nothing", () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as { scripts: { generate: string } };
    const argv = pkg.scripts.generate.split(/\s+/);
    expect(argv[0]).toBe("openapi-typescript");
    const spec = argv[1]!;
    const dir = mkdtempSync(join(tmpdir(), "api-types-"));
    try {
      const out = join(dir, "api-types.ts");
      execFileSync(join(pkgRoot, "node_modules/.bin/openapi-typescript"), [spec, "-o", out], { cwd: pkgRoot, stdio: "pipe" });
      expect(readFileSync(out, "utf8")).toBe(readFileSync(join(pkgRoot, "src/api-types.ts"), "utf8"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
