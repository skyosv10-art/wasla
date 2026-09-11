/**
 * الترحيلُ: تطبيقُ `contracts/schema.sql` **حرفاً** لا توليدُ DDL من مرآةِ TypeScript.
 *
 * ## القرار: العقدُ هو ما يُطبَّقُ — والترحيلُ المولَّدُ **تكافؤٌ مُقاسٌ** لا بديلٌ
 *
 * نصُّ العقدِ كلُّهُ `CREATE TABLE IF NOT EXISTS` و`CREATE INDEX IF NOT EXISTS`
 * و`CREATE SEQUENCE IF NOT EXISTS`، فتشغيلُهُ مرّتَينِ سالمٌ. وهو المُطبَّقُ في اختباراتِ
 * التكاملِ وفي أوّلِ إنشاءٍ لقاعدةٍ محليّةٍ.
 *
 * وقد انتظمتِ الخدمةُ في الترحيلاتِ المولَّدةِ (ADR-024) لأنّ «طبِّقِ العقدَ كاملاً أو لا شيءَ»
 * لا يُعطي مساراً عكوساً مُرقَّماً لبيئةٍ فيها بياناتٌ. فالمولَّدُ في `drizzle/` هو مسارُ
 * البيئاتِ، والعقدُ هو المرجعُ، و`__tests__/migrations.integration.test.ts` يُثبتُ أنّهما
 * يُنتجانِ **الكتالوجَ نفسَهُ** في سبعةِ أبعادٍ — فلا يبقى للمخطَّطِ مصدرانِ يفترقانِ صامتَينِ.
 *
 * ## ولا Drizzle في التنفيذِ هنا بقصدٍ
 *
 * `pool.query(ddl)` لا `db.execute(sql.raw(ddl))`: مسارُ `pg` المباشرُ يُنفّذُ النصَّ كما هو
 * ويُعيدُ خطأَ Postgres بحرفِهِ ورقمِ سطرِهِ — وهذا فرقٌ يُقاسُ في الدقائقِ عندَ أوّلِ خطأٍ.
 *
 * ## ولا قراءةَ بيئةٍ هنا
 *
 * `connectionString` وسيطٌ، ومسارُ العقدِ يُشتقُّ من موقعِ هذا الملفِّ لا من `cwd`: مُنادٍ
 * يركضُ من جذرِ المستودعِ ومُنادٍ يركضُ من مجلَّدِ الخدمةِ يجبُ أن يقرآ نفسَ الملفِّ. وقارئُ
 * البيئةِ الوحيدُ هو `migrate-cli.ts`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

/** جذرُ الخدمةِ: `src/db/` ← `src/` ← جذرُ الحزمةِ. */
const SERVICE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** مسارُ العقدِ الوحيدُ المُعتمَدُ — يُقرأُ في الحارسِ نفسِهِ كي لا يوجدَ مسارانِ. */
export const SCHEMA_CONTRACT_PATH = join(SERVICE_ROOT, "contracts", "schema.sql");

export function readSchemaContract(): string {
  return readFileSync(SCHEMA_CONTRACT_PATH, "utf8");
}

/**
 * يُطبّقُ نصَّ العقدِ على القاعدةِ المُشارِ إليها بالمسبحِ.
 *
 * لا `BEGIN` هنا: النصُّ يحملُ معاملتَهُ بنفسِهِ.
 */
export async function applyDeliverySchema(pool: Pool): Promise<void> {
  await pool.query(readSchemaContract());
}
