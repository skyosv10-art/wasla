/**
 * `POST/GET /vehicles` and `PATCH /vehicles/{vehicleId}`.
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

const sedan = { vehicle_class: "sedan", plate_number: "أ ب ج 1234", is_primary: true };

describe("مركبات السائق", () => {
  it("ينشئ 201 ثم يعيد 200 للمفتاح نفسه بالمركبة نفسها", async () => {
    const { app } = await seeded();
    const idempotencyKey = key("veh");
    const first = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/vehicles`,
      headers: { "idempotency-key": idempotencyKey },
      payload: sedan,
    });
    const replay = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/vehicles`,
      headers: { "idempotency-key": idempotencyKey },
      payload: sedan,
    });
    const listed = await app.inject({ method: "GET", url: `/drivers/${DRIVER}/vehicles` });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(first.json().id);
    // The proof that the replay was not a second creation: one row, not two.
    expect(listed.json().vehicles).toHaveLength(1);
    await app.close();
  });

  it("يرفض المفتاح نفسه بحمولة مختلفة", async () => {
    const { app } = await seeded();
    const idempotencyKey = key("veh");
    await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/vehicles`,
      headers: { "idempotency-key": idempotencyKey },
      payload: sedan,
    });
    const conflict = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/vehicles`,
      headers: { "idempotency-key": idempotencyKey },
      payload: { ...sedan, vehicle_class: "suv" },
    });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("DRIVER_IDEMPOTENCY_KEY_REUSED");
    await app.close();
  });

  it("لا يعيد المركبة حقلاً غير مُعلَن في العقد", async () => {
    const { app } = await seeded();
    const created = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/vehicles`,
      headers: { "idempotency-key": key("veh") },
      payload: sedan,
    });

    expect(Object.keys(created.json()).sort()).toEqual(
      [
        "color",
        "created_at",
        "id",
        "is_primary",
        "make",
        "model",
        "model_year",
        "plate_number",
        "status",
        "updated_at",
        "vehicle_class",
      ].sort(),
    );
    await app.close();
  });

  it("يتقاعد بالتعديل ويرفض التنشيط ومعرّفاً غير UUID", async () => {
    const { app } = await seeded();
    const created = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/vehicles`,
      headers: { "idempotency-key": key("veh") },
      payload: sedan,
    });
    const vehicleId = created.json().id;

    const retired = await app.inject({
      method: "PATCH",
      url: `/drivers/${DRIVER}/vehicles/${vehicleId}`,
      payload: { status: "retired" },
    });
    const reactivate = await app.inject({
      method: "PATCH",
      url: `/drivers/${DRIVER}/vehicles/${vehicleId}`,
      payload: { status: "active" },
    });
    const badId = await app.inject({
      method: "PATCH",
      url: `/drivers/${DRIVER}/vehicles/not-a-uuid`,
      payload: { status: "retired" },
    });

    expect(retired.json().status).toBe("retired");
    expect(reactivate.statusCode).toBe(400);
    expect(badId.statusCode).toBe(400);
    expect(badId.json().error.details).toMatchObject({ field: "vehicleId" });
    await app.close();
  });

  it("يرفض التعديل الفارغ ومركبة مجهولة بـ404", async () => {
    const { app } = await seeded();
    const empty = await app.inject({
      method: "PATCH",
      url: `/drivers/${DRIVER}/vehicles/00000000-0000-4000-8000-000000000001`,
      payload: {},
    });
    const missing = await app.inject({
      method: "PATCH",
      url: `/drivers/${DRIVER}/vehicles/00000000-0000-4000-8000-000000000001`,
      payload: { status: "retired" },
    });

    expect(empty.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("DRIVER_VEHICLE_NOT_FOUND");
    await app.close();
  });

  it("يرفض التسجيل بلا رأس منع تكرار وبصنف مجهول", async () => {
    const { app } = await seeded();
    const noKey = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/vehicles`,
      payload: sedan,
    });
    const badClass = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/vehicles`,
      headers: { "idempotency-key": key("veh") },
      payload: { ...sedan, vehicle_class: "spaceship" },
    });

    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().error.code).toBe("DRIVER_IDEMPOTENCY_KEY_REQUIRED");
    expect(badClass.statusCode).toBe(400);
    await app.close();
  });

  it("مركبة لسائق مجهول 404 قبل أي كتابة", async () => {
    const { env, app } = httpHarness();
    const response = await app.inject({
      method: "POST",
      url: `/drivers/${DRIVER}/vehicles`,
      headers: { "idempotency-key": key("veh") },
      payload: sedan,
    });

    expect(response.statusCode).toBe(404);
    expect(await env.vehicles.list(DRIVER)).toHaveLength(0);
    await app.close();
  });
});
