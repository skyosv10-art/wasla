import { describe, expect, it } from "vitest";

import { createSignedDispatchApp as createDispatchApp } from "./service-identity-support.js";
import { createDirectRunner } from "../runner.js";
import { createDispatchJob } from "../use-cases/create-job.js";
import { createHarness, driverId, orderRef, ZONE_ID } from "./harness.js";

describe("واجهة النبضة", () => {
  it("لا تقبل جسماً وتفتح الموجة عبر النبضة فقط", async () => {
    const harness = createHarness();
    const order = orderRef(1);
    harness.orders.seedOrder(order.orderId);
    await createDispatchJob(harness.deps, { ...order, zoneId: ZONE_ID, orderType: "ride", vehicleClass: "sedan", idempotencyKey: "create-tick-job" });
    harness.matching.setPool([driverId(1)]);
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps) });
    const invalid = await app.inject({ method: "POST", url: "/dispatch/tick", headers: { "idempotency-key": "tick-key-0001" }, payload: {} });
    const response = await app.inject({ method: "POST", url: "/dispatch/tick", headers: { "idempotency-key": "tick-key-0002" } });
    expect(invalid.statusCode).toBe(400);
    expect(response.statusCode).toBe(200);
    expect((await response.json()).opened_waves).toBe(1);
    await app.close();
  });

  it("يرفض النبضة بلا مفتاح منع تكرار", async () => {
    const app = createDispatchApp({ runner: createDirectRunner(createHarness().deps) });

    const response = await app.inject({ method: "POST", url: "/dispatch/tick" });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("يحدّث آخر نبضة فقط بعد نبضة ناجحة", async () => {
    const harness = createHarness();
    const state = { lastTickAt: null as string | null };
    const app = createDispatchApp({ runner: createDirectRunner(harness.deps), tickState: state });

    const response = await app.inject({ method: "POST", url: "/dispatch/tick", headers: { "idempotency-key": "successful-tick-key" } });

    expect(response.statusCode).toBe(200);
    expect(state.lastTickAt).toBe((await response.json()).tick_at);
    await app.close();
  });

  it("لا يحدّث آخر نبضة عندما تفشل النبضة", async () => {
    const harness = createHarness();
    const order = orderRef(1);
    harness.orders.seedOrder(order.orderId);
    await createDispatchJob(harness.deps, {
      ...order,
      zoneId: ZONE_ID,
      orderType: "ride",
      vehicleClass: "sedan",
      idempotencyKey: "failing-tick-job",
    });
    const state = { lastTickAt: null as string | null };
    const app = createDispatchApp({
      tickState: state,
      runner: {
        read: async (work) => work(harness.deps),
        write: async () => {
          throw new Error("عطل البنية");
        },
      },
    });

    const response = await app.inject({ method: "POST", url: "/dispatch/tick", headers: { "idempotency-key": "failed-tick-key" } });

    expect(response.statusCode).toBe(503);
    expect(state.lastTickAt).toBeNull();
    await app.close();
  });
});
