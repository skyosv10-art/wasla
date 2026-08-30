/**
 * اختبارُ دورةِ حياةِ جلسةِ البشرِ — عنصرُ العمل **M1-02** · **ADR-019**.
 *
 * هذه المجموعةُ وحديّةٌ فوقَ مُنفِّذِ ذاكرةٍ، وتُثبِت **قواعدَ القرار**:
 * الانتهاءَ عندَ حدِّه، الإلغاءَ، عدمَ تسريبِ الرمزِ، وشكلَ `Principal`
 * الناتج. و**لا تُثبِت منعَ الإعادةِ في الإنتاج**: ذلك قيدٌ في Postgres
 * وبرهانُه في `session-postgres.integration.test.ts` لا هنا — وما يُرى
 * أدناه من رفضِ الإعادةِ في الذاكرةِ برهانٌ على المُنفِّذِ الوهميِّ وحدَه.
 */

import { createHash } from "node:crypto";

import { describe, it, expect, beforeEach } from "vitest";

import {
  CryptoIdGenerator,
  DEFAULT_SESSION_TTL_SECONDS,
  InMemoryIdentityRepository,
  InMemoryOutbox,
  InMemoryPublicIdSequence,
  InMemorySessionRepository,
  IdentityError,
  hashSessionToken,
  isSessionValid,
  issueSessionFromTelegram,
  resolveTelegramIdentity,
  revokeSession,
  sessionExpiryFrom,
  sessionHashEquals,
  verifySessionToken,
  type SessionUseCaseDeps,
  type UseCaseDeps,
} from "../index.js";

/** ساعةٌ يقودها الاختبار — لا `Date.now()` في أيِّ حكمٍ زمنيٍّ. */
class FixedClock {
  constructor(private current: Date) {}
  now(): string {
    return this.current.toISOString();
  }
  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
  get date(): Date {
    return this.current;
  }
}

const T0 = new Date("2026-08-30T08:00:00.000Z");

/** بصمةٌ صحيحةُ الصيغةِ ومختلفةٌ لكلِّ اسمٍ — لا تكرارَ عرَضيّاً بين الحالات. */
function fingerprint(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

interface Harness {
  deps: SessionUseCaseDeps;
  identityDeps: UseCaseDeps;
  repo: InMemoryIdentityRepository;
  sessions: InMemorySessionRepository;
  clock: FixedClock;
}

function makeHarness(): Harness {
  const repo = new InMemoryIdentityRepository();
  const sessions = new InMemorySessionRepository();
  const clock = new FixedClock(T0);
  const idGen = new CryptoIdGenerator();
  return {
    repo,
    sessions,
    clock,
    deps: { sessions, repo, clock, idGen },
    identityDeps: {
      repo,
      outbox: new InMemoryOutbox(),
      publicIdSeq: new InMemoryPublicIdSequence(),
      clock,
      idGen,
    },
  };
}

/** يُنشئ (أو يجد) مستخدماً من تلغرام ويُعيد ما يحتاجه إصدارُ الجلسة. */
async function identityOf(
  h: Harness,
  telegramUserId: number,
): Promise<{ internalUuid: string; waslaPublicId: string }> {
  await resolveTelegramIdentity(h.identityDeps, {
    telegram_user_id: telegramUserId,
    telegram_username: `u${telegramUserId}`,
  });
  const user = await h.repo.findUserByTelegramId(telegramUserId);
  if (user === null) throw new Error("تهيئةُ الاختبارِ فشلت: لا مستخدمَ بعدَ resolve.");
  return { internalUuid: user.internalUuid, waslaPublicId: user.waslaPublicId };
}

async function issue(
  h: Harness,
  telegramUserId: number,
  seed: string,
  over: Partial<{ ttlSeconds: number; actorType: "customer" | "driver" | "admin" | "support" }> = {},
) {
  return issueSessionFromTelegram(
    h.deps,
    {
      initDataFingerprint: fingerprint(seed),
      telegramUserId,
      ...over,
    },
    () => identityOf(h, telegramUserId),
  );
}

describe("issueSessionFromTelegram", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("يُصدِر جلسةً ويربطها بالمستخدمِ الصحيح", async () => {
    const issued = await issue(h, 501, "a");
    const identity = await identityOf(h, 501);

    expect(issued.session.userInternalUuid).toBe(identity.internalUuid);
    expect(issued.waslaPublicId).toBe(identity.waslaPublicId);
    expect(issued.session.channel).toBe("telegram");
    expect(issued.session.actorType).toBe("customer");
    expect(issued.session.issuedAt).toBe(T0.toISOString());
    expect(issued.session.expiresAt).toBe(sessionExpiryFrom(T0));
    expect(issued.session.revokedAt).toBeNull();
  });

  it("**لا يُخزّن الرمزَ** بل بصمتَه فقط", async () => {
    // لو خُزِّن الرمزُ الصريحُ لَصار تسريبُ نسخةٍ من قاعدةِ البياناتِ
    // تسليماً لجلساتٍ حيّةٍ جاهزةِ الاستعمال.
    const issued = await issue(h, 502, "b");
    const stored = JSON.stringify(issued.session);

    expect(stored).not.toContain(issued.token);
    expect(issued.session.tokenHash).toBe(hashSessionToken(issued.token));
    expect(issued.session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("يُعطي رمزاً مختلفاً في كلِّ إصدارٍ ولو لنفسِ المستخدم", async () => {
    const a = await issue(h, 503, "c1");
    const b = await issue(h, 503, "c2");
    expect(a.token).not.toBe(b.token);
    expect(a.session.tokenHash).not.toBe(b.session.tokenHash);
    expect(a.session.id).not.toBe(b.session.id);
  });

  it("لا يُنشئ مستخدماً ثانياً لجلسةٍ ثانيةٍ لنفسِ الشخص", async () => {
    // اعتمادُ `resolveTelegramIdentity` بدلَ تكرارِ منطقِه هو ما يحرس هذا.
    const a = await issue(h, 504, "d1");
    const b = await issue(h, 504, "d2");
    expect(b.session.userInternalUuid).toBe(a.session.userInternalUuid);
    expect(b.waslaPublicId).toBe(a.waslaPublicId);
  });

  it("يحترم نوعَ الفاعلِ ومدّةً مُمرَّرةً", async () => {
    const issued = await issue(h, 505, "e", { actorType: "driver", ttlSeconds: 60 });
    expect(issued.session.actorType).toBe("driver");
    expect(issued.session.expiresAt).toBe(new Date(T0.getTime() + 60_000).toISOString());
  });

  it("يرفض بصمةً ليست sha256 — خطأُ توصيلٍ لا مُدخَلُ مستخدم", async () => {
    await expect(
      issueSessionFromTelegram(
        h.deps,
        { initDataFingerprint: "not-a-hash", telegramUserId: 506 },
        () => identityOf(h, 506),
      ),
    ).rejects.toThrow(TypeError);
  });

  it("يرفض إعادةَ استعمالِ نفسِ بصمةِ init-data (في هذا المُنفِّذِ)", async () => {
    await issue(h, 507, "same-message");
    const second = issue(h, 507, "same-message");
    await expect(second).rejects.toBeInstanceOf(IdentityError);
    await expect(second).rejects.toMatchObject({
      code: "IDENTITY_SESSION_REPLAY",
      httpStatus: 409,
    });
  });

  it("لا يُخفِق حين تتساوى بصمةُ رسالتَينِ لمستخدمَينِ مختلفَين — التفرّدُ عالميّ", async () => {
    // القيدُ على البصمةِ وحدَها لا على (مستخدم، بصمة): رسالةٌ واحدةٌ لا
    // يمكن أن تكون صادرةً عن شخصَين، فلو سُمِح بذلك لصار المهاجمُ يُعيد
    // رسالةَ غيرِه على حسابِه.
    await issue(h, 508, "shared");
    await expect(
      issueSessionFromTelegram(
        h.deps,
        { initDataFingerprint: fingerprint("shared"), telegramUserId: 509 },
        () => identityOf(h, 509),
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_SESSION_REPLAY" });
  });
});

describe("verifySessionToken", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("يُعيد UserPrincipal بالمعرِّفِ العامِّ لصاحبِ الجلسة", async () => {
    const issued = await issue(h, 601, "v1");
    const principal = await verifySessionToken(h.deps, issued.token, {
      roles: ["customer"],
      scopes: ["orders:order:read"],
    });

    expect(principal.kind).toBe("user");
    expect(principal.waslaPublicId).toBe(issued.waslaPublicId);
    expect(principal.internalUuid).toBe(issued.session.userInternalUuid);
    expect(principal.sessionId).toBe(issued.session.id);
    expect(principal.channel).toBe("telegram");
    expect(principal.actor).toBe("customer");
    expect(principal.roles).toEqual(["customer"]);
    expect(principal.scopes).toEqual(["orders:order:read"]);
    expect(principal.expiresAt).toBe(issued.session.expiresAt);
  });

  it("لا يشتقُّ أدواراً ولا صلاحيّاتٍ من نفسِه", async () => {
    // مصفوفةُ «دور → صلاحيّات» عندَ المُصدِر (M1-05). لو اشتقّت هذه الدالّةُ
    // صلاحيّةً واحدةً بنفسِها لصار في النظامِ مصدرانِ للحقيقةِ يفترقان.
    const issued = await issue(h, 602, "v2");
    const principal = await verifySessionToken(h.deps, issued.token);
    expect(principal.roles).toEqual([]);
    expect(principal.scopes).toEqual([]);
    expect(principal.tenantId).toBeUndefined();
  });

  it("يرفض رمزاً لا وجودَ له بـAUTHN_UNAUTHENTICATED", async () => {
    await expect(
      verifySessionToken(h.deps, "رمزٌ لم يُصدَر قطّ"),
    ).rejects.toMatchObject({ code: "AUTHN_UNAUTHENTICATED" });
  });

  it("يرفض رمزاً صحيحَ الصيغةِ خُمِّن عشوائيّاً", async () => {
    await issue(h, 603, "v3");
    await expect(
      verifySessionToken(h.deps, Buffer.alloc(32, 7).toString("base64url")),
    ).rejects.toMatchObject({ code: "AUTHN_UNAUTHENTICATED" });
  });

  it("يقبل قبلَ لحظةِ الانتهاءِ بثانيةٍ", async () => {
    const issued = await issue(h, 604, "v4");
    h.clock.advance(DEFAULT_SESSION_TTL_SECONDS - 1);
    const principal = await verifySessionToken(h.deps, issued.token);
    expect(principal.sessionId).toBe(issued.session.id);
  });

  it("يرفض **عندَ** لحظةِ الانتهاءِ بالضبط — الحدُّ غيرُ شاملٍ كـauth-sdk", async () => {
    const issued = await issue(h, 605, "v5");
    h.clock.advance(DEFAULT_SESSION_TTL_SECONDS);
    await expect(verifySessionToken(h.deps, issued.token)).rejects.toMatchObject({
      code: "AUTHN_EXPIRED",
    });
  });

  it("يرفض جلسةً مسحوبةً بـAUTHN_UNAUTHENTICATED لا بـAUTHN_EXPIRED", async () => {
    // التمييزُ يُخبِر المهاجمَ أنّ رمزَه كان صحيحاً يوماً؛ والمسحوبُ
    // يُردُّ كالمجهولِ تماماً.
    const issued = await issue(h, 606, "v6");
    await revokeSession(h.deps, issued.session.id, "اشتباهٌ أمنيّ");
    await expect(verifySessionToken(h.deps, issued.token)).rejects.toMatchObject({
      code: "AUTHN_UNAUTHENTICATED",
    });
  });

  it("السحبُ يسبق الانتهاءَ في الحكمِ حين يقع الاثنان", async () => {
    const issued = await issue(h, 607, "v7");
    await revokeSession(h.deps, issued.session.id, "خروجٌ بطلبِ المستخدم");
    h.clock.advance(DEFAULT_SESSION_TTL_SECONDS * 10);
    await expect(verifySessionToken(h.deps, issued.token)).rejects.toMatchObject({
      code: "AUTHN_UNAUTHENTICATED",
    });
  });

  it("يُسجّل آخِرَ استعمالٍ ولا يجعله شرطاً للنجاح", async () => {
    const issued = await issue(h, 608, "v8");
    expect(issued.session.lastSeenAt).toBeNull();
    h.clock.advance(30);
    await verifySessionToken(h.deps, issued.token);
    const after = await h.sessions.findSessionByTokenHash(issued.session.tokenHash);
    expect(after?.lastSeenAt).toBe(h.clock.date.toISOString());
  });

  it("ينجح وإن أخفقت كتابةُ آخِرِ استعمال", async () => {
    // التدقيقُ لا يُعطَّل به طلبٌ مصادَقٌ عليه: خطأُ كتابةٍ في `touchSession`
    // ليس سبباً لمنعِ مستخدمٍ صحيحِ الجلسة.
    const issued = await issue(h, 609, "v9");
    h.sessions.touchSession = async () => {
      throw new Error("قاعدةُ البياناتِ للقراءةِ فقط الآن");
    };
    const principal = await verifySessionToken(h.deps, issued.token);
    expect(principal.sessionId).toBe(issued.session.id);
  });

  it("يرفض جلسةً تُشير إلى مستخدمٍ لم يبقَ له سجلّ", async () => {
    const issued = await issue(h, 610, "v10");
    h.repo.findUserByInternalUuid = async () => null;
    await expect(verifySessionToken(h.deps, issued.token)).rejects.toMatchObject({
      code: "AUTHN_UNAUTHENTICATED",
    });
  });
});

describe("revokeSession", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("يُسجّل وقتَ السحبِ وسببَه معاً", async () => {
    const issued = await issue(h, 701, "r1");
    h.clock.advance(10);
    await revokeSession(h.deps, issued.session.id, "خروجٌ بطلبِ المستخدم");
    const after = await h.sessions.findSessionByTokenHash(issued.session.tokenHash);
    expect(after?.revokedAt).toBe(h.clock.date.toISOString());
    expect(after?.revokedReason).toBe("خروجٌ بطلبِ المستخدم");
  });

  it("مُتماثِلُ التكرارِ: النداءُ الثاني لا يُخفِق ولا يُغيّر أوّلَ سبب", async () => {
    const issued = await issue(h, 702, "r2");
    await revokeSession(h.deps, issued.session.id, "السببُ الأوّل");
    h.clock.advance(600);
    await revokeSession(h.deps, issued.session.id, "سببٌ ثانٍ متأخّر");
    const after = await h.sessions.findSessionByTokenHash(issued.session.tokenHash);
    expect(after?.revokedReason).toBe("السببُ الأوّل");
  });

  it("يرفض سحباً بلا سبب", async () => {
    const issued = await issue(h, 703, "r3");
    await expect(revokeSession(h.deps, issued.session.id, "   ")).rejects.toThrow(TypeError);
  });

  it("يُخفِق على جلسةٍ لا وجودَ لها", async () => {
    await expect(
      revokeSession(h.deps, "00000000-0000-4000-8000-000000000000", "سببٌ"),
    ).rejects.toMatchObject({ code: "IDENTITY_SESSION_NOT_FOUND", httpStatus: 404 });
  });

  it("سحبُ جلسةٍ لا يمسّ جلسةً أخرى لنفسِ المستخدم", async () => {
    const a = await issue(h, 704, "r4a");
    const b = await issue(h, 704, "r4b");
    await revokeSession(h.deps, a.session.id, "جهازٌ مفقود");
    await expect(verifySessionToken(h.deps, a.token)).rejects.toMatchObject({
      code: "AUTHN_UNAUTHENTICATED",
    });
    expect((await verifySessionToken(h.deps, b.token)).sessionId).toBe(b.session.id);
  });
});

describe("نواةُ المجالِ النقيّة", () => {
  it("isSessionValid يتّفق مع الحدِّ غيرِ الشامل", async () => {
    const h = makeHarness();
    const issued = await issue(h, 801, "d1");
    const expiry = new Date(issued.session.expiresAt);
    expect(isSessionValid(issued.session, new Date(expiry.getTime() - 1))).toBe(true);
    expect(isSessionValid(issued.session, expiry)).toBe(false);
  });

  it("sessionExpiryFrom يرفض مدّةً غيرَ موجبة", () => {
    expect(() => sessionExpiryFrom(T0, 0)).toThrow(TypeError);
    expect(() => sessionExpiryFrom(T0, -5)).toThrow(TypeError);
  });

  it("hashSessionToken يرفض رمزاً فارغاً", () => {
    expect(() => hashSessionToken("")).toThrow(TypeError);
  });

  it("sessionHashEquals يرفض ما ليس sha256 hex ولا يقبل بادئةً", () => {
    const a = createHash("sha256").update("x").digest("hex");
    expect(sessionHashEquals(a, a)).toBe(true);
    expect(sessionHashEquals(a, a.slice(0, 63))).toBe(false);
    expect(sessionHashEquals(a, a.toUpperCase())).toBe(false);
    expect(sessionHashEquals(a, "z".repeat(64))).toBe(false);
  });
});
