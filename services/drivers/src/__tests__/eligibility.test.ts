/**
 * The eligibility truth table.
 *
 * One test per condition in DRIVER_CORE.md §2, each breaking exactly one thing from a
 * baseline that passes everything. A single "ineligible driver" fixture with four
 * problems would pass while three of the four rules were broken.
 */

import { describe, expect, it } from "vitest";

import { evaluateEligibility, isWithinValidity, nextRecheckAt } from "../domain/eligibility.js";
import { LAUNCH_POLICY_VERSION, findSeededPolicy } from "../domain/policy.js";
import { loadSnapshot } from "../use-cases/recompute-eligibility.js";
import { readEligibility } from "../use-cases/read-eligibility.js";
import { declareAvailability, setServiceZones, suspendDriver, updateProfile } from "../use-cases/manage-profile.js";
import { patchVehicle } from "../use-cases/manage-vehicles.js";
import { reviewDocument, submitDocument } from "../use-cases/manage-documents.js";
import type { DriverDocument, EligibilityPolicy } from "../domain/model.js";
import { DRIVER, environment, eligibleDriver, nextKey, seedDriver, verifiedDocument } from "./helpers.js";

const policy = findSeededPolicy(LAUNCH_POLICY_VERSION) as EligibilityPolicy;

describe("eligibility truth table", () => {
  it("يمنح الأهليّة عند تحقّق كلّ الشروط", async () => {
    const env = environment();
    await eligibleDriver(env);
    const { decision } = await readEligibility(env, DRIVER);
    expect(decision.state).toBe("eligible");
    expect(decision.reasonCodes).toEqual([]);
  });

  it("يمنع بلا مركبة أساسيّة، ولا يبلّغ عن وثائق المركبة", async () => {
    const env = environment();
    const { vehicleId } = await eligibleDriver(env);
    await patchVehicle(env, DRIVER, vehicleId, { status: "retired" });

    const { decision } = await readEligibility(env, DRIVER);
    expect(decision.state).toBe("ineligible");
    expect(decision.reasonCodes).toEqual(["NO_PRIMARY_VEHICLE"]);
    // The registration is verified but attributed to a retired car. Reporting it as
    // missing would send him to upload a paper he cannot usefully supply.
    expect(decision.reasonCodes).not.toContain("DOCUMENT_MISSING");
  });

  it("يمنع بلا نطاق خدمة", async () => {
    const env = environment();
    await eligibleDriver(env);
    await setServiceZones(env, DRIVER, { zones: [] });
    const { decision } = await readEligibility(env, DRIVER);
    expect(decision.reasonCodes).toEqual(["NO_SERVICE_ZONE"]);
  });

  it("يمنع بلا نوع خدمة، وبمجموعة وثائق مطلوبة فارغة", async () => {
    const env = environment();
    await eligibleDriver(env);
    await updateProfile(env, DRIVER, { serviceKinds: [] });
    const { decision } = await readEligibility(env, DRIVER);
    // The only actionable step: choose a service kind. Requiring documents for a
    // service he has not chosen would be a checklist for a job he is not applying for.
    expect(decision.reasonCodes).toEqual(["NO_SERVICE_KIND"]);
  });

  it("يعيد السبب الأوّل وحده عند الإيقاف — الإيقاف يقطع القائمة", async () => {
    const env = environment();
    await seedDriver(env, { withZone: false, withVehicle: false });
    await suspendDriver(env, DRIVER, "FRAUD_REVIEW");

    const { decision } = await readEligibility(env, DRIVER);
    expect(decision.state).toBe("suspended");
    // Alone, although zone, vehicle and every document are also missing: none of
    // them can lift a suspension, and listing them would send him to fix the wrong
    // things.
    expect(decision.reasonCodes).toEqual(["PROFILE_SUSPENDED"]);
  });

  it("يجمع كلّ الأسباب لا أوّلها، بترتيب الكتالوج المنشور", async () => {
    const env = environment();
    await seedDriver(env, { withZone: false, withVehicle: false });
    const { decision } = await readEligibility(env, DRIVER);

    expect(decision.state).toBe("ineligible");
    expect(decision.reasonCodes).toEqual([
      "NO_PRIMARY_VEHICLE",
      "NO_SERVICE_ZONE",
      "DOCUMENT_MISSING",
    ]);
  });

  it("يميّز بين ناقص ومعلّق ومرفوض لكلّ نوع وثيقة", async () => {
    const env = environment();
    const vehicleId = await seedDriver(env);
    await verifiedDocument(env, "vehicle_registration", { vehicleId, expiresAt: "2027-06-01" });

    // national_id pending, driving_license rejected.
    await submitDocument(env, DRIVER, {
      documentType: "national_id",
      storageRef: "s3://wasla-docs/id.pdf",
      idempotencyKey: nextKey("doc"),
    });
    const licence = await submitDocument(env, DRIVER, {
      documentType: "driving_license",
      storageRef: "s3://wasla-docs/licence.pdf",
      idempotencyKey: nextKey("doc"),
    });
    await reviewDocument(env, DRIVER, licence.id, {
      status: "rejected",
      reviewedBy: "ops-1",
      rejectionReasonCode: "ILLEGIBLE_SCAN",
    });

    const { decision } = await readEligibility(env, DRIVER);
    // Codes follow the PUBLISHED catalogue order (the contract), …
    expect(decision.reasonCodes).toEqual(["DOCUMENT_PENDING", "DOCUMENT_REJECTED"]);
    // … while deficits follow the required-type order, which `requiredDocumentsFor`
    // sorts alphabetically. The two orders are deliberately independent: the codes
    // are compared between evaluations to detect change, so their order is part of
    // the contract; the deficits are detail, and sorting them by type is only what
    // makes them deterministic.
    expect(decision.deficits).toEqual([
      { code: "DOCUMENT_REJECTED", documentType: "driving_license" },
      { code: "DOCUMENT_PENDING", documentType: "national_id" },
    ]);
  });

  it("يفضّل المعلّق على المرفوض لنفس النوع", async () => {
    const env = environment();
    const vehicleId = await seedDriver(env);
    await verifiedDocument(env, "national_id");
    await verifiedDocument(env, "vehicle_registration", { vehicleId, expiresAt: "2027-06-01" });

    const first = await submitDocument(env, DRIVER, {
      documentType: "driving_license",
      storageRef: "s3://wasla-docs/licence-1.pdf",
      idempotencyKey: nextKey("doc"),
    });
    await reviewDocument(env, DRIVER, first.id, {
      status: "rejected",
      reviewedBy: "ops-1",
      rejectionReasonCode: "ILLEGIBLE_SCAN",
    });
    await submitDocument(env, DRIVER, {
      documentType: "driving_license",
      storageRef: "s3://wasla-docs/licence-2.pdf",
      idempotencyKey: nextKey("doc"),
    });

    const { decision } = await readEligibility(env, DRIVER);
    // He has already done his part; the answer must be "wait", not "upload again".
    expect(decision.reasonCodes).toEqual(["DOCUMENT_PENDING"]);
  });

  it("يبلّغ PROFILE_NOT_VERIFIED وحده حين لا يوجد سبب أخصّ منه", async () => {
    const env = environment();
    await eligibleDriver(env);
    // Everything is in order, then an operator marks the file itself as not verified.
    await env.profiles.update(DRIVER, { verificationStatus: "rejected" }, env.clock.now());

    const { decision } = await readEligibility(env, DRIVER);
    // The promise: an `ineligible` verdict never carries an empty reason list.
    expect(decision.reasonCodes).toEqual(["PROFILE_NOT_VERIFIED"]);
  });
});

describe("انتهاء الصلاحيّة على الحدّ", () => {
  const documentAt = (expiresAt: string): DriverDocument => ({
    id: "d1",
    waslaPublicId: DRIVER,
    documentType: "driving_license",
    status: "verified",
    vehicleId: null,
    storageRef: "s3://x",
    issuedAt: null,
    expiresAt,
    reviewedAt: "2026-01-01T00:00:00.000Z",
    reviewedBy: "ops-1",
    rejectionReasonCode: null,
    idempotencyKey: "k",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  it("صالحة قبل اللحظة، ساقطة عندها وبعدها — تفشل مبكّراً لا متأخّراً", () => {
    const boundary = Date.parse("2026-03-10T00:00:00.000Z");
    const document = documentAt("2026-03-10");
    expect(isWithinValidity(document, policy, boundary - 1)).toBe(true);
    // AT the instant it is already invalid: `>` and not `>=`, fail-closed.
    expect(isWithinValidity(document, policy, boundary)).toBe(false);
    expect(isWithinValidity(document, policy, boundary + 1)).toBe(false);
  });

  it("مهلة السماح تُمدّد الحدّ بعدد أيّامها بالضبط", () => {
    const lenient: EligibilityPolicy = { ...policy, documentGraceDays: 3 };
    const boundary = Date.parse("2026-03-10T00:00:00.000Z");
    const document = documentAt("2026-03-10");
    expect(isWithinValidity(document, lenient, boundary + 3 * 86_400_000 - 1)).toBe(true);
    expect(isWithinValidity(document, lenient, boundary + 3 * 86_400_000)).toBe(false);
  });

  it("وثيقة بلا تاريخ انتهاء لا تنتهي، ولا تُنتج موعد مراجعة", () => {
    const document = { ...documentAt("2026-03-10"), expiresAt: null };
    expect(isWithinValidity(document, policy, Date.parse("2099-01-01T00:00:00.000Z"))).toBe(true);
    expect(nextRecheckAt([document], policy, Date.parse("2026-01-01T00:00:00.000Z"))).toBeNull();
  });

  it("موعد المراجعة هو أقرب انقلاب مستقبليّ، ويتجاهل ما مضى", () => {
    const nowMs = Date.parse("2026-06-01T00:00:00.000Z");
    const past = { ...documentAt("2026-01-01"), id: "past" };
    const soon = { ...documentAt("2026-07-01"), id: "soon" };
    const later = { ...documentAt("2027-01-01"), id: "later" };
    // A past flip would make the tick pick the same driver forever.
    expect(nextRecheckAt([past, later, soon], policy, nowMs)).toBe("2026-07-01T00:00:00.000Z");
  });

  it("المعلّقة لا تُنتج موعد مراجعة — لا شيء ينتهي قبل قبوله", () => {
    const pending: DriverDocument = { ...documentAt("2026-07-01"), status: "pending" };
    expect(nextRecheckAt([pending], policy, Date.parse("2026-01-01T00:00:00.000Z"))).toBeNull();
  });
});

describe("evaluateEligibility نقيّة", () => {
  it("لا تقرأ الساعة — نفس اللقطة تُنتج نفس الحكم مرّتين", async () => {
    const env = environment();
    await eligibleDriver(env);
    const snapshot = await loadSnapshot(env, DRIVER);
    if (snapshot === null) throw new Error("snapshot");

    const first = evaluateEligibility(snapshot, policy, "2026-02-01T00:00:00.000Z");
    const second = evaluateEligibility(snapshot, policy, "2026-02-01T00:00:00.000Z");
    expect(second).toEqual(first);

    // And the same snapshot after the licence expiry is a different answer, proving
    // `now` is the injected value and not the process clock.
    const later = evaluateEligibility(snapshot, policy, "2028-01-01T00:00:00.000Z");
    expect(later.reasonCodes).toEqual(["DOCUMENT_EXPIRED"]);
  });

  it("الجاهزيّة المعلنة لا تدخل في الحكم", async () => {
    const env = environment();
    await eligibleDriver(env);
    await declareAvailability(env, DRIVER, "offline");
    const { decision } = await readEligibility(env, DRIVER);
    // Two axes, deliberately separate: a driver taking a break is not unqualified.
    expect(decision.state).toBe("eligible");
  });
});
