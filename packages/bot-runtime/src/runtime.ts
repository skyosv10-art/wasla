/**
 * The composition itself: configuration → ports → the dependency bundles the
 * use cases receive.
 *
 * This is the *only* place in the running system where a concrete adapter is
 * chosen. Everything above it depends on ports, which is what makes the ADR-007
 * axiom testable: swap `TelegramChannelAdapter` for `MockChannelAdapter` here and
 * every use case above keeps working untouched.
 *
 * Phase 03 state, stated plainly rather than hidden: persistence is **in-memory**
 * (processed updates, deliveries, outbox). That is honest for a single-process
 * local run and wrong for production — a restart forgets which updates were
 * processed, so de-duplication would not survive it. MR 5 replaces these three
 * stores with Postgres adapters against `channel_updates` / `channel_deliveries`
 * / `channel_outbox`; nothing outside this file changes when it does.
 */

import {
  channelError,
  InMemoryDeliveryStore,
  InMemoryOutbox,
  InMemoryProcessedUpdateStore,
  exponentialBackoffPolicy,
  type ChannelPort,
  type IdentityBootstrapPort,
  type InboundDeps,
  type LaunchDeps,
  type OutboundDeps,
} from "@wasla/channel-core";
import { TelegramChannelAdapter, TelegramUpdateParser } from "@wasla/telegram-adapter";

import type { BotConfig } from "./config.js";
import { SingleBotRegistry } from "./config.js";
import { HttpIdentityBootstrap } from "./identity-bootstrap.js";
import { CryptoIdGenerator, SystemClock } from "./system.js";

/** Assembled dependencies of one bot process, ready for `createBotApp`. */
export interface BotRuntime {
  readonly bot: BotConfig["bot"];
  readonly inbound: InboundDeps;
  readonly outbound: OutboundDeps;
  readonly launch: LaunchDeps;
  /** True when no identity service is wired (health reports `degraded`). */
  readonly identityDegraded: boolean;
}

export interface BuildBotRuntimeOptions {
  /** Overrides the Telegram channel adapter (tests inject a mock). */
  readonly channel?: ChannelPort;
  /** Overrides identity bootstrap (tests inject a fake). */
  readonly identity?: IdentityBootstrapPort;
  /** Commands this bot answers; `start` is always included. */
  readonly supportedCommands?: readonly string[];
}

/**
 * Identity bootstrap when no identity service is configured.
 *
 * It refuses, loudly and retryably: a bot that cannot reach identity must not
 * invent a `wasla_public_id`, because a fabricated identity would be persisted
 * by whichever service consumes the outbox event and could never be reconciled.
 * The health endpoint reports `degraded` so the condition is visible before a
 * user ever sends `/start`.
 */
class UnconfiguredIdentityBootstrap implements IdentityBootstrapPort {
  async ensureIdentity(): Promise<never> {
    throw channelError("CHANNEL_IDENTITY_BOOTSTRAP_FAILED", "خدمة الهوية غير مُهيّأة لهذا البوت");
  }
}

/** Wire one bot from its validated configuration. */
export function buildBotRuntime(
  config: BotConfig,
  options: BuildBotRuntimeOptions = {},
): BotRuntime {
  const clock = new SystemClock();
  const ids = new CryptoIdGenerator();
  const registry = new SingleBotRegistry(config.presence);

  const channel: ChannelPort =
    options.channel ??
    new TelegramChannelAdapter({
      bot: config.bot,
      presence: config.presence,
      clock,
      apiOptions: { botToken: config.botToken },
    });

  const identityConfigured =
    options.identity !== undefined || config.identityServiceUrl !== undefined;
  const identity: IdentityBootstrapPort =
    options.identity ??
    (config.identityServiceUrl
      ? new HttpIdentityBootstrap({
          baseUrl: config.identityServiceUrl,
          ...(config.identityTimeoutMs === undefined
            ? {}
            : { timeoutMs: config.identityTimeoutMs }),
        })
      : new UnconfiguredIdentityBootstrap());

  // One outbox instance shared by both paths: inbound and outbound events must
  // land in the same log, in the order they happened.
  const outbox = new InMemoryOutbox();

  const inbound: InboundDeps = {
    parser: new TelegramUpdateParser(),
    processedUpdates: new InMemoryProcessedUpdateStore(),
    outbox,
    identity,
    clock,
    ids,
    ...(options.supportedCommands === undefined
      ? {}
      : { supportedCommands: options.supportedCommands }),
  };

  const outbound: OutboundDeps = {
    channel,
    deliveries: new InMemoryDeliveryStore(),
    outbox,
    retry: exponentialBackoffPolicy(),
    clock,
    ids,
  };

  return {
    bot: config.bot,
    inbound,
    outbound,
    launch: { registry },
    identityDegraded: !identityConfigured,
  };
}
