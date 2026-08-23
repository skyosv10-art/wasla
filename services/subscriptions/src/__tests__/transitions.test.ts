/**
 * الانتقالاتُ السبعة: كلُّ حافّةٍ مُعلَنةٍ **تُقبَل**، وكلُّ زوجٍ غيرِ مُعلَنٍ **يُرفَض**.
 *
 * الاختبارُ الأهمُّ هنا هو الثاني: نُولّد **كلَّ** أزواجِ (الحالاتُ الأربعُ + ∅) × (الحالاتُ
 * الأربع) = عشرون زوجاً، ونُثبت أنّ المقبولَ منها سبعةٌ بعينِها وأنّ الثلاثةَ عشرَ الباقيةَ
 * تُرفض برمزِ عقدٍ واحد. اختبارٌ يذكر الحافّاتِ المسموحةَ وحدَها يمرّ على تنفيذٍ يقبل كلَّ
 * شيء — وهذا هو النقيضُ الذي تطلبه القاعدةُ الحاكمة (HANDOFF §16-ب).
 */

import { describe, expect, it } from "vitest";

import { SUBSCRIPTION_ALLOWED_TRANSITIONS, SUBSCRIPTION_STATES } from "../domain/contract-sets.js";
import type { SubscriptionState } from "../domain/contract-sets.js";
import { isSubscriptionError } from "../domain/errors.js";
import {
  assertTransition,
  draftTransition,
  isAllowedTransition,
  reasonForTransition,
} from "../domain/transitions.js";

const T0 = "2026-03-01T00:00:00.000Z";
const FROM_STATES: ReadonlyArray<SubscriptionState | null> = [null, ...SUBSCRIPTION_STATES];

/** مصدرٌ صالحٌ لكلّ هدفٍ، كي يفصل هذا الملفُّ رفضَ الحافّةِ عن رفضِ المصدر. */
function sourceFor(toState: SubscriptionState): "trial" | "payment" | null {
  if (toState === "trial") return "trial";
  if (toState === "active") return "payment";
  return null;
}

describe("الحافّاتُ السبعُ المُعلَنة", () => {
  it("كلُّ حافّةٍ في العقد تُقبَل وتُنتج سبباً مُقفلاً", () => {
    expect(SUBSCRIPTION_ALLOWED_TRANSITIONS).toHaveLength(7);
    for (const [from, to] of SUBSCRIPTION_ALLOWED_TRANSITIONS) {
      expect(isAllowedTransition(from, to), `${from ?? "∅"} → ${to}`).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
      expect(reasonForTransition(from, to, sourceFor(to))).toMatch(
        /^(?:trial_granted|payment_activated|referral_reward_applied|period_ended|community_grace_ended)$/,
      );
    }
  });

  it("والأزواجُ الثلاثةَ عشرَ الباقيةُ تُرفض برمزِ العقد", () => {
    const declared = new Set(
      SUBSCRIPTION_ALLOWED_TRANSITIONS.map(([from, to]) => `${from ?? "∅"}→${to}`),
    );
    const rejected: string[] = [];
    for (const from of FROM_STATES) {
      for (const to of SUBSCRIPTION_STATES) {
        const key = `${from ?? "∅"}→${to}`;
        if (declared.has(key)) continue;
        expect(isAllowedTransition(from, to), key).toBe(false);
        try {
          assertTransition(from, to);
          throw new Error(`قُبل زوجٌ غير معلن: ${key}`);
        } catch (error) {
          expect(isSubscriptionError(error), key).toBe(true);
          expect((error as { code: string }).code).toBe("SUBSCRIPTION_TRANSITION_NOT_ALLOWED");
          rejected.push(key);
        }
      }
    }
    expect(rejected).toHaveLength(20 - 7);
  });

  it("ولا active → active بحال: التجديدُ مدةٌ لا انتقال (القرار 3)", () => {
    expect(isAllowedTransition("active", "active")).toBe(false);
    expect(() => assertTransition("active", "active")).toThrowError(/انتقال غير معلن/);
  });

  it("ولا نزولَ من الأرضيّةِ ولا تجربةً ثانية", () => {
    for (const pair of [
      ["community", "expired"],
      ["community", "trial"],
      ["expired", "trial"],
      ["active", "trial"],
      ["trial", "community"],
    ] as const) {
      expect(isAllowedTransition(pair[0], pair[1]), pair.join("→")).toBe(false);
    }
  });
});

describe("سببُ الانتقال يُشتقّ ولا يُمرَّر", () => {
  it("∅ → trial ⇒ trial_granted", () => {
    expect(reasonForTransition(null, "trial", "trial")).toBe("trial_granted");
    expect(reasonForTransition(null, "trial", null)).toBe("trial_granted");
  });

  it("ونقيضُه: مدةٌ مدفوعةٌ لا تُنتج حالةَ تجربة", () => {
    expect(() => reasonForTransition(null, "trial", "payment")).toThrowError(/حقل غير صالح/);
  });

  it("إلى active: الدفعُ والمكافأةُ سببان مختلفان لا سببٌ واحد", () => {
    expect(reasonForTransition("trial", "active", "payment")).toBe("payment_activated");
    expect(reasonForTransition("expired", "active", "referral_reward")).toBe(
      "referral_reward_applied",
    );
    expect(reasonForTransition("community", "active", "payment")).toBe("payment_activated");
  });

  it("ونقيضُه: active بلا مصدرٍ أو بمصدرِ تجربةٍ يُرفض ولا يُخمَّن", () => {
    // تخمينُ «دفع» كان سينسب إلى الدفعِ نموّاً سببُه إحالة، وهو أسوأُ من غيابِ الرقم.
    expect(() => reasonForTransition("trial", "active", null)).toThrowError(/حقل غير صالح/);
    expect(() => reasonForTransition("trial", "active", "trial")).toThrowError(/حقل غير صالح/);
  });

  it("الانقضاءُ سببُه واحدٌ من أيّ حالةٍ سابقة", () => {
    expect(reasonForTransition("trial", "expired", null)).toBe("period_ended");
    expect(reasonForTransition("active", "expired", null)).toBe("period_ended");
  });

  it("والأرضيّةُ سببُها انتهاءُ المهلةِ لا عقوبة", () => {
    expect(reasonForTransition("expired", "community", null)).toBe("community_grace_ended");
  });

  it("والسببُ لا يُحسب لزوجٍ مرفوضٍ أصلاً — الرفضُ قبل الاشتقاق", () => {
    expect(() => reasonForTransition("active", "active", "payment")).toThrowError(
      /انتقال غير معلن/,
    );
  });
});

describe("مسوّدةُ الانتقال", () => {
  it("تحمل الزوجَ والسببَ واللحظةَ، ولا تُنشئ تسلسلاً ولا مُعرّفاً", () => {
    const draft = draftTransition("trial", "active", "payment", T0);
    expect(draft).toEqual({
      fromState: "trial",
      toState: "active",
      reasonCode: "payment_activated",
      occurredAt: T0,
    });
    // التسلسلُ والمُعرّفُ تُنشئهما القاعدةُ في 3/6: مسوّدةٌ تُخمّن تسلسلاً تكذب على أوّلِ
    // تزامنٍ حقيقيّ.
    expect(Object.keys(draft).sort()).toEqual(["fromState", "occurredAt", "reasonCode", "toState"]);
  });

  it("وترفض لحظةً ليست ISO", () => {
    expect(() => draftTransition("trial", "active", "payment", "الآن")).toThrowError(
      /حقل غير صالح/,
    );
  });
});
