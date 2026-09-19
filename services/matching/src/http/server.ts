/**
 * جذر تركيب خدمة المطابقة.
 *
 * يختار Postgres عند وجود DATABASE_URL، وإلا ذاكرة معلنة كحالة degraded حتى لا
 * تبدو خدمة تفقد بياناتها بعد إعادة التشغيل سليمة. يغلق Fastify البركة معه كي
 * لا تبقى اتصالات قاعدة البيانات مفتوحة عند إيقاف الحاوية.
 */

import { randomUUID } from "node:crypto";

import { readPortEnv } from "@wasla/config";
import type { Pool } from "pg";

import { MATCHING_SERVICE_PORT } from "@wasla/contracts-matching";
import {
  createServiceRequestSigner,
  keyRegistryFromEnv,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import { createServiceTokenReplayGuardFromEnv } from "@wasla/service-auth/replay-store";

import { createMatchingDb } from "../infrastructure/drizzle/db.js";
import { PostgresMatchingUnitOfWork } from "../infrastructure/drizzle/transaction.js";
import { createInMemoryDependencies } from "../infrastructure/in-memory.js";
import {
  HttpZoneHierarchy,
  MATCHING_GEOGRAPHY_SCOPES,
} from "../infrastructure/http-geography.js";
import type { Clock, IdGenerator } from "../ports.js";
import { createDirectRunner, PostgresMatchingRunner, type MatchingRunner } from "../runner.js";

import { createMatchingApp, type MatchingHealthDescriptor } from "./app.js";
import { registerMetrics, instrumentApp, addMetricsEndpoint, startTracing } from "@wasla/observability";

class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

class CryptoIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}

interface Wiring {
  runner: MatchingRunner;
  health: MatchingHealthDescriptor;
  pool: Pool | null;
}

function buildWiring(): Wiring {
  const zones = new HttpZoneHierarchy({
    baseUrl: process.env.GEOGRAPHY_BASE_URL ?? "http://localhost:8081",
    // M1-04 (الموجةُ الخامسة): حدُّ الجغرافيا مفروضٌ، فكلُّ نداءٍ صادرٍ إليه
    // موقَّعٌ. المفاتيحُ من البيئةِ بلا قيمةٍ افتراضيّةٍ: منادٍ بلا مفاتيح
    // يُرَدُّ 401 فيُقرأ الردُّ عطلَ الجغرافيا لا نقصَ إعدادٍ هنا، والإخفاقُ
    // عندَ الإقلاعِ يسمّي العلةَ في موضعِها.
    signRequest: createServiceRequestSigner({
      serviceName: "matching",
      audience: "geography",
      keys: keyRegistryFromEnv(process.env),
      scopes: MATCHING_GEOGRAPHY_SCOPES,
    }),
  });
  const clock = new SystemClock();
  const ids = new CryptoIdGenerator();

  if (process.env.DATABASE_URL) {
    const { pool, db } = createMatchingDb({ connectionString: process.env.DATABASE_URL });
    return {
      runner: new PostgresMatchingRunner(new PostgresMatchingUnitOfWork(db), { zones, clock, ids }),
      health: { persistence: "postgres" },
      pool,
    };
  }

  const memory = createInMemoryDependencies();
  return {
    runner: createDirectRunner({ ...memory, zones }),
    health: { persistence: "memory" },
    pool: null,
  };
}

/**
 * مفاتيح هوية الخدمة ومخزن آثار الإعادة.
 *
 * لا قيمة افتراضية للمفاتيح: خدمة بلا مفاتيح لا تستطيع أن تفرق منادياً من
 * مزوّر، فتشغيلها «مؤقتاً بلا فرض» هو تشغيل الثغرة التي تسدها هذه الدفعة.
 * فالإخفاق عند الإقلاع برسالة تسمّي المتغير أرخص من نشرٍ مفتوح لا أحد يراه.
 *
 * ومخزنُ آثارِ الإعادةِ **مشترَكٌ بينَ النسخِ** (ADR-035 · إغلاقُ
 * `RISK-0015`): يُبنى من البيئةِ فوقَ Postgres في
 * `createServiceTokenReplayGuardFromEnv`، ولا هبوطَ إلى الذاكرةِ بالسكوتِ —
 * نمطُ الذاكرةِ يُطلَبُ صراحةً ويُرفَضُ في `NODE_ENV=production`.
 */
function serviceIdentityWiring(): {
  keys: ReturnType<typeof keyRegistryFromEnv>;
  replayGuard: ServiceTokenReplayGuard;
} {
  return { keys: keyRegistryFromEnv(process.env), replayGuard: createServiceTokenReplayGuardFromEnv(process.env) };
}

async function main(): Promise<void> {
  const { runner, health, pool } = buildWiring();
    // M2-08b: Start observability tracing (no-op without OTEL_EXPORTER_OTLP_ENDPOINT)
  const stopTracing = startTracing("matching");

  const app = createMatchingApp({
    runner,
    health,
    logger: true,
    serviceIdentity: serviceIdentityWiring(),
  });

  // M2-08b: Wire observability — metrics middleware + /metrics endpoint
  const metrics = registerMetrics("matching");
  instrumentApp(app, metrics);
  addMetricsEndpoint(app, metrics);

  app.addHook("onClose", async () => { stopTracing(); });
  
  if (pool) {
    app.addHook("onClose", async () => {
    stopTracing();
      await pool.end();
    });
  }

  const port = readPortEnv(process.env, "PORT", MATCHING_SERVICE_PORT);
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }

  try {
    await app.listen({ port, host: "0.0.0.0" });
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exit(1);
  }
}

await main();
