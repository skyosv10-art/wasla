/**
 * سجلُّ المفاتيح (M1-03) — يُختبَر أنّه **يُفشِل الإقلاعَ** لا الطلبَ، وأنّ
 * دورةَ حياةِ المفتاحِ (ADR-022) مفروضةٌ في البناءِ لا موصوفةٌ في وثيقةٍ.
 */

import { describe, expect, it } from "vitest";

import {
  keyRegistryFromEnv,
  MIN_SECRET_BYTES,
  ServiceAuthKeyError,
  ServiceAuthKeyRegistry,
} from "../keys.js";

const STRONG = "x".repeat(MIN_SECRET_BYTES);

describe("ServiceAuthKeyRegistry — الرفضُ عندَ البناء", () => {
  it("يرفض سجلاً فارغاً", () => {
    expect(
      () => new ServiceAuthKeyRegistry({ keys: [], activeKid: "k1" }),
    ).toThrow(ServiceAuthKeyError);
  });

  it("يرفض سرّاً أقصرَ من الحدِّ الأدنى", () => {
    expect(
      () =>
        new ServiceAuthKeyRegistry({
          keys: [
            { kid: "k1", secret: "x".repeat(MIN_SECRET_BYTES - 1), status: "active" },
          ],
          activeKid: "k1",
        }),
    ).toThrow(/أقصرُ من الحدِّ الأدنى/);
  });

  it("يقبل سرّاً بطولِ الحدِّ الأدنى بالضبط — الحدُّ شاملٌ", () => {
    expect(
      () =>
        new ServiceAuthKeyRegistry({
          keys: [{ kid: "k1", secret: STRONG, status: "active" }],
          activeKid: "k1",
        }),
    ).not.toThrow();
  });

  it("لا يُسرِّب السرَّ في رسالةِ الخطأ", () => {
    const secret = "sup3r-secret-but-short";
    try {
      new ServiceAuthKeyRegistry({
        keys: [{ kid: "k1", secret, status: "active" }],
        activeKid: "k1",
      });
      expect.unreachable("كان يجب أن يرمي");
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).not.toContain("sup3r");
    }
  });

  it("يرفض معرِّفَ مفتاحٍ مكرَّراً", () => {
    expect(
      () =>
        new ServiceAuthKeyRegistry({
          keys: [
            { kid: "k1", secret: STRONG, status: "active" },
            { kid: "k1", secret: `${STRONG}2`, status: "verify_only" },
          ],
          activeKid: "k1",
        }),
    ).toThrow(/مكرَّرٌ/);
  });

  it("يرفض معرِّفاً لا يطابق الصيغة", () => {
    for (const kid of ["", "has space", "has.dot", "x".repeat(65)]) {
      expect(
        () =>
          new ServiceAuthKeyRegistry({
            keys: [{ kid, secret: STRONG, status: "active" }],
            activeKid: kid,
          }),
      ).toThrow(ServiceAuthKeyError);
    }
  });

  it("يرفض مفتاحاً نشطاً غيرَ موجودٍ في المفاتيحِ المعروفة", () => {
    expect(
      () =>
        new ServiceAuthKeyRegistry({
          keys: [{ kid: "k1", secret: STRONG, status: "active" }],
          activeKid: "k2",
        }),
    ).toThrow(/غيرُ موجودٍ/);
  });

  it("يرفض حالاً غيرَ معروفٍ", () => {
    expect(
      () =>
        new ServiceAuthKeyRegistry({
          // إعدادٌ يأتي من متغيّرِ بيئةٍ قد يحمل نصّاً حرّاً، فالحرسُ في وقتِ
          // التشغيلِ لا في النوعِ وحدَه.
          keys: [{ kid: "k1", secret: STRONG, status: "retired" as never }],
          activeKid: "k1",
        }),
    ).toThrow(/حالُ المفتاحِ/);
  });
});

describe("ServiceAuthKeyRegistry — دورةُ حياةِ المفتاح (ADR-022)", () => {
  it("يرفض سجلاً بلا مفتاحٍ نشطٍ — لا مِنتاجَ بلا توقيع", () => {
    expect(
      () =>
        new ServiceAuthKeyRegistry({
          keys: [
            { kid: "old", secret: `${STRONG}-old`, status: "verify_only" },
            { kid: "gone", secret: "", status: "revoked" },
          ],
          activeKid: "old",
        }),
    ).toThrow(/لا مفتاحَ حالُه active/);
  });

  it("يرفض مفتاحَينِ نشطَينِ — الغموضُ في أيِّهما وُقِّع يُفسِد التحقيق", () => {
    expect(
      () =>
        new ServiceAuthKeyRegistry({
          keys: [
            { kid: "a", secret: `${STRONG}-a`, status: "active" },
            { kid: "b", secret: `${STRONG}-b`, status: "active" },
          ],
          activeKid: "a",
        }),
    ).toThrow(/أكثرُ من مفتاحٍ حالُه active/);
  });

  it("يرفض أن يكون المفتاحُ النشطُ المُعلَنُ حالُه verify_only", () => {
    expect(
      () =>
        new ServiceAuthKeyRegistry({
          keys: [
            { kid: "old", secret: `${STRONG}-old`, status: "verify_only" },
            { kid: "new", secret: `${STRONG}-new`, status: "active" },
          ],
          activeKid: "old",
        }),
    ).toThrow(/حالُه «verify_only»/);
  });

  it("نافذةُ التحقُّقِ المزدوجِ: القديمُ يُتحقَّق به ولا يُوقَّع به", () => {
    const registry = new ServiceAuthKeyRegistry({
      keys: [
        { kid: "old", secret: `${STRONG}-old`, status: "verify_only" },
        { kid: "new", secret: `${STRONG}-new`, status: "active" },
      ],
      activeKid: "new",
    });
    expect(registry.activeSecret()).toBe(`${STRONG}-new`);
    expect(registry.resolveVerificationKey("old")).toEqual({
      status: "usable",
      secret: `${STRONG}-old`,
    });
    expect(registry.verifiableKids()).toEqual(["old", "new"]);
  });

  it("المفتاحُ المسحوبُ يُفرَق عن المجهولِ — وهو أوّلُ سؤالٍ في تحقيقِ حادثة", () => {
    const registry = new ServiceAuthKeyRegistry({
      keys: [
        { kid: "stolen", secret: "", status: "revoked" },
        { kid: "new", secret: `${STRONG}-new`, status: "active" },
      ],
      activeKid: "new",
    });
    expect(registry.resolveVerificationKey("stolen")).toEqual({ status: "revoked" });
    expect(registry.resolveVerificationKey("ghost")).toEqual({ status: "unknown" });
    expect(registry.verifiableKids()).toEqual(["new"]);
  });

  it("المسحوبُ لا يُشترَط طولُ سرِّه — لأنّ سرَّه يجب أن يُحذَف من الإعداد", () => {
    expect(
      () =>
        new ServiceAuthKeyRegistry({
          keys: [
            { kid: "stolen", secret: "short", status: "revoked" },
            { kid: "new", secret: `${STRONG}-new`, status: "active" },
          ],
          activeKid: "new",
        }),
    ).not.toThrow();
  });

  it("ولا يُبقي سرَّ المسحوبِ في الذاكرةِ ولو مُرِّر", () => {
    const registry = new ServiceAuthKeyRegistry({
      keys: [
        { kid: "stolen", secret: `${STRONG}-leak`, status: "revoked" },
        { kid: "new", secret: `${STRONG}-new`, status: "active" },
      ],
      activeKid: "new",
    });
    expect(JSON.stringify(registry.describeKeys())).not.toContain("leak");
    expect(
      registry.describeKeys().find((key) => key.kid === "stolen")?.secretBytes,
    ).toBe(0);
  });
});

describe("ServiceAuthKeyRegistry — القراءةُ والتدوير", () => {
  const registry = new ServiceAuthKeyRegistry({
    keys: [
      { kid: "old", secret: `${STRONG}-old`, status: "verify_only" },
      { kid: "new", secret: `${STRONG}-new`, status: "active" },
    ],
    activeKid: "new",
  });

  it("يُوقِّع بالمفتاحِ النشطِ ويعرف المفتاحَ السابقَ — نافذةُ تدويرٍ بلا انقطاع", () => {
    expect(registry.activeKid).toBe("new");
    expect(registry.activeSecret()).toBe(`${STRONG}-new`);
    expect(registry.resolveVerificationKey("old")).toEqual({
      status: "usable",
      secret: `${STRONG}-old`,
    });
  });

  it("يردُّ «مجهولٌ» لمفتاحٍ غيرِ معروفٍ ولا يرمي — القرارُ للمُتحقِّق", () => {
    expect(registry.resolveVerificationKey("ghost")).toEqual({ status: "unknown" });
  });

  it("describeKeys لا يحمل سرّاً ويُعلِن الحال", () => {
    const described = registry.describeKeys();
    expect(described).toHaveLength(2);
    expect(JSON.stringify(described)).not.toContain(STRONG);
    expect(described.filter((k) => k.active)).toHaveLength(1);
    expect(described.map((k) => k.status)).toEqual(["verify_only", "active"]);
    expect(described[0]?.secretBytes).toBeGreaterThanOrEqual(MIN_SECRET_BYTES);
  });
});

describe("keyRegistryFromEnv", () => {
  it("يقرأ مفاتيحَ عدّةً بحالاتِها ويحدِّد النشطَ", () => {
    const registry = keyRegistryFromEnv({
      WASLA_SERVICE_AUTH_KEYS: `k1:verify_only:${STRONG}-a, k2:active:${STRONG}-b`,
      WASLA_SERVICE_AUTH_ACTIVE_KID: "k2",
    });
    expect(registry.activeKid).toBe("k2");
    expect(registry.resolveVerificationKey("k1")).toEqual({
      status: "usable",
      secret: `${STRONG}-a`,
    });
  });

  it("يقرأ مفتاحاً مسحوباً بلا سرٍّ — `kid:revoked:`", () => {
    const registry = keyRegistryFromEnv({
      WASLA_SERVICE_AUTH_KEYS: `k1:revoked:, k2:active:${STRONG}-b`,
      WASLA_SERVICE_AUTH_ACTIVE_KID: "k2",
    });
    expect(registry.resolveVerificationKey("k1")).toEqual({ status: "revoked" });
  });

  it("لا يقطع السرَّ عندَ النقطتَينِ التي بعدَ الحال", () => {
    const secret = `${STRONG}:with:colons`;
    const registry = keyRegistryFromEnv({
      WASLA_SERVICE_AUTH_KEYS: `k1:active:${secret}`,
      WASLA_SERVICE_AUTH_ACTIVE_KID: "k1",
    });
    expect(registry.resolveVerificationKey("k1")).toEqual({
      status: "usable",
      secret,
    });
  });

  it("يرفض متغيّراً مفقوداً أو فارغاً", () => {
    expect(() => keyRegistryFromEnv({})).toThrow(/مفقودٌ أو فارغٌ/);
    expect(() =>
      keyRegistryFromEnv({ WASLA_SERVICE_AUTH_KEYS: "   " }),
    ).toThrow(/مفقودٌ أو فارغٌ/);
  });

  it("يرفض الصيغةَ القديمةَ «kid:secret» برسالةٍ تُسمّي التغيير", () => {
    expect(() =>
      keyRegistryFromEnv({
        WASLA_SERVICE_AUTH_KEYS: `k1:${STRONG}`,
        WASLA_SERVICE_AUTH_ACTIVE_KID: "k1",
      }),
    ).toThrow(/kid:status:secret/);
  });

  it("يرفض حالاً مجهولاً في المتغيّر", () => {
    expect(() =>
      keyRegistryFromEnv({
        WASLA_SERVICE_AUTH_KEYS: `k1:enabled:${STRONG}`,
        WASLA_SERVICE_AUTH_ACTIVE_KID: "k1",
      }),
    ).toThrow(/غيرُ معروفٍ/);
  });

  it("يرفض مدخلاً بلا فاصلٍ أو بسرٍّ فارغٍ لغيرِ المسحوب", () => {
    for (const raw of ["k1", ":active:secret", `k1:active:`]) {
      expect(() =>
        keyRegistryFromEnv({
          WASLA_SERVICE_AUTH_KEYS: raw,
          WASLA_SERVICE_AUTH_ACTIVE_KID: "k1",
        }),
      ).toThrow(ServiceAuthKeyError);
    }
  });

  it("يرفض غيابَ المفتاحِ النشط", () => {
    expect(() =>
      keyRegistryFromEnv({ WASLA_SERVICE_AUTH_KEYS: `k1:active:${STRONG}` }),
    ).toThrow(/ACTIVE_KID/);
  });

  it("يقبل أسماءَ متغيّراتٍ بديلةً", () => {
    const registry = keyRegistryFromEnv(
      { KEYS: `k1:active:${STRONG}`, ACTIVE: "k1" },
      { keysVar: "KEYS", activeVar: "ACTIVE" },
    );
    expect(registry.activeKid).toBe("k1");
  });
});
