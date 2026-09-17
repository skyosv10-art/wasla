/**
 * Search service production entrypoint (ADR-025 §5).
 *
 * Wires `DATABASE_URL` → a `pg.Pool` → `SearchIndexReader` (the read-side
 * adapter) + `SearchIndexHealthProbe` (the readiness adapter) →
 * `buildSearchHttpApp`, then listens on `PORT` (default 8012, per
 * api.openapi.yml `servers`).
 *
 * Credentials are NEVER committed: `DATABASE_URL` is read from the environment
 * only. The Supabase trial connection string is a runtime secret, not a source
 * constant. If `DATABASE_URL` is absent the server refuses to start — a search
 * service without a read model is not a service.
 */

import { Pool } from "pg";

import { readPortEnv } from "@wasla/config";
import { keyRegistryFromEnv, InMemoryServiceTokenReplayGuard } from "@wasla/service-auth";
import { buildSearchHttpApp } from "./app.js";
import { SearchIndexReader } from "../infrastructure/search-index-reader.js";
import { SearchIndexHealthProbe } from "../infrastructure/search-index-health-probe.js";

const DATABASE_URL = process.env.DATABASE_URL;
const PORT = readPortEnv(process.env, "PORT", 8012);

async function main(): Promise<void> {
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const readPort = new SearchIndexReader(pool);
  // Readiness shares the pool on purpose: a probe on its own connection would
  // report "ready" while the pool the searches use is exhausted (RISK-0030).
  const indexHealthPort = new SearchIndexHealthProbe(pool);
  const keys = keyRegistryFromEnv(process.env);
  if (keys === undefined) {
    console.error("WASLA_SERVICE_AUTH_KEYS is required");
    process.exit(1);
  }
  const { fastify, close } = buildSearchHttpApp({
    searchReadPort: readPort,
    indexHealthPort,
    serviceIdentity: {
      keys,
      replayGuard: new InMemoryServiceTokenReplayGuard(),
    },
  });

  try {
    await fastify.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`search service listening on :${PORT}`);
  } catch (err) {
    console.error("search service failed to start", err);
    await close();
    await pool.end();
    process.exit(1);
  }
}

await main();
