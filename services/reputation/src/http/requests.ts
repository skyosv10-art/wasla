/**
 * حراسةُ الطلب: ما تعرفه طبقةُ النقل وحدها (Phase 09 · المراجعة 4/6).
 *
 * ## ما تفحصه هذه الطبقة وما لا تفحصه عمداً
 *
 * تفحص ما يستطيع النقلُ أن يعرفه فقط: أنّ الجسمَ كائن، وأنّ مفاتيحه مُعلَنةٌ في العقد،
 * وأنّ الترويسات مفردةٌ وداخلَ الطول. أمّا **معنى** القيمة — أهي `WS-` صحيحة؟ أهي رتبةٌ
 * معروفة؟ أهو تسلسلٌ ≥ 1؟ — فيُفحَص بنداءِ `assert*` من `src/domain/validation.ts`، أي
 * بنفس الدالّة التي تناديها حالةُ الاستخدام. لا نسخةَ ثانية من القاعدة هنا: نسخةٌ ثانية
 * تعني جوابين مختلفين ليومٍ تتغيّر فيه القاعدةُ في موضعٍ واحد.
 *
 * والانقسامُ يظهر في رموز HTTP: ما يرفضه هذا الملف `400` (طلبُ المُتَّصل مشوّه)، وما يرفضه
 * المجالُ قد يكون `422` (الطلبُ فُهم ورُفض لقاعدةٍ عن العالم).
 *
 * ## لماذا `onlyKeys` لا «تجاهل ما لا تعرف»
 *
 * كلُّ مخطّطٍ في `contracts/api.openapi.yml` يُعلن `additionalProperties: false`. وإسقاطُ
 * مفتاحٍ مجهولٍ بصمت هو نمطُ الفشل الأغلى لاحقاً: يُرسل عميلٌ `subjectType` داخل جسم
 * `POST /reputation/facts` (والعقد يقول `subject_type`) فيأخذ `201` ويظنّ أنّ حقلَه وصل،
 * والواقعةُ سُجّلت بجانبٍ غيرِ الذي أراد. والرفضُ يقول ذلك من أوّل محاولةٍ والمُتَّصل ما
 * زال ينظر إلى طلبه.
 *
 * وقوائمُ المفاتيح **مُصدَّرة** كي يقارنها `__tests__/http-drift.test.ts` بخصائص العقد على
 * القرص: قائمةٌ بيضاءُ تتخلّف بصمتٍ عن العقد ترفض طلباتٍ يسمح بها العقد، وهو الخللُ
 * نفسه في الاتجاه المعاكس.
 *
 * ## ولماذا يُحوَّل `snake_case` إلى `camelCase` هنا صراحةً
 *
 * أجسامُ العقد `snake_case`، ومسوّداتُ حالات الاستخدام في هذه الخدمة `camelCase` (بخلاف
 * خدمة التفاوض التي تُعلن مدخلاتها بمفاتيح العقد). فالمُواءمةُ لازمة، وهي **مكتوبةٌ حقلاً
 * حقلاً** في هذا الملف وحده: حلقةٌ تُحوّل الأسماء آلياً كانت ستقبل كلَّ مفتاحٍ يخترعه
 * مُتَّصل، وتُسقط `onlyKeys` من معناه، وتُخفي يومَ يُضاف حقلٌ إلى العقد ولا يُقرأ.
 */

import { idempotencyKeyRequired, validationFailed } from "../domain/errors.js";
import type { ReputationFactDraft, ReputationRatingDraft } from "../domain/model.js";
import {
  assertFactKind,
  assertFraudRuleCode,
  assertOrderPublicId,
  assertSeverity,
  assertSubjectType,
  assertWaslaPublicId,
} from "../domain/validation.js";
import type { FactFilter, FraudSignalFilter, RatingFilter } from "../ports.js";
import type { FraudSeverity } from "../domain/contract-sets.js";

const IDEMPOTENCY_MIN = 8;
const IDEMPOTENCY_MAX = 128;
const REQUEST_ID_MAX = 128;

export type RequestHeaders = Record<string, string | string[] | undefined>;

function invalid(field: string, expected = "صيغة العقد"): never {
  throw validationFailed(field, expected);
}

/**
 * قيمةُ ترويسةٍ واحدة، أو لا شيء.
 *
 * الترويسةُ المكرّرة تُرفض ولا تُحسم. يصل Node التكرارَ بفاصلة، والفاصلةُ ليست حرفاً
 * مشروعاً في مفتاح تفرّدٍ ولا في مُعرّف تتبّعٍ نُصدره، فوجودُها دليلُ تكرارٍ لا دليلُ
 * محتوى — ومعنى «خُذ الأولى» أنّ أيَّ مفتاحَي مُتَّصلَين يفوز يصير تخميناً.
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
 * مفتاحُ المعالجة الواحدة لفعلٍ قابلٍ لإعادة المحاولة.
 *
 * المفتاحُ **الغائب** والمفتاحُ **المشوّه** رمزان مختلفان، والفرقُ هو خطوةُ المُتَّصل
 * التالية: `REPUTATION_IDEMPOTENCY_KEY_REQUIRED` يقول «أضف الترويسة»، و
 * `REPUTATION_VALIDATION_FAILED` يقول «الترويسةُ التي أرسلتَها ليست مفتاحاً». وكلاهما
 * `400`، فدمجُهما كان سيوفّر صفراً في الحالة ويُكلّف كلَّ شيءٍ في السطر الوحيد الذي
 * يقرؤه المُتكامِل.
 *
 * والطولُ (8..128) يُفحَص هنا لا في `requireIdempotencyKey` الخاصّة بحالات الاستخدام:
 * حدودُ العقد حدودُ صيغةٍ تخصّ الترويسة، ومن ينادي حالةَ الاستخدام من داخل العمليّة
 * (مستهلكُ الأحداث، النبضةُ المُجدولة) لا شبكةَ له ليُعيد عليها المحاولة أصلاً.
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
 * ترويسةُ التتبّع محدودةُ الطول، وذاك قاعدةُ تخزينٍ لا ذوق.
 *
 * `request.id` يصير `trace_id` في كل جوابٍ **ويُمرَّر إلى المجال**، حيث يُكتب في مغلّف كل
 * حدثٍ في `reputation_outbox` وفي عمود `trace_id` على الوقائع. فترويسةٌ غيرُ محدودة من
 * مُتَّصل هي كتابةٌ غيرُ محدودة في جدولٍ يُقرأ لاحقاً كأثرٍ تدقيقيّ.
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

/** `additionalProperties: false` — مفتاحٌ غيرُ مُعلَنٍ يُرفض ولا يُسقَط بصمت. */
export function onlyKeys(payload: Record<string, unknown>, keys: readonly string[]): void {
  const unexpected = Object.keys(payload).find((key) => !keys.includes(key));
  if (unexpected !== undefined) invalid(unexpected, "حقل معلن في العقد");
}

/**
 * المسارُ الذي لا يُعلن `requestBody` يرفض جسماً غيرَ فارغ.
 *
 * `POST …/recompute` و`POST /reputation/tick` لا جسمَ لهما في العقد. وقبولُ جسمٍ ثم
 * تجاهلُه يجعل مُنادياً يُرسل `{"limit": 500}` ويظنّ أنّ حدّاً طُبِّق، والنبضةُ تعمل بحدّها
 * الافتراضي. والحدُّ ليس معلمةً عامّة عمداً: مُتَّصلٌ يختار كم شخصاً تُعيد نبضةٌ واحدة
 * حسابَه يختار عملياً طولَ معاملةٍ على قاعدةٍ مشتركة.
 */
export function assertNoBody(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  if (typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 0) return;
  invalid("body", "جسم فارغ");
}

// ---------------------------------------------------------------------------
// مُعرّفات المسار
// ---------------------------------------------------------------------------

/**
 * `subjectType` من المسار — بنداءِ حرسِ المجال نفسِه لا بكتالوجٍ ثانٍ هنا.
 *
 * `assertSubjectType` تقارن بالقائمة المُقفلة في `@wasla/contracts-reputation`، وهي
 * محروسةٌ ضدّ `enum` في العقد. ونسخةٌ ثالثةٌ من القائمة في هذا الملف كانت ستكون موضعاً
 * ثالثاً عليه أن يوافقَ يومَ تُضاف قيمة.
 */
export function toPathSubjectType(params: unknown): ReturnType<typeof assertSubjectType> {
  return assertSubjectType((params as { subjectType?: unknown }).subjectType);
}

export function toPathSubjectPublicId(params: unknown): string {
  return assertWaslaPublicId((params as { subjectPublicId?: unknown }).subjectPublicId);
}

/**
 * `rulesetVersion` من المسار: عددٌ صحيحٌ ≥ 1 مكتوبٌ نصّاً في العنوان.
 *
 * يُحوَّل هنا لا في المجال، لأنّ المجالَ يتعامل مع عددٍ ويجب أن يبقى كذلك: مجالٌ يقبل
 * `"1"` نصّاً هو مجالٌ يقبل `"1"` من مستودعٍ يوماً ما. والتحويلُ الضمنيّ بـ`Number()` على
 * `"1abc"` يعطي `NaN` وعلى `""` يعطي `0`، فكلاهما مرفوضٌ صريحاً بدل أن يمرّ.
 */
export function toPathRulesetVersion(params: unknown): number {
  const raw = (params as { rulesetVersion?: unknown }).rulesetVersion;
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) {
    invalid("rulesetVersion", "عدد صحيح ≥ 1");
  }
  return Number(raw);
}

// ---------------------------------------------------------------------------
// قوائم مفاتيح الأجسام والاستعلامات — مُصدَّرة لحارس الانحراف
// ---------------------------------------------------------------------------

export const FACT_RECORD_KEYS = [
  "subject_type",
  "subject_public_id",
  "fact_kind",
  "order_public_id",
  "source_event_type",
  "source_event_id",
  "source_sequence",
  "actor_type",
  "reason_code",
  "occurred_at",
] as const;

export const RATING_SUBMIT_KEYS = [
  "order_public_id",
  "rater_type",
  "rater_public_id",
  "subject_public_id",
  "stars",
  "reason_code",
  "submitted_at",
] as const;

/** مُرشِّحاتُ القراءة — بأسماء العقد كما تُكتب في سلسلة الاستعلام (`camelCase`). */
export const FACT_LIST_QUERY_KEYS = [
  "subjectPublicId",
  "subjectType",
  "orderPublicId",
  "factKind",
] as const;

export const RATING_LIST_QUERY_KEYS = ["subjectPublicId", "orderPublicId"] as const;

export const FRAUD_SIGNAL_LIST_QUERY_KEYS = [
  "subjectPublicId",
  "subjectType",
  "ruleCode",
  "severity",
] as const;

// ---------------------------------------------------------------------------
// الأجسام
// ---------------------------------------------------------------------------

/**
 * مسوّدةُ واقعةٍ من جسمٍ `snake_case`.
 *
 * القيَمُ تُنقل كما وصلت ولا تُفحَص هنا: `validateDraft` في `record-fact.ts` أوّلُ سطرٍ
 * فيها نداءُ `assert*` لكل حقل، فهي التي تُنتج `REPUTATION_VALIDATION_FAILED` باسم الحقل
 * الداخليّ. وفحصٌ مسبقٌ هنا كان سيُنتج الرمزَ نفسَه من موضعٍ لا يملك القاعدة، ويصير
 * موضعين على أحدهما أن يوافق.
 *
 * و`reason_code` الغائبُ يصير `null` صريحاً لا `undefined`: المسوّدةُ تُعلن الحقلَ
 * إلزاميّاً بقيمةٍ قابلةٍ للعدم، والعمودُ في القاعدة `NULL`-قابل. و`undefined` كان سيمرّ
 * إلى `stableStringify` فتختلف بصمةُ طلبٍ ذكر الحقلَ فارغاً عن بصمة طلبٍ لم يذكره، وهما
 * طلبٌ واحد لمفتاح معالجةٍ واحدة.
 */
export function toFactRecordDraft(raw: unknown): ReputationFactDraft {
  const body = object(raw);
  onlyKeys(body, FACT_RECORD_KEYS);
  const draft = {
    subjectType: body.subject_type,
    subjectPublicId: body.subject_public_id,
    factKind: body.fact_kind,
    orderPublicId: body.order_public_id,
    sourceEventType: body.source_event_type,
    sourceEventId: body.source_event_id,
    sourceSequence: body.source_sequence,
    actorType: body.actor_type,
    reasonCode: body.reason_code ?? null,
    occurredAt: body.occurred_at,
  };
  return draft as ReputationFactDraft;
}

/**
 * مسوّدةُ تقييمٍ من جسمٍ `snake_case`.
 *
 * لا `subject_type` في الطلب وذاك مقصودٌ في العقد: الجانبُ المُقيَّم يُشتَق من `rater_type`
 * (العميلُ يُقيّم سائقاً والسائقُ يُقيّم عميلاً)، وطلبُه من المُتَّصل كان سيسمح بتقييمٍ
 * يقول «سائقٌ يُقيّم سائقاً» فيُرفض بـ422 بعد أن كان يمكن ألّا يُطلب أصلاً.
 *
 * و`submitted_at` يُحذف إن غاب ولا يُمرَّر `undefined`: المسوّدةُ تُعلنه اختيارياً،
 * و`submitRating` يضع ساعةَ الخدمة مكانَه. أمّا حقلٌ موجودٌ بقيمة `undefined` فيُغيّر
 * البصمة كما سبق.
 */
export function toRatingSubmitDraft(raw: unknown): ReputationRatingDraft {
  const body = object(raw);
  onlyKeys(body, RATING_SUBMIT_KEYS);
  const draft: Record<string, unknown> = {
    orderPublicId: body.order_public_id,
    raterType: body.rater_type,
    raterPublicId: body.rater_public_id,
    subjectPublicId: body.subject_public_id,
    stars: body.stars,
    reasonCode: body.reason_code ?? null,
  };
  if (body.submitted_at !== undefined) draft.submittedAt = body.submitted_at;
  return draft as unknown as ReputationRatingDraft;
}

// ---------------------------------------------------------------------------
// الاستعلامات
// ---------------------------------------------------------------------------

/**
 * مُرشِّحاتُ القائمة: مجهولُ المفاتيح يُرفض هنا أيضاً.
 *
 * قد يبدو رفضُ مُعامل استعلامٍ مجهولٍ تشدّداً بلا داعٍ، وهو في الحقيقة الحراسةُ الأهمّ على
 * هذه المسارات: العقد يشترط مُرشِّحاً واحداً على الأقل، ومُتَّصلٌ يكتب
 * `?subject_public_id=WS-…` بـ`snake_case` بدل `?subjectPublicId=` سيأخذ — لو تُجوهِل
 * المفتاح — `400 REPUTATION_FILTER_REQUIRED` ويظنّ أنّ مُرشِّحه صحيحٌ والخدمةُ عاطلة.
 * والرفضُ باسم المفتاح يقول له أين الخطأ في السطر نفسه.
 *
 * والقيَمُ تُفحَص بحرّاس المجال (`assertWaslaPublicId` …) لأنّ `FactFilter` تُعلن أنواعاً
 * مُضيَّقة: مُرشِّحٌ يعبُر بلا فحصٍ كان سيصل إلى استعلامٍ بقيمةٍ لا شكلَ لها، فيُجيب
 * قائمةً فارغة ويقول للمُتَّصل «لا وقائع» بدل «مُعرّفك ليس مُعرّفاً».
 */
export function toFactListFilter(raw: unknown): FactFilter {
  const query = raw === undefined || raw === null ? {} : object(raw);
  onlyKeys(query, FACT_LIST_QUERY_KEYS);
  const filter: {
    subjectType?: ReturnType<typeof assertSubjectType>;
    subjectPublicId?: string;
    orderPublicId?: string;
    factKind?: ReturnType<typeof assertFactKind>;
  } = {};
  if (query.subjectPublicId !== undefined) {
    filter.subjectPublicId = assertWaslaPublicId(query.subjectPublicId);
  }
  if (query.subjectType !== undefined) filter.subjectType = assertSubjectType(query.subjectType);
  if (query.orderPublicId !== undefined) {
    filter.orderPublicId = assertOrderPublicId(query.orderPublicId);
  }
  if (query.factKind !== undefined) filter.factKind = assertFactKind(query.factKind);
  return filter;
}

export function toRatingListFilter(raw: unknown): RatingFilter {
  const query = raw === undefined || raw === null ? {} : object(raw);
  onlyKeys(query, RATING_LIST_QUERY_KEYS);
  const filter: { subjectPublicId?: string; orderPublicId?: string } = {};
  if (query.subjectPublicId !== undefined) {
    filter.subjectPublicId = assertWaslaPublicId(query.subjectPublicId);
  }
  if (query.orderPublicId !== undefined) {
    filter.orderPublicId = assertOrderPublicId(query.orderPublicId);
  }
  return filter;
}

/**
 * مُرشِّحاتُ الإشارات — و`severity` منها **ليس** مُرشِّحَ مخزن.
 *
 * `FraudSignalFilter` في المنافذ تعرف ثلاثةَ حقول (الجانب، المُعرّف، رمزَ القاعدة) ولا
 * تعرف الشِدّة، والعقدُ يُعلن `severity` مُعامَلاً مسموحاً. فهو يُفحَص هنا بحرس المجال
 * ويُعاد إلى المُنادي كي يُرشِّح به على النتيجة المُعادة، بدل واحدٍ من بديلين أسوأ:
 * إسقاطُه بصمتٍ (فيرى المُتَّصل إشاراتٍ لم يطلبها ويظنّ مُرشِّحه عمل)، أو تعديلُ منفذٍ
 * ومُهيئَين ومُهاجرةٍ من أجل مُرشِّحِ قراءةٍ تُنفّذه سطرٌ واحد.
 *
 * وشِدّةٌ **بلا** مُعرّفٍ ولا رمزِ قاعدةٍ تبقى `400 REPUTATION_FILTER_REQUIRED` يرفعه
 * `listFraudSignals`: «أعطني كلَّ إشارات الشِدّة العالية» تصديرٌ لسلوك كلّ الناس بطلبٍ
 * واحد، وهو بالضبط ما يمنعه حرسُ المُرشِّح.
 */
export function toFraudSignalListQuery(raw: unknown): {
  readonly filter: FraudSignalFilter;
  readonly severity?: FraudSeverity;
} {
  const query = raw === undefined || raw === null ? {} : object(raw);
  onlyKeys(query, FRAUD_SIGNAL_LIST_QUERY_KEYS);
  const filter: {
    subjectType?: ReturnType<typeof assertSubjectType>;
    subjectPublicId?: string;
    ruleCode?: ReturnType<typeof assertFraudRuleCode>;
  } = {};
  if (query.subjectPublicId !== undefined) {
    filter.subjectPublicId = assertWaslaPublicId(query.subjectPublicId);
  }
  if (query.subjectType !== undefined) filter.subjectType = assertSubjectType(query.subjectType);
  if (query.ruleCode !== undefined) filter.ruleCode = assertFraudRuleCode(query.ruleCode);
  if (query.severity === undefined) return { filter };
  return { filter, severity: assertSeverity(query.severity) };
}
