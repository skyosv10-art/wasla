/**
 * الخطأُ في هذا المجال: **رمزٌ من كتالوجِ العقدِ** يحمل حقولاً مُسمّاةً لا نصّاً حرّاً.
 *
 * ADR-016 القرار 10، بسوابق ADR-012 و013 و014 و015. الرمزُ هو ما يُبرمَج عليه المستهلكُ،
 * والرسالةُ العربيّةُ للإنسان، ولذلك تُفحَص الاختباراتُ على `code` لا على نصّ الرسالة: نصٌّ
 * يُفحَص يجعل تحسينَ صياغةٍ للمستخدمِ كسراً في وظيفةِ CI فيتعلّم الفريقُ أن لا يُحسّن.
 *
 * ## لماذا يُشتَقُّ نوعُ `details` من العقدِ ولا يُعلَن هنا
 *
 * `ErrorResponse.error.details` مُعلَنٌ في OpenAPI بعشرةِ مفاتيحَ و`additionalProperties: false`.
 * اشتقاقُ النوعِ من الحزمةِ يجعل مفتاحاً يخترعه المجالُ **خطأَ ترجمةٍ** لا مفاجأةَ إنتاج؛
 * ولو أُعلنت الواجهةُ هنا يدوياً لصار في المستودعِ عقدان: عقدُ الشبكةِ الصارمُ الذي يرفض
 * المفتاحَ الزائد، ونسخةُ الخدمةِ المتسامحةُ التي تُنتجه، فيمرّ `typecheck` ويسقط مستهلكٌ
 * صارمٌ عند أوّلِ خطأٍ حقيقيّ.
 *
 * ومن هذا الحصرِ يتبع ما **لا** يظهر في `details`: لا سعرَ ولا مالَ (القرار 4) ولا عنوانَ ولا
 * وصفاً حرّاً ولا رقمَ جوّال (القرار 10). المسموحُ أسماءُ حقولٍ وقيمُ تعدادٍ ومُعرّفاتٌ
 * علنيّةٌ وكميّةُ مخزون، وهي وحدها ما يحتاجه المستهلكُ ليُصلح طلبَه.
 *
 * ## لماذا صنفٌ واحدٌ لا صنفٌ لكلّ رمز
 *
 * أربعةٌ وعشرون رمزاً ⇒ أربعةٌ وعشرون صنفاً يعني أربعةً وعشرين موضعَ صيانةٍ لقاعدةٍ واحدة،
 * وأوّلَ رمزٍ جديدٍ يُضاف بلا صنفٍ فيسقط من كلِّ `instanceof`. صنفٌ واحدٌ يحمل الرمزَ حقلاً
 * يجعل `httpStatusForMarketplaceError` كافياً لكلّ الكتالوج، ويجعل إضافةَ رمزٍ في العقدِ
 * تكفي وحدها.
 */

import {
  MARKETPLACE_ERROR_CODE_CLASS,
  httpStatusForMarketplaceError,
  type ErrorResponse,
  type MarketplaceErrorClass,
  type MarketplaceErrorCode,
} from "./contract-sets.js";

/**
 * حقولُ `details` كما يُعلنها العقدُ حرفاً بحرف — مُشتقّةٌ لا مكتوبة.
 *
 * `field` اسمُ حقلٍ لا قيمتُه، و`expected` قاعدةٌ مُعلَنةٌ نصّاً ثابتاً لا مثالاً من بيانات
 * أحد، و`constraint` اسمُ قيدٍ في المخطّطِ يحمي الحقيقةَ نفسَها عند تزامنِ الكتابة.
 */
export type MarketplaceErrorDetails = NonNullable<NonNullable<ErrorResponse["error"]>["details"]>;

/**
 * خطأُ مجالِ السوق. `code` هو العقدُ، و`message` عربيّةٌ للإنسان، و`details` حقولٌ مُسمّاة.
 *
 * `httpStatus` مُشتَقٌّ لا مُمرَّرٌ في المُنشئ: مُمرَّرٌ يعني أنّ نفسَ الرمزِ قد يعود 409 من
 * مسارٍ و422 من آخرَ فيبني المستهلكُ منطقَ إعادةِ محاولةٍ على رملٍ. والاشتقاقُ من
 * `MARKETPLACE_ERROR_CODE_CLASS` يجعل الجوابَ واحداً في كلّ السطح.
 */
export class MarketplaceError extends Error {
  readonly code: MarketplaceErrorCode;
  readonly errorClass: MarketplaceErrorClass;
  readonly httpStatus: number;
  readonly details?: MarketplaceErrorDetails;

  constructor(code: MarketplaceErrorCode, message: string, details?: MarketplaceErrorDetails) {
    super(message);
    this.name = "MarketplaceError";
    this.code = code;
    this.errorClass = MARKETPLACE_ERROR_CODE_CLASS[code];
    this.httpStatus = httpStatusForMarketplaceError(code);
    if (details !== undefined) this.details = details;
  }
}

/** حارسٌ يُستعمَل في طبقة HTTP (المراجعة 4/6) للتمييز عن الأخطاءِ غيرِ المتوقَّعة. */
export function isMarketplaceError(error: unknown): error is MarketplaceError {
  return error instanceof MarketplaceError;
}

// --- بانياتُ الأخطاء: واحدةٌ لكلّ رمزٍ يُنتجه المجالُ النقيّ ----------------------
//
// الرموزُ التي لا تُنتَج هنا (`STORE_NOT_FOUND` · `PRODUCT_NOT_FOUND` ·
// `STORE_CATEGORY_NOT_FOUND` · `STORE_STAFF_NOT_FOUND` · `MARKETPLACE_IDEMPOTENCY_*` ·
// `STORE_REVIEW_ALREADY_PENDING` · `MARKETPLACE_FILTER_REQUIRED` · `MARKETPLACE_UNAVAILABLE`)
// تحتاج مخزناً ليعرف أنّ الصفَّ غائبٌ أو مسارَ طلبٍ ليعرف أنّ مفتاحاً أُعيد، فمكانُها المراجعة
// 4/6. وهي موجودةٌ في الكتالوجِ من المراجعة 1/6، والمجالُ لا يخترع رمزاً ليس فيه ولا يُسقط
// رمزاً منه.
//
// أمّا الثلاثةُ أدناه (`STORE_SLUG_TAKEN` · `PRODUCT_SKU_TAKEN` ·
// `STORE_STAFF_ALREADY_MEMBER`) فنزلت في المراجعة 3/6 لأنّ التفرّدَ حقيقةٌ **لا تُعرَف قبل
// الكتابة**: فحصُ «هل اللاحقةُ مأخوذة؟» بقراءةٍ ثمّ كتابةٍ يمرّ في الاختبارِ ويسقط عند
// طلبَين متزامنَين — والحقيقةُ يحرسها فهرسٌ فريدٌ في القاعدة، وترجمةُ اسمِه إلى رمزِ العقدِ
// هي وظيفةُ `db/constraints.ts`. ولا تُعاد قيمةُ المدخلِ في `details` (اللاحقةُ استثناءٌ
// مُعلَنٌ في العقدِ لأنّها مُعرِّفٌ علنيٌّ يقرؤه صاحبُ المتجرِ في الرابط)، ويُسمّى القيدُ
// دائماً كي يُقرأ سببُ التعارضِ من السجلِّ بلا تخمين.

export function validationFailed(field: string, expected: string): MarketplaceError {
  return new MarketplaceError(
    "MARKETPLACE_VALIDATION_FAILED",
    `حقلٌ غيرُ مقبول: ${field} — المتوقَّع ${expected}.`,
    { field, expected },
  );
}

/**
 * قرارٌ لا يقبله المتجرُ في حالته الحاضرة. الحالتان تُعادان كي يعرف المستهلكُ **أين هو**
 * لا أنّ شيئاً فُشِل: `from_state: 'suspended'` مع `to_state: 'archived'` يقول لصاحبِ المتجرِ
 * «أعِد التشغيلَ أوّلاً» بلا أن يقرأ ADR.
 */
export function storeDecisionNotAllowed(
  from: string | null,
  to: string,
  decision: string,
): MarketplaceError {
  return new MarketplaceError(
    "STORE_DECISION_NOT_ALLOWED",
    `قرارٌ غيرُ مسموحٍ على متجرٍ في حالته الحاضرة: ${decision}.`,
    { from_state: from ?? "none", to_state: to, expected: `decision ${decision} not applicable` },
  );
}

/** الرفضُ والإيقافُ يلزمهما سببٌ مُقفَل؛ الحقلُ يُسمّى ولا يُعاد نصُّ سببٍ حرّ. */
export function storeRejectionReasonRequired(decision: string): MarketplaceError {
  return new MarketplaceError(
    "STORE_REJECTION_REASON_REQUIRED",
    `القرارُ ${decision} يلزمه سببٌ مُقفَلٌ من القائمة المُعلَنة.`,
    { field: "reason_code", expected: "one of the declared STORE_REASON_CODES" },
  );
}

export function productTransitionNotAllowed(from: string | null, to: string): MarketplaceError {
  return new MarketplaceError("PRODUCT_TRANSITION_NOT_ALLOWED", "انتقالٌ غيرُ مسموحٍ لحالة المنتج.", {
    from_state: from ?? "none",
    to_state: to,
  });
}

/**
 * اسمُ حقلِ اللاحقةِ كما يُرسِله العميلُ — لا كما يُسمّيه العمود.
 *
 * الوثيقةُ تقول إنّ `field` «اسمُ الحقلِ المرفوض»، والعميلُ أرسل `store_slug` لا `slug`؛
 * فتسميةُ العمودِ كانت تُرشِد العميلَ إلى حقلٍ لا وجودَ له في جسمِه. وثابتٌ واحدٌ هنا
 * أفضلُ من ثلاثِ نصوصٍ متكرّرةٍ تنحرف واحدةً بعد أخرى (`storeSlugReserved` ·
 * `storeSlugTaken` · `assertStoreSlug`).
 */
export const STORE_SLUG_FIELD = "store_slug";

export function storeSlugReserved(storeSlug: string): MarketplaceError {
  return new MarketplaceError("STORE_SLUG_RESERVED", "هذه اللاحقةُ محجوزةٌ للمنصّة.", {
    store_slug: storeSlug,
    field: STORE_SLUG_FIELD,
  });
}

/** أحدُ شروطِ الظهورِ الأربعةِ ساقطٌ — برمزه الخاصِّ لا برمزٍ جامعٍ (القرار 3). */
export function storeNotApproved(state: string): MarketplaceError {
  return new MarketplaceError("STORE_NOT_APPROVED", "المتجرُ غيرُ معتمَد.", {
    from_state: state,
    expected: "approved",
  });
}

export function productNotModerated(moderationState: string): MarketplaceError {
  return new MarketplaceError("PRODUCT_NOT_MODERATED", "المنتجُ لم يجتز الاعتدال.", {
    from_state: moderationState,
    expected: "approved",
  });
}

export function storeCategoryInactive(categorySlug: string): MarketplaceError {
  return new MarketplaceError("STORE_CATEGORY_INACTIVE", "التصنيفُ مُعطَّل.", {
    category_slug: categorySlug,
  });
}

export function productCategoryNotLeaf(categorySlug: string): MarketplaceError {
  return new MarketplaceError("PRODUCT_CATEGORY_NOT_LEAF", "المنتجُ يُسنَد إلى تصنيفٍ ورقةٍ فقط.", {
    category_slug: categorySlug,
    expected: "leaf category at depth 2",
  });
}

export function storeOwnerRoleImmutable(memberPublicId: string): MarketplaceError {
  return new MarketplaceError("STORE_OWNER_ROLE_IMMUTABLE", "دورُ المالكِ لا يُعدَّل ولا يُنزَع.", {
    member_public_id: memberPublicId,
    constraint: "ux_store_staff_single_owner",
  });
}

/**
 * سحبٌ ينزل بالكميّةِ تحت الصفر. تُعاد الكميّةُ في اليدِ لأنّها **رقمُ مخزونٍ لا مال**، وبها
 * يعرف المستهلكُ الحدَّ الأعلى للسحبِ المقبولِ فلا يُعيد المحاولةَ بالتخمين.
 */
export function inventoryInsufficientQuantity(quantityOnHand: number): MarketplaceError {
  return new MarketplaceError(
    "INVENTORY_INSUFFICIENT_QUANTITY",
    "الكميّةُ في اليدِ لا تكفي هذا السحب.",
    { quantity_on_hand: quantityOnHand, field: "quantity_delta", expected: "quantity_after >= 0" },
  );
}

/**
 * لاحقةُ متجرٍ مأخوذةٌ — يُترجَم إليها انتهاكُ `ux_stores_slug_lower` لا انتهاكُ `slug` وحدَه:
 * الفهرسُ على `LOWER(slug)` بقصد، فـ`Wasla-Store` و`wasla-store` تعارضٌ واحدٌ لا اثنان.
 */
export function storeSlugTaken(storeSlug: string): MarketplaceError {
  return new MarketplaceError("STORE_SLUG_TAKEN", "هذه اللاحقةُ مأخوذةٌ لمتجرٍ آخر.", {
    store_slug: storeSlug,
    field: STORE_SLUG_FIELD,
    constraint: "ux_stores_slug_lower",
  });
}

/**
 * رمزُ صنفٍ مأخوذٌ **داخلَ المتجرِ** لا في السوقِ كلِّه — ولذلك لا يُعاد الرمزُ في `details`:
 * حقولُ `details` معدودةٌ في العقدِ ولا حقلَ فيها لـ`sku`، ويُسمّى الحقلُ والقيدُ فيكفي.
 */
export function productSkuTaken(): MarketplaceError {
  return new MarketplaceError("PRODUCT_SKU_TAKEN", "رمزُ الصنفِ مُستعملٌ في هذا المتجر.", {
    field: "sku",
    expected: "unique per store",
    constraint: "ux_products_store_sku",
  });
}

/** عضويّةٌ نشطةٌ قائمةٌ — والفهرسُ جزئيٌّ، فعودةُ مَن أُزيل ليست تعارضاً (القرار 8). */
export function storeStaffAlreadyMember(memberPublicId: string): MarketplaceError {
  return new MarketplaceError("STORE_STAFF_ALREADY_MEMBER", "هذا العضوُ في طاقمِ المتجرِ فعلاً.", {
    member_public_id: memberPublicId,
    constraint: "ux_store_staff_active_member",
  });
}

/** حدٌّ مُعلَنٌ لا صامت: `STORE_ACTIVE_LIMIT_PER_OWNER` يُذكَر نصّاً في `expected`. */
export function storeOwnerLimitReached(limit: number): MarketplaceError {
  return new MarketplaceError(
    "STORE_OWNER_LIMIT_REACHED",
    "بلغ المالكُ حدَّ المتاجرِ النشطةِ المسموحَ في هذا الطور.",
    { expected: `at most ${limit} active store(s) per owner`, constraint: "ux_stores_owner_active" },
  );
}

// --- بانياتُ المراجعة 4/6: ما لا يعرفه المجالُ النقيُّ وحدَه ---------------------
//
// نزلت هنا لا في `app/` بقصد: `MarketplaceError` هي النوعُ الواحدُ الذي تقرؤه طبقةُ HTTP
// وتُشتَقُّ منه الحالةُ بالصنفِ لا بجدولٍ يدويّ، فبانيةٌ في `app/` كانت ستُنتج خطأً لا يمرّ
// من `isMarketplaceError` — أي `503` على «متجرٌ غيرُ موجود». والحقيقةُ التي يحتاجها كلُّ رمزٍ
// أدناه (صفٌّ غائبٌ · مفتاحٌ أُعيد · مُرشِّحٌ ناقصٌ · مخزنٌ غيرُ مهيّأ) تُكتشَف في المخزنِ أو
// على الحدّ، لكنّ **الرمزَ والرسالةَ والتفاصيلَ** تبقى مُعلَنةً في موضعٍ واحد.

/** متجرٌ غيرُ موجودٍ باللاحقةِ التي طُلب بها — واللاحقةُ تُعاد لأنّها مُعرِّفٌ علنيّ. */
export function storeNotFound(storeSlug: string): MarketplaceError {
  return new MarketplaceError("STORE_NOT_FOUND", "لا متجرَ بهذه اللاحقة.", {
    store_slug: storeSlug,
  });
}

/**
 * منتجٌ غيرُ موجود.
 *
 * `product_id` يُعاد لأنّه مُعرِّفٌ أعطاه المُنادي بنفسِه، فإعادتُه لا تُفصح عن شيءٍ لا
 * يعرفه — وهي الفرقُ بين «أيَّ منتجٍ تعني؟» و«لم أجد ما أرسلتَه».
 */
export function productNotFound(productId: string): MarketplaceError {
  return new MarketplaceError("PRODUCT_NOT_FOUND", "لا منتجَ بهذا المُعرّف.", {
    product_id: productId,
  });
}

/** تصنيفٌ غيرُ موجودٍ في الشجرة — والشجرةُ بيانُ منصّةٍ تُزرَع في المراجعة 5/6 لا في مسار. */
export function storeCategoryNotFound(categorySlug: string): MarketplaceError {
  return new MarketplaceError("STORE_CATEGORY_NOT_FOUND", "لا تصنيفَ بهذه اللاحقة.", {
    category_slug: categorySlug,
  });
}

/** عضوٌ غيرُ موجودٍ **نشطاً** في هذا المتجر؛ والمُزالُ سابقاً ليس عضواً حاضراً. */
export function storeStaffNotFound(memberPublicId: string): MarketplaceError {
  return new MarketplaceError("STORE_STAFF_NOT_FOUND", "لا عضوَ نشطٌ بهذا المُعرّف في المتجر.", {
    member_public_id: memberPublicId,
  });
}

/**
 * `Idempotency-Key` غائبةٌ عن كتابةٍ تُلزمها — رمزٌ خاصٌّ لا `VALIDATION_FAILED`.
 *
 * الفرقُ عمليٌّ لا شكليّ: المُتَّصلُ الذي نسي الترويسةَ يجب أن يقرأ تعليمةً واحدةً واضحةً
 * («أضف مفتاحاً») لا أن يبحث في `details.field` عن سببِ رفضٍ يظنّه في حمولته.
 */
export function marketplaceIdempotencyKeyRequired(): MarketplaceError {
  return new MarketplaceError(
    "MARKETPLACE_IDEMPOTENCY_KEY_REQUIRED",
    "هذه الكتابةُ تلزمها ترويسةُ Idempotency-Key.",
    { field: "Idempotency-Key", expected: "8..128 characters" },
  );
}

/**
 * نفسُ المفتاحِ لحمولةٍ مختلفة — تعارضٌ مُسمّىً لا كتابةٌ صامتة.
 *
 * وهو **ليس** جوابَ الإعادة: الإعادةُ بنفسِ المفتاحِ ونفسِ الحمولةِ تُعيد الجوابَ المحفوظَ
 * بحرفِه بحالته المحفوظة. وهذا الرمزُ لحالةٍ واحدةٍ فقط: مفتاحٌ مُستعملٌ لطلبٍ آخر — أي خللٌ
 * في توليدِ المفاتيحِ عند المُنادي، وإخفاؤه كان سيُنتج جواباً عن طلبٍ لم يُرسَل.
 */
export function marketplaceIdempotencyKeyReused(): MarketplaceError {
  return new MarketplaceError(
    "MARKETPLACE_IDEMPOTENCY_KEY_REUSED",
    "هذا المفتاحُ مُستعملٌ لطلبٍ بحمولةٍ مختلفة.",
    { field: "Idempotency-Key", expected: "a key not used for a different payload" },
  );
}

/** طلبُ مراجعةٍ ثانٍ ومتجرٌ في `pending_review` أصلاً: مراجعةٌ واحدةٌ معلّقةٌ لا صفٌّ ثانٍ. */
export function storeReviewAlreadyPending(storeSlug: string): MarketplaceError {
  return new MarketplaceError(
    "STORE_REVIEW_ALREADY_PENDING",
    "للمتجرِ طلبُ مراجعةٍ معلّقٌ فعلاً.",
    { store_slug: storeSlug, from_state: "pending_review" },
  );
}

/**
 * قراءةُ قائمةٍ بلا مُرشِّحٍ واحدٍ على الأقلّ.
 *
 * ولمَ يُرفض المسحُ الكامل؟ لأنّ `GET /stores` بلا مُرشِّحٍ يُقرأ «كلُّ متاجرِ المنصّة» —
 * صفحةً بعد صفحةٍ على فهرسٍ لا يخدمها، ثمّ يصير المسارُ الذي يُسقط القاعدةَ عند أوّلِ نموّ.
 * والمُرشِّحُ الإلزاميُّ يجعل كلَّ قراءةٍ تُصيب فهرساً مُعلَناً في العقد.
 */
export function marketplaceFilterRequired(expected: string): MarketplaceError {
  return new MarketplaceError(
    "MARKETPLACE_FILTER_REQUIRED",
    "هذه القراءةُ تلزمها مُرشِّحٌ واحدٌ على الأقلّ.",
    { field: "query", expected },
  );
}

/**
 * الاستمراريّةُ غيرُ مهيّأة — `503` لا `500`.
 *
 * الفرقُ هو ما يقرؤه المُنادي: `503` تعني «حاولْ لاحقاً، الخللُ عندنا وقد يزول»، و`500` تعني
 * «طلبُك أسقط شيئاً». وخدمةٌ أُقلعت بلا `DATABASE_URL` حالتُها الأولى لا الثانية، ولذلك تبقى
 * `GET /health` ناطقةً بـ`degraded` وتُجيب كلُّ عمليّةٍ أخرى بهذا الرمز.
 */
export function marketplaceUnavailable(reason: string): MarketplaceError {
  return new MarketplaceError("MARKETPLACE_UNAVAILABLE", `السوقُ غيرُ متاحٍ حالياً: ${reason}.`, {
    expected: "configured persistence",
  });
}
