/**
 * Default vitest config — runs the pure-core unit tests only. Integration tests
 * (`*.integration.test.ts`) need a live Postgres and are excluded from the
 * default `pnpm -r test` run so CI stays green without a DB (DB wiring arrives
 * in MR 4 via a GitLab postgres service). Run them explicitly with:
 *   pnpm --filter @wasla/identity-service test:integration
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/__tests__/**/*.integration.test.ts",
    ],
  },
});
