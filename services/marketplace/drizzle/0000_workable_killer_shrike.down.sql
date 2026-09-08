-- رفيقُ الترجعِ لـ`0000_workable_killer_shrike.sql` — مُراجَعٌ يدويّاً (ADR-024 §2.2).
--
-- يُسقِطُ الجداولَ العشرةَ بترتيبٍ عكسيٍّ لتبعيّاتِها كما يفرضُهُ رسمُ المفاتيحِ الأجنبيّةِ
-- في العقدِ (`contracts/schema.sql`): صندوقُ الصادرِ ومفتاحُ منعِ التكرارِ مستقلّانِ،
-- والحساباتُ (دفاترُ القراراتِ والمخزونُ) قبلَ ما تحكمُه (المنتجاتُ ثمّ المتاجرُ ثمّ
-- التصنيفاتُ). لا دوالَّ ولا مُطلِقاتِ ولا متتابعاتٍ في هذا العقدِ — جداولٌ فحسب، والبذرُ
-- (شجرةُ التصنيفاتِ) يعيشُ في `domain/category-seed.ts` فتُسقِطُهُ إسقاطاتُ جدولِه.
--
-- الاعتمادُ هنا على ترتيبِ الـFKs لا على إعادةِ اشتقاقِهِ: الترجعُ يُراجَعُ لا يُخمَّن،
-- وأيُّ خطأٍ يُكتشفُهُ اختبارُ العكسيّةِ في `migrations.integration.test.ts`.

DROP TABLE IF EXISTS "marketplace_outbox";--> statement-breakpoint
DROP TABLE IF EXISTS "marketplace_idempotency";--> statement-breakpoint
DROP TABLE IF EXISTS "product_inventory";--> statement-breakpoint
DROP TABLE IF EXISTS "inventory_adjustments";--> statement-breakpoint
DROP TABLE IF EXISTS "product_reviews";--> statement-breakpoint
DROP TABLE IF EXISTS "products";--> statement-breakpoint
DROP TABLE IF EXISTS "store_staff";--> statement-breakpoint
DROP TABLE IF EXISTS "store_reviews";--> statement-breakpoint
DROP TABLE IF EXISTS "stores";--> statement-breakpoint
DROP TABLE IF EXISTS "store_categories";
