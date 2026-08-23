/**
 * الترجمةُ من حدثِ محرّك الطلب إلى مسوّداتِ وقائع — دالّةٌ نقيّةٌ بلا منفذٍ ولا لحظة.
 *
 * ## القاعدةُ التي تحكم هذا الملفّ
 *
 * «السمعةُ نتيجةٌ مُشتقّة من دفتر وقائع». والدفترُ لا يُكتب إلّا من حدثٍ منشور، وهذا
 * الملفُّ هو **كلُّ** ما يُقرّر أيُّ حدثٍ يصير واقعةً وأيُّها لا يصير. وعزلُه في دالّةٍ
 * نقيّةٍ ليس ترتيباً: قرارُ «الإكمال يُسجّل للعميل وللسائق كليهما» قرارُ عملٍ يُقرأ
 * ويُراجَع، ولو سكن داخل مستهلكٍ يفتح معاملةً ويكتب في القاعدة لَما استطاع أحدٌ أن
 * يختبره إلّا بقاعدةٍ قائمة، ولَصار أرخصُ اختبارٍ له هو ألّا يُختبَر.
 *
 * ## `ignored` جوابٌ لا فشل
 *
 * أكثرُ انتقالات الطلب لا تعني السمعةَ شيئاً: `searching` و`offered` و`arrived` وسائرُها
 * مراحلُ رحلةٍ لا وقائعَ سلوك. والناقلُ يُسلّم كلَّ الأحداث إلى كلِّ مشترك، فمستهلكٌ
 * يرفع خطأً على `searching` كان سينتج سجلَّ أخطاءٍ يمتلئ في دقائق فيُغطّي أوّلَ خطأٍ
 * حقيقيّ — وهي بعينها العلّةُ التي جعلت `record-fact.ts` يُقدّم التكرار على التأخّر.
 *
 * ولذلك: كلُّ إهمالٍ **مُسمّى بسببه**. لا `return []` صامت.
 *
 * ## ولماذا لا تُترجَم كلُّ حالةٍ نهائية
 *
 * `expired` و`no_driver_found` و`driver_timeout` نهائياتٌ لا يملكها العميل ولا يملكها
 * سائقٌ بعينه — انتهاءُ مهلةٍ في السوق ليس سلوكَ شخص. و`partner_cancelled` و`blocked`
 * و`failed` و`under_review` قراراتٌ إداريّةٌ أو أعطالُ نظام: تسجيلُها في سمعةِ أحدٍ كان
 * يعني أن يُعاقَب على عطلٍ لا يد له فيه، والخدمةُ لا تعاقب أحداً (ADR-014 القرار 7).
 *
 * والوزنُ هو الحدُّ الأخير: `LAUNCH_RULE_WEIGHTS` لا تُعلن وزناً لـ
 * `order_cancelled_by_driver` على العميل ولا العكس، فترجمةٌ تُنتج مسوّدةً كهذه تُردّ
 * `422 REPUTATION_RULE_WEIGHT_MISSING` من `recordFact`. وهذا الملفُّ لا يعتمد على ذلك
 * حرساً بل يُوافقه صريحاً: كلُّ مسوّدةٍ يُنتجها هنا لها وزنٌ مُعلَنٌ في النسخة النشطة،
 * ويُثبته اختبارٌ يُقارن مخرجَ الترجمة بجدول الأوزان.
 *
 * Scope: خدمة السمعة · ترجمةُ أحداث المصدر
 * Last Updated: 2026-08-23
 * Status: Active
 * Related Code: src/domain/ruleset.ts · src/use-cases/record-fact.ts
 * Related Team: Reputation & Trust
 */

import type { ReputationFactDraft } from "../domain/model.js";
import type { OrderSourceEvent } from "./source-events.js";

/**
 * سببُ إهمالِ حدثٍ — مُقفَلٌ ومُسمّى، فلا نصَّ حرًّا يُقرأ ولا يُعَدّ.
 *
 * ولِمَ قائمةٌ مقفلة ولم يكفِ نصٌّ يشرح: من يُشغّل المستهلك سيعدّ هذه الأسبابَ في
 * لوحةٍ، ونصٌّ حرٌّ يجعل كلَّ صياغةٍ فئةً جديدة فلا يُجمع شيءٌ مع شيء.
 */
export const SOURCE_EVENT_IGNORE_REASONS = [
  /** انتقالُ حالةٍ لا يعني السمعةَ — مرحلةُ رحلةٍ لا واقعةَ سلوك. */
  "status_not_reputable",
  /** نهائيةٌ لا يملكها طرفٌ بعينه: مهلةٌ انتهت أو سوقٌ لم يجد سائقاً. */
  "status_owned_by_no_party",
  /** إلغاءُ عرضِ إسنادٍ من غير السائق — لا واقعةَ على من لم يفعل. */
  "assignment_cancelled_by_system",
  /** إكمالٌ بلا سائقٍ في الحمولة: يُترجَم للعميل وحده، ويُسجّل الغيابُ باسمه. */
  "driver_absent_in_payload",
] as const;

export type SourceEventIgnoreReason = (typeof SOURCE_EVENT_IGNORE_REASONS)[number];

export interface SourceEventTranslation {
  /** المسوّداتُ بالترتيب الذي تُسجّل به. قد تكون فارغةً مع سببٍ في `ignored`. */
  readonly drafts: readonly ReputationFactDraft[];
  /** ما أُهمل ولماذا — يُسجّله من يُشغّل المستهلك، ولا يُرفَع خطأً به. */
  readonly ignored: readonly SourceEventIgnoreReason[];
}

/**
 * لماذا `subjectType` مشتقٌّ من نوعِ الواقعة لا من الحدث.
 *
 * الجانبُ ليس خياراً: `order_cancelled_by_customer` واقعةُ عميلٍ دائماً، و
 * `assignment_timed_out` واقعةُ سائقٍ دائماً. وتمريرُ الجانب وسيطاً كان سيسمح بمسوّدةٍ
 * تقول «إلغاءُ العميل على السائق» فتُردّ 422 بعد أن كُتبت في الكود، والأفضلُ أن تكون
 * غيرَ قابلةٍ للتعبير.
 */
function customerDraft(
  event: OrderSourceEvent & { readonly event_type: "order.status_changed" },
  factKind: "order_completed" | "order_cancelled_by_customer",
): ReputationFactDraft {
  return {
    subjectType: "customer",
    subjectPublicId: event.data.customer_public_id,
    factKind,
    orderPublicId: event.data.order_public_id,
    sourceEventType: event.event_type,
    sourceEventId: event.event_id,
    sourceSequence: event.data.sequence,
    /**
     * `actor_type` يُنسَخ كما ورد من المحرّك ولا يُخمَّن: مَن ألغى الطلبَ حقيقةٌ معلومةٌ
     * عند المحرّك وحده. وكتالوجُ الفاعلين في العقدين واحدٌ حرفاً بحرف (`ActorType` في
     * `services/orders/contracts/events.json` و`ReputationActorType` في
     * `@wasla/contracts-reputation`)، فالتحويلُ هنا تحويلُ نوعٍ لا تحويلُ قيمة — ومع
     * ذلك يمرّ على `assertActorType` داخل `recordFact` فيُردّ 400 لو انفكّ الكتالوجان
     * يوماً. والبديلُ الأرخصُ الخاطئ: تحويلُ ما لا نعرفه إلى `system` — فيُنسَب فعلُ
     * موظّفٍ إلى النظام في دفترٍ لا يُعدَّل، ولا يشتكي شيء.
     */
    actorType: event.data.actor_type as ReputationFactDraft["actorType"],
    reasonCode: event.data.reason_code,
    occurredAt: event.occurred_at,
    traceId: event.trace_id,
  };
}

function driverDraft(
  event: OrderSourceEvent & { readonly event_type: "order.status_changed" },
  driverPublicId: string,
  factKind: "order_completed" | "order_cancelled_by_driver",
): ReputationFactDraft {
  return {
    subjectType: "driver",
    subjectPublicId: driverPublicId,
    factKind,
    orderPublicId: event.data.order_public_id,
    sourceEventType: event.event_type,
    sourceEventId: event.event_id,
    sourceSequence: event.data.sequence,
    actorType: event.data.actor_type as ReputationFactDraft["actorType"],
    reasonCode: event.data.reason_code,
    occurredAt: event.occurred_at,
    traceId: event.trace_id,
  };
}

/**
 * الحالاتُ النهائيةُ التي لا تُنسَب إلى طرف.
 *
 * مكتوبةٌ صريحةً لا محسوبةً من `is_terminal`: النهائيّةُ صفةُ انتقالٍ في جدول المحرّك،
 * وكونُ الواقعةِ مملوكةً لطرفٍ قرارُ سمعةٍ نملكه نحن. وربطُ الثاني بالأوّل كان يعني أنّ
 * إضافةَ حالةٍ نهائيةٍ في المحرّك تُغيّر سمعةَ الناس بلا قرارٍ من أحد.
 *
 * وتُصدَّر لأنّ `source-events-drift.test.ts` يقارنها بتعداد `OrderStatus` في عقد الطلب
 * في الاتجاهين: اسمٌ هنا لا وجودَ له هناك فرعٌ ميّت، وحالةٌ نهائيّةٌ هناك بلا تصنيفٍ هنا
 * تمرّ إلى `status_not_reputable` — وهو الفرعُ المُعَدّ لحالات الرحلة لا للنهائيّات.
 */
export const UNOWNED_TERMINAL_STATUSES: readonly string[] = [
  "expired",
  "no_driver_found",
  "driver_rejected",
  "driver_timeout",
  "partner_cancelled",
  "blocked",
  "failed",
  "payment_disputed",
  "under_review",
];

export function translateSourceEvent(event: OrderSourceEvent): SourceEventTranslation {
  if (event.event_type === "order.status_changed") return translateStatusChanged(event);
  return translateAssignmentResolved(event);
}

function translateStatusChanged(
  event: OrderSourceEvent & { readonly event_type: "order.status_changed" },
): SourceEventTranslation {
  const status = event.data.to_status;

  if (status === "completed") {
    /**
     * الإكمالُ واقعتان لا واحدة: العميلُ أكمل والسائقُ أكمل، ولكلٍّ وزنُه المُعلَن
     * (3 و4 في `saudi-launch-v1`). وتسجيلُ واحدةٍ فقط كان يعني أنّ أحدَ الجانبين لا
     * تنمو سمعتُه من العمل نفسِه.
     *
     * والمفتاحُ `ux_reputation_facts_source` يشمل الجانبَ والمُعرّف، فالواقعتان لا
     * تتعارضان ولو حملتا نفسَ `sequence` — وهو ما يجعل حرسَ التأخّر (وهو لكلِّ
     * «شخص × طلب») يمرّ على الاثنتين.
     */
    const drafts: ReputationFactDraft[] = [customerDraft(event, "order_completed")];
    const driver = event.data.driver_public_id;
    if (driver === null) {
      return { drafts, ignored: ["driver_absent_in_payload"] };
    }
    drafts.push(driverDraft(event, driver, "order_completed"));
    return { drafts, ignored: [] };
  }

  if (status === "customer_cancelled") {
    return { drafts: [customerDraft(event, "order_cancelled_by_customer")], ignored: [] };
  }

  if (status === "driver_cancelled") {
    const driver = event.data.driver_public_id;
    /**
     * إلغاءُ سائقٍ بلا مُعرّفِ سائقٍ في الحمولة تناقضٌ في المصدر. ولا يُخمَّن الطرفُ ولا
     * يُسجَّل على العميل: واقعةٌ تُنسَب إلى غير فاعلها أسوأُ من واقعةٍ لم تُسجَّل، لأنّ
     * الأولى تُصلَّح بإعادة تسليمٍ والثانيةُ تبقى رقماً خاطئاً في دفترٍ لا يُعدَّل.
     */
    if (driver === null) return { drafts: [], ignored: ["driver_absent_in_payload"] };
    return { drafts: [driverDraft(event, driver, "order_cancelled_by_driver")], ignored: [] };
  }

  if (UNOWNED_TERMINAL_STATUSES.includes(status)) {
    return { drafts: [], ignored: ["status_owned_by_no_party"] };
  }

  return { drafts: [], ignored: ["status_not_reputable"] };
}

function translateAssignmentResolved(
  event: OrderSourceEvent & { readonly event_type: "order.assignment_resolved" },
): SourceEventTranslation {
  const state = event.data.assignment_state;

  /**
   * `cancelled` وحدها تُهمَل من الأربعة: إلغاءُ العرض يأتي من موجةِ الإسناد أو من إلغاء
   * العميل للطلب، وليس فعلاً للسائق. والثلاثةُ الباقية أفعالُه أو صمتُه:
   *
   *   - `accepted` → `assignment_accepted` (+1)
   *   - `rejected` → `assignment_rejected` (**صفرٌ مُعلَن**: الرفضُ حقٌّ لا مخالفة)
   *   - `expired`  → `assignment_timed_out` (−2: الصمتُ يُكلّف العميلَ انتظاراً)
   */
  if (state === "cancelled") {
    return { drafts: [], ignored: ["assignment_cancelled_by_system"] };
  }

  const factKind =
    state === "accepted"
      ? "assignment_accepted"
      : state === "rejected"
        ? "assignment_rejected"
        : "assignment_timed_out";

  return {
    drafts: [
      {
        subjectType: "driver",
        subjectPublicId: event.data.driver_public_id,
        factKind,
        orderPublicId: event.data.order_public_id,
        sourceEventType: event.event_type,
        sourceEventId: event.event_id,
        sourceSequence: event.data.sequence,
        /**
         * `actor_type` غيرُ موجودٍ في حمولة هذا الحدث بالعقد، فيُشتقّ من النتيجة ولا
         * يُفترَض واحداً للكلّ: القبولُ والرفضُ فعلُ السائق، وانتهاءُ المهلة قرارُ
         * النظام حين لم يفعل أحدٌ شيئاً. وجعلُها كلَّها `driver` كان سينسب إلى السائق
         * فعلاً لم يفعله؛ وجعلُها كلَّها `system` كان سيمحو فاعلَ الرفض من الدفتر.
         */
        actorType: state === "expired" ? "system" : "driver",
        reasonCode: event.data.reason_code,
        /**
         * `resolved_at` لا `occurred_at` المغلّف: الأولى لحظةُ انتهاء العرض في العالم،
         * والثانيةُ لحظةُ إنتاج الحدث. والتلاشي في `score.ts` يُحسب بعمر الواقعة، فخلطُ
         * اللحظتين كان يجعل تأخُّرَ ناشرٍ يُغيّر نتيجةَ حسابٍ لا علاقة له به.
         */
        occurredAt: event.data.resolved_at,
        traceId: event.trace_id,
      },
    ],
    ignored: [],
  };
}
