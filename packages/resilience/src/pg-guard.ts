/**
 * pg-guard — database-failure containment for `pg` pools (RISK-0058 · ADR-059).
 *
 * DR scenario 2 (CLM-0436) measured three defects on an unchanged service:
 *   1. an idle-connection drop CRASHED the process 17 ms later — `pg-pool` re-emits a
 *      client error as a pool `'error'` event, and an EventEmitter `'error'` with no
 *      listener throws;
 *   2. a network partition made calls HANG until the client gave up — no
 *      `connectionTimeoutMillis`, no `query_timeout`;
 *   3. a down database answered every call with a slow 503 and NO circuit breaker —
 *      `@wasla/resilience` (M6-18A) was imported by no service — while `/health` said `ok`.
 *
 * This module is the single fix for all three, applied to every runtime pool:
 *   - `withPgPoolDefaults(config)`  bounded connect and query time, TCP keep-alive;
 *   - `guardPgPool(pool, { name })` error listeners on the pool AND on every client
 *     (pg-pool removes its own listener while a client is checked out), a circuit
 *     breaker in front of `pool.query` and `pool.connect`, and a health probe;
 *   - `attachDatabaseHealth(app, …)` makes the service's health route answer 503 with the
 *     real database state instead of a misleading `ok`.
 *
 * Typed structurally — this package does not depend on `pg` or `fastify`, so it stays a
 * leaf; the services that own those dependencies pass their instances in.
 */

import { createCircuitBreaker, type CircuitBreaker, type CircuitBreakerOptions, type Clock } from "./circuit-breaker.js";

/** Defaults. Each can be overridden per pool by config, or per process by environment. */
export const PG_GUARD_DEFAULTS = {
  /** Upper bound to obtain a connection (TCP + TLS + startup). pg's own default is "forever". */
  connectionTimeoutMillis: 5_000,
  /** Client-side bound on one query — the only bound that survives a silent partition. */
  queryTimeoutMillis: 15_000,
  /** M6-18A defaults (docs/12-testing/M6-18B_DRILL.md §3, scenario 2). */
  failureThreshold: 5,
  cooldownMs: 30_000,
  /** Health probe: `SELECT 1` must answer within this bound… */
  probeTimeoutMs: 2_000,
  /** …and one probe result is shared by every health call inside this window. */
  probeCacheMs: 1_000,
} as const;

/** RISK-0060: TLS mode for database connections. */
export type PgSslMode = "off" | "require" | "verify-full";

/**
 * The SSL configuration that `withPgPoolDefaults` adds to every pool. `off` leaves
 * `ssl` unset so local development and tests behave exactly as before; `require`
 * encrypts the connection without verifying the server certificate; `verify-full`
 * pins the Supabase CA and refuses a connection whose certificate does not match.
 *
 * The CA is read from `WASLA_PG_SSL_CA` (the PEM body, not a file path) so the pool
 * factory never touches the filesystem. A `verify-full` request with no CA is a
 * configuration error, not a silent plaintext fallback.
 */
export interface PgSslConfig {
  readonly ssl?: { readonly ca?: string; readonly rejectUnauthorized?: boolean };
}

function readSslMode(env: Readonly<Record<string, string | undefined>>): PgSslMode {
  const raw = env["WASLA_PG_SSL_MODE"];
  if (raw === undefined || raw.trim() === "") return "off";
  const mode = raw.trim();
  if (mode === "off" || mode === "require" || mode === "verify-full") return mode;
  throw new Error(
    `WASLA_PG_SSL_MODE must be one of "off", "require", "verify-full", got ${JSON.stringify(raw)}`,
  );
}

function buildSslConfig(env: Readonly<Record<string, string | undefined>>): PgSslConfig {
  const mode = readSslMode(env);
  if (mode === "off") return {};
  if (mode === "require") {
    return { ssl: { rejectUnauthorized: false } };
  }
  // verify-full
  const ca = env["WASLA_PG_SSL_CA"];
  if (ca === undefined || ca.trim() === "") {
    throw new Error(
      'WASLA_PG_SSL_MODE=verify-full requires WASLA_PG_SSL_CA to be set to the PEM certificate body',
    );
  }
  return { ssl: { ca: ca.trim(), rejectUnauthorized: true } };
}

/** Error raised instead of reaching a database that is known (or just found) to be unavailable. */
export class DbUnavailableError extends Error {
  /** Stable machine code. Deliberately not a 5-character SQLSTATE: error mappers that walk
   * `code` looking for one (constraint / serialization handling) must not mistake it. */
  readonly code = "DB_UNAVAILABLE";
  /** Fastify's default handler honours this; service handlers map the class explicitly. */
  readonly statusCode = 503;
  constructor(
    readonly pool: string,
    /** `circuit_open` or the connectivity reason (`ECONNREFUSED`, `connect_timeout`, …). */
    readonly reason: string,
  ) {
    super(`database unavailable (${pool}: ${reason})`);
    this.name = "DbUnavailableError";
  }
}

export function isDbUnavailableError(error: unknown): error is DbUnavailableError {
  return (
    error instanceof DbUnavailableError ||
    (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "DB_UNAVAILABLE")
  );
}

const CONNECTIVITY_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNABORTED",
  // SQLSTATE class 08 — connection exception; 57P01..57P03 — the server is going away / not accepting.
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "57P01",
  "57P02",
  "57P03",
]);

const CONNECTIVITY_MESSAGES: ReadonlyArray<readonly [RegExp, string]> = [
  [/timeout exceeded when trying to connect/i, "connect_timeout"],
  [/connection timeout/i, "connect_timeout"],
  [/query read timeout/i, "query_timeout"],
  [/connection terminated/i, "connection_terminated"],
  [/client has encountered a connection error/i, "connection_error"],
  [/the database system is (starting up|shutting down|in recovery mode)/i, "server_unavailable"],
];

/**
 * Does this error mean "the database could not be reached", as opposed to "the database
 * answered with an error"? Only the first kind may count against the breaker: a unique
 * violation is a healthy database saying no.
 */
export function connectivityReason(error: unknown): string | undefined {
  if (isDbUnavailableError(error)) return (error as DbUnavailableError).reason ?? "db_unavailable";
  let cursor: unknown = error;
  for (let depth = 0; depth < 4 && typeof cursor === "object" && cursor !== null; depth += 1) {
    const code = (cursor as { code?: unknown }).code;
    if (typeof code === "string" && CONNECTIVITY_CODES.has(code)) return code;
    const message = (cursor as { message?: unknown }).message;
    if (typeof message === "string") {
      for (const [pattern, reason] of CONNECTIVITY_MESSAGES) if (pattern.test(message)) return reason;
    }
    const next = (cursor as { cause?: unknown }).cause;
    if (next === cursor) break;
    cursor = next;
  }
  // AggregateError (dual-stack connect) carries the per-address errors in `errors`.
  const nested = (error as { errors?: unknown } | null)?.errors;
  if (Array.isArray(nested)) {
    for (const inner of nested) {
      const reason = connectivityReason(inner);
      if (reason !== undefined) return reason;
    }
  }
  return undefined;
}

function envMs(env: Readonly<Record<string, string | undefined>>, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer number of milliseconds, got ${JSON.stringify(raw)}`);
  }
  return value;
}

export interface PgPoolTimeouts {
  connectionTimeoutMillis?: number;
  query_timeout?: number;
  keepAlive?: boolean;
}

/**
 * Adds the bounded defaults to a pool config without overriding what the caller set.
 *   WASLA_PG_CONNECT_TIMEOUT_MS · WASLA_PG_QUERY_TIMEOUT_MS override the defaults per process.
 *   WASLA_PG_SSL_MODE (off|require|verify-full) controls TLS; `verify-full` requires
 *   WASLA_PG_SSL_CA to be the PEM certificate body (RISK-0060).
 */
export function withPgPoolDefaults<T extends object>(
  config: T,
  env: Readonly<Record<string, string | undefined>> = process.env,
): T & Required<PgPoolTimeouts> & PgSslConfig {
  const c = config as T & PgPoolTimeouts;
  const sslConfig = buildSslConfig(env);
  return {
    ...config,
    ...sslConfig,
    connectionTimeoutMillis:
      c.connectionTimeoutMillis ?? envMs(env, "WASLA_PG_CONNECT_TIMEOUT_MS", PG_GUARD_DEFAULTS.connectionTimeoutMillis),
    query_timeout: c.query_timeout ?? envMs(env, "WASLA_PG_QUERY_TIMEOUT_MS", PG_GUARD_DEFAULTS.queryTimeoutMillis),
    keepAlive: c.keepAlive ?? true,
  };
}

/** The slice of `pg.Pool` this module touches. */
export interface PgPoolLike {
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "connect", listener: (client: PgClientLike) => void): unknown;
  query: (...args: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  connect: (...args: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface PgClientLike {
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type DatabaseState = "up" | "down";

export interface DatabaseHealth {
  readonly pool: string;
  readonly state: DatabaseState;
  readonly breaker: "closed" | "open" | "half_open";
  /** Last connectivity reason seen, `null` once a probe succeeded after it. */
  readonly reason: string | null;
  readonly checkedAt: string;
  readonly latencyMs: number | null;
}

export interface PgGuard {
  readonly name: string;
  readonly breaker: CircuitBreaker;
  /** Live `SELECT 1` within `probeTimeoutMs`. Success closes the breaker; failure counts against it. */
  probe(): Promise<DatabaseHealth>;
  /** Counters for evidence and logs. */
  readonly stats: { poolErrors: number; clientErrors: number; rejectedOpen: number; connectivityFailures: number };
}

export interface GuardPgPoolOptions {
  readonly name: string;
  readonly breaker?: CircuitBreakerOptions;
  readonly probeTimeoutMs?: number;
  readonly probeCacheMs?: number;
  readonly clock?: Clock;
  /** One structured line per event. Default: `console.warn`. Never receives a connection string. */
  readonly log?: (line: string) => void;
}

const GUARDS = new WeakMap<object, PgGuard>();
/** Every guard installed in this process, in creation order — what health reports by default. */
const REGISTRY: PgGuard[] = [];

/** All guards installed in this process (runtime pools only; one-shot CLIs do not guard). */
export function installedPgGuards(): readonly PgGuard[] {
  return REGISTRY;
}

/** The guard installed on a pool, if any. */
export function pgGuardOf(pool: object): PgGuard | undefined {
  return GUARDS.get(pool);
}

/**
 * Installs error listeners, a circuit breaker and a probe on `pool`, in place, and returns
 * the same pool — so every caller that already holds a `Pool` keeps its type and behaviour
 * when the database is healthy. Idempotent.
 */
export function guardPgPool<P extends PgPoolLike>(pool: P, options: GuardPgPoolOptions): P {
  if (GUARDS.has(pool)) return pool;
  const name = options.name;
  const clock = options.clock ?? (() => Date.now());
  const breaker = createCircuitBreaker({
    failureThreshold: options.breaker?.failureThreshold ?? PG_GUARD_DEFAULTS.failureThreshold,
    cooldownMs: options.breaker?.cooldownMs ?? PG_GUARD_DEFAULTS.cooldownMs,
    clock,
  });
  const probeTimeoutMs = options.probeTimeoutMs ?? PG_GUARD_DEFAULTS.probeTimeoutMs;
  const probeCacheMs = options.probeCacheMs ?? PG_GUARD_DEFAULTS.probeCacheMs;
  const log = options.log ?? ((line: string) => console.warn(line));
  const stats = { poolErrors: 0, clientErrors: 0, rejectedOpen: 0, connectivityFailures: 0 };
  let lastReason: string | null = null;
  let lastLoggedState: string = breaker.state;
  // Probe state. A cached "up" is invalidated by the first connectivity failure seen after it:
  // otherwise health could repeat a stale "up" for `probeCacheMs` while calls already fail —
  // the exact misleading `ok` RISK-0058 is about (measured in the CLM-0438 re-run, E2).
  let inFlight: Promise<DatabaseHealth> | null = null;
  let cached: { at: number; value: DatabaseHealth } | null = null;

  const emit = (event: string, fields: Record<string, unknown>): void => {
    try {
      log(JSON.stringify({ level: "warn", event, pool: name, ...fields }));
    } catch {
      /* logging must never become the crash it is reporting */
    }
  };
  const noteBreaker = (): void => {
    if (breaker.state !== lastLoggedState) {
      emit("db_breaker_transition", { from: lastLoggedState, to: breaker.state, failures: breaker.failureCount });
      lastLoggedState = breaker.state;
    }
  };
  const failure = (reason: string): void => {
    stats.connectivityFailures += 1;
    lastReason = reason;
    if (cached?.value.state === "up") cached = null;
    breaker.onFailure();
    noteBreaker();
  };
  const success = (): void => {
    breaker.onSuccess();
    noteBreaker();
  };
  const classify = (error: unknown): unknown => {
    const reason = connectivityReason(error);
    if (reason === undefined) {
      success(); // the database answered — with an error, but it answered
      return error;
    }
    failure(reason);
    return isDbUnavailableError(error) ? error : new DbUnavailableError(name, reason);
  };
  const shortReason = (error: Error): string => connectivityReason(error) ?? (error as { code?: string }).code ?? error.name;

  // (1) The crash: pool-level 'error' (idle client died) and client-level 'error' while a
  // client is checked out (pg-pool removes its idle listener on acquire).
  pool.on("error", (error: Error) => {
    stats.poolErrors += 1;
    emit("db_pool_error", { reason: shortReason(error) });
    failure(shortReason(error));
  });
  pool.on("connect", (client: PgClientLike) => {
    client.on("error", (error: Error) => {
      stats.clientErrors += 1;
      emit("db_client_error", { reason: shortReason(error) });
    });
  });

  // (3) The breaker in front of every way the services reach the database.
  const rawQuery = pool.query.bind(pool) as (...args: unknown[]) => unknown;
  const rawConnect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;

  const rejectOpen = (): DbUnavailableError => {
    stats.rejectedOpen += 1;
    return new DbUnavailableError(name, "circuit_open");
  };

  (pool as { query: unknown }).query = function guardedQuery(...args: unknown[]): unknown {
    const first = args[0] as { submit?: unknown } | undefined;
    // Submittables (cursors, streams) manage their own lifecycle — pass through untouched.
    if (first !== null && typeof first === "object" && typeof first.submit === "function") return rawQuery(...args);
    const callback = typeof args[args.length - 1] === "function" ? (args.pop() as (e: unknown, r?: unknown) => void) : undefined;
    let result: Promise<unknown>;
    if (!breaker.before()) {
      noteBreaker();
      result = Promise.reject(rejectOpen());
    } else {
      noteBreaker();
      result = (rawQuery(...args) as Promise<unknown>).then(
        (value) => {
          success();
          return value;
        },
        (error: unknown) => {
          throw classify(error);
        },
      );
    }
    if (callback) {
      result.then(
        (value) => callback(undefined, value),
        (error) => callback(error),
      );
      return undefined;
    }
    return result;
  };

  (pool as { connect: unknown }).connect = function guardedConnect(...args: unknown[]): unknown {
    // pg-pool's own `query()` acquires with a callback; that path is already guarded above.
    if (typeof args[0] === "function") return rawConnect(...args);
    if (!breaker.before()) {
      noteBreaker();
      return Promise.reject(rejectOpen());
    }
    noteBreaker();
    return (rawConnect() as Promise<unknown>).then(
      (client) => {
        success();
        return client;
      },
      (error: unknown) => {
        throw classify(error);
      },
    );
  };

  // (2)+(3) The probe health uses: a real round-trip, bounded, shared within a short window.
  const probe = (): Promise<DatabaseHealth> => {
    const now = clock();
    if (cached && now - cached.at < probeCacheMs) return Promise.resolve(cached.value);
    if (inFlight) return inFlight;
    const started = clock();
    inFlight = new Promise<DatabaseHealth>((resolve) => {
      let settled = false;
      const finish = (ok: boolean, reason: string | null): void => {
        if (settled) return;
        settled = true;
        if (ok) {
          lastReason = null;
          breaker.reset();
          noteBreaker();
        } else {
          failure(reason ?? "probe_failed");
        }
        const value: DatabaseHealth = {
          pool: name,
          state: ok ? "up" : "down",
          breaker: breaker.state,
          reason: ok ? null : (reason ?? lastReason),
          checkedAt: new Date(clock()).toISOString(),
          latencyMs: ok ? Math.max(0, clock() - started) : null,
        };
        cached = { at: clock(), value };
        inFlight = null;
        resolve(value);
      };
      const timer = setTimeout(() => finish(false, "probe_timeout"), probeTimeoutMs);
      (timer as { unref?: () => void }).unref?.();
      Promise.resolve()
        .then(() => rawQuery("SELECT 1") as Promise<unknown>)
        .then(
          () => {
            clearTimeout(timer);
            finish(true, null);
          },
          (error: unknown) => {
            clearTimeout(timer);
            finish(false, connectivityReason(error) ?? "probe_error");
          },
        );
    });
    return inFlight;
  };

  const guard: PgGuard = { name, breaker, probe, stats };
  GUARDS.set(pool, guard);
  REGISTRY.push(guard);
  return pool;
}

/** The slice of Fastify this module touches. */
export interface HealthHookApp {
  addHook(
    name: "onRequest",
    hook: (request: { url: string; method: string }, reply: HealthHookReply) => Promise<unknown>,
  ): unknown;
}

export interface HealthHookReply {
  code(status: number): HealthHookReply;
  header(key: string, value: string): HealthHookReply;
  send(payload: unknown): unknown;
}

export interface AttachDatabaseHealthOptions {
  /** Health paths of this service (exact match, query string ignored). */
  readonly paths: readonly string[];
  /** Pools to probe. Omitted → every guarded pool in the process, resolved per request, so a
   * pool created after this call (e.g. the lazily built replay store) is still reported. */
  readonly pools?: readonly PgPoolLike[];
  readonly service: string;
}

/**
 * Health that tells the truth. Before the service's own health handler runs, every guarded
 * pool is probed; if any is down the request is answered here with **503**
 * `{ status: "unavailable", database: [...] }` — not the handler's `ok`. When all are up the
 * handler answers as before, with an `x-wasla-database: up` header added.
 */
export function attachDatabaseHealth(app: HealthHookApp, options: AttachDatabaseHealthOptions): void {
  const explicit = options.pools?.map((pool) => {
    const guard = pgGuardOf(pool);
    if (!guard) throw new Error(`attachDatabaseHealth(${options.service}): pool is not guarded — call guardPgPool() first`);
    return guard;
  });
  const paths = new Set(options.paths);
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "GET" && request.method !== "HEAD") return undefined;
    const path = request.url.split("?")[0] ?? request.url;
    if (!paths.has(path)) return undefined;
    const guards = explicit ?? REGISTRY;
    // No database in this process (in-memory mode): nothing to report; the handler's own
    // `degraded`/`memory` answer stands.
    if (guards.length === 0) return undefined;
    const results = await Promise.all(guards.map((guard) => guard.probe()));
    const down = results.some((result) => result.state !== "up");
    reply.header("x-wasla-database", down ? "down" : "up");
    if (!down) return undefined;
    reply.code(503).send({ status: "unavailable", service: options.service, database: results });
    return reply;
  });
}
