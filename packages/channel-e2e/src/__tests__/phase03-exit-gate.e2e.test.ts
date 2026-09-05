/**
 * Phase 03 Exit Gate E2E test (MR 7 — the last of the phase plan).
 *
 * The gate, as published in docs/16-progress/ROADMAP.md and MASTER_PROGRESS.md:
 *
 *   «every bot opens the right Mini App, and the Telegram adapter can be replaced
 *    in tests by a Mock adapter».
 *
 * This file is the executable form of that sentence. Until it passes, Phase 03 is
 * not closed.
 *
 * What makes it an E2E and not a third copy of the per-bot suites: the three bot
 * *deployables* run at once, against **one** identity service reached over real
 * HTTP and **one** channel store set. That is the only arrangement in which the
 * interesting failures can appear at all — a bot answering with another bot's Mini
 * App, three bots creating three accounts for one person, or the same update id
 * from two different bots colliding in a shared de-duplication index.
 *
 * The store set is the only thing that varies with the environment:
 *
 *   `pnpm -r test`                    → in-memory stores (runs everywhere, on every MR)
 *   `DATABASE_URL=… pnpm --filter @wasla/channel-e2e test`
 *                                     → the Postgres adapters, plus the row-level
 *                                       assertions that only a real database can
 *                                       answer
 *
 * The gate itself is never skipped — a gate that can be skipped is not a gate.
 * Only the row-level assertions are conditional, and they say so in their names.
 */

import {
  DEFAULT_MINI_APP_LABELS,
  DEFAULT_WELCOME_TEXT,
} from "@wasla/bot-runtime";
import { MockChannelAdapter } from "@wasla/channel-core";
import { BOT_MINI_APP, IMPLEMENTED_CHANNEL, type BotKind } from "@wasla/contracts-channel";
import { buildApp as buildCustomerBot } from "@wasla/customer-bot";
import { TelegramChannelAdapter } from "@wasla/telegram-adapter";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  BOTS,
  CHAT_REF,
  MINI_APP_URL,
  buildGateBot,
  buildGateBots,
  closeGateBots,
  dispatchesOf,
  envFor,
  openPool,
  postWebhook,
  readOutbox,
  resetChannelSchema,
  signIdentityRequest,
  startIdentityService,
  startUpdate,
  truncateChannelTables,
  type GateBot,
  type IdentityService,
} from "./harness.js";

const DATABASE_URL = process.env.DATABASE_URL;
const PERSISTENCE = DATABASE_URL === undefined ? "memory" : "postgres";

/** Row-level assertions need a database; the gate's own assertions never do. */
const withDatabase = it.skipIf(DATABASE_URL === undefined);

/** One person, on all three bots — the subject of the identity assertions. */
const TELEGRAM_USER_ID = 777_000_123;

let identity: IdentityService;
let pool: Pool | undefined;
let bots: GateBot[] = [];

/** Build the three bots for one test and register them for teardown. */
function gateBots(): GateBot[] {
  bots = buildGateBots({
    identityUrl: identity.baseUrl,
    ...(DATABASE_URL === undefined ? {} : { databaseUrl: DATABASE_URL }),
  });
  return bots;
}

function botOf(all: readonly GateBot[], bot: BotKind): GateBot {
  const found = all.find((candidate) => candidate.bot === bot);
  if (found === undefined) throw new Error(`bot not built: ${bot}`);
  return found;
}

beforeAll(async () => {
  if (DATABASE_URL !== undefined) {
    pool = openPool(DATABASE_URL);
    await resetChannelSchema(pool);
  }
});

afterAll(async () => {
  await pool?.end();
});

// The identity service is restarted per test so no test inherits another's
// accounts: «one identity per person» must be proven from an empty registry.
beforeEach(async () => {
  identity = await startIdentityService();
  if (pool !== undefined) await truncateChannelTables(pool);
});

afterEach(async () => {
  await closeGateBots(bots);
  bots = [];
  await identity.close();
});

describe(`Phase 03 Exit Gate (${PERSISTENCE} stores)`, () => {
  it("gives every bot its own Mini App and refuses the other two", async () => {
    const all = gateBots();

    for (const gate of all) {
      const own = await gate.app.inject({
        method: "GET",
        url: `/channel/${gate.bot}/mini-app`,
      });

      expect(own.statusCode).toBe(200);
      expect(own.json()).toEqual({
        bot: gate.bot,
        mini_app: BOT_MINI_APP[gate.bot],
        url: MINI_APP_URL[gate.bot],
        label: DEFAULT_MINI_APP_LABELS[gate.bot],
      });

      // A process holds one token, so serving another bot from it would mean
      // sending as a bot whose token it does not have (config.ts, ADR-007).
      for (const other of BOTS.filter((candidate) => candidate !== gate.bot)) {
        const foreign = await gate.app.inject({
          method: "GET",
          url: `/channel/${other}/mini-app`,
        });
        expect(foreign.statusCode).toBe(404);
        expect((foreign.json() as { code: string }).code).toBe("CHANNEL_UNKNOWN_BOT");
      }
    }
  });

  it("answers /start with a button that opens that bot's own Mini App", async () => {
    const all = gateBots();

    for (const [index, gate] of all.entries()) {
      const updateId = 100 + index;
      const accepted = await postWebhook(
        gate,
        startUpdate({
          updateId,
          chatRef: CHAT_REF[gate.bot],
          userId: TELEGRAM_USER_ID,
        }),
      );

      expect(accepted.statusCode).toBe(202);
      expect(accepted.body).toMatchObject({
        status: "accepted",
        channel: IMPLEMENTED_CHANNEL,
        bot: gate.bot,
        kind: "command",
      });

      // Exactly one message, carrying exactly this bot's launch surface.
      expect(gate.channel.sent).toHaveLength(1);
      expect(gate.channel.last()).toMatchObject({
        channel: IMPLEMENTED_CHANNEL,
        chatRef: CHAT_REF[gate.bot],
        kind: "text_with_buttons",
        text: DEFAULT_WELCOME_TEXT[gate.bot],
        idempotencyKey: `start:${gate.bot}:${updateId}`,
        buttons: [
          {
            type: "mini_app",
            miniApp: BOT_MINI_APP[gate.bot],
            label: DEFAULT_MINI_APP_LABELS[gate.bot],
          },
        ],
      });
    }

    // The published evidence trail: one launch event per bot, attributed to it.
    const launched = (await readOutbox(all, pool)).filter(
      (entry) => entry.event_type === "channel.mini_app.launched",
    );
    expect(launched).toHaveLength(BOTS.length);
    expect(
      launched.map((entry) => [entry.payload.bot, entry.payload.mini_app]).sort(),
    ).toEqual(BOTS.map((bot) => [bot, BOT_MINI_APP[bot]]).sort());
  });

  it("resolves one identity for one person across the three bots", async () => {
    const all = gateBots();

    for (const [index, gate] of all.entries()) {
      const response = await postWebhook(
        gate,
        startUpdate({
          updateId: 200 + index,
          chatRef: CHAT_REF[gate.bot],
          userId: TELEGRAM_USER_ID,
        }),
      );
      expect(response.statusCode).toBe(202);
    }

    // Asked directly, identity confirms it never created a second account: the
    // second and third bot resolved the one the first created.
    const resolved = await fetch(`${identity.baseUrl}/identity/resolve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signIdentityRequest("POST", "/identity/resolve"),
      },
      body: JSON.stringify({ telegram_user_id: TELEGRAM_USER_ID, source: "customer_bot" }),
    });
    expect(resolved.status).toBe(200);
    const body = (await resolved.json()) as { wasla_public_id: string; created: boolean };
    expect(body.created).toBe(false);
    expect(body.wasla_public_id).toMatch(/^WS-\d{10}$/);

    const created = identity.outbox
      .drain()
      .filter((event) => event.event_type === "identity.created");
    expect(created).toHaveLength(1);
    expect(created[0]?.payload).toMatchObject({
      wasla_public_id: body.wasla_public_id,
      source: "customer_bot",
    });

    // And the channel layer still holds no mapping to it (ADR-001, ADR-007 rule 4).
    const events = await readOutbox(all, pool);
    expect(JSON.stringify(events)).not.toContain(body.wasla_public_id);
  });

  it("does not process a replayed update twice", async () => {
    const gate = botOf(gateBots(), "customer");
    const update = startUpdate({
      updateId: 300,
      chatRef: CHAT_REF.customer,
      userId: TELEGRAM_USER_ID,
    });

    const first = await postWebhook(gate, update);
    const replay = await postWebhook(gate, update);

    expect(first.body.status).toBe("accepted");
    // A replay is a 202, never an error: Telegram retries on any non-2xx, so
    // answering 4xx to a replay would guarantee more replays.
    expect(replay.statusCode).toBe(202);
    expect(replay.body.status).toBe("duplicate");

    expect(gate.channel.sent).toHaveLength(1);
    const received = (await readOutbox([gate], pool)).filter(
      (entry) => entry.event_type === "channel.update.received",
    );
    expect(received).toHaveLength(1);
  });

  it("keeps de-duplication per bot, not per update id", async () => {
    const all = gateBots();
    const customer = botOf(all, "customer");
    const driver = botOf(all, "driver");

    // Telegram numbers updates per bot, so the same id from two bots is two
    // different updates. In a shared store that only holds if the uniqueness key
    // includes the bot.
    const shared = 4242;
    const first = await postWebhook(
      customer,
      startUpdate({ updateId: shared, chatRef: CHAT_REF.customer, userId: TELEGRAM_USER_ID }),
    );
    const second = await postWebhook(
      driver,
      startUpdate({ updateId: shared, chatRef: CHAT_REF.driver, userId: TELEGRAM_USER_ID }),
    );

    expect(first.body.status).toBe("accepted");
    expect(second.body.status).toBe("accepted");
    expect(dispatchesOf([customer, driver])).toEqual([
      { bot: "customer", count: 1 },
      { bot: "driver", count: 1 },
    ]);
    expect(customer.channel.last()?.buttons?.[0]).toMatchObject({ miniApp: "customer" });
    expect(driver.channel.last()?.buttons?.[0]).toMatchObject({ miniApp: "driver" });
  });

  it("wires Telegram from configuration and accepts the mock in its place", async () => {
    const options = {
      identityUrl: identity.baseUrl,
      ...(DATABASE_URL === undefined ? {} : { databaseUrl: DATABASE_URL }),
    };

    // Built from configuration alone — production wiring, and the reason the swap
    // is an override of a real default rather than the only path there is.
    const wired = buildCustomerBot({ env: envFor("customer", options), logger: false });
    try {
      expect(wired.runtime.outbound.channel).toBeInstanceOf(TelegramChannelAdapter);
      expect(wired.runtime.outbound.channel.channel).toBe(IMPLEMENTED_CHANNEL);
    } finally {
      await wired.app.close();
    }

    // The same composition root, one seam overridden, nothing else touched — and
    // the port answers identically, which is what makes the two interchangeable
    // to every use case above it (ADR-007).
    const swapped = buildGateBot("customer", options);
    try {
      expect(swapped.runtime.outbound.channel).toBeInstanceOf(MockChannelAdapter);
      expect(swapped.runtime.outbound.channel.channel).toBe(IMPLEMENTED_CHANNEL);
      expect(swapped.runtime.inbound.parser.channel).toBe(IMPLEMENTED_CHANNEL);
    } finally {
      await closeGateBots([swapped]);
    }
  });

  it("reports health and the persistence it was wired with", async () => {
    for (const gate of gateBots()) {
      const health = await gate.app.inject({ method: "GET", url: "/health" });

      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: "ok", channel: IMPLEMENTED_CHANNEL });
      expect(gate.runtime.persistence).toBe(PERSISTENCE);
    }
  });

  withDatabase(
    "records one update row and one sent delivery per bot (Postgres only)",
    async () => {
      const all = gateBots();
      for (const [index, gate] of all.entries()) {
        await postWebhook(
          gate,
          startUpdate({
            updateId: 500 + index,
            chatRef: CHAT_REF[gate.bot],
            userId: TELEGRAM_USER_ID,
          }),
        );
      }

      const readPool = pool as Pool;

      const updates = await readPool.query<{
        bot: string;
        kind: string;
        status: string;
        chat_ref: string;
      }>("SELECT bot, kind, status, chat_ref FROM channel_updates ORDER BY bot");
      expect(updates.rows).toEqual(
        [...BOTS]
          .sort()
          .map((bot) => ({ bot, kind: "command", status: "processed", chat_ref: CHAT_REF[bot] })),
      );

      const deliveries = await readPool.query<{
        bot: string;
        status: string;
        attempts: number;
        idempotency_key: string;
        body: { buttons?: { miniApp?: string }[] };
      }>(
        "SELECT bot, status, attempts, idempotency_key, body FROM channel_deliveries ORDER BY bot",
      );
      expect(deliveries.rows).toHaveLength(BOTS.length);
      for (const row of deliveries.rows) {
        expect(row.status).toBe("sent");
        expect(row.attempts).toBe(1);
        expect(row.idempotency_key).toMatch(new RegExp(`^start:${row.bot}:\\d+$`));
        // The stored body is what a retry would re-send — so it must already
        // carry this bot's launch surface and nothing channel-specific.
        expect(row.body.buttons?.[0]?.miniApp).toBe(BOT_MINI_APP[row.bot as BotKind]);
      }

      // The outbox is keyed by the conversation, never by an identity.
      const outbox = await readPool.query<{ aggregate_id: string }>(
        "SELECT aggregate_id FROM channel_outbox WHERE event_type = 'channel.mini_app.launched' ORDER BY aggregate_id",
      );
      expect(outbox.rows.map((row) => row.aggregate_id)).toEqual(
        [...BOTS].map((bot) => CHAT_REF[bot]).sort(),
      );
    },
  );
});
