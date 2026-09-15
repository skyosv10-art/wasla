/**
 * إقرارُ صفٍّ مسمومٍ — القرارُ وحدَهُ (المراجعةُ 24/N · M5-13 · ADR-026 §4.27).
 *
 * ## الدَّينُ الذي يرفعُهُ هذا الملفُّ
 *
 * §4.23 أعطى المُشغِّلَ **عيناً** على الفقدِ، و§4.24 أعطاهُ **يداً** تُعيدُ.
 * وبقيَ بابٌ ثالثٌ مفتوحاً: صفٌّ مسمومٌ **لا يُعادُ ولا يُنسى**. مثالُهُ الحرفيُّ
 * من الدفترِ نفسِهِ: حدثٌ بنسخةٍ غيرِ مدعومةٍ من مُنتِجٍ أُصلِحَ بعدَ أسبوعٍ —
 * إعادتُهُ تُسَمِّمُهُ ثانيةً بالسببِ نفسِهِ، وتركُهُ يُبقي `warning` قائماً إلى
 * الأبدِ.
 *
 * و«تحذيرٌ إلى الأبدِ» ليسَ حالةً محايدةً: هوَ الطريقُ المقيسُ إلى **تصميتِ
 * التنبيهِ**، وبعدَ التصميتِ لا يُرى المسمومُ **الجديدُ** أيضاً. فالمقياسُ الذي
 * لا يستطيعُ العودةَ إلى الأخضرِ إلّا بمحوِ صفٍّ **يدفعُ نحوَ محوِ الدليلِ** —
 * وهوَ ما تمنعُهُ قواعدُ هذا المستودعِ نصّاً.
 *
 * ## والمخرجُ: إقرارٌ **يُضيفُ** ولا يمحو
 *
 * الصفُّ يبقى بحرفِهِ: `consumed_status = 'poisoned'` و`attempt_count`
 * و`last_error` لا يمسُّها الإقرارُ. ويُضافُ إليهِ ثلاثيٌّ: **متى** و**مَن**
 * و**لماذا**. والعددُ الكلِّيُّ يبقى منشوراً؛ المُستثنى من **الحكمِ** وحدَهُ.
 *
 * ## وثلاثةُ حدودٍ تمنعُ أن يصيرَ زرَّ إسكاتٍ
 *
 * **(أ) لا إقرارَ جماعيَّ.** صفٌّ صفٌّ بمُعرِّفِهِ — سابقةُ §4.25 حرفاً. ونداءٌ
 * يُقِرُّ «كلَّ المسمومِ» كانَ سيجعلَ الإقرارَ أرخصَ من القراءةِ، وما يَرخُصُ
 * يُستعمَلُ بلا نظرٍ.
 *
 * **(ب) لا إقرارَ بلا سببٍ.** والسببُ **حدُّهُ الأدنى اثنا عشرَ حرفاً** لا
 * حرفٌ واحدٌ: سببٌ من حرفٍ (`x`) يُرضي مُدقِّقاً شكليّاً ولا يُفيدُ قارئَ
 * تحقيقٍ بعدَ شهرٍ. والحدُّ مفروضٌ **في القاعدةِ** أيضاً لا في الشيفرةِ وحدَها.
 *
 * **(ج) والمُقِرُّ من الهويّةِ المُثبَتةِ لا من الجسمِ** — سابقةُ §4.20 حرفاً:
 * مَن يكتبُ اسمَهُ في جسمٍ لم يُقِرَّ شيئاً بل وقَّعَ بقلمٍ لا يملكُهُ.
 *
 * ## وإعادةٌ بعدَ إقرارٍ تمحو الإقرارَ — **في القاعدةِ**
 *
 * القيدُ `ck_…_ack_poisoned_only` يرفضُ صفّاً غيرَ مسمومٍ يحملُ إقراراً، فإعادةُ
 * الصفِّ إلى `pending` (§4.25) **توجِبُ** محوَ الثلاثيِّ وإلّا سقطت المعاملةُ
 * بـ`23514`. فالحكمُ «عُولِجَ» لا يَعبُرُ إلى حياةٍ ثانيةٍ للصفِّ بسهوٍ في
 * شيفرةٍ — القاعدةُ تمنعُهُ.
 *
 * ## والإقرارُ الثاني على صفٍّ مُقَرٍّ بهِ **لا يكتبُ فوقَ الأوّلِ**
 *
 * سابقةُ §4.20 حرفاً: يُعادُ `already_acknowledged` بالصفِّ كما هوَ، ولا
 * يُستبدَلُ المُقِرُّ الأوّلُ ولا سببُهُ. ودفترُ مسؤوليّةٍ يُكتَبُ فوقَ أوّلِ
 * شاهدٍ فيهِ ليسَ دفترَ مسؤوليّةٍ.
 */

/*
 * والحالةُ المقيسةُ تُستوردُ ولا تُكتبُ حرفاً: `"poisoned"` مكتوبةً هنا كانت
 * ستصيرُ مصدرَ حقيقةٍ ثالثاً (القاعدةُ · §4.23 · هذا)، وإعادةُ تسميةٍ يوماً كانت
 * ستتركُ أحدَها خارجَ الموكبِ بلا خطأِ ترجمةٍ.
 */
import { RELAY_POISONED_STATUS } from "./relay-dead-letters.js";

/* ════════════════════════════════════════════════════════════════════════
 * 1) حدودُ السببِ — نفسُ الأرقامِ في القاعدةِ حرفاً
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * `12 … 512` — والرقمانِ مكتوبانِ في قيدَي `CHECK` في الدفترَينِ
 * (`contracts/schema.sql` §7 و§10). وتكرارُهما هنا ليسَ مصدرَ حقيقةٍ ثانياً بل
 * **حرسُ حدٍّ**: القاعدةُ هيَ التي تُنفِّذُ، وهذهِ تُعطي المنادي 400 مفهوماً
 * بدلَ 500 من `23514`. والانحرافُ بينَهما يُسقِطُ اختباراً (`relay-acknowledgement`
 * يقيسُ الحدَّينِ، واختبارُ التكامُلِ يقيسُ القيدَ نفسَهُ على قاعدةٍ حقيقيّةٍ).
 */
export const RELAY_ACKNOWLEDGEMENT_REASON_MIN_LENGTH = 12;
export const RELAY_ACKNOWLEDGEMENT_REASON_MAX_LENGTH = 512;

/* ════════════════════════════════════════════════════════════════════════
 * 2) السببُ — تحقُّقٌ مُسبَّبٌ
 * ════════════════════════════════════════════════════════════════════════ */

export type RelayAcknowledgementReasonRejection =
  | "missing"
  | "not_a_string"
  | "too_short"
  | "too_long";

export type RelayAcknowledgementReasonResult =
  | { readonly reason: "accepted"; readonly value: string }
  | { readonly reason: "rejected"; readonly because: RelayAcknowledgementReasonRejection };

/**
 * يُقلِّمُ الفراغَ ثمَّ يقيسُ. والتقليمُ قبلَ القياسِ مقصودٌ: `"            "`
 * (اثنا عشرَ فراغاً) كانَ سيمرُّ على قياسِ طولٍ خامٍ وهوَ لا سببَ.
 *
 * **ولا يُقتَطَعُ الطويلُ بل يُرفَضُ**: سببٌ مقتطعٌ في دفترِ مسؤوليّةٍ يُقرأُ
 * جملةً تامّةً وهوَ نصفُ جملةٍ — سابقةُ `composeConflictAcknowledger` حرفاً.
 */
export function normalizeRelayAcknowledgementReason(
  raw: unknown,
): RelayAcknowledgementReasonResult {
  if (raw === undefined || raw === null) {
    return { reason: "rejected", because: "missing" };
  }
  if (typeof raw !== "string") {
    return { reason: "rejected", because: "not_a_string" };
  }
  const value = raw.trim();
  if (value.length < RELAY_ACKNOWLEDGEMENT_REASON_MIN_LENGTH) {
    return { reason: "rejected", because: "too_short" };
  }
  if (value.length > RELAY_ACKNOWLEDGEMENT_REASON_MAX_LENGTH) {
    return { reason: "rejected", because: "too_long" };
  }
  return { reason: "accepted", value };
}

/* ════════════════════════════════════════════════════════════════════════
 * 3) القرارُ — دالّةٌ نقيّةٌ على الحالةِ المقروءةِ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * أسبابُ الرفضِ — نفسُ تعدادِ §4.24 حرفاً، وذلكَ مقصودٌ: المُشغِّلُ الذي تعلَّمَ
 * الفرقَ بينَ «لا صفَّ» و«ليسَ مسموماً» في مسارِ الإعادةِ يقرؤُهُ هنا بالمعنى
 * نفسِهِ، ولا يتعلَّمُ قاموساً ثانياً لمسارٍ مجاورٍ.
 */
export type RelayAcknowledgementRejectionReason = "not_found" | "not_poisoned";

export interface RelayAcknowledgementRejected {
  readonly outcome: "rejected";
  readonly reason: RelayAcknowledgementRejectionReason;
  /** الحالةُ المقروءةُ فعلاً — `null` حينَ لا صفَّ. لا تُخمَّنُ ولا تُطوى. */
  readonly observedStatus: string | null;
}

export interface RelayAcknowledgementAccepted {
  readonly outcome: "acknowledged";
}

export interface RelayAcknowledgementAlready {
  readonly outcome: "already_acknowledged";
  /** إقرارُ الأوّلِ كما هوَ — يُنشَرُ ولا يُستبدَلُ. */
  readonly acknowledgedAt: string;
  readonly acknowledgedBy: string;
  readonly acknowledgementReason: string;
}

export type RelayAcknowledgementDecision =
  | RelayAcknowledgementAccepted
  | RelayAcknowledgementAlready
  | RelayAcknowledgementRejected;

/**
 * يُقرِّرُ من الحالةِ المقروءةِ والإقرارِ القائمِ وحدَهُما.
 *
 * ولمَ نقيّةٌ ومنفصلةٌ عن المُحوِّلِ؟ لنفسِ سببِ `decideRelayRequeue`: دفنُ
 * الشرطِ في `WHERE` كانَ سيجعلُ الرفضَ **صفراً من الصفوفِ المُعدَّلةِ**، ولا
 * يُفرَّقُ حينَها بينَ «لا صفَّ» و«صفٌّ ليسَ مسموماً» و«صفٌّ أُقِرَّ سلفاً» —
 * وهيَ ثلاثةُ أجوبةٍ مختلفةٍ لمُشغِّلٍ في حادثةٍ.
 */
export function decideRelayAcknowledgement(observed: {
  readonly status: string | null;
  readonly acknowledgedAt: string | null;
  readonly acknowledgedBy: string | null;
  readonly acknowledgementReason: string | null;
}): RelayAcknowledgementDecision {
  if (observed.status === null) {
    return { outcome: "rejected", reason: "not_found", observedStatus: null };
  }
  if (observed.status !== RELAY_POISONED_STATUS) {
    return { outcome: "rejected", reason: "not_poisoned", observedStatus: observed.status };
  }
  if (
    observed.acknowledgedAt !== null &&
    observed.acknowledgedBy !== null &&
    observed.acknowledgementReason !== null
  ) {
    return {
      outcome: "already_acknowledged",
      acknowledgedAt: observed.acknowledgedAt,
      acknowledgedBy: observed.acknowledgedBy,
      acknowledgementReason: observed.acknowledgementReason,
    };
  }
  return { outcome: "acknowledged" };
}
