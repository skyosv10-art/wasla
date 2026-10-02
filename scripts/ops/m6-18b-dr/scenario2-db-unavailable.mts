/**
 * M6-18B · DR scenario 2 — "Database unavailable" (docs/12-testing/M6-18B_DRILL.md §3).
 *
 * Non-production harness. It never touches the production database or Render:
 *   - the billing service (services/billing/src/http/server.ts, run as shipped) runs as a
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
 * time after the DB returns. In its first run (CLM-0436) it asserted nothing about the expected
 * outcome; since CLM-0438 it also prints a verdict and fails closed (see below).
 *
 * Re-run after the RISK-0058 fix (CLM-0438 · ADR-059): the same experiments, now with a
 * VERDICT. The first run (CLM-0436) only measured; this one also states the pass criteria of
 * M6-18B_DRILL.md §3 + ADR-059 and exits 1 if any is not met (fail closed). It adds:
 *   - health-driven recovery (what Render's health checks do) next to cooldown-only recovery;
 *   - E4 "fleet": every service with a database, started from its own server.ts, through the
 *     same proxy — alive during the outage, health 503 while down, 200 after, recovery timed.
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
  for (let i = 1; i <= 90; i++) {
    const s = await call(invoicePath(), phase, i, true);
    samples.push(s);
    if (s.status === 404) return { recoveredMs: Math.round(performance.now() - t0), samples };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { recoveredMs: null, samples };
}

/** What a platform health check does: poll health until 200, then confirm with a DB-backed call. */
async function recoverViaHealth(phase: string): Promise<{
  healthOkMs: number | null;
  firstDbAnswerMs: number | null;
  polls: number;
}> {
  const t0 = performance.now();
  let healthOkMs: number | null = null;
  let polls = 0;
  for (let i = 1; i <= 120; i++) {
    polls = i;
    const h = await call("/billing/health", phase, i, false);
    if (h.status === 200) {
      healthOkMs = Math.round(performance.now() - t0);
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (healthOkMs === null) return { healthOkMs, firstDbAnswerMs: null, polls };
  const c = await call(invoicePath(), `${phase}-confirm`, 1, true);
  return { healthOkMs, firstDbAnswerMs: c.status === 404 ? Math.round(performance.now() - t0) : null, polls };
}

// ── E4 fleet: every service that owns a pool, from its own composition root ──────────────
/**
 * `excluded` is a measured, recorded reason — never a way to make the fleet pass: partners does
 * not boot at all under enforced service identity (its routes carry no `serviceIdentity`
 * classification; the plugin refuses the first one), with or without a database. That is
 * RISK-0059, an auth change that belongs in its own PR (RISK-0042 rule), not here.
 */
const FLEET: ReadonlyArray<{ service: string; health: string; dbEnv: string; excluded?: string }> = [
  { service: "audit", health: "/health", dbEnv: "DATABASE_URL" },
  { service: "billing", health: "/billing/health", dbEnv: "BILLING_DATABASE_URL" },
  { service: "customers", health: "/health", dbEnv: "DATABASE_URL" },
  { service: "delivery", health: "/delivery/health", dbEnv: "DATABASE_URL" },
  { service: "dispatch", health: "/health", dbEnv: "DATABASE_URL" },
  { service: "drivers", health: "/health", dbEnv: "DATABASE_URL" },
  { service: "geography", health: "/health", dbEnv: "DATABASE_URL" },
  { service: "identity", health: "/health", dbEnv: "DATABASE_URL" },
  { service: "marketplace", health: "/health", dbEnv: "DATABASE_URL" },
  { service: "matching", health: "/health", dbEnv: "DATABASE_URL" },
  { service: "negotiations", health: "/health", dbEnv: "DATABASE_URL" },
  { service: "orders", health: "/health", dbEnv: "DATABASE_URL" },
  {
    service: "partners",
    health: "/partners/health",
    dbEnv: "PARTNERS_DATABASE_URL",
    excluded: "RISK-0059: does not boot under enforced service identity (GET /partners/health has no serviceIdentity classification)",
  },
  { service: "reputation", health: "/health", dbEnv: "DATABASE_URL" },
  { service: "search", health: "/search/health", dbEnv: "DATABASE_URL" },
  { service: "subscriptions", health: "/health", dbEnv: "DATABASE_URL" },
  { service: "support", health: "/health", dbEnv: "DATABASE_URL" },
];
const FLEET_BASE_PORT = Number(process.env.DR_FLEET_BASE_PORT ?? "18200");

interface FleetMember {
  service: string;
  port: number;
  health: string;
  child: ChildProcess;
  stderr: () => string;
  exited: () => boolean;
}

async function healthStatus(port: number, path: string, timeoutMs = 5_000): Promise<{ status: number | string; ms: number }> {
  const t0 = performance.now();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    await res.text();
    return { status: res.status, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return { status: (err as Error).name === "TimeoutError" ? "client-timeout" : "network-error", ms: Math.round(performance.now() - t0) };
  }
}

async function startFleet(): Promise<{
  members: FleetMember[];
  notStarted: Array<{ service: string; reason: string }>;
  excluded: Array<{ service: string; reason: string }>;
}> {
  const members: FleetMember[] = [];
  const notStarted: Array<{ service: string; reason: string }> = [];
  const excluded = FLEET.filter((m) => m.excluded !== undefined).map((m) => ({ service: m.service, reason: m.excluded! }));
  FLEET.forEach((m, i) => {
    if (m.excluded !== undefined) return;
    const port = FLEET_BASE_PORT + i;
    const child = spawn("./services/audit/node_modules/.bin/tsx", [`services/${m.service}/src/http/server.ts`], {
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "development",
        PORT: String(port),
        [m.dbEnv]: `postgres://postgres@127.0.0.1:${PROXY_PORT}/billing`,
        WASLA_SERVICE_TOKEN_REPLAY_MODE: "memory",
        OTEL_SDK_DISABLED: "true",
        ...env,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let exited = false;
    child.stderr?.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
    child.on("exit", () => (exited = true));
    members.push({ service: m.service, port, health: m.health, child, stderr: () => stderr, exited: () => exited });
  });
  const deadline = performance.now() + 90_000;
  const pending = new Set(members);
  while (pending.size > 0 && performance.now() < deadline) {
    for (const m of [...pending]) {
      if (m.exited()) {
        pending.delete(m);
        continue;
      }
      const h = await healthStatus(m.port, m.health, 1_000);
      if (h.status === 200) pending.delete(m);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  for (const m of members) {
    if (m.exited() || pending.has(m)) {
      notStarted.push({ service: m.service, reason: m.exited() ? `exited: ${firstErrorLines(m.stderr()).join(" | ").slice(0, 300)}` : "health not 200 within 90 s" });
    }
  }
  return { members: members.filter((m) => !m.exited() && !pending.has(m)), notStarted, excluded };
}

async function main(): Promise<void> {
  const proxy = new FaultProxy();
  await proxy.listen();
  const experiments: Record<string, unknown> = {};
  const checks: Array<{ id: string; pass: boolean; detail: string }> = [];
  const check = (id: string, pass: boolean, detail: string) => checks.push({ id, pass, detail });

  // E1 — warm drop: the pool holds idle connections, then the DB goes away.
  {
    await proxy.set("pass");
    const b = await startBilling();
    const baseline: Sample[] = [];
    for (let i = 1; i <= 3; i++) baseline.push(await call(invoicePath(), "E1-baseline", i, true));
    const dropAt = performance.now();
    await proxy.set("refuse");
    const exited = await Promise.race([b.exit, new Promise<null>((r) => setTimeout(() => r(null), 5_000))]);
    const during: Sample[] = [];
    for (let i = 1; i <= 8; i++) during.push(await call(invoicePath(), "E1-during", i, true));
    const health = await call("/billing/health", "E1-health-during-outage", 1, false);
    const restoreAt = performance.now();
    await proxy.set("pass");
    const rec = await recoverViaHealth("E1-recovery");
    experiments.E1_warm_drop = {
      baseline,
      process_exited: exited !== null,
      exit_code: exited?.code ?? null,
      exit_after_drop_ms: exited ? Math.round(exited.atMs - dropAt) : null,
      during_outage: during,
      during_statuses: [...new Set(during.map((s) => `${s.status} ${s.code ?? ""}`.trim()))],
      during_max_ms: Math.max(...during.map((s) => s.ms)),
      health_during_outage: health,
      outage_ms: Math.round(restoreAt - dropAt),
      recovery_after_db_restored: rec,
      crash_signature: firstErrorLines(b.stderr()),
    };
    check("E1.alive", exited === null && b.child.exitCode === null, `process alive after the drop (exited=${exited !== null})`);
    check("E1.no-hang", during.every((s) => typeof s.status === "number"), `every call during the outage answered (max ${Math.max(...during.map((s) => s.ms))} ms)`);
    check("E1.503", during.every((s) => s.status === 503), `statuses during the outage: ${[...new Set(during.map((s) => s.status))].join(",")}`);
    check("E1.health-503", health.status === 503, `health during the outage: ${health.status}`);
    check("E1.recovers", rec.firstDbAnswerMs !== null, `health 200 after ${rec.healthOkMs} ms, first DB answer after ${rec.firstDbAnswerMs} ms`);
    await stopBilling(b);
  }

  // E2 — cold refuse: the DB is down before the first query. Breaker trips after 5.
  {
    await proxy.set("pass");
    const b = await startBilling();
    await proxy.set("refuse");
    const refuse: Sample[] = [];
    for (let i = 1; i <= 10; i++) refuse.push(await call(invoicePath(), "E2-refuse", i, true));
    const health = await call("/billing/health", "E2-health-during-outage", 1, false);
    const restoreAt = performance.now();
    await proxy.set("pass");
    // No health polling here: recovery has to come from the breaker's own half-open trial.
    const rec = await recover("E2-recovery-cooldown-only");
    const afterFive = refuse.slice(5).map((s) => s.ms);
    experiments.E2_cold_refuse = {
      refuse,
      first_five_ms: refuse.slice(0, 5).map((s) => s.ms),
      after_five_ms: afterFive,
      statuses: [...new Set(refuse.map((s) => `${s.status} ${s.code ?? ""}`.trim()))],
      health_during_outage: health,
      recovery_ms_after_db_restored_cooldown_only: rec.recoveredMs,
      recovery_attempts: rec.samples.length,
      restore_at_ms: Math.round(restoreAt),
      process_alive_at_end: b.child.exitCode === null,
    };
    check("E2.503", refuse.every((s) => s.status === 503), `statuses: ${[...new Set(refuse.map((s) => s.status))].join(",")}`);
    check("E2.breaker-fast", afterFive.every((ms) => ms < 100), `calls 6-10 rejected in ${afterFive.join("/")} ms (< 100 ms each = rejected without the DB)`);
    check("E2.health-503", health.status === 503, `health during the outage: ${health.status}`);
    check("E2.half-open-recovers", rec.recoveredMs !== null && rec.recoveredMs <= 35_000, `cooldown-only recovery after ${rec.recoveredMs} ms (cooldown 30 s)`);
    check("E2.alive", b.child.exitCode === null, "process alive");
    await stopBilling(b);
  }

  // E3 — cold blackhole: a network partition; connections are accepted and never answered.
  {
    await proxy.set("pass");
    const b = await startBilling();
    await proxy.set("blackhole");
    const hole: Sample[] = [];
    for (let i = 1; i <= 7; i++) hole.push(await call(invoicePath(), "E3-blackhole", i, true));
    const health = await call("/billing/health", "E3-health-during-partition", 1, false);
    await proxy.set("pass");
    const rec = await recoverViaHealth("E3-recovery");
    experiments.E3_cold_blackhole = {
      blackhole: hole,
      statuses: [...new Set(hole.map((s) => String(s.status)))],
      ms: hole.map((s) => s.ms),
      health_during_partition: health,
      recovery_after_db_restored: rec,
      process_alive_at_end: b.child.exitCode === null,
    };
    check("E3.bounded", hole.every((s) => typeof s.status === "number" && s.ms < 7_000), `every call answered within 7 s (connect timeout 5 s): ${hole.map((s) => s.ms).join("/")} ms`);
    check("E3.breaker-fast", hole.slice(5).every((s) => s.status === 503 && s.ms < 100), `calls 6-7: ${hole.slice(5).map((s) => `${s.status}/${s.ms}ms`).join(" ")}`);
    check("E3.health-503", health.status === 503 && health.ms < 3_000, `health during the partition: ${health.status} in ${health.ms} ms`);
    check("E3.recovers", rec.firstDbAnswerMs !== null, `health 200 after ${rec.healthOkMs} ms, first DB answer after ${rec.firstDbAnswerMs} ms`);
    check("E3.alive", b.child.exitCode === null, "process alive");
    await stopBilling(b);
  }

  // E4 — fleet: every service with a pool, through the same proxy.
  {
    await proxy.set("pass");
    const { members, notStarted, excluded } = await startFleet();
    const warm: Record<string, unknown> = {};
    for (const m of members) warm[m.service] = await healthStatus(m.port, m.health);
    const dropAt = performance.now();
    await proxy.set("refuse");
    await new Promise((r) => setTimeout(r, 3_000));
    const during: Record<string, { status: number | string; ms: number; alive: boolean }> = {};
    await Promise.all(
      members.map(async (m) => {
        const h = await healthStatus(m.port, m.health);
        during[m.service] = { ...h, alive: !m.exited() };
      }),
    );
    const restoreAt = performance.now();
    await proxy.set("pass");
    const recovery: Record<string, number | null> = {};
    await Promise.all(
      members.map(async (m) => {
        const t0 = performance.now();
        for (let i = 0; i < 120; i++) {
          if (m.exited()) break;
          const h = await healthStatus(m.port, m.health, 2_000);
          if (h.status === 200) {
            recovery[m.service] = Math.round(performance.now() - t0);
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        recovery[m.service] = null;
      }),
    );
    const aliveAtEnd = Object.fromEntries(members.map((m) => [m.service, !m.exited()]));
    for (const m of members) if (!m.exited()) m.child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 1_500));
    experiments.E4_fleet = {
      started: members.map((m) => m.service),
      not_started: notStarted,
      excluded,
      health_before: warm,
      outage_ms: Math.round(restoreAt - dropAt),
      health_during_outage: during,
      health_recovery_ms_after_db_restored: recovery,
      alive_at_end: aliveAtEnd,
    };
    const expected = FLEET.length - excluded.length;
    check(
      "E4.started",
      notStarted.length === 0 && members.length === expected,
      `${members.length}/${expected} services started (excluded with a recorded reason: ${excluded.map((e) => e.service).join(",") || "none"})${notStarted.length ? `; not started: ${notStarted.map((n) => n.service).join(",")}` : ""}`,
    );
    const crashed = Object.entries(during).filter(([, v]) => !v.alive).map(([k]) => k);
    check("E4.alive", crashed.length === 0 && Object.values(aliveAtEnd).every(Boolean), `crashed during the outage: ${crashed.join(",") || "none"}`);
    const not503 = Object.entries(during).filter(([, v]) => v.status !== 503).map(([k, v]) => `${k}=${v.status}`);
    check("E4.health-503", not503.length === 0, `health not 503 during the outage: ${not503.join(",") || "none"}`);
    const notRecovered = Object.entries(recovery).filter(([, v]) => v === null).map(([k]) => k);
    check("E4.recovers", notRecovered.length === 0, `not recovered: ${notRecovered.join(",") || "none"}; max ${Math.max(...Object.values(recovery).map((v) => v ?? -1))} ms`);
  }

  await proxy.close();
  const failed = checks.filter((c) => !c.pass);
  const record = {
    scenario: "M6-18B scenario 2 — database unavailable (re-run after RISK-0058 fix, CLM-0438)",
    service: "billing (E1-E3) and every service with a pool (E4), each from its own server.ts, local child processes",
    database: "local throwaway Postgres behind a TCP fault proxy (non-production)",
    client_timeout_ms: CLIENT_TIMEOUT_MS,
    experiments,
    verdict: { pass: failed.length === 0, checks },
  };
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  if (failed.length > 0) {
    process.stderr.write(`scenario 2 FAILED: ${failed.map((c) => `${c.id} (${c.detail})`).join("; ")}\n`);
    process.exitCode = 1;
  }
}

await main();
