/**
 * النبضة: إعادةُ حسابِ المستحقّين، وتقييمُ قواعد الاحتيال، ورفعُ ما تجاوز عتبته.
 *
 * ## لا مؤقّتَ ولا `sleep`
 *
 * النبضةُ دالّةٌ تُستدعى — من `POST /reputation/tick` أو من مُشغّلٍ خارجيّ — وتنتهي.
 * لا `setInterval` في المجال ولا انتظارَ زمنٍ حقيقيّ. والاستحقاقُ محفوظٌ في
 * `next_recompute_at` في القاعدة لا في ذاكرة عمليّة، فإعادةُ التشغيل تُؤخّر الاكتشاف
 * ولا تُلغي الاستحقاق، ونسختان تركضان معاً لا تتصارعان على مؤقّت.
 *
 * ## النافذةُ تُحسب ولا تُخمَّن
 *
 * نافذةُ الاحتيال سلّةٌ يوميّةٌ بتوقيت UTC: `endedAt` = بدايةُ الغد، و`startedAt` =
 * `endedAt −` `fraudWindowDays`. ولذلك كلُّ نبضاتِ اليوم الواحد تُنتج **نفس** النافذة،
 * وتفرّدُ `ux_fraud_signals_rule_window` يجعل الإشارةَ الثانيةَ في نفس اليوم مستحيلة.
 * البديلُ — نافذةٌ تنتهي «الآن» — كان سيرفع إشارةً في كل نبضة، فتُغرَق لوحةُ المراجعة
 * ويُطفئها من يقرؤها.
 *
 * ولا حاجةَ إلى تذكّر «متى ركضت آخر مرّة»: حدُّ النافذة مُشتقٌّ من اللحظة، فالنبضةُ
 * **قابلةٌ للتكرار** بمعناها الدقيق، لا «تعمل مرّةً واحدة إن لم يُخطئ أحد».
 *
 * ## الفشلُ يُعَدّ ولا يُرمى
 *
 * نبضةٌ تتوقّف عند أوّل شخصٍ يفشل تجعل عطلاً في صفٍّ واحدٍ يُوقف حسابَ الجميع. ولذلك كلُّ
 * شخصٍ يُعالَج على انفراد، والفشلُ يُحصى في `failures` ويُردّ في النتيجة (`TickResult` في
 * العقد) — وتلك عبارةُ `errors.md`: «فشلُ النبضة يُعَدّ ولا يُرمى».
 */

import { evaluateFraudRules } from "../domain/fraud.js";
import { fraudSignalRaised, type ReputationDomainEvent } from "../domain/events.js";
import type { FraudSignalRow, ReputationScoreRow } from "../domain/model.js";
import { fraudWindowFor } from "../domain/time.js";
import type { ReputationDependencies } from "../ports.js";
import { DEFAULT_TICK_LIMIT, recomputeSubjectScore, requireActiveRuleset } from "./shared.js";

export interface TickResult {
  readonly ranAt: string;
  readonly scoresRecomputed: number;
  readonly tiersChanged: number;
  readonly fraudSignalsRaised: number;
  readonly failures: number;
}

export async function runTick(
  deps: ReputationDependencies,
  input: { readonly limit?: number; readonly traceId?: string | null } = {},
): Promise<TickResult> {
  const ranAt = deps.clock.now();
  const traceId = input.traceId ?? null;
  const limit = input.limit ?? DEFAULT_TICK_LIMIT;

  const ruleset = await requireActiveRuleset(deps);
  const window = fraudWindowFor(ranAt, ruleset.fraudWindowDays);

  const due = await deps.scores.listDueForRecompute(ranAt, limit);

  let scoresRecomputed = 0;
  let tiersChanged = 0;
  let fraudSignalsRaised = 0;
  let failures = 0;

  for (const row of due) {
    try {
      const outcome = await recomputeSubjectScore(deps, {
        subjectType: row.subjectType,
        subjectPublicId: row.subjectPublicId,
        ruleset,
        trigger: "tick",
        at: ranAt,
        traceId,
      });
      await deps.outbox.append(outcome.events, ranAt);
      scoresRecomputed += 1;
      if (outcome.tierDidChange) tiersChanged += 1;

      fraudSignalsRaised += await raiseFraudSignalsFor(deps, {
        score: row,
        window,
        ruleset,
        ranAt,
        traceId,
      });
    } catch {
      /**
       * الاستثناءُ يُحصى ولا يُبتلَع في صمتٍ ولا يُوقف النبضة.
       *
       * ولا يُعاد رميُه: `TickResult.failures` هو السطحُ الذي يقرؤه المُشغّل والمراقبة،
       * ورميُه كان سيُخفي عددَ من نجح ويُظهر النبضةَ كأنّها لم تعمل أصلاً.
       */
      failures += 1;
    }
  }

  return { ranAt, scoresRecomputed, tiersChanged, fraudSignalsRaised, failures };
}

/**
 * تقييمُ القواعد الخمس لشخصٍ في نافذةٍ، ورفعُ ما تجاوز عتبته — مرّةً واحدة لكل
 * (قاعدة × شخص × نافذة).
 *
 * القواعدُ نقيّة: تُعطى وقائعَ وتقييماتٍ ونسخةَ قواعدٍ ونافذة، وتُعيد مسوّدةَ إشارةٍ أو
 * لا شيء. ولا حالةَ فيها ولا نموذجَ ولا احتمال (ADR-014 القرار 6): إشارةٌ **مُسمّاة**
 * يُمكن أن يُقال لصاحبها بأي لغة «هذه القاعدة، وهذا عددُك، وهذه عتبتُها» — وذاك ما لا
 * يستطيعه نموذجٌ احتماليّ، ولا يجوز أن يُبنى عليه إيقافُ رزق أحد.
 *
 * ووجودُ إشارةٍ لنفس المفتاح يعني «رُفعت»، فلا تُرفَع ثانيةً ولا يُردّ خطأ: إعادةُ النبضة
 * حالةٌ عاديّة (`errors.md` §ما لا يُنتجه أي رمز).
 */
async function raiseFraudSignalsFor(
  deps: ReputationDependencies,
  input: {
    readonly score: ReputationScoreRow;
    readonly window: { readonly startedAt: string; readonly endedAt: string };
    readonly ruleset: Awaited<ReturnType<typeof requireActiveRuleset>>;
    readonly ranAt: string;
    readonly traceId: string | null;
  },
): Promise<number> {
  const { subjectType, subjectPublicId } = input.score;

  const facts = await deps.facts.listBySubject(subjectType, subjectPublicId);
  const ratingsAuthored = await deps.ratings.listByRater(subjectPublicId);

  const drafts = evaluateFraudRules({
    subjectType,
    subjectPublicId,
    window: input.window,
    facts,
    ratingsAuthored,
    ruleset: input.ruleset,
  });

  let raised = 0;
  const events: ReputationDomainEvent[] = [];

  for (const draft of drafts) {
    const already = await deps.fraudSignals.findByRuleWindow(
      draft.subjectType,
      draft.subjectPublicId,
      draft.ruleCode,
      draft.windowEndedAt,
    );
    if (already !== null) continue;

    const signal: FraudSignalRow = await deps.fraudSignals.insert({
      id: deps.ids.uuid(),
      subjectType: draft.subjectType,
      subjectPublicId: draft.subjectPublicId,
      ruleCode: draft.ruleCode,
      severity: draft.severity,
      windowStartedAt: draft.windowStartedAt,
      windowEndedAt: draft.windowEndedAt,
      observedCount: draft.observedCount,
      thresholdCount: draft.thresholdCount,
      rulesetVersion: draft.rulesetVersion,
      raisedAt: input.ranAt,
      traceId: input.traceId,
    });

    events.push(
      fraudSignalRaised({
        meta: { eventId: deps.ids.uuid(), occurredAt: input.ranAt, traceId: input.traceId },
        signalId: signal.id,
        subjectType: signal.subjectType,
        subjectPublicId: signal.subjectPublicId,
        ruleCode: signal.ruleCode,
        severity: signal.severity,
        observedCount: signal.observedCount,
        thresholdCount: signal.thresholdCount,
        windowStartedAt: signal.windowStartedAt,
        windowEndedAt: signal.windowEndedAt,
        rulesetVersion: signal.rulesetVersion,
      }),
    );
    raised += 1;
  }

  if (events.length > 0) await deps.outbox.append(events, input.ranAt);
  return raised;
}
