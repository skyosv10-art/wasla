/**
 * M6-18B · DR scenario 2 — "Database unavailable" (docs/12-testing/M6-18B_DRILL.md §3).
 *
 * Non-production harness. It never touches the production database or Render:
 *   - the billing service (services/billing/src/http/server.ts, unchanged) runs as a
 *     child process on this machine;
 *   - its BILLING_DATABASE_URL points at a local TCP fault proxy, and the proxy points at
 *     a local throwaway Postgres (DR_UPSTREAM_PORT);
 *   - the proxy injects two failure modes:
 *       refuse    — the listener is closed and open sockets are destroyed (DB down, RST);
 *       blackhole — connections are accepted and never forwarded (network partition).
 *
 * The harness measures what the service actually does: status and latency per request,
 * whether calls are rejected immediately after 5 failures (circuit breaker OPEN per
 * M6-18A defaults), what /billing/health reports during the outage, and the recovery
 * time after the DB returns. It asserts nothing about the expected outcome; it prints
 * a JSON record that is copied into the evidence README.
 *
 * Run: DR_UPSTREAM_PORT=55432 ./services/audit/node_modules/.bin/tsx scripts/ops/m6-18b-dr/scenario2-db-unavailable.mts
 * Keys are generated per run in memory and never written anywhere.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import net from "node:net";

import { keyRegistryFromEnv, mintServiceToken, SERVICE_AUTH_HEADER } from "../../../packages/service-auth/src/index.ts";

const UPSTREAM_PORT = Number(process.env.DR_UPSTREAM_PORT ?? "55432");
const PROXY_PORT = Number(process.env.DR_PROXY_PORT ?? "55433");
const SERVICE_PORT = Number(process.env.DR_SERVICE_PORT ?? "18091");
const CLIENT_TIMEOUT_MS = Number(process.env.DR_CLIENT_TIMEOUT_MS ?? "15000");

type Mode = "pass" | "refuse" | "blackhole";

class FaultProxy {
  private server: net.Server | null = null;
  private sockets = new Set<net.Socket>();
  mode: Mode = "pass";

  async listen(): Promise<void> {
    this.server = net.createServer((client) => {
      this.sockets.add(client);
      client.on("close", () => this.sockets.delete(client));
      client.on("error", () => undefined);
      if (this.mode === "blackhole") return; // accepted, never forwarded
      const upstream = net.connect(UPSTREAM_PORT, "127.0.0.1");
      this.sockets.add(upstream);
      upstream.on("close", () => this.sockets.delete(upstream));
      upstream.on("error", () => client.destroy());
      client.on("close", () => upstream.destroy());
      upstream.on("close", () => client.destroy());
      client.pipe(upstream);
      upstream.pipe(client);
    });
    await new Promise<void>((resolve) => this.server!.listen(PROXY_PORT, "127.0.0.1", resolve));
  }

  async close(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  async set(mode: Mode): Promise<void> {
    if (mode === "refuse") {
      await this.close();
    } else {
      for (const s of this.sockets) s.destroy();
      this.sockets.clear();
      if (!this.server) await this.listen();
    }
    this.mode = mode;
  }
}

const secret = randomBytes(32).toString("hex");
const env = {
  WASLA_SERVICE_AUTH_KEYS: `dr1:active:${secret}`,
  WASLA_SERVICE_AUTH_ACTIVE_KID: "dr1",
};
const keys = keyRegistryFromEnv(env);

interface Sample {
  phase: string;
  n: number;
  status: number | "client-timeout" | "network-error";
  ms: number;
  code?: string;
}

async function call(path: string, phase: string, n: number, auth: boolean): Promise<Sample> {
  const headers: Record<string, string> = {};
  if (auth) {
    headers[SERVICE_AUTH_HEADER] = mintServiceToken({
      serviceName: "orders",
      audience: "billing",
      scopes: ["billing:invoice:read"],
      method: "GET",
      path,
      keys,
      now: new Date(),
    });
  }
  const t0 = performance.now();
  try {
    const res = await fetch(`http://127.0.0.1:${SERVICE_PORT}${path}`, {
      headers,
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
    const body = await res.text();
    let code: string | undefined;
    try {
      const parsed = JSON.parse(body) as { error?: { code?: string }; code?: string; status?: string };
      code = parsed.error?.code ?? parsed.code ?? parsed.status;
    } catch {
      code = undefined;
    }
    return { phase, n, status: res.status, ms: Math.round(performance.now() - t0), code };
  } catch (err) {
    const name = (err as Error).name;
    return {
      phase,
      n,
      status: name === "TimeoutError" ? "client-timeout" : "network-error",
      ms: Math.round(performance.now() - t0),
    };
  }
}

const invoicePath = () => `/billing/invoices/${randomUUID()}`;

async function waitForService(child: ChildProcess): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(`billing exited with ${child.exitCode}`);
    try {
      const res = await fetch(`http://127.0.0.1:${SERVICE_PORT}/billing/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("billing did not start");
}

interface Billing {
  child: ChildProcess;
  stderr: () => string;
  exit: Promise<{ code: number | null; signal: string | null; atMs: number }>;
}

async function startBilling(): Promise<Billing> {
  const child = spawn(
    "./services/audit/node_modules/.bin/tsx",
    ["services/billing/src/http/server.ts"],
    {
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "development",
        PORT: String(SERVICE_PORT),
        BILLING_DATABASE_URL: `postgres://postgres@127.0.0.1:${PROXY_PORT}/billing`,
        WASLA_SERVICE_TOKEN_REPLAY_MODE: "memory",
        ...env,
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
  const exit = new Promise<{ code: number | null; signal: string | null; atMs: number }>((resolve) =>
    child.on("exit", (code, signal) => resolve({ code, signal, atMs: performance.now() })),
  );
  await waitForService(child);
  return { child, stderr: () => stderr, exit };
}

async function stopBilling(b: Billing): Promise<void> {
  if (b.child.exitCode === null && b.child.signalCode === null) b.child.kill("SIGTERM");
  await Promise.race([b.exit, new Promise((r) => setTimeout(r, 5000))]);
}

function firstErrorLines(stderr: string): string[] {
  return stderr
    .split("\n")
    .filter((l) => /Error|throw|Emitted|idleListener/.test(l))
    .slice(0, 6)
    .map((l) => l.trim().slice(0, 200));
}

async function recover(phase: string): Promise<{ recoveredMs: number | null; samples: Sample[] }> {
  const samples: Sample[] = [];
  const t0 = performance.now();
  for (let i = 1; i <= 60; i++) {
    const s = await call(invoicePath(), phase, i, true);
    samples.push(s);
    if (s.status === 404) return { recoveredMs: Math.round(performance.now() - t0), samples };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { recoveredMs: null, samples };
}

async function main(): Promise<void> {
  const proxy = new FaultProxy();
  await proxy.listen();
  const experiments: Record<string, unknown> = {};

  // E1 — warm drop: the pool holds idle connections, then the DB goes away.
  {
    await proxy.set("pass");
    const b = await startBilling();
    const baseline: Sample[] = [];
    for (let i = 1; i <= 3; i++) baseline.push(await call(invoicePath(), "E1-baseline", i, true));
    const dropAt = performance.now();
    await proxy.set("refuse");
    const exited = await Promise.race([
      b.exit,
      new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
    ]);
    const after = await call(invoicePath(), "E1-after-drop", 1, true);
    experiments.E1_warm_drop = {
      baseline,
      process_exited: exited !== null,
      exit_code: exited?.code ?? null,
      exit_after_drop_ms: exited ? Math.round(exited.atMs - dropAt) : null,
      request_after_drop: after,
      crash_signature: firstErrorLines(b.stderr()),
    };
    await stopBilling(b);
  }

  // E2 — cold refuse: no idle connections; the DB is down before the first query.
  {
    await proxy.set("pass");
    const b = await startBilling();
    await proxy.set("refuse");
    const refuse: Sample[] = [];
    for (let i = 1; i <= 10; i++) refuse.push(await call(invoicePath(), "E2-refuse", i, true));
    const health = await call("/billing/health", "E2-health-during-outage", 1, false);
    await proxy.set("pass");
    const rec = await recover("E2-recovery");
    experiments.E2_cold_refuse = {
      refuse,
      first_five_ms: refuse.slice(0, 5).map((s) => s.ms),
      after_five_ms: refuse.slice(5).map((s) => s.ms),
      statuses: [...new Set(refuse.map((s) => `${s.status} ${s.code ?? ""}`.trim()))],
      health_during_outage: health,
      recovery_ms_after_db_restored: rec.recoveredMs,
      recovery_attempts: rec.samples.length,
      process_alive_at_end: b.child.exitCode === null,
    };
    await stopBilling(b);
  }

  // E3 — cold blackhole: a network partition; connections are accepted and never answered.
  {
    await proxy.set("pass");
    const b = await startBilling();
    await proxy.set("blackhole");
    const hole: Sample[] = [];
    for (let i = 1; i <= 3; i++) hole.push(await call(invoicePath(), "E3-blackhole", i, true));
    const health = await call("/billing/health", "E3-health-during-partition", 1, false);
    await proxy.set("pass");
    const rec = await recover("E3-recovery");
    experiments.E3_cold_blackhole = {
      blackhole: hole,
      statuses: [...new Set(hole.map((s) => String(s.status)))],
      health_during_partition: health,
      recovery_ms_after_db_restored: rec.recoveredMs,
      recovery_attempts: rec.samples.length,
      process_alive_at_end: b.child.exitCode === null,
    };
    await stopBilling(b);
  }

  await proxy.close();
  const record = {
    scenario: "M6-18B scenario 2 — database unavailable",
    service: "billing (services/billing/src/http/server.ts, unchanged, local child process)",
    database: "local throwaway Postgres behind a TCP fault proxy (non-production)",
    client_timeout_ms: CLIENT_TIMEOUT_MS,
    experiments,
  };
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
}

await main();
