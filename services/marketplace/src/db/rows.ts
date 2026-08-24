/**
 * حدُّ الترجمةِ بين صفِّ القاعدةِ ونوعِ المجال — موضعٌ **واحدٌ** لا حقلٌ يُنسخ في كلِّ مخزن.
 *
 * ## القرار: تحويلٌ حقلاً بحقل، ولا `row as StoreRecord`
 *
 * الإسنادُ بالقوّةِ (`as`) يُسكت المُصرِّفَ ولا يُحوّل شيئاً: عمودُ `TIMESTAMPTZ` يعود من `pg`
 * كـ`Date` لا كنصِّ ISO، وعمودٌ `TEXT` يعود `string` لا `StoreState`. فصفٌّ مُسنَدٌ بالقوّةِ
 * يُنتج كائناً يقول نوعُه إنّ `decidedAt` نصٌّ وقيمتُه `Date`، فتُقارَن اللحظتان بـ`===` فلا
 * تتساويان أبداً وتُشتقّ حالةٌ خاطئةٌ بلا أن يفشل شيء.
 *
 * ## واللحظاتُ نصُّ ISO في كلِّ سطحِ المجال
 *
 * `iso()` موضعُ التحويلِ الوحيد. والمجالُ لا يعرف `Date` بحال (وهذا محروسٌ في
 * `purity.test.ts`: لا `new Date(` بلا وسيطٍ ولا `Date.now`)، فالمقارناتُ في `time.ts` تجري
 * على نصٍّ بـ`Date.parse` — وشكلٌ واحدٌ للنصِّ يعني أنّ صفَّ القاعدةِ وصفَّ الذاكرةِ يتساويان
 * بـ`toEqual` في الاختبار بلا معايرة.
 *
 * ## والقيمةُ الخارجةُ عن التعدادِ تُرمى لا تُمرَّر
 *
 * `narrow()` تفحص قيمةَ العمودِ على قائمةِ العقدِ **عند القراءة**. ولمَ نفحص ما تحميه القاعدةُ
 * بفحصٍ (`CHECK (state IN (...))`)؟ لأنّ ترحيلاً يدويّاً أو استعادةَ نسخةٍ من بيئةٍ أقدمَ قد
 * تُدخل قيمةً لم تكن ممنوعةً يومَها، ثمّ تصير `state = 'archived_v1'` حالةً لا يعرفها
 * `deriveStoreState` فتُسقط قراراً صامتاً. والصراخُ عند القراءةِ يجعل العطبَ سطراً في السجلِّ
 * لا سلوكاً غامضاً في لوحةِ الاعتدال.
 */

import {
  INVENTORY_REASON_CODES,
  PRODUCT_ACTOR_TYPES,
  PRODUCT_DECISIONS,
  PRODUCT_MODERATION_STATES,
  PRODUCT_REASON_CODES,
  PRODUCT_STATES,
  STORE_ACTOR_TYPES,
  STORE_DECISIONS,
  STORE_REASON_CODES,
  STORE_STAFF_ROLES,
  STORE_STATES,
  type ProductModerationState,
  type ProductState,
  type StoreState,
} from "../domain/contract-sets.js";
import { validationFailed } from "../domain/errors.js";
import type {
  InventoryAdjustmentEntry,
  ProductReviewEntry,
  StoreReviewEntry,
  StoreStaffEntry,
} from "../domain/model.js";

/** لحظةٌ من المحرّكِ إلى نصِّ ISO — الموضعُ الوحيد. */
export function iso(value: Date): string {
  return value.toISOString();
}

/** قيمةُ عمودٍ نصّيٍّ مُقيَّدةٌ بقائمةِ العقدِ، أو خطأُ تحقّقٍ مُسمّىً بالحقلِ والقائمة. */
function narrow<T extends string>(
  value: string,
  allowed: readonly T[],
  field: string,
): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw validationFailed(field, `one of ${allowed.join(" | ")}`);
  return found;
}

function narrowOptional<T extends string>(
  value: string | null,
  allowed: readonly T[],
  field: string,
): T | undefined {
  return value === null ? undefined : narrow(value, allowed, field);
}

// ---------------------------------------------------------------------------
// سجلاتُ الموارد: ما يُقرأ من `stores` و`products` و`product_inventory`
// ---------------------------------------------------------------------------

export interface StoreRow {
  readonly storeId: string;
  readonly ownerPublicId: string;
  readonly slug: string;
  readonly titleAr: string;
  readonly titleEn: string | null;
  readonly titleUr: string | null;
  readonly descriptionAr: string | null;
  readonly categoryId: string;
  readonly state: string;
  readonly stateSequence: number;
  readonly firstApprovedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StoreRecord {
  readonly storeId: string;
  readonly ownerPublicId: string;
  readonly slug: string;
  readonly titleAr: string;
  readonly titleEn?: string;
  readonly titleUr?: string;
  readonly descriptionAr?: string;
  readonly categoryId: string;
  readonly state: StoreState;
  readonly stateSequence: number;
  readonly firstApprovedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toStore(row: StoreRow): StoreRecord {
  return {
    storeId: row.storeId,
    ownerPublicId: row.ownerPublicId,
    slug: row.slug,
    titleAr: row.titleAr,
    titleEn: row.titleEn ?? undefined,
    titleUr: row.titleUr ?? undefined,
    descriptionAr: row.descriptionAr ?? undefined,
    categoryId: row.categoryId,
    state: narrow(row.state, STORE_STATES, "state"),
    stateSequence: row.stateSequence,
    firstApprovedAt: row.firstApprovedAt === null ? undefined : iso(row.firstApprovedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export interface ProductRow {
  readonly productId: string;
  readonly storeId: string;
  readonly sku: string;
  readonly titleAr: string;
  readonly titleEn: string | null;
  readonly titleUr: string | null;
  readonly descriptionAr: string | null;
  readonly categoryId: string;
  readonly priceMinorUnits: number;
  readonly currencyCode: string;
  readonly state: string;
  readonly moderationState: string;
  readonly moderationSequence: number;
  readonly createdByPublicId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProductRecord {
  readonly productId: string;
  readonly storeId: string;
  readonly sku: string;
  readonly titleAr: string;
  readonly titleEn?: string;
  readonly titleUr?: string;
  readonly descriptionAr?: string;
  readonly categoryId: string;
  /**
   * هللاتٌ عدداً صحيحاً كما هي في العمود — لا `toFixed` ولا قسمةٌ على مئة ولا رمزُ عملة
   * (القرار 4). التنسيقُ قرارُ عرضٍ يملكه العميل، وقسمةٌ هنا تُدخل عائماً في مسارِ بيانات.
   */
  readonly priceMinorUnits: number;
  readonly currencyCode: string;
  readonly state: ProductState;
  readonly moderationState: ProductModerationState;
  readonly moderationSequence: number;
  readonly createdByPublicId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toProduct(row: ProductRow): ProductRecord {
  return {
    productId: row.productId,
    storeId: row.storeId,
    sku: row.sku,
    titleAr: row.titleAr,
    titleEn: row.titleEn ?? undefined,
    titleUr: row.titleUr ?? undefined,
    descriptionAr: row.descriptionAr ?? undefined,
    categoryId: row.categoryId,
    priceMinorUnits: row.priceMinorUnits,
    currencyCode: row.currencyCode,
    state: narrow(row.state, PRODUCT_STATES, "state"),
    moderationState: narrow(row.moderationState, PRODUCT_MODERATION_STATES, "moderation_state"),
    moderationSequence: row.moderationSequence,
    createdByPublicId: row.createdByPublicId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export interface CategoryRow {
  readonly categoryId: string;
  readonly slug: string;
  readonly depth: number;
  readonly parentCategoryId: string | null;
  readonly labelAr: string;
  readonly labelEn: string | null;
  readonly labelUr: string | null;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

export interface CategoryRecord {
  readonly categoryId: string;
  readonly slug: string;
  readonly depth: number;
  readonly parentCategoryId?: string;
  readonly labelAr: string;
  readonly labelEn?: string;
  readonly labelUr?: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export function toCategory(row: CategoryRow): CategoryRecord {
  return {
    categoryId: row.categoryId,
    slug: row.slug,
    depth: row.depth,
    parentCategoryId: row.parentCategoryId ?? undefined,
    labelAr: row.labelAr,
    labelEn: row.labelEn ?? undefined,
    labelUr: row.labelUr ?? undefined,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    createdAt: iso(row.createdAt),
  };
}

export interface InventoryRow {
  readonly productId: string;
  readonly quantityOnHand: number;
  readonly lastAdjustmentSequence: number;
  readonly updatedAt: Date;
}

export interface InventoryRecord {
  readonly productId: string;
  readonly quantityOnHand: number;
  readonly lastAdjustmentSequence: number;
  readonly updatedAt: string;
}

export function toInventory(row: InventoryRow): InventoryRecord {
  return {
    productId: row.productId,
    quantityOnHand: row.quantityOnHand,
    lastAdjustmentSequence: row.lastAdjustmentSequence,
    updatedAt: iso(row.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// مداخلُ الدفاتر: تُعاد **بنوعِ المجالِ نفسِه** لا بنوعٍ شبيه
// ---------------------------------------------------------------------------
//
// `toStoreReview` تُعيد `StoreReviewEntry` — نفسَ النوعِ الذي يأخذه `deriveStoreState`. ولو
// أعادت نوعاً خاصّاً بالقاعدةِ لَاحتاج كلُّ مُنادٍ تحويلاً ثانياً، وأوّلُ تحويلٍ يُنسى يُنتج
// اشتقاقاً على دفترٍ ناقصٍ حقلاً. والاشتقاقُ يبقى في `domain/state.ts` وحدَه.

export interface StoreReviewRow {
  readonly reviewId: string;
  readonly storeId: string;
  readonly decision: string;
  readonly reasonCode: string | null;
  readonly actorType: string;
  readonly actorPublicId: string | null;
  readonly fromState: string | null;
  readonly toState: string;
  readonly stateSequence: number;
  readonly decidedAt: Date;
  readonly createdAt: Date;
}

export interface StoreReviewRecord extends StoreReviewEntry {
  readonly reviewId: string;
  readonly storeId: string;
  readonly createdAt: string;
}

export function toStoreReview(row: StoreReviewRow): StoreReviewRecord {
  return {
    reviewId: row.reviewId,
    storeId: row.storeId,
    decision: narrow(row.decision, STORE_DECISIONS, "decision"),
    reasonCode: narrowOptional(row.reasonCode, STORE_REASON_CODES, "reason_code"),
    actorType: narrow(row.actorType, STORE_ACTOR_TYPES, "actor_type"),
    actorPublicId: row.actorPublicId ?? undefined,
    fromState: narrowOptional(row.fromState, STORE_STATES, "from_state") ?? null,
    toState: narrow(row.toState, STORE_STATES, "to_state"),
    stateSequence: row.stateSequence,
    decidedAt: iso(row.decidedAt),
    createdAt: iso(row.createdAt),
  };
}

export interface ProductReviewRow {
  readonly reviewId: string;
  readonly productId: string;
  readonly decision: string;
  readonly reasonCode: string | null;
  readonly actorType: string;
  readonly actorPublicId: string | null;
  readonly fromState: string | null;
  readonly toState: string;
  readonly moderationSequence: number;
  readonly decidedAt: Date;
  readonly createdAt: Date;
}

export interface ProductReviewRecord extends ProductReviewEntry {
  readonly reviewId: string;
  readonly productId: string;
  readonly createdAt: string;
}

export function toProductReview(row: ProductReviewRow): ProductReviewRecord {
  return {
    reviewId: row.reviewId,
    productId: row.productId,
    decision: narrow(row.decision, PRODUCT_DECISIONS, "decision"),
    reasonCode: narrowOptional(row.reasonCode, PRODUCT_REASON_CODES, "reason_code"),
    actorType: narrow(row.actorType, PRODUCT_ACTOR_TYPES, "actor_type"),
    actorPublicId: row.actorPublicId ?? undefined,
    fromState:
      narrowOptional(row.fromState, PRODUCT_MODERATION_STATES, "from_state") ?? null,
    toState: narrow(row.toState, PRODUCT_MODERATION_STATES, "to_state"),
    moderationSequence: row.moderationSequence,
    decidedAt: iso(row.decidedAt),
    createdAt: iso(row.createdAt),
  };
}

export interface InventoryAdjustmentRow {
  readonly adjustmentId: string;
  readonly productId: string;
  readonly quantityDelta: number;
  readonly quantityAfter: number;
  readonly reasonCode: string;
  readonly actorPublicId: string;
  readonly adjustmentSequence: number;
  readonly occurredAt: Date;
  readonly createdAt: Date;
}

export interface InventoryAdjustmentRecord extends InventoryAdjustmentEntry {
  readonly adjustmentId: string;
  readonly productId: string;
  readonly createdAt: string;
}

export function toInventoryAdjustment(row: InventoryAdjustmentRow): InventoryAdjustmentRecord {
  return {
    adjustmentId: row.adjustmentId,
    productId: row.productId,
    quantityDelta: row.quantityDelta,
    quantityAfter: row.quantityAfter,
    reasonCode: narrow(row.reasonCode, INVENTORY_REASON_CODES, "reason_code"),
    actorPublicId: row.actorPublicId,
    adjustmentSequence: row.adjustmentSequence,
    occurredAt: iso(row.occurredAt),
    createdAt: iso(row.createdAt),
  };
}

export interface StoreStaffRow {
  readonly staffId: string;
  readonly storeId: string;
  readonly memberPublicId: string;
  readonly role: string;
  readonly addedByPublicId: string;
  readonly addedAt: Date;
  readonly removedAt: Date | null;
  readonly removedByPublicId: string | null;
}

export interface StoreStaffRecord extends StoreStaffEntry {
  readonly staffId: string;
  readonly storeId: string;
}

export function toStoreStaff(row: StoreStaffRow): StoreStaffRecord {
  return {
    staffId: row.staffId,
    storeId: row.storeId,
    memberPublicId: row.memberPublicId,
    role: narrow(row.role, STORE_STAFF_ROLES, "role"),
    addedByPublicId: row.addedByPublicId,
    addedAt: iso(row.addedAt),
    removedAt: row.removedAt === null ? undefined : iso(row.removedAt),
    removedByPublicId: row.removedByPublicId ?? undefined,
  };
}
