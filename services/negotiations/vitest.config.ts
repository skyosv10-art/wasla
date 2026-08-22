/**
 * Default vitest config — pure-core unit tests only.
 *
 * The negotiation domain has no database and no HTTP in MR 2/6, so the whole suite runs
 * in milliseconds on a machine without Postgres — including the expiry and tick tests,
 * which drive a clock by hand instead of sleeping. Integration tests arrive with the
 * Drizzle adapters in MR 3/6 together with the `negotiations-db-integration` CI job,
 * exactly as in drivers/matching/dispatch/orders/customers/geography.
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
