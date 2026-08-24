/**
 * الظهور: اقترانُ أربعةِ شروطٍ يُشتَقُّ عند القراءة، ولكلِّ شرطٍ رمزُه.
 *
 * ADR-016 القرار 3. الدالّةُ الجامعةُ `isProductVisible` تقيم في **حزمةِ العقدِ** لا هنا، لأنّ
 * مستهلكاً آخرَ (بحثُ الطور 12 · بوتُ العميل) يحتاج نفسَ الشرطِ حرفاً؛ ولو كتب كلٌّ منهم فرعَه
 * لظهر منتجٌ في نتيجةِ بحثٍ واختفى عند فتحه. وهذا الملفُّ يُضيف ما لا مكانَ له في العقد:
 * **تحويلَ «غيرُ ظاهر» إلى سببٍ يُقرأ**.
 *
 * ## لماذا قائمةُ عوائقَ لا `boolean` وحدَه
 *
 * لأنّ `false` لا يقول ماذا يُصلح. صاحبُ متجرٍ يسأل «لِمَ منتجي لا يظهر؟» والجوابُ قد يكون:
 * متجرُك لم يُعتمد بعد · منتجُك لم يجتز الاعتدال · لم تنشره · مخزونُك صفر. أربعةُ أعمالٍ
 * مختلفةٍ تماماً، ورمزٌ واحدٌ جامعٌ (`PRODUCT_NOT_VISIBLE` — وهو غيرُ موجودٍ في الكتالوجِ عن
 * قصد) يجعله يُصلح ما ليس مكسوراً ثمّ يفتح تذكرةَ دعمٍ لا تُغلَق.
 *
 * ولذلك تُعاد **كلُّ** العوائقِ لا أوّلُها فقط في `productVisibilityBlockers`: منتجٌ في متجرٍ
 * موقوفٍ وبمخزونٍ صفرٍ ينقصه عملان، ومن أُخبِر بواحدٍ فقط يُصلحه ثمّ يعود ليجد نفسَ الجدارِ.
 * وأمّا `assertProductVisible` فترمي الأوّلَ بترتيبٍ مُعلَنٍ ثابتٍ لأنّ استجابةَ HTTP تحمل رمزاً
 * واحداً؛ والترتيبُ من الأعمِّ إلى الأخصّ — متجرٌ ثمّ اعتدالٌ ثمّ نشرٌ ثمّ مخزون — كي يُذكَر
 * أوّلاً ما لا يستطيع صاحبُ المتجرِ تجاوزَه بنفسه.
 *
 * ## ولماذا لا يُخزَّن الظهورُ ولا يُنشَر
 *
 * النسخةُ الخاطئةُ الأرخص: عمودٌ `is_visible` يُحدَّث بمُشغِّل. فيصير إيقافُ متجرٍ واحدٍ كتابةً
 * على كلِّ منتجاتِه، وأوّلُ فشلٍ في المنتصفِ يترك سوقاً نصفَ ظاهرٍ لا أحدَ يعرف أيُّ نصفٍ صحيح.
 * ولا حادثةَ `product.visibility_changed` كذلك: الظهورُ **دالّةٌ** في أربعةِ حقائقَ لكلٍّ منها
 * حادثتُها المُعلَنة، وحادثةٌ خامسةٌ مُشتقّةٌ تجعل المستهلكَ يبني مخزناً موازياً يتباعد بصمت.
 */

import { isProductVisible, type MarketplaceErrorCode, type ProductModerationState, type ProductState, type StoreState } from "./contract-sets.js";
import {
  productNotModerated,
  productTransitionNotAllowed,
  storeNotApproved,
  inventoryInsufficientQuantity,
} from "./errors.js";

/** الحقائقُ الأربعُ التي يُشتَقُّ منها الظهور — لا خامسةَ ولا عمودَ مُخزَّن. */
export interface ProductVisibilityFacts {
  readonly storeState: StoreState;
  readonly productState: ProductState;
  readonly moderationState: ProductModerationState;
  readonly quantityOnHand: number;
}

/** الظهورُ نفسُه: تفويضٌ إلى دالّةِ العقدِ بلا إعادةِ كتابةِ الشروطِ الأربعة. */
export function isVisible(facts: ProductVisibilityFacts): boolean {
  return isProductVisible(facts);
}

/**
 * كلُّ ما ينقص هذا المنتجَ ليظهر، بترتيبٍ ثابتٍ من الأعمِّ إلى الأخصّ. مصفوفةٌ فارغةٌ ⇒ ظاهر.
 *
 * الترتيبُ **جزءٌ من العقدِ العمليّ**: لوحةُ الشريكِ تعرض أوّلَ عائقٍ في القائمةِ بارزاً، ولو
 * تغيّر الترتيبُ بلا قصدٍ لتغيّرت رسالةُ كلِّ شريكٍ في السوقِ بلا سطرٍ في دفترِ التغيير.
 */
export function productVisibilityBlockers(facts: ProductVisibilityFacts): MarketplaceErrorCode[] {
  const blockers: MarketplaceErrorCode[] = [];
  if (facts.storeState !== "approved") blockers.push("STORE_NOT_APPROVED");
  if (facts.moderationState !== "approved") blockers.push("PRODUCT_NOT_MODERATED");
  if (facts.productState !== "published") blockers.push("PRODUCT_TRANSITION_NOT_ALLOWED");
  if (facts.quantityOnHand <= 0) blockers.push("INVENTORY_INSUFFICIENT_QUANTITY");
  return blockers;
}

/**
 * يرمي أوّلَ عائقٍ إن وُجد. تُستعمَل في مسارٍ يجب أن يفشل بجوابٍ واحد (المراجعة 4/6)، وهي
 * موافقةٌ لـ`productVisibilityBlockers` بالبناءِ لا بالنسخ: نفسُ الترتيبِ ونفسُ الشروط.
 */
export function assertProductVisible(facts: ProductVisibilityFacts): void {
  if (facts.storeState !== "approved") throw storeNotApproved(facts.storeState);
  if (facts.moderationState !== "approved") throw productNotModerated(facts.moderationState);
  if (facts.productState !== "published") {
    throw productTransitionNotAllowed(facts.productState, "published");
  }
  if (facts.quantityOnHand <= 0) throw inventoryInsufficientQuantity(facts.quantityOnHand);
}
