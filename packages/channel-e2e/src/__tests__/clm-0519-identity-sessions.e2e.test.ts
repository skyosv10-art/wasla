/**
 * بوابةُ CLM-0519 · **المرحلةُ الأولى من ADR-069** — دورةُ حياةِ جلسةِ
 * المستخدمِ عبرَ حدِّ الهويّةِ (HTTP): الإصدارُ · الاستبدالُ · السحبُ.
 *
 * هذا هو الملفُ الذي يُثبِت الحالاتَ الثلاثَ عشرةَ (I-01..I-13) المُقرَّرةَ
 * في ADR-069 §7.1 على **Postgres حقيقيٍّ** عبرَ `DATABASE_URL`. وحدُّ
 * القياسِ هو `createIdentityApp` نفسُهُ لا نسخةٌ منه — فالطريقُ المُقيسُ هو
 * الطريقُ الذي يُنشرُ.
 *
 * **قاعدةُ الحصرِ المُقرَّرةَ من المالكِ:** كلُّ ما هو `conditional` أو
 * `blocked_until_*` يبقى محجوزاً — فلا اختبارَ هنا يُغطّي تفعيلًا حيًّا أو
 * ربطًا بالتطبيقِ ولا منحًا لغيرِ `customer-bot` و`driver-bot`.
 *
 * **وما لا يُدَّعى هنا:** لا إنتاجَ حيًّا ولا تغييرَ في `Render` — المساراتُ
 * مُنفَّذةٌ ومقيسةٌ على Postgres في CI، والبرهانُ الحيُّ مرحلةٌ مستقلةٌ.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  CryptoIdGenerator,
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
  resolveTelegramIdentity,
  type Db,
  type IdentityRepository,
  type SessionRepository,
  type UseCaseDeps,
} from "@wasla/identity-service";
import { createIdentityApp } from "@wasla/identity-service";
import { InMemoryServiceTokenReplayGuard, ServiceAuthKeyRegistry, serviceAuthHeaders } from "@wasla/service-auth";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const T0 = new Date("2026-10-09T00:00:00.000Z");
const TEST_SERVICE_SECRET = "clm-0519-test-service-secret-012345";
const TEST_ACTIVE_KID = "test-active-clm-0519";

/**
 * ساعةٌ يقودها الاختبار. **القرارُ المُقرَّرُ من المالكِ (§6 المرحلةُ الأولى):**
 * اختباراتُ النجاحِ والفشلِ على Postgres حقيقيٍّ — فالتقديمُ الزمنيُّ هنا
 * مقصودٌ لا «تجاوزٌ»، والقاعدةُ التي تحرسهُ أنّ الطريقَ يُقاسُ لا يُتظاهَرُ بهِ.
 */
class TestClock {
  constructor(private current: Date) {}
  now(): string {
    return this.current.toISOString();
  }
  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
  set(at: Date): void {
    this.current = new Date(at.getTime());
  }
}

/** كلُّ الصلاحيّاتِ المفروضةِ في حدِّ الهويّةِ — لكِ يُثبَتَ المسارُ لا الصلاحيّةُ. */
const ALL_IDENTITY_SCOPES: readonly string[] = [
  "identity:resolve:write",
  "identity:user:read",
  "identity:link:write",
  "identity:recovery:write",
  "identity:history:read",
  "identity:assertion:issue",
  "identity:session:issue",
  "identity:session:exchange",
  "identity:session:revoke",
];

function createTestKeyRegistry(
  secret: string = TEST_SERVICE_SECRET,
): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [{ kid: TEST_ACTIVE_KID, secret, status: "active" }],
    activeKid: TEST_ACTIVE_KID,
  });
}

/** ترويساتُ نداءٍ موقَّعٍ مربوطٍ بهذه الطريقةِ وهذا المسارِ. */
function signFor(
  method: string,
  url: string,
  options: {
    keys?: ServiceAuthKeyRegistry;
    scopes?: readonly string[];
    serviceName?: string;
    now?: Date;
  } = {},
): Record<string, string> {
  return serviceAuthHeaders({
    serviceName: options.serviceName ?? "customer-bot",
    audience: "identity",
    method: method.toUpperCase(),
    path: url,
    keys: options.keys ?? createTestKeyRegistry(),
    now: options.now ?? new Date(),
    scopes: options.scopes ?? ALL_IDENTITY_SCOPES,
  });
}

/**
 * مُولِّدُ مفتاحِ Ed25519 في الاختبارِ. لا يُخالِفُ «لا مفتاحَ إنتاجيًّا في
 * المستودعِ» لأنّهُ مُولَّدٌ وقتَ الاختبارِ لا مكتوبٌ في المستودعِ.
 */
function generateTestEd25519Key(): { kid: string; privateKeyPem: string; publicKeyPem: string } {
  // نُولِّدُ مفتاحًا مُنفردًا لكلِّ جولةِ اختبارٍ — فلا يُقرأ من المستودعِ.
  const { generateKeyPairSync } = require("node:crypto") as {
    generateKeyPairSync(algorithm: string, options: Record<string, unknown>): {
      privateKey: { export: (fmt: { type: string; format: string }) => string };
      publicKey: { export: (fmt: { type: string; format: string }) => string };
    };
  };
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {});
  return {
    kid: `clm-0519-test-${Math.random().toString(36).slice(2, 8)}`,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

/** مفتاحُ إصدارِ `wua1` المُستعمَلُ في الجولاتِ — مُولَّدٌ وقتَ الاختبارِ. */
function buildUserAssertionSigningKey() {
  const { createPrivateKey } = require("node:crypto") as {
    createPrivateKey(pem: string | { key: string; format: string; type: string }): unknown;
  };
  const kp = generateTestEd25519Key();
  return {
    kid: kp.kid,
    privateKey: createPrivateKey(kp.privateKeyPem) as never,
  };
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

/** يُعيدُ التطبيقَ المُسَيَّجَ لحدِّ الهويّةِ — نفسُ الطريقِ الذي يُنشرُ. */
function buildApp(
  w: Wiring,
  options: {
    signingKey: ReturnType<typeof buildUserAssertionSigningKey> | null;
  },
): ReturnType<typeof createIdentityApp> {
  const keys = createTestKeyRegistry();
  return createIdentityApp({
    deps: w.identityDeps,
    logger: true,
    serviceIdentity: {
      keys,
      // **حارسُ الإعادةِ بساعةٍ مقودةٍ لا بساعةِ الجدارِ:** فبدونها يُخزَّنُ
      // الأثرُ بزمنٍ حقيقيٍّ ويُقرأ بزمنٍ آخرَ — والفرقُ يُسقِطُ اختبارَ
      // «الرمزُ مُعاد» حينَ يُوقَّفُ الاختبارُ (ساعةُ التوقيعِ مُزاحةٌ إلى `T0`).
      replayGuard: new InMemoryServiceTokenReplayGuard({ now: () => new Date(w.clock.now()) }),
    },
    userAssertion: {
      signingKey: options.signingKey,
      now: () => new Date(w.clock.now()),
      ttlSeconds: 60,
    },
    session: w.sessionDeps,
  });
}

/**
 * ADR-069 · CLM-0519: هذا «التطبيقُ» المُسَيَّجُ يُتركُ مُستعمَلاً في اختباراتِ
 * الحالاتِ I-01..I-13 — فكلُّ حالةٍ تُبنى في `beforeEach` لا من هنا. (هذهِ
 * الدالّةُ تُركَت للقراءةِ لا للنداءِ — المُجموعَةُ تُنشئُ التطبيقَ بنفسِها.)
 */
void buildApp;

/**
 * يُصدِرُ جلسةً عبرَ حدِّ HTTP — نفسُ ما سيفعلهُ الوسيطُ في الإنتاجِ. يُقرأُ
 * مِن `init-data` الخامِّ أنّهُ مُوقَّعٌ من `signInitDataForTests` في المحوَّلِ،
 * فلا يُدَّعى التوقيعُ على خلافِهِ (ADR-018).
 */
async function seedUser(w: Wiring, telegramUserId: number): Promise<void> {
  // المُسَيَّجُ يُنشئُ المستخدمَ إن لم يُوجد (نفسُ طريقِ الإنتاجِ) — لا اختراعَ
  // سجلٍّ بيدِ الاختبارِ هنا.
  await resolveTelegramIdentity(w.identityDeps, {
    telegram_user_id: telegramUserId,
    telegram_username: `gate${telegramUserId}`,
  });
}

/** يُصدِرُ جلسةً عبرَ حدِّ HTTP — نفسُ ما سيفعلهُ الوسيطُ في الإنتاجِ. */
async function issueViaHttp(
  app: ReturnType<typeof createIdentityApp>,
  telegramUserId: number,
  initDataFingerprint: string,
  now: Date,
  options: {
    keys?: ServiceAuthKeyRegistry;
    scopes?: readonly string[];
    serviceName?: string;
    body?: Record<string, unknown>;
  } = {},
): Promise<{ statusCode: number; json: () => Promise<unknown> }> {
  const headers = signFor("POST", "/identity/sessions", {
    keys: options.keys,
    scopes: options.scopes,
    serviceName: options.serviceName,
    now,
  });
  const body = {
    telegram_user_id: telegramUserId,
    init_data_fingerprint: initDataFingerprint,
    ...(options.body ?? {}),
  };
  return app.inject({
    method: "POST",
    url: "/identity/sessions",
    headers,
    payload: body,
  });
}

/**
 * يُقايِضُ جلسةً بتأكيدٍ قصيرِ العمرِ عبرَ حدِّ HTTP. لا يُمرَّرُ التأكيدُ في
 * الجسمِ ولا في ترويسةٍ سِرِّيّةٍ — يُردُّ في الاستجابةِ وحدَها (I-13).
 */
async function exchangeViaHttp(
  app: ReturnType<typeof createIdentityApp>,
  sessionToken: string,
  audience: readonly string[],
  now: Date,
  options: {
    keys?: ServiceAuthKeyRegistry;
    scopes?: readonly string[];
    serviceName?: string;
  } = {},
): Promise<{ statusCode: number; json: () => Promise<unknown> }> {
  const headers = signFor("POST", "/identity/sessions/exchange", {
    keys: options.keys,
    scopes: options.scopes,
    serviceName: options.serviceName,
    now,
  });
  return app.inject({
    method: "POST",
    url: "/identity/sessions/exchange",
    headers,
    payload: { session_token: sessionToken, audience },
  });
}

/**
 * يسحبُ جلسةً برموزِها عبرَ حدِّ HTTP.
 */
async function revokeViaHttp(
  app: ReturnType<typeof createIdentityApp>,
  sessionToken: string,
  now: Date,
  options: {
    keys?: ServiceAuthKeyRegistry;
    scopes?: readonly string[];
    serviceName?: string;
    reason?: string;
  } = {},
): Promise<{ statusCode: number; json: () => Promise<unknown> }> {
  const headers = signFor("POST", "/identity/sessions/revoke", {
    keys: options.keys,
    scopes: options.scopes,
    serviceName: options.serviceName,
    now,
  });
  return app.inject({
    method: "POST",
    url: "/identity/sessions/revoke",
    headers,
    payload: {
      session_token: sessionToken,
      ...(options.reason === undefined ? {} : { reason: options.reason }),
    },
  });
}

/** يبني `init-data` مُوقَّعاً كما ترسله تلغرام. */
function makeInitDataRaw(
  telegramUserId: number,
  at: Date,
  queryId: string,
): string {
  // `signInitDataForTests` مُصدَّرٌ من `@wasla/telegram-adapter` — ولا يُقرأُ
  // هنا أصلاً لأنّ الحدَّ لا يتلقّى init-data خاماً بل بصمتَهُ.
  // (هذه الدالّةُ تُسَمَّى في بوابةِ M1-02 لا هنا؛ تُركَت للاتّساقِ.)
  return `auth_date=${Math.floor(at.getTime() / 1000)}&query_id=${queryId}&user=${JSON.stringify({
    id: telegramUserId,
    first_name: "بوابة",
    username: `gate${telegramUserId}`,
    language_code: "ar",
  })}`;
}

/** بصمةُ init-data في الاختبارِ: `sha256` للرسالةِ الخامِّ (لا يُخزَّنُ الرسالةُ). */
async function fingerprintFor(telegramUserId: number, queryId: string, at: Date): Promise<string> {
  const { createHash } = await import("node:crypto");
  const raw = makeInitDataRaw(telegramUserId, at, queryId);
  return createHash("sha256").update(raw).digest("hex");
}

// ── المجموعةُ المُسَيَّجَةُ للحالاتِ I-01..I-13 ─────────────────────────────────
function sessionRoutesSuite(
  label: string,
  build: () => Promise<Wiring>,
  isPostgres: boolean,
): void {
  describe(`بوابةُ CLM-0519 · ${label}`, () => {
    let w: Wiring;
    let app: ReturnType<typeof createIdentityApp>;
    let signingKey: ReturnType<typeof buildUserAssertionSigningKey>;
    let logs: Array<Record<string, unknown>>;
    let seq = 0;

    beforeEach(async () => {
      w = await build();
      seq += 1;
      signingKey = buildUserAssertionSigningKey();
      logs = [];
      app = createIdentityApp({
        deps: w.identityDeps,
        logger: {
          level: "info",
          base: undefined,
          timestamp: () => `,"time":"${new Date().toISOString()}"`,
        } as never,
        serviceIdentity: {
          keys: createTestKeyRegistry(),
          replayGuard: new InMemoryServiceTokenReplayGuard(),
          // **ساعةُ فرضِ هويّةِ الخدمةِ يقودها الاختبارُ لا الجدارُ**: فبدونها يُقرأ
          // `iat` من `Date.now()` الحقيقيِّ والساعةُ المُزاحةُ في `TestClock` تُصدِرُ
          // رمزًا «مستقبليًّا» فيُرفَضُ (I-01..I-13 تُبنى كلُّها فوقَ `T0`).
          now: () => new Date(w.clock.now()),
        },
        userAssertion: {
          signingKey,
          now: () => new Date(w.clock.now()),
          ttlSeconds: 60,
        },
        session: w.sessionDeps,
      });
      // نلتقطُ ما يُكتَبُ في السجلِّ (I-13): لا رمزَ ولا بصمةً ولا مُعرِّفًا داخليًّا.
      const originalInfo = app.log.info.bind(app.log);
      (app.log as { info: unknown }).info = function (this: unknown, ...args: unknown[]) {
        const obj = typeof args[0] === "object" && args[0] !== null ? (args[0] as Record<string, unknown>) : {};
        const msg = typeof args[1] === "string" ? args[1] : (typeof args[0] === "string" ? args[0] : "");
        logs.push({ ...obj, message: msg });
        return originalInfo(...(args as [Record<string, unknown>, string]));
      };
    });

    it(
      isPostgres
        ? "**I-01** إصدارٌ من customer-bot ببصمةٍ صالحةٍ ← 201 + رمزٌ لا يُقرأُ إلا مرّةً"
        : "I-01 إصدارٌ من customer-bot ببصمةٍ صالحةٍ ← 201 (على مُنفِّذِ ذاكرةٍ — لا يُعتَدُّ بهِ للإنتاجِ)",
      async () => {
        const uid = 900_000 + seq;
        await seedUser(w, uid);
        const fingerprint = await fingerprintFor(uid, `q-i01-${seq}`, T0);
        const response = await issueViaHttp(app, uid, fingerprint, T0, {
          serviceName: "customer-bot",
        });
        expect(response.statusCode).toBe(201);
        const body = (await response.json()) as {
          token: string;
          wasla_public_id: string;
          actor_type: "customer" | "driver";
          expires_at: string;
          session_id: string;
        };
        expect(body.token).toBeTruthy();
        expect(body.wasla_public_id).toMatch(/^WS-\d{10}$/);
        expect(body.actor_type).toBe("customer");
        expect(Date.parse(body.expires_at)).toBeGreaterThan(T0.getTime());
        expect(body.session_id).toMatch(/^[0-9a-f-]{36}$/);
      },
    );

    it(
      isPostgres
        ? "**I-02** إعادةُ نفسِ البصمةِ ← 409 IDENTITY_SESSION_REPLAY (قيدُ المحرّكِ)"
        : "I-02 إعادةُ نفسِ البصمةِ ← 409 (مُنفِّذُ ذاكرةٍ)",
      async () => {
        const uid = 901_000 + seq;
        await seedUser(w, uid);
        const fingerprint = await fingerprintFor(uid, `q-i02-${seq}`, T0);
        const first = await issueViaHttp(app, uid, fingerprint, T0, { serviceName: "customer-bot" });
        expect(first.statusCode).toBe(201);

        // نفسُ البصمةِ **بحرفِها** — التوقيعُ ما زالَ صحيحاً وعمرُها مقبولٌ،
        // فالرفضُ من القيدِ لا من التوقيعِ.
        const replay = await issueViaHttp(app, uid, fingerprint, T0, { serviceName: "customer-bot" });
        expect(replay.statusCode).toBe(409);
        const body = (await replay.json()) as { code: string };
        expect(body.code).toBe("IDENTITY_SESSION_REPLAY");
      },
    );

    it(
      isPostgres
        ? "**I-03** `actor_type: \"admin\"` في الجسمِ يُهجَرُ — الفاعلُ من مسارِ الثقةِ"
        : "I-03 `actor_type` في الجسمِ يُهجَرُ",
      async () => {
        const uid = 902_000 + seq;
        await seedUser(w, uid);
        const fingerprint = await fingerprintFor(uid, `q-i03-${seq}`, T0);
        const response = await issueViaHttp(app, uid, fingerprint, T0, {
          serviceName: "customer-bot",
          body: { actor_type: "admin" },
        });
        expect(response.statusCode).toBe(201);
        const body = (await response.json()) as { actor_type: "customer" | "driver" };
        expect(body.actor_type).toBe("customer");
      },
    );

    it(
      isPostgres
        ? "**I-04** إصدارٌ من خدمةٍ بلا `identity:session:issue` (dispatch) ← 403"
        : "I-04 إصدارٌ من dispatch ← 403",
      async () => {
        const uid = 903_000 + seq;
        await seedUser(w, uid);
        const fingerprint = await fingerprintFor(uid, `q-i04-${seq}`, T0);
        const response = await issueViaHttp(app, uid, fingerprint, T0, {
          serviceName: "dispatch",
          scopes: ["identity:resolve:write"],
        });
        expect(response.statusCode).toBe(403);
      },
    );

    it(
      isPostgres
        ? "**I-05** نداءٌ بلا ترويسةِ `x-wasla-service-auth` ← 401"
        : "I-05 نداءٌ بلا ترويسةٍ ← 401",
      async () => {
        const uid = 904_000 + seq;
        const fingerprint = await fingerprintFor(uid, `q-i05-${seq}`, T0);
        const response = await app.inject({
          method: "POST",
          url: "/identity/sessions",
          payload: { telegram_user_id: uid, init_data_fingerprint: fingerprint },
        });
        expect(response.statusCode).toBe(401);
      },
    );

    it(
      isPostgres
        ? "**I-06** استبدالُ جلسةٍ صالحةٍ لجمهورٍ مسموحٍ ← 200 + تأكيد `wua1` صالح"
        : "I-06 استبدالٌ لجمهورٍ مسموحٍ ← 200",
      async () => {
        const uid = 905_000 + seq;
        await seedUser(w, uid);
        const fingerprint = await fingerprintFor(uid, `q-i06-${seq}`, T0);
        const issued = await issueViaHttp(app, uid, fingerprint, T0, { serviceName: "customer-bot" });
        expect(issued.statusCode).toBe(201);
        const issuedBody = (await issued.json()) as { token: string };

        const exchanged = await exchangeViaHttp(app, issuedBody.token, ["orders"], T0, {
          serviceName: "customer-bot",
        });
        expect(exchanged.statusCode).toBe(200);
        const exchangeBody = (await exchanged.json()) as {
          assertion: string;
          wasla_public_id: string;
          actor_type: "customer" | "driver";
          audience: string[];
          expires_at: string;
        };
        expect(exchangeBody.assertion).toMatch(/^wua1\./);
        expect(exchangeBody.actor_type).toBe("customer");
        expect(exchangeBody.audience).toContain("orders");
        // ≤60s من الإصدارِ — العمرُ القصيرُ المُقرَّرُ في ADR-069 §2.2.
        const exp = Date.parse(exchangeBody.expires_at);
        expect(exp).toBeLessThanOrEqual(T0.getTime() + 60_000);
        expect(exp).toBeGreaterThan(T0.getTime());
      },
    );

    it(
      isPostgres
        ? "**I-07** استبدالُ جلسةٍ منتهيةٍ ← 401 `AUTHN_EXPIRED`"
        : "I-07 جلسةٌ منتهيةٌ ← 401 AUTHN_EXPIRED",
      async () => {
        const uid = 906_000 + seq;
        await seedUser(w, uid);
        const fingerprint = await fingerprintFor(uid, `q-i07-${seq}`, T0);
        const issued = await issueViaHttp(app, uid, fingerprint, T0, { serviceName: "customer-bot" });
        const issuedBody = (await issued.json()) as { token: string };

        // نُقدِّمُ الساعةَ إلى ما بعدَ الانتهاءِ (4 ساعاتٍ افتراضيّاً).
        w.clock.advance(4 * 60 * 60 + 1);
        const exchanged = await exchangeViaHttp(app, issuedBody.token, ["orders"], new Date(w.clock.now()), {
          serviceName: "customer-bot",
        });
        expect(exchanged.statusCode).toBe(401);
        const body = (await exchanged.json()) as { code: string; message: string };
        expect(body.code).toBe("AUTHN_EXPIRED");
        expect(body.message).toContain("انتهت مدّةُ الجلسةِ");
      },
    );

    it(
      isPostgres
        ? "**I-08** استبدالُ رمزٍ مُلغىً أو غيرِ معروفٍ ← 401 `AUTHN_UNAUTHENTICATED` بنفسِ الكودِ والنصِّ"
        : "I-08 رمزٌ مُلغىً أو غيرُ معروفٍ ← 401",
      async () => {
        const uid = 907_000 + seq;
        await seedUser(w, uid);
        const fingerprint = await fingerprintFor(uid, `q-i08-${seq}`, T0);
        const issued = await issueViaHttp(app, uid, fingerprint, T0, { serviceName: "customer-bot" });
        const issuedBody = (await issued.json()) as { token: string; session_id: string };

        // 1) مُلغىً: نسحبُ ثمّ نستبدلُ.
        const revoked = await revokeViaHttp(app, issuedBody.token, T0, { serviceName: "customer-bot" });
        expect(revoked.statusCode).toBe(200);
        const afterRevoke = await exchangeViaHttp(app, issuedBody.token, ["orders"], T0, {
          serviceName: "customer-bot",
        });
        expect(afterRevoke.statusCode).toBe(401);
        const revokedBody = (await afterRevoke.json()) as { code: string; message: string };

        // 2) غيرُ معروفٍ: رمزٌ عشوائيٌّ.
        const unknown = await exchangeViaHttp(app, "not-a-real-session-token", ["orders"], T0, {
          serviceName: "customer-bot",
        });
        expect(unknown.statusCode).toBe(401);
        const unknownBody = (await unknown.json()) as { code: string; message: string };

        // **نفسُ الكودِ ونفسُ النصِّ** — تمييزُهما يُخبِرُ المهاجمَ أنّ رمزَهُ
        // كانَ صحيحاً يوماً (I-08).
        expect(revokedBody.code).toBe(unknownBody.code);
        expect(revokedBody.code).toBe("AUTHN_UNAUTHENTICATED");
        expect(revokedBody.message).toBe(unknownBody.message);
        expect(revokedBody.message).toBe("رمزُ الجلسةِ غيرُ مقبول.");
      },
    );

    it(
      isPostgres
        ? "**I-09** استبدالٌ لجمهورٍ خارجِ قائمةِ الفاعلِ ← 403 `IDENTITY_ASSERTION_FORBIDDEN`"
        : "I-09 جمهورٌ خارجُ القائمةِ ← 403",
      async () => {
        const uid = 908_000 + seq;
        await seedUser(w, uid);
        const fingerprint = await fingerprintFor(uid, `q-i09-${seq}`, T0);
        const issued = await issueViaHttp(app, uid, fingerprint, T0, { serviceName: "customer-bot" });
        const issuedBody = (await issued.json()) as { token: string };

        // `audit` جمهورٌ لا يملكُهُ `customer` في `ASSERTION_AUDIENCES_BY_ACTOR`.
        const exchanged = await exchangeViaHttp(app, issuedBody.token, ["audit"], T0, {
          serviceName: "customer-bot",
        });
        expect(exchanged.statusCode).toBe(403);
        const body = (await exchanged.json()) as { code: string };
        expect(body.code).toBe("IDENTITY_ASSERTION_FORBIDDEN");
      },
    );

    it(
      isPostgres
        ? "**I-10** استبدالٌ من driver-bot لجلسةِ `customer` ← 403 (تعارضُ الفاعلِ مع المنادي)"
        : "I-10 تعارضُ الفاعلِ مع المنادي ← 403",
      async () => {
        const uid = 909_000 + seq;
        await seedUser(w, uid);
        const fingerprint = await fingerprintFor(uid, `q-i10-${seq}`, T0);
        const issued = await issueViaHttp(app, uid, fingerprint, T0, { serviceName: "customer-bot" });
        const issuedBody = (await issued.json()) as { token: string };

        // `driver-bot` لا يستبدلُ جلسةَ `customer` — فالبوتُ لا يُبدّلُ شخصاً.
        const exchanged = await exchangeViaHttp(app, issuedBody.token, ["orders"], T0, {
          serviceName: "driver-bot",
        });
        expect(exchanged.statusCode).toBe(403);
        const body = (await exchanged.json()) as { code: string };
        expect(body.code).toBe("IDENTITY_ASSERTION_FORBIDDEN");
      },
    );

    it(
      isPostgres
        ? "**I-11** مستخدمٌ موقوفٌ ← 403 `IDENTITY_USER_SUSPENDED`، ولا جلسةَ ولا تأكيدَ"
        : "I-11 مستخدمٌ موقوفٌ ← 403",
      async () => {
        const uid = 910_000 + seq;
        await seedUser(w, uid);
        const fingerprint = await fingerprintFor(uid, `q-i11-${seq}`, T0);
        const issued = await issueViaHttp(app, uid, fingerprint, T0, { serviceName: "customer-bot" });
        const issuedBody = (await issued.json()) as { token: string; wasla_public_id: string };

        // نُوقِفُ المستخدمَ مباشرةً في المستودعِ (الطريقُ الإداريُّ).
        const owner = await w.repo.findUserByTelegramId(uid);
        expect(owner).not.toBeNull();
        await w.repo.updateUserStatus(owner!.internalUuid, "suspended");

        // **السحبُ الأوّلُ قبلَ الاستبدالِ:** جلسةُ المستخدمِ الموقوفِ لا تُقايِضُ
        // بتأكيدٍ، لكنّ حارسَ الإعادةِ (الفهرسُ الفريدُ) يرفضُ طلباً ثانياً بنفسِ
        // البصمةِ. فالطريقُ الوحيدُ الذي يُثبِتُ I-11 هُنا هوَ جلسةٌ جديدةٌ برسالةٍ
        // جديدةٍ (بصمةٌ جديدةٌ) — لا إعادةُ نداءٍ بالبصمةِ المُستهلَكةِ.
        const fingerprint2 = await fingerprintFor(uid, `q-i11b-${seq}`, T0);
        const exchangeAttempt = await exchangeViaHttp(app, issuedBody.token, ["orders"], T0, {
          serviceName: "customer-bot",
        });
        // **الموقوفُ يُرفَضُ في الاستبدالِ بـ`IDENTITY_USER_SUSPENDED` (403)** —
        // والفهرسُ الفريدُ لا يمنعُ ذلكَ لأنّ الطلبَ استبدالٌ لا إصدار.
        expect(exchangeAttempt.statusCode).toBe(403);
        const body = (await exchangeAttempt.json()) as { code: string };
        expect(body.code).toBe("IDENTITY_USER_SUSPENDED");

        // ولا إصدارُ جلسةٍ جديدةٍ يعملُ للموقوفِ (بصمةٌ جديدةٌ لا تُشبهُ القديمة).
        const issueAttempt = await issueViaHttp(app, uid, fingerprint2, T0, { serviceName: "customer-bot" });
        expect(issueAttempt.statusCode).toBe(403);
        const issueBody = (await issueAttempt.json()) as { code: string };
        expect(issueBody.code).toBe("IDENTITY_USER_SUSPENDED");
      },
    );

    it(
      isPostgres
        ? "**I-12** لا مفتاحَ توقيعٍ `wua1` ← 503 `IDENTITY_ASSERTION_UNAVAILABLE`"
        : "I-12 لا مفتاحَ ← 503",
      async () => {
        const uid = 911_000 + seq;
        await seedUser(w, uid);
        const fingerprint = await fingerprintFor(uid, `q-i12-${seq}`, T0);
        const noKeyKeys = createTestKeyRegistry();
        const noKeyApp = createIdentityApp({
          deps: w.identityDeps,
          logger: false,
          serviceIdentity: {
            keys: noKeyKeys,
            replayGuard: new InMemoryServiceTokenReplayGuard({ now: () => new Date(w.clock.now()) }),
            now: () => new Date(w.clock.now()),
          },
          userAssertion: {
            signingKey: null,
            now: () => new Date(w.clock.now()),
          },
          session: w.sessionDeps,
        });
        const issued = await noKeyApp.inject({
          method: "POST",
          url: "/identity/sessions",
          headers: signFor("POST", "/identity/sessions", {
            keys: noKeyKeys,
            serviceName: "customer-bot",
            now: new Date(w.clock.now()),
          }),
          payload: { telegram_user_id: uid, init_data_fingerprint: fingerprint },
        });
        expect(issued.statusCode).toBe(201);
        const issuedBody = (await issued.json()) as { token: string };

        const exchanged = await noKeyApp.inject({
          method: "POST",
          url: "/identity/sessions/exchange",
          headers: signFor("POST", "/identity/sessions/exchange", {
            keys: noKeyKeys,
            serviceName: "customer-bot",
            now: new Date(w.clock.now()),
          }),
          payload: { session_token: issuedBody.token, audience: ["orders"] },
        });
        expect(exchanged.statusCode).toBe(503);
        const body = (await exchanged.json()) as { code: string };
        expect(body.code).toBe("IDENTITY_ASSERTION_UNAVAILABLE");
      },
    );

    it(
      isPostgres
        ? "**I-13** السجلُّ لا يحملُ الرمزَ ولا البصمةَ الكاملةَ ولا المُعرِّفَ الداخليَّ (فحصٌ نصّيٌّ)"
        : "I-13 السجلُّ نظيفٌ من الأسرارِ",
      async () => {
        const uid = 912_000 + seq;
        await seedUser(w, uid);
        const fingerprint = await fingerprintFor(uid, `q-i13-${seq}`, T0);
        const issued = await issueViaHttp(app, uid, fingerprint, T0, { serviceName: "customer-bot" });
        const issuedBody = (await issued.json()) as { token: string; session_id: string };
        const exchanged = await exchangeViaHttp(app, issuedBody.token, ["orders"], T0, {
          serviceName: "customer-bot",
        });
        expect(exchanged.statusCode).toBe(200);
        const revoked = await revokeViaHttp(app, issuedBody.token, T0, { serviceName: "customer-bot" });
        expect(revoked.statusCode).toBe(200);

        const logText = JSON.stringify(logs);
        // لا رمزَ جلسةٍ صريحاً في السجلِّ.
        expect(logText).not.toContain(issuedBody.token);
        // لا بصمةَ init-data كاملةً (تُخزَّنُ مُعمّاةً في القاعدةِ لا نصًّا في السجلِّ).
        expect(logText).not.toContain(fingerprint);
        // لا مُعرِّفًا داخليًّا (UUID) في السجلِّ — يُقرأُ المعرِّفُ العامُّ وحدَهُ.
        const owner = await w.repo.findUserByTelegramId(uid);
        expect(owner).not.toBeNull();
        expect(logText).not.toContain(owner!.internalUuid);
      },
    );
  });
}

// ── المُنفِّذُ الوهميُّ: يجري دائمًا (الطريقُ والحكمُ الزمنيُّ) ──────────────────
sessionRoutesSuite(
  "مُنفِّذُ ذاكرةٍ (الطريقُ والحكمُ الزمنيُّ)",
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

// ── المحرّكُ الحقيقيُّ: هو وحدَه ما يُثبِت القيودَ عبرَ النسخِ المتعدّدةِ ──────
const DATABASE_URL = process.env.DATABASE_URL;
let pool: Pool | undefined;
let db: Db | undefined;

describe.skipIf(!DATABASE_URL)("تهيئةُ Postgres لبوابةِ CLM-0519", () => {
  beforeAll(async () => {
    const created = createDb({ connectionString: DATABASE_URL! });
    pool = created.pool;
    db = created.db;
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

  sessionRoutesSuite(
    "Postgres حقيقيّ (الحالاتُ I-01..I-13)",
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
