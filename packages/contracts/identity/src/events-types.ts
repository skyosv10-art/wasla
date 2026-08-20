/**
 * Identity Domain Event types — hand-derived from the canonical Event Contract
 * (services/identity/contracts/events.json, JSON Schema 2020-12).
 *
 * Why hand-derived (not codegen): `json-schema-to-typescript` emits a generic
 * index signature for the $defs-only root schema, which is unusable. The event
 * set is small, stable, and versioned (v1; any breaking change requires v2 +
 * ADR), so hand-authoring is reliable and low-drift.
 *
 * Drift guard: `__tests__/events.test.ts` reads events.json and asserts the
 * event_type literals + payload structure stay in sync with these types.
 *
 * Canonical source = events.json. If the contract changes, update this file
 * to match and re-run the drift-guard test.
 */

/** Base envelope shared by all Identity domain events. */
export interface EventEnvelope {
  /** UUID. */
  event_id: string;
  /** Discriminator (e.g. "identity.created"). */
  event_type: string;
  /** Schema version, pattern ^v[0-9]+$. */
  event_version: string;
  /** ISO-8601 date-time. */
  occurred_at: string;
  /** Always "identity-service". */
  producer: "identity-service";
  /** The aggregate (user) the event concerns. */
  aggregate: {
    type: "user";
    /** internal_uuid — never shown to end users. */
    id: string;
  };
  /** Optional trace/correlation id. */
  trace_id?: string;
}

/** A new Wasla user was created (from a Telegram identity resolution or another link). */
export interface IdentityCreatedV1 extends EventEnvelope {
  event_type: "identity.created";
  event_version: "v1";
  payload: {
    /** Pattern ^WS-[0-9]{10}$. */
    wasla_public_id: string;
    source: "customer_bot" | "driver_bot" | "partner_bot";
  };
}

/** A new external identity link was added to an existing user. */
export interface IdentityLinkAddedV1 extends EventEnvelope {
  event_type: "identity.link.added";
  event_version: "v1";
  payload: {
    provider: "telegram" | "phone" | "email" | "web" | "mobile";
    external_id: string;
    verified: boolean;
  };
}

/** Telegram username changed for a user — does NOT create a new user. */
export interface TelegramUsernameChangedV1 extends EventEnvelope {
  event_type: "identity.telegram_username.changed";
  event_version: "v1";
  payload: {
    old_username: string | null;
    new_username: string;
    /** ISO-8601 date-time. */
    effective_at: string;
    source: "customer_bot" | "driver_bot" | "partner_bot" | "system";
  };
}

/** Account recovery started via Wasla Public ID. */
export interface RecoveryStartedV1 extends EventEnvelope {
  event_type: "identity.recovery.started";
  event_version: "v1";
  payload: {
    /** UUID. */
    recovery_id: string;
    verification_method: "phone_otp" | "email_otp" | "admin_assisted";
  };
}

/** Union of all v1 Identity domain events. */
export type IdentityEvent =
  | IdentityCreatedV1
  | IdentityLinkAddedV1
  | TelegramUsernameChangedV1
  | RecoveryStartedV1;

/** Discriminator union of all event_type literals. */
export type IdentityEventType = IdentityEvent["event_type"];

/** All v1 event_type literals, in declaration order. (Drift-guarded by tests.) */
export const IDENTITY_EVENT_TYPES: readonly IdentityEventType[] = [
  "identity.created",
  "identity.link.added",
  "identity.telegram_username.changed",
  "identity.recovery.started",
] as const;

/** Map an event_type literal to its concrete event interface (type-level). */
export interface IdentityEventByType {
  "identity.created": IdentityCreatedV1;
  "identity.link.added": IdentityLinkAddedV1;
  "identity.telegram_username.changed": TelegramUsernameChangedV1;
  "identity.recovery.started": RecoveryStartedV1;
}
