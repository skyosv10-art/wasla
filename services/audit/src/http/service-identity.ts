/**
 * Service identity enforcement for the Audit boundary (M3-04).
 *
 * Two scopes: read (GET /audit/events) and write (POST /audit/events).
 * The admin portal's operator/admin RBAC is an upstream concern — this
 * boundary enforces service-auth, not user-session roles.
 */

import type { FastifyInstance } from "fastify";

import {
  registerServiceIdentityOnFastify,
  type ServiceIdentityDenial,
  type ServiceIdentityRouteConfig,
  type ServiceIdentityRouteIdentity,
} from "@wasla/service-auth/fastify";
import type {
  ServiceAuthKeyRegistry,
  ServiceTokenReplayGuard,
} from "@wasla/service-auth";

import type { AuditErrorBody } from "./errors.js";

export const AUDIT_SERVICE_AUDIENCE = "audit";

export const AUDIT_SCOPES = {
  read: "audit:read",
  write: "audit:write",
} as const;

export type AuditRouteIdentity = ServiceIdentityRouteIdentity;
export type AuditRouteConfig = ServiceIdentityRouteConfig;

function denialBody(decision: ServiceIdentityDenial, traceId: string): AuditErrorBody {
  return {
    code: decision.code,
    message: decision.message,
    trace_id: traceId,
  };
}

export interface AuditServiceIdentityOptions {
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
  readonly audience?: string;
  readonly now?: () => Date;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

export function registerServiceIdentity(
  app: FastifyInstance,
  options: AuditServiceIdentityOptions,
): void {
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? AUDIT_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody,
    boundaryLabel: "حد التدقيق",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clockSkewSeconds === undefined ? {} : { clockSkewSeconds: options.clockSkewSeconds }),
    ...(options.maxTtlSeconds === undefined ? {} : { maxTtlSeconds: options.maxTtlSeconds }),
  });
}
