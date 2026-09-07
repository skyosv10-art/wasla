-- ═════════════════════════════════════════════════════════════════════
-- رفيقُ الترجعِ (down) للترحيلِ 0000_gray_carlie_cooper
-- negotiations service · ADR-024 الموجة 3
--
-- يُسقِطُ كلَّ ما أنشأهُ الترحيلُ الأماميُّ بترتيبٍ عكسيٍّ للتبعيّاتِ
-- (هو ترتيبُ الترجعِ المُعلَّنُ في ذيلِ العقدِ نفسِه):
--   1) negotiation_outbox           (لا تتبعيّاتٍ نازلةً منه)
--   2) negotiation_idempotency      (FK → negotiation_threads)
--   3) negotiation_price_handoffs   (FK → negotiation_agreements)
--   4) negotiation_agreements       (FK → negotiation_threads · negotiation_policies)
--   5) negotiation_messages         (FK → negotiation_threads)
--   6) negotiation_rounds           (FK → negotiation_threads)
--   7) negotiation_threads          (FK → negotiation_policies)
--   8) negotiation_policies         (الجدولُ الجذرُ — يُسقَطُ آخراً)
--
-- القيودُ والفهارسُ تُسقَطُ تلقائياً مع جداولِها؛ لا دوالَّ ولا مُطلِقاتِ
-- في هذا العقدِ فلا كائناتٍ مستقلّةً تُسقَطُ صريحاً. وseed النسخةِ 1 يزولُ
-- بإسقاطِ جدولِ السياساتِ نفسِه فلا حاجةَ إلى DELETE منفصل.
-- ═════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS "negotiation_outbox";--> statement-breakpoint
DROP TABLE IF EXISTS "negotiation_idempotency";--> statement-breakpoint
DROP TABLE IF EXISTS "negotiation_price_handoffs";--> statement-breakpoint
DROP TABLE IF EXISTS "negotiation_agreements";--> statement-breakpoint
DROP TABLE IF EXISTS "negotiation_messages";--> statement-breakpoint
DROP TABLE IF EXISTS "negotiation_rounds";--> statement-breakpoint
DROP TABLE IF EXISTS "negotiation_threads";--> statement-breakpoint
DROP TABLE IF EXISTS "negotiation_policies";
