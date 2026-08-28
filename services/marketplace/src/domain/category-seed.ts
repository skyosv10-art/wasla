/**
 * شجرةُ التصنيفاتِ الأوّليّةِ: **الشكلُ محكومٌ هنا، والمحتوى قرارٌ لم يُتَّخذ بعد**.
 *
 * ## لماذا المصفوفةُ المُعلَنةُ فارغةٌ اليوم
 *
 * `db/migrate.ts` أعلن في المراجعة 3/6 أنّ «التصنيفاتَ الأولى تملكها 5/6» وأعلن معها سببَ
 * التأجيل حرفاً: **بذرةٌ تُثبّت شجرةً لم يُقرّرها أحدٌ، ثمّ يصير حذفُها تعديلَ بياناتٍ في
 * الإنتاج لا تعديلَ كود**. وهذا السببُ لم يزل: لا ADR ولا وثيقةَ منتَجٍ في المستودعِ كلِّه
 * تُسمّي تصنيفاً واحداً — بحثٌ عن أيِّ لاحقةِ تصنيفٍ في `docs/` يعود فارغاً.
 *
 * فلو كتبتُ هنا «إلكترونيات · أزياء · طعام» لكنتُ **قرّرتُ تصنيفَ السوقِ بنفسي** في مراجعةٍ
 * موضوعُها الأحداثُ والمخزون، ثمّ لصار قرارُ منتَجٍ كاملٌ سطرَ كودٍ مدسوساً يمرّ في مراجعةٍ
 * لا أحدَ يقرؤه فيها بعينِ مالكِ منتَج. والفرقُ بين تأجيلٍ مُعلَنٍ وقرارٍ مدسوسٍ هو كلُّ ما
 * يفصل هذا الملفَّ عن عطبٍ في الإنتاج.
 *
 * فالمُنجَزُ في 5/6 هو **الآليّةُ محروسةً ومُختبَرةً**: الشكلُ (`assertCategorySeedTree`)
 * والتسطيحُ (`flattenCategorySeed`) والبذرُ العَكوسُ (`seedCategories` في `db/categories.ts`)
 * — كلُّها مفحوصةٌ على شجرةِ اختبارٍ حقيقيّةٍ. ويومَ يصدر القرارُ، التغييرُ **سطرُ بياناتٍ في
 * هذا الثابتِ وحدَه** بلا لمسِ آليّةٍ ولا مُهاجرةٍ ولا اختبار.
 *
 * ## ولماذا لا تُقرأ الشجرةُ من ملفِّ JSON خارجيّ؟
 *
 * لأنّ ملفّاً يُقرأ وقتَ التشغيلِ يجعل بياناتِ منصّةٍ خارجَ مراجعةِ الكودِ وخارجَ حارسِ
 * الشكل: يُعدَّل في بيئةٍ واحدةٍ فتختلف شجرةُ الإنتاجِ عن شجرةِ الاختبارِ بلا أثرٍ في `git`.
 * وحارسُ النقاءِ يقصر قراءةَ الملفّاتِ على `db/migrate.ts` وحدَه، وثقبٌ ثانٍ فيه لبياناتٍ
 * كان سيصير الطريقَ الذي يدخل منه كلُّ شيءٍ لاحقاً.
 */

import { validationFailed } from "./errors.js";
import { assertBoundedText, assertCategorySlug } from "./identifiers.js";

/** حدودُ العقدِ نصّاً: `store_categories` يفحص العنوانَ 2..64 والترتيبَ 0..999. */
export const CATEGORY_LABEL_MIN_LENGTH = 2;
export const CATEGORY_LABEL_MAX_LENGTH = 64;
export const CATEGORY_SORT_ORDER_MIN = 0;
export const CATEGORY_SORT_ORDER_MAX = 999;

/**
 * جذرٌ وأوراقُه — شجرةٌ مُعشَّشةٌ لا قائمةٌ مسطَّحةٌ بـ`parent_slug`.
 *
 * التعشيشُ يجعل «فرعٌ بلا أبٍ» **غيرَ قابلٍ للكتابة** أصلاً، فلا يحتاج حارساً يفحصه: قائمةٌ
 * مسطَّحةٌ كانت ستسمح بلاحقةِ أبٍ مطبوعةٍ خطأً تمرّ الشكلَ ثمّ تسقط على مفتاحٍ أجنبيٍّ في
 * منتصفِ البذرِ — نصفُ شجرةٍ مكتوبٌ ونصفٌ لا.
 */
export interface CategorySeedLeaf {
  readonly slug: string;
  readonly labelAr: string;
  readonly labelEn?: string;
  readonly labelUr?: string;
  readonly sortOrder?: number;
}

export interface CategorySeedRoot extends CategorySeedLeaf {
  readonly children: ReadonlyArray<CategorySeedLeaf>;
}

/** صفٌّ مسطَّحٌ جاهزٌ للإدخال: العمقُ محسوبٌ ولاحقةُ الأبِ مُعلَنةٌ للجذورِ `undefined`. */
export interface CategorySeedRow {
  readonly slug: string;
  readonly depth: 1 | 2;
  readonly parentSlug?: string;
  readonly labelAr: string;
  readonly labelEn?: string;
  readonly labelUr?: string;
  readonly sortOrder: number;
}

/**
 * الشجرةُ المبذورةُ في الإطلاق — **فارغةٌ حتّى قرارِ مالكِ المنتَج** (انظر رأسَ الملفّ).
 *
 * ومصفوفةٌ فارغةٌ ليست آليّةً معطّلةً: `seedCategories` تعمل عليها وتُعيد صفراً مبذوراً،
 * وهذا **ما يجب أن يحدث** قبل القرار. ولا سطرَ يُكتب في قاعدةٍ لشجرةٍ لا مالكَ لها.
 */
export const MARKETPLACE_CATEGORY_SEED: ReadonlyArray<CategorySeedRoot> = Object.freeze([]);

/**
 * يفحص شجرةً ويُسطّحها إلى صفوفٍ مرتَّبةٍ: كلُّ جذرٍ قبلَ أوراقِه.
 *
 * ## ولمَ الترتيبُ جزءٌ من العقدِ لا تفصيلُ حلقة؟
 *
 * لأنّ `fk_store_categories_parent` مفتاحٌ أجنبيٌّ يُفحَص عند كلِّ سطرٍ: ورقةٌ تُكتب قبل
 * جذرِها تسقط. وترتيبٌ يعتمد على ترتيبِ حلقتَين متداخلتَين في مكانِ النداءِ كان سيصير
 * صحيحاً بالحظِّ ثمّ يُكسَر عند أوّلِ إعادةِ ترتيبٍ «تجميليّة».
 *
 * واللواحقُ تُفحَص متفرّدةً في **الشجرةِ كلِّها** لا في كلِّ مستوى: `ux_store_categories_slug`
 * فريدٌ على الجدولِ كلِّه، وجذرٌ وورقةٌ بنفسِ اللاحقةِ كانا سيمرّان الشكلَ ثمّ يسقطان في
 * منتصفِ البذر.
 */
export function flattenCategorySeed(
  roots: ReadonlyArray<CategorySeedRoot>,
): ReadonlyArray<CategorySeedRow> {
  const rows: CategorySeedRow[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    rows.push(seedRow(root, 1, seen, undefined));
    for (const child of root.children) {
      rows.push(seedRow(child, 2, seen, root.slug));
    }
  }

  return Object.freeze(rows);
}

/** يفحص الشجرةَ ويُهمل الناتجَ — بابٌ مُسمّىً للحارسِ كي يُقرأ الفحصُ نيّةً لا أثراً جانبيّاً. */
export function assertCategorySeedTree(
  roots: ReadonlyArray<CategorySeedRoot>,
): ReadonlyArray<CategorySeedRoot> {
  flattenCategorySeed(roots);
  return roots;
}

function seedRow(
  node: CategorySeedLeaf,
  depth: 1 | 2,
  seen: Set<string>,
  parentSlug: string | undefined,
): CategorySeedRow {
  const slug = assertCategorySlug(node.slug, "slug");
  if (seen.has(slug)) throw validationFailed("slug", `a slug unique in the seed tree: ${slug}`);
  seen.add(slug);

  const sortOrder = node.sortOrder ?? CATEGORY_SORT_ORDER_MIN;
  if (
    !Number.isSafeInteger(sortOrder) ||
    sortOrder < CATEGORY_SORT_ORDER_MIN ||
    sortOrder > CATEGORY_SORT_ORDER_MAX
  ) {
    throw validationFailed(
      "sort_order",
      `integer between ${CATEGORY_SORT_ORDER_MIN} and ${CATEGORY_SORT_ORDER_MAX}`,
    );
  }

  return {
    slug,
    depth,
    ...(parentSlug === undefined ? {} : { parentSlug }),
    labelAr: label(node.labelAr, "label_ar"),
    ...(node.labelEn === undefined ? {} : { labelEn: label(node.labelEn, "label_en") }),
    ...(node.labelUr === undefined ? {} : { labelUr: label(node.labelUr, "label_ur") }),
    sortOrder,
  };
}

function label(value: string, field: string): string {
  return assertBoundedText(value, field, CATEGORY_LABEL_MIN_LENGTH, CATEGORY_LABEL_MAX_LENGTH);
}
