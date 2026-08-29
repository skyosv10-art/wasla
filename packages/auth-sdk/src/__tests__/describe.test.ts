import { describe, expect, it } from "vitest";

import { anonymous, describePrincipal } from "../index.js";
import { validService, validUser } from "./fixtures.js";

describe("describePrincipal — تمثيلٌ آمنٌ للسجلّات", () => {
  it("لا يُخرِج المعرِّفَ الداخليَّ ولا معرِّفَ الجلسةِ الخام", () => {
    const serialized = JSON.stringify(describePrincipal(validUser));
    expect(serialized).not.toContain(validUser.internalUuid);
    expect(serialized).not.toContain(validUser.sessionId);
  });

  it("يُخرِج المعرِّفَ العامَّ ونوعَ الفاعلِ وعددَ الصلاحيّاتِ لا قائمتَها", () => {
    const described = describePrincipal(validUser);
    expect(described.publicId).toBe("WSL-0000123");
    expect(described.actor).toBe("customer");
    expect(described.scopeCount).toBe(2);
    expect(JSON.stringify(described)).not.toContain("orders:order:create");
  });

  it("بصمةُ الجلسةِ حتميّةٌ وقصيرةٌ ولا تُستعمَل رمزاً", () => {
    const first = describePrincipal(validUser).sessionFingerprint;
    const second = describePrincipal({ ...validUser }).sessionFingerprint;
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}$/);
  });

  it("جلستان مختلفتان تُعطيان بصمتَين مختلفتَين", () => {
    const other = describePrincipal({ ...validUser, sessionId: "sess_02ABC" });
    expect(other.sessionFingerprint).not.toBe(
      describePrincipal(validUser).sessionFingerprint,
    );
  });

  it("المجهولُ لا يحمل أيَّ حقلٍ يُعرِّف", () => {
    expect(describePrincipal(anonymous())).toEqual({
      kind: "anonymous",
      scopeCount: 0,
    });
  });

  it("الخدمةُ تُوصَف باسمِها، والنيابةُ تُظهِر المعرِّفَ العامَّ وحدَه", () => {
    expect(describePrincipal(validService)).toEqual({
      kind: "service",
      actor: "dispatch",
      scopeCount: 1,
      expiresAt: validService.expiresAt,
    });
    const delegated = describePrincipal({
      ...validService,
      onBehalfOfPublicId: "WSL-0000123",
    });
    expect(delegated.publicId).toBe("WSL-0000123");
  });
});
