-- رفيقُ الترجعِ لـ`0000_whole_triathlon.sql` — مُراجَعٌ يدويّاً (ADR-024 §2.2).
--
-- يُسقِطُ الجداولَ الثلاثةَ عشرَ بترتيبٍ عكسيٍّ لتبعيّاتِها كما يفرضُهُ رسمُ المفاتيحِ
-- الأجنبيّةِ في العقدِ (`contracts/schema.sql`): كلُّ ما يُشيرُ إلى `store_orders`
-- (مفاتيحُ التماثُلِ · الحجوزاتُ · الأصنافُ · الانتقالاتُ · المهمّةُ) قبلَهُ، وانتقالاتُ
-- المهمّةِ قبلَ المهمّةِ، والدفاترُ ونقاطُ التقدّمِ وصندوقُ الصادرِ مستقلّةٌ لا يحكمُها أحدٌ.
--
-- **والمتتالُ يُسقَطُ صراحةً**: متتابعاتُ `BIGSERIAL` تموتُ مع جداولِها (ملكيّةُ عمودٍ)،
-- أمّا `store_order_public_id_seq` فمُنشأٌ مستقلاً في الترحيلِ فيبقى بعدَ إسقاطِ الجداولِ
-- كلِّها — وترجعٌ يُبقي متتالاً هو ترجعٌ ناقصٌ يُسقِطُهُ بعدُ المتتابعاتِ في اختبارِ
-- العكسيّةِ، لا ترجعٌ سليمٌ.
--
-- والاعتمادُ هنا على ترتيبِ الـFKs لا على إعادةِ اشتقاقِهِ: الترجعُ يُراجَعُ لا يُخمَّنُ،
-- وأيُّ خطأٍ يُكتشفُهُ اختبارُ العكسيّةِ في `src/__tests__/migrations.integration.test.ts`.

DROP TABLE IF EXISTS "delivery_idempotency_keys";--> statement-breakpoint
DROP TABLE IF EXISTS "delivery_inventory_reservations";--> statement-breakpoint
DROP TABLE IF EXISTS "delivery_inventory_relay_checkpoint";--> statement-breakpoint
DROP TABLE IF EXISTS "delivery_inventory_relay_consumed_events";--> statement-breakpoint
DROP TABLE IF EXISTS "delivery_inventory_observations";--> statement-breakpoint
DROP TABLE IF EXISTS "delivery_relay_checkpoint";--> statement-breakpoint
DROP TABLE IF EXISTS "delivery_relay_consumed_events";--> statement-breakpoint
DROP TABLE IF EXISTS "delivery_outbox";--> statement-breakpoint
DROP TABLE IF EXISTS "delivery_task_transitions";--> statement-breakpoint
DROP TABLE IF EXISTS "delivery_tasks";--> statement-breakpoint
DROP TABLE IF EXISTS "store_order_transitions";--> statement-breakpoint
DROP TABLE IF EXISTS "store_order_items";--> statement-breakpoint
DROP TABLE IF EXISTS "store_orders";--> statement-breakpoint
DROP SEQUENCE IF EXISTS "store_order_public_id_seq";
