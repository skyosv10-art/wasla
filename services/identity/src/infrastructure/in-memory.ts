/**
 * In-memory adapters for the Identity domain.
 *
 * Used by unit tests and the future Fastify layer's app.inject tests. They
 * enforce the same UNIQUE constraints as schema.sql so use-case behavior is
 * identical to the Postgres-backed repository (added in a later MR).
 */

import { randomUUID } from "node:crypto";

import { IdentityError } from "../domain/errors.js";
import { formatWaslaPublicId } from "../domain/public-id.js";
import type {
  User,
  IdentityLink,
  HistoryEntry,
  RecoveryRequest,
} from "../domain/model.js";
import type { Session } from "../domain/session.js";
import type {
  Clock,
  IdGenerator,
  PublicIdSequence,
  IdentityRepository,
  Outbox,
  CreateUserInput,
  AddLinkInput,
  RecordHistoryInput,
  CreateRecoveryInput,
  CreateSessionInput,
  SessionRepository,
} from "../ports.js";

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class CryptoIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}

/** Deterministic counter-based sequence (stand-in for a Postgres sequence). */
export class InMemoryPublicIdSequence implements PublicIdSequence {
  private next_ = 0;
  async next(): Promise<number> {
    this.next_ += 1;
    return this.next_;
  }
}

export class InMemoryOutbox implements Outbox {
  private readonly events: import("@wasla/contracts-identity").IdentityEvent[] =
    [];
  async append(event: import("@wasla/contracts-identity").IdentityEvent): Promise<void> {
    this.events.push(event);
  }
  async unread(): Promise<import("@wasla/contracts-identity").IdentityEvent[]> {
    return [...this.events];
  }
  /** Test helper: drain and return all appended events. */
  drain(): import("@wasla/contracts-identity").IdentityEvent[] {
    const out = [...this.events];
    this.events.length = 0;
    return out;
  }
}

export class InMemoryIdentityRepository implements IdentityRepository {
  private users = new Map<string, User>();
  private links: IdentityLink[] = [];
  private history: HistoryEntry[] = [];
  private recoveries = new Map<string, RecoveryRequest>();
  private linkSeq = 0;
  private historySeq = 0;
  private telegramIndex = new Map<string, string>(); // externalId -> internalUuid

  async findUserByTelegramId(telegramUserId: number | string): Promise<User | null> {
    const externalId = String(telegramUserId);
    const internalUuid = this.telegramIndex.get(externalId);
    if (!internalUuid) return null;
    return this.users.get(internalUuid) ?? null;
  }

  async findUserByPublicId(waslaPublicId: string): Promise<User | null> {
    for (const u of this.users.values()) {
      if (u.waslaPublicId === waslaPublicId) return u;
    }
    return null;
  }

  async findUserByInternalUuid(internalUuid: string): Promise<User | null> {
    return this.users.get(internalUuid) ?? null;
  }

  async createUser(input: CreateUserInput): Promise<User> {
    if (this.users.has(input.internalUuid)) {
      throw new IdentityError(
        "IDENTITY_INTERNAL_ERROR",
        "duplicate internal_uuid",
      );
    }
    const user: User = { ...input, version: 1 };
    this.users.set(input.internalUuid, user);
    return user;
  }

  async addLink(input: AddLinkInput): Promise<IdentityLink> {
    const existing = this.links.find(
      (l) => l.provider === input.provider && l.externalId === input.externalId,
    );
    if (existing) {
      if (existing.userInternalUuid !== input.userInternalUuid) {
        throw new IdentityError(
          "IDENTITY_LINK_ALREADY_LINKED",
          "external identity link is already linked to another user",
        );
      }
      return existing;
    }
    const link: IdentityLink = {
      id: ++this.linkSeq,
      userInternalUuid: input.userInternalUuid,
      provider: input.provider,
      externalId: input.externalId,
      verified: input.verified,
      linkedAt: input.linkedAt,
    };
    this.links.push(link);
    if (input.provider === "telegram") {
      this.telegramIndex.set(input.externalId, input.userInternalUuid);
    }
    return link;
  }

  async listLinks(userInternalUuid: string): Promise<IdentityLink[]> {
    return this.links.filter(
      (l) => l.userInternalUuid === userInternalUuid,
    );
  }

  async latestTelegramUsername(userInternalUuid: string): Promise<string | null> {
    const entries = this.history
      .filter(
        (h) =>
          h.userInternalUuid === userInternalUuid &&
          h.field === "telegram_username",
      )
      .sort((a, b) => (a.id < b.id ? 1 : -1));
    return entries[0]?.newValue ?? null;
  }

  async recordHistory(input: RecordHistoryInput): Promise<HistoryEntry> {
    const entry: HistoryEntry = {
      id: ++this.historySeq,
      userInternalUuid: input.userInternalUuid,
      field: input.field,
      oldValue: input.oldValue,
      newValue: input.newValue,
      effectiveAt: input.effectiveAt,
      source: input.source,
    };
    this.history.push(entry);
    return entry;
  }

  async listHistory(
    userInternalUuid: string,
    field?: HistoryEntry["field"],
  ): Promise<HistoryEntry[]> {
    return this.history
      .filter(
        (h) =>
          h.userInternalUuid === userInternalUuid &&
          (field === undefined || h.field === field),
      )
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  async createRecoveryRequest(input: CreateRecoveryInput): Promise<RecoveryRequest> {
    const req: RecoveryRequest = {
      id: input.id,
      userInternalUuid: input.userInternalUuid,
      verificationMethod: input.verificationMethod,
      status: "verification_pending",
      createdAt: input.createdAt,
      resolvedAt: null,
    };
    this.recoveries.set(input.id, req);
    return req;
  }

  async updateUserStatus(
    userInternalUuid: string,
    status: User["status"],
  ): Promise<User> {
    const existing = this.users.get(userInternalUuid);
    if (!existing) {
      throw new IdentityError("IDENTITY_NOT_FOUND", "user not found");
    }
    const updated: User = { ...existing, status, version: existing.version + 1 };
    this.users.set(userInternalUuid, updated);
    return updated;
  }

  /** Test helper: generate and format the next public id. */
  async nextPublicId(seq: PublicIdSequence): Promise<string> {
    return formatWaslaPublicId(await seq.next());
  }
}

/**
 * مخزنُ جلساتٍ في الذاكرة — للاختبارِ الوحديِّ فقط (**M1-02**).
 *
 * **حدُّه المُعلَن:** منعُ الإعادةِ هنا يعمل داخلَ العمليّةِ الواحدةِ فقط.
 * وفي الإنتاجِ لا يجوز الاعتمادُ عليه أبداً: نسختانِ من الخدمةِ تعنيان
 * ذاكرتَينِ منفصلتَينِ فتمرُّ الإعادةُ. الضمانةُ الحقيقيّةُ هي الفهرسُ
 * الفريدُ في Postgres، والاختبارُ الذي يُثبِتها اختبارُ تكاملٍ على قاعدةٍ
 * حقيقيّةٍ لا هذا الوهم.
 */
export class InMemorySessionRepository implements SessionRepository {
  private sessions = new Map<string, Session>();
  private byTokenHash = new Map<string, string>();
  private usedInitData = new Set<string>();

  async createSession(input: CreateSessionInput): Promise<Session> {
    if (input.initDataHash !== null && this.usedInitData.has(input.initDataHash)) {
      throw new IdentityError(
        "IDENTITY_SESSION_REPLAY",
        "رسالةُ init-data استُعمِلت من قبل لإصدارِ جلسة.",
      );
    }
    if (this.byTokenHash.has(input.tokenHash)) {
      // تصادمُ رمزَينِ عشوائيَّينِ بطولِ 256 بتاً غيرُ عمليٍّ؛ فوقوعُه يعني
      // عيباً في التوليدِ لا حالةً طبيعيّةً، فيُرفَع لا يُبتَلع.
      throw new IdentityError("IDENTITY_INTERNAL_ERROR", "تصادمُ بصمةِ رمزِ جلسة.");
    }
    const session: Session = {
      ...input,
      lastSeenAt: null,
      revokedAt: null,
      revokedReason: null,
    };
    this.sessions.set(session.id, session);
    this.byTokenHash.set(session.tokenHash, session.id);
    if (session.initDataHash !== null) this.usedInitData.add(session.initDataHash);
    return session;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<Session | null> {
    const id = this.byTokenHash.get(tokenHash);
    return id === undefined ? null : (this.sessions.get(id) ?? null);
  }

  async touchSession(sessionId: string, seenAt: string): Promise<void> {
    const current = this.sessions.get(sessionId);
    if (current === undefined) return;
    this.sessions.set(sessionId, { ...current, lastSeenAt: seenAt });
  }

  async revokeSession(sessionId: string, revokedAt: string, reason: string): Promise<void> {
    const current = this.sessions.get(sessionId);
    if (current === undefined) {
      throw new IdentityError("IDENTITY_SESSION_NOT_FOUND", "لا جلسةَ بهذا المعرّف.");
    }
    // أوّلُ سببٍ يبقى: التكرارُ لا يُخفِق ولا يُعيد الكتابة.
    if (current.revokedAt !== null) return;
    this.sessions.set(sessionId, { ...current, revokedAt, revokedReason: reason });
  }

  async listSessionsForUser(userInternalUuid: string): Promise<Session[]> {
    return [...this.sessions.values()]
      .filter((s) => s.userInternalUuid === userInternalUuid)
      .sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt));
  }
}
