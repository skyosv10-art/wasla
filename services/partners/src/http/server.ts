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
import { createPartnersPool } from "../infrastructure/pg";
import { PgCredentialStore } from "../infrastructure/credential-store";
import { PgWebhookStore } from "../infrastructure/webhook-store";
import { PgUsageStore } from "../infrastructure/usage-store";
import { PgAuditStore } from "../infrastructure/audit-store";
import { PgLifecycleStore } from "../infrastructure/lifecycle-store";
import { PgStoreStaffPort } from "../infrastructure/store-staff-port";
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

  const pool = createPartnersPool();

  const ports: PartnerPorts = {
    staffPort: new PgStoreStaffPort(pool),
    credentialStore: new PgCredentialStore(pool),
    webhookStore: new PgWebhookStore(pool),
    usageStore: new PgUsageStore(pool),
    auditStore: new PgAuditStore(pool),
    lifecycleStore: new PgLifecycleStore(pool),
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
    await pool.end();
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
