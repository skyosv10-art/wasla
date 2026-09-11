-- الترحيلُ الثاني لخدمةِ التوصيلِ — حياةُ مفاتيحِ التماثُلِ (ADR-026 §4.15 · رفعُ دَينِ §4.10).
--
-- مولَّدٌ بـ`drizzle-kit generate` ثمّ **مُعدَّلٌ يدويّاً في موضعٍ واحدٍ** مُعلَنٍ هنا:
-- المولِّدُ أصدرَ عبارةً واحدةً
--
--     ALTER TABLE "delivery_idempotency_keys" ADD COLUMN "expires_at" timestamptz NOT NULL;
--
-- وهذهِ **تسقطُ في كلِّ قاعدةٍ فيها صفٌّ واحدٌ**: عمودٌ لا يقبلُ العدمَ بلا افتراضٍ
-- لا مكانَ لهُ في صفوفٍ قائمةٍ. وقد قِيسَ ذلكَ لا افتُرِضَ: على PostgreSQL 17.6
-- بصفٍّ واحدٍ قائمٍ تسقطُ العبارةُ المولَّدةُ بـ`23502`
-- (`column "expires_at" of relation "delivery_idempotency_keys" contains null values`).
-- والمولِّدُ لا يعلمُ
-- ذلكَ لأنّهُ يقارنُ رسمَينِ لا قاعدتَينِ — فبيئةٌ جديدةٌ فارغةٌ تنجو، وبيئةٌ عاملةٌ
-- فيها مفاتيحُ حيّةٌ تسقطُ. فقُسِّمَت إلى ثلاثِ خطواتٍ هيَ الطريقُ المعروفُ:
--
--   1. إضافةُ العمودِ **قابلاً للعدمِ** — لا يمسُّ صفّاً قائماً.
--   2. تعبئةٌ رجعيّةٌ للصفوفِ القائمةِ: `created_at + 24 ساعةً`، وهيَ المدّةُ
--      الافتراضيّةُ نفسُها (`IDEMPOTENCY_KEY_TTL_SECONDS`) لا رقماً مخترَعاً هنا.
--      ومفتاحٌ قديمٌ مضى على كتابتِهِ يومٌ يصيرُ منتهياً في الحالِ — وهذا هوَ
--      المقصودُ لا عيبٌ: لم تكن لهُ حياةٌ قبلَ اليومِ فلا وعدَ يُخلَفُ.
--   3. `SET NOT NULL` بعدَ التعبئةِ — فالقيدُ يُفرَضُ على واقعٍ لا على فراغٍ.
--
-- وترتيبُ الفهرسِ والفحصِ بعدَ ذلكَ بقصدٍ: فحصُ `expires_at > created_at` على
-- جدولٍ نصفُ عمودِهِ عدمٌ يسقطُ أو يمرُّ كذباً، فلا يُضافُ إلّا بعدَ الخطوةِ الثالثةِ.
--
-- والتكافؤُ مع `contracts/schema.sql` مقيسٌ في سبعةِ أبعادِ كتالوجٍ في
-- `src/__tests__/migrations.integration.test.ts`، وطريقُ الترقيةِ على قاعدةٍ **فيها
-- بياناتٌ** مقيسٌ في `src/__tests__/idempotency-retention.integration.test.ts` — لا
-- مُدَّعىً في تعليقٍ. ورفيقُ الترجعِ `0001_idempotency_key_lifetime.down.sql`
-- مُراجَعٌ يدويّاً (ADR-024 §2.2).

ALTER TABLE "delivery_idempotency_keys" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "delivery_idempotency_keys" SET "expires_at" = "created_at" + interval '24 hours' WHERE "expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "delivery_idempotency_keys" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_delivery_idempotency_keys_expiry" ON "delivery_idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "delivery_idempotency_keys" ADD CONSTRAINT "delivery_idempotency_keys_check" CHECK ("delivery_idempotency_keys"."expires_at" > "delivery_idempotency_keys"."created_at");
