/**
 * الترحيلُ: تطبيقُ `contracts/schema.sql` **حرفاً** لا توليدُ DDL من مرآةِ TypeScript.
 *
 * ## القرار: العقدُ هو ما يُطبَّقُ — والترحيلُ المولَّدُ **تكافؤٌ مُقاسٌ** لا بديلٌ
 *
 * نصُّ العقدِ كلُّهُ `CREATE … IF NOT EXISTS` و`CREATE OR REPLACE FUNCTION` و`DROP TRIGGER
 * IF EXISTS` قبلَ كلِّ `CREATE TRIGGER`، فتشغيلُهُ مرّتَينِ سالمٌ. وهو المُطبَّقُ في
 * `__tests__/pg-harness.ts` وفي أوّلِ إنشاءٍ لقاعدةٍ محليّةٍ.
 *
 * وقد انتظمتِ الخدمةُ في الترحيلاتِ المولَّدةِ (ADR-024 · الموجةُ الخامسةُ) لأنّ «طبِّقِ
 * العقدَ كاملاً أو لا شيءَ» لا يُعطي مساراً عكوساً مُرقَّماً لبيئةٍ فيها بياناتٌ — وكانَ
 * دَينُ هذهِ الخدمةِ **مُعلَناً بالحرفِ** في سجلِّ المهامِّ يومَ المراجعةِ التأسيسيّةِ:
 * «ترحيلٌ يُولَّدُ لاحقاً عندَ إضافةِ طبقةِ قاعدةِ البياناتِ». ثمّ أُضيفت طبقةُ القاعدةِ في
 * المراجعاتِ 2/N–5/N ولم يُولَّدِ الترحيلُ — فوجودُ الكودِ لم يكن إثباتاً.
 *
 * فالمولَّدُ في `drizzle/` هوَ مسارُ البيئاتِ، والعقدُ هوَ المرجعُ،
 * و`__tests__/migrations.integration.test.ts` يُثبتُ أنّهما يُنتجانِ **الكتالوجَ نفسَهُ** في
 * سبعةِ أبعادٍ — فلا يبقى للمخطَّطِ مصدرانِ يفترقانِ صامتَينِ.
 *
 * ## ولا Drizzle في التنفيذِ هنا بقصدٍ
 *
 * `pool.query(ddl)` لا `db.execute(sql.raw(ddl))`: مسارُ `pg` المباشرُ يُنفّذُ النصَّ كما هو
 * ويُعيدُ خطأَ Postgres بحرفِهِ ورقمِ سطرِهِ.
 *
 * ## ولا قراءةَ بيئةٍ هنا
 *
 * `connectionString` وسيطٌ، ومسارُ العقدِ يُشتقُّ من موقعِ هذا الملفِّ لا من `cwd`. وقارئُ
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
export async function applySearchSchema(pool: Pool): Promise<void> {
  await pool.query(readSchemaContract());
}
