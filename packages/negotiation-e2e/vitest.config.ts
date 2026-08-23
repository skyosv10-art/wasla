/**
 * Single config, and it deliberately *includes* the `.e2e.test.ts` file.
 *
 * Everywhere else in this repo the default config excludes
 * `*.{integration,e2e}.test.ts` so `pnpm -r test` stays green without a database.
 * This package is the fifth declared exception, for the same reason as
 * `@wasla/channel-e2e`, `@wasla/customer-e2e`, `@wasla/order-e2e` and
 * `@wasla/dispatch-e2e`: it holds the Phase 08 exit gate, and a gate that can be
 * skipped is not a gate. The suite therefore runs in every `pnpm -r test` against
 * in-memory stores, and setting `NEGOTIATION_DATABASE_URL` lifts the same file onto
 * Postgres.
 *
 * `fileParallelism: false` because the suite owns the negotiation schema of the
 * target database (drop + DDL). There is one test file today; the setting is here so
 * a second one cannot silently race over the same tables.
 *
 * The timeout is 120s rather than 30s: every scenario boots seven real listeners and
 * drives an order from intake through dispatch into a negotiation over real HTTP,
 * and one scenario stops the order engine and starts it again on the same port. It
 * runs in seconds on memory, and a cold Postgres service container in CI is what the
 * headroom is for.
 *
 * Reasoning in docs/12-testing/PHASE08_EXIT_GATE_E2E.md.
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
