/**
 * Ports (hexagonal boundaries) for the Identity domain.
 *
 * Use cases depend only on these interfaces. Concrete adapters live in
 * ./infrastructure (in-memory, for unit tests) and will be added in later
 * MRs (Drizzle/Postgres repository, Fastify HTTP layer).
 */

import type { IdentityEvent } from "@wasla/contracts-identity";

import type {
  User,
  IdentityLink,
  HistoryEntry,
  RecoveryRequest,
  LinkProvider,
  HistoryField,
  HistorySource,
  VerificationMethod,
  UserStatus,
} from "./domain/model.js";

/** Wall-clock time as ISO-8601 string. */
export interface Clock {
  now(): string;
}

/** UUID generator (for internal_uuid, event_id, recovery_id). */
export interface IdGenerator {
  uuid(): string;
}

/**
 * Monotonic source of Wasla Public ID sequence numbers. The persistence
 * adapter backs this with a Postgres sequence; the in-memory adapter uses a
 * counter. formatWaslaPublicId(n) turns the number into "WS-XXXXXXXXXX".
 */
export interface PublicIdSequence {
  next(): Promise<number>;
}

/** Input for creating a user. */
export interface CreateUserInput {
  internalUuid: string;
  waslaPublicId: string;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

/** Input for adding an identity link. */
export interface AddLinkInput {
  userInternalUuid: string;
  provider: LinkProvider;
  externalId: string;
  verified: boolean;
  linkedAt: string;
}

/** Input for recording a history entry. */
export interface RecordHistoryInput {
  userInternalUuid: string;
  field: HistoryField;
  oldValue: string | null;
  newValue: string;
  source: HistorySource;
  effectiveAt: string;
}

/** Input for creating a recovery request. */
export interface CreateRecoveryInput {
  id: string;
  userInternalUuid: string;
  verificationMethod: VerificationMethod;
  createdAt: string;
}

/**
 * Identity repository port — the source of truth for users, links, history
 * and recovery requests. Implementations must enforce the schema.sql UNIQUE
 * constraints (e.g. (provider, external_id) uniqueness).
 */
export interface IdentityRepository {
  /** Resolve a user by their Telegram numeric id (via the telegram link). */
  findUserByTelegramId(telegramUserId: number | string): Promise<User | null>;

  /** Find a user by their Wasla Public ID. */
  findUserByPublicId(waslaPublicId: string): Promise<User | null>;

  /** Create a new user (internal_uuid + wasla_public_id supplied by caller). */
  createUser(input: CreateUserInput): Promise<User>;

  /**
   * Add an external identity link. Throws IdentityError
   * (IDENTITY_LINK_ALREADY_LINKED) if (provider, external_id) is already
   * linked to another user.
   */
  addLink(input: AddLinkInput): Promise<IdentityLink>;

  /** List all links for a user. */
  listLinks(userInternalUuid: string): Promise<IdentityLink[]>;

  /** The most recent telegram_username recorded for a user (null if none). */
  latestTelegramUsername(userInternalUuid: string): Promise<string | null>;

  /** Append a history entry. */
  recordHistory(input: RecordHistoryInput): Promise<HistoryEntry>;

  /** List history for a user, optionally filtered by field. */
  listHistory(
    userInternalUuid: string,
    field?: HistoryField,
  ): Promise<HistoryEntry[]>;

  /** Create a recovery request. */
  createRecoveryRequest(input: CreateRecoveryInput): Promise<RecoveryRequest>;

  /** Update user status (e.g. to recovery_in_progress). */
  updateUserStatus(
    userInternalUuid: string,
    status: UserStatus,
  ): Promise<User>;
}

/**
 * Domain event outbox. Use cases append events here within the same logical
 * operation; a relay (later MR) publishes them to Kafka. Kept separate from
 * the repository so the domain owns event ordering without coupling to a
 * broker.
 */
export interface Outbox {
  append(event: IdentityEvent): Promise<void>;
  /** Read appended (unpublished) events — used by tests and the future relay. */
  unread(): Promise<IdentityEvent[]>;
}
