/**
 * ADR-060 §6 · CLM-0440 — اختباراتُ `wua1` الإيجابيّةُ والسلبيّةُ.
 *
 * كلُّ مفتاحٍ هنا يُولَّدُ داخلَ الاختبارِ بـ`generateKeyPairSync` — لا مادّةَ مفتاحٍ في Git.
 * المقيسُ: التوقيعُ المزوَّرُ، الحمولةُ المُعدَّلةُ، `kid` المجهولُ، رمزُ HMAC المُقلَّدُ،
 * انتهاءُ الصلاحيّةِ، `iat` المستقبليُّ، العمرُ الأطولُ من 300 ث، الجمهورُ الخاطئُ،
 * `sub ≠ obo`، `via` غيرُ المسموحِ، الفاعلُ غيرُ المسموحِ، الغيابُ، التشوُّهُ —
 * ثمَّ أوضاعُ المُستقبِلِ الثلاثةُ على Fastify، وأنَّ المفتاحَ الخاصَّ لا يظهرُ في نصٍّ.
 */
import { createHmac, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { inspect } from "node:util";

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  incomingDelegationOf,
  registerServiceIdentityOnFastify,
  type ServiceIdentityDenial,
} from "../fastify.js";
import { ServiceAuthKeyRegistry } from "../keys.js";
import { InMemoryServiceTokenReplayGuard } from "../replay.js";
import { serviceAuthHeaders } from "../http.js";
import {
  MAX_USER_ASSERTION_TTL_SECONDS,
  USER_ASSERTION_HEADER,
  UserAssertionConfigError,
  mintUserAssertion,
  userAssertionDenialOf,
  userAssertionHeaders,
  userAssertionModeFromEnv,
  userAssertionPublicKeysFromEnv,
  userAssertionSigningKey,
  userAssertionSigningKeyFromEnv,
  verifyUserAssertion,
  type UserAssertionMode,
  type UserAssertionPublicKeys,
  type VerifyUserAssertionOptions,
} from "../user-assertion.js";

const NOW = new Date("2026-10-02T12:00:00.000Z");
const SUB = "WU-CUST-0001";

function pair(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync("ed25519");
}

const primary = pair();
const attacker = pair();
const KEY = userAssertionSigningKey("ua-2026-10", primary.privateKey);
const PUBLIC: UserAssertionPublicKeys = new Map([["ua-2026-10", primary.publicKey]]);

function mint(overrides: Partial<Parameters<typeof mintUserAssertion>[0]> = {}): string {
  return mintUserAssertion({
    key: KEY,
    sub: SUB,
    act: "customer",
    chn: "telegram",
    via: "customer-bot",
    aud: ["negotiations"],
    now: NOW,
    ...overrides,
  }).assertion;
}

function opts(overrides: Partial<VerifyUserAssertionOptions> = {}): VerifyUserAssertionOptions {
  return {
    publicKeys: PUBLIC,
    audience: "negotiations",
    onBehalfOfPublicId: SUB,
    callerService: "customer-bot",
    actors: ["customer"],
    now: NOW,
    ...overrides,
  };
}

function b64(json: unknown): string {
  return Buffer.from(JSON.stringify(json), "utf8").toString("base64url");
}

function payloadOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("wua1 — المسارُ الإيجابيُّ", () => {
  it("يصكُّ ويتحقّقُ ذهاباً وإياباً، والحمولةُ كما في ADR-060 §2.2", () => {
    const token = mint();
    expect(token.startsWith("wua1.")).toBe(true);
    const verdict = verifyUserAssertion(token, opts());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.payload).toMatchObject({
      kid: "ua-2026-10",
      iss: "identity",
      sub: SUB,
      act: "customer",
      chn: "telegram",
      via: "customer-bot",
      aud: ["negotiations"],
      iat: NOW.getTime() / 1000,
      exp: NOW.getTime() / 1000 + 60,
    });
    expect(verdict.payload.jti).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it("المُمرِّرُ المُعلَنُ (drivers → matching) مقبولٌ، والمُمرِّرُ غيرُ المُعلَنِ مرفوضٌ", () => {
    const token = mint({ act: "driver", via: "driver-bot", aud: ["drivers", "matching"] });
    const base = { audience: "matching", callerService: "drivers", actors: ["driver" as const] };
    expect(verifyUserAssertion(token, opts({ ...base, forwarders: ["drivers"] })).ok).toBe(true);
    expect(verifyUserAssertion(token, opts(base))).toEqual({ ok: false, reason: "via_not_allowed" });
  });

  it("يقبلُ أيَّ `kid` معروفٍ — نافذةُ التدويرِ تحملُ مفتاحَينِ عامَّينِ", () => {
    const next = pair();
    const nextKey = userAssertionSigningKey("ua-2026-11", next.privateKey);
    const both = new Map([...PUBLIC, ["ua-2026-11", next.publicKey]]);
    expect(verifyUserAssertion(mint(), opts({ publicKeys: both })).ok).toBe(true);
    expect(verifyUserAssertion(mint({ key: nextKey }), opts({ publicKeys: both })).ok).toBe(true);
    // الإبطالُ: حذفُ الـkid القديمِ يُسقطُ كلَّ تأكيدٍ وقّعَهُ.
    const revoked = new Map([["ua-2026-11", next.publicKey]]);
    expect(verifyUserAssertion(mint(), opts({ publicKeys: revoked }))).toEqual({ ok: false, reason: "assertion_unknown_kid" });
  });
});

describe("wua1 — المسارُ السلبيُّ (ADR-060 §6)", () => {
  it("توقيعٌ مزوَّرٌ بمفتاحِ مهاجمٍ تحتَ kid صحيحٍ ⇒ bad_signature", () => {
    const forged = mint({ key: userAssertionSigningKey("ua-2026-10", attacker.privateKey) });
    expect(verifyUserAssertion(forged, opts())).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("حمولةٌ مُعدَّلةٌ (sub آخر) مع التوقيعِ الأصليِّ ⇒ bad_signature، ولا يُقرأُ sub", () => {
    const token = mint();
    const [scheme, , sig] = token.split(".");
    const tampered = `${scheme}.${b64({ ...payloadOf(token), sub: "WU-VICTIM-9" })}.${sig}`;
    expect(verifyUserAssertion(tampered, opts({ onBehalfOfPublicId: "WU-VICTIM-9" }))).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("حمولةٌ مُعدَّلةٌ (aud موسَّع) ⇒ bad_signature", () => {
    const token = mint();
    const [scheme, , sig] = token.split(".");
    const tampered = `${scheme}.${b64({ ...payloadOf(token), aud: ["negotiations", "marketplace"] })}.${sig}`;
    expect(verifyUserAssertion(tampered, opts({ audience: "marketplace" }))).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("رمزٌ مُقلَّدٌ بتوقيعِ HMAC (بمفتاحٍ متماثلٍ تعرفُهُ الخدماتُ) ⇒ bad_signature", () => {
    const body = `wua1.${b64(payloadOf(mint()))}`;
    const hmac = createHmac("sha512", "shared-service-secret").update(body).digest().toString("base64url");
    expect(verifyUserAssertion(`${body}.${hmac}`, opts())).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("kid مجهولٌ ⇒ assertion_unknown_kid", () => {
    const other = userAssertionSigningKey("ua-unknown", primary.privateKey);
    expect(verifyUserAssertion(mint({ key: other }), opts())).toEqual({ ok: false, reason: "assertion_unknown_kid" });
  });

  it("منتهي الصلاحيّةِ ⇒ expired (حتّى بعدَ نافذةِ الانحرافِ لا قبلَها)", () => {
    const token = mint({ ttlSeconds: 60 });
    expect(verifyUserAssertion(token, opts({ now: new Date(NOW.getTime() + 59_000) })).ok).toBe(true);
    expect(verifyUserAssertion(token, opts({ now: new Date(NOW.getTime() + 60_000) }))).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("iat في المستقبلِ أبعدَ من الانحرافِ ⇒ not_yet_valid", () => {
    const token = mint({ now: new Date(NOW.getTime() + 31_000) });
    expect(verifyUserAssertion(token, opts())).toEqual({ ok: false, reason: "not_yet_valid" });
    expect(verifyUserAssertion(mint({ now: new Date(NOW.getTime() + 29_000) }), opts()).ok).toBe(true);
  });

  it("عمرٌ أطولُ من 300 ث مُوقَّعٌ صحيحاً ⇒ ttl_too_long، والصكُّ نفسُه يرفضُه", () => {
    expect(() => mint({ ttlSeconds: MAX_USER_ASSERTION_TTL_SECONDS + 1 })).toThrow(UserAssertionConfigError);
    // صكٌّ يدويٌّ يتجاوزُ الحدَّ — كأنَّ مُصدِراً خاطئاً وقّعَهُ.
    const iat = NOW.getTime() / 1000;
    const body = `wua1.${b64({ ...payloadOf(mint()), iat, exp: iat + 301 })}`;
    const sig = sign(null, Buffer.from(body), primary.privateKey).toString("base64url");
    expect(verifyUserAssertion(`${body}.${sig}`, opts())).toEqual({ ok: false, reason: "ttl_too_long" });
  });

  it("الخدمةُ المقصودةُ خاطئةٌ ⇒ wrong_audience", () => {
    expect(verifyUserAssertion(mint({ aud: ["marketplace"] }), opts())).toEqual({ ok: false, reason: "wrong_audience" });
  });

  it("sub لا يطابقُ obo ⇒ obo_mismatch، وغيابُ obo كذلك", () => {
    expect(verifyUserAssertion(mint(), opts({ onBehalfOfPublicId: "WU-OTHER-0002" }))).toEqual({
      ok: false,
      reason: "obo_mismatch",
    });
    expect(verifyUserAssertion(mint(), opts({ onBehalfOfPublicId: undefined }))).toEqual({
      ok: false,
      reason: "obo_mismatch",
    });
  });

  it("المنادي ليسَ via ولا مُمرِّراً ⇒ via_not_allowed", () => {
    expect(verifyUserAssertion(mint(), opts({ callerService: "driver-bot" }))).toEqual({
      ok: false,
      reason: "via_not_allowed",
    });
  });

  it("نوعُ الفاعلِ غيرُ مقبولٍ على المسارِ ⇒ actor_not_allowed", () => {
    expect(verifyUserAssertion(mint(), opts({ actors: ["driver"] }))).toEqual({ ok: false, reason: "actor_not_allowed" });
  });

  it("الغيابُ ⇒ missing، والتشوُّهُ ⇒ malformed", () => {
    expect(verifyUserAssertion(undefined, opts())).toEqual({ ok: false, reason: "missing" });
    expect(verifyUserAssertion("", opts())).toEqual({ ok: false, reason: "missing" });
    for (const bad of ["wua1", "wua1.a.b.c", "wua2.x.y", "wua1.!!!.sig", `wua1.${b64({ kid: "ua-2026-10" })}.AAAA`, "x".repeat(5000)]) {
      expect(verifyUserAssertion(bad, opts())).toEqual({ ok: false, reason: "malformed" });
    }
    const token = mint();
    const [scheme, , sig] = token.split(".");
    expect(verifyUserAssertion(`${scheme}.${b64({ ...payloadOf(token), act: "admin" })}.${sig}`, opts())).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("خريطةُ الرفضِ على السلكِ ثابتةٌ (ADR-060 §2.6)", () => {
    expect(userAssertionDenialOf("missing")).toEqual({ status: 401, code: "AUTHN_USER_ASSERTION_REQUIRED" });
    expect(userAssertionDenialOf("bad_signature")).toEqual({ status: 401, code: "AUTHN_USER_ASSERTION_INVALID" });
    expect(userAssertionDenialOf("expired")).toEqual({ status: 401, code: "AUTHN_USER_ASSERTION_EXPIRED" });
    expect(userAssertionDenialOf("obo_mismatch")).toEqual({ status: 403, code: "AUTHZ_USER_ASSERTION_MISMATCH" });
    expect(userAssertionDenialOf("wrong_audience")).toEqual({ status: 403, code: "AUTHZ_USER_ASSERTION_MISMATCH" });
  });
});

describe("wua1 — قراءةُ البيئةِ وسِرّيّةُ المفتاحِ", () => {
  const pkcs8 = primary.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const spki = primary.publicKey.export({ format: "der", type: "spki" }).toString("base64");

  it("الوضعُ الافتراضيُّ off، والقيمةُ غيرُ المعروفةِ ترمي", () => {
    expect(userAssertionModeFromEnv({})).toBe("off");
    expect(userAssertionModeFromEnv({ WASLA_USER_ASSERTION_MODE: "observe" })).toBe("observe");
    expect(userAssertionModeFromEnv({ WASLA_USER_ASSERTION_MODE: "enforce" })).toBe("enforce");
    expect(() => userAssertionModeFromEnv({ WASLA_USER_ASSERTION_MODE: "strict" })).toThrow(UserAssertionConfigError);
  });

  it("المفاتيحُ العامّةُ تُقرأُ من JSON، وما ليسَ Ed25519 يُرفَضُ", () => {
    const keys = userAssertionPublicKeysFromEnv({ WASLA_USER_ASSERTION_PUBLIC_KEYS: JSON.stringify({ "ua-2026-10": spki }) });
    expect(verifyUserAssertion(mint(), opts({ publicKeys: keys })).ok).toBe(true);
    expect(userAssertionPublicKeysFromEnv({}).size).toBe(0);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "der", type: "spki" }).toString("base64");
    expect(() => userAssertionPublicKeysFromEnv({ WASLA_USER_ASSERTION_PUBLIC_KEYS: JSON.stringify({ k1: rsa }) })).toThrow(/not an Ed25519/);
    expect(() => userAssertionPublicKeysFromEnv({ WASLA_USER_ASSERTION_PUBLIC_KEYS: "[1]" })).toThrow(UserAssertionConfigError);
  });

  it("مفتاحُ التوقيعِ يُقرأُ من البيئةِ، وغيابُهُ null", () => {
    const key = userAssertionSigningKeyFromEnv({ WASLA_USER_ASSERTION_SIGNING_KEY: `ua-2026-10:${pkcs8}` });
    expect(key?.kid).toBe("ua-2026-10");
    expect(verifyUserAssertion(mint({ key: key! }), opts()).ok).toBe(true);
    expect(userAssertionSigningKeyFromEnv({})).toBeNull();
  });

  it("المفتاحُ الخاصُّ لا يظهرُ في رسالةِ خطأٍ ولا في toString/JSON/inspect", () => {
    const key = userAssertionSigningKeyFromEnv({ WASLA_USER_ASSERTION_SIGNING_KEY: `ua-2026-10:${pkcs8}` })!;
    for (const text of [String(key), JSON.stringify(key), inspect(key, { depth: 5 })]) {
      expect(text).not.toContain(pkcs8);
      expect(text).not.toContain(pkcs8.slice(0, 24));
      expect(text).toContain("redacted");
    }
    const broken = `${pkcs8.slice(0, 40)}AAAA`;
    try {
      userAssertionSigningKeyFromEnv({ WASLA_USER_ASSERTION_SIGNING_KEY: `ua-2026-10:${broken}` });
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(broken);
      expect(String((error as Error).message)).not.toContain(pkcs8.slice(0, 24));
    }
    expect(() => userAssertionSigningKeyFromEnv({ WASLA_USER_ASSERTION_SIGNING_KEY: pkcs8 })).toThrow(/kid is invalid/);
    expect(() => userAssertionSigningKey("ua-x", primary.publicKey)).toThrow(UserAssertionConfigError);
  });
});

// ── المُستقبِلُ على Fastify: الأوضاعُ الثلاثةُ ─────────────────────────────

const SVC_KID = "k-test-0001";
const SVC_SECRET = "test-secret-0123456789abcdefghijkl";
const SCOPE = "alpha:thing:write";

function registry(): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({ keys: [{ kid: SVC_KID, secret: SVC_SECRET, status: "active" }], activeKid: SVC_KID });
}

function denialBody(denial: ServiceIdentityDenial, traceId: string) {
  return { envelope: "boundary-owned", code: denial.code, trace: traceId };
}

function receiver(mode: UserAssertionMode | undefined, logs: unknown[] = []) {
  const app = Fastify({
    logger: {
      level: "info",
      stream: { write: (line: string) => logs.push(JSON.parse(line)) },
    },
  });
  registerServiceIdentityOnFastify(app, {
    audience: "alpha",
    keys: registry(),
    replayGuard: new InMemoryServiceTokenReplayGuard(),
    denialBody,
    boundaryLabel: "حدٌّ صناعيٌّ",
    now: () => NOW,
    ...(mode === undefined ? {} : { userAssertion: { mode, publicKeys: PUBLIC } }),
  });
  app.post(
    "/thing",
    { config: { serviceIdentity: { scopes: [SCOPE], beneficiary: "asserted", actors: ["customer"] } } },
    async (request) => ({ endUser: request.endUser ?? null, delegation: incomingDelegationOf(request) ?? null }),
  );
  return app;
}

function signed(caller: string, obo?: string): Record<string, string> {
  // رمزٌ يدويٌّ لا مُوقِّعٌ مُركَّبٌ: الحدُّ «alpha» صناعيٌّ لا منحَ له في مصفوفةِ M1-05.
  return serviceAuthHeaders({
    serviceName: caller,
    audience: "alpha",
    method: "POST",
    path: "/thing",
    keys: registry(),
    now: NOW,
    scopes: [SCOPE],
    ...(obo === undefined ? {} : { onBehalfOfPublicId: obo }),
  });
}

function aliceAssertion(): string {
  return mint({ aud: ["alpha"] });
}

describe("المُستقبِلُ — off/observe/enforce (ADR-060 §2.7)", () => {
  it("بلا إعدادٍ أو في off: لا تحقُّقَ ولا رفضَ ولا endUser — السلوكُ القائمُ كما هوَ", async () => {
    for (const mode of [undefined, "off" as const]) {
      const app = receiver(mode);
      const missing = await app.inject({ method: "POST", url: "/thing", headers: signed("customer-bot") });
      expect(missing.statusCode).toBe(200);
      expect(missing.json().endUser).toBeNull();
      const forged = await app.inject({
        method: "POST",
        url: "/thing",
        headers: { ...signed("customer-bot", "WU-OTHER-0002"), [USER_ASSERTION_HEADER]: aliceAssertion() },
      });
      expect(forged.statusCode).toBe(200);
      expect(forged.json().endUser).toBeNull();
    }
  });

  it("observe: يُسجِّلُ ولا يرفضُ أبداً، ويضعُ endUser للتأكيدِ الصالحِ وحدَه", async () => {
    const logs: Array<Record<string, unknown>> = [];
    const app = receiver("observe", logs);
    const bad = await app.inject({ method: "POST", url: "/thing", headers: signed("customer-bot", SUB) });
    expect(bad.statusCode).toBe(200);
    expect(bad.json().endUser).toBeNull();
    const good = await app.inject({
      method: "POST",
      url: "/thing",
      headers: { ...signed("customer-bot", SUB), [USER_ASSERTION_HEADER]: aliceAssertion() },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().endUser).toEqual({ publicId: SUB, actorType: "customer", via: "customer-bot" });
    const outcomes = logs.filter((l) => l.event === "user_assertion_outcome");
    expect(outcomes.map((l) => [l.outcome, l.reason ?? null])).toEqual([
      ["invalid", "missing"],
      ["valid", null],
    ]);
    // السجلُّ لا يحملُ التأكيدَ نفسَه.
    expect(JSON.stringify(logs)).not.toContain(aliceAssertion().split(".")[2]!.slice(0, 20));
  });

  it("enforce: 401 للغيابِ و403 لعدمِ المطابقةِ، ويمرُّ الصالحُ", async () => {
    const app = receiver("enforce");
    const missing = await app.inject({ method: "POST", url: "/thing", headers: signed("customer-bot", SUB) });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toMatchObject({ error: { code: "AUTHN_USER_ASSERTION_REQUIRED" } });
    const mismatch = await app.inject({
      method: "POST",
      url: "/thing",
      headers: { ...signed("customer-bot", "WU-OTHER-0002"), [USER_ASSERTION_HEADER]: aliceAssertion() },
    });
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json()).toMatchObject({ error: { code: "AUTHZ_USER_ASSERTION_MISMATCH" } });
    const forged = await app.inject({
      method: "POST",
      url: "/thing",
      headers: {
        ...signed("customer-bot", SUB),
        [USER_ASSERTION_HEADER]: mint({ aud: ["alpha"], key: userAssertionSigningKey("ua-2026-10", attacker.privateKey) }),
      },
    });
    expect(forged.statusCode).toBe(401);
    expect(forged.json()).toMatchObject({ error: { code: "AUTHN_USER_ASSERTION_INVALID" } });
    const good = await app.inject({
      method: "POST",
      url: "/thing",
      headers: { ...signed("customer-bot", SUB), [USER_ASSERTION_HEADER]: aliceAssertion() },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().endUser).toMatchObject({ publicId: SUB });
  });

  it("رمزُ الخدمةِ يسبقُ التأكيدَ: بلا رمزٍ ⇒ 401 بمغلَّفِ الحدِّ حتّى في enforce", async () => {
    const app = receiver("enforce");
    const response = await app.inject({ method: "POST", url: "/thing", headers: { [USER_ASSERTION_HEADER]: aliceAssertion() } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ envelope: "boundary-owned" });
  });

  it("incomingDelegationOf يُمرِّرُ obo والرأسَ كما وصلا، ولا شيءَ إن نقصَ أحدُهما", async () => {
    const app = receiver("off");
    const token = aliceAssertion();
    const both = await app.inject({ method: "POST", url: "/thing", headers: { ...signed("customer-bot", SUB), ...userAssertionHeaders({ publicId: SUB, assertion: token }) } });
    expect(both.json().delegation).toEqual({ publicId: SUB, assertion: token });
    const noObo = await app.inject({ method: "POST", url: "/thing", headers: { ...signed("customer-bot"), [USER_ASSERTION_HEADER]: token } });
    expect(noObo.json().delegation).toBeNull();
  });
});
