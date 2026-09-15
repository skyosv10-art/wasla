/**
 * اختباراتُ قرارِ تركيبِ المُوقِّعِ — الموجةُ 3 من `M1-05B` (ADR-030).
 *
 * والسؤالُ الذي تُجيبُهُ هذهِ الحزمةُ وحدَها: **أيَبيتُ الحاجزُ حيّاً؟** فالبابُ
 * الساكنُ في الفحصِ 16 يقرأُ ما كُتِبَ في ملفٍّ، وهذا يقرأُ ما يجري عندَ بناءِ
 * مُوقِّعٍ. وأكثرُ الحالاتِ **سلبيّةٌ** بقصدٍ: مصفوفةٌ تسمحُ بكلِّ شيءٍ تمرُّ
 * في كلِّ حالةٍ موجبةٍ.
 */

import { describe, expect, it } from "vitest";

import {
  AuthzPolicyError,
  FLEET_GRANTS,
  TEST_FLEET_ROLES,
  assertSignerComposition,
  evaluateSignerComposition,
} from "../index.js";

describe("تركيبُ المُوقِّعِ — دورُ إنتاجٍ", () => {
  it("داخلَ سقفِ منحِهِ ⇒ يُسمَحُ", () => {
    expect(
      evaluateSignerComposition({
        role: "dispatch",
        audience: "matching",
        scopes: ["matching:candidates:evaluate", "matching:candidacy:write"],
      }).allowed,
    ).toBe(true);
  });

  it("أقلُّ من سقفِهِ ⇒ يُسمَحُ — فالمنحُ سقفٌ لا أمرٌ", () => {
    expect(
      evaluateSignerComposition({
        role: "dispatch",
        audience: "matching",
        scopes: [],
      }).allowed,
    ).toBe(true);
  });

  it("فوقَ سقفِهِ ⇒ يُرفَضُ بـ`SCOPE_NOT_GRANTED` — وهذا الرفضُ الحيُّ الذي طلبَهُ معيارُ الخروجِ", () => {
    const decision = evaluateSignerComposition({
      role: "dispatch",
      audience: "matching",
      scopes: [
        "matching:candidates:evaluate",
        "matching:candidacy:write",
        "matching:rulesets:read",
        "matching:decisions:read",
      ],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.error.code).toBe("SCOPE_NOT_GRANTED");
    expect([...decision.error.offendingScopes].sort()).toEqual([
      "matching:decisions:read",
      "matching:rulesets:read",
    ]);
  });

  it("على حدٍّ لا منحَ لهُ عليهِ ⇒ `AUDIENCE_NOT_GRANTED` — والجمهورُ هوَ ما يفصلُ الحدودَ", () => {
    const decision = evaluateSignerComposition({
      role: "dispatch",
      audience: "marketplace",
      scopes: ["marketplace:store:read"],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.error.code).toBe("AUDIENCE_NOT_GRANTED");
  });
});

describe("تركيبُ المُوقِّعِ — دورُ أسطولٍ", () => {
  it("على حدٍّ مُعلَنٍ لهُ ⇒ يُسمَحُ ولو بكاملِ مجموعةِ الحدِّ", () => {
    expect(
      evaluateSignerComposition({
        role: "order-exit-gate",
        audience: "orders",
        scopes: ["orders:intake:write", "orders:transition:write", "orders:assignment:write"],
      }).allowed,
    ).toBe(true);
  });

  it("على حدٍّ لم يُعلَنْ لهُ ⇒ يُرفَضُ — فالسقفُ المقيسُ هنا جمهورٌ", () => {
    const decision = evaluateSignerComposition({
      role: "order-exit-gate",
      audience: "marketplace",
      scopes: ["marketplace:store:read"],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.error.code).toBe("AUDIENCE_NOT_GRANTED");
  });

  it("`caller` وحدَهُ بجمهورٍ مفتوحٍ — لأنَّ اختبارَ وحدةٍ يُنشِئُ حدوداً وهميّةً", () => {
    expect(FLEET_GRANTS["caller"]?.audiences).toBe("any-audience");
    expect(
      evaluateSignerComposition({ role: "caller", audience: "alpha", scopes: ["x:y:z"] }).allowed,
    ).toBe(true);
  });
});

describe("تركيبُ المُوقِّعِ — دورٌ بلا إعلانٍ", () => {
  it("اسمٌ لا وجودَ لهُ في الجدولَينِ ⇒ `ROLE_NOT_DECLARED` — والمجهولُ لا يُقرأُ سماحاً", () => {
    const decision = evaluateSignerComposition({
      role: "totally-undeclared-service",
      audience: "orders",
      scopes: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.error.code).toBe("ROLE_NOT_DECLARED");
  });

  it("الصيغةُ الرامية ترمي `AuthzPolicyError` لا `Error` عامّاً", () => {
    expect(() =>
      assertSignerComposition({ role: "nope", audience: "orders", scopes: [] }),
    ).toThrow(AuthzPolicyError);
  });
});

describe("انسدادُ الجدولَينِ على بعضِهما", () => {
  it("كلُّ دورِ أسطولٍ في الجردِ لهُ سقفٌ مُعلَنٌ وبالعكسِ — لا اسمَ بلا سقفٍ ولا سقفَ بلا اسمٍ", () => {
    expect(Object.keys(FLEET_GRANTS).sort()).toEqual(Object.keys(TEST_FLEET_ROLES).sort());
  });

  it("لا سقفَ أسطولٍ بلا سببٍ مكتوبٍ", () => {
    for (const [role, grant] of Object.entries(FLEET_GRANTS)) {
      expect(grant.reason.trim().length, role).toBeGreaterThan(20);
    }
  });

  it("لا اسمَ أسطولٍ يُطابِقُ دوراً إنتاجيّاً — فالتسمِيةُ نفسُها تفصلُ العالمَينِ", async () => {
    const { PRODUCTION_GRANTS } = await import("../index.js");
    for (const role of Object.keys(FLEET_GRANTS)) {
      expect(PRODUCTION_GRANTS[role], role).toBeUndefined();
    }
  });
});
