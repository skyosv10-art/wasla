/**
 * نقطة دخول اتصال PostgreSQL لخدمة التفاوض.
 *
 * هذه الطبقة لا تعرف قرارات المجال ولا حالات التفاوض؛ مهمتها الوحيدة تحويل إعداد الاتصال
 * إلى عميل `pg` وواجهة Drizzle. يبقى DDL الرسمي في `contracts/schema.sql`، ولا ينشئ هذا
 * الملف الجداول كي لا تصبح المرآة TypeScript مصدراً منافساً للعقد.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg, { type Pool } from 'pg';
import { guardPgPool, withPgPoolDefaults } from '@wasla/resilience';
import * as schema from './schema.js';
export type Db = NodePgDatabase<typeof schema>;
export type DbOrTx = Db;
export interface DbConfig {
  connectionString: string;
  max?: number;
}
export function createNegotiationDb(config: DbConfig): { pool: Pool; db: Db } {
  // RISK-0058 · ADR-059: bounded connect/query time, error listeners and a circuit breaker.
  const pool = guardPgPool(
    new pg.Pool(
      withPgPoolDefaults({
        connectionString: config.connectionString,
        max: config.max,
      }),
    ),
    { name: "negotiations" },
  );
  return { pool, db: drizzle(pool, { schema }) };
}
