/**
 * حدُّ التشغيلِ للترحيلِ — **الملفُّ الوحيدُ في هذه الحزمةِ الذي يقرأُ البيئةَ**.
 *
 * التشغيل: `DATABASE_URL=… pnpm --filter @wasla/drivers-service db:migrate`
 */

import { Pool } from "pg";

import { applyDriversSchema } from "./migrate.js";

export async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run the drivers migration");
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    await applyDriversSchema(pool);
    process.stdout.write("drivers schema applied · contracts/schema.sql executed verbatim\n");
  } finally {
    await pool.end();
  }
}

await main();
