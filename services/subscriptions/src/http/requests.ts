/**
 * حرّاسُ الحدّ: ما يُقبل من السلك قبل أن يلمس المجالَ أو المعاملة.
 *
 * القاعدةُ التي يقوم عليها الملفُّ كلُّه: **يُفحص هنا ما لا يستطيع المجالُ فحصَه، ولا يُفحص
 * هنا ما يفحصه المجال.** فالمجالُ يملك أنماطَ المُعرّفات ولحظاتِ ISO وأسماءَ الحقول
 * الداخليّة، وهو الذي يرفع `SUBSCRIPTION_VALIDATION_FAILED` باسمِ الحقل. ونسخةٌ ثانيةٌ من
 * تلك الفحوص هنا كانت ستصير موضعاً ثانياً عليه أن يوافق يومَ يتغيّر نمطٌ، وأرخصُ نسخةٍ
 * خاطئةٍ هي أن يوافق أحدُهما ويُنسى الآخر.
 *
 * فما يبقى لهذا الملف ثلاثةُ أشياء لا يراها المجالُ أصلاً:
 *
 * 1. **شكلُ الحمولة**: كائنٌ لا مصفوفةٌ ولا نصّ، وبمفاتيحَ مُعلَنةٍ فقط
 *    (`additionalProperties: false` في العقد)، وجسمٌ فارغٌ لمن لا يُعلن جسماً.
 * 2. **الترويسات**: `Idempotency-Key` إلزاميّةٌ لكلّ عمليةٍ تكتب، وطولُ `x-request-id`
 *    محدود.
 * 3. **تحويلُ النصِّ إلى نوع**: `planVersion` في المسار يأتي نصّاً، والمجالُ يتعامل مع عددٍ
 *    ويجب أن يبقى كذلك — مجالٌ يقبل `"1"` نصّاً هو مجالٌ يقبل `"1"` من مستودعٍ يوماً ما.
 *
 * (سابقةُ `services/reputation/src/http/requests.ts`، وهذا الملفُّ يتبع بنيتَها بالحرف.)
 */

import { REFERRAL_STATES } from "@wasla/contracts-subscription";

import {
  idempotencyKeyRequired,
  paymentReferenceRequired,
  referralFilterRequired,
  validationFailed,
} from "../domain/errors.js";

/** طولُ مفتاحِ المعالجةِ الواحدة كما يُعلنه العقد. */
const IDEMPOTENCY_MIN = 8;
const IDEMPOTENCY_MAX = 128;

/**
 * حدُّ طولِ ترويسةِ التتبّع.
 *
 * `request.id` يصير `trace_id` في كلّ جواب **ويُمرَّر إلى المجال** فيُكتب في عمود
 * `trace_id` على صفوفِ الإحالة وفي مغلّفِ كلّ حدثٍ في `subscription_outbox`. فترويسةٌ غيرُ
 * محدودةٍ من مُتَّصل هي كتابةٌ غيرُ محدودةٍ في جدولٍ يُقرأ لاحقاً كأثرٍ تدقيقيّ.
 */
const REQUEST_ID_MAX = 200;

/**
 * حدُّ طولِ مرجعِ الدفع: `4..64` كما يقول `ck_subscription_periods_payment_reference`.
 *
 * والعقدُ (OpenAPI) يقول `minLength: 1` — وهذا **تعارضٌ موثَّقٌ** حُسم لصالحِ القاعدة: مرجعٌ
 * بطولِ حرفٍ واحدٍ يمرّ من التحقّقِ ثم تسقط المعاملةُ على القيد، فيصير جوابُ المُرسِل `500`
 * بدل `422` — أي نُعطي رمزاً خاطئاً لطلبٍ كنّا نعرف أنّه سيُرفض. (يُوثّق في §18 من
 * HANDOFF كثغرةِ عقدٍ ثالثة.)
 */
const PAYMENT_REFERENCE_MIN = 4;
const PAYMENT_REFERENCE_MAX = 64;

export type RequestHeaders = Record<string, string | string[] | undefined>;

function invalid(field: string, expected: string): never {
  throw validationFailed(field, expected);
}

/**
 * ترويسةٌ مكرّرةٌ تُرفض ولا يُختار أوّلُها.
 *
 * Fastify يجمع التكرارَ في مصفوفة. واختيارُ `[0]` بصمتٍ يعني أنّ مُرسلاً بعث مفتاحَي
 * معالجةٍ مختلفين وظنّ أنّ الثانيَ هو المُطبَّق — وهذا بالضبط الوضعُ الذي يُنتج كتابةً
 * مزدوجةً في المراجعة 5/6 يومَ يُخزَّن المفتاح.
 */
export function singleHeader(headers: RequestHeaders, name: string): string | undefined {
  const raw = headers[name];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) invalid(name, "ترويسة واحدة لا مكرّرة");
  return raw;
}

/**
 * كلُّ عمليةٍ تُغيّر حالةً تُلزم `Idempotency-Key` — تُفحص هنا ولو لم تُخزَّن بعد.
 *
 * الخزنُ الفعليُّ (جدول `subscription_idempotency`) من عملِ المراجعة 5/6. ولمَ نُلزم بها
 * الآن؟ لأنّ الإلزامَ عقدٌ مع المُتَّصلين: لو قبلنا اليومَ طلباتٍ بلا مفتاحٍ ثم ألزمنا غداً،
 * لصار الإلزامُ كسراً متوافقاً-عكسيّاً لكلّ عميلٍ بُني على التسامح. والعكسُ سليم: عميلٌ
 * يُرسلها اليومَ يعمل غداً بلا تغيير.
 */
export function requireIdempotencyKey(headers: RequestHeaders): string {
  const key = singleHeader(headers, "idempotency-key");
  if (key === undefined || key.length === 0) {
    throw idempotencyKeyRequired();
  }
  if (key.length < IDEMPOTENCY_MIN || key.length > IDEMPOTENCY_MAX) {
    invalid("Idempotency-Key", `طول بين ${IDEMPOTENCY_MIN} و${IDEMPOTENCY_MAX}`);
  }
  return key;
}

export function assertRequestIdLength(headers: RequestHeaders): void {
  const requestId = singleHeader(headers, "x-request-id");
  if (requestId !== undefined && requestId.length > REQUEST_ID_MAX) {
    invalid("x-request-id", `طول لا يتجاوز ${REQUEST_ID_MAX}`);
  }
}

function object(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    invalid("payload", "كائن JSON");
  }
  return raw as Record<string, unknown>;
}

/** `additionalProperties: false` — مفتاحٌ غيرُ مُعلَنٍ يُرفض ولا يُسقَط بصمت. */
export function onlyKeys(payload: Record<string, unknown>, keys: readonly string[]): void {
  const unexpected = Object.keys(payload).find((key) => !keys.includes(key));
  if (unexpected !== undefined) invalid(unexpected, "حقل معلن في العقد");
}

/**
 * المسارُ الذي لا يُعلن `requestBody` يرفض حمولةً غيرَ فارغة.
 *
 * `POST …/recompute` و`POST /subscriptions/tick` لا حمولةَ لهما في العقد. وقبولُ حمولةٍ ثمّ
 * تجاهلُها يجعل مُنادياً يُرسل `{"limit": 500}` ويظنّ أنّ حدّاً طُبِّق، والنبضةُ تعمل بحدِّها
 * الافتراضيّ. والحدُّ ليس معلمةً عامّةً عمداً: مُتَّصلٌ يختار كم سائقاً تُعيد نبضةٌ واحدةٌ
 * حسابَه يختار عمليّاً طولَ معاملةٍ على قاعدةٍ مشتركة.
 */
export function assertEmptyPayload(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  if (typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 0) return;
  invalid("payload", "حمولة فارغة");
}

// ---------------------------------------------------------------------------
// مُعرّفاتُ المسار
// ---------------------------------------------------------------------------

/**
 * نصُّ المسار يُنقل كما وصل، والنمطُ يفحصه المجال.
 *
 * `assertWaslaPublicId` في `domain/identifiers.ts` هي التي تُنتج الرمزَ باسمِ الحقلِ
 * الداخليّ، وهي محروسةٌ ضدّ `WASLA_PUBLIC_ID_PATTERN` في حزمةِ العقد. وفحصٌ ثانٍ هنا كان
 * سيُنتج الرمزَ نفسَه من موضعٍ لا يملك القاعدة.
 */
export function pathParam(params: unknown, name: string): unknown {
  return (params as Record<string, unknown>)[name];
}

/**
 * `planVersion` من المسار: عددٌ صحيحٌ ≥ 1 مكتوبٌ نصّاً في العنوان.
 *
 * والتحويلُ الضمنيُّ بـ`Number()` على `"1abc"` يعطي `NaN` وعلى `""` يعطي `0`، فكلاهما
 * مرفوضٌ صريحاً بدل أن يمرّ إلى استعلامٍ يقرأ خطّةً غيرَ موجودةٍ فيصير `404` عن سببٍ خاطئ.
 */
export function toPathPlanVersion(params: unknown): number {
  const raw = pathParam(params, "planVersion");
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) {
    invalid("planVersion", "عدد صحيح ≥ 1");
  }
  return Number(raw);
}

/**
 * `frozen_only` من سلسلةِ الاستعلام: `true`/`false` نصّاً، والغائبُ `false`.
 *
 * ولمَ لا نقبل `1` و`yes` و`""`؟ لأنّ `?frozen_only` بلا قيمةٍ يعني عند مُرسِلٍ «نعم» وعند
 * إطارٍ «نصٌّ فارغ»، فمن يطلب المُجمَّدَ وحدَه قد يستلم الكتالوجَ كلَّه ويبني عليه شاشةَ
 * خطّةٍ لم تُجمَّد بعد. القيمتان المُعلَنتان وحدَهما، وما سواهما `400` صريح.
 */
export function toQueryFrozenOnly(query: unknown): boolean {
  const raw = (query as { frozen_only?: unknown }).frozen_only;
  if (raw === undefined) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return invalid("frozen_only", "true أو false");
}

// ---------------------------------------------------------------------------
// قوائمُ مفاتيحِ الحمولات والاستعلامات — مُصدَّرةٌ لحارسِ الانحراف
// ---------------------------------------------------------------------------

export const SUBSCRIPTION_START_KEYS = [
  "driver_public_id",
  "plan_code",
  "plan_version",
  "requested_at",
] as const;

export const SUBSCRIPTION_ACTIVATE_KEYS = [
  "payment_reference",
  "plan_code",
  "plan_version",
  "activated_at",
] as const;

export const REFERRAL_CLAIM_KEYS = ["referral_code", "referee_public_id", "claimed_at"] as const;

/** مُرشِّحُ القراءةِ الإلزاميُّ على `GET /referrals` — واحدٌ منها على الأقلّ. */
export const REFERRAL_LIST_QUERY_KEYS = [
  "referrer_public_id",
  "referee_public_id",
  "state",
] as const;

// ---------------------------------------------------------------------------
// الحمولات
// ---------------------------------------------------------------------------

/** مدخلاتُ بدءِ التجربة كما تصل — القيَمُ تُنقل ويفحصها المجال. */
export interface StartTrialWire {
  readonly driverPublicId: unknown;
  readonly planCode: unknown;
  readonly planVersion: unknown;
  readonly requestedAt: unknown;
}

export function toStartTrialInput(raw: unknown): StartTrialWire {
  const payload = object(raw);
  onlyKeys(payload, SUBSCRIPTION_START_KEYS);
  return {
    driverPublicId: payload.driver_public_id,
    planCode: payload.plan_code,
    planVersion: payload.plan_version,
    requestedAt: payload.requested_at,
  };
}

export interface ActivateWire {
  readonly paymentReference: string;
  readonly planCode: unknown;
  readonly planVersion: unknown;
  readonly activatedAt: unknown;
}

/**
 * التفعيلُ هو الحمولةُ الوحيدةُ التي يُفحص فيها حقلٌ **هنا**: مرجعُ الدفع.
 *
 * لأنّ حدَّه ليس في المجال ولا في العقد بل في **قيدِ القاعدة** (`4..64`)، والمجالُ لا
 * يستورد القاعدةَ ولا يجوز أن يستوردها. والبديلُ — تمريرُه ثم انتظارُ سقوطِ المعاملة —
 * يُنتج `500` عن طلبٍ كان جوابُه الصحيحُ `422`.
 */
export function toActivateInput(raw: unknown): ActivateWire {
  const payload = object(raw);
  onlyKeys(payload, SUBSCRIPTION_ACTIVATE_KEYS);
  const reference = payload.payment_reference;
  if (typeof reference !== "string" || reference.length === 0) {
    throw paymentReferenceRequired();
  }
  if (reference.length < PAYMENT_REFERENCE_MIN || reference.length > PAYMENT_REFERENCE_MAX) {
    invalid("payment_reference", `طول بين ${PAYMENT_REFERENCE_MIN} و${PAYMENT_REFERENCE_MAX}`);
  }
  return {
    paymentReference: reference,
    planCode: payload.plan_code,
    planVersion: payload.plan_version,
    activatedAt: payload.activated_at,
  };
}

export interface ReferralClaimWire {
  readonly referralCode: unknown;
  readonly refereePublicId: unknown;
  readonly claimedAt: unknown;
}

export function toReferralClaimInput(raw: unknown): ReferralClaimWire {
  const payload = object(raw);
  onlyKeys(payload, REFERRAL_CLAIM_KEYS);
  return {
    referralCode: payload.referral_code,
    refereePublicId: payload.referee_public_id,
    claimedAt: payload.claimed_at,
  };
}

/**
 * مُرشِّحُ `GET /referrals`: **إلزاميٌّ**، وواحدٌ لا اثنان.
 *
 * لماذا إلزاميّ: قائمةٌ بلا مُرشِّحٍ هي مسحٌ كاملٌ لجدولِ الإحالات من عنوانٍ عامّ — وهو
 * أرخصُ طريقٍ إلى تسريبِ علاقاتٍ بين سائقين وإلى استعلامٍ يثقل القاعدةَ بلا حدّ. وسقفُ
 * `maxItems: 200` يحدّ الجوابَ لا العمل.
 *
 * ولماذا لا نقبل اثنين معاً: العقدُ يُعلن ثلاثةَ مُرشِّحاتٍ بديلةً لا مُركَّبة، وجمعُها
 * يعني تركيبَ استعلاماتٍ لم يُقاس أثرُها على فهرسٍ (لا فهرسَ مُركَّبٌ عليها في
 * `schema.sql`). والرفضُ الصريحُ أوضحُ من تجاهلِ الزائد.
 */
export type ReferralListFilter =
  | { readonly kind: "referrer"; readonly value: unknown }
  | { readonly kind: "referee"; readonly value: unknown }
  | { readonly kind: "state"; readonly value: string };

export function toReferralListFilter(query: unknown): ReferralListFilter {
  const raw = query as Record<string, unknown>;
  onlyKeys(raw, REFERRAL_LIST_QUERY_KEYS);
  const present = REFERRAL_LIST_QUERY_KEYS.filter((key) => raw[key] !== undefined);
  if (present.length === 0) throw referralFilterRequired();
  if (present.length > 1) invalid(present.join("+"), "مُرشِّح واحد لا أكثر");

  if (raw.referrer_public_id !== undefined) {
    return { kind: "referrer", value: raw.referrer_public_id };
  }
  if (raw.referee_public_id !== undefined) {
    return { kind: "referee", value: raw.referee_public_id };
  }
  const state = raw.state;
  // الحالةُ تُفحص هنا بالقائمةِ المُقفلةِ في حزمةِ العقد لا بقائمةٍ ثانيةٍ مكتوبةٍ في هذا
  // الملف: مُرشِّحٌ بحالةٍ لا وجودَ لها يُعيد `[]` بصمتٍ فيُقرأ «لا إحالات» وهو خطأُ إملاء.
  if (typeof state !== "string" || !(REFERRAL_STATES as readonly string[]).includes(state)) {
    invalid("state", REFERRAL_STATES.join("|"));
  }
  return { kind: "state", value: state };
}
