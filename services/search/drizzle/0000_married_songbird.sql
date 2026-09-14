CREATE TABLE "search_marketplace_product_state" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"store_slug" text NOT NULL,
	"sku" text NOT NULL,
	"category_slug" text NOT NULL,
	"product_state" text NOT NULL,
	"moderation_state" text NOT NULL,
	"moderation_sequence" integer DEFAULT 0 NOT NULL,
	"quantity_on_hand" integer DEFAULT 0 NOT NULL,
	"adjustment_sequence" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_marketplace_product_state_product_state_check" CHECK ("search_marketplace_product_state"."product_state" IN ('draft','published','archived')),
	CONSTRAINT "search_marketplace_product_state_moderation_state_check" CHECK ("search_marketplace_product_state"."moderation_state" IN ('pending','approved','rejected')),
	CONSTRAINT "search_marketplace_product_state_moderation_sequence_check" CHECK ("search_marketplace_product_state"."moderation_sequence" >= 0),
	CONSTRAINT "search_marketplace_product_state_quantity_on_hand_check" CHECK ("search_marketplace_product_state"."quantity_on_hand" >= 0),
	CONSTRAINT "search_marketplace_product_state_adjustment_sequence_check" CHECK ("search_marketplace_product_state"."adjustment_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "search_marketplace_store_state" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"store_slug" text NOT NULL,
	"category_slug" text NOT NULL,
	"store_state" text NOT NULL,
	"state_sequence" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_marketplace_store_state_store_state_check" CHECK ("search_marketplace_store_state"."store_state" IN ('draft','pending_review','approved','rejected','suspended','archived')),
	CONSTRAINT "search_marketplace_store_state_state_sequence_check" CHECK ("search_marketplace_store_state"."state_sequence" >= 1)
);
--> statement-breakpoint
CREATE TABLE "search_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_version" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "search_outbox_event_id_key" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "search_product_index" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"store_slug" text NOT NULL,
	"sku" text NOT NULL,
	"category_slug" text NOT NULL,
	"title_ar" text NOT NULL,
	"title_en" text,
	"price_minor_units" integer NOT NULL,
	"currency_code" text NOT NULL,
	"store_state" text NOT NULL,
	"product_state" text NOT NULL,
	"moderation_state" text NOT NULL,
	"quantity_on_hand" integer NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "search_product_index_title_ar_check" CHECK (char_length("search_product_index"."title_ar") BETWEEN 1 AND 256),
	CONSTRAINT "search_product_index_title_en_check" CHECK ("search_product_index"."title_en" IS NULL OR char_length("search_product_index"."title_en") BETWEEN 1 AND 256),
	CONSTRAINT "search_product_index_price_minor_units_check" CHECK ("search_product_index"."price_minor_units" >= 0),
	CONSTRAINT "search_product_index_currency_code_check" CHECK ("search_product_index"."currency_code" = 'SAR'),
	CONSTRAINT "search_product_index_store_state_check" CHECK ("search_product_index"."store_state" IN ('draft','pending_review','approved','rejected','suspended','archived')),
	CONSTRAINT "search_product_index_product_state_check" CHECK ("search_product_index"."product_state" IN ('draft','published','archived')),
	CONSTRAINT "search_product_index_moderation_state_check" CHECK ("search_product_index"."moderation_state" IN ('pending','approved','rejected')),
	CONSTRAINT "search_product_index_quantity_on_hand_check" CHECK ("search_product_index"."quantity_on_hand" >= 0)
);
--> statement-breakpoint
CREATE TABLE "search_relay_checkpoint" (
	"consumer_id" text PRIMARY KEY NOT NULL,
	"last_outbox_id" uuid NOT NULL,
	"last_created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_relay_consumed_events" (
	"outbox_id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_relay_consumed_events_status_check" CHECK ("search_relay_consumed_events"."status" IN ('pending','applied','skipped','skipped_stale','ignored','poisoned')),
	CONSTRAINT "search_relay_consumed_events_attempt_count_check" CHECK ("search_relay_consumed_events"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "ix_search_product_state_store" ON "search_marketplace_product_state" USING btree ("store_id") WHERE "search_marketplace_product_state"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_search_outbox_unpublished" ON "search_outbox" USING btree ("occurred_at") WHERE "search_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_search_products_slug" ON "search_product_index" USING btree ("store_slug","sku");--> statement-breakpoint
CREATE INDEX "ix_search_products_category" ON "search_product_index" USING btree ("category_slug") WHERE "search_product_index"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_search_products_visible" ON "search_product_index" USING btree ("store_state","product_state","moderation_state","quantity_on_hand") WHERE "search_product_index"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_search_consumed_status" ON "search_relay_consumed_events" USING btree ("status") WHERE "search_relay_consumed_events"."status" NOT IN ('applied','skipped','skipped_stale','ignored','poisoned');--> statement-breakpoint
-- ═════════════════════════════════════════════════════════════════════
-- إلحاقٌ **يدويٌّ مُعلَنٌ** (ADR-024 §2.2 · سابقةُ services/customers):
-- أربعةُ أصنافٍ في العقدِ (contracts/schema.sql) خارجَ نطاقِ تعبيرِ الإسقاطِ
-- (src/db/schema.ts)، فلا يولِّدُها drizzle-kit:
--   1) امتدادُ pg_trgm — ليس كائنَ مخطَّطٍ أصلاً.
--   2) فهرسا gin: أحدُهما على تعبيرٍ (to_tsvector) والآخرُ بصنفِ مُعاملاتٍ
--      (gin_trgm_ops) — ومُعلَنانِ في NOT_MIRRORED_INDEXES في المرآةِ.
--   3) دالّتا plpgsql.
--   4) أربعةُ مُطلِقاتٍ.
-- تُلحَقُ هنا بيدٍ **مُعلَمةٍ صريحاً** فلا يُدَّعى أنّها مولَّدةٌ وهي مُلحَقةٌ،
-- ولا يُمَسُّ الإسقاطُ (meta/0000_snapshot.json) كي لا يُنتِجَ db:generate
-- التاليَ فرقاً وهميّاً. ويقيسُ اختبارُ التكافؤِ
-- (src/__tests__/migrations.integration.test.ts) بقاءَها مطابقةً للعقدِ حرفاً
-- في أبعادِ «الفهارسِ» و«المُطلِقاتِ» و«الدوالِّ».
--
-- والامتدادُ **قبلَ** فهرسِ trgm بالضرورةِ: gin_trgm_ops لا يوجدُ قبلَهُ.
-- ═════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "ix_search_products_fts_en" ON "search_product_index" USING gin (to_tsvector('english', coalesce("title_en", "title_ar")));--> statement-breakpoint
CREATE INDEX "ix_search_products_trgm_ar" ON "search_product_index" USING gin ("title_ar" gin_trgm_ops);--> statement-breakpoint
CREATE FUNCTION search_set_indexed_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.indexed_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE FUNCTION search_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_search_product_index_indexed_at BEFORE UPDATE ON search_product_index
    FOR EACH ROW EXECUTE FUNCTION search_set_indexed_at();--> statement-breakpoint
CREATE TRIGGER trg_search_product_state_updated_at BEFORE UPDATE ON search_marketplace_product_state
    FOR EACH ROW EXECUTE FUNCTION search_set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_search_store_state_updated_at BEFORE UPDATE ON search_marketplace_store_state
    FOR EACH ROW EXECUTE FUNCTION search_set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_search_checkpoint_updated_at BEFORE UPDATE ON search_relay_checkpoint
    FOR EACH ROW EXECUTE FUNCTION search_set_updated_at();
