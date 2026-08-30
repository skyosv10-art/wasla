/**
 * سجلُّ المفاتيح (M1-03) — يُختبَر أنّه **يُفشِل الإقلاعَ** لا الطلبَ.
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
          keys: [{ kid: "k1", secret: "x".repeat(MIN_SECRET_BYTES - 1) }],
          activeKid: "k1",
        }),
    ).toThrow(/أقصرُ من الحدِّ الأدنى/);
  });

  it("يقبل سرّاً بطولِ الحدِّ الأدنى بالضبط — الحدُّ شاملٌ", () => {
    expect(
      () =>
        new ServiceAuthKeyRegistry({
          keys: [{ kid: "k1", secret: STRONG }],
          activeKid: "k1",
        }),
    ).not.toThrow();
  });

  it("لا يُسرِّب السرَّ في رسالةِ الخطأ", () => {
    const secret = "sup3r-secret-but-short";
    try {
      new ServiceAuthKeyRegistry({
        keys: [{ kid: "k1", secret }],
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
            { kid: "k1", secret: STRONG },
            { kid: "k1", secret: `${STRONG}2` },
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
            keys: [{ kid, secret: STRONG }],
            activeKid: kid,
          }),
      ).toThrow(ServiceAuthKeyError);
    }
  });

  it("يرفض مفتاحاً نشطاً غيرَ موجودٍ في المفاتيحِ المعروفة", () => {
    expect(
      () =>
        new ServiceAuthKeyRegistry({
          keys: [{ kid: "k1", secret: STRONG }],
          activeKid: "k2",
        }),
    ).toThrow(/غيرُ موجودٍ/);
  });
});

describe("ServiceAuthKeyRegistry — القراءةُ والتدوير", () => {
  const registry = new ServiceAuthKeyRegistry({
    keys: [
      { kid: "old", secret: `${STRONG}-old` },
      { kid: "new", secret: `${STRONG}-new` },
    ],
    activeKid: "new",
  });

  it("يُوقِّع بالمفتاحِ النشطِ ويعرف المفتاحَ السابقَ — نافذةُ تدويرٍ بلا انقطاع", () => {
    expect(registry.activeKid).toBe("new");
    expect(registry.activeSecret()).toBe(`${STRONG}-new`);
    expect(registry.secretFor("old")).toBe(`${STRONG}-old`);
  });

  it("يردُّ undefined لمفتاحٍ مجهولٍ ولا يرمي — القرارُ للمُتحقِّق", () => {
    expect(registry.secretFor("ghost")).toBeUndefined();
  });

  it("describeKeys لا يحمل سرّاً", () => {
    const described = registry.describeKeys();
    expect(described).toHaveLength(2);
    expect(JSON.stringify(described)).not.toContain(STRONG);
    expect(described.filter((k) => k.active)).toHaveLength(1);
    expect(described[0]?.secretBytes).toBeGreaterThanOrEqual(MIN_SECRET_BYTES);
  });
});

describe("keyRegistryFromEnv", () => {
  it("يقرأ مفاتيحَ عدّةً ويحدِّد النشطَ", () => {
    const registry = keyRegistryFromEnv({
      WASLA_SERVICE_AUTH_KEYS: `k1:${STRONG}-a, k2:${STRONG}-b`,
      WASLA_SERVICE_AUTH_ACTIVE_KID: "k2",
    });
    expect(registry.activeKid).toBe("k2");
    expect(registry.secretFor("k1")).toBe(`${STRONG}-a`);
  });

  it("لا يقطع السرَّ عندَ النقطتَينِ الثانية", () => {
    const secret = `${STRONG}:with:colons`;
    const registry = keyRegistryFromEnv({
      WASLA_SERVICE_AUTH_KEYS: `k1:${secret}`,
      WASLA_SERVICE_AUTH_ACTIVE_KID: "k1",
    });
    expect(registry.secretFor("k1")).toBe(secret);
  });

  it("يرفض متغيّراً مفقوداً أو فارغاً", () => {
    expect(() => keyRegistryFromEnv({})).toThrow(/مفقودٌ أو فارغٌ/);
    expect(() =>
      keyRegistryFromEnv({ WASLA_SERVICE_AUTH_KEYS: "   " }),
    ).toThrow(/مفقودٌ أو فارغٌ/);
  });

  it("يرفض مدخلاً بلا فاصلٍ أو بسرٍّ فارغٍ", () => {
    for (const raw of ["k1", ":secret", "k1:"]) {
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
      keyRegistryFromEnv({ WASLA_SERVICE_AUTH_KEYS: `k1:${STRONG}` }),
    ).toThrow(/ACTIVE_KID/);
  });

  it("يقبل أسماءَ متغيّراتٍ بديلةً", () => {
    const registry = keyRegistryFromEnv(
      { KEYS: `k1:${STRONG}`, ACTIVE: "k1" },
      { keysVar: "KEYS", activeVar: "ACTIVE" },
    );
    expect(registry.activeKid).toBe("k1");
  });
});
