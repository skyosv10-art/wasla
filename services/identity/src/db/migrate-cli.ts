/**
 * حدُّ التشغيلِ للترحيلِ — **الملفُّ الوحيدُ في هذه الحزمةِ الذي يقرأُ البيئةَ**.
 *
 * التشغيل: `DATABASE_URL=… pnpm --filter @wasla/identity-service db:migrate`
 */

import { Pool } from "pg";

import { applyIdentitySchema } from "./migrate.js";

export async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run the identity migration");
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    await applyIdentitySchema(pool);
    process.stdout.write("identity schema applied · contracts/schema.sql executed verbatim\n");
  } finally {
    await pool.end();
  }
}

await main();
