/**
 * جذر تركيب خدمة المطابقة.
 *
 * يختار Postgres عند وجود DATABASE_URL، وإلا ذاكرة معلنة كحالة degraded حتى لا
 * تبدو خدمة تفقد بياناتها بعد إعادة التشغيل سليمة. يغلق Fastify البركة معه كي
 * لا تبقى اتصالات قاعدة البيانات مفتوحة عند إيقاف الحاوية.
 */

import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { MATCHING_SERVICE_PORT } from "@wasla/contracts-matching";
import { InMemoryServiceTokenReplayGuard, keyRegistryFromEnv } from "@wasla/service-auth";

import { createMatchingDb } from "../infrastructure/drizzle/db.js";
import { PostgresMatchingUnitOfWork } from "../infrastructure/drizzle/transaction.js";
import { createInMemoryDependencies } from "../infrastructure/in-memory.js";
import { HttpZoneHierarchy } from "../infrastructure/http-geography.js";
import type { Clock, IdGenerator } from "../ports.js";
import { createDirectRunner, PostgresMatchingRunner, type MatchingRunner } from "../runner.js";

import { createMatchingApp, type MatchingHealthDescriptor } from "./app.js";

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
  const zones = new HttpZoneHierarchy({ baseUrl: process.env.GEOGRAPHY_BASE_URL ?? "http://localhost:8081" });
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
 * ومخزن الآثار في الذاكرة **دين معلن (RISK-0015)**: نسختان من الخدمة لا تتشاركان
 * ذاكرة، فرمز التقُط يمكن أن يُعاد على النسخة الأخرى. Redis هو السد، وعقد
 * `ServiceTokenReplayGuard` مكتوب كي يكون الاستبدال تغيير سطر في هذا الملف.
 */
function serviceIdentityWiring(): {
  keys: ReturnType<typeof keyRegistryFromEnv>;
  replayGuard: InMemoryServiceTokenReplayGuard;
} {
  return { keys: keyRegistryFromEnv(process.env), replayGuard: new InMemoryServiceTokenReplayGuard() };
}

async function main(): Promise<void> {
  const { runner, health, pool } = buildWiring();
  const app = createMatchingApp({
    runner,
    health,
    logger: true,
    serviceIdentity: serviceIdentityWiring(),
  });

  if (pool) {
    app.addHook("onClose", async () => {
      await pool.end();
    });
  }

  const port = Number(process.env.PORT ?? MATCHING_SERVICE_PORT);
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
