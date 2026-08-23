/**
 * حراسة الطلب: ما تعرفه طبقة النقل وحدها (Phase 08 · MR 4/6).
 *
 * ## ما تفحصه هذه الطبقة وما لا تفحصه عمداً
 *
 * تفحص ما يستطيع النقل أن يعرفه فقط: أنّ الجسم كائن، وأنّ مفاتيحه مُعلَنة في العقد، وأنّ
 * الترويسات مفردة وداخل الطول، وأنّ مُعرّفات المسار لها الشكل المنشور. **معنى** الحقل لا
 * يُعاد فحصه هنا — المبلغ في حدود السياسة، تبادلُ الأدوار، عملة الخيط، سقفُ الرسائل —
 * لأنّ `src/domain/validation.ts` وحالاتَ الاستخدام تملك ذلك، ونسخةٌ ثانية جوابٌ ثانٍ.
 * ويومَ تتغيّر قاعدةٌ، يجب ألّا يكون هذا الملف أحدَ المواضع التي عليها أن توافق.
 *
 * والانقسام يظهر في رموز HTTP: كلّ ما يرفضه هذا الملف `400` (طلبُ المُتَّصل مشوّه)، بينما
 * رفضُ المجال قد يكون `422` (الطلب فُهم ورُفض). طبقةُ نقلٍ تفحص المعاني مسبقاً تُحوّل
 * الـ`422` إلى `400` فتقول لكل مُتَّصل «أصلح صيغتك» في قاعدةٍ عن العالم.
 *
 * ## لماذا `onlyKeys` لا «تجاهل ما لا تعرف»
 *
 * كل مخطّط طلب في `contracts/api.openapi.yml` يُعلن `additionalProperties: false`.
 * إسقاطُ مفتاحٍ مجهول بصمت هو نمطُ الفشل الأغلى لاحقاً: يُرسل عميلٌ `expected_round_no`
 * إلى مسارٍ لا يقرؤه فيأخذ `201` ويظنّ أنّ الحارس التفاؤلي عمل. الرفضُ يقول ذلك من أول
 * محاولة، والمُتَّصل ما زال ينظر إلى طلبه.
 *
 * وقوائم المفاتيح **مُصدَّرة** كي يقارنها `__tests__/http-contract.test.ts` بخصائص العقد.
 * قائمةٌ بيضاء تتخلّف بصمت عن العقد ترفض طلبات يسمح بها العقد، وهو الخللُ نفسه في
 * الاتجاه المعاكس.
 *
 * ## ولماذا لا تُفحَص القيَم المقفلة هنا أبداً
 *
 * لا طرفٌ ولا حالةُ خيط ولا سببُ إلغاء ولا لغة تُقارن بكتالوج في هذا الملف، وذاك
 * مقصود. كل مدخل حالة استخدام مُعلَن `unknown`، وأوّل سطر في كل واحدة منها نداءٌ
 * لـ`assertParty` أو `assertThreadState` أو `assertServiceKind`… فالمجال **يفحص فعلاً** ولا
 * يكتفي بأنواع تُمحى. وفحصٌ ثانٍ هنا لا يحمي من شيء: إن وافق فهو سطرٌ مكرّر، وإن
 * خالف يوماً فقد رفضنا بـ`400` قيمةً يقبلها المجال والعقد معاً.
 *
 * وانحراف قيمة مُعدّدة عن العقد محروسٌ أصلاً حيث يجب: حرّاس `@wasla/contracts-negotiation`
 * تقارن كل كتالوج بـ`enum` المقابل في `api.openapi.yml`. نسخةٌ ثالثة من القائمة هنا كانت
 * ستكون موضعاً ثالثاً عليه أن يوافق يوم تُضاف قيمة.
 */

import { idempotencyKeyRequired, validationFailed } from "../domain/errors.js";
import type { AcceptRoundInput } from "../use-cases/accept-round.js";
import type { CancelThreadInput } from "../use-cases/cancel-thread.js";
import type { OpenThreadInput } from "../use-cases/open-thread.js";
import type { PostMessageInput } from "../use-cases/post-message.js";
import type { ProposeRoundInput } from "../use-cases/propose-round.js";
import type { ListNegotiationsInput } from "../use-cases/read-negotiation.js";
import type { RejectRoundInput } from "../use-cases/reject-round.js";

const IDEMPOTENCY_MIN = 8;
const IDEMPOTENCY_MAX = 128;
const REQUEST_ID_MAX = 128;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RequestHeaders = Record<string, string | string[] | undefined>;

function invalid(field: string, expected = "صيغة العقد"): never {
  throw validationFailed(field, expected);
}

/**
 * قيمةُ ترويسةٍ واحدة، أو لا شيء.
 *
 * الترويسة المكرّرة تُرفض ولا تُحسم. يصل Node التكرارَ بفاصلة، والفاصلة ليست حرفاً
 * مشروعاً في مفتاح تفرّدٍ ولا في مُعرّف تتبّعٍ نُصدره، فوجودُها دليلُ تكرارٍ لا دليلُ
 * محتوى — ومعنى ذلك أنّ «خُذ الأولى» تخمينٌ في أيّ مفتاحَي مُتَّصلَين يفوز.
 */
function singleHeader(headers: RequestHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) invalid(name, "ترويسة واحدة");
  if (value === undefined) return undefined;
  if (value.includes(",")) invalid(name, "ترويسة واحدة");
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * مفتاح التفرّد لفعلٍ قابل لإعادة المحاولة.
 *
 * المفتاح **الغائب** والمفتاح **المشوّه** رمزان مختلفان، والفرق هو خطوة المُتَّصل التالية:
 * `NEGOTIATION_IDEMPOTENCY_KEY_REQUIRED` يقول «أضف الترويسة»، و`NEGOTIATION_VALIDATION_FAILED`
 * يقول «الترويسة التي أرسلتَها ليست مفتاحاً». وكلاهما `400`، فدمجُهما كان سيوفّر صفراً في
 * الحالة ويُكلّف كلّ شيء في السطر الوحيد الذي يقرؤه المُتكامِل.
 *
 * والطول يُفحَص هنا لا في `assertIdempotencyKey`: حدود العقد (8..128) حدودُ صيغةٍ تخصّ
 * الترويسة، ومَن ينادي حالةَ الاستخدام من داخل العمليّة (النبضة، البوت) لا شبكة له
 * ليُعيد عليها المحاولة أصلاً.
 */
export function requireIdempotencyKey(headers: RequestHeaders): string {
  const key = singleHeader(headers, "Idempotency-Key");
  if (key === undefined) throw idempotencyKeyRequired();
  if (key.length < IDEMPOTENCY_MIN || key.length > IDEMPOTENCY_MAX) {
    invalid("Idempotency-Key", `طول بين ${IDEMPOTENCY_MIN} و${IDEMPOTENCY_MAX}`);
  }
  return key;
}

/**
 * ترويسة التتبّع محدودةُ الطول، وذاك قاعدةُ تخزين لا ذوق.
 *
 * `request.id` يصير `trace_id` في كل جواب **ويُمرَّر إلى المجال**، حيث يُكتب في مغلّف كل
 * حدثٍ في `negotiation_outbox`. فترويسةٌ غير محدودة من مُتَّصل هي كتابةٌ غير محدودة في
 * جدولٍ يُقرأ لاحقاً كأثرٍ تدقيقي.
 */
export function assertRequestIdLength(headers: RequestHeaders): void {
  const requestId = singleHeader(headers, "x-request-id");
  if (requestId !== undefined && requestId.length > REQUEST_ID_MAX) {
    invalid("x-request-id", `طول لا يتجاوز ${REQUEST_ID_MAX}`);
  }
}

function object(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) invalid("body", "كائن JSON");
  return raw as Record<string, unknown>;
}

/** `additionalProperties: false` — مفتاحٌ غير مُعلَن يُرفض ولا يُسقَط بصمت. */
export function onlyKeys(body: Record<string, unknown>, keys: readonly string[]): void {
  const unknown = Object.keys(body).find((key) => !keys.includes(key));
  if (unknown !== undefined) invalid(unknown, "حقل معلن في العقد");
}

/**
 * المسار الذي لا يُعلن `requestBody` يرفض جسماً غير فارغ.
 *
 * `POST /negotiations/tick` لا جسم له عمداً (العقد يقول ذلك ويشرح السبب). قبولُ جسمٍ
 * وتجاهلُه يجعل مُنادياً يُرسل `{"limit": 500}` ويظنّ أنّ حدّاً طُبِّق، والنبضة تعمل بحدّها
 * الافتراضي. والحدّ ليس معلمةً عامّة عمداً: مُتَّصلٌ يختار كم خيطاً تُنهي نبضةٌ واحدة
 * يختار عملياً طولَ المعاملة على قاعدة مشتركة.
 */
export function assertNoBody(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  if (typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 0) return;
  invalid("body", "جسم فارغ");
}

/** مُعرّف الخيط من المسار — UUID لا غير. */
export function toPathUuid(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !UUID.test(raw)) invalid(field, "UUID");
  return raw;
}

/**
 * `roundNo` من المسار: عددٌ صحيح ≥ 1 مكتوبٌ نصّاً في العنوان.
 *
 * يُحوَّل هنا لا في المجال، لأنّ `assertRoundNo` يتعامل مع عددٍ ويجب أن يبقى كذلك: مجالٌ
 * يقبل `"3"` نصّاً هو مجالٌ يقبل `"3"` من مستودعٍ يوماً ما. والتحويل الضمني بـ`Number()`
 * على `"3abc"` يعطي `NaN`، وعلى `""` يعطي `0`، فكلاهما مرفوضٌ صريحاً بدل أن يمرّ.
 */
export function toPathRoundNo(raw: unknown): number {
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) invalid("roundNo", "عدد صحيح ≥ 1");
  return Number(raw);
}

// ---------------------------------------------------------------------------
// قوائم مفاتيح الأجسام — واحدة لكل مخطّط طلب في العقد، مُصدَّرة لحارس الانحراف.
// ---------------------------------------------------------------------------

export const THREAD_OPEN_KEYS = [
  "order_public_id",
  "customer_public_id",
  "driver_public_id",
  "dispatch_offer_id",
  "service_kind",
  "opening_amount_minor",
  "currency",
  "opened_by",
  "opening_note",
  "source_locale",
] as const;

export const THREAD_CANCEL_KEYS = ["reason_code"] as const;

export const ROUND_PROPOSAL_KEYS = [
  "proposed_by",
  "amount_minor",
  "currency",
  "expected_round_no",
  "note",
  "source_locale",
] as const;

export const ROUND_DECISION_KEYS = ["acting_party", "note", "source_locale"] as const;

export const ROUND_REJECTION_KEYS = [
  "acting_party",
  "close_thread",
  "note",
  "source_locale",
] as const;

export const MESSAGE_SUBMISSION_KEYS = [
  "author_role",
  "body",
  "round_no",
  "source_locale",
] as const;

/** مُرشِّحات `GET /negotiations` — بأسماء العقد كما تُكتب في سلسلة الاستعلام. */
export const THREAD_LIST_QUERY_KEYS = ["orderPublicId", "driverPublicId", "state"] as const;

/**
 * الأجسام تُمرَّر بعد الحراسة كما هي، لا تُعاد بناءً.
 *
 * حالاتُ الاستخدام تُعلن مدخلاتها بمفاتيح العقد نفسها (`order_public_id` …) وبنوع
 * `unknown` تفحصه بنفسها. فإعادةُ بناء الكائن هنا كانت ستكون النسخة الثانية من العقد:
 * حقلٌ يُضاف إلى المخطّط ويُنسى في المُحوّل يمرّ صامتاً بـ`200` وقد أُسقط.
 *
 * والتحويل إلى نوع المدخل (`as`) لا يُخفي فحصاً: النوع يقول إنّ المفاتيح **المطلوبة**
 * موجودة، وقيمتُها كلّها `unknown` فلا يستطيع النوع أن يعِد بشيء عن محتواها. وغيابُ
 * مفتاحٍ مطلوب يُرفَض في السطر الأول من حالة الاستخدام بـ`assert*` — أي في الموضع الذي
 * يملك القاعدة. الفحصُ هنا كان سيُنتج رمزَ الخطأ نفسه من موضعٍ لا يملكه.
 */
export function toThreadOpenBody(raw: unknown): OpenThreadInput {
  const body = object(raw);
  onlyKeys(body, THREAD_OPEN_KEYS);
  return body as unknown as OpenThreadInput;
}

export function toThreadCancelBody(raw: unknown): CancelThreadInput {
  const body = object(raw);
  onlyKeys(body, THREAD_CANCEL_KEYS);
  return body as unknown as CancelThreadInput;
}

export function toRoundProposalBody(raw: unknown): ProposeRoundInput {
  const body = object(raw);
  onlyKeys(body, ROUND_PROPOSAL_KEYS);
  return body as unknown as ProposeRoundInput;
}

export function toRoundDecisionBody(raw: unknown): AcceptRoundInput {
  const body = object(raw);
  onlyKeys(body, ROUND_DECISION_KEYS);
  return body as unknown as AcceptRoundInput;
}

export function toRoundRejectionBody(raw: unknown): RejectRoundInput {
  const body = object(raw);
  onlyKeys(body, ROUND_REJECTION_KEYS);
  return body as unknown as RejectRoundInput;
}

export function toMessageSubmissionBody(raw: unknown): PostMessageInput {
  const body = object(raw);
  onlyKeys(body, MESSAGE_SUBMISSION_KEYS);
  return body as unknown as PostMessageInput;
}

/**
 * مُرشِّحات القائمة: مجهولُ المفاتيح يُرفض هنا أيضاً.
 *
 * قد يبدو رفضُ مُعامل استعلامٍ مجهول تشدّداً بلا داعٍ، وهو في الحقيقة الحراسة الأهم على
 * هذا المسار بالذات: العقد يشترط مُرشِّحاً واحداً على الأقل، ومُتَّصلٌ يكتب
 * `?order_public_id=ORD-…` بـsnake_case بدل `?orderPublicId=` سيأخذ — لو تُجوهِل المفتاح —
 * `400 NEGOTIATION_FILTER_REQUIRED` ويظنّ أنّ مُرشِّحه صحيح والخدمة عاطلة. الرفضُ باسم
 * المفتاح يقول له أين الخطأ في السطر نفسه.
 *
 * ولا يُحوَّل شيء هنا إلى `snake_case` بيد: `listNegotiations` تُعلن مدخلاتها بأسماء
 * العقد الداخلية، فالمُواءمة صريحة وفي موضع واحد.
 */
export function toThreadListQuery(raw: unknown): ListNegotiationsInput {
  const query = raw === undefined || raw === null ? {} : object(raw);
  onlyKeys(query, THREAD_LIST_QUERY_KEYS);
  const input: { order_public_id?: unknown; driver_public_id?: unknown; state?: unknown } = {};
  if ("orderPublicId" in query) input.order_public_id = query.orderPublicId;
  if ("driverPublicId" in query) input.driver_public_id = query.driverPublicId;
  if ("state" in query) input.state = query.state;
  return input;
}
