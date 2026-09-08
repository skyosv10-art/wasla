-- رفيقُ الترجعِ لـ`0000_supreme_dorian_gray.sql` — مُراجَعٌ يدويّاً (ADR-024 §2.2).
--
-- يُسقِطُ الجداولَ العشرةَ بترتيبٍ عكسيٍّ لتبعيّاتِها كما يفرضُهُ رسمُ المفاتيحِ الأجنبيّةِ
-- في العقدِ (`contracts/schema.sql`). لا دوالَّ ولا مُطلِقاتِ ولا متتابعاتِ في هذا العقدِ
-- — جداولٌ وبذورٌ فحسب، فالبذورُ تُسقَطُ بإسقاطِ جدولِها.
--
-- الاعتمادُ هنا على ترتيبِ الـFKs لا على إعادةِ اشتقاقِهِ: الترجعُ يُراجَعُ لا يُخمَّن،
-- وأيُّ خطأٍ يُكتشفُهُ اختبارُ العكسيّةِ في `migrations.integration.test.ts`.

DROP TABLE IF EXISTS "subscription_outbox";--> statement-breakpoint
DROP TABLE IF EXISTS "subscription_idempotency";--> statement-breakpoint
DROP TABLE IF EXISTS "referral_rewards";--> statement-breakpoint
DROP TABLE IF EXISTS "referrals";--> statement-breakpoint
DROP TABLE IF EXISTS "referral_codes";--> statement-breakpoint
DROP TABLE IF EXISTS "subscription_transitions";--> statement-breakpoint
DROP TABLE IF EXISTS "subscriptions";--> statement-breakpoint
DROP TABLE IF EXISTS "subscription_periods";--> statement-breakpoint
DROP TABLE IF EXISTS "subscription_plan_entitlements";--> statement-breakpoint
DROP TABLE IF EXISTS "subscription_plans";
