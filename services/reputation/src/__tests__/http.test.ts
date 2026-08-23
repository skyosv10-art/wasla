/**
 * طبقةُ HTTP: ما تُضيفه على حالات الاستخدام، ولا شيءَ سواه (Phase 09 · المراجعة 4/6).
 *
 * حالاتُ الاستخدام مُختبرةٌ في `record-fact.test.ts` و`submit-rating.test.ts` و`reads.test.ts`
 * وغيرها. فما يُفحَص هنا هو ما لا تعرفه إلا هذه الطبقة: رمزُ الحالة، ومفاتيحُ السلك
 * (`snake_case`)، ورفضُ المفاتيح المجهولة، وترجمةُ الخطأ إلى جسمٍ منشور، وترتيبُ القوائم
 * وسقفُها، ومُعرّفُ التتبّع. وإعادةُ اختبار قاعدةِ مجالٍ عبر HTTP كانت ستُضاعف الكلفةَ
 * وتُنتج موضعاً ثانياً يجب تعديله يومَ تتغيّر القاعدة.
 */

import { describe, expect, it } from "vitest";

import { REPUTATION_ERROR_CODES } from "@wasla/contracts-reputation";

import { createReputationApp } from "../http/app.js";
import type { ReputationRunner } from "../runner.js";

import {
  CUSTOMER,
  DRIVER,
  factBody,
  httpHarness,
  order,
  ratingBody,
  T0,
  writeHeaders,
} from "./http-harness.js";

const KEY = "idem-key-0000001";

function bodyOf(response: { payload: string }): Record<string, unknown> {
  return JSON.parse(response.payload) as Record<string, unknown>;
}

function errorOf(response: { payload: string }): {
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  const parsed = bodyOf(response) as { error: { code: string; message: string; details?: Record<string, unknown> } };
  return parsed.error;
}

describe("POST /reputation/facts", () => {
  it("201 في المرّة الأولى، بجسمٍ بمفاتيح العقد", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders(KEY),
      payload: factBody(),
    });

    expect(response.statusCode).toBe(201);
    const body = bodyOf(response) as {
      fact: Record<string, unknown>;
      score: Record<string, unknown>;
      duplicate: boolean;
    };
    expect(body.duplicate).toBe(false);
    expect(body.fact.subject_public_id).toBe(CUSTOMER);
    expect(body.fact.fact_kind).toBe("order_completed");
    expect(body.score.subject_type).toBe("customer");
    expect(body.score.fact_count).toBe(1);
    // مفاتيحُ camelCase غائبةٌ تماماً: جسمٌ يحمل الشكلين يمرّ في مستهلكٍ متسامحٍ ويسقط
    // عند أوّل مستهلكٍ صارم.
    expect(Object.keys(body.fact)).not.toContain("subjectPublicId");
  });

  it("إعادةُ نفس المفتاح بنفس الحمولة: 200 و duplicate=true — لا 409", async () => {
    const { app } = httpHarness();
    const first = await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders(KEY),
      payload: factBody(),
    });
    const second = await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders(KEY),
      payload: factBody(),
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    const replayed = bodyOf(second) as { duplicate: boolean; fact: { id: string } };
    expect(replayed.duplicate).toBe(true);
    // نفسُ الصفّ لا نسخةٌ ثانية منه.
    expect(replayed.fact.id).toBe((bodyOf(first) as { fact: { id: string } }).fact.id);
    expect(second.statusCode).not.toBe(409);
  });

  it("إعادةُ نفس المصدر بمفتاحٍ آخر: 200 و duplicate=true، بجسمٍ مبنيٍّ من الصفّ نفسه", async () => {
    const { app } = httpHarness();
    await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders(KEY),
      payload: factBody(),
    });
    const second = await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders("idem-key-0000002"),
      payload: factBody(),
    });

    expect(second.statusCode).toBe(200);
    expect((bodyOf(second) as { duplicate: boolean }).duplicate).toBe(true);
  });

  it("نفسُ المفتاح بحمولةٍ مختلفة: 409 REPUTATION_IDEMPOTENCY_KEY_REUSED", async () => {
    const { app } = httpHarness();
    await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders(KEY),
      payload: factBody(),
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders(KEY),
      payload: factBody({ order_public_id: order(2), source_event_id: "other-event" }),
    });

    expect(conflict.statusCode).toBe(409);
    expect(errorOf(conflict).code).toBe("REPUTATION_IDEMPOTENCY_KEY_REUSED");
  });

  it("بلا ترويسة مفتاح: 400 REPUTATION_IDEMPOTENCY_KEY_REQUIRED", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: { "content-type": "application/json" },
      payload: factBody(),
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).code).toBe("REPUTATION_IDEMPOTENCY_KEY_REQUIRED");
  });

  it("مفتاحٌ أقصرُ من حدّ العقد: 400 VALIDATION_FAILED باسم الترويسة — لا رمزُ الغياب", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders("short"),
      payload: factBody(),
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).code).toBe("REPUTATION_VALIDATION_FAILED");
    expect(errorOf(response).details?.field).toBe("Idempotency-Key");
  });

  it("مفتاحٌ مكرَّرٌ في ترويستين: يُرفض ولا يُحسم بأخذ الأولى", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: { "content-type": "application/json", "idempotency-key": `${KEY},${KEY}` },
      payload: factBody(),
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).details?.field).toBe("Idempotency-Key");
  });

  it("مفتاحٌ مجهولٌ في الجسم: يُرفض باسمه ولا يُسقَط بصمت", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders(KEY),
      payload: factBody({ severity: "high" }),
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).details?.field).toBe("severity");
  });

  it("مفتاحُ camelCase في الجسم يُرفض باسمه — لا يُقبل الشكلان", async () => {
    const { app } = httpHarness();
    const payload = factBody();
    delete payload.subject_type;
    const response = await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders(KEY),
      payload: { ...payload, subjectType: "customer" },
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).details?.field).toBe("subjectType");
  });

  it("قيمةٌ خارجَ الكتالوج تُرفض من المجال باسم الحقل الداخلي", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders(KEY),
      payload: factBody({ subject_type: "merchant" }),
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).code).toBe("REPUTATION_VALIDATION_FAILED");
    expect(errorOf(response).details?.field).toBe("subjectType");
  });

  it("JSON مكسور: 400 VALIDATION_FAILED بحقل body — لا 500", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders(KEY),
      payload: "{ليس JSON",
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).code).toBe("REPUTATION_VALIDATION_FAILED");
    expect(errorOf(response).details?.field).toBe("body");
  });
});

describe("GET /reputation/facts", () => {
  it("بلا مُرشِّح: 400 REPUTATION_FILTER_REQUIRED", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/reputation/facts" });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).code).toBe("REPUTATION_FILTER_REQUIRED");
  });

  it("أحدثُ الوقائع أولاً — والمنافذُ تُعيد تصاعدياً", async () => {
    const { app } = httpHarness();
    await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders(KEY),
      payload: factBody({ occurred_at: T0 }),
    });
    await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders("idem-key-0000002"),
      payload: factBody({
        order_public_id: order(2),
        source_event_id: "second-event",
        occurred_at: "2026-03-02T12:00:00.000Z",
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: `/reputation/facts?subjectPublicId=${CUSTOMER}`,
    });
    expect(response.statusCode).toBe(200);
    const facts = (bodyOf(response) as { facts: { occurred_at: string }[] }).facts;
    expect(facts).toHaveLength(2);
    expect(facts[0]?.occurred_at).toBe("2026-03-02T12:00:00.000Z");
  });

  it("مُعامِلُ استعلامٍ بـsnake_case يُرفض باسمه — لا يُقرأ كغياب مُرشِّح", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "GET",
      url: `/reputation/facts?subject_public_id=${CUSTOMER}`,
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).code).toBe("REPUTATION_VALIDATION_FAILED");
    expect(errorOf(response).details?.field).toBe("subject_public_id");
  });

  it("مُعرّفٌ مشوّهٌ في المُرشِّح يُرفض ولا يُجيب قائمةً فارغة", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "GET",
      url: "/reputation/facts?subjectPublicId=WS-1",
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).details?.field).toBe("subjectPublicId");
  });
});

describe("GET /reputation/scores/{subjectType}/{subjectPublicId}", () => {
  it("404 لمن لا وقائع له — لا نتيجةٌ افتراضية", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "GET",
      url: `/reputation/scores/customer/${CUSTOMER}`,
    });

    expect(response.statusCode).toBe(404);
    expect(errorOf(response).code).toBe("REPUTATION_SCORE_NOT_FOUND");
  });

  it("200 بعد أوّل واقعة", async () => {
    const { app } = httpHarness();
    await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders(KEY),
      payload: factBody(),
    });
    const response = await app.inject({
      method: "GET",
      url: `/reputation/scores/customer/${CUSTOMER}`,
    });

    expect(response.statusCode).toBe(200);
    const score = bodyOf(response) as { tier: string; ruleset_version: number };
    expect(score.ruleset_version).toBe(1);
    expect(typeof score.tier).toBe("string");
  });

  it("نوعُ جانبٍ مجهولٌ في المسار: 400 لا 404", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "GET",
      url: `/reputation/scores/merchant/${CUSTOMER}`,
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).details?.field).toBe("subjectType");
  });
});

describe("POST /reputation/scores/{subjectType}/{subjectPublicId}/recompute", () => {
  it("200 وإعادةُ نفس المفتاح تُعيد الجوابَ المحفوظ", async () => {
    const { app } = httpHarness();
    await app.inject({
      method: "POST",
      url: "/reputation/facts",
      headers: writeHeaders(KEY),
      payload: factBody(),
    });

    const url = `/reputation/scores/customer/${CUSTOMER}/recompute`;
    const first = await app.inject({ method: "POST", url, headers: writeHeaders("recompute-key-1") });
    const second = await app.inject({
      method: "POST",
      url,
      headers: writeHeaders("recompute-key-1"),
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(bodyOf(second)).toEqual(bodyOf(first));
  });

  it("جسمٌ غيرُ فارغ على مسارٍ بلا requestBody: 400 بحقل body", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: `/reputation/scores/customer/${CUSTOMER}/recompute`,
      headers: writeHeaders("recompute-key-1"),
      payload: { limit: 500 },
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).details?.field).toBe("body");
  });

  it("404 لمن لا دفترَ له", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: `/reputation/scores/customer/${CUSTOMER}/recompute`,
      headers: writeHeaders("recompute-key-1"),
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("POST /reputation/ratings", () => {
  async function completedOrder(): Promise<ReturnType<typeof httpHarness>> {
    const harness = httpHarness();
    for (const [index, subject] of [CUSTOMER, DRIVER].entries()) {
      await harness.app.inject({
        method: "POST",
        url: "/reputation/facts",
        headers: writeHeaders(`complete-key-000${index}`),
        payload: factBody({
          subject_type: index === 0 ? "customer" : "driver",
          subject_public_id: subject,
          source_event_id: `complete-${index}`,
        }),
      });
    }
    return harness;
  }

  it("201 ومعه الواقعةُ المُشتقّة والنتيجة", async () => {
    const { app } = await completedOrder();
    const response = await app.inject({
      method: "POST",
      url: "/reputation/ratings",
      headers: writeHeaders("rating-key-00001"),
      payload: ratingBody(),
    });

    expect(response.statusCode).toBe(201);
    const body = bodyOf(response) as {
      rating: Record<string, unknown>;
      fact: Record<string, unknown>;
      score: Record<string, unknown>;
    };
    expect(body.rating.subject_public_id).toBe(DRIVER);
    expect(body.rating.rater_type).toBe("customer");
    expect(body.fact.fact_kind).toBe("rating_received");
    expect(body.score.subject_type).toBe("driver");
  });

  it("إعادةُ نفس المفتاح: 200 وجسمُ الإعادة المحفوظ حرفياً", async () => {
    const { app } = await completedOrder();
    const first = await app.inject({
      method: "POST",
      url: "/reputation/ratings",
      headers: writeHeaders("rating-key-00001"),
      payload: ratingBody(),
    });
    const second = await app.inject({
      method: "POST",
      url: "/reputation/ratings",
      headers: writeHeaders("rating-key-00001"),
      payload: ratingBody(),
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(bodyOf(second)).toEqual(bodyOf(first));
  });

  it("طلبٌ لم يكتمل: 422 REPUTATION_ORDER_NOT_COMPLETED", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/reputation/ratings",
      headers: writeHeaders("rating-key-00001"),
      payload: ratingBody(),
    });

    expect(response.statusCode).toBe(422);
    expect(errorOf(response).code).toBe("REPUTATION_ORDER_NOT_COMPLETED");
  });

  it("لا حقلَ تعليقٍ في العقد: مفتاحٌ كهذا يُرفض باسمه", async () => {
    const { app } = await completedOrder();
    const response = await app.inject({
      method: "POST",
      url: "/reputation/ratings",
      headers: writeHeaders("rating-key-00001"),
      payload: { ...ratingBody(), comment: "شكراً" },
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).details?.field).toBe("comment");
  });
});

describe("GET /reputation/ratings", () => {
  it("بلا مُرشِّح: 400 REPUTATION_FILTER_REQUIRED", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/reputation/ratings" });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).code).toBe("REPUTATION_FILTER_REQUIRED");
  });

  it("مُرشِّحٌ صحيح: 200 وقائمةٌ بمفاتيح العقد", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "GET",
      url: `/reputation/ratings?subjectPublicId=${DRIVER}`,
    });

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toEqual({ ratings: [] });
  });
});

describe("GET /reputation/fraud-signals", () => {
  it("بلا مُرشِّح: 400 REPUTATION_FILTER_REQUIRED", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/reputation/fraud-signals" });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).code).toBe("REPUTATION_FILTER_REQUIRED");
  });

  it("الشِدّةُ وحدها لا تكفي مُرشِّحاً: 400 ولا تُصدَّر إشاراتُ كلّ الناس", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "GET",
      url: "/reputation/fraud-signals?severity=high",
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).code).toBe("REPUTATION_FILTER_REQUIRED");
  });

  it("شِدّةٌ خارجَ الكتالوج: 400 باسم المُعامِل", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "GET",
      url: `/reputation/fraud-signals?subjectPublicId=${DRIVER}&severity=critical`,
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).details?.field).toBe("severity");
  });

  it("مُرشِّحٌ صحيحٌ مع شِدّة: 200 وقائمة", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "GET",
      url: `/reputation/fraud-signals?subjectPublicId=${DRIVER}&severity=high`,
    });

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toEqual({ signals: [] });
  });
});

describe("مسارات نسخ القواعد", () => {
  it("GET /reputation/rulesets: 200 وقائمةٌ فيها نسخةُ الإطلاق", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/reputation/rulesets" });

    expect(response.statusCode).toBe(200);
    const rulesets = (bodyOf(response) as { rulesets: { ruleset_version: number }[] }).rulesets;
    expect(rulesets.map((ruleset) => ruleset.ruleset_version)).toContain(1);
  });

  it("GET /reputation/rulesets/1: 200 بالأوزان والعتبات مُعلَنة", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/reputation/rulesets/1" });

    expect(response.statusCode).toBe(200);
    const ruleset = bodyOf(response) as {
      ruleset_version: number;
      weights: unknown[];
      fraud_thresholds: unknown[];
    };
    expect(ruleset.ruleset_version).toBe(1);
    expect(ruleset.weights.length).toBeGreaterThan(0);
    expect(ruleset.fraud_thresholds.length).toBeGreaterThan(0);
  });

  it("نسخةٌ غيرُ موجودة: 404 REPUTATION_RULESET_NOT_FOUND", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/reputation/rulesets/99" });

    expect(response.statusCode).toBe(404);
    expect(errorOf(response).code).toBe("REPUTATION_RULESET_NOT_FOUND");
    expect(errorOf(response).details?.ruleset_version).toBe(99);
  });

  it("نسخةٌ ليست عدداً: 400 لا NaN يعبُر إلى المستودع", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/reputation/rulesets/abc" });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).details?.field).toBe("rulesetVersion");
  });
});

describe("POST /reputation/tick و GET /health", () => {
  it("النبضةُ 200 ومعها عدّاداتُها، وتُحدّث مؤشّرَ الصحّة", async () => {
    const { app, tickState } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/reputation/tick",
      headers: writeHeaders("tick-key-0000001"),
    });

    expect(response.statusCode).toBe(200);
    const result = bodyOf(response) as { ran_at: string; failures: number };
    expect(result.failures).toBe(0);
    expect(tickState.lastTickAt).toBe(result.ran_at);

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(bodyOf(health)).toEqual({
      status: "degraded",
      persistence: "memory",
      last_tick_at: result.ran_at,
    });
  });

  it("النبضةُ تشترط الترويسة ولا تقبل جسماً", async () => {
    const { app } = httpHarness();
    const noKey = await app.inject({ method: "POST", url: "/reputation/tick" });
    const withBody = await app.inject({
      method: "POST",
      url: "/reputation/tick",
      headers: writeHeaders("tick-key-0000001"),
      payload: { limit: 5 },
    });

    expect(noKey.statusCode).toBe(400);
    expect(errorOf(noKey).code).toBe("REPUTATION_IDEMPOTENCY_KEY_REQUIRED");
    expect(withBody.statusCode).toBe(400);
    expect(errorOf(withBody).details?.field).toBe("body");
  });

  it("/health قبل أيّ نبضة: last_tick_at = null لا حقلٌ غائب", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toEqual({
      status: "degraded",
      persistence: "memory",
      last_tick_at: null,
    });
  });
});

describe("مُعرّف التتبّع", () => {
  it("x-request-id يُصبح trace_id في جسم الخطأ", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "GET",
      url: "/reputation/facts",
      headers: { "x-request-id": "trace-من-المُتَّصل" },
    });

    expect(response.statusCode).toBe(400);
    expect((bodyOf(response) as unknown as { trace_id: string }).trace_id).toBe("trace-من-المُتَّصل");
  });

  it("بلا ترويسةِ تتبّع: trace_id مُولَّدٌ لا فارغ", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/reputation/facts" });

    expect((bodyOf(response) as unknown as { trace_id: string }).trace_id.length).toBeGreaterThan(0);
  });

  it("ترويسةُ تتبّعٍ أطولُ من الحدّ: 400 — كتابةٌ غيرُ محدودة في أثرٍ تدقيقي", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "GET",
      url: `/reputation/facts?subjectPublicId=${CUSTOMER}`,
      headers: { "x-request-id": "x".repeat(129) },
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).details?.field).toBe("x-request-id");
  });
});

describe("ترجمةُ ما ليس من عندنا", () => {
  /** مُشغّلٌ يرمي ما نُريد: الطريقُ الوحيد لفحص فروعِ معالج الخطأ من الخارج. */
  function throwingApp(error: unknown) {
    const runner: ReputationRunner = {
      write: () => Promise.reject(error),
      read: () => Promise.reject(error),
    };
    return createReputationApp({ runner });
  }

  it("رميةٌ بلا تصنيف: 503 REPUTATION_UNAVAILABLE — لا 500 ولا 502", async () => {
    const app = throwingApp(new Error("انقطع منفذ"));
    const response = await app.inject({
      method: "GET",
      url: `/reputation/facts?subjectPublicId=${CUSTOMER}`,
    });

    expect(response.statusCode).toBe(503);
    expect(errorOf(response).code).toBe("REPUTATION_UNAVAILABLE");
  });

  it("قيدُ قاعدةٍ غيرُ مُترجَم في سلسلة cause: 500 برمزٍ خارجَ الكتالوج", async () => {
    const wrapped = new Error("failed query");
    (wrapped as { cause?: unknown }).cause = { constraint: "ck_reputation_scores_non_negative" };
    const app = throwingApp(wrapped);
    const response = await app.inject({
      method: "GET",
      url: `/reputation/facts?subjectPublicId=${CUSTOMER}`,
    });

    expect(response.statusCode).toBe(500);
    expect(errorOf(response).code).toBe("REPUTATION_INTERNAL_ERROR");
    expect(errorOf(response).details?.constraint).toBe("ck_reputation_scores_non_negative");
    expect(REPUTATION_ERROR_CODES as readonly string[]).not.toContain(errorOf(response).code);
  });

  it("عنوانٌ لا وجودَ له: 404 من Fastify بلا رمزِ عقدٍ مُختلَق", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/reputation/unknown" });

    expect(response.statusCode).toBe(404);
    expect(bodyOf(response)).not.toHaveProperty("trace_id");
  });
});
