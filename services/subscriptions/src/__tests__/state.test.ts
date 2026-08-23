/**
 * اشتقاقُ الحالة: كلُّ حالةٍ **ونقيضُها**، وكلُّ حدٍّ من الجانبَين.
 *
 * القاعدةُ التي تحكم هذا الملف (HANDOFF §16-ب): لا يُقبل اختبارٌ يُثبت أنّ شيئاً يعمل بلا
 * اختبارٍ يُثبت أنّ نقيضَه **يُرفَض** أو يُعطي حالةً أخرى. لأنّ اختباراً موجَباً وحدَه يمرّ
 * على دالّةٍ تُعيد `"active"` دائماً.
 *
 * والحدودُ تُختبَر عند الميلي-ثانية لا «قريباً منها»: `[starts_at, ends_at)` نصفُ مفتوح،
 * فالنهايةُ خارجةٌ والبدايةُ داخلة. واختبارٌ يفحص «بعد يومٍ من النهاية» يمرّ على تنفيذٍ
 * يخطئ في الحدّ بميلي-ثانيةٍ واحدة — وهذا بالضبط ما يجعل سائقاً يشتكي مرّةً في الشهر.
 */

import { describe, expect, it } from "vitest";

import { LAUNCH_PLAN } from "../domain/plans.js";
import { coverageRuns, currentCoverageEnd, deriveState } from "../domain/state.js";
import { addDays } from "../domain/time.js";
import type { Period, PlanVersion } from "../domain/model.js";

const DRIVER = "WS-1000000001";
const T0 = "2026-03-01T00:00:00.000Z";

function period(overrides: Partial<Period> & Pick<Period, "startsAt" | "endsAt">): Period {
  return {
    periodId: overrides.periodId ?? "11111111-1111-4111-8111-111111111111",
    driverPublicId: DRIVER,
    planCode: LAUNCH_PLAN.planCode,
    planVersion: LAUNCH_PLAN.planVersion,
    source: "payment",
    paymentReference: "PR-1",
    grantedDays: 30,
    ...overrides,
  };
}

function trial(startsAt: string, days = LAUNCH_PLAN.trialDays): Period {
  return period({
    periodId: "22222222-2222-4222-8222-222222222222",
    source: "trial",
    paymentReference: null,
    grantedDays: days,
    startsAt,
    endsAt: addDays(startsAt, days),
  });
}

function paid(startsAt: string, days = LAUNCH_PLAN.durationDays): Period {
  return period({ startsAt, endsAt: addDays(startsAt, days), grantedDays: days });
}

function reward(startsAt: string, days = LAUNCH_PLAN.referralRewardDays): Period {
  return period({
    periodId: "33333333-3333-4333-8333-333333333333",
    source: "referral_reward",
    paymentReference: null,
    grantedDays: days,
    startsAt,
    endsAt: addDays(startsAt, days),
  });
}

describe("لا اشتراكَ أصلاً", () => {
  it("دفترٌ فارغٌ يُعطي null لا expired", () => {
    // النقيضُ المهمّ: سائقٌ لم يبدأ تجربتَه لم ينقضِ عنه شيء. لو أعادت الدالّةُ
    // `expired` لصار البوتُ يقول «انقضى اشتراكك» لمن لم يشترك قطُّ.
    expect(deriveState([], LAUNCH_PLAN, T0)).toBeNull();
  });

  it("ولحظةٌ قبل أوّلِ مدةٍ تُرفض ولا تُخمَّن", () => {
    expect(() => deriveState([trial(T0)], LAUNCH_PLAN, "2026-02-28T23:59:59.999Z")).toThrowError(
      /SUBSCRIPTION_VALIDATION_FAILED|حقل غير صالح/,
    );
  });
});

describe("trial", () => {
  it("مدةُ تجربةٍ تُغطّي الآن ⇒ trial لا active", () => {
    const derived = deriveState([trial(T0)], LAUNCH_PLAN, "2026-03-05T00:00:00.000Z")!;
    expect(derived.state).toBe("trial");
    expect(derived.expiresAt).toBe(addDays(T0, 14));
    expect(derived.stateStartedAt).toBe(T0);
    expect(derived.coverageEndedAt).toBeNull();
  });

  it("الحدُّ الأوّل داخلٌ: لحظةُ البدايةِ نفسُها trial", () => {
    expect(deriveState([trial(T0)], LAUNCH_PLAN, T0)!.state).toBe("trial");
  });

  it("والحدُّ الآخر خارجٌ: لحظةُ النهايةِ نفسُها ليست trial", () => {
    // نقيضُ الحدّ. مدةٌ تنتهي في T لا تُغطّي T، وإلّا كان لكلّ سائقٍ ميلي-ثانيةٌ إضافيّة
    // مملوكةٌ لمدّتَين، ويقرّر ترتيبُ الفرز حالتَه.
    const end = addDays(T0, 14);
    const derived = deriveState([trial(T0)], LAUNCH_PLAN, end)!;
    expect(derived.state).not.toBe("trial");
    expect(derived.state).toBe("expired");
  });

  it("وقبل النهايةِ بميلي-ثانيةٍ واحدةٍ ما زال trial", () => {
    const justBefore = new Date(Date.parse(addDays(T0, 14)) - 1).toISOString();
    expect(deriveState([trial(T0)], LAUNCH_PLAN, justBefore)!.state).toBe("trial");
  });
});

describe("active", () => {
  it("مدةٌ مدفوعةٌ تُغطّي الآن ⇒ active", () => {
    const derived = deriveState([paid(T0)], LAUNCH_PLAN, "2026-03-10T00:00:00.000Z")!;
    expect(derived.state).toBe("active");
    expect(derived.expiresAt).toBe(addDays(T0, 30));
  });

  it("ومدةُ مكافأةٍ وحدَها تُغطّي الآن ⇒ active أيضاً لا trial", () => {
    expect(deriveState([reward(T0)], LAUNCH_PLAN, "2026-03-02T00:00:00.000Z")!.state).toBe("active");
  });

  it("دفعٌ داخلَ التجربة ⇒ active، ولا يقرّر ترتيبُ الفرز", () => {
    const periods = [trial(T0), paid("2026-03-05T00:00:00.000Z")];
    const forward = deriveState(periods, LAUNCH_PLAN, "2026-03-06T00:00:00.000Z")!;
    const reversed = deriveState([...periods].reverse(), LAUNCH_PLAN, "2026-03-06T00:00:00.000Z")!;
    expect(forward.state).toBe("active");
    expect(reversed).toEqual(forward);
  });

  it("التجديدُ يُمدّ نفسَ السلسلةِ ولا يفتح حالةً ثانية (القرار 3)", () => {
    // ثلاثُ مُدَدٍ متلاصقةٍ = سلسلةٌ واحدةٌ = حالةٌ واحدةٌ تنتهي في آخرِ نهاية. وهذا هو
    // سببُ غيابِ `active → active` من الجدول: لا حدثَ هنا يستحقّ صفَّ انتقال.
    const chain = [paid(T0), paid(addDays(T0, 30)), paid(addDays(T0, 60))];
    const derived = deriveState(chain, LAUNCH_PLAN, addDays(T0, 61))!;
    expect(derived.state).toBe("active");
    expect(derived.expiresAt).toBe(addDays(T0, 90));
    expect(derived.stateStartedAt).toBe(T0);
    expect(coverageRuns(chain)).toHaveLength(1);
  });

  it("ونقيضُه: فراغٌ بين مدّتَين يفصل سلسلتَين", () => {
    const gapped = [paid(T0), paid(addDays(T0, 40))];
    expect(coverageRuns(gapped)).toHaveLength(2);
  });
});

describe("expired ثم community", () => {
  const start = T0;
  const coverageEnd = addDays(start, 30);

  it("بعد النهايةِ وقبل انتهاءِ المهلة ⇒ expired", () => {
    const derived = deriveState([paid(start)], LAUNCH_PLAN, addDays(coverageEnd, 3))!;
    expect(derived.state).toBe("expired");
    expect(derived.expiresAt).toBeNull();
    expect(derived.coverageEndedAt).toBe(coverageEnd);
    expect(derived.stateStartedAt).toBe(coverageEnd);
  });

  it("وعند آخرِ ميلي-ثانيةٍ من المهلة ما زال expired", () => {
    const justBefore = new Date(Date.parse(addDays(coverageEnd, 7)) - 1).toISOString();
    expect(deriveState([paid(start)], LAUNCH_PLAN, justBefore)!.state).toBe("expired");
  });

  it("وعند نهايةِ المهلةِ بالضبط ⇒ community", () => {
    const graceEnd = addDays(coverageEnd, 7);
    const derived = deriveState([paid(start)], LAUNCH_PLAN, graceEnd)!;
    expect(derived.state).toBe("community");
    expect(derived.stateStartedAt).toBe(graceEnd);
    expect(derived.expiresAt).toBeNull();
  });

  it("وتبقى community بلا نهايةٍ: أرضيّةٌ لا مرحلةٌ عابرة", () => {
    expect(deriveState([paid(start)], LAUNCH_PLAN, addDays(coverageEnd, 400))!.state).toBe(
      "community",
    );
  });

  it("مهلةٌ صفرٌ تُنزل فوراً بلا مرحلةٍ وسطى", () => {
    const noGrace: PlanVersion = { ...LAUNCH_PLAN, communityGraceDays: 0 };
    expect(deriveState([paid(start)], noGrace, coverageEnd)!.state).toBe("community");
    // ونقيضُه: بميلي-ثانيةٍ قبل النهاية ما زال active لا community.
    const justBefore = new Date(Date.parse(coverageEnd) - 1).toISOString();
    expect(deriveState([paid(start)], noGrace, justBefore)!.state).toBe("active");
  });

  it("والمهلةُ تُقاس من آخرِ نهايةٍ مضت لا من أبعدِ نهايةٍ في الدفتر", () => {
    /**
     * دفترٌ فيه مدةٌ مستقبليّةٌ مُجدولة: القياسُ من نهايتها كان سيجعل سائقاً بلا تغطيةٍ
     * اليومَ يبدو في مهلةٍ لم تبدأ بعد، فيُخاطبه البوتُ برسالةِ تجديدٍ بعد شهر.
     */
    const periods = [paid(start), paid(addDays(start, 60))];
    const derived = deriveState(periods, LAUNCH_PLAN, addDays(coverageEnd, 10))!;
    expect(derived.state).toBe("community");
    expect(derived.coverageEndedAt).toBe(coverageEnd);
  });

  it("تجربةٌ انقضت بلا دفعٍ تسلك نفسَ الطريق: expired ثم community", () => {
    const trialEnd = addDays(start, 14);
    expect(deriveState([trial(start)], LAUNCH_PLAN, addDays(trialEnd, 1))!.state).toBe("expired");
    expect(deriveState([trial(start)], LAUNCH_PLAN, addDays(trialEnd, 7))!.state).toBe("community");
  });

  it("وعودةُ الدفعِ بعد الأرضيّةِ تُعيد active", () => {
    const revived = [paid(start), paid(addDays(start, 100))];
    expect(deriveState(revived, LAUNCH_PLAN, addDays(start, 101))!.state).toBe("active");
  });
});

describe("نسخةُ الخطّةِ الحاكمة", () => {
  it("تُقرأ من المدةِ نفسِها وتُرفض نسخةٌ لا تطابقها", () => {
    const otherVersion: PlanVersion = { ...LAUNCH_PLAN, planVersion: 2 };
    expect(() => deriveState([paid(T0)], otherVersion, addDays(T0, 1))).toThrowError(
      /حقل غير صالح/,
    );
  });

  it("وتظهر في المخرَجِ مع كلّ حالة، لا في التغطيةِ وحدها", () => {
    for (const now of [addDays(T0, 1), addDays(T0, 31), addDays(T0, 40)]) {
      const derived = deriveState([paid(T0)], LAUNCH_PLAN, now)!;
      expect(derived.planVersion).toBe(LAUNCH_PLAN.planVersion);
      expect(derived.planCode).toBe(LAUNCH_PLAN.planCode);
    }
  });
});

describe("مُدخلاتٌ مرفوضة", () => {
  it("مدةٌ نهايتُها قبل بدايتِها أو مساويةٌ لها", () => {
    expect(() => deriveState([period({ startsAt: T0, endsAt: T0 })], LAUNCH_PLAN, T0)).toThrowError(
      /حقل غير صالح/,
    );
    expect(() =>
      deriveState([period({ startsAt: addDays(T0, 2), endsAt: T0 })], LAUNCH_PLAN, T0),
    ).toThrowError(/حقل غير صالح/);
  });

  it("ولحظةٌ ليست ISO", () => {
    expect(() => deriveState([paid(T0)], LAUNCH_PLAN, "أمس")).toThrowError(/حقل غير صالح/);
  });
});

describe("نهايةُ التغطيةِ لبدءِ مدةٍ ممتدّة", () => {
  it("تُعيد آخرَ نهايةٍ في الدفتر، وnull لدفترٍ فارغ", () => {
    expect(currentCoverageEnd([])).toBeNull();
    expect(currentCoverageEnd([paid(T0), paid(addDays(T0, 30))])).toBe(addDays(T0, 60));
  });
});
