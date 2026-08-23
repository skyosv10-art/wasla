/**
 * الخطّةُ المُجمَّدةُ والاستحقاقاتُ: الأرقامُ من العقدِ حرفياً، والتجميدُ مُختبَرٌ بمحاولةِ تعديلٍ فعليّة.
 *
 * لِمَ لا يكفي وصفُ الخطّةِ بـ«مُجمَّدة» في الشرح؟ لأنّ `readonly` في TypeScript يختفي عند
 * التصريف؛ فمُنادٍ يكتب `plan.durationDays = 45` من JavaScript يمرّ صامتاً، وتُصبح مدّةُ
 * كلّ من اشترك بعده مختلفةً عن مدّةِ من قبله بلا صفٍّ واحدٍ في الدفتر يشرح السبب.
 */

import { describe, expect, it } from "vitest";

import {
  SUBSCRIPTION_COMMUNITY_FLOOR_ENTITLEMENTS,
  SUBSCRIPTION_ENTITLEMENTS,
  SUBSCRIPTION_LAUNCH_COMMUNITY_DAILY_ORDER_CAP,
  SUBSCRIPTION_LAUNCH_PLAN_CODE,
  SUBSCRIPTION_PAID_ONLY_ENTITLEMENTS,
} from "@wasla/contracts-subscription";
import {
  REFERRAL_QUALIFYING_FACT_COUNT,
  REFERRAL_REWARD_DAYS,
  REFERRAL_WINDOW_DAYS,
  SUBSCRIPTION_LAUNCH_COMMUNITY_GRACE_DAYS,
  SUBSCRIPTION_LAUNCH_DURATION_DAYS,
  SUBSCRIPTION_LAUNCH_PLAN_VERSION,
  SUBSCRIPTION_LAUNCH_TRIAL_DAYS,
} from "@wasla/contracts-subscription";
import { FLOOR_STATES, effectiveEntitlements, isPaidOnlyEntitlement } from "../domain/entitlements.js";
import { isSubscriptionError } from "../domain/errors.js";
import { LAUNCH_PLAN, PLAN_CATALOG, findPlanVersion, requireGrantablePlan } from "../domain/plans.js";
import type { PlanVersion } from "../domain/model.js";

describe("بذرةُ الخطّةِ تطابق العقدَ حرفياً", () => {
  it("كلُّ رقمٍ في الخطّةِ مأخوذٌ من ثابتِ العقدِ لا مكتوبٌ بيد", () => {
    expect(LAUNCH_PLAN.planCode).toBe(SUBSCRIPTION_LAUNCH_PLAN_CODE);
    expect(LAUNCH_PLAN.planVersion).toBe(SUBSCRIPTION_LAUNCH_PLAN_VERSION);
    expect(LAUNCH_PLAN.trialDays).toBe(SUBSCRIPTION_LAUNCH_TRIAL_DAYS);
    expect(LAUNCH_PLAN.durationDays).toBe(SUBSCRIPTION_LAUNCH_DURATION_DAYS);
    expect(LAUNCH_PLAN.communityGraceDays).toBe(SUBSCRIPTION_LAUNCH_COMMUNITY_GRACE_DAYS);
    expect(LAUNCH_PLAN.communityDailyOrderCap).toBe(SUBSCRIPTION_LAUNCH_COMMUNITY_DAILY_ORDER_CAP);
    expect(LAUNCH_PLAN.referralRewardDays).toBe(REFERRAL_REWARD_DAYS);
    expect(LAUNCH_PLAN.referralWindowDays).toBe(REFERRAL_WINDOW_DAYS);
    expect(LAUNCH_PLAN.referralQualifyingFacts).toBe(REFERRAL_QUALIFYING_FACT_COUNT);
    expect(LAUNCH_PLAN.isFrozen).toBe(true);
  });

  it("ولا حقلَ مالٍ في الخطّةِ ولو واحداً (القرار 6)", () => {
    // الحارسُ النصّيُّ يمنع الكلمةَ في المصدر؛ وهذا يمنع الحقلَ في الكائنِ المُصدَّر نفسِه.
    expect(Object.keys(LAUNCH_PLAN).sort()).toEqual([
      "communityDailyOrderCap",
      "communityGraceDays",
      "durationDays",
      "entitlements",
      "isFrozen",
      "label",
      "planCode",
      "planVersion",
      "referralQualifyingFacts",
      "referralRewardDays",
      "referralWindowDays",
      "trialDays",
    ]);
  });

  it("والاستحقاقاتُ الأربعةُ كلُّها موجودةٌ بترتيبِ العقد", () => {
    expect(LAUNCH_PLAN.entitlements.map((entitlement) => entitlement.entitlementCode)).toEqual([
      ...SUBSCRIPTION_ENTITLEMENTS,
    ]);
  });
});

describe("التجميدُ فعليٌّ لا موصوف", () => {
  it("تعديلُ حقلٍ في الخطّةِ يفشل", () => {
    expect(() => {
      (LAUNCH_PLAN as unknown as { durationDays: number }).durationDays = 45;
    }).toThrow();
    expect(LAUNCH_PLAN.durationDays).toBe(SUBSCRIPTION_LAUNCH_DURATION_DAYS);
  });

  it("والتجميدُ عميقٌ: قائمةُ الاستحقاقاتِ وعناصرُها كذلك", () => {
    expect(() => {
      (LAUNCH_PLAN.entitlements as Array<unknown>).push({});
    }).toThrow();
    expect(() => {
      (LAUNCH_PLAN.entitlements[0] as { limitValue: number }).limitValue = 99;
    }).toThrow();
    expect(() => {
      (PLAN_CATALOG as Array<unknown>).push({});
    }).toThrow();
  });
});

describe("البحثُ عن نسخةِ خطّة", () => {
  it("يُطابق الرمزَ والنسخةَ معاً لا الرمزَ وحده", () => {
    expect(findPlanVersion(SUBSCRIPTION_LAUNCH_PLAN_CODE, SUBSCRIPTION_LAUNCH_PLAN_VERSION)).toBe(
      LAUNCH_PLAN,
    );
    // نقيضُ الأهمّية: نسخةٌ لاحقةٌ لنفس الرمزِ ليست الخطّةَ نفسَها، وإلّا صار كلُّ سائقٍ
    // يقرأ أرقامَ آخرِ نسخةٍ لا أرقامَ النسخةِ التي اشترك عليها.
    expect(findPlanVersion(SUBSCRIPTION_LAUNCH_PLAN_CODE, SUBSCRIPTION_LAUNCH_PLAN_VERSION + 1)).toBeUndefined();
    expect(findPlanVersion("ghost-plan", SUBSCRIPTION_LAUNCH_PLAN_VERSION)).toBeUndefined();
  });

  it("والمنحُ يميّز «غير موجود» (404) من «غير مُجمَّدة» (422)", () => {
    /**
     * رمزان لا رمزٌ واحد: خطّةٌ لا وجودَ لها خطأُ مُنادٍ يُصلحه بتصحيح الرمز، وخطّةٌ موجودةٌ
     * غيرُ مُجمَّدةٍ خطأُ حالةٍ في الكتالوج لا يُصلحه المُنادي أبداً. دمجُهما في 400 واحدٍ
     * يجعل الدعمَ يطلب من السائقِ «حاول مرّةً أخرى» في حالةٍ لن تتغيّر بالمحاولة.
     */
    try {
      requireGrantablePlan("ghost-plan", 1);
      throw new Error("قُبلت خطّةٌ لا وجودَ لها");
    } catch (error) {
      expect(isSubscriptionError(error)).toBe(true);
      expect((error as { code: string; httpStatus: number }).code).toBe("SUBSCRIPTION_PLAN_NOT_FOUND");
      expect((error as { httpStatus: number }).httpStatus).toBe(404);
    }
    expect(requireGrantablePlan(SUBSCRIPTION_LAUNCH_PLAN_CODE, SUBSCRIPTION_LAUNCH_PLAN_VERSION)).toBe(
      LAUNCH_PLAN,
    );
  });
});

describe("الاستحقاقاتُ الفعليّةُ لكلّ حالة", () => {
  it("trial وactive تُعطيان الحزمةَ كاملةً — التجربةُ تجربةٌ حقيقيّة", () => {
    for (const state of ["trial", "active"] as const) {
      const codes = effectiveEntitlements(LAUNCH_PLAN, state).map((e) => e.entitlementCode);
      expect(codes, state).toEqual([...SUBSCRIPTION_ENTITLEMENTS]);
    }
  });

  it("expired وcommunity تشتركان في الأرضيّةِ نفسِها", () => {
    /**
     * قرارُ الملحق (المراجعة 2/6): المهلةُ نافذةُ **تذكيرٍ** لا نافذةُ امتياز. لو أعطت
     * `expired` حزمةً أكملَ من `community` لصار الأرخصُ للسائقِ أن يبقى في المهلةِ وينتظر،
     * ولصارت المهلةُ منتَجاً مجانيّاً مدّتُه سبعةُ أيامٍ متجدّدة.
     */
    expect([...FLOOR_STATES].sort()).toEqual(["community", "expired"]);
    const expired = effectiveEntitlements(LAUNCH_PLAN, "expired");
    const community = effectiveEntitlements(LAUNCH_PLAN, "community");
    expect(expired).toEqual(community);
  });

  it("والأرضيّةُ تُسقط كلَّ استحقاقٍ مدفوعٍ وتُبقي الحدَّ المجتمعيَّ فقط", () => {
    const floor = effectiveEntitlements(LAUNCH_PLAN, "community");
    expect(floor.map((e) => e.entitlementCode)).toEqual([...SUBSCRIPTION_COMMUNITY_FLOOR_ENTITLEMENTS]);
    for (const code of SUBSCRIPTION_PAID_ONLY_ENTITLEMENTS) {
      expect(floor.some((e) => e.entitlementCode === code), code).toBe(false);
    }
    expect(floor.find((e) => e.entitlementCode === "daily_order_cap")?.limitValue).toBe(
      SUBSCRIPTION_LAUNCH_COMMUNITY_DAILY_ORDER_CAP,
    );
  });

  it("وسقفٌ صفرٌ يُسقط قبولَ الطلباتِ نفسَه — لا استحقاقٌ بحدٍّ صفر", () => {
    // استحقاقٌ معلَنٌ بسقفٍ صفرٍ أسوأُ من غيابِه: البوتُ يقول «تقبل الطلبات» ثم يُرفض كلُّ طلب.
    const closedFloor: PlanVersion = { ...LAUNCH_PLAN, communityDailyOrderCap: 0 };
    const floor = effectiveEntitlements(closedFloor, "community");
    expect(floor.some((e) => e.entitlementCode === "accept_orders")).toBe(false);
    expect(floor.find((e) => e.entitlementCode === "daily_order_cap")?.limitValue).toBe(0);
  });

  it("والقسمةُ بين الأرضيّةِ والمدفوعِ تُغطّي كلَّ الرموزِ بلا تقاطع", () => {
    expect([...SUBSCRIPTION_COMMUNITY_FLOOR_ENTITLEMENTS, ...SUBSCRIPTION_PAID_ONLY_ENTITLEMENTS].sort()).toEqual(
      [...SUBSCRIPTION_ENTITLEMENTS].sort(),
    );
    for (const code of SUBSCRIPTION_COMMUNITY_FLOOR_ENTITLEMENTS) {
      expect(isPaidOnlyEntitlement(code), code).toBe(false);
    }
    for (const code of SUBSCRIPTION_PAID_ONLY_ENTITLEMENTS) {
      expect(isPaidOnlyEntitlement(code), code).toBe(true);
    }
  });

  it("والمُخرَجُ نسخةٌ لا إشارةٌ إلى الخطّةِ المُجمَّدة", () => {
    // مُستهلكٌ يُعدّل ما أعطيناه لا ينبغي أن يُفسد الكتالوجَ لكلّ من بعده.
    const list = effectiveEntitlements(LAUNCH_PLAN, "active");
    (list[0] as { limitValue: number }).limitValue = 777;
    expect(LAUNCH_PLAN.entitlements[0]!.limitValue).toBe(-1);
  });
});
