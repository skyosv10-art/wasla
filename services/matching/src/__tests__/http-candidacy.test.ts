import { describe, expect, it } from "vitest";

import { createHttpHarness, candidacyPayload, DRIVER_ID, IDEMPOTENCY_KEY } from "./http-support.js";

describe("مسارات الترشيح", () => {
  it("يستبدل الصف كاملاً ثم يقرأه مع is_fresh", async () => {
    const { app } = createHttpHarness();
    const written = await app.inject({
      method: "PUT",
      url: `/candidacy/${DRIVER_ID}`,
      headers: { "idempotency-key": IDEMPOTENCY_KEY },
      payload: candidacyPayload(),
    });
    const read = await app.inject({ method: "GET", url: `/candidacy/${DRIVER_ID}` });
    expect(written.statusCode).toBe(200);
    expect(written.json()).toMatchObject({ driver_public_id: DRIVER_ID, is_fresh: true });
    expect(read.statusCode).toBe(200);
    expect(read.json()).not.toHaveProperty("score_bp");
    await app.close();
  });

  it("يرد 400 لمفتاح مفقود أو قصير وللمعرف العام غير الصحيح", async () => {
    const { app } = createHttpHarness();
    const missing = await app.inject({ method: "PUT", url: `/candidacy/${DRIVER_ID}`, payload: candidacyPayload() });
    const short = await app.inject({
      method: "PUT", url: `/candidacy/${DRIVER_ID}`, headers: { "idempotency-key": "short" }, payload: candidacyPayload(),
    });
    const malformedId = await app.inject({
      method: "PUT", url: "/candidacy/not-a-driver", headers: { "idempotency-key": IDEMPOTENCY_KEY }, payload: candidacyPayload(),
    });
    expect(missing.statusCode).toBe(400);
    expect(short.statusCode).toBe(400);
    expect(malformedId.statusCode).toBe(400);
    await app.close();
  });

  it("يرد 409 عند إعادة المفتاح بحمولة مختلفة", async () => {
    const { app } = createHttpHarness();
    await app.inject({
      method: "PUT", url: `/candidacy/${DRIVER_ID}`, headers: { "idempotency-key": IDEMPOTENCY_KEY }, payload: candidacyPayload(),
    });
    const response = await app.inject({
      method: "PUT", url: `/candidacy/${DRIVER_ID}`, headers: { "idempotency-key": IDEMPOTENCY_KEY },
      payload: candidacyPayload({ availability_state: "busy" }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("MATCHING_IDEMPOTENCY_KEY_REUSED");
    await app.close();
  });

  it("يرد 404 عند قراءة صف غائب وعند تغيير توافره", async () => {
    const { app } = createHttpHarness();
    const read = await app.inject({ method: "GET", url: `/candidacy/${DRIVER_ID}` });
    const availability = await app.inject({
      method: "POST", url: `/candidacy/${DRIVER_ID}/availability`, headers: { "idempotency-key": IDEMPOTENCY_KEY },
      payload: { availability_state: "busy" },
    });
    expect(read.statusCode).toBe(404);
    expect(availability.statusCode).toBe(404);
    await app.close();
  });

  it("يغير التوافر ويحتفظ بفحص مفتاح منع التكرار", async () => {
    const { app } = createHttpHarness();
    await app.inject({
      method: "PUT", url: `/candidacy/${DRIVER_ID}`, headers: { "idempotency-key": IDEMPOTENCY_KEY }, payload: candidacyPayload(),
    });
    const response = await app.inject({
      method: "POST", url: `/candidacy/${DRIVER_ID}/availability`, headers: { "idempotency-key": "availability-key" },
      payload: { availability_state: "busy" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ availability_state: "busy", is_fresh: true });
    await app.close();
  });
});
