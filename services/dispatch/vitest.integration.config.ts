/**
 * Integration vitest config — runs only the Postgres tests of the dispatch
 * service. Requires a live database (DATABASE_URL); every file here skips itself
 * when DATABASE_URL is unset, so the command is safe to run anywhere.
 *
 * `fileParallelism: false` is required, not a preference: every file owns the
 * schema (DROP TABLE + canonical DDL) of the SAME database, so two files in
 * parallel workers would race on those tables.
 *
 * CI job: `dispatch-db-integration` (see .gitlab-ci.yml).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.{integration,e2e}.test.ts"],
    fileParallelism: false,
  },
});
