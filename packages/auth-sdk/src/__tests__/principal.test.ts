import { describe, expect, it } from "vitest";

import {
  anonymous,
  isAnonymousPrincipal,
  isServicePrincipal,
  isUserPrincipal,
  parsePrincipal,
  type Principal,
} from "../index.js";

import { validService, validUser } from "./fixtures.js";

describe("حُرّاسُ جنسِ الـPrincipal", () => {
  it("يُميّز الأجناسَ الثلاثةَ بلا تداخل", () => {
    const anon = anonymous();
    const cases: readonly Principal[] = [validUser, validService, anon];
    expect(cases.filter(isUserPrincipal)).toEqual([validUser]);
    expect(cases.filter(isServicePrincipal)).toEqual([validService]);
    expect(cases.filter(isAnonymousPrincipal)).toEqual([anon]);
  });

  it("المجهولُ يُبنى بسببٍ افتراضيٍّ صريحٍ لا بـundefined", () => {
    expect(anonymous()).toEqual({
      kind: "anonymous",
      reason: "no_credentials",
    });
    expect(anonymous("unverified_credentials").reason).toBe(
      "unverified_credentials",
    );
  });
});

describe("parsePrincipal — المسارُ الموجب", () => {
  it("يقرأ فاعلاً بشريّاً كاملاً ويُجمِّدُه", () => {
    const parsed = parsePrincipal(JSON.parse(JSON.stringify(validUser)));
    expect(parsed).toEqual(validUser);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it("يقرأ هويّةَ خدمةٍ ويقبل النيابةَ عن مستخدم", () => {
    const withDelegation = {
      ...validService,
      onBehalfOfPublicId: "WSL-0000123",
    };
    expect(parsePrincipal(withDelegation)).toEqual(withDelegation);
  });

  it("يُسقِط الحقولَ الاختياريّةَ الغائبةَ بدل وضعِ undefined فيها", () => {
    const parsed = parsePrincipal({ ...validService });
    expect("onBehalfOfPublicId" in parsed).toBe(false);
  });

  it("يقبل مستأجراً عندَ الفاعلِ الشريك", () => {
    const partner = {
      ...validUser,
      actor: "partner",
      tenantId: "STORE-42",
      scopes: ["marketplace:store:manage"],
    };
    const parsed = parsePrincipal(partner);
    expect(isUserPrincipal(parsed) && parsed.tenantId).toBe("STORE-42");
  });

  it("يقبل المجهولَ بسببٍ معروف", () => {
    expect(
      parsePrincipal({ kind: "anonymous", reason: "unverified_credentials" }),
    ).toEqual({ kind: "anonymous", reason: "unverified_credentials" });
  });
});

describe("parsePrincipal — المساراتُ السالبة", () => {
  const rejected: readonly (readonly [string, unknown])[] = [
    ["ليس كائناً", "user"],
    ["مصفوفة", [validUser]],
    ["null", null],
    ["جنسٌ غيرُ معروف", { ...validUser, kind: "robot" }],
    ["جنسٌ مفقود", { waslaPublicId: "WSL-1" }],
    ["سببُ مجهوليّةٍ غيرُ معروف", { kind: "anonymous", reason: "because" }],
    ["مجهولٌ بلا سبب", { kind: "anonymous" }],
    ["نوعُ فاعلٍ غيرُ معروف", { ...validUser, actor: "root" }],
    ["قناةٌ غيرُ معروفة", { ...validUser, channel: "fax" }],
    ["معرِّفٌ عامٌّ فارغ", { ...validUser, waslaPublicId: "  " }],
    ["معرِّفٌ داخليٌّ مفقود", { ...validUser, internalUuid: undefined }],
    ["معرِّفُ جلسةٍ مفقود", { ...validUser, sessionId: undefined }],
    ["أدوارٌ ليست قائمة", { ...validUser, roles: "customer" }],
    ["صلاحيّاتٌ ليست قائمة", { ...validUser, scopes: "orders:order:read" }],
    ["صلاحيّةٌ بجزءَين", { ...validUser, scopes: ["orders:read"] }],
    ["صلاحيّةٌ بأربعةِ أجزاء", { ...validUser, scopes: ["a:b:c:d"] }],
    ["صلاحيّةٌ بأحرفٍ كبيرة", { ...validUser, scopes: ["Orders:Order:Read"] }],
    ["صلاحيّةٌ مكرَّرة", { ...validUser, scopes: ["a:b:c", "a:b:c"] }],
    ["صلاحيّةٌ ليست نصّاً", { ...validUser, scopes: [42] }],
    ["تاريخُ إصدارٍ غيرُ صالح", { ...validUser, issuedAt: "أمس" }],
    ["تاريخُ انتهاءٍ مفقود", { ...validUser, expiresAt: undefined }],
    ["اسمُ خدمةٍ بأحرفٍ كبيرة", { ...validService, serviceName: "Dispatch" }],
    ["اسمُ خدمةٍ بمسافة", { ...validService, serviceName: "dispatch svc" }],
    ["جهةٌ مقصودةٌ فارغة", { ...validService, audience: "" }],
    ["نيابةٌ ليست نصّاً", { ...validService, onBehalfOfPublicId: 7 }],
  ];

  for (const [label, input] of rejected) {
    it(`يرفض: ${label}`, () => {
      expect(() => parsePrincipal(input)).toThrowError();
      try {
        parsePrincipal(input);
      } catch (error) {
        expect((error as { code: string }).code).toBe(
          "AUTHN_INVALID_PRINCIPAL",
        );
      }
    });
  }

  it("لا يُترجم الفشلَ إلى مجهولٍ صامت", () => {
    // الحدُّ الذي يمنع تحوّلَ نقصِ الإثباتِ إلى «مستخدمٍ مجهولٍ» مقبولٍ ضمنيّاً.
    expect(() => parsePrincipal({ kind: "user" })).toThrowError();
  });
});
