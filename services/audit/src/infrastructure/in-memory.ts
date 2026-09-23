/**
 * In-memory repository for the Audit service.
 *
 * Stores events in an array, newest-first on list. Used by tests and as the
 * fallback when no DATABASE_URL is configured (same pattern as other services).
 */

import type { AuditEvent, CreateAuditEventInput, ListAuditEventsOptions } from "../domain/model.js";
import type { AuditRepository, Clock } from "../ports.js";

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  private events: AuditEvent[] = [];
  private nextId = 1;

  async append(input: CreateAuditEventInput): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: this.nextId++,
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.metadata ?? {},
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  async list(options: ListAuditEventsOptions): Promise<AuditEvent[]> {
    let result = [...this.events];

    if (options.actorId !== undefined) {
      result = result.filter((e) => e.actorId === options.actorId);
    }
    if (options.actorRole !== undefined) {
      result = result.filter((e) => e.actorRole === options.actorRole);
    }
    if (options.action !== undefined) {
      result = result.filter((e) => e.action === options.action);
    }
    if (options.resourceType !== undefined) {
      result = result.filter((e) => e.resourceType === options.resourceType);
    }
    if (options.resourceId !== undefined) {
      result = result.filter((e) => e.resourceId === options.resourceId);
    }
    if (options.from !== undefined) {
      result = result.filter((e) => e.createdAt >= options.from!);
    }
    if (options.to !== undefined) {
      result = result.filter((e) => e.createdAt <= options.to!);
    }

    // Newest-first: by createdAt descending, then by id descending (stable tiebreaker)
    result.sort((a, b) => {
      const cmp = b.createdAt.localeCompare(a.createdAt);
      return cmp !== 0 ? cmp : b.id - a.id;
    });

    return result.slice(options.offset, options.offset + options.limit);
  }
}

export function createInMemoryDeps(): { repo: InMemoryAuditRepository; clock: SystemClock } {
  return {
    repo: new InMemoryAuditRepository(),
    clock: new SystemClock(),
  };
}
