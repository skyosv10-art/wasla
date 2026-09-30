-- RISK-0012 (CLM-0416 · ADR-057): commit-ordered relay cursors + delivery_outbox
--
-- Consumers now read the producer's outbox in COMMIT order. `commit_sequence` is
-- (re)assigned by a DEFERRABLE INITIALLY DEFERRED constraint trigger at COMMIT,
-- under a per-table advisory lock, so a transaction that inserted first but
-- committed last gets the higher number and is never skipped by a consumer that
-- already read past its insert-time position. Existing rows are backfilled in
-- their existing append order. Idempotent: the same statements as contracts/schema.sql.
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE delivery_tasks ADD COLUMN IF NOT EXISTS dispatch_last_commit_sequence BIGINT;--> statement-breakpoint
ALTER TABLE delivery_relay_checkpoint ADD COLUMN IF NOT EXISTS last_commit_sequence BIGINT NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE delivery_inventory_relay_checkpoint ADD COLUMN IF NOT EXISTS last_commit_sequence BIGINT NOT NULL DEFAULT 0;--> statement-breakpoint
-- الترتيبُ الذي يقرؤه المستهلكونَ هو ترتيبُ الالتزامِ (COMMIT) لا ترتيبُ الإدراجِ:
-- `outbox_id` يُخصَّصُ عندَ الإدراجِ، فمعاملةٌ بدأتْ أوّلاً والتزمتْ أخيراً تُظهِرُ
-- رقماً أصغرَ من رقمٍ قرأه المستهلكُ وتجاوزَه — فيضيعُ حدثُها. المُشغِّلُ المؤجَّلُ
-- (DEFERRABLE INITIALLY DEFERRED) يعملُ لحظةَ COMMIT تحتَ قفلٍ استشاريٍّ واحدٍ لكلِّ
-- جدولٍ، فيُعيدُ تخصيصَ `commit_sequence` بترتيبِ الالتزامِ، وبترتيبِ الإدراجِ داخلَ
-- المعاملةِ الواحدةِ. ولا يُمسَكُ القفلُ إلا في مرحلةِ ما قبلَ الالتزامِ، بعدَ كلِّ أقفالِ
-- الصفوفِ، فلا يدخلُ في دورةِ جمودٍ (deadlock).
CREATE SEQUENCE IF NOT EXISTS delivery_outbox_commit_seq AS BIGINT;--> statement-breakpoint
ALTER TABLE delivery_outbox ADD COLUMN IF NOT EXISTS commit_sequence BIGINT;--> statement-breakpoint
DO $risk0012$
DECLARE m BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(10012, hashtext('delivery_outbox'));
    IF EXISTS (SELECT 1 FROM delivery_outbox WHERE commit_sequence IS NULL) THEN
        SELECT COALESCE(max(commit_sequence), 0) INTO m FROM delivery_outbox;
        UPDATE delivery_outbox t
           SET commit_sequence = s.n
          FROM (SELECT outbox_id, m + row_number() OVER (ORDER BY outbox_id) AS n
                  FROM delivery_outbox WHERE commit_sequence IS NULL) s
         WHERE t.outbox_id = s.outbox_id;
    END IF;
    SELECT COALESCE(max(commit_sequence), 0) INTO m FROM delivery_outbox;
    IF m > 0 THEN
        PERFORM setval('delivery_outbox_commit_seq', GREATEST(m, (SELECT last_value FROM delivery_outbox_commit_seq)));
    END IF;
END
$risk0012$;--> statement-breakpoint
ALTER TABLE delivery_outbox ALTER COLUMN commit_sequence SET DEFAULT nextval('delivery_outbox_commit_seq');--> statement-breakpoint
ALTER TABLE delivery_outbox ALTER COLUMN commit_sequence SET NOT NULL;--> statement-breakpoint
ALTER SEQUENCE delivery_outbox_commit_seq OWNED BY delivery_outbox.commit_sequence;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ux_delivery_outbox_commit_sequence ON delivery_outbox (commit_sequence);--> statement-breakpoint
CREATE OR REPLACE FUNCTION delivery_outbox_assign_commit_sequence() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(10012, hashtext('delivery_outbox'));
    UPDATE delivery_outbox SET commit_sequence = nextval('delivery_outbox_commit_seq') WHERE outbox_id = NEW.outbox_id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_delivery_outbox_commit_sequence ON delivery_outbox;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_delivery_outbox_commit_sequence
    AFTER INSERT ON delivery_outbox
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION delivery_outbox_assign_commit_sequence();
