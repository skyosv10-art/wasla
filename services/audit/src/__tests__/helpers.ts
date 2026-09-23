/**
 * Test helpers for the Audit service.
 *
 * Builds a signed app harness using the same pattern as other services.
 */

import type { InjectOptions, LightMyRequestResponse } from "fastify";

import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
} from "@wasla/service-auth";

import { createAuditApp } from "../http/app.js";
import { AUDIT_SCOPES, AUDIT_SERVICE_AUDIENCE } from "../http/service-identity.js";
import { createInMemoryDeps } from "../infrastructure/in-memory.js";

export const TEST_SERVICE_SECRET = "audit-test-secret-0123456789abcdef";
export const TEST_ACTIVE_KID = "test-active";

export const ALL_AUDIT_SCOPES: readonly string[] = Object.values(AUDIT_SCOPES);

export function createTestKeyRegistry(secret: string = TEST_SERVICE_SECRET): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [{ kid: TEST_ACTIVE_KID, secret, status: "active" }],
    activeKid: TEST_ACTIVE_KID,
  });
}

export function signFor(
  method: string,
  url: string,
  options: {
    keys?: ServiceAuthKeyRegistry;
    scopes?: readonly string[];
    serviceName?: string;
    now?: Date;
  } = {},
): Record<string, string> {
  return serviceAuthHeaders({
    serviceName: options.serviceName ?? "admin-portal",
    audience: AUDIT_SERVICE_AUDIENCE,
    method: method.toUpperCase(),
    path: url,
    keys: options.keys ?? createTestKeyRegistry(),
    now: options.now ?? new Date(),
    scopes: options.scopes ?? ALL_AUDIT_SCOPES,
  });
}

export function attachSigningInject(
  app: { inject: unknown },
  keys: ServiceAuthKeyRegistry,
): (options: InjectOptions) => Promise<LightMyRequestResponse> {
  const target = app as {
    inject: (options: InjectOptions) => Promise<LightMyRequestResponse>;
  };
  const rawInject = target.inject.bind(target);
  target.inject = (options: InjectOptions) =>
    rawInject({
      ...options,
      headers: {
        ...signFor(String(options.method ?? "GET"), String(options.url ?? "/"), { keys }),
        ...(options.headers ?? {}),
      },
    });
  return rawInject;
}

export interface AuditAppHarness {
  app: ReturnType<typeof createAuditApp>;
  keys: ServiceAuthKeyRegistry;
  replayGuard: InMemoryServiceTokenReplayGuard;
  rawInject: (options: InjectOptions) => Promise<LightMyRequestResponse>;
}

export function buildSignedAuditApp(): AuditAppHarness {
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const deps = createInMemoryDeps();
  const app = createAuditApp({ deps, serviceIdentity: { keys, replayGuard } });
  const rawInject = attachSigningInject(app, keys);
  return { app, keys, replayGuard, rawInject };
}
