/**
 * حالاتُ استخدامِ جلسةِ البشرِ — عنصرُ العمل **M1-02** · **ADR-019**.
 *
 * ثلاثةُ أفعالٍ فقط: **أصدِر** من init-data متحقَّقٍ منه، **تحقَّق** من رمزٍ
 * فأعطِ `Principal`، **اسحَب**. وما وراءَ ذلك (تجديدٌ، «اسحب كلَّ أجهزتي»،
 * قائمةُ الجلسات) مؤجَّلٌ بقرارٍ لا بنسيان: كلُّ فعلٍ إضافيٍّ هنا سطحُ هجومٍ
 * يجب أن يُبرَّر بحاجةٍ قائمة.
 *
 * وحدُّ المسؤوليّة: **التحقُّقُ من توقيعِ init-data ليس هنا** — هو في
 * `@wasla/telegram-adapter` لأنّه كلامُ تلغرامَ لا كلامُ الهويّة، و`auth-sdk`
 * ممنوعةٌ منه بنصِّ ADR-018. هذا الملفُّ يستقبل **نتيجةً متحقَّقاً منها**
 * ويُصدِر عليها جلسةً.
 */

import {
  AuthErrorCode,
  AuthenticationError,
  type UserPrincipal,
} from "@wasla/auth-sdk";

import {
  DEFAULT_SESSION_TTL_SECONDS,
  SessionInvalidity,
  generateSessionToken,
  hashSessionToken,
  sessionExpiryFrom,
  sessionInvalidity,
  type Session,
  type SessionActorType,
} from "../domain/session.js";
import type { Clock, IdGenerator, IdentityRepository, SessionRepository } from "../ports.js";

/** تبعيّاتُ حالاتِ استخدامِ الجلسة. */
export interface SessionUseCaseDeps {
  readonly sessions: SessionRepository;
  readonly repo: IdentityRepository;
  readonly clock: Clock;
  readonly idGen: IdGenerator;
  readonly traceId?: string;
}

/**
 * ما يجب أن يكون قد تُحقِّق منه **قبلَ** الوصولِ إلى هنا. الاسمُ صريحٌ
 * بقصدٍ: مَن يبني هذا الكائنَ بيدِه من طلبٍ خارجيٍّ فقد تجاوزَ التوقيعَ،
 * وليُقرأ ذلك في اسمِ النوعِ لا في تعليقٍ منسيّ.
 */
export interface VerifiedTelegramSessionRequest {
  /** `hash` أو بصمةُ رسالةِ init-data — مفتاحُ منعِ الإعادة. */
  readonly initDataFingerprint: string;
  readonly telegramUserId: number;
  readonly telegramUsername?: string;
  readonly telegramFirstName?: string;
  readonly telegramLanguageCode?: string;
  readonly actorType?: SessionActorType;
  readonly ttlSeconds?: number;
}

/** نتيجةُ الإصدار: الرمزُ الصريحُ يُعاد **مرّةً واحدةً فقط**. */
export interface IssuedSession {
  /** الرمزُ المُعتِمُ. لا يُسجَّل ولا يُخزَّن — هذه آخرُ مرّةٍ يُرى فيها. */
  readonly token: string;
  readonly session: Session;
  readonly waslaPublicId: string;
}

/**
 * يُصدِر جلسةً من init-data **متحقَّقٍ منه**.
 *
 * ويُعيد استعمالَ `resolveTelegramIdentity` لا يُكرّر منطقَه: مَن يدخل
 * أوّلَ مرّةٍ يُنشأ له مستخدمٌ، ومَن غيّر معرِّفَه يبقى هو نفسَه. تكرارُ
 * ذلك المنطقِ هنا كان سيُنتج مستخدماً ثانياً لنفسِ الشخص.
 */
export async function issueSessionFromTelegram(
  deps: SessionUseCaseDeps,
  request: VerifiedTelegramSessionRequest,
  resolveIdentity: () => Promise<{ internalUuid: string; waslaPublicId: string }>,
): Promise<IssuedSession> {
  if (!/^[0-9a-f]{64}$/.test(request.initDataFingerprint)) {
    // بصمةٌ بلا صيغةٍ صحيحةٍ تعني أنّ المُنادي لم يُمرِّر ما تُنتجه
    // `fingerprintInitData` — وهو خطأُ توصيلٍ لا مُدخَلُ مستخدمٍ سيّئ.
    throw new TypeError(
      "issueSessionFromTelegram: بصمةُ init-data يجب أن تكون sha256 بصيغةِ hex.",
    );
  }

  const identity = await resolveIdentity();
  const now = new Date(deps.clock.now());
  const token = generateSessionToken();

  // القيدُ الفريدُ في قاعدةِ البيانات هو ما يمنع الإعادةَ، لا فحصٌ سابقٌ
  // هنا: بين الفحصِ والكتابةِ نافذةٌ تكفي لطلبَينِ متوازيَين.
  const session = await deps.sessions.createSession({
    id: deps.idGen.uuid(),
    userInternalUuid: identity.internalUuid,
    actorType: request.actorType ?? "customer",
    channel: "telegram",
    tokenHash: hashSessionToken(token),
    initDataHash: request.initDataFingerprint,
    issuedAt: now.toISOString(),
    expiresAt: sessionExpiryFrom(now, request.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS),
  });

  return { token, session, waslaPublicId: identity.waslaPublicId };
}

/**
 * يتحقَّق من رمزِ جلسةٍ ويُعيد `UserPrincipal` جاهزاً لـ`auth-sdk`.
 *
 * الأدوارُ والصلاحيّاتُ تُمرَّر من الخارجِ (`grants`) ولا تُشتَق هنا: مصفوفةُ
 * «دور → صلاحيّات» عنصرُ العمل **M1-05** عندَ المُصدِر، واشتقاقُها في
 * موضعَينِ يُنتج نظامَينِ للصلاحيّاتِ يفترقان بلا إشعار.
 */
export async function verifySessionToken(
  deps: SessionUseCaseDeps,
  token: string,
  grants: { roles: readonly string[]; scopes: readonly string[]; tenantId?: string } = {
    roles: [],
    scopes: [],
  },
): Promise<UserPrincipal> {
  const now = new Date(deps.clock.now());
  const session = await deps.sessions.findSessionByTokenHash(hashSessionToken(token));

  // رمزٌ لا وجودَ له ورمزٌ مُلغىً يُردَّان بنفسِ الكودِ ونفسِ النصّ: تمييزُهما
  // يُخبِر المهاجمَ أنّ رمزَه كان صحيحاً يوماً.
  if (session === null) {
    throw new AuthenticationError(
      AuthErrorCode.UNAUTHENTICATED,
      "رمزُ الجلسةِ غيرُ مقبول.",
      { traceId: deps.traceId },
    );
  }

  const invalidity = sessionInvalidity(session, now);
  if (invalidity === SessionInvalidity.Revoked) {
    throw new AuthenticationError(
      AuthErrorCode.UNAUTHENTICATED,
      "رمزُ الجلسةِ غيرُ مقبول.",
      { traceId: deps.traceId },
    );
  }
  if (invalidity === SessionInvalidity.Expired) {
    // الانتهاءُ يُفصَح عنه بكودٍ مستقلٍّ لأنّه **إرشادُ عملٍ** للعميل:
    // أعِد الدخولَ. وهو لا يُفيد المهاجمَ شيئاً لأنّه لا يبلغه إلّا بعدَ
    // أن يملك رمزاً صحيحاً أصلاً.
    throw new AuthenticationError(
      AuthErrorCode.EXPIRED,
      "انتهت مدّةُ الجلسةِ — يلزم الدخولُ من جديد.",
      { traceId: deps.traceId },
    );
  }

  // المعرِّفُ العامُّ يُقرأ من سجلِّ المستخدمِ لا من الجلسة: لو حُذف
  // المستخدمُ أو أُوقِف بعدَ إصدارِ الجلسةِ، فالجلسةُ وحدَها لا تعرف ذلك.
  const owner = await deps.repo.findUserByInternalUuid(session.userInternalUuid);
  if (owner === null) {
    throw new AuthenticationError(
      AuthErrorCode.UNAUTHENTICATED,
      "رمزُ الجلسةِ غيرُ مقبول.",
      { traceId: deps.traceId },
    );
  }

  // آخِرُ استعمالٍ يُسجَّل ولا يُنتظَر منه قرار: فشلُ الكتابةِ لا يجوز أن
  // يمنع طلباً مصادَقاً عليه.
  await deps.sessions.touchSession(session.id, now.toISOString()).catch(() => undefined);

  return {
    kind: "user",
    waslaPublicId: owner.waslaPublicId,
    internalUuid: session.userInternalUuid,
    actor: session.actorType,
    channel: session.channel,
    sessionId: session.id,
    roles: grants.roles,
    scopes: grants.scopes,
    ...(grants.tenantId === undefined ? {} : { tenantId: grants.tenantId }),
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
  };
}

/**
 * يسحب جلسةً. مُتماثِلُ التكرارِ عندَ الطبقةِ الدنيا، ويُخفِق فقط إن لم
 * توجد الجلسةُ أصلاً — لأنّ سحبَ ما لا وجودَ له يعني أنّ المُنادي يظنّ
 * حالةً غيرَ الواقع، وإخفاءُ ذلك يُخفي عيباً في الطبقةِ الأعلى.
 */
export async function revokeSession(
  deps: SessionUseCaseDeps,
  sessionId: string,
  reason: string,
): Promise<void> {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (trimmed.length === 0) {
    // النوعُ مقصودٌ: السببُ تُوفّره الطبقةُ المُنادِيةُ دائماً (سحبٌ إداريٌّ،
    // خروجٌ بطلبِ المستخدم، اشتباهٌ أمنيّ). سطرُ سحبٍ بلا سببٍ سجلٌّ
    // لا يُدقَّق، فيُمنع عندَ الحدِّ لا يُملأ بقيمةٍ افتراضيّةٍ كاذبة.
    throw new TypeError("revokeSession: سحبُ الجلسةِ يلزمه سببٌ غيرُ فارغ.");
  }
  await deps.sessions.revokeSession(sessionId, deps.clock.now(), trimmed);
}
