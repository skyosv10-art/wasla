/**
 * بوابةُ M1-02 — **جلسةُ البشرِ من طرفٍ إلى طرف** (ADR-019).
 *
 * سؤالُ البوابةِ واحدٌ: هل تُبنى جلسةٌ من `init-data` تلغرامَ حقيقيِّ
 * التوقيعِ، ثمّ **تُرفَض إعادتُها**، ثمّ **تنتهي** في وقتِها — على محرّكٍ
 * حقيقيّ؟
 *
 * ومكانُ هذا الملفِّ هنا لا في `services/identity` بقرارٍ: هو الحزمةُ
 * الوحيدةُ المسموحُ لها بوصلِ الخدمةِ بالمحوَّلِ معاً (ADR-007، ووصفُ
 * `@wasla/channel-e2e`). ولو وُضِع في `services/identity` لَاحتاجت الخدمةُ
 * أن تعتمد على `@wasla/telegram-adapter` — أي أن تعرف الهويّةُ لغةَ قناةٍ
 * بعينها، وهو ما تمنعه الطبقات.
 *
 * **حدُّ ما يُثبِته هذا الملفّ:**
 * - بلا `DATABASE_URL`: يُثبِت الطريقَ والحكمَ الزمنيَّ فوقَ مُنفِّذِ ذاكرةٍ.
 *   ورفضُ الإعادةِ هناك برهانٌ على المُنفِّذِ الوهميِّ **لا على الإنتاج**.
 * - مع `DATABASE_URL`: يُثبِت أنّ منعَ الإعادةِ **قيدٌ في المحرّك** — وهو
 *   وحدَه ما يصحّ عبرَ نسخِ الخدمةِ المتعدّدة.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  CryptoIdGenerator,
  DEFAULT_SESSION_TTL_SECONDS,
  InMemoryIdentityRepository,
  InMemoryOutbox,
  InMemoryPublicIdSequence,
  InMemorySessionRepository,
  PostgresIdentityRepository,
  PostgresOutbox,
  PostgresPublicIdSequence,
  PostgresSessionRepository,
  createDb,
  ensurePublicIdSequence,
  issueSessionFromTelegram,
  resolveTelegramIdentity,
  revokeSession,
  verifySessionToken,
  type Db,
  type IdentityRepository,
  type SessionRepository,
  type UseCaseDeps,
} from "@wasla/identity-service";
import {
  fingerprintInitData,
  signInitDataForTests,
  verifyTelegramInitData,
} from "@wasla/telegram-adapter";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/** رمزُ روبوتٍ وهميٌّ — لا سرَّ حقيقيّاً في مستودع. */
const BOT_TOKEN = "777000:m1-02-gate-bot-token-not-a-secret";

const T0 = new Date("2026-08-30T09:00:00.000Z");

/** ساعةٌ يقودها الاختبار. */
class TestClock {
  constructor(private current: Date) {}
  now(): string {
    return this.current.toISOString();
  }
  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

/** يبني `init-data` مُوقَّعاً كما ترسله تلغرام. */
function makeInitData(telegramUserId: number, at: Date, queryId: string): string {
  return signInitDataForTests(
    {
      auth_date: String(Math.floor(at.getTime() / 1000)),
      query_id: queryId,
      user: JSON.stringify({
        id: telegramUserId,
        first_name: "بوابة",
        username: `gate${telegramUserId}`,
        language_code: "ar",
      }),
    },
    BOT_TOKEN,
  );
}

interface Wiring {
  repo: IdentityRepository;
  sessions: SessionRepository;
  clock: TestClock;
  identityDeps: UseCaseDeps;
  sessionDeps: {
    sessions: SessionRepository;
    repo: IdentityRepository;
    clock: TestClock;
    idGen: CryptoIdGenerator;
  };
}

/**
 * الطريقُ الكاملُ: `init-data` خامٌّ ← تحقُّقٌ من التوقيعِ في المحوَّل ←
 * إصدارُ جلسةٍ في الهويّة. هذه هي الدالّةُ التي تُمثّل ما سيفعله الوسيطُ
 * المركزيُّ (M1-04)، ومَن يتجاوزها يتجاوز التوقيع.
 */
async function login(w: Wiring, raw: string, now: Date) {
  const verified = verifyTelegramInitData(raw, BOT_TOKEN, { now });
  return issueSessionFromTelegram(
    w.sessionDeps,
    {
      initDataFingerprint: fingerprintInitData(raw),
      telegramUserId: verified.user.id,
      telegramUsername: verified.user.username,
    },
    async () => {
      await resolveTelegramIdentity(w.identityDeps, {
        telegram_user_id: verified.user.id,
        telegram_username: verified.user.username,
      });
      const user = await w.repo.findUserByTelegramId(verified.user.id);
      if (user === null) throw new Error("resolve لم يُنتج مستخدماً.");
      return { internalUuid: user.internalUuid, waslaPublicId: user.waslaPublicId };
    },
  );
}

/** المجموعةُ نفسُها تُشغَّل على مُنفِّذَين — والفرقُ بينهما هو الرسالة. */
function gateSuite(label: string, build: () => Promise<Wiring>, isPostgres: boolean): void {
  describe(`بوابةُ M1-02 · ${label}`, () => {
    let w: Wiring;
    let seq = 0;

    beforeEach(async () => {
      w = await build();
      seq += 1;
    });

    it("توقيعٌ صحيحٌ ← جلسةٌ ← Principal بالمعرِّفِ العامِّ", async () => {
      const uid = 900_000 + seq;
      const raw = makeInitData(uid, T0, `q-ok-${seq}`);
      const issued = await login(w, raw, T0);

      const principal = await verifySessionToken(w.sessionDeps, issued.token, {
        roles: ["customer"],
        scopes: ["orders:order:read"],
      });

      expect(principal.kind).toBe("user");
      expect(principal.waslaPublicId).toBe(issued.waslaPublicId);
      expect(principal.waslaPublicId).toMatch(/^WS-\d{10}$/);
      expect(principal.sessionId).toBe(issued.session.id);
      expect(principal.channel).toBe("telegram");
      // المعرِّفُ الداخليُّ موجودٌ في الـPrincipal ولا يعبر إلى استجابةٍ
      // (SECURITY_RULES §11) — الحدُّ الذي يحرسه `describePrincipal`.
      expect(principal.internalUuid).not.toBe(principal.waslaPublicId);
    });

    it("توقيعٌ مُزوَّرٌ ← لا جلسةَ إطلاقاً", async () => {
      const uid = 910_000 + seq;
      const raw = makeInitData(uid, T0, `q-bad-${seq}`);
      const tampered = raw.replace(/&query_id=[^&]*/, `&query_id=q-changed-${seq}`);

      expect(() => verifyTelegramInitData(tampered, BOT_TOKEN, { now: T0 })).toThrow();
      // ولا يكفي أن يُخفِق التحقُّقُ: يجب ألّا يكون سطرٌ قد كُتِب.
      const user = await w.repo.findUserByTelegramId(uid);
      expect(user).toBeNull();
    });

    it(
      isPostgres
        ? "**إعادةُ** نفسِ init-data تُرفَض بقيدِ المحرّك (23505 → IDENTITY_SESSION_REPLAY)"
        : "إعادةُ نفسِ init-data تُرفَض في مُنفِّذِ الذاكرةِ (لا يُعتَدُّ بها للإنتاج)",
      async () => {
        const uid = 920_000 + seq;
        const raw = makeInitData(uid, T0, `q-replay-${seq}`);
        const first = await login(w, raw, T0);
        expect(first.session.initDataHash).toBe(fingerprintInitData(raw));

        // نفسُ الرسالةِ بحرفِها: توقيعُها ما زال صحيحاً وعمرُها ما زال
        // مقبولاً — فالتوقيعُ وحدَه لا يمنع الإعادةَ، والقيدُ هو ما يمنعها.
        await expect(login(w, raw, T0)).rejects.toMatchObject({
          code: "IDENTITY_SESSION_REPLAY",
          httpStatus: 409,
        });

        // والجلسةُ الأولى تبقى صالحةً: الرفضُ لا يُعاقِب مَن دخلَ بحقّ.
        const principal = await verifySessionToken(w.sessionDeps, first.token);
        expect(principal.sessionId).toBe(first.session.id);
      },
    );

    it("جلسةٌ تنتهي عندَ حدِّها ← AUTHN_EXPIRED", async () => {
      const uid = 930_000 + seq;
      const raw = makeInitData(uid, T0, `q-exp-${seq}`);
      const issued = await login(w, raw, T0);

      w.clock.advance(DEFAULT_SESSION_TTL_SECONDS - 1);
      expect((await verifySessionToken(w.sessionDeps, issued.token)).sessionId).toBe(
        issued.session.id,
      );

      w.clock.advance(1);
      await expect(verifySessionToken(w.sessionDeps, issued.token)).rejects.toMatchObject({
        code: "AUTHN_EXPIRED",
      });
    });

    it("init-data قديمٌ ← يُرفَض قبلَ أن يصل إلى الهويّة", async () => {
      const uid = 940_000 + seq;
      const old = new Date(T0.getTime() - 3600 * 1000);
      const raw = makeInitData(uid, old, `q-old-${seq}`);
      expect(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: T0 })).toThrow();
      expect(await w.repo.findUserByTelegramId(uid)).toBeNull();
    });

    it("السحبُ يُبطِل الجلسةَ فوراً", async () => {
      const uid = 950_000 + seq;
      const issued = await login(w, makeInitData(uid, T0, `q-rev-${seq}`), T0);
      await revokeSession(w.sessionDeps, issued.session.id, "بوابةُ M1-02");
      await expect(verifySessionToken(w.sessionDeps, issued.token)).rejects.toMatchObject({
        code: "AUTHN_UNAUTHENTICATED",
      });
    });

    it("دخولٌ ثانٍ برسالةٍ جديدةٍ يُعطي جلسةً ثانيةً لنفسِ المستخدم", async () => {
      const uid = 960_000 + seq;
      const a = await login(w, makeInitData(uid, T0, `q-a-${seq}`), T0);
      w.clock.advance(5);
      const b = await login(w, makeInitData(uid, T0, `q-b-${seq}`), T0);

      expect(b.waslaPublicId).toBe(a.waslaPublicId);
      expect(b.session.id).not.toBe(a.session.id);
      // وسحبُ إحداهما لا يمسّ الأخرى — «اخرج من هذا الجهاز» لا «من كلِّها».
      await revokeSession(w.sessionDeps, a.session.id, "جهازٌ واحد");
      expect((await verifySessionToken(w.sessionDeps, b.token)).sessionId).toBe(b.session.id);
    });

    if (isPostgres) {
      it("لا يُخزَّن الرمزُ في قاعدةِ البياناتِ — بصمتُه فقط", async () => {
        const uid = 970_000 + seq;
        const issued = await login(w, makeInitData(uid, T0, `q-store-${seq}`), T0);
        const rows = await pool!.query<{ all: string }>(
          "SELECT identity_sessions::text AS all FROM identity_sessions WHERE id = $1",
          [issued.session.id],
        );
        expect(rows.rowCount).toBe(1);
        expect(rows.rows[0]!.all).not.toContain(issued.token);
        expect(rows.rows[0]!.all).toContain(issued.session.tokenHash);
      });

      it("الفهرسُ الفريدُ الجزئيُّ يسمح بجلساتٍ متعدّدةٍ بلا init-data", async () => {
        // القنواتُ الأخرى (web/mobile) تُخزّن NULL. فهرسٌ فريدٌ غيرُ جزئيٍّ
        // كان سيمنع وجودَ أكثرَ من واحدةٍ منها في بعضِ الدلالات.
        const uid = 980_000 + seq;
        const issued = await login(w, makeInitData(uid, T0, `q-null-${seq}`), T0);
        const owner = issued.session.userInternalUuid;
        for (const n of [1, 2]) {
          await pool!.query(
            `INSERT INTO identity_sessions
               (user_internal_uuid, channel, token_hash, init_data_hash, expires_at)
             VALUES ($1, 'web', $2, NULL, now() + interval '1 hour')`,
            [owner, String(n).padStart(64, "0")],
          );
        }
        const count = await pool!.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM identity_sessions WHERE user_internal_uuid = $1 AND init_data_hash IS NULL",
          [owner],
        );
        expect(count.rows[0]!.n).toBe("2");
      });
    }
  });
}

// ── المُنفِّذُ الوهميُّ: يجري دائماً، لأنّ بوابةً تُتخطّى ليست بوابة ──────
gateSuite(
  "مُنفِّذُ ذاكرةٍ (الطريقُ والحكمُ الزمنيّ)",
  async () => {
    const repo = new InMemoryIdentityRepository();
    const sessions = new InMemorySessionRepository();
    const clock = new TestClock(new Date(T0));
    const idGen = new CryptoIdGenerator();
    return {
      repo,
      sessions,
      clock,
      identityDeps: {
        repo,
        outbox: new InMemoryOutbox(),
        publicIdSeq: new InMemoryPublicIdSequence(),
        clock,
        idGen,
      },
      sessionDeps: { sessions, repo, clock, idGen },
    };
  },
  false,
);

// ── المحرّكُ الحقيقيُّ: هو وحدَه ما يُثبِت منعَ الإعادةِ عبرَ النسخ ────────
const DATABASE_URL = process.env.DATABASE_URL;
let pool: Pool | undefined;
let db: Db | undefined;

describe.skipIf(!DATABASE_URL)("تهيئةُ Postgres لبوابةِ M1-02", () => {
  beforeAll(async () => {
    const created = createDb({ connectionString: DATABASE_URL! });
    pool = created.pool;
    db = created.db;
    // نفسُ ترتيبِ الإسقاطِ المستعملِ في اختباراتِ الهويّة: الجلساتُ أوّلاً
    // لأنّها تُشير إلى المستخدمين.
    await pool.query(
      "DROP TABLE IF EXISTS identity_sessions, identity_outbox, identity_recovery_requests, identity_history, identity_links, identity_users CASCADE",
    );
    const ddl = await readFile(
      resolve(process.cwd(), "../../services/identity/contracts/schema.sql"),
      "utf-8",
    );
    await pool.query(ddl);
    await ensurePublicIdSequence(db);
  });

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
  });

  it("المخطّطُ مُطبَّقٌ وجدولُ الجلساتِ موجود", async () => {
    const rows = await pool!.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM information_schema.tables WHERE table_name = 'identity_sessions'",
    );
    expect(rows.rows[0]!.n).toBe("1");
  });

  gateSuite(
    "Postgres حقيقيّ (منعُ الإعادةِ قيدُ محرّك)",
    async () => {
      const repo = new PostgresIdentityRepository(db!);
      const sessions = new PostgresSessionRepository(db!);
      const clock = new TestClock(new Date(T0));
      const idGen = new CryptoIdGenerator();
      return {
        repo,
        sessions,
        clock,
        identityDeps: {
          repo,
          outbox: new PostgresOutbox(db!),
          publicIdSeq: new PostgresPublicIdSequence(db!),
          clock,
          idGen,
        },
        sessionDeps: { sessions, repo, clock, idGen },
      };
    },
    true,
  );
});
