/**
 * اختيارُ المنفذين الصادرين من حزمة بيئة (Phase 08 · MR 5/6).
 *
 * ## لماذا وحدةٌ مستقلّة لا سطران في `http/server.ts`
 *
 * المنفذان الصادران يُقرأان من أكثر من جذر تركيب: عمليّة الخدمة على 8091، وبوابة الخروج
 * E2E في MR 6/6 التي ترفع الخدمات معاً وتحتاج أن تُوصّل بالضبط ما يُوصّله الإنتاج. ولو
 * أجاب كل جذرٍ عن السؤال وحده لتباعدا، والعطلُ الذي يُنتجه التباعد نوعيّ: بوابةُ خروجٍ
 * تمرّ بمنافذَ ذاكرية «تنجح دائماً» فتُعلن نجاح مرحلةٍ لم تُختبر.
 *
 * فالقاعدة سطرٌ واحد: **الجذر يقرّر أن ينادي هذا الملف، ولا يُعيد استنتاج ما يُعيده.**
 *
 * والبيئة **معامل** لا `process.env`: اختبارٌ يصف التوصيل الذي يتحدّث عنه، ولا يُعدّل
 * العمليّة التي يجري فيها.
 *
 * ## لا عنوان افتراضيّ، ولا منفذٌ يتظاهر
 *
 * متغيّرٌ غائب ⇒ منفذ `Unconfigured…` من `runtime.ts`، وهو **مرئيّ**: أحدهما يرفض بـ`503`
 * قبل الكتابة، والآخر يرمي فيُسجَّل `unavailable` ولا يُبطل اتفاقاً. وتخمينُ
 * `http://localhost:8087` كان سيُحوّل متغيّراً ناقصاً عندنا إلى انقطاعٍ يُنسب إلى محرّك
 * الطلب في كل سجلٍّ يقرؤه مُشغّل بعد ذلك.
 *
 * ## لماذا يقرأ `DispatchOfferPort` متغيّرين
 *
 * لقطةُ العرض مركّبة من ملكيّتين: العرض من التوزيع ووضعُ السعر من محرّك الطلب
 * (`http-dispatch-offer.ts` يشرح لماذا لا يجوز نسخُ أحدهما إلى الآخر). فالمنفذ الحقيقي
 * لا يُوصَّل إلّا بالعنوانين معاً: عنوانٌ واحد يعني لقطةً نصفها مُخمَّن، وخيطٌ يُفتح على
 * تخمينٍ أسوأ من خيطٍ لا يُفتح.
 */

import { HttpAgreedPricePort } from "./http-agreed-price.js";
import { HttpDispatchOfferPort } from "./http-dispatch-offer.js";
import {
  UnconfiguredAgreedPricePort,
  UnconfiguredDispatchOfferPort,
} from "./runtime.js";
import type { AgreedPricePort, DispatchOfferPort } from "../ports.js";

/** بالضبط المتغيّرات التي يقرأها هذا التوصيل. لا يُضاف إليها شيء بصمت. */
export interface NegotiationOutboundEnv {
  readonly DISPATCH_SERVICE_URL?: string | undefined;
  readonly ORDERS_SERVICE_URL?: string | undefined;
}

/** أين تذهب ملاحظة التوصيل: `console.warn` في عمليّة، وجاسوسٌ في اختبار. */
export type WiringLog = (message: string) => void;

function trimmed(value: string | undefined): string | null {
  const candidate = value?.trim();
  return candidate === undefined || candidate.length === 0 ? null : candidate;
}

/**
 * منفذ عروض التوزيع: حقيقيٌّ عند وجود العنوانين، ورافضٌ بالاسم عند غياب أيّهما.
 *
 * الملاحظة تُسمّي المتغيّر الناقص: «الخدمة لا تفتح خيوطاً» بلا سببٍ مذكور تُرسل مُشغّلاً
 * يبحث عن عطلٍ في التوزيع، والسبب متغيّرُ بيئةٍ عنده.
 */
export function configuredDispatchOffers(
  env: NegotiationOutboundEnv,
  log: WiringLog,
): DispatchOfferPort {
  const dispatchBaseUrl = trimmed(env.DISPATCH_SERVICE_URL);
  const ordersBaseUrl = trimmed(env.ORDERS_SERVICE_URL);
  if (dispatchBaseUrl !== null && ordersBaseUrl !== null) {
    return new HttpDispatchOfferPort({ dispatchBaseUrl, ordersBaseUrl });
  }
  const missing = [
    dispatchBaseUrl === null ? "DISPATCH_SERVICE_URL" : null,
    ordersBaseUrl === null ? "ORDERS_SERVICE_URL" : null,
  ].filter((name): name is string => name !== null);
  log(
    `${missing.join(" و")} غير مضبوط: لقطة عرض التوزيع غير موصَّلة، ` +
      `وفتحُ أي خيط سيُجيب 503 NEGOTIATION_UNAVAILABLE.`,
  );
  return new UnconfiguredDispatchOfferPort();
}

/**
 * منفذ تسليم السعر: حقيقيٌّ عند وجود عنوان محرّك الطلب، ورامٍ بالاسم عند غيابه.
 *
 * الغياب هنا **لا يمنع الاتفاق** ولا يجوز أن يمنعه: القبول يقع ويُسجَّل، والتسليم يبقى
 * `pending` ثمّ يُعيد النبضةُ المحاولة حتى `abandoned` (ADR-013 القرار 2). ولذلك تُقال
 * الملاحظة بصيغة «الاتفاقات ستبقى غير مُسلَّمة»، لا «التفاوض متوقّف».
 */
export function configuredAgreedPrice(
  env: NegotiationOutboundEnv,
  log: WiringLog,
): AgreedPricePort {
  const baseUrl = trimmed(env.ORDERS_SERVICE_URL);
  if (baseUrl !== null) return new HttpAgreedPricePort({ baseUrl });
  log(
    "ORDERS_SERVICE_URL غير مضبوط: الاتفاقات ستقع وتبقى غير مُسلَّمة إلى محرّك الطلب " +
      "(handoff_state=pending ثم abandoned بعد نفاد المحاولات).",
  );
  return new UnconfiguredAgreedPricePort();
}

/** هل وُصِّل المنفذان الحقيقيان كلاهما؟ الجواب الذي قد تحتاج بوابةُ الخروج أن تراه. */
export function outboundFullyConfigured(env: NegotiationOutboundEnv): boolean {
  return trimmed(env.DISPATCH_SERVICE_URL) !== null && trimmed(env.ORDERS_SERVICE_URL) !== null;
}
