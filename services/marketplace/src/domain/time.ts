/**
 * الزمن: لحظةٌ مُمرَّرةٌ تُقارَن، لا ساعةٌ تُسأل.
 *
 * ADR-016 القرار 2، بسوابق ADR-011 و012 و013 و014 و015. وهذا الملفُّ أقصرُ من نظيرِه في خدمةِ
 * الاشتراكِ لسببٍ مُعلَن: **لا نبضةَ في السوق ولا انقضاءَ بالزمن**. الاعتمادُ قرارُ إنسانٍ لا
 * حادثةُ ساعة، فليس هنا `next_review_at` ولا `is_stale` ولا `tick`. ولو أُضيف مؤقّتٌ «تنبيهاً
 * للمراجعِ المتأخّر» لصار للنظامِ رأيٌ في ملفٍ لم يقرأه أحدٌ بعد، ثمّ يُعتمد أو يُرفض متجرٌ
 * بمرورِ الوقتِ لا بقرارٍ يحمل اسمَ فاعلٍ في الدفتر.
 *
 * فما بقيت الحاجةُ إليه هنا؟ **التحقّقُ والترتيبُ** فقط: أنّ `decided_at` لحظةٌ حقيقيّةٌ،
 * وأنّ لحظةً لا تسبق لحظةً في دفترٍ يُقرأ بالترتيب. ولا `Date.now()` في المجالِ بحال: دالّةُ
 * اشتقاقٍ تسأل الساعةَ تُعطي جوابَين في دقيقتَين، فتصير إعادةُ بناءِ العمودِ المُشتَقِّ من
 * الدفتر — وهي وعدُ القرار 1 — عمليّةً لا تُثبت شيئاً.
 *
 * ولماذا نصٌّ ISO لا `Date`؟ كما في كلّ خدمات وَصْلة: كائنُ `Date` قابلٌ للتغيير، ويحمل
 * منطقةً محليّةً لا يريدها المجال، ويُطبَع مختلفاً بين نسختَي Node.
 */

import { validationFailed } from "./errors.js";

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
 * هل `instant` عند `boundary` أو بعدها؟
 *
 * تُستعمَل في حرّاسِ الدفتر: قرارٌ لاحقٌ في الترتيبِ لا يجوز أن يكون زمنُه قبل زمنِ سابقه،
 * وإلّا صار للدفترِ ترتيبان — ترتيبُ `state_sequence` وترتيبُ `decided_at` — يقولان روايتَين
 * مختلفتَين لمن يقرأ سِجلَّ متجرٍ في تحقيقٍ إداريّ. والتساوي مقبولٌ: قرارٌ آليٌّ وقرارُ إنسانٍ
 * قد يقعان في نفسِ الميلي-ثانيةِ ولا معنى لرفضِ ذلك.
 */
export function isAtOrAfter(instant: string, boundary: string): boolean {
  return toEpochMillis(instant, "instant") >= toEpochMillis(boundary, "boundary");
}
