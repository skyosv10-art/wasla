/**
 * تحقُّقُ الحدّ: **ما لا يستطيع المجالُ أن يتحقّق منه وحدَه، ولا شيءَ غيرَه**.
 *
 * ## القاعدةُ الفاصلة
 *
 * الترويساتُ والمعالمُ ومفاتيحُ الجسمِ الزائدةُ شكلٌ نقليٌّ لا يعرفه المجال — فتُفحَص هنا.
 * أمّا اللاحقاتُ والمُعرِّفاتُ والأسعارُ والأدوارُ فحقائقُ مجالٍ لها دوالٌّ مُعلَنةٌ
 * (`assertStoreSlug` · `assertWaslaPublicId` · `assertPriceMinorUnits` · `assertStaffRole`) —
 * فتُنادى من هنا ولا تُكتب ثانيةً. ونسخُ النمطِ في الحدِّ هو أوّلُ خطوةٍ نحو حدٍّ يقبل ما
 * يرفضه المجالُ أو يرفض ما يقبله، ثمّ إلى رسالتَي خطأٍ مختلفتَين للسببِ نفسِه.
 *
 * ## لماذا `additionalProperties: false` يُفرَض هنا صراحةً
 *
 * العقدُ يُغلق كلَّ جسمٍ، وتجاهلُ مفتاحٍ زائدٍ صامتاً هو أخطرُ سلوكٍ ممكن: مُتَّصلٌ يُرسل
 * `state: "approved"` مع تسجيلِ متجرٍ يظنّ أنّه اعتمده، ويُجيبه الحدُّ `201` — فيبني على
 * وهمٍ. والرفضُ الصريحُ يُنهي هذا في أوّلِ طلب.
 *
 * ## ولا `state` من مُتَّصلٍ أبداً
 *
 * `stores.state` و`products.moderation_state` إسقاطان. ولا دالّةَ في هذا الملفّ تقبل حالةً
 * في **جسمِ** كتابة؛ والحالةُ تُقبَل مُرشِّحَ قراءةٍ في `GET` وحدَه.
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
} from "../domain/contract-sets.js";
import {
  marketplaceFilterRequired,
  marketplaceIdempotencyKeyRequired,
  validationFailed,
} from "../domain/errors.js";

/** حدودُ العقد للترويسات (`IdempotencyKey` · `RequestId` · `Cursor` · `Limit`). */
export const IDEMPOTENCY_MIN = 8;
export const IDEMPOTENCY_MAX = 128;
export const REQUEST_ID_MAX = 128;
export const CURSOR_MAX = 256;
export const LIMIT_DEFAULT = 50;
export const LIMIT_MAX = 200;

type Headers = Record<string, string | string[] | undefined>;

/**
 * الأدوارُ التي يجوز إسنادُها في طلبٍ — أدوارُ العقدِ ناقصةً `owner`.
 *
 * وتُشتقُّ اشتقاقاً لا تُكتب قائمةً: `owner` يُسنَد عند التسجيلِ وحدَه وقيدُ
 * `ux_store_staff_single_owner` يحرسه، فلو أُضيف دورٌ رابعٌ في العقدِ لَظهر هنا تلقائيّاً
 * بدلاً من أن يُرفَض بصمتٍ حتّى ينتبه أحدٌ لقائمةٍ منسوخة.
 */
const ASSIGNABLE_STAFF_ROLES = Object.freeze(
  STORE_STAFF_ROLES.filter((role) => role !== "owner"),
) as ReadonlyArray<Exclude<(typeof STORE_STAFF_ROLES)[number], "owner">>;

export type AssignableStaffRole = Exclude<(typeof STORE_STAFF_ROLES)[number], "owner">;

/**
 * ترويسةٌ واحدةٌ لا مصفوفة.
 *
 * ترويسةٌ مكرّرةٌ تُقرأ مصفوفةً في Fastify، وأخذُ أوّلِ عنصرٍ صامتاً يجعل
 * `Idempotency-Key: a` و`Idempotency-Key: b` في طلبٍ واحدٍ يُحفَظ بأحدِهما — وهي غموضٌ في
 * أخطرِ ترويسةٍ في الخدمة. فتُرفض صريحةً.
 */
function singleHeader(headers: Headers, name: string): string | undefined {
  const raw = headers[name];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) throw validationFailed(name, "exactly one header value");
  return raw;
}

/** `Idempotency-Key` إلزاميّةٌ لكلّ كتابةٍ — والرمزُ خاصٌّ لا رمزُ تحقُّقٍ عامّ. */
export function requireIdempotencyKey(headers: Headers): string {
  const key = singleHeader(headers, "idempotency-key");
  /**
   * الغيابُ رمزٌ خاصٌّ، والطولُ المخالفُ رمزُ تحقّقٍ — وليسا واحداً.
   *
   * المُتَّصلُ الذي نسي الترويسةَ يحتاج «أضِف الترويسة»، والذي أرسل مفتاحاً قصيراً يحتاج
   * «أصلِح قيمتَها». ورمزٌ واحدٌ للأمرَين كان سيجعل عميلاً يُعيد المحاولةَ بنفسِ المفتاحِ
   * القصيرِ لأنّ الرسالةَ لم تُسمِّ ما يخالف.
   */
  if (key === undefined || key.trim().length === 0) {
    throw marketplaceIdempotencyKeyRequired();
  }
  if (key.length < IDEMPOTENCY_MIN || key.length > IDEMPOTENCY_MAX) {
    throw validationFailed("Idempotency-Key", `${IDEMPOTENCY_MIN}..${IDEMPOTENCY_MAX} chars`);
  }
  return key;
}

/** `x-request-id` اختياريّةٌ ويُقاس طولُها: ترويسةٌ بلا حدٍّ تدخل السجلَّ بلا حدّ. */
export function assertRequestIdLength(headers: Headers): void {
  const requestId = singleHeader(headers, "x-request-id");
  if (requestId !== undefined && (requestId.length < 1 || requestId.length > REQUEST_ID_MAX)) {
    throw validationFailed("x-request-id", `1..${REQUEST_ID_MAX} chars`);
  }
}

/**
 * حمولةُ كتابةٍ كسِجلٍّ — والحمولةُ الغائبةُ سِجلٌّ فارغٌ لا خطأٌ باسمِ «الجسم».
 *
 * ولمَ يُعامَل الغيابُ فراغاً؟ لأنّ أكثرَ العملاءِ يضع `content-type: application/json`
 * على كلّ `POST` ثمّ يُرسل جسماً فارغاً. ورفضٌ باسمِ «الجسم» يقول للمُرسِل «أرسِل جسماً»
 * وهو قد أرسله — والتعليمةُ التي ينفّذها فعلاً هي اسمُ **الحقلِ الناقصِ** الذي سيُسمّيه
 * `requiredString` بعد سطرٍ واحد. ويبقى الجسمُ غيرُ الكائنِ (نصٌّ أو مصفوفةٌ أو `null`)
 * مرفوضاً باسمِ `payload`: هذا خطأُ شكلٍ لا نقصُ حقل.
 */
function object(raw: unknown): Record<string, unknown> {
  if (raw === undefined) return {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw validationFailed("payload", "a JSON object");
  }
  return raw as Record<string, unknown>;
}

/** يرفض أيَّ مفتاحٍ خارجَ القائمةِ المُعلَنة — بالاسمِ كي يقرأ المُتَّصلُ ما أرسله زائداً. */
function onlyKeys(payload: Record<string, unknown>, keys: ReadonlyArray<string>): void {
  for (const key of Object.keys(payload)) {
    if (!keys.includes(key)) throw validationFailed(key, `one of ${keys.join(", ")}`);
  }
}

function requiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string") throw validationFailed(key, "string");
  return value;
}

function optionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw validationFailed(key, "string or null");
  return value;
}

function requiredInteger(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw validationFailed(key, "integer");
  }
  return value;
}

function optionalInteger(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw validationFailed(key, "integer or null");
  }
  return value;
}

function oneOf<TValue extends string>(
  value: unknown,
  allowed: ReadonlyArray<TValue>,
  field: string,
): TValue {
  if (typeof value !== "string" || !allowed.includes(value as TValue)) {
    throw validationFailed(field, `one of ${allowed.join(", ")}`);
  }
  return value as TValue;
}

/** المفاتيحُ المُعلَنةُ لكلّ جسم — مُصدَّرةٌ كي يقرأها حارسُ الانحرافِ نصّاً. */
export const REGISTER_STORE_KEYS = Object.freeze([
  "owner_public_id",
  "store_slug",
  "title_ar",
  "title_en",
  "title_ur",
  "description_ar",
  "category_slug",
]);
export const STORE_DECISION_KEYS = Object.freeze([
  "decision",
  "actor_type",
  "actor_public_id",
  "reason_code",
]);
export const REVIEW_REQUEST_KEYS = Object.freeze(["requested_by_public_id"]);
export const ADD_STAFF_KEYS = Object.freeze(["member_public_id", "role", "added_by_public_id"]);
export const REMOVE_STAFF_KEYS = Object.freeze(["removed_by_public_id"]);
export const CREATE_PRODUCT_KEYS = Object.freeze([
  "sku",
  "title_ar",
  "title_en",
  "title_ur",
  "description_ar",
  "category_slug",
  "price_minor_units",
  "currency_code",
  "created_by_public_id",
  "initial_quantity",
]);
export const PRODUCT_ACTION_KEYS = Object.freeze(["actor_public_id"]);
/** مفاتيحُ الترقيمِ المشتركةُ — تُشار إليها في العقدِ بـ`$ref` لا باسمٍ في كلّ عمليّة. */
export const PAGE_QUERY_KEYS = Object.freeze(["cursor", "limit"]);
/**
 * مُرشِّحاتُ كلِّ قراءةٍ، مُعلَنةً باسمِها كي يُقابلها حارسُ التباعدِ بمُعامِلاتِ العقد.
 *
 * والمفتاحُ المجهولُ يُرفض ولا يُهمَل: `?visible_onlyy=true` مُهمَلاً بصمتٍ يُعيد منتجاتٍ
 * مخفيّةً لواجهةٍ طلبت الظاهرَ وحدَه — وهو أسوأُ من خطأٍ صريح.
 */
export const STORE_QUERY_FILTER_KEYS = Object.freeze([
  "state",
  "owner_public_id",
  "category_slug",
]);
export const PRODUCT_QUERY_FILTER_KEYS = Object.freeze([
  "state",
  "moderation_state",
  "visible_only",
]);
export const INVENTORY_QUERY_FILTER_KEYS = Object.freeze(["include_ledger"]);
export const CATEGORY_QUERY_KEYS = Object.freeze(["active_only"]);
export const PRODUCT_DECISION_KEYS = Object.freeze([
  "decision",
  "actor_type",
  "actor_public_id",
  "reason_code",
]);
export const ADJUST_INVENTORY_KEYS = Object.freeze([
  "quantity_delta",
  "reason_code",
  "actor_public_id",
]);

export function parseRegisterStore(raw: unknown): {
  ownerPublicId: string;
  storeSlug: string;
  titleAr: string;
  titleEn?: string;
  titleUr?: string;
  descriptionAr?: string;
  categorySlug: string;
} {
  const payload = object(raw);
  onlyKeys(payload, REGISTER_STORE_KEYS);
  const titleEn = optionalString(payload, "title_en");
  const titleUr = optionalString(payload, "title_ur");
  const descriptionAr = optionalString(payload, "description_ar");
  return {
    ownerPublicId: requiredString(payload, "owner_public_id"),
    storeSlug: requiredString(payload, "store_slug"),
    titleAr: requiredString(payload, "title_ar"),
    ...(titleEn === undefined ? {} : { titleEn }),
    ...(titleUr === undefined ? {} : { titleUr }),
    ...(descriptionAr === undefined ? {} : { descriptionAr }),
    categorySlug: requiredString(payload, "category_slug"),
  };
}

export function parseStoreDecision(raw: unknown): {
  decision: (typeof STORE_DECISIONS)[number];
  actorType: (typeof STORE_ACTOR_TYPES)[number];
  actorPublicId?: string;
  reasonCode?: (typeof STORE_REASON_CODES)[number];
} {
  const payload = object(raw);
  onlyKeys(payload, STORE_DECISION_KEYS);
  const actorPublicId = optionalString(payload, "actor_public_id");
  const rawReason = payload["reason_code"];
  const reasonCode =
    rawReason === undefined || rawReason === null
      ? undefined
      : oneOf(rawReason, STORE_REASON_CODES, "reason_code");
  return {
    decision: oneOf(payload["decision"], STORE_DECISIONS, "decision"),
    actorType: oneOf(payload["actor_type"], STORE_ACTOR_TYPES, "actor_type"),
    ...(actorPublicId === undefined ? {} : { actorPublicId }),
    ...(reasonCode === undefined ? {} : { reasonCode }),
  };
}

export function parseReviewRequest(raw: unknown): { requestedByPublicId: string } {
  const payload = object(raw);
  onlyKeys(payload, REVIEW_REQUEST_KEYS);
  return { requestedByPublicId: requiredString(payload, "requested_by_public_id") };
}

export function parseAddStaff(raw: unknown): {
  memberPublicId: string;
  role: AssignableStaffRole;
  addedByPublicId: string;
} {
  const payload = object(raw);
  onlyKeys(payload, ADD_STAFF_KEYS);
  return {
    memberPublicId: requiredString(payload, "member_public_id"),
    role: oneOf(payload["role"], ASSIGNABLE_STAFF_ROLES, "role"),
    addedByPublicId: requiredString(payload, "added_by_public_id"),
  };
}

export function parseRemoveStaff(raw: unknown): { removedByPublicId: string } {
  const payload = object(raw);
  onlyKeys(payload, REMOVE_STAFF_KEYS);
  return { removedByPublicId: requiredString(payload, "removed_by_public_id") };
}

export function parseCreateProduct(raw: unknown): {
  sku: string;
  titleAr: string;
  titleEn?: string;
  titleUr?: string;
  descriptionAr?: string;
  categorySlug: string;
  priceMinorUnits: number;
  currencyCode: string;
  createdByPublicId: string;
  initialQuantity?: number;
} {
  const payload = object(raw);
  onlyKeys(payload, CREATE_PRODUCT_KEYS);
  const titleEn = optionalString(payload, "title_en");
  const titleUr = optionalString(payload, "title_ur");
  const descriptionAr = optionalString(payload, "description_ar");
  const initialQuantity = optionalInteger(payload, "initial_quantity");
  if (initialQuantity !== undefined && initialQuantity < 0) {
    throw validationFailed("initial_quantity", "non-negative integer");
  }
  return {
    sku: requiredString(payload, "sku"),
    titleAr: requiredString(payload, "title_ar"),
    ...(titleEn === undefined ? {} : { titleEn }),
    ...(titleUr === undefined ? {} : { titleUr }),
    ...(descriptionAr === undefined ? {} : { descriptionAr }),
    categorySlug: requiredString(payload, "category_slug"),
    priceMinorUnits: requiredInteger(payload, "price_minor_units"),
    currencyCode: requiredString(payload, "currency_code"),
    createdByPublicId: requiredString(payload, "created_by_public_id"),
    ...(initialQuantity === undefined ? {} : { initialQuantity }),
  };
}

export function parseProductAction(raw: unknown): { actorPublicId: string } {
  const payload = object(raw);
  onlyKeys(payload, PRODUCT_ACTION_KEYS);
  return { actorPublicId: requiredString(payload, "actor_public_id") };
}

export function parseProductDecision(raw: unknown): {
  decision: (typeof PRODUCT_DECISIONS)[number];
  actorType: (typeof PRODUCT_ACTOR_TYPES)[number];
  actorPublicId?: string;
  reasonCode?: (typeof PRODUCT_REASON_CODES)[number];
} {
  const payload = object(raw);
  onlyKeys(payload, PRODUCT_DECISION_KEYS);
  const actorPublicId = optionalString(payload, "actor_public_id");
  const rawReason = payload["reason_code"];
  const reasonCode =
    rawReason === undefined || rawReason === null
      ? undefined
      : oneOf(rawReason, PRODUCT_REASON_CODES, "reason_code");
  return {
    decision: oneOf(payload["decision"], PRODUCT_DECISIONS, "decision"),
    actorType: oneOf(payload["actor_type"], PRODUCT_ACTOR_TYPES, "actor_type"),
    ...(actorPublicId === undefined ? {} : { actorPublicId }),
    ...(reasonCode === undefined ? {} : { reasonCode }),
  };
}

export function parseAdjustInventory(raw: unknown): {
  quantityDelta: number;
  reasonCode: (typeof INVENTORY_REASON_CODES)[number];
  actorPublicId: string;
} {
  const payload = object(raw);
  onlyKeys(payload, ADJUST_INVENTORY_KEYS);
  return {
    quantityDelta: requiredInteger(payload, "quantity_delta"),
    reasonCode: oneOf(payload["reason_code"], INVENTORY_REASON_CODES, "reason_code"),
    actorPublicId: requiredString(payload, "actor_public_id"),
  };
}

/** معلَمُ مسارٍ حاضرٌ — غيابُه عيبُ توجيهٍ لا خطأُ مُتَّصل، فيُرفض بوضوح. */
export function pathParam(params: unknown, name: string): string {
  const value = (params as Record<string, unknown> | undefined)?.[name];
  if (typeof value !== "string" || value.length === 0) {
    throw validationFailed(name, "a non-empty path parameter");
  }
  return value;
}

/** مُرشِّحاتُ قراءةِ المتاجرِ من سلسلةِ الاستفهام. */
export function parseStoreQuery(raw: unknown): {
  state?: (typeof STORE_STATES)[number];
  ownerPublicId?: string;
  categorySlug?: string;
  cursor?: string;
  limit?: number;
} {
  const query = (raw ?? {}) as Record<string, unknown>;
  onlyKeys(query, [...STORE_QUERY_FILTER_KEYS, ...PAGE_QUERY_KEYS]);
  /**
   * مُرشِّحٌ واحدٌ على الأقلِّ — ويُفحَص **في الحدِّ** لا في خدمةِ التطبيقِ وحدَها.
   *
   * `GET /stores` بلا مُرشِّحٍ مسحُ جدولٍ كامل، ورفضُه قبل أن يُسأل المخزنُ يجعل الرمزَ
   * صادقاً في وضعَي التشغيل: خدمةٌ بلا قاعدةٍ تقول «المُرشِّحُ مطلوبٌ» لا «الخدمةُ متعذّرة»،
   * فلا يُعيد المُتَّصلُ نفسَ الطلبِ المخالفِ منتظراً عودةَ القاعدة. ويبقى الفحصُ في
   * `MarketplaceStoreService.listStores` قائماً: مُنادٍ آخرُ لا يمرّ من هذا الحدّ.
   */
  if (
    query["state"] === undefined &&
    query["owner_public_id"] === undefined &&
    query["category_slug"] === undefined
  ) {
    throw marketplaceFilterRequired("one of state, owner_public_id, category_slug");
  }
  const state =
    query["state"] === undefined
      ? undefined
      : oneOf(query["state"], STORE_STATES, "state");
  return {
    ...(state === undefined ? {} : { state }),
    ...(query["owner_public_id"] === undefined
      ? {}
      : { ownerPublicId: queryString(query, "owner_public_id") }),
    ...(query["category_slug"] === undefined
      ? {}
      : { categorySlug: queryString(query, "category_slug") }),
    ...cursorAndLimit(query),
  };
}

/**
 * قراءةٌ مُصفَّحةٌ بلا مُرشِّحات: `cursor` و`limit` وحدَهما.
 *
 * ولمَ لا تُعاد `parseStoreQuery` هنا؟ لأنّها تُلزم مُرشِّحاً وتقبل `state` — ودفترُ قراراتِ
 * متجرٍ واحدٍ لا مُرشِّحَ له في العقد، فاستعمالُها كان يردّ `MARKETPLACE_FILTER_REQUIRED` على
 * طلبٍ مطابقٍ للعقدِ تماماً (وقد وقع ذلك فعلاً، وأسقطه اختبارُ الوضعِ المتدهور). ومفتاحٌ
 * مجهولٌ في الاستعلامِ يُرفض بالاسم: `?statee=approved` يُهمَل بصمتٍ كان سيُعيد كلَّ الصفوف.
 */
export function parsePageQuery(raw: unknown): { cursor?: string; limit?: number } {
  const query = (raw ?? {}) as Record<string, unknown>;
  onlyKeys(query, PAGE_QUERY_KEYS);
  return cursorAndLimit(query);
}

/** ومُرشِّحاتُ قراءةِ المنتجات. */
export function parseProductQuery(raw: unknown): {
  state?: (typeof PRODUCT_STATES)[number];
  moderationState?: (typeof PRODUCT_MODERATION_STATES)[number];
  visibleOnly?: boolean;
  cursor?: string;
  limit?: number;
} {
  const query = (raw ?? {}) as Record<string, unknown>;
  onlyKeys(query, [...PRODUCT_QUERY_FILTER_KEYS, ...PAGE_QUERY_KEYS]);
  const state =
    query["state"] === undefined ? undefined : oneOf(query["state"], PRODUCT_STATES, "state");
  const moderationState =
    query["moderation_state"] === undefined
      ? undefined
      : oneOf(query["moderation_state"], PRODUCT_MODERATION_STATES, "moderation_state");
  const visibleOnly = queryBoolean(query, "visible_only");
  return {
    ...(state === undefined ? {} : { state }),
    ...(moderationState === undefined ? {} : { moderationState }),
    ...(visibleOnly === undefined ? {} : { visibleOnly }),
    ...cursorAndLimit(query),
  };
}

/** ومُرشِّحاتُ قراءةِ المخزون. */
export function parseInventoryQuery(raw: unknown): {
  includeLedger?: boolean;
  cursor?: string;
  limit?: number;
} {
  const query = (raw ?? {}) as Record<string, unknown>;
  onlyKeys(query, [...INVENTORY_QUERY_FILTER_KEYS, ...PAGE_QUERY_KEYS]);
  const includeLedger = queryBoolean(query, "include_ledger");
  return {
    ...(includeLedger === undefined ? {} : { includeLedger }),
    ...cursorAndLimit(query),
  };
}

/** و`active_only` وحدَها لقراءةِ التصنيفات. */
export function parseCategoryQuery(raw: unknown): { activeOnly?: boolean } {
  const query = (raw ?? {}) as Record<string, unknown>;
  onlyKeys(query, CATEGORY_QUERY_KEYS);
  const activeOnly = queryBoolean(query, "active_only");
  return activeOnly === undefined ? {} : { activeOnly };
}

function queryString(query: Record<string, unknown>, key: string): string {
  const value = query[key];
  if (typeof value !== "string" || value.length === 0) {
    throw validationFailed(key, "a non-empty string");
  }
  return value;
}

/**
 * `"true"` و`"false"` وحدَهما.
 *
 * ولمَ لا `Boolean(value)`؟ لأنّها تُحوّل `"false"` إلى `true` — فيقرأ المُتَّصلُ نتيجةَ
 * `visible_only=false` وقد رُشِّحت. والرفضُ الصريحُ يمنع هذا الصنفَ من الخطأِ الصامت.
 */
function queryBoolean(query: Record<string, unknown>, key: string): boolean | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw validationFailed(key, "true or false");
}

function cursorAndLimit(query: Record<string, unknown>): {
  cursor?: string;
  limit?: number;
} {
  const rawCursor = query["cursor"];
  const rawLimit = query["limit"];
  const cursor =
    rawCursor === undefined
      ? undefined
      : (() => {
          const value = queryString(query, "cursor");
          if (value.length > CURSOR_MAX) {
            throw validationFailed("cursor", `1..${CURSOR_MAX} characters`);
          }
          return value;
        })();
  const limit =
    rawLimit === undefined
      ? undefined
      : (() => {
          if (typeof rawLimit !== "string" || !/^[0-9]{1,3}$/.test(rawLimit)) {
            throw validationFailed("limit", `1..${LIMIT_MAX}`);
          }
          const parsed = Number.parseInt(rawLimit, 10);
          if (parsed < 1 || parsed > LIMIT_MAX) throw validationFailed("limit", `1..${LIMIT_MAX}`);
          return parsed;
        })();
  return {
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
  };
}

/** جسمٌ فارغٌ مقبولٌ حيث لا حمولةَ — و`{}` و`null` و`undefined` سواءٌ هنا. */
export function assertEmptyPayload(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  const payload = object(raw);
  if (Object.keys(payload).length > 0) throw validationFailed("body", "an empty body");
}
