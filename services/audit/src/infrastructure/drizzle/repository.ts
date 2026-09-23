/**
 * Drizzle/Postgres repository for the Audit service.
 *
 * Implements `AuditRepository` against the `audit_events` table. The append
 * operation uses `RETURNING` to get the auto-generated id and created_at.
 */

import { eq, and, lte, gte, desc, sql } from "drizzle-orm";

import type { AuditEvent, CreateAuditEventInput, ListAuditEventsOptions } from "../../domain/model.js";
import type { AuditRepository } from "../../ports.js";
import { auditEvents } from "./schema.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

type Db = NodePgDatabase<typeof import("./schema.js")>;

function toDomain(row: typeof auditEvents.$inferSelect): AuditEvent {
  return {
    id: row.id,
    actorId: row.actorId,
    actorRole: row.actorRole,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}

export class DrizzleAuditRepository implements AuditRepository {
  constructor(private readonly db: Db) {}

  async append(input: CreateAuditEventInput): Promise<AuditEvent> {
    const [row] = await this.db
      .insert(auditEvents)
      .values({
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: input.metadata ?? {},
      })
      .returning();

    return toDomain(row);
  }

  async list(options: ListAuditEventsOptions): Promise<AuditEvent[]> {
    const conditions = [];
    if (options.actorId !== undefined) conditions.push(eq(auditEvents.actorId, options.actorId));
    if (options.actorRole !== undefined) conditions.push(eq(auditEvents.actorRole, options.actorRole));
    if (options.action !== undefined) conditions.push(eq(auditEvents.action, options.action));
    if (options.resourceType !== undefined) conditions.push(eq(auditEvents.resourceType, options.resourceType));
    if (options.resourceId !== undefined) conditions.push(eq(auditEvents.resourceId, options.resourceId));
    if (options.from !== undefined) conditions.push(gte(auditEvents.createdAt, sql`${options.from}::timestamptz`));
    if (options.to !== undefined) conditions.push(lte(auditEvents.createdAt, sql`${options.to}::timestamptz`));

    const query = conditions.length > 0
      ? this.db.select().from(auditEvents).where(and(...conditions)).orderBy(desc(auditEvents.createdAt))
      : this.db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt));

    const rows = await query.limit(options.limit).offset(options.offset);
    return rows.map(toDomain);
  }
}
