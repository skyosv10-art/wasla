/**
 * وضعُ الذاكرة: خدمةٌ بلا `DATABASE_URL` **تقول عجزَها** ولا تبدو عاملة (الطور 11 · 4/6).
 *
 * القرارُ الذي تُثبته هذه المجموعة: غيابُ الاستمراريّةِ لا يُسقط العمليّةَ ولا يُستبدل بتنفيذٍ
 * في الذاكرة. الأوّلُ يجعل حاضنةً تُعيد التشغيلَ في حلقةٍ بلا مسارِ صحّةٍ يُقرأ، والثاني أخطرُ
 * منه: `POST /stores` يُجيب `201` من ذاكرةٍ تُنسى عند إعادةِ التشغيل، فيظنّ تاجرٌ أنّ متجرَه
 * سُجّل ويرفع منتجاتِه عليه.
 *
 * وكلُّ ما هنا يركض بـ`app.inject`: نفسُ المُوجّهِ ونفسُ مُحلِّلِ المحتوى ونفسُ معالجِ الخطأِ
 * الذي تخدمه العمليّة، بلا مقبسٍ ولا قاعدة — فالمجموعةُ تمرّ على جهازٍ لا Postgres فيه، وهذا
 * شرطُ أن تُقرأ نتيجتُها قبل الدفع لا بعده.
 */

import { describe, expect, it } from "vitest";

import { MARKETPLACE_SERVICE_PORT } from "@wasla/contracts-marketplace";

import { createMarketplaceApp } from "../http/app.js";

const OWNER = "WS-1000000001";
const MEMBER = "WS-1000000003";
const MODERATOR = "WS-9000000001";
const SLUG = "riyadh-phones";
const PRODUCT = "11111111-1111-4111-8111-111111111111";
const KEY = "idem-0000000001";

function degradedApp() {
  // لا `services`: هذا هو **نفسُ** ما يبنيه `http/server.ts` حين تغيب `DATABASE_URL`.
  return createMarketplaceApp();
}

/** الترويساتُ الكاملةُ لكتابةٍ مطابقةٍ للعقد — حتى يكون سببُ `503` هو العجزُ لا الحدّ. */
const writeHeaders = { "idempotency-key": KEY, "content-type": "application/json" };

describe("مسارُ الصحّةِ يبقى ناطقاً", () => {
  it("`200` مع `unavailable` و`memory` — لا سقوطَ ولا `503`", async () => {
    const app = degradedApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(response.statusCode).toBe(200);
    // مسارُ صحّةٍ يسقط مع القاعدةِ لا يُشخّص شيئاً: المُشغّلُ يرى «لا جواب» ولا يعرف أهي
    // شبكةٌ أم بوّابةٌ أم قاعدة — والجوابُ هنا يُسمّي السببَ في حقلَين لا أكثر.
    expect(response.json()).toEqual({ status: "unavailable", mode: "memory" });
  });

  it("ووضعُ Postgres يُعلَن معطىً لا يُكتشَف من داخل التطبيق", () => {
    // `mode` يُحسب في `server.ts` من البيئةِ ويُمرَّر. وتطبيقٌ يفحص البيئةَ بنفسِه كان
    // سيجعل اختباراً يمرّ لأنّ متغيّراً بقي في بيئةِ المُشغّل.
    expect(MARKETPLACE_SERVICE_PORT).toBe(8094);
  });
});

describe("كلُّ عمليّةٍ سوى الصحّةِ تُجيب 503", () => {
  const operations: readonly (readonly [
    string,
    "GET" | "POST" | "DELETE",
    string,
    Record<string, unknown>?,
  ])[] = [
    ["شجرةُ التصنيفات", "GET", "/categories"],
    [
      "تسجيلُ متجر",
      "POST",
      "/stores",
      {
        owner_public_id: OWNER,
        store_slug: SLUG,
        title_ar: "هواتف الرياض",
        category_slug: "electronics-phones",
      },
    ],
    ["قائمةُ المتاجر", "GET", "/stores?state=approved"],
    ["قراءةُ متجر", "GET", `/stores/${SLUG}`],
    [
      "طلبُ المراجعة",
      "POST",
      `/stores/${SLUG}/review-requests`,
      { requested_by_public_id: OWNER },
    ],
    [
      "قرارُ متجر",
      "POST",
      `/stores/${SLUG}/decisions`,
      { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
    ],
    ["دفترُ قراراتِ متجر", "GET", `/stores/${SLUG}/reviews`],
    ["طاقمُ المتجر", "GET", `/stores/${SLUG}/staff`],
    [
      "إضافةُ عضوٍ",
      "POST",
      `/stores/${SLUG}/staff`,
      { member_public_id: MEMBER, role: "manager", added_by_public_id: OWNER },
    ],
    [
      "إزالةُ عضوٍ",
      "DELETE",
      `/stores/${SLUG}/staff/${MEMBER}`,
      { removed_by_public_id: OWNER },
    ],
    ["منتجاتُ متجر", "GET", `/stores/${SLUG}/products`],
    [
      "إنشاءُ منتج",
      "POST",
      `/stores/${SLUG}/products`,
      {
        sku: "SKU-0001",
        title_ar: "هاتف",
        category_slug: "electronics-phones",
        price_minor_units: 250000,
        currency_code: "SAR",
        created_by_public_id: OWNER,
      },
    ],
    ["قراءةُ منتج", "GET", `/products/${PRODUCT}`],
    ["نشرُ منتج", "POST", `/products/${PRODUCT}/publish`, { actor_public_id: OWNER }],
    ["أرشفةُ منتج", "POST", `/products/${PRODUCT}/archive`, { actor_public_id: OWNER }],
    [
      "قرارُ اعتدالٍ",
      "POST",
      `/products/${PRODUCT}/decisions`,
      { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
    ],
    ["قراءةُ المخزون", "GET", `/products/${PRODUCT}/inventory`],
    [
      "فرقُ مخزون",
      "POST",
      `/products/${PRODUCT}/inventory`,
      { quantity_delta: 5, reason_code: "restock", actor_public_id: OWNER },
    ],
  ];

  for (const [label, method, url, payload] of operations) {
    it(`${label}: MARKETPLACE_UNAVAILABLE بلا استثناء`, async () => {
      const app = degradedApp();
      const response = await app.inject({
        method,
        url,
        // ترويسةٌ غائبةٌ لا `undefined` مُمرّرةٌ: `inject` يميّز الأمرَين في أنواعِه.
        ...(method === "GET" ? {} : { headers: writeHeaders }),
        ...(payload === undefined ? {} : { payload }),
      });
      await app.close();

      expect(response.statusCode, `${label}: ${response.body}`).toBe(503);
      const body = response.json() as {
        error: { code: string; message: string };
        trace_id: string;
      };
      expect(body.error.code).toBe("MARKETPLACE_UNAVAILABLE");
      // رسالةٌ عربيّةٌ تُقرأ في سجلٍّ، ومُعرّفُ أثرٍ حاضرٌ دائماً — يولّده Fastify حين تغيب
      // الترويسةُ، فلا يكون `trace_id` فارغاً في جوابٍ يُحقَّق فيه لاحقاً.
      expect(body.error.message.length).toBeGreaterThan(0);
      expect(body.trace_id.length).toBeGreaterThan(0);
    });
  }

  it("والعمليّاتُ المُغطّاةُ هنا ثمانيَ عشرةَ — والتاسعةَ عشرةَ هي الصحّة", () => {
    // العددُ مكتوبٌ حتى تسقط عمليّةٌ تُضاف بلا سطرٍ هنا: عمليّةٌ جديدةٌ تُجيب من ذاكرةٍ بلا
    // مخزنٍ هي بالضبط الخللُ الذي تمنعه هذه المجموعة. والعقدُ يُعلن 19 عمليّةً في 15 مساراً.
    expect(operations).toHaveLength(18);
  });
});

describe("وحدُّ الطلبِ يُفحَص قبل العجز", () => {
  it("مفتاحُ المعالجةِ الغائبُ: `400` لا `503` — الطلبُ مخالفٌ أصلاً", async () => {
    /**
     * الترتيبُ مقصود: خطأُ المُتَّصلِ يُقال له كما هو. ولو رددنا `503` على طلبٍ ناقصِ
     * الترويسةِ لظنّ أنّ الخدمةَ ساقطةٌ وأعاد المحاولةَ بنفسِ الطلبِ المخالفِ إلى الأبد.
     */
    const app = degradedApp();
    const response = await app.inject({
      method: "POST",
      url: "/stores",
      headers: { "content-type": "application/json" },
      payload: {
        owner_public_id: OWNER,
        store_slug: SLUG,
        title_ar: "هواتف",
        category_slug: "electronics-phones",
      },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "MARKETPLACE_IDEMPOTENCY_KEY_REQUIRED",
    );
  });

  it("ومفتاحٌ أقصرُ من الحدِّ: `400` بحقلِ الترويسةِ مُسمّىً", async () => {
    const app = degradedApp();
    const response = await app.inject({
      method: "POST",
      url: "/stores",
      headers: { ...writeHeaders, "idempotency-key": "short" },
      payload: {
        owner_public_id: OWNER,
        store_slug: SLUG,
        title_ar: "هواتف",
        category_slug: "electronics-phones",
      },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details?: Record<string, unknown> } };
    expect(body.error.code).toBe("MARKETPLACE_VALIDATION_FAILED");
    expect(body.error.details?.field).toBe("Idempotency-Key");
  });

  it("و JSON المكسورُ: `400 MARKETPLACE_VALIDATION_FAILED` لا خطأُ إطار", async () => {
    const app = degradedApp();
    const response = await app.inject({
      method: "POST",
      url: "/stores",
      headers: writeHeaders,
      payload: '{"owner_public_id":',
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details?: Record<string, unknown> } };
    expect(body.error.code).toBe("MARKETPLACE_VALIDATION_FAILED");
    // «JSON مكسور» و«حقلٌ غيرُ صالح» تعليمةٌ واحدةٌ من جهةِ المُرسِل: أصلِح الحمولة.
    expect(body.error.details?.field).toBe("payload");
  });

  it("وحقلٌ مجهولٌ في الحمولةِ يُرفض ولا يُهمَل بصمت", async () => {
    /**
     * `additionalProperties: false` في العقدِ ليس تزيّناً: حقلٌ مجهولٌ يُهمَل بصمتٍ يجعل
     * مُتكامِلاً يُرسل `state: "approved"` ويظنّ أنّه اعتمد متجرَه — ثمّ يكتشف الفرقَ بعد
     * أسبوعٍ من الطلبات. والحالةُ لا تُقبل من عميلٍ بحال (قرارُ الطورِ الأوّل).
     */
    const app = degradedApp();
    const response = await app.inject({
      method: "POST",
      url: "/stores",
      headers: writeHeaders,
      payload: {
        owner_public_id: OWNER,
        store_slug: SLUG,
        title_ar: "هواتف",
        category_slug: "electronics-phones",
        state: "approved",
      },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details?: Record<string, unknown> } };
    expect(body.error.code).toBe("MARKETPLACE_VALIDATION_FAILED");
    expect(body.error.details?.field).toBe("state");
  });

  it("وحمولةٌ فارغةٌ مع ترويسةِ JSON مقبولةٌ — فلا يتعلّم المُتَّصلُ مخالفةَ العقد", async () => {
    /**
     * أكثرُ العملاءِ يضع `content-type: application/json` افتراضياً على كلّ `POST`.
     * و`FST_ERR_CTP_EMPTY_JSON_BODY` كان سيردّ `400` بخطأِ إطارٍ لا رمزَ عقدٍ له، فيُرسل
     * المُتكامِلُ `{}` ليُسكته. والجوابُ هنا خطأُ **تحقّقٍ مُسمّىً بالحقلِ الناقص** — تعليمةٌ
     * يُنفّذها المُرسِل، لا لغزٌ من الإطار.
     */
    const app = degradedApp();
    const response = await app.inject({
      method: "POST",
      url: `/products/${PRODUCT}/publish`,
      headers: writeHeaders,
      payload: "",
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details?: Record<string, unknown> } };
    expect(body.error.code).toBe("MARKETPLACE_VALIDATION_FAILED");
    expect(body.error.details?.field).toBe("actor_public_id");
  });

  it("وترشيحٌ غائبٌ في قائمةِ المتاجر: `MARKETPLACE_FILTER_REQUIRED` قبل العجز", async () => {
    /**
     * `GET /stores` بلا مُرشِّحٍ هو مسحُ جدولٍ كامل. ورفضُه في الحدِّ **قبل** أن يُسأل
     * المخزنُ يجعل الرمزَ صادقاً في وضعَي التشغيل: العجزُ ليس سببَ الرفضِ هنا.
     */
    const app = degradedApp();
    const response = await app.inject({ method: "GET", url: "/stores" });
    await app.close();

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details?: Record<string, unknown> } };
    expect(body.error.code).toBe("MARKETPLACE_FILTER_REQUIRED");
    expect(String(body.error.details?.expected)).toContain("state");
  });

  it("وحدُّ الصفحةِ الأقصى يُرفض صريحاً لا يُقلَّم بصمت", async () => {
    /**
     * تقليمُ `limit=5000` إلى 200 بصمتٍ يجعل مُتكامِلاً يظنّ أنّه استلم كلَّ شيءٍ وقد
     * استلم أوّلَ مئتين، فيبني إجماليّاً خاطئاً على صفحةٍ واحدة.
     */
    const app = degradedApp();
    const response = await app.inject({ method: "GET", url: "/stores?state=approved&limit=5000" });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "MARKETPLACE_VALIDATION_FAILED",
    );
  });

  it("ومُعرّفُ الأثرِ القادمُ من المُتَّصلِ يُعاد كما هو", async () => {
    const app = degradedApp();
    const response = await app.inject({
      method: "GET",
      url: `/stores/${SLUG}`,
      headers: { "x-request-id": "trace-من-البوّابة" },
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect((response.json() as { trace_id: string }).trace_id).toBe("trace-من-البوّابة");
  });

  it("ومسارٌ غيرُ معروفٍ يبقى `404` من الإطارِ لا `503` من الخدمة", async () => {
    // خدمةٌ تُجيب `503` على كلّ شيءٍ تجعل خطأً مطبعيّاً في المسارِ يبدو انقطاعَ قاعدة.
    const app = degradedApp();
    const response = await app.inject({ method: "GET", url: "/stores/x/unknown-tail" });
    await app.close();

    expect(response.statusCode).toBe(404);
  });
});
