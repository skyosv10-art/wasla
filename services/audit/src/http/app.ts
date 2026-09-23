/**
 * The HTTP layer of the Audit service (M3-04 ADMIN_MVP_SPEC §6.2).
 *
 * Two routes:
 *   POST /audit/events — append an event (append-only, no update/delete)
 *   GET  /audit/events — list events with filtering
 *
 * The audit log is append-only: there is no PUT, PATCH, or DELETE route,
 * and the repository ports expose only `append` and `list`.
 */

import Fastify, { type FastifyInstance } from "fastify";

import { registerServiceIdentity, AUDIT_SCOPES, type AuditRouteConfig } from "./service-identity.js";
import { sendAuditError } from "./errors.js";
import { AuditError } from "../domain/errors.js";
import type { AuditDeps } from "../ports.js";
import type { AuditEvent } from "../domain/model.js";

const OPEN: AuditRouteConfig = { serviceIdentity: "open" };

function adminScoped(...scopes: readonly string[]): AuditRouteConfig {
  return { serviceIdentity: { scopes } };
}

export interface CreateAuditAppOptions {
  readonly deps: AuditDeps;
  readonly logger?: boolean;
  readonly serviceIdentity?: {
    keys: import("@wasla/service-auth").ServiceAuthKeyRegistry;
    replayGuard: import("@wasla/service-auth").ServiceTokenReplayGuard;
    audience?: string;
  };
}

function toWire(event: AuditEvent) {
  return {
    id: event.id,
    actor_id: event.actorId,
    actor_role: event.actorRole,
    action: event.action,
    resource_type: event.resourceType,
    resource_id: event.resourceId,
    metadata: event.metadata,
    created_at: event.createdAt,
  };
}

export function createAuditApp(options: CreateAuditAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, requestIdHeader: "x-request-id" });

  app.setErrorHandler((error, request, reply) => {
    sendAuditError(reply, error, request.id);
  });

  if (options.serviceIdentity) {
    registerServiceIdentity(app, {
      keys: options.serviceIdentity.keys,
      replayGuard: options.serviceIdentity.replayGuard,
      audience: options.serviceIdentity.audience,
    });
  }

  app.get("/health", { config: OPEN }, async (_request, reply) => {
    return reply.status(200).send({ status: "ok" });
  });

  app.post(
    "/audit/events",
    { config: adminScoped(AUDIT_SCOPES.write) },
    async (request, reply) => {
      const body = request.body as {
        actor_id?: unknown;
        actor_role?: unknown;
        action?: unknown;
        resource_type?: unknown;
        resource_id?: unknown;
        metadata?: unknown;
      };

      const actorId = typeof body?.actor_id === "string" ? body.actor_id.trim() : "";
      const actorRole = typeof body?.actor_role === "string" ? body.actor_role.trim() : "";
      const action = typeof body?.action === "string" ? body.action.trim() : "";
      const resourceType = typeof body?.resource_type === "string" ? body.resource_type.trim() : "";
      const resourceId = typeof body?.resource_id === "string" ? body.resource_id.trim() : "";

      if (!actorId || !actorRole || !action || !resourceType || !resourceId) {
        throw new AuditError(
          "AUDIT_INVALID_EVENT",
          "جميع الحقول المطلوبة: actor_id, actor_role, action, resource_type, resource_id",
          { traceId: request.id },
        );
      }

      const metadata =
        body.metadata !== undefined && typeof body.metadata === "object" && body.metadata !== null
          ? (body.metadata as Record<string, unknown>)
          : {};

      const event = await options.deps.repo.append({
        actorId,
        actorRole,
        action,
        resourceType,
        resourceId,
        metadata,
        createdAt: options.deps.clock.now(),
      });

      return reply.status(201).send(toWire(event));
    },
  );

  app.get(
    "/audit/events",
    { config: adminScoped(AUDIT_SCOPES.read) },
    async (request, reply) => {
      const query = request.query as {
        actor_id?: unknown;
        actor_role?: unknown;
        action?: unknown;
        resource_type?: unknown;
        resource_id?: unknown;
        from?: unknown;
        to?: unknown;
        limit?: unknown;
        offset?: unknown;
      };

      const limit = Math.min(Math.max(parseInt(query.limit as string) || 50, 1), 200);
      const offset = Math.max(parseInt(query.offset as string) || 0, 0);

      const events = await options.deps.repo.list({
        actorId: typeof query.actor_id === "string" ? query.actor_id : undefined,
        actorRole: typeof query.actor_role === "string" ? query.actor_role : undefined,
        action: typeof query.action === "string" ? query.action : undefined,
        resourceType: typeof query.resource_type === "string" ? query.resource_type : undefined,
        resourceId: typeof query.resource_id === "string" ? query.resource_id : undefined,
        from: typeof query.from === "string" ? query.from : undefined,
        to: typeof query.to === "string" ? query.to : undefined,
        limit,
        offset,
      });

      return reply.status(200).send({
        events: events.map(toWire),
        limit,
        offset,
      });
    },
  );

  return app;
}
