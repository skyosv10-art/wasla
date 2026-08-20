/**
 * Bot configuration, read from the environment — never from source.
 *
 * SECURITY_RULES forbids a token, a webhook secret or a public address in the
 * repository, and ADR-007 rule 6 makes the Mini App address *configuration*
 * injected through `MiniAppRegistryPort`. This file is the single translation
 * point between `process.env` and the typed `BotPresence` the core consumes.
 *
 * Two deliberate choices:
 *
 *  1. **Fail fast, at startup.** A bot whose token or webhook secret is missing
 *     must refuse to boot, not boot and reject every update with a 401 (or worse,
 *     accept unauthenticated ones). `loadBotConfig` throws a plain `Error` —
 *     this is a deployment fault, not a channel error, so it must not be
 *     translatable into an HTTP body.
 *  2. **Never echo a secret.** Validation messages name the *variable*, never
 *     its value or length beyond the published minimum.
 *
 * Variable names are derived from the bot kind, so adding a fourth bot needs no
 * change here: `CUSTOMER_BOT_TOKEN`, `DRIVER_BOT_TOKEN`, …
 */

import {
  DEEP_LINK_PAYLOAD_PLACEHOLDER,
  LIMITS,
  type BotPresence,
  type GroupPresence,
  type GroupRole,
  type MiniAppRegistryPort,
} from "@wasla/channel-core";
import { BOT_MINI_APP, type BotKind } from "@wasla/contracts-channel";
import { MIN_WEBHOOK_SECRET_LENGTH } from "@wasla/telegram-adapter";

/** The subset of `process.env` this module needs (injectable for tests). */
export type EnvBag = Readonly<Record<string, string | undefined>>;

/** Default listen port per bot: customer keeps the contract's 8083. */
export const DEFAULT_BOT_PORTS: Readonly<Record<BotKind, number>> = {
  customer: 8083,
  driver: 8084,
  partner: 8085,
};

/** Default Mini App button labels (Arabic-first, per the product language). */
export const DEFAULT_MINI_APP_LABELS: Readonly<Record<BotKind, string>> = {
  customer: "افتح تطبيق وصلة",
  driver: "افتح تطبيق الكابتن",
  partner: "افتح تطبيق الشريك",
};

/**
 * Environment variable that declares the groups of each role (ADR-008).
 *
 * Group references are configuration, not state: the binding table that would
 * hold them belongs to the support service and is deferred, so a deployment
 * declares its rooms the same way it declares its Mini App address. Values are
 * comma-separated conversation references.
 */
export const GROUP_ENV_NAMES: Readonly<Record<GroupRole, string>> = {
  support: "SUPPORT_GROUP_CHAT_IDS",
  escalation: "ESCALATION_GROUP_CHAT_IDS",
  community: "COMMUNITY_GROUP_CHAT_IDS",
};

/** Roles in declaration order — also the order conflicts are detected in. */
export const GROUP_ROLES: readonly GroupRole[] = ["support", "escalation", "community"];

/** Everything one bot process needs to run. */
export interface BotConfig {
  readonly bot: BotKind;
  /** Bot API token — held only to build the outbound client. Never logged. */
  readonly botToken: string;
  /** Expected value of the webhook secret header. Never logged. */
  readonly webhookSecret: string;
  readonly presence: BotPresence;
  /** Identity service base URL; absent means «no identity bootstrap wired». */
  readonly identityServiceUrl?: string;
  readonly identityTimeoutMs?: number;
  /**
   * Postgres connection string for the channel tables; absent means «run with
   * in-memory stores» (local development and tests only — de-duplication and the
   * retry queue are then lost on restart).
   */
  readonly databaseUrl?: string;
  /** Groups this deployment operates; empty means «private chats only». */
  readonly groups: readonly GroupPresence[];
  readonly port: number;
}

/** Environment variable prefix of a bot: `customer` → `CUSTOMER_BOT`. */
export function envPrefix(bot: BotKind): string {
  return `${bot.toUpperCase()}_BOT`;
}

/** Names of every variable a bot reads — used by docs and by the error message. */
export function envNames(bot: BotKind): Readonly<Record<string, string>> {
  const p = envPrefix(bot);
  return {
    token: `${p}_TOKEN`,
    webhookSecret: `${p}_WEBHOOK_SECRET`,
    miniAppUrl: `${p}_MINI_APP_URL`,
    miniAppLabel: `${p}_MINI_APP_LABEL`,
    deepLinkTemplate: `${p}_DEEP_LINK_TEMPLATE`,
    port: `${p}_PORT`,
    supportGroups: GROUP_ENV_NAMES.support,
    escalationGroups: GROUP_ENV_NAMES.escalation,
    communityGroups: GROUP_ENV_NAMES.community,
  };
}

function required(env: EnvBag, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`missing required environment variable ${name}`);
  }
  return value;
}

function assertHttpsUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${name} must use https (Telegram refuses http Mini Apps)`);
  }
  return url.toString();
}

function readPort(env: EnvBag, bot: BotKind): number {
  const raw = env[envNames(bot).port] ?? env.PORT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_BOT_PORTS[bot];
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${envNames(bot).port} must be an integer between 1 and 65535`);
  }
  return port;
}

/**
 * Read `DATABASE_URL`, refusing anything that is not a Postgres URL.
 *
 * A typo here would otherwise surface much later as a connection error on the
 * first webhook, so it is validated at startup like every other variable. The
 * value is never logged: a connection string carries a password.
 */
function readDatabaseUrl(env: EnvBag): string | undefined {
  const raw = env.DATABASE_URL?.trim();
  if (raw === undefined || raw === "") return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres:// (or postgresql://) scheme");
  }
  return raw;
}

function readTimeout(env: EnvBag): number | undefined {
  const raw = env.IDENTITY_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") return undefined;
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms <= 0) {
    throw new Error("IDENTITY_TIMEOUT_MS must be a positive integer (milliseconds)");
  }
  return ms;
}

/**
 * Read the declared groups of every role.
 *
 * Validation is strict on purpose. A reference that is empty, over-long or
 * declared under two roles is a deployment fault, and the failure it would cause
 * later is the worst kind: the bot would answer — or stay silent — in the wrong
 * room, in front of customers. So it refuses to boot instead.
 */
export function loadGroupPresences(env: EnvBag): readonly GroupPresence[] {
  const groups: GroupPresence[] = [];
  const seen = new Map<string, GroupRole>();

  for (const role of GROUP_ROLES) {
    const name = GROUP_ENV_NAMES[role];
    const raw = env[name]?.trim();
    if (raw === undefined || raw === "") continue;

    for (const part of raw.split(",")) {
      const chatRef = part.trim();
      if (chatRef === "") {
        throw new Error(`${name} contains an empty conversation reference`);
      }
      if (chatRef.length > LIMITS.chatRefMax) {
        throw new Error(`${name} contains a reference longer than ${LIMITS.chatRefMax} characters`);
      }
      const previous = seen.get(chatRef);
      if (previous !== undefined) {
        throw new Error(
          `a group is declared under two roles (${previous} and ${role}); each group has one role`,
        );
      }
      seen.set(chatRef, role);
      groups.push({ chatRef, role, label: `${role}:${groups.length + 1}` });
    }
  }

  return groups;
}

/**
 * Build the presence of one bot from the environment.
 *
 * The Mini App kind mirrors the bot kind by construction (customer bot → customer
 * Mini App). That identity is the subject of the Phase 03 Exit Gate, so it is
 * derived here rather than configured: a deployment cannot point the driver bot
 * at the customer app by editing a variable.
 */
export function loadBotPresence(bot: BotKind, env: EnvBag): BotPresence {
  const names = envNames(bot);
  const miniAppUrl = assertHttpsUrl(required(env, names.miniAppUrl), names.miniAppUrl);
  const miniAppLabel = env[names.miniAppLabel]?.trim() ?? DEFAULT_MINI_APP_LABELS[bot];
  const deepLinkTemplate = env[names.deepLinkTemplate]?.trim();

  if (deepLinkTemplate !== undefined && deepLinkTemplate.length > 0) {
    if (!deepLinkTemplate.includes(DEEP_LINK_PAYLOAD_PLACEHOLDER)) {
      throw new Error(
        `${names.deepLinkTemplate} must contain the ${DEEP_LINK_PAYLOAD_PLACEHOLDER} placeholder`,
      );
    }
  }

  return {
    bot,
    miniApp: BOT_MINI_APP[bot],
    miniAppUrl,
    miniAppLabel,
    ...(deepLinkTemplate ? { deepLinkTemplate } : {}),
  };
}

/** Read and validate the full configuration of a bot process. */
export function loadBotConfig(bot: BotKind, env: EnvBag): BotConfig {
  const names = envNames(bot);
  const botToken = required(env, names.token);
  const webhookSecret = required(env, names.webhookSecret);

  if (webhookSecret.length < MIN_WEBHOOK_SECRET_LENGTH) {
    throw new Error(
      `${names.webhookSecret} must be at least ${MIN_WEBHOOK_SECRET_LENGTH} characters`,
    );
  }

  const identityServiceUrl = env.IDENTITY_SERVICE_URL?.trim();
  const identityTimeoutMs = readTimeout(env);
  const databaseUrl = readDatabaseUrl(env);

  return {
    bot,
    botToken,
    webhookSecret,
    presence: loadBotPresence(bot, env),
    ...(identityServiceUrl ? { identityServiceUrl } : {}),
    ...(identityTimeoutMs === undefined ? {} : { identityTimeoutMs }),
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    groups: loadGroupPresences(env),
    port: readPort(env, bot),
  };
}

/**
 * `MiniAppRegistryPort` for a process that serves exactly one bot.
 *
 * One process per bot is a security boundary, not a deployment preference: a
 * process holds one token, so it *cannot* send as another bot. The registry
 * mirrors that boundary by answering `null` for every other bot — which the core
 * turns into `CHANNEL_UNKNOWN_BOT` (404), the honest answer for «that bot is not
 * served here».
 */
export class SingleBotRegistry implements MiniAppRegistryPort {
  constructor(private readonly presence: BotPresence) {}

  presenceFor(bot: BotKind): BotPresence | null {
    return bot === this.presence.bot ? this.presence : null;
  }
}
