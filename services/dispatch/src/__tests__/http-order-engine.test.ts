import { afterEach, describe, expect, it, vi } from "vitest";

import { createServiceRequestSigner, SERVICE_AUTH_HEADER, ServiceAuthKeyRegistry } from "@wasla/service-auth";

import { DISPATCH_ORDERS_SCOPES, HttpOrderEnginePort } from "../infrastructure/http-order-engine.js";

/** موقّع اختباري حقيقي: النداء يجب أن يحمل ترويسة يقبلها حد الطلبات (M1-04). */
const TEST_SIGNER = createServiceRequestSigner({
  serviceName: "dispatch",
  audience: "orders",
  keys: new ServiceAuthKeyRegistry({
    keys: [{ kid: "test", secret: "dispatch-orders-secret-0123456789", status: "active" }],
    activeKid: "test",
  }),
  scopes: DISPATCH_ORDERS_SCOPES,
});


const orderId = "10000000-0000-4000-8000-000000000001";
const assignmentId = "70000000-0000-4000-8000-000000000001";
const registerInput = { orderId, driverPublicId: "WS-0000000001", idempotencyKey: "register-key", traceId: "trace-register" };
const resolveInput = { orderId, assignmentId, state: "rejected" as const, reasonCode: "DRIVER_DECLINED", idempotencyKey: "resolve-key", traceId: "trace-resolve" };
const transitionInput = { orderId, to: "cancelled" as const, reasonCode: "ORDER_CANCELLED", idempotencyKey: "transition-key", traceId: "trace-transition" };
const assignment = { id: assignmentId };

afterEach(() => vi.unstubAllGlobals());

function port(timeoutMs?: number): HttpOrderEnginePort {
  return new HttpOrderEnginePort({ baseUrl: "http://orders.test", timeoutMs, signRequest: TEST_SIGNER });
}

describe("محول محرّك الطلبات لتسجيل العرض", () => {
  it("يوقّع كل نداء صادر بترويسة هوية مربوطة بالطريقة والمسار (M1-04)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(assignment), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await port().registerOffer(registerInput);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://orders.test/orders/${orderId}/assignments`);
    // نداء بلا ترويسة هوية يُرَدّ 401 من حد الطلبات؛ فغيابها هنا عطلٌ لا تفصيل.
    expect((options.headers as Record<string, string>)[SERVICE_AUTH_HEADER]).toMatch(/^wsvc2\./u);
  });

  it("يعيد applied عند إنشاء تسجيل العرض", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(assignment), { status: 201 })));
    await expect(port().registerOffer(registerInput)).resolves.toEqual({ outcome: "applied", assignmentId });
  });

  it("يعيد already_applied عند إعادة تسجيل العرض", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(assignment), { status: 200 })));
    await expect(port().registerOffer(registerInput)).resolves.toEqual({ outcome: "already_applied", assignmentId });
  });

  it("يعيد rejected مع رمز المحرّك عند رفض تسجيل العرض", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "ORDER_ASSIGNMENT_FORBIDDEN" }), { status: 409 })));
    await expect(port().registerOffer(registerInput)).resolves.toEqual({ outcome: "rejected", rejectionCode: "ORDER_ASSIGNMENT_FORBIDDEN" });
  });

  it("يعيد unavailable عند تعذر تسجيل العرض", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(port().registerOffer(registerInput)).resolves.toEqual({ outcome: "unavailable" });
  });

  it("يعيد timeout عند انتهاء مهلة تسجيل العرض", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("مهلة"), { name: "AbortError" })));
    await expect(port().registerOffer(registerInput)).resolves.toEqual({ outcome: "timeout" });
  });

  it("يحافظ على مفتاح تسجيل العرض ويمرر معرّف التتبع", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(assignment), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await port().registerOffer(registerInput);
    await port().registerOffer(registerInput);
    await port().registerOffer({ ...registerInput, idempotencyKey: "register-other-key" });

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ "idempotency-key": "register-key", "x-request-id": "trace-register" });
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ "idempotency-key": "register-key" });
    expect(fetchMock.mock.calls[2][1].headers).toMatchObject({ "idempotency-key": "register-other-key" });
  });

  it("لا يعد JSON التالف من تسجيل العرض نجاحاً", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{", { status: 201 })));
    await expect(port().registerOffer(registerInput)).resolves.toEqual({ outcome: "unavailable" });
  });
});

describe("محول محرّك الطلبات لحسم الإسناد", () => {
  it("يعيد applied عند حسم الإسناد الجديد", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 201 })));
    await expect(port().resolveAssignment(resolveInput)).resolves.toEqual({ outcome: "applied" });
  });

  it("يعيد already_applied عند إعادة حسم الإسناد", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await expect(port().resolveAssignment(resolveInput)).resolves.toEqual({ outcome: "already_applied" });
  });

  it("يعيد rejected مع رمز المحرّك عند رفض حسم الإسناد", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "ORDER_ASSIGNMENT_ALREADY_RESOLVED" }), { status: 422 })));
    await expect(port().resolveAssignment(resolveInput)).resolves.toEqual({ outcome: "rejected", rejectionCode: "ORDER_ASSIGNMENT_ALREADY_RESOLVED" });
  });

  it("يعيد unavailable عند تعذر حسم الإسناد", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("انقطاع")));
    await expect(port().resolveAssignment(resolveInput)).resolves.toEqual({ outcome: "unavailable" });
  });

  it("يعيد timeout عند انتهاء مهلة حسم الإسناد", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("مهلة"), { name: "AbortError" })));
    await expect(port().resolveAssignment(resolveInput)).resolves.toEqual({ outcome: "timeout" });
  });

  it("يحافظ على مفتاح حسم الإسناد ويمرر معرّف التتبع", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await port().resolveAssignment(resolveInput);
    await port().resolveAssignment(resolveInput);
    await port().resolveAssignment({ ...resolveInput, idempotencyKey: "resolve-other-key" });

    expect(fetchMock.mock.calls[0][0]).toBe(`http://orders.test/orders/${orderId}/assignments/${assignmentId}`);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ "idempotency-key": "resolve-key", "x-request-id": "trace-resolve" });
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ "idempotency-key": "resolve-key" });
    expect(fetchMock.mock.calls[2][1].headers).toMatchObject({ "idempotency-key": "resolve-other-key" });
  });

  it("لا يعد JSON التالف من حسم الإسناد نجاحاً", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{", { status: 200 })));
    await expect(port().resolveAssignment(resolveInput)).resolves.toEqual({ outcome: "unavailable" });
  });
});

describe("محول محرّك الطلبات لانتقال الطلب", () => {
  it("يعيد applied عند انتقال طلب جديد", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 201 })));
    await expect(port().transitionOrder(transitionInput)).resolves.toEqual({ outcome: "applied" });
  });

  it("يعيد already_applied عند إعادة انتقال الطلب", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await expect(port().transitionOrder(transitionInput)).resolves.toEqual({ outcome: "already_applied" });
  });

  it("يعيد rejected مع رمز المحرّك عند رفض انتقال الطلب", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "ORDER_ILLEGAL_TRANSITION" }), { status: 409 })));
    await expect(port().transitionOrder(transitionInput)).resolves.toEqual({ outcome: "rejected", rejectionCode: "ORDER_ILLEGAL_TRANSITION" });
  });

  it("يعيد unavailable عند تعذر انتقال الطلب", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    await expect(port().transitionOrder(transitionInput)).resolves.toEqual({ outcome: "unavailable" });
  });

  it("يعيد timeout عند انتهاء مهلة انتقال الطلب", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("مهلة"), { name: "AbortError" })));
    await expect(port().transitionOrder(transitionInput)).resolves.toEqual({ outcome: "timeout" });
  });

  it("يحافظ على مفتاح انتقال الطلب ويمرر معرّف التتبع", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await port().transitionOrder(transitionInput);
    await port().transitionOrder(transitionInput);
    await port().transitionOrder({ ...transitionInput, idempotencyKey: "transition-other-key" });

    expect(fetchMock.mock.calls[0][0]).toBe(`http://orders.test/orders/${orderId}/transitions`);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ "idempotency-key": "transition-key", "x-request-id": "trace-transition" });
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ "idempotency-key": "transition-key" });
    expect(fetchMock.mock.calls[2][1].headers).toMatchObject({ "idempotency-key": "transition-other-key" });
  });

  it("لا يعد JSON التالف من انتقال الطلب نجاحاً", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{", { status: 200 })));
    await expect(port().transitionOrder(transitionInput)).resolves.toEqual({ outcome: "unavailable" });
  });

  it("يلغي الطلب فعلاً عند انتهاء المهلة", async () => {
    let aborted = false;
    const fetchMock = vi.fn((_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(Object.assign(new Error("أوقف"), { name: "AbortError" }));
        });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(port(1).transitionOrder(transitionInput)).resolves.toEqual({ outcome: "timeout" });
    expect(aborted).toBe(true);
  });
});
