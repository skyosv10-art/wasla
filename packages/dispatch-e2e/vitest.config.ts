/**
 * Single config, and it deliberately *includes* the `.e2e.test.ts` file.
 *
 * Everywhere else in this repo the default config excludes
 * `*.{integration,e2e}.test.ts` so `pnpm -r test` stays green without a database.
 * This package is the fourth declared exception, for the same reason as
 * `@wasla/channel-e2e`, `@wasla/customer-e2e` and `@wasla/order-e2e`: it holds the
 * Phase 07 exit gate, and a gate that can be skipped is not a gate. The suite
 * therefore runs in every `pnpm -r test` against in-memory stores, and setting
 * `DISPATCH_DATABASE_URL` lifts the same file onto Postgres.
 *
 * `fileParallelism: false` because the suite owns the matching AND dispatch schemas
 * of the target database (drop + DDL). There is one test file today; the setting is
 * here so a second one cannot silently race over the same tables.
 *
 * The timeout is 120s rather than 30s: every scenario boots six real listeners and
 * drives the dispatch loop over real HTTP — six services, three of them called
 * through their production HTTP adapters. It runs in seconds on memory, and a cold
 * Postgres service container in CI is what the headroom is for.
 *
 * Reasoning in docs/12-testing/PHASE07_EXIT_GATE_E2E.md.
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
