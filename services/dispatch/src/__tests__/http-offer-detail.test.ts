import { describe, expect, it } from "vitest";

import { createSignedDispatchApp as createDispatchApp } from "./service-identity-support.js";
import type { DispatchRunner } from "../runner.js";
import { createDispatchJob } from "../use-cases/create-job.js";
import { readDispatchOffer } from "../use-cases/read-job.js";
import { createHarness, driverId, orderRef, ZONE_ID } from "./harness.js";

async function offerReady() {
  const harness = createHarness();
  const order = orderRef(1);
  harness.orders.seedOrder(order.orderId);
  const { job } = await createDispatchJob(harness.deps, {
    ...order,
    zoneId: ZONE_ID,
    orderType: "delivery",
    vehicleClass: "motorcycle",
    idempotencyKey: "detail-create-key",
  });
  harness.matching.setPool([driverId(1)]);
  const app = createDispatchApp({ runner: {
    read: async (work) => work(harness.deps),
    write: async (work) => work(harness.deps),
  } });
  await app.inject({
    method: "POST",
    url: "/dispatch/tick",
    headers: { "idempotency-key": "detail-tick-key" },
  });
  const offer = (await harness.offers.listForJob(job.id))[0]!;
  return { app, harness, job, offer, order };
}

describe("قراءة عرض واحد", () => {
  it("يعيد null من حالة الاستخدام عند غياب العرض قبل أن يترجمه HTTP إلى 404", async () => {
    const harness = createHarness();

    await expect(
      readDispatchOffer(harness.deps, {
        offerId: "90000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toBeNull();
  });

  it("يعيد 200 بكل حقول العرض وسياق الوظيفة عبر مقبس القراءة فقط", async () => {
    const { app, harness, job, offer, order } = await offerReady();
    const calls = { read: 0, write: 0 };
    const runner: DispatchRunner = {
      read: async (work) => {
        calls.read += 1;
        return work(harness.deps);
      },
      write: async (work) => {
        calls.write += 1;
        return work(harness.deps);
      },
    };
    await app.close();
    const readApp = createDispatchApp({ runner });

    const response = await readApp.inject({
      method: "GET",
      url: `/dispatch/offers/${offer.id}`,
      headers: { "x-request-id": "negotiation-read-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(await response.json()).toMatchObject({
      id: offer.id,
      job_id: job.id,
      wave_id: offer.waveId,
      driver_public_id: offer.driverPublicId,
      status: "offered",
      reason_code: null,
      offered_at: offer.offeredAt,
      expires_at: offer.expiresAt,
      responded_at: null,
      resolved_at: null,
      created_at: offer.createdAt,
      order_public_id: order.orderPublicId,
      order_id: order.orderId,
      order_type: "delivery",
      vehicle_class: "motorcycle",
      job_status: "dispatching",
      standing: true,
    });
    expect(calls).toEqual({ read: 1, write: 0 });
    await readApp.close();
  });

  it("يعيد 404 للعرض غير المعروف", async () => {
    const app = createDispatchApp({
      runner: {
        read: async (work) => work(createHarness().deps),
        write: async (work) => work(createHarness().deps),
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/dispatch/offers/90000000-0000-4000-8000-000000000001",
    });

    expect(response.statusCode).toBe(404);
    expect(await response.json()).toMatchObject({ code: "DISPATCH_OFFER_NOT_FOUND" });
    await app.close();
  });

  it("يعيد 400 قبل القراءة عندما لا يكون معرّف العرض UUID", async () => {
    let reads = 0;
    const app = createDispatchApp({
      runner: {
        read: async () => {
          reads += 1;
          throw new Error("لا يجب أن تحدث قراءة");
        },
        write: async () => {
          throw new Error("لا يجب أن تحدث كتابة");
        },
      },
    });

    const response = await app.inject({ method: "GET", url: "/dispatch/offers/not-a-uuid" });

    expect(response.statusCode).toBe(400);
    expect(await response.json()).toMatchObject({ code: "DISPATCH_VALIDATION_FAILED" });
    expect(reads).toBe(0);
    await app.close();
  });

  it("يعيد standing: false بعد رفض العرض", async () => {
    const { app, offer } = await offerReady();
    await app.inject({
      method: "POST",
      url: `/dispatch/offers/${offer.id}/reject`,
      headers: { "idempotency-key": "detail-reject-key" },
      payload: { reason_code: "DRIVER_DECLINED" },
    });

    const response = await app.inject({ method: "GET", url: `/dispatch/offers/${offer.id}` });

    expect(await response.json()).toMatchObject({ status: "rejected", standing: false });
    await app.close();
  });

  it("يعيد standing: false بعد أن تسجل النبضة انتهاء العرض", async () => {
    const { app, harness, offer } = await offerReady();
    harness.clock.advanceSeconds(31);
    await app.inject({
      method: "POST",
      url: "/dispatch/tick",
      headers: { "idempotency-key": "detail-expire-tick-key" },
    });

    const response = await app.inject({ method: "GET", url: `/dispatch/offers/${offer.id}` });

    expect(await response.json()).toMatchObject({ status: "timed_out", standing: false });
    await app.close();
  });

  it("يعيد standing: false إذا كانت الوظيفة نهائية ولو بقي العرض offered", async () => {
    const { app, harness, job, offer } = await offerReady();
    await harness.jobs.updateStatus(job.id, "assigned", "OFFER_ACCEPTED", harness.clock.now());

    const response = await app.inject({ method: "GET", url: `/dispatch/offers/${offer.id}` });

    expect(await response.json()).toMatchObject({
      status: "offered",
      job_status: "assigned",
      standing: false,
    });
    await app.close();
  });

  it("يبقي standing: true بعد الموعد ما لم تمر نبضة", async () => {
    const { app, harness, offer } = await offerReady();
    harness.clock.advanceSeconds(31);

    const response = await app.inject({ method: "GET", url: `/dispatch/offers/${offer.id}` });

    expect(await response.json()).toMatchObject({ status: "offered", standing: true });
    await app.close();
  });

  it("يعيد 503 عند تعذر مقبس القراءة", async () => {
    const app = createDispatchApp({
      runner: {
        read: async () => {
          throw new Error("تعذر التخزين");
        },
        write: async () => {
          throw new Error("لا يجب أن تحدث كتابة");
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/dispatch/offers/90000000-0000-4000-8000-000000000001",
    });

    expect(response.statusCode).toBe(503);
    expect(await response.json()).toMatchObject({ code: "DISPATCH_ENGINE_UNAVAILABLE" });
    await app.close();
  });
});
