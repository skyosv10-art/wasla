/**
 * مخزنُ التصنيفات: قراءةٌ للحكمِ، وإدخالٌ للبذرِ لا للمستخدم.
 *
 * ## القرار: `categoryFacts` تُعيد ما يحتاجه المجالُ لا الصفَّ كلَّه
 *
 * `assertStoreCategory` و`assertProductCategory` تحكمان بثلاثةِ حقولٍ: اللاحقةُ والعمقُ
 * والتفعيل. وتمريرُ الصفِّ كلِّه كان سيسمح لحكمٍ أن يعتمد على `sort_order` أو `label_ar` بلا
 * أن يلحظه أحد، ثمّ يصير ترتيبُ عرضٍ سبباً في رفضِ منتج.
 *
 * ## والإدخالُ مُعلَنٌ للبذرِ وحدَه
 *
 * `insertCategory` تُدرِج صفّاً واحداً ويستعملها الاختبارُ ليحصل على تصنيفٍ حقيقيّ، و
 * `seedCategories` تبذر شجرةً مُعلَنةً **قابلةً للإعادة**: تُنادى من `db/migrate-cli.ts` بعدَ
 * المخطّطِ، تُسطِّح الشجرةَ (أبٌ قبلَ أوراقِه كي يصحّ المفتاحُ الأجنبيّ)، وتُدرِج بـ
 * `onConflictDoNothing` على اللاحقةِ فلا تملك صفّاً موجوداً — تفصيلُ العلّةِ عند الدالّةِ
 * نفسِها. ولا مسارَ HTTP ينشئ تصنيفاً:
 * الشجرةُ بيانُ منصّةٍ لا مُدخلُ مستخدمٍ (وذاك نصُّ العقدِ في `store_categories`)، وفتحُها
 * للمستخدمِ كان سينتج «الكترونيات» و«إلكترونيات» تصنيفَين لمعنى واحد.
 *
 * ولا حذفَ تصنيفٍ ولا `is_active = false` من هنا: التعطيلُ قرارٌ إداريٌّ يملكه طورٌ لاحق،
 * وحذفُه كان سيترك منتجاتٍ بلا تصنيفٍ لا تظهر ولا تُشرَح.
 */

import { asc, eq, sql } from "drizzle-orm";

import type { DbOrTx } from "./client.js";
import { storeCategories } from "./schema.js";
import { toCategory, type CategoryRecord } from "./rows.js";
import {
  flattenCategorySeed,
  type CategorySeedRoot,
} from "../domain/category-seed.js";
import { validationFailed } from "../domain/errors.js";
import type { CategoryFacts } from "../domain/model.js";

/** مسوّدةُ تصنيفٍ للبذر: العمقُ والأبُ مُعلَنان معاً كي يحكم عليهما قيدُ العقدِ لا الكود. */
export interface CategoryDraft {
  readonly slug: string;
  readonly depth: number;
  readonly parentCategoryId?: string;
  readonly labelAr: string;
  readonly labelEn?: string;
  readonly labelUr?: string;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
}

export class PostgresCategoryStore {
  constructor(private readonly db: DbOrTx) {}

  async insertCategory(draft: CategoryDraft): Promise<CategoryRecord> {
    const rows = await this.db
      .insert(storeCategories)
      .values({
        categoryId: sql`gen_random_uuid()`,
        slug: draft.slug,
        depth: draft.depth,
        parentCategoryId: draft.parentCategoryId ?? null,
        labelAr: draft.labelAr,
        labelEn: draft.labelEn ?? null,
        labelUr: draft.labelUr ?? null,
        sortOrder: draft.sortOrder ?? 0,
        isActive: draft.isActive ?? true,
      })
      .returning();
    const row = rows[0];
    if (!row) throw validationFailed("store_category", "one inserted row");
    return toCategory(row);
  }

  async findById(categoryId: string): Promise<CategoryRecord | undefined> {
    const rows = await this.db
      .select()
      .from(storeCategories)
      .where(eq(storeCategories.categoryId, categoryId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toCategory(row);
  }

  async findBySlug(slug: string): Promise<CategoryRecord | undefined> {
    const rows = await this.db
      .select()
      .from(storeCategories)
      .where(eq(storeCategories.slug, slug))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toCategory(row);
  }

  /** حقائقُ الحكمِ وحدَها، أو `undefined` إن غاب الصفُّ — والقرارُ في `domain/catalog.ts`. */
  async categoryFacts(categoryId: string): Promise<CategoryFacts | undefined> {
    const record = await this.findById(categoryId);
    if (record === undefined) return undefined;
    return { slug: record.slug, depth: record.depth, isActive: record.isActive };
  }

  /**
   * يبذر شجرةً مُعلَنةً **عَكوساً**: ما وُجد يُترك، وما غاب يُكتب، ولا شيءَ يُدهَس.
   *
   * ## ولمَ `onConflictDoNothing` لا `onConflictDoUpdate`؟
   *
   * لأنّ التحديثَ يجعل البذرَ **مالكاً دائماً** للصفِّ: مالكٌ يعطّل تصنيفاً في لوحةٍ
   * يرى تعطيلَه يُلغى صامتاً في أوّلِ نشرٍ تالٍ، وهو أسوأُ من أن لا يعمل التعطيلُ أصلاً
   * لأنّه يعمل ثمّ يُراجع. والبذرُ **يُنشِئ ما غاب ولا يملك ما وُجد**؛ وتغييرُ عنوانٍ
   * مبذورٍ قرارُ مالكٍ لا أثرٌ جانبيٌّ لإعادةِ تشغيلِ مُهاجرة.
   *
   * ## ولمَ يُقرأ الأبُ بلاحقته بعد الإدخال؟
   *
   * لأنّ `onConflictDoNothing` تُعيد **صفرَ صفوفٍ** حين يكون الصفُّ موجوداً، فمُعرِّفُ الأبِ
   * لا يأتي من `returning()` في الركضةِ الثانية. وحملُ المُعرِّفِ من الركضةِ الأولى في الذاكرةِ
   * وحدَه كان سيعمل في المرّةِ الأولى ويسقط في الثانية — وهو أسوأُ أنواعِ العطب: عطبٌ لا
   * يظهر إلّا في بيئةٍ مُرقّاة لا في بيئةٍ نقيّة.
   */
  async seedCategories(
    roots: ReadonlyArray<CategorySeedRoot>,
  ): Promise<{ readonly inserted: number; readonly existing: number }> {
    const rows = flattenCategorySeed(roots);
    let inserted = 0;
    let existing = 0;

    for (const row of rows) {
      const parentCategoryId =
        row.parentSlug === undefined ? null : (await this.requireBySlug(row.parentSlug)).categoryId;

      const returned = await this.db
        .insert(storeCategories)
        .values({
          categoryId: sql`gen_random_uuid()`,
          slug: row.slug,
          depth: row.depth,
          parentCategoryId,
          labelAr: row.labelAr,
          labelEn: row.labelEn ?? null,
          labelUr: row.labelUr ?? null,
          sortOrder: row.sortOrder,
          isActive: true,
        })
        .onConflictDoNothing({ target: storeCategories.slug })
        .returning();

      if (returned[0] === undefined) existing += 1;
      else inserted += 1;
    }

    return { inserted, existing };
  }

  /** لاحقةٌ يجب أن توجد — والغيابُ عطبٌ في البذرِ لا حالةٌ يدور عليها المُنادي. */
  private async requireBySlug(slug: string): Promise<CategoryRecord> {
    const record = await this.findBySlug(slug);
    if (record === undefined) throw validationFailed("parent_slug", `a seeded category: ${slug}`);
    return record;
  }

  /** الشجرةُ كما تُعرض: بالعمقِ ثمّ بالترتيبِ المُعلَنِ ثمّ باللاحقة — ترتيبٌ تامٌّ وثابت. */
  async listCategories(): Promise<ReadonlyArray<CategoryRecord>> {
    const rows = await this.db
      .select()
      .from(storeCategories)
      .orderBy(
        asc(storeCategories.depth),
        asc(storeCategories.sortOrder),
        asc(storeCategories.slug),
      );
    return rows.map(toCategory);
  }
}
