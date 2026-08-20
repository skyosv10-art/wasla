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
