/**
 * إثباتُ الفرضِ على **حدِّ التوصيلِ** (`M1-04` · الموجةُ السادسةُ ·
 * المراجعةُ 17/N · رفعُ دَينِ ADR-026 §4.18).
 *
 * هذا الملفُّ وحدَه يستعملُ `rawInject` **بلا توقيعٍ**؛ فبقيّةُ اختباراتِ HTTP
 * يوقِّعُ لها السندُ تلقائيّاً، ولو أُثبِتَ الفرضُ بها لأُثبِتَ **السندُ** لا
 * الحدُّ. وهذا هوَ الفرقُ بينَ اختبارٍ يطمئنُ واختبارٍ يشهدُ.
 *
 * المصفوفةُ المطلوبةُ (ADR-020 · ADR-021): لا هويّةَ → 401 · منتحلةٌ → 401 ·
 * منتهيةٌ → 401 · جمهورٌ آخرُ → 401 · مسارٌ أو طريقةٌ أخرى → 401 · رمزٌ معادٌ →
 * 401 · صحيحةٌ بصلاحيّةٍ ناقصةٍ → 403 · مخزنُ الآثارِ صامتٌ → 503 · مسارٌ
 * مجهولٌ → 401 قبلَ 404 · مسارٌ بلا تصنيفٍ → سقوطُ الإقلاعِ.
 *
 * **وثلاثةُ أكوادٍ لا كودانِ** — وهذا **قِيسَ ولم يُفتَرَض**: الوسيطُ المشتركُ
 * يُميِّزُ الانتهاءَ (`AUTHN_EXPIRED`) وعدمَ مطابقةِ الجمهورِ
 * (`AUTHN_AUDIENCE_MISMATCH`) عن الغالبِ (`AUTHN_UNAUTHENTICATED`) بقصدٍ مكتوبٍ
 * في [`errors.ts`](../../../../packages/service-auth/src/errors.ts): البابانِ
 * يخدمانِ المُشغِّلَ الشريفَ («جدِّد» و«أصلِحْ إعدادَ النشرِ») ولا يُنطَقُ بهما
 * إلّا **بعدَ** إثباتِ التوقيعِ، فلا يُفيدانِ مَن لا يملكُ مفتاحاً. وحدُّ
 * التوصيلِ **يورِثُ** هذا ولا يُخصِّصُهُ — وتُثبَتُ الثلاثةُ هنا كما هيَ.
 *
 * ويُضافُ ما يخصُّ **هذا** الحدَّ وحدَهُ: أنَّ الأفعالَ الأربعةَ الخطيرةَ —
 * إعلانُ الدفعِ وإنشاءُ الطلبِ وإلغاؤهُ وتقديمُ تنفيذِهِ — **لا تُنالُ برمزِ
 * قراءةٍ**، وأنَّ مسارَي الرصدِ مفتوحانِ بقصدٍ مُعلَنٍ.
 */

import {
  InMemoryServiceTokenReplayGuard,
  ServiceTokenReplayStoreUnavailableError,
  serviceAuthHeaders,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import { describe, expect, it } from "vitest";

import { buildDeliveryHttpApp } from "../http/app.js";
import { DELIVERY_SCOPES } from "../http/service-identity.js";

import {
  ALL_DELIVERY_SCOPES,
  buildSignedDeliveryApp,
  createTestKeyRegistry,
  signFor,
  TEST_FORGED_SECRET,
} from "./service-identity-support.js";
import {
  CUSTOMER_REF,
  FakeCatalog,
  FakeReadinessProbe,
  FakeReservationPort,
  FakeReservationStore,
  FakeStoreOrderStore,
  PRODUCT_A,
  STORE_SLUG,
  fixedOrder,
  fixedTask,
  uuidSequence,
} from "./store-order-fakes.js";

const NOW = "2026-09-10T10:00:00.000Z";
const ORDER = "WS-0000000001";
const ORDERS = "/store-orders";

/** رمزَا الرفضِ بلا سابقةِ `DELIVERY_` — مفرداتُ ADR-020 لا مفرداتُ خدمةٍ. */
const UNAUTHENTICATED = "AUTHN_UNAUTHENTICATED";
const FORBIDDEN = "AUTHZ_FORBIDDEN";

/** جسمُ إنشاءٍ **صحيحٌ** كي يكونَ الرفضُ عن الهويّةِ لا عن التحقّقِ من الجسمِ. */
const placement = {
  customer_ref: CUSTOMER_REF,
  store_slug: STORE_SLUG,
  items: [{ product_id: PRODUCT_A, quantity: 1 }],
  delivery_fee_minor_units: 500,
};

let keyCounter = 0;
function idempotency(): Record<string, string> {
  keyCounter += 1;
  return { "idempotency-key": `identity-key-${String(keyCounter).padStart(6, "0")}` };
}

/** سندٌ مفروضٌ وطلبٌ مبذورٌ: الأفعالُ على طلبٍ قائمٍ لا على مُعرِّفٍ متخيَّلٍ. */
function harnessApp() {
  const store = new FakeStoreOrderStore();
  store.seed(fixedOrder(), fixedTask());
  const built = buildSignedDeliveryApp({
    readPort: store,
    writePort: store,
    catalogPort: new FakeCatalog(),
    reservationPort: new FakeReservationPort(),
    reservationStore: new FakeReservationStore(),
    readinessPort: new FakeReadinessProbe([{ name: "database", ok: true }]),
    newUuid: uuidSequence(),
    now: () => NOW,
  });
  return { store, ...built };
}

/** تطبيقٌ بمخزنِ آثارٍ يُقرِّرُهُ الاختبارُ — لإثباتِ الإغلاقِ عندَ العجزِ. */
function appWithGuard(replayGuard: ServiceTokenReplayGuard) {
  const store = new FakeStoreOrderStore();
  store.seed(fixedOrder(), fixedTask());
  const keys = createTestKeyRegistry();
  const app = buildDeliveryHttpApp({
    readPort: store,
    writePort: store,
    catalogPort: new FakeCatalog(),
    reservationPort: new FakeReservationPort(),
    reservationStore: new FakeReservationStore(),
    newUuid: uuidSequence(),
    now: () => NOW,
    serviceIdentity: { keys, replayGuard },
  });
  return { app, keys };
}

describe("حد التوصيل — مصفوفة المصادقة الداخلة", () => {
  it("لا هوية → 401 بمغلف عقد التوصيل (error_code) ولا يُسمّى سبب الرفض", async () => {
    const { app, rawInject } = harnessApp();
    const response = await rawInject({
      method: "POST",
      url: ORDERS,
      headers: idempotency(),
      payload: placement,
    });
    expect(response.statusCode).toBe(401);
    const body = response.json() as Record<string, unknown>;
    // العقدُ المنشورُ يُوجِبُ الثلاثةَ، و`code` ليسَ منها: منادٍ يقرأُ
    // `error_code` في كلِّ خطأٍ لن يقرأَ رفضَهُ لو غُيِّرَ الاسمُ هنا.
    expect(body.error_code).toBe(UNAUTHENTICATED);
    expect(body.trace_id).toBeTruthy();
    expect(body.code).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(["error_code", "message", "trace_id"]);
    // السببُ يُسجَّلُ ولا يُعادُ: «رمزٌ منتهٍ» و«توقيعٌ خاطئٌ» فرقٌ يفيدُ المهاجمَ.
    expect(String(body.message)).not.toMatch(/توقيع|منته|kid|صلاحي|جمهور/u);
    await app.close();
  });

  it("هوية منتحلة بسر آخر → 401 لا 403 ولا 500", async () => {
    const { app, rawInject } = harnessApp();
    const response = await rawInject({
      method: "POST",
      url: ORDERS,
      headers: {
        ...idempotency(),
        ...signFor("POST", ORDERS, { keys: createTestKeyRegistry(TEST_FORGED_SECRET) }),
      },
      payload: placement,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error_code).toBe(UNAUTHENTICATED);
    await app.close();
  });

  it("رمز منتهٍ → 401؛ فالزمن جزء من الرمز لا زينة", async () => {
    const { app, rawInject, keys } = harnessApp();
    const response = await rawInject({
      method: "POST",
      url: ORDERS,
      headers: {
        ...idempotency(),
        // ساعةٌ قبلَ الآنَ: أطولُ من أيِّ عمرٍ مسموحٍ ومن أيِّ انحرافٍ مقبولٍ.
        ...signFor("POST", ORDERS, { keys, now: new Date(Date.now() - 3_600_000) }),
      },
      payload: placement,
    });
    expect(response.statusCode).toBe(401);
    // `AUTHN_EXPIRED` لا `AUTHN_UNAUTHENTICATED`: انظرْ ترويسةَ الملفِّ — تمييزٌ
    // مقصودٌ في الوسيطِ المشتركِ لا سهوٌ في هذا الحدِّ.
    expect(response.json().error_code).toBe("AUTHN_EXPIRED");
    await app.close();
  });

  it("جمهور آخر → 401 بكود الجمهور: خطأ نشرٍ يُشخّص ولا يُخفى", async () => {
    const { app, rawInject, keys } = harnessApp();
    // رمزٌ صحيحُ التوقيعِ موجَّهٌ إلى حدِّ السوقِ لا إلى حدِّ التوصيلِ.
    const headers = serviceAuthHeaders({
      serviceName: "core",
      audience: "marketplace",
      method: "POST",
      path: ORDERS,
      keys,
      now: new Date(),
      scopes: ALL_DELIVERY_SCOPES,
    });
    const response = await rawInject({
      method: "POST",
      url: ORDERS,
      headers: { ...idempotency(), ...headers },
      payload: placement,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error_code).toBe("AUTHN_AUDIENCE_MISMATCH");
    await app.close();
  });

  it("هوية صحيحة بالصلاحية المطلوبة → يمر الطلب إلى المجال (201)", async () => {
    const { app, rawInject, keys } = harnessApp();
    const response = await rawInject({
      method: "POST",
      url: ORDERS,
      headers: {
        ...idempotency(),
        ...signFor("POST", ORDERS, {
          keys,
          serviceName: "core",
          scopes: [DELIVERY_SCOPES.storeOrderWrite],
        }),
      },
      payload: placement,
    });
    // الفرضُ **يسمحُ** كما يمنعُ: حدٌّ يرفضُ كلَّ شيءٍ ليسَ مفروضاً بل معطَّلاً.
    expect(response.statusCode).toBe(201);
    await app.close();
  });

  it("هوية صحيحة وصلاحية ناقصة → 403 لا 401", async () => {
    const { app, rawInject, keys } = harnessApp();
    // منادٍ يملكُ القراءةَ ويحاولُ الإنشاءَ: الفرقُ بينَ «مَن أنتَ» و«ماذا تملكُ».
    const response = await rawInject({
      method: "POST",
      url: ORDERS,
      headers: {
        ...idempotency(),
        ...signFor("POST", ORDERS, { keys, scopes: [DELIVERY_SCOPES.storeOrderRead] }),
      },
      payload: placement,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error_code).toBe(FORBIDDEN);
    await app.close();
  });

  it("الرمز نفسه مرتين → 401 في الثانية (إعادة · ADR-021)", async () => {
    const { app, rawInject, keys } = harnessApp();
    const path = `${ORDERS}/${ORDER}`;
    const headers = signFor("GET", path, { keys, scopes: [DELIVERY_SCOPES.storeOrderRead] });
    const first = await rawInject({ method: "GET", url: path, headers });
    const second = await rawInject({ method: "GET", url: path, headers });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(401);
    await app.close();
  });

  it("مخزن الآثار لا يجيب → 503 لا 201: الإغلاق عند العجز", async () => {
    const { app } = appWithGuard({
      remember() {
        throw new ServiceTokenReplayStoreUnavailableError("المخزن صامت.");
      },
    });
    const response = await app.fastify.inject({
      method: "POST",
      url: ORDERS,
      headers: { ...idempotency(), ...signFor("POST", ORDERS) },
      payload: placement,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error_code).toBe("SERVICE_AUTH_REPLAY_STORE_UNAVAILABLE");
    await app.close();
  });
});

describe("حد التوصيل — الأفعال الأربعة الخطيرة لا تُنال برمز قراءة", () => {
  const read = [DELIVERY_SCOPES.storeOrderRead, DELIVERY_SCOPES.deliveryTaskRead];

  it("رمز قراءةٍ لا يُعلن طلباً مدفوعاً → 403", async () => {
    const { app, rawInject, keys } = harnessApp();
    const path = `${ORDERS}/${ORDER}/payment-mirror`;
    const response = await rawInject({
      method: "PUT",
      url: path,
      headers: { ...idempotency(), ...signFor("PUT", path, { keys, scopes: read }) },
      payload: { payment_state: "paid", payment_ref: "PAY-1" },
    });
    // 403 **قبلَ** أن يُسألَ المجالُ: الرفضُ عن الصلاحيّةِ لا عن حالةِ الطلبِ.
    expect(response.statusCode).toBe(403);
    expect(response.json().error_code).toBe(FORBIDDEN);
    await app.close();
  });

  it("رمز قراءةٍ لا يُلغي طلباً حياً → 403", async () => {
    const { app, rawInject, keys } = harnessApp();
    const path = `${ORDERS}/${ORDER}/cancellation`;
    const response = await rawInject({
      method: "POST",
      url: path,
      headers: { ...idempotency(), ...signFor("POST", path, { keys, scopes: read }) },
      payload: { reason_code: "CUSTOMER_CHANGED_MIND" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error_code).toBe(FORBIDDEN);
    await app.close();
  });

  it("رمز قراءةٍ لا يُقدّم التنفيذ → 403؛ والتسليم خصم لا يُستردّ", async () => {
    const { app, rawInject, keys } = harnessApp();
    const path = `${ORDERS}/${ORDER}/fulfillment-transition`;
    const response = await rawInject({
      method: "POST",
      url: path,
      headers: { ...idempotency(), ...signFor("POST", path, { keys, scopes: read }) },
      payload: { target_state: "delivered" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error_code).toBe(FORBIDDEN);
    await app.close();
  });

  it("صلاحية إلغاءٍ لا تفتح مرآة الدفع — صلاحية لكل خطرٍ لا صلاحية للحدّ", async () => {
    const { app, rawInject, keys } = harnessApp();
    const path = `${ORDERS}/${ORDER}/payment-mirror`;
    const response = await rawInject({
      method: "PUT",
      url: path,
      headers: {
        ...idempotency(),
        ...signFor("PUT", path, { keys, scopes: [DELIVERY_SCOPES.storeOrderCancel] }),
      },
      payload: { payment_state: "paid", payment_ref: "PAY-2" },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("مسارا التشغيل خارج العقد لهما صلاحيتاهما: دورة الطلب لا تفتح المكنسة", async () => {
    const { app, rawInject, keys } = harnessApp();
    const path = "/delivery/idempotency-keys/sweep";
    const response = await rawInject({
      method: "POST",
      url: path,
      headers: signFor("POST", path, {
        keys,
        scopes: [DELIVERY_SCOPES.storeOrderWrite, DELIVERY_SCOPES.storeOrderConfirm],
      }),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error_code).toBe(FORBIDDEN);
    await app.close();
  });
});

describe("حد التوصيل — حدود الربط والتصنيف", () => {
  it("رمز مسارٍ آخر لا يُقبل ولو حمل كل الصلاحيات", async () => {
    const { app, rawInject, keys } = harnessApp();
    const path = `${ORDERS}/${ORDER}/confirmation`;
    const response = await rawInject({
      method: "POST",
      url: path,
      headers: {
        ...idempotency(),
        ...signFor("POST", ORDERS, { keys, scopes: ALL_DELIVERY_SCOPES }),
      },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("رمز طريقةٍ أخرى على المسار نفسه لا يُقبل", async () => {
    const { app, rawInject, keys } = harnessApp();
    const path = `${ORDERS}/${ORDER}`;
    const response = await rawInject({
      method: "GET",
      url: path,
      headers: signFor("POST", path, { keys, scopes: ALL_DELIVERY_SCOPES }),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("رمز طلبٍ لا يقرأ طلباً آخر — المُعرّف داخل الربط لا خارجه", async () => {
    // **الفرقُ عن `RISK-0026`:** المُعرِّفُ هنا جزءٌ من **المسارِ** لا من سلسلةِ
    // الاستفسارِ، والربطُ يغطّي المسارَ (ADR-021 §4). وهذا يُقاسُ لا يُدَّعى.
    const { app, rawInject, keys } = harnessApp();
    const headers = signFor("GET", `${ORDERS}/${ORDER}`, {
      keys,
      scopes: [DELIVERY_SCOPES.storeOrderRead],
    });
    const response = await rawInject({ method: "GET", url: `${ORDERS}/WS-0000000002`, headers });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("`/delivery/health` مفتوح بقصد معلن — لا هوية ولا 401", async () => {
    const { app, rawInject } = harnessApp();
    const response = await rawInject({ method: "GET", url: "/delivery/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("`/delivery/ready` مفتوح بقصد معلن — منادِيه مُنسّقُ النشر ولا مفتاح له", async () => {
    // إغلاقُهُ يوقفُ النشرَ لا المهاجمَ، وجسمُهُ لا يحملُ طلباً ولا متجراً ولا
    // مبلغاً — أسماءَ تابعينَ وحالاتِهم. والقرارُ مكتوبٌ في السجلِّ §5 لا مُستنتَجٌ.
    const { app, rawInject } = harnessApp();
    const response = await rawInject({ method: "GET", url: "/delivery/ready" });
    expect(response.statusCode).not.toBe(401);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ready" });
    await app.close();
  });

  it("مسار غير معروف يُرَدّ 401 قبل 404 — لا استكشاف مسارات بلا هوية", async () => {
    const { app, rawInject } = harnessApp();
    const response = await rawInject({ method: "GET", url: "/store-orders/x/does-not-exist" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error_code).toBe(UNAUTHENTICATED);
    await app.close();
  });

  it("مسار يُسجّل بلا تصنيف يُسقط التطبيق عند الإقلاع لا عند أول طلب", () => {
    const store = new FakeStoreOrderStore();
    const app = buildDeliveryHttpApp({
      readPort: store,
      writePort: store,
      reservationPort: new FakeReservationPort(),
      reservationStore: new FakeReservationStore(),
      newUuid: uuidSequence(),
      now: () => NOW,
      serviceIdentity: {
        keys: createTestKeyRegistry(),
        replayGuard: new InMemoryServiceTokenReplayGuard(),
      },
    });
    expect(() => {
      app.fastify.get("/delivery/forgotten", async () => ({ ok: true }));
    }).toThrow(/بلا تصنيف هوية خدمة/u);
  });
});
