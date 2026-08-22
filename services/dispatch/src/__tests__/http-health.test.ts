import { describe, expect, it } from "vitest";

import { createDispatchApp } from "../http/app.js";
import { createDirectRunner } from "../runner.js";
import { createHarness } from "./harness.js";

describe("صحة الخدمة", () => {
  it("تعلن الذاكرة متدهورة وآخر نبضة يبدأ null", async () => {
    const app = createDispatchApp({ runner: createDirectRunner(createHarness().deps) });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(await response.json()).toEqual({ status: "degraded", service: "dispatch-service", persistence: "memory", last_tick_at: null });
    await app.close();
  });

  it("تعلن Postgres سليمة عندما يكون التخزين الدائم هو المركب", async () => {
    const app = createDispatchApp({
      runner: createDirectRunner(createHarness().deps),
      health: { persistence: "postgres" },
    });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(await response.json()).toEqual({
      status: "ok",
      service: "dispatch-service",
      persistence: "postgres",
      last_tick_at: null,
    });
    await app.close();
  });
});
