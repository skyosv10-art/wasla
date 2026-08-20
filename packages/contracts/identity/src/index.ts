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

/** A single identity change history entry. */
export type IdentityHistoryEntry =
  components["schemas"]["IdentityHistoryEntry"];

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
