/**
 * Shared setup for the Phase 04 Exit Gate suite.
 *
 * Everything here exists to make one thing possible: running the customer bot,
 * the Customer Core, a real identity service, a real geography service and a stub
 * order engine in a single process, and then asking the gate's question of the
 * result — «can a customer produce a valid order that reaches the order engine,
 * with no matching involved?» (Phase 04 exit criterion).
 *
 * Nothing here re-implements production wiring where production wiring exists:
 * the bot is built through its own `buildApp()`, the Customer Core through
 * `createCustomerApp()`, and the handover payload through the service's own
 * `toOrderIntakeRequestDto`. What varies is only what has to:
 *
 *   1. the channel adapter — `MockChannelAdapter` instead of Telegram, the swap
 *      ADR-007 promises;
 *   2. the order engine — a stub listener, because the engine is Phase 06 and the
 *      gate must not wait for it;
 *   3. the store set — Postgres when `CUSTOMER_DATABASE_URL` is set, in-memory
 *      otherwise, so the same file is the gate in both modes.
 *
 * Identity and geography are **not** faked: both listen on real ephemeral ports so
 * the service's production `HttpIdentityLookupPort` and `HttpGeographyPort` speak
 * real HTTP. Their own persistence is in-memory, because what this gate examines
 * is the contract between services, not their storage — the Phase 01 and Phase 02
 * gates already cover that.
 *
 * Why `CUSTOMER_DATABASE_URL` and not `DATABASE_URL`: `DATABASE_URL` is the
 * *channel* store set (Phase 03). If the gate set it, the bot would try to use
 * channel tables this suite does not own, and the gate would start failing for a
 * reason that has nothing to do with Phase 04. The channel stores stay in-memory
 * here on purpose; the channel's own persistence has its own gate.
 */

import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import type { BotApp } from "@wasla/bot-runtime";
import { MockChannelAdapter } from "@wasla/channel-core";
import { WEBHOOK_SECRET_HEADER } from "@wasla/contracts-channel";
import { buildApp as buildCustomerBot, UseCaseCustomerFlows } from "@wasla/customer-bot";
import {
  createCustomerApp,
  createCustomerDb,
  CryptoIdGenerator,
  HttpGeographyPort,
  HttpIdentityLookupPort,
  InMemoryCustomerRepository,
  InMemoryOutbox as InMemoryCustomerOutbox,
  PostgresCustomerOutbox,
  PostgresCustomerRepository,
  SystemClock,
  type CustomerEvent,
  type Outbox,
  type UseCaseDeps,
} from "@wasla/customers-service";
import {
  createGeographyApp,
  CryptoIdGenerator as GeoIdGenerator,
  InMemoryGeographyRepository,
  InMemoryIdentityLookupPort as GeoIdentityLookup,
  InMemoryOutbox as InMemoryGeoOutbox,
  SAUDI_FIXTURE_IDS,
  SystemClock as GeoSystemClock,
} from "@wasla/geography-service";
import {
  createIdentityApp,
  CryptoIdGenerator as IdentityIdGenerator,
  InMemoryIdentityRepository,
  InMemoryOutbox as InMemoryIdentityOutbox,
  InMemoryPublicIdSequence,
  SystemClock as IdentitySystemClock,
} from "@wasla/identity-service";
import { Pool } from "pg";

import { HttpStubOrderIntake } from "./order-intake-http.js";
import { startStubOrderEngine, type StubOrderEngine } from "./stub-order-engine.js";

/** Postgres mode is opt-in; the gate itself is not. */
export const CUSTOMER_DATABASE_URL = process.env.CUSTOMER_DATABASE_URL;

/** One secret for the whole suite: the gate tests the chain, not secret rotation. */
export const WEBHOOK_SECRET = "phase04-exit-gate-webhook-secret";

export const MINI_APP_URL = "https://apps.wasla.test/customer";

/** Two active zones from the Saudi fixture — a real hierarchy, not a stub. */
export const PICKUP_ZONE = SAUDI_FIXTURE_IDS.zoneHaraEast;
export const DROPOFF_ZONE = SAUDI_FIXTURE_IDS.zoneQubaNorth;
/** A syntactically valid zone id that exists nowhere. */
export const UNKNOWN_ZONE = "99999999-9999-9999-9999-999999999999";

const CUSTOMER_TABLES =
  "customer_outbox, customer_order_request_stops, customer_order_requests, " +
  "customer_saved_places, customer_profiles";

/** The canonical DDL, read from the contract rather than duplicated here. */
const CUSTOMER_SCHEMA_SQL = resolve(
  process.cwd(),
  "../../services/customers/contracts/schema.sql",
);

export interface GateContext {
  /** Base URL of the Customer Core service (a real listener). */
  readonly customerUrl: string;
  /** Base URL of the identity service, to look up the id a `/start` produced. */
  readonly identityUrl: string;
  /** The customer bot, built through its own composition root. */
  readonly bot: BotApp;
  /** What the bot handed to «Telegram». */
  readonly channel: MockChannelAdapter;
  /** The stub engine: what it received, and how it should answer next. */
  readonly engine: StubOrderEngine;
  /** Identity's outbox, to prove an identity was really created. */
  readonly identityEvents: InMemoryIdentityOutbox;
  /** Customer Core events, whichever store is in play. */
  readonly customerOutbox: Outbox;
  /** `postgres` or `memory` — reported by the gate so a run is unambiguous. */
  readonly persistence: "postgres" | "memory";
  /** Remove every row/event between tests without rebuilding the process. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Start the gate: four listeners, one store set, one bot. */
export async function startGate(): Promise<GateContext> {
  // --- identity: a real service on an ephemeral port ------------------------
  const identityEvents = new InMemoryIdentityOutbox();
  const identityApp = createIdentityApp({
    deps: {
      repo: new InMemoryIdentityRepository(),
      outbox: identityEvents,
      publicIdSeq: new InMemoryPublicIdSequence(),
      clock: new IdentitySystemClock(),
      idGen: new IdentityIdGenerator(),
    },
    logger: false,
  });
  await identityApp.listen({ port: 0, host: "127.0.0.1" });
  const identityUrl = `http://127.0.0.1:${(identityApp.server.address() as AddressInfo).port}`;

  // --- geography: a real service over the Saudi fixture ---------------------
  const geoApp = createGeographyApp({
    deps: {
      repo: new InMemoryGeographyRepository(),
      outbox: new InMemoryGeoOutbox(),
      clock: new GeoSystemClock(),
      idGen: new GeoIdGenerator(),
      identityLookup: new GeoIdentityLookup(),
    },
    logger: false,
  });
  await geoApp.listen({ port: 0, host: "127.0.0.1" });
  const geographyUrl = `http://127.0.0.1:${(geoApp.server.address() as AddressInfo).port}`;

  // --- the stub engine ------------------------------------------------------
  const engine = await startStubOrderEngine("accept");

  // --- the Customer Core, wired exactly as a deployment would --------------
  let pool: Pool | null = null;
  let repo: UseCaseDeps["repo"];
  let outbox: Outbox;
  if (CUSTOMER_DATABASE_URL) {
    const created = createCustomerDb({ connectionString: CUSTOMER_DATABASE_URL });
    pool = created.pool;
    await pool.query(`DROP TABLE IF EXISTS ${CUSTOMER_TABLES} CASCADE`);
    await pool.query(await readFile(CUSTOMER_SCHEMA_SQL, "utf-8"));
    repo = new PostgresCustomerRepository(created.db);
    outbox = new PostgresCustomerOutbox(created.db);
  } else {
    repo = new InMemoryCustomerRepository();
    outbox = new InMemoryCustomerOutbox();
  }

  const deps: UseCaseDeps = {
    repo,
    outbox,
    clock: new SystemClock(),
    idGen: new CryptoIdGenerator(),
    identityLookup: new HttpIdentityLookupPort({ baseUrl: identityUrl }),
    geography: new HttpGeographyPort({ baseUrl: geographyUrl }),
    orderIntake: new HttpStubOrderIntake({ baseUrl: engine.baseUrl }),
  };

  const customerApp = createCustomerApp({
    deps,
    // The claim under test: with a store and an engine wired, this build says
    // `ok`. Everywhere else in Phase 04 it says `degraded`, and that was about
    // missing wiring — not about a service that cannot work.
    health: {
      persistence: CUSTOMER_DATABASE_URL ? "postgres" : "memory",
      orderIntake: "configured",
    },
    logger: false,
  });
  await customerApp.listen({ port: 0, host: "127.0.0.1" });
  const customerUrl = `http://127.0.0.1:${(customerApp.server.address() as AddressInfo).port}`;

  // --- the bot, on the very same core --------------------------------------
  // The flows are handed in over the same `deps`, so what the bot reads is what
  // the HTTP path wrote. Letting the bot open its own pool would make the gate
  // pass even if the two ends were looking at different data.
  const channel = new MockChannelAdapter();
  const bot = buildCustomerBot({
    env: {
      CUSTOMER_BOT_TOKEN: "phase04-gate-token",
      CUSTOMER_BOT_WEBHOOK_SECRET: WEBHOOK_SECRET,
      CUSTOMER_BOT_MINI_APP_URL: MINI_APP_URL,
      IDENTITY_SERVICE_URL: identityUrl,
    },
    channel,
    customerFlows: new UseCaseCustomerFlows(deps),
    logger: false,
  });

  return {
    customerUrl,
    identityUrl,
    bot,
    channel,
    engine,
    identityEvents,
    customerOutbox: outbox,
    persistence: CUSTOMER_DATABASE_URL ? "postgres" : "memory",
    // Only the recorders are cleared, never the stores.
    //
    // Truncating between tests would make the two modes behave differently
    // (there is no truncate for the in-memory repository), and the gate must be
    // the same gate in both. Isolation comes from data instead: every test uses
    // its own channel user, so it gets its own `wasla_public_id`, and event
    // assertions go through `eventsFor()` rather than reading the whole outbox.
    reset: async () => {
      channel.sent.length = 0;
      engine.received.length = 0;
      engine.malformed.length = 0;
      engine.minted.length = 0;
      engine.mode("accept");
    },
    close: async () => {
      await bot.app.close();
      await customerApp.close();
      await engine.close();
      await geoApp.close();
      await identityApp.close();
      if (pool) await pool.end();
    },
  };
}

/** A `/start` webhook payload in a private chat, in Telegram's shape. */
export function startUpdate(input: {
  readonly updateId: number;
  readonly chatRef: string;
  readonly userId: number;
  readonly firstName?: string;
  readonly languageCode?: string;
}): Record<string, unknown> {
  return {
    update_id: input.updateId,
    message: {
      message_id: input.updateId,
      date: 1_770_000_000,
      chat: { id: Number(input.chatRef), type: "private" },
      from: {
        id: input.userId,
        first_name: input.firstName ?? "عميل",
        ...(input.languageCode === undefined ? {} : { language_code: input.languageCode }),
      },
      text: "/start",
    },
  };
}

/** A command update for a command the bot registered. */
export function commandUpdate(input: {
  readonly updateId: number;
  readonly chatRef: string;
  readonly userId: number;
  readonly command: string;
}): Record<string, unknown> {
  const update = startUpdate(input) as { message: Record<string, unknown> };
  update.message.text = `/${input.command}`;
  return update as unknown as Record<string, unknown>;
}

/** POST one update to the bot's webhook with the expected secret header. */
export async function postWebhook(
  gate: GateContext,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = await gate.bot.app.inject({
    method: "POST",
    url: "/channel/customer/webhook",
    headers: {
      [WEBHOOK_SECRET_HEADER]: WEBHOOK_SECRET,
      "content-type": "application/json",
    },
    payload,
  });
  return {
    statusCode: response.statusCode,
    body: response.body ? (response.json() as Record<string, unknown>) : {},
  };
}

export interface HttpResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Call the Customer Core over real HTTP, the way any consumer would. */
export async function callCore(
  gate: GateContext,
  init: {
    readonly method: string;
    readonly path: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    readonly traceId?: string;
  },
): Promise<HttpResult> {
  const response = await fetch(`${gate.customerUrl}${init.path}`, {
    method: init.method,
    headers: {
      "content-type": "application/json",
      ...(init.idempotencyKey === undefined ? {} : { "idempotency-key": init.idempotencyKey }),
      ...(init.traceId === undefined ? {} : { "x-request-id": init.traceId }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

/** Every event the Customer Core appended, oldest first. */
export async function customerEvents(gate: GateContext): Promise<CustomerEvent[]> {
  return gate.customerOutbox.unread();
}

/**
 * The events belonging to one customer.
 *
 * The outbox is shared by the whole run, so an assertion that reads it whole
 * would depend on the order the tests happen to run in. Both envelopes carry the
 * owner: profile/place events under `wasla_public_id`, order events under
 * `customer_public_id`.
 */
export async function eventsFor(
  gate: GateContext,
  waslaPublicId: string,
): Promise<CustomerEvent[]> {
  const all = await customerEvents(gate);
  return all.filter((event) => {
    const payload = event.payload as Record<string, unknown>;
    return (
      payload.wasla_public_id === waslaPublicId ||
      payload.customer_public_id === waslaPublicId
    );
  });
}

/**
 * Ask identity which account a channel user resolved to.
 *
 * The bot never tells anyone the id — that is the point of ADR-001: the channel
 * layer holds no mapping to `wasla_public_id`. So the gate asks identity, the
 * same way the Customer Core would, and the answer must come back with
 * `created: false` because the bot's `/start` already created it.
 */
export async function resolveIdentity(
  gate: GateContext,
  telegramUserId: number,
): Promise<{ readonly waslaPublicId: string; readonly created: boolean }> {
  const response = await fetch(`${gate.identityUrl}/identity/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ telegram_user_id: telegramUserId, source: "customer_bot" }),
  });
  const body = (await response.json()) as { wasla_public_id: string; created: boolean };
  return { waslaPublicId: body.wasla_public_id, created: body.created };
}

/**
 * A valid two-stop order body: the gate's «valid order».
 *
 * Field names are the wire's, not the domain's (`zone_id`, `offered_price`,
 * `amount_minor`), and the stops carry `kind` — the contract identifies a stop by
 * its role, not by a position in the array, so a reordered array cannot silently
 * swap pickup and dropoff. `source` says where the location came from, which is
 * mandatory per stop under ADR-009 and is what a later audit reads.
 */
export function orderBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    order_type: "ride",
    vehicle_class: "sedan",
    price_mode: "customer_offer",
    offered_price: { amount_minor: 2500, currency: "SAR" },
    stops: [
      { kind: "pickup", zone_id: PICKUP_ZONE, source: "saved_place", label: "البيت" },
      { kind: "dropoff", zone_id: DROPOFF_ZONE, source: "map", label: "المسجد النبوي" },
    ],
    notes: null,
    ...overrides,
  };
}

/** A place body for `POST /customers/{id}/places`. */
export function placeBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    label: "البيت",
    zone_id: PICKUP_ZONE,
    address_text: "حيّ الحرة الشرقية",
    coordinates: null,
    ...overrides,
  };
}
