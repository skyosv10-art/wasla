/**
 * Geography service bootstrap (composition root) — MR 5.
 *
 * Wires concrete adapters and starts the Fastify server:
 *  - Postgres adapters when DATABASE_URL is set (production/staging);
 *  - in-memory adapters (Saudi fixture) otherwise, for local dev / smoke runs;
 *  - HttpIdentityLookupPort when IDENTITY_SERVICE_URL is set, otherwise the
 *    permissive in-process lookup (dev only — never in production).
 *
 * Not exercised by the unit test suite (which uses createGeographyApp +
 * app.inject with in-memory deps). Run with: `node --import tsx ...`.
 * Port via PORT (default 8081 — identity uses 8080; see api.openapi.yml).
 */

import {
  createServiceRequestSigner,
  keyRegistryFromEnv,
} from "@wasla/service-auth";
import { createServiceTokenReplayGuardFromEnv } from "@wasla/service-auth/replay-store";

import { readPortEnv } from "@wasla/config";

import { createGeographyApp } from "./app.js";
import {
  SystemClock,
  CryptoIdGenerator,
  InMemoryGeographyRepository,
  InMemoryOutbox,
  InMemoryIdentityLookupPort,
  HttpIdentityLookupPort,
  GEOGRAPHY_IDENTITY_SCOPES,
  PostgresGeographyRepository,
  PostgresOutbox,
  createDb,
} from "../index.js";
import type { IdentityLookupPort } from "../ports.js";
import type { UseCaseDeps } from "../use-cases/deps.js";
import { registerMetrics, instrumentApp, addMetricsEndpoint, startTracing } from "@wasla/observability";

function buildIdentityLookup(): IdentityLookupPort {
  const baseUrl = process.env.IDENTITY_SERVICE_URL;
  if (baseUrl) {
    return new HttpIdentityLookupPort({
      baseUrl,
      // M1-04 (الموجة 3): حد الهويّة صار يفرض هوية الخدمة. والصلاحية المطلوبة
      // قراءةُ مستخدم وحدها — لا ربطَ هويّةٍ ولا بدءَ استعادةٍ.
      signRequest: createServiceRequestSigner({
        serviceName: "geography",
        audience: "identity",
        keys: keyRegistryFromEnv(process.env),
        scopes: GEOGRAPHY_IDENTITY_SCOPES,
      }),
    });
  }
  // Dev fallback: assumes every format-valid public id exists.
  return new InMemoryIdentityLookupPort();
}

async function buildDeps(): Promise<UseCaseDeps> {
  const clock = new SystemClock();
  const idGen = new CryptoIdGenerator();
  const identityLookup = buildIdentityLookup();

  if (process.env.DATABASE_URL) {
    const { db } = createDb({ connectionString: process.env.DATABASE_URL });
    return {
      repo: new PostgresGeographyRepository(db),
      outbox: new PostgresOutbox(db),
      clock,
      idGen,
      identityLookup,
    };
  }

  // In-memory dev mode (Saudi fixture seeded by the repository constructor).
  return {
    repo: new InMemoryGeographyRepository(),
    outbox: new InMemoryOutbox(),
    clock,
    idGen,
    identityLookup,
  };
}

async function main(): Promise<void> {
  const deps = await buildDeps();
  // M1-04 (الموجةُ الخامسة): الحدُّ مفروضٌ، والمفاتيحُ من البيئةِ بلا قيمةٍ
  // افتراضيّةٍ — فنشرٌ بلا `WASLA_SERVICE_AUTH_KEYS` يسقطُ عندَ الإقلاعِ لا
  // ومخزنُ آثارِ الإعادةِ **مشترَكٌ بينَ النسخِ** (ADR-035 · إغلاقُ
  // `RISK-0015`): يُبنى من البيئةِ فوقَ Postgres في
  // `createServiceTokenReplayGuardFromEnv`، ولا هبوطَ إلى الذاكرةِ بالسكوتِ —
  // نمطُ الذاكرةِ يُطلَبُ صراحةً ويُرفَضُ في `NODE_ENV=production`.
    // M2-08b: Start observability tracing (no-op without OTEL_EXPORTER_OTLP_ENDPOINT)
  const stopTracing = startTracing("geography");

  const app = createGeographyApp({
    deps,
    logger: true,
    serviceIdentity: {
      keys: keyRegistryFromEnv(process.env),
      replayGuard: createServiceTokenReplayGuardFromEnv(process.env),
    },
  });

  // M2-08b: Wire observability — metrics middleware + /metrics endpoint
  const metrics = registerMetrics("geography");
  instrumentApp(app, metrics);
  addMetricsEndpoint(app, metrics);
  const port = readPortEnv(process.env, "PORT", 8081);

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      stopTracing();
      void app.close().then(() => process.exit(0));
    });
  }

  try {
    await app.listen({ port, host: "0.0.0.0" });
  } catch (err) {
    stopTracing();
    app.log.error(err);
    process.exit(1);
  }
}

await main();
