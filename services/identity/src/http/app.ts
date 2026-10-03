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
import type { UserAssertionSigningKey } from "@wasla/service-auth/user-assertion";

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
}

/** مسار مفتوح بتصنيف صريح — لا استثناء صامت. */
const OPEN: IdentityRouteConfig = { serviceIdentity: "open" };

/** مسار يطلب صلاحية واحدة بالاسم. */
function scoped(...scopes: readonly string[]): IdentityRouteConfig {
  return { serviceIdentity: { scopes } };
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
  registerServiceIdentity(app, options.serviceIdentity);

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
  app.get("/identity/users/:waslaPublicId", { config: scoped(IDENTITY_SCOPES.userRead) }, async (request, reply) => {
    const { waslaPublicId } = request.params as { waslaPublicId: string };
    const user = await getUser({ repo: deps.repo }, waslaPublicId);
    return reply.status(200).send(user);
  });

  // POST /identity/users/:waslaPublicId/links — add an external identity link.
  app.post("/identity/users/:waslaPublicId/links", { config: scoped(IDENTITY_SCOPES.linkWrite) }, async (request, reply) => {
    const { waslaPublicId } = request.params as { waslaPublicId: string };
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
  app.post(
    "/identity/users/:waslaPublicId/recovery",
    { config: scoped(IDENTITY_SCOPES.recoveryWrite) },
    async (request, reply) => {
      const { waslaPublicId } = request.params as { waslaPublicId: string };
      const body = request.body as StartRecoveryRequest;
      const recovery = await startRecovery(deps, {
        waslaPublicId,
        verification_method: body.verification_method,
      });
      return reply.status(202).send(recovery);
    },
  );

  // GET /identity/users/:waslaPublicId/history — identity change history.
  app.get(
    "/identity/users/:waslaPublicId/history",
    { config: scoped(IDENTITY_SCOPES.historyRead) },
    async (request, reply) => {
      const { waslaPublicId } = request.params as { waslaPublicId: string };
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

  // CLM-0448: the issuer's boot line — whether a signing key is loaded, and its kid only.
  app.addHook("onReady", async () => {
    const key = options.userAssertion?.signingKey ?? null;
    app.log.info({ event: "user_assertion_signer", enabled: key !== null, kid: key?.kid ?? null }, "user assertion signer config");
  });
  return app;
}
