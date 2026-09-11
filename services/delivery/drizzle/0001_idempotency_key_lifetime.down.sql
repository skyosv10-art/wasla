-- رفيقُ الترجعِ لـ`0001_idempotency_key_lifetime.sql` — مُراجَعٌ يدويّاً (ADR-024 §2.2).
--
-- ترتيبٌ عكسيٌّ حرفاً: الفحصُ ثمّ الفهرسُ ثمّ العمودُ. وإسقاطُ العمودِ يُسقِطُ
-- تابعَيهِ حتماً في Postgres، لكنَّ الصراحةَ هنا مقصودةٌ: ترجعٌ يعتمدُ على أثرٍ
-- جانبيٍّ لعبارةٍ أخرى ترجعٌ لا يُقرأُ.
--
-- ولا استعادةَ للبياناتِ: العمودُ يذهبُ بما فيهِ. وهذا مقبولٌ لأنَّ حياةَ المفتاحِ
-- بيانٌ مُشتَقٌّ لا أصلٌ — والترجعُ يُعيدُ سلوكَ ما قبلَ 13/N (مفاتيحُ لا تنتهي)
-- بلا فقدِ مفتاحٍ واحدٍ. أمّا المُكنسةُ فلا أثرَ لها في القاعدةِ تُتراجَعُ.
--
-- والعكسيّةُ مقيسةٌ في `src/__tests__/migrations.integration.test.ts`: بعدَ الترجعِ
-- تُقاسُ نظافةُ القاعدةِ في الأبعادِ السبعةِ، ثمّ تُعادُ الدورةُ مرّةً ثانيةً.

ALTER TABLE "delivery_idempotency_keys" DROP CONSTRAINT IF EXISTS "delivery_idempotency_keys_check";--> statement-breakpoint
DROP INDEX IF EXISTS "ix_delivery_idempotency_keys_expiry";--> statement-breakpoint
ALTER TABLE "delivery_idempotency_keys" DROP COLUMN IF EXISTS "expires_at";
