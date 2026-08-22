/**
 * `GET /eligibility`, `POST /drivers/eligibility/tick` and `GET /health`.
 */

import { describe, expect, it } from "vitest";

import { DRIVER, httpHarness, key, registration } from "./http-harness.js";

async function seeded() {
  const harness = httpHarness();
  await harness.app.inject({
    method: "POST",
    url: "/drivers",
    headers: { "idempotency-key": key() },
    payload: registration(DRIVER),
  });
  return harness;
}

describe("قراءة الأهليّة", () => {
  it("تعيد الحكم مع كل الأسباب لا أوّلها", async () => {
    const { app } = await seeded();
    const response = await app.inject({ method: "GET", url: `/drivers/${DRIVER}/eligibility` });

    expect(response.statusCode).toBe(200);
    expect(response.json().eligibility_state).toBe("ineligible");
    // A driver who just registered is missing his papers AND his zones AND a vehicle;
    // reporting one reason at a time is how a driver spends three days fixing one thing
    // per day.
    expect(response.json().reason_codes.length).toBeGreaterThan(1);
    expect(Object.keys(response.json()).sort()).toEqual(
      ["eligibility_state", "evaluated_at", "policy_version", "reason_codes", "wasla_public_id"].sort(),
    );
    await app.close();
  });

  it("ترفض السائق المجهول بـ404 ولا تُرجع حكم unknown", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: `/drivers/${DRIVER}/eligibility` });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("DRIVER_NOT_FOUND");
    expect(response.body).not.toContain("unknown");
    await app.close();
  });

  it("لا تسجّل سطر أهليّة للسائق المجهول", async () => {
    const { env, app } = httpHarness();
    await app.inject({ method: "GET", url: `/drivers/${DRIVER}/eligibility` });

    expect(await env.eligibilityLog.list(DRIVER)).toHaveLength(0);
    await app.close();
  });
});

describe("نبضة الانتهاء", () => {
  it("تعيد عدّاداتها الأربعة وتطلب رأس منع التكرار", async () => {
    const { app } = await seeded();
    const withoutKey = await app.inject({ method: "POST", url: "/drivers/eligibility/tick" });
    const ticked = await app.inject({
      method: "POST",
      url: "/drivers/eligibility/tick",
      headers: { "idempotency-key": key("tick") },
    });

    expect(withoutKey.statusCode).toBe(400);
    expect(withoutKey.json().error.code).toBe("DRIVER_IDEMPOTENCY_KEY_REQUIRED");
    expect(ticked.statusCode).toBe(200);
    expect(Object.keys(ticked.json()).sort()).toEqual(
      ["changed_drivers", "published", "publish_failures", "rechecked_drivers"].sort(),
    );
    await app.close();
  });

  it("ترفض جسماً غير فارغ ولا تخزّن سجلّ إعادة للمفتاح", async () => {
    const { env, app } = httpHarness();
    const withBody = await app.inject({
      method: "POST",
      url: "/drivers/eligibility/tick",
      headers: { "idempotency-key": key("tick") },
      payload: { limit: 10 },
    });
    const tickKey = key("tick");
    await app.inject({
      method: "POST",
      url: "/drivers/eligibility/tick",
      headers: { "idempotency-key": tickKey },
    });

    expect(withBody.statusCode).toBe(400);
    expect(await env.idempotency.find(tickKey)).toBeNull();
    await app.close();
  });

  it("تُحدِّث مؤشّر آخر نبضة الذي يقرأه /health", async () => {
    const { app, tickState } = await seeded();
    const before = await app.inject({ method: "GET", url: "/health" });
    await app.inject({
      method: "POST",
      url: "/drivers/eligibility/tick",
      headers: { "idempotency-key": key("tick") },
    });
    const after = await app.inject({ method: "GET", url: "/health" });

    expect(before.json().last_tick_at).toBeNull();
    expect(after.json().last_tick_at).toBe(tickState.lastTickAt);
    expect(after.json().last_tick_at).not.toBeNull();
    await app.close();
  });
});

describe("الصحّة", () => {
  it("degraded على الذاكرة، ومفاتيح العقد فقط", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "degraded",
      persistence: "memory",
      last_tick_at: null,
    });
    await app.close();
  });
});
