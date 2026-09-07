-- الترجعُ (down) لـ 0000_foamy_johnny_blaze — أساسُ مخطَّطِ خدمةِ التوزيع.
--
-- مُراجَعٌ بيدٍ لا مولَّدٌ (ADR-024 §2.2): drizzle-kit يولِّدُ الأمامَ وحدَه،
-- وهذا رفيقُهُ العكسيُّ الذي يُثبِتُ اختبارُ الدورةِ (migrations.integration.test.ts)
-- أنّهُ يُعيدُ القاعدةَ **نظيفةً** لا أنّهُ موجودٌ فحسب.
--
-- الترتيبُ عكسيٌّ تماماً: المُطلِقاتُ والدالّةُ أوّلاً (تعتمدُ على الجداولِ)،
-- ثمّ الفهارسُ، ثمّ الجداولُ بترتيبِ التبعيّاتِ (offers قبلَ waves قبلَ jobs).

DROP TRIGGER IF EXISTS trg_dispatch_offers_updated_at ON dispatch_offers;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_dispatch_waves_updated_at ON dispatch_waves;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_dispatch_jobs_updated_at ON dispatch_jobs;--> statement-breakpoint
DROP FUNCTION IF EXISTS dispatch_set_updated_at();--> statement-breakpoint
DROP INDEX IF EXISTS ix_dispatch_waves_open_due;--> statement-breakpoint
DROP INDEX IF EXISTS ux_dispatch_waves_one_open_job;--> statement-breakpoint
DROP INDEX IF EXISTS ix_dispatch_outbox_aggregate;--> statement-breakpoint
DROP INDEX IF EXISTS ix_dispatch_outbox_unpublished;--> statement-breakpoint
DROP INDEX IF EXISTS ux_dispatch_offers_one_accepted_job;--> statement-breakpoint
DROP INDEX IF EXISTS ix_dispatch_offers_open_due;--> statement-breakpoint
DROP INDEX IF EXISTS ix_dispatch_offers_wave;--> statement-breakpoint
DROP INDEX IF EXISTS ix_dispatch_jobs_escalation_due;--> statement-breakpoint
DROP INDEX IF EXISTS ix_dispatch_jobs_status_due;--> statement-breakpoint
DROP TABLE IF EXISTS dispatch_offers;--> statement-breakpoint
DROP TABLE IF EXISTS dispatch_waves;--> statement-breakpoint
DROP TABLE IF EXISTS dispatch_outbox;--> statement-breakpoint
DROP TABLE IF EXISTS dispatch_idempotency;--> statement-breakpoint
DROP TABLE IF EXISTS dispatch_jobs;
