import { describe, expect, it } from "vitest";

import { createSignedDispatchApp as createDispatchApp } from "./service-identity-support.js";
import { createDirectRunner } from "../runner.js";
import { createHarness, orderRef, ZONE_ID } from "./harness.js";

describe("أخطاء HTTP", () => {
  it("لا يعيد صدى المعرّف غير المقبول", async () => {
    const app = createDispatchApp({ runner: createDirectRunner(createHarness().deps) });
    const rejected = "ليس-معرفاً-ويجب-ألا-يظهر";
    const response = await app.inject({ method: "GET", url: `/dispatch/jobs/${encodeURIComponent(rejected)}` });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(rejected);
    await app.close();
  });

  it("يعيد رموز العقد 404 و422 و503", async () => {
    const harness = createHarness();
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps) });
    const unknown = "10000000-0000-4000-8000-000000000099";
    const missing = await app.inject({ method: "GET", url: `/dispatch/jobs/${unknown}` });
    const invalidReason = await app.inject({
      method: "POST",
      url: `/dispatch/jobs/${unknown}/cancel`,
      headers: { "idempotency-key": "invalid-reason-key" },
      payload: { reason_code: "ليس-سبباً" },
    });
    const order = orderRef(1);
    harness.orders.seedOrder(order.orderId);
    harness.orders.failNext("unavailable");
    const unavailable = await app.inject({
      method: "POST",
      url: "/dispatch/jobs",
      headers: { "idempotency-key": "unavailable-job-key" },
      payload: {
        order_id: order.orderId,
        order_public_id: order.orderPublicId,
        zone_id: ZONE_ID,
        order_type: "ride",
        vehicle_class: "sedan",
      },
    });
    expect(missing.statusCode).toBe(404);
    expect(invalidReason.statusCode).toBe(422);
    expect(unavailable.statusCode).toBe(503);
    await app.close();
  });

  it("يرفض معرّف المهمة غير UUID برمز تحقق", async () => {
    const app = createDispatchApp({ runner: createDirectRunner(createHarness().deps) });

    const response = await app.inject({ method: "GET", url: "/dispatch/jobs/not-a-uuid" });

    expect(response.statusCode).toBe(400);
    expect(await response.json()).toMatchObject({ code: "DISPATCH_VALIDATION_FAILED" });
    await app.close();
  });

  it("لا يعيد صدى مفتاح التكرار المرفوض", async () => {
    const rejected = "rejected, key";
    const app = createDispatchApp({ runner: createDirectRunner(createHarness().deps) });

    const response = await app.inject({
      method: "POST",
      url: "/dispatch/jobs",
      headers: { "idempotency-key": rejected },
      payload: {
        order_id: orderRef(1).orderId,
        order_public_id: orderRef(1).orderPublicId,
        zone_id: ZONE_ID,
        order_type: "ride",
        vehicle_class: "sedan",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(rejected);
    await app.close();
  });

  it("يحّول الخطأ غير المعروف من المعالج إلى 503", async () => {
    const app = createDispatchApp({
      runner: {
        read: async () => {
          throw new Error("لا يجب أن تُقرأ");
        },
        write: async () => {
          throw new Error("خلل غير معروف");
        },
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/dispatch/jobs",
      headers: { "idempotency-key": "unknown-error-key" },
      payload: {
        order_id: orderRef(1).orderId,
        order_public_id: orderRef(1).orderPublicId,
        zone_id: ZONE_ID,
        order_type: "ride",
        vehicle_class: "sedan",
      },
    });

    expect(response.statusCode).toBe(503);
    expect(await response.json()).toMatchObject({ code: "DISPATCH_ENGINE_UNAVAILABLE" });
    await app.close();
  });
});
