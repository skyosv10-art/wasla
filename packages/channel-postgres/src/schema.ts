/**
 * Drizzle schema for the channel layer — a type-safe projection of the canonical
 * data contract `packages/channel-core/contracts/schema.sql` (ADR-004/006 rule:
 * the SQL file is the source of truth, this file mirrors it).
 *
 * Neutrality (ADR-007): no column, table or type here is Telegram-shaped. The
 * channel is a value in the `channel` column, `chat_ref` is opaque, and there is
 * no FK to `identity_users` — that mapping belongs to the Identity service
 * (ADR-001).
 *
 * Drift between this projection and the DDL is caught by
 * `src/__tests__/schema-drift.test.ts`, which parses schema.sql and compares
 * column sets — so this file cannot silently fall behind the contract.
 */

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** `channel IN (...)` — the channels the contract allows. */
const CHANNELS = sql`('telegram','web','mobile','whatsapp')`;
/** `bot IN (...)` — the three bots of Phase 03. */
const BOTS = sql`('customer','driver','partner')`;

// ─────────────────────────────────────────────────────────────────────
// 1) channel_updates — inbound intake + de-duplication
// ─────────────────────────────────────────────────────────────────────

export const channelUpdates = pgTable(
  "channel_updates",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    channel: text("channel").notNull(),
    bot: text("bot").notNull(),
    channelUpdateId: text("channel_update_id").notNull(),
    chatRef: text("chat_ref").notNull(),
    kind: text("kind").notNull(),
    command: text("command"),
    status: text("status").notNull().default("processed"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    traceId: text("trace_id"),
  },
  (table) => [
    check("channel_updates_channel_check", sql`${table.channel} IN ${CHANNELS}`),
    check("channel_updates_bot_check", sql`${table.bot} IN ${BOTS}`),
    check(
      "channel_updates_kind_check",
      sql`${table.kind} IN ('command','text_message','callback','contact','location','group_event','unsupported')`,
    ),
    check(
      "channel_updates_status_check",
      sql`${table.status} IN ('processed','skipped','failed')`,
    ),
    uniqueIndex("ux_channel_updates_dedup").on(table.channel, table.bot, table.channelUpdateId),
    index("ix_channel_updates_chat").on(table.channel, table.chatRef, table.receivedAt.desc()),
  ],
);

// ─────────────────────────────────────────────────────────────────────
// 2) channel_deliveries — outbound state + retry queue
// ─────────────────────────────────────────────────────────────────────

export const channelDeliveries = pgTable(
  "channel_deliveries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    channel: text("channel").notNull(),
    chatRef: text("chat_ref").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    kind: text("kind").notNull(),
    /** The accepted, channel-neutral message body — a retry re-sends *this*. */
    body: jsonb("body").notNull(),
    /** Owning bot, only used to attribute a Mini App launch event. */
    bot: text("bot"),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    traceId: text("trace_id"),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check("channel_deliveries_channel_check", sql`${table.channel} IN ${CHANNELS}`),
    check("channel_deliveries_kind_check", sql`${table.kind} IN ('text','text_with_buttons')`),
    check(
      "channel_deliveries_bot_check",
      sql`${table.bot} IS NULL OR ${table.bot} IN ${BOTS}`,
    ),
    check(
      "channel_deliveries_priority_check",
      sql`${table.priority} IN ('critical','high','normal','low')`,
    ),
    check(
      "channel_deliveries_status_check",
      sql`${table.status} IN ('queued','sent','failed')`,
    ),
    check("channel_deliveries_attempts_check", sql`${table.attempts} >= 0`),
    check("channel_deliveries_max_attempts_check", sql`${table.maxAttempts} >= 1`),
    uniqueIndex("ux_channel_deliveries_idempotency").on(table.channel, table.idempotencyKey),
    index("ix_channel_deliveries_retry_queue").on(table.status, table.nextAttemptAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────
// 3) channel_outbox — domain events (never published directly)
// ─────────────────────────────────────────────────────────────────────

export const channelOutbox = pgTable(
  "channel_outbox",
  {
    /**
     * The event id from the envelope. The contract's PK is a UUID with a
     * `gen_random_uuid()` default, and `event_id` is itself a UUID minted by
     * `IdGeneratorPort`, so storing it as the PK keeps the outbox naturally
     * idempotent instead of adding a column the contract does not have.
     */
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    aggregateType: text("aggregate_type").notNull().default("channel_chat"),
    /** `chat_ref` — opaque conversation reference, no FK. */
    aggregateId: text("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    eventVersion: text("event_version").notNull().default("v1"),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    traceId: text("trace_id"),
  },
  (table) => [
    check("channel_outbox_aggregate_type_check", sql`${table.aggregateType} = 'channel_chat'`),
    check("channel_outbox_event_version_check", sql`${table.eventVersion} ~ '^v[0-9]+$'`),
    index("ix_channel_outbox_unpublished").on(table.occurredAt),
  ],
);

/** Every table of the channel data contract, for `drizzle(pool, { schema })`. */
export const channelSchema = { channelUpdates, channelDeliveries, channelOutbox };
