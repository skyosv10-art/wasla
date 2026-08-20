/**
 * drizzle-kit config. The canonical DDL is
 * packages/channel-core/contracts/schema.sql (the contract, ADR-004/006/007);
 * this config lets `drizzle-kit generate/push` manage migrations from the
 * type-safe Drizzle projection in src/schema.ts when a migration is needed.
 *
 * Scripts: pnpm --filter @wasla/channel-postgres db:generate | db:push | db:studio
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://wasla:wasla@localhost:5432/wasla",
  },
  strict: true,
  verbose: true,
});
