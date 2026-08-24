/**
 * اشتقاقُ الحالة من دفترِ المُدَد — قلبُ ADR-015 القرار 2.
 *
 * ## القاعدة في سطر
 *
 * الحالةُ **دالّةٌ** من (المُدَدِ المُسجّلة · نسخةِ الخطّة · اللحظة). لا حقلَ `state` يكتبه
 * مسارٌ إداريٌّ حرّ، ولا مؤقّتَ يقلبها في الخلفية.
 *
 * ## لماذا لا يُكتب `state` مباشرةً
 *
 * النسخةُ الخاطئةُ الأرخص هي عمودُ `state` يُحدَّث بيدِ كلّ مسار: مسارُ الدفع يكتب
 * `active`، والنبضةُ تكتب `expired`، والإدارةُ تكتب ما تراه، ثم يظهر سائقٌ حالتُه `active`
 * وليس له مدةٌ سارية — ولا يوجد في النظام ما يقول أيُّ مسارٍ كتب ذلك ولا متى. أمّا الاشتقاقُ
 * من الدفتر فيجعل السؤالَ «لماذا هو `active`؟» مُجاباً دائماً: **لأنّ هذه المدة تُغطّي الآن**.
 * والصفُّ في `subscriptions` صفٌّ **متحقَّق** (materialized) لا مصدرَ حقيقة، ولذلك يحمل
 * `is_stale` ويُعاد بناؤه من الدفتر في `POST /subscriptions/{id}/recompute`.
 *
 * ## سلاسلُ التغطية (`coverage runs`)
 *
 * المُدَدُ تُدمَج في **سلاسلَ متلاصقة**: مدةٌ تبدأ عند نهايةِ سابقتها أو قبلَها تُمدّها،
 * والفراغُ بينهما يفصل سلسلتَين. وهذا هو ما يجعل التجديدَ **مدةً في الدفتر لا انتقالَ
 * `active → active`** (القرار 3): سلسلةٌ واحدةٌ من ثلاثِ مُدَدٍ تُنتج حالةً واحدةً مستمرّةً
 * تاريخُ انتهائها آخرُ نهايةٍ فيها، ولا حاجةَ إلى انتقالٍ يقول «تجدّد» ولا معنى تدقيقيّ له.
 *
 * الحدودُ نصفُ مفتوحة `[starts_at, ends_at)` (انظر `time.ts`): مدةٌ تنتهي في `T` لا تُغطّي
 * `T`، ومدةٌ تبدأ في `T` تُغطّيها. فلحظةُ الالتقاءِ مملوكةٌ لمدّةٍ واحدةٍ لا لمدّتَين.
 *
 * ## وبعد نهايةِ التغطية
 *
 * `expired` من نهايةِ التغطية حتى `نهاية التغطية + community_grace_days`، ثم `community`
 * إلى ما لا نهاية. ومهلةٌ صفرٌ تعني النزولَ فوراً بلا مرحلةٍ وسطى — وهذا حرفياً ما يقوله
 * القيدُ في `schema.sql`، والاختبارُ يُثبته لا يستنتجه.
 */

import { effectiveEntitlements } from "./entitlements.js";
import { validationFailed } from "./errors.js";
import type { DerivedSubscription, Period, PlanVersion } from "./model.js";
import { addDays, assertTimestamp, isAtOrAfter, isBefore, toEpochMillis } from "./time.js";

/** سلسلةُ تغطيةٍ متلاصقةٌ ومُدَدُها، للقراءةِ في الاختبار ولطبقاتٍ لاحقة. */
export interface CoverageRun {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly periods: ReadonlyArray<Period>;
}

function assertPeriod(period: Period): void {
  assertTimestamp(period.startsAt, "starts_at");
  assertTimestamp(period.endsAt, "ends_at");
  if (toEpochMillis(period.endsAt, "ends_at") <= toEpochMillis(period.startsAt, "starts_at")) {
    // مدةٌ لا تُغطّي شيئاً: نهايةٌ قبل بدايةٍ أو مساويةٌ لها. تُرفض هنا لا تُهمَل بصمت،
    // لأنّ إهمالَها يجعل دفترَ سائقٍ يبدو أقصرَ ممّا مُنح بلا سببٍ يُقرأ في السجل.
    throw validationFailed("ends_at", "instant strictly after starts_at");
  }
}

/**
 * دمجُ المُدَد في سلاسلَ متلاصقةٍ مرتَّبةً زمنياً.
 *
 * الفرزُ على (البداية ثمّ النهاية) كي يكون المُخرَجُ واحداً لأيّ ترتيبِ إدخال: دالّةٌ نقيّةٌ
 * تُعطي جوابَين لنفس المجموعةِ بترتيبَين مختلفَين ليست نقيّةً في المعنى الذي نريد.
 */
export function coverageRuns(periods: ReadonlyArray<Period>): ReadonlyArray<CoverageRun> {
  for (const period of periods) assertPeriod(period);
  const sorted = [...periods].sort(
    (left, right) =>
      toEpochMillis(left.startsAt) - toEpochMillis(right.startsAt) ||
      toEpochMillis(left.endsAt) - toEpochMillis(right.endsAt),
  );

  const runs: Array<{ startsAt: string; endsAt: string; periods: Period[] }> = [];
  for (const period of sorted) {
    const current = runs[runs.length - 1];
    // `<=` لا `<`: مدةٌ تبدأ في نفس لحظةِ انتهاءِ السلسلة تُمدّها ولا تفتح سلسلةً ثانية،
    // وإلّا ظهر سائقٌ «انقضى ثم عاد» في نفس الميلي-ثانية وله انتقالان لا حادثةَ لهما.
    if (current && toEpochMillis(period.startsAt) <= toEpochMillis(current.endsAt)) {
      current.periods.push(period);
      if (toEpochMillis(period.endsAt) > toEpochMillis(current.endsAt)) current.endsAt = period.endsAt;
      continue;
    }
    runs.push({ startsAt: period.startsAt, endsAt: period.endsAt, periods: [period] });
  }
  return runs.map((run) => Object.freeze({ ...run, periods: Object.freeze([...run.periods]) }));
}

/** آخرُ سلسلةٍ انتهت عند `now` أو قبلها. */
function lastEndedRun(runs: ReadonlyArray<CoverageRun>, now: string): CoverageRun | undefined {
  return [...runs].reverse().find((run) => isAtOrAfter(now, run.endsAt));
}

/** المدةُ التي تُغطّي `now` بنفسها داخل سلسلةٍ (لا السلسلةُ ككلّ). */
function coveringPeriods(run: CoverageRun, now: string): ReadonlyArray<Period> {
  return run.periods.filter(
    (period) => isAtOrAfter(now, period.startsAt) && isBefore(now, period.endsAt),
  );
}

/**
 * المدةُ الحاكمة بين مُدَدٍ تُغطّي اللحظةَ نفسها: المدفوعةُ أو المكافأةُ تسبق التجربة.
 *
 * ولمَ الأقوى يفوز؟ لأنّ سائقاً دفع وهو في تجربتِه لا يجوز أن يُقال له «أنت في تجربة»،
 * ولأنّ الحالةَ يجب أن تكون دالّةً من المجموعة لا من ترتيبِ الفرز.
 */
function strongestCovering(covering: ReadonlyArray<Period>): Period | undefined {
  return covering.find((period) => period.source !== "trial") ?? covering[0];
}

/**
 * المدةُ الحاكمةُ عند `now` إن وُجدت — **نفسُ قاعدةِ `deriveState`** لا قاعدةٌ ثانية.
 *
 * ولمَ تُصدَّر أصلاً؟ لأنّ الصفَّ المُتحقِّق يحمل `current_period_id`، و`DerivedSubscription`
 * لا تحمل مُعرّفاتٍ (ولا ينبغي: المجالُ يحسب على مُدَدٍ لا يملك هويّاتِها). فلو اختارت
 * طبقةُ التطبيق المُدّةَ بمنطقِها لصارت قاعدةُ «الأقوى يفوز» مكتوبةً مرتين، ويومَ تختلفان
 * يقول الصفُّ `active` ويُشير إلى مدّةِ تجربةٍ — ولا أحدَ يلاحِق أيّهما الصحيح.
 */
export function governingPeriod(periods: ReadonlyArray<Period>, now: string): Period | null {
  assertTimestamp(now, "now");
  const runs = coverageRuns(periods);
  const activeRun = runs.find(
    (run) => isAtOrAfter(now, run.startsAt) && isBefore(now, run.endsAt),
  );
  if (!activeRun) return null;
  return strongestCovering(coveringPeriods(activeRun, now)) ?? null;
}

/** بدايةُ أوّلِ تغطيةٍ في الدفتر — `started_at` للاشتراك لا للحالةِ الراهنة. */
export function firstCoverageStart(periods: ReadonlyArray<Period>): string | null {
  const runs = coverageRuns(periods);
  return runs[0]?.startsAt ?? null;
}

function assertGoverningPlan(period: Period, plan: PlanVersion): void {
  if (period.planCode !== plan.planCode || period.planVersion !== plan.planVersion) {
    // نسخةُ الخطّةِ الحاكمةُ هي نسخةُ **المدة** لا نسخةٌ يختارها المُنادي: لو قبلنا نسخةً
    // أخرى لحُسبت أرضيّةُ سائقٍ بأرقامِ خطّةٍ لم تُمنح له، وهذا بالضبط ما يجعل «النسخة»
    // حقلاً بلا معنى.
    throw validationFailed("plan_version", "plan version of the governing period");
  }
}

/**
 * اشتقاقُ الحالة. تُعيد `null` لسائقٍ لا مدةَ له: **لا اشتراكَ** حالةٌ رابعةٌ لا تُسمّى
 * `expired` — سائقٌ لم يبدأ تجربتَه بعدُ لم ينقضِ عنه شيء.
 *
 * `now` يجب أن تكون عند بدايةِ أوّلِ مدةٍ أو بعدها. لحظةٌ قبل الدفتر كلِّه ليست «قبل
 * الاشتراك» بل خطأٌ في المُنادي: حسابُ حالةٍ في ماضٍ لم يكن فيه للسائق سجلٌّ يُنتج جواباً
 * لا يمكن التحقّق منه، فيُرفض صريحاً.
 */
export function deriveState(
  periods: ReadonlyArray<Period>,
  plan: PlanVersion,
  now: string,
): DerivedSubscription | null {
  assertTimestamp(now, "now");
  if (periods.length === 0) return null;

  const runs = coverageRuns(periods);
  const first = runs[0]!;
  if (isBefore(now, first.startsAt)) {
    throw validationFailed("now", "instant at or after the first period start");
  }

  const activeRun = runs.find(
    (run) => isAtOrAfter(now, run.startsAt) && isBefore(now, run.endsAt),
  );

  if (activeRun) {
    const covering = coveringPeriods(activeRun, now);
    const governing = strongestCovering(covering)!;
    assertGoverningPlan(governing, plan);
    const state = governing.source === "trial" ? "trial" : "active";
    return Object.freeze({
      state,
      planCode: governing.planCode,
      planVersion: governing.planVersion,
      stateStartedAt: activeRun.startsAt,
      expiresAt: activeRun.endsAt,
      coverageEndedAt: null,
      entitlements: Object.freeze(effectiveEntitlements(plan, state)),
      computedAt: now,
    } satisfies DerivedSubscription);
  }

  // لا سلسلةَ تُغطّي الآن: إمّا بعد نهايةِ التغطية، أو في فراغٍ بين سلسلتَين — والحُكمُ
  // في الحالتَين يُقاس من **آخرِ نهايةٍ مضت**، لا من أبعدِ نهايةٍ في الدفتر. الفرقُ يظهر
  // في دفترٍ فيه مدةٌ مستقبليّةٌ مُجدولة: قياسُ المهلةِ من نهايتها كان سيجعل سائقاً بلا
  // تغطيةٍ اليومَ يبدو في مهلةٍ لم تبدأ بعد.
  const ended = lastEndedRun(runs, now)!;
  const governing = [...ended.periods].sort(
    (left, right) => toEpochMillis(right.endsAt) - toEpochMillis(left.endsAt),
  )[0]!;
  assertGoverningPlan(governing, plan);
  const graceEndsAt = addDays(ended.endsAt, plan.communityGraceDays);
  const state = isBefore(now, graceEndsAt) ? "expired" : "community";
  return Object.freeze({
    state,
    planCode: governing.planCode,
    planVersion: governing.planVersion,
    stateStartedAt: state === "expired" ? ended.endsAt : graceEndsAt,
    expiresAt: null,
    coverageEndedAt: ended.endsAt,
    entitlements: Object.freeze(effectiveEntitlements(plan, state)),
    computedAt: now,
  } satisfies DerivedSubscription);
}

/** نهايةُ التغطيةِ القائمةِ أو الماضية، لتبدأ منها مدةٌ ممتدّةٌ لا مُتقاطعة (القرار 9). */
export function currentCoverageEnd(periods: ReadonlyArray<Period>): string | null {
  const runs = coverageRuns(periods);
  if (runs.length === 0) return null;
  return runs.reduce((latest, run) =>
    toEpochMillis(run.endsAt) > toEpochMillis(latest.endsAt) ? run : latest,
  ).endsAt;
}
