/**
 * The document and vehicle state machines, and the constraints the in-memory stores
 * simulate by name.
 *
 * These tests assert on CONSTRAINT NAMES on purpose. When MR 3/6 puts Postgres behind
 * the same ports, a rule that changed name will fail here rather than surface as an
 * unrecognised database error in production.
 */

import { describe, expect, it } from "vitest";

import { ConstraintViolation } from "../infrastructure/in-memory.js";
import { canTransitionDocument } from "../domain/documents.js";
import { canTransitionVehicle } from "../domain/vehicles.js";
import { isDriverError } from "../domain/errors.js";
import { patchVehicle, registerVehicle } from "../use-cases/manage-vehicles.js";
import { reviewDocument, submitDocument } from "../use-cases/manage-documents.js";
import { reinstateDriver, suspendDriver } from "../use-cases/manage-profile.js";
import { DRIVER, environment, nextKey, seedDriver, verifiedDocument } from "./helpers.js";

async function expectDriverError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => isDriverError(error) && error.code === code,
    `expected DriverError ${code}`,
  );
}

describe("آلة حالة الوثيقة", () => {
  it("الانتقالات المسموحة فقط، و superseded نهائيّة", () => {
    expect(canTransitionDocument("pending", "verified")).toBe(true);
    expect(canTransitionDocument("pending", "rejected")).toBe(true);
    expect(canTransitionDocument("pending", "superseded")).toBe(true);
    expect(canTransitionDocument("verified", "superseded")).toBe(true);
    expect(canTransitionDocument("rejected", "superseded")).toBe(true);
    // No re-review in place, and no way back out of history.
    expect(canTransitionDocument("verified", "rejected")).toBe(false);
    expect(canTransitionDocument("rejected", "verified")).toBe(false);
    expect(canTransitionDocument("superseded", "pending")).toBe(false);
    expect(canTransitionDocument("superseded", "verified")).toBe(false);
    // There is deliberately no `expired` state: expiry is a DATE compared at read
    // time, not a status somebody has to remember to write.
    expect(canTransitionDocument("verified", "verified")).toBe(false);
  });

  it("لا تُراجَع وثيقة مرّتين", async () => {
    const env = environment();
    await seedDriver(env);
    const document = await submitDocument(env, DRIVER, {
      documentType: "national_id",
      storageRef: "s3://wasla-docs/id.pdf",
      idempotencyKey: nextKey("doc"),
    });
    await reviewDocument(env, DRIVER, document.id, { status: "verified", reviewedBy: "ops-1" });
    await expectDriverError(
      reviewDocument(env, DRIVER, document.id, {
        status: "rejected",
        reviewedBy: "ops-2",
        rejectionReasonCode: "SECOND_THOUGHTS",
      }),
      "DRIVER_DOCUMENT_ALREADY_REVIEWED",
    );
  });

  it("الإيداع الجديد يُخلِف النسخة الحيّة ولا يمسحها", async () => {
    const env = environment();
    await seedDriver(env);
    const first = await verifiedDocument(env, "national_id");
    await submitDocument(env, DRIVER, {
      documentType: "national_id",
      storageRef: "s3://wasla-docs/id-2.pdf",
      idempotencyKey: nextKey("doc"),
    });

    const all = await env.documents.list(DRIVER);
    const old = all.find((document) => document.id === first.id);
    expect(old?.status).toBe("superseded");
    // The old row survives, with its reviewer and its date, because an audit asks
    // what was accepted on the day the decision was made.
    expect(old?.reviewedBy).toBe("ops-1");
    expect(all.filter((document) => document.status === "pending")).toHaveLength(1);
  });

  it("مفتاح تكرار مُعاد بحمولة مختلفة يُرفض", async () => {
    const env = environment();
    await seedDriver(env);
    const key = nextKey("doc");
    await submitDocument(env, DRIVER, {
      documentType: "national_id",
      storageRef: "s3://wasla-docs/id.pdf",
      idempotencyKey: key,
    });
    // The same call again: a retry, and it must succeed with the same row.
    const retry = await submitDocument(env, DRIVER, {
      documentType: "national_id",
      storageRef: "s3://wasla-docs/id.pdf",
      idempotencyKey: key,
    });
    expect(retry.storageRef).toBe("s3://wasla-docs/id.pdf");

    await expectDriverError(
      submitDocument(env, DRIVER, {
        documentType: "national_id",
        storageRef: "s3://wasla-docs/DIFFERENT.pdf",
        idempotencyKey: key,
      }),
      "DRIVER_IDEMPOTENCY_KEY_REUSED",
    );
  });

  it("وثيقة مركبة بلا مركبة تُرفض قبل أن تلمس المخزن", async () => {
    const env = environment();
    await seedDriver(env);
    await expectDriverError(
      submitDocument(env, DRIVER, {
        documentType: "vehicle_registration",
        storageRef: "s3://wasla-docs/reg.pdf",
        idempotencyKey: nextKey("doc"),
        vehicleId: null,
      }),
      "DRIVER_PRIMARY_VEHICLE_REQUIRED",
    );
  });

  it("وثيقة شخصيّة مع مركبة تُرفض كذلك — النطاق يعمل في الاتّجاهين", async () => {
    const env = environment();
    const vehicleId = await seedDriver(env);
    await expectDriverError(
      submitDocument(env, DRIVER, {
        documentType: "national_id",
        storageRef: "s3://wasla-docs/id.pdf",
        idempotencyKey: nextKey("doc"),
        vehicleId,
      }),
      "DRIVER_VALIDATION_FAILED",
    );
  });

  it("تاريخ انتهاء قبل الإصدار يُرفض", async () => {
    const env = environment();
    await seedDriver(env);
    await expectDriverError(
      submitDocument(env, DRIVER, {
        documentType: "national_id",
        storageRef: "s3://wasla-docs/id.pdf",
        idempotencyKey: nextKey("doc"),
        issuedAt: "2026-05-01",
        expiresAt: "2026-04-01",
      }),
      "DRIVER_DOCUMENT_EXPIRY_INVALID",
    );
  });

  it("تاريخ غير موجود فعلاً يُرفض لا يُقبَل شكلاً", async () => {
    const env = environment();
    await seedDriver(env);
    await expectDriverError(
      submitDocument(env, DRIVER, {
        documentType: "national_id",
        storageRef: "s3://wasla-docs/id.pdf",
        idempotencyKey: nextKey("doc"),
        expiresAt: "2026-02-31",
      }),
      "DRIVER_VALIDATION_FAILED",
    );
  });
});

describe("آلة حالة المركبة", () => {
  it("active → retired فقط، ولا رجعة", () => {
    expect(canTransitionVehicle("active", "retired")).toBe(true);
    expect(canTransitionVehicle("retired", "active")).toBe(false);
    expect(canTransitionVehicle("retired", "retired")).toBe(false);
  });

  it("أوّل مركبة تصبح أساسيّة تلقائيّاً", async () => {
    const env = environment();
    const vehicleId = await seedDriver(env);
    const vehicle = await env.vehicles.find(DRIVER, vehicleId);
    // Otherwise he is ineligible for a reason no screen we offer him can fix.
    expect(vehicle?.isPrimary).toBe(true);
  });

  it("الترقية تُنزل الأخت في نفس الخطوة — أساسيّة واحدة دائماً", async () => {
    const env = environment();
    const first = await seedDriver(env);
    const second = await registerVehicle(env, DRIVER, {
      vehicleClass: "van",
      idempotencyKey: nextKey("veh"),
    });
    expect(second.isPrimary).toBe(false);

    await patchVehicle(env, DRIVER, second.id, { isPrimary: true });
    const fleet = await env.vehicles.list(DRIVER);
    expect(fleet.filter((vehicle) => vehicle.isPrimary).map((vehicle) => vehicle.id)).toEqual([
      second.id,
    ]);
    expect((await env.vehicles.find(DRIVER, first))?.isPrimary).toBe(false);
  });

  it("سحب المركبة الأساسيّة يمسح العلَم في نفس الخطوة", async () => {
    const env = environment();
    const vehicleId = await seedDriver(env);
    const retired = await patchVehicle(env, DRIVER, vehicleId, { status: "retired" });
    // ck_driver_vehicles_retired_not_primary: two steps would leave a window in
    // which a retired car is still the primary one.
    expect(retired.status).toBe("retired");
    expect(retired.isPrimary).toBe(false);
  });

  it("وثائق مركبة مسحوبة تُرفض", async () => {
    const env = environment();
    const vehicleId = await seedDriver(env);
    await patchVehicle(env, DRIVER, vehicleId, { status: "retired" });
    await expectDriverError(
      submitDocument(env, DRIVER, {
        documentType: "vehicle_registration",
        storageRef: "s3://wasla-docs/reg.pdf",
        idempotencyKey: nextKey("doc"),
        vehicleId,
      }),
      "DRIVER_VEHICLE_RETIRED",
    );
  });
});

describe("قيود المخزن تُحاكى بالاسم", () => {
  it("أساسيّتان في حفظة واحدة تُشعل ux_driver_vehicles_one_primary", async () => {
    const env = environment();
    const first = await seedDriver(env);
    const second = await registerVehicle(env, DRIVER, {
      vehicleClass: "van",
      idempotencyKey: nextKey("veh"),
    });
    const a = await env.vehicles.find(DRIVER, first);
    const b = await env.vehicles.find(DRIVER, second.id);
    if (a === null || b === null) throw new Error("fixture");

    // Reaching past the use cases on purpose: this asserts the STORE refuses it, so
    // a future use case that forgets to demote cannot pass silently.
    await expect(
      env.vehicles.saveAll([{ ...a, isPrimary: true }, { ...b, isPrimary: true }]),
    ).rejects.toThrow(ConstraintViolation);
  });

  it("إيقاف بلا سبب يُشعل ck_driver_profiles_suspension_reason", async () => {
    const env = environment();
    await seedDriver(env);
    await expect(
      env.profiles.update(DRIVER, { status: "suspended" }, env.clock.now()),
    ).rejects.toThrow(/ck_driver_profiles_suspension_reason/);
  });

  it("القيد المُشتعل ليس DriverError — لأنّه عيب فينا لا في المتصل", async () => {
    const env = environment();
    await seedDriver(env);
    const error = await env.profiles
      .update(DRIVER, { status: "suspended" }, env.clock.now())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConstraintViolation);
    // Dressing a domain bug as a 4xx is how it gets triaged as a client problem.
    expect(isDriverError(error)).toBe(false);
  });
});

describe("الإيقاف والإعادة", () => {
  it("الإيقاف يمنع كتابات السائق ولا يمنع المراجعة", async () => {
    const env = environment();
    await seedDriver(env);
    const document = await submitDocument(env, DRIVER, {
      documentType: "national_id",
      storageRef: "s3://wasla-docs/id.pdf",
      idempotencyKey: nextKey("doc"),
    });
    await suspendDriver(env, DRIVER, "FRAUD_REVIEW");

    await expectDriverError(
      submitDocument(env, DRIVER, {
        documentType: "driving_license",
        storageRef: "s3://wasla-docs/licence.pdf",
        idempotencyKey: nextKey("doc"),
      }),
      "DRIVER_SUSPENDED",
    );
    // The operator queue keeps working: a suspended file is exactly the one whose
    // papers somebody needs to look at.
    const reviewed = await reviewDocument(env, DRIVER, document.id, {
      status: "verified",
      reviewedBy: "ops-1",
    });
    expect(reviewed.status).toBe("verified");
  });

  it("إيقاف مُوقَف و إعادة غير مُوقَف يُرفضان", async () => {
    const env = environment();
    await seedDriver(env);
    await expectDriverError(reinstateDriver(env, DRIVER), "DRIVER_NOT_SUSPENDED");
    await suspendDriver(env, DRIVER, "FRAUD_REVIEW");
    await expectDriverError(suspendDriver(env, DRIVER, "AGAIN"), "DRIVER_SUSPENDED");
  });

  it("الإعادة لا تَهَب أهليّة — يعود إلى ما تسمح به وثائقه", async () => {
    const env = environment();
    await seedDriver(env, { withZone: false, withVehicle: false });
    await suspendDriver(env, DRIVER, "FRAUD_REVIEW");
    await reinstateDriver(env, DRIVER);

    const profile = await env.profiles.find(DRIVER);
    expect(profile?.status).toBe("active");
    expect(profile?.suspensionReasonCode).toBeNull();
    const latest = await env.eligibilityLog.latest(DRIVER);
    expect(latest?.toState).toBe("ineligible");
  });

  it("الإيقاف لا يمسّ verification_status", async () => {
    const env = environment();
    const vehicleId = await seedDriver(env);
    await verifiedDocument(env, "national_id");
    await verifiedDocument(env, "driving_license", { expiresAt: "2027-01-01" });
    await verifiedDocument(env, "vehicle_registration", { vehicleId, expiresAt: "2027-06-01" });
    expect((await env.profiles.find(DRIVER))?.verificationStatus).toBe("verified");

    await suspendDriver(env, DRIVER, "FRAUD_REVIEW");
    // Expressing a suspension by resetting verification would erase the record of a
    // verified driver being blocked, and the appeal a week later would read nothing.
    expect((await env.profiles.find(DRIVER))?.verificationStatus).toBe("verified");
  });
});
