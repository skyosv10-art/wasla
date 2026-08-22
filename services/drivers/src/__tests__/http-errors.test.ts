/**
 * The error boundary: shape, trace id, echo safety, and the two codes no route can
 * currently produce on its own.
 */

import { describe, expect, it } from "vitest";

import { candidacyPublishFailed } from "../domain/errors.js";
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

  it("يوصل DRIVER_CANDIDACY_PUBLISH_FAILED إلى 502 عندما يُرفع", async () => {
    // Nothing raises it in MR 4/6 — `publishCandidacy` records a failed publication and
    // lets the local write stand. This test proves the MAPPING is in place, so MR 5/6,
    // which introduces the first port that can fail, only has to decide where to throw.
    const app = createDriverApp({ runner: failingRunner(candidacyPublishFailed()) });
    const response = await app.inject({ method: "GET", url: `/drivers/${DRIVER}` });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("DRIVER_CANDIDACY_PUBLISH_FAILED");
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
