/**
 * CLI entry point for running migrations.
 *
 * Usage: tsx src/db/migrate-cli.ts
 * Reads DATABASE_URL from the environment.
 */

import { applyAuditSchema } from "./migrate.js";
import { default as pg } from "pg";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  try {
    console.log("Applying audit schema...");
    await applyAuditSchema(pool);
    console.log("Schema applied successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

await main();
