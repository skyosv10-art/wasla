import { describe, expect, it } from "vitest";

import { assertRequestIdLength, requireIdempotencyKey } from "../http/requests.js";

import { InMemoryServiceTokenReplayGuard } from "@wasla/service-auth";

import {
  candidacyPayload,
  candidatePayload,
  createHttpHarness,
  createTestKeyRegistry,
  DRIVER_ID,
  IDEMPOTENCY_KEY,
  signFor,
  ZONE_PICKUP,
} from "./http-support.js";

describe("حد الأخطاء HTTP", () => {
  it("يرفض الترويسة المكررة ومعرف الطلب المتجاوز بلا صدى للقيمة", () => {
    expect(() => requireIdempotencyKey({ "idempotency-key": ["first-key", "second-key"] })).toThrow();
    const rejected = "x".repeat(129);
    expect(() => assertRequestIdLength({ "x-request-id": rejected })).toThrow();
  });

  it("يرد 400 لترويسة منع تكرار مكررة في المسار HTTP", async () => {
    const { app } = createHttpHarness();
    const response = await app.inject({
      method: "PUT",
      url: "/candidacy/WS-0000000001",
      headers: { "idempotency-key": ["first-key", "second-key"] },
      payload: { availability_state: "available", eligibility_state: "eligible", service_kinds: ["ride"], zone_ids: ["00000000-0000-4000-9000-000000000001"] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("MATCHING_VALIDATION_FAILED");
    await app.close();
  });

  it("لا يعكس في رد الخطأ قيمة المجال المرفوضة", async () => {
    const { app } = createHttpHarness();
    const rejected = "vehicle-secret-value";
    const response = await app.inject({
      method: "POST",
      url: "/matching/candidates",
      payload: candidatePayload({ vehicle_class: rejected }),
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).not.toContain(rejected);
    expect(response.json().code).toBe("MATCHING_VEHICLE_CLASS_UNKNOWN");
    await app.close();
  });
});

describe("الرموز التشغيلية المنشورة", () => {
  it("يعيد كتالوج القواعد 200 وقراراً غائباً 404", async () => {
    const { app } = createHttpHarness();
    const rulesets = await app.inject({ method: "GET", url: "/matching/rulesets" });
    const missingDecision = await app.inject({
      method: "GET",
      url: "/matching/decisions/00000000-0000-4000-8000-000000000099",
    });
    expect(rulesets.statusCode).toBe(200);
    expect(rulesets.json().rulesets).toHaveLength(1);
    expect(missingDecision.statusCode).toBe(404);
    expect(missingDecision.json().code).toBe("MATCHING_DECISION_NOT_FOUND");
    await app.close();
  });

  it("يحوّل الخطأ غير المعروف إلى 503 العقدي", async () => {
    const app = (await import("../http/app.js")).createMatchingApp({
      runner: {
        async write() {
          throw new Error("temporary failure");
        },
        async read() {
          throw new Error("temporary failure");
        },
      },
      serviceIdentity: { keys: createTestKeyRegistry(), replayGuard: new InMemoryServiceTokenReplayGuard() },
    });
    const response = await app.inject({
      method: "GET",
      url: "/matching/rulesets",
      headers: signFor("GET", "/matching/rulesets"),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: "MATCHING_UNAVAILABLE" });
    await app.close();
  });
  it("يرفض مفتاحاً زائداً في حمولة المرشحين لأن العقد يمنع الخصائص الإضافية", async () => {
    const { app } = createHttpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/matching/candidates",
      headers: { "idempotency-key": IDEMPOTENCY_KEY },
      payload: candidatePayload({ pickup_zone: ZONE_PICKUP }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("MATCHING_VALIDATION_FAILED");
    await app.close();
  });

  it("لا يردّ صدى قيمة المفتاح الزائد في رسالة الرفض", async () => {
    const { app } = createHttpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/matching/candidates",
      headers: { "idempotency-key": IDEMPOTENCY_KEY },
      payload: candidatePayload({ secret_note: "قيمة لا يجوز أن تظهر" }),
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).not.toContain("قيمة لا يجوز أن تظهر");
    await app.close();
  });

  it("يرفض مفتاحاً زائداً في حمولة الترشيح", async () => {
    const { app } = createHttpHarness();
    const response = await app.inject({
      method: "PUT",
      url: `/candidacy/${DRIVER_ID}`,
      headers: { "idempotency-key": IDEMPOTENCY_KEY },
      payload: candidacyPayload({ rating: 5 }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("MATCHING_VALIDATION_FAILED");
    await app.close();
  });

  it("يرفض مفتاحاً زائداً في حمولة التوافر الضيقة", async () => {
    const { app } = createHttpHarness();
    const response = await app.inject({
      method: "POST",
      url: `/candidacy/${DRIVER_ID}/availability`,
      headers: { "idempotency-key": IDEMPOTENCY_KEY },
      payload: { availability_state: "busy", eligibility_state: "eligible" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("MATCHING_VALIDATION_FAILED");
    await app.close();
  });
});
