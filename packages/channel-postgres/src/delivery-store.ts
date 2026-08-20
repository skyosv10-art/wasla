/**
 * `DeliveryStorePort` on Postgres — outbound delivery state and the retry queue.
 *
 * Three contract guarantees are implemented by the database itself rather than by
 * application logic, because only the database can enforce them across processes:
 *
 *   1. one delivery per `(channel, idempotency_key)` — the unique index
 *      `ux_channel_deliveries_idempotency`; `create` reports the existing row
 *      instead of inserting a second one, which is what turns a caller's retry
 *      into `duplicate` rather than a double send;
 *   2. `version` bumps on every persisted attempt — done inside the UPDATE
 *      (`version = version + 1`), so no read-modify-write window exists;
 *   3. the retry queue order — priority first (critical > high > normal > low),
 *      then `next_attempt_at`, matching the in-memory adapter exactly so the core
 *      behaves the same on either side of the port.
 *
 * The message body is stored verbatim in `body` (JSONB) because a retry must
 * re-send *the same* message and the caller may no longer exist to rebuild it.
 */

import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";

import {
  channelError,
  type ChannelDispatch,
  type DeliveryProgress,
  type DeliveryRecord,
  type DeliveryStatus,
  type DeliveryStorePort,
  type MessagePriority,
  type NewDelivery,
  type OutboundMessageKind,
  type StoredDispatch,
} from "@wasla/channel-core";
import type { BotKind, ChannelName } from "@wasla/contracts-channel";

import type { ChannelDb } from "./db.js";
import { channelDeliveries } from "./schema.js";

/** One `channel_deliveries` row as Drizzle returns it. */
type DeliveryRow = typeof channelDeliveries.$inferSelect;

/**
 * Retry-queue ordering as SQL. The contract's priority is a TEXT enum, so the
 * order has to be expressed explicitly — alphabetical order would put `critical`
 * after `high` and quietly break the published policy.
 */
const PRIORITY_RANK = sql`CASE ${channelDeliveries.priority}
  WHEN 'critical' THEN 0
  WHEN 'high' THEN 1
  WHEN 'normal' THEN 2
  ELSE 3
END`;

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** Map a row to the neutral domain record the core works with. */
function toRecord(row: DeliveryRow): DeliveryRecord {
  return {
    deliveryId: row.id,
    channel: row.channel as ChannelName,
    chatRef: row.chatRef,
    idempotencyKey: row.idempotencyKey,
    kind: row.kind as OutboundMessageKind,
    priority: row.priority as MessagePriority,
    status: row.status as DeliveryStatus,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    nextAttemptAt: iso(row.nextAttemptAt),
    lastErrorCode: row.lastErrorCode,
    lastErrorAt: iso(row.lastErrorAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sentAt: iso(row.sentAt),
    ...(row.traceId === null ? {} : { traceId: row.traceId }),
    version: row.version,
  };
}

export class PostgresDeliveryStore implements DeliveryStorePort {
  constructor(private readonly db: ChannelDb) {}

  async create(delivery: NewDelivery): Promise<{ record: DeliveryRecord; created: boolean }> {
    const createdAt = new Date(delivery.createdAt);
    const inserted = await this.db
      .insert(channelDeliveries)
      .values({
        id: delivery.deliveryId,
        channel: delivery.channel,
        chatRef: delivery.chatRef,
        idempotencyKey: delivery.idempotencyKey,
        kind: delivery.kind,
        body: delivery.dispatch,
        bot: delivery.bot ?? null,
        priority: delivery.priority,
        status: "queued",
        attempts: 0,
        maxAttempts: delivery.maxAttempts,
        nextAttemptAt: null,
        createdAt,
        updatedAt: createdAt,
        traceId: delivery.traceId ?? null,
        version: 1,
      })
      .onConflictDoNothing({
        target: [channelDeliveries.channel, channelDeliveries.idempotencyKey],
      })
      .returning();

    const fresh = inserted[0];
    if (fresh !== undefined) {
      return { record: toRecord(fresh), created: true };
    }

    // The key already exists: report the row we already have. Losing this race
    // is the normal case for a caller retry, not an error.
    const existing = await this.findByIdempotencyKey(delivery.channel, delivery.idempotencyKey);
    if (existing === null) {
      throw channelError("CHANNEL_INTERNAL_ERROR", "تعارض مفتاح منع تكرار بلا سجل مطابق", {
        details: { channel: delivery.channel, idempotencyKey: delivery.idempotencyKey },
      });
    }
    return { record: existing, created: false };
  }

  async findByIdempotencyKey(
    channel: ChannelName,
    idempotencyKey: string,
  ): Promise<DeliveryRecord | null> {
    const rows = await this.db
      .select()
      .from(channelDeliveries)
      .where(
        and(
          eq(channelDeliveries.channel, channel),
          eq(channelDeliveries.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async applyProgress(deliveryId: string, progress: DeliveryProgress): Promise<DeliveryRecord> {
    const updated = await this.db
      .update(channelDeliveries)
      .set({
        status: progress.status,
        attempts: progress.attempts,
        nextAttemptAt: progress.nextAttemptAt === null ? null : new Date(progress.nextAttemptAt),
        lastErrorCode: progress.lastErrorCode,
        lastErrorAt: progress.lastErrorAt === null ? null : new Date(progress.lastErrorAt),
        sentAt: progress.sentAt === null ? null : new Date(progress.sentAt),
        updatedAt: new Date(progress.updatedAt),
        version: sql`${channelDeliveries.version} + 1`,
      })
      .where(eq(channelDeliveries.id, deliveryId))
      .returning();

    const row = updated[0];
    if (row === undefined) {
      throw channelError("CHANNEL_INTERNAL_ERROR", "محاولة تحديث تسليم غير موجود", {
        details: { deliveryId },
      });
    }
    return toRecord(row);
  }

  async dueForRetry(now: string, limit: number): Promise<DeliveryRecord[]> {
    const rows = await this.db
      .select()
      .from(channelDeliveries)
      .where(
        and(
          eq(channelDeliveries.status, "queued"),
          isNotNull(channelDeliveries.nextAttemptAt),
          lte(channelDeliveries.nextAttemptAt, new Date(now)),
        ),
      )
      .orderBy(PRIORITY_RANK, asc(channelDeliveries.nextAttemptAt))
      .limit(limit);

    return rows.map(toRecord);
  }

  async loadDispatch(deliveryId: string): Promise<StoredDispatch | null> {
    const rows = await this.db
      .select({ body: channelDeliveries.body, bot: channelDeliveries.bot })
      .from(channelDeliveries)
      .where(eq(channelDeliveries.id, deliveryId))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;

    return {
      dispatch: row.body as ChannelDispatch,
      ...(row.bot === null ? {} : { bot: row.bot as BotKind }),
    };
  }
}
