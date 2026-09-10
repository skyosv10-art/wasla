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
import { StoreOrderStore } from "../infrastructure/store-order-store.js";
import { PostgresReadinessProbe } from "../infrastructure/readiness-probe.js";
import {
  DELIVERY_MARKETPLACE_SCOPES,
  HttpMarketplaceCatalogPort,
} from "../infrastructure/http-marketplace-catalog.js";
import type { StoreOrderCatalogPort } from "../ports.js";

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

async function main(): Promise<void> {
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const store = new StoreOrderStore(pool);
  const catalog = buildCatalogPort();
  const { fastify, close } = buildDeliveryHttpApp({
    readPort: store,
    writePort: store,
    // A REAL probe over the same pool the routes use: probing a second pool
    // would report the health of a connection nobody serves traffic with
    // (review 7/N · §4.10-2).
    readinessPort: new PostgresReadinessProbe(pool),
    // موصولٌ متى وُجِدَ العنوانُ، وغائبٌ بلا بديلٍ متى غابَ — والجاهزيّةُ تقولُ
    // أيَّهما هو الحالُ في `not_claimed` (المراجعةُ 8/N).
    ...(catalog.catalogPort === undefined ? {} : { catalogPort: catalog.catalogPort }),
  });

  try {
    await fastify.listen({ port: PORT, host: "0.0.0.0" });
    // يُطبَعُ عندَ الإقلاعِ لأنَّ «أيُّ تركيبٍ يعملُ الآنَ؟» أوّلُ سؤالٍ في أيِّ
    // حادثةٍ، وقراءتُهُ من السجلِّ أسرعُ من استنتاجِهِ من سلوكِ المسارات.
    console.log(`delivery service listening on :${PORT} · marketplace catalog: ${catalog.label}`);
  } catch (err) {
    console.error("delivery service failed to start", err);
    await close();
    await pool.end();
    process.exit(1);
  }
}

await main();
