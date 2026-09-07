-- ═════════════════════════════════════════════════════════════════════
-- رفيقُ الترجعِ (down) للترحيلِ 0000_fuzzy_expediter
-- matching service · ADR-024 الموجة 3
--
-- يُسقِطُ كلَّ ما أنشأهُ الترحيلُ الأماميُّ بترتيبٍ عكسيٍّ للتبعيّاتِ:
--   1) matching_idempotency            (لا تتبعيّاتٍ نازلةً منه)
--   2) matching_outbox                 (لا تتبعيّاتٍ نازلةً منه)
--   3) matching_decision_candidates    (FK → matching_decisions)
--   4) matching_decisions              (FK → matching_rulesets)
--   5) matching_rulesets               (مُشارٌ إليه من matching_decisions)
--   6) driver_candidacy                (لا تتبعيّاتٍ نازلةً منه)
--
-- القيودُ والفهارسُ تُسقَطُ تلقائياً مع جداولِها. تُسقَطُ الجداولُ بترتيبٍ
-- يضمنُ ألّا يبقى أيُّ قيدٍ ناظرٍ إلى جدولٍ لم يُسقَطْ بعدُ.
-- ═════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS "matching_idempotency";--> statement-breakpoint
DROP TABLE IF EXISTS "matching_outbox";--> statement-breakpoint
DROP TABLE IF EXISTS "matching_decision_candidates";--> statement-breakpoint
DROP TABLE IF EXISTS "matching_decisions";--> statement-breakpoint
DROP TABLE IF EXISTS "matching_rulesets";--> statement-breakpoint
DROP TABLE IF EXISTS "driver_candidacy";--> statement-breakpoint
