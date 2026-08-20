/**
 * Single config, and it deliberately *includes* the `.e2e.test.ts` file.
 *
 * Everywhere else in this repo the default config excludes `*.{integration,e2e}
 * .test.ts` so `pnpm -r test` stays green without a database. This package is the
 * exception on purpose: it holds the Phase 03 exit gate, and a gate that can be
 * skipped is not a gate. So the suite runs in every `pnpm -r test` against the
 * in-memory stores, and setting `DATABASE_URL` lifts the same file onto Postgres
 * plus the one row-level test that only a real engine can answer.
 *
 * `fileParallelism: false` because the suite owns the channel schema of the
 * target database (drop + DDL, then truncate per test). There is a single test
 * file today; the setting is here so adding a second one cannot silently start a
 * race over the same tables.
 *
 * Reasoning in docs/12-testing/PHASE03_EXIT_GATE_E2E.md.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.e2e.test.ts"],
    fileParallelism: false,
  },
});
