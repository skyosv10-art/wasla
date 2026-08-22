/**
 * The privacy guard.
 *
 * An API response goes to one reader who asked for it and was authorised. An EVENT
 * goes to every subscriber, into every subscriber's log, and into whatever they
 * forward it to. So the fields that identify a person or a car in the street — the
 * plate, the document pointer, the display name, the reviewer's identity — must not
 * ride the bus, and a code review is not a durable way to keep them off it.
 *
 * This test drives the whole write surface, collects every event, and searches the
 * PAYLOADS for the sensitive values. It fails on the day somebody adds a convenient
 * field, which is the only moment the removal is still cheap.
 */

import { describe, expect, it } from "vitest";

import { registerDriver } from "../use-cases/register-driver.js";
import {
  declareAvailability,
  reinstateDriver,
  setServiceZones,
  suspendDriver,
  updateProfile,
} from "../use-cases/manage-profile.js";
import { patchVehicle, registerVehicle } from "../use-cases/manage-vehicles.js";
import { reviewDocument, submitDocument } from "../use-cases/manage-documents.js";
import { runExpiryTick } from "../use-cases/read-eligibility.js";
import { DRIVER, ZONE_A, ZONE_B, environment, nextKey } from "./helpers.js";
import type { InMemoryDriverEnvironment } from "../infrastructure/in-memory.js";

const PLATE = "XYZ-9876";
const STORAGE_REF = "s3://wasla-docs/secret-national-id-scan.pdf";
const DISPLAY_NAME = "عبد الله بن محمد";
const REVIEWER = "ops-agent-42";

/** Every event this service can produce, from one driver's full life cycle. */
async function exerciseEveryPath(env: InMemoryDriverEnvironment): Promise<void> {
  await registerDriver(env, {
    waslaPublicId: DRIVER,
    displayName: DISPLAY_NAME,
    serviceKinds: ["ride"],
  });
  await setServiceZones(env, DRIVER, { zones: [{ zoneId: ZONE_A, preferenceRank: 1 }] });
  await updateProfile(env, DRIVER, { serviceKinds: ["ride", "delivery"] });

  const vehicle = await registerVehicle(env, DRIVER, {
    vehicleClass: "sedan",
    idempotencyKey: nextKey("veh"),
    plateNumber: PLATE,
    make: "Toyota",
  });
  const second = await registerVehicle(env, DRIVER, {
    vehicleClass: "van",
    idempotencyKey: nextKey("veh"),
    plateNumber: PLATE,
  });
  await patchVehicle(env, DRIVER, second.id, { isPrimary: true });
  await patchVehicle(env, DRIVER, second.id, { status: "retired" });

  const identity = await submitDocument(env, DRIVER, {
    documentType: "national_id",
    storageRef: STORAGE_REF,
    idempotencyKey: nextKey("doc"),
  });
  await reviewDocument(env, DRIVER, identity.id, { status: "verified", reviewedBy: REVIEWER });

  const licence = await submitDocument(env, DRIVER, {
    documentType: "driving_license",
    storageRef: STORAGE_REF,
    idempotencyKey: nextKey("doc"),
    expiresAt: "2026-06-01",
  });
  await reviewDocument(env, DRIVER, licence.id, {
    status: "rejected",
    reviewedBy: REVIEWER,
    rejectionReasonCode: "ILLEGIBLE_SCAN",
  });

  const registration = await submitDocument(env, DRIVER, {
    documentType: "vehicle_registration",
    storageRef: STORAGE_REF,
    idempotencyKey: nextKey("doc"),
    vehicleId: vehicle.id,
    expiresAt: "2026-06-01",
  });
  await reviewDocument(env, DRIVER, registration.id, {
    status: "verified",
    reviewedBy: REVIEWER,
    expiresAt: "2026-06-01",
  });

  await declareAvailability(env, DRIVER, "available");
  await suspendDriver(env, DRIVER, "FRAUD_REVIEW");
  await reinstateDriver(env, DRIVER);

  env.clock.set("2026-06-02T00:00:00.000Z");
  await runExpiryTick(env);
  await setServiceZones(env, DRIVER, { zones: [{ zoneId: ZONE_B, preferenceRank: 2 }] });
}

describe("حارس الخصوصيّة في الأحداث", () => {
  it("لا لوحة ولا مؤشّر ملفّ ولا اسم ولا هويّة مراجع في أيّ حمولة حدث", async () => {
    const env = environment();
    await exerciseEveryPath(env);

    const events = await env.outbox.unread();
    expect(events.length).toBeGreaterThan(10);

    const serialised = JSON.stringify(events);
    for (const secret of [PLATE, STORAGE_REF, DISPLAY_NAME, REVIEWER]) {
      expect(serialised, `قيمة حسّاسة ظهرت في حمولة حدث: ${secret}`).not.toContain(secret);
    }
  });

  it("ولا حتى بأسماء الحقول — الحقل الغائب لا يُضاف يوماً بالخطأ", async () => {
    const env = environment();
    await exerciseEveryPath(env);
    const events = await env.outbox.unread();

    const forbidden = ["plate_number", "storage_ref", "display_name", "reviewed_by"];
    for (const event of events) {
      const payload = JSON.stringify((event as { data?: unknown }).data ?? {});
      for (const key of forbidden) {
        expect(payload, `${event.event_type} يحمل ${key}`).not.toContain(key);
      }
    }
  });

  it("كلّ حمولة تحمل occurred_for — لحظة السريان لا لحظة الإنتاج", async () => {
    const env = environment();
    await exerciseEveryPath(env);
    for (const event of await env.outbox.unread()) {
      const data = (event as { data?: Record<string, unknown> }).data ?? {};
      // Required by every schema in events.json; without it a consumer replaying the
      // stream cannot tell the order things BECAME true from the order we noticed.
      expect(data.occurred_for, `${event.event_type} بلا occurred_for`).toBeTypeOf("string");
    }
  });

  it("المغلّف كامل في كلّ حدث", async () => {
    const env = environment();
    await exerciseEveryPath(env);
    for (const event of await env.outbox.unread()) {
      expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(event.event_version).toBe("v1");
      expect(event.producer).toBe("drivers-service");
      expect(event.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(["driver", "driver_document", "driver_vehicle"]).toContain(event.aggregate.type);
      expect(event.aggregate.id.length).toBeGreaterThan(0);
    }
  });
});
