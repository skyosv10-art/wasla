/**
 * بُناةُ أحداثِ السوق — دوالُّ خالصةٌ تُنتج حمولةَ العقدِ ولا تكتب شيئاً.
 *
 * ## القرار: الحدثُ يُبنى في المجالِ ويُكتب في المخزن
 *
 * لو بُنيت الحمولةُ داخلَ `db/outbox.ts` لصار العقدُ (`contracts/events.json`) محروساً بقاعدةِ
 * بياناتٍ لا بمُصرِّفٍ ولا باختبارٍ سريع: كلُّ تحقّقٍ من مفتاحٍ ناقصٍ يحتاج معاملةً حقيقيّةً،
 * فيُصبح خطأُ الحمولةِ عطباً يُكتشَف في التكاملِ إن كان هناك تكامل. وهذه الملفُّ بلا استيرادٍ
 * من `db/` ولا من `app/`: مُدخلاتُه قيمٌ، ومُخرجُه كائنٌ، فاختبارُه `events.test.ts` سريعٌ
 * يفحص كلَّ مفتاحٍ على العقدِ **نفسِه** مقروءاً من الملفّ لا منسوخاً في الاختبار.
 *
 * ## والغلافُ لا يُبنى هنا كاملاً: `event_id` من القاعدةِ وحدَها
 *
 * `randomUUID(` ممنوعٌ في `src/` كلِّه (محروسٌ في `purity.test.ts`) لأنّ مُعرِّفاً يُولَّد في
 * العمليّةِ يجعل إعادةَ تشغيلِ نفسِ القرارِ حدثاً بمُعرِّفٍ جديدٍ، فينكسر إهمالُ المُستهلكِ
 * للمُكرَّر. فالمُعرِّفُ عمودٌ افتراضُه `gen_random_uuid()` في `marketplace_outbox`، والغلافُ
 * يُعاد بناؤه من أعمدةِ الصفِّ بـ`marketplaceEventEnvelope` — وهي الدالّةُ التي تُثبت أنّ ما
 * سيُنشَر يوماً مُطابقٌ للعقد، بلا ناقلٍ ولا ناشرٍ في هذه المراجعة.
 *
 * ## وما لا يدخل الحمولةَ بحال
 *
 * لا سعرَ ولا عملةَ ولا نصَّ حرٍّ (عنوانٌ أو وصف) ولا حقلَ ظهورٍ محسوب: العقدُ يمنعها
 * بـ`additionalProperties: false`، وهذا الملفُّ يمنعها بألّا يقبلها في مُدخلاتِه أصلاً. ومُعرِّفاتُ
 * الأشخاصِ مراجعُ مُعتِمةٌ (`WS-##########`) لا هويّاتٌ.
 *
 * ## وكلُّ مفتاحٍ يُكتب دائماً
 *
 * الحقولُ الاختياريّةُ في العقدِ (`actor_public_id`، `reason_code`) تُكتب `null` صريحاً لا
 * تُحذَف: مجموعةُ المفاتيحِ ثابتةٌ لكلِّ نوعِ حدثٍ، فمُستهلكٌ يقرأ `data.reason_code` لا يحتاج
 * أن يُفرِّق بين «غائبٍ» و«فارغٍ»، والاختبارُ يستطيع مُطابقةَ المفاتيحِ بالمساواةِ التامّةِ على
 * `properties` كلِّها لا بالاحتواء.
 */

import type {
  InventoryReasonCode,
  ProductActorType,
  ProductModerationState,
  ProductReasonCode,
  ProductState,
  StoreActorType,
  StoreReasonCode,
  StoreStaffRole,
  StoreState,
} from "./contract-sets.js";
import {
  INVENTORY_REASON_CODES,
  PRODUCT_ACTOR_TYPES,
  PRODUCT_MODERATION_STATES,
  PRODUCT_REASON_CODES,
  PRODUCT_STATES,
  STORE_ACTOR_TYPES,
  STORE_REASON_CODES,
  STORE_STAFF_ROLES,
  STORE_STATES,
} from "./contract-sets.js";
import { validationFailed } from "./errors.js";
import {
  assertCategorySlug,
  assertProductSku,
  assertStoreSlug,
  assertUuid,
  assertWaslaPublicId,
} from "./identifiers.js";
import { assertTimestamp } from "./time.js";

/** مُنتِجُ كلِّ حدثٍ في هذه الخدمة — ثابتُ العقدِ (`producer` مُقيَّدٌ بـ`const`). */
export const MARKETPLACE_EVENT_PRODUCER = "marketplace-service";

/** إصدارُ العقدِ الحاليُّ الوحيد. لا `v2` قبلَ قرارٍ مُوثَّقٍ ومُستهلكٍ يقرأ الاثنين. */
export const MARKETPLACE_EVENT_VERSION = "v1";

/** أنواعُ الأحداثِ الثلاثةَ عشرَ بترتيبِ العقد. قائمةٌ واحدةٌ يفحصُها الاختبارُ على الملفّ. */
export const MARKETPLACE_EVENT_TYPES = Object.freeze([
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
] as const);

export type MarketplaceEventType = (typeof MARKETPLACE_EVENT_TYPES)[number];

/** جذرُ الحدث. `inventory` مُجمَّعٌ مُستقلٌّ مُفتاحُه المنتج، لأنّ الفرقَ يُقرأ بترتيبِه وحدَه. */
export type MarketplaceAggregateType = "store" | "product" | "inventory";

/** قيمةٌ في حمولةِ حدثٍ: لا كائناتٌ متداخلةٌ ولا مصفوفاتٌ — العقدُ كلُّه مُسطَّح. */
export type MarketplaceEventValue = string | number | boolean | null;

export type MarketplaceEventPayload = Readonly<Record<string, MarketplaceEventValue>>;

/**
 * حدثٌ جاهزٌ للكتابةِ في `marketplace_outbox` بلا `event_id`.
 *
 * الحقولُ الأربعةُ الأولى أعمدةٌ في الجدولِ لا حقولٌ في الحمولة: النوعُ والإصدارُ والجذرُ
 * ومُعرِّفُه مفاتيحُ فرزٍ وترشيحٍ للناشر، وتكرارُها داخلَ `payload` كان سيسمح باختلافِ
 * العمودِ عن الحمولةِ في صفٍّ واحد.
 */
export interface MarketplaceEventDraft {
  readonly eventType: MarketplaceEventType;
  readonly eventVersion: typeof MARKETPLACE_EVENT_VERSION;
  readonly aggregateType: MarketplaceAggregateType;
  readonly aggregateId: string;
  /** لحظةُ إنتاجِ الحدثِ من ساعةِ الطلب — لا لحظةُ الواقعةِ (تلك `occurred_for` في الحمولة). */
  readonly occurredAt: string;
  readonly payload: MarketplaceEventPayload;
}

/** الغلافُ كما يصفُه `EventEnvelope` في العقد — مفاتيحُ `snake_case` كما تُنشَر. */
export interface MarketplaceEventEnvelope {
  readonly event_id: string;
  readonly event_type: MarketplaceEventType;
  readonly event_version: string;
  readonly occurred_at: string;
  readonly producer: typeof MARKETPLACE_EVENT_PRODUCER;
  readonly aggregate: {
    readonly type: MarketplaceAggregateType;
    readonly id: string;
  };
  readonly data: MarketplaceEventPayload;
}

/**
 * يُعيد بناءَ الحدثِ الكاملِ من مُعرِّفِ الصفِّ ومُسوَّدتِه.
 *
 * هذه هي الدالّةُ التي سيُناديها الناشرُ يومَ يُكتب (دَينُ Phase 09 المُعلَن)، وهي الآن دليلُ
 * الاختبارِ على أنّ ما يُخزَّن كافٍ لإنتاجِ غلافٍ مُطابقٍ للعقدِ بلا حقلٍ ناقص.
 */
export function marketplaceEventEnvelope(
  eventId: string,
  draft: MarketplaceEventDraft,
): MarketplaceEventEnvelope {
  return {
    event_id: assertUuid(eventId, "event_id"),
    event_type: draft.eventType,
    event_version: draft.eventVersion,
    occurred_at: draft.occurredAt,
    producer: MARKETPLACE_EVENT_PRODUCER,
    aggregate: { type: draft.aggregateType, id: draft.aggregateId },
    data: draft.payload,
  };
}

/** تسلسلٌ مقبولٌ: صحيحٌ موجَبٌ. الصفرُ يعني «لم يحدث»، ولا حدثَ لما لم يحدث. */
function assertSequence(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw validationFailed(field, "عددٌ صحيحٌ ≥ 1");
  }
  return value;
}

/** كميّةٌ مقبولةٌ في حمولةٍ: صحيحةٌ غيرُ سالبة. */
function assertQuantity(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw validationFailed(field, "عددٌ صحيحٌ ≥ 0");
  }
  return value;
}

/** فرقٌ مقبولٌ: صحيحٌ لا يساوي صفراً (`not: {const: 0}` في العقد). */
function assertDelta(value: number, field: string): number {
  if (!Number.isInteger(value) || value === 0) {
    throw validationFailed(field, "عددٌ صحيحٌ لا يساوي صفراً");
  }
  return value;
}

/** قيمةٌ من تعدادِ العقدِ أو خطأُ تحقّقٍ يُسمّي الحقلَ والقائمة. */
function assertMember<T extends string>(value: T, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value)) {
    throw validationFailed(field, `واحدةٌ من: ${allowed.join(", ")}`);
  }
  return value;
}

function optionalPublicId(value: string | undefined, field: string): string | null {
  return value === undefined ? null : assertWaslaPublicId(value, field);
}

function optionalMember<T extends string>(
  value: T | undefined,
  allowed: readonly T[],
  field: string,
): T | null {
  return value === undefined ? null : assertMember(value, allowed, field);
}

/** الحقولُ التي يحملها كلُّ حدثِ قرارٍ على متجرٍ — مُطابِقةٌ لـ`StoreDecisionData`. */
export interface StoreDecisionEventInput {
  readonly storeId: string;
  readonly storeSlug: string;
  readonly ownerPublicId: string;
  readonly categorySlug: string;
  readonly fromState: StoreState | null;
  readonly toState: StoreState;
  readonly stateSequence: number;
  readonly actorType: StoreActorType;
  readonly actorPublicId?: string;
  readonly reasonCode?: StoreReasonCode;
  /** لحظةُ القرارِ كما دخلت الدفترَ (`decided_at`) لا لحظةُ إنتاجِ الحدث. */
  readonly occurredFor: string;
  readonly occurredAt: string;
}

/**
 * نوعُ حدثِ المتجرِ يُشتقّ من **الحالةِ الوجهةِ** لا من اسمِ القرار.
 *
 * القراراتُ ستّةٌ والحالاتُ ستٌّ، لكن `reinstated` و`approved` ينتهيان إلى `approved` نفسِها،
 * وللمُستهلكِ حدثٌ واحدٌ (`store_approved`) يُفرِّق بينهما بـ`is_first_approval` — وهذا نصُّ
 * العقدِ حرفاً. وخريطةٌ كاملةٌ على `StoreState` تجعل إضافةَ حالةٍ يوماً خطأَ تصريفٍ لا حدثاً
 * ناقصاً يُكتشَف عند مُستهلكٍ.
 */
const STORE_EVENT_BY_TO_STATE: Readonly<Record<StoreState, MarketplaceEventType>> = Object.freeze({
  draft: "marketplace.store_registered",
  pending_review: "marketplace.store_review_requested",
  approved: "marketplace.store_approved",
  rejected: "marketplace.store_rejected",
  suspended: "marketplace.store_suspended",
  archived: "marketplace.store_archived",
});

function storeDecisionPayload(input: StoreDecisionEventInput): Record<string, MarketplaceEventValue> {
  return {
    store_id: assertUuid(input.storeId, "store_id"),
    store_slug: assertStoreSlug(input.storeSlug, "store_slug"),
    owner_public_id: assertWaslaPublicId(input.ownerPublicId, "owner_public_id"),
    category_slug: assertCategorySlug(input.categorySlug, "category_slug"),
    from_state:
      input.fromState === null ? null : assertMember(input.fromState, STORE_STATES, "from_state"),
    to_state: assertMember(input.toState, STORE_STATES, "to_state"),
    state_sequence: assertSequence(input.stateSequence, "state_sequence"),
    actor_type: assertMember(input.actorType, STORE_ACTOR_TYPES, "actor_type"),
    actor_public_id: optionalPublicId(input.actorPublicId, "actor_public_id"),
    reason_code: optionalMember(input.reasonCode, STORE_REASON_CODES, "reason_code"),
    occurred_for: assertTimestamp(input.occurredFor, "occurred_for"),
  };
}

function storeDraft(
  eventType: MarketplaceEventType,
  input: StoreDecisionEventInput,
  payload: Record<string, MarketplaceEventValue>,
): MarketplaceEventDraft {
  return {
    eventType,
    eventVersion: MARKETPLACE_EVENT_VERSION,
    aggregateType: "store",
    aggregateId: payload.store_id as string,
    occurredAt: assertTimestamp(input.occurredAt, "occurred_at"),
    payload: Object.freeze(payload),
  };
}

/**
 * التسجيل: ∅ → `draft`. لا صفَّ دفترٍ لهذا القرارِ (التسلسلُ 1 بلا مراجعة)، فالحدثُ هو
 * الأثرُ الوحيدُ الذي يراه خارجُ الخدمةِ لحدوثِ الإنشاء.
 */
export function storeRegisteredEvent(
  input: Omit<StoreDecisionEventInput, "fromState" | "toState" | "actorType" | "reasonCode">,
): MarketplaceEventDraft {
  const full: StoreDecisionEventInput = {
    ...input,
    fromState: null,
    toState: "draft",
    actorType: "owner",
  };
  return storeDraft("marketplace.store_registered", full, storeDecisionPayload(full));
}

/**
 * قرارُ اعتدالٍ على متجرٍ عدا الاعتماد. والاعتمادُ له بانٍ خاصٌّ لأنّه يحمل مفتاحاً زائداً
 * إلزاميّاً (`is_first_approval`)، فلا يُمكن أن يُنسى.
 */
export function storeDecisionEvent(input: StoreDecisionEventInput): MarketplaceEventDraft {
  if (input.toState === "approved") {
    throw validationFailed("to_state", "استعمل storeApprovedEvent للاعتماد");
  }
  if (input.toState === "draft") {
    throw validationFailed("to_state", "استعمل storeRegisteredEvent للإنشاء");
  }
  return storeDraft(STORE_EVENT_BY_TO_STATE[input.toState], input, storeDecisionPayload(input));
}

/**
 * الاعتمادُ الأوّلُ أو الإعادةُ بعد إيقاف — والفرقُ صريحٌ في الحمولةِ لا مُستنتَجٌ عند المُستهلك.
 *
 * ولا `reason_code` في هذه الحمولةِ بنصِّ العقد (`MarketplaceStoreApprovedV1` يقول
 * `additionalProperties: false` ولا يُعلن المفتاحَ أصلاً، خلافاً لبقيّةِ قراراتِ المتجر):
 * الاعتمادُ لا يُعلَّل — والصفُّ في الدفترِ قد يحمل `owner_request` سبباً لإعادةِ تفعيلٍ،
 * لكنّ نشرَه كان سيجعل مُستهلكاً يقرأ سببَ رفضٍ في حدثِ اعتماد. فيُحذَف المفتاحُ **صراحةً**
 * بعد بناءِ حمولةِ القرارِ المشتركةِ لا بإغفالِ تمريره: الإغفالُ كان سيمرّ يومَ يتغيّر
 * `storeDecisionPayload`، والحذفُ المُسمّى يبقى صحيحاً بعده.
 */
export function storeApprovedEvent(
  input: StoreDecisionEventInput & { readonly isFirstApproval: boolean },
): MarketplaceEventDraft {
  if (input.toState !== "approved") {
    throw validationFailed("to_state", "approved");
  }
  if (typeof input.isFirstApproval !== "boolean") {
    throw validationFailed("is_first_approval", "قيمةٌ منطقيّة");
  }
  const { reason_code: _notPublished, ...shared } = storeDecisionPayload(input);
  const payload: Record<string, MarketplaceEventValue> = {
    ...shared,
    is_first_approval: input.isFirstApproval,
  };
  return storeDraft("marketplace.store_approved", input, payload);
}

export interface StoreStaffEventInput {
  readonly storeId: string;
  readonly storeSlug: string;
  readonly staffId: string;
  readonly memberPublicId: string;
  readonly role: StoreStaffRole;
  readonly actorPublicId: string;
  readonly occurredFor: string;
  readonly occurredAt: string;
}

function staffPayload(
  input: StoreStaffEventInput,
  actorField: string,
  allowedRoles: readonly StoreStaffRole[],
): Record<string, MarketplaceEventValue> {
  return {
    store_id: assertUuid(input.storeId, "store_id"),
    store_slug: assertStoreSlug(input.storeSlug, "store_slug"),
    staff_id: assertUuid(input.staffId, "staff_id"),
    member_public_id: assertWaslaPublicId(input.memberPublicId, "member_public_id"),
    role: assertMember(input.role, allowedRoles, "role"),
    [actorField]: assertWaslaPublicId(input.actorPublicId, actorField),
    occurred_for: assertTimestamp(input.occurredFor, "occurred_for"),
  };
}

export function storeStaffAddedEvent(input: StoreStaffEventInput): MarketplaceEventDraft {
  const payload = staffPayload(input, "added_by_public_id", STORE_STAFF_ROLES);
  return {
    eventType: "marketplace.store_staff_added",
    eventVersion: MARKETPLACE_EVENT_VERSION,
    aggregateType: "store",
    aggregateId: payload.store_id as string,
    occurredAt: assertTimestamp(input.occurredAt, "occurred_at"),
    payload: Object.freeze(payload),
  };
}

/**
 * الإزالةُ لا تقع على المالك: العقدُ يقصر `role` هنا على `manager|staff`، والمجالُ يمنع إزالةَ
 * المالكِ أصلاً (`domain/staff.ts`) — فالحصرُ هنا يمنع حدثاً يُخالف قراراً مُطبَّقاً فوقَه.
 */
const REMOVABLE_STAFF_ROLES: readonly StoreStaffRole[] = Object.freeze(
  STORE_STAFF_ROLES.filter((role) => role !== "owner"),
);

export function storeStaffRemovedEvent(input: StoreStaffEventInput): MarketplaceEventDraft {
  const payload = staffPayload(input, "removed_by_public_id", REMOVABLE_STAFF_ROLES);
  return {
    eventType: "marketplace.store_staff_removed",
    eventVersion: MARKETPLACE_EVENT_VERSION,
    aggregateType: "store",
    aggregateId: payload.store_id as string,
    occurredAt: assertTimestamp(input.occurredAt, "occurred_at"),
    payload: Object.freeze(payload),
  };
}

function productDraft(
  eventType: MarketplaceEventType,
  occurredAt: string,
  payload: Record<string, MarketplaceEventValue>,
): MarketplaceEventDraft {
  return {
    eventType,
    eventVersion: MARKETPLACE_EVENT_VERSION,
    aggregateType: "product",
    aggregateId: payload.product_id as string,
    occurredAt: assertTimestamp(occurredAt, "occurred_at"),
    payload: Object.freeze(payload),
  };
}

export interface ProductCreatedEventInput {
  readonly productId: string;
  readonly storeId: string;
  readonly storeSlug: string;
  readonly sku: string;
  readonly categorySlug: string;
  readonly createdByPublicId: string;
  readonly occurredFor: string;
  readonly occurredAt: string;
}

/** الإنشاءُ دائماً `draft` + `pending`: العقدُ يُثبّتهما بـ`const`، فلا يُمرَّران وسيطَين. */
export function productCreatedEvent(input: ProductCreatedEventInput): MarketplaceEventDraft {
  return productDraft("marketplace.product_created", input.occurredAt, {
    product_id: assertUuid(input.productId, "product_id"),
    store_id: assertUuid(input.storeId, "store_id"),
    store_slug: assertStoreSlug(input.storeSlug, "store_slug"),
    sku: assertProductSku(input.sku, "sku"),
    category_slug: assertCategorySlug(input.categorySlug, "category_slug"),
    state: "draft",
    moderation_state: "pending",
    created_by_public_id: assertWaslaPublicId(input.createdByPublicId, "created_by_public_id"),
    occurred_for: assertTimestamp(input.occurredFor, "occurred_for"),
  });
}

export interface ProductModeratedEventInput {
  readonly productId: string;
  readonly storeId: string;
  readonly storeSlug: string;
  readonly fromState: ProductModerationState | null;
  readonly toState: ProductModerationState;
  readonly moderationSequence: number;
  readonly actorType: ProductActorType;
  readonly actorPublicId?: string;
  readonly reasonCode?: ProductReasonCode;
  readonly occurredFor: string;
  readonly occurredAt: string;
}

export function productModeratedEvent(input: ProductModeratedEventInput): MarketplaceEventDraft {
  return productDraft("marketplace.product_moderated", input.occurredAt, {
    product_id: assertUuid(input.productId, "product_id"),
    store_id: assertUuid(input.storeId, "store_id"),
    store_slug: assertStoreSlug(input.storeSlug, "store_slug"),
    from_state:
      input.fromState === null
        ? null
        : assertMember(input.fromState, PRODUCT_MODERATION_STATES, "from_state"),
    to_state: assertMember(input.toState, PRODUCT_MODERATION_STATES, "to_state"),
    moderation_sequence: assertSequence(input.moderationSequence, "moderation_sequence"),
    actor_type: assertMember(input.actorType, PRODUCT_ACTOR_TYPES, "actor_type"),
    actor_public_id: optionalPublicId(input.actorPublicId, "actor_public_id"),
    reason_code: optionalMember(input.reasonCode, PRODUCT_REASON_CODES, "reason_code"),
    occurred_for: assertTimestamp(input.occurredFor, "occurred_for"),
  });
}

export interface ProductPublishedEventInput {
  readonly productId: string;
  readonly storeId: string;
  readonly storeSlug: string;
  readonly categorySlug: string;
  readonly fromState: ProductState;
  readonly storeState: StoreState;
  readonly quantityOnHand: number;
  readonly actorPublicId: string;
  readonly occurredFor: string;
  readonly occurredAt: string;
}

/**
 * النشرُ ليس ظهوراً (القرار 3): الحمولةُ تحمل حالةَ المتجرِ والكميّةَ **كما كانتا لحظتَه** كي
 * يعرف المُستهلكُ أنّ منتجاً نُشِر ولم يَظهر. ولا حقلَ `is_visible` هنا: الظهورُ يُحسَب ولا يُخزَّن.
 */
export function productPublishedEvent(input: ProductPublishedEventInput): MarketplaceEventDraft {
  return productDraft("marketplace.product_published", input.occurredAt, {
    product_id: assertUuid(input.productId, "product_id"),
    store_id: assertUuid(input.storeId, "store_id"),
    store_slug: assertStoreSlug(input.storeSlug, "store_slug"),
    category_slug: assertCategorySlug(input.categorySlug, "category_slug"),
    from_state: assertMember(input.fromState, PRODUCT_STATES, "from_state"),
    to_state: "published",
    store_state: assertMember(input.storeState, STORE_STATES, "store_state"),
    quantity_on_hand: assertQuantity(input.quantityOnHand, "quantity_on_hand"),
    actor_public_id: assertWaslaPublicId(input.actorPublicId, "actor_public_id"),
    occurred_for: assertTimestamp(input.occurredFor, "occurred_for"),
  });
}

export interface ProductArchivedEventInput {
  readonly productId: string;
  readonly storeId: string;
  readonly storeSlug: string;
  readonly fromState: ProductState;
  readonly actorPublicId: string;
  readonly occurredFor: string;
  readonly occurredAt: string;
}

export function productArchivedEvent(input: ProductArchivedEventInput): MarketplaceEventDraft {
  return productDraft("marketplace.product_archived", input.occurredAt, {
    product_id: assertUuid(input.productId, "product_id"),
    store_id: assertUuid(input.storeId, "store_id"),
    store_slug: assertStoreSlug(input.storeSlug, "store_slug"),
    from_state: assertMember(input.fromState, PRODUCT_STATES, "from_state"),
    to_state: "archived",
    actor_public_id: assertWaslaPublicId(input.actorPublicId, "actor_public_id"),
    occurred_for: assertTimestamp(input.occurredFor, "occurred_for"),
  });
}

export interface InventoryAdjustedEventInput {
  readonly adjustmentId: string;
  readonly productId: string;
  readonly storeId: string;
  readonly quantityDelta: number;
  readonly quantityAfter: number;
  readonly reasonCode: InventoryReasonCode;
  readonly adjustmentSequence: number;
  readonly actorPublicId: string;
  readonly occurredFor: string;
  readonly occurredAt: string;
}

/**
 * جذرُ حدثِ المخزونِ `inventory` ومُعرِّفُه **المنتج**: الدفترُ مفتاحُه المنتجُ وتسلسلُه على
 * المنتجِ، فمُستهلكٌ يُرتِّب أحداثَ المخزونِ يُرتِّبها على المنتجِ لا على الفرقِ الفردِ.
 */
export function inventoryAdjustedEvent(input: InventoryAdjustedEventInput): MarketplaceEventDraft {
  const payload: Record<string, MarketplaceEventValue> = {
    adjustment_id: assertUuid(input.adjustmentId, "adjustment_id"),
    product_id: assertUuid(input.productId, "product_id"),
    store_id: assertUuid(input.storeId, "store_id"),
    quantity_delta: assertDelta(input.quantityDelta, "quantity_delta"),
    quantity_after: assertQuantity(input.quantityAfter, "quantity_after"),
    reason_code: assertMember(input.reasonCode, INVENTORY_REASON_CODES, "reason_code"),
    adjustment_sequence: assertSequence(input.adjustmentSequence, "adjustment_sequence"),
    actor_public_id: assertWaslaPublicId(input.actorPublicId, "actor_public_id"),
    occurred_for: assertTimestamp(input.occurredFor, "occurred_for"),
  };
  return {
    eventType: "marketplace.inventory_adjusted",
    eventVersion: MARKETPLACE_EVENT_VERSION,
    aggregateType: "inventory",
    aggregateId: payload.product_id as string,
    occurredAt: assertTimestamp(input.occurredAt, "occurred_at"),
    payload: Object.freeze(payload),
  };
}
