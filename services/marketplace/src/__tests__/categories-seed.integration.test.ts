/**
 * بذرُ التصنيفاتِ على قاعدةٍ حقيقيّة: **يُنشئ ما غاب ولا يملك ما وُجد**.
 *
 * ## ما يُثبته هذا الملفُّ ولا يُثبته `category-seed.test.ts`
 *
 * ذاك يفحص الشجرةَ المُعلَنةَ وتسطيحَها بلا قاعدةٍ: ترتيبٌ، لاحقاتٌ فريدةٌ، حدودُ عنوانٍ. وهذه
 * كلُّها صحيحةٌ ولا تقول شيئاً عن الشيءِ الذي يُكسر في الإنتاج: **إعادةُ تشغيلِ المُهاجرة**.
 * فالبذرُ يُنادى في كلِّ نشرٍ، لا مرّةً واحدةً، وثلاثةُ أعطابٍ لا تظهر إلّا فوق قاعدة:
 *
 *  1. **الازدواج**: ركضةٌ ثانيةٌ تُدرِج نسخةً ثانيةً — أو تسقط بخطأِ تفرّدٍ فتُفشِل النشرَ كلَّه.
 *  2. **ترتيبُ المفاتيحِ الأجنبيّة**: ورقةٌ تُدرَج قبلَ أبيها تسقط بقيدِ `parent_category_id`،
 *     وهذا ما يجعل التسطيحَ «أبٌ قبلَ أوراقِه» عقداً لا ذوقاً.
 *  3. **ملكيّةُ الصفِّ**: تصنيفٌ عطّله مالكٌ يدويّاً يجب أن يبقى معطّلاً بعد ركضةٍ تالية. ولو
 *     كُتب البذرُ بـ`onConflictDoUpdate` لعاد التصنيفُ نشطاً صامتاً — عطبٌ يُلغي قرارَ مالكٍ
 *     ولا يُخلِّف سطراً في سجل.
 *
 * ## والبذرةُ المُعلَنةُ **فارغةٌ بقرار**
 *
 * `MARKETPLACE_CATEGORY_SEED` مجموعةٌ فارغةٌ: أيُّ شجرةِ تصنيفاتٍ حقيقيّةٍ قرارُ مالكِ منتَجٍ لا
 * اختيارُ مُنفِّذٍ. فتُفحَص هنا **آليّةُ** البذرِ بشجرةٍ محلّيّةٍ في الاختبارِ، ويُفحَص أنّ
 * المُعلَنةَ لا تكتب صفّاً — فلا يظنّ قارئٌ أنّ الخدمةَ تُهاجر كتالوجاً وهي لا تفعل.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MARKETPLACE_CATEGORY_SEED, type CategorySeedRoot } from "../domain/category-seed.js";
import { MarketplaceError } from "../domain/errors.js";
import { PG_ENABLED, countRows, resetData, setupPostgres, type PgFixture } from "./pg-harness.js";

/** شجرةٌ محلّيّةٌ للاختبارِ وحدَه: أبٌ وورقتان، ولا علاقةَ لها بالمُعلَنةِ في المجال. */
const FIXTURE: ReadonlyArray<CategorySeedRoot> = Object.freeze([
  Object.freeze({
    slug: "seed-electronics",
    labelAr: "إلكترونيّات",
    labelEn: "Electronics",
    sortOrder: 10,
    children: Object.freeze([
      Object.freeze({ slug: "seed-phones", labelAr: "هواتف", sortOrder: 1 }),
      Object.freeze({ slug: "seed-laptops", labelAr: "حواسيبُ محمولة", sortOrder: 2 }),
    ]),
  }),
  Object.freeze({
    slug: "seed-home",
    labelAr: "منزل",
    children: Object.freeze([Object.freeze({ slug: "seed-kitchen", labelAr: "مطبخ" })]),
  }),
]) as ReadonlyArray<CategorySeedRoot>;

describe.skipIf(!PG_ENABLED)("بذرُ التصنيفاتِ فوق Postgres", () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
  });

  afterAll(async () => {
    await pg?.close();
  });

  it("الركضةُ الأولى تُدرِج الشجرةَ كلَّها بأبٍ قبلَ أوراقِه", async () => {
    const first = await pg.stores.categories.seedCategories(FIXTURE);
    expect(first).toEqual({ inserted: 5, existing: 0 });
    expect(await countRows(pg.pool, "store_categories")).toBe(5);

    const rows = await pg.stores.categories.listCategories();
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    const parent = bySlug.get("seed-electronics")!;
    expect(parent.depth).toBe(1);
    expect(parent.parentCategoryId).toBeUndefined();
    expect(bySlug.get("seed-phones")!.depth).toBe(2);
    expect(bySlug.get("seed-phones")!.parentCategoryId).toBe(parent.categoryId);
    expect(bySlug.get("seed-kitchen")!.parentCategoryId).toBe(bySlug.get("seed-home")!.categoryId);
  });

  it("والركضةُ الثانيةُ لا تُدرِج شيئاً ولا تسقط — هذا هو معنى «قابلٌ للإعادة»", async () => {
    await pg.stores.categories.seedCategories(FIXTURE);
    const second = await pg.stores.categories.seedCategories(FIXTURE);
    expect(second).toEqual({ inserted: 0, existing: 5 });
    expect(await countRows(pg.pool, "store_categories")).toBe(5);
  });

  it("وثلاثُ ركضاتٍ لا تُغيّر المُعرِّفاتِ: البذرُ لا يُعيد إنشاءَ صفوفٍ يُشير إليها منتَج", async () => {
    await pg.stores.categories.seedCategories(FIXTURE);
    const before = (await pg.stores.categories.listCategories()).map((row) => row.categoryId);
    await pg.stores.categories.seedCategories(FIXTURE);
    await pg.stores.categories.seedCategories(FIXTURE);
    const after = (await pg.stores.categories.listCategories()).map((row) => row.categoryId);
    expect(after).toEqual(before);
  });

  it("وتعطيلٌ يدويٌّ يبقى بعد إعادةِ البذرِ — البذرُ لا يملك الصفَّ الموجود", async () => {
    await pg.stores.categories.seedCategories(FIXTURE);
    await pg.pool.query("UPDATE store_categories SET is_active = false WHERE slug = $1", [
      "seed-phones",
    ]);

    const again = await pg.stores.categories.seedCategories(FIXTURE);
    expect(again.inserted).toBe(0);

    const row = await pg.stores.categories.findBySlug("seed-phones");
    expect(row?.isActive).toBe(false);
  });

  it("وعنوانٌ عُدِّل يدويّاً يبقى معدّلاً كذلك", async () => {
    await pg.stores.categories.seedCategories(FIXTURE);
    await pg.pool.query("UPDATE store_categories SET label_ar = $1 WHERE slug = $2", [
      "عنوانُ مالكٍ",
      "seed-electronics",
    ]);
    await pg.stores.categories.seedCategories(FIXTURE);
    expect((await pg.stores.categories.findBySlug("seed-electronics"))?.labelAr).toBe("عنوانُ مالكٍ");
  });

  it("وشجرةٌ تُضاف إليها ورقةٌ تُدرِج الجديدَ وحدَه", async () => {
    await pg.stores.categories.seedCategories(FIXTURE);
    const grown: ReadonlyArray<CategorySeedRoot> = [
      ...FIXTURE.slice(0, 1),
      {
        ...FIXTURE[1]!,
        children: [...(FIXTURE[1]!.children ?? []), { slug: "seed-garden", labelAr: "حديقة" }],
      },
    ];
    const result = await pg.stores.categories.seedCategories(grown);
    expect(result).toEqual({ inserted: 1, existing: 5 });
    expect(await countRows(pg.pool, "store_categories")).toBe(6);
    expect((await pg.stores.categories.findBySlug("seed-garden"))?.depth).toBe(2);
  });

  it("والبذرةُ المُعلَنةُ فارغةٌ: لا صفَّ يُكتب، ولا كتالوجَ يُدَّعى", async () => {
    const result = await pg.stores.categories.seedCategories(MARKETPLACE_CATEGORY_SEED);
    expect(result).toEqual({ inserted: 0, existing: 0 });
    expect(await countRows(pg.pool, "store_categories")).toBe(0);
  });

  it("وشجرةٌ مرفوضةُ الشكلِ لا تكتب نصفَها: التحقّقُ قبلَ أوّلِ إدراج", async () => {
    const bad: ReadonlyArray<CategorySeedRoot> = [
      { slug: "seed-valid", labelAr: "صالح", children: [] },
      { slug: "Seed_Invalid", labelAr: "غيرُ صالح", children: [] },
    ];
    await expect(pg.stores.categories.seedCategories(bad)).rejects.toBeInstanceOf(MarketplaceError);
    expect(await countRows(pg.pool, "store_categories")).toBe(0);
  });
});
