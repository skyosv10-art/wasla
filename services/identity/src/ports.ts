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
import type {
  Session,
  SessionActorType,
  SessionChannel,
} from "./domain/session.js";

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

  /**
   * Find a user by their internal UUID (M1-02).
   *
   * تُقرأ بها الجلسةُ صاحبَها: الجلسةُ تحمل المعرِّفَ الداخليَّ، والـ
   * `Principal` يحمل المعرِّفَ العامَّ — فلا بدَّ من جسرٍ بينهما. ولا يجوز
   * أن يعبرَ المعرِّفُ الداخليُّ الحدَّ إلى استجابةٍ أو سجلٍّ (SECURITY_RULES §11).
   */
  findUserByInternalUuid(internalUuid: string): Promise<User | null>;

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

/**
 * منفذُ جلساتِ البشرِ (عنصرُ العمل **M1-02** · **ADR-019**).
 *
 * فُصِل عن `IdentityRepository` بقصد: الهويّةُ سجلٌّ دائمٌ يُقرأ كثيراً
 * ويُكتَب قليلاً، والجلسةُ سطرٌ قصيرُ العمرِ يُكتَب في كلِّ دخولٍ ويُقرأ في
 * كلِّ طلب. خلطُهما في منفذٍ واحدٍ يجعل كلَّ وهمٍ (fake) في الاختبارِ يحمل
 * ما لا يحتاجه.
 */
export interface SessionRepository {
  /**
   * يُنشئ جلسةً.
   *
   * **يجب** على المُنفِّذِ أن يُخفِق بـ`IdentityError('IDENTITY_SESSION_REPLAY')`
   * إذا كان `initDataHash` مستعملاً من قبل — وهذه هي ضمانةُ منعِ الإعادة.
   * المُنفِّذُ فوقَ Postgres يترجم `23505` على الفهرسِ الفريد؛ ولا يجوز
   * لأيِّ مُنفِّذٍ أن يُنفِّذ «اقرأ ثمّ اكتب» لأنّه يترك نافذةَ تسابُقٍ.
   */
  createSession(input: CreateSessionInput): Promise<Session>;

  /** يجد جلسةً ببصمةِ رمزِها؛ `null` إن لم توجد. */
  findSessionByTokenHash(tokenHash: string): Promise<Session | null>;

  /** يُسجّل آخِرَ استعمالٍ للجلسة (تدقيقٌ لا تفويض). */
  touchSession(sessionId: string, seenAt: string): Promise<void>;

  /**
   * يُلغي جلسةً. عمليّةٌ **مُتماثِلةُ التكرارِ** (idempotent): إلغاءُ
   * جلسةٍ مُلغاةٍ لا يُخفِق ولا يُغيّر السببَ الأوّل — فأوّلُ سببٍ هو
   * الحقيقةُ الأمنيّةُ، وما بعدَه تكرارُ نداءٍ.
   */
  revokeSession(sessionId: string, revokedAt: string, reason: string): Promise<void>;

  /** جلساتُ مستخدمٍ (الأحدثُ أوّلاً) — للتدقيقِ و«اسحب كلَّ أجهزتي». */
  listSessionsForUser(userInternalUuid: string): Promise<Session[]>;
}

/** مُدخَلُ إنشاءِ جلسة. */
export interface CreateSessionInput {
  readonly id: string;
  readonly userInternalUuid: string;
  readonly actorType: SessionActorType;
  readonly channel: SessionChannel;
  readonly tokenHash: string;
  readonly initDataHash: string | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
}
