/**
 * طبقةُ الاستعمال للاشتراك — **كلُّ عمليةٍ في العقد لها دالّةٌ واحدةٌ هنا، ولا قاعدةَ في HTTP**.
 *
 * ## ما تفعله هذه الطبقة وما لا تفعله
 *
 * تفعل ثلاثةَ أشياء: تُحضر نسخةَ الخطّةِ من **القاعدة**، وتُنادي المجالَ ليقرّر، وتلفّ
 * الكتابةَ في معاملةٍ واحدةٍ عبر `db/unit-of-work.ts`. ولا تفعل رابعاً: لا تحسب تاريخاً،
 * ولا تختار حالةً بـ`if`، ولا تقرأ ساعةً إلّا من `Clock` المُمرَّرة.
 *
 * والسببُ أنّ الطبقةَ التي تحسب صارت في مشاريعَ سابقةٍ **مجالاً ثانياً**: قاعدةٌ تُكتب هنا
 * وأخرى في المجال، ثمّ يفترقان في حالةٍ واحدةٍ ولا اختبارَ يملك السؤال. فالحدُّ هنا صريح:
 * كلُّ رقمٍ يُقرأ من `PlanVersion`، وكلُّ قرارِ حالةٍ من `deriveState`/`draftTransition`.
 *
 * ## لحظةُ العملية: مُعلَنةٌ في الطلب حين أعلنها العقد، ومن الساعة حين لم يُعلنها
 *
 * `POST /subscriptions` يحمل `requested_at`، و`activate` يحمل `activated_at`. وليست حقولاً
 * تزيينية: العقدُ نفسُه يُظهر `computed_at` مساوياً لها في الأمثلة، ومعناها أنّ **لحظةَ
 * الواقعةِ هي التي أعلنها المُرسِل** لا لحظةَ وصولِ الطلب — فإعادةُ تسليمٍ متأخّرةٌ بعد
 * انقطاعِ شبكةٍ تُسجّل المنحةَ في وقتِها الحقيقيّ لا في وقتِ الوصول.
 *
 * ولذلك حارسٌ واحدٌ لازم: **لحظةٌ في المستقبل مرفوضة** (`assertNotAhead`). مُرسِلٌ يُعلن
 * لحظةً بعد الآن يمنح تغطيةً تبدأ قبل أن تُدفع، ويجعل النبضةَ ترى مُدّةً «سارية» لم يبدأ
 * سببُها. والرفضُ شكليٌّ (`SUBSCRIPTION_VALIDATION_FAILED`) لأنّ الحقلَ نفسَه غيرُ مقبول.
 *
 * أمّا `recompute` و`tick` فلا لحظةَ في طلبِهما — عمداً (نصُّ العقد) — فتُقرأ من `Clock`.
 *
 * ## التفرّد في هذه المراجعة: طبيعيٌّ لا مُخزَّن
 *
 * جدولُ `subscription_idempotency` مُعلَنٌ في العقد ومؤجَّلٌ إلى المراجعة 5/6 (HANDOFF §18).
 * فما يقع هنا اليوم:
 *
 * - الرأسُ `Idempotency-Key` **إلزاميٌّ ويُتحقَّق شكلاً** عند حدّ HTTP، ولا يُخزَّن.
 * - `duplicate` في التفعيل يُشتقّ من **الدفتر نفسِه**: مُدّةُ دفعٍ بنفسِ المرجع موجودةٌ
 *   للسائق ⇒ إعادةُ تسليمٍ، فتُعاد الحالةُ المحفوظةُ بلا كتابة.
 * - `duplicate` في بدءِ التجربة **دائماً `false`**: بدايةٌ ثانيةٌ لسائقٍ له اشتراكٌ تُرفض
 *   بـ`409 SUBSCRIPTION_ALREADY_EXISTS` (نصُّ errors.md)، وهو جوابٌ آمنٌ لا يمنح يوماً
 *   مضاعفاً — لكنّه ليس `200` بالنتيجةِ المحفوظة. وهذا **نقصٌ مُعلَنٌ** لا مُخفىً.
 * - `SUBSCRIPTION_IDEMPOTENCY_KEY_REUSED` **لا يُصدَر في 4/6**: لا حمولةَ محفوظةً تُقارن.
 *
 * وفحصُ «مُدّةٌ بنفسِ المرجع» فحصٌ قبل الكتابةِ داخل نفس المعاملة، وهو **يُضيّق النافذةَ ولا
 * يُغلقها** تحت `READ COMMITTED`: لا قيدَ تفرّدٍ على `payment_reference` في العقد. الإغلاقُ
 * الحقيقيُّ مفتاحٌ فريدٌ في جدولِ التفرّد (5/6)، وهذا مكتوبٌ هنا كي لا يُقرأ الفحصُ كأنّه ضمان.
 */

import { effectiveEntitlements } from "../domain/entitlements.js";
import {
  planNotFound,
  planNotFrozen,
  subscriptionAlreadyExists,
  subscriptionNotFound,
  subscriptionUnavailable,
  validationFailed,
} from "../domain/errors.js";
import {
  assertPlanCode,
  assertPlanVersion,
  assertWaslaPublicId,
} from "../domain/identifiers.js";
import type { Entitlement, PlanVersion } from "../domain/model.js";
import { draftPaymentPeriod, draftTrialPeriod } from "../domain/periods.js";
import { currentCoverageEnd } from "../domain/state.js";
import { assertTimestamp, isAtOrAfter, type Clock } from "../domain/time.js";
import type { ProjectionRecord } from "../db/projection.js";
import type { LedgerTrace, PeriodRecord, PostgresSubscriptionLedger } from "../db/repository.js";
import type { SubscriptionUnitOfWork } from "../db/unit-of-work.js";
import { referralCodeFor } from "./referral-code.js";
import type { IdGenerator } from "./events.js";
import { syncFromLedger } from "./sync.js";

/**
 * حدُّ دفعةِ النبضة. مُعلَنٌ ليُقرأ في الاختبار، ودونَ سقفِ قائمةِ المُدد في العقد (500).
 *
 * نبضةٌ بلا حدٍّ تعمل اليومَ على مئةِ سائقٍ وتسقط على مئةِ ألفٍ في معاملةٍ واحدةٍ طويلة؛
 * والباقي يُعالَج في النبضةِ التالية لأنّ الاستحقاقَ لا يزول بتأجيلِ دقيقة.
 */
export const TICK_BATCH_LIMIT = 200;

/** الحالةُ كما تُقرأ للمستهلك: الصفُّ المُتحقِّق + استحقاقاتُه + هل تجاوزه الزمن. */
export interface StateView {
  readonly projection: ProjectionRecord;
  readonly entitlements: ReadonlyArray<Entitlement>;
  /** نهايةٌ مخزنةٌ تجاوزها الزمنُ قبل أن تُعالجها النبضة — يُعلَن ولا يُخفى (نصُّ العقد). */
  readonly isStale: boolean;
}

export interface StartTrialInput {
  readonly driverPublicId: string;
  readonly planCode: string;
  readonly planVersion: number;
  readonly requestedAt: string;
  readonly trace?: LedgerTrace;
}

export interface ActivateInput {
  readonly driverPublicId: string;
  readonly paymentReference: string;
  readonly planCode: string;
  readonly planVersion: number;
  readonly activatedAt: string;
  readonly trace?: LedgerTrace;
}

export interface GrantOutcome {
  readonly state: StateView;
  readonly period: PeriodRecord;
  readonly duplicate: boolean;
  /**
   * مُعرِّفاتُ ما كُتب في صندوقِ الصادرِ في **نفسِ** معاملةِ هذا النداء — فارغةٌ عند الإعادة.
   *
   * ولمَ تُعاد إلى الأعلى وهي لا تخرج على السلك (الغلافُ `additionalProperties: false`)؟
   * لأنّها الطريقُ الوحيدُ لاختبارٍ يُثبت «حدثٌ لكلّ انتقالٍ لا حدثٌ لكلّ نداء» دون أن يقرأ
   * الجدولَ بنفسِه. وقراءةٌ من الجدولِ كانت ستُثبت أنّ صفوفاً هناك، لا أنّ **هذا** النداءَ
   * كتبها — وهو الفرقُ بين اختبارِ ذرّيةٍ واختبارِ وجود.
   */
  readonly eventIds: readonly string[];
}

export interface RecomputeOutcome {
  readonly state: StateView;
  /** مُعرِّفاتُ أحداثِ هذه المعاملة — انظر `GrantOutcome.eventIds`. */
  readonly eventIds: readonly string[];
  /** هل اختلف ما بناه الدفترُ عمّا كان مخزوناً (أو كان الصفُّ غائباً أصلاً). */
  readonly rebuilt: boolean;
}

export interface TickOutcome {
  readonly ranAt: string;
  readonly periodsEnded: number;
  readonly subscriptionsExpired: number;
  readonly subscriptionsMovedToCommunity: number;
  readonly referralsQualified: number;
  readonly rewardsApplied: number;
  readonly failures: number;
}

/**
 * نسخةُ خطّةٍ من القاعدة، مع تحقّقِ التجميدِ حين تكون المنحةُ هي الغرض.
 *
 * `grantable` ليست علماً تجميليّاً: القراءةُ تُعيد نسخةً غيرَ مجمّدةٍ عن قصدٍ (`GET /plans`
 * يُظهر `is_frozen: false` كما هي)، والمنعُ **عند المنح** وحدَه — لأنّ منحَ مدةٍ من نسخةٍ
 * قابلةٍ للتحرير يجعل تفسيرَ اشتراكِ الأمس مستحيلاً بعد أوّلِ تعديلٍ على الكتالوج.
 */
async function requirePlan(
  ledger: PostgresSubscriptionLedger,
  planCode: string,
  planVersion: number,
  grantable: boolean,
): Promise<PlanVersion> {
  const plan = await ledger.readPlanVersion(planCode, planVersion);
  if (!plan) throw planNotFound(planCode, planVersion);
  if (grantable && !plan.isFrozen) throw planNotFrozen(planCode, planVersion);
  return plan;
}

export class SubscriptionService {
  /** آخرُ نبضةٍ نفّذتها **هذه العملية** — يُعلَن في `GET /health` كما يقول العقد. */
  private lastTick: string | null = null;

  /**
   * `ids` وسيطٌ ثالثٌ **إلزاميّ**: لا نشرَ بلا مُعرِّفٍ، ولا مُعرِّفَ بلا منفذٍ يُمرَّر.
   *
   * ولمَ لا يُستورَد `uuidIdGenerator` داخلَ الخدمةِ مباشرةً؟ لأنّ الاختبارَ حينئذٍ لا يستطيع
   * أن يُقارن حمولةً بمساواةٍ تامّة، فيصير يُقارن «حقلٌ موجودٌ وشكلُه uuid» — وهو تحقّقٌ يمرّ
   * على مُعرِّفٍ مختلفٍ في الحمولةِ عن مفتاحِ الصفّ، أي على العطبِ بعينه الذي يحرسه.
   */
  constructor(
    private readonly uow: SubscriptionUnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  get lastTickAt(): string | null {
    return this.lastTick;
  }

  /** لحظةٌ أعلنها المُرسِل: شكلُها ISO، ولا تسبق الساعةَ إلى الأمام. */
  private declaredInstant(value: string, field: string): string {
    const instant = assertTimestamp(value, field);
    const now = assertTimestamp(this.clock.now(), "now");
    // المقارنةُ على لحظةٍ واحدةٍ مقروءةٍ مرّةً: ساعةٌ تُقرأ مرتين تجعل الحارسَ يقبل
    // ويرفض نفسَ المُدخل بفرق ميلي-ثانية، وهو أسوأُ من حارسٍ لا يوجد.
    if (isAtOrAfter(instant, now) && instant !== now) {
      // لحظةٌ في المستقبل تمنح تغطيةً قبل سببِها، وتجعل النبضةَ تحسب مُدّةً لم تبدأ.
      throw validationFailed(field, "instant not ahead of the service clock");
    }
    return instant;
  }

  // -------------------------------------------------------------------------
  // الكتالوج
  // -------------------------------------------------------------------------

  async listPlans(frozenOnly: boolean): Promise<ReadonlyArray<PlanVersion>> {
    return this.uow.read(({ stores }) => stores.ledger.listPlanVersions(frozenOnly));
  }

  async getPlan(planCode: string, planVersion: number): Promise<PlanVersion> {
    return this.uow.read(({ stores }) => requirePlan(stores.ledger, planCode, planVersion, false));
  }

  // -------------------------------------------------------------------------
  // القراءات
  // -------------------------------------------------------------------------

  /**
   * حالةُ سائقٍ من **الصفِّ المُتحقِّق** لا بإعادةِ اشتقاقٍ في كلّ قراءة.
   *
   * ولمَ لا يُشتقّ هنا؟ لأنّ القراءةَ ستصير كتابةً: الاشتقاقُ يُنتج انتقالاً حين يتغيّر،
   * فتكتب `GET` تاريخاً. والصفُّ يُعلن قِدَمَه بـ`is_stale` بدلاً من أن يُخفيه، والنبضةُ هي
   * مالكةُ تثبيتِ الانتقال — وهذا نصُّ العقد لا اختصار.
   */
  async getState(driver: string): Promise<StateView> {
    const driverPublicId = assertWaslaPublicId(driver);
    return this.uow.read(async ({ stores }) => {
      const projection = await stores.projection.read(driverPublicId);
      if (!projection) throw subscriptionNotFound();
      return this.viewOf(projection, await this.planOfProjection(stores.ledger, projection));
    });
  }

  async listPeriods(driver: string): Promise<ReadonlyArray<PeriodRecord>> {
    const driverPublicId = assertWaslaPublicId(driver);
    return this.uow.read(async ({ stores }) => {
      const periods = await stores.ledger.listPeriods(driverPublicId);
      // دفترٌ فارغٌ ليس «سائقاً بلا مُدد» بل سائقاً لا اشتراكَ له: `200` بقائمةٍ فارغةٍ
      // يجعل المستهلكَ يفحص الطولَ ليعرف أنّ لا شيءَ هناك.
      if (periods.length === 0) throw subscriptionNotFound();
      return periods;
    });
  }

  // -------------------------------------------------------------------------
  // الكتابات
  // -------------------------------------------------------------------------

  async startTrial(input: StartTrialInput): Promise<GrantOutcome> {
    // حرّاسُ الشكلِ تُنادى هنا أيضاً لا على الحدِّ وحدَه: النبضةُ ومستهلكُ الأحداثِ في
    // المراجعة 5/6 يُمرّران مُعرّفاتٍ لا تعبر HTTP، وحرسٌ يسري على الغرباءِ وحدَهم يجعل
    // أخطرَ صفٍّ مشوّهٍ في الدفتر هو الذي نكتبه نحن.
    const driverPublicId = assertWaslaPublicId(input.driverPublicId);
    const planCode = assertPlanCode(input.planCode);
    const planVersion = assertPlanVersion(input.planVersion);
    const now = this.declaredInstant(input.requestedAt, "requested_at");
    const { value } = await this.uow.write(async ({ stores, probe }) => {
      const plan = await requirePlan(stores.ledger, planCode, planVersion, true);

      const existing = await stores.projection.read(driverPublicId);
      // اشتراكٌ قائمٌ بأيّ حالة يمنع بدايةً ثانية؛ والتجديدُ طريقُه `activate` لا هذا.
      if (existing) throw subscriptionAlreadyExists(existing.state);

      const outcome = await syncFromLedger({
        stores,
        driverPublicId: input.driverPublicId,
        plan,
        now,
        grant: draftTrialPeriod({ driverPublicId: input.driverPublicId, plan, now }),
        trace: input.trace,
        probe,
        ids: this.ids,
      });

      // رمزُ الإحالةِ يُبذَر هنا **داخل نفسِ المعاملة**، لا عند أوّلِ قراءةٍ للرمز:
      // `GET /referrals/codes/{owner}` قراءةٌ لا تكتب صفّاً (نصُّ errors.md)، والمطالبةُ
      // تحتاج جدولَ الرموزِ لتعرف صاحبَ الرمز — فالرمزُ مُشتَقٌّ من مُعرّفِ المالكِ بدالّةٍ
      // ثابتة، وبذرُه أثرٌ من آثارِ الاشتراكِ لا فعلٌ مستقلٌّ له مسار.
      await stores.referrals.ensureCode(referralCodeFor(input.driverPublicId), input.driverPublicId);

      return {
        state: this.viewOf(outcome.projection, plan),
        period: outcome.period!,
        duplicate: false,
        eventIds: outcome.eventIds,
      } satisfies GrantOutcome;
    });
    return value;
  }

  async activate(input: ActivateInput): Promise<GrantOutcome> {
    assertWaslaPublicId(input.driverPublicId);
    assertPlanCode(input.planCode);
    assertPlanVersion(input.planVersion);
    const now = this.declaredInstant(input.activatedAt, "activated_at");
    const { value } = await this.uow.write(async ({ stores, probe }) => {
      const plan = await requirePlan(stores.ledger, input.planCode, input.planVersion, true);

      const stored = await stores.projection.read(input.driverPublicId);
      // تفعيلٌ لسائقٍ لا اشتراكَ له: المورد غائبٌ، ولا تُختلَق بدايةٌ من فعلِ تجديد.
      if (!stored) throw subscriptionNotFound();

      const periods = await stores.ledger.listPeriods(input.driverPublicId);
      const replayed = periods.find(
        (period) => period.source === "payment" && period.paymentReference === input.paymentReference,
      );
      if (replayed) {
        // إعادةُ تسليمٍ لنفسِ المرجع: تُعاد الحالةُ المحفوظةُ بلا منحةٍ ثانية.
        return {
          state: this.viewOf(stored, await this.planOfProjection(stores.ledger, stored)),
          period: replayed,
          duplicate: true,
          // إعادةٌ لا تكتب حقيقةً فلا تُنشر حدثاً: حدثٌ ثانٍ لنفسِ التفعيلِ كان سيُضاعف
          // كلَّ أثرٍ عند كلِّ مستهلك، وهو أسوأُ ما تُنتجه إعادةُ محاولةٍ سليمة.
          eventIds: [],
        } satisfies GrantOutcome;
      }

      const outcome = await syncFromLedger({
        stores,
        driverPublicId: input.driverPublicId,
        plan,
        now,
        grant: draftPaymentPeriod({
          driverPublicId: input.driverPublicId,
          plan,
          paymentReference: input.paymentReference,
          // المُدّةُ الجديدةُ تبدأ من نهايةِ التغطيةِ السارية لا من الآن: تجديدٌ يحرق ما
          // بقي من مُدّةٍ مدفوعةٍ يجعل السائقَ يؤجّل الدفعَ إلى آخرِ لحظة.
          currentCoverageEnd: currentCoverageEnd(periods),
          now,
        }),
        trace: input.trace,
        probe,
        ids: this.ids,
      });

      return {
        state: this.viewOf(outcome.projection, plan),
        period: outcome.period!,
        duplicate: false,
        eventIds: outcome.eventIds,
      } satisfies GrantOutcome;
    });
    return value;
  }

  /**
   * إعادةُ بناءِ الصفِّ المُتحقِّق من الدفتر — **الإثباتُ العمليُّ أنّ الحالةَ مُشتقّةٌ لا أصل**.
   *
   * لا `grant` هنا: لا مُدّةَ تُضاف، فلا يجوز أن يُغيّر هذا الطريقُ تغطيةَ سائقٍ بحرفٍ واحد.
   * ولحظةُ الحساب من الساعةِ لأنّ الطلبَ لا يحمل وقتاً (نصُّ العقد: لا جسمَ للطلب).
   */
  async recompute(driver: string, trace?: LedgerTrace): Promise<RecomputeOutcome> {
    const driverPublicId = assertWaslaPublicId(driver);
    const now = this.clock.now();
    const { value } = await this.uow.write(async ({ stores, probe }) => {
      const periods = await stores.ledger.listPeriods(driverPublicId);
      // الدفترُ هو الأصل: صفٌّ مُتحقِّقٌ غائبٌ يُعاد بناؤه، أمّا دفترٌ فارغٌ فلا شيءَ يُبنى منه.
      if (periods.length === 0) throw subscriptionNotFound();

      const before = await stores.projection.read(driverPublicId);
      const plan = await this.planOfPeriods(stores.ledger, periods);
      const outcome = await syncFromLedger({ stores, driverPublicId, plan, now, trace, probe, ids: this.ids });

      const rebuilt =
        before === null ||
        before.state !== outcome.projection.state ||
        before.expiresAt !== outcome.projection.expiresAt ||
        before.stateSequence !== outcome.projection.stateSequence;

      return {
        state: this.viewOf(outcome.projection, plan),
        rebuilt,
        eventIds: outcome.eventIds,
      } satisfies RecomputeOutcome;
    });
    return value;
  }

  /**
   * نبضةُ الزمن — المكانُ **الوحيد** الذي يُثبّت انقضاءَ المُدّةِ ونهايةَ مهلةِ المجتمع.
   *
   * ## ثلاثةُ قراراتٍ مكتوبةٌ هنا
   *
   * **1) لحظةٌ واحدةٌ مُثبَّتةٌ للدفعةِ كلِّها.** تُقرأ الساعةُ مرّةً؛ ونبضةٌ تسألها لكلّ سائقٍ
   * تُنتج دفعةً غيرَ متجانسةٍ لا يمكن إعادةُ حسابِها لتفسيرِ ما جرى.
   *
   * **2) معاملةٌ لكلّ سائقٍ لا معاملةٌ للدفعة.** فشلُ سائقٍ واحدٍ يُعدّ في `failures` ولا
   * يُلغي عملَ التسعةِ والتسعين الآخرين. والنسخةُ الأرخص — رميُ الدفعةِ عند أوّلِ عطبٍ —
   * تُخفي تراكمَ العملِ المتأخّرِ وراء إعادةِ محاولاتٍ لا تنتهي، وهذا نصُّ العقد.
   *
   * **3) صنفان من المرشّحين.** `listLapsed` يقرأ من فهرسِ الانقضاء (تغطيةٌ تجاوزها الزمن)،
   * و`listExpired` يقرأ صفوفَ `expired` لأنّها بلا `expires_at` بنصّ القيد فلا يُرشّحها
   * فهرسٌ زمنيّ، ومهلةُ المجتمعِ تُحسب من الدفتر لا من عمودٍ ثانٍ.
   *
   * وعدّادا الإحالةِ صفرٌ في هذه المراجعة: التأهيلُ والمكافأةُ عملُ 5/6، وعدٌّ كاذبٌ أسوأُ
   * من صفرٍ صريحٍ لأنّه يجعل غيابَ المستهلكِ للأحداثِ غيرَ مرئيّ.
   */
  async tick(): Promise<TickOutcome> {
    const ranAt = this.clock.now();
    const candidates = await this.uow.read(async ({ stores }) => {
      const lapsed = await stores.projection.listLapsed(ranAt, TICK_BATCH_LIMIT);
      const expired = await stores.projection.listExpired(TICK_BATCH_LIMIT);
      const seen = new Set<string>();
      const merged: Array<{ readonly driverPublicId: string; readonly lapsed: boolean }> = [];
      for (const record of lapsed) {
        seen.add(record.driverPublicId);
        merged.push({ driverPublicId: record.driverPublicId, lapsed: true });
      }
      for (const record of expired) {
        if (seen.has(record.driverPublicId)) continue;
        merged.push({ driverPublicId: record.driverPublicId, lapsed: false });
      }
      return merged;
    });

    let periodsEnded = 0;
    let subscriptionsExpired = 0;
    let movedToCommunity = 0;
    let failures = 0;

    for (const candidate of candidates) {
      try {
        const { value } = await this.uow.write(async ({ stores, probe }) => {
          const periods = await stores.ledger.listPeriods(candidate.driverPublicId);
          if (periods.length === 0) return null;
          const plan = await this.planOfPeriods(stores.ledger, periods);
          return syncFromLedger({
            stores,
            driverPublicId: candidate.driverPublicId,
            plan,
            now: ranAt,
            probe,
            ids: this.ids,
          });
        });
        if (!value?.transition) continue;
        if (candidate.lapsed) periodsEnded += 1;
        if (value.transition.toState === "expired") subscriptionsExpired += 1;
        if (value.transition.toState === "community") movedToCommunity += 1;
      } catch {
        // السجلُّ الفاشلُ يُعدّ ولا يُوقف الدفعة؛ ولا يُبتلع الرمزُ في صمتٍ لأنّ العدّادَ
        // نفسَه هو الإشارةُ التي يقرأها التشغيل، ويظهر تعثّرُ النبضة في `GET /health`.
        failures += 1;
      }
    }

    this.lastTick = ranAt;
    return {
      ranAt,
      periodsEnded,
      subscriptionsExpired,
      subscriptionsMovedToCommunity: movedToCommunity,
      referralsQualified: 0,
      rewardsApplied: 0,
      failures,
    };
  }

  // -------------------------------------------------------------------------
  // مساعداتٌ خاصّة
  // -------------------------------------------------------------------------

  /** الاستحقاقاتُ من نسخةِ الخطّةِ وحالةِ الصفّ، و`is_stale` بمقارنةِ الساعةِ بالنهايةِ المخزنة. */
  private viewOf(projection: ProjectionRecord, plan: PlanVersion): StateView {
    return {
      projection,
      entitlements: effectiveEntitlements(plan, projection.state),
      isStale: projection.expiresAt !== null && isAtOrAfter(this.clock.now(), projection.expiresAt),
    };
  }

  /**
   * نسخةُ الخطّةِ التي يشير إليها الصفُّ المُتحقِّق.
   *
   * غيابُها **مستحيلٌ** تحت `fk_subscriptions_plan`؛ ولو وقع فهو عطبُ بياناتٍ لا طلبٌ خاطئ،
   * فالجوابُ `503` لا `404`: مستهلكٌ يقرأ «الخطّةُ غيرُ موجودة» على سائقٍ مشتركٍ يتصرّف على
   * أنّ الاشتراكَ انتهى، والحقيقةُ أنّ الخدمةَ لا تستطيع الإجابة.
   */
  private async planOfProjection(
    ledger: PostgresSubscriptionLedger,
    projection: ProjectionRecord,
  ): Promise<PlanVersion> {
    const plan = await ledger.readPlanVersion(projection.planCode, projection.planVersion);
    if (!plan) throw subscriptionUnavailable("catalog row for the stored plan version");
    return plan;
  }

  /**
   * نسخةُ الخطّةِ التي يُشتقّ بها الدفتر: خطّةُ **آخرِ مُدّةٍ مُنحت**.
   *
   * ولمَ الأخيرةُ لا الأولى؟ لأنّ الاستحقاقاتَ والمهلةَ يجب أن تتبع أحدثَ وعدٍ قُبل، وسائقٌ
   * ترقّى إلى نسخةٍ أحدثَ لا يُقاس انقضاؤه بمهلةِ نسخةٍ تركها. والمُدَدُ مُرتّبةٌ بالإنشاء
   * في `listPeriods`، فالأخيرةُ هي آخرُ ما قُبل فعلاً.
   */
  private async planOfPeriods(
    ledger: PostgresSubscriptionLedger,
    periods: ReadonlyArray<PeriodRecord>,
  ): Promise<PlanVersion> {
    const last = periods[periods.length - 1]!;
    const plan = await ledger.readPlanVersion(last.planCode, last.planVersion);
    if (!plan) throw subscriptionUnavailable("catalog row for the last granted plan version");
    return plan;
  }
}
