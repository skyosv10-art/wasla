/**
 * مستهلكُ أحداثِ محرّك الطلب (الطور 09 · المراجعة 5/6).
 *
 * ## ما هذا الملفُّ وما ليس هو
 *
 * هو **مُحوّلٌ** يقرأ حمولةَ حدثٍ ويستدعي `recordFact` — لا أكثر. وليس ناقلاً ولا مشتركاً
 * ولا مسار HTTP: لا `fetch` فيه ولا مقبسَ ولا مؤقّت، ومَن يُطعمه الأحداثَ **خارج الخدمة**
 * كما أنّ مُشغّلَ `POST /reputation/tick` خارجَها (ADR-014 · HANDOFF §16-ي البند 5).
 *
 * ولماذا هذا الحدُّ بالضبط: الناقلُ قرارُ منصّةٍ لم يُتّخذ بعد (لا ناقلَ في المستودع حتى
 * اليوم، ولا خدمةَ لها ناشرٌ يُصرّف صندوقَها). فخدمةٌ تُدخل مكتبةَ ناقلٍ الآن كانت
 * ستُلزم المنصّةَ بها قبل أن يُكتب لها ADR، ثمّ يُقاس الثمنُ يومَ يُختار غيرُها. وما
 * يُحتاج فعلاً هو أن يكون **التحويلُ** صحيحاً ومُختبَراً، وهو ما يُقاس هنا بلا ناقل.
 *
 * ## لِمَ `recordFact` نفسُها ولا مسارٌ ثانٍ
 *
 * HANDOFF §16-ي البند 1: «عبر **نفس** `recordFact`». والوقائعُ الواصلةُ من الناقل تمرّ
 * على الحرّاس بنفس الترتيب الذي يمرّ عليه طلبُ `POST /reputation/facts`: الشكلُ، ثمّ
 * الوزنُ المُعلَن، ثمّ التكرارُ، ثمّ التأخّر. ومسارٌ ثانٍ «للأحداث» كان أرخصَ بأسبوعٍ ثمّ
 * أغلى بسنة: أوّلُ حرسٍ يُضاف إلى واحدٍ منهما وينسى الآخرَ يُنتج دفترين بقاعدتين.
 *
 * ## at-least-once هو الحالةُ الطبيعيّة
 *
 * الناقلُ يُسلّم الحدثَ مرّتين، وهذا ليس عطلاً. والتفرّدُ قيدٌ في القاعدة
 * (`ux_reputation_facts_source`) لا `if` في هذا الملفّ، فإعادةُ التسليم تُعاد
 * `duplicate: true` بلا نقطةٍ ثانية وبلا حدثٍ ثانٍ في الصندوق. والاختبارُ الذي يُثبت هذا
 * يعدّ **عددَ الأحداث المنشورة** لا رمزَ الحالة: مستهلكٌ يُرجع 200 مرّتين وقد أضاف
 * حدثين هو بعينه العطلُ الذي يُخفيه اختبارُ رمزِ الحالة.
 *
 * ## معاملةٌ لكلِّ مسوّدة، لا واحدةٌ للحدث
 *
 * حدثُ الإكمال يُنتج مسوّدتين (العميل والسائق)، وكلُّ واحدةٍ تُسجَّل في **نداءِ
 * `runner.write` مستقلّ**. والسببُ أنّ الثانيةَ قد تُردّ 422 لتأخّرٍ أو 409 لتعارضٍ في
 * حمولةٍ، ومعاملةٌ واحدةٌ تلفّ الاثنتين كانت ستُلغي واقعةَ العميل الصحيحةَ لأنّ واقعةَ
 * السائق سقطت — أي تخسر معلومةً صحيحةً بسبب أخرى خاطئة. والذرّيةُ المطلوبةُ في هذا الطور
 * ذرّيةُ **القرار الواحد** (واقعة + نتيجة + حدث)، وهي محفوظةٌ داخل كل نداء.
 *
 * Scope: خدمة السمعة · حدُّ الدخول من محرّك الطلب
 * Last Updated: 2026-08-23
 * Status: Active
 * Related Code: src/use-cases/record-fact.ts · src/inbound/translate.ts
 * Related Team: Reputation & Trust
 */

import { isReputationError } from "../domain/errors.js";
import type { ReputationFactDraft } from "../domain/model.js";
import type { ReputationRunner } from "../runner.js";
import { recordFact } from "../use-cases/record-fact.js";
import { parseSourceEvent } from "./source-events.js";
import type { SourceEventIgnoreReason } from "./translate.js";
import { translateSourceEvent } from "./translate.js";

/** ما صار لكلِّ مسوّدةٍ — مُسمّىً، لأنّ «فشل» بلا تمييزٍ يجعل التكرارَ يُقرأ عطلاً. */
export type FactOutcome =
  | {
      readonly kind: "recorded";
      readonly draft: ReputationFactDraft;
      readonly factId: string;
      readonly scorePoints: number;
      readonly tier: string;
    }
  | {
      readonly kind: "duplicate";
      readonly draft: ReputationFactDraft;
      readonly factId: string;
    }
  | {
      /**
       * رفضٌ **مُسمّى** من المجال: وزنٌ غائب، أو تأخّرٌ، أو تعارضُ حمولة. ليس عطلاً في
       * البنية، ولا يجوز أن يُعاد إلى الناقل ليُعيد التسليمَ إلى الأبد: إعادةُ تسليمِ
       * واقعةٍ متأخّرةٍ ستتأخّر دائماً.
       */
      readonly kind: "rejected";
      readonly draft: ReputationFactDraft;
      readonly errorCode: string;
      readonly httpStatus: number;
    };

export type SourceEventConsumption =
  | {
      /** حدثٌ صحيحٌ لا يعنينا — يُعَدّ ولا يُعاد إلى الناقل ولا يُرفَع به خطأ. */
      readonly kind: "unsupported";
      readonly eventType: string;
    }
  | {
      readonly kind: "consumed";
      readonly eventId: string;
      readonly outcomes: readonly FactOutcome[];
      readonly ignored: readonly SourceEventIgnoreReason[];
    };

/**
 * ## متى يُعيد الناقلُ التسليم — عقدُ هذه الدالّة مع من سيربطه
 *
 * القاعدةُ سطرٌ واحد: **رجوعٌ عاديٌّ يعني «استُهلك»، ورفعُ خطأٍ يعني «أعِد التسليم»**.
 * ولا دالّةَ `requiresRedelivery` هنا تُسأل بعد الرجوع، لأنّها كانت ستُجيب `false`
 * دائماً فتصير سطراً يُقرأ ولا يقرّر — وسطرٌ كهذا يُغري بأن يُبنى عليه قرارٌ خاطئ.
 *
 * والرفضُ المُسمّى (400/409/422) لا يُعاد تسليمُه: قرارٌ مستقرٌّ لن يتغيّر بمحاولةٍ
 * ثانية، وإعادتُه تُنتج حلقةً لا تنتهي على حدثٍ واحدٍ فتُغرق الطابورَ وتُؤخّر الصحيح.
 * ولذلك يُجمَع في `outcomes` ويُرجَع عاديّاً. أمّا العطلُ غيرُ المُسمّى فيُرفَع.
 */

/**
 * يستهلك حمولةً خام: يقرأ، يُترجم، ثمّ يُسجّل كلَّ مسوّدةٍ في نداءِ كتابةٍ مستقلّ.
 *
 * الأخطاءُ المُسمّاة تُجمَع في `outcomes` ولا تُرفَع، لأنّ رفعَ خطأِ الوزن الغائب من
 * مسوّدةٍ ثانيةٍ كان سيُخفي أنّ الأولى سُجّلت بنجاح. وما ليس مُسمّىً (عطلُ اتصال، خطأُ
 * برمجة) **يُرفَع كما هو**: عطلٌ يُبلَع هنا كان سيُقرأ «استُهلك الحدثُ» فيُفقَد إلى
 * الأبد، وذاك بعينه ما يُحوّل عطلاً مؤقّتاً إلى واقعةٍ لم تُسجَّل قطّ.
 */
export async function consumeSourceEvent(
  runner: ReputationRunner,
  raw: unknown,
): Promise<SourceEventConsumption> {
  const parsed = parseSourceEvent(raw);
  if (parsed.kind === "unsupported") {
    return { kind: "unsupported", eventType: parsed.eventType };
  }

  const event = parsed.event;
  const translation = translateSourceEvent(event);
  const outcomes: FactOutcome[] = [];

  for (const draft of translation.drafts) {
    try {
      const result = await runner.write((deps) =>
        recordFact(deps, { draft, traceId: event.trace_id }),
      );
      outcomes.push(
        result.duplicate
          ? { kind: "duplicate", draft, factId: result.fact.id }
          : {
              kind: "recorded",
              draft,
              factId: result.fact.id,
              scorePoints: result.score.scorePoints,
              tier: result.score.tier,
            },
      );
    } catch (error) {
      if (!isReputationError(error)) throw error;
      outcomes.push({
        kind: "rejected",
        draft,
        errorCode: error.code,
        httpStatus: error.httpStatus,
      });
    }
  }

  return {
    kind: "consumed",
    eventId: event.event_id,
    outcomes,
    ignored: translation.ignored,
  };
}
