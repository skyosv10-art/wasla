/**
 * الكتالوج: مسوّدةُ متجرٍ ومسوّدةُ منتجٍ وقواعدُ التصنيفِ وقفلُ اللاحقة.
 *
 * هذا الملفُّ هو حيث تتلاقى الحرّاسُ المتفرّقةُ في **عمليّةٍ واحدةٍ تُنتج شكلاً جاهزاً للكتابة**:
 * لا يكفي أن يكون كلُّ حقلٍ صحيحاً وحدَه، بل يجب أن يكون الشكلُ الناتجُ كاملاً بحالته الأولى
 * وتسلسلِه الأوّل. ولمَ في المجالِ لا في المُتحكِّم؟ لأنّ للمتجرِ ثلاثةَ مسارات إنشاءٍ
 * محتملةٍ (بوتُ الشريك · لوحةُ الإدارة · استيرادٌ جماعيّ لاحقاً)، ومن ترك التجميعَ للمُتحكِّم
 * أنشأ متجراً معتمَداً بمسارٍ نسي حقلاً وأنشأه مسوّدةً بمسارٍ آخر.
 *
 * ## التصنيف: ورقةٌ للمنتجِ، وأيُّ عمقٍ للمتجر
 *
 * القرار 3 من مخطّطِ التصنيف: عمقُ الشجرةِ اثنان، و«الورقةُ» هي العمقُ 2 **حساباً لا عموداً**
 * (`is_leaf` مُخزَّنٌ يصير كذباً أوّلَ مرّةٍ يُضاف فرعٌ تحت ورقة). والمنتجُ يلزمه تصنيفٌ ورقةٌ
 * لأنّ تصنيفاً أعلى يجعل «مطاعم» سلّةً لكلّ شيءٍ فلا يُفيد تصفيةً ولا بحثاً؛ والمتجرُ يجوز له
 * العمقُ 1 لأنّ متجراً قد يبيع أنواعاً في العائلةِ نفسِها.
 *
 * والتفعيلُ يُفحَص للاثنَين: تصنيفٌ مُعطَّلٌ قرارٌ إداريٌّ بإيقافِ بابٍ في السوق، ولو قَبِله
 * الإنشاءُ لصار الإيقافُ بلا أثرٍ إلّا على القديم.
 *
 * ## قفلُ `slug` بعد أوّلِ اعتماد
 *
 * القرار 7. قبل أوّلِ اعتمادٍ تُعدَّل بحرّيّة (لم يُنشَر رابطٌ بعد)، وبعده تُقفَل إلى الأبد —
 * وإن أُوقف المتجرُ أو أُرشِف. ولمَ أوّلُ اعتمادٍ لا آخرُه؟ لأنّ الرابطَ يُنشَر بعد الاعتمادِ
 * الأوّل، وما نُشِر في محادثةٍ أو مُلصَقٍ لا يُسحب بإيقافٍ ثمّ إعادة. والأرشفةُ لا تُحرّر
 * اللاحقةَ لأحدٍ آخر: رابطٌ قديمٌ يجب أن يقول «انتهى هذا المتجر» لا أن يفتح متجرَ غريبٍ اشترى
 * اللاحقةَ بعده.
 */

import {
  CATEGORY_MAX_DEPTH,
  STORE_ACTIVE_LIMIT_PER_OWNER,
  type ProductModerationState,
  type ProductState,
  type StoreState,
} from "./contract-sets.js";
import {
  STORE_SLUG_FIELD,
  productCategoryNotLeaf,
  productNotModerated,
  storeCategoryInactive,
  storeNotApproved,
  storeOwnerLimitReached,
  validationFailed,
} from "./errors.js";
import {
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_TITLE_MAX_LENGTH,
  PRODUCT_TITLE_MIN_LENGTH,
  STORE_DESCRIPTION_MAX_LENGTH,
  STORE_TITLE_MAX_LENGTH,
  STORE_TITLE_MIN_LENGTH,
  assertBoundedText,
  assertOptionalBoundedText,
  assertProductSku,
  assertStoreSlug,
  assertUuid,
  assertWaslaPublicId,
} from "./identifiers.js";
import type { CategoryFacts, ProductDraft, StoreDraft } from "./model.js";
import { assertCurrencyCode, assertPriceMinorUnits } from "./pricing.js";
import {
  PRODUCT_INITIAL_MODERATION_SEQUENCE,
  PRODUCT_INITIAL_MODERATION_STATE,
  STORE_INITIAL_SEQUENCE,
  STORE_INITIAL_STATE,
} from "./state.js";

/** الحالاتُ التي تُحسَب «نشطةً» في حدِّ متاجرِ المالك: كلُّ ما ليس نهايةً مُعلَنة. */
export const STORE_ACTIVE_STATES: readonly StoreState[] = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "suspended",
];

/**
 * حدُّ المتاجرِ النشطةِ للمالك. `archived` وحدَها لا تُحسَب: هي النهايةُ المُعلَنةُ، وما سواها —
 * بما فيها `rejected` و`suspended` — ملفٌّ قائمٌ يُشغل مقعدَ المالك.
 *
 * ولمَ يُحسَب المرفوضُ؟ لأنّ الرفضَ **طلبُ إصلاحٍ لا نهاية** (`rejected → pending_review` في
 * جدولِ العقد). ولو لم يُحسَب لصار طريقُ تجاوزِ الحدِّ مفتوحاً: يُنشئ المالكُ متجراً فيُرفَض
 * فيُنشئ آخرَ، فيجتمع له ملفّاتٌ لا نهايةَ لها تُشغل المُراجعين على متاجرَ لا تُفتَح.
 */
export function assertOwnerStoreLimit(activeStoreCount: number): void {
  if (!Number.isSafeInteger(activeStoreCount) || activeStoreCount < 0) {
    throw validationFailed("active_store_count", "non-negative integer");
  }
  if (activeStoreCount >= STORE_ACTIVE_LIMIT_PER_OWNER) {
    throw storeOwnerLimitReached(STORE_ACTIVE_LIMIT_PER_OWNER);
  }
}

/** تصنيفُ متجرٍ: أيُّ عمقٍ مسموحٍ، لكن **فعّالاً**. */
export function assertStoreCategory(category: CategoryFacts): CategoryFacts {
  assertCategoryDepth(category.depth);
  if (!category.isActive) throw storeCategoryInactive(category.slug);
  return category;
}

/** تصنيفُ منتجٍ: ورقةٌ (عمقُ 2) وفعّالة. الترتيبُ: التفعيلُ أوّلاً لأنّه المنعُ الأعمّ. */
export function assertProductCategory(category: CategoryFacts): CategoryFacts {
  assertCategoryDepth(category.depth);
  if (!category.isActive) throw storeCategoryInactive(category.slug);
  if (!isLeafCategory(category.depth)) throw productCategoryNotLeaf(category.slug);
  return category;
}

/** الورقةُ حسابٌ لا عمود: العمقُ الأقصى المُعلَنُ في العقدِ هو الورقة. */
export function isLeafCategory(depth: number): boolean {
  return depth === CATEGORY_LEAF_DEPTH;
}

/** عمقُ الورقةِ مُشتَقٌّ من حدِّ العقدِ لا مكتوبٌ رقماً: تغييرُ الحدِّ يُغيّر الورقةَ معه. */
export const CATEGORY_LEAF_DEPTH = CATEGORY_MAX_DEPTH;

function assertCategoryDepth(depth: number): number {
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > CATEGORY_MAX_DEPTH) {
    throw validationFailed("depth", `integer between 1 and ${CATEGORY_MAX_DEPTH}`);
  }
  return depth;
}

/**
 * قفلُ اللاحقة. `firstApprovedAt` حاضرٌ ⇒ اللاحقةُ نهائيّةٌ، ومحاولةُ تغييرِها تُرفَض بتحقّقٍ
 * يقول «غيرُ قابلةٍ للتعديل» لا بخطأٍ عامّ.
 */
export function assertStoreSlugMutable(firstApprovedAt: string | undefined): void {
  if (firstApprovedAt !== undefined) {
    throw validationFailed(STORE_SLUG_FIELD, "immutable once the store has been approved at least once");
  }
}

/**
 * مسوّدةُ متجر. الناتجُ **دائماً** `draft` بتسلسلٍ 1: لا مسارَ إنشاءٍ يُنتج متجراً معتمَداً،
 * ولا معاملٌ اختياريٌّ يسمح بذلك «للاستيرادِ» — أوّلُ معاملٍ كهذا يصير باباً يُعتمَد به متجرٌ
 * بلا مُراجعٍ ولا سطرٍ في الدفتر (القرار 2).
 */
export function draftStore(input: {
  ownerPublicId: unknown;
  slug: unknown;
  titleAr: unknown;
  titleEn?: unknown;
  titleUr?: unknown;
  descriptionAr?: unknown;
  categoryId: unknown;
  category: CategoryFacts;
  activeStoreCount: number;
}): StoreDraft {
  const ownerPublicId = assertWaslaPublicId(input.ownerPublicId, "owner_public_id");
  assertOwnerStoreLimit(input.activeStoreCount);
  assertStoreCategory(input.category);

  const draft: StoreDraft = {
    ownerPublicId,
    slug: assertStoreSlug(input.slug),
    titleAr: assertBoundedText(input.titleAr, "title_ar", STORE_TITLE_MIN_LENGTH, STORE_TITLE_MAX_LENGTH),
    categoryId: assertUuid(input.categoryId, "category_id"),
    state: STORE_INITIAL_STATE,
    stateSequence: STORE_INITIAL_SEQUENCE,
  };

  const titleEn = assertOptionalBoundedText(input.titleEn, "title_en", STORE_TITLE_MAX_LENGTH);
  const titleUr = assertOptionalBoundedText(input.titleUr, "title_ur", STORE_TITLE_MAX_LENGTH);
  const descriptionAr = assertOptionalBoundedText(
    input.descriptionAr,
    "description_ar",
    STORE_DESCRIPTION_MAX_LENGTH,
  );

  return {
    ...draft,
    ...(titleEn === undefined ? {} : { titleEn }),
    ...(titleUr === undefined ? {} : { titleUr }),
    ...(descriptionAr === undefined ? {} : { descriptionAr }),
  };
}

/**
 * مسوّدةُ منتج: `draft` واعتدالٌ `pending` دائماً.
 *
 * ولمَ يُفحَص أنّ المتجرَ معتمَدٌ عند **إنشاءِ** المنتج؟ لأنّ الكتالوجَ عملُ متجرٍ قائم: منتجٌ
 * في متجرٍ لم يُعتمَد بعد يجعل صاحبَه يبني عشرين منتجاً ثمّ يُرفَض متجرُه، فيصير عملُه ورقماً
 * في المخزونِ بلا سوقٍ يقبله. والرمزُ `STORE_NOT_APPROVED` مُعلَنٌ لذلك.
 */
export function draftProduct(input: {
  storeId: unknown;
  storeState: StoreState;
  sku: unknown;
  titleAr: unknown;
  titleEn?: unknown;
  titleUr?: unknown;
  descriptionAr?: unknown;
  categoryId: unknown;
  category: CategoryFacts;
  priceMinorUnits: unknown;
  currencyCode?: unknown;
  createdByPublicId: unknown;
}): ProductDraft {
  if (input.storeState !== "approved") throw storeNotApproved(input.storeState);
  assertProductCategory(input.category);

  const draft: ProductDraft = {
    storeId: assertUuid(input.storeId, "store_id"),
    sku: assertProductSku(input.sku),
    titleAr: assertBoundedText(
      input.titleAr,
      "title_ar",
      PRODUCT_TITLE_MIN_LENGTH,
      PRODUCT_TITLE_MAX_LENGTH,
    ),
    categoryId: assertUuid(input.categoryId, "category_id"),
    priceMinorUnits: assertPriceMinorUnits(input.priceMinorUnits),
    currencyCode: assertCurrencyCode(input.currencyCode ?? "SAR"),
    state: "draft",
    moderationState: PRODUCT_INITIAL_MODERATION_STATE,
    moderationSequence: PRODUCT_INITIAL_MODERATION_SEQUENCE,
    createdByPublicId: assertWaslaPublicId(input.createdByPublicId, "created_by_public_id"),
  };

  const titleEn = assertOptionalBoundedText(input.titleEn, "title_en", PRODUCT_TITLE_MAX_LENGTH);
  const titleUr = assertOptionalBoundedText(input.titleUr, "title_ur", PRODUCT_TITLE_MAX_LENGTH);
  const descriptionAr = assertOptionalBoundedText(
    input.descriptionAr,
    "description_ar",
    PRODUCT_DESCRIPTION_MAX_LENGTH,
  );

  return {
    ...draft,
    ...(titleEn === undefined ? {} : { titleEn }),
    ...(titleUr === undefined ? {} : { titleUr }),
    ...(descriptionAr === undefined ? {} : { descriptionAr }),
  };
}

/**
 * شرطُ النشرِ: منتجٌ مسوّدةٌ **واعتدالٌ معتمَد**، وهو مطابقُ قيدِ
 * `ck_products_publish_requires_moderation` في المخطّط.
 *
 * ولمَ يُفحَص هنا وهو محروسٌ في القاعدة؟ لأنّ القيدَ يمنع الكتابةَ برسالةٍ لا يفهمها صاحبُ
 * المتجر، والمجالُ يُعيد `PRODUCT_NOT_MODERATED` فيعرف أنّ عليه أن ينتظر مُراجعاً لا أن يُعيد
 * المحاولة. والانتقالُ نفسُه (`draft → published`) محروسٌ في `assertProductTransition`، وهذه
 * الدالّةُ تجمع الشرطَين في السؤالِ الذي يُسأل فعلاً: «هل أستطيع نشرَه الآن؟».
 */
export function assertProductPublishable(input: {
  productState: ProductState;
  moderationState: ProductModerationState;
}): void {
  if (input.moderationState !== "approved") throw productNotModerated(input.moderationState);
  if (input.productState !== "draft") {
    throw validationFailed("state", "draft (only a draft product can be published)");
  }
}
