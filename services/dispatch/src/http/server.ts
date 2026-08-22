import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import { DISPATCH_SERVICE_PORT } from "@wasla/contracts-dispatch";
import { MATCHING_SERVICE_PORT } from "@wasla/contracts-matching";

import { createDispatchDb } from "../infrastructure/drizzle/db.js";
import {
  createInMemoryStores,
  SequentialIdGenerator,
  StaticRulesProvider,
} from "../infrastructure/in-memory.js";
import { HttpMatchingPort } from "../infrastructure/http-matching.js";
import { HttpOrderEnginePort } from "../infrastructure/http-order-engine.js";
import type { Clock, DispatchDependencies, IdGenerator, MatchingPort, OrderEnginePort } from "../ports.js";
import { PostgresDispatchUnitOfWork } from "../infrastructure/drizzle/transaction.js";
import { createDirectRunner, PostgresDispatchRunner, type DispatchRunner } from "../runner.js";

import { createDispatchApp, type DispatchHealthDescriptor } from "./app.js";

class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

class CryptoIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}

class UnavailableMatchingPort implements MatchingPort {
  async candidates(): Promise<never> {
    throw new Error("المطابقة غير مضبوطة");
  }
  async markUnavailable(): Promise<void> {
    throw new Error("المطابقة غير مضبوطة");
  }
}

class UnavailableOrderEnginePort implements OrderEnginePort {
  async registerOffer() { return { outcome: "unavailable" as const }; }
  async resolveAssignment() { return { outcome: "unavailable" as const }; }
  async transitionOrder() { return { outcome: "unavailable" as const }; }
}

interface Wiring {
  runner: DispatchRunner;
  health: DispatchHealthDescriptor;
  pool: Pool | null;
}

function rules(): StaticRulesProvider {
  return new StaticRulesProvider({
    rulesetVersion: 1,
    waveSize: Number(process.env.DISPATCH_WAVE_SIZE ?? 2),
    offerTimeoutSeconds: Number(process.env.DISPATCH_OFFER_TIMEOUT_SECONDS ?? 30),
    maxWaves: Number(process.env.DISPATCH_MAX_WAVES ?? 3),
    escalationTimeoutSeconds: Number(process.env.DISPATCH_ESCALATION_TIMEOUT_SECONDS ?? 120),
  });
}

function productionPorts(): { matching: MatchingPort; orders: OrderEnginePort } {
  return {
    matching: new HttpMatchingPort({ baseUrl: process.env.MATCHING_BASE_URL ?? `http://localhost:${MATCHING_SERVICE_PORT}` }),
    orders: new HttpOrderEnginePort({ baseUrl: process.env.ORDERS_BASE_URL ?? "http://localhost:8087" }),
  };
}

function buildWiring(): Wiring {
  const clock = new SystemClock();
  const ids = new CryptoIdGenerator();
  if (process.env.DATABASE_URL) {
    const { pool, db } = createDispatchDb({ connectionString: process.env.DATABASE_URL });
    const { matching, orders } = productionPorts();
    return {
      runner: new PostgresDispatchRunner(new PostgresDispatchUnitOfWork(db), { matching, orders, rules: rules(), clock, ids }),
      health: { persistence: "postgres" },
      pool,
    };
  }

  const stores = createInMemoryStores();
  const deps: DispatchDependencies = {
    ...stores,
    matching: new UnavailableMatchingPort(),
    orders: new UnavailableOrderEnginePort(),
    rules: rules(),
    clock,
    ids: new SequentialIdGenerator(),
  };
  return { runner: createDirectRunner(deps), health: { persistence: "memory" }, pool: null };
}

async function main(): Promise<void> {
  const { runner, health, pool } = buildWiring();
  const app = createDispatchApp({ runner, health, logger: true });
  if (pool) app.addHook("onClose", async () => { await pool.end(); });
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => { void app.close().then(() => process.exit(0)); });
  }
  try {
    await app.listen({ port: Number(process.env.PORT ?? DISPATCH_SERVICE_PORT), host: "0.0.0.0" });
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exit(1);
  }
}

await main();
