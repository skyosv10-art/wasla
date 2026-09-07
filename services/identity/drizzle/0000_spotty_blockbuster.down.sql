-- الترجعُ (down) لـ 0000_spotty_blockbuster — أساسُ مخطَّطِ خدمةِ الهويّةِ.
--
-- مُراجَعٌ بيدٍ لا مولَّدٌ (ADR-024 §2.2): drizzle-kit يولِّدُ الأمامَ وحدَه،
-- وهذا رفيقُهُ العكسيُّ الذي يُثبِتُ اختبارُ الدورةِ (migrations.integration.test.ts)
-- أنّهُ يُعيدُ القاعدةَ **نظيفةً** لا أنّهُ موجودٌ فحسب.
--
-- الترتيبُ عكسيٌّ تماماً: المُطلِقُ والدالّةُ أوّلاً (تعتمدُ على الجدولِ)،
-- ثمّ الفهارسُ، ثمّ الجداولُ بترتيبِ التبعيّاتِ (الأبناءُ قبلَ identity_users
-- التي تشيرُ إليها جميعاً بـFK).

DROP TRIGGER IF EXISTS trg_identity_users_updated_at ON identity_users;--> statement-breakpoint
DROP FUNCTION IF EXISTS identity_set_updated_at();--> statement-breakpoint
DROP INDEX IF EXISTS uq_identity_users_public_id;--> statement-breakpoint
DROP INDEX IF EXISTS uq_identity_sessions_init_data;--> statement-breakpoint
DROP INDEX IF EXISTS ix_identity_sessions_user;--> statement-breakpoint
DROP INDEX IF EXISTS uq_identity_sessions_token;--> statement-breakpoint
DROP INDEX IF EXISTS ix_identity_outbox_unpublished;--> statement-breakpoint
DROP INDEX IF EXISTS ix_identity_links_user;--> statement-breakpoint
DROP INDEX IF EXISTS ix_identity_history_user_field;--> statement-breakpoint
DROP TABLE IF EXISTS identity_sessions;--> statement-breakpoint
DROP TABLE IF EXISTS identity_recovery_requests;--> statement-breakpoint
DROP TABLE IF EXISTS identity_outbox;--> statement-breakpoint
DROP TABLE IF EXISTS identity_links;--> statement-breakpoint
DROP TABLE IF EXISTS identity_history;--> statement-breakpoint
DROP TABLE IF EXISTS identity_users;
