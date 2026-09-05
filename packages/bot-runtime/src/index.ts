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
  GROUP_ENV_NAMES,
  GROUP_ROLES,
  SingleBotRegistry,
  envNames,
  envPrefix,
  loadBotConfig,
  loadBotPresence,
  loadGroupPresences,
  type BotConfig,
  type EnvBag,
} from "./config.js";

export { CryptoIdGenerator, SystemClock } from "./system.js";

export {
  CHANNEL_IDENTITY_SCOPES,
  IDENTITY_RESOLVE_PATH,
  HttpIdentityBootstrap,
  type FetchLike,
  type HttpIdentityBootstrapOptions,
} from "./identity-bootstrap.js";

export {
  DEFAULT_GROUP_LINK_LABEL,
  DEFAULT_GROUP_START_TEXT,
  DEFAULT_WELCOME_TEXT,
  buildGroupStartReply,
  buildStartReply,
  type GroupStartReplyInput,
  type StartReplyInput,
} from "./welcome.js";

export {
  buildBotRuntime,
  type BotRuntime,
  type BuildBotRuntimeOptions,
  type ChannelStoreSet,
} from "./runtime.js";

export {
  buildConversationReply,
  type ConversationEvent,
  type ConversationHandler,
  type ConversationIdentity,
  type ConversationReply,
  type ConversationReplyInput,
} from "./conversation.js";

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
  runBotApp,
  startBot,
  type BotApp,
  type BotRuntimeOverrides,
  type StartBotOptions,
} from "./http/server.js";
