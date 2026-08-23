/**
 * إعادةُ حسابٍ مطلوبةٌ صراحةً لشخصٍ واحد.
 *
 * تُستدعى من `POST /reputation/scores/{subjectType}/{subjectPublicId}/recompute` (المراجعة
 * 4/6) وفي التحقيقات. لا تُصلح شيئاً ولا تُعدّل دفتراً: تُعيد قراءةَ الدفتر وتحسب من
 * جديد. وإن كان الرقمُ مختلفاً فالعلّةُ في نسخة قواعدٍ تغيّرت أو في نبضةٍ لم تركض، لا في
 * الحاسبة — والحاسبةُ نقيّةٌ فيُعاد إنتاجُ ناتجها بنفس المدخل دائماً.
 */

import type { ReputationSubjectType } from "../domain/contract-sets.js";
import { scoreNotFound, scoreStale } from "../domain/errors.js";
import type { ReputationRecordedResponse, ReputationScoreRow } from "../domain/model.js";
import type { ReputationDependencies } from "../ports.js";
import {
  checkIdempotency,
  domainRecordedResponse,
  fingerprintOf,
  type RecordedResponseOf,
  recomputeSubjectScore,
  rememberIdempotency,
  requireActiveRuleset,
} from "./shared.js";
import { assertSubjectType, assertWaslaPublicId } from "../domain/validation.js";

export interface RecomputeScoreResult {
  readonly score: ReputationScoreRow;
  readonly previous: ReputationScoreRow | null;
  readonly tierDidChange: boolean;
  /** جوابُ المرّة الأولى كما حَفِظَه من نادى — في الإعادة وحدها. */
  readonly replayedResponse?: ReputationRecordedResponse;
}

export async function recomputeScore(
  deps: ReputationDependencies,
  input: {
    readonly subjectType: ReputationSubjectType;
    readonly subjectPublicId: string;
    /**
     * حرسُ تزامنٍ متفائل: «أعِد الحساب فقط إن كانت النتيجةُ التي رأيتُها ما زالت الأحدث».
     *
     * غيابُه يعني «أعِد الحساب على أي حال»، ووجودُه بقيمةٍ لا تُطابق المُخزَّن يعني أنّ
     * الدفترَ تحرّك بعد أن قرأ المستدعي، فيُردّ `REPUTATION_SCORE_STALE` (409) بدل أن
     * يُكتب فوق حسابٍ أحدث. وبلا هذا الحرس كانت واجهةٌ إداريّةٌ تُعيد الحساب مرّتين
     * بالتوازي تُنتج ترتيباً غيرَ معروفٍ للكتابتين.
     */
    readonly ifComputedThroughFactId?: string | null;
    readonly idempotencyKey?: string | null;
    readonly traceId?: string | null;
    /** كيف يُترجم من نادى النتيجةَ إلى جوابٍ يُعاد حرفياً عند التكرار. */
    readonly recordedResponse?: RecordedResponseOf<RecomputeScoreResult>;
  },
): Promise<RecomputeScoreResult> {
  const subjectType = assertSubjectType(input.subjectType);
  const subjectPublicId = assertWaslaPublicId(input.subjectPublicId);
  const traceId = input.traceId ?? null;

  const stored = await deps.scores.find(subjectType, subjectPublicId);
  const facts = await deps.facts.listBySubject(subjectType, subjectPublicId);

  /**
   * لا دفترَ ولا نتيجةَ مُخزَّنة ⇒ `404`.
   *
   * ولا تُختلَق نتيجةُ بدايةٍ لشخصٍ لم يفعل شيئاً: صفٌّ كهذا كان سيجعل «عددُ من لهم سمعة»
   * يساوي عددَ من فُتح لهم حساب، فيُقاس شيءٌ غيرُ الذي يُظنّ أنّه يُقاس.
   */
  if (stored === null && facts.length === 0) throw scoreNotFound(subjectType, subjectPublicId);

  if (
    input.ifComputedThroughFactId !== undefined &&
    input.ifComputedThroughFactId !== null &&
    (stored === null || stored.computedThroughFactId !== input.ifComputedThroughFactId)
  ) {
    throw scoreStale();
  }

  const fingerprint = fingerprintOf({ subjectType, subjectPublicId });
  if (input.idempotencyKey !== undefined && input.idempotencyKey !== null) {
    const decision = await checkIdempotency(deps, input.idempotencyKey, fingerprint);
    if (decision.kind === "replay" && stored !== null) {
      return {
        score: stored,
        previous: stored,
        tierDidChange: false,
        replayedResponse: decision.row.recordedResponse,
      };
    }
  }

  const ruleset = await requireActiveRuleset(deps);
  const at = deps.clock.now();
  const outcome = await recomputeSubjectScore(deps, {
    subjectType,
    subjectPublicId,
    ruleset,
    trigger: "manual_recompute",
    at,
    traceId,
  });

  await deps.outbox.append(outcome.events, at);

  const result: RecomputeScoreResult = {
    score: outcome.score,
    previous: outcome.previous,
    tierDidChange: outcome.tierDidChange,
  };

  if (input.idempotencyKey !== undefined && input.idempotencyKey !== null) {
    await rememberIdempotency(deps, {
      idempotencyKey: input.idempotencyKey,
      operation: "recompute_score",
      fingerprint,
      subjectPublicId,
      recordedResponse: (input.recordedResponse ?? domainRecordedResponse)(result),
      at,
    });
  }

  return result;
}
