/**
 * حدُّ التشغيلِ للترحيلِ — **الملفُّ الوحيدُ في هذه الحزمةِ الذي يقرأُ البيئةَ**.
 *
 * التشغيل: `DATABASE_URL=… pnpm --filter @wasla/billing-service db:migrate`
 */

import { Pool } from "pg";

import { applyBillingSchema } from "./migrate.js";

export async function main(): Promise<void> {
  const connectionString = process.env.BILLING_DATABASE_URL;
  if (!connectionString) {
    throw new Error("BILLING_DATABASE_URL is required to run the billing migration");
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    await applyBillingSchema(pool);
    process.stdout.write("billing schema applied · contracts/schema.sql executed verbatim\n");
  } finally {
    await pool.end();
  }
}

await main();
