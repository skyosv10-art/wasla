/**
 * Integration vitest config — runs only the Postgres integration tests. Requires
 * a live database (DATABASE_URL). Skipped entirely when DATABASE_URL is unset.
 * (Wired in MR 4 alongside the Drizzle/Postgres adapter.)
 *
 * `fileParallelism: false` is required, not a preference: every file here owns
 * the schema (DROP TABLE + DDL + seed) of the SAME database, so running two
 * files in parallel workers would race on those tables. Added in MR 7 when the
 * Phase 02 Exit Gate E2E became the second file to touch the geo_* schema.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.{integration,e2e}.test.ts"],
    fileParallelism: false,
  },
});
