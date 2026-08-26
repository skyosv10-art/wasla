/**
 * تحويلُ الصفِّ إلى مورِدِ عقدٍ — وأنواعُ الهدفِ مُشتقّةٌ من حزمةِ العقدِ لا مكتوبةٌ هنا.
 *
 * ## لماذا لا واجهاتٌ مكتوبةٌ باليد
 *
 * `StoreResource` و`ProductResource` وأخواتُها مُصدَّرةٌ من `@wasla/contracts-marketplace`
 * مُشتقّةً من OpenAPI. وكتابةُ نسخةٍ منها هنا كانت ستجعل حقلاً يُضاف في العقدِ يمرّ
 * `typecheck` بسلامٍ لأنّ الخدمةَ تقرأ نسختَها، ثمّ يسقط مستهلكٌ صارمٌ في الإنتاج. والإسنادُ
 * إلى النوعِ المُشتَقِّ يجعل حقلاً ناقصاً **خطأَ ترجمة** — وهو المكانُ الصحيحُ لهذا الخطأ.
 *
 * ## والحدُّ لا يُعيد مُعرِّفاً داخليّاً
 *
 * `category_id` لا يظهر في أيّ مورِد؛ العقدُ يُعلن `category_slug`. ولذلك تأخذ الدوالُّ فهرسَ
 * لواحقٍ ولا تقرأ القاعدةَ بنفسِها: مُعرِّفٌ يُسرَّب مرّةً يصير عقداً ضمنيّاً يبنيه المستهلكُ
 * ثمّ لا يُنزَع.
 *
 * ## وحقلٌ غائبٌ لا حقلٌ حاضرٌ خاوٍ
 *
 * العقدُ يُعلن `null` صريحاً لِما يُنقَص (`first_approved_at` · `removed_at` · `next_cursor`)
 * ويُعلن غيابَ المفتاحِ لِما هو اختياريٌّ (`title_en` · `reason_code`). والفرقُ مقصودٌ: `null`
 * تقول «لا قيمةَ لهذه الحقيقةِ بعد»، والغيابُ يقول «لم تُذكَر». فتُحترَم القسمةُ حرفاً هنا.
 */

import type {
  InventoryAdjustmentResource,
  InventoryReadResponse,
  ProductResource,
  ProductReviewResource,
  StoreCategory,
  StoreResource,
  StoreReviewResource,
  StoreStaffResource,
} from "@wasla/contracts-marketplace";
import type {
  InventoryAdjustmentOutcome,
  InventoryView,
  ProductDecisionOutcome,
  ProductView,
} from "../app/index.js";
import type {
  CategoryRecord,
  StoreRecord,
  StoreReviewRecord,
  StoreStaffRecord,
} from "../db/rows.js";
import { storeCategoryNotFound } from "../domain/errors.js";

/** فهرسُ «مُعرِّفٌ ← لاحقة» كما يُنتجه `MarketplaceCatalogService.categorySlugIndex`. */
export type CategorySlugIndex = ReadonlyMap<string, string>;

/**
 * لاحقةُ تصنيفٍ من فهرسِها — والغيابُ خطأٌ مُسمّىً لا `undefined` يمرّ إلى السلك.
 *
 * صفٌّ يُشير إلى تصنيفٍ غيرِ موجودٍ يستحيل مع `fk_stores_category`، لكنّ الاعتمادَ على
 * الاستحالةِ بلا رمزٍ يجعل أوّلَ خللٍ في الهجرةِ يُنتج `category_slug: undefined` في جوابٍ
 * ناجح — وهو أسوأُ من خطأٍ صريح.
 */
function slugOf(index: CategorySlugIndex, categoryId: string): string {
  const slug = index.get(categoryId);
  if (slug === undefined) throw storeCategoryNotFound(categoryId);
  return slug;
}

/** حقلٌ اختياريٌّ يُذكَر إن وُجد ويُحذَف إن غاب — لا `null` مكانَ الغياب. */
function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): { [K in TKey]?: TValue } {
  return (value === undefined ? {} : { [key]: value }) as { [K in TKey]?: TValue };
}

/** متجرٌ — و`is_slug_locked` مُشتَقٌّ من `first_approved_at` لا عمودٌ ثانٍ لحقيقةٍ واحدة. */
export function toStoreResource(store: StoreRecord, categories: CategorySlugIndex): StoreResource {
  return {
    store_id: store.storeId,
    store_slug: store.slug,
    owner_public_id: store.ownerPublicId,
    title_ar: store.titleAr,
    ...optional("title_en", store.titleEn),
    ...optional("title_ur", store.titleUr),
    ...optional("description_ar", store.descriptionAr),
    category_slug: slugOf(categories, store.categoryId),
    state: store.state,
    state_sequence: store.stateSequence,
    is_slug_locked: store.firstApprovedAt !== undefined,
    first_approved_at: store.firstApprovedAt ?? null,
    created_at: store.createdAt,
    updated_at: store.updatedAt,
  };
}

/**
 * منتجٌ — و`is_visible` يأتي محسوباً من طبقةِ التطبيق ولا يُحسَب هنا ثانيةً.
 *
 * حسابُه في المُحوِّلِ كان سيجعل نسخةً ثانيةً من القاعدةِ في طبقةٍ لا تُختبَر كالمجال، وأوّلَ
 * شرطٍ يُضاف في `isVisible` ولا يُضاف هنا يجعل الجوابَ يكذب على المُتَّصل.
 */
export function toProductResource(view: ProductView, categories: CategorySlugIndex): ProductResource {
  const { product } = view;
  return {
    product_id: product.productId,
    store_id: product.storeId,
    store_slug: view.storeSlug,
    sku: product.sku,
    title_ar: product.titleAr,
    ...optional("title_en", product.titleEn),
    ...optional("title_ur", product.titleUr),
    ...optional("description_ar", product.descriptionAr),
    category_slug: slugOf(categories, product.categoryId),
    price_minor_units: product.priceMinorUnits,
    currency_code: product.currencyCode as "SAR",
    state: product.state,
    moderation_state: product.moderationState,
    moderation_sequence: product.moderationSequence,
    quantity_on_hand: view.quantityOnHand,
    is_visible: view.isVisible,
    created_at: product.createdAt,
    updated_at: product.updatedAt,
  };
}

/** قرارُ متجرٍ — واللاحقةُ تُمرَّر لأنّ صفَّ الدفترِ يحمل المُعرِّفَ وحدَه. */
export function toStoreReviewResource(
  review: StoreReviewRecord,
  storeSlug: string,
): StoreReviewResource {
  return {
    review_id: review.reviewId,
    store_id: review.storeId,
    store_slug: storeSlug,
    decision: review.decision,
    from_state: review.fromState ?? null,
    to_state: review.toState,
    state_sequence: review.stateSequence,
    actor_type: review.actorType,
    ...optional("actor_public_id", review.actorPublicId),
    ...optional("reason_code", review.reasonCode),
    decided_at: review.decidedAt,
  };
}

/** قرارُ اعتدالِ منتجٍ. */
export function toProductReviewResource(outcome: ProductDecisionOutcome): ProductReviewResource {
  const { review } = outcome;
  return {
    review_id: review.reviewId,
    product_id: review.productId,
    store_id: outcome.storeId,
    decision: review.decision,
    from_state: review.fromState ?? null,
    to_state: review.toState,
    moderation_sequence: review.moderationSequence,
    actor_type: review.actorType,
    ...optional("actor_public_id", review.actorPublicId),
    ...optional("reason_code", review.reasonCode),
    decided_at: review.decidedAt,
  };
}

/** عضوُ طاقمٍ — و`removed_at: null` تعني نشِطاً؛ الإزالةُ زمنٌ يُكتب لا صفٌّ يُحذَف. */
export function toStoreStaffResource(member: StoreStaffRecord): StoreStaffResource {
  return {
    staff_id: member.staffId,
    store_id: member.storeId,
    member_public_id: member.memberPublicId,
    role: member.role,
    added_by_public_id: member.addedByPublicId,
    added_at: member.addedAt,
    removed_at: member.removedAt ?? null,
    ...optional("removed_by_public_id", member.removedByPublicId),
  };
}

/** فرقُ مخزونٍ واحد. */
export function toInventoryAdjustmentResource(
  outcome: InventoryAdjustmentOutcome,
): InventoryAdjustmentResource {
  const { adjustment } = outcome;
  return {
    adjustment_id: adjustment.adjustmentId,
    product_id: adjustment.productId,
    store_id: outcome.storeId,
    quantity_delta: adjustment.quantityDelta,
    quantity_after: adjustment.quantityAfter,
    reason_code: adjustment.reasonCode,
    adjustment_sequence: adjustment.adjustmentSequence,
    actor_public_id: adjustment.actorPublicId,
    occurred_at: adjustment.occurredAt,
  };
}

/**
 * قراءةُ مخزونٍ — ومصفوفةٌ فارغةٌ تعني «لم يُطلَب الدفتر» لا «لا دفترَ له».
 *
 * ولذلك لا يُحذَف الحقلُ عند عدمِ الطلبِ: حقلٌ يظهر ويغيب حسبَ مُرشِّحٍ يجعل المُتَّصلَ يكتب
 * فرعَين لشكلَين، ومصفوفةٌ فارغةٌ دائماً الحاضرةُ شكلٌ واحدٌ يُقرأ.
 */
export function toInventoryReadResponse(
  view: InventoryView,
  outcomeOf: (adjustment: InventoryView["adjustments"][number]) => InventoryAdjustmentResource,
): InventoryReadResponse {
  return {
    product_id: view.productId,
    store_id: view.storeId,
    quantity_on_hand: view.quantityOnHand,
    last_adjustment_sequence: view.lastAdjustmentSequence,
    adjustments: view.adjustments.map(outcomeOf),
    next_cursor: view.nextCursor ?? null,
  };
}

/** تصنيفٌ في الشجرة — و`parent_slug: null` تعني جذراً لا أباً مجهولاً. */
export function toStoreCategory(
  category: CategoryRecord,
  categories: CategorySlugIndex,
): StoreCategory {
  return {
    category_slug: category.slug,
    label_ar: category.labelAr,
    ...optional("label_en", category.labelEn),
    ...optional("label_ur", category.labelUr),
    depth: category.depth as 1 | 2,
    parent_slug:
      category.parentCategoryId === undefined
        ? null
        : slugOf(categories, category.parentCategoryId),
    sort_order: category.sortOrder,
    is_active: category.isActive,
  };
}
