/**
 * السعر: عددٌ صحيحٌ بالهللاتِ وعُملةٌ ثابتة — **بيانٌ في الكتالوجِ لا حركةُ مال**.
 *
 * ADR-016 القرار 4. لا `NUMERIC` ولا `FLOAT` ولا كسرٌ عائمٌ بحال: `0.1 + 0.2` في الحسابِ
 * العائمِ ليس `0.3`، وسوقٌ يجمع أسعاراً عائمةً يُنتج فاتورةً تختلف عن جمعِ صاحبِها بهللةٍ ثمّ
 * لا يُقنعه شيء. والوحدةُ الصغرى (الهللة) تجعل كلَّ حسابٍ جمعاً وضرباً في أعدادٍ صحيحة.
 *
 * ## لماذا الحدُّ الأدنى 1 لا 0
 *
 * منتجٌ بسعرِ صفرٍ ليس مجّانيّاً بل **حقلٌ نُسي**. والمجّانيّةُ إن أُريدت قرارُ عرضٍ يُعلَن
 * (هديّةٌ · عيّنة) لا غيابُ رقمٍ يمرّ في التحقّق؛ ورقمُ صفرٍ يمرّ اليومَ يصير غداً منتجاً
 * ظاهراً في السوقِ بلا ثمنٍ لا يعرف أحدٌ أكان قصداً أم خطأً.
 *
 * ## ولماذا لا دالّةَ تنسيقٍ هنا
 *
 * عرضُ «29.50 ر.س» شأنُ الواجهةِ: للبوتِ لغاتٌ ثلاثٌ وأرقامٌ عربيّةٌ وهنديّة، ودالّةُ تنسيقٍ
 * في المجالِ تجعل نصَّ العرضِ قراراً محسوباً في الخدمةِ ثمّ يُنسخ إليه كلُّ مستهلكٍ لغتَه.
 * المجالُ يحرس **العددَ**، والعرضُ يحرس الإنسان.
 */

import {
  MARKETPLACE_CURRENCY_CODE,
  PRICE_MINOR_UNITS_MAX,
  PRICE_MINOR_UNITS_MIN,
} from "./contract-sets.js";
import { validationFailed } from "./errors.js";

/**
 * سعرٌ مقبول: عددٌ صحيحٌ بالهللاتِ داخلَ الحدَّين المُعلَنَين في العقد.
 *
 * `Number.isSafeInteger` يرفض `29.5` صريحاً؛ والرفضُ لا التقريب: تقريبٌ صامتٌ يجعل تاجراً
 * يكتب سعراً ويرى في السوقِ سعراً آخر، وهو أسوأُ من رسالةِ خطأٍ يفهمها.
 */
export function assertPriceMinorUnits(value: unknown, field = "price_minor_units"): number {
  if (!Number.isSafeInteger(value)) {
    throw validationFailed(field, "integer amount in halalas (no fractions)");
  }
  const price = value as number;
  if (price < PRICE_MINOR_UNITS_MIN || price > PRICE_MINOR_UNITS_MAX) {
    throw validationFailed(field, `integer between ${PRICE_MINOR_UNITS_MIN} and ${PRICE_MINOR_UNITS_MAX}`);
  }
  return price;
}

/**
 * العُملةُ الوحيدةُ في هذا الطور. تُفحَص ولا تُفترَض: مستهلكٌ يرسل `USD` يجب أن يُرفَض برمزٍ
 * يُقرأ، لا أن يُكتب سعرٌ بعُملةٍ يظنّها المرسلُ دولاراً ويقرأها السوقُ ريالاً.
 */
export function assertCurrencyCode(value: unknown, field = "currency_code"): typeof MARKETPLACE_CURRENCY_CODE {
  if (value !== MARKETPLACE_CURRENCY_CODE) {
    throw validationFailed(field, MARKETPLACE_CURRENCY_CODE);
  }
  return MARKETPLACE_CURRENCY_CODE;
}
