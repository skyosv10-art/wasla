/**
 * حدُّ التشغيلِ للترحيلِ — **الملفُّ الوحيدُ في هذه الحزمةِ الذي يقرأُ البيئةَ**.
 *
 * التشغيل: `DATABASE_URL=… pnpm --filter @wasla/dispatch-service db:migrate`
 */

import { Pool } from "pg";

import { applyDispatchSchema } from "./migrate.js";

export async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run the dispatch migration");
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    await applyDispatchSchema(pool);
    process.stdout.write("dispatch schema applied · contracts/schema.sql executed verbatim\n");
  } finally {
    await pool.end();
  }
}

await main();
