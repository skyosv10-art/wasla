/**
 * حارسُ الإعادةِ المشترَكُ — البرهانُ على PostgreSQL حقيقيٍّ
 * (M1-03 · إغلاقُ `RISK-0015` · ADR-035 · وظيفةُ CI: `db-integration` ساقُ `service-auth`).
 *
 * ── لِمَ لا يكفي اختبارُ الوحدةِ ─────────────────────────────────────────────
 * الخطرُ `RISK-0015` **ليسَ خطأً في ترجمةِ عددِ صفوفٍ** — هوَ أنَّ نسختَينِ لا
 * تتشاركانِ حقيقةً. ومُنفِّذٌ زائفٌ لا يُثبِتُ اشتراكاً ولا ذَرِّيّةً ولا انتهاءً:
 * يُثبِتُ ما بُرمِجَ فيهِ. فالثلاثةُ تُقاسُ هنا وحدَها، وعليها وحدَها يُدَّعى الإغلاقُ:
 *
 *  1. **الاشتراكُ**: حارسانِ ببِركتَي اتّصالٍ منفصلتَينِ (نظيرُ نسختَي خدمةٍ وراءَ
 *     موازِنِ حِمْلٍ) — ما قَبِلَهُ الأوّلُ يُرَدُّ `replayed` عندَ الثاني.
 *  2. **الذَّرِّيّةُ**: عشرُ محاولاتٍ متوازيةٍ للأثرِ نفسِهِ ⇒ **قبولٌ واحدٌ بالضبطِ**.
 *  3. **الانتهاءُ والاستعادةُ**: أثرٌ انقضت مدّةُ حفظِهِ يُستعادُ صفُّهُ (قبولٌ جديدٌ)،
 *     وأثرٌ لم تنقضِ يبقى مرفوضاً — فلا نافذةُ إعادةٍ ولا نموٌّ أبديٌّ.
 *
 * ولا `DATABASE_URL` ⇒ **إخفاقٌ صريحٌ لا تخطٍّ صامتٌ**: هذا الملفُّ لا يُشغَّلُ إلّا
 * بإعدادِ التكاملِ، ووظيفةُ CI تُعطيهِ قاعدةً. فغيابُها عطبُ بيئةٍ يُقالُ لا يُكتَمُ.
 */

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ensureServiceTokenReplaySchema,
  PostgresServiceTokenReplayGuard,
  SERVICE_TOKEN_REPLAY_TABLE,
  type ReplaySqlExecutor,
} from "../replay-postgres.js";
import { createServiceTokenReplayStore } from "../replay-store.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL مطلوبٌ لاختبارِ التكاملِ — ولا تخطٍّ صامتٌ (وظيفةُ db-integration تُعيّنُهُ).",
  );
}

function executorOf(pool: Pool): ReplaySqlExecutor {
  return {
    query: (sql, params) =>
      pool.query(sql, params as unknown[]) as Promise<{
        rowCount: number | null;
      }>,
  };
}

/** بِركتانِ منفصلتانِ = نظيرُ نسختَينِ منفصلتَينِ من الخدمةِ. */
let poolA: Pool;
let poolB: Pool;
const NOW = new Date("2026-09-17T10:00:00.000Z");

beforeAll(async () => {
  poolA = new Pool({ connectionString, max: 5 });
  poolB = new Pool({ connectionString, max: 5 });
  await ensureServiceTokenReplaySchema(executorOf(poolA));
  await poolA.query(`DELETE FROM ${SERVICE_TOKEN_REPLAY_TABLE}`);
});

afterAll(async () => {
  await poolA.end();
  await poolB.end();
});

describe("المخزنُ المشترَكُ فوقَ Postgres", () => {
  it("تهيئةُ المخطَّطِ متوافقةٌ مع التكرارِ (تُنفَّذُ مرّتَينِ بلا خطأٍ)", async () => {
    await ensureServiceTokenReplaySchema(executorOf(poolA));
    await ensureServiceTokenReplaySchema(executorOf(poolB));
    const { rows } = await poolA.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = $1`,
      [SERVICE_TOKEN_REPLAY_TABLE],
    );
    expect(rows[0].n).toBe(1);
  });

  it("1) نسختانِ تتشاركانِ الحقيقةَ: ما قَبِلَتْهُ الأولى تردُّهُ الثانيةُ", async () => {
    const guardA = new PostgresServiceTokenReplayGuard(executorOf(poolA), {
      now: () => NOW,
    });
    const guardB = new PostgresServiceTokenReplayGuard(executorOf(poolB), {
      now: () => NOW,
    });
    const record = {
      kid: "kid-shared",
      jti: "jti-shared",
      expiresAtMs: NOW.getTime() + 60_000,
    };

    await expect(guardA.remember(record)).resolves.toBe("accepted");
    await expect(guardB.remember(record)).resolves.toBe("replayed");
    await expect(guardA.remember(record)).resolves.toBe("replayed");
  });

  it("`kid` جزءٌ من المفتاحِ: `jti` نفسُهُ بمفتاحٍ آخرَ ليسَ إعادةً", async () => {
    const guard = new PostgresServiceTokenReplayGuard(executorOf(poolA), {
      now: () => NOW,
    });
    const base = { jti: "jti-per-kid", expiresAtMs: NOW.getTime() + 60_000 };
    await expect(guard.remember({ ...base, kid: "kid-1" })).resolves.toBe(
      "accepted",
    );
    await expect(guard.remember({ ...base, kid: "kid-2" })).resolves.toBe(
      "accepted",
    );
    await expect(guard.remember({ ...base, kid: "kid-1" })).resolves.toBe(
      "replayed",
    );
  });

  it("2) الذَّرِّيّةُ: عشرُ محاولاتٍ متوازيةٍ ⇒ قبولٌ واحدٌ بالضبطِ", async () => {
    const guards = [poolA, poolB, poolA, poolB, poolA].map(
      (pool) =>
        new PostgresServiceTokenReplayGuard(executorOf(pool), {
          now: () => NOW,
          // مسحٌ معطَّلٌ في هذه الحالةِ: المقصودُ قياسُ القرارِ لا الصيانةِ.
          sweepIntervalMs: Number.MAX_SAFE_INTEGER,
        }),
    );
    const record = {
      kid: "kid-race",
      jti: "jti-race",
      expiresAtMs: NOW.getTime() + 60_000,
    };

    const decisions = await Promise.all(
      Array.from({ length: 10 }, (_unused, i) =>
        guards[i % guards.length]!.remember(record),
      ),
    );

    expect(decisions.filter((d) => d === "accepted")).toHaveLength(1);
    expect(decisions.filter((d) => d === "replayed")).toHaveLength(9);
  });

  it("3) الأثرُ المنتهي يُستعادُ، وغيرُ المنتهي يبقى مرفوضاً", async () => {
    let nowMs = NOW.getTime();
    const guard = new PostgresServiceTokenReplayGuard(executorOf(poolA), {
      now: () => new Date(nowMs),
      retentionSkewSeconds: 0,
      sweepIntervalMs: Number.MAX_SAFE_INTEGER,
    });
    const record = {
      kid: "kid-expiry",
      jti: "jti-expiry",
      expiresAtMs: nowMs + 10_000,
    };

    await expect(guard.remember(record)).resolves.toBe("accepted");
    nowMs += 5_000; // ما زالت المدّةُ حيّةً
    await expect(guard.remember(record)).resolves.toBe("replayed");
    nowMs += 10_000; // انقضت المدّةُ ⇒ الصفُّ يُستعادُ
    await expect(
      guard.remember({ ...record, expiresAtMs: nowMs + 10_000 }),
    ).resolves.toBe("accepted");
  });

  it("المسحُ يحذفُ المنتهيَ وحدَهُ ولا يمسُّ الحيَّ", async () => {
    let nowMs = NOW.getTime();
    const guard = new PostgresServiceTokenReplayGuard(executorOf(poolA), {
      now: () => new Date(nowMs),
      retentionSkewSeconds: 0,
      sweepIntervalMs: 0,
    });
    await guard.remember({
      kid: "kid-sweep",
      jti: "short",
      expiresAtMs: nowMs + 1_000,
    });
    await guard.remember({
      kid: "kid-sweep",
      jti: "long",
      expiresAtMs: nowMs + 600_000,
    });

    nowMs += 60_000;
    // نداءٌ ثالثٌ يُشغِّلُ المسحةَ (مُدّتُها صِفرٌ) بعدَ قرارِهِ.
    await guard.remember({
      kid: "kid-sweep",
      jti: "trigger",
      expiresAtMs: nowMs + 600_000,
    });

    const { rows } = await poolA.query(
      `SELECT jti FROM ${SERVICE_TOKEN_REPLAY_TABLE} WHERE kid = $1 ORDER BY jti`,
      ["kid-sweep"],
    );
    expect(rows.map((r: { jti: string }) => r.jti)).toEqual([
      "long",
      "trigger",
    ]);
  });

  it("المِغلافُ يبني نمطَ postgres من البيئةِ ويُهيِّئُ المخطَّطَ فعلاً", async () => {
    const store = await createServiceTokenReplayStore({
      DATABASE_URL: connectionString,
    });
    try {
      expect(store.mode).toBe("postgres");
      const record = {
        kid: "kid-env",
        jti: "jti-env",
        expiresAtMs: Date.now() + 60_000,
      };
      await expect(store.guard.remember(record)).resolves.toBe("accepted");
      await expect(store.guard.remember(record)).resolves.toBe("replayed");
    } finally {
      await store.close();
    }
  });
});
