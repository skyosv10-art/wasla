-- رفيقُ الترجعِ لـ`0000_third_sir_ram.sql` — مُراجَعٌ يدويّاً (ADR-024 §2.2).
--
-- يُسقِطُ الجداولَ العشرةَ بترتيبٍ عكسيٍّ لتبعيّاتِها كما في ذيلِ العقدِ
-- (`contracts/schema.sql`). لا دوالَّ ولا مُطلِقاتِ ولا متتابعاتِ في هذا العقدِ
-- — جداولٌ فحسب، فلا بذورَ تُسقَطُ بإسقاطِ جدولِها.
--
-- العقدُ يُوثِّقُ هذا الترتيبَ نفسَه في ذيلِه (التعليقُ الختاميُّ)، والاعتمادُ هنا
-- على ترتيبِهِ لا على إعادةِ اشتقاقِهِ من مخطَّطِ الـFKs: الترجعُ يُراجَعُ لا يُخمَّن.

DROP TABLE IF EXISTS "subscription_outbox";--> statement-breakpoint
DROP TABLE IF EXISTS "subscription_idempotency";--> statement-breakpoint
DROP TABLE IF EXISTS "referral_rewards";--> statement-breakpoint
DROP TABLE IF EXISTS "referrals";--> statement-breakpoint
DROP TABLE IF EXISTS "referral_codes";--> statement-breakpoint
DROP TABLE IF EXISTS "subscription_transitions";--> statement-breakpoint
DROP TABLE IF EXISTS "subscription_periods";--> statement-breakpoint
DROP TABLE IF EXISTS "subscriptions";--> statement-breakpoint
DROP TABLE IF EXISTS "subscription_plan_entitlements";--> statement-breakpoint
DROP TABLE IF EXISTS "subscription_plans";
