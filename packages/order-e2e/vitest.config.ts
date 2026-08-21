/**
 * Single config, and it deliberately *includes* the `.e2e.test.ts` file.
 *
 * Everywhere else in this repo the default config excludes
 * `*.{integration,e2e}.test.ts` so `pnpm -r test` stays green without a database.
 * This package is the third declared exception, for the same reason as
 * `@wasla/channel-e2e` and `@wasla/customer-e2e`: it holds the Phase 06 exit
 * gate, and a gate that can be skipped is not a gate. The suite therefore runs in
 * every `pnpm -r test` against the in-memory engine store, and setting
 * `ORDER_DATABASE_URL` lifts the same file onto Postgres.
 *
 * `fileParallelism: false` because the suite owns the order schema of the target
 * database (drop + DDL). There is one test file today; the setting is here so a
 * second one cannot silently race over the same tables.
 *
 * The timeout is 120s rather than 30s: the full-table sweep walks the published
 * lifecycle for every one of the 21 statuses and then attempts all 21 targets
 * from each — 441 real HTTP transitions plus the walks that set them up. It runs
 * in seconds on memory, and a cold Postgres service container in CI is what the
 * headroom is for.
 *
 * Reasoning in docs/12-testing/PHASE06_EXIT_GATE_E2E.md.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.e2e.test.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
