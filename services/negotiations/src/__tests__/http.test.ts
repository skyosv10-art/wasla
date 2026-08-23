/**
 * طبقة HTTP: المسارات العشرة و`/health` عبر `app.inject` (Phase 08 · MR 4/6).
 *
 * ما تُثبته هذه المجموعة هو ما **تُضيفه هذه الطبقة** لا ما يفعله المجال: اختيارُ
 * `200`/`201`، شكلُ الجسم على السلك، حراسةُ الترويسات، رفضُ المفتاح غير المُعلَن، وأنّ خطأً
 * مرفوعاً يصل بصنفه لا بتخمينٍ. قواعدُ التفاوض نفسها مُختبَرة في المجال بـ131 اختباراً،
 * وإعادتُها من خلف HTTP كانت ستقيسها على بعد ثلاث طبقات من عدم المباشرة.
 *
 * ولا `sleep` في هذا الملف ولا في غيره: الساعة تُحرَّك بيد.
 */

import { describe, expect, it } from "vitest";

import { NEGOTIATION_ERROR_CODES } from "@wasla/contracts-negotiation";

import { NEGOTIATION_INTERNAL_ERROR_CODE } from "../http/errors.js";

import { httpHarness, key, openInput, ORDER_ID, writeHeaders } from "./http-harness.js";

/** يفتح خيطاً عبر HTTP ويُعيد جسمه، مُتحقّقاً أنّه `201`. */
async function openOverHttp(harness = httpHarness()) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/negotiations",
    headers: writeHeaders(key("open")),
    payload: openInput(),
  });
  expect(response.statusCode).toBe(201);
  return { harness, thread: response.json() as Record<string, unknown> };
}

describe("HTTP · /health", () => {
  it("يقول degraded على الذاكرة، وlast_tick_at يبدأ null", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "degraded",
      persistence: "memory",
      last_tick_at: null,
    });
  });

  it("لا يشترط مفتاح تفرّد: القراءة لا تُعاد محاولتها بمفتاح", async () => {
    const { app } = httpHarness();
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});

describe("HTTP · فتح خيط", () => {
  it("201 على الفتح، وشكل الجسم snake_case بحقول العقد", async () => {
    const { thread } = await openOverHttp();
    expect(thread.state).toBe("open");
    expect(thread.order_public_id).toBe(ORDER_ID);
    expect(thread.opening_amount_minor).toBe(3000);
    expect(thread.round_count).toBe(0);
    expect(thread.version).toBe(1);
    // لا مفتاح camelCase تسرّب من النموذج الداخلي.
    expect(Object.keys(thread)).not.toContain("orderPublicId");
  });

  it("200 لا 201 على إعادة المحاولة بالمفتاح نفسه، وبالخيط نفسه", async () => {
    const { app } = httpHarness();
    const headers = writeHeaders(key("replay"));
    const first = await app.inject({
      method: "POST",
      url: "/negotiations",
      headers,
      payload: openInput(),
    });
    const second = await app.inject({
      method: "POST",
      url: "/negotiations",
      headers,
      payload: openInput(),
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect((second.json() as { id: string }).id).toBe((first.json() as { id: string }).id);
  });

  it("400 IDEMPOTENCY_KEY_REQUIRED حين تغيب الترويسة", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/negotiations",
      headers: { "content-type": "application/json" },
      payload: openInput(),
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "NEGOTIATION_IDEMPOTENCY_KEY_REQUIRED",
    );
  });

  it("400 VALIDATION_FAILED على مفتاح تفرّد أقصر من الحدّ — رمزٌ مختلف عن الغياب", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/negotiations",
      headers: writeHeaders("short"),
      payload: openInput(),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details?: { field?: string } } };
    expect(body.error.code).toBe("NEGOTIATION_VALIDATION_FAILED");
    expect(body.error.details?.field).toBe("Idempotency-Key");
  });

  it("400 على حقلٍ غير مُعلَن في العقد، ويُسمّى الحقل — لا يُسقَط بصمت", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/negotiations",
      headers: writeHeaders(key("extra")),
      payload: { ...openInput(), commission_minor: 500 },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details?: { field?: string } } };
    expect(body.error.code).toBe("NEGOTIATION_VALIDATION_FAILED");
    expect(body.error.details?.field).toBe("commission_minor");
  });

  it("400 على JSON مكسور، بجسم خطأ من عندنا لا من Fastify", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/negotiations",
      headers: writeHeaders(key("broken")),
      payload: "{ not json",
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string }; trace_id: string };
    expect(body.error.code).toBe("NEGOTIATION_VALIDATION_FAILED");
    expect(typeof body.trace_id).toBe("string");
  });

  it("422 من المجال يبقى 422 ولا يُهبَط إلى 400", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/negotiations",
      headers: writeHeaders(key("bounds")),
      payload: openInput({ opening_amount_minor: 1 }),
    });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "NEGOTIATION_AMOUNT_OUT_OF_BOUNDS",
    );
  });

  it("x-request-id من المُتَّصل يصير trace_id في الجواب", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/negotiations",
      headers: { ...writeHeaders(key("trace")), "x-request-id": "req-abc-123" },
      payload: openInput({ opening_amount_minor: 1 }),
    });
    expect((response.json() as { trace_id: string }).trace_id).toBe("req-abc-123");
  });

  it("400 على x-request-id أطول من 128 — لا كتابة غير محدودة في الصادر", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/negotiations",
      headers: { ...writeHeaders(key("longtrace")), "x-request-id": "r".repeat(129) },
      payload: openInput(),
    });
    expect(response.statusCode).toBe(400);
    expect(
      (response.json() as { error: { details?: { field?: string } } }).error.details?.field,
    ).toBe("x-request-id");
  });
});

describe("HTTP · قائمة الخيوط", () => {
  it("تُرشَّح بـorderPublicId وتُعاد داخل مفتاح threads", async () => {
    const { harness } = await openOverHttp();
    const response = await harness.app.inject({
      method: "GET",
      url: `/negotiations?orderPublicId=${ORDER_ID}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { threads: { order_public_id: string }[] };
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0]?.order_public_id).toBe(ORDER_ID);
  });

  it("400 FILTER_REQUIRED بلا مُرشِّح — لا قراءة غير محدودة", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/negotiations" });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "NEGOTIATION_FILTER_REQUIRED",
    );
  });

  it("400 على مُرشِّح بـsnake_case: يُسمّى المفتاح بدل أن يُقال «مُرشِّح مطلوب»", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "GET",
      url: `/negotiations?order_public_id=${ORDER_ID}`,
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details?: { field?: string } } };
    expect(body.error.code).toBe("NEGOTIATION_VALIDATION_FAILED");
    expect(body.error.details?.field).toBe("order_public_id");
  });

  it("400 على state وحده: حالةٌ ليست مُرشِّحاً", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/negotiations?state=open" });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "NEGOTIATION_FILTER_REQUIRED",
    );
  });
});

describe("HTTP · قراءة خيط", () => {
  it("200 بالخيط، و404 THREAD_NOT_FOUND لمُعرّفٍ مجهول", async () => {
    const { harness, thread } = await openOverHttp();
    const found = await harness.app.inject({ method: "GET", url: `/negotiations/${thread.id}` });
    expect(found.statusCode).toBe(200);
    expect((found.json() as { id: string }).id).toBe(thread.id);

    const missing = await harness.app.inject({
      method: "GET",
      url: "/negotiations/99999999-9999-4999-8999-999999999999",
    });
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { error: { code: string } }).error.code).toBe(
      "NEGOTIATION_THREAD_NOT_FOUND",
    );
  });

  it("400 على مُعرّف مسارٍ ليس UUID — لا 404 يقول إنّ الشكل سليم", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/negotiations/not-a-uuid" });
    expect(response.statusCode).toBe(400);
    expect(
      (response.json() as { error: { details?: { field?: string } } }).error.details?.field,
    ).toBe("threadId");
  });

  it("404 على مسارٍ لا وجود له يبقى 404 عادياً لا خطأ مجال", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/negotiations-typo" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).not.toHaveProperty("error.code", "NEGOTIATION_THREAD_NOT_FOUND");
  });
});

describe("HTTP · الأدوار", () => {
  it("201 على عرضٍ مضادّ، ثم القائمة تُعيده داخل rounds", async () => {
    const { harness, thread } = await openOverHttp();
    const proposal = await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/rounds`,
      headers: writeHeaders(key("propose")),
      payload: { proposed_by: "driver", amount_minor: 3500, currency: "SAR", expected_round_no: 0 },
    });
    expect(proposal.statusCode).toBe(201);
    const round = proposal.json() as Record<string, unknown>;
    expect(round.round_no).toBe(1);
    expect(round.state).toBe("pending");
    expect(round.proposed_by).toBe("driver");

    const list = await harness.app.inject({
      method: "GET",
      url: `/negotiations/${thread.id}/rounds`,
    });
    expect((list.json() as { rounds: unknown[] }).rounds).toHaveLength(1);
  });

  it("409 ROUND_STALE على expected_round_no قديم", async () => {
    const { harness, thread } = await openOverHttp();
    await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/rounds`,
      headers: writeHeaders(key("first")),
      payload: { proposed_by: "driver", amount_minor: 3500, currency: "SAR", expected_round_no: 0 },
    });
    const stale = await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/rounds`,
      headers: writeHeaders(key("stale")),
      payload: {
        proposed_by: "customer",
        amount_minor: 3200,
        currency: "SAR",
        expected_round_no: 0,
      },
    });
    expect(stale.statusCode).toBe(409);
    const body = stale.json() as { error: { code: string; details?: { current_round_no?: number } } };
    expect(body.error.code).toBe("NEGOTIATION_ROUND_STALE");
    // `current_round_no` يُعاد بـsnake_case: هو ما يُعيد المُرسل إلى الحقيقة بطلبٍ واحد.
    expect(body.error.details?.current_round_no).toBe(1);
  });

  it("القبول يُعيد الاتفاق لا الدور، ومعه حالة التسليم", async () => {
    const { harness, thread } = await openOverHttp();
    await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/rounds`,
      headers: writeHeaders(key("offer")),
      payload: { proposed_by: "driver", amount_minor: 3500, currency: "SAR", expected_round_no: 0 },
    });
    const accepted = await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/rounds/1/accept`,
      headers: writeHeaders(key("accept")),
      payload: { acting_party: "customer" },
    });
    expect(accepted.statusCode).toBe(201);
    const agreement = accepted.json() as Record<string, unknown>;
    expect(agreement.thread_id).toBe(thread.id);
    expect(agreement.round_no).toBe(1);
    expect(agreement.amount_minor).toBe(3500);
    expect(agreement.accepted_by).toBe("customer");
    expect(agreement).toHaveProperty("handoff_state");
    expect(agreement).toHaveProperty("handoff_attempts");
  });

  it("فشل تسليم السعر يبقى 201 ومعه اتفاق — لا 502 ولا إنكار للاتفاق", async () => {
    const { harness, thread } = await openOverHttp();
    harness.deps.agreedPrice.mode = "throw";
    await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/rounds`,
      headers: writeHeaders(key("offer2")),
      payload: { proposed_by: "driver", amount_minor: 3500, currency: "SAR", expected_round_no: 0 },
    });
    const accepted = await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/rounds/1/accept`,
      headers: writeHeaders(key("accept2")),
      payload: { acting_party: "customer" },
    });
    expect(accepted.statusCode).toBe(201);
    // المحاولة الأولى فشلت انقطاعاً لا رفضاً: الحالة تبقى `pending` ومعها موعد إعادة،
    // والاتفاق قائم. لا 502 ولا إنكار لاتفاقٍ تمّ بين طرفين.
    const agreement = accepted.json() as Record<string, unknown>;
    expect(agreement.handoff_state).toBe("pending");
    expect(agreement.handoff_attempts).toBe(1);
    expect(agreement.last_error_code).toBe("HANDOFF_TRANSPORT_ERROR");
    expect(typeof agreement.next_handoff_at).toBe("string");
  });

  it("الرفض يُعيد الخيط لا الدور، وبـ200 لا 201", async () => {
    const { harness, thread } = await openOverHttp();
    await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/rounds`,
      headers: writeHeaders(key("offer3")),
      payload: { proposed_by: "driver", amount_minor: 3500, currency: "SAR", expected_round_no: 0 },
    });
    const rejected = await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/rounds/1/reject`,
      headers: writeHeaders(key("reject")),
      payload: { acting_party: "customer", close_thread: true },
    });
    expect(rejected.statusCode).toBe(200);
    const body = rejected.json() as Record<string, unknown>;
    expect(body.id).toBe(thread.id);
    expect(body.state).toBe("declined");
    expect(body.close_reason_code).toBe("declined_by_customer");
  });

  it("400 على roundNo ليس عدداً صحيحاً ≥ 1", async () => {
    const { harness, thread } = await openOverHttp();
    for (const bad of ["0", "abc", "1.5", "-2"]) {
      const response = await harness.app.inject({
        method: "POST",
        url: `/negotiations/${thread.id}/rounds/${bad}/accept`,
        headers: writeHeaders(key(`bad-${bad}`)),
        payload: { acting_party: "customer" },
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("422 SELF_ACCEPT_FORBIDDEN حين يقبل صاحبُ العرض عرضه", async () => {
    const { harness, thread } = await openOverHttp();
    await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/rounds`,
      headers: writeHeaders(key("offer4")),
      payload: { proposed_by: "driver", amount_minor: 3500, currency: "SAR", expected_round_no: 0 },
    });
    const response = await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/rounds/1/accept`,
      headers: writeHeaders(key("self")),
      payload: { acting_party: "driver" },
    });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "NEGOTIATION_SELF_ACCEPT_FORBIDDEN",
    );
  });
});

describe("HTTP · الرسائل", () => {
  it("201 على رسالة، والقائمة تحمل رسالة الافتتاح قبلها", async () => {
    const { harness, thread } = await openOverHttp();
    const posted = await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/messages`,
      headers: writeHeaders(key("msg")),
      payload: { author_role: "customer", body: "هل يمكن التخفيض؟" },
    });
    expect(posted.statusCode).toBe(201);
    const message = posted.json() as Record<string, unknown>;
    expect(message.body).toBe("هل يمكن التخفيض؟");
    expect(message.author_role).toBe("customer");
    expect(message.source_locale).toBe("ar");

    const list = await harness.app.inject({
      method: "GET",
      url: `/negotiations/${thread.id}/messages`,
    });
    const messages = (list.json() as { messages: { sequence_no: number }[] }).messages;
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0]?.sequence_no).toBe(1);
  });

  it("404 لقائمة رسائل خيطٍ مجهول — لا قائمة فارغة تُصدَّق", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "GET",
      url: "/negotiations/99999999-9999-4999-8999-999999999999/messages",
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("HTTP · الاتفاق", () => {
  it("404 AGREEMENT_NOT_FOUND على خيطٍ قائم بلا اتفاق", async () => {
    const { harness, thread } = await openOverHttp();
    const response = await harness.app.inject({
      method: "GET",
      url: `/negotiations/${thread.id}/agreement`,
    });
    expect(response.statusCode).toBe(404);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "NEGOTIATION_AGREEMENT_NOT_FOUND",
    );
  });
});

describe("HTTP · الإلغاء", () => {
  it("200 ويُغلق الخيط بسببه المُعلَن", async () => {
    const { harness, thread } = await openOverHttp();
    const response = await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/cancel`,
      headers: writeHeaders(key("cancel")),
      payload: { reason_code: "order_withdrawn" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.state).toBe("cancelled");
    expect(body.close_reason_code).toBe("order_withdrawn");
  });

  it("200 لا 201 على إعادة المحاولة: الإلغاء لا يُنشئ مورداً", async () => {
    const { harness, thread } = await openOverHttp();
    const headers = writeHeaders(key("cancel-replay"));
    const first = await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/cancel`,
      headers,
      payload: { reason_code: "order_withdrawn" },
    });
    const second = await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/cancel`,
      headers,
      payload: { reason_code: "order_withdrawn" },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
  });
});

describe("HTTP · النبضة", () => {
  it("200 بعدّادات، وتُحدّث last_tick_at في /health", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/negotiations/tick",
      headers: { "idempotency-key": key("tick") },
    });
    expect(response.statusCode).toBe(200);
    const result = response.json() as Record<string, unknown>;
    expect(result).toMatchObject({
      rounds_expired: 0,
      threads_expired: 0,
      threads_closed_max_rounds: 0,
      handoffs_attempted: 0,
      handoffs_succeeded: 0,
      handoff_failures: 0,
    });
    expect(typeof result.ticked_at).toBe("string");

    const health = await app.inject({ method: "GET", url: "/health" });
    expect((health.json() as { last_tick_at: string | null }).last_tick_at).toBe(result.ticked_at);
  });

  it("400 على جسمٍ غير فارغ: المسار لا يُعلن جسماً، فلا يتجاهله", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/negotiations/tick",
      headers: { "idempotency-key": key("tick2"), "content-type": "application/json" },
      payload: { limit: 500 },
    });
    expect(response.statusCode).toBe(400);
    expect(
      (response.json() as { error: { details?: { field?: string } } }).error.details?.field,
    ).toBe("body");
  });

  it("النبضة تُنهي صلاحية دورٍ بعد تحريك الساعة، بلا انتظار", async () => {
    const { harness, thread } = await openOverHttp();
    await harness.app.inject({
      method: "POST",
      url: `/negotiations/${thread.id}/rounds`,
      headers: writeHeaders(key("expiring")),
      payload: { proposed_by: "driver", amount_minor: 3500, currency: "SAR", expected_round_no: 0 },
    });
    harness.deps.clock.advanceSeconds(60 * 60 * 24);
    const ticked = await harness.app.inject({
      method: "POST",
      url: "/negotiations/tick",
      headers: { "idempotency-key": key("tick3") },
    });
    expect(ticked.statusCode).toBe(200);
    const result = ticked.json() as { rounds_expired: number };
    expect(result.rounds_expired).toBeGreaterThanOrEqual(1);
  });
});

describe("HTTP · تصنيف الخطأ", () => {
  it("503 NEGOTIATION_UNAVAILABLE حين يفشل منفذ إلزامي", async () => {
    const harness = httpHarness();
    harness.deps.offers.unavailable = true;
    const response = await harness.app.inject({
      method: "POST",
      url: "/negotiations",
      headers: writeHeaders(key("outage")),
      payload: openInput(),
    });
    expect(response.statusCode).toBe(503);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "NEGOTIATION_UNAVAILABLE",
    );
  });

  it("500 على قيد تماسك، برمزٍ غير منشور في الكتالوج — لا 4xx ولا 503", async () => {
    const harness = httpHarness();
    const app = harness.app;
    // خطأٌ يحمل اسم قيد، كما يرفعه المخزن الذاكري ويلفّه drizzle على محرّكٍ حقيقي.
    // الحقنُ في المستودع لا في المعالج، كي يمرّ الخطأ بالطريق نفسه الذي يمرّ منه حقاً.
    harness.deps.threads.create = async () => {
      throw Object.assign(new Error("wrapped"), {
        cause: { constraint: "ux_negotiation_threads_order_driver_x" },
      });
    };
    const response = await app.inject({
      method: "POST",
      url: "/negotiations",
      headers: writeHeaders(key("constraint")),
      payload: openInput(),
    });
    expect(response.statusCode).toBe(500);
    const body = response.json() as { error: { code: string; details?: { constraint?: string } } };
    expect(body.error.code).toBe(NEGOTIATION_INTERNAL_ERROR_CODE);
    expect(body.error.details?.constraint).toBe("ux_negotiation_threads_order_driver_x");
    // الرمز مقصودٌ غيابه عن الكتالوج: إشارةُ خللٍ لا حالةٌ يتعاقد عليها مستهلك.
    expect(NEGOTIATION_ERROR_CODES as readonly string[]).not.toContain(
      NEGOTIATION_INTERNAL_ERROR_CODE,
    );
  });

  it("كل جسم خطأ يحمل trace_id ولا يُصدِر قيمة أدخلها المُتَّصل", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/negotiations",
      headers: writeHeaders(key("echo")),
      payload: openInput({ opening_amount_minor: 999_999_999 }),
    });
    expect(response.statusCode).toBe(422);
    const raw = response.body;
    expect(raw).toContain("trace_id");
    expect(raw).not.toContain("999999999");
  });
});
