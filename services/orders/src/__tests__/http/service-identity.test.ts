/**
 * إثباتُ الفرضِ على **حدِّ الطلباتِ** (`M1-04` · الموجةُ الثانيةُ).
 *
 * هذا الملفُّ وحدَه يستعملُ `rawInject` **بلا توقيعٍ**؛ فبقيّةُ اختباراتِ HTTP
 * يوقِّعُ لها السندُ تلقائيّاً، ولو أُثبِتَ الفرضُ بها لأُثبِتَ السندُ لا الحدُّ.
 *
 * المصفوفةُ المطلوبةُ: لا هويّةَ → 401 · منتحلةٌ → 401 · صحيحةٌ → مقبولٌ ·
 * صحيحةٌ بصلاحيّةٍ ناقصةٍ → 403. ويُضافُ: رمزٌ معادٌ → 401 · مخزنٌ لا يجيبُ → 503 ·
 * رمزُ مسارٍ آخرَ لا يُقبَلُ · `/health` مفتوحٌ بقصدٍ · مسارٌ بلا تصنيفٍ يُسقِطُ
 * الإقلاعَ.
 */

import { AuthErrorCode } from "@wasla/auth-sdk";
import {
  InMemoryServiceTokenReplayGuard,
  ServiceTokenReplayStoreUnavailableError,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import { describe, expect, it } from "vitest";

import { createOrderApp } from "../../http/app.js";
import { ORDER_SCOPES } from "../../http/service-identity.js";
import { createDirectRunner } from "../../runner.js";

import { makeHarness, publicId } from "../harness.js";
import {
  ALL_ORDER_SCOPES,
  createOrderHttpHarness,
  createTestKeyRegistry,
  signFor,
  TEST_FORGED_SECRET,
} from "./support.js";

const LOOKUP = "/orders/lookup";
const INTAKE = "/orders/intake";

/** جسمُ قبولٍ صحيحٌ — كي يكونَ الرفضُ عن الهويّةِ لا عن التحقّقِ من الجسمِ. */
function intakeBody(): Record<string, unknown> {
  return {
    order_request_id: "22222222-2222-4222-8222-222222222222",
    customer_public_id: publicId(1),
    order_type: "ride",
    vehicle_class: "sedan",
    price_mode: "customer_offer",
    offered_price: { amount_minor: 2500, currency: "SAR" },
    stops: [
      { kind: "pickup", zone_id: "66666666-6666-4666-8666-666666666666", source: "map" },
      { kind: "dropoff", zone_id: "77777777-7777-4777-8777-777777777777", source: "map" },
    ],
    requested_at: "2026-01-01T00:00:00.000Z",
  };
}

function appWithGuard(replayGuard: ServiceTokenReplayGuard) {
  const keys = createTestKeyRegistry();
  const app = createOrderApp({
    runner: createDirectRunner(makeHarness()),
    serviceIdentity: { keys, replayGuard },
  });
  return { app, keys };
}

describe("حد الطلبات — المصفوفة الأربع", () => {
  it("لا هوية → 401 بمغلف العقد ولا يُسمّى سبب الرفض في الرد", async () => {
    const { app, rawInject } = createOrderHttpHarness();
    const response = await rawInject({
      method: "POST",
      url: INTAKE,
      headers: { "idempotency-key": "orders-identity-key-1" },
      payload: intakeBody(),
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
    const { app, rawInject } = createOrderHttpHarness();
    const response = await rawInject({
      method: "POST",
      url: INTAKE,
      headers: {
        ...signFor("POST", INTAKE, { keys: createTestKeyRegistry(TEST_FORGED_SECRET) }),
        "idempotency-key": "orders-identity-key-2",
      },
      payload: intakeBody(),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe(AuthErrorCode.UNAUTHENTICATED);
    await app.close();
  });

  it("هوية صحيحة بالصلاحية المطلوبة → يمر الطلب إلى العقد", async () => {
    const { app, rawInject, keys } = createOrderHttpHarness();
    const response = await rawInject({
      method: "POST",
      url: INTAKE,
      headers: {
        ...signFor("POST", INTAKE, { keys, serviceName: "customers", scopes: [ORDER_SCOPES.intakeWrite] }),
        "idempotency-key": "orders-identity-key-3",
      },
      payload: intakeBody(),
    });
    expect(response.statusCode).toBe(201);
    await app.close();
  });

  it("هوية صحيحة وصلاحية ناقصة → 403 لا 401", async () => {
    const { app, rawInject, keys } = createOrderHttpHarness();
    // منادٍ يملك صلاحية القراءة ويحاول الكتابة: الفرق بين «من أنت» و«ماذا تملك».
    const response = await rawInject({
      method: "POST",
      url: INTAKE,
      headers: {
        ...signFor("POST", INTAKE, { keys, serviceName: "customers", scopes: [ORDER_SCOPES.orderRead] }),
        "idempotency-key": "orders-identity-key-4",
      },
      payload: intakeBody(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(AuthErrorCode.FORBIDDEN);
    await app.close();
  });

  it("الرمز نفسه مرتين → 401 في الثانية", async () => {
    const { app, rawInject, keys } = createOrderHttpHarness();
    const headers = {
      ...signFor("GET", LOOKUP, { keys, scopes: [ORDER_SCOPES.orderRead] }),
    };
    const url = `${LOOKUP}?order_public_id=ORD-0000000001`;
    const first = await rawInject({ method: "GET", url, headers });
    const second = await rawInject({ method: "GET", url, headers });
    // الأول يعبر الهوية ثم يُرَدّ من العقد (الطلب غير موجود)؛ المهم أنه ليس 401.
    expect(first.statusCode).not.toBe(401);
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
      url: INTAKE,
      headers: { ...signFor("POST", INTAKE), "idempotency-key": "orders-identity-key-5" },
      payload: intakeBody(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("SERVICE_AUTH_REPLAY_STORE_UNAVAILABLE");
    await app.close();
  });
});

describe("حد الطلبات — حدود الربط والتصنيف", () => {
  it("رمز مسار آخر لا يُقبل على هذا المسار", async () => {
    const { app, rawInject, keys } = createOrderHttpHarness();
    const response = await rawInject({
      method: "POST",
      url: INTAKE,
      headers: {
        ...signFor("POST", "/orders/agreed-prices", { keys, scopes: ALL_ORDER_SCOPES }),
        "idempotency-key": "orders-identity-key-6",
      },
      payload: intakeBody(),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("`/health` مفتوح بقصد ومعلن — لا هوية ولا 401", async () => {
    const { app, rawInject } = createOrderHttpHarness();
    const response = await rawInject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("مسار غير معروف يُرَدّ 401 قبل 404 — لا استكشاف مسارات بلا هوية", async () => {
    const { app, rawInject } = createOrderHttpHarness();
    const response = await rawInject({ method: "GET", url: "/orders/does-not-exist/secret" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("مسار يُسجّل بلا تصنيف يُسقط التطبيق عند الإقلاع لا عند أول طلب", () => {
    const app = createOrderApp({
      runner: createDirectRunner(makeHarness()),
      serviceIdentity: {
        keys: createTestKeyRegistry(),
        replayGuard: new InMemoryServiceTokenReplayGuard(),
      },
    });
    expect(() => {
      app.get("/orders/forgotten", async () => ({ ok: true }));
    }).toThrow(/بلا تصنيف هوية خدمة/u);
  });

  it("سلسلة الاستعلام خارج الربط — و`/orders/lookup` أول مسار يجعل الدين مادّياً (RISK-0026)", async () => {
    // **قياسٌ لا دعوى:** الربط يغطي الطريقة والمسار ولا يغطي سلسلة الاستعلام
    // (ADR-021 §4). وحتى `M1-03` لم يكن في المستودع مسار مفروض يقرأ استعلاماً،
    // فكان الأثر صفراً. و`/orders/lookup` **يقرأ `order_public_id` من الاستعلام
    // وحده**، فرمزٌ صحيحٌ لهذا المسار يظل صحيحاً لو بُدِّل مُعرّف الطلب — وهذا
    // ما يُثبته هذا الاختبار صراحة كي يُرى الدين لا كي يُبارَك. الحدّ الفعلي عليه
    // اليوم: مهلة الرمز القصيرة وحارس الإعادة (استعمال واحد). والسد الحقيقي
    // (ضم الاستعلام إلى الربط) عملُ `M1-05`، وهو مسجّل في RISK-0026.
    const { app, rawInject, keys } = createOrderHttpHarness();
    const headers = signFor("GET", LOOKUP, { keys, scopes: [ORDER_SCOPES.orderRead] });
    const response = await rawInject({
      method: "GET",
      url: `${LOOKUP}?order_public_id=ORD-0000000002`,
      headers,
    });
    // ليس 401: الهوية عبرت رغم أن الاستعلام لم يكن جزءاً مما وُقّع عليه.
    expect(response.statusCode).not.toBe(401);
    await app.close();
  });
});
