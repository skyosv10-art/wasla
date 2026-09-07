-- الترجعُ (down) لـ 0000_unusual_master_mold — أساسُ مخطَّطِ خدمةِ العملاء.
--
-- مُراجَعٌ بيدٍ لا مولَّدٌ (ADR-024 §2.2): drizzle-kit يولِّدُ الأمامَ وحدَه،
-- وهذا رفيقُهُ العكسيُّ الذي يُثبِتُ اختبارُ الدورةِ (migrations.integration.test.ts)
-- أنّهُ يُعيدُ القاعدةَ **نظيفةً** لا أنّهُ موجودٌ فحسب.
--
-- الترتيبُ عكسيٌّ تماماً: المُطلِقاتُ والدالّةُ أوّلاً (تعتمدُ على الجداولِ)،
-- ثمّ الفهارسُ، ثمّ الجداولُ بترتيبِ التبعيّاتِ (stops قبلَ requests التي تشيرُ إليها).

DROP TRIGGER IF EXISTS trg_customer_order_requests_updated_at ON customer_order_requests;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_customer_saved_places_updated_at ON customer_saved_places;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_customer_profiles_updated_at ON customer_profiles;--> statement-breakpoint
DROP FUNCTION IF EXISTS customer_set_updated_at();--> statement-breakpoint
DROP INDEX IF EXISTS ix_customer_saved_places_owner;--> statement-breakpoint
DROP INDEX IF EXISTS ux_customer_saved_places_idempotency;--> statement-breakpoint
DROP INDEX IF EXISTS ux_customer_saved_places_label;--> statement-breakpoint
DROP INDEX IF EXISTS ix_customer_outbox_unpublished;--> statement-breakpoint
DROP INDEX IF EXISTS ux_customer_order_requests_order_public_id;--> statement-breakpoint
DROP INDEX IF EXISTS ix_customer_order_requests_owner;--> statement-breakpoint
DROP INDEX IF EXISTS ux_customer_order_requests_idempotency;--> statement-breakpoint
DROP INDEX IF EXISTS ix_customer_order_request_stops_zone;--> statement-breakpoint
DROP TABLE IF EXISTS customer_outbox;--> statement-breakpoint
DROP TABLE IF EXISTS customer_order_request_stops;--> statement-breakpoint
DROP TABLE IF EXISTS customer_order_requests;--> statement-breakpoint
DROP TABLE IF EXISTS customer_saved_places;--> statement-breakpoint
DROP TABLE IF EXISTS customer_profiles;
