/**
 * `@wasla/bot-runtime` — everything the three bot roots share.
 *
 * A bot root (`bots/customer-bot`, `bots/driver-bot`, `bots/partner-bot`) is a
 * *composition root* (ADR-007 §1): it names its bot, and nothing else. This
 * package holds what that naming needs — the HTTP surface of the channel
 * contract, the environment→configuration reader, the production clock/id
 * generator, and the HTTP identity adapter.
 *
 * **Why a package and not three copies:** the webhook is WASLA's only
 * unauthenticated entry point, and its secret verification *is* its
 * authentication. Three copies of that check would be three places for it to rot
 * independently, and the Phase 03 Exit Gate would have to assert the same rule
 * three times over three implementations instead of once over one. Justification
 * required by ENGINEERING_DOCUMENTATION_LAW §7 for any new package.
 *
 * Dependency direction is unchanged and still one-way:
 *   `bots/*` → `@wasla/bot-runtime` → `@wasla/telegram-adapter` → `@wasla/channel-core`
 */

export {
  DEFAULT_BOT_PORTS,
  DEFAULT_MINI_APP_LABELS,
  SingleBotRegistry,
  envNames,
  envPrefix,
  loadBotConfig,
  loadBotPresence,
  type BotConfig,
  type EnvBag,
} from "./config.js";

export { CryptoIdGenerator, SystemClock } from "./system.js";

export {
  HttpIdentityBootstrap,
  type FetchLike,
  type HttpIdentityBootstrapOptions,
} from "./identity-bootstrap.js";

export { DEFAULT_WELCOME_TEXT, buildStartReply, type StartReplyInput } from "./welcome.js";

export {
  buildBotRuntime,
  type BotRuntime,
  type BuildBotRuntimeOptions,
} from "./runtime.js";

export {
  createBotApp,
  readOutboundMessage,
  type BotAppDeps,
  type CreateBotAppOptions,
} from "./http/app.js";

export { sendChannelError } from "./http/errors.js";

export {
  buildBotApp,
  runBot,
  startBot,
  type BotApp,
  type BotRuntimeOverrides,
  type StartBotOptions,
} from "./http/server.js";
