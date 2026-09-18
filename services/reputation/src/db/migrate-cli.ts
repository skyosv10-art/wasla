/**
 * حدُّ التشغيلِ للترحيلِ — **الملفُّ الوحيدُ في هذه الحزمةِ الذي يقرأُ البيئةَ**.
 *
 * التشغيل: `DATABASE_URL=… pnpm --filter @wasla/reputation-service db:migrate`
 */

import { Pool } from "pg";

import { applyReputationSchema } from "./migrate.js";

export async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run the reputation migration");
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    await applyReputationSchema(pool);
    process.stdout.write("reputation schema applied · contracts/schema.sql executed verbatim\n");
  } finally {
    await pool.end();
  }
}

await main();
