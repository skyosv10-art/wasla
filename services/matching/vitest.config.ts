/**
 * Default vitest config — pure-core unit tests only.
 *
 * The matching domain has no database and no HTTP in MR 2/6, so every test here
 * runs in milliseconds on a machine without Postgres. Integration tests arrive
 * with the Drizzle adapters in MR 3/6 together with the `matching-db-integration`
 * CI job, exactly as in orders/customers/geography.
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
