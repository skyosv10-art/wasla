/**
 * Partners migration CLI — the only file in this package that reads the environment.
 *
 * Usage: `DATABASE_URL=… pnpm --filter @wasla/partners-service db:migrate`
 */

import { Pool } from "pg";

import { applyPartnersSchema } from "./migrate.js";

export async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run the partners migration");
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    await applyPartnersSchema(pool);
    process.stdout.write("partners schema applied · contracts/schema.sql executed verbatim\n");
  } finally {
    await pool.end();
  }
}

await main();
