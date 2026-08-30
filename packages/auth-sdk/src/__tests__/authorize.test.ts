import { describe, expect, it } from "vitest";

import {
  anonymous,
  assertAudience,
  assertObjectOwner,
  assertScopes,
  assertTenant,
  hasAllScopes,
  hasRole,
  hasScope,
  isExpired,
  ownerPublicIdOf,
  scopesOf,
} from "../index.js";
import { validService, validUser } from "./fixtures.js";

const BEFORE_EXPIRY = new Date("2026-08-30T00:30:00.000Z");
const AT_EXPIRY = new Date("2026-08-30T01:00:00.000Z");
const AFTER_EXPIRY = new Date("2026-08-30T01:00:00.001Z");

function codeOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    return (error as { code: string }).code;
  }
  throw new Error("كان يجب أن يُرفَع خطأٌ ولم يُرفَع");
}

describe("انتهاءُ المدّة", () => {
  it("قبلَ الانتهاءِ: غيرُ منتهٍ", () => {
    expect(isExpired(validUser, BEFORE_EXPIRY)).toBe(false);
  });

  it("عندَ لحظةِ الانتهاءِ نفسِها: ما زال سارياً (حدٌّ حصريٌّ مقصود)", () => {
    expect(isExpired(validUser, AT_EXPIRY)).toBe(false);
  });

  it("بعدَ الانتهاءِ بمِلّي ثانية: منتهٍ", () => {
    expect(isExpired(validUser, AFTER_EXPIRY)).toBe(true);
  });

  it("المجهولُ لا ينتهي لأنّه لا إثباتَ له", () => {
    expect(isExpired(anonymous(), AFTER_EXPIRY)).toBe(false);
  });

  it("إثباتٌ بلا تاريخِ انتهاءٍ يُعَدُّ منتهياً لا سارياً أبداً", () => {
    const { expiresAt: _dropped, ...withoutExpiry } = validUser;
    expect(isExpired(withoutExpiry as typeof validUser, BEFORE_EXPIRY)).toBe(
      true,
    );
  });
});

describe("مطابقةُ الصلاحيّات", () => {
  it("يطابق صلاحيّةً حرفيّة", () => {
    expect(hasScope(validUser, "orders:order:create")).toBe(true);
  });

  it("يرفض صلاحيّةً غيرَ ممنوحة", () => {
    expect(hasScope(validUser, "orders:order:delete")).toBe(false);
  });

  it("حرفُ البدلِ في الجزءِ الأخيرِ يمنح الأفعالَ كلَّها", () => {
    const wide = { ...validUser, scopes: ["orders:order:*"] };
    expect(hasScope(wide, "orders:order:delete")).toBe(true);
  });

  it("لا يوجد بدلٌ مطلقٌ يفتح النظامَ كلَّه", () => {
    const star = { ...validUser, scopes: ["orders:order:*"] };
    expect(hasScope(star, "billing:invoice:read")).toBe(false);
    const bogus = { ...validUser, scopes: ["orders:*:*"] };
    expect(hasScope(bogus, "billing:invoice:read")).toBe(false);
  });

  it("المجهولُ لا يملك صلاحيّةً قطّ", () => {
    expect(scopesOf(anonymous())).toEqual([]);
    expect(hasScope(anonymous(), "orders:order:read")).toBe(false);
  });

  it("hasAllScopes اقترانُ «و» لا «أو»", () => {
    expect(
      hasAllScopes(validUser, ["orders:order:read", "orders:order:create"]),
    ).toBe(true);
    expect(
      hasAllScopes(validUser, ["orders:order:read", "orders:order:delete"]),
    ).toBe(false);
  });

  it("الأدوارُ للفاعلِ البشريِّ فقط", () => {
    expect(hasRole(validUser, "customer")).toBe(true);
    expect(hasRole(validUser, "admin")).toBe(false);
    expect(hasRole(validService, "customer")).toBe(false);
  });
});

describe("assertScopes — ترتيبُ الأبواب", () => {
  it("يمرّ عندَ اكتمالِ الهويّةِ والصلاحيّة", () => {
    expect(() =>
      assertScopes(validUser, ["orders:order:read"], BEFORE_EXPIRY),
    ).not.toThrow();
  });

  it("المجهولُ يُرفَض بـUNAUTHENTICATED لا بـFORBIDDEN", () => {
    expect(codeOf(() => assertScopes(anonymous(), [], BEFORE_EXPIRY))).toBe(
      "AUTHN_UNAUTHENTICATED",
    );
  });

  it("المنتهي يُرفَض بـEXPIRED قبلَ فحصِ الصلاحيّة", () => {
    expect(
      codeOf(() =>
        assertScopes(validUser, ["orders:order:delete"], AFTER_EXPIRY),
      ),
    ).toBe("AUTHN_EXPIRED");
  });

  it("نقصُ الصلاحيّةِ يُرفَض بـFORBIDDEN", () => {
    expect(
      codeOf(() =>
        assertScopes(validUser, ["orders:order:delete"], BEFORE_EXPIRY),
      ),
    ).toBe("AUTHZ_FORBIDDEN");
  });
});

describe("الجهةُ المقصودةُ بالرمز", () => {
  it("يقبل رمزاً مُوجَّهاً إلى هذه الخدمة", () => {
    expect(() => assertAudience(validService, "orders")).not.toThrow();
  });

  it("يرفض إعادةَ استخدامِ الرمزِ على خدمةٍ أخرى", () => {
    expect(codeOf(() => assertAudience(validService, "billing"))).toBe(
      "AUTHN_AUDIENCE_MISMATCH",
    );
  });

  it("لا يُقيَّد الفاعلُ البشريُّ بجهةٍ مقصودةٍ هنا", () => {
    expect(() => assertAudience(validUser, "billing")).not.toThrow();
  });
});

describe("مِلكيّةُ الكائنِ ومنعُ IDOR", () => {
  it("صاحبُ الكائنِ يُقبَل", () => {
    expect(() => assertObjectOwner(validUser, "WSL-0000123")).not.toThrow();
  });

  it("غيرُ الصاحبِ يُرفَض بـNOT_OWNER", () => {
    expect(codeOf(() => assertObjectOwner(validUser, "WSL-0000999"))).toBe(
      "AUTHZ_NOT_OWNER",
    );
  });

  it("المجهولُ لا يملك شيئاً", () => {
    expect(codeOf(() => assertObjectOwner(anonymous(), "WSL-0000123"))).toBe(
      "AUTHZ_NOT_OWNER",
    );
  });

  it("الإداريُّ لا يُستثنى ضمنيّاً — بل بصلاحيّةٍ صريحةٍ يُمرِّرها المُنادي", () => {
    const admin = {
      ...validUser,
      actor: "admin" as const,
      roles: ["admin"],
      scopes: ["orders:order:read_any"],
    };
    expect(codeOf(() => assertObjectOwner(admin, "WSL-0000999"))).toBe(
      "AUTHZ_NOT_OWNER",
    );
    expect(() =>
      assertObjectOwner(admin, "WSL-0000999", "orders:order:read_any"),
    ).not.toThrow();
  });

  it("تجاوزٌ مُطلَبٌ ولا يملكه الفاعلُ لا يفتح الباب", () => {
    expect(
      codeOf(() =>
        assertObjectOwner(validUser, "WSL-0000999", "orders:order:read_any"),
      ),
    ).toBe("AUTHZ_NOT_OWNER");
  });

  it("خدمةٌ تنوب عن مستخدمٍ تُنسَب إليه المِلكيّة", () => {
    const delegated = { ...validService, onBehalfOfPublicId: "WSL-0000123" };
    expect(ownerPublicIdOf(delegated)).toBe("WSL-0000123");
    expect(() => assertObjectOwner(delegated, "WSL-0000123")).not.toThrow();
  });

  it("خدمةٌ بلا نيابةٍ لا تُنسَب إليها مِلكيّةُ أحد", () => {
    expect(ownerPublicIdOf(validService)).toBeUndefined();
    expect(codeOf(() => assertObjectOwner(validService, "WSL-0000123"))).toBe(
      "AUTHZ_NOT_OWNER",
    );
  });
});

describe("حدُّ المستأجر", () => {
  const partner = {
    ...validUser,
    actor: "partner" as const,
    tenantId: "STORE-42",
  };

  it("يقبل مستأجرَه", () => {
    expect(() => assertTenant(partner, "STORE-42")).not.toThrow();
  });

  it("يرفض مستأجراً آخر", () => {
    expect(codeOf(() => assertTenant(partner, "STORE-43"))).toBe(
      "AUTHZ_NOT_OWNER",
    );
  });

  it("فاعلٌ بلا مستأجرٍ لا يرى بياناتِ أيِّ مستأجر", () => {
    expect(codeOf(() => assertTenant(validUser, "STORE-42"))).toBe(
      "AUTHZ_NOT_OWNER",
    );
  });
});
