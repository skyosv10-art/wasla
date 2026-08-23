/**
 * @wasla/driver-bot — the WASLA driver bot (السائق).
 *
 * A composition root: every channel behaviour lives in @wasla/bot-runtime, and the
 * thing specific to this process is *which* bot it serves — `"driver"` — which
 * decides which Mini App it opens (BOT_MINI_APP.driver) and which variables it
 * reads (DRIVER_BOT_*).
 *
 * Phase 05 · MR 5/6 adds the one thing a composition root *is* allowed to add: the
 * binding between this channel and the Driver Core
 * (docs/02-architecture/DRIVER_BOT_FLOWS.md). The behaviour it binds lives in
 * `flows.ts` (neutral, no Telegram) and `driver-core.ts` (the only importer of the
 * domain), so the channel layer still knows no domain and the domain still knows no
 * channel (ADR-007 rule 2).
 *
 * Why a separate deployable: each bot has its own Telegram token and its own
 * webhook secret, so they are separate processes with separate blast radii. Why
 * no logic here: three copies of one webhook handler would drift, and one copy
 * would eventually forget the secret check.
 */

export { BOT, buildApp, type DriverBotOverrides } from "./server.js";

export {
  AVAILABILITY_TEXT,
  DOCUMENTS_HEADER_TEXT,
  DOCUMENTS_UPLOAD_HINT_TEXT,
  DOCUMENT_STATUS_TEXT,
  DOCUMENT_TYPE_TEXT,
  DRIVER_AVAILABLE_COMMAND,
  DRIVER_DOCS_COMMAND,
  DRIVER_FLOW_ERROR_TEXT,
  DRIVER_FLOW_FALLBACK_ERROR_TEXT,
  DRIVER_OFFLINE_COMMAND,
  DRIVER_STATUS_COMMAND,
  DRIVER_SUPPORTED_COMMANDS,
  DRIVER_NEGOTIATIONS_COMMAND,
  DRIVER_ACCEPT_COMMAND,
  DRIVER_REJECT_COMMAND,
  DriverFlowError,
  ELIGIBILITY_REASON_TEXT,
  ELIGIBILITY_STATE_TEXT,
  NO_DOCUMENTS_TEXT,
  STATUS_REASONS_HEADER_TEXT,
  createDriverConversationHandler,
  renderDocuments,
  renderStatus,
  type DeclaredAvailabilityView,
  type DriverDocumentView,
  type DriverFlowsPort,
  type DriverStatusView,
} from "./flows.js";

export {
  UseCaseDriverFlows,
  buildDriverFlows,
  buildDriverNegotiations,
  buildDriverFlowsOver,
  toDriverLocale,
  type DriverFlowsEnv,
  type DriverFlowsWiring,
} from "./driver-core.js";

export {
  DRIVER_NEGOTIATION_REPLY_LIMIT,
  DRIVER_NEGOTIATION_TEXT,
  createDriverNegotiationConversationHandler,
  selectOnlyPendingOtherPartyRound,
  type DriverNegotiationsPort,
  type NegotiationParty,
  type NegotiationRoundState,
  type NegotiationRoundView,
  type NegotiationThreadState,
  type NegotiationThreadView,
} from "./negotiation-flows.js";
export {
  HttpDriverNegotiations,
  UnconfiguredDriverNegotiations,
  type HttpDriverNegotiationsOptions,
} from "./infrastructure/http-negotiations.js";
