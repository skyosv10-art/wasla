/**
 * نقطةُ دخول اتصال PostgreSQL لخدمة الاشتراك والإحالة.
 *
 * لا قرارَ مجالٍ هنا ولا اشتقاقَ حالةٍ ولا حسابَ يوم: تحويلُ عنوانِ اتصالٍ إلى مسبح `pg`
 * وواجهةِ Drizzle وحده. ولا يُنشئ هذا الملفُّ جدولاً: الـDDL الرسميُّ في
 * `contracts/schema.sql` (مُجمَّد، المراجعة 1/6) ويُطبّقه `migrate.ts` نصّاً، وتوليدُ
 * الجداول من مرآة TypeScript كان سيجعل للمخطّط مصدرَين يختلفان أوّلَ مرّةٍ يُضاف قيدٌ في
 * أحدهما — واختلافاً كهذا يُكتشَف في الإنتاج لا في البناء (سابقةُ
 * `services/reputation/src/infrastructure/drizzle/db.ts`).
 *
 * ولا `process.env` هنا: العنوانُ **وسيطٌ** يمرّره المُنادي. قراءةُ البيئةِ داخل الطبقة كانت
 * ستجعل اختباراً يكتب في قاعدةٍ لم يُصرّح بها، وتُخفي أيَّ عنوانٍ استُعمل فعلاً. وقارئُ
 * البيئةِ الوحيدُ في هذه الحزمة هو `migrate-cli.ts` — وهو مُعلَنٌ بالاسم في
 * `__tests__/purity.test.ts`.
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg, { type Pool } from "pg";

import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

/**
 * جذرُ الاتصال أو معاملةٌ جارية — نفسُ النوع.
 *
 * كلُّ مخزنٍ يأخذ `DbOrTx` ولا يفتح معاملةً بنفسه: مالكُ الحدود هو من يُنادي (وحدةُ العمل
 * تأتي مع المراجعة 4/6). ومخزنٌ يفتح معاملتَه كان سيُنتج قراراً نصفَ مكتوب: مُدّةٌ دخلت
 * الدفترَ وانتقالٌ لم يُسجَّل، فتصير حالةُ سائقٍ مُشتقّةً من دفترٍ لا يُفسّرها.
 */
export type DbOrTx = Db;

export interface SubscriptionDbConfig {
  readonly connectionString: string;
  readonly max?: number;
}

export function createSubscriptionDb(config: SubscriptionDbConfig): {
  readonly pool: Pool;
  readonly db: Db;
} {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
  });
  return { pool, db: drizzle(pool, { schema }) };
}
