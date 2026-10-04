/**
 * RISK-0060 (CLM-0456): the readiness race covers obtaining a connection.
 *
 * On Render, with verify-full TLS, 12/12 idle-spaced `/delivery/ready` calls answered
 * 503 `probe_timeout` while `/health` and real traffic were fine: the 1.5 s client race
 * was shorter than a cold TLS connect. The race is now connect bound + query bound;
 * the server-side `statement_timeout` still bounds the query itself.
 */
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { connectBoundMs, PostgresReadinessProbe } from "../infrastructure/readiness-probe.js";

function fakePool(delayMs: number | "hang", connectionTimeoutMillis?: number): { pool: Pool; texts: string[] } {
  const texts: string[] = [];
  const pool = {
    options: connectionTimeoutMillis === undefined ? {} : { connectionTimeoutMillis },
    query(text: string) {
      texts.push(text);
      if (delayMs === "hang") return new Promise(() => undefined);
      return new Promise((r) => setTimeout(() => r({ rows: [] }), delayMs));
    },
  };
  return { pool: pool as unknown as Pool, texts };
}

describe("PostgresReadinessProbe — bound covers connection acquisition", () => {
  it("a slow-but-successful cold connect is ready, not a false probe_timeout", async () => {
    const { pool, texts } = fakePool(300, 2_000);
    const [check] = await new PostgresReadinessProbe(pool, 100).probe();
    expect(check).toEqual({ name: "database", ok: true });
    // The server-side bound is still the query bound alone.
    expect(texts[0]).toContain("statement_timeout = 100;");
  });

  it("a hanging database is still reported within connect + query bound", async () => {
    const { pool } = fakePool("hang", 150);
    const t0 = Date.now();
    const [check] = await new PostgresReadinessProbe(pool, 100).probe();
    const elapsed = Date.now() - t0;
    expect(check).toEqual({ name: "database", ok: false, detail: "probe_timeout" });
    expect(elapsed).toBeGreaterThanOrEqual(240);
    expect(elapsed).toBeLessThan(1_500);
  });

  it("connectBoundMs reads the pool's own bound and ignores nonsense", () => {
    expect(connectBoundMs({ options: { connectionTimeoutMillis: 5_000 } })).toBe(5_000);
    expect(connectBoundMs({ options: { connectionTimeoutMillis: 0 } })).toBe(0);
    expect(connectBoundMs({ options: { connectionTimeoutMillis: "5000" } })).toBe(0);
    expect(connectBoundMs({})).toBe(0);
  });
});
