/**
 * Service identity for the partners boundary.
 * (ADR-048 §2, ADR-018 §2)
 */

import type { FastifyInstance } from "fastify";
import type { ServiceAuthKeyRegistry, ServiceTokenReplayGuard } from "@wasla/service-auth";
import { registerServiceIdentityOnFastify } from "@wasla/service-auth/fastify";

export const PARTNERS_SERVICE_AUDIENCE = "partners";

export const PARTNERS_SCOPES = {
  credentialIssue: "partners:credential:issue",
  credentialRead: "partners:credential:read",
  credentialRevoke: "partners:credential:revoke",
  webhookCreate: "partners:webhook:create",
  webhookRead: "partners:webhook:read",
  webhookDelete: "partners:webhook:delete",
  usageRead: "partners:usage:read",
  auditRead: "partners:audit:read",
  lifecycleRead: "partners:lifecycle:read",
  lifecycleSuspend: "partners:lifecycle:suspend",
  lifecycleReinstate: "partners:lifecycle:reinstate",
} as const;

export interface MarketplaceServiceIdentityOptions {
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
  readonly audience?: string;
  readonly now?: () => Date;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

export function registerServiceIdentity(
  app: FastifyInstance,
  options: Partial<MarketplaceServiceIdentityOptions>,
): void {
  if (!options.keys || !options.replayGuard) return;
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? PARTNERS_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody: (decision, traceId) => ({
      error: { code: decision.code, message: decision.message },
      trace_id: traceId,
    }),
    boundaryLabel: "حد الشركاء",
    ...(options.now ? { now: options.now } : {}),
    ...(options.clockSkewSeconds !== undefined ? { clockSkewSeconds: options.clockSkewSeconds } : {}),
    ...(options.maxTtlSeconds !== undefined ? { maxTtlSeconds: options.maxTtlSeconds } : {}),
  });
}
