/**
 * Fastify HTTP app factory for the Identity service.
 *
 * Wires the 5 contract endpoints (api.openapi.yml) to the use cases. The
 * factory takes the shared UseCaseDeps (hexagonal wiring) so tests inject
 * in-memory adapters while the bootstrap (server.ts) wires Postgres adapters.
 *
 * Contract-First: request/response shapes come from @wasla/contracts-identity.
 * Domain validation is delegated to the use cases (they throw stable error
 * codes); the error handler maps those to the contract Error body.
 */

import Fastify, { type FastifyInstance } from "fastify";

import type {
  ResolveIdentityRequest,
  AddIdentityLinkRequest,
  StartRecoveryRequest,
  IssueSessionRequest,
  IssueSessionResponse,
  ExchangeSessionRequest,
  ExchangeSessionResponse,
  RevokeSessionRequest,
  RevokeSessionResponse,
} from "@wasla/contracts-identity";

import type { UseCaseDeps } from "../use-cases/resolve-telegram-identity.js";
import { resolveTelegramIdentity } from "../use-cases/resolve-telegram-identity.js";
import { getUser } from "../use-cases/get-user.js";
import { addIdentityLink } from "../use-cases/add-identity-link.js";
import { startRecovery } from "../use-cases/start-recovery.js";
import { getIdentityHistory } from "../use-cases/get-identity-history.js";
import {
  issueUserAssertion,
  type IssueUserAssertionRequest,
} from "../use-cases/issue-user-assertion.js";
import {
  issueSessionFromTelegram,
  revokeSession as revokeSessionUseCase,
  type SessionUseCaseDeps,
} from "../use-cases/session.js";
import { ASSERTION_AUDIENCES_BY_ACTOR } from "../use-cases/issue-user-assertion.js";
import {
  DEFAULT_USER_ASSERTION_TTL_SECONDS,
  mintUserAssertion,
  type UserAssertionSigningKey,
} from "@wasla/service-auth/user-assertion";
import { AuthenticationError, AuthErrorCode } from "@wasla/auth-sdk";
import type { UserAssertionMode, UserAssertionPublicKeys } from "@wasla/service-auth";

import {
  SessionInvalidity,
  type SessionActorType,
  hashSessionToken,
  sessionInvalidity,
} from "../domain/session.js";

import { sendIdentityError } from "./errors.js";
import {
  registerServiceIdentity,
  IDENTITY_SCOPES,
  type IdentityRouteConfig,
  type IdentityServiceIdentityOptions,
} from "./service-identity.js";

export interface CreateIdentityAppOptions {
  deps: UseCaseDeps;
  /** Enable Fastify's request logger (pino). Off by default for tests. */
  logger?: boolean;
  /**
   * فرضُ هويّةِ الخدمةِ على هذا الحدِّ (`M1-04`). **إلزاميٌّ ولا قيمةَ افتراضيّةَ
   * له بقصدٍ**: حدُّ الهويّةِ يربطُ هويّاتٍ خارجيّةً ويبدأُ استعادةَ حسابٍ، فبناءُ
   * تطبيقٍ له بلا هويّةِ خدمةٍ **لا يُترجَمُ** — والنسيانُ لا يكونُ صامتاً.
   */
  serviceIdentity: IdentityServiceIdentityOptions;
  /**
   * ADR-060 · CLM-0440: مفتاحُ Ed25519 الخاصُّ لإصدارِ `wua1`. غيابُهُ ⇒ `POST /identity/assertions`
   * يُجيبُ 503 ولا يُصدِرُ شيئاً — وهو الحالُ في الإنتاجِ حتّى قرارِ P3.
   */
  userAssertion?: {
    readonly signingKey: UserAssertionSigningKey | null;
    readonly now?: () => Date;
    readonly ttlSeconds?: number;
  };
  /**
   * ADR-069 · CLM-0519: حالاتُ استخدامِ الجلسةِ تُمرَّرُ من الخارجِ لا تُشتَقُّ هنا —
   * لأنّ `UseCaseDeps` (المستودعاتُ الأصلُ) لا يحملُ `sessions` ولا `clock` ولا
   * `idGen`، وبناءُها داخلَ `createIdentityApp` كان سيَحرمُ الاختبارَ من حقنِ ساعةٍ
   * جامدةٍ ومُولِّدِ معرّفاتٍ مُعزَّلٍ.
   */
  session?: SessionUseCaseDeps;
  /**
   * ADR-069 · CLM-0519: نافذةُ التحققِ من انتهاءِ الجلسةِ (بالثواني). القيمةُ
   * الافتراضيّةُ (60) تُستخدمُ عندَ غيابِ الخيارِ — وهي تمنعُ «اختبارَ ساعةٍ ناجحٌ
   * وبطاقةً منتهيةً» من المرورِ بلا انتباهٍ.
   */
  sessionGraceSeconds?: number;
  /**
   * ADR-060 P2 (CLM-0462): user assertion verification config for
   * `beneficiary: "asserted"` routes. When present, the middleware verifies
   * the end-user assertion and sets `request.endUser`. When absent, the
   * `asserted` routes behave as `off` — no-ops, backward compatible.
   */
  userAssertionVerify?: {
    readonly mode: UserAssertionMode;
    readonly publicKeys: UserAssertionPublicKeys;
    readonly skewSeconds?: number;
  };
}

/** مسار مفتوح بتصنيف صريح — لا استثناء صامت. */
const OPEN: IdentityRouteConfig = { serviceIdentity: "open" };

/** مسار يطلب صلاحية واحدة بالاسم. */
function scoped(...scopes: readonly string[]): IdentityRouteConfig {
  return { serviceIdentity: { scopes } };
}

/**
 * ADR-060 P2 (CLM-0462): route with `beneficiary: "asserted"` — the end-user
 * identity is verified by the middleware, and the handler compares the path's
 * `:waslaPublicId` with `endUser.publicId`.
 *
 * The Identity service is the assertion issuer and also a receiver on its
 * owner-scoped write routes. `POST /identity/users/:waslaPublicId/links` was
 * `scoped(identity:link:write)` — any holder of that scope could link an
 * external account to any user. RISK-0042 wave 3 named this the highest-impact
 * gap. This elevates it to `asserted` so the caller's end-user assertion must
 * name the same `wasla_public_id` as the path parameter.
 */
function asserted(...scopes: readonly string[]): IdentityRouteConfig {
  return {
    serviceIdentity: {
      scopes,
      beneficiary: "asserted",
      actors: ["customer", "driver", "store_staff"],
    },
  };
}

/** Build the Identity Fastify app without starting to listen. */
export function createIdentityApp(
  options: CreateIdentityAppOptions,
): FastifyInstance {
  const { deps } = options;
  const app = Fastify({ logger: options.logger ?? false });

  app.setErrorHandler((error, request, reply) => {
    sendIdentityError(reply, error, request.id);
  });

  // فرضُ هويّةِ الخدمةِ **قبلَ تسجيلِ المساراتِ**: حاجزُ التصنيفِ عندَ `onRoute`
  // لا يرى إلّا ما يُسجَّلُ بعدَه، فمسارٌ يُضافُ لاحقاً بلا تصنيفٍ يُسقِطُ الإقلاعَ.
  registerServiceIdentity(app, {
    ...options.serviceIdentity,
    ...(options.userAssertionVerify === undefined
      ? {}
      : { userAssertion: options.userAssertionVerify }),
  });

  // GET /health — liveness probe (not part of the contract API surface).
  app.get("/health", { config: OPEN }, async (_request, reply) => {
    return reply.status(200).send({ status: "ok" });
  });

  // POST /identity/resolve — idempotent create/resolve from Telegram.
  app.post("/identity/resolve", { config: scoped(IDENTITY_SCOPES.resolveWrite) }, async (request, reply) => {
    const body = request.body as ResolveIdentityRequest;
    const result = await resolveTelegramIdentity(deps, body);
    return reply.status(result.created ? 201 : 200).send(result);
  });

  // GET /identity/users/:waslaPublicId — read a user by Public ID.
  // ADR-060 P2 (CLM-0463): `asserted` — the caller's end-user assertion must
  // name the same `wasla_public_id` as the path. Mismatch → 404
  // (IDENTITY_NOT_FOUND) per ADR-060 §2.6.
  app.get("/identity/users/:waslaPublicId", { config: asserted(IDENTITY_SCOPES.userRead) }, async (request, reply) => {
    const { waslaPublicId } = request.params as { waslaPublicId: string };
    assertWaslaPublicId(request, waslaPublicId);
    const user = await getUser({ repo: deps.repo }, waslaPublicId);
    return reply.status(200).send(user);
  });

  // POST /identity/users/:waslaPublicId/links — add an external identity link.
  // ADR-060 P2 (CLM-0462): `asserted` — the caller's end-user assertion must
  // name the same `wasla_public_id` as the path. Mismatch → 404
  // (IDENTITY_USER_NOT_FOUND) per ADR-060 §2.6.
  app.post("/identity/users/:waslaPublicId/links", { config: asserted(IDENTITY_SCOPES.linkWrite) }, async (request, reply) => {
    const { waslaPublicId } = request.params as { waslaPublicId: string };
    assertWaslaPublicId(request, waslaPublicId);
    const body = request.body as AddIdentityLinkRequest;
    const link = await addIdentityLink(deps, {
      waslaPublicId,
      provider: body.provider,
      external_id: body.external_id,
      verified: body.verified,
    });
    return reply.status(200).send(link);
  });

  // POST /identity/users/:waslaPublicId/recovery — start account recovery.
  // ADR-060 P2 (CLM-0463): `asserted` — the caller's end-user assertion must
  // name the same `wasla_public_id` as the path. Mismatch → 404
  // (IDENTITY_NOT_FOUND) per ADR-060 §2.6.
  app.post(
    "/identity/users/:waslaPublicId/recovery",
    { config: asserted(IDENTITY_SCOPES.recoveryWrite) },
    async (request, reply) => {
      const { waslaPublicId } = request.params as { waslaPublicId: string };
      assertWaslaPublicId(request, waslaPublicId);
      const body = request.body as StartRecoveryRequest;
      const recovery = await startRecovery(deps, {
        waslaPublicId,
        verification_method: body.verification_method,
      });
      return reply.status(202).send(recovery);
    },
  );

  // GET /identity/users/:waslaPublicId/history — identity change history.
  // ADR-060 P2 (CLM-0463): `asserted` — the caller's end-user assertion must
  // name the same `wasla_public_id` as the path. Mismatch → 404
  // (IDENTITY_NOT_FOUND) per ADR-060 §2.6.
  app.get(
    "/identity/users/:waslaPublicId/history",
    { config: asserted(IDENTITY_SCOPES.historyRead) },
    async (request, reply) => {
      const { waslaPublicId } = request.params as { waslaPublicId: string };
      assertWaslaPublicId(request, waslaPublicId);
      const query = request.query as { field?: string };
      const history = await getIdentityHistory({ repo: deps.repo }, {
        waslaPublicId,
        field: query.field,
      });
      return reply.status(200).send(history);
    },
  );

  // POST /identity/assertions — إصدارُ تأكيدِ المستخدمِ النهائيِّ (ADR-060 · CLM-0440).
  // قراءةٌ فقط: لا إنشاءَ مستخدمٍ. والسجلُّ يحملُ المعرّفَ العامَّ وحدَهُ — لا التأكيدَ ولا معرّفَ القناةِ.
  app.post(
    "/identity/assertions",
    { config: scoped(IDENTITY_SCOPES.assertionIssue) },
    async (request, reply) => {
      const caller = request.serviceCaller?.serviceName ?? "";
      const { response, payload } = await issueUserAssertion(
        {
          repo: deps.repo,
          signingKey: options.userAssertion?.signingKey ?? null,
          now: options.userAssertion?.now ?? (() => new Date()),
          ...(options.userAssertion?.ttlSeconds === undefined ? {} : { ttlSeconds: options.userAssertion.ttlSeconds }),
        },
        caller,
        (request.body ?? {}) as IssueUserAssertionRequest,
      );
      request.log.info(
        {
          event: "user_assertion_issued",
          sub: payload.sub,
          act: payload.act,
          via: payload.via,
          aud: payload.aud,
          kid: payload.kid,
          jti: payload.jti,
          exp: payload.exp,
        },
        "user assertion issued",
      );
      return reply.status(200).send(response);
    },
  );

  // ── ADR-069 · CLM-0519 (المرحلةُ الأولى): دورةُ حياةِ جلسةِ المستخدمِ ─────────
  // الفاعلُ يُشتقُّ من **مسارِ الثقةِ** (هويّةِ الخدمةِ المنادية) لا من جسمِ
  // الطلبِ (I-03): `customer-bot` لا يُصدِرُ إلّا جلسةَ `customer`، و`driver-bot`
  // لا يُصدِرُ إلّا جلسةَ `driver`. **حدُّ الثقةِ المُعلَنُ الآنَ:** مفاتيحُ
  // `wsvc3` مُشتركةٌ بينَ الأسطولِ (`WEBAPP_SHARED_FLEET_KEY` في
  // `services/identity/src/config.ts`) — فأيُّ حاملٍ للمفتاحِ يستطيعُ التوقيعَ
  // باسمِ أيِّ بوتٍ، ويبقى الربطُ حقيقياً فقط إذا كانَت المفاتيحُ **متمايزةً**
  // (قرارٌ مالكٍ مستقلٌّ لاحقٌ). المساراتُ لذا **مُغَلَّقةٌ مِن جانبِ الاستبدالِ**
  // فقط: من يملكُ رمزَ جلسةٍ **صالحاً** يملكُ المسارَ — لا أكثرَ.
  const sessionDeps = options.session;
  const SESSION_ACTOR_BY_CALLER: Readonly<Record<string, Extract<SessionActorType, "customer" | "driver">>> = {
    "customer-bot": "customer",
    "driver-bot": "driver",
  };

  // POST /identity/sessions — إصدارُ جلسةٍ من init-data موقَّعةٍ (I-01..I-05).
  if (sessionDeps !== undefined) {
    app.post(
      "/identity/sessions",
      { config: scoped(IDENTITY_SCOPES.sessionIssue) },
      async (request, reply) => {
        const caller = request.serviceCaller?.serviceName ?? "";
        const allowedActor = SESSION_ACTOR_BY_CALLER[caller];
        if (allowedActor === undefined) {
          // أيُّ منادٍ آخرَ (dispatch · partner · …) لا يملكُ الجلساتِ أصلاً —
          // الرفضُ 403 لأنّ الهويّةَ صحيحةٌ والصلاحيّةَ ناقصةٌ (I-04).
          throw new IdentityError(
            "IDENTITY_ASSERTION_FORBIDDEN",
            "this caller may not issue or exchange user sessions",
          );
        }
        const body = (request.body ?? {}) as IssueSessionRequest;
        // I-03: `actor_type` في الجسمِ **يُهجَرُ ولا يُقرأُ** — المنبعُ مسارُ الثقةِ.
        const fingerprint = typeof body.init_data_fingerprint === "string" ? body.init_data_fingerprint : "";
        const telegramUserId = body.telegram_user_id;
        if (
          typeof telegramUserId !== "number" ||
          !Number.isSafeInteger(telegramUserId) ||
          telegramUserId <= 0
        ) {
          throw new IdentityError(
            "IDENTITY_ASSERTION_INVALID_REQUEST",
            "telegram_user_id must be a positive integer",
          );
        }
        const issued = await issueSessionFromTelegram(
          sessionDeps,
          {
            initDataFingerprint: fingerprint,
            telegramUserId,
            actorType: allowedActor,
          },
          async () => {
            // ADR-069 · CLM-0519: الإصدارُ من هويةٍ **قائمةٍ** لا يُنشئُ مستخدماً
            // جديداً — فبصمةُ init-data الموقَّعةِ شهادةُ «هذا الشخصُ دخلَ»،
            // وليست شهادةَ «هذا الشخصُ جديدٌ». والاستحداثُ في `resolve` وحدَهُ.
            const user = await sessionDeps.repo.findUserByTelegramId(telegramUserId);
            if (user === null || user.status === "deleted") {
              throw new IdentityError(
                "IDENTITY_NOT_FOUND",
                "no linked identity for this channel user",
              );
            }
            if (user.status !== "active") {
              // I-11: مستخدمٌ موقوفٌ لا جلسةَ له.
              throw new IdentityError(
                "IDENTITY_USER_SUSPENDED",
                "identity is not active",
              );
            }
            return { internalUuid: user.internalUuid, waslaPublicId: user.waslaPublicId };
          },
        );
        request.log.info(
          {
            event: "user_session_issued",
            wasla_public_id: issued.waslaPublicId,
            actor_type: issued.session.actorType,
            channel: issued.session.channel,
            session_id: issued.session.id,
            expires_at: issued.session.expiresAt,
            via: caller,
          },
          "user session issued",
        );
        return reply.status(201).send({
          token: issued.token,
          wasla_public_id: issued.waslaPublicId,
          actor_type: allowedActor,
          expires_at: issued.session.expiresAt,
          session_id: issued.session.id,
        } satisfies IssueSessionResponse);
      },
    );

    // POST /identity/sessions/exchange — قايضةُ جلسةٍ بتأكيدٍ قصيرِ العمرِ (I-06..I-10).
    app.post(
      "/identity/sessions/exchange",
      { config: scoped(IDENTITY_SCOPES.sessionExchange) },
      async (request, reply) => {
        const caller = request.serviceCaller?.serviceName ?? "";
        const allowedActor = SESSION_ACTOR_BY_CALLER[caller];
        if (allowedActor === undefined) {
          throw new IdentityError(
            "IDENTITY_ASSERTION_FORBIDDEN",
            "this caller may not issue or exchange user sessions",
          );
        }
        const body = (request.body ?? {}) as ExchangeSessionRequest;
        const token = typeof body.session_token === "string" ? body.session_token : "";
        const audience = body.audience;
        if (
          !Array.isArray(audience) ||
          audience.length === 0 ||
          audience.length > 4 ||
          !audience.every((a) => typeof a === "string")
        ) {
          throw new IdentityError(
            "IDENTITY_ASSERTION_INVALID_REQUEST",
            "audience must be a non-empty list of service names",
          );
        }
        const allowedAudiences = ASSERTION_AUDIENCES_BY_ACTOR[allowedActor];
        if (!audience.every((a) => allowedAudiences.includes(a as string))) {
          // I-09: جمهورٌ خارجَ قائمةِ الفاعلِ ⇒ 403 (لا 503 ولا 500).
          throw new IdentityError(
            "IDENTITY_ASSERTION_FORBIDDEN",
            "requested audience is not allowed for this actor type",
          );
        }
        const signingKey = options.userAssertion?.signingKey ?? null;
        if (signingKey === null) {
          // I-12: لا مفتاحَ ⇒ 503 — لا تأكيدَ «غيرُ موقَّعٍ».
          throw new IdentityError(
            "IDENTITY_ASSERTION_UNAVAILABLE",
            "user assertions are not available",
          );
        }

        const sessionUseCase = sessionDeps;
        const now = new Date(sessionUseCase.clock.now());
        const sessionRow = await sessionUseCase.sessions.findSessionByTokenHash(
          hashSessionToken(token),
        );
        if (sessionRow === null) {
          // I-08: رمزٌ مُلغىً أو غيرُ معروفٍ — نفسُ الكودِ والنصِّ للجمهورِ.
          throw new AuthenticationError(
            AuthErrorCode.UNAUTHENTICATED,
            "رمزُ الجلسةِ غيرُ مقبول.",
            { traceId: request.id },
          );
        }
        const invalidity = sessionInvalidity(sessionRow, now);
        if (invalidity === SessionInvalidity.Revoked) {
          throw new AuthenticationError(
            AuthErrorCode.UNAUTHENTICATED,
            "رمزُ الجلسةِ غيرُ مقبول.",
            { traceId: request.id },
          );
        }
        if (invalidity === SessionInvalidity.Expired) {
          // I-07: الانتهاءُ يُفصَحُ عنه بكودٍ مستقلٍّ (إرشادُ عملٍ: أعِد الدخولَ).
          throw new AuthenticationError(
            AuthErrorCode.EXPIRED,
            "انتهت مدّةُ الجلسةِ — يلزم الدخولُ من جديد.",
            { traceId: request.id },
          );
        }
        // I-10: فاعلُ الجلسةِ من مسارِ الثقةِ لا من الجلسةِ وحدَها — البوتُ لا يُبدّلُ
        // شخصاً. منادٍ `driver-bot` لا يستبدلُ جلسةَ `customer`.
        if (sessionRow.actorType !== allowedActor) {
          throw new IdentityError(
            "IDENTITY_ASSERTION_FORBIDDEN",
            "this caller may not exchange a session of a different actor type",
          );
        }
        const owner = await sessionUseCase.repo.findUserByInternalUuid(sessionRow.userInternalUuid);
        if (owner === null || owner.status === "deleted") {
          throw new AuthenticationError(
            AuthErrorCode.UNAUTHENTICATED,
            "رمزُ الجلسةِ غيرُ مقبول.",
            { traceId: request.id },
          );
        }
        if (owner.status !== "active") {
          // I-11: مستخدمٌ موقوفٌ لا تأكيدَ له حتى لو كانت الجلسةُ حيّةً.
          throw new IdentityError(
            "IDENTITY_USER_SUSPENDED",
            "identity is not active",
          );
        }
        // آخرُ استعمالٍ يُسجَّل ولا يُنتظَر منه قرار: فشلُ الكتابةِ لا يمنعُ طلباً مصادَقاً عليه.
        await sessionUseCase.sessions.touchSession(sessionRow.id, now.toISOString()).catch(() => undefined);

        const ttlSeconds = options.userAssertion?.ttlSeconds ?? DEFAULT_USER_ASSERTION_TTL_SECONDS;
        const { assertion, payload } = mintUserAssertion({
          key: signingKey,
          sub: owner.waslaPublicId,
          act: allowedActor,
          chn: "telegram",
          via: caller,
          aud: audience as string[],
          now,
          ttlSeconds,
        });
        request.log.info(
          {
            event: "user_session_exchanged",
            wasla_public_id: payload.sub,
            actor_type: payload.act,
            via: caller,
            aud: payload.aud,
            kid: payload.kid,
            jti: payload.jti,
            exp: payload.exp,
            session_id: sessionRow.id,
          },
          "user session exchanged",
        );
        return reply.status(200).send({
          assertion,
          wasla_public_id: payload.sub,
          actor_type: allowedActor,
          audience: [...payload.aud],
          expires_at: new Date(payload.exp * 1000).toISOString(),
        } satisfies ExchangeSessionResponse);
      },
    );

    // POST /identity/sessions/revoke — سحبُ جلسةٍ برموزِها (I-13 يُغطّي السجلَّ).
    app.post(
      "/identity/sessions/revoke",
      { config: scoped(IDENTITY_SCOPES.sessionRevoke) },
      async (request, reply) => {
        const caller = request.serviceCaller?.serviceName ?? "";
        const allowedActor = SESSION_ACTOR_BY_CALLER[caller];
        if (allowedActor === undefined) {
          throw new IdentityError(
            "IDENTITY_ASSERTION_FORBIDDEN",
            "this caller may not revoke user sessions",
          );
        }
        const body = (request.body ?? {}) as RevokeSessionRequest;
        const token = typeof body.session_token === "string" ? body.session_token : "";
        const reason = typeof body.reason === "string" && body.reason.trim().length > 0
          ? body.reason.trim()
          : "user_requested";
        const sessionRow = await sessionDeps.sessions.findSessionByTokenHash(
          hashSessionToken(token),
        );
        if (sessionRow === null) {
          // سحبُ ما لا وجودَ له يُخفي عيباً في الطبقةِ الأعلى — يُفصَحُ عنه 404.
          throw new IdentityError(
            "IDENTITY_SESSION_NOT_FOUND",
            "session not found",
          );
        }
        await revokeSessionUseCase(sessionDeps, sessionRow.id, reason);
        request.log.info(
          {
            event: "user_session_revoked",
            session_id: sessionRow.id,
            actor_type: sessionRow.actorType,
            via: caller,
            reason,
          },
          "user session revoked",
        );
        return reply.status(200).send({ revoked: true, session_id: sessionRow.id } satisfies RevokeSessionResponse);
      },
    );
  }

  // CLM-0448: the issuer's boot line — whether a signing key is loaded, and its kid only.
  app.addHook("onReady", async () => {
    const key = options.userAssertion?.signingKey ?? null;
    app.log.info({ event: "user_assertion_signer", enabled: key !== null, kid: key?.kid ?? null }, "user assertion signer config");
  });
  return app;
}

// ── ADR-060 P2 (CLM-0462): owner-binding helpers ──────────────────────────────
// These are no-ops when `endUser` is undefined (off mode, or observe without a
// valid assertion). With a verified `endUser` the handler compares the path's
// `wasla_public_id` with the asserted identity; `endUserOwnershipDenied`
// rejects only in `enforce` and logs `would_reject` in `observe` (CLM-0448).
// A mismatch returns 404 (not 403) per ADR-060 §2.6 — to avoid leaking existence.

import type { FastifyRequest } from "fastify";
import { endUserOwnershipDenied } from "@wasla/service-auth/fastify";
import { IdentityError } from "../domain/errors.js";

/**
 * The path's `:waslaPublicId` must match `endUser.publicId`. A mismatch means
 * the caller is trying to link an external identity to a user that is not
 * their own — the highest-impact gap named in RISK-0042 wave 3.
 */
function assertWaslaPublicId(request: FastifyRequest, waslaPublicId: string): void {
  const endUser = request.endUser;
  if (endUser === undefined) return;
  if (endUserOwnershipDenied(request, endUser.publicId === waslaPublicId, "wasla_public_id")) {
    throw new IdentityError("IDENTITY_NOT_FOUND", "user not found");
  }
}
