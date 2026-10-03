/**
 * pg-guard — negative tests for RISK-0058 (ADR-059).
 *
 * A fake pool reproduces the three failure modes DR scenario 2 measured, with the same
 * event shapes `pg-pool` uses: connection loss (ECONNREFUSED / pool 'error' / client
 * 'error'), connection delay (a query that never answers, and pg's own timeout errors),
 * and recovery. The real-database version of the same assertions is the scenario-2
 * harness (scripts/ops/m6-18b-dr/scenario2-db-unavailable.mts), which fails closed.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import {
  attachDatabaseHealth,
  connectivityReason,
  DbUnavailableError,
  guardPgPool,
  installedPgGuards,
  isDbUnavailableError,
  pgGuardOf,
  PG_GUARD_DEFAULTS,
  withPgPoolDefaults,
  type HealthHookApp,
  type HealthHookReply,
} from "../pg-guard.js";

type Mode = "up" | "refuse" | "hang" | "sql-error" | "query-timeout";

class FakeClient extends EventEmitter {}

class FakePool extends EventEmitter {
  mode: Mode = "up";
  calls = 0;
  async query(text: string): Promise<{ rows: unknown[] }> {
    this.calls += 1;
    if (this.mode === "refuse") throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    if (this.mode === "hang") return new Promise(() => undefined);
    if (this.mode === "query-timeout") throw new Error("Query read timeout");
    if (this.mode === "sql-error") throw Object.assign(new Error("duplicate key"), { code: "23505" });
    return { rows: [{ text }] };
  }
  async connect(): Promise<FakeClient> {
    this.calls += 1;
    if (this.mode === "refuse") throw new Error("timeout exceeded when trying to connect");
    const client = new FakeClient();
    this.emit("connect", client);
    return client;
  }
}

function clock(start = 1_000_000) {
  const now = { value: start };
  return { now, fn: () => now.value };
}

function quiet(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line) => lines.push(line) };
}

describe("withPgPoolDefaults — bounded connect and query time", () => {
  it("adds connect/query bounds and keep-alive without overriding the caller", () => {
    const c = withPgPoolDefaults({ connectionString: "postgres://x", max: 3 }, {});
    expect(c.connectionTimeoutMillis).toBe(PG_GUARD_DEFAULTS.connectionTimeoutMillis);
    expect(c.query_timeout).toBe(PG_GUARD_DEFAULTS.queryTimeoutMillis);
    expect(c.keepAlive).toBe(true);
    expect(c.max).toBe(3);
    const own = withPgPoolDefaults({ connectionTimeoutMillis: 100, query_timeout: 200 }, {});
    expect([own.connectionTimeoutMillis, own.query_timeout]).toEqual([100, 200]);
  });

  it("reads per-process overrides and refuses a malformed one (no silent unbounded value)", () => {
    const c = withPgPoolDefaults({}, { WASLA_PG_CONNECT_TIMEOUT_MS: "750", WASLA_PG_QUERY_TIMEOUT_MS: "900" });
    expect([c.connectionTimeoutMillis, c.query_timeout]).toEqual([750, 900]);
    expect(() => withPgPoolDefaults({}, { WASLA_PG_CONNECT_TIMEOUT_MS: "0" })).toThrow(/positive integer/);
    expect(() => withPgPoolDefaults({}, { WASLA_PG_QUERY_TIMEOUT_MS: "soon" })).toThrow(/positive integer/);
  });
});

describe("withPgPoolDefaults — TLS / SSL (RISK-0060)", () => {
  it("leaves ssl unset when WASLA_PG_SSL_MODE is absent (local dev backward compatible)", () => {
    const c = withPgPoolDefaults({ connectionString: "postgres://x" }, {});
    expect(c.ssl).toBeUndefined();
  });

  it("leaves ssl unset when WASLA_PG_SSL_MODE=off", () => {
    const c = withPgPoolDefaults({ connectionString: "postgres://x" }, { WASLA_PG_SSL_MODE: "off" });
    expect(c.ssl).toBeUndefined();
  });

  it("sets ssl with rejectUnauthorized=false for WASLA_PG_SSL_MODE=require (TLS without cert pinning)", () => {
    const c = withPgPoolDefaults({ connectionString: "postgres://x" }, { WASLA_PG_SSL_MODE: "require" });
    expect(c.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("sets ssl with ca and rejectUnauthorized=true for WASLA_PG_SSL_MODE=verify-full", () => {
    const ca = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";
    const c = withPgPoolDefaults({ connectionString: "postgres://x" }, {
      WASLA_PG_SSL_MODE: "verify-full",
      WASLA_PG_SSL_CA: ca,
    });
    expect(c.ssl).toEqual({ ca, rejectUnauthorized: true });
  });

  it("trims the CA PEM body (no whitespace injection)", () => {
    const ca = "  -----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----  ";
    const c = withPgPoolDefaults({}, { WASLA_PG_SSL_MODE: "verify-full", WASLA_PG_SSL_CA: ca });
    expect(c.ssl?.ca).toBe(ca.trim());
  });

  it("refuses verify-full without a CA (no silent plaintext fallback)", () => {
    expect(() => withPgPoolDefaults({}, { WASLA_PG_SSL_MODE: "verify-full" })).toThrow(/WASLA_PG_SSL_CA/);
    expect(() => withPgPoolDefaults({}, { WASLA_PG_SSL_MODE: "verify-full", WASLA_PG_SSL_CA: "   " })).toThrow(/WASLA_PG_SSL_CA/);
  });

  it("refuses an invalid WASLA_PG_SSL_MODE value", () => {
    expect(() => withPgPoolDefaults({}, { WASLA_PG_SSL_MODE: "yes" })).toThrow(/off.*require.*verify-full/);
    expect(() => withPgPoolDefaults({}, { WASLA_PG_SSL_MODE: "ssl" })).toThrow(/off.*require.*verify-full/);
  });

  it("env-derived ssl takes precedence over a caller-provided ssl (env is the single source of truth)", () => {
    const callerSsl = { ca: "caller-ca", rejectUnauthorized: true };
    const c = withPgPoolDefaults({ ssl: callerSsl }, { WASLA_PG_SSL_MODE: "require" });
    expect(c.ssl).toEqual({ rejectUnauthorized: false });
  });
});

describe("connectivityReason — only 'could not reach' counts against the breaker", () => {
  it("recognises network codes, SQLSTATE class 08/57P0x and pg's timeout messages", () => {
    expect(connectivityReason({ code: "ECONNREFUSED" })).toBe("ECONNREFUSED");
    expect(connectivityReason({ code: "57P01" })).toBe("57P01");
    expect(connectivityReason(new Error("timeout exceeded when trying to connect"))).toBe("connect_timeout");
    expect(connectivityReason(new Error("Query read timeout"))).toBe("query_timeout");
    expect(connectivityReason(new Error("Connection terminated unexpectedly"))).toBe("connection_terminated");
    expect(connectivityReason({ errors: [{ code: "ECONNREFUSED" }] })).toBe("ECONNREFUSED");
  });
  it("does not treat an answer from a healthy database as unavailability", () => {
    expect(connectivityReason({ code: "23505", message: "duplicate key" })).toBeUndefined();
    expect(connectivityReason(new Error("relation does not exist"))).toBeUndefined();
  });
});

describe("guardPgPool — connection loss", () => {
  it("a pool 'error' (idle client died) does not crash the process — it is listened to and counted", () => {
    const pool = new FakePool();
    const q = quiet();
    guardPgPool(pool, { name: "t", log: q.log });
    // Without a listener EventEmitter#emit('error') throws — the E1 crash.
    expect(() => pool.emit("error", Object.assign(new Error("Connection terminated unexpectedly"), {}))).not.toThrow();
    expect(pgGuardOf(pool)?.stats.poolErrors).toBe(1);
    expect(q.lines.some((l) => l.includes("db_pool_error"))).toBe(true);
  });

  it("a checked-out client's 'error' does not crash the process either", async () => {
    const pool = new FakePool();
    guardPgPool(pool, { name: "t", log: quiet().log });
    const client = (await pool.connect()) as FakeClient;
    expect(() => client.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
    expect(pgGuardOf(pool)?.stats.clientErrors).toBe(1);
  });

  it("refused connections become DbUnavailableError; after 5 the breaker opens and calls fail fast without touching the DB", async () => {
    const pool = new FakePool();
    const c = clock();
    guardPgPool(pool, { name: "billing", clock: c.fn, log: quiet().log });
    pool.mode = "refuse";
    for (let i = 0; i < PG_GUARD_DEFAULTS.failureThreshold; i++) {
      const error = await pool.query("SELECT 1").catch((e: unknown) => e);
      expect(isDbUnavailableError(error)).toBe(true);
      expect((error as DbUnavailableError).reason).toBe("ECONNREFUSED");
    }
    expect(pgGuardOf(pool)?.breaker.state).toBe("open");
    const before = pool.calls;
    const open = await pool.query("SELECT 1").catch((e: unknown) => e);
    expect((open as DbUnavailableError).reason).toBe("circuit_open");
    expect((open as DbUnavailableError).statusCode).toBe(503);
    const tx = await pool.connect().catch((e: unknown) => e);
    expect((tx as DbUnavailableError).reason).toBe("circuit_open");
    expect(pool.calls).toBe(before); // rejected before reaching the database
    expect(pgGuardOf(pool)?.stats.rejectedOpen).toBe(2);
  });

  it("the callback form of pool.query is guarded too", async () => {
    const pool = new FakePool();
    guardPgPool(pool, { name: "t", log: quiet().log });
    pool.mode = "refuse";
    const error = await new Promise((resolve) => (pool.query as (...a: unknown[]) => unknown)("SELECT 1", (e: unknown) => resolve(e)));
    expect(isDbUnavailableError(error)).toBe(true);
  });

  it("an SQL error from a healthy database does not open the breaker", async () => {
    const pool = new FakePool();
    guardPgPool(pool, { name: "t", log: quiet().log });
    pool.mode = "sql-error";
    for (let i = 0; i < 10; i++) {
      const error = await pool.query("INSERT").catch((e: unknown) => e);
      expect((error as { code?: string }).code).toBe("23505");
    }
    expect(pgGuardOf(pool)?.breaker.state).toBe("closed");
  });
});

describe("guardPgPool — connection delay", () => {
  it("pg's own query/connect timeouts count as connectivity failures", async () => {
    const pool = new FakePool();
    guardPgPool(pool, { name: "t", log: quiet().log });
    pool.mode = "query-timeout";
    const q = await pool.query("SELECT pg_sleep(60)").catch((e: unknown) => e);
    expect((q as DbUnavailableError).reason).toBe("query_timeout");
    pool.mode = "refuse";
    const c = await pool.connect().catch((e: unknown) => e);
    expect((c as DbUnavailableError).reason).toBe("connect_timeout");
    expect(pgGuardOf(pool)?.stats.connectivityFailures).toBe(2);
  });

  it("a hanging database makes the probe answer 'down' within probeTimeoutMs, not hang", async () => {
    const pool = new FakePool();
    guardPgPool(pool, { name: "t", probeTimeoutMs: 50, probeCacheMs: 0, log: quiet().log });
    pool.mode = "hang";
    const t0 = Date.now();
    const health = await pgGuardOf(pool)!.probe();
    const elapsed = Date.now() - t0;
    expect(health.state).toBe("down");
    expect(health.reason).toBe("probe_timeout");
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe("guardPgPool — no stale 'up' after a failure", () => {
  it("a cached healthy probe is dropped by the first connectivity failure inside the cache window", async () => {
    const pool = new FakePool();
    const c = clock();
    guardPgPool(pool, { name: "t", clock: c.fn, probeCacheMs: 60_000, log: quiet().log });
    expect((await pgGuardOf(pool)!.probe()).state).toBe("up");
    pool.mode = "refuse";
    await pool.query("SELECT 1").catch(() => undefined);
    const health = await pgGuardOf(pool)!.probe();
    expect(health.state).toBe("down");
    expect(health.reason).toBe("ECONNREFUSED");
  });
});

describe("guardPgPool — recovery", () => {
  it("a successful probe after the database returns closes the breaker immediately", async () => {
    const pool = new FakePool();
    const c = clock();
    guardPgPool(pool, { name: "t", clock: c.fn, probeCacheMs: 0, log: quiet().log });
    pool.mode = "refuse";
    for (let i = 0; i < 5; i++) await pool.query("SELECT 1").catch(() => undefined);
    expect(pgGuardOf(pool)?.breaker.state).toBe("open");
    pool.mode = "up";
    const health = await pgGuardOf(pool)!.probe();
    expect(health).toMatchObject({ state: "up", breaker: "closed", reason: null });
    await expect(pool.query("SELECT 1")).resolves.toBeDefined();
  });

  it("without a probe, the breaker recovers through half-open after the cooldown", async () => {
    const pool = new FakePool();
    const c = clock();
    guardPgPool(pool, { name: "t", clock: c.fn, log: quiet().log });
    pool.mode = "refuse";
    for (let i = 0; i < 5; i++) await pool.query("SELECT 1").catch(() => undefined);
    pool.mode = "up";
    expect(((await pool.query("SELECT 1").catch((e: unknown) => e)) as DbUnavailableError).reason).toBe("circuit_open");
    c.now.value += PG_GUARD_DEFAULTS.cooldownMs;
    await expect(pool.query("SELECT 1")).resolves.toBeDefined(); // half-open trial
    expect(pgGuardOf(pool)?.breaker.state).toBe("closed");
  });

  it("a failed half-open trial re-opens the breaker", async () => {
    const pool = new FakePool();
    const c = clock();
    guardPgPool(pool, { name: "t", clock: c.fn, log: quiet().log });
    pool.mode = "refuse";
    for (let i = 0; i < 5; i++) await pool.query("SELECT 1").catch(() => undefined);
    c.now.value += PG_GUARD_DEFAULTS.cooldownMs;
    await pool.query("SELECT 1").catch(() => undefined);
    expect(pgGuardOf(pool)?.breaker.state).toBe("open");
  });
});

describe("attachDatabaseHealth — health during the outage and after recovery", () => {
  function fakeApp() {
    let hook: Parameters<HealthHookApp["addHook"]>[1] | undefined;
    const app: HealthHookApp = { addHook: (_n, h) => ((hook = h), undefined) };
    async function get(url: string) {
      const sent: { status: number; headers: Record<string, string>; body: unknown; sent: boolean } = {
        status: 200,
        headers: {},
        body: undefined,
        sent: false,
      };
      const reply: HealthHookReply = {
        code: (s) => ((sent.status = s), reply),
        header: (k, v) => ((sent.headers[k] = v), reply),
        send: (b) => ((sent.body = b), (sent.sent = true), reply),
      };
      await hook!({ url, method: "GET" }, reply);
      return sent;
    }
    return { app, get };
  }

  it("answers 503 with the real database state while it is down, and passes through once it is back", async () => {
    const pool = new FakePool();
    guardPgPool(pool, { name: "billing", probeCacheMs: 0, log: quiet().log });
    const { app, get } = fakeApp();
    attachDatabaseHealth(app, { paths: ["/billing/health"], pools: [pool], service: "billing" });

    const healthy = await get("/billing/health");
    expect(healthy.sent).toBe(false); // the service's own handler answers
    expect(healthy.headers["x-wasla-database"]).toBe("up");

    pool.mode = "refuse";
    const down = await get("/billing/health?x=1");
    expect(down.sent).toBe(true);
    expect(down.status).toBe(503);
    expect(down.headers["x-wasla-database"]).toBe("down");
    expect(down.body).toMatchObject({ status: "unavailable", service: "billing", database: [{ state: "down", reason: "ECONNREFUSED" }] });

    pool.mode = "up";
    const back = await get("/billing/health");
    expect(back.sent).toBe(false);
    expect(back.headers["x-wasla-database"]).toBe("up");
  });

  it("ignores other paths and refuses an unguarded pool (no silent 'ok')", async () => {
    const pool = new FakePool();
    guardPgPool(pool, { name: "t", log: quiet().log });
    const { app, get } = fakeApp();
    attachDatabaseHealth(app, { paths: ["/health"], pools: [pool], service: "t" });
    pool.mode = "refuse";
    const other = await get("/billing/invoices/1");
    expect(other.sent).toBe(false);
    expect(other.headers["x-wasla-database"]).toBeUndefined();
    expect(() => attachDatabaseHealth(app, { paths: ["/health"], pools: [new FakePool()], service: "t" })).toThrow(/not guarded/);
  });
});

describe("attachDatabaseHealth — default: every guarded pool in the process", () => {
  it("reports a pool created after the hook was attached (resolved per request)", async () => {
    let hook: Parameters<HealthHookApp["addHook"]>[1] | undefined;
    const app: HealthHookApp = { addHook: (_n, h) => ((hook = h), undefined) };
    attachDatabaseHealth(app, { paths: ["/health"], service: "late" });
    const late = new FakePool();
    guardPgPool(late, { name: "late-pool", probeCacheMs: 0, log: quiet().log });
    late.mode = "refuse";
    expect(installedPgGuards().some((g) => g.name === "late-pool")).toBe(true);
    const sent = { status: 200, body: undefined as unknown };
    const reply: HealthHookReply = {
      code: (s) => ((sent.status = s), reply),
      header: () => reply,
      send: (b) => ((sent.body = b), reply),
    };
    await hook!({ url: "/health", method: "GET" }, reply);
    expect(sent.status).toBe(503);
    expect((sent.body as { database: Array<{ pool: string; state: string }> }).database).toContainEqual(
      expect.objectContaining({ pool: "late-pool", state: "down" }),
    );
  });
});

describe("DbUnavailableError", () => {
  it("carries no 5-character code an SQLSTATE mapper could mistake for a constraint or retry signal", () => {
    const error = new DbUnavailableError("p", "circuit_open");
    expect(error.code).toBe("DB_UNAVAILABLE");
    expect(error.code.length).not.toBe(5);
    expect("cause" in error).toBe(false);
  });
});
