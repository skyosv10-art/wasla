import { describe, expect, it } from "vitest";

import { candidacyFixture, seedAll, ZONE_UNKNOWN } from "./harness.js";
import { candidatePayload, createHttpHarness } from "./http-support.js";

describe("POST /matching/candidates", () => {
  it("يعيد 200 وسبب الفراغ ولا يطلب Idempotency-Key", async () => {
    const { app } = createHttpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/matching/candidates",
      payload: candidatePayload(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      candidates: [],
      empty_reason_code: "NO_CANDIDACY_ROWS",
    });
    await app.close();
  });

  it("يمرر النتيجة التفصيلية المنشورة إلى مسار التدقيق", async () => {
    const { app, deps } = createHttpHarness();
    seedAll(deps, [candidacyFixture({ driverPublicId: "WS-0000000002" })]);
    const result = await app.inject({ method: "POST", url: "/matching/candidates", payload: candidatePayload() });
    expect(result.statusCode).toBe(200);
    const decisionId = result.json().decision_id as string;
    const decision = await app.inject({ method: "GET", url: `/matching/decisions/${decisionId}` });
    expect(decision.statusCode).toBe(200);
    expect(decision.json().candidates[0]).toMatchObject({
      driver_public_id: "WS-0000000002",
      score_bp: expect.any(Number),
    });
    await app.close();
  });

  it("يرد 400 لجسم غير JSON أو نوع محتوى غير مدعوم من النقل", async () => {
    const { app } = createHttpHarness();
    const invalidJson = await app.inject({
      method: "POST",
      url: "/matching/candidates",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    const wrongType = await app.inject({
      method: "POST",
      url: "/matching/candidates",
      headers: { "content-type": "text/plain" },
      payload: "not-json",
    });
    expect(invalidJson.statusCode).toBe(400);
    expect(wrongType.statusCode).toBe(400);
    expect(invalidJson.json().code).toBe("MATCHING_VALIDATION_FAILED");
    await app.close();
  });

  it("يفصل الرفض الشكلي 400 عن المنطقة غير الموجودة 422", async () => {
    const { app } = createHttpHarness();
    const malformed = await app.inject({ method: "POST", url: "/matching/candidates", payload: [] });
    const unknownZone = await app.inject({
      method: "POST",
      url: "/matching/candidates",
      payload: candidatePayload({ pickup_zone_id: ZONE_UNKNOWN }),
    });
    expect(malformed.statusCode).toBe(400);
    expect(unknownZone.statusCode).toBe(422);
    expect(unknownZone.json().code).toBe("MATCHING_ZONE_UNKNOWN");
    await app.close();
  });
});
