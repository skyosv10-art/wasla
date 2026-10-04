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
  TENANT_BOUND_OPERATION_COUNT,
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
  /**
   * (`M1-04` الموجةُ 9 · `CLM-0197`) العددُ **قلَبَ** من أربعٍ وثمانينَ على
   * تسعةِ حدودٍ إلى **ثلاثٍ وتسعينَ على عَشْرِ حدودٍ** — قلبٌ لا محوٌ: الدعوى
   * السابقةُ صدقت لدفعتِها، وتسعُ عملياتِ حدِّ العميلِ دخلَتْ في هذهِ الدفعةِ
   * التي فرضَتْ ذلكَ الحدَّ فعلاً (`ADR-034` · `RISK-0051`).
   */
  it("ستٌّ وستونَ ومئةُ عمليّةٍ على سبعةَ عشرَ حدّاً (M1-04 · الموجةُ 9·10·11·12)", () => {
    // ADR-060 · CLM-0440: +1 — `POST /identity/assertions` (was 157).
    // CLM-0444: +8 — partners boundary (was 158). Total: 166.
    expect(ENFORCED_OPERATIONS).toHaveLength(166);
    expect(new Set(ENFORCED_OPERATIONS.map((o) => o.audience)).size).toBe(18);
  });

  it("مئةٌ وثلاثٌ وثلاثونَ صلاحيّةً مفروضةً، ولا عمليّةَ بلا صلاحيّةٍ (كانت ثمانياً وتسعينَ قبلَ صلاحيّتَي حدِّ البحث)", () => {
    // ADR-060 · CLM-0440: +1 — `identity:assertion:issue` (was 124).
    // CLM-0444: +8 — partners scopes (was 125). Total: 133.
    expect(allEnforcedScopes()).toHaveLength(133);
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

  /**
   * تصحيحٌ **بالإضافةِ** (`M1-05B`): كانَ هذا الاختبارُ يُثبِتُ أنَّ الرسالةَ
   * تحملُ الكلمةَ `caller-asserted` بعينِها، لأنَّ `GET /orders/:orderId` كانَ
   * صفّاً `caller-asserted` يومَ `M1-05`. وقد صارَ `token-bound`، فلو بقيَ
   * الاختبارُ على الكلمةِ الحرفيّةِ لسقطَ **لسببٍ صحيحٍ** — والمطلبُ الذي
   * كانَ يحرسُهُ ليسَ الكلمةَ بل **أن تُصرِّحَ الرسالةُ بقوّةِ الربطِ التي
   * أنتجتِ الرفضَ**، فلا يُقرأُ ربطٌ ضعيفٌ إثباتَ ملكيّةٍ. فيُعمَّمُ على كلِّ
   * صفٍّ مُصنَّفٍ بدلاً من أن يُثبَّتَ على صفٍّ واحدٍ يتغيَّرُ.
   */
  it("رسالةُ الرفضِ تُصرِّحُ بقوّةِ الربطِ الفعليّةِ لكلِّ صفٍّ مُصنَّفٍ", () => {
    const rejecting = OPERATION_BINDINGS.filter((b) => b.strength !== "none");
    // لو صارَ كلُّ صفٍّ `none` لمرَّ الاختبارُ على مجموعةٍ فارغةٍ — فيُرفَضُ الفراغُ.
    expect(rejecting.length).toBeGreaterThan(0);
    for (const binding of rejecting) {
      const decision = evaluateOwnerBinding({
        audience: binding.audience,
        method: binding.method,
        path: binding.path,
        dimension: binding.dimension,
        claimed: "WSL-0000000002",
        actual: "WSL-0000000001",
      });
      expect(decision.allowed, `${binding.method} ${binding.path}`).toBe(false);
      if (!decision.allowed) {
        expect(decision.error.message, `${binding.method} ${binding.path}`).toContain(
          binding.strength,
        );
      }
    }
  });

  /**
   * أثرٌ مقيسٌ للموجةِ الأولى يُسجَّلُ كي لا يُقرأَ صدفةً: **لم يبقَ في
   * المصفوفةِ صفٌّ واحدٌ `caller-asserted`.** صفَّا الطلباتِ كانا الوحيدَينِ،
   * وقد صارا `token-bound`. وما بقيَ `none` (حدُّ السوقِ) أضعفُ لا أقوى.
   *
   * **والتصريحُ الصريحُ هنا أنَّ فرعَ الرسالةِ الخاصَّ بـ`caller-asserted`
   * لم يَعُدْ يُبلَغُ من بياناتِ المصفوفةِ** — فلا يُدَّعى أنّهُ مُغطّىً.
   * وهوَ يُختبَرُ أدناهُ بمُدخَلٍ مُصطنَعٍ لا بصفٍّ حقيقيٍّ، والفرقُ مُعلَنٌ.
   */
  it("لا صفَّ `caller-asserted` بعدَ الموجةِ الأولى — والغيابُ مُعلَنٌ لا مُستنتَجٌ", () => {
    expect(OPERATION_BINDINGS.filter((b) => b.strength === "caller-asserted")).toHaveLength(0);
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
  /**
   * تصحيحٌ **بالإضافةِ** (`M1-05B`): كانَ هذا الاختبارُ يُثبِتُ الصفرَ —
   * وكانَ صادقاً في `M1-05`. وقد صارَ **اثنَينِ** بالموجةِ الأولى، ثمَّ
   * **سبعاً** بالموجةِ الثانيةِ (`CLM-0179`). والرقمُ لا يُكتَبُ هنا وحدَهُ بل
   * **يُقابَلُ بالصفوفِ نفسِها**: فلو رُفِعَ الرقمُ بتعديلِ المُشتَقِّ بلا
   * صفوفٍ لسقطَ، ولو أُضيفَ صفٌّ بلا تصنيفِ مسارٍ في شفرةِ الحدِّ لسقطَ
   * الفحصُ 16.
   */
  /**
   * (`M1-05B` الموجةُ 4) العددُ **قلَبَ** من سبعٍ إلى عشرٍ — قلبٌ لا محوٌ: الدعوى
   * القديمةُ (سبعٌ) صدقت للدفعةِ التي كُتِبَتْ فيها، وصفوفُ الموجةِ الرابعةِ
   * الثلاثةُ (`publish` · `archive` · `inventory`) دخلَتْ فصارَ القياسُ عشرةً.
   */
  /**
   * (`M1-04` الموجةُ 9) وقلَبَ العددُ ثانيةً من عشرٍ إلى **تسعَ عشرةَ**: تسعُ
   * عملياتِ حدِّ العميلِ كلُّها مربوطةٌ بالمالكِ في الدفعةِ نفسِها التي فرضَتْ
   * هويّةَ الخدمةِ عليها — فلم يمرَّ هذا الحدُّ بحالِ «مفروضٌ بلا ربطٍ» أصلاً.
   */
  it("العملياتُ المربوطةُ بالرمزِ أربعٌ وأربعونَ ومُطابِقةٌ لصفوفِها — لا رقمٌ يُكتَبُ باليدِ (كانت أربعاً وثلاثينَ)", () => {
    const tokenBound = OPERATION_BINDINGS.filter((b) => b.strength === "token-bound");
    expect(TOKEN_BOUND_OPERATION_COUNT).toBe(tokenBound.length);
    expect(TOKEN_BOUND_OPERATION_COUNT).toBe(44);
    expect(tokenBound.map((b) => `${b.method} ${b.path}`).sort()).toEqual([
      "DELETE /customers/:waslaPublicId/places/:placeId",
      "DELETE /stores/:storeSlug/staff/:memberPublicId",
      "GET /customers/:waslaPublicId/order-requests",
      "GET /customers/:waslaPublicId/order-requests/:orderRequestId",
      "GET /customers/:waslaPublicId/places",
      "GET /customers/:waslaPublicId/profile",
      "GET /drivers/:waslaPublicId",
      "GET /drivers/:waslaPublicId/documents",
      "GET /drivers/:waslaPublicId/eligibility",
      "GET /drivers/:waslaPublicId/vehicles",
      "GET /drivers/:waslaPublicId/zones",
      "GET /orders/:orderId",
      "GET /orders/:orderId/history",
      "GET /orders/drivers/:driverPublicId/jobs",
      "GET /referrals/codes/:ownerPublicId",
      "GET /reputation/scores/:subjectType/:subjectPublicId",
      "GET /stores/:storeSlug/staff",
      "GET /subscriptions/:driverPublicId",
      "GET /subscriptions/:driverPublicId/periods",
      "PATCH /drivers/:waslaPublicId",
      "PATCH /drivers/:waslaPublicId/vehicles/:vehicleId",
      "POST /customers/:waslaPublicId/order-requests",
      "POST /customers/:waslaPublicId/order-requests/preview",
      "POST /customers/:waslaPublicId/places",
      "POST /drivers",
      "POST /drivers/:waslaPublicId/documents",
      "POST /drivers/:waslaPublicId/documents/:documentId/review",
      "POST /drivers/:waslaPublicId/reinstate",
      "POST /drivers/:waslaPublicId/suspend",
      "POST /drivers/:waslaPublicId/vehicles",
      "POST /products/:productId/archive",
      "POST /products/:productId/inventory",
      "POST /products/:productId/publish",
      "POST /referrals",
      "POST /reputation/ratings",
      "POST /stores/:storeSlug/products",
      "POST /stores/:storeSlug/review-requests",
      "POST /stores/:storeSlug/staff",
      "POST /subscriptions",
      "POST /subscriptions/:driverPublicId/activate",
      "POST /subscriptions/:driverPublicId/recompute",
      "PUT /customers/:waslaPublicId/profile",
      "PUT /drivers/:waslaPublicId/availability",
      "PUT /drivers/:waslaPublicId/zones",
    ]);
  });

  /**
   * **الاختبارُ المقلوبُ لا المحذوفُ** (`CLM-0179`).
   *
   * كانَ هنا سطرٌ يُثبِتُ أنَّ **لا صفَّ مُستأجِرٍ مربوطٌ بالرمزِ**، وكانَ
   * صادقاً ومقيساً. وحذفُهُ عندَ تغيُّرِ الواقعِ كانَ سيمحو دليلاً؛ فقُلِبَ
   * إلى دعوىً **أقوى** تُثبِتُ العددَ الجديدَ وأسماءَ صفوفِهِ — فلو رُدَّ
   * الربطُ إلى `none` صامتاً لسقطَ هذا السطرُ بعينِهِ.
   */
  /**
   * (`M1-05B` الموجةُ 4) خمسٌ صارَتْ ثمانياً بقلبٍ لا بمحوٍ — ودورةُ حياةِ
   * المنتجِ (`publish` · `archive`) انتقلَتْ من بُعدِ الملكيّةِ `owner/none`
   * إلى بُعدِ المستأجرِ `tenant/token-bound`، وتعديلُ المخزونِ دخلَ معها.
   */
  it("وبُعدُ المستأجرِ صارَ مربوطاً في ثمانٍ بأسمائها — والقديمُ مقلوبٌ لا ممحوٌّ", () => {
    const tenantBound = OPERATION_BINDINGS.filter(
      (b) => b.dimension === "tenant" && b.strength === "token-bound",
    );
    expect(TENANT_BOUND_OPERATION_COUNT).toBe(tenantBound.length);
    expect(TENANT_BOUND_OPERATION_COUNT).toBe(8);
    expect(tenantBound.every((b) => b.audience === "marketplace")).toBe(true);
    expect(tenantBound.map((b) => `${b.method} ${b.path}`).sort()).toEqual([
      "DELETE /stores/:storeSlug/staff/:memberPublicId",
      "GET /stores/:storeSlug/staff",
      "POST /products/:productId/archive",
      "POST /products/:productId/inventory",
      "POST /products/:productId/publish",
      "POST /stores/:storeSlug/products",
      "POST /stores/:storeSlug/review-requests",
      "POST /stores/:storeSlug/staff",
    ]);
    // وبُعدُ الملكيّةِ كانَ اثنَينِ ثمَّ صارَ **أحدَ عشرَ** بتسعِ عملياتِ حدِّ
    // العميلِ (`M1-04` الموجةُ 9): زيادةٌ في بُعدِ الملكيّةِ لا انتقاصٌ من بُعدِ
    // المستأجرِ — والثمانيةُ أعلاهُ كما هيَ، فالقياسانِ مستقلّانِ.
    // (`M1-04` الموجةُ 10) صارَ **خمسةً وعشرينَ** بأربعَ عشرةَ عمليّةً لحدِّ
    // السائقينَ — كلُّها في بُعدِ الملكيّةِ ومربوطةٌ بالرمزِ.
    // (`M1-04` الموجةُ 13 · `CLM-0201`) صارَ **خمسةً وثلاثينَ** بسبعِ عملياتِ
    // حدِّ الاشتراكِ — كلُّها في بُعدِ الملكيّةِ ومربوطةٌ بالرمزِ.
    expect(
      OPERATION_BINDINGS.filter(
        (b) => b.dimension === "owner" && b.strength === "token-bound",
      ),
    ).toHaveLength(36);
  });

  /**
   * وما **لم** يُربَطْ يبقى مقيساً بأسمائِهِ: ستُّ عملياتٍ على حدِّ السوقِ
   * تبقى `none` **بأسبابٍ مكتوبةٍ** في `note` كلِّ صفٍّ (مُنادٍ خدميٌّ بلا
   * مُنتَفِعٍ · كتالوجٌ عامٌّ · وعكسُ سياسةٍ في `POST .../decisions`).
   *
   * ولمَ يُكتَبُ هذا اختباراً: بلا سطرٍ كهذا يصيرُ تركُ مسارٍ بلا ربطٍ
   * **غيابَ قرارٍ** لا قراراً؛ فمن أرادَ فكَّ ربطٍ لاحقاً يجبُ أن يُبدِّلَ
   * رقماً هنا فيُقرأَ قصدُهُ.
   */
  /**
   * (`M1-05B` الموجةُ 4) سادسةٌ انتقلَتْ من بُعدِ الملكيّةِ إلى بُعدِ المستأجرِ
   * مربوطةً بالرمزِ (`publish` · `archive` كانَتا owner/none)، والسابعةُ
   * الجديدةُ قرارُ اعتدالِ المنتجِ — بقيَ سببًا مكتوبًا: سلطةُ منصّةٍ.
   */
  it("وسبعُ عملياتٍ سوقيّةٍ تبقى بلا ربطٍ بأسبابٍ مكتوبةٍ لا بإغفالٍ", () => {
    const unbound = OPERATION_BINDINGS.filter(
      (b) => b.audience === "marketplace" && b.dimension === "tenant" && b.strength === "none",
    );
    expect(unbound.map((b) => `${b.method} ${b.path}`).sort()).toEqual([
      // RISK-0042 الموجةُ 2 (CLM-0437): صفّانِ أُضيفا بدليلٍ مقروءٍ — يُضافانِ ولا يُمحى ما قبلَهما.
      // CLM-0443 (ADR-060 P2): `GET /products/:productId/inventory` ارتقى إلى `asserted` فخرجَ من هذهِ القائمة.
      "GET /products/:productId",
      "GET /stores/:storeSlug",
      "GET /stores/:storeSlug/products",
      "GET /stores/:storeSlug/reviews",
      "POST /products/:productId/decisions",
      "POST /stores/:storeSlug/decisions",
      "POST /stores/:storeSlug/inventory/release",
      "POST /stores/:storeSlug/inventory/reserve",
    ]);
    // ولا صفَّ منها بلا سببٍ مكتوبٍ: `note` فارغةٌ تُقرأُ إغفالاً.
    for (const binding of unbound) {
      expect(binding.note.length).toBeGreaterThan(40);
      expect(binding.note).toContain("`none`");
    }
  });

  it("المُصنَّفُ وغيرُ المُصنَّفِ يُساويانِ الجردَ كلَّهُ — فلا عمليّةَ تسقطُ من الحسابِ", () => {
    expect(OPERATION_BINDINGS.length + UNCLASSIFIED_OPERATION_COUNT).toBe(
      ENFORCED_OPERATIONS.length,
    );
    // كانت 105؛ الموجةُ 1 من RISK-0042 (CLM-0435) صنَّفَتْ 23 عمليّةً `none` بدليلٍ مقروءٍ (→ 82)،
    // والموجةُ 2 (CLM-0437) صنَّفَتْ 35 أخرى (→ 47)، والموجةُ 3 (CLM-0461) الـ47 الباقيةَ (→ 0).
    expect(UNCLASSIFIED_OPERATION_COUNT).toBe(0);
  });

  it("RISK-0042 الموجةُ 3: الـ47 الباقيةُ `none`، كلٌّ بدليلٍ وسببٍ، والفجواتُ مُسمّاةٌ (CLM-0461)", () => {
    const wave3Audiences = new Set(["channel", "delivery", "identity", "search", "audit", "support", "billing"]);
    const wave3Orders = new Set([
      "POST /orders/intake",
      "POST /orders/agreed-prices",
      "POST /orders/:orderId/transitions",
      "POST /orders/:orderId/assignments",
      "PATCH /orders/:orderId/assignments/:assignmentId",
    ]);
    const wave3 = OPERATION_BINDINGS.filter(
      (b) =>
        // `POST /identity/assertions` صُنِّفَ قبلَ الموجةِ (ADR-060 · CLM-0440).
        (wave3Audiences.has(b.audience) && b.path !== "/identity/assertions") ||
        (b.audience === "orders" && wave3Orders.has(`${b.method} ${b.path}`)),
    );
    expect(wave3).toHaveLength(47);
    for (const b of wave3) {
      expect(b.strength).toBe("none");
      expect(b.evidence).toMatch(/^[^:]+\.ts:\S+ \S+/);
      expect(b.note.length).toBeGreaterThan(20);
    }
    // 21 فجوةً مقيسةً تُسمّى في `note` (لا يُقرأُ `none` بلا مالكٍ «سليماً»).
    expect(wave3.filter((b) => b.note.includes("فجوةٌ مقيسةٌ"))).toHaveLength(21);
    expect(wave3.filter((b) => b.audience === "billing").every((b) => b.dimension === "tenant")).toBe(true);
  });

  it("RISK-0042 الموجةُ 1: 23 صفّاً `none` كلٌّ بدليلِ `<ملفٌّ>:<مِرساةٌ>` وسببٍ مكتوبٍ", () => {
    const wave1Audiences = new Set(["dispatch", "geography"]);
    const wave1 = OPERATION_BINDINGS.filter(
      (b) =>
        wave1Audiences.has(b.audience) ||
        (b.audience === "drivers" && ((b.method === "GET" && b.path === "/drivers") || b.path === "/drivers/eligibility/tick")) ||
        (b.audience === "customers" && b.path.startsWith("/customers") && !b.path.includes(":waslaPublicId")),
    );
    expect(wave1).toHaveLength(23);
    for (const binding of wave1) {
      expect(binding.strength).toBe("none");
      expect(binding.evidence).toMatch(/^services\/[a-z-]+\/src\/http\/app\.ts:\S+ \S+/);
      expect(binding.note.length).toBeGreaterThan(20);
    }
  });

  it("RISK-0042 الموجةُ 2: 32 صفّاً `none` على خمسةِ حدودٍ — كلٌّ بدليلٍ ومِرساتَينِ وسببٍ", () => {
    // CLM-0441 (ADR-060 P2 · 2026-10-03): 11 من 12 عمليّة مفاوضاتٍ ارتقتْ من `none` إلى `asserted`.
    // CLM-0442 (ADR-060 P2 · 2026-10-03): 3 عمليّات مطابقةٍ ارتقتْ من `none` إلى `asserted`.
    // CLM-0443 (ADR-060 P2 · 2026-10-03): 3 عمليّات سوقٍ ارتقتْ من `none` إلى `asserted` (POST/GET /stores · GET inventory).
    // تبقى 18 صفّاً `none` في الموجةِ 2: 1 negotiations/tick + 3 matching + 8 reputation + 4 subscriptions + 2 marketplace.
    const wave2 = OPERATION_BINDINGS.filter((b) =>
      ["negotiations", "matching", "reputation", "subscriptions", "marketplace"].includes(b.audience)
      && b.note.startsWith("`none`:"),
    );
    const perAudience: Record<string, number> = {};
    for (const b of wave2) perAudience[b.audience] = (perAudience[b.audience] ?? 0) + 1;
    expect(perAudience).toEqual({ negotiations: 1, matching: 3, reputation: 8, subscriptions: 4, marketplace: 2 });
    for (const binding of wave2) {
      expect(binding.strength).toBe("none");
      expect(binding.evidence).toMatch(/^services\/[a-z-]+\/src\/http\/app\.ts:\S+ \S+/);
      expect(binding.note.length).toBeGreaterThan(20);
    }
  });

  it("CLM-0441 (ADR-060 P2): 11 عمليّة مفاوضاتٍ `asserted` — كلٌّ بدليلٍ ومِرساتَينِ وسببٍ", () => {
    const asserted = OPERATION_BINDINGS.filter((b) =>
      b.audience === "negotiations" && b.strength === "asserted",
    );
    expect(asserted).toHaveLength(11);
    for (const binding of asserted) {
      expect(binding.evidence).toMatch(/^services\/negotiations\/src\/http\/app\.ts:asserted/);
      expect(binding.note).toContain("CLM-0441");
      expect(binding.note.length).toBeGreaterThan(20);
    }
    // /tick stays `none`
    const tick = OPERATION_BINDINGS.find((b) => b.audience === "negotiations" && b.path === "/negotiations/tick");
    expect(tick?.strength).toBe("none");
  });

  it("CLM-0442 (ADR-060 P2): 3 عمليّات مطابقةٍ `asserted` — كلٌّ بدليلٍ ومِرساتَينِ وسببٍ", () => {
    const asserted = OPERATION_BINDINGS.filter((b) =>
      b.audience === "matching" && b.strength === "asserted",
    );
    expect(asserted).toHaveLength(3);
    for (const binding of asserted) {
      expect(binding.evidence).toMatch(/^services\/matching\/src\/http\/app\.ts:assertedDriver/);
      expect(binding.note).toContain("CLM-0442");
      expect(binding.note.length).toBeGreaterThan(20);
    }
    // System routes stay `none`
    const candidates = OPERATION_BINDINGS.find((b) => b.audience === "matching" && b.path === "/matching/candidates");
    expect(candidates?.strength).toBe("none");
    const rulesets = OPERATION_BINDINGS.find((b) => b.audience === "matching" && b.path === "/matching/rulesets");
    expect(rulesets?.strength).toBe("none");
    const decisions = OPERATION_BINDINGS.find((b) => b.audience === "matching" && b.path === "/matching/decisions/:decisionId");
    expect(decisions?.strength).toBe("none");
  });

  it("CLM-0443 (ADR-060 P2): 3 عمليّات سوقٍ `asserted` — كلٌّ بدليلٍ ومِرساتَينِ وسببٍ", () => {
    const asserted = OPERATION_BINDINGS.filter((b) =>
      b.audience === "marketplace" && b.strength === "asserted",
    );
    expect(asserted.map((b) => `${b.method} ${b.path}`).sort()).toEqual([
      "GET /products/:productId/inventory",
      "GET /stores",
      "POST /stores",
    ]);
    for (const binding of asserted) {
      expect(binding.evidence).toMatch(/^services\/marketplace\/src\/http\/app\.ts:assertedStaff/);
      expect(binding.note).toContain("CLM-0443");
      expect(binding.note.length).toBeGreaterThan(20);
    }
    // Catalogue/system reads used by delivery stay `none` (no obo, system scope).
    const productRead = OPERATION_BINDINGS.find((b) => b.audience === "marketplace" && b.method === "GET" && b.path === "/products/:productId");
    expect(productRead?.strength).toBe("none");
    const storeRead = OPERATION_BINDINGS.find((b) => b.audience === "marketplace" && b.method === "GET" && b.path === "/stores/:storeSlug");
    expect(storeRead?.strength).toBe("none");
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
      // ADR-060 · CLM-0440: إصدارُ تأكيدِ المستخدمِ النهائيِّ — يُضافُ ولا يُمحى ما قبلَهُ.
      "identity:assertion:issue",
      "identity:history:read",
      "identity:link:write",
      "identity:recovery:write",
      "identity:resolve:write",
      "identity:user:read",
    ]);
  });
});
