/**
 * الطبقةُ الاثنتا عشرةَ عمليّةً فوق **قاعدةٍ حقيقيّة** — لا مُضاعِفَ مخزنٍ ولا ذاكرة.
 *
 * ## ما يُثبته هذا الملفُّ ولا يُثبته اختبارُ الوحدة
 *
 * اختباراتُ `http-degraded` تُثبت أنّ الحدَّ يردّ `503` بلا استمراريّة، و`http-drift`
 * يُثبت أنّ المساراتَ والحقولَ هي التي في الورقة. وكلاهما لا يُثبت الشيءَ الوحيدَ الذي
 * يهمّ المُتكامِل: أنّ **الرحلةَ** تمرّ — بدءُ تجربةٍ يكتب مدّةً وانتقالاً وصفَّ إسقاطٍ
 * ورمزَ إحالةٍ في معاملةٍ واحدة، ثم تنشيطٌ يُمدّد التغطيةَ، ثم مطالبةُ إحالةٍ تجد الرمزَ
 * الذي زُرع، ثم نبضةٌ تُعيد الحسابَ. وأيُّ خطأٍ في الترجمةِ بين الطبقاتِ يظهر هنا وحدَه.
 *
 * ## وقواعدُ الكتابة
 *
 *  1. **ساعةٌ ثابتةٌ متأخّرة** (`NOW`): كلُّ لحظةٍ مُعلَنةٍ في الطلبات (`T0` وما بعده) تسبقها،
 *     فحارسُ «لا لحظةَ في المستقبل» لا يُسقط اختباراً لسببٍ زمنيّ. وساعةُ النظامِ هنا كانت
 *     ستجعل الحزمةَ تحمرّ بعد سنةٍ من كتابتها.
 *  2. **الجوابُ يُقرأ من السلك** لا من كائنِ المجال: `response.json()` هو ما سيراه العميلُ،
 *     وقراءةُ ما تُعيده الخدمةُ داخليّاً تُثبت أنّ الخدمةَ متّسقةٌ مع نفسِها فقط.
 *  3. **مفتاحُ التكرارِ حاضرٌ في كلّ كتابة**: الحدُّ يُلزمه، ومن كتب اختباراً بلا مفتاحٍ
 *     سيُثبت `400` ويحسبه نجاحاً.
 *  4. كلُّ اختبارٍ يبدأ بجدولٍ نظيفٍ (`resetData`) والكتالوجُ باقٍ من المُهاجرة.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ReferralService } from "../app/referrals.js";
import { SubscriptionService } from "../app/subscriptions.js";
import { referralCodeFor } from "../app/referral-code.js";
import { SubscriptionUnitOfWork } from "../db/unit-of-work.js";
import { LAUNCH_PLAN } from "../domain/plans.js";
import { addDays } from "../domain/time.js";
import type { Clock } from "../domain/time.js";
import { createSubscriptionApp } from "../http/app.js";
import type { PeriodWire, PlanWire, ReferralWire, StateWire, TickWire } from "../http/mappers.js";
import {
  DRIVER,
  OTHER_DRIVER,
  PG_ENABLED,
  T0,
  countRows,
  resetData,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";

/** ساعةُ الخدمة: متأخّرةٌ عن كلّ لحظةٍ يُعلنها طلبٌ في هذا الملف. */
const NOW = "2026-06-01T00:00:00.000Z";
const fixedClock: Clock = { now: () => NOW };

const KEY = { "idempotency-key": "idem-0000000001", "content-type": "application/json" };

/** جسمٌ مُعلَنٌ لا مُخمَّن: الحقولُ هي `required` في `SubscriptionStartRequest`. */
const startBody = (driver: string, requestedAt = T0) => ({
  driver_public_id: driver,
  plan_code: LAUNCH_PLAN.planCode,
  plan_version: LAUNCH_PLAN.planVersion,
  requested_at: requestedAt,
});

describe.skipIf(!PG_ENABLED)("الاثنتا عشرةَ عمليّةً فوق Postgres", () => {
  let pg: PgFixture;
  let app: FastifyInstance;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
    const uow = new SubscriptionUnitOfWork(pg.db);
    app = createSubscriptionApp({
      mode: "postgres",
      services: {
        subscriptions: new SubscriptionService(uow, fixedClock),
        referrals: new ReferralService(uow, fixedClock),
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
  });

  afterAll(async () => {
    await pg?.close();
  });

  /** بدءُ تجربةٍ ناجحٌ — لبنةُ أكثرِ الاختباراتِ هنا. */
  async function startTrial(driver = DRIVER, requestedAt = T0) {
    const response = await app.inject({
      method: "POST",
      url: "/subscriptions",
      headers: KEY,
      payload: startBody(driver, requestedAt),
    });
    expect(response.statusCode).toBe(201);
    return response.json() as StateWire;
  }

  // -------------------------------------------------------------------------
  // 1 · الصحّة و 2-3 · الكتالوج
  // -------------------------------------------------------------------------

  it("الصحّةُ `ok` مع مخزنٍ حقيقيّ، و`last_tick_at` فارغةٌ قبل أوّل نبضة", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", mode: "postgres", last_tick_at: null });
  });

  it("الخططُ تُقرأ من القاعدةِ لا من ثابتِ الكودِ، والمُجمّدةُ منها هي المُمنَحة", async () => {
    const all = await app.inject({ method: "GET", url: "/subscriptions/plans" });
    const frozen = await app.inject({
      method: "GET",
      url: "/subscriptions/plans?frozen_only=true",
    });

    const plans = (all.json() as { plans: PlanWire[] }).plans;
    expect(plans.length).toBeGreaterThan(0);
    // الصفُّ موجودٌ فعلاً في القاعدة: عدَدُ الخططِ على السلكِ = عدَدُ صفوفِ الجدول.
    expect(plans).toHaveLength(await countRows(pg.pool, "subscription_plans"));
    expect((frozen.json() as { plans: PlanWire[] }).plans.every((plan) => plan.is_frozen)).toBe(
      true,
    );
  });

  it("ونسخةُ خطّةٍ بعينها تُعيد استحقاقاتِها، والمعدومةُ 404", async () => {
    const found = await app.inject({
      method: "GET",
      url: `/subscriptions/plans/${LAUNCH_PLAN.planCode}/${LAUNCH_PLAN.planVersion}`,
    });
    const missing = await app.inject({
      method: "GET",
      url: `/subscriptions/plans/${LAUNCH_PLAN.planCode}/99`,
    });

    expect(found.statusCode).toBe(200);
    const plan = found.json() as PlanWire;
    expect(plan.plan_code).toBe(LAUNCH_PLAN.planCode);
    expect(plan.trial_days).toBe(LAUNCH_PLAN.trialDays);
    expect(plan.entitlements.length).toBeGreaterThan(0);
    // وأرقامُ سياسةِ الإحالةِ الداخليّةُ ليست على السلك (قرارُ المُحوّلات).
    expect(Object.keys(plan)).not.toContain("referral_reward_days");

    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { error: { code: string } }).error.code).toBe(
      "SUBSCRIPTION_PLAN_NOT_FOUND",
    );
  });

  // -------------------------------------------------------------------------
  // 4 · بدءُ التجربة — معاملةٌ واحدةٌ تكتب أربعةَ آثار
  // -------------------------------------------------------------------------

  it("بدءُ التجربة 201: مدّةٌ وانتقالٌ وصفُّ إسقاطٍ ورمزُ إحالةٍ — بمعاملةٍ واحدة", async () => {
    const state = await startTrial();

    expect(state.state).toBe("trial");
    expect(state.driver_public_id).toBe(DRIVER);
    expect(state.state_sequence).toBe(1);
    expect(state.started_at).toBe(T0);
    expect(state.expires_at).toBe(addDays(T0, LAUNCH_PLAN.trialDays));
    // الحالةُ المقروءةُ عند لحظةٍ متأخّرةٍ عن انتهاءِ التجربة: الصفُّ لم يُشتقّ بعد،
    // والعقدُ يُعلن ذلك في `is_stale` بدلاً من أن تكتبَ قراءةٌ حقيقةً جديدة.
    expect(state.is_stale).toBe(true);

    expect(await countRows(pg.pool, "subscription_periods")).toBe(1);
    expect(await countRows(pg.pool, "subscription_transitions")).toBe(1);
    expect(await countRows(pg.pool, "subscriptions")).toBe(1);
    // الرمزُ يُزرع هنا لا عند أوّلِ قراءة، وهو مُشتقٌّ من مُعرّفِ المالكِ لا عشوائيّ.
    expect(await countRows(pg.pool, "referral_codes")).toBe(1);
  });

  it("وبدءٌ ثانٍ لنفس السائقِ 409 — لا صفَّ ثانياً ولا مدّةً ثانية", async () => {
    await startTrial();
    const again = await app.inject({
      method: "POST",
      url: "/subscriptions",
      headers: KEY,
      payload: startBody(DRIVER),
    });

    expect(again.statusCode).toBe(409);
    expect((again.json() as { error: { code: string } }).error.code).toBe(
      "SUBSCRIPTION_ALREADY_EXISTS",
    );
    expect(await countRows(pg.pool, "subscription_periods")).toBe(1);
    expect(await countRows(pg.pool, "subscriptions")).toBe(1);
  });

  it("ولحظةٌ في مستقبلِ ساعةِ الخدمة 400 بلا أثرٍ في القاعدة", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/subscriptions",
      headers: KEY,
      payload: startBody(DRIVER, addDays(NOW, 1)),
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details?: { field?: string } } };
    expect(body.error.code).toBe("SUBSCRIPTION_VALIDATION_FAILED");
    expect(body.error.details?.field).toBe("requested_at");
    expect(await countRows(pg.pool, "subscription_periods")).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 5 · قراءةُ الحالة — إسقاطٌ لا اشتقاق
  // -------------------------------------------------------------------------

  it("قراءةُ الحالةِ تُعيد الإسقاطَ نفسَه ولا تكتب شيئاً", async () => {
    const started = await startTrial();
    const before = await countRows(pg.pool, "subscription_transitions");

    const read = await app.inject({ method: "GET", url: `/subscriptions/${DRIVER}` });

    expect(read.statusCode).toBe(200);
    // `computed_at` وحدَها تختلف: هي لحظةُ حسابِ الجواب لا حقيقةٌ محفوظة.
    expect({ ...(read.json() as StateWire), computed_at: "" }).toEqual({
      ...started,
      computed_at: "",
    });
    expect(await countRows(pg.pool, "subscription_transitions")).toBe(before);
  });

  it("وسائقٌ بلا اشتراكٍ 404 لا حالةٌ فارغة", async () => {
    const response = await app.inject({ method: "GET", url: `/subscriptions/${OTHER_DRIVER}` });

    expect(response.statusCode).toBe(404);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "SUBSCRIPTION_NOT_FOUND",
    );
  });

  // -------------------------------------------------------------------------
  // 6 · التنشيط — تغطيةٌ تُمدّد لا حالةٌ تُستبدل
  // -------------------------------------------------------------------------

  it("التنشيطُ أثناء التجربة 200: مدّةٌ ثانيةٌ وتغطيةٌ تمتدّ — والحالةُ تبقى `trial`", async () => {
    const trial = await startTrial();
    const activatedAt = addDays(T0, 1);

    const response = await app.inject({
      method: "POST",
      url: `/subscriptions/${DRIVER}/activate`,
      headers: KEY,
      payload: {
        payment_reference: "PAY-0000000001",
        plan_code: LAUNCH_PLAN.planCode,
        plan_version: LAUNCH_PLAN.planVersion,
        activated_at: activatedAt,
      },
    });

    expect(response.statusCode).toBe(200);
    const state = response.json() as StateWire;
    // `trial` لا `active`: المُدّةُ المدفوعةُ تبدأ عند نهايةِ التجربة (`laterOf`) فلا تُغطّي
    // اليومَ، والحالةُ دالّةٌ من المُدّةِ الحاكمةِ الآن لا من آخرِ ما كُتب. ومن كتب `active`
    // هنا كان سيقول للسائق «انتهت تجربتُك» يومَ دفع، ويُسقط بقيّةَ أيّامِه المجّانيّة.
    expect(state.state).toBe("trial");
    // ولا انتقالَ ثانياً: `trial → trial` غيرُ مُعلَنٍ، والمُدّةُ وحدَها هي الأثر.
    expect(state.state_sequence).toBe(1);
    // التغطيةُ تُضاف إلى نهايةِ التجربةِ لا إلى لحظةِ الدفع: من دفع في اليوم الأوّل
    // لا يخسر بقيّةَ تجربتِه.
    expect(state.expires_at).toBe(addDays(trial.expires_at!, LAUNCH_PLAN.durationDays));
    expect(await countRows(pg.pool, "subscription_periods")).toBe(2);
    expect(await countRows(pg.pool, "subscription_transitions")).toBe(1);
  });

  it("وتنشيطٌ بلا مرجعِ دفعٍ 422، ولسائقٍ بلا اشتراكٍ 404", async () => {
    const noReference = await app.inject({
      method: "POST",
      url: `/subscriptions/${DRIVER}/activate`,
      headers: KEY,
      payload: {
        plan_code: LAUNCH_PLAN.planCode,
        plan_version: LAUNCH_PLAN.planVersion,
        activated_at: T0,
      },
    });
    const noSubscription = await app.inject({
      method: "POST",
      url: `/subscriptions/${OTHER_DRIVER}/activate`,
      headers: KEY,
      payload: {
        payment_reference: "PAY-0000000002",
        plan_code: LAUNCH_PLAN.planCode,
        plan_version: LAUNCH_PLAN.planVersion,
        activated_at: T0,
      },
    });

    // 422 لا 400: الجسمُ صالحُ الشكلِ والقاعدةُ المكسورةُ قاعدةُ مجالٍ — «مدّةٌ مصدرُها
    // دفعٌ تحتاج مرجعاً» — و`errors.md` يفرّق الشكلَ من القاعدةِ بالرمزَين.
    expect(noReference.statusCode).toBe(422);
    expect((noReference.json() as { error: { code: string } }).error.code).toBe(
      "SUBSCRIPTION_PAYMENT_REFERENCE_REQUIRED",
    );
    expect(noSubscription.statusCode).toBe(404);
    expect(await countRows(pg.pool, "subscription_periods")).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 7-8 · إعادةُ الحساب ودفترُ المُدد
  // -------------------------------------------------------------------------

  it("إعادةُ الحسابِ تُحدّث الإسقاطَ إلى ما يقوله الدفترُ عند ساعةِ الخدمة", async () => {
    await startTrial();

    const response = await app.inject({
      method: "POST",
      url: `/subscriptions/${DRIVER}/recompute`,
      headers: KEY,
    });

    expect(response.statusCode).toBe(200);
    const state = response.json() as StateWire;
    // التجربةُ انتهت قبل `NOW` بشهور، فالإسقاطُ بعد الإعادةِ ليس `trial` ولا `is_stale`.
    expect(state.state).toBe("community");
    expect(state.is_stale).toBe(false);
    // ثلاثةُ انتقالاتٍ لا اثنان: `trial` عند البدء، ثمّ `expired` ثمّ `community` — الطريقُ
    // المُعلَنُ كاملاً في معاملةٍ واحدة. وقبل إصلاحِ 4/6 كانت هذه العمليّةُ ترفع 409.
    expect(state.state_sequence).toBe(3);
    expect(await countRows(pg.pool, "subscription_transitions")).toBe(3);
    // ولا مدّةَ جديدةً: إعادةُ الحسابِ تقرأ الدفترَ ولا تمنح تغطية.
    expect(await countRows(pg.pool, "subscription_periods")).toBe(1);
  });

  it("ودفترُ المُدد يُعيد المُددَ بترتيبِ البداية، ولمن لا دفترَ له 404", async () => {
    await startTrial();
    await app.inject({
      method: "POST",
      url: `/subscriptions/${DRIVER}/activate`,
      headers: KEY,
      payload: {
        payment_reference: "PAY-0000000003",
        plan_code: LAUNCH_PLAN.planCode,
        plan_version: LAUNCH_PLAN.planVersion,
        activated_at: addDays(T0, 2),
      },
    });

    const response = await app.inject({ method: "GET", url: `/subscriptions/${DRIVER}/periods` });
    const missing = await app.inject({
      method: "GET",
      url: `/subscriptions/${OTHER_DRIVER}/periods`,
    });

    expect(response.statusCode).toBe(200);
    const periods = (response.json() as { periods: PeriodWire[] }).periods;
    expect(periods.map((period) => period.source)).toEqual(["trial", "payment"]);
    expect(periods[0]?.payment_reference).toBeNull();
    expect(periods[1]?.payment_reference).toBe("PAY-0000000003");
    expect(periods[0]!.starts_at < periods[1]!.starts_at).toBe(true);
    expect(missing.statusCode).toBe(404);
  });

  // -------------------------------------------------------------------------
  // 9 · النبضة
  // -------------------------------------------------------------------------

  it("النبضةُ تُعيد حسابَ من انتهت تغطيتُه، وتُعلن لحظتَها في الصحّة", async () => {
    await startTrial();

    const tick = await app.inject({ method: "POST", url: "/subscriptions/tick", headers: KEY });

    expect(tick.statusCode).toBe(200);
    const outcome = tick.json() as TickWire;
    expect(outcome.ran_at).toBe(NOW);
    expect(outcome.failures).toBe(0);
    expect(outcome.periods_ended + outcome.subscriptions_expired).toBeGreaterThan(0);
    // 5/6 يملك التأهيلَ والمكافآت، فالعدّادانِ صفرٌ هنا **بقرارٍ** لا بسهو.
    expect(outcome.referrals_qualified).toBe(0);
    expect(outcome.rewards_applied).toBe(0);

    const health = await app.inject({ method: "GET", url: "/health" });
    expect((health.json() as { last_tick_at: string | null }).last_tick_at).toBe(NOW);
  });

  it("ونبضةٌ على قاعدةٍ بلا اشتراكاتٍ تنجح بأصفار", async () => {
    const tick = await app.inject({ method: "POST", url: "/subscriptions/tick", headers: KEY });

    expect(tick.statusCode).toBe(200);
    const outcome = tick.json() as TickWire;
    expect(outcome.periods_ended).toBe(0);
    expect(outcome.subscriptions_expired).toBe(0);
    expect(outcome.failures).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 10-12 · الإحالات
  // -------------------------------------------------------------------------

  it("رمزُ الإحالةِ يُقرأ بعد بدءِ التجربةِ ويطابق المُشتقَّ، وقبلها 404", async () => {
    const before = await app.inject({ method: "GET", url: `/referrals/codes/${DRIVER}` });
    await startTrial();
    const after = await app.inject({ method: "GET", url: `/referrals/codes/${DRIVER}` });

    expect(before.statusCode).toBe(404);
    expect((before.json() as { error: { code: string } }).error.code).toBe(
      "REFERRAL_CODE_NOT_FOUND",
    );
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({
      referral_code: referralCodeFor(DRIVER),
      owner_public_id: DRIVER,
      is_active: true,
    });
  });

  it("مطالبةُ إحالةٍ 201 بحالةِ `pending` بلا مكافأة، وتكرارُها 200 بنفس المُعرّف", async () => {
    await startTrial();
    await startTrial(OTHER_DRIVER, addDays(T0, 1));
    const payload = {
      referral_code: referralCodeFor(DRIVER),
      referee_public_id: OTHER_DRIVER,
      claimed_at: addDays(T0, 2),
    };

    const first = await app.inject({
      method: "POST",
      url: "/referrals",
      headers: KEY,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/referrals",
      headers: KEY,
      payload,
    });

    expect(first.statusCode).toBe(201);
    const referral = first.json() as ReferralWire;
    expect(referral.state).toBe("pending");
    expect(referral.referrer_public_id).toBe(DRIVER);
    expect(referral.referee_public_id).toBe(OTHER_DRIVER);
    // المكافأةُ `null` على السلكِ في 4/6: العقدُ يُعلن الحقلَ، والمنحُ في 5/6.
    expect(referral.reward).toBeNull();
    expect(referral.qualifying_fact_count).toBe(0);

    expect(second.statusCode).toBe(200);
    expect((second.json() as ReferralWire).referral_id).toBe(referral.referral_id);
    expect(await countRows(pg.pool, "referrals")).toBe(1);
    expect(await countRows(pg.pool, "referral_rewards")).toBe(0);
  });

  it("وإحالةُ المرءِ نفسَه مرفوضةٌ، ورمزٌ لا مالكَ له 404", async () => {
    await startTrial();

    const self = await app.inject({
      method: "POST",
      url: "/referrals",
      headers: KEY,
      payload: {
        referral_code: referralCodeFor(DRIVER),
        referee_public_id: DRIVER,
        claimed_at: addDays(T0, 1),
      },
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/referrals",
      headers: KEY,
      payload: {
        referral_code: referralCodeFor("WS-1000009999"),
        referee_public_id: OTHER_DRIVER,
        claimed_at: addDays(T0, 1),
      },
    });

    expect(self.statusCode).toBe(422);
    expect((self.json() as { error: { code: string } }).error.code).toBe("REFERRAL_SELF_FORBIDDEN");
    expect(unknown.statusCode).toBe(404);
    expect(await countRows(pg.pool, "referrals")).toBe(0);
  });

  it("وقائمةُ الإحالاتِ تُرشَّح بالمُحيلِ أو المُحالِ أو الحالة، وبلا مُرشِّحٍ 400", async () => {
    await startTrial();
    await startTrial(OTHER_DRIVER, addDays(T0, 1));
    await app.inject({
      method: "POST",
      url: "/referrals",
      headers: KEY,
      payload: {
        referral_code: referralCodeFor(DRIVER),
        referee_public_id: OTHER_DRIVER,
        claimed_at: addDays(T0, 2),
      },
    });

    const byReferrer = await app.inject({
      method: "GET",
      url: `/referrals?referrer_public_id=${DRIVER}`,
    });
    const byReferee = await app.inject({
      method: "GET",
      url: `/referrals?referee_public_id=${DRIVER}`,
    });
    const byState = await app.inject({ method: "GET", url: "/referrals?state=pending" });
    const unfiltered = await app.inject({ method: "GET", url: "/referrals" });

    expect((byReferrer.json() as { referrals: ReferralWire[] }).referrals).toHaveLength(1);
    // نفسُ السائقِ مُحيلٌ لا مُحال: مُرشِّحٌ يقرأ العمودَ الآخرَ يُعيد لا شيء.
    expect((byReferee.json() as { referrals: ReferralWire[] }).referrals).toHaveLength(0);
    expect((byState.json() as { referrals: ReferralWire[] }).referrals).toHaveLength(1);
    expect(unfiltered.statusCode).toBe(400);
    expect((unfiltered.json() as { error: { code: string } }).error.code).toBe(
      "SUBSCRIPTION_FILTER_REQUIRED",
    );
  });

  // -------------------------------------------------------------------------
  // الحدُّ نفسُه فوق قاعدةٍ حقيقيّة
  // -------------------------------------------------------------------------

  it("ومفتاحُ التكرارِ إلزاميٌّ على الكتابةِ ولو كانت القاعدةُ حاضرة", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/subscriptions",
      headers: { "content-type": "application/json" },
      payload: startBody(DRIVER),
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "SUBSCRIPTION_IDEMPOTENCY_KEY_REQUIRED",
    );
    expect(await countRows(pg.pool, "subscriptions")).toBe(0);
  });

  it("و`x-request-id` من البوّابةِ يعود `trace_id` في جسمِ الخطأ", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/subscriptions/${OTHER_DRIVER}`,
      headers: { "x-request-id": "trace-من-البوّابة" },
    });

    expect(response.statusCode).toBe(404);
    expect((response.json() as { trace_id: string }).trace_id).toBe("trace-من-البوّابة");
  });
});
