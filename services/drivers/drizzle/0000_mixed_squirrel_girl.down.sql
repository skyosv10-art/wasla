-- ═════════════════════════════════════════════════════════════════════
-- رفيقُ الترجعِ (down) للترحيلِ 0000_mixed_squirrel_girl
-- drivers service · ADR-024 الموجة 3
--
-- يُسقِطُ كلَّ ما أنشأهُ الترحيلُ الأماميُّ بترتيبٍ عكسيٍّ للتبعيّاتِ:
--   1) المُطلِقاتُ الثلاثةُ ثمّ الدالةُ driver_set_updated_at (الإلحاقُ المُراجَع)
--   2) driver_idempotency            (لا تتبعيّاتٍ نازلةً منه)
--   3) driver_outbox                 (لا تتبعيّاتٍ نازلةً منه)
--   4) driver_candidacy_publications (FK → driver_profiles)
--   5) driver_eligibility_log        (FK → driver_profiles)
--   6) driver_eligibility_policies   (يُشارُ إليه من driver_profiles حكماً لا قيداً)
--   7) driver_documents              (FK → driver_profiles · driver_vehicles)
--   8) driver_vehicles               (يُشارُ إليه من driver_documents)
--   9) driver_service_zones          (FK → driver_profiles)
--  10) driver_profiles               (الجدولُ الجذرُ — يُسقَطُ آخراً)
--
-- القيودُ والفهارسُ والمُطلِقاتُ تُسقَطُ تلقائياً مع جداولِها؛ الدالةُ تُسقَطُ
-- صريحاً لأنّها كائنٌ مستقلٌّ في المخططِ لا يتبعُ جدولاً. وseed النسخةِ 1
-- يزولُ بإسقاطِ جدولِ السياساتِ نفسِه فلا حاجةَ إلى DELETE منفصل.
-- ═════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS "trg_driver_documents_updated_at" ON "driver_documents";--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_driver_vehicles_updated_at" ON "driver_vehicles";--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_driver_profiles_updated_at" ON "driver_profiles";--> statement-breakpoint
DROP FUNCTION IF EXISTS "driver_set_updated_at"();--> statement-breakpoint
DROP TABLE IF EXISTS "driver_idempotency";--> statement-breakpoint
DROP TABLE IF EXISTS "driver_outbox";--> statement-breakpoint
DROP TABLE IF EXISTS "driver_candidacy_publications";--> statement-breakpoint
DROP TABLE IF EXISTS "driver_eligibility_log";--> statement-breakpoint
DROP TABLE IF EXISTS "driver_eligibility_policies";--> statement-breakpoint
DROP TABLE IF EXISTS "driver_documents";--> statement-breakpoint
DROP TABLE IF EXISTS "driver_vehicles";--> statement-breakpoint
DROP TABLE IF EXISTS "driver_service_zones";--> statement-breakpoint
DROP TABLE IF EXISTS "driver_profiles";--> statement-breakpoint
