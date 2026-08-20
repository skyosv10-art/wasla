/**
 * Shared setup for the Phase 03 Exit Gate suite.
 *
 * Everything here exists to make one thing possible: running the three bot
 * composition roots, a real identity service and the channel stores in a single
 * process, and then asking the gate's question of the result. Nothing here
 * re-implements production wiring — each bot is built through its own
 * `buildApp()`, so what the gate observes is the deployable, not a copy of it.
 *
 * Two seams vary, and only two:
 *
 *   1. the channel adapter — `MockChannelAdapter` instead of
 *      `TelegramChannelAdapter`, which is the swap ADR-007 promises;
 *   2. the store set — Postgres when `DATABASE_URL` is set, in-memory otherwise,
 *      chosen by the same `loadBotConfig` production uses.
 *
 * The identity service is *not* faked: it listens on a real ephemeral port so the
 * bots' production `HttpIdentityBootstrap` adapter speaks real HTTP to it. Its
 * own persistence is in-memory, because what the gate examines is the contract
 * between the two services, not identity's storage (already covered by the Phase
 * 01 gate).
 */

import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import type { BotApp, BotRuntimeOverrides } from "@wasla/bot-runtime";
import {
  InMemoryOutbox as InMemoryChannelOutbox,
  MockChannelAdapter,
  type ChannelDomainEvent,
} from "@wasla/channel-core";
import { WEBHOOK_SECRET_HEADER, type BotKind } from "@wasla/contracts-channel";
import { buildApp as buildCustomerBot } from "@wasla/customer-bot";
import { buildApp as buildDriverBot } from "@wasla/driver-bot";
import {
  createIdentityApp,
  CryptoIdGenerator as IdentityIdGenerator,
  InMemoryIdentityRepository,
  InMemoryOutbox as InMemoryIdentityOutbox,
  InMemoryPublicIdSequence,
  SystemClock as IdentitySystemClock,
} from "@wasla/identity-service";
import { buildApp as buildPartnerBot } from "@wasla/partner-bot";
import { Pool } from "pg";

/** The three bots, in the order the gate reports them. */
export const BOTS: readonly BotKind[] = ["customer", "driver", "partner"];

/** One secret for the whole suite: the gate tests routing, not secret rotation. */
export const WEBHOOK_SECRET = "phase03-exit-gate-webhook-secret";

/**
 * Mini App address per bot — the value the gate is about.
 *
 * Three distinct hosts, so a bot that served another bot's app would fail on the
 * URL and not only on the `mini_app` field.
 */
export const MINI_APP_URL: Readonly<Record<BotKind, string>> = {
  customer: "https://apps.wasla.test/customer",
  driver: "https://apps.wasla.test/driver",
  partner: "https://apps.wasla.test/partner",
};

/** Conversation reference used per bot (an opaque string, never an FK). */
export const CHAT_REF: Readonly<Record<BotKind, string>> = {
  customer: "5001",
  driver: "5002",
  partner: "5003",
};

const BUILDERS: Readonly<Record<BotKind, (overrides?: BotRuntimeOverrides) => BotApp>> = {
  customer: buildCustomerBot,
  driver: buildDriverBot,
  partner: buildPartnerBot,
};

/** A running identity service the bots reach over HTTP. */
export interface IdentityService {
  /** Base URL to put in `IDENTITY_SERVICE_URL`. */
  readonly baseUrl: string;
  /** The outbox the service appends to — read to count `identity.created`. */
  readonly outbox: InMemoryIdentityOutbox;
  close(): Promise<void>;
}

/**
 * Start the identity service on an ephemeral port.
 *
 * `port: 0` and `127.0.0.1` on purpose: a fixed port would make two suites
 * collide, and binding a public interface in a test is an avoidable exposure.
 */
export async function startIdentityService(): Promise<IdentityService> {
  const outbox = new InMemoryIdentityOutbox();
  const app = createIdentityApp({
    deps: {
      repo: new InMemoryIdentityRepository(),
      outbox,
      publicIdSeq: new InMemoryPublicIdSequence(),
      clock: new IdentitySystemClock(),
      idGen: new IdentityIdGenerator(),
    },
    logger: false,
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    outbox,
    close: () => app.close(),
  };
}

/** One bot of the gate: its app, its wiring, and the adapter it was handed. */
export interface GateBot {
  readonly bot: BotKind;
  readonly app: BotApp["app"];
  readonly runtime: BotApp["runtime"];
  /** The adapter standing in for Telegram — the gate reads what it received. */
  readonly channel: MockChannelAdapter;
}

export interface BuildGateBotsOptions {
  /** `IDENTITY_SERVICE_URL`; omitted leaves the bot identity-degraded. */
  readonly identityUrl?: string;
  /** `DATABASE_URL`; omitted wires the in-memory stores. */
  readonly databaseUrl?: string;
}

/**
 * The environment of one bot, built the way a deployment would.
 *
 * Handed to `buildApp` as an explicit bag instead of mutating `process.env`, so
 * the suite cannot leak configuration between tests — and so a missing variable
 * fails here rather than being silently inherited from the shell.
 */
export function envFor(bot: BotKind, options: BuildGateBotsOptions = {}): Record<string, string> {
  const prefix = `${bot.toUpperCase()}_BOT`;
  return {
    [`${prefix}_TOKEN`]: `${bot}-bot-token`,
    [`${prefix}_WEBHOOK_SECRET`]: WEBHOOK_SECRET,
    [`${prefix}_MINI_APP_URL`]: MINI_APP_URL[bot],
    ...(options.identityUrl === undefined ? {} : { IDENTITY_SERVICE_URL: options.identityUrl }),
    ...(options.databaseUrl === undefined ? {} : { DATABASE_URL: options.databaseUrl }),
  };
}

/** Build one bot through its own composition root, with the mock adapter. */
export function buildGateBot(bot: BotKind, options: BuildGateBotsOptions = {}): GateBot {
  const channel = new MockChannelAdapter();
  const { app, runtime } = BUILDERS[bot]({
    env: envFor(bot, options),
    channel,
    logger: false,
  });
  return { bot, app, runtime, channel };
}

/** Build all three bots — the gate's subject. */
export function buildGateBots(options: BuildGateBotsOptions = {}): GateBot[] {
  return BOTS.map((bot) => buildGateBot(bot, options));
}

/** Close every bot; `app.close()` also releases the connection pool. */
export async function closeGateBots(bots: readonly GateBot[]): Promise<void> {
  for (const bot of bots) {
    await bot.app.close();
  }
}

/** A `/start` webhook payload in a private chat, in Telegram's shape. */
export function startUpdate(input: {
  readonly updateId: number;
  readonly chatRef: string;
  readonly userId: number;
  readonly firstName?: string;
}): Record<string, unknown> {
  return {
    update_id: input.updateId,
    message: {
      message_id: input.updateId,
      chat: { id: Number(input.chatRef), type: "private" },
      from: { id: input.userId, first_name: input.firstName ?? "مستخدم" },
      text: "/start",
    },
  };
}

/** POST one update to a bot's webhook with the expected secret header. */
export async function postWebhook(
  target: GateBot,
  payload: Record<string, unknown>,
  bot: BotKind = target.bot,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = await target.app.inject({
    method: "POST",
    url: `/channel/${bot}/webhook`,
    headers: {
      [WEBHOOK_SECRET_HEADER]: WEBHOOK_SECRET,
      "content-type": "application/json",
    },
    payload,
  });
  return { statusCode: response.statusCode, body: response.json() as Record<string, unknown> };
}

// ─────────────────────────────────────────────────────────────────────
// Reading what was recorded — the same assertions against either store
// ─────────────────────────────────────────────────────────────────────

/** A domain event as the gate reads it, whichever store holds it. */
export interface OutboxEntry {
  readonly event_type: string;
  readonly aggregate_id: string;
  readonly payload: Record<string, unknown>;
}

function normalize(event: ChannelDomainEvent): OutboxEntry {
  return {
    event_type: event.event_type,
    aggregate_id: event.aggregate.id,
    payload: event.payload as unknown as Record<string, unknown>,
  };
}

/**
 * Every channel event these bots emitted.
 *
 * With Postgres there is one shared log, so the pool is the source. In memory
 * each bot owns its own outbox instance, so they are concatenated — which is why
 * the gate asserts on counts per bot and never on a global order.
 */
export async function readOutbox(
  bots: readonly GateBot[],
  pool: Pool | undefined,
): Promise<OutboxEntry[]> {
  if (pool !== undefined) {
    const { rows } = await pool.query<OutboxEntry>(
      "SELECT event_type, aggregate_id, payload FROM channel_outbox ORDER BY occurred_at, event_type",
    );
    return rows;
  }

  return bots.flatMap((bot) =>
    (bot.runtime.inbound.outbox as InMemoryChannelOutbox).events.map(normalize),
  );
}

/** Every dispatch the mock adapters accepted, in the bots' declared order. */
export function dispatchesOf(bots: readonly GateBot[]): { bot: BotKind; count: number }[] {
  return bots.map((bot) => ({ bot: bot.bot, count: bot.channel.sent.length }));
}

// ─────────────────────────────────────────────────────────────────────
// Postgres — only when DATABASE_URL is set
// ─────────────────────────────────────────────────────────────────────

/**
 * The canonical DDL, resolved from this package's root.
 *
 * The channel contract owns its tables; no test and no adapter package defines a
 * table of its own (the rule `@wasla/channel-postgres` already follows).
 */
export const CHANNEL_SCHEMA_SQL = resolve(process.cwd(), "../channel-core/contracts/schema.sql");

const CHANNEL_TABLES = "channel_outbox, channel_deliveries, channel_updates";

/** Drop the channel tables and re-apply the published schema. */
export async function resetChannelSchema(pool: Pool): Promise<void> {
  const ddl = await readFile(CHANNEL_SCHEMA_SQL, "utf8");
  await pool.query(`DROP TABLE IF EXISTS ${CHANNEL_TABLES} CASCADE`);
  await pool.query(ddl);
}

/** Empty the channel tables between tests without re-applying the DDL. */
export async function truncateChannelTables(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${CHANNEL_TABLES}`);
}

/** Open the suite's own pool (separate from the bots' pools, read-only use). */
export function openPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 2 });
}
