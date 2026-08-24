/**
 * بصمةُ الطلب: **نفسُ المفتاح + نفسُ المُدخل = إعادة، ونفسُ المفتاح + مُدخلٌ آخر = تعارض**.
 *
 * ## لِمَ بصمةٌ ولا مقارنةُ الجسمِ كما هو
 *
 * لأنّ العمودَ يجب أن يبقى قصيراً وقابلاً للفهرسة، ولأنّ حفظَ جسمِ الطلبِ الأصليِّ يُخزّن
 * مُدخلاً قد يحمل مرجعَ دفعٍ ونصّاً لا نحتاجه بعد لحظتِه. وأربعٌ وستّون حرفاً سِتّةَ عشرَ
 * أساساً تُجيب عن السؤال الوحيد المطلوب: «هل هذا هو نفسُ الطلبِ الذي رأيتُه؟».
 *
 * ## ولِمَ ترتيبُ المفاتيح مفروضٌ هنا
 *
 * `JSON.stringify` يحفظ ترتيبَ الإدراج، فطلبان متساويان في المعنى (`{a,b}` و`{b,a}`) كانا
 * سيُنتجان بصمتَين مختلفتَين، فتُرفض إعادةُ إرسالٍ سليمةٍ بـ409 لأنّ عميلاً غيّر ترتيبَ
 * حقولِه بين محاولتَين. والترتيبُ يُفرض بالفرزِ في كلّ عُمق — وهو الفرقُ بين حارسٍ يحمي
 * وحارسٍ يُغضب المستعمل.
 *
 * ## وما لا يدخل البصمة
 *
 * لا ترويسات (فـ`x-request-id` يتغيّر في كلّ محاولةٍ بحكمِ تعريفه، ودخولُه كان سيجعل كلَّ
 * إعادةِ إرسالٍ «مُدخلاً آخر»)، ولا لحظةُ الوصول، ولا المفتاحُ نفسُه. جسمُ الطلبِ والمسارُ
 * وحدَهما — والمسارُ في عمودٍ منفصلٍ (`route_key`) لا في البصمة، لأنّ تعارضَ مفتاحٍ بين
 * مسارَين يجب أن يُقرأ من الصفّ بلا فكِّ تعمية.
 */

import { createHash } from "node:crypto";

import { REQUEST_HASH_LENGTH } from "../db/idempotency.js";

/**
 * تمثيلٌ ثابتٌ لأيّ قيمةٍ قابلةٍ للتحويل إلى JSON — المفاتيحُ مفروزةٌ في كلّ عُمق.
 *
 * `undefined` داخل كائنٍ يُحذف كما يفعل `JSON.stringify` بالضبط، فلا يصير حقلٌ غائبٌ
 * مختلفاً عن حقلٍ قيمتُه `undefined` — والاثنان لا يُفرَّق بينهما على السلك أصلاً.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`);
  return `{${entries.join(",")}}`;
}

/**
 * بصمةُ مُدخلٍ — sha256 سِتّةَ عشرَ أساساً، بطولٍ يُطابق حرسَ العمود.
 *
 * ولمَ sha256 ولا تعميةٌ أرخص؟ لأنّ تصادُماً هنا يعني أن يُعاد إلى عميلٍ **جوابُ طلبٍ آخر**
 * بمفتاحٍ صادَف تصادُماً — وهو أسوأُ عطلٍ ممكنٍ في هذا الجدول، وثمنُ التعميةِ لا يُقاس أمامه.
 */
export function fingerprint(value: unknown): string {
  const digest = createHash("sha256").update(canonical(value), "utf8").digest("hex");
  if (digest.length !== REQUEST_HASH_LENGTH) {
    throw new RangeError(`fingerprint must be ${REQUEST_HASH_LENGTH} characters`);
  }
  return digest;
}

/**
 * ## النطاق
 *
 * بصمةُ مُدخلٍ ثابتةٌ لجدولِ منعِ التكرار — لا قراءةَ ولا كتابةَ قاعدةٍ في هذا الملفّ.
 *
 * ## آخر تحديث
 *
 * المراجعة 5/6 — الملفُّ جديد.
 *
 * ## الحالة
 *
 * مُستعمَلٌ من `app/facts.ts` (بصمةُ حمولةِ الواقعة) ومن حدِّ HTTP لطلباتِ الكتابةِ الثلاثة.
 *
 * ## كودٌ ذو صلة
 *
 * `db/idempotency.ts` · `http/requests.ts` · `contracts/errors.md`.
 *
 * ## الفريق
 *
 * Platform / Subscriptions.
 */
