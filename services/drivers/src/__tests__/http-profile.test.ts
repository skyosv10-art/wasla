/**
 * `POST /drivers`, the profile reads, the patch, availability and the suspension pair.
 */

import { describe, expect, it } from "vitest";

import { DRIVER, httpHarness, key, registration, ZONE_A } from "./http-harness.js";

describe("تسجيل السائق", () => {
  it("ينشئ 201 ثم يعيد 200 للمفتاح والحمولة نفسيهما بالملف نفسه", async () => {
    const { app } = httpHarness();
    const idempotencyKey = key();
    const first = await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": idempotencyKey },
      payload: registration(DRIVER),
    });
    const replay = await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": idempotencyKey },
      payload: registration(DRIVER),
    });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(first.json().wasla_public_id).toBe(DRIVER);
    expect(replay.json()).toEqual(first.json());
    await app.close();
  });

  it("يرفض المفتاح نفسه بحمولة مختلفة بـ409 ولا يغيّر الملف", async () => {
    const { app } = httpHarness();
    const idempotencyKey = key();
    await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": idempotencyKey },
      payload: registration(DRIVER),
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": idempotencyKey },
      payload: { ...registration(DRIVER), preferred_locale: "en" },
    });
    const profile = await app.inject({ method: "GET", url: `/drivers/${DRIVER}` });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("DRIVER_IDEMPOTENCY_KEY_REUSED");
    expect(profile.json().preferred_locale).toBe("ar");
    await app.close();
  });

  it("لا يقلب ترتيب الحقول إلى حمولة مختلفة", async () => {
    const { app } = httpHarness();
    const idempotencyKey = key();
    await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": idempotencyKey },
      payload: { wasla_public_id: DRIVER, display_name: "سائق تجربة", service_kinds: ["ride"] },
    });
    // The same request with its keys serialised in another order: a fingerprint over the
    // raw JSON string would call this a different payload and answer 409.
    const reordered = await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": idempotencyKey },
      payload: { service_kinds: ["ride"], display_name: "سائق تجربة", wasla_public_id: DRIVER },
    });

    expect(reordered.statusCode).toBe(200);
    await app.close();
  });

  it("مفتاحان مختلفان لنفس المعرّف: الثاني تعارض تسجيل لا تعارض مفتاح", async () => {
    const { app } = httpHarness();
    await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": key() },
      payload: registration(DRIVER),
    });
    const second = await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": key() },
      payload: registration(DRIVER),
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("DRIVER_ALREADY_EXISTS");
    await app.close();
  });

  it("لا يخزّن اسم السائق في سجلّ منع التكرار", async () => {
    const { env, app } = httpHarness();
    await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": key() },
      payload: { ...registration(DRIVER), display_name: "اسم صريح جداً" },
    });

    expect(JSON.stringify(env.idempotency)).not.toContain("اسم صريح جداً");
    await app.close();
  });

  it("يرفض الرأس المفقود برمزه الخاص لا برمز التحقق العام", async () => {
    // A distinct code because the repair is distinct: a missing header means «add the
    // header», while a validation failure means «fix a field», and one code for both
    // sends the caller looking in the wrong place.
    const { app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/drivers",
      payload: registration(DRIVER),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("DRIVER_IDEMPOTENCY_KEY_REQUIRED");
    await app.close();
  });

  it("يرفض المفتاح القصير والمكرر والحقل الزائد", async () => {
    const { app } = httpHarness();
    for (const request of [
      { headers: { "idempotency-key": "short" }, payload: registration(DRIVER) },
      { headers: { "idempotency-key": ["a".repeat(10), "b".repeat(10)] }, payload: registration(DRIVER) },
      { headers: { "idempotency-key": key() }, payload: { ...registration(DRIVER), rank: 1 } },
    ]) {
      const response = await app.inject({ method: "POST", url: "/drivers", ...request });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("DRIVER_VALIDATION_FAILED");
    }
    await app.close();
  });

  it("يرفض المعرّف العام المخالف للنمط قبل لمس المخزن", async () => {
    const { env, app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": key() },
      payload: registration("WS-1"),
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(env.idempotency)).not.toContain("WS-1");
    await app.close();
  });
});

describe("قراءة الملف وتعديله", () => {
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

  it("يعيد الملف بمفاتيح العقد ويرفض المجهول بـ404", async () => {
    const { app } = await seeded();
    const found = await app.inject({ method: "GET", url: `/drivers/${DRIVER}` });
    const missing = await app.inject({ method: "GET", url: "/drivers/WS-9999999999" });

    expect(found.statusCode).toBe(200);
    expect(Object.keys(found.json()).sort()).toEqual(
      [
        "created_at",
        "declared_availability",
        "display_name",
        "eligibility_policy_version",
        "eligibility_recheck_at",
        "last_published_at",
        "last_published_state",
        "preferred_locale",
        "service_kinds",
        "status",
        "suspension_reason_code",
        "updated_at",
        "verification_status",
        "wasla_public_id",
        "work_city_zone_id",
      ].sort(),
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("DRIVER_NOT_FOUND");
    await app.close();
  });

  it("يميّز الحقل الغائب من الحقل الصريح بقيمة فارغة", async () => {
    const { app } = await seeded();
    await app.inject({
      method: "PATCH",
      url: `/drivers/${DRIVER}`,
      payload: { work_city_zone_id: ZONE_A },
    });
    const untouched = await app.inject({
      method: "PATCH",
      url: `/drivers/${DRIVER}`,
      payload: { preferred_locale: "en" },
    });
    const cleared = await app.inject({
      method: "PATCH",
      url: `/drivers/${DRIVER}`,
      payload: { work_city_zone_id: null },
    });

    expect(untouched.json().work_city_zone_id).toBe(ZONE_A);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().work_city_zone_id).toBeNull();
    await app.close();
  });

  it("يرفض التعديل الفارغ والمنطقة المجهولة", async () => {
    const { app } = await seeded();
    const empty = await app.inject({ method: "PATCH", url: `/drivers/${DRIVER}`, payload: {} });
    const unknownZone = await app.inject({
      method: "PATCH",
      url: `/drivers/${DRIVER}`,
      payload: { work_city_zone_id: "33333333-3333-4333-8333-333333333333" },
    });

    expect(empty.statusCode).toBe(400);
    expect(unknownZone.statusCode).toBe(422);
    expect(unknownZone.json().error.code).toBe("DRIVER_ZONE_UNKNOWN");
    await app.close();
  });

  it("يستبدل المناطق ويعيدها مغلَّفة بمفتاح zones", async () => {
    const { app } = await seeded();
    const replaced = await app.inject({
      method: "PUT",
      url: `/drivers/${DRIVER}/zones`,
      payload: { zones: [{ zone_id: ZONE_A, preference_rank: 1 }] },
    });
    const listed = await app.inject({ method: "GET", url: `/drivers/${DRIVER}/zones` });

    expect(replaced.statusCode).toBe(200);
    expect(Object.keys(replaced.json())).toEqual(["zones"]);
    expect(listed.json().zones).toHaveLength(1);
    expect(listed.json().zones[0].zone_id).toBe(ZONE_A);
    await app.close();
  });

  it("يرفض رتبة مكرّرة وقائمة بحقل زائد", async () => {
    const { app } = await seeded();
    const duplicateRank = await app.inject({
      method: "PUT",
      url: `/drivers/${DRIVER}/zones`,
      payload: {
        zones: [
          { zone_id: ZONE_A, preference_rank: 1 },
          { zone_id: ZONE_A, preference_rank: 1 },
        ],
      },
    });
    const extraKey = await app.inject({
      method: "PUT",
      url: `/drivers/${DRIVER}/zones`,
      payload: { zones: [{ zone_id: ZONE_A, preference_rank: 1, note: "x" }] },
    });

    expect([400, 422]).toContain(duplicateRank.statusCode);
    expect(extraKey.statusCode).toBe(400);
    await app.close();
  });

  it("قوائم السائق المجهول 404 لا قائمة فارغة", async () => {
    const { app } = httpHarness();
    for (const path of ["zones", "vehicles", "documents"]) {
      const response = await app.inject({ method: "GET", url: `/drivers/${DRIVER}/${path}` });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("DRIVER_NOT_FOUND");
    }
    await app.close();
  });
});

describe("الإتاحة والإيقاف والإعادة", () => {
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

  it("يقبل available و offline ويرفض busy", async () => {
    const { app } = await seeded();
    const available = await app.inject({
      method: "PUT",
      url: `/drivers/${DRIVER}/availability`,
      payload: { declared_availability: "available" },
    });
    const busy = await app.inject({
      method: "PUT",
      url: `/drivers/${DRIVER}/availability`,
      payload: { declared_availability: "busy" },
    });

    expect(available.json().declared_availability).toBe("available");
    expect(busy.statusCode).toBe(400);
    expect(busy.json().error.details).toMatchObject({ field: "declared_availability" });
    await app.close();
  });

  it("يوقف بسبب ثم يعيد، ويرفض الإيقاف المكرّر والإعادة لغير موقوف", async () => {
    const { app } = await seeded();
    const suspended = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/suspend`,
      payload: { reason_code: "DOCUMENT_EXPIRED" },
    });
    const again = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/suspend`,
      payload: { reason_code: "DOCUMENT_EXPIRED" },
    });
    const reinstated = await app.inject({ method: "POST", url: `/drivers/${DRIVER}/reinstate` });
    const twice = await app.inject({ method: "POST", url: `/drivers/${DRIVER}/reinstate` });

    expect(suspended.json().status).toBe("suspended");
    expect(again.statusCode).toBe(409);
    expect(reinstated.json().status).toBe("active");
    expect(twice.statusCode).toBe(409);
    await app.close();
  });

  it("يرفض جسماً غير فارغ في الإعادة", async () => {
    const { app } = await seeded();
    await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/suspend`,
      payload: { reason_code: "DOCUMENT_EXPIRED" },
    });
    const response = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/reinstate`,
      payload: { reason_code: "DOCUMENT_EXPIRED" },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
