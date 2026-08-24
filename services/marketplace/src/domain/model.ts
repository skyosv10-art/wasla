/**
 * أشكالُ المجال: صفوفُ الدفترِ ومسوّداتُ الكتابةِ، بأسماءِ `camelCase` في الشيفرةِ ومطابقةً
 * حرفيّاً لأعمدةِ `schema.sql` في المعنى.
 *
 * ## لماذا أشكالٌ خاصّةٌ بالمجالِ لا أنواعُ OpenAPI مباشرةً
 *
 * أنواعُ `api-types.ts` **عقدُ شبكةٍ**: فيها ما يهمّ العميلَ (`store_slug` نصّاً، `links`،
 * `trace_id`) وليس فيها ما يحتاجه الاشتقاقُ (`state_sequence`، `from_state`). ولو بُني
 * المجالُ على شكلِ الشبكةِ لصار كلُّ تحسينٍ في تمثيلِ الاستجابةِ تعديلاً في قاعدةِ حسابِ
 * الحالة، وهذا بالضبط ما جعل الأطوارَ السابقةَ تُفصل الطبقتَين.
 *
 * وليست هذه الأشكالُ نسخةً من المخطّط: لا `created_at` ولا `updated_at` هنا لأنّهما بيانُ
 * كتابةٍ يملكه المخزن، ولا `store_id` في المسوّدةِ لأنّ المُعرّفَ يُولَّد في المراجعة 3/6.
 *
 * ## لماذا الصفوفُ للقراءةِ فقط (`readonly`)
 *
 * لأنّ الاشتقاقَ **طيٌّ على دفترٍ لا يُلمَس**. دالّةٌ تُعدّل صفَّ دفترٍ مرّرَه المُتّصلُ إليها
 * تُخفي أثرَها في ذاكرةِ من دعاها، فيصير سببُ اختلافِ حالتَين تعديلاً وقع في دالّةٍ اسمُها
 * `derive…` — وهو أسوأُ ما يُبحَث عنه في تحقيقٍ إداريّ.
 */

import type {
  InventoryReasonCode,
  ProductActorType,
  ProductDecision,
  ProductModerationState,
  ProductReasonCode,
  ProductState,
  StoreActorType,
  StoreDecision,
  StoreReasonCode,
  StoreStaffRole,
  StoreState,
} from "./contract-sets.js";

/** صفٌّ في `store_reviews` — دفترٌ لا يُحدَّث ولا يُحذَف منه (القرار 1). */
export interface StoreReviewEntry {
  readonly decision: StoreDecision;
  readonly reasonCode?: StoreReasonCode;
  readonly actorType: StoreActorType;
  /** غائبٌ حين `actor_type = 'system'` وحدَه؛ وهذا محروسٌ في `state.ts`. */
  readonly actorPublicId?: string;
  readonly fromState: StoreState | null;
  readonly toState: StoreState;
  readonly stateSequence: number;
  readonly decidedAt: string;
}

/** صفٌّ في `product_reviews`. لا `owner` في فاعليه: الاعتدالُ ليس قرارَ صاحبِ المنتج. */
export interface ProductReviewEntry {
  readonly decision: ProductDecision;
  readonly reasonCode?: ProductReasonCode;
  readonly actorType: ProductActorType;
  readonly actorPublicId?: string;
  readonly fromState: ProductModerationState | null;
  readonly toState: ProductModerationState;
  readonly moderationSequence: number;
  readonly decidedAt: string;
}

/** صفٌّ في `inventory_adjustments`: فرقٌ موقَّعٌ **مع** الرصيدِ بعده (القرار 5). */
export interface InventoryAdjustmentEntry {
  readonly quantityDelta: number;
  readonly quantityAfter: number;
  readonly reasonCode: InventoryReasonCode;
  readonly actorPublicId: string;
  readonly adjustmentSequence: number;
  readonly occurredAt: string;
}

/** صفٌّ في `store_staff`: الإزالةُ ختمٌ بزمنٍ وفاعلٍ لا حذفٌ (القرار 8). */
export interface StoreStaffEntry {
  readonly memberPublicId: string;
  readonly role: StoreStaffRole;
  readonly addedByPublicId: string;
  readonly addedAt: string;
  readonly removedAt?: string;
  readonly removedByPublicId?: string;
}

/** تصنيفٌ كما يحتاجه المجالُ للحكمِ: عمقٌ وتفعيلٌ ولاحقةٌ للرسالة — لا شجرةٌ كاملة. */
export interface CategoryFacts {
  readonly slug: string;
  readonly depth: number;
  readonly isActive: boolean;
}

/** مسوّدةُ متجرٍ جديدٍ: `draft` والتسلسلُ 1، وكلاهما مُعلَنٌ لا مُفترَض. */
export interface StoreDraft {
  readonly ownerPublicId: string;
  readonly slug: string;
  readonly titleAr: string;
  readonly titleEn?: string;
  readonly titleUr?: string;
  readonly descriptionAr?: string;
  readonly categoryId: string;
  readonly state: StoreState;
  readonly stateSequence: number;
}

/** مسوّدةُ منتجٍ جديد: `draft` واعتدالٌ `pending`، فلا منتجَ يُنشَأ معتمَداً. */
export interface ProductDraft {
  readonly storeId: string;
  readonly sku: string;
  readonly titleAr: string;
  readonly titleEn?: string;
  readonly titleUr?: string;
  readonly descriptionAr?: string;
  readonly categoryId: string;
  readonly priceMinorUnits: number;
  readonly currencyCode: "SAR";
  readonly state: ProductState;
  readonly moderationState: ProductModerationState;
  readonly moderationSequence: number;
  readonly createdByPublicId: string;
}

/** الحالةُ المُشتقّةُ للمتجرِ: ما يُكتب في `stores` بعد قراءةِ الدفترِ كلِّه. */
export interface DerivedStoreState {
  readonly state: StoreState;
  readonly stateSequence: number;
  /** لحظةُ أوّلِ اعتمادٍ — بها تُقفَل `slug` (القرار 7)، وتبقى وإن أُوقِف المتجرُ بعدها. */
  readonly firstApprovedAt?: string;
}

/** الحالةُ المُشتقّةُ لاعتدالِ المنتج. */
export interface DerivedProductModeration {
  readonly moderationState: ProductModerationState;
  readonly moderationSequence: number;
}
