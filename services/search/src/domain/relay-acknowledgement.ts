/**
 * إقرارُ صفٍّ مسمومٍ في مُرحِّلِ البحثِ — القرارُ وحدَهُ
 * (فجوةُ `G5` · موجةُ المحضرِ · `CLM-0249` · سابقةُ ADR-026 §4.27 حرفاً).
 *
 * ## الدَّينُ الذي يرفعُهُ هذا الملفُّ
 *
 * موجةُ العينِ (`CLM-0247`) أعطت المُشغِّلَ **قياساً** للفقدِ، وموجةُ اليدِ
 * (`CLM-0248`) أعطتهُ **إعادةً**. وبقيَ بابٌ ثالثٌ: صفٌّ مسمومٌ **لا يُعادُ ولا
 * يُنسى** — حدثُ سوقٍ بنسخةٍ لا يعرفُها البحثُ، إعادتُهُ تُسَمِّمُهُ ثانيةً
 * بالسببِ نفسِهِ، وتركُهُ يُبقي `warning` قائماً بلا نهايةٍ (العتبةُ `1`).
 *
 * و«تحذيرٌ إلى الأبدِ» ليسَ حالةً محايدةً: هوَ الطريقُ المقيسُ إلى **تصميتِ
 * التنبيهِ**، وبعدَ التصميتِ لا يُرى المسمومُ **الجديدُ** أيضاً. ومقياسٌ لا
 * يستطيعُ العودةَ إلى الأخضرِ إلّا بمحوِ صفٍّ **يدفعُ نحوَ محوِ الدليلِ**، وهوَ
 * ما تمنعُهُ قواعدُ هذا المستودعِ نصّاً.
 *
 * ## والمخرجُ: إقرارٌ **يُضيفُ** ولا يمحو
 *
 * الصفُّ يبقى بحرفِهِ: `status = 'poisoned'` و`attempt_count` و`last_error`
 * و`consumed_at` لا يمسُّها الإقرارُ. ويُضافُ إليهِ ثلاثيٌّ: **متى** و**مَن**
 * و**لماذا**. و`total_poisoned` يبقى منشوراً كما هوَ؛ المُستثنى من **الحكمِ**
 * وحدَهُ (`total_unacknowledged_poisoned`).
 *
 * و`consumed_at` خاصّةً لا يُلمَسُ: هوَ **مقياسُ العمرِ** في هذا الدفترِ (لا
 * `updated_at` فيهِ)، وتحريكُهُ عندَ الإقرارِ كانَ سيُقصِّرُ عمرَ فقدٍ لم
 * يُحَلَّ — أي يُخفِّفُ الحكمَ بفعلٍ إداريٍّ.
 *
 * ## وثلاثةُ حدودٍ تمنعُ أن يصيرَ زرَّ إسكاتٍ
 *
 * **(أ) لا إقرارَ جماعيَّ.** صفٌّ صفٌّ بمُعرِّفِهِ — سابقةُ موجةِ الإعادةِ
 * حرفاً. ونداءٌ يُقِرُّ «كلَّ المسمومِ» كانَ سيجعلُ الإقرارَ أرخصَ من القراءةِ،
 * وما يَرخُصُ يُستعمَلُ بلا نظرٍ.
 *
 * **(ب) لا إقرارَ بلا سببٍ**، وحدُّهُ الأدنى **اثنا عشرَ حرفاً** لا حرفٌ: سببٌ
 * من حرفٍ (`x`) يُرضي مُدقِّقاً شكليّاً ولا يُفيدُ قارئَ تحقيقٍ بعدَ شهرٍ.
 * والحدُّ مفروضٌ **في القاعدةِ** أيضاً لا في الشيفرةِ وحدَها.
 *
 * **(ج) والمُقِرُّ من الهويّةِ المُثبَتةِ لا من الجسمِ**: مَن يكتبُ اسمَهُ في
 * جسمٍ لم يُقِرَّ شيئاً بل وقَّعَ بقلمٍ لا يملكُهُ.
 *
 * ## وإعادةٌ بعدَ إقرارٍ تمحو الإقرارَ — **في القاعدةِ**
 *
 * القيدُ `ck_search_relay_consumed_events_ack_poisoned_only` يرفضُ صفّاً غيرَ
 * مسمومٍ يحملُ إقراراً، فإعادةُ الصفِّ إلى `pending` **توجِبُ** محوَ الثلاثيِّ
 * وإلّا سقطت المعاملةُ بـ`23514`. فالحكمُ «عُولِجَ» لا يَعبُرُ إلى حياةٍ ثانيةٍ
 * للصفِّ بسهوٍ في شيفرةٍ — القاعدةُ تمنعُهُ، وهذا مُثبَتٌ باختبارِ تكامُلٍ على
 * قاعدةٍ حقيقيّةٍ لا مُدَّعىً في تعليقٍ.
 *
 * ## والإقرارُ الثاني لا يكتبُ فوقَ الأوّلِ
 *
 * يُعادُ `already_acknowledged` بإقرارِ الأوّلِ كما هوَ، ولا يُستبدَلُ المُقِرُّ
 * الأوّلُ ولا سببُهُ. ودفترُ مسؤوليّةٍ يُكتَبُ فوقَ أوّلِ شاهدٍ فيهِ ليسَ دفترَ
 * مسؤوليّةٍ.
 */

/*
 * والحالةُ المقيسةُ تُستوردُ ولا تُكتبُ حرفاً: `"poisoned"` مكتوبةً هنا كانت
 * ستصيرُ مصدرَ حقيقةٍ ثالثاً (القاعدةُ · موجةُ العينِ · هذا)، وإعادةُ تسميةٍ
 * يوماً كانت ستتركُ أحدَها خارجَ الموكبِ بلا خطأِ ترجمةٍ.
 */
import { SEARCH_POISONED_STATUS } from "./relay-dead-letters.js";

/* ════════════════════════════════════════════════════════════════════════
 * 1) حدودُ السببِ — نفسُ الأرقامِ في القاعدةِ حرفاً
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * `12 … 512` — والرقمانِ مكتوبانِ في قيدَي `CHECK` في
 * `services/search/contracts/schema.sql` §5. وتكرارُهما هنا ليسَ مصدرَ حقيقةٍ
 * ثانياً بل **حرسُ حدٍّ**: القاعدةُ هيَ التي تُنفِّذُ، وهذهِ تُعطي المنادي 400
 * مفهوماً بدلَ 500 من `23514`. والانحرافُ بينَهما يُسقِطُ اختباراً (الوحدةُ
 * تقيسُ الحدَّينِ، والتكامُلُ يقيسُ القيدَ نفسَهُ على قاعدةٍ حقيقيّةٍ).
 *
 * والأرقامُ هيَ أرقامُ دفترِ التوصيلِ حرفاً: حدّانِ مختلفانِ لسببٍ واحدٍ في
 * منظومةٍ واحدةٍ كانا سيجعلانِ المُشغِّلَ يحفظُ جدولاً لا قاعدةً.
 */
export const SEARCH_ACKNOWLEDGEMENT_REASON_MIN_LENGTH = 12;
export const SEARCH_ACKNOWLEDGEMENT_REASON_MAX_LENGTH = 512;

/**
 * حدُّ اسمِ المُقِرِّ — `128`، وهوَ رقمُ `..._ack_by_check` في القاعدةِ حرفاً.
 */
export const SEARCH_ACKNOWLEDGER_MAX_LENGTH = 128;

/* ════════════════════════════════════════════════════════════════════════
 * 2) السببُ — تحقُّقٌ مُسبَّبٌ
 * ════════════════════════════════════════════════════════════════════════ */

export type SearchAcknowledgementReasonRejection =
  | "missing"
  | "not_a_string"
  | "too_short"
  | "too_long";

export type SearchAcknowledgementReasonResult =
  | { readonly reason: "accepted"; readonly value: string }
  | { readonly reason: "rejected"; readonly because: SearchAcknowledgementReasonRejection };

/**
 * يُقلِّمُ الفراغَ ثمَّ يقيسُ. والتقليمُ قبلَ القياسِ مقصودٌ: `"            "`
 * (اثنا عشرَ فراغاً) كانَ سيمرُّ على قياسِ طولٍ خامٍ وهوَ لا سببَ.
 *
 * **ولا يُقتَطَعُ الطويلُ بل يُرفَضُ**: سببٌ مقتطعٌ في دفترِ مسؤوليّةٍ يُقرأُ
 * جملةً تامّةً وهوَ نصفُ جملةٍ.
 */
export function normalizeSearchAcknowledgementReason(
  raw: unknown,
): SearchAcknowledgementReasonResult {
  if (raw === undefined || raw === null) {
    return { reason: "rejected", because: "missing" };
  }
  if (typeof raw !== "string") {
    return { reason: "rejected", because: "not_a_string" };
  }
  const value = raw.trim();
  if (value.length < SEARCH_ACKNOWLEDGEMENT_REASON_MIN_LENGTH) {
    return { reason: "rejected", because: "too_short" };
  }
  if (value.length > SEARCH_ACKNOWLEDGEMENT_REASON_MAX_LENGTH) {
    return { reason: "rejected", because: "too_long" };
  }
  return { reason: "accepted", value };
}

/* ════════════════════════════════════════════════════════════════════════
 * 3) اسمُ المُقِرِّ — يُركَّبُ من الهويّةِ المُثبَتةِ وحدَها
 * ════════════════════════════════════════════════════════════════════════ */

export type SearchAcknowledgerRejection = "empty_service_name" | "too_long";

export type SearchAcknowledgerResult =
  | { readonly acknowledger: "composed"; readonly value: string }
  | { readonly acknowledger: "rejected"; readonly because: SearchAcknowledgerRejection };

/**
 * يُركِّبُ نصَّ `acknowledged_by` من **الهويّةِ المُثبَتةِ وحدَها**، بالصيغةِ
 * `service:<name>[/on-behalf-of:<publicId>]`.
 *
 * ## ولمَ صيغةٌ ثانيةٌ ولا تُستوردُ صيغةُ التوصيلِ؟
 *
 * لأنَّ الخدمتَينِ حدّانِ مستقلّانِ لا يستوردُ أحدُهما مجالَ الآخرِ (ADR-001)،
 * وحزمةٌ مشتركةٌ لسطرَينِ كانت ستُنشِئَ تبعيّةً بينَ حدَّينِ لأجلِ نصٍّ. والصيغةُ
 * **محفوظةٌ حرفاً** لأنَّ الحفظَ هوَ الغرضُ: تحقيقٌ واحدٌ يقرأُ دفترَي
 * مسؤوليّةٍ (مسمومُ التوصيلِ ومسمومُ البحثِ) بقاموسٍ واحدٍ، والانحرافُ يُسقِطُ
 * اختباراً يقيسُ النصَّ المُركَّبَ حرفاً.
 *
 * والسابقةُ `service:` مقصودةٌ: صفٌّ يقولُ `ops-console` وحدَهُ لا يُفرَّقُ عن
 * إقرارٍ يدويٍّ على القاعدةِ كُتِبَ باسمِ إنسانٍ.
 *
 * والطولُ يُرفَضُ ولا يُقتَطَعُ: هويّةٌ مقتطعةٌ في دفترِ مسؤوليّةٍ كذبةٌ صغيرةٌ
 * تُقرأُ حقيقةً.
 */
export function composeSearchAcknowledger(identity: {
  readonly serviceName: string;
  readonly onBehalfOfPublicId?: string | undefined;
}): SearchAcknowledgerResult {
  const serviceName = identity.serviceName.trim();
  if (serviceName === "") {
    return { acknowledger: "rejected", because: "empty_service_name" };
  }

  const onBehalfOf = identity.onBehalfOfPublicId?.trim() ?? "";
  const value =
    onBehalfOf === ""
      ? `service:${serviceName}`
      : `service:${serviceName}/on-behalf-of:${onBehalfOf}`;

  if (value.length > SEARCH_ACKNOWLEDGER_MAX_LENGTH) {
    return { acknowledger: "rejected", because: "too_long" };
  }

  return { acknowledger: "composed", value };
}

/* ════════════════════════════════════════════════════════════════════════
 * 4) القرارُ — دالّةٌ نقيّةٌ على الحالةِ المقروءةِ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * أسبابُ الرفضِ — نفسُ تعدادِ موجةِ الإعادةِ حرفاً، وذلكَ مقصودٌ: المُشغِّلُ
 * الذي تعلَّمَ الفرقَ بينَ «لا صفَّ» و«ليسَ مسموماً» هناكَ يقرؤُهُ هنا بالمعنى
 * نفسِهِ، ولا يتعلَّمُ قاموساً ثانياً لمسارٍ مجاورٍ.
 */
export type SearchAcknowledgementRejectionReason = "not_found" | "not_poisoned";

export interface SearchAcknowledgementRejected {
  readonly outcome: "rejected";
  readonly reason: SearchAcknowledgementRejectionReason;
  /** الحالةُ المقروءةُ فعلاً — `null` حينَ لا صفَّ. لا تُخمَّنُ ولا تُطوى. */
  readonly observedStatus: string | null;
}

export interface SearchAcknowledgementAccepted {
  readonly outcome: "acknowledged";
}

export interface SearchAcknowledgementAlready {
  readonly outcome: "already_acknowledged";
  /** إقرارُ الأوّلِ كما هوَ — يُنشَرُ ولا يُستبدَلُ. */
  readonly acknowledgedAt: string;
  readonly acknowledgedBy: string;
  readonly acknowledgementReason: string;
}

export type SearchAcknowledgementDecision =
  | SearchAcknowledgementAccepted
  | SearchAcknowledgementAlready
  | SearchAcknowledgementRejected;

/**
 * يُقرِّرُ من الحالةِ المقروءةِ والإقرارِ القائمِ وحدَهُما.
 *
 * ولمَ نقيّةٌ ومنفصلةٌ عن المُحوِّلِ؟ لنفسِ سببِ `decideSearchRequeue`: دفنُ
 * الشرطِ في `WHERE` كانَ سيجعلُ الرفضَ **صفراً من الصفوفِ المُعدَّلةِ**، ولا
 * يُفرَّقُ حينَها بينَ «لا صفَّ» و«صفٌّ ليسَ مسموماً» و«صفٌّ أُقِرَّ سلفاً» —
 * وهيَ ثلاثةُ أجوبةٍ مختلفةٍ لمُشغِّلٍ في حادثةٍ.
 */
export function decideSearchAcknowledgement(observed: {
  readonly status: string | null;
  readonly acknowledgedAt: string | null;
  readonly acknowledgedBy: string | null;
  readonly acknowledgementReason: string | null;
}): SearchAcknowledgementDecision {
  if (observed.status === null) {
    return { outcome: "rejected", reason: "not_found", observedStatus: null };
  }
  if (observed.status !== SEARCH_POISONED_STATUS) {
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
