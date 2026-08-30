/**
 * Postgres-backed Identity repository + outbox, implementing the ports
 * (../ports.ts) with drizzle-orm/node-postgres. Enforces schema.sql UNIQUE
 * constraints (ON CONFLICT DO NOTHING on (provider, external_id); the DB
 * unique constraint on identity_users.wasla_public_id is the final net).
 *
 * The canonical DDL is schema.sql (ADR-004); this adapter only reads/writes
 * against it. Text columns with CHECK constraints are cast to the narrower
 * domain union types — the DB enforces the allowed values.
 */

import { and, asc, eq, isNull, desc, sql } from "drizzle-orm";

import type { IdentityEvent } from "@wasla/contracts-identity";

import { IdentityError } from "../../domain/errors.js";
import type {
  User,
  IdentityLink,
  HistoryEntry,
  RecoveryRequest,
  UserStatus,
  LinkProvider,
  HistoryField,
  HistorySource,
  VerificationMethod,
  RecoveryStatus,
} from "../../domain/model.js";
import type {
  Session,
  SessionActorType,
  SessionChannel,
} from "../../domain/session.js";
import type {
  IdentityRepository,
  Outbox,
  CreateUserInput,
  AddLinkInput,
  RecordHistoryInput,
  CreateRecoveryInput,
  CreateSessionInput,
  SessionRepository,
} from "../../ports.js";

import {
  identityUsers,
  identityLinks,
  identityHistory,
  identityRecoveryRequests,
  identityOutbox,
  identitySessions,
} from "./schema.js";
import type { Db } from "./db.js";

// --- row -> domain mappers (cast text-with-check columns to union types) ---

function mapUser(row: typeof identityUsers.$inferSelect): User {
  return {
    internalUuid: row.internalUuid,
    waslaPublicId: row.waslaPublicId,
    status: row.status as UserStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function mapLink(row: typeof identityLinks.$inferSelect): IdentityLink {
  return {
    id: row.id,
    userInternalUuid: row.userInternalUuid,
    provider: row.provider as LinkProvider,
    externalId: row.externalId,
    verified: row.verified,
    linkedAt: row.linkedAt.toISOString(),
  };
}

function mapHistory(row: typeof identityHistory.$inferSelect): HistoryEntry {
  return {
    id: row.id,
    userInternalUuid: row.userInternalUuid,
    field: row.field as HistoryField,
    oldValue: row.oldValue,
    newValue: row.newValue,
    effectiveAt: row.effectiveAt.toISOString(),
    source: row.source as HistorySource,
  };
}

function mapRecovery(
  row: typeof identityRecoveryRequests.$inferSelect,
): RecoveryRequest {
  return {
    id: row.id,
    userInternalUuid: row.userInternalUuid,
    verificationMethod: row.verificationMethod as VerificationMethod,
    status: row.status as RecoveryStatus,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

// --- repository ---

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly db: Db) {}

  async findUserByTelegramId(
    telegramUserId: number | string,
  ): Promise<User | null> {
    const rows = await this.db
      .select({ user: identityUsers })
      .from(identityUsers)
      .innerJoin(
        identityLinks,
        eq(identityUsers.internalUuid, identityLinks.userInternalUuid),
      )
      .where(
        and(
          eq(identityLinks.provider, "telegram"),
          eq(identityLinks.externalId, String(telegramUserId)),
        ),
      )
      .limit(1);
    return rows[0] ? mapUser(rows[0].user) : null;
  }

  async findUserByPublicId(waslaPublicId: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(identityUsers)
      .where(eq(identityUsers.waslaPublicId, waslaPublicId))
      .limit(1);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async findUserByInternalUuid(internalUuid: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(identityUsers)
      .where(eq(identityUsers.internalUuid, internalUuid))
      .limit(1);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async createUser(input: CreateUserInput): Promise<User> {
    const rows = await this.db
      .insert(identityUsers)
      .values({
        internalUuid: input.internalUuid,
        waslaPublicId: input.waslaPublicId,
        status: input.status,
        createdAt: new Date(input.createdAt),
        updatedAt: new Date(input.updatedAt),
      })
      .returning();
    if (rows.length === 0) {
      // The only insert-time failure is a duplicate wasla_public_id, which
      // the use case should have prevented via a sequence-generated id.
      throw new IdentityError(
        "IDENTITY_INTERNAL_ERROR",
        "identity_users insert returned no row (duplicate wasla_public_id?)",
      );
    }
    return mapUser(rows[0]);
  }

  async addLink(input: AddLinkInput): Promise<IdentityLink> {
    const inserted = await this.db
      .insert(identityLinks)
      .values({
        userInternalUuid: input.userInternalUuid,
        provider: input.provider,
        externalId: input.externalId,
        verified: input.verified,
        linkedAt: new Date(input.linkedAt),
      })
      .onConflictDoNothing({
        target: [identityLinks.provider, identityLinks.externalId],
      })
      .returning();

    if (inserted.length > 0) {
      return mapLink(inserted[0]);
    }

    // Conflict: the (provider, external_id) already exists. If it belongs to
    // the same user, return it; otherwise it's an error.
    const existing = await this.db
      .select()
      .from(identityLinks)
      .where(
        and(
          eq(identityLinks.provider, input.provider),
          eq(identityLinks.externalId, input.externalId),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (!row) {
      throw new IdentityError(
        "IDENTITY_INTERNAL_ERROR",
        "identity_links conflict but existing row not found",
      );
    }
    if (row.userInternalUuid !== input.userInternalUuid) {
      throw new IdentityError(
        "IDENTITY_LINK_ALREADY_LINKED",
        `identity link (${input.provider}, ${input.externalId}) belongs to another user`,
      );
    }
    return mapLink(row);
  }

  async listLinks(userInternalUuid: string): Promise<IdentityLink[]> {
    const rows = await this.db
      .select()
      .from(identityLinks)
      .where(eq(identityLinks.userInternalUuid, userInternalUuid));
    return rows.map(mapLink);
  }

  async latestTelegramUsername(
    userInternalUuid: string,
  ): Promise<string | null> {
    const rows = await this.db
      .select({ value: identityHistory.newValue })
      .from(identityHistory)
      .where(
        and(
          eq(identityHistory.userInternalUuid, userInternalUuid),
          eq(identityHistory.field, "telegram_username"),
        ),
      )
      .orderBy(desc(identityHistory.id))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  async recordHistory(input: RecordHistoryInput): Promise<HistoryEntry> {
    const rows = await this.db
      .insert(identityHistory)
      .values({
        userInternalUuid: input.userInternalUuid,
        field: input.field,
        oldValue: input.oldValue,
        newValue: input.newValue,
        effectiveAt: new Date(input.effectiveAt),
        source: input.source,
      })
      .returning();
    if (rows.length === 0) {
      throw new IdentityError(
        "IDENTITY_INTERNAL_ERROR",
        "identity_history insert returned no row",
      );
    }
    return mapHistory(rows[0]);
  }

  async listHistory(
    userInternalUuid: string,
    field?: HistoryField,
  ): Promise<HistoryEntry[]> {
    const condition = field
      ? and(
          eq(identityHistory.userInternalUuid, userInternalUuid),
          eq(identityHistory.field, field),
        )
      : eq(identityHistory.userInternalUuid, userInternalUuid);
    const rows = await this.db
      .select()
      .from(identityHistory)
      .where(condition)
      .orderBy(asc(identityHistory.id));
    return rows.map(mapHistory);
  }

  async createRecoveryRequest(
    input: CreateRecoveryInput,
  ): Promise<RecoveryRequest> {
    const rows = await this.db
      .insert(identityRecoveryRequests)
      .values({
        id: input.id,
        userInternalUuid: input.userInternalUuid,
        verificationMethod: input.verificationMethod,
        createdAt: new Date(input.createdAt),
      })
      .returning();
    if (rows.length === 0) {
      throw new IdentityError(
        "IDENTITY_INTERNAL_ERROR",
        "identity_recovery_requests insert returned no row",
      );
    }
    return mapRecovery(rows[0]);
  }

  async updateUserStatus(
    userInternalUuid: string,
    status: UserStatus,
  ): Promise<User> {
    const rows = await this.db
      .update(identityUsers)
      .set({ status, updatedAt: new Date(), version: sql`${identityUsers.version} + 1` })
      .where(eq(identityUsers.internalUuid, userInternalUuid))
      .returning();
    if (rows.length === 0) {
      throw new IdentityError("IDENTITY_NOT_FOUND", "user not found");
    }
    return mapUser(rows[0]);
  }
}

// --- outbox ---

export class PostgresOutbox implements Outbox {
  constructor(private readonly db: Db) {}

  async append(event: IdentityEvent): Promise<void> {
    await this.db.insert(identityOutbox).values({
      eventId: event.event_id,
      eventType: event.event_type,
      eventVersion: event.event_version,
      aggregateId: event.aggregate.id,
      payload: event,
      occurredAt: new Date(event.occurred_at),
    });
  }

  async unread(): Promise<IdentityEvent[]> {
    const rows = await this.db
      .select()
      .from(identityOutbox)
      .where(isNull(identityOutbox.publishedAt))
      .orderBy(asc(identityOutbox.id));
    return rows.map((row) => row.payload);
  }
}

/**
 * مستودعُ جلساتٍ فوقَ Postgres (**M1-02** · **ADR-019**).
 *
 * الفارقُ الجوهريُّ عن نسخةِ الذاكرة: منعُ الإعادةِ هنا ليس فحصاً في
 * الكودِ بل ترجمةً لخطأِ قيدٍ من المحرّك. ولذلك لا يوجد «اقرأ ثمّ اكتب»
 * في هذا الملفِّ إطلاقاً — ذلك النمطُ يترك نافذةً بين القراءةِ والكتابةِ
 * يعبرُها طلبانِ متوازيانِ بنفسِ الرسالة.
 */
export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}

  async createSession(input: CreateSessionInput): Promise<Session> {
    try {
      const rows = await this.db
        .insert(identitySessions)
        .values({
          id: input.id,
          userInternalUuid: input.userInternalUuid,
          actorType: input.actorType,
          channel: input.channel,
          tokenHash: input.tokenHash,
          initDataHash: input.initDataHash,
          issuedAt: new Date(input.issuedAt),
          expiresAt: new Date(input.expiresAt),
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new IdentityError("IDENTITY_INTERNAL_ERROR", "insert session returned no row");
      }
      return mapSession(row);
    } catch (error) {
      // 23505 = unique_violation. ونُميّز الفهرسَ بالاسمِ لا بالتخمين:
      // تصادمُ بصمةِ الرمزِ عيبٌ في التوليدِ (503)، وتكرارُ init-data
      // هجومُ إعادةٍ أو ضغطةُ زرٍّ مزدوجةٌ (409) — وخلطُهما يُخفي أحدَهما.
      if (isUniqueViolation(error, "uq_identity_sessions_init_data")) {
        throw new IdentityError(
          "IDENTITY_SESSION_REPLAY",
          "رسالةُ init-data استُعمِلت من قبل لإصدارِ جلسة.",
          { class: "conflict" },
        );
      }
      if (isUniqueViolation(error, "uq_identity_sessions_token")) {
        throw new IdentityError("IDENTITY_INTERNAL_ERROR", "تصادمُ بصمةِ رمزِ جلسة.");
      }
      throw error;
    }
  }

  async findSessionByTokenHash(tokenHash: string): Promise<Session | null> {
    const rows = await this.db
      .select()
      .from(identitySessions)
      .where(eq(identitySessions.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ? mapSession(rows[0]) : null;
  }

  async touchSession(sessionId: string, seenAt: string): Promise<void> {
    await this.db
      .update(identitySessions)
      .set({ lastSeenAt: new Date(seenAt) })
      .where(eq(identitySessions.id, sessionId));
  }

  async revokeSession(sessionId: string, revokedAt: string, reason: string): Promise<void> {
    // `isNull(revokedAt)` تجعل العمليّةَ مُتماثِلةَ التكرارِ في **جملةٍ
    // واحدةٍ**: أوّلُ سببٍ يبقى، ونداءٌ ثانٍ لا يُصيب سطراً.
    const rows = await this.db
      .update(identitySessions)
      .set({ revokedAt: new Date(revokedAt), revokedReason: reason })
      .where(
        and(eq(identitySessions.id, sessionId), isNull(identitySessions.revokedAt)),
      )
      .returning({ id: identitySessions.id });

    if (rows.length > 0) return;

    // لا سطرَ تأثَّر: إمّا أنّها مُلغاةٌ سابقاً (تكرارٌ مقبول) أو لا وجودَ
    // لها (خطأٌ يجب أن يُرى). والتمييزُ يلزمه قراءةٌ — وهي آمنةٌ هنا لأنّها
    // لا تُقرِّر كتابةً.
    const existing = await this.db
      .select({ id: identitySessions.id })
      .from(identitySessions)
      .where(eq(identitySessions.id, sessionId))
      .limit(1);
    if (existing.length === 0) {
      throw new IdentityError("IDENTITY_SESSION_NOT_FOUND", "لا جلسةَ بهذا المعرّف.");
    }
  }

  async listSessionsForUser(userInternalUuid: string): Promise<Session[]> {
    const rows = await this.db
      .select()
      .from(identitySessions)
      .where(eq(identitySessions.userInternalUuid, userInternalUuid))
      .orderBy(desc(identitySessions.issuedAt));
    return rows.map(mapSession);
  }
}

/**
 * هل الخطأُ خرقَ قيدِ تفرُّدٍ على الفهرسِ المُسمَّى؟
 *
 * **ويُمشى في سلسلةِ `cause`** ولا يُفحَص الكائنُ الأعلى وحدَه. وهذا ليس
 * احتياطاً نظريّاً: النسخةُ الأولى فحصت الأعلى فقط، فأخفقت بوابةُ M1-02 على
 * Postgres حقيقيٍّ لأنّ `drizzle-orm` تُلفّ خطأَ `pg` في `DrizzleQueryError`
 * فيصير `code` في `cause` لا في الأعلى. أي أنّ منعَ الإعادةِ كان يعمل في
 * المحرّكِ ويُترجَم عندَنا إلى خطأٍ غيرِ مُصنَّفٍ (500) بدلَ 409 — وما كشفَه
 * إلّا اختبارٌ على قاعدةٍ حقيقيّةٍ؛ لم يكن مُنفِّذُ الذاكرةِ ليكشفه أبداً.
 */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  // حدٌّ للعمقِ كي لا تُدوِّر سلسلةُ `cause` دائريّةٌ إلى الأبد.
  for (let depth = 0; depth < 8 && typeof current === "object" && current !== null; depth += 1) {
    const e = current as {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (e.code === "23505") {
      if (typeof e.constraint === "string") return e.constraint === constraint;
      // بعضُ مسارات الأخطاء لا تحمل `constraint`؛ فالرسالةُ آخرُ ملجأٍ
      // ويُقال إنّها أضعفُ من الحقلِ المُهيكَل.
      return typeof e.message === "string" && e.message.includes(constraint);
    }
    current = e.cause;
  }
  return false;
}

function mapSession(row: typeof identitySessions.$inferSelect): Session {
  return {
    id: row.id,
    userInternalUuid: row.userInternalUuid,
    actorType: row.actorType as SessionActorType,
    channel: row.channel as SessionChannel,
    tokenHash: row.tokenHash,
    initDataHash: row.initDataHash,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    lastSeenAt: row.lastSeenAt === null ? null : row.lastSeenAt.toISOString(),
    revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
    revokedReason: row.revokedReason,
  };
}
