/**
 * إثبات الفرض على حد المطابقة (M1-03 · البند الرابع من البوابة).
 *
 * هذا الملف وحده يستعمل `rawInject` بلا توقيع؛ فبقية اختبارات HTTP يوقّع لها
 * السند تلقائياً، ولو أثبتنا الفرض بها لأثبتنا السند لا الحد.
 *
 * المصفوفة المطلوبة: لا هوية → 401 · منتحلة → 401 · صحيحة → مقبول · صحيحة
 * بصلاحية ناقصة → 403. ويُضاف: رمز معاد → 401 · مخزن لا يجيب → 503.
 */

import { AuthErrorCode } from "@wasla/auth-sdk";
import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  ServiceTokenReplayStoreUnavailableError,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import { describe, expect, it } from "vitest";

import { createMatchingApp } from "../http/app.js";
import { MATCHING_SCOPES } from "../http/service-identity.js";
import { createDirectRunner } from "../runner.js";

import { createHarness } from "./harness.js";
import {
  ALL_MATCHING_SCOPES,
  candidatePayload,
  createHttpHarness,
  createTestKeyRegistry,
  DRIVER_ID,
  IDEMPOTENCY_KEY,
  signFor,
  TEST_ACTIVE_KID,
} from "./http-support.js";

const CANDIDATES = "/matching/candidates";

/** مهاجم يعرف الصيغة ومعرف المفتاح ولا يملك السر. */
function forgedKeys(): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [{ kid: TEST_ACTIVE_KID, secret: "forged-secret-0123456789abcdefghij", status: "active" }],
    activeKid: TEST_ACTIVE_KID,
  });
}

function appWithGuard(replayGuard: ServiceTokenReplayGuard) {
  const keys = createTestKeyRegistry();
  const app = createMatchingApp({
    runner: createDirectRunner(createHarness()),
    serviceIdentity: { keys, replayGuard },
  });
  return { app, keys };
}

describe("فرض هوية الخدمة — المصفوفة الأربع", () => {
  it("لا هوية → 401 بمغلف العقد ولا يُسمّى الباب في الرد", async () => {
    const { app, rawInject } = createHttpHarness();
    const response = await rawInject({
      method: "POST",
      url: CANDIDATES,
      headers: { "idempotency-key": IDEMPOTENCY_KEY },
      payload: candidatePayload(),
    });
    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.code).toBe(AuthErrorCode.UNAUTHENTICATED);
    expect(body.trace_id).toBeTypeOf("string");
    expect(Object.keys(body).sort()).toEqual(["code", "message", "trace_id"]);
    await app.close();
  });

  it("هوية منتحلة → 401 لا 403 ولا 500", async () => {
    const { app, rawInject } = createHttpHarness();
    const response = await rawInject({
      method: "POST",
      url: CANDIDATES,
      headers: { ...signFor("POST", CANDIDATES, { keys: forgedKeys() }), "idempotency-key": IDEMPOTENCY_KEY },
      payload: candidatePayload(),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("هوية صحيحة → يمر الطلب إلى العقد", async () => {
    const { app, rawInject, keys } = createHttpHarness();
    const response = await rawInject({
      method: "POST",
      url: CANDIDATES,
      headers: { ...signFor("POST", CANDIDATES, { keys }), "idempotency-key": IDEMPOTENCY_KEY },
      payload: candidatePayload(),
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("هوية صحيحة وصلاحية ناقصة → 403 لا 401", async () => {
    const { app, rawInject, keys } = createHttpHarness();
    const response = await rawInject({
      method: "POST",
      url: CANDIDATES,
      headers: {
        ...signFor("POST", CANDIDATES, { keys, scopes: [MATCHING_SCOPES.candidacyRead] }),
        "idempotency-key": IDEMPOTENCY_KEY,
      },
      payload: candidatePayload(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(AuthErrorCode.FORBIDDEN);
    await app.close();
  });
});

describe("فرض هوية الخدمة — الطزاجة والتعذر", () => {
  it("الرمز نفسه مرتين → 200 ثم 401", async () => {
    const { app, rawInject, keys } = createHttpHarness();
    const headers = { ...signFor("POST", CANDIDATES, { keys }), "idempotency-key": IDEMPOTENCY_KEY };
    const first = await rawInject({ method: "POST", url: CANDIDATES, headers, payload: candidatePayload() });
    const second = await rawInject({ method: "POST", url: CANDIDATES, headers, payload: candidatePayload() });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(401);
    await app.close();
  });

  it("مخزن الآثار لا يجيب → 503 لا 200", async () => {
    const { app } = appWithGuard({
      remember() {
        throw new ServiceTokenReplayStoreUnavailableError("المخزن صامت.");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: CANDIDATES,
      headers: { ...signFor("POST", CANDIDATES), "idempotency-key": IDEMPOTENCY_KEY },
      payload: candidatePayload(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("SERVICE_AUTH_REPLAY_STORE_UNAVAILABLE");
    await app.close();
  });
});

describe("فرض هوية الخدمة — حدود الربط والتصنيف", () => {
  it("رمز مسار آخر لا يُقبل على هذا المسار", async () => {
    const { app, rawInject, keys } = createHttpHarness();
    const response = await rawInject({
      method: "POST",
      url: CANDIDATES,
      headers: { ...signFor("POST", "/matching/rulesets", { keys }), "idempotency-key": IDEMPOTENCY_KEY },
      payload: candidatePayload(),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("رمز مُعرّف سائق لا يُقبل على مُعرّف سائق آخر", async () => {
    const { app, rawInject, keys } = createHttpHarness();
    const response = await rawInject({
      method: "GET",
      url: `/candidacy/${DRIVER_ID}`,
      headers: signFor("GET", "/candidacy/WS-0000000002", { keys }),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("`/health` مفتوح بقصد ومعلن — لا هوية ولا 401", async () => {
    const { app, rawInject } = createHttpHarness();
    const response = await rawInject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("مسار غير معروف يُرَدّ 401 قبل 404 — لا استكشاف مسارات بلا هوية", async () => {
    const { app, rawInject } = createHttpHarness();
    const response = await rawInject({ method: "GET", url: "/matching/secret-admin" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("مسار يُسجّل بلا تصنيف يُسقط التطبيق عند الإقلاع لا عند أول طلب", () => {
    const app = createMatchingApp({
      runner: createDirectRunner(createHarness()),
      serviceIdentity: { keys: createTestKeyRegistry(), replayGuard: new InMemoryServiceTokenReplayGuard() },
    });
    expect(() => {
      app.get("/matching/forgotten", async () => ({ ok: true }));
    }).toThrow(/بلا تصنيف هوية خدمة/);
  });

  it("سلسلة الاستعلام **جزءٌ من الربط** — الدين المعلن في ADR-021 §4 سُدَّ (ADR-036)", async () => {
    // **قياس لا دعوى.** [إضافة 2026-09-17] كان هذا الاختبار يُثبت العكس: أن
    // تغيير الاستعلام لا يُبطل الرمز. وقد نصَّت ADR-021 §4 حرفياً على أنه «إن
    // قُرِّرَ ربطُه لاحقاً سقطَ ذلك الاختبارُ وأُعيدت كتابتُه بوعيٍ» — وهذا هو
    // ما جرى: الربط وُسِّع في ADR-036 لإقفال RISK-0026، فسقط الاختبار وأُعيدت
    // كتابته إلى ما يُقاس اليوم. ولم يُحذف شيء: البند الثالث أدناه يُثبت أن
    // التوقيع للهدف نفسِه ما زال يمرّ، فالفرق مقيسٌ لا مُدَّعى.
    const { app, rawInject, keys } = createHttpHarness();
    const response = await rawInject({
      method: "GET",
      url: "/matching/rulesets?unsigned=1",
      headers: signFor("GET", "/matching/rulesets", { keys, scopes: ALL_MATCHING_SCOPES }),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("والتوقيع للهدف نفسِه باستعلامه يمرّ — الإقفال ليس منعاً للاستعلام", async () => {
    const { app, rawInject, keys } = createHttpHarness();
    const response = await rawInject({
      method: "GET",
      url: "/matching/rulesets?unsigned=1",
      headers: signFor("GET", "/matching/rulesets?unsigned=1", {
        keys,
        scopes: ALL_MATCHING_SCOPES,
      }),
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
