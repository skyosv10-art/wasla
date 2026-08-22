/**
 * Default vitest config — pure-core unit tests only.
 *
 * The dispatch domain in MR 4/6 has no database and no HTTP, so every test here
 * runs in milliseconds on a machine without Postgres. Integration tests arrive
 * with the Drizzle adapters in MR 5/6 together with the `dispatch-db-integration`
 * CI job, exactly as in orders/customers/geography/matching.
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
