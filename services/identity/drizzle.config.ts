/**
 * drizzle-kit config. The canonical DDL is schema.sql (the contract, ADR-004);
 * this config lets `drizzle-kit generate/push` manage migrations from the
 * type-safe Drizzle schema (src/infrastructure/drizzle/schema.ts) when needed.
 *
 * Scripts: pnpm --filter @wasla/identity-service db:generate | db:push | db:studio
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/infrastructure/drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://wasla:wasla@localhost:5432/wasla",
  },
  strict: true,
  verbose: true,
});
