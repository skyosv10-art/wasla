/**
 * مُهيئُ PostgreSQL لاختبارات تكامل خدمة الاشتراك والإحالة.
 *
 * أربعُ قواعدَ تجعل هذه الاختبارات دليلاً على العقد لا على نفسها:
 *
 *  1. المخطّطُ يُطبَّق بـ**المُهاجرةِ نفسِها** (`migrateSubscriptions`) لا بنسخةٍ ثانيةٍ من
 *     منطقِ التطبيق في الاختبار. فما يُفحَص هو ما سيركض في CI وفي الإنتاج؛ ومُهيئٌ يزرع
 *     الخطّةَ بيده كان سيُثبت أنّ الاختبارَ يعرف الأرقامَ، لا أنّ المُهاجرةَ تكتبها.
 *  2. بذرةُ الكتالوج **لا تُمسح** بين الاختبارات: `subscription_plans` و
 *     `subscription_plan_entitlements` بياناتُ عقدٍ يقرؤها كلُّ منحِ مُدّةٍ عبر مفتاحٍ أجنبيّ،
 *     ومسحُها كان سيُنتج اختباراتٍ حمراءَ لسببٍ لا علاقةَ له بالسلوك المفحوص
 *     (HANDOFF §16-و البند 3: البذرةُ من الترحيل لا من الكود).
 *  3. لا مشاركةَ بين ملفات الاختبار: كلُّها تملك قاعدةً واحدة، ولذلك يضبط إعدادُ التكامل
 *     `fileParallelism: false`.
 *  4. لا `sleep` ولا ساعةَ نظام: اللحظاتُ ثوابتُ نصّيّةٌ (`T0`) هي **نفسُها** التي تستعملها
 *     اختباراتُ المجال، فأيُّ فرقٍ يظهر يكون فرقَ استمراريّةٍ لا فرقَ بيئة.
 *
 * وتتخطّى حزمُ التكامل نفسَها عند غياب `DATABASE_URL`، فيبقى التشغيلُ على جهازٍ بلا
 * PostgreSQL ممكناً. الطريقةُ في `docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md`.
 */

import type { Pool } from "pg";

import { createSubscriptionDb, type Db } from "../db/client.js";
import { migrateSubscriptions } from "../db/migrate.js";
import { PostgresSubscriptionLedger } from "../db/repository.js";

/** وجودُ العنوان وحده هو مفتاحُ تشغيل التكامل؛ لا نفترض قاعدةً على جهاز المطوّر. */
export const DATABASE_URL = process.env.DATABASE_URL;
export const PG_ENABLED = Boolean(DATABASE_URL);

export const DRIVER = "WS-1000000001";
export const OTHER_DRIVER = "WS-1000000002";
export const T0 = "2026-03-01T00:00:00.000Z";
export const FROZEN_AT = "2026-02-01T00:00:00.000Z";

/**
 * الجداولُ العشرةُ بترتيبِ اعتمادٍ عكسيّ.
 *
 * `DROP ... CASCADE` متسامحٌ مع الترتيب، لكن `TRUNCATE` يحتاجه. وقائمةٌ واحدةٌ للإجراءين
 * تمنع إضافةَ جدولٍ إلى أحدهما ونسيانَه في الآخر.
 */
export const TABLES = [
  "subscription_outbox",
  "subscription_idempotency",
  "referral_rewards",
  "referrals",
  "referral_codes",
  "subscription_transitions",
  "subscription_periods",
  "subscriptions",
  "subscription_plan_entitlements",
  "subscription_plans",
] as const;

/** جداولُ الكتالوج — تُبذَر مرّةً بالمُهاجرة ولا تُمسح بين الاختبارات. */
const CONTRACT_SEEDED = new Set<string>([
  "subscription_plans",
  "subscription_plan_entitlements",
]);

const TRUNCATED_TABLES = TABLES.filter((table) => !CONTRACT_SEEDED.has(table));

export interface PgFixture {
  readonly pool: Pool;
  readonly db: Db;
  readonly ledger: PostgresSubscriptionLedger;
  readonly close: () => Promise<void>;
}

/** يُسقط جداولَ الخدمة وحدها ثمّ يُشغّل المُهاجرةَ كاملةً. */
export async function resetSchema(pool: Pool, db: Db): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
  await migrateSubscriptions(pool, db, FROZEN_AT);
}

/** يفتح مسبحاً ويُعيد بناءَ المخطّط قبل بدء الملف. */
export async function setupPostgres(): Promise<PgFixture> {
  const { pool, db } = createSubscriptionDb({ connectionString: DATABASE_URL!, max: 4 });
  await resetSchema(pool, db);
  return {
    pool,
    db,
    ledger: new PostgresSubscriptionLedger(db),
    close: () => pool.end(),
  };
}

/** يُنظّف أثرَ الاختبار السابق مع الإبقاء على بذرة الكتالوج. */
export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${TRUNCATED_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

/** يعدّ صفوفَ جدولٍ بعينه — لإثبات أنّ ما لم يُكتب لم يُكتب. */
export async function countRows(pool: Pool, table: (typeof TABLES)[number]): Promise<number> {
  const result = await pool.query<{ readonly count: string }>(
    `SELECT count(*)::text AS count FROM ${table}`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

/**
 * صفوفُ صندوقِ الصادرِ كلُّها بترتيبِ الوقوع — للاختبارِ وحدَه.
 *
 * ولمَ استعلامٌ نصّيٌّ هنا ولا في `db/`؟ لأنّ المخزنَ لا يُعلن «اقرأ كلَّ شيء»: منتَجاً،
 * القراءةُ إمّا مطالبةٌ بحدٍّ (`claimUnpublished`) أو صفٌّ بمُعرِّفه — وقائمةٌ بلا حدٍّ على
 * جدولٍ ينمو أبداً هي أوّلُ استعلامٍ يُسقط قاعدةً في الإنتاج. والاختبارُ يحتاج أن يرى
 * **ما نُشر أيضاً**، فيقرأ هنا بمسؤوليّتِه ولا يُوسّع سطحَ المخزن لأجلِه.
 */
export async function outboxSnapshot(pool: Pool): Promise<
  ReadonlyArray<{
    readonly eventId: string;
    readonly eventType: string;
    readonly aggregateType: string;
    readonly payload: unknown;
    readonly publishedAt: string | null;
    readonly attempts: number;
    readonly lastError: string | null;
    readonly traceId: string | null;
  }>
> {
  const result = await pool.query(
    `SELECT event_id, event_type, aggregate_type, payload,
            to_char(published_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS published_at,
            attempts, last_error, trace_id
       FROM subscription_outbox
      ORDER BY occurred_at, event_id`,
  );
  return result.rows.map((row) => ({
    eventId: row.event_id as string,
    eventType: row.event_type as string,
    aggregateType: row.aggregate_type as string,
    payload: row.payload as unknown,
    publishedAt: (row.published_at as string | null) ?? null,
    attempts: Number(row.attempts),
    lastError: (row.last_error as string | null) ?? null,
    traceId: (row.trace_id as string | null) ?? null,
  }));
}

/** أسماءُ قيودٍ مُسمّاةٍ موجودةٍ فعلاً في القاعدة — لإثبات أنّ العقد طُبّق لا وُصف. */
export async function constraintNames(pool: Pool): Promise<ReadonlyArray<string>> {
  const result = await pool.query<{ readonly conname: string }>(
    `SELECT c.conname AS conname
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = ANY($1::text[])
      ORDER BY c.conname`,
    [[...TABLES]],
  );
  return result.rows.map((row) => row.conname);
}

/** أسماءُ جداولِ الخدمة الموجودةِ في المخطّط الحاليّ. */
export async function tableNames(pool: Pool): Promise<ReadonlyArray<string>> {
  const result = await pool.query<{ readonly tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename`,
  );
  return result.rows.map((row) => row.tablename);
}
