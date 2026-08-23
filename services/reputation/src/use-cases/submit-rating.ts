/**
 * تقييمٌ من طرفٍ لطرفٍ على طلبٍ مكتمل.
 *
 * التقييمُ ليس نتيجةً ولا يُعدّلها مباشرة. يُخزَّن كتقييم، **ثم** يُشتقّ منه واقعةُ
 * `rating_received` في الدفتر، ومن الدفتر تُحسب النتيجة. الطريقُ الطويل مقصود: لو أضاف
 * التقييمُ نقاطاً بنفسه لصار للنتيجة مصدرانِ للحقيقة، ولَبطلت «النتيجةُ مُشتقّةٌ من دفتر
 * وقائع» في أوّل حالةٍ تختلف فيها الحصيلتان — ولا يُعرف أيّهما الصحيح.
 *
 * ## من أين يُعرف أنّ المُقيِّم طرفٌ في الطلب؟
 *
 * **من الدفتر، لا من محرّك الطلب.** لا نداءَ متزامنَ هنا (ADR-014): السمعةُ مستهلكٌ
 * لأحداث الطلب، ووقائعُ الطلب في دفترها هي ما تُثبت مَن كان طرفاً فيه ومتى اكتمل. وتابعٌ
 * متزامنٌ كان سيجعل تقييمَ عميلٍ يفشل لأنّ خدمةً أخرى تتعافى.
 *
 * ونتيجةً لذلك: طلبٌ لم تصل وقائعُه بعد ⇒ `REPUTATION_ORDER_NOT_COMPLETED` (422)، وهو
 * الردُّ الصحيح: الدفترُ لا يعرف بعد أنّ الطلب اكتمل، ولا يجوز أن نُصدّق العميل على ذلك.
 *
 * ## `subjectType` مُشتقٌّ لا مُرسَل
 *
 * حمولةُ العقد (`RatingSubmitRequest`) لا تحمل `subject_type`، وهذا مقصود: جانبُ
 * المُقيَّم معلومٌ من دفتر الطلب، وقبولُه من العميل كان سيسمح بتقييمٍ يُسجَّل على الجانب
 * الخطأ فيُوزَن بأوزانٍ ليست له.
 */

import {
  orderNotCompleted,
  ratingAlreadySubmitted,
  ratingPartyMismatch,
  ratingSelfForbidden,
  ratingWindowClosed,
} from "../domain/errors.js";
import { ratingSubmitted } from "../domain/events.js";
import type {
  ReputationFactRow,
  ReputationRatingDraft,
  ReputationRatingRow,
  ReputationScoreRow,
} from "../domain/model.js";
import { addHours, assertTimestamp, toEpochMillis } from "../domain/time.js";
import {
  assertOrderPublicId,
  assertRatingReasonCode,
  assertStars,
  assertSubjectType,
  assertWaslaPublicId,
} from "../domain/validation.js";
import type { ReputationDependencies } from "../ports.js";
import { recordFact } from "./record-fact.js";
import {
  checkIdempotency,
  fingerprintOf,
  rememberIdempotency,
  requireActiveRuleset,
  requireIdempotencyKey,
} from "./shared.js";

export interface RatingSubmitResult {
  readonly rating: ReputationRatingRow;
  readonly fact: ReputationFactRow;
  readonly score: ReputationScoreRow;
}

/** نوعُ الواقعة المُشتقّة من تقييم، ومصدرُها المُعلَن في الدفتر. */
const RATING_FACT_KIND = "rating_received" as const;
const RATING_SOURCE_EVENT_TYPE = "reputation.rating_submitted" as const;

export async function submitRating(
  deps: ReputationDependencies,
  input: {
    readonly draft: ReputationRatingDraft;
    readonly idempotencyKey?: string | null;
    readonly traceId?: string | null;
  },
): Promise<RatingSubmitResult> {
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const traceId = input.traceId ?? input.draft.traceId ?? null;

  const draft = {
    orderPublicId: assertOrderPublicId(input.draft.orderPublicId),
    raterType: assertSubjectType(input.draft.raterType, "raterType"),
    raterPublicId: assertWaslaPublicId(input.draft.raterPublicId, "raterPublicId"),
    subjectPublicId: assertWaslaPublicId(input.draft.subjectPublicId, "subjectPublicId"),
    stars: assertStars(input.draft.stars),
    reasonCode: assertRatingReasonCode(input.draft.reasonCode),
    submittedAt:
      input.draft.submittedAt === undefined
        ? deps.clock.now()
        : assertTimestamp(input.draft.submittedAt, "submittedAt"),
  };

  const fingerprint = fingerprintOf(draft);
  const decision = await checkIdempotency(deps, idempotencyKey, fingerprint);
  if (decision.kind === "replay") return await replayResult(deps, draft);

  /**
   * التقييمُ الذاتيّ يُرفَض **قبل** أي قراءةٍ أخرى.
   *
   * لأنّه لا يحتاج معرفةَ شيءٍ عن الطلب ليكون خطأً، ورفضُه أوّلاً يجعل الرسالةَ دقيقةً:
   * `REPUTATION_RATING_SELF_FORBIDDEN` لا «لستَ طرفاً في الطلب».
   */
  if (draft.raterPublicId === draft.subjectPublicId) throw ratingSelfForbidden();

  const ruleset = await requireActiveRuleset(deps);

  const completion = await deps.facts.findOrderCompletion(draft.orderPublicId);
  if (completion === null) throw orderNotCompleted();

  const orderFacts = await deps.facts.list({ orderPublicId: draft.orderPublicId });
  const raterFact = orderFacts.find((fact) => fact.subjectPublicId === draft.raterPublicId);
  const subjectFact = orderFacts.find((fact) => fact.subjectPublicId === draft.subjectPublicId);
  if (raterFact === undefined || subjectFact === undefined) throw ratingPartyMismatch();
  if (raterFact.subjectType !== draft.raterType) throw ratingPartyMismatch();

  const subjectType = subjectFact.subjectType;
  // `ck_reputation_ratings_cross_side`: التقييمُ يعبُر الجانبين، ولا يُقيّم أحدٌ نظيرَه.
  if (subjectType === draft.raterType) throw ratingPartyMismatch();

  /**
   * النافذةُ تُحسب من **اكتمال الطلب** لا من لحظة الطلب ولا من لحظة الوصول.
   *
   * والحدُّ من نسخة القواعد (`ratingWindowHours`) لا رقماً مضمَّناً. ونافذةٌ مفتوحةٌ بلا
   * حدٍّ كانت ستسمح بتقييمٍ بعد شهرين يُغيّر رقماً بُنيت عليه قراراتٌ في الأثناء.
   */
  const deadline = addHours(completion.occurredAt, ruleset.ratingWindowHours);
  if (toEpochMillis(draft.submittedAt, "submittedAt") > toEpochMillis(deadline, "deadline")) {
    throw ratingWindowClosed(ruleset.ratingWindowHours);
  }

  const already = await deps.ratings.findByOrderPair(
    draft.orderPublicId,
    draft.raterPublicId,
    draft.subjectPublicId,
  );
  if (already !== null) throw ratingAlreadySubmitted();

  const rating = await deps.ratings.insert({
    id: deps.ids.uuid(),
    orderPublicId: draft.orderPublicId,
    raterType: draft.raterType,
    raterPublicId: draft.raterPublicId,
    subjectType,
    subjectPublicId: draft.subjectPublicId,
    stars: draft.stars,
    reasonCode: draft.reasonCode,
    rulesetVersion: ruleset.rulesetVersion,
    submittedAt: draft.submittedAt,
  });

  /**
   * تسلسلُ الواقعة المُشتقّة = أحدثُ تسلسلٍ لهذا (الشخص × الطلب) + 1.
   *
   * التقييمُ ليس حدثاً في محرّك الطلب فلا تسلسلَ له من هناك، ومواصلةُ تسلسل الشخص على
   * نفس الطلب تُحقّق أمرين: تفرّدُ `ux_reputation_facts_source` يبقى صحيحاً، وحرسُ
   * التأخّر في `recordFact` يبقى رتيباً فلا تُرفَض واقعةٌ لاحقةٌ مشروعة.
   */
  const nextSequence =
    ((await deps.facts.latestSourceSequence(
      subjectType,
      draft.subjectPublicId,
      draft.orderPublicId,
    )) ?? 0) + 1;

  const recorded = await recordFact(deps, {
    draft: {
      subjectType,
      subjectPublicId: draft.subjectPublicId,
      factKind: RATING_FACT_KIND,
      orderPublicId: draft.orderPublicId,
      sourceEventType: RATING_SOURCE_EVENT_TYPE,
      sourceEventId: rating.id,
      sourceSequence: nextSequence,
      actorType: draft.raterType,
      // لا `reasonCode` على الواقعة: سببُ التقييم يعيش في صفّ التقييم، ونسخُه إلى
      // الدفتر كان سيُنشئ نسختين لحقيقةٍ واحدة تتفارقان عند أوّل تصحيح.
      reasonCode: null,
      occurredAt: draft.submittedAt,
      traceId,
    },
    traceId,
  });

  await deps.outbox.append(
    [
      ratingSubmitted({
        meta: { eventId: deps.ids.uuid(), occurredAt: rating.submittedAt, traceId },
        ratingId: rating.id,
        orderPublicId: rating.orderPublicId,
        raterType: rating.raterType,
        raterPublicId: rating.raterPublicId,
        subjectType: rating.subjectType,
        subjectPublicId: rating.subjectPublicId,
        stars: rating.stars,
        reasonCode: rating.reasonCode,
        rulesetVersion: rating.rulesetVersion,
        submittedAt: rating.submittedAt,
      }),
    ],
    rating.submittedAt,
  );

  await rememberIdempotency(deps, {
    idempotencyKey,
    operation: "submit_rating",
    fingerprint,
    subjectType,
    subjectPublicId: draft.subjectPublicId,
    at: deps.clock.now(),
  });

  return { rating, fact: recorded.fact, score: recorded.score };
}

/**
 * إعادةُ **نفس** نتيجة الطلب الأصليّ لمفتاحٍ مكرّرٍ ببصمةٍ مطابقة.
 *
 * تُقرأ من المخازن ولا تُعاد كتابةُ شيء: لا صفٌّ ثانٍ ولا حدثٌ ثانٍ ولا نقطةٌ ثانية. وهذا
 * هو معنى مفتاح المعالجة الواحدة، وهو الأمرُ الذي تُثبته بوّابةُ خروج الطور: «إعادةُ
 * التشغيل لا تُضاعف النقاط».
 */
async function replayResult(
  deps: ReputationDependencies,
  draft: {
    readonly orderPublicId: string;
    readonly raterPublicId: string;
    readonly subjectPublicId: string;
  },
): Promise<RatingSubmitResult> {
  const rating = await deps.ratings.findByOrderPair(
    draft.orderPublicId,
    draft.raterPublicId,
    draft.subjectPublicId,
  );
  if (rating === null) throw ratingAlreadySubmitted();

  const facts = await deps.facts.list({
    orderPublicId: rating.orderPublicId,
    subjectType: rating.subjectType,
    subjectPublicId: rating.subjectPublicId,
    factKind: RATING_FACT_KIND,
  });
  const fact = facts.find((candidate) => candidate.sourceEventId === rating.id);
  if (fact === undefined) throw ratingAlreadySubmitted();

  const score = await deps.scores.find(rating.subjectType, rating.subjectPublicId);
  if (score === null) throw ratingAlreadySubmitted();

  return { rating, fact, score };
}
