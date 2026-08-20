/**
 * Integration vitest config — runs only the Postgres integration tests. Requires
 * a live database (DATABASE_URL). Skipped entirely when DATABASE_URL is unset.
 * (Wired in MR 4 alongside the Drizzle/Postgres adapter.)
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.{integration,e2e}.test.ts"],
  },
});
