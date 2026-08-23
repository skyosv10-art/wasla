/**
 * تسجيلُ واقعةٍ في الدفتر ثم إعادةُ حسابِ النتيجة.
 *
 * هذه الحالةُ هي **المدخلُ الوحيد** إلى الدفتر: لا كتابةَ واقعةٍ في أي موضعٍ آخر، ولا
 * تعديلَ نتيجةٍ إلّا من الدفتر. ومَن يستدعيها إمّا مستهلكُ أحداث محرّك الطلب (المراجعة
 * 5/6) أو `POST /reputation/facts` (المراجعة 4/6) أو `submitRating` داخلياً — والثلاثةُ
 * تمرّ على نفس الحرّاس بنفس الترتيب.
 *
 * ## الترتيبُ مقصود
 *
 *   1. تحقُّقُ الشكل (400).
 *   2. النسخةُ النشطة، ووجودُ وزنٍ مُعلَن لهذا (الجانب × نوع الواقعة) (422).
 *   3. **التكرار قبل التأخّر**: إعادةُ تسليمٍ بنفس الحمولة تُعاد كـ`duplicate` قبل أن
 *      يفحصها حرسُ التسلسل. ولو انعكس الترتيب لصارت كلُّ إعادةِ تسليمٍ من الناقل —
 *      وهي أمرٌ يقع كل يوم — خطأً 422، فيُقرأ نظامٌ سليم كنظامٍ يفشل ألفَ مرّة.
 *   4. التأخّرُ في الوصول (422).
 *   5. الكتابة، ثم إعادةُ الحساب، ثم الأحداث في **نفس** المعاملة عبر صندوق الصادر.
 *
 * ## `at-least-once` ليس خطأً (`errors.md` القاعدة 4)
 *
 * نفسُ مفتاح المصدر بنفس الحمولة ⇒ `200` و`duplicate: true` والنتيجةُ الحالية، ولا نقطةَ
 * تُضاف. ونفسُ المفتاح بحمولةٍ **مختلفة** ⇒ `409 REPUTATION_FACT_ALREADY_RECORDED`،
 * لأنّ ذاك ليس إعادةَ تسليمٍ بل مصدرَين يقولان شيئين عن نفس الواقعة، ولا يجوز أن نختار
 * أحدهما بصمت.
 */

import { factAlreadyRecordedWithDifferentPayload, sourceEventStale } from "../domain/errors.js";
import { factRecorded, type ReputationDomainEvent } from "../domain/events.js";
import type {
  ReputationFactDraft,
  ReputationFactRow,
  ReputationRecordedResponse,
  ReputationScoreRow,
} from "../domain/model.js";
import { weightFor } from "../domain/ruleset.js";
import { assertTimestamp } from "../domain/time.js";
import {
  assertActorType,
  assertFactKind,
  assertFactReasonCode,
  assertOrderPublicId,
  assertSourceEventId,
  assertSourceEventType,
  assertSourceSequence,
  assertSubjectType,
  assertWaslaPublicId,
} from "../domain/validation.js";
import type { FactSourceKey, ReputationDependencies } from "../ports.js";
import {
  checkIdempotency,
  domainRecordedResponse,
  fingerprintOf,
  type RecordedResponseOf,
  recomputeSubjectScore,
  rememberIdempotency,
  requireActiveRuleset,
} from "./shared.js";

export interface FactRecordResult {
  readonly fact: ReputationFactRow;
  readonly score: ReputationScoreRow;
  /** `true` يعني: هذه الواقعةُ كانت مسجَّلةً، ولم تُضَف نقطةٌ ثانية. */
  readonly duplicate: boolean;
  /**
   * جوابُ المرّة الأولى كما حَفِظَه من نادى — يوجد حين يُمرَّر مفتاحٌ ويكون معروفاً فقط.
   *
   * ويُلاحظ أنّ `duplicate: true` لا يلزم منه وجودُه: إعادةُ تسليمٍ من الناقل تُكتشف
   * بمفتاح المصدر ولو لم يكن للمُرسِل مفتاحُ معالجةٍ واحدة أصلاً.
   */
  readonly replayedResponse?: ReputationRecordedResponse;
}

/** الحمولةُ بعد التحقُّق — أنواعٌ مُضيَّقة، فلا `unknown` يعبُر إلى ما بعد هذا الحدّ. */
function validateDraft(draft: ReputationFactDraft): ReputationFactDraft {
  return {
    subjectType: assertSubjectType(draft.subjectType),
    subjectPublicId: assertWaslaPublicId(draft.subjectPublicId),
    factKind: assertFactKind(draft.factKind),
    orderPublicId: assertOrderPublicId(draft.orderPublicId),
    sourceEventType: assertSourceEventType(draft.sourceEventType),
    sourceEventId: assertSourceEventId(draft.sourceEventId),
    sourceSequence: assertSourceSequence(draft.sourceSequence),
    actorType: assertActorType(draft.actorType),
    reasonCode: assertFactReasonCode(draft.reasonCode),
    occurredAt: assertTimestamp(draft.occurredAt, "occurredAt"),
    traceId: draft.traceId ?? null,
  };
}

function sourceKeyOf(draft: ReputationFactDraft): FactSourceKey {
  return {
    subjectType: draft.subjectType,
    subjectPublicId: draft.subjectPublicId,
    factKind: draft.factKind,
    orderPublicId: draft.orderPublicId,
    sourceSequence: draft.sourceSequence,
  };
}

/**
 * هل الصفُّ المسجَّل **نفسُ** الواقعة؟
 *
 * تُقارَن الحقولُ التي تصف الواقعة في العالم: مُعرّفُ حدث المصدر ونوعُه ومَن فعله وسببُه
 * ولحظةُ وقوعه. ولا يُقارَن `recordedAt` ولا `id` ولا `traceId`: الثلاثةُ من **عندنا**
 * لا من الواقعة، ومقارنتُها كانت ستجعل كلَّ إعادةِ تسليمٍ «حمولةً مختلفة» فيُردّ 409 على
 * الحالة الطبيعية بعينها.
 */
function isSamePayload(existing: ReputationFactRow, draft: ReputationFactDraft): boolean {
  return (
    existing.sourceEventId === draft.sourceEventId &&
    existing.sourceEventType === draft.sourceEventType &&
    existing.actorType === draft.actorType &&
    existing.reasonCode === draft.reasonCode &&
    existing.occurredAt === draft.occurredAt
  );
}

export async function recordFact(
  deps: ReputationDependencies,
  input: {
    readonly draft: ReputationFactDraft;
    readonly traceId?: string | null;
    /**
     * مفتاحُ معالجةٍ واحدة من مُرسِل يملك واحداً — **اختياريّ وليس بديلاً عن مفتاح المصدر**.
     *
     * الدفترُ محميٌّ أصلاً بـ`ux_reputation_facts_source`، فإعادةُ التسليم تُكتشف بلا مفتاح.
     * والمفتاحُ يزيد شيئين لا يقدر عليهما مفتاحُ المصدر: مفتاحٌ واحد بحمولتين مختلفتين يُردَّ
     * `409 REPUTATION_IDEMPOTENCY_KEY_REUSED` بدل أن يُكتب واقعتين؛ وجوابُ التكرار يُعاد
     * محفوظاً لا مُعادَ التركيب.
     */
    readonly idempotencyKey?: string | null;
    /** كيف يُترجم من نادى النتيجةَ إلى جوابٍ يُعاد حرفياً عند التكرار. */
    readonly recordedResponse?: RecordedResponseOf<FactRecordResult>;
  },
): Promise<FactRecordResult> {
  const draft = validateDraft(input.draft);
  const traceId = input.traceId ?? draft.traceId ?? null;
  const ruleset = await requireActiveRuleset(deps);

  // وزنٌ غيرُ مُعلَن ⇒ رفضٌ مُسمّى قبل أي كتابة. لا `?? 0` (انظر `weightFor`).
  weightFor(ruleset, draft.subjectType, draft.factKind);

  /**
   * حرسُ المفتاح قبل قراءة المصدر وقبل أي كتابة.
   *
   * والبصمةُ من الحمولة المتحقَّق منها لا من الخام: فراغٌ زائد أو ترتيبٌ مختلف للمفاتيح
   * ليس حمولةً مختلفة، ومُرسِلٌ يُعيد نفسَ الطلب لا يُردَّ عليه بـ409 من أجل فراغ.
   */
  const fingerprint = fingerprintOf(draft);
  let replayedResponse: ReputationRecordedResponse | undefined;
  if (input.idempotencyKey !== undefined && input.idempotencyKey !== null) {
    const decision = await checkIdempotency(deps, input.idempotencyKey, fingerprint);
    if (decision.kind === "replay") replayedResponse = decision.row.recordedResponse;
  }

  const existing = await deps.facts.findBySource(sourceKeyOf(draft));
  if (existing !== null) {
    if (!isSamePayload(existing, draft)) throw factAlreadyRecordedWithDifferentPayload();
    return {
      fact: existing,
      score: await currentOrRecomputedScore(deps, existing, traceId),
      duplicate: true,
      replayedResponse,
    };
  }

  /**
   * التأخّرُ في الوصول: تسلسلٌ لا يزيد على أحدث ما سُجّل لهذا (الشخص × الطلب).
   *
   * المقارنةُ `<=` لا `<`: تسلسلٌ مساوٍ بنوعِ واقعةٍ مختلف يعني حدثاً واحداً في المصدر
   * فُسِّر مرّتين، وقبولُه كان سيُسجّل واقعتين لانتقالٍ واحد.
   */
  const latest = await deps.facts.latestSourceSequence(
    draft.subjectType,
    draft.subjectPublicId,
    draft.orderPublicId,
  );
  if (latest !== null && draft.sourceSequence <= latest) throw sourceEventStale(latest);

  const recordedAt = deps.clock.now();
  const fact = await deps.facts.insert({
    id: deps.ids.uuid(),
    subjectType: draft.subjectType,
    subjectPublicId: draft.subjectPublicId,
    factKind: draft.factKind,
    orderPublicId: draft.orderPublicId,
    sourceEventType: draft.sourceEventType,
    sourceEventId: draft.sourceEventId,
    sourceSequence: draft.sourceSequence,
    actorType: draft.actorType,
    reasonCode: draft.reasonCode,
    occurredAt: draft.occurredAt,
    recordedAt,
    traceId,
  });

  const outcome = await recomputeSubjectScore(deps, {
    subjectType: fact.subjectType,
    subjectPublicId: fact.subjectPublicId,
    ruleset,
    trigger: "fact_recorded",
    at: recordedAt,
    traceId,
  });

  const events: ReputationDomainEvent[] = [
    factRecorded({
      meta: { eventId: deps.ids.uuid(), occurredAt: recordedAt, traceId },
      factId: fact.id,
      subjectType: fact.subjectType,
      subjectPublicId: fact.subjectPublicId,
      factKind: fact.factKind,
      orderPublicId: fact.orderPublicId,
      sourceEventType: fact.sourceEventType,
      sourceEventId: fact.sourceEventId,
      sourceSequence: fact.sourceSequence,
      actorType: fact.actorType,
      reasonCode: fact.reasonCode,
      factOccurredAt: fact.occurredAt,
    }),
    ...outcome.events,
  ];
  await deps.outbox.append(events, recordedAt);

  const result: FactRecordResult = { fact, score: outcome.score, duplicate: false };

  if (input.idempotencyKey !== undefined && input.idempotencyKey !== null) {
    await rememberIdempotency(deps, {
      idempotencyKey: input.idempotencyKey,
      operation: "record_fact",
      fingerprint,
      subjectPublicId: draft.subjectPublicId,
      recordedResponse: (input.recordedResponse ?? domainRecordedResponse)(result),
      at: recordedAt,
    });
  }

  return result;
}

/**
 * نتيجةُ صاحبِ واقعةٍ مكرّرة.
 *
 * تُقرأ المُخزَّنة إن وُجدت. وغيابُها مع وجودِ واقعةٍ في الدفتر يعني صفّاً ضائعاً (استعادةٌ
 * جزئية، أو كتابةٌ فُقدت)، فتُحسب وتُكتب هنا: ردُّ `404` على شخصٍ له دفترٌ كان سيجعل
 * إعادةَ تسليمٍ عاديّة تُخفي علّةً بدل أن تُصلحها. ولا تُصدَر أحداثٌ في هذا المسار: لا
 * واقعةَ جديدةَ وقعت، والحسابُ هنا إصلاحٌ لا قرار.
 */
async function currentOrRecomputedScore(
  deps: ReputationDependencies,
  fact: ReputationFactRow,
  traceId: string | null,
): Promise<ReputationScoreRow> {
  const stored = await deps.scores.find(fact.subjectType, fact.subjectPublicId);
  if (stored !== null) return stored;
  const ruleset = await requireActiveRuleset(deps);
  const outcome = await recomputeSubjectScore(deps, {
    subjectType: fact.subjectType,
    subjectPublicId: fact.subjectPublicId,
    ruleset,
    trigger: "manual_recompute",
    at: deps.clock.now(),
    traceId,
  });
  return outcome.score;
}
