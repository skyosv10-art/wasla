/**
 * Single config, and it deliberately *includes* the `.e2e.test.ts` file.
 *
 * Everywhere else in this repo the default config excludes
 * `*.{integration,e2e}.test.ts` so `pnpm -r test` stays green without a
 * database. This package is the second declared exception, for the same reason
 * as `@wasla/channel-e2e`: it holds the Phase 04 exit gate, and a gate that can
 * be skipped is not a gate. The suite therefore runs in every `pnpm -r test`
 * against the in-memory Customer Core, and setting `CUSTOMER_DATABASE_URL` lifts
 * the same file onto Postgres.
 *
 * `fileParallelism: false` because the suite owns the customer schema of the
 * target database (drop + DDL, then truncate). There is one test file today; the
 * setting is here so a second one cannot silently race over the same tables.
 *
 * Reasoning in docs/12-testing/PHASE04_EXIT_GATE_E2E.md.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.e2e.test.ts"],
    fileParallelism: false,
    // The gate starts four HTTP listeners and (optionally) a pool per run.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
