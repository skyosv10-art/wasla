/**
 * الترحيلُ: تطبيقُ `contracts/schema.sql` **حرفاً** لا توليدُ DDL من مرآةِ TypeScript.
 *
 * نصُّ العقدِ كلُّهُ `CREATE … IF NOT EXISTS`، فتشغيلُهُ مرّتَينِ سالمٌ.
 *
 * `pool.query(ddl)` لا `db.execute(sql.raw(ddl))`: مسارُ `pg` المباشرُ يُنفّذُ النصَّ كما هو
 * ويُعيدُ خطأَ Postgres بحرفِهِ ورقمِ سطرِهِ.
 *
 * ولا قراءةَ بيئةٍ هنا: `connectionString` وسيطٌ، ومسارُ العقدِ يُشتقُّ من موقعِ هذا
 * الملفِّ لا من `cwd`. وقارئُ البيئةِ الوحيدُ هو `migrate-cli.ts`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

/** جذرُ الخدمةِ: `src/db/` ← `src/` ← جذرُ الحزمةِ. */
const SERVICE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** مسارُ العقدِ الوحيدُ المُعتمَدُ. */
export const SCHEMA_CONTRACT_PATH = join(SERVICE_ROOT, "contracts", "schema.sql");

export function readSchemaContract(): string {
  return readFileSync(SCHEMA_CONTRACT_PATH, "utf8");
}

/**
 * يُطبّقُ نصَّ العقدِ على القاعدةِ المُشارِ إليها بالمسبحِ.
 *
 * لا `BEGIN` هنا: النصُّ يحملُ معاملتَهُ بنفسِهِ.
 */
export async function applyIdentitySchema(pool: Pool): Promise<void> {
  await pool.query(readSchemaContract());
}
