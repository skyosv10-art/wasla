-- الترحيلُ الرابعُ لخدمةِ التوصيلِ — إقرارُ الصفوفِ المسمومةِ في دفترَي الاستهلاكِ
-- (ADR-026 §4.27 · رفعُ دَينِ M5-13 «لا فرقَ بين مسمومٍ عُولِجَ ومسمومٍ أُهمِلَ» · المراجعةُ 24/N).
--
-- مولَّدٌ بـ`drizzle-kit generate` **بلا تعديلٍ يدويٍّ في العباراتِ** — والرأسُ وحدَهُ
-- مُضافٌ. وسلامةُ الترقيةِ على قاعدةٍ **مأهولةٍ** مقصودةٌ بالتصميمِ لا بالحظِّ
-- (RISK-0020 · الفحصُ 13 · البابُ 4):
--
--   1) الأعمدةُ الثلاثةُ **قابلةٌ للعدمِ بلا افتراضيٍّ**، فلا `ADD COLUMN … NOT NULL`
--      بلا `DEFAULT` ولا تعبئةَ رجعيّةَ ولا إعادةَ كتابةِ جدولٍ: في Postgres 11+
--      إضافةُ عمودٍ عَدَميٍّ تغييرُ كتالوجٍ محضٌ.
--   2) قيودُ `CHECK` الأربعةُ في كلِّ دفترٍ تُضافُ **بعدَ** الأعمدةِ، وتمُرُّ على
--      كلِّ صفٍّ قائمٍ حتماً: صفوفُ ما قبلَ الترحيلِ إقرارُها `NULL` ثلاثاً، وهو
--      الحالُ الذي تسمحُ بهِ القيودُ الأربعةُ جميعاً. فلا `23514` على قاعدةٍ مأهولةٍ.
--   3) الفهرسانِ الجزئيّانِ غيرُ `CONCURRENTLY` على سابقةِ `0002`: الترحيلُ يجري في
--      معاملةٍ واحدةٍ، و`CONCURRENTLY` ممنوعٌ فيها. والقفلُ مقبولٌ لأنّ الدفترَينِ
--      يُكتَبانِ بمعدّلِ الأحداثِ لا بمعدّلِ الطلباتِ.
--
-- ولمَ قيدُ `ack_poisoned_only` في **القاعدةِ** لا في الشيفرةِ وحدَها؟ لأنَّ إعادةَ
-- الصفِّ إلى `pending` (§4.25) لو تركتْ إقراراً قديماً لصارَ الدفترُ يشهدُ أنَّ صفّاً
-- حيّاً «عولِجَ». فالقاعدةُ تُلزِمُ ماحيَ الإقرارِ عندَ الإعادةِ، ومَن نسيَ المحوَ في
-- شيفرتِهِ ارتطمَ بـ`23514` لا مرَّ صامتاً.
--
-- ورفيقُ الترجعِ `0003_relay_poisoned_acknowledgement.down.sql` مُراجَعٌ يدويّاً (ADR-024 §2.2).

ALTER TABLE "delivery_inventory_relay_consumed_events" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_inventory_relay_consumed_events" ADD COLUMN "acknowledged_by" text;--> statement-breakpoint
ALTER TABLE "delivery_inventory_relay_consumed_events" ADD COLUMN "acknowledgement_reason" text;--> statement-breakpoint
ALTER TABLE "delivery_relay_consumed_events" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_relay_consumed_events" ADD COLUMN "acknowledged_by" text;--> statement-breakpoint
ALTER TABLE "delivery_relay_consumed_events" ADD COLUMN "acknowledgement_reason" text;--> statement-breakpoint
CREATE INDEX "ix_delivery_inventory_relay_consumed_unacknowledged" ON "delivery_inventory_relay_consumed_events" USING btree ("updated_at") WHERE "delivery_inventory_relay_consumed_events"."consumed_status" = 'poisoned' AND "delivery_inventory_relay_consumed_events"."acknowledged_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_delivery_relay_consumed_unacknowledged" ON "delivery_relay_consumed_events" USING btree ("updated_at") WHERE "delivery_relay_consumed_events"."consumed_status" = 'poisoned' AND "delivery_relay_consumed_events"."acknowledged_at" IS NULL;--> statement-breakpoint
ALTER TABLE "delivery_inventory_relay_consumed_events" ADD CONSTRAINT "delivery_inventory_relay_consumed_events_ack_by_check" CHECK ("delivery_inventory_relay_consumed_events"."acknowledged_by" IS NULL OR char_length("delivery_inventory_relay_consumed_events"."acknowledged_by") BETWEEN 1 AND 128);--> statement-breakpoint
ALTER TABLE "delivery_inventory_relay_consumed_events" ADD CONSTRAINT "delivery_inventory_relay_consumed_events_ack_reason_chk" CHECK ("delivery_inventory_relay_consumed_events"."acknowledgement_reason" IS NULL OR char_length("delivery_inventory_relay_consumed_events"."acknowledgement_reason") BETWEEN 12 AND 512);--> statement-breakpoint
ALTER TABLE "delivery_inventory_relay_consumed_events" ADD CONSTRAINT "ck_delivery_inventory_relay_consumed_events_ack_triple" CHECK (("delivery_inventory_relay_consumed_events"."acknowledged_at" IS NULL) = ("delivery_inventory_relay_consumed_events"."acknowledged_by" IS NULL) AND ("delivery_inventory_relay_consumed_events"."acknowledged_at" IS NULL) = ("delivery_inventory_relay_consumed_events"."acknowledgement_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "delivery_inventory_relay_consumed_events" ADD CONSTRAINT "ck_delivery_inventory_relay_consumed_ack_poisoned_only" CHECK ("delivery_inventory_relay_consumed_events"."acknowledged_at" IS NULL OR "delivery_inventory_relay_consumed_events"."consumed_status" = 'poisoned');--> statement-breakpoint
ALTER TABLE "delivery_relay_consumed_events" ADD CONSTRAINT "delivery_relay_consumed_events_ack_by_check" CHECK ("delivery_relay_consumed_events"."acknowledged_by" IS NULL OR char_length("delivery_relay_consumed_events"."acknowledged_by") BETWEEN 1 AND 128);--> statement-breakpoint
ALTER TABLE "delivery_relay_consumed_events" ADD CONSTRAINT "delivery_relay_consumed_events_ack_reason_check" CHECK ("delivery_relay_consumed_events"."acknowledgement_reason" IS NULL OR char_length("delivery_relay_consumed_events"."acknowledgement_reason") BETWEEN 12 AND 512);--> statement-breakpoint
ALTER TABLE "delivery_relay_consumed_events" ADD CONSTRAINT "ck_delivery_relay_consumed_events_ack_triple" CHECK (("delivery_relay_consumed_events"."acknowledged_at" IS NULL) = ("delivery_relay_consumed_events"."acknowledged_by" IS NULL) AND ("delivery_relay_consumed_events"."acknowledged_at" IS NULL) = ("delivery_relay_consumed_events"."acknowledgement_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "delivery_relay_consumed_events" ADD CONSTRAINT "ck_delivery_relay_consumed_events_ack_poisoned_only" CHECK ("delivery_relay_consumed_events"."acknowledged_at" IS NULL OR "delivery_relay_consumed_events"."consumed_status" = 'poisoned');