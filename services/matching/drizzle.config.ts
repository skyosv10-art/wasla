/**
 * drizzle-kit config for the Matching service.
 *
 * The canonical DDL is `contracts/schema.sql` (ADR-011); this config
 * only lets `drizzle-kit generate/push/studio` work from the type-safe Drizzle
 * projection when a migration or an inspection is needed. Generating a migration
 * never replaces updating the contract: the contract is what reviewers read.
 *
 * Scripts: pnpm --filter @wasla/matching-service db:generate | db:push | db:studio
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/infrastructure/drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://wasla:wasla@localhost:5432/wasla_matching",
  },
  strict: true,
  verbose: true,
});
