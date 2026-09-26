/**
 * نقطةُ دخول اتصال PostgreSQL لخدمة الفوترة.
 *
 * لا قرارَ مجالٍ هنا ولا معرفةَ نتيجةٍ ولا إشارة: تحويلُ إعدادِ اتصالٍ إلى عميل `pg`
 * وواجهةِ Drizzle وحده. ولا يُنشئ هذا الملفُّ جدولاً: الـDDL الرسميُّ في
 * `contracts/schema.sql`، وتوليدُ الجداول من المرآة كان سيجعل TypeScript مصدراً منافساً
 * للعقد.
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg, { type Pool } from "pg";

import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export type DbOrTx = Db;

export interface BillingDbConfig {
  readonly connectionString: string;
  readonly max?: number;
}

export function createBillingDb(config: BillingDbConfig): {
  readonly pool: Pool;
  readonly db: Db;
} {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
  });
  return { pool, db: drizzle(pool, { schema }) };
}
