/**
 * Shared test harness for the bots layer.
 *
 * Builds a real bot app — real Telegram parser, real core use cases, real HTTP
 * routes — over in-memory stores and a mock channel. That combination is the
 * point: the assertions below exercise the production wiring, and the only thing
 * replaced is the transport, exactly as ADR-007's axiom promises.
 *
 * `app.inject` is used everywhere instead of a listening socket, so the suite
 * needs no port and no network.
 */

import {
  FakeIdentityBootstrap,
  FixedClock,
  InMemoryDeliveryStore,
  InMemoryOutbox,
  InMemoryProcessedUpdateStore,
  MockChannelAdapter,
  NO_JITTER,
  SequentialIdGenerator,
  StaticMiniAppRegistry,
  exponentialBackoffPolicy,
  type BotPresence,
  type MockSendOutcome,
} from "@wasla/channel-core";
import { BOT_MINI_APP, WEBHOOK_SECRET_HEADER, type BotKind } from "@wasla/contracts-channel";
import { TelegramUpdateParser } from "@wasla/telegram-adapter";
import type { FastifyInstance } from "fastify";

import { createBotApp } from "../http/app.js";

/** A valid secret (≥ 16 characters, per MIN_WEBHOOK_SECRET_LENGTH). */
export const SECRET = "test-webhook-secret-value";

export const BASE_URL = "https://apps.wasla.test";

/** Presence of a bot, shaped exactly like the env-driven one. */
export function presenceOf(bot: BotKind): BotPresence {
  return {
    bot,
    miniApp: BOT_MINI_APP[bot],
    miniAppUrl: `${BASE_URL}/${bot}`,
    miniAppLabel: `تطبيق ${bot}`,
    deepLinkTemplate: `https://t.me/wasla_${bot}_bot?start={payload}`,
  };
}

export interface Harness {
  readonly app: FastifyInstance;
  readonly channel: MockChannelAdapter;
  readonly identity: FakeIdentityBootstrap;
  readonly outbox: InMemoryOutbox;
  readonly deliveries: InMemoryDeliveryStore;
  readonly presence: BotPresence;
}

export interface HarnessOptions {
  /** Channel outcomes, consumed in order (the last one repeats). */
  readonly script?: MockSendOutcome[];
  readonly welcomeText?: string;
  /** Omit the configured secret, i.e. simulate a forgotten variable. */
  readonly withoutSecret?: boolean;
}

/** Build a bot app serving exactly one bot. */
export function harnessFor(bot: BotKind, options: HarnessOptions = {}): Harness {
  const clock = new FixedClock();
  const ids = new SequentialIdGenerator();
  const presence = presenceOf(bot);
  const channel = new MockChannelAdapter(options.script ?? [{ ok: true }]);
  const identity = new FakeIdentityBootstrap();
  const outbox = new InMemoryOutbox();
  const deliveries = new InMemoryDeliveryStore();

  const app = createBotApp({
    deps: {
      bot,
      inbound: {
        parser: new TelegramUpdateParser(),
        processedUpdates: new InMemoryProcessedUpdateStore(),
        outbox,
        identity,
        clock,
        ids,
      },
      outbound: {
        channel,
        deliveries,
        outbox,
        retry: exponentialBackoffPolicy({ jitter: NO_JITTER }),
        clock,
        ids,
      },
      launch: { registry: new StaticMiniAppRegistry({ [bot]: presence }) },
    },
    webhookSecret: options.withoutSecret ? undefined : SECRET,
    ...(options.welcomeText === undefined ? {} : { welcomeText: options.welcomeText }),
  });

  return { app, channel, identity, outbox, deliveries, presence };
}

/** Headers of an authentic webhook call. */
export function authHeaders(secret: string = SECRET): Record<string, string> {
  return { [WEBHOOK_SECRET_HEADER]: secret, "content-type": "application/json" };
}

/** A Telegram `/start` update (optionally carrying a deep-link payload). */
export function startUpdate(
  updateId: number,
  options: { chatId?: number; userId?: number; argument?: string } = {},
): Record<string, unknown> {
  const chatId = options.chatId ?? 4001;
  const userId = options.userId ?? 900123;
  const text = options.argument ? `/start ${options.argument}` : "/start";
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_770_000_000,
      chat: { id: chatId, type: "private" },
      from: { id: userId, first_name: "مستخدم", language_code: "ar" },
      text,
    },
  };
}

/** A plain text Telegram update (not a command). */
export function textUpdate(updateId: number, text = "مرحباً"): Record<string, unknown> {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_770_000_000,
      chat: { id: 4001, type: "private" },
      from: { id: 900123, first_name: "مستخدم" },
      text,
    },
  };
}
