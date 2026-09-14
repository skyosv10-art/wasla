-- الترجعُ (down) لـ `0000_married_songbird` — أساسُ مخطَّطِ خدمةِ البحثِ.
--
-- مُراجَعٌ بيدٍ لا مولَّدٌ (ADR-024 §2.2): drizzle-kit يولِّدُ الأمامَ وحدَه، وهذا رفيقُهُ
-- العكسيُّ الذي يُثبِتُ اختبارُ الدورةِ (src/__tests__/migrations.integration.test.ts) أنّهُ
-- يُعيدُ القاعدةَ **نظيفةً في الأبعادِ السبعةِ** لا أنّهُ موجودٌ فحسب.
--
-- الترتيبُ عكسيٌّ تماماً: المُطلِقاتُ (تعتمدُ على الجداولِ والدوالِّ) ثمَّ الدالّتانِ، ثمَّ
-- فهرسا gin، ثمَّ **الامتدادُ** (لا يُسقَطُ قبلَ فهرسِ trgm الذي يستعملُ صنفَ مُعاملاتِهِ)،
-- ثمَّ الفهارسُ البُنيويّةُ، ثمَّ الجداولُ.
--
-- **ولا مفاتيحَ أجنبيّةً في هذا العقدِ بقصدٍ**: الفهرسُ نموذجُ قراءةٍ مشتقٌّ لا يملكُ
-- تزاوجاً مرجعيّاً عبرَ الحدِّ (ADR-025 §2.3)، فترتيبُ إسقاطِ الجداولِ لا تحكمُهُ تبعيّةٌ.
-- ومع ذلكَ يُكتَبُ بترتيبٍ عكسيٍّ لترتيبِ العقدِ كي يُقرأَ مقابلَهُ سطراً بسطرٍ.
--
-- **والامتدادُ يُسقَطُ صراحةً**: `CREATE EXTENSION pg_trgm` يزرعُ عشراتَ الدوالِّ في
-- `public`، فترجعٌ يُبقيهِ يُخفِقُ في بُعدِ «الدوالِّ» من اختبارِ العكسيّةِ — وهو المقصودُ:
-- الترحيلُ يُنشئُ الامتدادَ فيلزمُهُ أن يُزيلَهُ، ولا يُقاسُ الأثرُ بالجداولِ وحدَها.
-- ولو كانَ الامتدادُ ملكاً لقاعدةٍ مشتركةٍ لَما جازَ إسقاطُهُ — وحينَها يُعلَنُ الترحيلُ
-- «غيرَ عكوسٍ» جزئيّاً بقرارٍ مُسجَّلٍ لا يُخفى؛ وليسَ الأمرُ كذلكَ هنا: القاعدةُ ملكُ
-- الخدمةِ، والامتدادُ مذكورٌ في عقدِها.

DROP TRIGGER IF EXISTS trg_search_checkpoint_updated_at ON search_relay_checkpoint;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_search_store_state_updated_at ON search_marketplace_store_state;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_search_product_state_updated_at ON search_marketplace_product_state;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_search_product_index_indexed_at ON search_product_index;--> statement-breakpoint
DROP FUNCTION IF EXISTS search_set_updated_at();--> statement-breakpoint
DROP FUNCTION IF EXISTS search_set_indexed_at();--> statement-breakpoint
DROP INDEX IF EXISTS ix_search_products_trgm_ar;--> statement-breakpoint
DROP INDEX IF EXISTS ix_search_products_fts_en;--> statement-breakpoint
DROP EXTENSION IF EXISTS pg_trgm;--> statement-breakpoint
DROP INDEX IF EXISTS ix_search_consumed_status;--> statement-breakpoint
DROP INDEX IF EXISTS ix_search_outbox_unpublished;--> statement-breakpoint
DROP INDEX IF EXISTS ix_search_product_state_store;--> statement-breakpoint
DROP INDEX IF EXISTS ix_search_products_visible;--> statement-breakpoint
DROP INDEX IF EXISTS ix_search_products_category;--> statement-breakpoint
DROP INDEX IF EXISTS ix_search_products_slug;--> statement-breakpoint
DROP TABLE IF EXISTS search_relay_checkpoint;--> statement-breakpoint
DROP TABLE IF EXISTS search_relay_consumed_events;--> statement-breakpoint
DROP TABLE IF EXISTS search_outbox;--> statement-breakpoint
DROP TABLE IF EXISTS search_marketplace_product_state;--> statement-breakpoint
DROP TABLE IF EXISTS search_marketplace_store_state;--> statement-breakpoint
DROP TABLE IF EXISTS search_product_index;
