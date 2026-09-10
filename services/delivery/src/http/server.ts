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
 * ## The catalog port is NOT wired, deliberately
 *
 * `POST /store-orders` needs marketplace price snapshots (§2.3), but the store
 * ref in this contract is `WS-##########` while services/marketplace
 * identifies a store by `store_slug`/`store_id` and publishes no public store
 * ref. No adapter can be written without inventing that mapping, so none is:
 * the route answers `503 DELIVERY_MARKETPLACE_UNAVAILABLE` (ADR-026 §4.9-2).
 * This composition root is therefore PARTIAL by declaration — reads and
 * cancellation are complete, placement is refused — the same honesty as the
 * unwired ORD-/WS- dispatch bridge (RISK-0034).
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

import { buildDeliveryHttpApp } from "./app.js";
import { StoreOrderStore } from "../infrastructure/store-order-store.js";
import { PostgresReadinessProbe } from "../infrastructure/readiness-probe.js";

const DATABASE_URL = process.env.DATABASE_URL;
const PORT = Number(process.env.PORT ?? 8097);

async function main(): Promise<void> {
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const store = new StoreOrderStore(pool);
  const { fastify, close } = buildDeliveryHttpApp({
    readPort: store,
    writePort: store,
    // A REAL probe over the same pool the routes use: probing a second pool
    // would report the health of a connection nobody serves traffic with
    // (review 7/N · §4.10-2).
    readinessPort: new PostgresReadinessProbe(pool),
    // catalogPort: intentionally absent — see the file header.
  });

  try {
    await fastify.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`delivery service listening on :${PORT}`);
  } catch (err) {
    console.error("delivery service failed to start", err);
    await close();
    await pool.end();
    process.exit(1);
  }
}

await main();
