/**
 * إثباتُ الفرضِ على **حدِّ التوزيعِ** (`M1-04` · الموجةُ الرابعةُ).
 *
 * هذا الملفُّ وحدَه يستعملُ `rawInject` **بلا توقيعٍ**؛ فبقيّةُ اختباراتِ HTTP
 * يوقِّعُ لها السندُ تلقائيّاً، ولو أُثبِتَ الفرضُ بها لأُثبِتَ السندُ لا الحدُّ.
 *
 * المصفوفةُ المطلوبةُ: لا هويّةَ → 401 · منتحلةٌ → 401 · صحيحةٌ → مقبولٌ ·
 * صحيحةٌ بصلاحيّةٍ ناقصةٍ → 403. ويُضافُ: رمزٌ معادٌ → 401 · مخزنٌ لا يجيبُ →
 * 503 · رمزُ مسارٍ آخرَ لا يُقبَلُ · `/health` مفتوحٌ بقصدٍ · مسارٌ بلا تصنيفٍ
 * يُسقِطُ الإقلاعَ · **والكتاباتُ الثلاثُ الخطيرةُ (القبولُ والإلغاءُ والنبضةُ)
 * لا تُنالُ برمزِ قراءةٍ**.
 */

import { AuthErrorCode } from "@wasla/auth-sdk";
import {
  InMemoryServiceTokenReplayGuard,
  ServiceTokenReplayStoreUnavailableError,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import { describe, expect, it } from "vitest";

import { createDispatchApp } from "../http/app.js";
import { DISPATCH_SCOPES } from "../http/service-identity.js";
import { createDirectRunner } from "../runner.js";

import { createHarness, orderRef, ZONE_ID } from "./harness.js";
import {
  ALL_DISPATCH_SCOPES,
  buildSignedDispatchApp,
  createTestKeyRegistry,
  signFor,
  TEST_FORGED_SECRET,
} from "./service-identity-support.js";

const JOBS = "/dispatch/jobs";

/** جسمُ إنشاءٍ صحيحٌ — كي يكونَ الرفضُ عن الهويّةِ لا عن التحقّقِ من الجسمِ. */
function jobBody(index = 1): Record<string, unknown> {
  return {
    order_id: orderRef(index).orderId,
    order_public_id: orderRef(index).orderPublicId,
    zone_id: ZONE_ID,
    order_type: "ride",
    vehicle_class: "sedan",
  };
}

function idempotency(key: string): Record<string, string> {
  return { "idempotency-key": key };
}

/** سندٌ مفروضٌ بمخزنٍ حقيقيٍّ، وطلبٌ مبذورٌ كي يكونَ الإنشاءُ ممكناً. */
function harnessApp() {
  const harness = createHarness();
  harness.orders.seedOrder(orderRef(1).orderId);
  harness.orders.seedOrder(orderRef(2).orderId);
  return { harness, ...buildSignedDispatchApp({ runner: createDirectRunner(harness.deps) }) };
}

function appWithGuard(replayGuard: ServiceTokenReplayGuard) {
  const harness = createHarness();
  harness.orders.seedOrder(orderRef(1).orderId);
  const keys = createTestKeyRegistry();
  const app = createDispatchApp({
    runner: createDirectRunner(harness.deps),
    serviceIdentity: { keys, replayGuard },
  });
  return { app, keys };
}

/** يُنشئُ وظيفةً موقَّعةً ويعيدُ مُعرِّفَها ومُعرِّفَ أوّلِ عرضٍ فيها. */
async function seedJob(
  app: { inject: (options: Record<string, unknown>) => Promise<{ json: () => unknown }> },
  index = 1,
): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: JOBS,
    headers: idempotency(`dispatch-seed-key-${index}`),
    payload: jobBody(index),
  });
  return (created.json() as { id: string }).id;
}

describe("حد التوزيع — المصفوفة الأربع", () => {
  it("لا هوية → 401 بمغلف العقد ولا يُسمّى سبب الرفض في الرد", async () => {
    const { app, rawInject } = harnessApp();
    const response = await rawInject({
      method: "POST",
      url: JOBS,
      headers: idempotency("dispatch-noauth-key"),
      payload: jobBody(),
    });
    expect(response.statusCode).toBe(401);
    const body = response.json() as { code: string; message: string; trace_id: string };
    expect(body.code).toBe(AuthErrorCode.UNAUTHENTICATED);
    expect(body.trace_id).toBeTruthy();
    // السبب يُسجَّل ولا يُعاد: «رمز منتهٍ» و«توقيع خاطئ» فرقٌ يفيد المهاجم وحده.
    expect(body.message).not.toMatch(/توقيع|منته|kid|صلاحي/u);
    await app.close();
  });

  it("هوية منتحلة → 401 لا 403 ولا 500", async () => {
    const { app, rawInject } = harnessApp();
    const response = await rawInject({
      method: "POST",
      url: JOBS,
      headers: {
        ...idempotency("dispatch-forged-key"),
        ...signFor("POST", JOBS, { keys: createTestKeyRegistry(TEST_FORGED_SECRET) }),
      },
      payload: jobBody(),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe(AuthErrorCode.UNAUTHENTICATED);
    await app.close();
  });

  it("هوية صحيحة بالصلاحية المطلوبة → يمر الطلب إلى العقد", async () => {
    const { app, rawInject, keys } = harnessApp();
    const response = await rawInject({
      method: "POST",
      url: JOBS,
      headers: {
        ...idempotency("dispatch-ok-key"),
        ...signFor("POST", JOBS, {
          keys,
          serviceName: "orders",
          scopes: [DISPATCH_SCOPES.jobWrite],
        }),
      },
      payload: jobBody(),
    });
    expect(response.statusCode).toBe(201);
    await app.close();
  });

  it("هوية صحيحة وصلاحية ناقصة → 403 لا 401", async () => {
    const { app, rawInject, keys } = harnessApp();
    // منادٍ يملك القراءة ويحاول الكتابة: الفرق بين «من أنت» و«ماذا تملك».
    const response = await rawInject({
      method: "POST",
      url: JOBS,
      headers: {
        ...idempotency("dispatch-scope-key"),
        ...signFor("POST", JOBS, {
          keys,
          serviceName: "negotiations",
          scopes: [DISPATCH_SCOPES.offerRead, DISPATCH_SCOPES.jobRead],
        }),
      },
      payload: jobBody(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(AuthErrorCode.FORBIDDEN);
    await app.close();
  });

  it("الرمز نفسه مرتين → 401 في الثانية", async () => {
    const { app, rawInject, keys } = harnessApp();
    const jobId = await seedJob(app);
    const path = `${JOBS}/${jobId}`;
    const headers = signFor("GET", path, { keys, scopes: [DISPATCH_SCOPES.jobRead] });
    const first = await rawInject({ method: "GET", url: path, headers });
    const second = await rawInject({ method: "GET", url: path, headers });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(401);
    await app.close();
  });

  it("مخزن الآثار لا يجيب → 503 لا 201", async () => {
    const { app } = appWithGuard({
      remember() {
        throw new ServiceTokenReplayStoreUnavailableError("المخزن صامت.");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: JOBS,
      headers: { ...idempotency("dispatch-store-key"), ...signFor("POST", JOBS) },
      payload: jobBody(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("SERVICE_AUTH_REPLAY_STORE_UNAVAILABLE");
    await app.close();
  });
});

describe("حد التوزيع — الكتابات الثلاث الخطيرة", () => {
  it("رمز قراءةٍ لا يقبل عرضاً نيابةً عن سائق → 403", async () => {
    const { app, rawInject, keys } = harnessApp();
    const path = "/dispatch/offers/00000000-0000-4000-8000-000000000001/accept";
    const response = await rawInject({
      method: "POST",
      url: path,
      headers: signFor("POST", path, {
        keys,
        scopes: [DISPATCH_SCOPES.offerRead, DISPATCH_SCOPES.jobRead],
      }),
    });
    // 403 قبلَ أن يُسأَلَ المجالُ أصلاً: الرفضُ عن الصلاحيّةِ لا عن «لا عرضَ بهذا المعرّف».
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(AuthErrorCode.FORBIDDEN);
    await app.close();
  });

  it("رمز قبولٍ لا يُلغي وظيفةً قائمة → 403", async () => {
    const { app, rawInject, keys } = harnessApp();
    const jobId = await seedJob(app);
    const path = `${JOBS}/${jobId}/cancel`;
    const response = await rawInject({
      method: "POST",
      url: path,
      headers: signFor("POST", path, { keys, scopes: [DISPATCH_SCOPES.offerAccept] }),
      payload: { reason: "customer_cancelled" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(AuthErrorCode.FORBIDDEN);
    await app.close();
  });

  it("رمز قراءةٍ لا يدفع النبضة → 403؛ والزمن هنا نبضة لا ساعة حائط", async () => {
    const { app, rawInject, keys } = harnessApp();
    const response = await rawInject({
      method: "POST",
      url: "/dispatch/tick",
      headers: signFor("POST", "/dispatch/tick", {
        keys,
        scopes: [DISPATCH_SCOPES.jobRead, DISPATCH_SCOPES.offerRead],
      }),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(AuthErrorCode.FORBIDDEN);
    await app.close();
  });

  it("النبضة بلا هوية خدمة أصلاً → 401 لا 4xx مجالي", async () => {
    const { app, rawInject } = harnessApp();
    const response = await rawInject({ method: "POST", url: "/dispatch/tick" });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe(AuthErrorCode.UNAUTHENTICATED);
    await app.close();
  });
});

describe("حد التوزيع — حدود الربط والتصنيف", () => {
  it("رمز مسار آخر لا يُقبل على هذا المسار", async () => {
    const { app, rawInject, keys } = harnessApp();
    const response = await rawInject({
      method: "POST",
      url: "/dispatch/tick",
      headers: signFor("POST", JOBS, { keys, scopes: ALL_DISPATCH_SCOPES }),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("رمز وظيفةٍ لا يقرأ وظيفةً أخرى — المُعرّف داخل الربط", async () => {
    // **الفرقُ عن `RISK-0026`:** المُعرِّفُ هنا جزءٌ من **المسارِ** لا من سلسلةِ
    // الاستفسارِ، والربطُ يغطّي المسارَ (ADR-021 §4) — فرمزٌ وُقِّعَ لقراءةِ
    // وظيفةٍ لا يصلحُ لقراءةِ غيرِها. وهذا يُقاسُ لا يُدَّعى.
    const { app, rawInject, keys } = harnessApp();
    const first = await seedJob(app, 1);
    const second = await seedJob(app, 2);
    expect(first).not.toBe(second);
    const headers = signFor("GET", `${JOBS}/${first}`, {
      keys,
      scopes: [DISPATCH_SCOPES.jobRead],
    });
    const response = await rawInject({ method: "GET", url: `${JOBS}/${second}`, headers });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("`/health` مفتوح بقصد ومعلن — لا هوية ولا 401", async () => {
    const { app, rawInject } = harnessApp();
    const response = await rawInject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("مسار غير معروف يُرَدّ 401 قبل 404 — لا استكشاف مسارات بلا هوية", async () => {
    const { app, rawInject } = harnessApp();
    const response = await rawInject({ method: "GET", url: "/dispatch/does-not-exist/secret" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("مسار يُسجّل بلا تصنيف يُسقط التطبيق عند الإقلاع لا عند أول طلب", () => {
    const harness = createHarness();
    const app = createDispatchApp({
      runner: createDirectRunner(harness.deps),
      serviceIdentity: {
        keys: createTestKeyRegistry(),
        replayGuard: new InMemoryServiceTokenReplayGuard(),
      },
    });
    expect(() => {
      app.get("/dispatch/forgotten", async () => ({ ok: true }));
    }).toThrow(/بلا تصنيف هوية خدمة/u);
  });
});
