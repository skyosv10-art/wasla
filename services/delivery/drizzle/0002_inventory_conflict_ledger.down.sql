-- رفيقُ الترجعِ لـ`0002_inventory_conflict_ledger.sql` — مُراجَعٌ يدويّاً (ADR-024 §2.2).
--
-- ترتيبٌ عكسيٌّ حرفاً: الفهرسانِ ثمّ الجدولُ. وإسقاطُ الجدولِ يُسقِطُ فهارسَهُ
-- وقيودَهُ حتماً في Postgres، لكنَّ الصراحةَ مقصودةٌ على سابقةِ `0001`: ترجعٌ
-- يعتمدُ على أثرٍ جانبيٍّ لعبارةٍ أخرى ترجعٌ لا يُقرأُ.
--
-- ولا استعادةَ للبياناتِ: الراياتُ تذهبُ بما فيها. وهذا مقبولٌ لأنَّ الرايةَ
-- **تقريرٌ مُشتَقٌّ لا أصلٌ** — مصدرُها أحداثُ `marketplace.inventory_adjusted`
-- المحفوظةُ في دفترِ السوقِ، وإعادةُ تسليمِها تُعيدُ بناءَ الدفترِ. والترجعُ
-- يُعيدُ سلوكَ ما قبلَ 16/N (رصدٌ بلا كشفِ تضاربٍ) بلا أن يفقدَ الرصدُ صفّاً:
-- `delivery_inventory_observations` لا يمسُّهُ هذا الترحيلُ أصلاً.
--
-- والعكسيّةُ مقيسةٌ في `src/__tests__/migrations.integration.test.ts`: بعدَ الترجعِ
-- تُقاسُ نظافةُ القاعدةِ في الأبعادِ السبعةِ، ثمّ تُعادُ الدورةُ مرّةً ثانيةً.

DROP INDEX IF EXISTS "ix_delivery_inventory_conflicts_product";--> statement-breakpoint
DROP INDEX IF EXISTS "ix_delivery_inventory_conflicts_unacknowledged";--> statement-breakpoint
DROP TABLE IF EXISTS "delivery_inventory_conflicts";
