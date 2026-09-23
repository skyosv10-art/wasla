CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" bigserial PRIMARY KEY,
  "actor_id" text NOT NULL,
  "actor_role" text NOT NULL,
  "action" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_audit_events_created_at" ON "audit_events" ("created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_audit_events_actor_id" ON "audit_events" ("actor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_audit_events_action" ON "audit_events" ("action");
