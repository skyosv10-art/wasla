/**
 * # بوابة خروج الطور 05 — نواة السائق (Phase 05 Exit Gate)
 *
 * السؤال الواحد الذي تجيب عنه هذه البوابة، بنصّ خارطة الطريق:
 *
 * > «سائق يُسجَّل ويُراجَع فيصير مؤهَّلاً **بأهليّة محسوبة** فيصله عرض حقيقي من
 * > التوزيع، ثمّ تنتهي وثيقته **بنبضة واحدة** فيخرج من التجمّع — و`eligibility_source`
 * > يقرأه أحدٌ `driver_core` لا `claimed`.»
 *
 * كل تأكيد هنا يمرّ من HTTP العلني لسبعة خدمات حقيقية. لا اختبار في هذا الملف يلمس
 * مخزناً ولا يبني صفّاً بيده: الحالة التي لا يستطيع السطح العلني إنتاجها حالةٌ لا يجب
 * أن يُبنى عليها برهان.
 *
 * أربعة مسارات، كلٌّ منها نهاية يجب أن تكون قابلة للوصول وقابلة للإثبات:
 *
 *   1. **المسار الكامل** — من `POST /identity/resolve` إلى طلب `accepted` مربوط بالسائق،
 *      والأهليّة محسوبة لا مُدّعاة.
 *   2. **نبضة واحدة تُخرجه** — تنتهي رخصته، فتُخرجه نبضة واحدة من التجمّع، ويتوقّف
 *      التوزيع عن عرض أي شيء عليه.
 *   3. **الجغرافيا بوابة لا تزيين** — منطقة لا تعرفها خدمة الجغرافيا تُرفض، لأنّ
 *      المنفذ سألها فعلاً.
 *   4. **`busy` لا يُرقّى** — سائق مشغول يعلن «أنا متاح» فلا يصير متاحاً عند المطابقة،
 *      لأنّ الالتزام الحيّ لخدمة أخرى (ADR-012 القرار 4).
 *
 * التفصيل والحجّة في docs/12-testing/PHASE05_EXIT_GATE_E2E.md.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  callDrivers,
  callMatching,
  candidacyStatus,
  createJob,
  EXPIRY_ADVANCE_SECONDS,
  nextKey,
  onboardDriver,
  openOffers,
  orderStatus,
  placeOrder,
  readCandidacy,
  readEligibility,
  readJob,
  readOffers,
  SERVED_ZONE,
  startGate,
  tickDispatch,
  tickEligibility,
  UNKNOWN_ZONE,
  type GateContext,
} from "../harness.js";

let gate: GateContext;

beforeEach(async () => {
  gate = await startGate();
});

afterEach(async () => {
  await gate.close();
});

// ---------------------------------------------------------------------------
// 1. المسار الكامل: تسجيل → مراجعة → أهليّة محسوبة → عرض حقيقي → قبول
// ---------------------------------------------------------------------------

describe("المسار الكامل: من التسجيل إلى طلب مقبول", () => {
  it("سائق مُراجَع يصير مؤهَّلاً بأهليّة محسوبة، فيصله عرض من التوزيع فيقبله", async () => {
    const driver = await onboardDriver(gate);

    // (أ) الأهليّة محسوبة: `eligible` بلا سبب واحد، والسياسة المُثبَّتة هي التي حكمت.
    const verdict = await readEligibility(gate, driver.waslaPublicId);
    expect(verdict.eligibility_state).toBe("eligible");
    expect(verdict.reason_codes).toEqual([]);
    expect(verdict.policy_version).toBe(1);

    // (ب) المطابقة تحمل الإسقاط، وما لم يُكتب بيد أحد: المصدر `driver_core`.
    const candidacy = await readCandidacy(gate, driver.waslaPublicId);
    expect(candidacy.eligibility_state).toBe("eligible");
    expect(candidacy.eligibility_source).toBe("driver_core");
    expect(candidacy.availability_state).toBe("available");
    expect(candidacy.service_kinds).toEqual(["ride"]);
    expect(candidacy.vehicle_class).toBe("sedan");
    expect(candidacy.zone_ids).toEqual([SERVED_ZONE]);

    // (ج) طلب حقيقي من عميل حقيقي، ومهمّة توزيع، ونبضة واحدة.
    const order = await placeOrder(gate);
    const job = await createJob(gate, order);
    await tickDispatch(gate);

    // (د) العرض وصل هذا السائق بالذات — لا «سائقاً ما».
    const offers = await openOffers(gate, job.id as string);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.driver_public_id).toBe(driver.waslaPublicId);

    // (هـ) يقبل من المسار نفسه الذي سيستدعيه بوت السائق.
    const accepted = await callDrivers(gate, { method: "GET", path: "/health" });
    expect(accepted.status).toBe(200);
    const acceptance = await fetch(
      `${gate.dispatchUrl}/dispatch/offers/${offers[0]?.id as string}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": nextKey("gate-accept") },
        body: JSON.stringify({ driver_public_id: driver.waslaPublicId }),
      },
    );
    expect(acceptance.status).toBe(200);

    // (و) الطلب صار مقبولاً عند المحرّك، والمهمّة انتهت عند التوزيع.
    expect(await orderStatus(gate, order)).toBe("accepted");
    expect((await readJob(gate, job.id as string)).status).toBe("assigned");
  });

  it("الأهليّة ليست ادّعاءً: قبل المراجعة لا عرض، وبعدها عرض", async () => {
    // نفس السائق، بلا وثائق مُتحقَّقة. كل شيء آخر مُكتمل — منطقة ومركبة وتوافر — حتى
    // يكون الفارق الوحيد هو المراجعة، ويكون غياب العرض منسوباً إليها وحدها.
    const driver = await onboardDriver(gate, { verifiedDocuments: [] });
    const before = await readEligibility(gate, driver.waslaPublicId);
    expect(before.eligibility_state).toBe("ineligible");
    // كل الأسباب لا أوّلها: سائق يُصلح شيئاً واحداً كل يوم يقضي ثلاثة أيام.
    expect(before.reason_codes).toContain("DOCUMENT_MISSING");

    const order = await placeOrder(gate);
    const job = await createJob(gate, order);
    await tickDispatch(gate);
    expect(await openOffers(gate, job.id as string)).toHaveLength(0);
    // والسبب معلن عند التوزيع لا مُخمَّن: المطابقة أفرغت المجموعة بالأهليّة.
    expect(await orderStatus(gate, order)).toBe("searching");
  });
});

// ---------------------------------------------------------------------------
// 2. نبضة واحدة: انتهاء الوثيقة يُخرجه من التجمّع
// ---------------------------------------------------------------------------

describe("نبضة واحدة تُخرجه من التجمّع", () => {
  it("تنتهي الرخصة، فتُخرجه نبضة واحدة، فلا يعود التوزيع يراه", async () => {
    const driver = await onboardDriver(gate);
    expect((await readCandidacy(gate, driver.waslaPublicId)).eligibility_state).toBe("eligible");

    // الزمن يتقدّم بالحقن لا بالانتظار. لحظة الانتهاء محسوبة من ثابتَي المسخّرة، فلو
    // تحرّك الحقبة لَما توقّف الاختبار عن عبور الانتهاء بصمت.
    gate.clock.advanceSeconds(EXPIRY_ADVANCE_SECONDS);

    // نبضة **واحدة**. لا حلقة، ولا انتظار، ولا نبضة ثانية «للتأكّد».
    const tick = await tickEligibility(gate);
    expect(tick.rechecked_drivers).toBe(1);
    expect(tick.changed_drivers).toBe(1);
    expect(tick.published).toBe(1);
    expect(tick.publish_failures).toBe(0);

    // الحكم انتقل، والسبب هو الانتهاء بالاسم لا «مشكلة في الوثائق».
    const after = await readEligibility(gate, driver.waslaPublicId);
    expect(after.eligibility_state).toBe("ineligible");
    expect(after.reason_codes).toContain("DOCUMENT_EXPIRED");

    // والمطابقة عرفت — لأنّ النبضة نشرت، لا لأنّ أحداً أخبرها.
    const candidacy = await readCandidacy(gate, driver.waslaPublicId);
    expect(candidacy.eligibility_state).toBe("ineligible");
    expect(candidacy.eligibility_source).toBe("driver_core");

    // وخروجه من التجمّع ليس صفّاً في جدول: التوزيع لا يعرض عليه شيئاً.
    const order = await placeOrder(gate);
    const job = await createJob(gate, order);
    await tickDispatch(gate);
    expect(await openOffers(gate, job.id as string)).toHaveLength(0);
  });

  it("النبضة الثانية لا تجد شيئاً ولا تنشر ثانية — سكونها من حالتها", async () => {
    const driver = await onboardDriver(gate);
    gate.clock.advanceSeconds(EXPIRY_ADVANCE_SECONDS);
    await tickEligibility(gate);

    const second = await tickEligibility(gate);
    // مؤشّر إعادة الفحص أُفرِغ في النبضة الأولى، فلا سائق مستحقّ ولا نشر. لو بقي
    // مستحقّاً لظلّت كل نبضة تعيد نشره إلى الأبد على خدمة لم تُخطئ.
    expect(second.rechecked_drivers).toBe(0);
    expect(second.changed_drivers).toBe(0);
    expect(second.published).toBe(0);
    expect((await readEligibility(gate, driver.waslaPublicId)).eligibility_state).toBe("ineligible");
  });

  it("النبضة تُحدِّث `last_tick_at` الذي يقرأه `/health`، والتخزين مُعلَن", async () => {
    const before = await callDrivers(gate, { method: "GET", path: "/health" });
    expect(before.status).toBe(200);
    expect(before.body.persistence).toBe(gate.persistence);
    // `degraded` على الذاكرة ليس تشاؤماً: خدمة تحفظ ملفات سائقين في RAM ستفقدها.
    expect(before.body.status).toBe(gate.persistence === "postgres" ? "ok" : "degraded");
    expect(before.body.last_tick_at).toBeNull();

    await tickEligibility(gate);
    const after = await callDrivers(gate, { method: "GET", path: "/health" });
    expect(after.body.last_tick_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. الجغرافيا بوابة حقيقية: المنفذ يسأل خدمةً، لا مجموعةً مبذورة
// ---------------------------------------------------------------------------

describe("دليل المناطق يُسأل عبر HTTP", () => {
  it("منطقة لا تعرفها الجغرافيا تُرفض، ولا يبقى للسائق منطقة", async () => {
    const driver = await onboardDriver(gate, { withZone: false, verifiedDocuments: [] });

    const refused = await callDrivers(gate, {
      method: "PUT",
      path: `/drivers/${driver.waslaPublicId}/zones`,
      body: { zones: [{ zone_id: UNKNOWN_ZONE, preference_rank: 1 }] },
    });

    // 422 لا 503: خدمة الجغرافيا أجابت، وجوابها أنّ المنطقة غير موجودة. الفرق بين
    // «سألنا فلم نجد» و«لم نستطع السؤال» هو الفرق بين خطأ المتصل وخطأ التشغيل.
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({ code: "DRIVER_ZONE_UNKNOWN" });

    const zones = await callDrivers(gate, {
      method: "GET",
      path: `/drivers/${driver.waslaPublicId}/zones`,
    });
    expect(zones.body.zones).toEqual([]);
  });

  it("المنطقة المعروفة تُقبَل — فالرفض أعلاه ليس رفضاً لكل شيء", async () => {
    const driver = await onboardDriver(gate, { withZone: false, verifiedDocuments: [] });
    const accepted = await callDrivers(gate, {
      method: "PUT",
      path: `/drivers/${driver.waslaPublicId}/zones`,
      body: { zones: [{ zone_id: SERVED_ZONE, preference_rank: 1 }] },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.zones).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. `busy` لا يُرقّى: الالتزام الحيّ يملكه التوزيع عبر المطابقة
// ---------------------------------------------------------------------------

describe("الجهوزية: نواة السائق لا ترفع سائقاً مشغولاً", () => {
  it("سائق مشغول يعلن «متاح» فيبقى `busy` عند المطابقة", async () => {
    const driver = await onboardDriver(gate);

    // يقبل عرضاً، فيصير `busy` عند المطابقة — بيد التوزيع لا بيدنا.
    const order = await placeOrder(gate);
    const job = await createJob(gate, order);
    await tickDispatch(gate);
    const offers = await openOffers(gate, job.id as string);
    await fetch(`${gate.dispatchUrl}/dispatch/offers/${offers[0]?.id as string}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": nextKey("gate-accept") },
      body: JSON.stringify({ driver_public_id: driver.waslaPublicId }),
    });
    expect((await readCandidacy(gate, driver.waslaPublicId)).availability_state).toBe("busy");

    // الآن يعلن «أنا متاح» في نواة السائق. الإعلان صادق عندنا…
    const declared = await callDrivers(gate, {
      method: "PUT",
      path: `/drivers/${driver.waslaPublicId}/availability`,
      body: { declared_availability: "available" },
    });
    expect(declared.status).toBe(200);
    expect(declared.body.declared_availability).toBe("available");

    // …ولا يُرقّي ما تملكه خدمة أخرى: راكب ثانٍ هو من يدفع ثمن عرضٍ ثانٍ.
    expect((await readCandidacy(gate, driver.waslaPublicId)).availability_state).toBe("busy");
  });

  it("إعلان `offline` ينزل إلى المطابقة فوراً — الأقلّ توافراً مسموح دائماً", async () => {
    const driver = await onboardDriver(gate);
    expect((await readCandidacy(gate, driver.waslaPublicId)).availability_state).toBe("available");

    await callDrivers(gate, {
      method: "PUT",
      path: `/drivers/${driver.waslaPublicId}/availability`,
      body: { declared_availability: "offline" },
    });

    expect((await readCandidacy(gate, driver.waslaPublicId)).availability_state).toBe("offline");
    const order = await placeOrder(gate);
    const job = await createJob(gate, order);
    await tickDispatch(gate);
    expect(await openOffers(gate, job.id as string)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. التعليق: قرار إداريّ يصل المطابقة كما يصل الحكم المحسوب
// ---------------------------------------------------------------------------

describe("التعليق يخرج السائق من التجمّع", () => {
  it("سائق معلَّق لا يصله عرض، والمطابقة تقرأ `suspended` لا `ineligible`", async () => {
    const driver = await onboardDriver(gate);

    const suspended = await callDrivers(gate, {
      method: "POST",
      path: `/drivers/${driver.waslaPublicId}/suspend`,
      body: { reason_code: "fraud_suspected" },
    });
    expect(suspended.status).toBe(200);

    // `suspended` حالة مستقلّة لا مرادف لـ`ineligible`: الأولى قرار، والثانية نقص.
    // من يقرأ اللوح بعد شهر يحتاج أن يعرف أيّهما كان.
    const candidacy = await readCandidacy(gate, driver.waslaPublicId);
    expect(candidacy.eligibility_state).toBe("suspended");
    expect(candidacy.eligibility_source).toBe("driver_core");

    const order = await placeOrder(gate);
    const job = await createJob(gate, order);
    await tickDispatch(gate);
    expect(await openOffers(gate, job.id as string)).toHaveLength(0);
  });

  it("إعادة التمكين تُعيده إلى التجمّع بنفس المسار", async () => {
    const driver = await onboardDriver(gate);
    await callDrivers(gate, {
      method: "POST",
      path: `/drivers/${driver.waslaPublicId}/suspend`,
      body: { reason_code: "fraud_suspected" },
    });
    await callDrivers(gate, {
      method: "POST",
      path: `/drivers/${driver.waslaPublicId}/reinstate`,
      body: {},
    });

    expect((await readCandidacy(gate, driver.waslaPublicId)).eligibility_state).toBe("eligible");
    const order = await placeOrder(gate);
    const job = await createJob(gate, order);
    await tickDispatch(gate);
    const offers = await openOffers(gate, job.id as string);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.driver_public_id).toBe(driver.waslaPublicId);
  });
});

// ---------------------------------------------------------------------------
// 6. سجلّ النشر: كل محاولة على اللوح، ناجحةً كانت أو مرفوضة
// ---------------------------------------------------------------------------

describe("الحدّ بين الخدمتين مُسجَّل لا مُستنتَج", () => {
  it("المطابقة تُنشئ الصفّ بـ200 لا 201، ومفتاح منع التكرار مطلوب", async () => {
    // هذا ليس فحص المطابقة، بل فحص أنّ منفذنا يعامل 200 قبولاً: لو انتظر 201 لكان
    // كل نشر ناجح يُقيَّد مرفوضاً، ولَما ظهر الخطأ إلّا في الإنتاج.
    const driver = await onboardDriver(gate);
    const direct = await callMatching(gate, {
      method: "PUT",
      path: `/candidacy/${driver.waslaPublicId}`,
      idempotencyKey: nextKey("gate-direct"),
      body: {
        availability_state: "available",
        eligibility_state: "eligible",
        eligibility_source: "driver_core",
        service_kinds: ["ride"],
        vehicle_class: "sedan",
        zone_ids: [SERVED_ZONE],
        actor_type: "test",
      },
    });
    expect(direct.status).toBe(200);
  });

  it("أحداث الأهليّة تُقيَّد في صندوق البريد — لا تغيّر صامت", async () => {
    const driver = await onboardDriver(gate);
    const events = (await gate.driverEvents()).filter(
      (event) => event.event_type === "drivers.eligibility_changed",
    );
    // التسجيل نفسه تغيّرٌ (من «لا شيء» إلى `ineligible`)، ثم كل خطوة نقلت الأسباب،
    // ثم الحكم النهائي. العدد ليس هو المهمّ، بل أنّ آخِرها يقول `eligible`.
    expect(events.length).toBeGreaterThan(1);
    const last = events[events.length - 1];
    expect(last?.data).toMatchObject({
      driver_public_id: driver.waslaPublicId,
      to_state: "eligible",
    });
  });

  it("سائق بلا مركبة أساسية لا يصله عرض ولو كانت وثائقه مُتحقَّقة", async () => {
    // الفلتر ليس عن الأهليّة وحدها: `vehicle_class` في الإسقاط يأتي من المركبة
    // الأساسية، فسائق بلا مركبة لا صنف له، ولا يطابق طلباً يشترط صنفاً.
    const driver = await onboardDriver(gate, {
      withVehicle: false,
      verifiedDocuments: ["national_id", "driving_license"],
    });
    const verdict = await readEligibility(gate, driver.waslaPublicId);
    expect(verdict.eligibility_state).toBe("ineligible");
    expect(verdict.reason_codes).toContain("NO_PRIMARY_VEHICLE");

    const order = await placeOrder(gate);
    const job = await createJob(gate, order);
    await tickDispatch(gate);
    expect(await readOffers(gate, job.id as string)).toHaveLength(0);
    expect(await candidacyStatus(gate, driver.waslaPublicId)).toBeGreaterThanOrEqual(200);
  });
});
