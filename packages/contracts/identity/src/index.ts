/**
 * @wasla/contracts-identity
 *
 * Typed Identity contracts:
 *  - API types generated from the OpenAPI source-of-truth via `openapi-typescript`.
 *  - Event types hand-derived from the JSON Schema Event Contract (events.json).
 *
 * These are Contract First artifacts (ADR-004) — NOT a runtime implementation.
 * Consumers (Telegram adapter, future services) import these types to stay
 * aligned with the published Identity API + Event contracts.
 *
 * Regenerate API types: pnpm --filter @wasla/contracts-identity generate
 */

export type * from "./api-types.js";
export type * from "./events-types.js";
export { IDENTITY_EVENT_TYPES } from "./events-types.js";

// --- API contract types (from OpenAPI) -------------------------------
import type { paths, components } from "./api-types.js";

/** All API paths and their operations. */
export type { paths };

/** Request payload the Telegram adapter sends to resolve/create a Wasla user. */
export type ResolveIdentityRequest =
  components["schemas"]["ResolveIdentityRequest"];

/** Response returned on a successful resolve. */
export type ResolveIdentityResponse =
  components["schemas"]["ResolveIdentityResponse"];

/** The resolved/created user entity. */
export type IdentityUser = components["schemas"]["User"];

/** A linked external identity (telegram/phone/email/...). */
export type IdentityLink = components["schemas"]["IdentityLink"];

/** Request body for adding an external identity link. */
export type AddIdentityLinkRequest =
  components["schemas"]["AddIdentityLinkRequest"];

/** Response returned when recovery is started. */
export type RecoveryStarted = components["schemas"]["RecoveryStarted"];

/** Request body for starting account recovery. */
export type StartRecoveryRequest =
  components["schemas"]["StartRecoveryRequest"];

/** A single identity change history entry. */
export type IdentityHistoryEntry =
  components["schemas"]["IdentityHistoryEntry"];

// --- Session lifecycle types (ADR-069 · CLM-0519 Phase 1) ---------------

/**
 * Request body for `POST /identity/sessions` — issuing a user session from a
 * verified init-data fingerprint. `actor_type` in the body is ignored: the
 * actor comes from the trusted caller path (I-03).
 */
export type IssueSessionRequest =
  components["schemas"]["IssueSessionRequest"];

/** Response of `POST /identity/sessions` — the opaque token is returned once. */
export type IssueSessionResponse =
  components["schemas"]["IssueSessionResponse"];

/** Request body for `POST /identity/sessions/exchange`. */
export type ExchangeSessionRequest =
  components["schemas"]["ExchangeSessionRequest"];

/** Response of `POST /identity/sessions/exchange` — a short-lived wua1. */
export type ExchangeSessionResponse =
  components["schemas"]["ExchangeSessionResponse"];

/** Request body for `POST /identity/sessions/revoke`. */
export type RevokeSessionRequest =
  components["schemas"]["RevokeSessionRequest"];

/** Response of `POST /identity/sessions/revoke`. */
export type RevokeSessionResponse =
  components["schemas"]["RevokeSessionResponse"];

// --- Event contract types (from events.json) --------------------------
import type {
  EventEnvelope,
  IdentityCreatedV1,
  IdentityLinkAddedV1,
  TelegramUsernameChangedV1,
  RecoveryStartedV1,
  IdentityEvent,
  IdentityEventType,
  IdentityEventByType,
} from "./events-types.js";

export type {
  EventEnvelope,
  IdentityCreatedV1,
  IdentityLinkAddedV1,
  TelegramUsernameChangedV1,
  RecoveryStartedV1,
  IdentityEvent,
  IdentityEventType,
  IdentityEventByType,
};
