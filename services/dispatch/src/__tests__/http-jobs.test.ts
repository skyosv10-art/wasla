import { describe, expect, it } from "vitest";

import { createDispatchApp } from "../http/app.js";
import { createDirectRunner } from "../runner.js";
import { createHarness, orderRef, ZONE_ID } from "./harness.js";

const key = "dispatch-create-key";
const body = (index = 1) => ({
  order_id: orderRef(index).orderId,
  order_public_id: orderRef(index).orderPublicId,
  zone_id: ZONE_ID,
  order_type: "ride",
  vehicle_class: "sedan",
});

describe("واجهة المهام", () => {
  it("تنشئ 201 ثم تعيد 200 للمفتاح والحمولة نفسيهما", async () => {
    const harness = createHarness();
    harness.orders.seedOrder(orderRef(1).orderId);
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps) });
    const first = await app.inject({ method: "POST", url: "/dispatch/jobs", headers: { "idempotency-key": key }, payload: body() });
    const replay = await app.inject({ method: "POST", url: "/dispatch/jobs", headers: { "idempotency-key": key }, payload: body() });
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect((await first.json()).id).toBe((await replay.json()).id);
    await app.close();
  });

  it("يرفض الرأس المفقود والقصير والمكرر والحقل الزائد بما فيه rules", async () => {
    const harness = createHarness();
    harness.orders.seedOrder(orderRef(1).orderId);
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps) });
    for (const request of [
      { headers: {}, payload: body() },
      { headers: { "idempotency-key": "short" }, payload: body() },
      { headers: { "idempotency-key": [key, "dispatch-other-key"] }, payload: body() },
      { headers: { "idempotency-key": key }, payload: { ...body(), rules: {} } },
    ]) {
      const response = await app.inject({ method: "POST", url: "/dispatch/jobs", ...request });
      expect(response.statusCode).toBe(400);
      expect(await response.json()).toMatchObject({ code: "DISPATCH_VALIDATION_FAILED" });
    }
    await app.close();
  });

  it("يرفض إعادة المفتاح بحمولة مختلفة ولا يفتح موجة عند الإنشاء", async () => {
    const harness = createHarness();
    harness.orders.seedOrder(orderRef(1).orderId);
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps) });
    await app.inject({ method: "POST", url: "/dispatch/jobs", headers: { "idempotency-key": key }, payload: body() });
    const conflict = await app.inject({ method: "POST", url: "/dispatch/jobs", headers: { "idempotency-key": key }, payload: { ...body(), vehicle_class: "suv" } });
    expect(conflict.statusCode).toBe(409);
    expect(await harness.waves.listForJob("00000000-0000-4000-8000-000000000001")).toHaveLength(0);
    await app.close();
  });

  it("يرفض مفتاح منع التكرار المفقود عند إنشاء المهمة", async () => {
    const harness = createHarness();
    harness.orders.seedOrder(orderRef(1).orderId);
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps) });

    const response = await app.inject({ method: "POST", url: "/dispatch/jobs", payload: body() });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("يرفض مفتاح منع التكرار الأقصر من ثمانية أحرف", async () => {
    const harness = createHarness();
    harness.orders.seedOrder(orderRef(1).orderId);
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps) });

    const response = await app.inject({ method: "POST", url: "/dispatch/jobs", headers: { "idempotency-key": "1234567" }, payload: body() });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("يرفض مفتاح منع التكرار الأطول من مئة وثمانية وعشرين حرفاً", async () => {
    const harness = createHarness();
    harness.orders.seedOrder(orderRef(1).orderId);
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps) });

    const response = await app.inject({ method: "POST", url: "/dispatch/jobs", headers: { "idempotency-key": "k".repeat(129) }, payload: body() });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("يرفض الحقل الإضافي في جسم إنشاء المهمة", async () => {
    const harness = createHarness();
    harness.orders.seedOrder(orderRef(1).orderId);
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps) });

    const response = await app.inject({ method: "POST", url: "/dispatch/jobs", headers: { "idempotency-key": key }, payload: { ...body(), unexpected: true } });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("يرفض rules في جسم إنشاء المهمة", async () => {
    const harness = createHarness();
    harness.orders.seedOrder(orderRef(1).orderId);
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps) });

    const response = await app.inject({ method: "POST", url: "/dispatch/jobs", headers: { "idempotency-key": key }, payload: { ...body(), rules: {} } });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("يرفض جسم JSON التالف عند إنشاء المهمة", async () => {
    const app = createDispatchApp({ runner: createDirectRunner(createHarness().deps) });

    const response = await app.inject({
      method: "POST",
      url: "/dispatch/jobs",
      headers: { "idempotency-key": key, "content-type": "application/json" },
      payload: "{",
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("يرفض نوع المحتوى غير المدعوم عند إنشاء المهمة", async () => {
    const app = createDispatchApp({ runner: createDirectRunner(createHarness().deps) });

    const response = await app.inject({
      method: "POST",
      url: "/dispatch/jobs",
      headers: { "idempotency-key": key, "content-type": "text/plain" },
      payload: "ليس JSON",
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("لا يفتح موجة عند إنشاء مهمة جديدة", async () => {
    const harness = createHarness();
    harness.orders.seedOrder(orderRef(1).orderId);
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps) });

    const response = await app.inject({ method: "POST", url: "/dispatch/jobs", headers: { "idempotency-key": key }, payload: body() });

    expect(response.statusCode).toBe(201);
    expect(await harness.waves.listForJob((await response.json()).id)).toHaveLength(0);
    await app.close();
  });
});
