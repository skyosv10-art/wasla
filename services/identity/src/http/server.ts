/**
 * Identity service bootstrap (composition root).
 *
 * Wires concrete adapters and starts the Fastify server:
 *  - Postgres adapters when DATABASE_URL is set (production/staging);
 *  - in-memory adapters otherwise (local dev / smoke runs).
 *
 * Not exercised by the unit test suite (which uses createIdentityApp +
 * app.inject with in-memory deps). Run with: `node --import tsx ...` or after
 * `pnpm --filter @wasla/identity-service build`. Port via PORT (default 8080).
 */

import { InMemoryServiceTokenReplayGuard, keyRegistryFromEnv } from "@wasla/service-auth";

import { createIdentityApp } from "./app.js";
import {
  SystemClock,
  CryptoIdGenerator,
  InMemoryIdentityRepository,
  InMemoryOutbox,
  InMemoryPublicIdSequence,
  PostgresIdentityRepository,
  PostgresOutbox,
  PostgresPublicIdSequence,
  createDb,
  ensurePublicIdSequence,
} from "../index.js";
import type { UseCaseDeps } from "../use-cases/resolve-telegram-identity.js";

async function buildDeps(): Promise<UseCaseDeps> {
  const clock = new SystemClock();
  const idGen = new CryptoIdGenerator();

  if (process.env.DATABASE_URL) {
    const { db } = createDb({
      connectionString: process.env.DATABASE_URL,
    });
    await ensurePublicIdSequence(db);
    return {
      repo: new PostgresIdentityRepository(db),
      outbox: new PostgresOutbox(db),
      publicIdSeq: new PostgresPublicIdSequence(db),
      clock,
      idGen,
    };
  }

  // In-memory dev mode.
  const repo = new InMemoryIdentityRepository();
  return {
    repo,
    outbox: new InMemoryOutbox(),
    publicIdSeq: new InMemoryPublicIdSequence(),
    clock,
    idGen,
  };
}

/**
 * مفاتيح هوية الخدمة ومخزن آثار الإعادة لحد الهويّة.
 *
 * لا قيمة افتراضية للمفاتيح: خدمة بلا مفاتيح لا تفرّق منادياً من مزوّر، فتشغيلها
 * «مؤقتاً بلا فرض» هو تشغيل الثغرة نفسها — وهذا الحدُّ يربط هويّات ويبدأ استعادة
 * حساب، فأثر الثغرة فيه استيلاء لا قراءة. والإخفاق عند الإقلاع برسالة تسمّي
 * المتغير أرخص من حدِّ هويّة مفتوح لا أحد يراه.
 *
 * ومخزن الآثار في الذاكرة **دين معلن (RISK-0015)**: نسختان لا تتشاركان ذاكرة،
 * فرمز التُقط يمكن أن يُعاد على النسخة الأخرى. Redis هو السد، وعقد
 * `ServiceTokenReplayGuard` مكتوب كي يكون الاستبدال تغيير سطر هنا.
 */
function serviceIdentityWiring(): {
  keys: ReturnType<typeof keyRegistryFromEnv>;
  replayGuard: InMemoryServiceTokenReplayGuard;
} {
  return {
    keys: keyRegistryFromEnv(process.env),
    replayGuard: new InMemoryServiceTokenReplayGuard(),
  };
}

async function main(): Promise<void> {
  const deps = await buildDeps();
  const app = createIdentityApp({
    deps,
    logger: true,
    serviceIdentity: serviceIdentityWiring(),
  });
  const port = Number(process.env.PORT ?? 8080);

  try {
    await app.listen({ port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

await main();
