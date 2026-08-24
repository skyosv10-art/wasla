/**
 * @wasla/contracts-marketplace
 *
 * تبرير الحزمة (§7): تضع عقودَ أساسِ السوق الكنسيّةَ في سطحِ TypeScript واحدٍ كي لا ينسخ
 * المستهلكون الحقيقةَ ولا يبتكروا عقداً موازياً. مستهلكوها المعلومون اليوم: بوتُ الشريك
 * (تسجيلُ المتجرِ وحالةُ الاعتدالِ ودفترُ المخزون)، لوحةُ الاعتدال (Phase 15) التي تقرأ
 * القراراتَ وأسبابَها المُقفلة، طورُ البحث (Phase 12) الذي يفهرس ما يُشتَقُّ ظهورُه هنا ولا
 * يملك شرطَ الظهور، وطورُ الشراء (Phase 13) الذي يملك الحجزَ ويقرأ الكميّةَ والسعرَ من
 * الموردِ لا من حدث.
 *
 * These are Contract First artifacts (ADR-004), NOT a runtime implementation;
 * implementation lands in later MRs of Phase 11. ADR-016 binds this service to a
 * single shape: decisions live in APPEND-ONLY ledgers and `stores.state` /
 * `products.moderation_state` are verified projections whose drop must be lossless
 * (decision 1), approval is a HUMAN DECISION and never time-derived so there is no
 * tick and no `next_review_at` (decision 2), visibility is DERIVED at read time
 * from four conditions and never stored (decision 3), price is a CATALOG DATUM in
 * integer halalas with `currency_code = 'SAR'` and NO MONEY MOVEMENT — money is
 * Phase 17 (decision 4), inventory is a SIGNED NON-ZERO DELTA LEDGER carrying its
 * resulting balance with no reserved/available columns because reservation is
 * Phase 13 (decision 5), owner and staff are OPAQUE public ids with no foreign key
 * into identity and suspension limits a STORE not a PERSON (decision 6), `slug` is
 * unique case-insensitively, FROZEN after `first_approved_at` and never released
 * by archiving while deep links are built from templates and never stored
 * (decision 7), roles are a closed list with a single enforced owner and removal
 * is `removed_at` never DELETE (decision 8), there is NO HARD DELETE and NO SEARCH
 * because search is Phase 12 and the terminal state is `archived` (decision 9),
 * and FREE TEXT lives in resources only — never in an event, never in error
 * `details` (decision 10).
 * Regenerate API types: pnpm --filter @wasla/contracts-marketplace generate
 */
export type * from "./api-types.js";
export type * from "./events-types.js";
export {
  MARKETPLACE_EVENT_TYPES,
  MARKETPLACE_EVENT_PRODUCER,
  MARKETPLACE_EVENT_FORBIDDEN_FIELDS,
  MARKETPLACE_FORBIDDEN_EVENT_TYPES,
} from "./events-types.js";

import type { components, paths } from "./api-types.js";
export type { paths };
export type WaslaPublicId = components["schemas"]["WaslaPublicId"];
export type StoreSlugValue = components["schemas"]["StoreSlug"];
export type CategorySlugValue = components["schemas"]["CategorySlug"];
export type StoreCategory = components["schemas"]["StoreCategory"];
export type RegisterStoreRequest = components["schemas"]["RegisterStoreRequest"];
export type StoreResource = components["schemas"]["StoreResource"];
export type StoreDecisionRequest = components["schemas"]["StoreDecisionRequest"];
export type StoreReviewResource = components["schemas"]["StoreReviewResource"];
export type StoreStaffResource = components["schemas"]["StoreStaffResource"];
export type CreateProductRequest = components["schemas"]["CreateProductRequest"];
export type ProductResource = components["schemas"]["ProductResource"];
export type ProductDecisionRequest = components["schemas"]["ProductDecisionRequest"];
export type ProductReviewResource = components["schemas"]["ProductReviewResource"];
export type AdjustInventoryRequest = components["schemas"]["AdjustInventoryRequest"];
export type InventoryAdjustmentResource = components["schemas"]["InventoryAdjustmentResource"];
export type InventoryReadResponse = components["schemas"]["InventoryReadResponse"];
export type HealthResponse = components["schemas"]["HealthResponse"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];

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
} from "./events-types.js";

/** أربعةٌ وعشرون رمزاً في خمسةِ أصناف؛ مُقفلةٌ ومطابقةٌ لجدولِ `errors.md` سطراً بسطر. */
export const MARKETPLACE_ERROR_CODES = [
  "MARKETPLACE_VALIDATION_FAILED",
  "MARKETPLACE_IDEMPOTENCY_KEY_REQUIRED",
  "MARKETPLACE_FILTER_REQUIRED",
  "STORE_NOT_FOUND",
  "PRODUCT_NOT_FOUND",
  "STORE_CATEGORY_NOT_FOUND",
  "STORE_STAFF_NOT_FOUND",
  "MARKETPLACE_IDEMPOTENCY_KEY_REUSED",
  "STORE_SLUG_TAKEN",
  "STORE_OWNER_LIMIT_REACHED",
  "PRODUCT_SKU_TAKEN",
  "STORE_STAFF_ALREADY_MEMBER",
  "STORE_REVIEW_ALREADY_PENDING",
  "STORE_DECISION_NOT_ALLOWED",
  "PRODUCT_TRANSITION_NOT_ALLOWED",
  "STORE_SLUG_RESERVED",
  "STORE_NOT_APPROVED",
  "PRODUCT_NOT_MODERATED",
  "STORE_CATEGORY_INACTIVE",
  "PRODUCT_CATEGORY_NOT_LEAF",
  "STORE_OWNER_ROLE_IMMUTABLE",
  "INVENTORY_INSUFFICIENT_QUANTITY",
  "STORE_REJECTION_REASON_REQUIRED",
  "MARKETPLACE_UNAVAILABLE",
] as const;
export type MarketplaceErrorCode = (typeof MARKETPLACE_ERROR_CODES)[number];

/**
 * لا `bad_gateway` ولا `502` في هذا الكتالوج (سابقةُ الأطوارِ 05 و08 و09 و10): لا تابعَ
 * متزامناً يُنتظر جوابُه في مسارِ الطلب هنا.
 *
 * ولا رمزَ يتكلّم عن المال (ADR-016 القرار 4): لا `PAYMENT_FAILED` ولا `PRICE_REJECTED`.
 * السعرُ هنا **بيانٌ في الكتالوج** لا حركةَ مال، ورمزٌ يقول «فشل الدفع» يجعل مستهلكاً يعتقد
 * أنّ هذه الخدمةَ بوّابةُ سدادٍ فيُرسل إليها ما لا يجوز أن تراه.
 *
 * ولا رمزَ يتكلّم عن الظهور (القرار 3): لا `PRODUCT_NOT_VISIBLE`. الظهورُ اقترانُ أربعةِ
 * شروطٍ يُشتَقُّ عند القراءة، ورمزٌ واحدٌ لأربعةِ أسبابٍ يترك المستهلكَ لا يعرف أيَّها وقع
 * فلا يستطيع أن يقول لصاحبِ المتجرِ ما ينقصه. والأربعةُ لها رموزُها المنفصلة:
 * `STORE_NOT_APPROVED` و`PRODUCT_NOT_MODERATED` و`INVENTORY_INSUFFICIENT_QUANTITY`
 * وحالةُ النشرِ في `PRODUCT_TRANSITION_NOT_ALLOWED`.
 *
 * ولا رمزَ عقابيّاً على شخص (القرار 6): لا `OWNER_BANNED`. الإيقافُ حدٌّ على **متجرٍ** لا
 * على إنسان، والقرارُ في شأنِ الأشخاصِ ملكُ حدِّ الهويّةِ ولوحةِ الإدارة (Phase 15).
 */
export const MARKETPLACE_ERROR_CLASS_STATUS = {
  validation_error: 400,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  service_unavailable: 503,
} as const;
export type MarketplaceErrorClass = keyof typeof MARKETPLACE_ERROR_CLASS_STATUS;

export const MARKETPLACE_ERROR_CODE_CLASS: Record<MarketplaceErrorCode, MarketplaceErrorClass> = {
  MARKETPLACE_VALIDATION_FAILED: "validation_error",
  MARKETPLACE_IDEMPOTENCY_KEY_REQUIRED: "validation_error",
  MARKETPLACE_FILTER_REQUIRED: "validation_error",
  STORE_NOT_FOUND: "not_found",
  PRODUCT_NOT_FOUND: "not_found",
  STORE_CATEGORY_NOT_FOUND: "not_found",
  STORE_STAFF_NOT_FOUND: "not_found",
  MARKETPLACE_IDEMPOTENCY_KEY_REUSED: "conflict",
  STORE_SLUG_TAKEN: "conflict",
  STORE_OWNER_LIMIT_REACHED: "conflict",
  PRODUCT_SKU_TAKEN: "conflict",
  STORE_STAFF_ALREADY_MEMBER: "conflict",
  STORE_REVIEW_ALREADY_PENDING: "conflict",
  STORE_DECISION_NOT_ALLOWED: "conflict",
  PRODUCT_TRANSITION_NOT_ALLOWED: "conflict",
  STORE_SLUG_RESERVED: "unprocessable",
  STORE_NOT_APPROVED: "unprocessable",
  PRODUCT_NOT_MODERATED: "unprocessable",
  STORE_CATEGORY_INACTIVE: "unprocessable",
  PRODUCT_CATEGORY_NOT_LEAF: "unprocessable",
  STORE_OWNER_ROLE_IMMUTABLE: "unprocessable",
  INVENTORY_INSUFFICIENT_QUANTITY: "unprocessable",
  STORE_REJECTION_REASON_REQUIRED: "unprocessable",
  MARKETPLACE_UNAVAILABLE: "service_unavailable",
};

export function httpStatusForMarketplaceError(code: MarketplaceErrorCode): number {
  return MARKETPLACE_ERROR_CLASS_STATUS[MARKETPLACE_ERROR_CODE_CLASS[code]];
}

// --- تعدادات المجال: مطابقة حرفياً لقيود DDL وتعدادات OpenAPI ----------------

/** مطابقة لقيد `state` في `stores` وللتعداد `StoreState`. */
export const STORE_STATES: readonly StoreState[] = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "suspended",
  "archived",
] as const;

/** مطابقة لقيد `decision` في `store_reviews`. القرارُ ليس الحالة: `reinstated` يُنتج `approved`. */
export const STORE_DECISIONS: readonly StoreDecision[] = [
  "review_requested",
  "approved",
  "rejected",
  "suspended",
  "reinstated",
  "archived",
] as const;

/** مطابقة لقيد `reason_code` في `store_reviews`. */
export const STORE_REASON_CODES: readonly StoreReasonCode[] = [
  "incomplete_profile",
  "prohibited_category",
  "duplicate_store",
  "misleading_title",
  "unverified_owner",
  "policy_violation",
  "owner_request",
] as const;

/** مطابقة لقيد `actor_type` في `store_reviews`؛ و`system` وحدَه يُعفى من الفاعلِ المُسمّى. */
export const STORE_ACTOR_TYPES: readonly StoreActorType[] = ["owner", "moderator", "system"] as const;

/** مطابقة لقيد `state` في `products`. */
export const PRODUCT_STATES: readonly ProductState[] = ["draft", "published", "archived"] as const;

/** مطابقة لقيد `moderation_state` في `products`؛ عمودٌ مستقلٌّ عن `state` بقرارِ شخصٍ مختلف. */
export const PRODUCT_MODERATION_STATES: readonly ProductModerationState[] = [
  "pending",
  "approved",
  "rejected",
] as const;

/** مطابقة لقيد `decision` في `product_reviews`. */
export const PRODUCT_DECISIONS: readonly ProductDecision[] = ["approved", "rejected"] as const;

/** مطابقة لقيد `reason_code` في `product_reviews`. */
export const PRODUCT_REASON_CODES: readonly ProductReasonCode[] = [
  "prohibited_item",
  "misleading_title",
  "wrong_category",
  "price_implausible",
  "duplicate_listing",
  "policy_violation",
] as const;

/** مطابقة لقيد `actor_type` في `product_reviews`؛ لا `owner` هنا: الاعتدالُ ليس قرارَ صاحبِ المنتج. */
export const PRODUCT_ACTOR_TYPES: readonly ProductActorType[] = ["moderator", "system"] as const;

/** مطابقة لقيد `reason_code` في `inventory_adjustments`. */
export const INVENTORY_REASON_CODES: readonly InventoryReasonCode[] = [
  "initial_stock",
  "restock",
  "correction",
  "shrinkage",
  "archive_zeroed",
] as const;

/** مطابقة لقيد `role` في `store_staff`. */
export const STORE_STAFF_ROLES: readonly StoreStaffRole[] = ["owner", "manager", "staff"] as const;

// --- حدود العقد المُعلَنة ------------------------------------------------------

/**
 * عُملةٌ واحدةٌ في هذا الطور، والسعرُ **عددٌ صحيحٌ بالهللات** لا كسرٌ عائم (ADR-016 القرار 4).
 *
 * الرقمُ يقيم في حزمةِ العقدِ لا في الخدمةِ لأنّ البوتَ يعرض «29.50 ر.س» فيقسم على 100، ولوحةَ
 * الاعتدالِ تفحص `price_implausible` فتقارن بحدٍّ أعلى؛ ولو نسخ كلٌّ منهما رقمَه لصار لدينا
 * حقيقتان تتباعدان بصمت. والحدُّ الأدنى 1 لا 0: منتجٌ بسعرِ صفرٍ ليس مجّانيّاً بل نموذجٌ
 * نُسي حقلُه، والمجّانيّةُ إن أُريدت قرارُ عرضٍ لا غيابُ رقم.
 */
export const MARKETPLACE_CURRENCY_CODE = "SAR" as const;
export const PRICE_MINOR_UNITS_MIN = 1;
export const PRICE_MINOR_UNITS_MAX = 100000000;

/**
 * أقصى مقدارٍ مطلقٍ لفرقِ مخزونٍ واحد. الفرقُ **موقَّعٌ وغيرُ صفريّ**: صفرٌ سطرٌ لا يقول
 * شيئاً في دفترٍ يُقرأ بالجمع، وسقفٌ مطلقٌ يمنع خطأَ إدخالٍ من أن يصير رقماً لا يُصدَّق
 * فيُفسد كلَّ حسابٍ بعده (القرار 5).
 */
export const INVENTORY_DELTA_ABS_MAX = 1000000;

/**
 * عمقُ شجرةِ التصنيفِ محدودٌ باثنَين، والورقةُ هي العمقُ 2 لا عمودٌ `is_leaf` يُخزَّن.
 *
 * النسخةُ الخاطئةُ الأرخص: شجرةٌ بلا حدٍّ «مرونةً للمستقبل»، فتُنشأ سلاسلُ خمسةِ مستوياتٍ لا
 * يستطيع بوتٌ عرضَها في قائمةٍ ولا مستهلكٌ فهرستَها بثمنٍ ثابت. والعمقُ 2 يكفي «مطاعم ←
 * مشاوي»، وتوسيعُه قرارٌ يُكتب في ADR لا فرعٌ في الكود.
 */
export const CATEGORY_MAX_DEPTH = 2;

/**
 * متجرٌ نشطٌ واحدٌ لكلِّ مالكٍ في هذا الطور (`ux_stores_owner_active`)، وتجاوزُه
 * `STORE_OWNER_LIMIT_REACHED`. حدٌّ مُعلَنٌ لا صامتٌ: من يريد رفعَه يُعدّل عقداً ويكتب قراراً.
 */
export const STORE_ACTIVE_LIMIT_PER_OWNER = 1;

/**
 * `slug` محجوزةٌ لا تُمنح لمتجر. الخطرُ ليس جمالياً: `wasla.app/support` لمتجرٍ يجعل صفحةَ
 * دعمٍ رسميّةً تُنتحل، فيُخاطب المشترون متجراً يظنّونه المنصّةَ نفسَها.
 */
export const RESERVED_STORE_SLUGS = [
  "admin",
  "api",
  "app",
  "help",
  "store",
  "stores",
  "support",
  "wasla",
  "www",
] as const;

// --- الصيغ ---------------------------------------------------------------------

/** صيغةُ المُعرّفِ العلنيِّ كما في كلّ الأطوار السابقة. */
export const WASLA_PUBLIC_ID_PATTERN = /^WS-[0-9]{10}$/;

/** صيغةُ `slug` المتجر: تبدأ بحرفٍ ولا تنتهي برقمٍ فاصل، وتُقرأ في رابطٍ يُنسخ يدوياً. */
export const STORE_SLUG_PATTERN = /^[a-z][a-z0-9-]{2,47}$/;

/** صيغةُ `slug` التصنيف؛ أقصرُ من slug المتجرِ لأنّها كلمةٌ واحدةٌ غالباً. */
export const CATEGORY_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;

/** صيغةُ `sku`: فريدةٌ داخل المتجرِ لا في السوقِ كلِّه (`ux_products_store_sku`). */
export const PRODUCT_SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/;

// --- جداول الانتقال المُعلَنة في العقد لا المُستنتَجة من الكود -------------------

/**
 * انتقالاتُ المتجرِ المسموحة. `null` مفتاحُ الإنشاء (∅ → draft).
 *
 * `['rejected','pending_review']` موجودٌ عن قصد: الرفضُ **ليس نهايةً** بل طلبُ إصلاحٍ بسببٍ
 * مُقفَل، ولو كان نهائيّاً لصار أوّلُ نقصٍ في ملفٍ حكماً مؤبّداً على تاجرٍ صغير.
 * و`['approved','suspended']` و`['suspended','approved']` زوجٌ متقابلٌ لأنّ الإيقافَ حدٌّ
 * قابلٌ للرفعِ لا عقوبةٌ نهائيّة (القرار 6). ولا `['suspended','archived']`: الأرشفةُ إعلانُ
 * نهايةٍ يملكه صاحبُ المتجرِ أو مُراجعٌ على متجرٍ **قائم**، ومتجرٌ موقوفٌ يُعاد أوّلاً ثمّ
 * يُؤرشَف كي يبقى في الدفترِ سطرٌ يقول من أعاده قبل أن يُنهيه.
 */
export const STORE_ALLOWED_TRANSITIONS: ReadonlyArray<readonly [StoreState | null, StoreState]> = [
  [null, "draft"],
  ["draft", "pending_review"],
  ["pending_review", "approved"],
  ["pending_review", "rejected"],
  ["rejected", "pending_review"],
  ["approved", "suspended"],
  ["suspended", "approved"],
  ["approved", "archived"],
  ["rejected", "archived"],
] as const;

/**
 * انتقالاتُ المنتج. `archived` نهائيّةٌ بلا مَخرج (القرار 9): إعادةُ إحياءِ منتجٍ مُؤرشَفٍ
 * تجعل رابطاً نُشِر ثمّ أُعلن انتهاؤه يعود بمحتوىً مختلفٍ وسعرٍ مختلف.
 * و`['draft','archived']` مسموحٌ كي يُنهي متجرٌ نموذجاً لم ينشره أصلاً بلا أن يُجبَر على نشره.
 */
export const PRODUCT_ALLOWED_TRANSITIONS: ReadonlyArray<readonly [ProductState | null, ProductState]> = [
  [null, "draft"],
  ["draft", "published"],
  ["published", "archived"],
  ["draft", "archived"],
] as const;

// --- سطح HTTP ------------------------------------------------------------------

/** Route values are kept for contract clients and drift-guarded against OpenAPI. */
export const MARKETPLACE_API_PATHS = [
  "/categories",
  "/health",
  "/products/{productId}",
  "/products/{productId}/archive",
  "/products/{productId}/decisions",
  "/products/{productId}/inventory",
  "/products/{productId}/publish",
  "/stores",
  "/stores/{storeSlug}",
  "/stores/{storeSlug}/decisions",
  "/stores/{storeSlug}/products",
  "/stores/{storeSlug}/review-requests",
  "/stores/{storeSlug}/reviews",
  "/stores/{storeSlug}/staff",
  "/stores/{storeSlug}/staff/{memberPublicId}",
] as const;

/**
 * خمسةَ عشرَ مساراً فريداً تحمل تسعَ عشرةَ عمليّة: `/stores` و`/stores/{storeSlug}/staff`
 * و`/stores/{storeSlug}/products` و`/products/{productId}/inventory` يحمل كلٌّ منها
 * `GET` و`POST`، و`/stores/{storeSlug}/staff/{memberPublicId}` يحمل `DELETE`.
 */
export const MARKETPLACE_API_OPERATION_COUNT = 19;

/** لا `502`: انظر §القاعدة في `services/marketplace/contracts/errors.md`. */
export const MARKETPLACE_HTTP_STATUS_CODES = [200, 201, 400, 404, 409, 422, 503] as const;

/**
 * منفذ خدمة السوق (CONTAINERS §4.7).
 *
 * يقيم الثابتُ في حزمةِ العقدِ لا في الخدمةِ لأنّ المستهلكَ (بوتُ الشريك · لوحةُ الاعتدال ·
 * البحث · الشراء) يحتاج المنفذَ ليبني عنوانَ العميل، ولو نسخه لصار لدينا حقيقتان تتباعدان
 * بصمت. والرقمُ 8094 لا يصطدم بمنفذِ طورٍ سابق، و`boundary.test.ts` يحرس ذلك.
 */
export const MARKETPLACE_SERVICE_PORT = 8094;

// --- الروابط العميقة: قالبٌ يُبنى ولا يُخزَّن (القرار 7) -------------------------

/**
 * أقصى طولٍ لحمولةِ الرابطِ العميقِ كما تفرضه القناة
 * (`DEEP_LINK_MAX_PAYLOAD_LENGTH` في `@wasla/contracts-channel`).
 *
 * مُعادٌ هنا كرقمٍ لا كاعتمادٍ على حزمةِ القناةِ كي لا تستورد حزمةُ عقدٍ حزمةَ عقدٍ أخرى
 * فيصير سطحُ السوقِ مرتهناً بحدِّ قناةٍ قد يتحرّك؛ و`contracts.test.ts` يحرس أنّ كلَّ قالبٍ
 * هنا يبقى تحت الحدِّ بأقصى مدخلٍ ممكن.
 */
export const MARKETPLACE_DEEP_LINK_MAX_PAYLOAD_LENGTH = 64;

/**
 * بادئتان لا أكثر. البادئةُ لازمةٌ لأنّ الحمولةَ نصٌّ واحدٌ يصل البوتَ بلا نوع، ولو أُرسلت
 * `slug` عارياً لما استطاع البوتُ أن يعرف أهو متجرٌ أم منتجٌ فيقرأ الجدولَ الخطأ.
 */
export const MARKETPLACE_DEEP_LINK_PREFIXES = { store: "s_", product: "p_" } as const;

/**
 * يبني حمولةَ رابطٍ عميقٍ لمتجر. **لا يُخزَّن الناتج** (القرار 7): الرابطُ دالّةٌ في `slug`،
 * وتخزينُه يخلق نسخةً ثانيةً تتباعد عند أوّلِ تغييرِ نطاقٍ أو بوت.
 */
export function buildStoreDeepLinkPayload(storeSlug: string): string {
  return `${MARKETPLACE_DEEP_LINK_PREFIXES.store}${storeSlug}`;
}

/** يبني حمولةَ رابطٍ عميقٍ لمنتج من مُعرّفه (UUID)؛ ولا يُخزَّن كذلك. */
export function buildProductDeepLinkPayload(productId: string): string {
  return `${MARKETPLACE_DEEP_LINK_PREFIXES.product}${productId}`;
}

// --- الظهورُ مُشتَقٌّ لا مُخزَّن (القرار 3) ---------------------------------------

/**
 * الشروطُ الأربعةُ للظهور، مُعلَنةً في العقدِ ومُشتقّةً عند القراءةِ لا مُخزَّنةً في عمود.
 *
 * دالّةٌ نقيّةٌ في حزمةِ العقدِ لأنّ المستهلكَ (البحثُ في Phase 12 · بوتُ العميل) يحتاج
 * الشرطَ نفسَه، ولو كتب كلٌّ منهم فرعَه لظهر منتجٌ في نتيجةِ بحثٍ واختفى عند فتحه.
 * النسخةُ الخاطئةُ الأرخص: عمودٌ `is_visible` يُحدَّث بمُشغِّل — فيصير كلُّ إيقافِ متجرٍ
 * كتابةً على كلِّ منتجاتِه، وأوّلُ فشلٍ في المنتصفِ يترك سوقاً نصفَ ظاهر.
 */
export function isProductVisible(input: {
  storeState: StoreState;
  productState: ProductState;
  moderationState: ProductModerationState;
  quantityOnHand: number;
}): boolean {
  return (
    input.storeState === "approved" &&
    input.productState === "published" &&
    input.moderationState === "approved" &&
    input.quantityOnHand > 0
  );
}
