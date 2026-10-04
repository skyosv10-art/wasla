// RISK-0058 · ADR-059 (CLM-0460): a bot's /health reports the real database state.
// Before the fix the launcher never attached the database health hook, so a bot whose
// guarded pools were down still answered 200 `ok` on /health.

import { EventEmitter } from "node:events";

import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { guardPgPool } from "@wasla/resilience";

import type { BotConfig } from "../config.js";
import type { BotRuntime } from "../runtime.js";
import { runBotApp } from "../http/server.js";

class FakePool extends EventEmitter {
  down = false;
  async query(): Promise<{ rows: unknown[] }> {
    if (this.down) throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    return { rows: [] };
  }
  async connect(): Promise<never> {
    throw new Error("not used");
  }
}

const apps: Array<{ close: () => Promise<unknown> }> = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

async function launch() {
  const app = Fastify();
  // The bot app's own liveness answer (createBotApp): always 200 `ok`.
  app.get("/health", async () => ({ status: "ok", channel: "telegram" }));
  apps.push(app);
  await runBotApp("customer", () => ({
    app,
    config: { port: 0 } as unknown as BotConfig,
    runtime: {} as BotRuntime,
  }));
  return app;
}

describe("runBotApp — /health reports the guarded pools (ADR-059, CLM-0460)", () => {
  it("answers 503 `x-wasla-database: down` while a guarded pool is down, and 200 `up` after", async () => {
    const pool = guardPgPool(new FakePool(), { name: "bot-test", probeCacheMs: 0, log: () => undefined });
    const app = await launch();

    pool.down = true;
    const down = await app.inject({ method: "GET", url: "/health" });
    expect(down.statusCode).toBe(503);
    expect(down.headers["x-wasla-database"]).toBe("down");
    expect(down.json()).toMatchObject({ status: "unavailable", service: "customer-bot" });

    pool.down = false;
    const up = await app.inject({ method: "GET", url: "/health" });
    expect(up.statusCode).toBe(200);
    expect(up.headers["x-wasla-database"]).toBe("up");
    expect(up.json()).toEqual({ status: "ok", channel: "telegram" });
  });
});
