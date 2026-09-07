-- رفيقُ الترجعِ لـ`0000_first_norman_osborn.sql` — مُراجَعٌ يدويّاً (ADR-024 §2.2).
--
-- يُسقِطُ الجداولَ التسعةَ بترتيبٍ عكسيٍّ لتبعيّاتِها كما في ذيلِ العقدِ
-- (`contracts/schema.sql`). لا دوالَّ ولا مُطلِقاتِ ولا متتابعاتِ في هذا العقدِ
-- — جداولٌ وبذورٌ فحسب، فالبذورُ تُسقَطُ بإسقاطِ جدولِها.
--
-- العقدُ يُوثِّقُ هذا الترتيبَ نفسَه في ذيلِه (التعليقُ الختاميُّ)، والاعتمادُ هنا
-- على ترتيبِهِ لا على إعادةِ اشتقاقِهِ من مخطَّطِ الـFKs: الترجعُ يُراجَعُ لا يُخمَّن.

DROP TABLE IF EXISTS "reputation_outbox";--> statement-breakpoint
DROP TABLE IF EXISTS "reputation_idempotency";--> statement-breakpoint
DROP TABLE IF EXISTS "fraud_signals";--> statement-breakpoint
DROP TABLE IF EXISTS "reputation_ratings";--> statement-breakpoint
DROP TABLE IF EXISTS "reputation_scores";--> statement-breakpoint
DROP TABLE IF EXISTS "reputation_facts";--> statement-breakpoint
DROP TABLE IF EXISTS "reputation_fraud_thresholds";--> statement-breakpoint
DROP TABLE IF EXISTS "reputation_rule_weights";--> statement-breakpoint
DROP TABLE IF EXISTS "reputation_rulesets";
