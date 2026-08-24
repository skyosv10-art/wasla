/**
 * مستهلكُ وقائعِ السمعة — **الطريقُ الذي يجعل الإحالةَ تتأهّل ثمّ تُكافأ**.
 *
 * ## ما يُستهلَك، ولِمَ واقعةٌ لا نتيجة
 *
 * حدثٌ واحدٌ: `reputation.fact_recorded` بنوعِ واقعةٍ `order_completed`. ولا يُستهلَك
 * `reputation.score_recomputed` ولا مستوىً (`tier`) بحال — وذاك قرارٌ لا سهو: **النتيجةُ
 * حصيلةُ حسابٍ تتغيّر بنسخةِ قواعد**، فإحالةٌ تأهّلت بنتيجةٍ 71 كانت ستصير غيرَ متأهّلةٍ بعد
 * تعديلِ أوزانٍ في خدمةٍ أخرى، ومكافأةٌ مُنحت لا تُسترَدّ. والواقعةُ لا تتغيّر: طلبٌ اكتمل
 * يبقى مكتملاً بعد أيّ تعديلٍ على أيّ قاعدةٍ في أيّ خدمة.
 *
 * ## ذرّيّةُ الطريقِ كلِّه — معاملةٌ واحدة
 *
 * منعُ التكرار، والعدّاد، وتقدّمُ الحالة، ومُدّةُ المكافأة، وصفُّها، وأحداثُها: كلُّها في
 * `uow.write` واحدة. ولو فُرّقت، لَظهرت أسوأُ حالةٍ في هذه الخدمة: **مُدّةُ مكافأةٍ في الدفتر
 * وحالةُ إحالةٍ ما زالت `qualified`** — فتُعالج الواقعةُ التالية فتُمنح المكافأةُ ثانيةً، ولا
 * شيءَ في النظام يقول إنّ الأولى مُنحت.
 *
 * ## منعُ التكرارِ **قبل** أيّ عمل، بمفتاحٍ من مُعرِّفِ الواقعة
 *
 * التسليمُ من السمعة at-least-once (ناشرُها يُعلّم بعد التسليم)، فنفسُ الواقعةِ تصل مرّتين
 * بحكمِ التصميمِ لا بحكمِ عطل. والمفتاحُ `fact:<fact_id>` يُدرَج **أوّلاً** في
 * `subscription_idempotency`: الخاسرُ في السباقِ يجد الصفَّ موجوداً فيرجع «مُكرَّرة» بلا أن
 * يعدّ واقعةً أو يمنح يوماً. ولو أُدرج أخيراً، لَعالج تسليمان متزامنان نفسَ الواقعةِ معاً.
 *
 * ### انحرافٌ مُعلَنٌ عن معنى الجدول
 *
 * `response_status` و`response_body` في هذا الجدول وُضعا لبايتاتِ جوابٍ يُعاد على HTTP، وهذا
 * المسارُ ليس HTTP ولا أحدَ يُعيد بايتاتِه لأحد. فالمحفوظُ هنا **إشعارُ معالجةٍ** لا جوابٌ:
 * `200` ومُعرِّفُ الواقعة. والبديلُ كان جدولاً ثانياً لمنعِ تكرارِ الأحداث — عمودان مُهدَران
 * في صفٍّ أرخصُ من جدولٍ ثانٍ له مُهاجرةٌ وفهرسٌ ومسارُ تنظيفٍ خاصٌّ به. ومُعلَنٌ هنا
 * وفي `docs/02-architecture/SUBSCRIPTION_EVENTS.md` كي لا يُقرأ لاحقاً كأنّه سوءُ فهم.
 *
 * ## والرفضُ لا يُكتب: `pending` تبقى `pending`
 *
 * واقعةٌ عُدَّت ولم تبلغ العتبةَ تُنتج حكمَ رفضٍ **في الذاكرة** ولا تُغيّر الصفّ. لأنّ
 * `qualifyReferral` تُجيب عن «هل تتأهّل الآن؟»، و«لا، ليس بعد» ليست «مرفوضة»: النافذةُ ما
 * زالت مفتوحةً وقد تبلغ العتبةَ غداً. وكتابةُ `rejected` عند كلّ واقعةٍ ناقصةٍ كانت ستُظهر
 * للسائق «إحالتُك مرفوضة» ثمّ تُبدّلها إلى «متأهّلة» بعد يومين — وهو أسوأُ من الصمت. وسببُ
 * الرفضِ يُعاد إلى المُنادي في التقريرِ ليُقرأ في السجلّ، ولا يُثبَّت في الصفّ.
 *
 * ## ولا `fetch` هنا: الحدثُ يُمرَّر لا يُجلَب
 *
 * المستهلكُ يستقبل حمولةً ويُقرّر. مَن يقرؤها من ناقلٍ خارجُ الخدمة — كما أنّ مُشغّلَ النبضةِ
 * خارجَها، وكما أنّ منفذَ نشرِ الصندوقِ خارجَها (`app/events.ts`).
 */

import type { PlanVersion } from "../domain/model.js";
import type { ReferralRejectionReason, SubscriptionState } from "../domain/contract-sets.js";
import {
  planNotFound,
  planNotFrozen,
  subscriptionUnavailable,
  validationFailed,
} from "../domain/errors.js";
import { referralQualified, referralRewarded } from "../domain/events.js";
import { applyReferralReward, qualifyReferral } from "../domain/referral.js";
import { currentCoverageEnd } from "../domain/state.js";
import type { Clock } from "../domain/time.js";
import type { SubscriptionUnitOfWork } from "../db/unit-of-work.js";
import { toOutboxDraft, type IdGenerator } from "./events.js";
import { fingerprint } from "./idempotency.js";
import { syncFromLedger } from "./sync.js";

/** نوعُ الحدثِ الوحيدُ الذي يُستهلَك، ومسارُه في سجلّ منعِ التكرار. */
export const CONSUMED_EVENT_TYPE = "reputation.fact_recorded";
export const FACT_ROUTE_KEY = "events:reputation.fact_recorded";

/** نوعُ الواقعةِ الوحيدُ الذي يُؤهِّل — والباقي يُهمَل بسببٍ **مُسمّى**. */
export const QUALIFYING_FACT_KIND = "order_completed";

/**
 * أسبابُ الإهمال — كلُّها مُسمّاةٌ، ولا سببَ اسمُه «غيرُ ذلك».
 *
 * ولمَ تُعاد إلى المُنادي بدل أن تُبتلَع؟ لأنّ «استُهلكت 12 واقعةً وتأهّلت 0» لا تقول شيئاً:
 * السببُ يفرّق بين ناقلٍ يُسلّم وقائعَ لا تخصّنا (سليم) وبين إحالاتٍ لا تُوجَد لمُحالٍ يعمل
 * (عطبُ ربطٍ يجب أن يُرى). ولوحةٌ بلا هذا التفريقِ تُظهر خدمةً صامتةً بلا تفسير.
 */
export const FACT_IGNORE_REASONS = [
  "fact_kind_not_qualifying",
  "subject_not_driver",
  "no_referral_for_referee",
  "referral_not_pending",
] as const;
export type FactIgnoreReason = (typeof FACT_IGNORE_REASONS)[number];

/**
 * الحمولةُ كما تُستقبَل — الحقولُ التي يقرؤها هذا المستهلكُ وحدَها.
 *
 * ولمَ لا يُعاد بناءُ مغلَّفِ السمعةِ كلِّه بنوعٍ كامل؟ لأنّه عقدُ خدمةٍ أخرى: كلُّ حقلٍ
 * نُلزمه هنا يصير قيداً على تطوّرِها. فنُلزم ما نحتاجه فعلاً ونتجاهل الباقي — وهذا هو
 * القراءةُ المتحفّظةُ التي تُبقي المستهلكَ حيّاً بعد أوّلِ حقلٍ يُضيفه المُنتِج.
 */
export interface ReputationFactEvent {
  readonly event_id: string;
  readonly event_type: string;
  readonly trace_id?: string | null;
  readonly data: {
    readonly fact_id: string;
    readonly subject_type: string;
    readonly subject_public_id: string;
    readonly fact_kind: string;
    /** لحظةُ **وقوعِ** الواقعةِ لا لحظةُ إصدارِ الحدث — انظر `occurred_for` في العقود. */
    readonly occurred_for: string;
  };
}

/**
 * يقرأ حمولةً غيرَ موثوقةٍ ويرفضها بالاسمِ عند أوّلِ حقلٍ ناقص.
 *
 * ولمَ لا `as ReputationFactEvent` وكفى؟ لأنّ الحمولةَ تأتي من ناقلٍ لا من `tsc`: تأكيدُ
 * نوعٍ هنا كان سيمرّ على `data: null` ثمّ ينفجر بـ`TypeError` في منتصف المعاملة — فيُقرأ
 * العطلُ كخللٍ في خدمتِنا لا كحمولةٍ مشوّهةٍ من مُنتِج.
 */
export function parseReputationFact(payload: unknown): ReputationFactEvent {
  if (payload === null || typeof payload !== "object") {
    throw validationFailed("event", "an object payload");
  }
  const envelope = payload as Record<string, unknown>;
  const eventId = envelope["event_id"];
  const eventType = envelope["event_type"];
  if (typeof eventId !== "string" || eventId.length === 0) {
    throw validationFailed("event_id", "a non-empty string");
  }
  if (eventType !== CONSUMED_EVENT_TYPE) {
    // نوعٌ آخرُ ليس «مُهمَلاً» بل **عطبُ ربط**: مَن يُشترك بنوعٍ لا يستهلكه يُخفي أنّ
    // اشتراكَه خاطئ، ويظهر ذلك بعد شهرٍ كصندوقٍ يُصرَّف بلا أثرٍ في الإحالات.
    throw validationFailed("event_type", CONSUMED_EVENT_TYPE);
  }
  const data = envelope["data"];
  if (data === null || typeof data !== "object") {
    throw validationFailed("data", "an object payload");
  }
  const fact = data as Record<string, unknown>;
  for (const field of ["fact_id", "subject_type", "subject_public_id", "fact_kind", "occurred_for"]) {
    if (typeof fact[field] !== "string" || (fact[field] as string).length === 0) {
      throw validationFailed(`data.${field}`, "a non-empty string");
    }
  }
  const traceId = envelope["trace_id"];
  return {
    event_id: eventId,
    event_type: CONSUMED_EVENT_TYPE,
    trace_id: typeof traceId === "string" ? traceId : null,
    data: {
      fact_id: fact["fact_id"] as string,
      subject_type: fact["subject_type"] as string,
      subject_public_id: fact["subject_public_id"] as string,
      fact_kind: fact["fact_kind"] as string,
      occurred_for: fact["occurred_for"] as string,
    },
  };
}

/**
 * حصيلةُ واقعةٍ واحدة — حكمٌ واحدٌ وأرقامٌ تفسّره.
 *
 * الأحكامُ الأربعةُ منفصلةٌ لأنّها أربعةُ أشياءَ مختلفةٍ لمن يقرأ السجلّ: `duplicate` تسليمٌ
 * ثانٍ (سليمٌ ومتوقَّع)، `ignored` واقعةٌ لا تخصّ إحالةً، `counted` عُدَّت ولم تكفِ العتبة،
 * `rewarded` تأهّلت ومُنحت. وعلمٌ واحدٌ `handled: boolean` كان سيطوي الأربعةَ في «نعم/لا».
 */
export interface FactOutcome {
  readonly verdict: "duplicate" | "ignored" | "counted" | "rewarded";
  readonly factId: string;
  readonly ignoreReason: FactIgnoreReason | null;
  readonly referralId: string | null;
  readonly qualifyingFactCount: number | null;
  /** سببُ عدمِ التأهّلِ **الآن** — ولا يُكتب في الصفّ (انظر ترويسةَ الملفّ). */
  readonly rejectionReason: ReferralRejectionReason | null;
  readonly rewardId: string | null;
  readonly grantedPeriodId: string | null;
  readonly rewardDays: number | null;
  /** مُعرِّفاتُ ما كُتب في صندوق الصادرِ لهذه الواقعة — قد تبلغ ثلاثةً عند المكافأة. */
  readonly eventIds: readonly string[];
}

function outcome(base: Partial<FactOutcome> & { readonly verdict: FactOutcome["verdict"]; readonly factId: string }): FactOutcome {
  return {
    ignoreReason: null,
    referralId: null,
    qualifyingFactCount: null,
    rejectionReason: null,
    rewardId: null,
    grantedPeriodId: null,
    rewardDays: null,
    eventIds: [],
    ...base,
  };
}

export class ReputationFactConsumer {
  constructor(
    private readonly uow: SubscriptionUnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * يستهلك واقعةً واحدة، ويُعيد ما جرى فعلاً لا ما نوى.
   *
   * `now` من ساعةِ الخدمة لا من `occurred_for`: النافذةُ تُقاس بالحاضرِ (هل ما زالت مفتوحةً
   * **الآن**؟)، ولو قِيست بلحظةِ الواقعةِ لَتأهّلت إحالةٌ بوقائعَ وصلت متأخّرةً بعد إغلاقِ
   * نافذتِها. ولحظةُ الواقعةِ تدخل حيث تنتمي: `occurred_for` في الحدثِ المُنشَر.
   */
  async record(payload: unknown): Promise<FactOutcome> {
    const event = parseReputationFact(payload);
    const fact = event.data;
    const now = this.clock.now();
    const traceId = event.trace_id ?? null;

    const { value } = await this.uow.write(async ({ stores }) => {
      // 1) منعُ التكرارِ أوّلاً — قبل عدٍّ أو منحٍ أو حدث.
      const remembered = await stores.idempotency.remember({
        idempotencyKey: `fact:${fact.fact_id}`,
        routeKey: FACT_ROUTE_KEY,
        requestHash: fingerprint(fact),
        responseStatus: 200,
        responseBody: { fact_id: fact.fact_id, event_id: event.event_id },
        traceId,
      });
      if (remembered.verdict === "replay") {
        return outcome({ verdict: "duplicate", factId: fact.fact_id });
      }

      // 2) الإهمالُ بسببٍ مُسمّى — والصفُّ المحفوظُ أعلاه يجعل الإهمالَ نفسَه غيرَ مُكرَّر.
      if (fact.subject_type !== "driver") {
        return outcome({
          verdict: "ignored",
          factId: fact.fact_id,
          ignoreReason: "subject_not_driver",
        });
      }
      if (fact.fact_kind !== QUALIFYING_FACT_KIND) {
        return outcome({
          verdict: "ignored",
          factId: fact.fact_id,
          ignoreReason: "fact_kind_not_qualifying",
        });
      }

      const referral = await stores.referrals.readByReferee(fact.subject_public_id);
      if (!referral) {
        return outcome({
          verdict: "ignored",
          factId: fact.fact_id,
          ignoreReason: "no_referral_for_referee",
        });
      }
      if (referral.state !== "pending") {
        return outcome({
          verdict: "ignored",
          factId: fact.fact_id,
          referralId: referral.referralId,
          ignoreReason: "referral_not_pending",
        });
      }

      // 3) العدُّ في القاعدة، والشرطُ `pending` هو ما يجعل تسليمَين متزامنَين لا يعدّان مرّتين.
      const counted = await stores.referrals.incrementQualifyingFacts(referral.referralId);
      if (!counted) {
        return outcome({
          verdict: "ignored",
          factId: fact.fact_id,
          referralId: referral.referralId,
          ignoreReason: "referral_not_pending",
        });
      }

      // 4) الأدلّةُ من الدفترِ لا من عدّادٍ وحدَه: مُدّةٌ مدفوعةٌ واحدةٌ على الأقلّ للمُحال.
      const refereePeriods = await stores.ledger.listPeriods(fact.subject_public_id);
      const plan = await this.planOf(stores, referral.planCode, referral.planVersion);

      /**
       * حالةُ المُحيلِ تُشتقُّ **الآن** من دفترِه لا تُقرأ من صفٍّ قد يكون بائتاً.
       *
       * وهذا خللٌ حقيقيٌّ وُجد باختبارِ التكامل: المُحيلُ دفع في يومِ تجربتِه الأوّل، فبقي
       * صفُّه المُتحقِّقُ `trial` حتى تُعيد نبضةٌ حسابَه. ومستهلكٌ يقرأ ذلك الصفَّ كان يرفض
       * تأهّلاً بـ`referrer_not_active` **وهو سارٍ فعلاً** — ثمّ تُغلَق النافذةُ فيُضيَّع
       * حقُّ سائقٍ بسببِ تأخّرِ مهمّةٍ دوريّة، بلا خطأٍ ولا سجلٍّ يشير إلى السبب.
       *
       * والاشتقاقُ هنا كتابةٌ مقصودةٌ لا قراءةٌ متنكّرة: `syncFromLedger` تكتب الانتقالاتِ
       * التي كانت النبضةُ ستكتبها وتنشر أحداثَها في نفسِ المعاملة، فيبقى موضعُ اشتقاقِ
       * الحالةِ واحداً في الخدمةِ كلِّها (القرار 2) — ولا نسخةَ ثانيةً من قواعدِ الانتقال هنا.
       */
      const referrerLedger = await stores.ledger.listPeriods(referral.referrerPublicId);
      const referrerAnchor = referrerLedger[referrerLedger.length - 1];
      const refreshedEventIds: string[] = [];
      let referrerState: SubscriptionState | null = null;
      if (referrerAnchor) {
        const referrerPlan = await this.planOf(
          stores,
          referrerAnchor.planCode,
          referrerAnchor.planVersion,
        );
        const refreshed = await syncFromLedger({
          stores,
          driverPublicId: referral.referrerPublicId,
          plan: referrerPlan,
          now,
          trace: { sourceEventId: event.event_id, traceId: traceId ?? undefined },
          ids: this.ids,
        });
        referrerState = refreshed.projection.state;
        refreshedEventIds.push(...refreshed.eventIds);
      }

      const judgement = qualifyReferral({
        referrerPublicId: referral.referrerPublicId,
        refereePublicId: referral.refereePublicId,
        referrerState,
        evidence: {
          qualifyingFactCount: counted.qualifyingFactCount,
          hasActivatedPaidPeriod: refereePeriods.some((period) => period.source === "payment"),
          // `ux_referrals_referee` يمنع إحالتَين لمُحالٍ واحد، فالصفُّ الذي بين يدينا **هو**
          // إحالتُه الوحيدة. وقراءةٌ ثانيةٌ لتأكيدِ ما يحرسه قيدٌ فريدٌ ثمنٌ بلا مقابل.
          alreadyReferredByAnother: false,
        },
        windowEndsAt: referral.windowEndsAt,
        plan,
        now,
      });

      if (judgement.state === "rejected") {
        // لا كتابةَ حالةٍ: تبقى `pending` بعدّادٍ أعلى بواحد (انظر ترويسةَ الملفّ).
        return outcome({
          verdict: "counted",
          factId: fact.fact_id,
          referralId: referral.referralId,
          qualifyingFactCount: counted.qualifyingFactCount,
          rejectionReason: judgement.reasonCode,
          // اشتقاقُ حالةِ المُحيلِ أعلاه قد يكون كتب انتقالاتٍ حقيقيّةً وأحداثَها، والرفضُ
          // لا يمحوها: تُعلَن هنا كي لا يقرأ أحدٌ «رُفض» فيفترض أنّ المعاملةَ لم تكتب شيئاً.
          eventIds: refreshedEventIds,
        });
      }

      // 5) تأهّلت: تقدّمُ الحالةِ محروسٌ بحالتِها السابقة، وحدثُها يُكتب في نفسِ المعاملة.
      const qualified = await stores.referrals.advanceState(referral.referralId, {
        from: "pending",
        to: "qualified",
        changedAt: judgement.judgedAt,
      });
      if (!qualified) {
        return outcome({
          verdict: "ignored",
          factId: fact.fact_id,
          referralId: referral.referralId,
          ignoreReason: "referral_not_pending",
        });
      }

      const eventIds: string[] = [...refreshedEventIds];
      const qualifiedEvent = referralQualified({
        meta: { eventId: this.ids.next(), occurredAt: now, traceId },
        referralId: qualified.referralId,
        referralCode: qualified.referralCode,
        referrerPublicId: qualified.referrerPublicId,
        refereePublicId: qualified.refereePublicId,
        qualifyingFactCount: qualified.qualifyingFactCount,
        requiredFactCount: plan.referralQualifyingFacts,
        planCode: plan.planCode,
        planVersion: plan.planVersion,
        qualifiedAt: judgement.judgedAt,
      });
      await stores.outbox.append(toOutboxDraft(qualifiedEvent));
      eventIds.push(qualifiedEvent.event_id);

      // 6) المكافأةُ **مُدّةٌ في الدفتر** لا رصيدٌ ولا نقطة، وتبدأ من نهايةِ تغطيةِ المُحيل:
      //    مكافأةٌ تبدأ الآن كانت ستحرق ما بقي من مُدّةٍ مدفوعةٍ فتُعاقب مَن دفع.
      const referrerPeriods = await stores.ledger.listPeriods(referral.referrerPublicId);
      const rewardDraft = applyReferralReward({
        referral: {
          referralId: qualified.referralId,
          referralCode: qualified.referralCode,
          referrerPublicId: qualified.referrerPublicId,
          refereePublicId: qualified.refereePublicId,
          state: qualified.state,
          reasonCode: qualified.reasonCode,
          qualifyingFactCount: qualified.qualifyingFactCount,
          windowEndsAt: qualified.windowEndsAt,
        },
        plan,
        currentCoverageEnd: currentCoverageEnd(referrerPeriods),
        now,
      });

      // نفسُ المسارِ الواحدِ للكتابة: المُدّةُ تُكتب ثمّ تُشتقُّ الحالةُ من الدفتر، فتُنشَر
      // `subscription.activated` تلقائيّاً إن نقل المنحُ المُحيلَ من انقضاءٍ إلى سريان.
      const synced = await syncFromLedger({
        stores,
        driverPublicId: referral.referrerPublicId,
        plan,
        now,
        grant: rewardDraft.period,
        trace: { sourceEventId: event.event_id, traceId: traceId ?? undefined },
        ids: this.ids,
      });
      if (!synced.period) {
        // مستحيلٌ بحكمِ التمرير (`grant` مُعطاة)، والرفضُ الصريحُ أصدقُ من `!` تُخفي الافتراض.
        throw subscriptionUnavailable("granted reward period");
      }
      eventIds.push(...synced.eventIds);

      const reward = await stores.referrals.insertReward({
        referralId: qualified.referralId,
        grantedPeriodId: synced.period.periodId,
        beneficiaryPublicId: referral.referrerPublicId,
        rewardDays: rewardDraft.rewardDays,
        planCode: rewardDraft.planCode,
        planVersion: rewardDraft.planVersion,
        grantedAt: now,
        traceId,
      });

      const rewarded = await stores.referrals.advanceState(qualified.referralId, {
        from: "qualified",
        to: "rewarded",
        changedAt: now,
      });
      if (!rewarded) {
        // القيدُ الفريدُ على `referral_id` في `referral_rewards` يمنع مكافأةً ثانيةً، فوصولُنا
        // إلى هنا بلا صفٍّ معدَّلٍ يعني حالةً غيرَ متوقّعةٍ: تُفشل المعاملةَ ولا تُبتلَع.
        throw subscriptionUnavailable("referral row in qualified state");
      }

      const rewardedEvent = referralRewarded({
        meta: { eventId: this.ids.next(), occurredAt: now, traceId },
        referralId: reward.referralId,
        rewardId: reward.rewardId,
        beneficiaryPublicId: reward.beneficiaryPublicId,
        grantedPeriodId: reward.grantedPeriodId,
        rewardDays: reward.rewardDays,
        planCode: reward.planCode,
        planVersion: reward.planVersion,
        rewardedAt: reward.grantedAt,
      });
      await stores.outbox.append(toOutboxDraft(rewardedEvent));
      eventIds.push(rewardedEvent.event_id);

      return outcome({
        verdict: "rewarded",
        factId: fact.fact_id,
        referralId: reward.referralId,
        qualifyingFactCount: qualified.qualifyingFactCount,
        rewardId: reward.rewardId,
        grantedPeriodId: reward.grantedPeriodId,
        rewardDays: reward.rewardDays,
        eventIds,
      });
    });

    return value;
  }

  /**
   * نسخةُ الخطّةِ المُثبَّتةُ في صفِّ الإحالة — ويجب أن تكون **مجمّدة**.
   *
   * لأنّ المنحَ يقع منها: أيّامُ المكافأةِ وعتبةُ الوقائعِ ونافذتُها كلُّها من هذه النسخة،
   * ومنحٌ من نسخةٍ قابلةٍ للتحرير يجعل تفسيرَ مكافأةِ الأمس مستحيلاً بعد أوّلِ تعديل.
   */
  private async planOf(
    stores: { readonly ledger: { readPlanVersion(code: string, version: number): Promise<PlanVersion | null> } },
    planCode: string,
    planVersion: number,
  ): Promise<PlanVersion> {
    const plan = await stores.ledger.readPlanVersion(planCode, planVersion);
    if (!plan) throw planNotFound(planCode, planVersion);
    if (!plan.isFrozen) throw planNotFrozen(planCode, planVersion);
    return plan;
  }
}

/**
 * ## النطاق
 *
 * استهلاكُ `reputation.fact_recorded`: منعُ تكرارٍ بمُعرِّفِ الواقعة · عدُّ الوقائعِ المُؤهِّلة ·
 * حكمُ التأهّل · تقدّمُ الحالةِ · مُدّةُ المكافأةِ وصفُّها · أحداثُ الإحالةِ في صندوق الصادر.
 *
 * ## آخر تحديث
 *
 * المراجعة 5/6 — الملفُّ جديد.
 *
 * ## الحالة
 *
 * لا مسارَ HTTP له في هذه المراجعة ولا مُشترِكَ ناقل: يُنادى من مُشغّلٍ خارجَ الخدمة، وهو
 * الدَّينُ المُعلَنُ نفسُه في `app/events.ts` (لا ADR يُسمّي ناقلَ وصلة بعد).
 *
 * ## كودٌ ذو صلة
 *
 * `domain/referral.ts` · `domain/events.ts` · `db/referrals.ts` · `app/sync.ts` ·
 * `services/reputation/contracts/events.json`.
 *
 * ## الفريق
 *
 * Platform / Subscriptions.
 */
