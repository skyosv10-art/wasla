/**
 * مُهيِّئُ PostgreSQL لاختباراتِ تكاملِ خدمةِ السوق.
 *
 * أربعُ قواعدَ تجعل هذه الاختباراتَ دليلاً على العقدِ لا على نفسِها:
 *
 *  1. المخطّطُ يُطبَّق بـ**المُهاجرةِ نفسِها** (`applyMarketplaceSchema`) لا بنسخةٍ ثانيةٍ من
 *     DDL في الاختبار. فما يُفحَص هو ما سيركض في CI وفي الإنتاج؛ ومُهيِّئٌ يكتب الجداولَ بيدِه
 *     كان سيُثبت أنّ الاختبارَ يعرف المخطّطَ، لا أنّ المُهاجرةَ تُطبّقه.
 *  2. لا بذرةَ عقدٍ في هذه المراجعة: التصنيفاتُ تُبذَر في المراجعة 5/6، فكلُّ اختبارٍ هنا
 *     يُنشئ تصنيفَه بنفسِه ويمسحُه. ولذلك `TRUNCATE` يشمل الجداولَ الثمانيةَ كلَّها بلا استثناء
 *     — واستثناءٌ يُكتب اليومَ لجدولٍ لا بذرةَ له كان سيصير كذبةً محفوظةً في الاختبار.
 *  3. لا مشاركةَ بين ملفّاتِ الاختبار: كلُّها تملك قاعدةً واحدةً، ولذلك يضبط إعدادُ التكاملِ
 *     `fileParallelism: false`.
 *  4. لا `sleep` ولا ساعةَ نظامٍ: اللحظاتُ ثوابتُ نصّيّةٌ (`T0` وما بعدَه) هي **نفسُها** التي
 *     تستعملها اختباراتُ المجالِ، فأيُّ فرقٍ يظهر يكون فرقَ استمراريّةٍ لا فرقَ بيئة.
 *
 * وتتخطّى حزمُ التكاملِ نفسَها عند غيابِ `DATABASE_URL`، فيبقى التشغيلُ على جهازٍ بلا
 * PostgreSQL ممكناً. الطريقةُ في `docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md` (المنفذ 55432).
 */

import type { Pool } from "pg";

import { constraintOf } from "../db/constraints.js";
import { createMarketplaceDb, type Db } from "../db/client.js";
import { applyMarketplaceSchema } from "../db/migrate.js";
import { bindStores, type MarketplaceStores } from "../db/unit-of-work.js";

/** وجودُ العنوانِ وحدَه هو مفتاحُ تشغيلِ التكامل؛ لا نفترض قاعدةً على جهازِ المطوّر. */
export const DATABASE_URL = process.env.DATABASE_URL;
export const PG_ENABLED = Boolean(DATABASE_URL);

export const OWNER = "WS-1000000001";
export const OTHER_OWNER = "WS-1000000002";
export const MODERATOR = "WS-9000000001";
export const MEMBER = "WS-1000000003";

export const T0 = "2026-03-01T00:00:00.000Z";
export const T1 = "2026-03-02T00:00:00.000Z";
export const T2 = "2026-03-03T00:00:00.000Z";

/**
 * الجداولُ العشرةُ بترتيبِ اعتمادٍ عكسيّ.
 *
 * `DROP ... CASCADE` متسامحٌ مع الترتيب، لكن `TRUNCATE` يحتاجه. وقائمةٌ واحدةٌ للإجراءَين
 * تمنع إضافةَ جدولٍ إلى أحدهما ونسيانَه في الآخر.
 */
export const TABLES = [
  "marketplace_outbox",
  "marketplace_idempotency",
  "product_inventory",
  "inventory_adjustments",
  "product_reviews",
  "products",
  "store_staff",
  "store_reviews",
  "stores",
  "store_categories",
] as const;

export interface PgFixture {
  readonly pool: Pool;
  readonly db: Db;
  readonly stores: MarketplaceStores;
  readonly close: () => Promise<void>;
}

/** يُسقط جداولَ الخدمةِ وحدَها ثمّ يُشغّل المُهاجرةَ كاملةً. */
export async function resetSchema(pool: Pool): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
  await applyMarketplaceSchema(pool);
}

/** يفتح مسبحاً ويُعيد بناءَ المخطّطِ قبل بدءِ الملف. */
export async function setupPostgres(): Promise<PgFixture> {
  const { pool, db } = createMarketplaceDb({ connectionString: DATABASE_URL!, max: 4 });
  await resetSchema(pool);
  return { pool, db, stores: bindStores(db), close: () => pool.end() };
}

/** يُنظّف أثرَ الاختبارِ السابقِ — الجداولُ كلُّها، فلا بذرةَ عقدٍ في هذه المراجعة. */
export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

/** يعدّ صفوفَ جدولٍ بعينه — لإثباتِ أنّ ما لم يُكتب لم يُكتب. */
export async function countRows(pool: Pool, table: (typeof TABLES)[number]): Promise<number> {
  const result = await pool.query<{ readonly count: string }>(
    `SELECT count(*)::text AS count FROM ${table}`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

/** أسماءُ قيودٍ مُسمّاةٍ موجودةٍ فعلاً في القاعدة — لإثباتِ أنّ العقدَ طُبّق لا وُصف. */
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

/** أسماءُ جداولِ الخدمةِ الموجودةِ في المخطّطِ الحاليّ. */
export async function tableNames(pool: Pool): Promise<ReadonlyArray<string>> {
  const result = await pool.query<{ readonly tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename`,
  );
  return result.rows.map((row) => row.tablename);
}

/** أسماءُ الفهارسِ — الفهرسُ الجزئيُّ حارسُ تفرّدٍ لا تحسين، فوجودُه يُفحَص بالاسم. */
export async function indexNames(pool: Pool): Promise<ReadonlyArray<string>> {
  const result = await pool.query<{ readonly indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() ORDER BY indexname`,
  );
  return result.rows.map((row) => row.indexname);
}

/**
 * اسمُ القيدِ الذي أسقط وعداً — أو `undefined` إن لم يسقط.
 *
 * ولمَ لا `toThrow(/اسم القيد/)`؟ لأنّ Drizzle يلفّ خطأَ المُشغّلِ في خطأٍ رسالتُه نصُّ
 * الاستعلامِ وحدَه، واسمُ القيدِ يقيم في `cause`. ومطابقةُ رسالةٍ كانت ستمرّ على أيِّ فشلِ
 * استعلامٍ آخرَ على نفسِ الجدول — أي اختبارٌ أخضرُ لا يفحص ما يقول إنّه يفحصه. وهذه الدالّةُ
 * تستعمل `constraintOf` **نفسَها** التي تستعملها الترجمةُ في الإنتاج، فيُفحَص الطريقُ الحقيقيُّ.
 */
export async function rejectingConstraint(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return constraintOf(error);
  }
}

/** تصنيفٌ ورقيٌّ جاهزٌ للاستعمال — أبٌ في العمق 1 وابنٌ في العمق 2 (الورقةُ وحدَها تقبل). */
export async function seedLeafCategory(
  stores: MarketplaceStores,
  slug = "electronics-phones",
): Promise<string> {
  const parent = await stores.categories.insertCategory({
    slug: `${slug}-parent`,
    depth: 1,
    labelAr: "إلكترونيّات",
    isActive: true,
  });
  const leaf = await stores.categories.insertCategory({
    slug,
    depth: 2,
    parentCategoryId: parent.categoryId,
    labelAr: "هواتف",
    isActive: true,
  });
  return leaf.categoryId;
}
