/**
 * Delivery service production entrypoint (ADR-026 §4.2 — the composition root).
 *
 * Wires `DATABASE_URL` → `pg.Pool` → `StoreOrderStore` (read + write ports) →
 * `buildDeliveryHttpApp`, then listens on `PORT` (default 8097, per
 * api.openapi.yml `servers`).
 *
 * Credentials are NEVER committed: the connection string is read from the
 * environment only — the Supabase trial URL is a runtime secret, not a source
 * constant (`scan-secrets.sh` enforces this, and it is right to).
 *
 * If `DATABASE_URL` is absent the process refuses to start. A delivery service
 * without its ledger cannot accept an order, and a process that starts anyway
 * would answer 503 to everything while looking healthy to an orchestrator.
 *
 * ## The catalog port IS wired now (review 8/N — ADR-026 §4.9-2 lifted)
 *
 * `MARKETPLACE_SERVICE_URL` → `HttpMarketplaceCatalogPort` (signed, ADR-020).
 * For seven reviews no adapter could exist because this contract demanded a
 * `WS-` store ref that marketplace never published; §4.11 resolved that by
 * using the reference marketplace DOES publish — the store slug.
 *
 * Absent the URL the port stays absent and placement keeps answering
 * `503 DELIVERY_MARKETPLACE_UNAVAILABLE`. That is a fail-closed default, not a
 * fallback: a fake or permissive catalog here would mint prices, and a price
 * this service invents is money it invents. Reads and cancellation are
 * unaffected either way — they need no marketplace.
 *
 * ## Readiness is wired to the SAME pool (review 7/N)
 *
 * `GET /delivery/ready` probes through `PostgresReadinessProbe` over the pool
 * the routes use. A probe with its own connection could be green while the
 * serving pool is exhausted — the failure mode readiness exists to catch.
 * With the catalog port still absent, a ready answer means "reads and
 * cancellation are servable", and the response says so in `not_claimed`.
 */

import { Pool } from "pg";

import { createServiceRequestSigner, keyRegistryFromEnv } from "@wasla/service-auth";

import { buildDeliveryHttpApp } from "./app.js";
import { resolveIdempotencyTtlSeconds } from "../domain/idempotency.js";
import { StoreOrderStore } from "../infrastructure/store-order-store.js";
import { PostgresReadinessProbe } from "../infrastructure/readiness-probe.js";
import { PostgresInventoryObservationStore } from "../infrastructure/inventory-observation-store.js";
import {
  DELIVERY_MARKETPLACE_SCOPES,
  HttpMarketplaceCatalogPort,
} from "../infrastructure/http-marketplace-catalog.js";
import {
  DELIVERY_MARKETPLACE_RESERVATION_SCOPES,
  HttpMarketplaceReservationPort,
} from "../infrastructure/http-marketplace-reservation.js";
import {
  DEFAULT_MARKETPLACE_PROBE_TIMEOUT_MS,
  DELIVERY_MARKETPLACE_PROBE_SCOPES,
  HttpMarketplaceHealthProbe,
} from "../infrastructure/http-marketplace-probe.js";
import {
  CachedDependencyProbe,
  DEFAULT_MARKETPLACE_PROBE_TTL_MS,
  resolveMarketplaceProbeConfig,
} from "../domain/dependency-probe.js";
import type { DependencyObservationPort } from "../domain/dependency-probe.js";
import type { InventoryReservationPort, StoreOrderCatalogPort } from "../ports.js";

const DATABASE_URL = process.env.DATABASE_URL;
const PORT = Number(process.env.PORT ?? 8097);

/**
 * لا منفذَ كتالوجٍ بلا عنوانِ سوقٍ — والصمتُ هنا فشلٌ مُغلَقٌ مُعلَنٌ.
 *
 * والمَهَلُ من البيئةِ لأنَّ زمنَ ردِّ السوقِ شأنُ تشغيلٍ لا ثابتُ شفرةٍ؛ وقيمةٌ
 * غيرُ مقروءةٍ تُهمَلُ إلى الافتراضِ بدلَ أن تُوقِفَ الإقلاعَ على خطأِ إعدادٍ
 * في حقلٍ ثانويٍّ.
 */
function buildCatalogPort(): { catalogPort?: StoreOrderCatalogPort; label: string } {
  const baseUrl = process.env.MARKETPLACE_SERVICE_URL;
  if (!baseUrl) return { label: "unwired (MARKETPLACE_SERVICE_URL absent)" };

  const timeoutRaw = Number(process.env.MARKETPLACE_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : undefined;
  return {
    catalogPort: new HttpMarketplaceCatalogPort({
      baseUrl,
      // المفاتيحُ من البيئةِ بلا قيمةٍ افتراضيّةٍ: منادٍ بلا مفاتيحَ يُرَدُّ 401
      // فيُقرأُ الردُّ عطلَ السوقِ لا نقصَ إعدادٍ هنا، والإخفاقُ عندَ الإقلاعِ
      // يسمّي العلّةَ في موضعِها (ADR-020 · ADR-022).
      signRequest: createServiceRequestSigner({
        serviceName: "delivery",
        audience: "marketplace",
        keys: keyRegistryFromEnv(process.env),
        scopes: DELIVERY_MARKETPLACE_SCOPES,
      }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }),
    label: `wired → ${baseUrl}`,
  };
}

/**
 * رصدُ السوقِ للجاهزيّةِ (المراجعةُ 15/N · ADR-026 §4.17).
 *
 * بلا عنوانِ سوقٍ لا مسبارَ — والجاهزيّةُ تقولُ `marketplace_catalog_not_wired`
 * كما كانت. وبعنوانٍ: مسبارٌ مُوقَّعٌ بلا صلاحيّةٍ، مُغلَّفٌ بصلاحيّةِ رصدٍ
 * (`ttlMs`) فالحِمْلُ مسقوفٌ لا بعددِ نبضاتِ المنظِّمِ.
 *
 * وإعدادُهُ يُحَلُّ هنا فيُوقِفُ الإقلاعَ على قيمةٍ خاطئةٍ — بخلافِ
 * `MARKETPLACE_TIMEOUT_MS` أعلاهُ التي تُهمَلُ إلى الافتراضِ. والفرقُ مقصودٌ
 * ومقيسٌ: مَهَلُ نداءِ الكتالوجِ حقلٌ ثانويٌّ يُصحِّحُهُ الاستعمالُ، أمّا
 * **صلاحيّةُ الرصدِ** فهيَ نفسُها الحمايةُ من إغراقِ حدِّ السوقِ؛ ورقمٌ مُهمَلٌ
 * صامتاً فيها يعني حمايةً يظنُّها المُشغِّلُ قائمةً وليست.
 */
function buildMarketplaceObservationPort(): {
  observationPort?: DependencyObservationPort;
  label: string;
} {
  const baseUrl = process.env.MARKETPLACE_SERVICE_URL;
  if (!baseUrl) return { label: "unwired (MARKETPLACE_SERVICE_URL absent)" };

  const config = resolveMarketplaceProbeConfig(process.env, {
    ttlMs: DEFAULT_MARKETPLACE_PROBE_TTL_MS,
    timeoutMs: DEFAULT_MARKETPLACE_PROBE_TIMEOUT_MS,
  });
  const probe = new HttpMarketplaceHealthProbe({
    baseUrl,
    signRequest: createServiceRequestSigner({
      serviceName: "delivery",
      audience: "marketplace",
      keys: keyRegistryFromEnv(process.env),
      scopes: DELIVERY_MARKETPLACE_PROBE_SCOPES,
    }),
    timeoutMs: config.timeoutMs,
  });
  return {
    observationPort: new CachedDependencyProbe(probe, {
      name: "marketplace_catalog",
      ttlMs: config.ttlMs,
    }),
    label: `probing ${baseUrl}/health · ttl ${config.ttlMs}ms · timeout ${config.timeoutMs}ms`,
  };
}

function buildReservationPort(): { reservationPort: InventoryReservationPort; label: string } {
  const baseUrl = process.env.MARKETPLACE_SERVICE_URL;
  if (!baseUrl) {
    return {
      reservationPort: {
        reserve: () => Promise.reject(new Error("MARKETPLACE_SERVICE_URL absent")),
        release: () => Promise.resolve({ released: true }),
      },
      label: "unwired (MARKETPLACE_SERVICE_URL absent)",
    };
  }

  return {
    reservationPort: new HttpMarketplaceReservationPort({
      baseUrl,
      signRequest: createServiceRequestSigner({
        serviceName: "delivery",
        audience: "marketplace",
        keys: keyRegistryFromEnv(process.env),
        scopes: DELIVERY_MARKETPLACE_RESERVATION_SCOPES,
      }),
    }),
    label: `wired → ${baseUrl}`,
  };
}

async function main(): Promise<void> {
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  // حياةُ مفتاحِ التماثُلِ تُحلُّ هنا في جِذعِ التركيبِ لا في المخزنِ: قيمةٌ خاطئةٌ
  // تُوقِفُ الإقلاعَ برسالةٍ تُسمّي المتغيّرَ، ولا تُكتشَفُ في أوّلِ كتابةٍ
  // (`domain/idempotency.ts` يشرحُ لِمَ الفشلُ صائحٌ هنا ومُهمَلٌ في المَهَلِ).
  const idempotencyTtlSeconds = resolveIdempotencyTtlSeconds(process.env);
  const store = new StoreOrderStore(pool, idempotencyTtlSeconds);
  const catalog = buildCatalogPort();
  const reservation = buildReservationPort();
  const observation = buildMarketplaceObservationPort();
  // مخزنُ الرصدِ مُركَّبٌ هنا للقراءةِ فقط (المراجعةُ 16/N · ADR-026 §4.18): الكتابةُ
  // فيهِ ملكُ المرحّلِ (`marketplace-inventory-relay.ts`) والتطبيقُ لا يرى منهُ
  // إلّا `InventoryConflictReadPort` — والمحدودُ بالنوعِ لا بالنيّةِ.
  const inventoryObservations = new PostgresInventoryObservationStore(pool);
  const { fastify, close } = buildDeliveryHttpApp({
    readPort: store,
    writePort: store,
    reservationPort: reservation.reservationPort,
    reservationStore: store,
    readinessPort: new PostgresReadinessProbe(pool),
    idempotencySweepPort: store,
    inventoryConflictReadPort: inventoryObservations,
    ...(catalog.catalogPort === undefined ? {} : { catalogPort: catalog.catalogPort }),
    ...(observation.observationPort === undefined
      ? {}
      : { marketplaceObservationPort: observation.observationPort }),
  });

  try {
    await fastify.listen({ port: PORT, host: "0.0.0.0" });
    // يُطبَعُ عندَ الإقلاعِ لأنَّ «أيُّ تركيبٍ يعملُ الآنَ؟» أوّلُ سؤالٍ في أيِّ
    // حادثةٍ، وقراءتُهُ من السجلِّ أسرعُ من استنتاجِهِ من سلوكِ المسارات.
    console.log(`delivery service listening on :${PORT} · marketplace catalog: ${catalog.label} · reservation: ${reservation.label} · readiness probe: ${observation.label} · idempotency key ttl: ${idempotencyTtlSeconds}s · inventory conflict reads: wired`);
  } catch (err) {
    console.error("delivery service failed to start", err);
    await close();
    await pool.end();
    process.exit(1);
  }
}

await main();
