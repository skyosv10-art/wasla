/**
 * Default vitest config — the unit suite only (the schema-drift guard).
 *
 * Integration tests (`*.integration.test.ts`) need a live Postgres and are
 * excluded from `pnpm -r test`, so the default pipeline stays green without a
 * database. Run them explicitly:
 *   DATABASE_URL=… pnpm --filter @wasla/channel-postgres test:integration
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/__tests__/*.{integration,e2e}.test.ts"],
  },
});
