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

import { sendIdentityError } from "./errors.js";

export interface CreateIdentityAppOptions {
  deps: UseCaseDeps;
  /** Enable Fastify's request logger (pino). Off by default for tests. */
  logger?: boolean;
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

  // GET /health — liveness probe (not part of the contract API surface).
  app.get("/health", async (_request, reply) => {
    return reply.status(200).send({ status: "ok" });
  });

  // POST /identity/resolve — idempotent create/resolve from Telegram.
  app.post("/identity/resolve", async (request, reply) => {
    const body = request.body as ResolveIdentityRequest;
    const result = await resolveTelegramIdentity(deps, body);
    return reply.status(result.created ? 201 : 200).send(result);
  });

  // GET /identity/users/:waslaPublicId — read a user by Public ID.
  app.get("/identity/users/:waslaPublicId", async (request, reply) => {
    const { waslaPublicId } = request.params as { waslaPublicId: string };
    const user = await getUser({ repo: deps.repo }, waslaPublicId);
    return reply.status(200).send(user);
  });

  // POST /identity/users/:waslaPublicId/links — add an external identity link.
  app.post("/identity/users/:waslaPublicId/links", async (request, reply) => {
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

  return app;
}
