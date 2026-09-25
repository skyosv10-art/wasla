/**
 * Partners service — production root.
 * (ADR-048 §6)
 *
 * The second and last file that reads `process.env` (with `db/migrate-cli.ts`).
 * Env purity is enforced by `__tests__/purity.test.ts`.
 */

import { keyRegistryFromEnv, type ServiceTokenReplayGuard } from "@wasla/service-auth";
import { createServiceTokenReplayGuardFromEnv } from "@wasla/service-auth/replay-store";
import { registerMetrics, instrumentApp, addMetricsEndpoint, startTracing } from "@wasla/observability";
import { createPartnersApp } from "./app";
import type { PartnerPorts } from "../ports";

const PARTNERS_SERVICE_PORT = 8098;

function readPort(): number {
  const raw = process.env.PORT ?? process.env.PARTNERS_SERVICE_PORT;
  if (raw === undefined || raw.trim() === "") return PARTNERS_SERVICE_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT / PARTNERS_SERVICE_PORT غير صالح");
  }
  return port;
}

function serviceIdentityFromEnv(): {
  keys: ReturnType<typeof keyRegistryFromEnv>;
  replayGuard: ServiceTokenReplayGuard;
} {
  return {
    keys: keyRegistryFromEnv(process.env),
    replayGuard: createServiceTokenReplayGuardFromEnv(process.env),
  };
}

export async function startPartnersServer(): Promise<void> {
  const port = readPort();
  const host = process.env.PARTNERS_SERVICE_HOST ?? "0.0.0.0";

  const stopTracing = startTracing("partners");

  const ports: PartnerPorts = {
    staffPort: {
      async isStoreStaff() { return null; },
    },
    credentialStore: {
      async create() { throw new Error("Not implemented"); },
      async listByTenant() { return []; },
      async revoke() { return null; },
      async findByHash() { return null; },
    },
    webhookStore: {
      async create() { throw new Error("Not implemented"); },
      async listByTenant() { return []; },
      async delete() { return null; },
      async pause() { return null; },
    },
    usageStore: {
      async incrementApiCalls() { throw new Error("Not implemented"); },
      async incrementWebhookDeliveries() { throw new Error("Not implemented"); },
      async get() { return null; },
    },
    auditStore: {
      async append() { throw new Error("Not implemented"); },
      async listByTenant() { return []; },
    },
    lifecycleStore: {
      async get() { return null; },
      async create() { throw new Error("Not implemented"); },
      async transition() { throw new Error("Not implemented"); },
    },
  };

  const app = createPartnersApp({
    ...ports,
    logger: true,
    serviceIdentity: serviceIdentityFromEnv(),
  });

  const metrics = registerMetrics("partners");
  instrumentApp(app, metrics);
  addMetricsEndpoint(app, metrics);

  app.addHook("onClose", async () => {
    stopTracing();
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }

  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exit(1);
  }
}

await startPartnersServer();
