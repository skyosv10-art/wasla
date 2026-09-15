/**
 * اختباراتُ مصفوفةِ التفويضِ (`M1-05`).
 *
 * وأكثرُ ما فيها **سلبيٌّ** بقصدٍ: البندُ على اللوحةِ معيارُ خروجِهِ
 * «`owner/role/tenant negative tests`»، والسببُ أنَّ الاختبارَ الموجبَ
 * («المسموحُ يُسمَحُ») يمرُّ أيضاً على مصفوفةٍ تسمحُ بكلِّ شيءٍ. فالذي يُفرِّقُ
 * سياسةً عن لا سياسةٍ هوَ **ما تمنعُه**.
 */

import { describe, expect, it } from "vitest";

import {
  AuthzPolicyError,
  ENFORCED_OPERATIONS,
  OPERATION_BINDINGS,
  PRODUCTION_GRANTS,
  TEST_FLEET_ROLES,
  TOKEN_BOUND_OPERATION_COUNT,
  UNCLASSIFIED_OPERATION_COUNT,
  allEnforcedScopes,
  assertScopeRequest,
  enforcedScopesAt,
  evaluateOwnerBinding,
  evaluateScopeRequest,
  grantFor,
  holdersOf,
  isScopeEnforcedAt,
  operationsRequiring,
} from "../index.js";

describe("جردُ العملياتِ المفروضةِ", () => {
  it("ثمانونَ عمليّةً على ثمانيةِ حدودٍ — القياسُ المُعلَنُ في ADR-027", () => {
    expect(ENFORCED_OPERATIONS).toHaveLength(80);
    expect(new Set(ENFORCED_OPERATIONS.map((o) => o.audience)).size).toBe(8);
  });

  it("أربعٌ وستّونَ صلاحيّةً مفروضةً، ولا عمليّةَ بلا صلاحيّةٍ", () => {
    expect(allEnforcedScopes()).toHaveLength(64);
    for (const op of ENFORCED_OPERATIONS) {
      expect(op.scopes.length).toBeGreaterThan(0);
    }
  });

  it("لا عمليّةَ مُكرَّرةٌ — الطريقةُ والمسارُ والجمهورُ مفتاحٌ واحدٌ", () => {
    const keys = ENFORCED_OPERATIONS.map((o) => `${o.audience} ${o.method} ${o.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("لا مسارَ يحملُ سلسلةَ استعلامٍ — الربطُ لا يشملُها (ADR-021 §4)", () => {
    for (const op of ENFORCED_OPERATIONS) {
      expect(op.path).not.toContain("?");
      expect(op.path.startsWith("/")).toBe(true);
    }
  });
});

describe("صدقُ المصفوفةِ: كلُّ منحٍ يُشيرُ إلى صلاحيّةٍ مفروضةٍ فعلاً", () => {
  it("لا صلاحيّةَ مُمنوحةٌ خارجَ ما يفرضُهُ الحدُّ", () => {
    const offenders: string[] = [];
    for (const [role, grants] of Object.entries(PRODUCTION_GRANTS)) {
      for (const grant of grants) {
        for (const scope of grant.scopes) {
          if (!isScopeEnforcedAt(grant.audience, scope)) {
            offenders.push(`${role} → ${grant.audience}: ${scope}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("كلُّ منحٍ يحملُ سبباً ودليلاً غيرَ فارغَين", () => {
    for (const [, grants] of Object.entries(PRODUCTION_GRANTS)) {
      for (const grant of grants) {
        expect(grant.reason.trim().length).toBeGreaterThan(10);
        expect(grant.evidence.length).toBeGreaterThan(0);
      }
    }
  });

  it("لا جمهورَ مُكرَّرٌ لدورٍ واحدٍ — سقفٌ واحدٌ لا سقفانِ", () => {
    for (const [, grants] of Object.entries(PRODUCTION_GRANTS)) {
      const auds = grants.map((g) => g.audience);
      expect(new Set(auds).size).toBe(auds.length);
    }
  });

  it("لا دورَ اختبارٍ مُعلَنٌ منحاً إنتاجيّاً", () => {
    for (const role of Object.keys(TEST_FLEET_ROLES)) {
      expect(PRODUCTION_GRANTS[role]).toBeUndefined();
    }
  });
});

// ── سلبيٌّ: الدورُ ─────────────────────────────────────────────────────────
describe("رفضٌ بالدورِ (role negative)", () => {
  it("دورٌ غيرُ مُعلَنٍ يُرفَضُ ولا يُقرأُ غيابُهُ سماحاً", () => {
    const decision = evaluateScopeRequest({
      role: "unknown-service",
      audience: "orders",
      scopes: ["orders:order:read"],
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.error.code).toBe("ROLE_NOT_DECLARED");
  });

  it("دورٌ مُعلَنٌ يُرفَضُ على حدٍّ لا منحَ لهُ عليهِ", () => {
    // `matching` تُنادي الجغرافيا فقط — ولا شأنَ لها بالطلباتِ.
    expect(grantFor("matching", "orders")).toBeUndefined();
    const decision = evaluateScopeRequest({
      role: "matching",
      audience: "orders",
      scopes: [],
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.error.code).toBe("AUDIENCE_NOT_GRANTED");
  });

  it("دورٌ مُعلَنٌ على الحدِّ يُرفَضُ إذا طلبَ صلاحيّةً خارجَ سقفِه", () => {
    // `dispatch` تُسنِدُ وتنقُلُ حالةً، ولا تقرأُ طلباً ولا تاريخَه.
    const decision = evaluateScopeRequest({
      role: "dispatch",
      audience: "orders",
      scopes: ["orders:assignment:write", "orders:history:read"],
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.error.code).toBe("SCOPE_NOT_GRANTED");
      expect(decision.error.offendingScopes).toEqual(["orders:history:read"]);
    }
  });

  it("الصيغةُ الرامية ترمي `AuthzPolicyError` لا `Error` عامّاً", () => {
    expect(() =>
      assertScopeRequest({ role: "customers", audience: "orders", scopes: ["orders:transition:write"] }),
    ).toThrow(AuthzPolicyError);
  });

  it("الرفضُ يُسمّي الصلاحيّةَ المُخالِفةَ وحدَها لا كلَّ المطلوبِ", () => {
    const decision = evaluateScopeRequest({
      role: "negotiations",
      audience: "orders",
      scopes: ["orders:order:read", "orders:transition:write", "orders:assignment:write"],
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect([...decision.error.offendingScopes].sort()).toEqual([
        "orders:assignment:write",
        "orders:transition:write",
      ]);
    }
  });

  it("المنحُ سقفٌ لا أمرٌ: طلبُ أقلَّ منهُ مسموحٌ، والفارغُ مسموحٌ", () => {
    expect(evaluateScopeRequest({ role: "dispatch", audience: "orders", scopes: [] }).allowed).toBe(true);
    expect(
      evaluateScopeRequest({
        role: "delivery",
        audience: "marketplace",
        scopes: ["marketplace:store:read"],
      }).allowed,
    ).toBe(true);
  });
});

// ── سلبيٌّ: الملكيّةُ ──────────────────────────────────────────────────────
describe("رفضٌ بالملكيّةِ (owner negative)", () => {
  const owned = {
    audience: "orders",
    method: "GET",
    path: "/orders/:orderId",
    dimension: "owner",
  } as const;

  it("غيرُ المالكِ يُرفَضُ", () => {
    const decision = evaluateOwnerBinding({
      ...owned,
      claimed: "WSL-0000000002",
      actual: "WSL-0000000001",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.error.code).toBe("OWNER_BINDING_VIOLATED");
  });

  it("المالكُ يُقبَلُ", () => {
    expect(
      evaluateOwnerBinding({ ...owned, claimed: "WSL-0000000001", actual: "WSL-0000000001" }).allowed,
    ).toBe(true);
  });

  it("رسالةُ الرفضِ تُصرِّحُ بقوّةِ الربطِ — فلا يُقرأُ `caller-asserted` إثباتَ ملكيّةٍ", () => {
    const decision = evaluateOwnerBinding({
      ...owned,
      claimed: "WSL-0000000002",
      actual: "WSL-0000000001",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.error.message).toContain("caller-asserted");
  });

  it("عمليّةٌ بلا ربطٍ تُصرِّحُ بـ`none` — الغيابُ مُعلَنٌ لا مُقنَّعٌ", () => {
    const decision = evaluateOwnerBinding({
      audience: "orders",
      method: "GET",
      path: "/orders/lookup",
      dimension: "owner",
      claimed: "WSL-0000000002",
      actual: "WSL-0000000001",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.error.message).toContain("none");
  });
});

// ── سلبيٌّ: المستأجرُ ─────────────────────────────────────────────────────
describe("رفضٌ بالمستأجرِ (tenant negative)", () => {
  it("فاعلٌ من متجرٍ آخرَ يُرفَضُ برمزِ المستأجرِ لا برمزِ المالكِ", () => {
    const decision = evaluateOwnerBinding({
      audience: "marketplace",
      method: "POST",
      path: "/stores/:storeSlug/staff",
      dimension: "tenant",
      claimed: "store-b",
      actual: "store-a",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.error.code).toBe("TENANT_BINDING_VIOLATED");
  });

  it("المستأجرُ نفسُهُ يُقبَلُ", () => {
    expect(
      evaluateOwnerBinding({
        audience: "marketplace",
        method: "POST",
        path: "/stores/:storeSlug/staff",
        dimension: "tenant",
        claimed: "store-a",
        actual: "store-a",
      }).allowed,
    ).toBe(true);
  });
});

// ── حدُّ الدعوى: الغيابُ مقيسٌ لا مُخفىً ──────────────────────────────────
describe("حدُّ الدعوى في هذهِ الدفعةِ", () => {
  it("لا عمليّةَ واحدةٌ مربوطةٌ بالرمزِ بعدُ — والصفرُ مُعلَنٌ لا مُستنتَجٌ", () => {
    expect(TOKEN_BOUND_OPERATION_COUNT).toBe(0);
  });

  it("المُصنَّفُ وغيرُ المُصنَّفِ يُساويانِ الجردَ كلَّهُ — فلا عمليّةَ تسقطُ من الحسابِ", () => {
    expect(OPERATION_BINDINGS.length + UNCLASSIFIED_OPERATION_COUNT).toBe(
      ENFORCED_OPERATIONS.length,
    );
    expect(UNCLASSIFIED_OPERATION_COUNT).toBe(64);
  });

  it("كلُّ تصنيفٍ يُشيرُ إلى عمليّةٍ موجودةٍ في الجردِ المفروضِ", () => {
    for (const binding of OPERATION_BINDINGS) {
      const found = ENFORCED_OPERATIONS.some(
        (op) =>
          op.audience === binding.audience &&
          op.method === binding.method &&
          op.path === binding.path,
      );
      expect(found, `${binding.method} ${binding.path}`).toBe(true);
    }
  });
});

describe("قراءةُ أثرِ منحٍ قبلَ إعطائِه", () => {
  it("حاملو صلاحيّةٍ يُقرآنَ من المصفوفةِ لا من الشفرةِ", () => {
    expect(holdersOf("geography:zone:read")).toEqual([
      "customer-bot",
      "customers",
      "drivers",
      "matching",
    ]);
  });

  it("صلاحيّةٌ لا حاملَ لها اليومَ تُقرأُ فارغةً — وهذا دينٌ مقروءٌ لا عطلٌ", () => {
    expect(holdersOf("orders:history:read")).toEqual([]);
  });

  it("العملياتُ التي تفتحُها صلاحيّةٌ تُقرأُ قبلَ منحِها", () => {
    const ops = operationsRequiring("marketplace:product:lifecycle");
    expect(ops.map((o) => o.path).sort()).toEqual([
      "/products/:productId/archive",
      "/products/:productId/publish",
    ]);
  });

  it("صلاحيّاتُ حدٍّ تُشتَقُّ من الجردِ لا تُكتَبُ ثانيةً", () => {
    expect(enforcedScopesAt("identity")).toEqual([
      "identity:history:read",
      "identity:link:write",
      "identity:recovery:write",
      "identity:resolve:write",
      "identity:user:read",
    ]);
  });
});
