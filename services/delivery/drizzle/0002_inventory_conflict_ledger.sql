-- الترحيلُ الثالثُ لخدمةِ التوصيلِ — دفترُ رايةِ تضاربِ المخزونِ
-- (ADR-026 §4.18 · رفعُ دَينِ §4.8 · المراجعةُ 16/N).
--
-- مولَّدٌ بـ`drizzle-kit generate` **بلا تعديلٍ يدويٍّ واحدٍ** — وذلكَ مقصودٌ لا
-- مصادفةٌ: جدولٌ جديدٌ لا عمودٌ يُضافُ إلى صفوفٍ قائمةٍ، فلا تعبئةَ رجعيّةَ ولا
-- تقسيمَ خطواتٍ كما احتاجَ `0001` (انظرْ رأسَهُ). ولا مفتاحَ أجنبيّاً هنا قصداً:
-- `adjustment_id` و`store_id` و`product_id` مراجعُ عبرَ حدِّ السوقِ، و`REFERENCES`
-- عبرَ الحدِّ ممنوعٌ (ADR-026 §2.3) — التماثُلُ يقومُ على المفتاحِ الأوّليِّ وحدَهُ.
--
-- والتكافؤُ مع `contracts/schema.sql` مقيسٌ في سبعةِ أبعادِ كتالوجٍ في
-- `src/__tests__/migrations.integration.test.ts` لا مُدَّعىً في تعليقٍ. ورفيقُ
-- الترجعِ `0002_inventory_conflict_ledger.down.sql` مُراجَعٌ يدويّاً (ADR-024 §2.2).

CREATE TABLE "delivery_inventory_conflicts" (
	"adjustment_id" uuid PRIMARY KEY NOT NULL,
	"marketplace_event_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"conflict_kind" text NOT NULL,
	"reason_code" text NOT NULL,
	"quantity_delta" integer NOT NULL,
	"observed_quantity_after" integer NOT NULL,
	"adjustment_sequence" integer NOT NULL,
	"affected_order_count" integer NOT NULL,
	"affected_units_total" integer NOT NULL,
	"affected_order_public_ids" text[] NOT NULL,
	"changes_order_state" boolean DEFAULT false NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"occurred_for" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"trace_id" text,
	CONSTRAINT "delivery_inventory_conflicts_conflict_kind_check" CHECK ("delivery_inventory_conflicts"."conflict_kind" IN ('stock_zeroed_while_reserved','downward_correction_while_reserved','shrinkage_while_reserved')),
	CONSTRAINT "delivery_inventory_conflicts_reason_code_check" CHECK ("delivery_inventory_conflicts"."reason_code" IN ('correction','shrinkage','archive_zeroed')),
	CONSTRAINT "delivery_inventory_conflicts_quantity_delta_check" CHECK ("delivery_inventory_conflicts"."quantity_delta" < 0),
	CONSTRAINT "delivery_inventory_conflicts_observed_quantity_after_check" CHECK ("delivery_inventory_conflicts"."observed_quantity_after" >= 0),
	CONSTRAINT "delivery_inventory_conflicts_adjustment_sequence_check" CHECK ("delivery_inventory_conflicts"."adjustment_sequence" >= 1),
	CONSTRAINT "delivery_inventory_conflicts_affected_order_count_check" CHECK ("delivery_inventory_conflicts"."affected_order_count" >= 1),
	CONSTRAINT "delivery_inventory_conflicts_affected_units_total_check" CHECK ("delivery_inventory_conflicts"."affected_units_total" >= 1),
	CONSTRAINT "delivery_inventory_conflicts_check" CHECK (array_length("delivery_inventory_conflicts"."affected_order_public_ids", 1) >= 1 AND array_length("delivery_inventory_conflicts"."affected_order_public_ids", 1) = "delivery_inventory_conflicts"."affected_order_count"),
	CONSTRAINT "delivery_inventory_conflicts_changes_order_state_check" CHECK ("delivery_inventory_conflicts"."changes_order_state" = FALSE),
	CONSTRAINT "delivery_inventory_conflicts_acknowledged_by_check" CHECK ("delivery_inventory_conflicts"."acknowledged_by" IS NULL OR char_length("delivery_inventory_conflicts"."acknowledged_by") BETWEEN 1 AND 128),
	CONSTRAINT "ck_delivery_inventory_conflicts_ack" CHECK (("delivery_inventory_conflicts"."acknowledged_at" IS NULL) = ("delivery_inventory_conflicts"."acknowledged_by" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "ix_delivery_inventory_conflicts_unacknowledged" ON "delivery_inventory_conflicts" USING btree ("detected_at" DESC) WHERE "delivery_inventory_conflicts"."acknowledged_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_delivery_inventory_conflicts_product" ON "delivery_inventory_conflicts" USING btree ("store_id","product_id");
