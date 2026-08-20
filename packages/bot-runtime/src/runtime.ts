/**
 * The composition itself: configuration → ports → the dependency bundles the
 * use cases receive.
 *
 * This is the *only* place in the running system where a concrete adapter is
 * chosen. Everything above it depends on ports, which is what makes the ADR-007
 * axiom testable: swap `TelegramChannelAdapter` for `MockChannelAdapter` here and
 * every use case above keeps working untouched.
 *
 * Persistence is chosen here and nowhere else (MR 5): with `DATABASE_URL` set,
 * the three channel stores are the Postgres adapters of
 * `@wasla/channel-postgres` writing to `channel_updates` / `channel_deliveries` /
 * `channel_outbox`; without it, they are the in-memory adapters. The in-memory
 * path is honest only for a single-process local run: a restart forgets which
 * updates were processed, so de-duplication and the retry queue do not survive it
 * — which is why production always sets `DATABASE_URL`. Nothing above this file
 * knows which of the two it got.
 *
 * Groups are composed here too (MR 6): the declared rooms become a
 * `GroupRegistryPort`, shared by the inbound and the outbound bundle so both
 * answer «is this room ours» identically.
 */

import {
  channelError,
  InMemoryDeliveryStore,
  InMemoryOutbox,
  InMemoryProcessedUpdateStore,
  StaticGroupRegistry,
  exponentialBackoffPolicy,
  type ChannelPort,
  type DeliveryStorePort,
  type GroupRegistryPort,
  type IdentityBootstrapPort,
  type InboundDeps,
  type LaunchDeps,
  type OutboundDeps,
  type OutboxPort,
  type ProcessedUpdateStorePort,
} from "@wasla/channel-core";
import { createChannelStores } from "@wasla/channel-postgres";
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
  /** Which store set was wired — visible so an operator can verify it. */
  readonly persistence: "postgres" | "memory";
  /** The groups this process operates — the same instance both bundles hold. */
  readonly groups: GroupRegistryPort;
  /** Release owned resources (the connection pool). Safe to call twice. */
  close(): Promise<void>;
}

/** The three ports whose adapter choice *is* persistence. */
export interface ChannelStoreSet {
  readonly processedUpdates: ProcessedUpdateStorePort;
  readonly deliveries: DeliveryStorePort;
  readonly outbox: OutboxPort;
  close(): Promise<void>;
}

export interface BuildBotRuntimeOptions {
  /** Overrides the Telegram channel adapter (tests inject a mock). */
  readonly channel?: ChannelPort;
  /** Overrides identity bootstrap (tests inject a fake). */
  readonly identity?: IdentityBootstrapPort;
  /** Overrides the group registry (tests declare rooms without the environment). */
  readonly groups?: GroupRegistryPort;
  /** Commands this bot answers; `start` is always included. */
  readonly supportedCommands?: readonly string[];
  /**
   * Overrides the persistence set.
   *
   * Tests use it to keep everything in memory while still exercising this exact
   * composition; the seam exists so no test has to invent a database URL, and so
   * an E2E can inspect the store it handed in.
   */
  readonly stores?: ChannelStoreSet;
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

  const stores = options.stores ?? buildStoreSet(config);

  // One registry instance for both directions: the inbound side decides whether a
  // room may be answered and the outbound side decides what may be sent to it, and
  // two registries could disagree.
  const groups: GroupRegistryPort = options.groups ?? new StaticGroupRegistry(config.groups);

  const inbound: InboundDeps = {
    parser: new TelegramUpdateParser(),
    processedUpdates: stores.processedUpdates,
    outbox: stores.outbox,
    identity,
    clock,
    ids,
    groups,
    ...(options.supportedCommands === undefined
      ? {}
      : { supportedCommands: options.supportedCommands }),
  };

  const outbound: OutboundDeps = {
    channel,
    deliveries: stores.deliveries,
    outbox: stores.outbox,
    retry: exponentialBackoffPolicy(),
    clock,
    ids,
    groups,
  };

  return {
    bot: config.bot,
    inbound,
    outbound,
    launch: { registry },
    groups,
    identityDegraded: !identityConfigured,
    persistence: config.databaseUrl === undefined ? "memory" : "postgres",
    close: stores.close,
  };
}

/**
 * Choose the store set for this process.
 *
 * The three stores travel together deliberately: a durable delivery queue behind
 * an in-memory de-duplication set would still lose exactly-once on restart, so
 * mixing them would buy nothing while hiding the loss.
 *
 * One outbox instance is shared by the inbound and the outbound path — both must
 * append to the same log, in the order things happened.
 */
function buildStoreSet(config: BotConfig): ChannelStoreSet {
  if (config.databaseUrl !== undefined) {
    return createChannelStores({ connectionString: config.databaseUrl });
  }

  const outbox = new InMemoryOutbox();
  return {
    processedUpdates: new InMemoryProcessedUpdateStore(),
    deliveries: new InMemoryDeliveryStore(),
    outbox,
    close: async () => {
      /* nothing to release: the in-memory set dies with the process */
    },
  };
}
