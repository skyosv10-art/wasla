/**
 * حارسُ الإعادة (M1-03 · ADR-021) — تُختبَر **الشروطُ الثلاثةُ** التي بدونها
 * لا يكون الحارسُ حارساً: ذَرِّيّةُ القرارِ · مدّةُ حفظٍ تُغطّي عمرَ الرمزِ ·
 * إخفاقٌ يُغلِق لا يُمرِّر.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_REPLAY_ENTRIES,
  InMemoryServiceTokenReplayGuard,
  ServiceTokenReplayStoreUnavailableError,
} from "../replay.js";

const NOW = new Date("2026-08-31T05:00:00.000Z");

function record(overrides: Partial<{ kid: string; jti: string; expiresAtMs: number }> = {}) {
  return {
    kid: overrides.kid ?? "k1",
    jti: overrides.jti ?? "A".repeat(22),
    expiresAtMs: overrides.expiresAtMs ?? NOW.getTime() + 60_000,
  };
}

/** ساعةُ الاختبارِ: تُمرَّر إلى الحارسِ صراحةً ولا تُزوَّر عالميّاً. */
let current = NOW;
const clock = () => current;

beforeEach(() => {
  current = NOW;
});

function guardWith(options: { maxEntries?: number; retentionSkewSeconds?: number } = {}) {
  return new InMemoryServiceTokenReplayGuard({ ...options, now: clock });
}

describe("InMemoryServiceTokenReplayGuard — القرار", () => {
  it("يقبل الأثرَ أوّلَ مرّةٍ ويرفضه ثانيةً", () => {
    const guard = guardWith();
    expect(guard.remember(record())).toBe("accepted");
    expect(guard.remember(record())).toBe("replayed");
  });

  it("لا يخلط أثرَينِ بمعرِّفٍ واحدٍ من مفتاحَينِ مختلفَينِ", () => {
    // `jti` فريدٌ عندَ مِنتاجٍ واحدٍ لا عبرَ المفاتيحِ كلِّها، فحصرُه بالمفتاحِ
    // يمنع أن يُبطِل مِنتاجٌ نداءَ مِنتاجٍ آخرَ بمعرِّفٍ متصادمٍ.
    const guard = guardWith();
    expect(guard.remember(record({ kid: "k1" }))).toBe("accepted");
    expect(guard.remember(record({ kid: "k2" }))).toBe("accepted");
  });

  it("لا يُخلَط `a:b` بـ`ab` في المِفتاحِ — لا تصادمَ بحدودٍ نصّيّةٍ", () => {
    const guard = guardWith();
    expect(guard.remember(record({ kid: "a", jti: `b${"A".repeat(21)}` }))).toBe(
      "accepted",
    );
    expect(guard.remember(record({ kid: "ab", jti: "A".repeat(21) + "A" }))).toBe(
      "accepted",
    );
  });

  it("قراران متزامنانِ لنفسِ الأثرِ: أحدُهما يُقبَل والآخرُ يُرفَض — لا كلاهما", () => {
    // هذه هي الحالةُ التي يُصنَع الهجومُ لها: إرسالُ الرمزِ مرّتَينِ في نفسِ
    // اللحظةِ. والقرارُ هنا يقع في نبضةٍ واحدةٍ بلا `await` بينَ الفحصِ والكتابةِ،
    // فلا تتخلَّل نبضةٌ تجعل الاثنَينِ يقرآنِ «غيرُ موجودٍ».
    const guard = guardWith();
    const decisions = [record(), record()].map((entry) => guard.remember(entry));
    expect(decisions.filter((d) => d === "accepted")).toHaveLength(1);
    expect(decisions.filter((d) => d === "replayed")).toHaveLength(1);
  });
});

describe("InMemoryServiceTokenReplayGuard — مدّةُ الحفظ", () => {
  it("يبقى الأثرُ محفوظاً بعدَ لحظةِ انتهاءِ الرمزِ — الهامشُ يُغطّي انحرافَ الساعات", () => {
    const guard = guardWith({ retentionSkewSeconds: 60 });
    guard.remember(record());

    // بعدَ انتهاءِ الرمزِ بثانيةٍ: لو نُسيَ الأثرُ الآنَ لكانت نافذةُ الانحرافِ
    // بابَ إعادةٍ مفتوحاً، لأنّ مُتحقِّقاً ساعتُه متأخِّرةٌ ما زال يقبل الرمزَ.
    current = new Date(NOW.getTime() + 61_000);
    expect(guard.remember(record())).toBe("replayed");
  });

  it("ويُنسى بعدَ انتهاءِ الرمزِ والهامشِ معاً — لا ذاكرةَ بلا فائدة", () => {
    const guard = guardWith({ retentionSkewSeconds: 60 });
    guard.remember(record());
    current = new Date(NOW.getTime() + 121_000);
    expect(guard.remember(record())).toBe("accepted");
    expect(guard.size()).toBe(1);
  });

  it("يمسح الآثارَ المنتهيةَ كسولاً عندَ الاستدعاءِ لا بمؤقِّتٍ خَلفيّ", () => {
    const guard = guardWith({ retentionSkewSeconds: 0 });
    for (let index = 0; index < 10; index += 1) {
      guard.remember(record({ jti: `J${index}`.padEnd(22, "x") }));
    }
    expect(guard.size()).toBe(10);
    current = new Date(NOW.getTime() + 60_001);
    guard.remember(record({ jti: "Z".repeat(22), expiresAtMs: NOW.getTime() + 120_000 }));
    expect(guard.size()).toBe(1);
  });
});

describe("InMemoryServiceTokenReplayGuard — الإخفاقُ يُغلِق", () => {
  it("يرمي عندَ بلوغِ الحدِّ ولا يُسقِط الأقدمَ بصمت", () => {
    // إسقاطُ الأقدمِ كان سيُعيد فتحَ نافذةِ الإعادةِ بلا أن يعلمَ أحدٌ؛ والرميُ
    // يجعل نقطةَ الفرضِ تردُّ 503 فيُرصَد الحدثُ بدلاً من أن يُبتلَع.
    const guard = guardWith({ maxEntries: 2 });
    guard.remember(record({ jti: "A".repeat(22) }));
    guard.remember(record({ jti: "B".repeat(22) }));
    expect(() => guard.remember(record({ jti: "C".repeat(22) }))).toThrow(
      ServiceTokenReplayStoreUnavailableError,
    );
    // والأقدمُ ما زال محفوظاً: لم يُستبدَل بالجديد.
    expect(guard.remember(record({ jti: "A".repeat(22) }))).toBe("replayed");
  });

  it("ويكشف الإعادةَ عندَ الامتلاءِ إن كان الأثرُ محفوظاً — الرفضُ أوّلاً", () => {
    const guard = guardWith({ maxEntries: 1 });
    guard.remember(record());
    expect(guard.remember(record())).toBe("replayed");
  });

  it("لا يقبل حدّاً غيرَ صالحٍ", () => {
    for (const maxEntries of [0, -1, 1.5]) {
      expect(() => new InMemoryServiceTokenReplayGuard({ maxEntries })).toThrow(
        TypeError,
      );
    }
  });

  it("للحدِّ الافتراضيِّ قيمةٌ مُعلَنةٌ لا مُخفاةٌ", () => {
    expect(DEFAULT_MAX_REPLAY_ENTRIES).toBe(100_000);
  });
});
