/**
 * Default vitest config — pure-core unit tests only.
 *
 * Integration tests (`*.integration.test.ts`) need a live Postgres and arrive
 * with the Drizzle repositories in MR 3/6, together with their own CI job
 * (`customer-db-integration`). Excluding them here keeps `pnpm -r test` green
 * on a machine without a database, exactly like the geography service.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/__tests__/*.{integration,e2e}.test.ts",
    ],
  },
});
