-- رفيقُ الترجعِ لـ`0003_relay_poisoned_acknowledgement.sql` — مُراجَعٌ يدويّاً (ADR-024 §2.2).
--
-- ترتيبٌ عكسيٌّ حرفاً: القيودُ ثمّ الفهارسُ ثمّ الأعمدةُ. وإسقاطُ العمودِ يُسقِطُ
-- قيودَهُ وفهارسَهُ حتماً في Postgres، لكنَّ الصراحةَ مقصودةٌ على سابقةِ `0002`:
-- ترجعٌ يعتمدُ على أثرٍ جانبيٍّ لعبارةٍ أخرى ترجعٌ لا يُقرأُ.
--
-- ولا استعادةَ لبياناتِ الإقرارِ: تذهبُ بذهابِ أعمدتِها. وهذا **مُعلَنٌ لا مُخفىً**:
-- الإقرارُ حُكمُ مُشغِّلٍ على صفٍّ مسمومٍ، والصفُّ المسمومُ نفسُهُ لا يمسُّهُ هذا
-- الترجعُ بحرفٍ — فيعودُ الدفترُ إلى سلوكِ ما قبلَ 24/N: كلُّ مسمومٍ يُحسَبُ في
-- الحادثةِ سواءٌ عُولِجَ أم أُهمِلَ. فالخسارةُ خسارةُ تمييزٍ لا خسارةُ دليلٍ.
--
-- والعكسيّةُ مقيسةٌ في `src/__tests__/migrations.integration.test.ts`: بعدَ الترجعِ
-- تُقاسُ نظافةُ القاعدةِ في الأبعادِ السبعةِ، ثمّ تُعادُ الدورةُ مرّةً ثانيةً.

ALTER TABLE "delivery_relay_consumed_events" DROP CONSTRAINT IF EXISTS "ck_delivery_relay_consumed_events_ack_poisoned_only";--> statement-breakpoint
ALTER TABLE "delivery_relay_consumed_events" DROP CONSTRAINT IF EXISTS "ck_delivery_relay_consumed_events_ack_triple";--> statement-breakpoint
ALTER TABLE "delivery_relay_consumed_events" DROP CONSTRAINT IF EXISTS "delivery_relay_consumed_events_ack_reason_check";--> statement-breakpoint
ALTER TABLE "delivery_relay_consumed_events" DROP CONSTRAINT IF EXISTS "delivery_relay_consumed_events_ack_by_check";--> statement-breakpoint
ALTER TABLE "delivery_inventory_relay_consumed_events" DROP CONSTRAINT IF EXISTS "ck_delivery_inventory_relay_consumed_ack_poisoned_only";--> statement-breakpoint
ALTER TABLE "delivery_inventory_relay_consumed_events" DROP CONSTRAINT IF EXISTS "ck_delivery_inventory_relay_consumed_events_ack_triple";--> statement-breakpoint
ALTER TABLE "delivery_inventory_relay_consumed_events" DROP CONSTRAINT IF EXISTS "delivery_inventory_relay_consumed_events_ack_reason_chk";--> statement-breakpoint
ALTER TABLE "delivery_inventory_relay_consumed_events" DROP CONSTRAINT IF EXISTS "delivery_inventory_relay_consumed_events_ack_by_check";--> statement-breakpoint
DROP INDEX IF EXISTS "ix_delivery_relay_consumed_unacknowledged";--> statement-breakpoint
DROP INDEX IF EXISTS "ix_delivery_inventory_relay_consumed_unacknowledged";--> statement-breakpoint
ALTER TABLE "delivery_relay_consumed_events" DROP COLUMN IF EXISTS "acknowledgement_reason";--> statement-breakpoint
ALTER TABLE "delivery_relay_consumed_events" DROP COLUMN IF EXISTS "acknowledged_by";--> statement-breakpoint
ALTER TABLE "delivery_relay_consumed_events" DROP COLUMN IF EXISTS "acknowledged_at";--> statement-breakpoint
ALTER TABLE "delivery_inventory_relay_consumed_events" DROP COLUMN IF EXISTS "acknowledgement_reason";--> statement-breakpoint
ALTER TABLE "delivery_inventory_relay_consumed_events" DROP COLUMN IF EXISTS "acknowledged_by";--> statement-breakpoint
ALTER TABLE "delivery_inventory_relay_consumed_events" DROP COLUMN IF EXISTS "acknowledged_at";
