/**
 * مِغلافُ بناءِ مخزنِ الآثارِ من البيئةِ (M1-03 · `RISK-0015` · ADR-035).
 *
 * ما يُقاسُ: **قرارُ الإقلاعِ** — أيَّ مخزنٍ يُبنى، ومتى يُرفَضُ الإقلاعُ، وأنَّ
 * الرفضَ يُسمّي المتغيّرَ. فالعطبُ الذي أُغلِقَ لم يكنْ في المخزنِ وحدَهُ بل في
 * **سكوتِ الجذورِ**: أربعةَ عشرَ ملفّاً يختارُ الذاكرةَ افتراضاً بلا أن يُسألَ.
 */

import { describe, expect, it, vi } from "vitest";

import type { ReplaySqlExecutor } from "../replay-postgres.js";
import { ServiceTokenReplayStoreUnavailableError } from "../replay.js";
import {
  createServiceTokenReplayGuardFromEnv,
  createServiceTokenReplayStore,
  REPLAY_STORE_MODE_ENV,
  REPLAY_STORE_URL_ENV,
  ReplayStoreConfigError,
} from "../replay-store.js";

const URL_A = "postgres://u:p@db:5432/wasla";
const URL_B = "postgres://u:p@replay:5432/replay";

function recordingExecutor(): {
  factory: (connectionString: string) => Promise<{
    executor: ReplaySqlExecutor;
    close?: () => Promise<void>;
  }>;
  urls: string[];
  statements: string[];
  closed: () => number;
} {
  const urls: string[] = [];
  const statements: string[] = [];
  let closes = 0;
  return {
    urls,
    statements,
    closed: () => closes,
    factory: async (connectionString) => {
      urls.push(connectionString);
      return {
        executor: {
          async query(sql) {
            statements.push(sql);
            return { rowCount: 1 };
          },
        },
        close: async () => {
          closes += 1;
        },
      };
    },
  };
}

describe("createServiceTokenReplayStore", () => {
  it("الافتراضُ postgres — ولا هبوطَ إلى الذاكرةِ بالسكوتِ", async () => {
    const rec = recordingExecutor();
    const store = await createServiceTokenReplayStore(
      { DATABASE_URL: URL_A },
      { createExecutor: rec.factory },
    );
    expect(store.mode).toBe("postgres");
    expect(rec.urls).toEqual([URL_A]);
    expect(rec.statements.some((s) => s.includes("CREATE TABLE"))).toBe(true);
    await store.close();
    expect(rec.closed()).toBe(1);
  });

  it("وصلةُ المخزنِ الخاصّةِ تسبقُ DATABASE_URL", async () => {
    const rec = recordingExecutor();
    await createServiceTokenReplayStore(
      { DATABASE_URL: URL_A, [REPLAY_STORE_URL_ENV]: URL_B },
      { createExecutor: rec.factory },
    );
    expect(rec.urls).toEqual([URL_B]);
  });

  it("لا وصلةَ ⇒ الإقلاعُ يسقطُ ويُسمّي المتغيّرَ", async () => {
    await expect(createServiceTokenReplayStore({})).rejects.toThrow(
      ReplayStoreConfigError,
    );
    await expect(createServiceTokenReplayStore({})).rejects.toThrow(
      REPLAY_STORE_URL_ENV,
    );
  });

  it("نمطُ الذاكرةِ يُطلَبُ صراحةً ويُقبَلُ خارجَ الإنتاجِ", async () => {
    const store = await createServiceTokenReplayStore({
      [REPLAY_STORE_MODE_ENV]: "memory",
    });
    expect(store.mode).toBe("memory");
    const record = { kid: "k", jti: "j", expiresAtMs: Date.now() + 60_000 };
    expect(await store.guard.remember(record)).toBe("accepted");
    expect(await store.guard.remember(record)).toBe("replayed");
  });

  it("نمطُ الذاكرةِ مرفوضٌ في NODE_ENV=production مهما طُلِبَ", async () => {
    await expect(
      createServiceTokenReplayStore({
        [REPLAY_STORE_MODE_ENV]: "memory",
        NODE_ENV: "production",
        DATABASE_URL: URL_A,
      }),
    ).rejects.toThrow(/production/);
  });

  it("نمطٌ مجهولٌ يُرفَضُ باسمِهِ ولا يُقرَأُ افتراضاً", async () => {
    await expect(
      createServiceTokenReplayStore({
        [REPLAY_STORE_MODE_ENV]: "redis",
        DATABASE_URL: URL_A,
      }),
    ).rejects.toThrow(/redis/);
  });

  it("إخفاقُ تهيئةِ المخطَّطِ يُسقِطُ الإقلاعَ ويُغلِقُ البِركةَ", async () => {
    let closed = 0;
    await expect(
      createServiceTokenReplayStore(
        { DATABASE_URL: URL_A },
        {
          createExecutor: async () => ({
            executor: {
              query: vi.fn(async () => {
                throw new Error("permission denied for schema public");
              }),
            },
            close: async () => {
              closed += 1;
            },
          }),
        },
      ),
    ).rejects.toThrow(ReplayStoreConfigError);
    expect(closed).toBe(1);
  });
});

/**
 * المِغلافُ المُتزامِنُ — وهوَ ما تستعملُهُ أربعةَ عشرَ جذرَ إقلاعٍ فعلاً.
 *
 * ما يُقاسُ هنا هوَ **الفصلُ**: خطأُ الإعدادِ يُلقى الآنَ (بلا أيِّ اتّصالٍ)،
 * والاتّصالُ يُؤجَّلُ إلى أوّلِ قرارٍ، وإخفاقُهُ 503 مُغلَقٌ **لا يُحفَظُ**.
 */
describe("createServiceTokenReplayGuardFromEnv", () => {
  it("لا وصلةَ ⇒ يسقطُ عندَ البناءِ لا عندَ أوّلِ رمزٍ", () => {
    expect(() => createServiceTokenReplayGuardFromEnv({})).toThrow(
      ReplayStoreConfigError,
    );
  });

  it("نمطُ الذاكرةِ مرفوضٌ في الإنتاجِ عندَ البناءِ نفسِهِ", () => {
    expect(() =>
      createServiceTokenReplayGuardFromEnv({
        [REPLAY_STORE_MODE_ENV]: "memory",
        NODE_ENV: "production",
        DATABASE_URL: URL_A,
      }),
    ).toThrow(/production/);
  });

  it("الاتّصالُ يُؤجَّلُ: لا فتحَ قبلَ أوّلِ قرارٍ، ولا يُعادُ الفتحُ بعدَهُ", async () => {
    const rec = recordingExecutor();
    const guard = createServiceTokenReplayGuardFromEnv(
      { DATABASE_URL: URL_A },
      { createExecutor: rec.factory },
    );
    expect(rec.urls).toEqual([]);

    const record = { kid: "k", jti: "j", expiresAtMs: Date.now() + 60_000 };
    expect(await guard.remember(record)).toBe("accepted");
    expect(rec.urls).toEqual([URL_A]);

    await guard.remember(record);
    expect(rec.urls).toEqual([URL_A]);
  });

  it("إخفاقُ الفتحِ 503 مُغلَقٌ، ولا يُحفَظُ فتعودُ الخدمةُ إذا عادت القاعدةُ", async () => {
    let attempt = 0;
    const guard = createServiceTokenReplayGuardFromEnv(
      { DATABASE_URL: URL_A },
      {
        createExecutor: async () => {
          attempt += 1;
          if (attempt === 1) throw new Error("ECONNREFUSED");
          return {
            executor: { async query() { return { rowCount: 1 }; } },
          };
        },
      },
    );

    const record = { kid: "k", jti: "j", expiresAtMs: Date.now() + 60_000 };
    await expect(guard.remember(record)).rejects.toBeInstanceOf(
      ServiceTokenReplayStoreUnavailableError,
    );
    // المحاولةُ الثانيةُ تفتحُ من جديدٍ: العطبُ تشغيليٌّ لا دائمٌ.
    expect(await guard.remember(record)).toBe("accepted");
    expect(attempt).toBe(2);
  });
});
