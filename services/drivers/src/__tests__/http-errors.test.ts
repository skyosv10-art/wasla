/**
 * The error boundary: shape, trace id, echo safety, and the status codes the service
 * refuses to produce — including `502`, retired in MR 5/6 (`contracts/errors.md`
 * §«الرمز المتقاعد»).
 */

import { describe, expect, it } from "vitest";

import { driverUnavailable } from "../domain/errors.js";
import { createDriverApp } from "../http/app.js";
import type { DriverRunner } from "../runner.js";
import { DRIVER, httpHarness, key, registration } from "./http-harness.js";

/** A runner whose every unit of work fails with a chosen error. */
function failingRunner(error: unknown): DriverRunner {
  return {
    async write() {
      throw error;
    },
    async read() {
      throw error;
    },
  };
}

describe("شكل الخطأ", () => {
  it("يعيد الغلاف المتداخل مع معرّف التتبّع دائماً", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: `/drivers/${DRIVER}` });
    const body = response.json();

    expect(Object.keys(body).sort()).toEqual(["error", "trace_id"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
    expect(typeof body.trace_id).toBe("string");
    expect(body.trace_id.length).toBeGreaterThan(0);
    await app.close();
  });

  it("يعيد معرّف التتبّع الذي أرسله المتصل نفسه", async () => {
    const { app } = httpHarness();
    const traceId = "trace-from-the-caller";
    const response = await app.inject({
      method: "GET",
      url: `/drivers/${DRIVER}`,
      headers: { "x-request-id": traceId },
    });

    // One id across the caller's logs and ours; a generated one would force whoever is
    // reading a complaint to guess which of our requests was his.
    expect(response.json().trace_id).toBe(traceId);
    await app.close();
  });

  it("يرفض معرّف تتبّع أطول من الحد", async () => {
    const { app } = httpHarness();
    const response = await app.inject({
      method: "GET",
      url: `/drivers/${DRIVER}`,
      headers: { "x-request-id": "t".repeat(200) },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details).toMatchObject({ field: "x-request-id" });
    await app.close();
  });

  it("لا يعيد صدى المعرّف المرفوض ولا المفتاح المرفوض", async () => {
    const { app } = httpHarness();
    const rejectedId = "ليس-معرّفاً-عاماً";
    const rejectedKey = "مفتاح، مرفوض";
    const badPath = await app.inject({
      method: "GET",
      url: `/drivers/${encodeURIComponent(rejectedId)}`,
    });
    const badKey = await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": rejectedKey },
      payload: registration(DRIVER),
    });

    // An error message that echoes its input is how a log ends up holding whatever a
    // caller typed into a field, including things nobody meant to store.
    expect(badPath.statusCode).toBe(400);
    expect(badPath.body).not.toContain(rejectedId);
    expect(badKey.body).not.toContain(rejectedKey);
    await app.close();
  });

  it("يترجم الجسم غير الصالح ونوع المحتوى الخاطئ إلى رمز تحقق واحد", async () => {
    const { app } = httpHarness();
    const brokenJson = await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": key(), "content-type": "application/json" },
      payload: "{ليس JSON",
    });
    const wrongType = await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": key(), "content-type": "text/plain" },
      payload: "نص عادي",
    });

    for (const response of [brokenJson, wrongType]) {
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("DRIVER_VALIDATION_FAILED");
    }
    await app.close();
  });

  it("يحوّل الخطأ غير المصنَّف إلى 503 بلا تفاصيل داخلية", async () => {
    const app = createDriverApp({ runner: failingRunner(new Error("انفجار في مكان ما")) });
    const response = await app.inject({ method: "GET", url: `/drivers/${DRIVER}` });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("DRIVER_UNAVAILABLE");
    // The internal message is for our logs, not for a client: leaking it turns an
    // incident into a description of our internals.
    expect(response.body).not.toContain("انفجار في مكان ما");
    await app.close();
  });

  it("يوصل منفذاً إلزامياً معطّلاً إلى 503 باسمه لا بالتخمين", async () => {
    // `driverUnavailable` is what the HTTP zone catalogue raises when geography cannot
    // answer (MR 5/6). It is asserted here, at the boundary, because the alternative —
    // an unnamed throw classified by the catch-all — gives the same status for a
    // reason nobody can read afterwards.
    const app = createDriverApp({ runner: failingRunner(driverUnavailable("دليل المناطق لا يجيب")) });
    const response = await app.inject({ method: "GET", url: `/drivers/${DRIVER}` });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("DRIVER_UNAVAILABLE");
    await app.close();
  });

  /**
   * حارس القرار: لا مسار في الخدمة يُنتج 502 بعد تقاعد رمز فشل النشر (MR 5/6).
   * الاختبار يمرّ على كل طريق كتابة معلن ويتأكد أن أي حالة خطأ ليست 502.
   */
  it("لا يُنتج 502 من أي مسار بعد تقاعد رمز فشل النشر", async () => {
    const { app } = httpHarness();
    const attempts = [
      app.inject({ method: "POST", url: "/drivers", headers: { "Idempotency-Key": key("x") }, payload: registration(DRIVER) }),
      app.inject({ method: "GET", url: `/drivers/${DRIVER}` }),
      app.inject({ method: "POST", url: "/eligibility/tick", headers: { "Idempotency-Key": key("t") }, payload: {} }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.statusCode, response.body).not.toBe(502);
    }
    await app.close();
  });

  it("يترك مسار Fastify المجهول 404 كما هو", async () => {
    const { app } = httpHarness();
    const response = await app.inject({ method: "GET", url: "/drivers-unknown-route" });

    // A route that does not exist is not a driver that does not exist: answering
    // `DRIVER_NOT_FOUND` here would tell a caller with a typo in his URL that the driver
    // is missing.
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("DRIVER_");
    await app.close();
  });
});
