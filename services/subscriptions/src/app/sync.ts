/**
 * المسارُ الواحدُ للكتابة: **مُدّةٌ ← اشتقاقٌ ← انتقالٌ عند التغيّر ← صفٌّ مُتحقِّق**.
 *
 * ## لماذا دالّةٌ واحدةٌ لكلّ الكتابات
 *
 * منحُ التجربة، والتفعيلُ بدفع، وإعادةُ الحساب، والنبضةُ — أربعةُ مسالكَ تنتهي كلُّها إلى
 * نفسِ السؤال: «ما الحالةُ التي يقولها الدفترُ الآن؟». ونسخةٌ لكلّ مسلكٍ كانت ستُنتج أربعةَ
 * أماكنَ تُقرّر متى يُكتب انتقالٌ ومتى لا — ويكفي أن يختلف واحدٌ منها ليصير للسائق تاريخٌ
 * لا يُقرأ (تفعيلٌ بلا انتقالٍ، أو انتقالٌ بلا تغيّرِ حالة).
 *
 * فهنا القرارُ مكتوبٌ مرّةً: **الاشتقاقُ يُقرَّر من الدفتر بعد الكتابة**، لا من المُدّةِ التي
 * كُتبت. والفرقُ حقيقيّ: مُدّةٌ مدفوعةٌ تبدأ **بعد** نهايةِ التجربة (`laterOf`) لا تُغيّر حالةَ
 * اليوم — فالسائقُ يبقى `trial` ولا يُكتب انتقالٌ، ويُقرأ في `expires_at` مدىً أطول. وحسابُ
 * الحالة من المُدّة الجديدة وحدَها كان سيقول `active` قبل أن يبدأ الدفعُ فعلاً.
 *
 * ## ومتى يُكتب انتقال؟ عند تغيّرِ الحالة وحدَه
 *
 * التجديدُ (دفعٌ يمتدّ فوق تغطيةٍ سارية) **لا يكتب انتقالاً**: `active → active` غيرُ مُعلَنٍ
 * في `SUBSCRIPTION_ALLOWED_TRANSITIONS`، والقاعدةُ تحرسه بـ`ck_subscription_transitions_state_changes`.
 * فالحارسُ هنا ليس `if` مُخترعاً بل قراءةُ نفسِ الجدول: نُقارن الحالةَ المُشتقّة بحالةِ الصفّ،
 * فإن تساوَيا فلا انتقال — والمُدّةُ وحدَها هي الأثرُ، وهو أثرٌ كافٍ لأنّ الدفترَ يحملها.
 *
 * ## وترتيبُ الكتابات مقصود
 *
 * المُدّةُ أوّلاً لأنّ الاشتقاقَ يقرؤها؛ ثمّ الانتقالُ لأنّ `state_sequence` في الصفّ المُتحقِّق
 * يجب أن يُطابق `sequence` آخرِ انتقالٍ (نصُّ العقد)؛ ثمّ الصفُّ. وكلُّها في معاملةٍ واحدة
 * (`db/unit-of-work.ts`)، فالفشلُ الجزئيُّ غيرُ ممكن.
 */

import { validationFailed } from "../domain/errors.js";
import type { DerivedSubscription, PeriodDraft, PlanVersion } from "../domain/model.js";
import { deriveState, firstCoverageStart, governingPeriod } from "../domain/state.js";
import { draftTransition, transitionPath } from "../domain/transitions.js";
import type { LedgerTrace, PeriodRecord, TransitionRecord } from "../db/repository.js";
import type { ProjectionRecord } from "../db/projection.js";
import type { SubscriptionStores, TransactionProbe } from "../db/unit-of-work.js";
import { toOutboxDraft, transitionEvent, type IdGenerator } from "./events.js";

export interface SyncInput {
  readonly stores: SubscriptionStores;
  readonly driverPublicId: string;
  readonly plan: PlanVersion;
  readonly now: string;
  /** مُدّةٌ تُضاف قبل الاشتقاق — غائبةٌ في إعادةِ الحساب وفي النبضة. */
  readonly grant?: PeriodDraft;
  readonly trace?: LedgerTrace;
  readonly probe?: TransactionProbe;
  /**
   * مُوَلِّدُ مُعرِّفاتِ الأحداث — **إلزاميّ**، ولا افتراضَ له.
   *
   * ولمَ لا وسيطٌ اختياريٌّ يُطفئ النشرَ حين يُهمَل؟ لأنّ ذاك بعينه ما يُنتج خدمةً تكتب
   * انتقالاتِها ولا تُعلنها: مسارٌ واحدٌ نُسي فيه الوسيطُ يصمت بلا أن يفشل شيء، ويُكتشف
   * بعد شهرٍ في لوحةِ مستهلكٍ ناقصة. فالإلزامُ هنا هو ما يجعل «كلُّ انتقالٍ يُنشَر» حكماً
   * يفحصه `tsc` لا اتفاقاً شفهيّاً.
   */
  readonly ids: IdGenerator;
}

export interface SyncOutcome {
  readonly projection: ProjectionRecord;
  readonly derived: DerivedSubscription;
  /** الانتقالُ إن وقع تغيّرٌ، و`null` في التجديدِ وفي إعادةِ حسابٍ لا تُغيّر شيئاً. */
  readonly transition: TransitionRecord | null;
  readonly period: PeriodRecord | null;
  readonly changed: boolean;
  /**
   * مُعرِّفاتُ الأحداثِ التي كُتبت في صندوق الصادرِ لهذه العملية — واحدٌ لكلّ وثبة.
   *
   * تُعاد لتُقرأ في الاختبارِ وفي التقارير: عمليّةٌ تقول `changed: true` وتُعيد قائمةً فارغةً
   * عطبٌ يجب أن يُرى، ولا سبيلَ لرؤيته من خارج المعاملةِ إلّا بقراءةِ الجدول.
   */
  readonly eventIds: readonly string[];
}

/**
 * يُنفّذ المسارَ كلَّه على مخازنِ معاملةٍ واحدة، ويُعيد ما استقرّ فعلاً لا ما نوى.
 *
 * `probe` خطّافُ اختبارِ الذرّيّة وحدَه (انظر `db/unit-of-work.ts`): لا مسارَ حقيقيَّ يُمرّره.
 */
export async function syncFromLedger(input: SyncInput): Promise<SyncOutcome> {
  const { stores, driverPublicId, plan, now, grant, trace, probe, ids } = input;

  const period = grant ? await stores.ledger.insertPeriod(grant, trace ?? {}) : null;
  if (probe) await probe("after-period");

  const periods = await stores.ledger.listPeriods(driverPublicId);
  const derived = deriveState(periods, plan, now);
  if (!derived) {
    // دفترٌ فارغٌ بعد منحةٍ مستحيلٌ (المنحةُ نفسُها مدّة)، وبلا منحةٍ يجب أن يُنادى هذا
    // المسارُ أصلاً. فالرفضُ صريحٌ بدل صفٍّ مُتحقِّقٍ لا حالةَ له.
    throw validationFailed("driver_public_id", "driver with at least one period");
  }

  const stored = await stores.projection.read(driverPublicId);
  const fromState = stored?.state ?? null;
  const governing = governingPeriod(periods, now);
  const startedAt = firstCoverageStart(periods)!;

  // ## الطريقُ كاملاً لا وثبةٌ واحدة
  //
  // الاشتقاقُ يقفز حالاتٍ حين يطول غيابُ النبضة: صفٌّ يقول `trial` ودفترٌ يقول
  // `community`. وزوجٌ واحدٌ من `trial` إلى `community` غيرُ مُعلَنٍ — فكانت العمليّةُ
  // تُرفض 409 وتُعدّ فشلاً دائماً في النبضة (خللٌ وُجد في تكامل 4/6). فالأزواجُ تُكتب
  // متسلسلةً في **نفسِ المعاملة**، فيبقى الدفترُ قارئاً: انقضى ثمّ نزل إلى الأرضيّة.
  //
  // والمصدرُ يُمرّر للوثبةِ الأخيرةِ وحدَها: المُدّةُ الحاكمةُ تفسّر الحالةَ التي
  // استقرّ عليها لا الحالاتِ التي عبرَها، وإسنادُ مُدّةٍ مدفوعةٍ إلى «انقضى» يقلب معنى السبب.
  let transition: TransitionRecord | null = null;
  const written: TransitionRecord[] = [];
  const hops = transitionPath(fromState, derived.state);
  for (const [index, [hopFrom, hopTo]] of hops.entries()) {
    const isLast = index === hops.length - 1;
    transition = await stores.ledger.insertTransition(
      {
        driverPublicId,
        // مصدرُ المُدّةِ الحاكمةِ هو سببُ الانتقال، ولا مصدرَ لانقضاءٍ أو نزولٍ إلى الأرضيّة.
        draft: draftTransition(hopFrom, hopTo, isLast ? (governing?.source ?? null) : null, now),
        periodId: isLast ? (governing?.periodId ?? null) : null,
      },
      trace ?? {},
    );
    written.push(transition);
  }
  if (probe) await probe("after-transition");

  // تسلسلُ الحالة: تسلسلُ الانتقالِ الجديد إن وقع، وإلّا تسلسلُ الصفِّ كما هو — فالتجديدُ
  // لا يُقدّم التسلسلَ لأنّه لم يُكتب انتقالٌ يُقدّمه، والعقدُ يقول «يُطابق آخرَ انتقال».
  const stateSequence = transition?.sequence ?? stored?.stateSequence;
  if (stateSequence === undefined) {
    throw validationFailed("state_sequence", "sequence from a stored or new transition");
  }

  const projection = await stores.projection.write({
    driverPublicId,
    state: derived.state,
    planCode: derived.planCode,
    planVersion: derived.planVersion,
    // الاقترانُ الملزم في `ck_subscriptions_period_state` مُشتَقٌّ هنا من نفسِ المصدر:
    // الحالتان المُغطّاتان لهما مُدّةٌ حاكمةٌ وانقضاءٌ، والحالتان الأخريان لا.
    currentPeriodId: derived.expiresAt === null ? null : (governing?.periodId ?? null),
    startedAt,
    expiresAt: derived.expiresAt,
    stateSequence,
    stateChangedAt: transition ? transition.occurredAt : (stored?.stateChangedAt ?? now),
    computedAt: derived.computedAt,
  });

  // ## النشرُ **بعد** الصفِّ المُتحقِّق، وفي نفسِ المعاملة
  //
  // بعدَه لأنّ حمولةَ الحدثِ تُلزم `subscription_id`، والمُعرِّفُ تُنشئه القاعدةُ عند أوّلِ
  // كتابةٍ للصفّ — فمنحُ تجربةٍ لا يعرف المُعرِّفَ قبل `projection.write`. وفي نفسِ المعاملة
  // لأنّ حدثاً يُكتب في معاملةٍ ثانيةٍ قد لا يُكتب أبداً، فيبقى الانتقالُ ثابتاً بلا إعلان.
  //
  // وحدثٌ لكلِّ وثبةٍ لا حدثٌ للطريق: طريقٌ من `trial` إلى `community` يعبر `expired`، وطيُّ
  // الوثبتين في حدثٍ واحدٍ كان سيُخفي **أنّ الاشتراكَ انقضى** — وهي الواقعةُ التي تُبنى
  // عليها المحاسبةُ اللاحقة.
  const eventIds: string[] = [];
  for (const hop of written) {
    const event = transitionEvent(hop, {
      meta: { eventId: ids.next(), occurredAt: now, traceId: trace?.traceId ?? null },
      subscriptionId: projection.subscriptionId,
      planCode: projection.planCode,
      planVersion: projection.planVersion,
      expiresAt: projection.expiresAt,
      governing: governing ?? null,
    });
    await stores.outbox.append(toOutboxDraft(event));
    eventIds.push(event.event_id);
  }

  return { projection, derived, transition, period, changed: transition !== null, eventIds };
}
