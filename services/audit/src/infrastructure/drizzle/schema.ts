/**
 * Drizzle schema for the Audit service.
 *
 * Mirrors `contracts/schema.sql` — the SQL DDL is the source of truth (ADR-004).
 * This projection is for type-safe queries and migration generation only.
 */

import { bigint, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const auditEvents = pgTable("audit_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  actorId: text("actor_id").notNull(),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
