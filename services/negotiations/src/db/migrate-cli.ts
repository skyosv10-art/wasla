/**
 * حدُّ التشغيلِ للترحيلِ — **الملفُّ الوحيدُ في هذه الحزمةِ الذي يقرأُ البيئةَ**.
 *
 * التشغيل: `DATABASE_URL=… pnpm --filter @wasla/negotiations-service db:migrate`
 */

import { Pool } from "pg";

import { applyNegotiationsSchema } from "./migrate.js";

export async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run the negotiations migration");
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    await applyNegotiationsSchema(pool);
    process.stdout.write("negotiations schema applied · contracts/schema.sql executed verbatim\n");
  } finally {
    await pool.end();
  }
}

await main();
