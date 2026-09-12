/**
 * رصدُ التبعيّةِ المُخزَّنُ — اختباراتُ وحدةٍ (المراجعةُ 15/N · ADR-026 §4.17).
 *
 * الساعةُ مُحقونةٌ والمنفذُ مُحصىً، فما يُقاسُ هنا هوَ **السقفُ** لا الصياغةُ:
 * كم نداءً يبلغُ حدَّ السوقِ لكلِّ نبضاتِ جاهزيّةٍ. اختبارٌ ينتظرُ ثانيةً
 * حقيقيّةً ليُثبِتَ انتهاءَ صلاحيّةٍ اختبارٌ يُحذَفُ عندَ أوّلِ تباطؤٍ في CI.
 */

import { describe, expect, it } from "vitest";

import {
  CachedDependencyProbe,
  PROBE_THREW_DETAIL,
  resolveMarketplaceProbeConfig,
} from "../domain/dependency-probe.js";
import type { DependencyProbePort, DependencyProbeResult } from "../domain/dependency-probe.js";

class CountingProbe implements DependencyProbePort {
  calls = 0;
  constructor(private readonly answer: () => Promise<DependencyProbeResult>) {}

  async probe(): Promise<DependencyProbeResult> {
    this.calls += 1;
    return await this.answer();
  }
}

/** ساعةٌ يُحرِّكُها الاختبارُ بالمللي ثانية. */
function clock(startMs: number): { now: () => Date; advance: (ms: number) => void } {
  let current = startMs;
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const T0 = Date.parse("2026-09-12T00:00:00.000Z");

describe("CachedDependencyProbe — سقفُ الحِمْلِ", () => {
  it("أوّلُ رصدٍ يسبرُ فعلاً ويحملُ الاسمَ والوقتَ وعمراً صفراً", async () => {
    const time = clock(T0);
    const probe = new CountingProbe(async () => ({ ok: true }));
    const cached = new CachedDependencyProbe(probe, {
      name: "marketplace_catalog",
      ttlMs: 15_000,
      now: time.now,
    });

    const observation = await cached.observe();

    expect(probe.calls).toBe(1);
    expect(observation.name).toBe("marketplace_catalog");
    expect(observation.ok).toBe(true);
    expect(observation.detail).toBeUndefined();
    expect(observation.observedAt.toISOString()).toBe("2026-09-12T00:00:00.000Z");
    expect(observation.ageMs).toBe(0);
  });

  it("نبضاتٌ متلاحقةٌ داخلَ الصلاحيّةِ نداءٌ واحدٌ — والعمرُ ينمو معَ الساعةِ", async () => {
    const time = clock(T0);
    const probe = new CountingProbe(async () => ({ ok: true }));
    const cached = new CachedDependencyProbe(probe, {
      name: "marketplace_catalog",
      ttlMs: 15_000,
      now: time.now,
    });

    await cached.observe();
    time.advance(5_000);
    const second = await cached.observe();
    time.advance(9_999);
    const third = await cached.observe();

    // ثلاثُ نبضاتٍ · نداءٌ واحدٌ: هذا هوَ الحدُّ الذي رفضَتِ المراجعةُ 8/N غيابَهُ.
    expect(probe.calls).toBe(1);
    expect(second.ageMs).toBe(5_000);
    expect(third.ageMs).toBe(14_999);
  });

  it("انتهاءُ الصلاحيّةِ يسبرُ من جديدٍ — والحدُّ عندَ `ttlMs` بالضبطِ لا بعدَهُ", async () => {
    const time = clock(T0);
    const probe = new CountingProbe(async () => ({ ok: true }));
    const cached = new CachedDependencyProbe(probe, {
      name: "marketplace_catalog",
      ttlMs: 15_000,
      now: time.now,
    });

    await cached.observe();
    time.advance(14_999);
    await cached.observe();
    expect(probe.calls).toBe(1);

    time.advance(1);
    const refreshed = await cached.observe();
    expect(probe.calls).toBe(2);
    expect(refreshed.ageMs).toBe(0);
  });

  it("`ttlMs: 0` يسبرُ في كلِّ نبضةٍ — قرارٌ مُجازٌ بقصدٍ لا ثغرةٌ", async () => {
    const time = clock(T0);
    const probe = new CountingProbe(async () => ({ ok: true }));
    const cached = new CachedDependencyProbe(probe, {
      name: "marketplace_catalog",
      ttlMs: 0,
      now: time.now,
    });

    await cached.observe();
    await cached.observe();
    await cached.observe();

    expect(probe.calls).toBe(3);
  });

  it("الإخفاقُ يُخزَّنُ كالنجاحِ — فعطلُ السوقِ لا يُكلِّفُ مَهَلاً في كلِّ نبضةٍ", async () => {
    const time = clock(T0);
    const probe = new CountingProbe(async () => ({ ok: false, detail: "marketplace_timeout" }));
    const cached = new CachedDependencyProbe(probe, {
      name: "marketplace_catalog",
      ttlMs: 15_000,
      now: time.now,
    });

    const first = await cached.observe();
    time.advance(1_000);
    const second = await cached.observe();

    expect(probe.calls).toBe(1);
    expect(first.ok).toBe(false);
    expect(first.detail).toBe("marketplace_timeout");
    expect(second.detail).toBe("marketplace_timeout");
    expect(second.ageMs).toBe(1_000);
  });

  it("نبضاتٌ متزامنةٌ تنتظرُ النداءَ نفسَهُ — تكتُّلٌ لا عاصفةٌ", async () => {
    const time = clock(T0);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probe = new CountingProbe(async () => {
      await gate;
      return { ok: true };
    });
    const cached = new CachedDependencyProbe(probe, {
      name: "marketplace_catalog",
      ttlMs: 15_000,
      now: time.now,
    });

    const inFlight = [cached.observe(), cached.observe(), cached.observe()];
    expect(probe.calls).toBe(1);
    release?.();
    const observations = await Promise.all(inFlight);

    expect(probe.calls).toBe(1);
    expect(observations.every((observation) => observation.ok)).toBe(true);
  });

  it("وبعدَ انقضاءِ النداءِ المُتكتِّلِ يُسبَرُ من جديدٍ — لا قفلٌ يبقى", async () => {
    const time = clock(T0);
    const probe = new CountingProbe(async () => ({ ok: true }));
    const cached = new CachedDependencyProbe(probe, {
      name: "marketplace_catalog",
      ttlMs: 0,
      now: time.now,
    });

    await Promise.all([cached.observe(), cached.observe()]);
    await cached.observe();

    // نداءانِ لا ثلاثةٌ: الأوّلانِ تكتّلا، والثالثُ بعدَ انقضاءِ الأوّلِ.
    expect(probe.calls).toBe(2);
  });

  it("منفذٌ رمى — يُقرأُ عيبَ محوّلٍ باسمِهِ ولا يَصعدُ إلى مُعالجِ الأخطاءِ", async () => {
    const time = clock(T0);
    const probe = new CountingProbe(async () => {
      throw new Error("boom");
    });
    const cached = new CachedDependencyProbe(probe, {
      name: "marketplace_catalog",
      ttlMs: 15_000,
      now: time.now,
    });

    const observation = await cached.observe();

    expect(observation.ok).toBe(false);
    expect(observation.detail).toBe(PROBE_THREW_DETAIL);
  });

  it("ساعةٌ رجعَت إلى الوراءِ لا تُنتِجُ عمراً سالباً", async () => {
    const time = clock(T0);
    const probe = new CountingProbe(async () => ({ ok: true }));
    const cached = new CachedDependencyProbe(probe, {
      name: "marketplace_catalog",
      ttlMs: 15_000,
      now: time.now,
    });

    await cached.observe();
    time.advance(-4_000);
    const observation = await cached.observe();

    expect(observation.ageMs).toBe(0);
  });
});

describe("resolveMarketplaceProbeConfig — الإعدادُ يُوقِفُ الإقلاعَ ولا يُصحَّحُ صامتاً", () => {
  const defaults = { ttlMs: 15_000, timeoutMs: 1_000 };

  it("بيئةٌ فارغةٌ ⇒ الافتراضاتُ", () => {
    expect(resolveMarketplaceProbeConfig({}, defaults)).toEqual(defaults);
  });

  it("قيمةٌ فارغةٌ أو مسافاتٌ ⇒ الافتراضُ لا خطأٌ", () => {
    expect(
      resolveMarketplaceProbeConfig({ MARKETPLACE_PROBE_TTL_MS: "   " }, defaults).ttlMs,
    ).toBe(15_000);
  });

  it("أرقامٌ عشريّةٌ تُقرأُ كما هيَ", () => {
    expect(
      resolveMarketplaceProbeConfig(
        { MARKETPLACE_PROBE_TTL_MS: "30000", MARKETPLACE_PROBE_TIMEOUT_MS: " 750 " },
        defaults,
      ),
    ).toEqual({ ttlMs: 30_000, timeoutMs: 750 });
  });

  it("`ttlMs: 0` مُجازٌ صريحاً — والمَهَلُ صفراً مرفوضٌ", () => {
    expect(
      resolveMarketplaceProbeConfig({ MARKETPLACE_PROBE_TTL_MS: "0" }, defaults).ttlMs,
    ).toBe(0);
    expect(() =>
      resolveMarketplaceProbeConfig({ MARKETPLACE_PROBE_TIMEOUT_MS: "0" }, defaults),
    ).toThrow(/MARKETPLACE_PROBE_TIMEOUT_MS=0/);
  });

  it.each(["1e3", "0x10", "١٥٠٠٠", "12.5", "-1", "abc", "15_000"])(
    "قيمةٌ غيرُ عشريّةٍ صريحةٍ تُوقِفُ الإقلاعَ وتُسمّي المتغيّرَ وقيمتَهُ: %s",
    (raw) => {
      expect(() =>
        resolveMarketplaceProbeConfig({ MARKETPLACE_PROBE_TTL_MS: raw }, defaults),
      ).toThrow(new RegExp(`MARKETPLACE_PROBE_TTL_MS[\\s\\S]*${raw.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}`));
    },
  );
});
