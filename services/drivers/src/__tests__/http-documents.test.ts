/**
 * `POST/GET /documents` and `POST /documents/{documentId}/review`.
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

const licence = {
  document_type: "driving_license",
  storage_ref: "s3://wasla-docs/driver/licence-1.pdf",
  expires_at: "2027-01-01",
};

async function submit(app: Awaited<ReturnType<typeof seeded>>["app"], payload = licence) {
  return app.inject({
    method: "POST",
    url: `/drivers/${DRIVER}/documents`,
    headers: { "idempotency-key": key("doc") },
    payload,
  });
}

describe("وثائق السائق", () => {
  it("ينشئ 201 ثم يعيد 200 للمفتاح نفسه، ويرفض حمولة مختلفة بـ409", async () => {
    const { app } = await seeded();
    const idempotencyKey = key("doc");
    const first = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/documents`,
      headers: { "idempotency-key": idempotencyKey },
      payload: licence,
    });
    const replay = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/documents`,
      headers: { "idempotency-key": idempotencyKey },
      payload: licence,
    });
    const conflict = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/documents`,
      headers: { "idempotency-key": idempotencyKey },
      payload: { ...licence, storage_ref: "s3://wasla-docs/driver/licence-2.pdf" },
    });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(first.json().id);
    expect(conflict.statusCode).toBe(409);
    await app.close();
  });

  it("لا تعيد الوثيقة حقلاً غير مُعلَن، ولا مرجع التخزين لغير محلّه", async () => {
    const { app } = await seeded();
    const created = await submit(app);

    expect(Object.keys(created.json()).sort()).toEqual(
      [
        "created_at",
        "document_type",
        "expires_at",
        "id",
        "issued_at",
        "rejection_reason_code",
        "reviewed_at",
        "reviewed_by",
        "status",
        "storage_ref",
        "updated_at",
        "vehicle_id",
      ].sort(),
    );
    expect(created.json().status).toBe("pending");
    await app.close();
  });

  it("تعيد القائمة الوثائق كلها بما فيها المستبدلة", async () => {
    const { app } = await seeded();
    await submit(app);
    // A second licence supersedes the first; the audit needs both to stay readable.
    await submit(app, { ...licence, storage_ref: "s3://wasla-docs/driver/licence-2.pdf" });
    const listed = await app.inject({ method: "GET", url: `/drivers/${DRIVER}/documents` });

    expect(Object.keys(listed.json())).toEqual(["documents"]);
    expect(listed.json().documents).toHaveLength(2);
    expect(listed.json().documents.map((document: { status: string }) => document.status)).toContain(
      "superseded",
    );
    await app.close();
  });

  it("تقبل المراجعة verified وتحوّل الحقل decision إلى حالة الوثيقة", async () => {
    const { app } = await seeded();
    const created = await submit(app);
    const reviewed = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/documents/${created.json().id}/review`,
      payload: { decision: "verified", reviewed_by: "مراجع الوثائق" },
    });

    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().status).toBe("verified");
    expect(reviewed.json().reviewed_by).toBe("مراجع الوثائق");
    await app.close();
  });

  it("ترفض rejected بلا سبب، وverified مع سبب", async () => {
    const { app } = await seeded();
    const first = await submit(app);
    const second = await submit(app, {
      ...licence,
      storage_ref: "s3://wasla-docs/driver/licence-3.pdf",
    });

    const noReason = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/documents/${second.json().id}/review`,
      payload: { decision: "rejected", reviewed_by: "مراجع الوثائق" },
    });
    const reasonOnAccept = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/documents/${second.json().id}/review`,
      payload: {
        decision: "verified",
        reviewed_by: "مراجع الوثائق",
        rejection_reason_code: "DOCUMENT_EXPIRED",
      },
    });
    const badDecision = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/documents/${second.json().id}/review`,
      payload: { decision: "maybe", reviewed_by: "مراجع الوثائق" },
    });
    // The first document became `superseded` when the second arrived, and a superseded
    // paper is not reviewable: reviewing it would attach a decision to a file nobody is
    // looking at any more.
    const superseded = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/documents/${first.json().id}/review`,
      payload: { decision: "verified", reviewed_by: "مراجع الوثائق" },
    });

    expect([400, 422]).toContain(noReason.statusCode);
    expect([400, 422]).toContain(reasonOnAccept.statusCode);
    expect(badDecision.statusCode).toBe(400);
    expect(badDecision.json().error.details).toMatchObject({ field: "decision" });
    expect([409, 422]).toContain(superseded.statusCode);
    await app.close();
  });

  it("ترفض وثيقة مجهولة بـ404 ومعرّفاً غير UUID بـ400", async () => {
    const { app } = await seeded();
    const missing = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/documents/00000000-0000-4000-8000-000000000009/review`,
      payload: { decision: "verified", reviewed_by: "مراجع الوثائق" },
    });
    const badId = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/documents/not-a-uuid/review`,
      payload: { decision: "verified", reviewed_by: "مراجع الوثائق" },
    });

    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("DRIVER_DOCUMENT_NOT_FOUND");
    expect(badId.statusCode).toBe(400);
    expect(badId.json().error.details).toMatchObject({ field: "documentId" });
    await app.close();
  });

  it("ترفض نوع وثيقة مجهولاً وحقلاً زائداً ورأساً مفقوداً", async () => {
    const { app } = await seeded();
    const badType = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/documents`,
      headers: { "idempotency-key": key("doc") },
      payload: { ...licence, document_type: "شيء آخر" },
    });
    const extraKey = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/documents`,
      headers: { "idempotency-key": key("doc") },
      payload: { ...licence, reviewed_by: "لا يُرسله المُقدِّم" },
    });
    const noKey = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/documents`,
      payload: licence,
    });

    expect(badType.statusCode).toBe(400);
    expect(extraKey.statusCode).toBe(400);
    expect(noKey.json().error.code).toBe("DRIVER_IDEMPOTENCY_KEY_REQUIRED");
    await app.close();
  });
});
