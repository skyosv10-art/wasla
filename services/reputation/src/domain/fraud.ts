/**
 * قواعدُ الاحتيال: خمسُ دوالَّ **مُسمّاةٍ حرفياً** كما في `FRAUD_RULE_CODES`.
 *
 * كلُّ قاعدةٍ تأخذ (نافذةً + وقائع) وتُعيد **إشارةً أو لا شيء**. لا نموذجَ ولا تدريبَ ولا
 * `probability` ولا `confidence` ولا `state` (ADR-014 القرار 6). والسببُ ليس تحفُّظاً
 * تقنياً: الإشارة تُرفع على إنسان، ومراجعُها البشريّ يحتاج أن يقرأ **لماذا** رُفعت —
 * «سبعُ إلغاءاتٍ في ثلاثين يوماً والعتبةُ خمس» جملةٌ تُراجَع وتُخطَّأ وتُدافَع عنها، و
 * «احتمالُ الاحتيال 0.83» جملةٌ لا يُمكن لأحدٍ أن يُخطّئها ولا أن يُبرّئ نفسه منها.
 *
 * ## ما تعنيه الإشارة وما لا تعنيه
 *
 * الإشارة **ملاحظةُ رصد**، لا حُكم ولا عقاب. لا شيء في وَصْلة يحجب ولا يوقف بناءً على
 * إشارة (القرار 7)، ولا مسارَ في العقد للبتّ فيها: المراجعةُ البشرية Phase 15. ولذلك
 * لا حقلَ `action` في العتبة ولا `resolution` في الإشارة.
 *
 * ## إشارةٌ واحدة لكل (قاعدة × شخص × نافذة)
 *
 * النبضةُ تُعاد — كل ساعة، وبعد إعادة تشغيل، ومرّتين بالخطأ — ويجب ألّا تتكرّر الإشارة.
 * والحارسُ حرفان: حدُّ النافذة **محسوبٌ** سلّةً يوميةً في `fraudWindowFor` (لا «منذ آخر
 * تشغيل»)، وقيدُ `ux_fraud_signals_rule_window` على
 * (`subject_type`, `subject_public_id`, `rule_code`, `window_ended_at`) في القاعدة.
 * الأول يجعل النافذة قابلةً للتكرار، والثاني يجعل التكرار مستحيلاً.
 *
 * وعددُ الوقائع قد يزيد خلال اليوم بعد رفع الإشارة، فلا تُرفَع ثانيةٌ بعددٍ أكبر. هذا
 * مقصود: الإشارةُ تقول «هذا النمط وقع في هذه النافذة»، لا «هذا آخرُ عددٍ رصدناه». من
 * أراد الرقم الحاضر يقرأ الدفتر.
 *
 * ## لماذا الدوالُّ بأسماء `snake_case`
 *
 * الاسمُ مطابقٌ حرفياً لقيمة `rule_code` في العقد وفي `CHECK` القاعدة وفي حدث
 * `reputation.fraud_signal_raised`. الاسمُ الاصطلاحيّ (`repeatedCustomerCancellation`)
 * كان سيُنشئ تحويلاً بين اسمِ الدالّة ورمزِ القاعدة، والتحويلُ موضعٌ يُخطئ فيه أحدٌ
 * فتُرفَع إشارةٌ برمزٍ لا يطابق القاعدة التي رفعتها — وهو خطأٌ لا يُكتشَف إلّا بمراجعةٍ
 * بشرية لإشارةٍ لا تُشرح.
 */

import type { FraudRuleCode, ReputationSubjectType } from "./contract-sets.js";
import { FRAUD_RULE_CODES } from "./contract-sets.js";
import type {
  FraudSignalDraft,
  FraudWindow,
  ReputationFactRow,
  ReputationRatingRow,
  ReputationRulesetRow,
} from "./model.js";
import { thresholdFor } from "./ruleset.js";
import { withinWindow } from "./time.js";

/**
 * مدخلُ القاعدة: النافذة، ودفترُ هذا الشخص، والتقييماتُ التي **أرسلها** هو.
 *
 * `facts` وقائعُ هذا الشخص كـ`subject`، و`ratingsAuthored` تقييماتٌ هو فيها `rater`.
 * المجموعتان مفصولتان لأنّهما تجيبان سؤالين: ما فُعل به، وما فعله هو. و
 * `rating_extremity_burst` تسأل الثانية وحدها، ولو مُرِّرت لها الأولى لقاست شيئاً آخر
 * تماماً (تقييماتٍ **تلقّاها**) وسمَّته بنفس الاسم.
 *
 * والقائمتان **مُرشَّحتان مسبقاً على الشخص فقط**، لا على النافذة: كلُّ قاعدةٍ تُرشِّح
 * نافذتها بنفسها بـ`withinWindow`، فلا تعتمد قاعدةٌ على ترشيحٍ فعله مستدعٍ لها.
 */
export interface FraudRuleInput {
  readonly subjectType: ReputationSubjectType;
  readonly subjectPublicId: string;
  readonly window: FraudWindow;
  readonly facts: readonly ReputationFactRow[];
  readonly ratingsAuthored: readonly ReputationRatingRow[];
  readonly ruleset: ReputationRulesetRow;
}

/** كلُّ قاعدةٍ في هذا الملف بهذا التوقيع بلا استثناء. */
export type FraudRule = (input: FraudRuleInput) => FraudSignalDraft | null;

/**
 * بانيةُ الإشارة، وهي **الموضع الوحيد** الذي تُنشأ فيه إشارةٌ في المجال.
 *
 * ترفض بالغياب حالتين: قاعدةٌ لا عتبةَ لها في هذه النسخة، وقاعدةٌ عتبتُها لجانبٍ آخر.
 * وترفض بالغياب عدداً **دون** العتبة — لا تُنتج إشارةً «قريبةً من العتبة»: إشارةٌ بعددٍ
 * دون عتبتها إشارةٌ لا سبب لها، وحارسُها في القاعدة `ck_fraud_signals_over_threshold`.
 */
function signalIfOverThreshold(
  input: FraudRuleInput,
  ruleCode: FraudRuleCode,
  observedCount: number,
): FraudSignalDraft | null {
  const threshold = thresholdFor(input.ruleset, ruleCode);
  if (threshold === null) return null;
  if (threshold.subjectType !== input.subjectType) return null;
  if (observedCount < threshold.thresholdCount) return null;

  return {
    subjectType: input.subjectType,
    subjectPublicId: input.subjectPublicId,
    ruleCode,
    severity: threshold.severity,
    windowStartedAt: input.window.startedAt,
    windowEndedAt: input.window.endedAt,
    observedCount,
    thresholdCount: threshold.thresholdCount,
    rulesetVersion: input.ruleset.rulesetVersion,
  };
}

function countFactsInWindow(input: FraudRuleInput, factKind: ReputationFactKindLiteral): number {
  return input.facts.filter(
    (fact) => fact.factKind === factKind && withinWindow(fact.occurredAt, input.window),
  ).length;
}

type ReputationFactKindLiteral = ReputationFactRow["factKind"];

// ---------------------------------------------------------------------------
// القواعد الخمس
// ---------------------------------------------------------------------------

/**
 * `repeated_customer_cancellation` — عميلٌ يُلغي كثيراً في النافذة.
 *
 * تُعدّ وقائعُ `order_cancelled_by_customer` وحدها. ولا تُعدّ إلغاءاتُ السائق على طلبات
 * هذا العميل: إلغاءُ الآخر ليس فعلَ العميل، وعدُّه هنا كان سيرفع إشارةً على من كان
 * ضحيّةَ النمط لا صاحبَه.
 */
export const repeated_customer_cancellation: FraudRule = (input) =>
  signalIfOverThreshold(
    input,
    "repeated_customer_cancellation",
    countFactsInWindow(input, "order_cancelled_by_customer"),
  );

/** `repeated_driver_cancellation` — سائقٌ يُلغي كثيراً في النافذة. */
export const repeated_driver_cancellation: FraudRule = (input) =>
  signalIfOverThreshold(
    input,
    "repeated_driver_cancellation",
    countFactsInWindow(input, "order_cancelled_by_driver"),
  );

/**
 * `accept_then_abandon` — قَبِل الإسناد ثم ألغى الطلب نفسه.
 *
 * تُعدّ **الطلبات** لا الوقائع: النمطُ زوجٌ (`assignment_accepted` ثم
 * `order_cancelled_by_driver`) على `order_public_id` واحد، وكلا طرفَي الزوج في النافذة.
 * وعدُّ الوقائع كان سيُعطي ضعفَ العدد فيتجاوز عتبةً بنصف النمط.
 *
 * وهذه أشدُّ القواعد (`high`) لأنّها الوحيدة التي تصف **سلوكاً مُركّباً**: القبولُ يُخرج
 * الطلب من طابور التوزيع ويُطمئن العميل، ثم الإلغاءُ يُعيده إلى الصفر بعد أن ضاع وقتُه.
 * والقبولُ وحده حقٌّ، والإلغاءُ وحده عذرٌ، والاثنان معاً على نفس الطلب مِراراً نمطٌ.
 *
 * ولا شرطَ ترتيبٍ زمنيّ بين الطرفين هنا عن قصد: إلغاءٌ قبل القبول مستحيلٌ في محرّك
 * الطلب، وفرضُ الترتيب كان سيجعل هذه القاعدة تصمت عند أوّل حدثين وصلا معكوسين من
 * ناقلٍ لا يضمن الترتيب — فتفوت أخطرُ القواعد لعلّةٍ في الناقل.
 */
export const accept_then_abandon: FraudRule = (input) => {
  const accepted = new Set<string>();
  const abandoned = new Set<string>();
  for (const fact of input.facts) {
    if (!withinWindow(fact.occurredAt, input.window)) continue;
    if (fact.factKind === "assignment_accepted") accepted.add(fact.orderPublicId);
    else if (fact.factKind === "order_cancelled_by_driver") abandoned.add(fact.orderPublicId);
  }
  let observed = 0;
  for (const orderPublicId of accepted) {
    if (abandoned.has(orderPublicId)) observed += 1;
  }
  return signalIfOverThreshold(input, "accept_then_abandon", observed);
};

/**
 * `offer_timeout_streak` — عروضٌ تنتهي مهلتُها بلا جواب.
 *
 * تُعدّ وقائعُ `assignment_timed_out` في النافذة. عتبتُها الأعلى (10) وشدّتُها الأدنى
 * (`low`) عن قصد: تطبيقٌ في الخلفية وشبكةٌ ضعيفةٌ يُنتجان هذا النمط بلا نيّة، فالإشارة
 * هنا **دعوةٌ لفحص سببٍ تقنيّ** قبل أن تكون ملاحظةَ سلوك. والاسمُ `streak` وصفٌ للنمط
 * كما سمّاه العقد، والعدُّ عددٌ في نافذةٍ لا تتابعٌ متّصل: «تتابعٌ» يعني انقطاعَه بأيّ
 * قبولٍ واحد، وذاك يجعل من يقبل عرضاً كل عشرة أعراضٍ غيرَ مرئيّ تماماً.
 */
export const offer_timeout_streak: FraudRule = (input) =>
  signalIfOverThreshold(
    input,
    "offer_timeout_streak",
    countFactsInWindow(input, "assignment_timed_out"),
  );

/**
 * `rating_extremity_burst` — مُقيِّمٌ لا يُعطي إلّا الطرفين.
 *
 * تُعدّ التقييماتُ التي **أرسلها** هذا الشخص في النافذة وكانت درجتُها الحدَّ الأدنى أو
 * الأعلى (نجمةٌ أو خمس). النمطُ يُفسد القياس: مُقيِّمٌ يُعطي 1 أو 5 دائماً لا يُميّز، ووزنُ
 * تقييمه كوزن من يُميّز.
 *
 * والقاعدة على **المُرسل** لا على المُقيَّم، ولذلك تقرأ `ratingsAuthored`. ولو قرأت
 * تقييماتِ من تلقّاها لصارت قاعدةً تُعاقب من أُسيء إليه.
 *
 * ولا تُعدّ الوقائعُ `rating_received` هنا بحال: الواقعةُ لا تحمل الدرجة (العقد لا
 * يُدرجها فيها)، فعدُّها كان سيقيس «كم تقييماً تلقّى» ويُسمّيه تطرُّفاً.
 */
export const rating_extremity_burst: FraudRule = (input) => {
  const observed = input.ratingsAuthored.filter(
    (rating) =>
      withinWindow(rating.submittedAt, input.window) &&
      (rating.stars === 1 || rating.stars === 5),
  ).length;
  return signalIfOverThreshold(input, "rating_extremity_burst", observed);
};

/**
 * القواعدُ الخمس بمفتاحِ رمزِها.
 *
 * `Record<FraudRuleCode, FraudRule>` يجعل `tsc` يفشل لحظةَ يُضاف رمزٌ إلى العقد بلا
 * قاعدةٍ تُقابله. وهذا هو الحارسُ الذي يمنع «رمزٌ في العقد لا يرفعه شيء» أن يمرّ بصمت.
 */
export const FRAUD_RULES: Record<FraudRuleCode, FraudRule> = {
  repeated_customer_cancellation,
  repeated_driver_cancellation,
  accept_then_abandon,
  offer_timeout_streak,
  rating_extremity_burst,
};

/**
 * تشغيلُ القواعد كلّها على شخصٍ في نافذةٍ، بترتيب `FRAUD_RULE_CODES` المُعلَن.
 *
 * الترتيبُ من العقد لا من ترتيب مفاتيح كائنٍ: ترتيبُ `Object.keys` مُعرَّفٌ في JavaScript
 * لكنه يتبع ترتيبَ الكتابة، فتغييرُ سطرين في `FRAUD_RULES` كان سيُغيّر ترتيبَ إشاراتٍ
 * تُرفَع في نبضةٍ واحدة — فرقٌ لا يُلاحَظ في اختبارٍ ويُلاحَظ في سجلٍّ يُقارَن.
 */
export function evaluateFraudRules(input: FraudRuleInput): readonly FraudSignalDraft[] {
  const drafts: FraudSignalDraft[] = [];
  for (const ruleCode of FRAUD_RULE_CODES) {
    const draft = FRAUD_RULES[ruleCode](input);
    if (draft !== null) drafts.push(draft);
  }
  return drafts;
}
