/**
 * Marketplace Foundation Domain Event types — hand-derived from
 * services/marketplace/contracts/events.json (JSON Schema 2020-12).
 *
 * Drift guards read the canonical schema at test time. ADR-016 decision 1: an
 * event is the TRACE OF A DECISION THAT ENTERED A LEDGER — a review request, an
 * approval, a rejection, a suspension, a publication, or a signed inventory
 * delta — never a declaration of intent and never the output of a timer. Every
 * decision payload therefore carries what makes it reproducible and orderable:
 * its previous state, its next state, its per-aggregate sequence and its named
 * actor; every inventory payload carries the delta AND the resulting balance.
 *
 * Decision 4: NO MONEY and NO PRICE cross this boundary — no `price_minor_units`,
 * no `currency_code`, no `amount`, no `total`, no `fee`, no `commission`. Price is
 * a CATALOG DATUM read from the resource; a consumer that caches it from an event
 * computes on a stale number and shows a buyer a price that does not exist.
 *
 * Decision 10: NO FREE TEXT crosses this boundary — no `title_ar`, no
 * `description_ar`. Consumers build an index, a notification or a dashboard, and
 * all of them read the title from the resource; free text in a payload is copied
 * into seven stores and then asked to be deleted from one.
 *
 * Decision 3: there is NO VISIBILITY EVENT. Visibility is the conjunction of four
 * conditions derived at read time, and an event announcing it would have to
 * publish its negation every time any one of the four changed.
 *
 * Decision 9: no delete event, no search event, no purchase event. The terminal
 * state is `archived`, search belongs to Phase 12 and purchase to Phase 13.
 */
export type MarketplaceAggregateType = "store" | "product" | "inventory";

/**
 * حالاتُ المتجرِ الستّ. **مُشتقّةٌ من دفتر `store_reviews`** لا مكتوبةٌ بيدٍ (ADR-016 القرار 1):
 * إسقاطُ العمودِ وإعادةُ بنائه من الدفترِ عملٌ بلا خسارة، فما في العمود ذاكرةٌ سريعةٌ لا
 * حقيقةٌ منفصلة. و`archived` نهايةٌ لا رجوعَ منها (القرار 9).
 */
export type StoreState = "draft" | "pending_review" | "approved" | "rejected" | "suspended" | "archived";

/**
 * القرارُ لا الحالة. الفرقُ مقصود: الحالةُ تُشتقّ من آخرِ قرار، ولو سُمّي القرارُ بأسماءِ
 * الحالاتِ لصار الدفترُ نسخةً ثانيةً من عمودِ الحالةِ لا سبباً له. و`reinstated` قرارٌ يُنتج
 * الحالةَ `approved` نفسَها: من رأى «approved» بلا القرارِ الذي أنتجها لا يعرف أهو اعتمادٌ
 * أوّلُ أم إعادةٌ بعد إيقاف — والفرقُ يغيّر كلَّ رسالةٍ تُرسل لصاحبِ المتجر.
 */
export type StoreDecision = "review_requested" | "approved" | "rejected" | "suspended" | "reinstated" | "archived";

/**
 * قائمةٌ مغلقة. سببٌ حرٌّ كان سيجعل «لماذا رُفض هذا المتجر؟» سؤالاً يُجاب بالقراءة لا بالعدّ،
 * فلا يستطيع أحدٌ أن يقيس أكثرَ أسبابِ الرفضِ كي يُصلح ما قبله.
 */
export type StoreReasonCode =
  | "incomplete_profile"
  | "prohibited_category"
  | "duplicate_store"
  | "misleading_title"
  | "unverified_owner"
  | "policy_violation"
  | "owner_request";

/**
 * `system` وحدَه يُسمَح له بغيابِ `actor_public_id` (`ck_store_reviews_actor`): قرارُ اعتمادٍ
 * بلا فاعلٍ مُسمّىً قرارٌ لا يُسأل عنه أحد.
 */
export type StoreActorType = "owner" | "moderator" | "system";

/** حالاتُ المنتجِ الثلاث. `archived` نهايةٌ لا رجوعَ منها. */
export type ProductState = "draft" | "published" | "archived";

/**
 * حالةُ الاعتدال **منفصلةٌ عن حالةِ النشر** لأنّهما قرارا شخصَين مختلفَين: الاعتدالُ إذنُ
 * مُراجعٍ والنشرُ قرارُ متجر. ودمجُهما في عمودٍ واحدٍ كان سيجعل مُراجعاً ينشر باسمِ متجرٍ لم
 * يقرّر أنّ منتجَه صار جاهزاً للعرض.
 */
export type ProductModerationState = "pending" | "approved" | "rejected";

export type ProductDecision = "approved" | "rejected";

export type ProductReasonCode =
  | "prohibited_item"
  | "misleading_title"
  | "wrong_category"
  | "price_implausible"
  | "duplicate_listing"
  | "policy_violation";

export type ProductActorType = "moderator" | "system";

/**
 * أسبابُ فرقِ المخزون. قائمةٌ مغلقةٌ لأنّ الفرقَ بلا سببٍ مُسمّىً يجعل «أين ذهبت الكميّة؟»
 * سؤالاً بلا جواب: `shrinkage` و`correction` رقمان متساويان ومعنيان مختلفان تماماً — الأوّلُ
 * فقدٌ حقيقيٌّ يُحصى، والثاني خطأُ إدخالٍ يُصحَّح.
 */
export type InventoryReasonCode = "initial_stock" | "restock" | "correction" | "shrinkage" | "archive_zeroed";

/** أدوارُ الطاقم. قائمةٌ مغلقةٌ والمالكُ واحدٌ بقيدِ `ux_store_staff_single_owner`. */
export type StoreStaffRole = "owner" | "manager" | "staff";

/** مغلّفٌ موحّدٌ لكل أحداث وصلة، كما في الأطوار السابقة. */
export interface MarketplaceEventEnvelope {
  event_id: string;
  event_type: MarketplaceEventType;
  event_version: "v1";
  occurred_at: string;
  producer: typeof MARKETPLACE_EVENT_PRODUCER;
  aggregate: { type: MarketplaceAggregateType; id: string };
  trace_id?: string | null;
}

/**
 * أنواعُ الأحداثِ الثلاثةَ عشرَ. القائمةُ **مُقفلةٌ في العقد** لا مُستنتَجةٌ من الكود، وحارسُ
 * `events.test.ts` يقارنها بالتعريفات في `events.json` حرفاً بحرف.
 */
export const MARKETPLACE_EVENT_TYPES = [
  "marketplace.store_registered",
  "marketplace.store_review_requested",
  "marketplace.store_approved",
  "marketplace.store_rejected",
  "marketplace.store_suspended",
  "marketplace.store_archived",
  "marketplace.store_staff_added",
  "marketplace.store_staff_removed",
  "marketplace.product_created",
  "marketplace.product_moderated",
  "marketplace.product_published",
  "marketplace.product_archived",
  "marketplace.inventory_adjusted",
] as const;
export type MarketplaceEventType = (typeof MARKETPLACE_EVENT_TYPES)[number];

/** منتجٌ واحدٌ لكلِّ أحداثِ هذا الحدّ؛ منتجان يعنيان مصدرَي حقيقةٍ لقرارٍ واحد. */
export const MARKETPLACE_EVENT_PRODUCER = "marketplace-service" as const;

/**
 * حقولٌ لا يجوز أن تظهر في أيِّ `properties` في `events.json`، ولو في تعريفٍ فرعيّ.
 *
 * `price_minor_units` و`currency_code` أوّلُ القائمةِ لأنّهما **موجودان في المورد ومحرَّمان في
 * الحمولة** (القرار 4): مستهلكٌ يحفظ السعرَ من حدثٍ يحسب على رقمٍ قديم. و`title_ar` و
 * `description_ar` كذلك (القرار 10). و`is_visible` محرَّمٌ لأنّه لا وجودَ له أصلاً (القرار 3)،
 * و`quantity_reserved` لأنّ الحجزَ ملكُ Phase 13 (القرار 5).
 */
export const MARKETPLACE_EVENT_FORBIDDEN_FIELDS = [
  "price_minor_units",
  "currency_code",
  "amount",
  "total",
  "fee",
  "commission",
  "vat",
  "discount",
  "invoice",
  "payout",
  "title_ar",
  "description_ar",
  "is_visible",
  "quantity_reserved",
  "quantity_available",
  "phone",
  "email",
  "latitude",
  "longitude",
  "chat_id",
  "telegram",
] as const;

/**
 * أنواعُ أحداثٍ لا يجوز أن تُعرَّف في هذا العقد.
 *
 * `marketplace.product_became_visible` أخطرُها لأنّها أكثرُ ما يُطلَب بحسن نيّة: الظهورُ
 * اقترانُ أربعةِ شروطٍ مُشتَقٍّ عند القراءة (القرار 3)، وحدثٌ يعلنه يحتاج نقيضَه عند كلِّ
 * إيقافِ متجرٍ وكلِّ فرقِ مخزونٍ يُنزل الكميّةَ إلى صفر. والبقيّةُ حدودُ أطوارٍ أخرى:
 * الحذفُ ممنوعٌ أصلاً، والبحثُ Phase 12، والشراءُ والحجزُ Phase 13، والمالُ Phase 17.
 */
export const MARKETPLACE_FORBIDDEN_EVENT_TYPES = [
  "marketplace.product_became_visible",
  "marketplace.product_hidden",
  "marketplace.store_deleted",
  "marketplace.product_deleted",
  "marketplace.product_indexed",
  "marketplace.inventory_reserved",
  "marketplace.inventory_released",
  "marketplace.order_placed",
  "marketplace.payment_captured",
  "marketplace.owner_banned",
] as const;
