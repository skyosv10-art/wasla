/**
 * M5-14 exit gate — partners E2E.
 *
 * Tenant isolation + SLA proof on real PostgreSQL + real HTTP wire.
 * Skips without DATABASE_URL (describe.skipIf).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.e2e.test.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
