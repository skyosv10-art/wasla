-- الترجعُ (down) لـ 0000_futuristic_skin — أساسُ مخطَّطِ طبقةِ القنواتِ.
--
-- مُراجَعٌ بيدٍ لا مولَّدٌ (ADR-024 §2.2): drizzle-kit يولِّدُ الأمامَ وحدَه،
-- وهذا رفيقُهُ العكسيُّ الذي يُثبِتُ اختبارُ الدورةِ أنّهُ يُعيدُ القاعدةَ نظيفةً.
--
-- طبقةُ القنواتِ أبسطُ من الخدماتِ: لا FKs (chat_ref مرجعٌ opaque بلا ربطٍ — ADR-007)،
-- ولا دوالَّ/مُطلِقاتِ (لا updated_at تلقائيّ)، ولا متتابعاتٍ (UUIDs عبر gen_random_uuid).
-- فالترجعُ = إسقاطُ الفهارسِ ثمّ الجداولِ الثلاثةِ بترتيبٍ عكسيٍّ (احتياطاً).

DROP INDEX IF EXISTS ix_channel_outbox_unpublished;--> statement-breakpoint
DROP INDEX IF EXISTS ix_channel_deliveries_retry_queue;--> statement-breakpoint
DROP INDEX IF EXISTS ux_channel_deliveries_idempotency;--> statement-breakpoint
DROP INDEX IF EXISTS ix_channel_updates_chat;--> statement-breakpoint
DROP INDEX IF EXISTS ux_channel_updates_dedup;--> statement-breakpoint
DROP TABLE IF EXISTS channel_outbox;--> statement-breakpoint
DROP TABLE IF EXISTS channel_deliveries;--> statement-breakpoint
DROP TABLE IF EXISTS channel_updates;
