/**
 * صياغةُ المُدَد وحسابُ الزمن: كلُّ حارسٍ ونقيضُه، وكلُّ حدٍّ عند الميلي-ثانية.
 *
 * المُدَدُ هي الحقيقةُ المخزَّنةُ الوحيدةُ في هذه الخدمة (القرار 2)، فخطأٌ في صياغةِ مدةٍ
 * ليس خطأً في عرضٍ بل خطأٌ في السجلّ نفسِه: يُقرأ بعد شهرٍ كأنّه قرارٌ صحيحٌ ولا يُكتشف إلّا
 * بشكوى سائق.
 */

import { describe, expect, it } from "vitest";

import { isSubscriptionError } from "../domain/errors.js";
import { draftPaymentPeriod, draftPeriod, draftTrialPeriod } from "../domain/periods.js";
import { LAUNCH_PLAN } from "../domain/plans.js";
import { addDays, assertTimestamp, fixedClock, isAtOrAfter, isBefore, laterOf, toEpochMillis } from "../domain/time.js";

const DRIVER = "WS-1000000001";
const NOW = "2026-03-01T00:00:00.000Z";

describe("مدةُ التجربة", () => {
  it("أيّامُها من نسخةِ الخطّة، تبدأ الآنَ وتنتهي بعد 14 يوماً، بلا مرجعِ دفع", () => {
    const draft = draftTrialPeriod({ driverPublicId: DRIVER, plan: LAUNCH_PLAN, now: NOW });
    expect(draft.source).toBe("trial");
    expect(draft.grantedDays).toBe(LAUNCH_PLAN.trialDays);
    expect(draft.startsAt).toBe(NOW);
    expect(draft.endsAt).toBe(addDays(NOW, LAUNCH_PLAN.trialDays));
    expect(draft.paymentReference).toBeNull();
    expect(draft.planVersion).toBe(LAUNCH_PLAN.planVersion);
  });

  it("والمسوّدةُ بلا مُعرّفٍ: المُعرّفُ تُنشئه القاعدةُ في 3/6", () => {
    const draft = draftTrialPeriod({ driverPublicId: DRIVER, plan: LAUNCH_PLAN, now: NOW });
    expect("periodId" in draft).toBe(false);
  });
});

describe("مدةٌ مدفوعة", () => {
  it("تحمل مرجعاً opaque واحداً وأيّامَ الدورةِ من الخطّة", () => {
    const draft = draftPaymentPeriod({
      driverPublicId: DRIVER,
      plan: LAUNCH_PLAN,
      paymentReference: "PAYREF-9",
      currentCoverageEnd: null,
      now: NOW,
    });
    expect(draft.source).toBe("payment");
    expect(draft.paymentReference).toBe("PAYREF-9");
    expect(draft.grantedDays).toBe(LAUNCH_PLAN.durationDays);
    expect(Object.keys(draft)).not.toContain("amount");
  });

  it("ودفعٌ بلا مرجعٍ يُرفض برمزٍ خاصٍّ به", () => {
    /**
     * النسخةُ الخاطئةُ الأرخص: قبولُ الدفعِ بمرجعٍ فارغ. تنجح النبضةُ وتُمنح ثلاثون يوماً،
     * ثم لا يوجد في الدفتر ما يُربط به سدادٌ عند أوّلِ مطابقةٍ مع مزوّدِ الدفع.
     */
    try {
      draftPeriod({
        driverPublicId: DRIVER,
        plan: LAUNCH_PLAN,
        source: "payment",
        grantedDays: 30,
        currentCoverageEnd: null,
        now: NOW,
      });
      throw new Error("قُبلت مدةُ دفعٍ بلا مرجع");
    } catch (error) {
      expect(isSubscriptionError(error)).toBe(true);
      expect((error as { code: string }).code).toBe("SUBSCRIPTION_PAYMENT_REFERENCE_REQUIRED");
      expect((error as { httpStatus: number }).httpStatus).toBe(422);
    }
  });

  it("ونقيضُه: مرجعُ دفعٍ على منحةٍ ليست دفعاً يُرفض كذلك", () => {
    for (const source of ["trial", "referral_reward"] as const) {
      expect(() =>
        draftPeriod({
          driverPublicId: DRIVER,
          plan: LAUNCH_PLAN,
          source,
          grantedDays: 10,
          paymentReference: "PAYREF-9",
          currentCoverageEnd: null,
          now: NOW,
        }),
      ).toThrowError(/حقل غير صالح/);
    }
  });
});

describe("عددُ الأيّامِ المُمنوحة", () => {
  it("يومٌ واحدٌ مقبولٌ، والصفرُ والسالبُ والكسرُ مرفوضة", () => {
    expect(
      draftPeriod({
        driverPublicId: DRIVER,
        plan: LAUNCH_PLAN,
        source: "referral_reward",
        grantedDays: 1,
        currentCoverageEnd: null,
        now: NOW,
      }).endsAt,
    ).toBe(addDays(NOW, 1));

    for (const days of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        draftPeriod({
          driverPublicId: DRIVER,
          plan: LAUNCH_PLAN,
          source: "referral_reward",
          grantedDays: days,
          currentCoverageEnd: null,
          now: NOW,
        }),
        String(days),
      ).toThrowError(/حقل غير صالح/);
    }
  });
});

describe("بدايةُ المدةِ الممتدّة", () => {
  it("تغطيةٌ سارية ⇒ البدايةُ نهايتُها لا الآن", () => {
    const coverageEnd = addDays(NOW, 12);
    const draft = draftPaymentPeriod({
      driverPublicId: DRIVER,
      plan: LAUNCH_PLAN,
      paymentReference: "PAYREF-1",
      currentCoverageEnd: coverageEnd,
      now: NOW,
    });
    expect(draft.startsAt).toBe(coverageEnd);
    expect(draft.endsAt).toBe(addDays(coverageEnd, 30));
  });

  it("وتغطيةٌ منقضية ⇒ البدايةُ الآنَ لا في الماضي", () => {
    // بدايةٌ في الماضي كانت ستبتلع أيّاماً انقضت بلا خدمةٍ وتُظهر تجديداً أقصرَ من المُعلَن.
    const draft = draftPaymentPeriod({
      driverPublicId: DRIVER,
      plan: LAUNCH_PLAN,
      paymentReference: "PAYREF-1",
      currentCoverageEnd: "2026-02-01T00:00:00.000Z",
      now: NOW,
    });
    expect(draft.startsAt).toBe(NOW);
  });

  it("وتغطيةٌ تنتهي الآنَ بالضبط ⇒ البدايةُ الآن، بلا ثقبٍ ولا تداخل", () => {
    const draft = draftPaymentPeriod({
      driverPublicId: DRIVER,
      plan: LAUNCH_PLAN,
      paymentReference: "PAYREF-1",
      currentCoverageEnd: NOW,
      now: NOW,
    });
    expect(draft.startsAt).toBe(NOW);
  });
});

describe("حسابُ الزمنِ نفسُه", () => {
  it("addDays يُضيف أيّاماً بالميلي-ثانيةِ ويرفض السالب", () => {
    expect(addDays(NOW, 0)).toBe(NOW);
    expect(addDays(NOW, 1)).toBe("2026-03-02T00:00:00.000Z");
    expect(addDays(NOW, 30)).toBe("2026-03-31T00:00:00.000Z");
    expect(() => addDays(NOW, -1)).toThrowError(/حقل غير صالح/);
  });

  it("ولا يتأثّر بتغيّرِ التوقيتِ الصيفيِّ ولا بطولِ الشهر", () => {
    /**
     * حسابٌ تقويميٌّ (`setMonth(+1)`) كان سيُنتج مدداً بطولٍ مختلفٍ لسائقَين اشتركا في
     * شهرَين مختلفَين — فبراير 28 مقابل مارس 31 — ثم يُشرح الفرقُ بعد شهرَين بلا سجل.
     * ثلاثون يوماً هي ثلاثون يوماً في كلّ مرّة.
     */
    const feb = addDays("2026-02-01T00:00:00.000Z", 30);
    const mar = addDays("2026-03-01T00:00:00.000Z", 30);
    expect(Date.parse(feb) - Date.parse("2026-02-01T00:00:00.000Z")).toBe(
      Date.parse(mar) - Date.parse("2026-03-01T00:00:00.000Z"),
    );
  });

  it("والمقارناتُ تعرف الحدَّ نصفَ المفتوح", () => {
    expect(isBefore(NOW, addDays(NOW, 1))).toBe(true);
    expect(isBefore(NOW, NOW)).toBe(false);
    expect(isAtOrAfter(NOW, NOW)).toBe(true);
    expect(isAtOrAfter(addDays(NOW, 1), NOW)).toBe(true);
    expect(isAtOrAfter(NOW, addDays(NOW, 1))).toBe(false);
  });

  it("وlaterOf تُعيد الأبعدَ ولا تتأثّر بترتيبِ الوسيطَين", () => {
    const later = addDays(NOW, 5);
    expect(laterOf(NOW, later)).toBe(later);
    expect(laterOf(later, NOW)).toBe(later);
    expect(laterOf(NOW, NOW)).toBe(NOW);
  });

  it("وكلُّ لحظةٍ تُتحقّق: نصٌّ ليس ISO يُرفض ولا يُصير NaN", () => {
    for (const bad of ["", "2026-13-01T00:00:00.000Z", "غداً", "1772000000000"]) {
      expect(() => assertTimestamp(bad, "now"), bad).toThrowError(/حقل غير صالح/);
    }
    expect(assertTimestamp(NOW, "now")).toBe(NOW);
    expect(toEpochMillis(NOW)).toBe(Date.parse(NOW));
  });

  it("والساعةُ المحقونةُ ثابتةٌ: نداءان يُعطيان نفسَ اللحظة", () => {
    // هذا هو بديلُ `Date.now()` المُعلَن: الزمنُ مُدخلٌ يُختبَر لا مصدرٌ خفيٌّ يُقرأ.
    const clock = fixedClock(NOW);
    expect(clock.now()).toBe(NOW);
    expect(clock.now()).toBe(clock.now());
  });
});
