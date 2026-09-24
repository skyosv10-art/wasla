/**
 * M4-02 Golden Journeys — staging-targeted E2E tests.
 *
 * These tests drive deployed Render staging URLs over HTTP. They are NOT
 * in-process harness tests — they require `GOLDEN_STAGING_BASE` to be set
 * (defaults to https://wasla-<service>.onrender.com convention).
 *
 * Without `GOLDEN_STAGING_BASE`, tests are skipped with a documented reason.
 *
 * `fileParallelism: false` because staging services share a database and
 * concurrent journeys could interfere.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.golden.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
