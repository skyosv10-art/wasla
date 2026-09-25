/**
 * Partners service — HTTP app factory.
 * (ADR-048 §6)
 */

import Fastify, { type FastifyInstance } from "fastify";
import { TenantAccessDeniedError, TenantRoleError } from "../domain/tenant-guard";
import { registerServiceIdentity, type MarketplaceServiceIdentityOptions } from "./service-identity";
import { issueCredential } from "../use-cases/issue-credential";
import { revokeCredential } from "../use-cases/revoke-credential";
import { suspendTenant } from "../use-cases/suspend-tenant";
import { reinstateTenant } from "../use-cases/reinstate-tenant";
import type { StoreStaffPort, CredentialStore, WebhookStore, UsageStore, AuditStore, LifecycleStore } from "../ports";

export interface PartnerAppOptions {
  readonly staffPort: StoreStaffPort;
  readonly credentialStore: CredentialStore;
  readonly webhookStore: WebhookStore;
  readonly usageStore: UsageStore;
  readonly auditStore: AuditStore;
  readonly lifecycleStore: LifecycleStore;
  readonly logger?: boolean;
  readonly serviceIdentity?: Partial<MarketplaceServiceIdentityOptions>;
}

export function createPartnersApp(options: PartnerAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  // Map domain errors to HTTP status codes
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof TenantAccessDeniedError) {
      return reply.status(403).send({ error: { code: "TENANT_ACCESS_DENIED", message: err.message } });
    }
    if (err instanceof TenantRoleError) {
      return reply.status(403).send({ error: { code: "TENANT_ROLE_DENIED", message: err.message } });
    }
    return reply.send(err);
  });

  registerServiceIdentity(app, options.serviceIdentity ?? {});

  app.get("/partners/health", async () => ({ status: "ok" }));

  app.get("/partners/ready", async () => {
    try {
      await options.lifecycleStore.get("00000000-0000-0000-0000-000000000000");
      return { status: "ready" };
    } catch {
      return { status: "unavailable" };
    }
  });

  app.post("/partners/credentials", async (request, reply) => {
    const body = request.body as { storeId: string; scopes?: string[] };
    const actor = request.headers["x-wasla-principal"] as string;
    if (!actor) {
      return reply.status(401).send({ error: { code: "AUTHN_UNAUTHENTICATED", message: "Principal required" } });
    }
    const result = await issueCredential(options.staffPort, options.credentialStore, options.auditStore, {
      storeId: body.storeId,
      actorPublicId: actor,
      scopes: body.scopes ?? [],
    });
    return reply.status(201).send(result);
  });

  app.get("/partners/credentials", async (request) => {
    const query = request.query as { storeId: string };
    const actor = request.headers["x-wasla-principal"] as string;
    if (!actor) {
      return { status: 401, error: { code: "AUTHN_UNAUTHENTICATED", message: "Principal required" } };
    }
    const creds = await options.credentialStore.listByTenant(query.storeId);
    return { credentials: creds };
  });

  app.delete("/partners/credentials/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { storeId: string };
    const actor = request.headers["x-wasla-principal"] as string;
    if (!actor) {
      return reply.status(401).send({ error: { code: "AUTHN_UNAUTHENTICATED", message: "Principal required" } });
    }
    await revokeCredential(options.staffPort, options.credentialStore, options.auditStore, {
      storeId: body.storeId,
      actorPublicId: actor,
      credentialId: id,
    });
    return reply.status(204).send();
  });

  app.post("/partners/lifecycle/suspend", async (request, reply) => {
    const body = request.body as { storeId: string; reason: string };
    const actor = request.headers["x-wasla-principal"] as string;
    if (!actor) {
      return reply.status(401).send({ error: { code: "AUTHN_UNAUTHENTICATED", message: "Principal required" } });
    }
    await suspendTenant(options.lifecycleStore, options.auditStore, {
      storeId: body.storeId,
      actorPublicId: actor,
      reason: body.reason,
    });
    return reply.status(200).send({ status: "suspended" });
  });

  app.post("/partners/lifecycle/reinstate", async (request, reply) => {
    const body = request.body as { storeId: string };
    const actor = request.headers["x-wasla-principal"] as string;
    if (!actor) {
      return reply.status(401).send({ error: { code: "AUTHN_UNAUTHENTICATED", message: "Principal required" } });
    }
    await reinstateTenant(options.lifecycleStore, options.auditStore, {
      storeId: body.storeId,
      actorPublicId: actor,
    });
    return reply.status(200).send({ status: "active" });
  });

  app.get("/partners/lifecycle", async (request, reply) => {
    const query = request.query as { storeId: string };
    const lifecycle = await options.lifecycleStore.get(query.storeId);
    if (!lifecycle) {
      return reply.status(404).send({ error: { code: "LIFECYCLE_NOT_FOUND", message: "Lifecycle not found" } });
    }
    return lifecycle;
  });

  app.get("/partners/audit", async (request) => {
    const query = request.query as { storeId: string; limit?: string };
    const limit = parseInt(query.limit ?? "50") || 50;
    const entries = await options.auditStore.listByTenant(query.storeId, limit);
    return { entries };
  });

  app.get("/partners/usage", async (request) => {
    const query = request.query as { storeId: string };
    const now = new Date();
    const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours())).toISOString();
    const usage = await options.usageStore.get(query.storeId, windowStart);
    return usage ?? { tenantStoreId: query.storeId, windowStart, apiCalls: 0, webhookDeliveries: 0 };
  });

  return app;
}
