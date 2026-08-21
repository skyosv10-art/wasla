/**
 * @wasla/customer-bot — the WASLA customer bot (العميل).
 *
 * A composition root, deliberately almost empty: every behaviour lives in
 * @wasla/bot-runtime, and the only thing specific to this process is *which* bot
 * it serves — `"customer"` — which decides which Mini App it opens
 * (BOT_MINI_APP.customer) and which variables it reads (CUSTOMER_BOT_*).
 *
 * Phase 04 adds the one thing a composition root *is* allowed to add: the
 * binding between this channel and the Customer Core
 * (docs/02-architecture/CUSTOMER_BOT_FLOWS.md). The behaviour it binds lives in
 * `flows.ts` (neutral, no Telegram) and `customer-core.ts` (the only importer of
 * the domain), so the channel layer still knows no domain and the domain still
 * knows no channel (ADR-007 rule 2).
 *
 * Why a separate deployable: each bot has its own Telegram token and its own
 * webhook secret, so they are separate processes with separate blast radii. Why
 * no logic here: three copies of one webhook handler would drift, and one copy
 * would eventually forget the secret check.
 */

export { BOT, buildApp, type CustomerBotOverrides } from "./server.js";

export {
  CUSTOMER_ORDERS_COMMAND,
  CUSTOMER_PLACES_COMMAND,
  CUSTOMER_SUPPORTED_COMMANDS,
  CustomerFlowError,
  FLOW_ERROR_TEXT,
  FLOW_FALLBACK_ERROR_TEXT,
  NO_ORDERS_TEXT,
  NO_PLACES_TEXT,
  ORDER_STATUS_TEXT,
  ORDER_TYPE_TEXT,
  ORDERS_REPLY_LIMIT,
  createCustomerConversationHandler,
  renderOrders,
  renderPlaces,
  type CustomerFlowsPort,
  type OrderRequestView,
  type SavedPlaceView,
} from "./flows.js";

export {
  UseCaseCustomerFlows,
  buildCustomerFlows,
  buildInMemoryCustomerFlows,
  toLocale,
  type CustomerFlowsEnv,
  type CustomerFlowsWiring,
} from "./customer-core.js";
