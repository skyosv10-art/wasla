/**
 * Partners service — production root.
 * (ADR-048 §6)
 */

import Fastify from "fastify";
import { readPortEnv } from "@wasla/config";
import { createApp } from "./app";
import type { PartnerPorts } from "../ports";

const PORT = readPortEnv(process.env, "PORT", 8098);

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  // In production, these ports would be wired to real infrastructure.
  // For now, this is a scaffold that starts and responds to health checks.
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

  createApp(app, ports);

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(JSON.stringify({ service: "partners", port: PORT, status: "listening" }));
}

main().catch((err) => {
  console.error(JSON.stringify({ service: "partners", error: String(err) }));
  process.exit(1);
});
