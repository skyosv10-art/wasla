/**
 * PostgreSQL readiness probe (review 7/N — ADR-026 §4.9-4 deferral lifted).
 *
 * ## Why not reuse `/delivery/health`
 *
 * Liveness answers "is this process running?" and must stay dependency-free:
 * an orchestrator that restarts a healthy process because a shared database
 * blinked turns one outage into a restart storm. Readiness answers a different
 * question — "should traffic be sent here?" — and answering it without asking
 * any dependency is what makes a `{"status":"ok"}` route worthless: review 6/N
 * shipped exactly such a route and declared the debt rather than pretending it
 * was a readiness check.
 *
 * ## Why the probe touches a real table
 *
 * `SELECT 1` proves a TCP connection and a live backend, and nothing else — it
 * passes against a database where the schema was never applied, or where this
 * role cannot read the tables it needs. `SELECT 1 FROM store_orders LIMIT 1`
 * costs the same round trip and additionally proves the schema exists and is
 * readable by this role. It reads no rows' contents, so no personal data can
 * reach a probe log (§2.6) — and there is none in this schema anyway.
 *
 * ## Why the timeout, and why it is enforced twice
 *
 * A readiness probe that hangs is worse than one that fails: the orchestrator
 * waits, the check times out at ITS timeout, and the reported reason is lost.
 * So the statement carries a server-side `statement_timeout` AND the call is
 * raced client-side — the server-side one cannot fire if the connection never
 * establishes (pool exhaustion, DNS, a paused instance), which is precisely
 * the failure mode a probe must catch.
 *
 * ## Why it never throws
 *
 * An unreachable database is the ANSWER this port exists to return, not an
 * exceptional condition. Throwing would route it into the HTTP error handler,
 * which would answer `ErrorResponse` — and the contract says this one route
 * answers `ReadinessResponse` on 503 too (contracts/errors.md rule 6).
 */

import type { Pool } from "pg";

import type { ReadinessCheckResult, ReadinessProbePort } from "../ports.js";

export const DEFAULT_READINESS_TIMEOUT_MS = 1_500;

export class PostgresReadinessProbe implements ReadinessProbePort {
  constructor(
    private readonly pool: Pool,
    private readonly timeoutMs: number = DEFAULT_READINESS_TIMEOUT_MS,
  ) {}

  async probe(): Promise<readonly ReadinessCheckResult[]> {
    return [await this.probeDatabase()];
  }

  private async probeDatabase(): Promise<ReadinessCheckResult> {
    let timer: NodeJS.Timeout | undefined;
    try {
      // Two statements in ONE text-only query: the simple query protocol wraps
      // them in an implicit transaction, which is what makes `SET LOCAL` apply
      // to the SELECT and then revert — a bare `SET` would leak the timeout to
      // every later user of this pooled connection.
      const query = this.pool.query(
        `SET LOCAL statement_timeout = ${this.timeoutMs}; SELECT 1 FROM store_orders LIMIT 1`,
      );
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`readiness probe exceeded ${this.timeoutMs}ms`)),
          this.timeoutMs,
        );
      });
      // The query promise is awaited by `race`, so a late rejection after a
      // timeout would be unhandled — attach a sink before racing.
      query.catch(() => undefined);
      await Promise.race([query, timeout]);
      return { name: "database", ok: true };
    } catch (error) {
      // `detail` is a short reason for the log, never the driver's full text:
      // connection errors quote the DSN, and the DSN carries the password.
      return { name: "database", ok: false, detail: readinessFailureReason(error) };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/**
 * A small closed vocabulary instead of the driver's message. A probe response
 * is public-ish (orchestrators, dashboards, screenshots); a pg error string is
 * not — it can contain the connection string, host names, and role names.
 */
export function readinessFailureReason(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "57014") return "statement_timeout";
  if (code === "42P01") return "schema_missing";
  if (code === "28P01" || code === "28000") return "authentication_failed";
  if (code === "3D000") return "database_missing";
  if (typeof code === "string" && code.length > 0) return `pg_${code}`;
  const message = error instanceof Error ? error.message : "";
  if (message.includes("exceeded")) return "probe_timeout";
  return "unreachable";
}
