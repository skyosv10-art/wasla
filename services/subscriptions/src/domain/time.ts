/**
 * الزمن: لحظةٌ مُمرَّرةٌ تُقارَن، لا ساعةٌ تُسأل.
 *
 * ADR-015 القرار 5، بسوابق ADR-011 القرار 3 وADR-012 القرار 5 وADR-013 القرار 5 وADR-014
 * القرار 8. لا شيءَ في هذه الخدمة يُجدول شيئاً ولا يُنام: لا `setTimeout` ولا `setInterval`
 * ولا `sleep` ولا `Date.now()` في المجال بحال. اللحظةُ تدخل من الحاقن (`Clock`) وتُمرَّر إلى
 * كلّ دالّةٍ تحتاجها، وهذا وحده ما يجعل اشتقاقَ الحالة **دالّةً نقيّة**: نفسُ الدفتر ونفسُ
 * نسخةِ الخطّة ونفسُ اللحظة ⇒ نفسُ الحالة، دائماً وفي أيّ جهاز.
 *
 * ولذلك أيضاً لا تُقرأ الساعةُ داخل `deriveState`. دالّةُ اشتقاقٍ تسأل الساعةَ بنفسها تُعطي
 * جوابَين في دقيقتَين، فتُصبح `POST /subscriptions/{id}/recompute` عمليةً لا تُثبت شيئاً:
 * تُشغّلها مرّتَين فتحصل على حالتَين ولا تعرف أيَّهما الخطأ. والنبضةُ (`POST /subscriptions/tick`)
 * هي **الزمنُ المُعلَن** في هذه الخدمة: لا مؤقّتَ داخليّاً يجعل انقضاءَ الاشتراك حادثةً لا
 * أحدَ طلبَها ولا أحدَ يستطيع إعادةَ تشغيلها.
 *
 * ## لماذا نصٌّ ISO ولا `Date`
 *
 * كلُّ خدمات وَصْلة تُمرّر زمنَ الساعة نصّاً ISO-8601. كائنُ `Date` قابلٌ للتغيير، ويحمل
 * منطقةً محلّيةً لا يريدها المجال، ويُطبَع مختلفاً بين نسختَي Node. المقارنةُ هنا تُحوّل إلى
 * ميلي-ثانيةٍ من الحقبة وتُقارن أرقاماً.
 *
 * ## لماذا `addDays` بميلي-ثانية اليوم لا بحسابٍ تقويميّ
 *
 * «ثلاثون يوماً» في هذا المجال **ثلاثون فترةً من أربعٍ وعشرين ساعة**، لا «نفسُ يومِ الشهر
 * القادم». الحسابُ التقويميُّ يفتح سؤالاً لا جوابَ له: مدةٌ تبدأ في 31 يناير وتنتهي في «31
 * فبراير»؟ وحسابٌ يقول «الشهرَ القادم» يجعل مدّةَ فبراير أقصرَ من مدّةِ يناير بيومَين
 * فيدفع سائقان نفسَ المبلغ ويأخذ أحدهما أقلّ. والسعوديةُ بلا توقيتٍ صيفيّ، فلا فرقَ
 * عملياً؛ ومع ذلك الحسابُ بالميلي-ثانية هو الوحيدُ الذي يبقى صحيحاً لو تغيّر ذلك.
 */

import { validationFailed } from "./errors.js";

const MILLIS_PER_DAY = 86_400_000;

/** تحويلٌ إلى ميلي-ثانيةٍ من الحقبة، برفضِ كلّ ما ليس لحظةً حقيقية. */
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
 * إضافةُ أيامٍ إلى لحظة. صفرٌ مقبولٌ (خطّةٌ بلا تجربة، أو مهلةٌ بلا تأجيل) والسالبُ مرفوض:
 * مدةٌ سالبةٌ تنتهي قبل أن تبدأ فتجعل التغطيةَ فارغةً بلا سببٍ يُقرأ.
 */
export function addDays(instant: string, days: number): string {
  if (!Number.isSafeInteger(days) || days < 0) {
    throw validationFailed("days", "non-negative integer");
  }
  return new Date(toEpochMillis(instant, "instant") + days * MILLIS_PER_DAY).toISOString();
}

/**
 * هل `instant` قبل `boundary` تماماً؟
 *
 * **الحدُّ خارجٌ من المدة**: مدةٌ تنتهي في `T` لا تُغطّي `T` نفسَها. لماذا نصفُ مفتوحٍ
 * `[starts_at, ends_at)`؟ لأنّ البديلَ يجعل لحظةَ التسليم مملوكةً لمدّتَين في وقتٍ واحد:
 * مدةُ التجربةِ تنتهي في `T` والمدةُ المدفوعةُ تبدأ في `T`، فإن كان الحدُّ داخلاً في
 * الاثنتَين صار للسائق تغطيتان في نفس الميلي-ثانية، ويقرّر ترتيبُ الفرزِ — لا القاعدةُ —
 * أيَّهما تُسمّي حالتَه. ونصفُ المفتوح يجعل السلسلةَ متلاصقةً بلا فراغٍ وبلا تقاطع.
 */
export function isBefore(instant: string, boundary: string): boolean {
  return toEpochMillis(instant, "instant") < toEpochMillis(boundary, "boundary");
}

/** هل `instant` عند `boundary` أو بعدها؟ نقيضُ `isBefore` بحرفه، فلا حدَّ يسقط بين الاثنتَين. */
export function isAtOrAfter(instant: string, boundary: string): boolean {
  return !isBefore(instant, boundary);
}

/** الأبعدُ من لحظتَين. تُستعمل ليبدأ الامتدادُ من نهاية التغطية لا من الآن (القرار 9). */
export function laterOf(first: string, second: string): string {
  return toEpochMillis(first, "first") >= toEpochMillis(second, "second") ? first : second;
}

/**
 * ساعةٌ محقونة. الحاقنُ الحقيقيُّ يقيم في طبقة HTTP/الأمر (المراجعة 4/6) ولا يعبر إلى
 * المجال: كلُّ ما يعبر هو النصُّ الذي أعادته.
 */
export interface Clock {
  now(): string;
}

/**
 * ساعةٌ ثابتةٌ للاختبار وللنبضةِ الواحدة.
 *
 * حتى النبضةُ الواحدةُ تستعمل لحظةً واحدةً مُثبَّتة: نبضةٌ تسأل الساعةَ لكلّ سائقٍ تُنتج
 * دفعةً غيرَ متجانسةٍ يكون فيها سائقٌ «انقضى» وآخرُ «لم ينقضِ» بفرق ميلي-ثانيةٍ لا معنى له،
 * ولا يمكن إعادةُ حسابِ الدفعة بعد ذلك لتفسيرِ ما جرى.
 */
export function fixedClock(instant: string): Clock {
  const pinned = assertTimestamp(instant, "now");
  return { now: () => pinned };
}
