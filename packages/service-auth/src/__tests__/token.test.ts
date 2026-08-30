/**
 * رمزُ هويّةِ الخدمة (M1-03) — المِنتاجُ والتحقُّق.
 *
 * كلُّ حالةٍ هنا تُثبِت **حارساً** لا مسلكاً سعيداً: لا خوارزميّةَ يختارها
 * المُنادي · توقيعٌ قبلَ الدلالةِ · جمهورٌ مُلزِمٌ · ربطٌ بالطلبِ · حدُّ عمرٍ
 * يُفحَص عندَ المُتحقِّقِ أيضاً.
 */

import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ServiceAuthError } from "../errors.js";
import { MIN_SECRET_BYTES, ServiceAuthKeyRegistry } from "../keys.js";
import {
  canonicalRequestBinding,
  MAX_SERVICE_TOKEN_TTL_SECONDS,
  mintServiceToken,
  SERVICE_TOKEN_SCHEME,
  verifyServiceToken,
} from "../token.js";

const SECRET = "k".repeat(MIN_SECRET_BYTES);
const OTHER_SECRET = "z".repeat(MIN_SECRET_BYTES);

const keys = new ServiceAuthKeyRegistry({
  keys: [{ kid: "k1", secret: SECRET }],
  activeKid: "k1",
});

/** سجلٌّ لمُهاجمٍ يملك مفتاحاً بمعرِّفٍ مطابقٍ وسرٍّ مختلف. */
const forgedKeys = new ServiceAuthKeyRegistry({
  keys: [{ kid: "k1", secret: OTHER_SECRET }],
  activeKid: "k1",
});

const NOW = new Date("2026-08-30T12:00:00.000Z");

const mintDefaults = {
  serviceName: "customers",
  audience: "identity",
  method: "GET",
  path: "/identity/users/pub_123",
  keys,
  now: NOW,
} as const;

const verifyDefaults = {
  audience: "identity",
  method: "GET",
  path: "/identity/users/pub_123",
  keys,
  now: NOW,
} as const;

function reject(fn: () => unknown): ServiceAuthError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceAuthError);
    return error as ServiceAuthError;
  }
  throw new Error("كان يجب أن يُرفَض");
}

/** يُعيد بناءَ رمزٍ بحِمْلٍ مُعدَّلٍ، مُوقَّعاً بالسجلِّ المُعطى. */
function retamper(
  token: string,
  mutate: (payload: Record<string, unknown>) => void,
  signWith: ServiceAuthKeyRegistry | undefined,
): string {
  const [, encodedPayload] = token.split(".");
  const payload = JSON.parse(
    Buffer.from(encodedPayload as string, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  mutate(payload);
  const nextEncoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  if (signWith === undefined) {
    // يُبقي التوقيعَ القديمَ — أي حِمْلٌ مُعدَّلٌ بتوقيعٍ لا يُطابقه.
    const [, , signature] = token.split(".");
    return `${SERVICE_TOKEN_SCHEME}.${nextEncoded}.${signature}`;
  }
  const signature = createHmac("sha256", signWith.activeSecret())
    .update(`${SERVICE_TOKEN_SCHEME}.${nextEncoded}`)
    .digest("base64url");
  return `${SERVICE_TOKEN_SCHEME}.${nextEncoded}.${signature}`;
}

describe("canonicalRequestBinding", () => {
  it("يُكبِّر الطريقةَ ويُسقِط سلسلةَ الاستعلامِ والشرطةَ الأخيرة", () => {
    expect(canonicalRequestBinding("get", "/a/b/?x=1")).toBe("GET /a/b");
    expect(canonicalRequestBinding("post", "/a/b")).toBe("POST /a/b");
  });

  it("يُبقي الجذرَ شرطةً واحدةً ولا يُفرِّغه", () => {
    expect(canonicalRequestBinding("GET", "/")).toBe("GET /");
    expect(canonicalRequestBinding("GET", "")).toBe("GET /");
    expect(canonicalRequestBinding("GET", "?q=1")).toBe("GET /");
  });

  it("لا يُطبِّع حالةَ أحرفِ المسار — المساراتُ حسّاسةٌ للحالةِ في HTTP", () => {
    expect(canonicalRequestBinding("GET", "/Users")).not.toBe("GET /users");
  });
});

describe("mintServiceToken — الرفضُ عندَ المِنتاج", () => {
  it("يرفض اسمَ خدمةٍ لا يطابق صيغةَ services/<name>", () => {
    for (const serviceName of ["", "Customers", "1customers", "cus_tomers", "a"]) {
      expect(() =>
        mintServiceToken({ ...mintDefaults, serviceName }),
      ).toThrow(TypeError);
    }
  });

  it("يرفض جمهوراً غيرَ صالحٍ", () => {
    expect(() =>
      mintServiceToken({ ...mintDefaults, audience: "Identity" }),
    ).toThrow(TypeError);
  });

  it("يرفض عمراً فوقَ الحدِّ الأقصى", () => {
    expect(() =>
      mintServiceToken({
        ...mintDefaults,
        ttlSeconds: MAX_SERVICE_TOKEN_TTL_SECONDS + 1,
      }),
    ).toThrow(/يتجاوز الحدَّ/);
  });

  it("يقبل الحدَّ الأقصى بالضبطِ — الحدُّ شاملٌ", () => {
    expect(() =>
      mintServiceToken({
        ...mintDefaults,
        ttlSeconds: MAX_SERVICE_TOKEN_TTL_SECONDS,
      }),
    ).not.toThrow();
  });

  it("يرفض عمراً غيرَ صحيحٍ أو غيرَ موجبٍ", () => {
    for (const ttlSeconds of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        mintServiceToken({ ...mintDefaults, ttlSeconds }),
      ).toThrow(TypeError);
    }
  });

  it("يرفض لحظةً غيرَ صالحةٍ", () => {
    expect(() =>
      mintServiceToken({ ...mintDefaults, now: new Date("غير صالح") }),
    ).toThrow(TypeError);
  });
});

describe("mintServiceToken — الصيغة", () => {
  it("ثلاثةُ أقسامٍ ببادئةِ النسخةِ ولا ترويسةَ خوارزميّةٍ", () => {
    const token = mintServiceToken(mintDefaults);
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(SERVICE_TOKEN_SCHEME);
    const payload = JSON.parse(
      Buffer.from(parts[1] as string, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("alg");
    expect(payload).not.toHaveProperty("typ");
    expect(Object.keys(payload).sort()).toEqual(
      ["aud", "exp", "iat", "kid", "req", "scp", "svc"].sort(),
    );
  });

  it("لا يحمل الحقلَ الاختياريَّ إن لم يُمرَّر", () => {
    const token = mintServiceToken(mintDefaults);
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] as string, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("obo");
  });

  it("لا يُسرِّب السرَّ في الرمز", () => {
    expect(mintServiceToken(mintDefaults)).not.toContain(SECRET);
  });
});

describe("verifyServiceToken — المسلكُ المُثبَت", () => {
  it("يُسلِّم ServicePrincipal بالشكلِ الموحَّدِ من ADR-018", () => {
    const token = mintServiceToken({
      ...mintDefaults,
      scopes: ["identity:users:read"],
    });
    const principal = verifyServiceToken(token, verifyDefaults);
    expect(principal.kind).toBe("service");
    expect(principal.serviceName).toBe("customers");
    expect(principal.audience).toBe("identity");
    expect(principal.scopes).toEqual(["identity:users:read"]);
    expect(principal.issuedAt).toBe("2026-08-30T12:00:00.000Z");
    expect(principal.expiresAt).toBe("2026-08-30T12:01:00.000Z");
    expect(principal.onBehalfOfPublicId).toBeUndefined();
  });

  it("يُمرِّر «نيابةً عن» بالمعرِّفِ العامِّ وحدَه", () => {
    const token = mintServiceToken({
      ...mintDefaults,
      onBehalfOfPublicId: "pub_123",
    });
    expect(verifyServiceToken(token, verifyDefaults).onBehalfOfPublicId).toBe(
      "pub_123",
    );
  });

  it("يُطبِّع الربطَ فيقبل الطريقةَ بحالةٍ مختلفةٍ وسلسلةَ استعلامٍ زائدةً", () => {
    const token = mintServiceToken(mintDefaults);
    expect(() =>
      verifyServiceToken(token, {
        ...verifyDefaults,
        method: "get",
        path: "/identity/users/pub_123?trace=1",
      }),
    ).not.toThrow();
  });
});

describe("verifyServiceToken — الأبوابُ بترتيبِها", () => {
  it("يرفض عددَ أقسامٍ خاطئاً", () => {
    for (const token of ["", "a", "a.b", "a.b.c.d"]) {
      expect(reject(() => verifyServiceToken(token, verifyDefaults)).reason).toBe(
        "malformed_token",
      );
    }
  });

  it("يرفض بادئةً غيرَ مدعومةٍ قبلَ فكِّ أيِّ ترميزٍ", () => {
    const token = mintServiceToken(mintDefaults);
    const [, payload, signature] = token.split(".");
    expect(
      reject(() =>
        verifyServiceToken(`wsvc2.${payload}.${signature}`, verifyDefaults),
      ).reason,
    ).toBe("unsupported_scheme");
  });

  it("يرفض رمزَ JWT مصوغاً بحقلِ alg — لا خوارزميّةَ يختارها المُنادي", () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
      "utf8",
    ).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ svc: "customers", aud: "identity" }),
      "utf8",
    ).toString("base64url");
    expect(
      reject(() => verifyServiceToken(`${header}.${body}.`, verifyDefaults))
        .reason,
    ).toBe("unsupported_scheme");
  });

  it("يرفض قسماً فارغاً", () => {
    expect(
      reject(() =>
        verifyServiceToken(`${SERVICE_TOKEN_SCHEME}..sig`, verifyDefaults),
      ).reason,
    ).toBe("malformed_token");
  });

  it("يرفض حِمْلاً ليس JSON أو ليس كائناً", () => {
    const notJson = Buffer.from("ليس json", "utf8").toString("base64url");
    expect(
      reject(() =>
        verifyServiceToken(
          `${SERVICE_TOKEN_SCHEME}.${notJson}.sig`,
          verifyDefaults,
        ),
      ).reason,
    ).toBe("malformed_token");

    const array = Buffer.from("[1,2]", "utf8").toString("base64url");
    expect(
      reject(() =>
        verifyServiceToken(
          `${SERVICE_TOKEN_SCHEME}.${array}.sig`,
          verifyDefaults,
        ),
      ).reason,
    ).toBe("invalid_claims");
  });

  it("يرفض كلَّ حقلٍ إلزاميٍّ ناقصاً أو مشوَّهاً", () => {
    const token = mintServiceToken(mintDefaults);
    const cases: ReadonlyArray<(p: Record<string, unknown>) => void> = [
      (p) => delete p.kid,
      (p) => delete p.svc,
      (p) => delete p.aud,
      (p) => delete p.scp,
      (p) => delete p.iat,
      (p) => delete p.exp,
      (p) => delete p.req,
      (p) => (p.svc = "Not-A-Service"),
      (p) => (p.aud = ""),
      (p) => (p.scp = "identity:users:read"),
      (p) => (p.scp = ["", "ok"]),
      (p) => (p.iat = "12"),
      (p) => (p.exp = -1),
      (p) => (p.iat = Number.MAX_SAFE_INTEGER + 2),
      (p) => (p.req = ""),
      (p) => (p.obo = ""),
      (p) => (p.exp = p.iat),
    ];
    for (const mutate of cases) {
      const reason = reject(() =>
        verifyServiceToken(retamper(token, mutate, keys), verifyDefaults),
      ).reason;
      expect(reason).toBe("invalid_claims");
    }
  });

  it("يرفض مفتاحاً مجهولاً", () => {
    const token = mintServiceToken(mintDefaults);
    expect(
      reject(() =>
        verifyServiceToken(retamper(token, (p) => (p.kid = "ghost"), keys), {
          ...verifyDefaults,
        }),
      ).reason,
    ).toBe("unknown_key");
  });

  it("يرفض توقيعاً لا يُطابق — حِمْلٌ مُعدَّلٌ بتوقيعٍ قديمٍ", () => {
    const token = mintServiceToken(mintDefaults);
    expect(
      reject(() =>
        verifyServiceToken(
          retamper(token, (p) => (p.svc = "orders"), undefined),
          verifyDefaults,
        ),
      ).reason,
    ).toBe("bad_signature");
  });

  it("يرفض رمزاً مُوقَّعاً بسرٍّ آخرَ بنفسِ معرِّفِ المفتاح", () => {
    const forged = mintServiceToken({ ...mintDefaults, keys: forgedKeys });
    expect(
      reject(() => verifyServiceToken(forged, verifyDefaults)).reason,
    ).toBe("bad_signature");
  });

  it("يرفض توقيعاً بطولٍ مختلفٍ بلا أن يرمي خطأً غيرَ مُصنَّفٍ", () => {
    const token = mintServiceToken(mintDefaults);
    const [, payload] = token.split(".");
    expect(
      reject(() =>
        verifyServiceToken(
          `${SERVICE_TOKEN_SCHEME}.${payload}.QUJD`,
          verifyDefaults,
        ),
      ).reason,
    ).toBe("bad_signature");
  });

  it("لا يُفصِح عن سببٍ دلاليٍّ قبلَ إثباتِ التوقيع", () => {
    // رمزٌ منتهٍ **ومُوقَّعٌ بسرٍّ خاطئٍ**: السببُ يجب أن يكون التوقيعَ لا الانتهاءَ.
    const forged = mintServiceToken({
      ...mintDefaults,
      keys: forgedKeys,
      now: new Date(NOW.getTime() - 3600_000),
    });
    expect(
      reject(() => verifyServiceToken(forged, verifyDefaults)).reason,
    ).toBe("bad_signature");
  });
});

describe("verifyServiceToken — الزمنُ والعمر", () => {
  it("يرفض رمزاً انتهى، والحدُّ غيرُ شاملٍ", () => {
    const token = mintServiceToken({ ...mintDefaults, ttlSeconds: 60 });
    // exp = NOW + 60ث بالضبط ⇒ منتهٍ عندَ تلك اللحظةِ نفسِها.
    const atExpiry = new Date(NOW.getTime() + 60_000);
    expect(
      reject(() =>
        verifyServiceToken(token, { ...verifyDefaults, now: atExpiry }),
      ).reason,
    ).toBe("expired");
    // وثانيةٌ قبلَها صالحٌ.
    expect(() =>
      verifyServiceToken(token, {
        ...verifyDefaults,
        now: new Date(NOW.getTime() + 59_000),
      }),
    ).not.toThrow();
  });

  it("يقبل انحرافَ ساعةٍ داخلَ الهامشِ ويرفض ما فوقَه", () => {
    const future = mintServiceToken({
      ...mintDefaults,
      now: new Date(NOW.getTime() + 60_000),
    });
    expect(() =>
      verifyServiceToken(future, { ...verifyDefaults, clockSkewSeconds: 60 }),
    ).not.toThrow();
    expect(
      reject(() =>
        verifyServiceToken(future, { ...verifyDefaults, clockSkewSeconds: 59 }),
      ).reason,
    ).toBe("issued_in_future");
  });

  it("يرفض عمراً مُعلَناً فوقَ الحدِّ ولو كان التوقيعُ صحيحاً", () => {
    // مِنتاجٌ يملك المفتاحَ لكنّه لا يحترم الحدَّ — المُتحقِّقُ يرفض بنفسِه.
    const token = mintServiceToken(mintDefaults);
    const longLived = retamper(
      token,
      (p) => (p.exp = (p.iat as number) + MAX_SERVICE_TOKEN_TTL_SECONDS + 1),
      keys,
    );
    expect(
      reject(() => verifyServiceToken(longLived, verifyDefaults)).reason,
    ).toBe("lifetime_too_long");
  });

  it("يرمي على لحظةٍ غيرِ صالحةٍ ولا يُعامِلها رفضَ إثباتٍ", () => {
    const token = mintServiceToken(mintDefaults);
    expect(() =>
      verifyServiceToken(token, {
        ...verifyDefaults,
        now: new Date("غير صالح"),
      }),
    ).toThrow(TypeError);
  });
});

describe("verifyServiceToken — الجمهورُ والربطُ بالطلب", () => {
  it("يرفض رمزاً موجَّهاً إلى خدمةٍ أخرى", () => {
    const token = mintServiceToken({ ...mintDefaults, audience: "orders" });
    expect(
      reject(() => verifyServiceToken(token, verifyDefaults)).reason,
    ).toBe("audience_mismatch");
  });

  it("يرفض إعادةَ استخدامِ رمزِ قراءةٍ على مسارٍ آخرَ", () => {
    const token = mintServiceToken(mintDefaults);
    expect(
      reject(() =>
        verifyServiceToken(token, {
          ...verifyDefaults,
          path: "/identity/users/pub_999",
        }),
      ).reason,
    ).toBe("request_binding_mismatch");
  });

  it("يرفض إعادةَ استخدامِ رمزِ قراءةٍ بطريقةٍ أخرى", () => {
    const token = mintServiceToken(mintDefaults);
    expect(
      reject(() =>
        verifyServiceToken(token, { ...verifyDefaults, method: "DELETE" }),
      ).reason,
    ).toBe("request_binding_mismatch");
  });
});

describe("التدويرُ بلا انقطاع", () => {
  it("يتحقَّق من رمزٍ مُوقَّعٍ بالمفتاحِ السابقِ بعدَ تبديلِ النشط", () => {
    const before = new ServiceAuthKeyRegistry({
      keys: [{ kid: "old", secret: `${SECRET}-old` }],
      activeKid: "old",
    });
    const after = new ServiceAuthKeyRegistry({
      keys: [
        { kid: "old", secret: `${SECRET}-old` },
        { kid: "new", secret: `${SECRET}-new` },
      ],
      activeKid: "new",
    });
    const oldToken = mintServiceToken({ ...mintDefaults, keys: before });
    expect(() =>
      verifyServiceToken(oldToken, { ...verifyDefaults, keys: after }),
    ).not.toThrow();

    // وبعدَ إسقاطِ المفتاحِ القديمِ يُرفَض — فالتدويرُ يُكمِل دورتَه.
    const rotated = new ServiceAuthKeyRegistry({
      keys: [{ kid: "new", secret: `${SECRET}-new` }],
      activeKid: "new",
    });
    expect(
      reject(() =>
        verifyServiceToken(oldToken, { ...verifyDefaults, keys: rotated }),
      ).reason,
    ).toBe("unknown_key");
  });
});
