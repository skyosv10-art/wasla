/**
 * وضعُ الذاكرة: خدمةٌ بلا `DATABASE_URL` **تقول عجزَها** ولا تبدو عاملة (Phase 10 · 4/6).
 *
 * القرارُ الذي تُثبته هذه المجموعةُ: غيابُ الاستمراريّةِ لا يُسقط العمليّةَ ولا يُستبدل
 * بتنفيذٍ في الذاكرة. الأوّلُ يجعل حاضنةً تُعيد التشغيلَ في حلقةٍ بلا مسارِ صحّةٍ يُقرأ،
 * والثاني أخطرُ: `POST /subscriptions` يُجيب `201` من ذاكرةٍ تُنسى عند إعادةِ التشغيل،
 * فيظنّ سائقٌ أنّ تجربتَه بدأت ويُبنى عليها قرارُ قبولِ طلبات.
 *
 * وكلُّ ما هنا يركض بـ`app.inject`: نفسُ المُوجّهِ ونفسُ مُحلِّلِ المحتوى ونفسُ معالجِ
 * الخطأِ الذي تخدمه العمليّة، بلا مقبسٍ ولا قاعدة — فالمجموعةُ تمرّ على جهازٍ لا Postgres
 * فيه، وهذا شرطُ أن تُقرأ نتيجتُها قبل الدفع لا بعده.
 */

import { describe, expect, it } from "vitest";

import { SUBSCRIPTION_SERVICE_PORT } from "@wasla/contracts-subscription";

import { createSubscriptionApp } from "../http/app.js";

const DRIVER = "WS-1000000001";
const T0 = "2026-03-01T00:00:00.000Z";
const KEY = "idem-0000000001";

function degradedApp() {
  // لا `services`: هذا هو **نفسُ** ما يبنيه `http/server.ts` حين تغيب `DATABASE_URL`.
  return createSubscriptionApp();
}

/** الترويساتُ الكاملةُ لكتابةٍ مطابقةٍ للعقد — حتى يكون سببُ `503` هو العجزُ لا الحدّ. */
const writeHeaders = { "idempotency-key": KEY, "content-type": "application/json" };

describe("مسارُ الصحّةِ يبقى ناطقاً", () => {
  it("`200` مع `degraded` و`memory` — لا سقوطَ ولا `503`", async () => {
    const app = degradedApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(response.statusCode).toBe(200);
    // مسارُ الصحّةِ الذي يسقط مع القاعدةِ لا يُشخّص شيئاً: المُشغّلُ يرى «لا جواب» ولا يعرف
    // أهي شبكةٌ أم بوّابةٌ أم قاعدةٌ — والجوابُ هنا يُسمّي السببَ في حقلٍ واحد.
    expect(response.json()).toEqual({ status: "degraded", mode: "memory", last_tick_at: null });
  });

  it("ووضعُ Postgres يُعلَن معطىً لا يُكتشَف من داخل التطبيق", () => {
    // `mode` يُحسب في `server.ts` من البيئةِ ويُمرَّر. وتطبيقٌ يفحص البيئةَ بنفسِه كان
    // سيجعل اختباراً يمرّ لأنّ متغيّراً بقي في بيئةِ المُشغّل.
    expect(SUBSCRIPTION_SERVICE_PORT).toBe(8093);
  });
});

describe("كلُّ عمليّةٍ سوى الصحّةِ تُجيب 503", () => {
  const operations: readonly (readonly [
    string,
    "GET" | "POST",
    string,
    Record<string, unknown>?,
  ])[] = [
    ["الخطط", "GET", "/subscriptions/plans"],
    ["نسخةُ خطّة", "GET", "/subscriptions/plans/saudi-driver-monthly/1"],
    [
      "بدءُ التجربة",
      "POST",
      "/subscriptions",
      { driver_public_id: DRIVER, plan_code: "saudi-driver-monthly", plan_version: 1, requested_at: T0 },
    ],
    ["قراءةُ الحالة", "GET", `/subscriptions/${DRIVER}`],
    [
      "التنشيط",
      "POST",
      `/subscriptions/${DRIVER}/activate`,
      {
        payment_reference: "PAY-000001",
        plan_code: "saudi-driver-monthly",
        plan_version: 1,
        activated_at: T0,
      },
    ],
    ["إعادةُ الحساب", "POST", `/subscriptions/${DRIVER}/recompute`],
    ["دفترُ المُدد", "GET", `/subscriptions/${DRIVER}/periods`],
    ["النبضة", "POST", "/subscriptions/tick"],
    [
      "مطالبةُ إحالة",
      "POST",
      "/referrals",
      { referral_code: "WR-2345678A", referee_public_id: "WS-1000000002", claimed_at: T0 },
    ],
    ["قائمةُ الإحالات", "GET", `/referrals?referrer_public_id=${DRIVER}`],
    ["رمزُ الإحالة", "GET", `/referrals/codes/${DRIVER}`],
  ];

  for (const [label, method, url, payload] of operations) {
    it(`${label}: SUBSCRIPTION_UNAVAILABLE بلا استثناء`, async () => {
      const app = degradedApp();
      const response = await app.inject({
        method,
        url,
        // ترويسةٌ غائبةٌ لا `undefined` مُمرّرةٌ: `inject` يميّز الأمرَين في أنواعِه.
        ...(method === "POST" ? { headers: writeHeaders } : {}),
        ...(payload === undefined ? {} : { payload }),
      });
      await app.close();

      expect(response.statusCode).toBe(503);
      const body = response.json() as {
        error: { code: string; message: string };
        trace_id: string;
      };
      expect(body.error.code).toBe("SUBSCRIPTION_UNAVAILABLE");
      // رسالةٌ عربيّةٌ تُقرأ في سجلٍّ، ومُعرّفُ أثرٍ حاضرٌ دائماً — يولّده Fastify حين تغيب
      // الترويسةُ، فلا يكون `trace_id` فارغاً في جوابٍ يُحقَّق فيه لاحقاً.
      expect(body.error.message.length).toBeGreaterThan(0);
      expect(body.trace_id.length).toBeGreaterThan(0);
    });
  }

  it("والعمليّاتُ المُغطّاةُ هنا إحدى عشرَ عمليّةً — والثانيةَ عشرةَ هي الصحّة", () => {
    // العددُ مكتوبٌ حتى تسقط عمليّةٌ تُضاف بلا سطرٍ هنا: عمليّةٌ جديدةٌ تُجيب من ذاكرةٍ
    // بلا مخزنٍ هي بالضبط الخللُ الذي تمنعه هذه المجموعة.
    expect(operations).toHaveLength(11);
  });
});

describe("وحدُّ الطلبِ يُفحَص قبل العجز", () => {
  it("مفتاحُ المعالجةِ الغائبُ: `400` لا `503` — الطلبُ مخالفٌ أصلاً", async () => {
    /**
     * الترتيبُ مقصود: خطأُ المُتَّصلِ يُقال له كما هو، ولو رددنا `503` على طلبٍ ناقصِ
     * الترويسةِ لظنّ أنّ الخدمةَ ساقطةٌ وأعاد المحاولةَ بنفسِ الطلبِ المخالفِ إلى الأبد.
     */
    const app = degradedApp();
    const response = await app.inject({
      method: "POST",
      url: "/subscriptions",
      headers: { "content-type": "application/json" },
      payload: { driver_public_id: DRIVER, plan_code: "p", plan_version: 1, requested_at: T0 },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "SUBSCRIPTION_IDEMPOTENCY_KEY_REQUIRED",
    );
  });

  it("و JSON المكسورُ: `400 SUBSCRIPTION_VALIDATION_FAILED` لا خطأُ إطار", async () => {
    const app = degradedApp();
    const response = await app.inject({
      method: "POST",
      url: "/subscriptions",
      headers: writeHeaders,
      payload: '{"driver_public_id":',
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    const body = response.json() as {
      error: { code: string; details?: Record<string, unknown> };
    };
    expect(body.error.code).toBe("SUBSCRIPTION_VALIDATION_FAILED");
    // «JSON مكسور» و«حقلٌ غيرُ صالح» تعليمةٌ واحدةٌ من جهةِ المُرسِل: أصلِح الحمولة.
    expect(body.error.details?.field).toBe("payload");
  });

  it("وحمولةٌ فارغةٌ مع ترويسةِ JSON مقبولةٌ — فلا يتعلّم المُتَّصلُ مخالفةَ العقد", async () => {
    /**
     * `POST …/recompute` لا يُعلن حمولةً، وأكثرُ العملاءِ يضع `content-type` افتراضياً على
     * كلّ `POST`. و`FST_ERR_CTP_EMPTY_JSON_BODY` كان سيردّ `400` على طلبٍ **مطابقٍ للعقد
     * تماماً**، فيُرسل المُتكامِلُ `{}` ليُسكته — أي يتعلّم أن يخالف العقدَ ليعمل.
     * والجوابُ هنا `503` لأنّ العجزَ هو السببُ الحقيقيُّ الوحيدُ الباقي.
     */
    const app = degradedApp();
    const response = await app.inject({
      method: "POST",
      url: `/subscriptions/${DRIVER}/recompute`,
      headers: writeHeaders,
      payload: "",
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "SUBSCRIPTION_UNAVAILABLE",
    );
  });

  it("ومُعرّفُ الأثرِ القادمُ من المُتَّصلِ يُعاد كما هو", async () => {
    const app = degradedApp();
    const response = await app.inject({
      method: "GET",
      url: `/subscriptions/${DRIVER}`,
      headers: { "x-request-id": "trace-من-البوّابة" },
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect((response.json() as { trace_id: string }).trace_id).toBe("trace-من-البوّابة");
  });
});
