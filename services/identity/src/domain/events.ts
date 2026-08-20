/**
 * Domain event factories.
 *
 * Produce typed Identity domain events (IdentityEvent from
 * @wasla/contracts-identity) that match the canonical Event Contract
 * (services/identity/contracts/events.json). Events are written to the Outbox
 * port (not published directly) so a relay can forward them to Kafka later
 * without redesigning the domain.
 */

import type {
  IdentityCreatedV1,
  IdentityLinkAddedV1,
  TelegramUsernameChangedV1,
  RecoveryStartedV1,
} from "@wasla/contracts-identity";

import type { Clock, IdGenerator } from "../ports.js";
import type {
  LinkProvider,
  VerificationMethod,
  HistorySource,
} from "./model.js";

/** Source of a user creation (events.json IdentityCreated_v1.payload.source). */
export type CreationSource = "customer_bot" | "driver_bot" | "partner_bot";

function envelope(input: {
  idGen: IdGenerator;
  clock: Clock;
  aggregateId: string;
  traceId?: string;
}) {
  return {
    event_id: input.idGen.uuid(),
    occurred_at: input.clock.now(),
    producer: "identity-service" as const,
    aggregate: { type: "user" as const, id: input.aggregateId },
    ...(input.traceId ? { trace_id: input.traceId } : {}),
  };
}

export function identityCreated(input: {
  idGen: IdGenerator;
  clock: Clock;
  aggregateId: string;
  waslaPublicId: string;
  source: CreationSource;
  traceId?: string;
}): IdentityCreatedV1 {
  return {
    ...envelope(input),
    event_type: "identity.created",
    event_version: "v1",
    payload: { wasla_public_id: input.waslaPublicId, source: input.source },
  };
}

export function identityLinkAdded(input: {
  idGen: IdGenerator;
  clock: Clock;
  aggregateId: string;
  provider: LinkProvider;
  externalId: string;
  verified: boolean;
  traceId?: string;
}): IdentityLinkAddedV1 {
  return {
    ...envelope(input),
    event_type: "identity.link.added",
    event_version: "v1",
    payload: {
      provider: input.provider,
      external_id: input.externalId,
      verified: input.verified,
    },
  };
}

export function telegramUsernameChanged(input: {
  idGen: IdGenerator;
  clock: Clock;
  aggregateId: string;
  oldUsername: string | null;
  newUsername: string;
  source: Extract<HistorySource, "customer_bot" | "driver_bot" | "partner_bot" | "system">;
  traceId?: string;
}): TelegramUsernameChangedV1 {
  return {
    ...envelope(input),
    event_type: "identity.telegram_username.changed",
    event_version: "v1",
    payload: {
      old_username: input.oldUsername,
      new_username: input.newUsername,
      effective_at: input.clock.now(),
      source: input.source,
    },
  };
}

export function recoveryStarted(input: {
  idGen: IdGenerator;
  clock: Clock;
  aggregateId: string;
  recoveryId: string;
  verificationMethod: VerificationMethod;
  traceId?: string;
}): RecoveryStartedV1 {
  return {
    ...envelope(input),
    event_type: "identity.recovery.started",
    event_version: "v1",
    payload: {
      recovery_id: input.recoveryId,
      verification_method: input.verificationMethod,
    },
  };
}
