/**
 * **إعادةُ الإرسالِ تُعيد نفسَ البايتات** — جدولُ منعِ التكرارِ موصولٌ بمساراتِ الكتابة.
 *
 * ## ما يُثبته هذا الملفُّ ولا يُثبته غيرُه
 *
 * `db/idempotency.ts` صار في 5/6 يعرف كيف يحفظ جواباً ويُعيده، و`http/requests.ts` صار
 * يُلزم المفتاحَ ويفحص طولَه. وبين الاثنَين كانت فجوةٌ: **لا أحدَ يقرأ الجدولَ**. فمُتَّصلٌ
 * انقطعت عنه الشبكةُ بعد أن التزمت المعاملةُ كان يُعيد الطلبَ فيُنفَّذ ثانيةً — مُدّةٌ
 * ثانيةٌ في الدفتر، حدثٌ ثانٍ في الصادر، وصفٌّ مُتحقِّقٌ يقول ما لم يشترِه أحد. وهذا الملفُّ
 * يُثبت أنّ الفجوةَ أُغلقت في المساراتِ الأربعةِ التي تكتب بمفتاح، وأنّ النبضةَ **خارجَها**
 * بقرارٍ مُعلَن.
 *
 * ## وثلاثةُ فروقٍ يفحصها كلُّ اختبارٍ هنا
 *
 *  1. **نفسُ الحالةِ ونفسُ الجسم**: `toEqual` على الجسمِ كلِّه لا على حقلٍ منه. جوابٌ يُعاد
 *     حسابُه يتّفق في الحالةِ ويختلف في `period_id` أو `state_sequence`، والمُتَّصلُ الذي
 *     يقارن يرى اضطراباً لا يُفسَّر.
 *  2. **لا صفَّ ثانياً**: عددُ الصفوفِ قبل الإعادةِ وبعدَها. جوابٌ صحيحٌ فوق كتابةٍ مُضاعفةٍ
 *     أسوأُ من خطأٍ صريح.
 *  3. **ولا حدثَ ثانياً**: `subscription_outbox` لا ينمو. مستهلكٌ واحدٌ يُضاعِف أثراً كافٍ
 *     لِيصير الخللُ ماليّاً في مرحلةٍ لاحقة.
 */

import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ReferralService } from "../app/referrals.js";
import { sequentialUuidGenerator } from "../app/events.js";
import { SubscriptionService } from "../app/subscriptions.js";
import { referralCodeFor } from "../app/referral-code.js";
import { SubscriptionUnitOfWork } from "../db/unit-of-work.js";
import { LAUNCH_PLAN } from "../domain/plans.js";
import type { Clock } from "../domain/time.js";
import { createSubscriptionApp } from "../http/app.js";
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

/** ساعةٌ ثابتةٌ متأخّرةٌ عن كلّ لحظةٍ يُعلنها طلبٌ هنا — نفسُ قاعدةِ `http.integration`. */
const NOW = "2026-06-01T00:00:00.000Z";
const fixedClock: Clock = { now: () => NOW };

const JSON_HEADERS = { "content-type": "application/json" };

/** مفتاحٌ صالحُ الطولِ (8..128) ومقروءٌ في رسالةِ فشل. */
const keyOf = (label: string) => `idem-replay-${label}`;

const startBody = (driver: string, requestedAt = T0) => ({
  driver_public_id: driver,
  plan_code: LAUNCH_PLAN.planCode,
  plan_version: LAUNCH_PLAN.planVersion,
  requested_at: requestedAt,
});

describe.skipIf(!PG_ENABLED)("إعادةُ الإرسالِ فوق Postgres — الجوابُ المحفوظُ حرفاً بحرف", () => {
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
        // مُولّدٌ متسلسلٌ لا عشوائيّ: لو أُعيد الحسابُ بدلَ الإعادةِ لاختلف مُعرّفُ الحدثِ
        // فظهر الفرقُ في الجسم — وهذا ما نريد أن نراه إن انكسر الطريق.
        subscriptions: new SubscriptionService(uow, fixedClock, sequentialUuidGenerator(1)),
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

  /**
   * نداءُ كتابةٍ بمفتاحٍ مُعلَن. و`payload` يُمرَّر دائماً — والفارغُ كائنٌ فارغ: الحدُّ
   * يتساهل مع جسمٍ فارغٍ في مساراتٍ لا جسمَ لها (نصُّ `http/app.ts`).
   */
  async function post(
    url: string,
    key: string,
    payload: Record<string, unknown> = {},
  ): Promise<LightMyRequestResponse> {
    return app.inject({
      method: "POST",
      url,
      headers: { ...JSON_HEADERS, "idempotency-key": key },
      payload,
    });
  }

  it("بدءُ تجربةٍ: نفسُ المفتاحِ ونفسُ الجسمِ ⇒ نفسُ الجوابِ بلا مُدّةٍ ثانية", async () => {
    const key = keyOf("start-same");
    const first = await post("/subscriptions", key, startBody(DRIVER));
    expect(first.statusCode).toBe(201);

    const periodsAfterFirst = await countRows(pg.pool, "subscription_periods");
    const outboxAfterFirst = await countRows(pg.pool, "subscription_outbox");

    const replay = await post("/subscriptions", key, startBody(DRIVER));

    // `201` لا `200`: المحفوظُ هو حالةُ الجوابِ الأوّلِ كما كانت. و`200` هنا كان سيقول
    // للمُتَّصل «كان موجوداً» وهو نفسُه من أنشأه.
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(await countRows(pg.pool, "subscription_periods")).toBe(periodsAfterFirst);
    expect(await countRows(pg.pool, "subscription_outbox")).toBe(outboxAfterFirst);
    expect(await countRows(pg.pool, "subscription_transitions")).toBe(1);
  });

  it("بدءُ تجربةٍ: نفسُ المفتاحِ لمُدخلٍ آخرَ ⇒ 409 لا جوابُ الأوّل", async () => {
    const key = keyOf("start-reused");
    expect((await post("/subscriptions", key, startBody(DRIVER))).statusCode).toBe(201);

    const reused = await post("/subscriptions", key, startBody(OTHER_DRIVER));
    expect(reused.statusCode).toBe(409);
    expect((reused.json() as { error: { code: string } }).error.code).toBe(
      "SUBSCRIPTION_IDEMPOTENCY_KEY_REUSED",
    );
    // ولا اشتراكَ للسائقِ الثاني: الرفضُ سبق كلَّ كتابة.
    expect((await app.inject({ method: "GET", url: `/subscriptions/${OTHER_DRIVER}` })).statusCode).toBe(
      404,
    );
  });

  it("مفتاحٌ آخرُ لنفسِ الطلبِ يُنفَّذ ثانيةً — فيردّه المجالُ لا المفتاح", async () => {
    expect((await post("/subscriptions", keyOf("start-a"), startBody(DRIVER))).statusCode).toBe(201);

    // مفتاحٌ جديدٌ ⇒ لا جوابَ محفوظ ⇒ يمرّ الطلبُ إلى العمليّة، فيصطدم بحارسِ «اشتراكٌ
    // قائم». وهذا هو الفرقُ بين الطبقتَين: المفتاحُ يحرس **التسليمَ** والمجالُ يحرس **الحقيقة**.
    const second = await post("/subscriptions", keyOf("start-b"), startBody(DRIVER));
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe(
      "SUBSCRIPTION_ALREADY_EXISTS",
    );
    expect(await countRows(pg.pool, "subscription_periods")).toBe(1);
  });

  it("التفعيل: إعادةُ الإرسالِ لا تُمدّد التغطيةَ مرّتَين", async () => {
    await post("/subscriptions", keyOf("act-start"), startBody(DRIVER));
    const body = {
      payment_reference: "pay-0001",
      plan_code: LAUNCH_PLAN.planCode,
      plan_version: LAUNCH_PLAN.planVersion,
      activated_at: T0,
    };
    const key = keyOf("act-same");
    const first = await post(`/subscriptions/${DRIVER}/activate`, key, body);
    expect(first.statusCode).toBe(200);
    const periods = await countRows(pg.pool, "subscription_periods");
    const outbox = await countRows(pg.pool, "subscription_outbox");

    const replay = await post(`/subscriptions/${DRIVER}/activate`, key, body);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(await countRows(pg.pool, "subscription_periods")).toBe(periods);
    expect(await countRows(pg.pool, "subscription_outbox")).toBe(outbox);
  });

  it("إعادةُ الحساب: الجوابُ المحفوظُ يُعيد `rebuilt` الأوّلَ لا حكماً جديداً", async () => {
    await post("/subscriptions", keyOf("rec-start"), startBody(DRIVER));
    const key = keyOf("rec-same");
    const first = await post(`/subscriptions/${DRIVER}/recompute`, key);
    expect(first.statusCode).toBe(200);

    const replay = await post(`/subscriptions/${DRIVER}/recompute`, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());

    // ونداءٌ ثالثٌ بمفتاحٍ جديدٍ يُعيد الحسابَ فعلاً ويبقى الجوابُ متساوياً في الحالة:
    // إعادةُ البناءِ من الدفترِ لا تُغيّر شيئاً حين لا يكون الدفترُ قد تغيّر.
    const fresh = await post(`/subscriptions/${DRIVER}/recompute`, keyOf("rec-other"));
    expect(fresh.statusCode).toBe(200);
    const sequenceOf = (raw: unknown) =>
      (raw as { subscription: { state_sequence: number } }).subscription.state_sequence;
    expect(sequenceOf(fresh.json())).toBe(sequenceOf(first.json()));
  });

  it("مطالبةُ الإحالة: إعادةُ الإرسالِ لا تُنشئ إحالةً ثانية", async () => {
    await post("/subscriptions", keyOf("ref-owner"), startBody(DRIVER));
    const body = {
      referral_code: referralCodeFor(DRIVER),
      referee_public_id: OTHER_DRIVER,
      claimed_at: T0,
    };
    const key = keyOf("ref-same");
    const first = await post("/referrals", key, body);
    expect(first.statusCode).toBe(201);

    const replay = await post("/referrals", key, body);
    // `201` المحفوظُ لا `200 duplicate: true`: الأخيرُ جوابُ مُتَّصلٍ **آخرَ** يُطالب بنفسِ
    // الرمزِ لنفسِ المُحال، وهو حالةٌ أخرى لها معناها.
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(await countRows(pg.pool, "referrals")).toBe(1);
  });

  it("النبضةُ خارجَ الطريقِ بقرارٍ مُعلَن: نداءان بمفتاحٍ واحدٍ يعملان", async () => {
    const key = keyOf("tick-same");
    const first = await post("/subscriptions/tick", key);
    const second = await post("/subscriptions/tick", key);

    // ولا `409` ولا جوابٌ محفوظ: جسمُ النبضةِ تقريرٌ عن **هذا** التشغيل، وإعادةُ تقريرٍ
    // قديمٍ كانت ستُخفي تشغيلاً وقع. وأثرُها مُشتقٌّ من الدفترِ فتكرارُها لا يُضاعف شيئاً.
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(await countRows(pg.pool, "subscription_idempotency")).toBe(0);
  });

  it("الصفُّ المحفوظُ يُعلن طريقَه ومفتاحَه — لا مسارَ URL فيه", async () => {
    await post("/subscriptions", keyOf("row-start"), startBody(DRIVER));
    await post(`/subscriptions/${DRIVER}/recompute`, keyOf("row-recompute"));

    const rows = await pg.pool.query<{
      readonly idempotency_key: string;
      readonly route_key: string;
      readonly request_hash: string;
      readonly response_status: number;
    }>(
      `SELECT idempotency_key, route_key, request_hash, response_status
         FROM subscription_idempotency ORDER BY route_key`,
    );
    expect(rows.rows.map((row) => row.route_key)).toEqual([
      "subscriptions:recompute",
      "subscriptions:start_trial",
    ]);
    // بصمةٌ بطولِ sha256 وطريقٌ لا يحمل مُعرّفَ سائقٍ: لو دخل المُعرّفُ في `route_key`
    // لصار العمودُ عديمَ الفائدةِ في أيّ تقرير.
    for (const row of rows.rows) {
      expect(row.request_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.route_key).not.toContain(DRIVER);
      expect(row.response_status).toBeGreaterThanOrEqual(200);
    }
  });
});

/**
 * ## النطاق
 *
 * وصلُ جدولِ منعِ التكرارِ بمساراتِ الكتابةِ الأربعةِ فوق قاعدةٍ حقيقيّة: نفسُ البايتاتِ عند
 * الإعادة، `409` عند إعادةِ استعمالِ مفتاحٍ لمُدخلٍ آخر، ولا صفَّ ولا حدثَ ثانياً — والنبضةُ
 * مُستثناةٌ بقرارٍ مُعلَن.
 *
 * ## آخر تحديث
 *
 * المراجعة 6/6 — الملفُّ جديد.
 *
 * ## الحالة
 *
 * يحتاج `DATABASE_URL` كبقيّةِ اختباراتِ التكامل (`docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md`).
 *
 * ## كودٌ ذو صلة
 *
 * `app/idempotency.ts` · `db/idempotency.ts` · `http/app.ts` · `http/errors.ts` ·
 * `docs/12-testing/PHASE10_EXIT_GATE_E2E.md`.
 *
 * ## الفريق
 *
 * Platform / Subscriptions.
 */
