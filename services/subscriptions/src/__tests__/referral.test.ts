/**
 * الإحالة: كلُّ سببِ رفضٍ **مُختبَرٌ منفرداً**، وترتيبُ الفحصِ مُثبَتٌ بحالةٍ يتصادم فيها سببان.
 *
 * والنقيضُ في كلّ مرّة: مُدخلٌ يختلف في شرطٍ واحدٍ فقط ويُنتج `qualified`. لأنّ اختباراً
 * يُثبت الرفضَ وحدَه يمرّ على دالّةٍ ترفض كلَّ شيء — وهي كارثةٌ أهدأُ من القبول العامّ لأنّها
 * تظهر كـ«لا أحد يُحيل أحداً» لا كخطأ.
 */

import { describe, expect, it } from "vitest";

import { REFERRAL_REJECTION_REASONS } from "../domain/contract-sets.js";
import { LAUNCH_PLAN } from "../domain/plans.js";
import {
  REFERRAL_REJECTION_ORDER,
  applyReferralReward,
  qualifyReferral,
  referralWindowEnd,
  rejectionOrderMatchesContract,
} from "../domain/referral.js";
import { addDays } from "../domain/time.js";
import type { Referral } from "../domain/model.js";

const REFERRER = "WS-1000000001";
const REFEREE = "WS-1000000002";
const CLAIMED_AT = "2026-03-01T00:00:00.000Z";
const NOW = "2026-03-10T00:00:00.000Z";
const WINDOW_END = addDays(CLAIMED_AT, LAUNCH_PLAN.referralWindowDays);

/** مُدخلٌ يتأهّل، ليُشتقّ منه كلُّ نقيضٍ بتغييرِ شرطٍ واحد. */
function qualifyingInput() {
  return {
    referrerPublicId: REFERRER,
    refereePublicId: REFEREE,
    referrerState: "active" as const,
    evidence: {
      qualifyingFactCount: LAUNCH_PLAN.referralQualifyingFacts,
      hasActivatedPaidPeriod: true,
      alreadyReferredByAnother: false,
    },
    windowEndsAt: WINDOW_END,
    plan: LAUNCH_PLAN,
    now: NOW,
  };
}

function referral(overrides: Partial<Referral> = {}): Referral {
  return {
    referralId: "44444444-4444-4444-8444-444444444444",
    referralCode: "WR-ABCD1234",
    referrerPublicId: REFERRER,
    refereePublicId: REFEREE,
    state: "qualified",
    reasonCode: null,
    qualifyingFactCount: LAUNCH_PLAN.referralQualifyingFacts,
    windowEndsAt: WINDOW_END,
    ...overrides,
  };
}

describe("التأهيلُ الموجَب", () => {
  it("مُحيلٌ active ومُحال إليه دفع وبلغ العتبةَ داخلَ النافذة ⇒ qualified بلا سبب", () => {
    const judgement = qualifyReferral(qualifyingInput());
    expect(judgement.state).toBe("qualified");
    expect(judgement.reasonCode).toBeNull();
    expect(judgement.qualifyingFactCount).toBe(LAUNCH_PLAN.referralQualifyingFacts);
    expect(judgement.judgedAt).toBe(NOW);
  });

  it("والعتبةُ حدٌّ داخلٌ: مساواتُها تكفي وما تحتَها بواحدٍ يُرفض", () => {
    const atThreshold = qualifyReferral(qualifyingInput());
    expect(atThreshold.state).toBe("qualified");

    const input = qualifyingInput();
    const below = qualifyReferral({
      ...input,
      evidence: { ...input.evidence, qualifyingFactCount: LAUNCH_PLAN.referralQualifyingFacts - 1 },
    });
    expect(below.state).toBe("rejected");
    expect(below.reasonCode).toBe("referee_no_qualifying_facts");
  });
});

describe("أسبابُ الرفضِ الستّة، كلٌّ بمُدخلٍ يختلف في شرطٍ واحد", () => {
  it("self_referral", () => {
    const judged = qualifyReferral({ ...qualifyingInput(), refereePublicId: REFERRER });
    expect(judged.reasonCode).toBe("self_referral");
  });

  it("referee_already_referred", () => {
    const input = qualifyingInput();
    const judged = qualifyReferral({
      ...input,
      evidence: { ...input.evidence, alreadyReferredByAnother: true },
    });
    expect(judged.reasonCode).toBe("referee_already_referred");
  });

  it("referral_window_expired — والحدُّ نفسُه منقضٍ لا سارٍ", () => {
    // نهايةُ النافذةِ خارجةٌ منها، كما في كلّ حدودِ هذا المجال.
    expect(qualifyReferral({ ...qualifyingInput(), now: WINDOW_END }).reasonCode).toBe(
      "referral_window_expired",
    );
    const justBefore = new Date(Date.parse(WINDOW_END) - 1).toISOString();
    expect(qualifyReferral({ ...qualifyingInput(), now: justBefore }).state).toBe("qualified");
  });

  it("referrer_not_active — وتجربةُ المُحيلِ لا تكفي", () => {
    /**
     * النسخةُ الخاطئةُ الأرخص: قبولُ مُحيلٍ في `trial`. يجمع مكافآتَ إحالاتٍ ثم يخرج بلا
     * أن يدفع ريالاً واحداً، ويصير بابُ الحسابات الوهميّة مفتوحاً من داخل القاعدة نفسِها.
     */
    for (const state of ["trial", "expired", "community", null] as const) {
      expect(
        qualifyReferral({ ...qualifyingInput(), referrerState: state }).reasonCode,
        String(state),
      ).toBe("referrer_not_active");
    }
  });

  it("referee_subscription_never_activated", () => {
    const input = qualifyingInput();
    const judged = qualifyReferral({
      ...input,
      evidence: { ...input.evidence, hasActivatedPaidPeriod: false },
    });
    expect(judged.reasonCode).toBe("referee_subscription_never_activated");
  });

  it("referee_no_qualifying_facts — وصفرُ وقائعَ لا يُقبل بحال", () => {
    const input = qualifyingInput();
    const judged = qualifyReferral({
      ...input,
      evidence: { ...input.evidence, qualifyingFactCount: 0 },
    });
    expect(judged.reasonCode).toBe("referee_no_qualifying_facts");
  });

  it("والأسبابُ الستّةُ هي أسبابُ العقدِ بحرفها", () => {
    expect([...REFERRAL_REJECTION_ORDER].sort()).toEqual([...REFERRAL_REJECTION_REASONS].sort());
    expect(rejectionOrderMatchesContract()).toBe(true);
  });
});

describe("ترتيبُ الفحصِ مُعلَنٌ ومستقرّ", () => {
  it("إحالةٌ ذاتيةٌ بنافذةٍ منقضيةٍ تُعطي self_referral لا انقضاءَ نافذة", () => {
    /**
     * لو تغيّر الترتيبُ لأعطت نفسُ الإحالةِ سببَين في وقتَين، ولصار قياسُ «كم إحالةً
     * رُفضت لأنّها ذاتية» مستحيلاً.
     */
    const judged = qualifyReferral({
      ...qualifyingInput(),
      refereePublicId: REFERRER,
      now: addDays(WINDOW_END, 5),
    });
    expect(judged.reasonCode).toBe("self_referral");
  });

  it("ونافذةٌ منقضيةٌ لمُحيلٍ غيرِ نشطٍ تُعطي انقضاءَ النافذة — الأثبتُ قبل المتقلّب", () => {
    const judged = qualifyReferral({
      ...qualifyingInput(),
      referrerState: "expired",
      now: addDays(WINDOW_END, 1),
    });
    expect(judged.reasonCode).toBe("referral_window_expired");
  });

  it("ومُحيلٌ غيرُ نشطٍ لمُحال إليه بلا وقائعَ يُعطي حالةَ المُحيل", () => {
    const input = qualifyingInput();
    const judged = qualifyReferral({
      ...input,
      referrerState: "trial",
      evidence: { ...input.evidence, qualifyingFactCount: 0 },
    });
    expect(judged.reasonCode).toBe("referrer_not_active");
  });
});

describe("نافذةُ الإحالة", () => {
  it("تُحسب من لحظةِ المطالبةِ وأيّامِ النافذةِ في نسخةِ الخطّة", () => {
    expect(referralWindowEnd(CLAIMED_AT, LAUNCH_PLAN)).toBe(addDays(CLAIMED_AT, 30));
  });
});

describe("المكافأةُ مدةٌ لا رصيد (القرار 9)", () => {
  it("تُنتج مدةً مصدرُها referral_reward بأيّامِ الخطّةِ وبلا مرجعِ دفع", () => {
    const draft = applyReferralReward({
      referral: referral(),
      plan: LAUNCH_PLAN,
      currentCoverageEnd: null,
      now: NOW,
    });
    expect(draft.rewardDays).toBe(LAUNCH_PLAN.referralRewardDays);
    expect(draft.period.source).toBe("referral_reward");
    expect(draft.period.paymentReference).toBeNull();
    expect(draft.period.grantedDays).toBe(30);
    expect(draft.period.startsAt).toBe(NOW);
    expect(draft.period.endsAt).toBe(addDays(NOW, 30));
    // المُستفيدُ هو **المُحيل** لا المُحال إليه: هذه هي المكافأةُ المُعلَنة في ADR-015.
    expect(draft.period.driverPublicId).toBe(REFERRER);
  });

  it("وتمتدّ من نهايةِ التغطيةِ القائمةِ فلا تحرق ما دُفع ثمنُه", () => {
    const coverageEnd = addDays(NOW, 20);
    const draft = applyReferralReward({
      referral: referral(),
      plan: LAUNCH_PLAN,
      currentCoverageEnd: coverageEnd,
      now: NOW,
    });
    expect(draft.period.startsAt).toBe(coverageEnd);
    expect(draft.period.endsAt).toBe(addDays(coverageEnd, 30));
  });

  it("ونقيضُه: تغطيةٌ منقضيةٌ تجعل البدايةَ الآنَ لا الماضي", () => {
    const draft = applyReferralReward({
      referral: referral(),
      plan: LAUNCH_PLAN,
      currentCoverageEnd: "2026-03-05T00:00:00.000Z",
      now: NOW,
    });
    expect(draft.period.startsAt).toBe(NOW);
  });

  it("ولا مكافأةَ ثانيةً لنفس الإحالة", () => {
    expect(() =>
      applyReferralReward({
        referral: referral({ state: "rewarded" }),
        plan: LAUNCH_PLAN,
        currentCoverageEnd: null,
        now: NOW,
      }),
    ).toThrowError(/مكافأة هذه الإحالة مُنحت/);
  });

  it("ولا مكافأةَ لإحالةٍ لم تتأهّل أو رُفضت", () => {
    for (const state of ["pending", "rejected"] as const) {
      expect(() =>
        applyReferralReward({
          referral: referral({ state }),
          plan: LAUNCH_PLAN,
          currentCoverageEnd: null,
          now: NOW,
        }),
      ).toThrowError(/الإحالة لم تتأهل/);
    }
  });
});
