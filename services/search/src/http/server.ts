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
import { keyRegistryFromEnv } from "@wasla/service-auth";
import { createServiceTokenReplayGuardFromEnv } from "@wasla/service-auth/replay-store";
import { buildSearchHttpApp } from "./app.js";
import { SearchIndexReader } from "../infrastructure/search-index-reader.js";
import { PostgresSearchDeadLetterStore } from "../infrastructure/relay-dead-letter-store.js";
import { SearchIndexHealthProbe } from "../infrastructure/search-index-health-probe.js";
import { registerMetrics, instrumentApp, addMetricsEndpoint, startTracing } from "@wasla/observability";

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
  /*
   * مقياسُ المسمومِ (`G5` · `CLM-0247`) — **مُركَّبٌ هنا لا اختياريٌّ في
   * الإنتاجِ**: منفذٌ مكتوبٌ ولا يُركَّبُ في جذرِ التركيبِ شيفرةٌ موجودةٌ غيرُ
   * مستعملةٍ، ومسارُهُ كانَ سيُجيبُ 503 في الإنتاجِ وحدَهُ فلا يُكشَفُ إلّا في
   * حادثةٍ. ويُشاركُ نفسَ المسبحِ لنفسِ سببِ مسبارِ الجاهزيّةِ.
   */
  const deadLetterReadPort = new PostgresSearchDeadLetterStore(pool);
  const keys = keyRegistryFromEnv(process.env);
  if (keys === undefined) {
    console.error("WASLA_SERVICE_AUTH_KEYS is required");
    process.exit(1);
  }
  // M2-08b: Start observability tracing (no-op without OTEL_EXPORTER_OTLP_ENDPOINT)
  const stopTracing = startTracing("search");

  const { fastify, close } = buildSearchHttpApp({
    searchReadPort: readPort,
    indexHealthPort,
    deadLetterReadPort,
    serviceIdentity: {
      keys,
      replayGuard: createServiceTokenReplayGuardFromEnv(process.env),
    },
  });

  // M2-08b: Wire observability — metrics middleware + /metrics endpoint
  const metrics = registerMetrics("search");
  instrumentApp(fastify, metrics);
  addMetricsEndpoint(fastify, metrics);

  try {
    await fastify.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`search service listening on :${PORT}`);
  } catch (err) {
    console.error("search service failed to start", err);
    await close();
    stopTracing();
    await pool.end();
    process.exit(1);
  }
}

await main();
