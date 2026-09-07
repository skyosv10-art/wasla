-- الترجعُ (down) لـ 0000_colossal_havok — أساسُ مخطَّطِ خدمةِ الطلباتِ.
--
-- مُراجَعٌ بيدٍ لا مولَّدٌ (ADR-024 §2.2): drizzle-kit يولِّدُ الأمامَ وحدَه،
-- وهذا رفيقُهُ العكسيُّ الذي يُثبِتُ اختبارُ الدورةِ (migrations.integration.test.ts)
-- أنّهُ يُعيدُ القاعدةَ **نظيفةً** لا أنّهُ موجودٌ فحسب.
--
-- الترتيبُ عكسيٌّ تماماً: FK النشطُ والمُطلِقانِ أوّلاً (تعتمدُ على الجداولِ)،
-- ثمّ الدالةُّ، ثمّ الفهارسُ، ثمّ الجداولُ بترتيبِ التبعيّاتِ المعكوسِ
-- (الأبناءُ قبلَ الآباء: outbox → assignments → status_history → stops → orders)،
-- ثمّ المتتاليةُ آخرَ شيءٍ.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_active_assignment;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_order_assignments_updated_at ON order_assignments;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;--> statement-breakpoint
DROP FUNCTION IF EXISTS order_set_updated_at();--> statement-breakpoint
DROP INDEX IF EXISTS ix_order_outbox_unpublished;--> statement-breakpoint
DROP INDEX IF EXISTS ix_order_outbox_aggregate;--> statement-breakpoint
DROP INDEX IF EXISTS ix_order_assignments_driver;--> statement-breakpoint
DROP INDEX IF EXISTS ix_order_assignments_order;--> statement-breakpoint
-- ux_order_assignments_order_driver وux_order_assignments_order_sequence قيودُ UNIQUE
-- (فهارسُها مملوكةٌ للقيدِ) — تُحذفُ تلقائيّاً مع الجدولِ.
DROP INDEX IF EXISTS ix_order_status_history_order;--> statement-breakpoint
DROP INDEX IF EXISTS ix_order_stops_order;--> statement-breakpoint
DROP INDEX IF EXISTS ix_order_stops_zone;--> statement-breakpoint
DROP INDEX IF EXISTS ix_orders_customer;--> statement-breakpoint
DROP INDEX IF EXISTS ix_orders_status;--> statement-breakpoint
-- ux_orders_idempotency_key وux_orders_agreed_negotiation فهارسُ فريدةٌ (لا قيودٌ)
DROP INDEX IF EXISTS ux_orders_idempotency_key;--> statement-breakpoint
DROP INDEX IF EXISTS ux_orders_agreed_negotiation;--> statement-breakpoint
DROP TABLE IF EXISTS order_outbox;--> statement-breakpoint
DROP TABLE IF EXISTS order_assignments;--> statement-breakpoint
DROP TABLE IF EXISTS order_status_history;--> statement-breakpoint
DROP TABLE IF EXISTS order_stops;--> statement-breakpoint
DROP TABLE IF EXISTS orders;--> statement-breakpoint
DROP SEQUENCE IF EXISTS order_public_id_seq;
