/**
 * تنسيقُ الأحداث: **مُعرِّفٌ يُولَّد مرّةً · مسوّدةُ صادرٍ · تصريفٌ يُسلّم ثمّ يُعلّم**.
 *
 * ثلاثُ مسؤولياتٍ في ملفٍّ واحدٍ لأنّها ثلاثُ حلقاتٍ من سلسلةٍ واحدةٍ لا تُقرأ مفرَّقة: مَن
 * يُولّد `event_id`، ومَن يحوّل حدثَ مجالٍ إلى صفٍّ، ومَن يُخرجه من الصفّ. وتفريقُها على
 * ثلاثة ملفّاتٍ كان سيُخفي الثابتَ الذي يربطها: **المُعرِّفُ واحدٌ في الحمولةِ والمفتاح**.
 *
 * ## لماذا يُولَّد `event_id` هنا ولا في مصنعِ الحدثِ ولا في القاعدة
 *
 * المفتاحُ الأساسيُّ لصفِّ `subscription_outbox` هو `event_id` نفسُه، وهو أيضاً حقلٌ **داخل**
 * الحمولة. فلو ولّدته القاعدةُ بـ`gen_random_uuid()` لَاحتجنا تحديثَ الحمولةِ بعد الإدراج
 * لتُطابقه — و`UPDATE` على صفِّ صادرٍ ممنوعٌ في حارس النقاء بعينه لهذا: صفٌّ يُعدَّل بعد
 * كتابته يفقد صفتَه كسجلٍّ لِما قُرِّر. ولو ولّده المصنعُ لَصار المجالُ يقرأ عشوائيةً فلا
 * يُقارَن حدثٌ بمساواةٍ تامّةٍ في اختبار.
 *
 * فالتوليدُ في طبقةِ التطبيق: `IdGenerator` منفذٌ يُمرَّر، وتحقيقُه الحقيقيُّ في
 * `app/runtime.ts` — الملفُّ الوحيدُ المسموحُ له بـ`randomUUID` في حارس النقاء.
 *
 * ## التسليمُ at-least-once، مُعلَناً لا مخفيّاً
 *
 * التعليمُ **بعد** التسليم. فلو سقطت العمليةُ بين نجاحِ التسليمِ والالتزام، سُلّم الصفُّ
 * ثانيةً. والعكسُ (تعليمٌ قبل تسليم) أرخصُ وأسوأ: at-most-once يُفقد الحدثَ نهائياً عند
 * أوّلِ عطلِ شبكةٍ بلا أن يبقى له أثر. والثمنُ مدفوعٌ في المكان الصحيح: `event_id` لا يتغيّر
 * بإعادة التسليم، ومستهلكٌ يُزيل التكرارَ به يرى الحدثَ مرّةً واحدة — وهو بعينه ما تفعله
 * هذه الخدمةُ نفسُها مع وقائع السمعة في `app/facts.ts`.
 *
 * ## ولا ناقلَ في هذه المراجعة
 *
 * `fetch` ممنوعٌ في كلّ ملفٍّ تحت `src/` بلا استثناء، وهذه المراجعةُ لا تُوسّع الحارس:
 * التسليمُ منفذٌ (`EventSinkPort`)، ومُهيئُه الشبكيُّ يسكن في العملية التي تُشغّل التصريف.
 * والسببُ ليس طاعةَ حارس: لا ADR يُسمّي ناقلَ وصلة بعد، فمكتبةُ ناقلٍ هنا كانت ستُلزم
 * المنصّةَ بقرارٍ لم يُتَّخذ ثمّ تُفشل حرسَ التبعيّات الذي كُتب ليمنع هذا بعينه. وما يجب أن
 * يصحّ الآن هو **منطقُ** التصريف، وهو يُقاس بمنفذٍ في الذاكرة بلا شبكة.
 *
 * ## ولا مؤقّت
 *
 * `drainSubscriptionOutbox` نداءٌ واحدٌ يُصرّف دفعةً ويُعيد تقريراً. مَن يُكرّره خارجَ
 * الخدمة، كما أنّ مُشغّلَ `POST /subscriptions/tick` خارجَها.
 */

import {
  activated,
  expired,
  movedToCommunity,
  trialStarted,
  type EventMeta,
  type SubscriptionDomainEvent,
} from "../domain/events.js";
import type { Clock } from "../domain/time.js";
import type { Period } from "../domain/model.js";
import type { TransitionRecord } from "../db/repository.js";
import type { OutboxDraft, OutboxRow } from "../db/outbox.js";
import type { SubscriptionUnitOfWork } from "../db/unit-of-work.js";

/**
 * مُوَلِّدُ مُعرِّفاتِ الأحداث — منفذٌ لا دالّةٌ حرّة.
 *
 * ولمَ منفذٌ لسطرٍ واحد؟ لأنّ الاختبارَ يحتاج تسلسلاً متوقّعاً (`evt-1`, `evt-2`) ليقارن
 * حمولةً بمساواةٍ تامّة. ومع دالّةٍ مستوردةٍ مباشرةً كان البديلُ الوحيدُ حيلةً في الإطار
 * تُرقِّع الوحدةَ (`vi.mock`) — وهي حيلةٌ تُخفي أنّ الاعتمادَ موجود.
 */
export interface IdGenerator {
  next(): string;
}

/** مُوَلِّدٌ تسلسليٌّ للاختبار وحدَه — مُصدَّرٌ لأنّ إعادةَ كتابتِه في كلّ ملفِّ اختبارٍ تُنتج نسخاً تتباعد. */
export function sequentialIdGenerator(prefix: string): IdGenerator {
  let counter = 0;
  return {
    next(): string {
      counter += 1;
      return `${prefix}${counter}`;
    },
  };
}

/**
 * مُوَلِّدٌ تسلسليٌّ **بشكلِ UUID** — لاختبارات التكامل وحدَها.
 *
 * ولمَ اثنان لا واحد؟ لأنّ `event_id` عمودُ `uuid` في القاعدة، و`evt-1` يُرفَض عند الإدخال
 * (`22P02`). فالتسلسلُ النصّيُّ يخدم الاختبارَ النقيَّ حيث لا قاعدة، وهذا يخدم القاعدةَ
 * ويبقى متوقَّعاً: لا `randomUUID` في اختبارٍ يقارن مُعرِّفاتٍ، ولا مُعرِّفٌ حقيقيٌّ يجعل
 * كلَّ تشغيلٍ نصّاً جديداً في رسالةِ الفشل.
 *
 * و`namespace` يفصل مُوَلِّداً عن آخرَ في الملفِّ نفسِه: مُوَلِّدان يبدآن من واحدٍ كانا
 * سيُنتجان نفسَ المُعرِّفِ لحدثَين مختلفَين، فيسقط الإدخالُ على المفتاحِ الأوّليّ — وهو فشلٌ
 * يبدو خللاً في الصندوقِ وهو خللٌ في المُهيئ.
 */
export function sequentialUuidGenerator(namespace = 0): IdGenerator {
  const group = (namespace % 0x1000).toString(16).padStart(3, "0");
  let counter = 0;
  return {
    next(): string {
      counter += 1;
      return `00000000-0000-4000-8${group}-${counter.toString().padStart(12, "0")}`;
    },
  };
}

/**
 * يحوّل حدثَ مجالٍ إلى مسوّدةِ صفٍّ — وهذا هو المكانُ الوحيدُ الذي يعرف الشكلين معاً.
 *
 * `payload` هو المغلَّفُ **كاملاً** بما فيه `event_id` و`trace_id`، لا `data` وحدَها. فمن
 * قرأ الصفَّ بعد سنةٍ يجد حدثاً صالحاً للتسليم كما هو، ولا يحتاج أن يُعيد بناءَ مغلَّفٍ من
 * أعمدةٍ متفرّقة — وإعادةُ البناءِ تلك كانت ستُنتج مغلَّفاً بنسخةِ الكودِ الحاضرةِ لا بنسخةِ
 * الكودِ التي قرّرت.
 *
 * والأعمدةُ المُكرَّرةُ (`event_type` · `aggregate_*` · `occurred_at`) ليست تكراراً عبثاً:
 * بها يُفرَز الصندوقُ ويُفهرَس بلا فتحِ `jsonb`.
 */
export function toOutboxDraft(event: SubscriptionDomainEvent): OutboxDraft {
  return {
    eventId: event.event_id,
    eventType: event.event_type,
    aggregateType: event.aggregate.type,
    aggregateId: event.aggregate.id,
    payload: event,
    occurredAt: event.occurred_at,
    traceId: event.trace_id,
  };
}

/** ما يحتاجه بناءُ حدثِ انتقالٍ زيادةً على صفِّ الانتقال نفسِه. */
export interface TransitionEventContext {
  readonly meta: EventMeta;
  readonly subscriptionId: string;
  readonly planCode: string;
  readonly planVersion: number;
  readonly expiresAt: string | null;
  /** المُدّةُ الحاكمةُ للحالةِ المُستقَرّة — إلزاميّةٌ حين تكون الحالةُ `active`. */
  readonly governing: Period | null;
}

/**
 * خطأُ حالةٍ لا يُمكن أن تُبنى منها حمولةٌ صالحة — يُرفَع ولا يُبلَع.
 *
 * حدثُ تفعيلٍ يُلزم `period_source` و`granted_days` و`expires_at`، وثلاثتُها من المُدّةِ
 * الحاكمة. فلو غابت لَكان البديلُ الأرخصُ أصفاراً وسلاسلَ فارغة: حدثٌ يمرّ تحقّقَ المخطَّطِ
 * ويقول للمستهلك «فُعِّل بصفرِ أيّام». والرفضُ الصريحُ يُبطل المعاملةَ كلَّها — وهو الصحيح،
 * لأنّ انتقالاً إلى `active` بلا مُدّةٍ حاكمةٍ عطبُ بنيةٍ لا عطبُ تسليم.
 */
export class EventPayloadIncompleteError extends Error {
  constructor(eventType: string, missing: string) {
    super(`cannot build ${eventType}: missing ${missing}`);
    this.name = "EventPayloadIncompleteError";
  }
}

/**
 * يبني الحدثَ الذي يُطابق انتقالاً واحداً — وثبةٌ واحدةٌ = حدثٌ واحد.
 *
 * ولمَ لا حدثٌ واحدٌ للطريق كلِّه؟ لأنّ طريقاً من `trial` إلى `community` يعبر `expired`،
 * وحدثٌ واحدٌ يقول «من التجربة إلى المجتمع» كان سيُخفي **أنّ الاشتراكَ انقضى** — وهي
 * الواقعةُ التي تُبنى عليها كلُّ محاسبةٍ لاحقة. فالحدثانِ يُنشَران بتسلسُلَي حالتيهما.
 */
export function transitionEvent(
  transition: TransitionRecord,
  context: TransitionEventContext,
): SubscriptionDomainEvent {
  const base = {
    meta: context.meta,
    driverPublicId: transition.driverPublicId,
    subscriptionId: context.subscriptionId,
    fromState: transition.fromState,
    reasonCode: transition.reasonCode,
    stateSequence: transition.sequence,
    planCode: context.planCode,
    planVersion: context.planVersion,
    periodId: transition.periodId,
    transitionOccurredAt: transition.occurredAt,
  };

  switch (transition.toState) {
    case "trial":
      return trialStarted({ ...base, toState: "trial", expiresAt: context.expiresAt });
    case "active": {
      const governing = context.governing;
      if (!governing) {
        throw new EventPayloadIncompleteError("subscription.activated", "governing period");
      }
      if (context.expiresAt === null) {
        throw new EventPayloadIncompleteError("subscription.activated", "expires_at");
      }
      return activated({
        ...base,
        toState: "active",
        expiresAt: context.expiresAt,
        periodSource: governing.source,
        grantedDays: governing.grantedDays,
        paymentReference: governing.paymentReference,
      });
    }
    case "expired":
      return expired({ ...base, toState: "expired", expiresAt: context.expiresAt });
    case "community":
      return movedToCommunity({ ...base, toState: "community", expiresAt: context.expiresAt });
  }
}

// ---------------------------------------------------------------------------
// التصريف
// ---------------------------------------------------------------------------

/**
 * منفذُ التسليم — **يرمي** عند الفشل ولا يُرجع `boolean`.
 *
 * و`boolean` كان أرخصَ وأخطر: `false` صامتةٌ تُخفي **لماذا** فشل التسليم، فيُكتب في
 * `last_error` نصٌّ من عندنا لا من العطل، ويُقرأ بعد أسبوعين فلا يقول شيئاً. والاستثناءُ
 * يحمل رسالتَه، والمُصرّفُ يكتبها في العمود المُعَدّ لها.
 */
export interface EventSinkPort {
  deliver(row: OutboxRow): Promise<void>;
}

/** خطأُ منفذٍ غيرِ مُهيَّأ — يُرفَع باسمه ولا يُبلَع. */
export class EventSinkUnconfiguredError extends Error {
  constructor(reason: string) {
    super(`subscriptions event sink is not configured: ${reason}`);
    this.name = "EventSinkUnconfiguredError";
  }
}

/**
 * منفذٌ يُعلن أنّه غيرُ مُهيَّأ في كلّ نداء.
 *
 * يُستعمل حين تُقلَع الخدمةُ بلا هدفِ نشرٍ مُعلَن: التصريفُ يفشل تسليمَ كلِّ صفٍّ ويكتب
 * السببَ في `last_error`، ويبقى `published_at` فارغاً — فلا حدثَ يُفقَد، ويُقرأ العطلُ من
 * الجدول بلا تحقيق. والبديلُ الأرخصُ الخاطئ منفذٌ لا يفعل شيئاً ويُرجع بنجاح: الصندوقُ
 * يُفرَغ، و`published_at` يُكتب، ولا مستهلكَ يستلم شيئاً — أي فقدانُ أحداثٍ صامتٌ يظهر بعد
 * شهرٍ في لوحةٍ ناقصة.
 */
export function unconfiguredEventSink(reason: string): EventSinkPort {
  return {
    async deliver(): Promise<void> {
      throw new EventSinkUnconfiguredError(reason);
    },
  };
}

export interface DrainFailure {
  readonly eventId: string;
  readonly eventType: string;
  readonly reason: string;
}

/**
 * تقريرُ دفعةٍ واحدة — و`claimed = published + failed.length + alreadyPublished` دائماً.
 *
 * الحقولُ منفصلةٌ لا عدّادٌ واحد: «صُرّف 40» لا تقول هل نُشر أربعون أم فشل عشرون، ولوحةٌ
 * مبنيّةٌ عليها تُظهر نظاماً سليماً وناقلُه معطَّل.
 */
export interface DrainReport {
  readonly claimed: number;
  readonly published: number;
  readonly failed: readonly DrainFailure[];
  /**
   * صفوفٌ سُلّمت ثمّ رفض التعليمُ الشرطيُّ أن يُغيّرها — أي كانت منشورةً أصلاً.
   *
   * الرقمُ يجب أن يبقى صفراً؛ ووجودُه في التقرير هو ما يجعله يُلاحَظ بدل أن يُبتلَع. وأيُّ
   * قيمةٍ فوق الصفر تعني أنّ الاحتجازَ لم يُقفل، وذاك عطلُ بنيةٍ لا عطلُ تسليم.
   */
  readonly alreadyPublished: number;
}

export const DRAIN_BATCH_LIMIT = 100;

/**
 * يُصرّف دفعةً واحدة: يحتجز غيرَ المنشور، يُسلّم، ثمّ يُعلّم.
 *
 * الثلاثةُ في **معاملةٍ واحدة**، وإلّا سقط القفل: `FOR UPDATE SKIP LOCKED` يُحرّر أقفالَه
 * عند الالتزام، فمُصرّفٌ يحتجز في معاملةٍ ثمّ يُسلّم خارجَها يفتح البابَ لمُصرّفٍ ثانٍ يحتجز
 * نفسَ الصفّ. والثمنُ معروفٌ ومقبول: معاملةٌ تنتظر شبكة — ولذلك `limit` محدودٌ ومُعلَن،
 * فدفعةٌ من ألفِ صفٍّ تُبقي معاملةً مفتوحةً دقائقَ فتُعطّل `VACUUM` وتُطيل الأقفال.
 *
 * وفشلُ صفٍّ لا يوقف الدفعة: الحلقةُ تمضي إلى التالي. ولو أوقفناها لَصار صفٌّ واحدٌ فاسدٌ
 * سدّاً يمنع كلَّ ما بعده إلى الأبد — وهو أسوأُ من تأخّرِ صفٍّ واحد.
 */
export async function drainSubscriptionOutbox(
  uow: SubscriptionUnitOfWork,
  sink: EventSinkPort,
  options: { readonly limit?: number; readonly clock: Clock },
): Promise<DrainReport> {
  const limit = options.limit ?? DRAIN_BATCH_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("drain limit must be an integer >= 1");
  }

  const { value } = await uow.write(async ({ stores }) => {
    const rows = await stores.outbox.claimUnpublished(limit);
    const failed: DrainFailure[] = [];
    let published = 0;
    let alreadyPublished = 0;

    for (const row of rows) {
      try {
        await sink.deliver(row);
      } catch (error) {
        /**
         * الرسالةُ من العطل لا من عندنا، والقصُّ في المخزن لا هنا: حدُّ الطول قاعدةُ
         * عمودٍ، ومكانُها عند العمود.
         */
        const reason = error instanceof Error ? error.message : String(error);
        await stores.outbox.recordDeliveryFailure(row.eventId, reason);
        failed.push({ eventId: row.eventId, eventType: row.eventType, reason });
        continue;
      }

      const changed = await stores.outbox.markPublished(row.eventId, options.clock.now());
      if (changed) published += 1;
      else alreadyPublished += 1;
    }

    return { claimed: rows.length, published, failed, alreadyPublished };
  });

  return value;
}

/**
 * ## النطاق
 *
 * منفذُ توليدِ المُعرِّفات · تحويلُ حدثِ المجالِ إلى صفِّ صادر · بناءُ حدثِ الانتقالِ من صفِّه ·
 * تصريفُ دفعةٍ من الصندوق.
 *
 * ## آخر تحديث
 *
 * المراجعة 5/6 — الملفُّ جديد.
 *
 * ## الحالة
 *
 * `transitionEvent` يُنادى من `app/sync.ts` داخلَ معاملةِ القرار. و`drainSubscriptionOutbox`
 * يُنادى من مُشغّلٍ خارجَ الخدمة، وليس له مسارُ HTTP في هذه المراجعة (دَينٌ مُعلَنٌ في
 * HANDOFF لا عطلٌ مخفيّ).
 *
 * ## كودٌ ذو صلة
 *
 * `domain/events.ts` · `db/outbox.ts` · `app/runtime.ts` ·
 * `services/reputation/src/outbound/drain-outbox.ts` (السابقة).
 *
 * ## الفريق
 *
 * Platform / Subscriptions.
 */
