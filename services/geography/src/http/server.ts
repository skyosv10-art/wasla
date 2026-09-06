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
  InMemoryServiceTokenReplayGuard,
  keyRegistryFromEnv,
} from "@wasla/service-auth";

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
  // بعدَ أوّلِ نداءٍ. ومخزنُ آثارِ الإعادةِ في الذاكرةِ **دَينٌ مُعلَنٌ
  // (`RISK-0015`)**: نسختانِ لا تتشاركانِ ذاكرةً، فرمزٌ التُقِطَ يمكنُ أن يُعادَ
  // على الأخرى — و`Redis` هو السدُّ، وعقدُ `ServiceTokenReplayGuard` مكتوبٌ كي
  // يكونَ الاستبدالُ تغييرَ سطرٍ هنا.
  const app = createGeographyApp({
    deps,
    logger: true,
    serviceIdentity: {
      keys: keyRegistryFromEnv(process.env),
      replayGuard: new InMemoryServiceTokenReplayGuard(),
    },
  });
  const port = Number(process.env.PORT ?? 8081);

  try {
    await app.listen({ port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

await main();
