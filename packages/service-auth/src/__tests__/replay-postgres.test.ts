/**
 * حارسُ الإعادةِ فوقَ Postgres — الوحدةُ (M1-03 · `RISK-0015` · ADR-035).
 *
 * ما يُقاسُ هنا **ترجمةُ القرارِ وحدَها**: عددُ الصفوفِ ⇒ قرارٌ، والخطأُ ⇒ إغلاقٌ،
 * والمُعامِلاتُ المُرسَلةُ إلى القاعدةِ. وأمّا **الذَّرِّيّةُ والانتهاءُ والاشتراكُ بينَ
 * النسخِ** فلا يُقاسُ بمُنفِّذٍ زائفٍ إطلاقاً — مُنفِّذٌ زائفٌ يُثبِتُ الزائفَ. تلكَ
 * الثلاثةُ يقيسُها `replay-postgres.integration.test.ts` على PostgreSQL حقيقيٍّ في
 * وظيفةِ `db-integration`، ولذلكَ لا يُدَّعى في هذا الملفِّ أنَّهُ يُغلِقُ الخطرَ.
 */

import { describe, expect, it } from "vitest";

import {
  ensureServiceTokenReplaySchema,
  PostgresServiceTokenReplayGuard,
  SERVICE_TOKEN_REPLAY_DDL,
  SERVICE_TOKEN_REPLAY_TABLE,
  type ReplaySqlExecutor,
} from "../replay-postgres.js";
import { ServiceTokenReplayStoreUnavailableError } from "../replay.js";

interface Call {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** مُنفِّذٌ يُسجِّلُ ما يُطلَبُ منهُ ويُجيبُ بما يُبرمَجُ — لا يُحاكي SQL ولا يُدَّعى ذلك. */
function fakeExecutor(
  answers: readonly (number | null | Error)[],
): { executor: ReplaySqlExecutor; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const executor: ReplaySqlExecutor = {
    async query(sql, params) {
      calls.push({ sql, params });
      // `??` كانَ سيبتلعُ `null` المُبرمَجَ ويُحوِّلَهُ إلى 1 — أي يُخفي الحالةَ
      // التي كُتِبَ هذا المُنفِّذُ ليقيسَها. فالمدى يُفحَصُ صراحةً.
      const answer = index < answers.length ? answers[index++]! : 1;
      if (answer instanceof Error) throw answer;
      return { rowCount: answer };
    },
  };
  return { executor, calls };
}

const NOW = new Date("2026-09-17T10:00:00.000Z");
const record = {
  kid: "k1",
  jti: "j1",
  expiresAtMs: NOW.getTime() + 30_000,
} as const;

describe("PostgresServiceTokenReplayGuard", () => {
  it("صفٌّ متأثّرٌ ⇒ accepted", async () => {
    const { executor } = fakeExecutor([1, 0]);
    const guard = new PostgresServiceTokenReplayGuard(executor, {
      now: () => NOW,
    });
    await expect(guard.remember(record)).resolves.toBe("accepted");
  });

  it("صِفرُ صفوفٍ ⇒ replayed (الصفُّ الحيُّ منعَ الكتابةَ)", async () => {
    const { executor } = fakeExecutor([0, 0]);
    const guard = new PostgresServiceTokenReplayGuard(executor, {
      now: () => NOW,
    });
    await expect(guard.remember(record)).resolves.toBe("replayed");
  });

  it("خطأُ المخزنِ يُغلِقُ ولا يُمرِّرُ", async () => {
    const { executor } = fakeExecutor([new Error("connection reset")]);
    const guard = new PostgresServiceTokenReplayGuard(executor, {
      now: () => NOW,
    });
    await expect(guard.remember(record)).rejects.toBeInstanceOf(
      ServiceTokenReplayStoreUnavailableError,
    );
  });

  it("عددُ صفوفٍ غيرُ معروفٍ (null) جهلٌ يُعلَنُ لا قبولٌ ولا رفضٌ", async () => {
    const { executor } = fakeExecutor([null]);
    const guard = new PostgresServiceTokenReplayGuard(executor, {
      now: () => NOW,
    });
    await expect(guard.remember(record)).rejects.toBeInstanceOf(
      ServiceTokenReplayStoreUnavailableError,
    );
  });

  it("مدّةُ الحفظِ = exp + الهامشُ، والآنَ يُمرَّرُ لا يُقرأُ من ساعةٍ ضمنيّةٍ", async () => {
    const { executor, calls } = fakeExecutor([1, 0]);
    const guard = new PostgresServiceTokenReplayGuard(executor, {
      now: () => NOW,
      retentionSkewSeconds: 90,
    });
    await guard.remember(record);

    const [kid, jti, retainUntil, now] = calls[0]!.params as [
      string,
      string,
      Date,
      Date,
    ];
    expect(kid).toBe("k1");
    expect(jti).toBe("j1");
    expect(retainUntil.getTime()).toBe(record.expiresAtMs + 90_000);
    expect(now.getTime()).toBe(NOW.getTime());
    expect(calls[0]!.sql).toContain(SERVICE_TOKEN_REPLAY_TABLE);
    expect(calls[0]!.sql).toContain("ON CONFLICT (kid, jti) DO UPDATE");
  });

  it("القرارُ يصدرُ قبلَ المسحِ، فمسحةٌ فاشلةٌ لا تُسقِطُ نداءً صحيحاً", async () => {
    const seen: unknown[] = [];
    const { executor, calls } = fakeExecutor([1, new Error("deadlock")]);
    const guard = new PostgresServiceTokenReplayGuard(executor, {
      now: () => NOW,
      sweepIntervalMs: 0,
      onSweepError: (error) => seen.push(error),
    });

    await expect(guard.remember(record)).resolves.toBe("accepted");
    expect(calls[1]!.sql).toContain("DELETE FROM");
    expect(seen).toHaveLength(1);
  });

  it("المسحُ لا يتكرَّرُ قبلَ انقضاءِ مُدّتِهِ", async () => {
    let nowMs = NOW.getTime();
    const { executor, calls } = fakeExecutor([1, 0, 1, 1, 0]);
    const guard = new PostgresServiceTokenReplayGuard(executor, {
      now: () => new Date(nowMs),
      sweepIntervalMs: 60_000,
    });

    await guard.remember(record);
    nowMs += 10_000; // دونَ المُدّةِ: لا مسحةَ ثانيةً
    await guard.remember({ ...record, jti: "j2" });
    const deletesBefore = calls.filter((c) => c.sql.includes("DELETE")).length;
    expect(deletesBefore).toBe(1);

    nowMs += 60_000; // فوقَ المُدّةِ: مسحةٌ جديدةٌ
    await guard.remember({ ...record, jti: "j3" });
    expect(calls.filter((c) => c.sql.includes("DELETE")).length).toBe(2);
  });

  it("هامشٌ سالبٌ يُرفَضُ عندَ البناءِ", () => {
    const { executor } = fakeExecutor([]);
    expect(
      () =>
        new PostgresServiceTokenReplayGuard(executor, {
          retentionSkewSeconds: -1,
        }),
    ).toThrow(TypeError);
  });

  it("تهيئةُ المخطَّطِ تُنفِّذُ كلَّ عبارةٍ مُعلَنةٍ", async () => {
    const { executor, calls } = fakeExecutor([1, 1]);
    await ensureServiceTokenReplaySchema(executor);
    expect(calls.map((c) => c.sql)).toEqual([...SERVICE_TOKEN_REPLAY_DDL]);
  });

  it("تهيئةُ المخطَّطِ تُلقي ولا تتجاوزُ الإخفاقَ", async () => {
    const { executor } = fakeExecutor([new Error("permission denied")]);
    await expect(ensureServiceTokenReplaySchema(executor)).rejects.toThrow(
      "permission denied",
    );
  });
});
