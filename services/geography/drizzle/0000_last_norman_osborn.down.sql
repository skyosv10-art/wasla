-- الترجعُ (down) لـ 0000_last_norman_osborn — أساسُ مخطَّطِ خدمةِ الجغرافيا.
--
-- مُراجَعٌ بيدٍ لا مولَّدٌ (ADR-024 §2.2): drizzle-kit يولِّدُ الأمامَ وحدَه،
-- وهذا رفيقُهُ العكسيُّ الذي يُثبِتُ اختبارُ الدورةِ (migrations.integration.test.ts)
-- أنّهُ يُعيدُ القاعدةَ **نظيفةً** لا أنّهُ موجودٌ فحسب.
--
-- الترتيبُ عكسيٌّ تماماً: المُطلِقاتُ الستّةُ أوّلاً (تعتمدُ على الجداولِ)،
-- ثمّ الدالةُّ، ثمّ الفهارسُ، ثمّ الجداولُ بترتيبِ التبعيّاتِ المعكوسِ
-- (الأبناءُ قبلَ الآباء: أسماءُ المناطقِ قبلَ الكياناتِ، والكياناتُ
-- من الأصغرِ إلى الأكبرِ: zone→district→city→region→country).

DROP TRIGGER IF EXISTS trg_geo_user_locations_updated_at ON geo_user_locations;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_geo_zones_updated_at ON geo_zones;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_geo_districts_updated_at ON geo_districts;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_geo_cities_updated_at ON geo_cities;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_geo_regions_updated_at ON geo_regions;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_geo_countries_updated_at ON geo_countries;--> statement-breakpoint
DROP FUNCTION IF EXISTS geo_set_updated_at();--> statement-breakpoint
DROP INDEX IF EXISTS ix_geo_outbox_unpublished;--> statement-breakpoint
DROP INDEX IF EXISTS uq_geo_zones_district_code;--> statement-breakpoint
DROP INDEX IF EXISTS ix_geo_user_locations_zone;--> statement-breakpoint
DROP INDEX IF EXISTS ix_geo_user_location_history_user;--> statement-breakpoint
DROP INDEX IF EXISTS uq_geo_regions_country_code;--> statement-breakpoint
DROP INDEX IF EXISTS uq_geo_cities_region_code;--> statement-breakpoint
DROP INDEX IF EXISTS uq_geo_districts_city_code;--> statement-breakpoint
DROP INDEX IF EXISTS uq_geo_countries_code;--> statement-breakpoint
DROP TABLE IF EXISTS geo_outbox;--> statement-breakpoint
DROP TABLE IF EXISTS geo_user_location_history;--> statement-breakpoint
DROP TABLE IF EXISTS geo_user_locations;--> statement-breakpoint
DROP TABLE IF EXISTS geo_zone_names;--> statement-breakpoint
DROP TABLE IF EXISTS geo_district_names;--> statement-breakpoint
DROP TABLE IF EXISTS geo_city_names;--> statement-breakpoint
DROP TABLE IF EXISTS geo_region_names;--> statement-breakpoint
DROP TABLE IF EXISTS geo_country_names;--> statement-breakpoint
DROP TABLE IF EXISTS geo_zones;--> statement-breakpoint
DROP TABLE IF EXISTS geo_districts;--> statement-breakpoint
DROP TABLE IF EXISTS geo_cities;--> statement-breakpoint
DROP TABLE IF EXISTS geo_regions;--> statement-breakpoint
DROP TABLE IF EXISTS geo_countries;
