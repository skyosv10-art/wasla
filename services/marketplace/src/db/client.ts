/**
 * نقطةُ دخولِ اتصالِ PostgreSQL لخدمةِ السوق.
 *
 * لا قرارَ مجالٍ هنا ولا اشتقاقَ حالةٍ ولا حكمَ ظهور: تحويلُ عنوانِ اتصالٍ إلى مسبحِ `pg`
 * وواجهةِ Drizzle وحدَه. ولا يُنشئ هذا الملفُّ جدولاً بحال: الـDDL الرسميُّ في
 * `contracts/schema.sql` (مُجمَّدٌ منذ المراجعة 1/6) ويُطبّقه `migrate.ts` **نصّاً**، وتوليدُ
 * الجداولِ من مرآةِ TypeScript كان سيجعل للمخطّطِ مصدرَين يختلفان أوّلَ مرّةٍ يُضاف قيدٌ في
 * أحدهما — واختلافاً كهذا يُكتشَف في الإنتاجِ لا في البناء (سابقةُ خدمةِ السمعة، وقرارُ
 * خدمةِ الاشتراكِ نفسُه في `services/subscriptions/src/db/client.ts`).
 *
 * ولا `process.env` هنا: العنوانُ **وسيطٌ** يمرّره المُنادي. قراءةُ البيئةِ داخلَ الطبقةِ كانت
 * ستجعل اختباراً يكتب في قاعدةٍ لم يُصرّح بها، وتُخفي أيَّ عنوانٍ استُعمل فعلاً. وقارئُ
 * البيئةِ الوحيدُ في هذه الحزمةِ هو `migrate-cli.ts` — مُعلَناً **بالاسم** في
 * `__tests__/purity.test.ts` لا بالنيّة.
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg, { type Pool } from "pg";

import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

/**
 * جذرُ الاتصالِ أو معاملةٌ جارية — نفسُ النوعِ بقصد.
 *
 * كلُّ مخزنٍ يأخذ `DbOrTx` ولا يفتح معاملةً بنفسِه: مالكُ الحدودِ هو `unit-of-work.ts`. ومخزنٌ
 * يفتح معاملتَه كان سيُنتج قراراً نصفَ مكتوب — سطرٌ في `store_reviews` وصفٌّ مُتحقِّقٌ في
 * `stores` لم يُحدَّث — أي متجرٌ اعتُمد في الدفترِ ويقول النظامُ إنّه `pending_review`. وذاك
 * عطبٌ لا يُصلحه إلّا تدخّلٌ يدويّ، لأنّ الصفَّ المُتحقِّقَ يبدو سليماً في ذاته.
 */
export type DbOrTx = Db;

export interface MarketplaceDbConfig {
  readonly connectionString: string;
  readonly max?: number;
}

export function createMarketplaceDb(config: MarketplaceDbConfig): {
  readonly pool: Pool;
  readonly db: Db;
} {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
  });
  return { pool, db: drizzle(pool, { schema }) };
}
