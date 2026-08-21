/**
 * Customer Core service bootstrap (composition root) — MR 4/6.
 *
 * The only place in the service that decides which concrete adapter is used and
 * the only place that opens or closes a connection. It wires:
 *
 *  - persistence: Postgres (Drizzle, MR 3/6) when DATABASE_URL is set, otherwise
 *    the in-memory repository, for local smoke runs without a database;
 *  - identity: HttpIdentityLookupPort when IDENTITY_SERVICE_URL is set, otherwise
 *    a permissive fake (dev only — it answers «exists» for any format-valid id);
 *  - geography: HttpGeographyPort when GEOGRAPHY_SERVICE_URL is set, otherwise a
 *    fake with no zones, which rejects every stop rather than inventing one;
 *  - order intake: `UnavailableOrderIntake` — Phase 04 has no engine adapter, and
 *    the fail-closed default is chosen **explicitly** here so that «no engine» is
 *    a visible decision (reported by /health as `degraded`) instead of an
 *    accident of omission. Phase 06 replaces this line, nothing else.
 *
 * The dev fallbacks are asymmetric on purpose: a missing identity service is
 * permissive (it only gates profile creation) while a missing geography service
 * is restrictive (a zone decides whether an order can exist at all). A
 * permissive geography fake would let a developer submit orders anchored to
 * zones that do not exist anywhere.
 *
 * The pool is closed in Fastify's `onClose` hook, so `app.close()` — on SIGTERM
 * or in a test — releases the connections it opened instead of leaking them.
 *
 * Not covered by the unit suite (which uses createCustomerApp + app.inject with
 * in-memory adapters). Run with: `pnpm --filter @wasla/customers-service start`.
 * Port via PORT (default 8086 — identity 8080, geography 8081; see ports table).
 */

import type { Pool } from "pg";

import {
  CryptoIdGenerator,
  FakeGeography,
  InMemoryCustomerRepository,
  InMemoryOutbox,
  SystemClock,
  UnavailableOrderIntake,
} from "../infrastructure/in-memory.js";
import { HttpGeographyPort } from "../infrastructure/http-geography.js";
import { HttpIdentityLookupPort } from "../infrastructure/http-identity-lookup.js";
import { createCustomerDb } from "../infrastructure/drizzle/db.js";
import {
  PostgresCustomerOutbox,
  PostgresCustomerRepository,
} from "../infrastructure/drizzle/repository.js";
import type { GeographyPort, IdentityLookupPort } from "../ports.js";
import type { UseCaseDeps } from "../use-cases/deps.js";

import { createCustomerApp, type CustomerHealthDescriptor } from "./app.js";

/**
 * A permissive identity fake for dev runs: every format-valid public id is
 * treated as existing. Never wire this in production — that is what
 * IDENTITY_SERVICE_URL is for.
 */
class PermissiveIdentityLookup implements IdentityLookupPort {
  async identityExists(): Promise<boolean> {
    return true;
  }
}

function buildIdentityLookup(): IdentityLookupPort {
  const baseUrl = process.env.IDENTITY_SERVICE_URL;
  return baseUrl
    ? new HttpIdentityLookupPort({ baseUrl })
    : new PermissiveIdentityLookup();
}

function buildGeography(): GeographyPort {
  const baseUrl = process.env.GEOGRAPHY_SERVICE_URL;
  // No URL → no zones: every stop is rejected with CUSTOMER_ZONE_NOT_FOUND,
  // which is the truthful answer when the zone hierarchy is not reachable.
  return baseUrl ? new HttpGeographyPort({ baseUrl }) : new FakeGeography([]);
}

interface Wiring {
  deps: UseCaseDeps;
  health: CustomerHealthDescriptor;
  pool: Pool | null;
}

function buildWiring(): Wiring {
  const clock = new SystemClock();
  const idGen = new CryptoIdGenerator();
  const identityLookup = buildIdentityLookup();
  const geography = buildGeography();
  // Explicit fail-closed default (ADR-009 §3): no silent success, no silent drop.
  const orderIntake = new UnavailableOrderIntake();

  if (process.env.DATABASE_URL) {
    const { pool, db } = createCustomerDb({
      connectionString: process.env.DATABASE_URL,
    });
    return {
      deps: {
        repo: new PostgresCustomerRepository(db),
        outbox: new PostgresCustomerOutbox(db),
        clock,
        idGen,
        identityLookup,
        geography,
        orderIntake,
      },
      health: { persistence: "postgres", orderIntake: "unconfigured" },
      pool,
    };
  }

  return {
    deps: {
      repo: new InMemoryCustomerRepository(),
      outbox: new InMemoryOutbox(),
      clock,
      idGen,
      identityLookup,
      geography,
      orderIntake,
    },
    health: { persistence: "memory", orderIntake: "unconfigured" },
    pool: null,
  };
}

async function main(): Promise<void> {
  const { deps, health, pool } = buildWiring();
  const app = createCustomerApp({ deps, health, logger: true });

  if (pool) {
    app.addHook("onClose", async () => {
      await pool.end();
    });
  }

  const port = Number(process.env.PORT ?? 8086);

  // SIGTERM is how a container is asked to stop: close the server (and with it
  // the pool) instead of letting the process die with connections open.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }

  try {
    await app.listen({ port, host: "0.0.0.0" });
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exit(1);
  }
}

await main();
