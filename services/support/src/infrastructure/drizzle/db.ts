/**
 * نقطةُ دخول اتصال PostgreSQL لخدمة الدعم.
 *
 * لا قرارَ مجالٍ هنا ولا معرفةَ نتيجةٍ ولا إشارة: تحويلُ إعدادِ اتصالٍ إلى عميل `pg`
 * وواجهةِ Drizzle وحده. ولا يُنشئ هذا الملفُّ جدولاً: الـDDL الرسميُّ في
 * `contracts/schema.sql`، وتوليدُ الجداول من المرآة كان سيجعل TypeScript مصدراً منافساً
 * للعقد.
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg, { type Pool } from "pg";
import { guardPgPool, withPgPoolDefaults } from "@wasla/resilience";

import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

/**
 * جذرُ الاتصال أو معاملةٌ جارية — نفسُ النوع.
 *
 * كلُّ مستودعٍ يأخذ `DbOrTx` ولا يفتح معاملةً بنفسه.
 */
export type DbOrTx = Db;

export interface SupportDbConfig {
  readonly connectionString: string;
  readonly max?: number;
}

export function createSupportDb(config: SupportDbConfig): {
  readonly pool: Pool;
  readonly db: Db;
} {
  // RISK-0058 · ADR-059: bounded connect/query time, error listeners and a circuit breaker.
  const pool = guardPgPool(
    new pg.Pool(
      withPgPoolDefaults({
        connectionString: config.connectionString,
        max: config.max ?? 10,
      }),
    ),
    { name: "support" },
  );
  return { pool, db: drizzle(pool, { schema }) };
}
