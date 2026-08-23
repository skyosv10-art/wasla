/**
 * الزمن: لحظةٌ مُمرَّرة تُقارَن، لا ساعةٌ تُسأل.
 *
 * ADR-014 القرار 8، بسوابق ADR-011 القرار 3 وADR-012 القرار 5 وADR-013 القرار 5. لا
 * شيء في هذه الخدمة يُجدول شيئاً ولا يُنام: لا `setTimeout` ولا `sleep` ولا
 * `Date.now()` في المجال بحال. اللحظةُ تدخل من الحاقن (`Clock`) وتُمرَّر إلى كل دالّةٍ
 * تحتاجها، وهذا وحده ما يجعل حسابَ نتيجةٍ **دالّةً نقيّة**: نفس الدفتر ونفس نسخة
 * القواعد ونفس اللحظة ⇒ نفس النتيجة، دائماً وفي أي جهاز.
 *
 * ولذلك أيضاً تُمرَّر اللحظة إلى `decayFactor` ولا تُقرأ داخله. دالّةُ تلاشٍ تسأل الساعة
 * بنفسها تُعطي جوابين في دقيقتين، فتُصبح `recompute` عمليةً لا تُثبت شيئاً: تُشغّلها
 * مرّتين فتحصل على رقمين، ولا تعرف أيّهما الخطأ.
 *
 * ## لماذا نصٌّ ISO ولا `Date`
 *
 * كل خدمات وَصْلة تُمرّر زمن الساعة نصّاً ISO-8601. كائنُ `Date` قابلٌ للتغيير، ويحمل
 * منطقةً محلّية لا يريدها المجال، ويُطبَع مختلفاً بين نسختَي Node. المقارنةُ هنا تُحوّل
 * إلى ميلي-ثانيةٍ من الحقبة وتُقارن أرقاماً.
 */

import { validationFailed } from "./errors.js";
import type { FraudWindow } from "./model.js";

const MILLIS_PER_HOUR = 3_600_000;
const MILLIS_PER_DAY = 86_400_000;

/** تحويلٌ إلى ميلي-ثانيةٍ من الحقبة، برفضِ كل ما ليس لحظةً حقيقية. */
export function toEpochMillis(iso: string, field = "timestamp"): number {
  const millis = Date.parse(iso);
  if (Number.isNaN(millis)) throw validationFailed(field, "ISO-8601 timestamp");
  return millis;
}

export function assertTimestamp(value: unknown, field = "timestamp"): string {
  if (typeof value !== "string") throw validationFailed(field, "ISO-8601 timestamp");
  toEpochMillis(value, field);
  return value;
}

/**
 * هل مضى `dueAt` عند `now`؟
 *
 * الحدّ داخلٌ في المضيّ: استحقاقٌ يساوي `now` بالضبط **قد** مضى. البديل يترك نافذةً
 * بميلي-ثانيةٍ واحدة يكون فيها الشيء متجاوزاً موعده ومقبولاً في الوقت نفسه، ويُلزم كلّ
 * قارئٍ للكود بأن يُعيد استنباط أيّ طرفٍ من المقارنة انتصر.
 */
export function isDue(dueAt: string, now: string): boolean {
  return toEpochMillis(dueAt, "due_at") <= toEpochMillis(now, "now");
}

export function addHours(instant: string, hours: number): string {
  if (!Number.isSafeInteger(hours) || hours < 0) {
    throw validationFailed("hours", "non-negative integer");
  }
  return new Date(toEpochMillis(instant, "instant") + hours * MILLIS_PER_HOUR).toISOString();
}

export function addDays(instant: string, days: number): string {
  if (!Number.isSafeInteger(days) || days < 0) {
    throw validationFailed("days", "non-negative integer");
  }
  return new Date(toEpochMillis(instant, "instant") + days * MILLIS_PER_DAY).toISOString();
}

/** فرقٌ بالأيام كعددٍ عاشريّ، من الأقدم إلى الأحدث. سالبٌ إن كان `later` قبل `earlier`. */
export function daysBetween(earlier: string, later: string): number {
  return (toEpochMillis(later, "later") - toEpochMillis(earlier, "earlier")) / MILLIS_PER_DAY;
}

/**
 * معامل التلاشي لواقعةٍ عمرُها `ageDays` بنصف عمرٍ `halfLifeDays`: \(2^{-age/halfLife}\).
 *
 * ## لماذا يُحسب على الواقعة لا على النتيجة
 *
 * الطريق الأرخص كان ضربَ نتيجةِ الأمس في «معامل نسيان» كل نبضة. وهو خطأٌ لسببين لا
 * يظهران في اختبارٍ بسيط:
 *
 *   1. **يجعل النتيجة تابعةً لعدد المرّات التي ركضت فيها النبضة**، لا للزمن. نبضةٌ
 *      تعطّلت يومين تُنتج رقماً أعلى من نبضةٍ صحيحة، ونبضةٌ ركضت مرّتين بالخطأ تُنتج
 *      رقماً أدنى. فتُصبح السمعة قياساً لصحّة خادمنا لا لسلوك الشخص.
 *   2. **يُلغي إمكان إعادة البناء.** حذفُ جدول النتائج و`recompute` لا يُعيد الرقم كما
 *      كان، لأنّ الرقم كان حصيلةَ سلسلةِ ضرباتٍ لا أحدَ يعرف طولها. وبذلك يصير الجدولُ
 *      المشتقُّ مصدرَ حقيقةٍ ثانياً، وهو بعينه ما يمنعه ADR-014 القرار 3.
 *
 * فالتلاشي هنا **مجموعٌ على وقائع مؤرّخة**: كل واقعةٍ تُوزَن بعمرها لحظةَ الحساب، ولا
 * أثرَ لنتيجةٍ سابقة في الحساب بحال.
 *
 * ## عمرٌ سالب
 *
 * واقعةٌ مؤرَّخة في المستقبل (ساعةُ منتجٍ منحرفة) عمرُها سالب، و\(2^{+x}\) كان
 * سيُضخّم وزنها. تُقصَر إلى الصفر: وزنٌ كاملٌ لا مُضخَّم. تضخيمٌ كهذا يجعل ساعةً منحرفة
 * على خادمٍ واحد وسيلةَ ترقيةٍ لسمعةٍ ما.
 */
export function decayFactor(ageDays: number, halfLifeDays: number): number {
  if (!Number.isFinite(ageDays)) throw validationFailed("ageDays", "finite number");
  if (!Number.isSafeInteger(halfLifeDays) || halfLifeDays < 1) {
    throw validationFailed("halfLifeDays", "positive integer");
  }
  const age = ageDays < 0 ? 0 : ageDays;
  return Math.pow(2, -age / halfLifeDays);
}

/** بداية اليوم بتوقيت UTC للحظةٍ. */
export function startOfUtcDay(instant: string): string {
  const millis = toEpochMillis(instant, "instant");
  return new Date(millis - (((millis % MILLIS_PER_DAY) + MILLIS_PER_DAY) % MILLIS_PER_DAY))
    .toISOString();
}

/**
 * نافذةُ رصدِ الاحتيال: حدّاها **محسوبان** من اللحظة ومن نسخة القواعد.
 *
 * `endedAt` = منتصفُ ليلِ UTC **التالي** للحظة، و`startedAt` = `endedAt` ناقص
 * `fraudWindowDays`. فالنافذة سلّةٌ يوميةٌ مُغلقة الحدّين حساباً، ولذلك:
 *
 *   - **النبضة تُعاد بلا تكرار.** كل نبضاتِ اليوم الواحد تُنتج `windowEndedAt` واحداً
 *     بعينه، فيمنع `ux_fraud_signals_rule_window` الإشارة الثانية بلا أن تحتاج النبضةُ
 *     أن تتذكّر متى ركضت آخر مرّة. ولو كان الحدّ هو «الآن» لكان لكل نبضةٍ نافذةٌ
 *     مختلفةٌ بميلي-ثانية، فيُنتج تشغيلُها كل ساعةٍ أربعاً وعشرين إشارةً لنفس السلوك.
 *   - **الحدّ مُشتقٌّ من الزمن لا من صحّة الخادم.** نبضةٌ فاتت يوماً ثم ركضت تُنتج نافذةَ
 *     يومِها هي، فلا تُعيد فتحَ نافذةٍ مضت ولا تخترع واحدةً لم تبدأ.
 *   - **وقائعُ اليوم داخلة.** ولو كان `endedAt` بدايةَ اليوم لخرج سلوكُ اليوم من الرصد،
 *     فيُكتشَف نمطُ اليوم غداً في أحسن الأحوال.
 *
 * والحدّ `endedAt` **حصريّ**: `[startedAt, endedAt)`. واقعةٌ وقعت في منتصف الليل
 * بالضبط تنتمي إلى نافذةِ يومها هي لا إلى يومين.
 */
export function fraudWindowFor(instant: string, fraudWindowDays: number): FraudWindow {
  if (!Number.isSafeInteger(fraudWindowDays) || fraudWindowDays < 1) {
    throw validationFailed("fraudWindowDays", "positive integer");
  }
  const endedAt = addDays(startOfUtcDay(instant), 1);
  const startedAt = new Date(
    toEpochMillis(endedAt, "window_ended_at") - fraudWindowDays * MILLIS_PER_DAY,
  ).toISOString();
  return { startedAt, endedAt };
}

/** هل تقع اللحظة في `[startedAt, endedAt)`؟ */
export function withinWindow(instant: string, window: FraudWindow): boolean {
  const at = toEpochMillis(instant, "occurred_at");
  return (
    at >= toEpochMillis(window.startedAt, "window_started_at") &&
    at < toEpochMillis(window.endedAt, "window_ended_at")
  );
}
