/**
 * Integration vitest config — only the Postgres tests. Requires DATABASE_URL;
 * every file skips itself when it is unset.
 *
 * `fileParallelism: false` is required, not a preference: each file owns the
 * schema (DROP TABLE + canonical DDL) of the SAME database, so parallel workers
 * would race on those tables.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.{integration,e2e}.test.ts"],
    fileParallelism: false,
  },
});
