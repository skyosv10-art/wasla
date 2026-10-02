/**
 * RISK-0058 · ADR-059 — negative tests on the real composition: billing's own `createBillingDb`
 * (a real `pg.Pool`, guarded) behind the real HTTP app, against a database that is NOT there.
 *
 *   refuse    — nothing listens on the port (database down);
 *   blackhole — a TCP server accepts and never answers (network partition / stalled server).
 *
 * What DR scenario 2 (CLM-0436) measured before the fix: 503 every time with no breaker, calls
 * hanging until the client gave up, and `/billing/health` saying `ok`. Recovery against a real
 * database is asserted by the scenario-2 harness (scripts/ops/m6-18b-dr/), which fails closed.
 */
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatabaseHealth, pgGuardOf } from "@wasla/resilience";

import { createBillingApp } from "../http/app.js";
import { createBillingDb } from "../infrastructure/drizzle/db.js";
import { PostgresInvoiceStore } from "../infrastructure/drizzle/repository.js";
import { PostgresOutboxPublisher } from "../infrastructure/pg/outbox-publisher.js";
import { PostgresSettlement } from "../infrastructure/pg/settlement-store.js";
import { InMemoryPaymentGateway } from "../ports.js";

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

function build(connectionString: string) {
  const { pool, db } = createBillingDb({ connectionString });
  const app = createBillingApp({
    store: new PostgresInvoiceStore(db),
    settlements: new PostgresSettlement(pool),
    paymentGateway: new InMemoryPaymentGateway(),
    publisher: new PostgresOutboxPublisher(pool),
  });
  attachDatabaseHealth(app, { paths: ["/billing/health"], pools: [pool], service: "billing" });
  return { app, pool };
}

const INVOICE = "/billing/invoices/00000000-0000-4000-8000-000000000001";

describe("billing — database refused (down)", () => {
  it("fails 5 times, then the breaker rejects fast without touching the database; health is 503", async () => {
    const port = await freePort();
    const { app, pool } = build(`postgres://u:p@127.0.0.1:${port}/billing`);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: "GET", url: INVOICE });
      statuses.push(res.statusCode);
    }
    expect(statuses).toEqual([503, 503, 503, 503, 503]);
    const guard = pgGuardOf(pool)!;
    expect(guard.breaker.state).toBe("open");

    const t0 = performance.now();
    const fast = await app.inject({ method: "GET", url: INVOICE });
    const fastMs = performance.now() - t0;
    expect(fast.statusCode).toBe(503);
    expect(guard.stats.rejectedOpen).toBeGreaterThanOrEqual(1);
    expect(fastMs).toBeLessThan(250);

    const health = await app.inject({ method: "GET", url: "/billing/health" });
    expect(health.statusCode).toBe(503);
    expect(health.headers["x-wasla-database"]).toBe("down");
    expect(JSON.parse(health.body)).toMatchObject({
      status: "unavailable",
      database: [{ pool: "billing", state: "down", reason: "ECONNREFUSED" }],
    });
    await app.close();
    await pool.end();
  });
});

describe("billing — database accepts and never answers (partition)", () => {
  let hole: net.Server;
  let holePort = 0;
  const sockets = new Set<net.Socket>();
  const saved = process.env.WASLA_PG_CONNECT_TIMEOUT_MS;

  beforeAll(async () => {
    hole = net.createServer((s) => {
      sockets.add(s);
      s.on("error", () => undefined);
    });
    await new Promise<void>((r) => hole.listen(0, "127.0.0.1", r));
    holePort = (hole.address() as net.AddressInfo).port;
    process.env.WASLA_PG_CONNECT_TIMEOUT_MS = "400";
  });
  afterAll(async () => {
    if (saved === undefined) delete process.env.WASLA_PG_CONNECT_TIMEOUT_MS;
    else process.env.WASLA_PG_CONNECT_TIMEOUT_MS = saved;
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => hole.close(() => r()));
  });

  it("a call is bounded by the connect timeout instead of hanging, and health answers 503 within its probe bound", async () => {
    const { app, pool } = build(`postgres://u:p@127.0.0.1:${holePort}/billing`);
    const t0 = performance.now();
    const res = await app.inject({ method: "GET", url: INVOICE });
    const ms = performance.now() - t0;
    expect(res.statusCode).toBe(503);
    expect(ms).toBeLessThan(3_000);

    const h0 = performance.now();
    const health = await app.inject({ method: "GET", url: "/billing/health" });
    const healthMs = performance.now() - h0;
    expect(health.statusCode).toBe(503);
    expect(healthMs).toBeLessThan(3_000);
    const body = JSON.parse(health.body) as { database: Array<{ state: string; reason: string }> };
    expect(body.database[0]?.state).toBe("down");
    expect(["probe_timeout", "connect_timeout"]).toContain(body.database[0]?.reason);
    await app.close();
    await pool.end().catch(() => undefined);
  }, 15_000);
});
