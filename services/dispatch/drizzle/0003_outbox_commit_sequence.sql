-- RISK-0012 (CLM-0416 · ADR-057): commit-ordered dispatch_outbox
--
-- Consumers now read the producer's outbox in COMMIT order. `commit_sequence` is
-- (re)assigned by a DEFERRABLE INITIALLY DEFERRED constraint trigger at COMMIT,
-- under a per-table advisory lock, so a transaction that inserted first but
-- committed last gets the higher number and is never skipped by a consumer that
-- already read past its insert-time position. Existing rows are backfilled in
-- their existing append order. Idempotent: the same statements as contracts/schema.sql.
-- @wasla-upgrade-proof: all-non-baseline

-- الترتيبُ الذي يقرؤه المستهلكونَ هو ترتيبُ الالتزامِ (COMMIT) لا ترتيبُ الإدراجِ:
-- `sequence_number` يُخصَّصُ عندَ الإدراجِ، فمعاملةٌ بدأتْ أوّلاً والتزمتْ أخيراً تُظهِرُ
-- رقماً أصغرَ من رقمٍ قرأه المستهلكُ وتجاوزَه — فيضيعُ حدثُها. المُشغِّلُ المؤجَّلُ
-- (DEFERRABLE INITIALLY DEFERRED) يعملُ لحظةَ COMMIT تحتَ قفلٍ استشاريٍّ واحدٍ لكلِّ
-- جدولٍ، فيُعيدُ تخصيصَ `commit_sequence` بترتيبِ الالتزامِ، وبترتيبِ الإدراجِ داخلَ
-- المعاملةِ الواحدةِ. ولا يُمسَكُ القفلُ إلا في مرحلةِ ما قبلَ الالتزامِ، بعدَ كلِّ أقفالِ
-- الصفوفِ، فلا يدخلُ في دورةِ جمودٍ (deadlock).
CREATE SEQUENCE IF NOT EXISTS dispatch_outbox_commit_seq AS BIGINT;--> statement-breakpoint
ALTER TABLE dispatch_outbox ADD COLUMN IF NOT EXISTS commit_sequence BIGINT;--> statement-breakpoint
DO $risk0012$
DECLARE m BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(10012, hashtext('dispatch_outbox'));
    IF EXISTS (SELECT 1 FROM dispatch_outbox WHERE commit_sequence IS NULL) THEN
        SELECT COALESCE(max(commit_sequence), 0) INTO m FROM dispatch_outbox;
        UPDATE dispatch_outbox t
           SET commit_sequence = s.n
          FROM (SELECT event_id, m + row_number() OVER (ORDER BY sequence_number) AS n
                  FROM dispatch_outbox WHERE commit_sequence IS NULL) s
         WHERE t.event_id = s.event_id;
    END IF;
    SELECT COALESCE(max(commit_sequence), 0) INTO m FROM dispatch_outbox;
    IF m > 0 THEN
        PERFORM setval('dispatch_outbox_commit_seq', GREATEST(m, (SELECT last_value FROM dispatch_outbox_commit_seq)));
    END IF;
END
$risk0012$;--> statement-breakpoint
ALTER TABLE dispatch_outbox ALTER COLUMN commit_sequence SET DEFAULT nextval('dispatch_outbox_commit_seq');--> statement-breakpoint
ALTER TABLE dispatch_outbox ALTER COLUMN commit_sequence SET NOT NULL;--> statement-breakpoint
ALTER SEQUENCE dispatch_outbox_commit_seq OWNED BY dispatch_outbox.commit_sequence;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ux_dispatch_outbox_commit_sequence ON dispatch_outbox (commit_sequence);--> statement-breakpoint
CREATE OR REPLACE FUNCTION dispatch_outbox_assign_commit_sequence() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(10012, hashtext('dispatch_outbox'));
    UPDATE dispatch_outbox SET commit_sequence = nextval('dispatch_outbox_commit_seq') WHERE event_id = NEW.event_id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_dispatch_outbox_commit_sequence ON dispatch_outbox;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_dispatch_outbox_commit_sequence
    AFTER INSERT ON dispatch_outbox
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION dispatch_outbox_assign_commit_sequence();
