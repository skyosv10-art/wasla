/**
 * محوّلات العمليّة الحقيقية: ساعةٌ ومُعرّفات، ومنفذان صادران لم يُوصَّلا بعد
 * (Phase 08 · MR 4/6).
 *
 * ## لماذا ملفٌّ مستقلّ عن `in-memory.ts`
 *
 * `in-memory.ts` بيئةُ اختبار: ساعتُها تُحرَّك بيد ومُعرّفاتها متسلسلة كي يُسمّي الفشلُ
 * `…-000000000007` بدل قيمةٍ تختلف في كل تشغيل. وما هنا نقيضُ ذلك تماماً — ساعةُ النظام
 * ومُعرّفاتُ التعمية — فوضعُهما معاً كان سيجعل استيراداً واحداً خاطئاً في اختبارٍ يجلب
 * زمناً حقيقياً إلى مجموعةٍ بُنيت كلّها على أنّ الزمن مُدخَل.
 *
 * ## المنفذان الصادران: يرفضان بالاسم ولا يتظاهران
 *
 * منفذا `DispatchOfferPort` و`AgreedPricePort` الحقيقيان (نداءان على 8089 و8087) شأنُ
 * MR 5/6. وحتى ذلك الحين لا يجوز أن يعمل الخادم بمنفذٍ **يتظاهر بالنجاح**: عرضُ إرسالٍ
 * مُختلَق يفتح خيطاً على سعرٍ لا سند له، وتسليمُ سعرٍ يُقال إنّه نجح يُغلق الاتفاق
 * `handed_off` بينما محرّك الطلب لا يعرف بالرقم شيئاً — وذاك عطلٌ صامت يُكتشف عند أوّل
 * سائق يطالب بأجرته.
 *
 * فالرفض هنا **مصنوعٌ ليُقرأ صحيحاً**، وبطريقتين مختلفتين عن قصد:
 *
 *   - `UnconfiguredDispatchOfferPort` يرفع `NEGOTIATION_UNAVAILABLE` (`503`): منفذٌ إلزامي
 *     **قبل** الكتابة، فالطلب لم يقع أثرُه وإعادةُ المحاولة هي التعليمة الصحيحة.
 *   - `UnconfiguredAgreedPricePort` **يرمي** ولا يُعيد `rejected`. الفرق جوهري: `rejected`
 *     قرارٌ من محرّك الطلب ونهائيٌّ على الاتفاق، ومحرّكُ الطلب لم يقل شيئاً هنا. الرميُ
 *     يُسجَّل `unavailable` فتُعيد النبضةُ المحاولة، ويبقى الاتفاق قائماً — وهو بعينه
 *     القرار 2 في ADR-013: فشلُ التسليم لا يُبطل اتفاقاً وقع بين طرفين.
 *
 * ولا شيء منهما يستنتج عنواناً افتراضياً: تخمينُ `localhost` يُحوّل متغيّراً ناقصاً عندنا
 * إلى انقطاعٍ يُنسب إلى خدمةٍ أخرى.
 */

import { randomUUID } from "node:crypto";

import { negotiationUnavailable } from "../domain/errors.js";
import type {
  AgreedPriceHandoffResult,
  AgreedPricePort,
  Clock,
  DispatchOfferPort,
  DispatchOfferSnapshot,
  IdGenerator,
} from "../ports.js";

/** ساعة النظام — المحوّل الوحيد الذي يقرأ الزمن الحقيقي. */
export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

/** مُعرّفات UUID v4 حقيقية. */
export class CryptoIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}

export class UnconfiguredDispatchOfferPort implements DispatchOfferPort {
  async describe(_dispatchOfferId: string): Promise<DispatchOfferSnapshot | null> {
    throw negotiationUnavailable("كتالوج عروض الإرسال غير موصَّل (DISPATCH_SERVICE_URL)");
  }
}

export class UnconfiguredAgreedPricePort implements AgreedPricePort {
  async handOff(): Promise<AgreedPriceHandoffResult> {
    // رميٌ لا `rejected`: انظر ترويسة الملف. ولا يُستعمل هنا `negotiationUnavailable`،
    // لأنّ هذا الرمي **لا يصل إلى مُتَّصل** — يلتقطه `use-cases/handoff.ts` ويُسجّله حالةَ
    // تسليم؛ وخطأٌ يحمل رمزاً منشوراً في موضعٍ لا يُنشَر منه يدعو أوّل قارئ أن يظنّ أنّ
    // القبول يستطيع أن يُجيب `503`.
    throw new Error("order engine not wired (ORDERS_SERVICE_URL): MR 5/6");
  }
}
