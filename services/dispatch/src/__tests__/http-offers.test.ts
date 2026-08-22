import { describe, expect, it } from "vitest";

import { createDispatchApp } from "../http/app.js";
import { createDirectRunner } from "../runner.js";
import { createDispatchJob } from "../use-cases/create-job.js";
import { createHarness, driverId, orderRef, ZONE_ID } from "./harness.js";

describe("واجهة العروض", () => {
  it("تسجل الرفض ولا تفتح موجة لاحقة قبل نبضة جديدة", async () => {
    const harness = createHarness();
    const order = orderRef(1);
    harness.orders.seedOrder(order.orderId);
    const job = await createDispatchJob(harness.deps, { ...order, zoneId: ZONE_ID, orderType: "ride", vehicleClass: "sedan", idempotencyKey: "offer-create-key" });
    harness.matching.setPool([driverId(1)]);
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps) });
    await app.inject({ method: "POST", url: "/dispatch/tick", headers: { "idempotency-key": "offer-tick-key" } });
    const offer = (await harness.offers.listForJob(job.job.id))[0];
    const rejection = await app.inject({ method: "POST", url: `/dispatch/offers/${offer.id}/reject`, headers: { "idempotency-key": "offer-reject-key" }, payload: { reason_code: "DRIVER_DECLINED" } });
    expect(rejection.statusCode).toBe(200);
    expect(await harness.waves.listForJob(job.job.id)).toHaveLength(1);
    const listed = await app.inject({ method: "GET", url: `/dispatch/jobs/${job.job.id}/offers` });
    expect((await listed.json()).items).toHaveLength(1);
    await app.close();
  });

  it("يرفض كود سبب خارج كتالوج رفض العرض", async () => {
    const harness = createHarness();
    const order = orderRef(1);
    harness.orders.seedOrder(order.orderId);
    const job = await createDispatchJob(harness.deps, { ...order, zoneId: ZONE_ID, orderType: "ride", vehicleClass: "sedan", idempotencyKey: "reason-create-key" });
    harness.matching.setPool([driverId(1)]);
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps) });
    await app.inject({ method: "POST", url: "/dispatch/tick", headers: { "idempotency-key": "reason-tick-key" } });
    const offer = (await harness.offers.listForJob(job.job.id))[0];

    const response = await app.inject({
      method: "POST",
      url: `/dispatch/offers/${offer.id}/reject`,
      headers: { "idempotency-key": "reason-reject-key" },
      payload: { reason_code: "NOT_A_REASON" },
    });

    expect(response.statusCode).toBe(422);
    await app.close();
  });

  it("يعيد 404 عند قبول عرض غير موجود", async () => {
    const app = createDispatchApp({ runner: createDirectRunner(createHarness().deps) });

    const response = await app.inject({
      method: "POST",
      url: "/dispatch/offers/90000000-0000-4000-8000-000000000001/accept",
      headers: { "idempotency-key": "missing-offer-key" },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("يرفض معرّف العرض غير UUID قبل محاولة قبول العرض", async () => {
    const app = createDispatchApp({ runner: createDirectRunner(createHarness().deps) });

    const response = await app.inject({
      method: "POST",
      url: "/dispatch/offers/not-a-uuid/accept",
      headers: { "idempotency-key": "invalid-offer-key" },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("يعيد 409 عند رفض عرض حُسم سابقاً", async () => {
    const harness = createHarness();
    const order = orderRef(1);
    harness.orders.seedOrder(order.orderId);
    const job = await createDispatchJob(harness.deps, { ...order, zoneId: ZONE_ID, orderType: "ride", vehicleClass: "sedan", idempotencyKey: "resolved-create-key" });
    harness.matching.setPool([driverId(1)]);
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps) });
    await app.inject({ method: "POST", url: "/dispatch/tick", headers: { "idempotency-key": "resolved-tick-key" } });
    const offer = (await harness.offers.listForJob(job.job.id))[0];
    await app.inject({
      method: "POST",
      url: `/dispatch/offers/${offer.id}/reject`,
      headers: { "idempotency-key": "first-reject-key" },
      payload: { reason_code: "DRIVER_DECLINED" },
    });

    const response = await app.inject({
      method: "POST",
      url: `/dispatch/offers/${offer.id}/reject`,
      headers: { "idempotency-key": "second-reject-key" },
      payload: { reason_code: "DRIVER_DECLINED" },
    });

    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it("يعيد قائمة العروض بترتيب الأقدم أولاً", async () => {
    const harness = createHarness();
    const order = orderRef(1);
    harness.orders.seedOrder(order.orderId);
    const job = await createDispatchJob(harness.deps, { ...order, zoneId: ZONE_ID, orderType: "ride", vehicleClass: "sedan", idempotencyKey: "order-create-key" });
    harness.matching.setPool([driverId(1), driverId(2)]);
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps) });
    await app.inject({ method: "POST", url: "/dispatch/tick", headers: { "idempotency-key": "order-tick-key" } });
    const expected = await harness.offers.listForJob(job.job.id);

    const response = await app.inject({ method: "GET", url: `/dispatch/jobs/${job.job.id}/offers` });

    expect((await response.json()).items.map((offer: { id: string }) => offer.id)).toEqual(expected.map((offer) => offer.id));
    await app.close();
  });
});
