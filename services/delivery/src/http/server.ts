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

import { readLenientIntEnv, readPortEnv } from "@wasla/config";
import {
  createServiceRequestSigner,
  keyRegistryFromEnv,
} from "@wasla/service-auth";
import { createServiceTokenReplayGuardFromEnv } from "@wasla/service-auth/replay-store";

import { buildDeliveryHttpApp } from "./app.js";
import { resolveIdempotencyTtlSeconds } from "../domain/idempotency.js";
import { StoreOrderStore } from "../infrastructure/store-order-store.js";
import { PostgresReadinessProbe } from "../infrastructure/readiness-probe.js";
import { PostgresInventoryObservationStore } from "../infrastructure/inventory-observation-store.js";
import { PostgresRelayDeadLetterStore } from "../infrastructure/relay-dead-letter-store.js";
import { PostgresRelayRequeueStore } from "../infrastructure/relay-requeue-store.js";
import { PostgresRelayAcknowledgementStore } from "../infrastructure/relay-dead-letter-acknowledgement-store.js";
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
import { registerMetrics, instrumentApp, addMetricsEndpoint, startTracing } from "@wasla/observability";

const DATABASE_URL = process.env.DATABASE_URL;
const PORT = readPortEnv(process.env, "PORT", 8097);

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

  // قراءةٌ متسامحةٌ بقصدٍ (M2-04 · ADR-020): القرارُ أعلاهُ مكتوبٌ، والتسامحُ الآنَ
  // مُسمّىً في اسمِ الدالّةِ بدلَ أن يكونَ أثراً جانبيّاً لـ`Number(...)`.
  const timeoutMs = readLenientIntEnv(process.env, "MARKETPLACE_TIMEOUT_MS", { min: 1 });
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
  /*
   * عينُ الفقدِ (المراجعةُ 21/N · ADR-026 §4.23) — **تُركَّبُ دائماً بلا حاسمِ
   * بيئةٍ**. ولمَ لا راية؟ لأنَّ رايةً تُطفَأُ تعني أنَّ أوّلَ نشرٍ يُنسى فيهِ
   * تفعيلُها يُجيبُ 500 على عينِ المراقبةِ — والأسوأُ أنَّ صفّاً مسموماً يُكتَبُ
   * في الدفترِ بلا أن يعلمَ أحدٌ **وهوَ بالذاتِ ما جاءَتْ لأجلِهِ**. والقراءةُ
   * محضةٌ بلا كلفةِ كتابةٍ، فلا شيءَ تُحرسُ منهُ برايةٍ.
   */
  const relayDeadLetters = new PostgresRelayDeadLetterStore(pool);
  /*
   * واليدُ والمحضرُ مُركَّبانِ معَ العينِ (المراجعةُ 24/N · §4.27) — **وتركيبُ
   * الإعادةِ هنا رفعٌ لاكتشافٍ قيسَ في هذا البندِ لا تزيُّدٌ**: مسارُ §4.24
   * كانَ مسجَّلاً ومقيساً وموثَّقاً ومنفذُهُ **غيرَ مُركَّبٍ في هذا الجذرِ**،
   * فكانَ يُجيبُ 500 في الإنتاجِ حرفاً وهوَ أخضرُ في الوحدةِ والتكامُلِ — وهوَ
   * عينُ ما يمنعُهُ تعليلُ تركيبِ راياتِ المخزونِ أعلاهُ وقياسِ §4.23، وما تقولُهُ
   * قاعدةُ المستودَعِ: وجودُ الكودِ والاختبارِ لا يكونُ إثباتاً إنتاجيًّا.
   */
  const relayRequeue = new PostgresRelayRequeueStore(pool);
  const relayAcknowledgement = new PostgresRelayAcknowledgementStore(pool);
  /*
   * فرضُ هويّةِ الخدمةِ الداخلةِ (`M1-04` الموجةُ السادسةُ · المراجعةُ 17/N).
   *
   * والمفاتيحُ من البيئةِ **بلا قيمةٍ افتراضيّةٍ**: نشرٌ بلا
   * `WASLA_SERVICE_AUTH_KEYS` يسقطُ عندَ الإقلاعِ لا بعدَ أوّلِ نداءٍ — وهوَ
   * نفسُ الحاسمُ الذي يُستعملُ سلفاً في هذا الملفِّ للتوقيعِ **الصادرِ**، فالحدُّ
   * الآنَ يُوقِّعُ ويتحقَّقُ بمَعينِ مفاتيحَ واحدٍ.
   *
   * ومخزنُ آثارِ الإعادةِ **مشترَكٌ بينَ النسخِ** (ADR-035 · إغلاقُ
   * `RISK-0015`): يُبنى من البيئةِ فوقَ Postgres في
   * `createServiceTokenReplayGuardFromEnv`، ولا هبوطَ إلى الذاكرةِ بالسكوتِ —
   * نمطُ الذاكرةِ يُطلَبُ صراحةً ويُرفَضُ في `NODE_ENV=production`.
   */
  // M2-08b: Start observability tracing (no-op without OTEL_EXPORTER_OTLP_ENDPOINT)
  const stopTracing = startTracing("delivery");

  const { fastify, close } = buildDeliveryHttpApp({
    serviceIdentity: {
      keys: keyRegistryFromEnv(process.env),
      replayGuard: createServiceTokenReplayGuardFromEnv(process.env),
    },
    readPort: store,
    writePort: store,
    reservationPort: reservation.reservationPort,
    reservationStore: store,
    readinessPort: new PostgresReadinessProbe(pool),
    idempotencySweepPort: store,
    inventoryConflictReadPort: inventoryObservations,
    // نفسُ المخزنِ لمنفذَينِ: القراءةُ والإقرارُ يعملانِ على نفسِ الصفِّ، ومُحوِّلٌ
    // ثانٍ في الوسطِ كانَ سيسمحُ لهما بأن يقرآ صفَّينِ مختلفَينِ (المراجعةُ 18/N).
    inventoryConflictAcknowledgementPort: inventoryObservations,
    relayDeadLetterReadPort: relayDeadLetters,
    relayRequeuePort: relayRequeue,
    relayDeadLetterAcknowledgementPort: relayAcknowledgement,
    ...(catalog.catalogPort === undefined ? {} : { catalogPort: catalog.catalogPort }),
    ...(observation.observationPort === undefined
      ? {}
      : { marketplaceObservationPort: observation.observationPort }),
  });

  // M2-08b: Wire observability — metrics middleware + /metrics endpoint
  const metrics = registerMetrics("delivery");
  instrumentApp(fastify, metrics);
  addMetricsEndpoint(fastify, metrics);

  try {
    await fastify.listen({ port: PORT, host: "0.0.0.0" });
    // يُطبَعُ عندَ الإقلاعِ لأنَّ «أيُّ تركيبٍ يعملُ الآنَ؟» أوّلُ سؤالٍ في أيِّ
    // حادثةٍ، وقراءتُهُ من السجلِّ أسرعُ من استنتاجِهِ من سلوكِ المسارات.
    console.log(`delivery service listening on :${PORT} · inbound service identity: enforced (audience=delivery) · marketplace catalog: ${catalog.label} · reservation: ${reservation.label} · readiness probe: ${observation.label} · idempotency key ttl: ${idempotencyTtlSeconds}s · inventory conflict reads: wired · relay dead-letter metric: wired · relay dead-letter requeue: wired · relay dead-letter acknowledgement: wired`);
  } catch (err) {
    console.error("delivery service failed to start", err);
    await close();
    stopTracing();
    await pool.end();
    process.exit(1);
  }
}

await main();
