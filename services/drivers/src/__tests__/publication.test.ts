/**
 * The eligibility log, the outbox, and the publication to matching.
 *
 * The subject here is not "does the verdict come out right" (that is
 * `eligibility.test.ts`) but "is the change RECORDED, and does a failure downstream
 * stay visible instead of quietly disappearing".
 */

import { describe, expect, it } from "vitest";

import { projectedAvailability, recomputeEligibility } from "../use-cases/recompute-eligibility.js";
import { readEligibility, runExpiryTick } from "../use-cases/read-eligibility.js";
import { declareAvailability, setServiceZones, suspendDriver } from "../use-cases/manage-profile.js";
import { submitDocument } from "../use-cases/manage-documents.js";
import { DRIVER, ZONE_B, environment, eligibleDriver, nextKey, seedDriver } from "./helpers.js";

describe("سجلّ الأهليّة", () => {
  it("يُقيَّد الصفّ عند التغيّر فقط", async () => {
    const env = environment();
    await eligibleDriver(env);
    const before = (await env.eligibilityLog.list(DRIVER)).length;

    await readEligibility(env, DRIVER);
    await readEligibility(env, DRIVER);
    // Repeated reads of an unchanged driver write nothing: a log that grows on every
    // read is a log nobody can read.
    expect((await env.eligibilityLog.list(DRIVER)).length).toBe(before);
  });

  it("أوّل صفّ يُقيَّد عند التسجيل، فلا يبدأ التاريخ فارغاً", async () => {
    const env = environment();
    await seedDriver(env, { withZone: false, withVehicle: false });
    const entries = await env.eligibilityLog.list(DRIVER);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.fromState).toBeNull();
    expect(entries[0]?.toState).toBe("ineligible");
    expect(entries[0]?.trigger).toBe("profile_changed");
  });

  it("تغيّر الأسباب وحدها تغيّرٌ يُقيَّد، وإن بقيت الحالة", async () => {
    const env = environment();
    await seedDriver(env, { withZone: false, withVehicle: false });
    const first = await env.eligibilityLog.latest(DRIVER);
    expect(first?.reasons).toContain("NO_SERVICE_ZONE");

    await setServiceZones(env, DRIVER, { zones: [{ zoneId: ZONE_B, preferenceRank: 1 }] });
    const second = await env.eligibilityLog.latest(DRIVER);
    // Still `ineligible`, but for one reason fewer — and that is a change the driver
    // can see progress in, so it belongs on the record.
    expect(second?.toState).toBe("ineligible");
    expect(second?.reasons).not.toContain("NO_SERVICE_ZONE");
    expect(await env.eligibilityLog.list(DRIVER)).toHaveLength(2);
  });

  it("لكلّ صفّ سجلّ حدث مقابل — لا تغيّر صامت", async () => {
    const env = environment();
    await eligibleDriver(env);
    const rows = await env.eligibilityLog.list(DRIVER);
    const events = (await env.outbox.unread()).filter(
      (event) => event.event_type === "drivers.eligibility_changed",
    );
    expect(events).toHaveLength(rows.length);
  });
});

describe("النشر إلى المطابقة", () => {
  it("لا يرفع سائقاً من busy — الجاهزيّة الحاليّة تُصان", () => {
    // ADR-012 decision 4: `busy` is dispatch's word about a live commitment.
    expect(projectedAvailability("available", "busy")).toBe("busy");
    expect(projectedAvailability("offline", "busy")).toBe("offline");
    expect(projectedAvailability("available", "offline")).toBe("available");
    expect(projectedAvailability("available", null)).toBe("available");
  });

  it("يُصان busy عبر مسار النشر الكامل", async () => {
    const env = environment();
    await eligibleDriver(env);
    env.candidacy.seed({
      waslaPublicId: DRIVER,
      eligibilityState: "eligible",
      availabilityState: "busy",
      serviceKinds: ["ride"],
      zoneIds: [],
      vehicleClass: "sedan",
    });

    await declareAvailability(env, DRIVER, "available");
    const attempts = await env.publications.list(DRIVER);
    const last = attempts[attempts.length - 1];
    // Otherwise a driver holding a live order is offered a second one, and the second
    // passenger pays for it.
    expect(last?.availabilityState).toBe("busy");
  });

  it("فشل النقل يُقيَّد ولا يُرجِع الحالة المحليّة", async () => {
    const env = environment();
    await eligibleDriver(env);
    env.candidacy.transportBroken = true;

    await suspendDriver(env, DRIVER, "FRAUD_REVIEW");

    const profile = await env.profiles.find(DRIVER);
    // The local truth stands: our correctness must not depend on matching's uptime.
    expect(profile?.status).toBe("suspended");
    const attempts = await env.publications.list(DRIVER);
    const last = attempts[attempts.length - 1];
    expect(last?.outcome).toBe("unavailable");
    expect(last?.failureCode).toBe("MATCHING_UNREACHABLE");
    // And the drift stays VISIBLE rather than being papered over.
    expect(profile?.lastPublishedState).not.toBe("suspended");
  });

  it("رفض المطابقة يُقيَّد بكوده لا بكودنا", async () => {
    const env = environment();
    await eligibleDriver(env);
    env.candidacy.failureCode = "CANDIDATE_ZONE_UNKNOWN";

    await declareAvailability(env, DRIVER, "available");
    const attempts = await env.publications.list(DRIVER);
    const last = attempts[attempts.length - 1];
    // "It answered and refused" is a different fact from "we could not reach it".
    expect(last?.outcome).toBe("rejected");
    expect(last?.failureCode).toBe("CANDIDATE_ZONE_UNKNOWN");
  });

  it("last_published_state لا يتقدّم إلّا بنشر ناجح", async () => {
    const env = environment();
    await eligibleDriver(env);
    const published = await env.profiles.find(DRIVER);
    expect(published?.lastPublishedState).toBe("eligible");

    env.candidacy.transportBroken = true;
    await suspendDriver(env, DRIVER, "FRAUD_REVIEW");
    expect((await env.profiles.find(DRIVER))?.lastPublishedState).toBe("eligible");
  });

  it("إيداع وثيقة لا يُعيد النشر بلا تغيّر في الحكم", async () => {
    const env = environment();
    await eligibleDriver(env);
    const before = (await env.publications.list(DRIVER)).length;

    await submitDocument(env, DRIVER, {
      documentType: "vehicle_photo",
      storageRef: "s3://wasla-docs/photo.jpg",
      idempotencyKey: nextKey("doc"),
      vehicleId: (await env.vehicles.list(DRIVER))[0]?.id ?? null,
    });
    // An optional photo changes nothing matching stores; republishing would be load
    // against a service that did nothing wrong.
    expect((await env.publications.list(DRIVER)).length).toBe(before);
  });
});

describe("نبضة الانتهاء", () => {
  it("تُسقط الأهليّة عند مرور تاريخ الانتهاء", async () => {
    const env = environment("2026-01-01T00:00:00.000Z");
    await eligibleDriver(env);
    expect((await env.eligibilityLog.latest(DRIVER))?.toState).toBe("eligible");

    // The licence expires 2027-01-01; nobody has touched anything.
    env.clock.set("2027-01-02T00:00:00.000Z");
    const result = await runExpiryTick(env);

    expect(result.recheckedDrivers).toBe(1);
    expect(result.changedDrivers).toBe(1);
    const latest = await env.eligibilityLog.latest(DRIVER);
    expect(latest?.toState).toBe("ineligible");
    expect(latest?.reasons).toEqual(["DOCUMENT_EXPIRED"]);
    expect(latest?.trigger).toBe("expiry_tick");
  });

  it("occurred_for هو لحظة الانتهاء لا لحظة تشغيل النبضة", async () => {
    const env = environment("2026-01-01T00:00:00.000Z");
    await eligibleDriver(env);
    // Six months late, as a forgotten cron would be.
    env.clock.set("2027-07-01T00:00:00.000Z");
    await runExpiryTick(env);

    const events = (await env.outbox.unread()).filter(
      (event) => event.event_type === "drivers.eligibility_changed",
    );
    const last = events[events.length - 1];
    expect(last?.occurred_at).toBe("2027-07-01T00:00:00.000Z");
    // A tick that runs six months late must not claim the licence expired six months
    // late. `occurred_for` is the instant the change was EFFECTIVE.
    expect(last?.data.occurred_for).toBe("2027-01-01T00:00:00.000Z");
  });

  it("النبضة لا تختار سائقاً لم يحن موعده", async () => {
    const env = environment("2026-01-01T00:00:00.000Z");
    await eligibleDriver(env);
    const result = await runExpiryTick(env);
    expect(result.recheckedDrivers).toBe(0);
  });

  it("النبضة لا تدور على نفس السائق أبداً", async () => {
    const env = environment("2026-01-01T00:00:00.000Z");
    await eligibleDriver(env);
    env.clock.set("2027-01-02T00:00:00.000Z");

    const first = await runExpiryTick(env);
    expect(first.recheckedDrivers).toBe(1);
    // The whole reason past flip instants are skipped: a second sweep must find
    // nothing, or a forgotten cron becomes an infinite loop over one driver.
    const second = await runExpiryTick(env);
    expect(second.recheckedDrivers).toBe(0);
  });

  it("النبضة لا تنشر سائقاً لم يتغيّر حكمه", async () => {
    const env = environment("2026-01-01T00:00:00.000Z");
    await eligibleDriver(env);
    const before = (await env.publications.list(DRIVER)).length;
    await recomputeEligibility(env, DRIVER, { trigger: "expiry_tick" });
    expect((await env.publications.list(DRIVER)).length).toBe(before);
  });

  it("سائق بلا ملفّ: unknown، ولا يُكتب شيء", async () => {
    const env = environment();
    const { decision } = await readEligibility(env, "WS-9999999999");
    expect(decision.state).toBe("unknown");
    expect(decision.reasonCodes).toEqual([]);
    // A log row for a driver who does not exist would put a profile-shaped hole in
    // the audit trail.
    expect(await env.eligibilityLog.list("WS-9999999999")).toHaveLength(0);
    expect(await env.outbox.unread()).toHaveLength(0);
  });
});
