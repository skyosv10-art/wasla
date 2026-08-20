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
  type BotPresence,
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

  return {
    bot,
    botToken,
    webhookSecret,
    presence: loadBotPresence(bot, env),
    ...(identityServiceUrl ? { identityServiceUrl } : {}),
    ...(identityTimeoutMs === undefined ? {} : { identityTimeoutMs }),
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
