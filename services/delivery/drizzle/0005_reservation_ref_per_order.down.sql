-- رفيقُ الترجعِ لـ`0005_reservation_ref_per_order.sql` — مُراجَعٌ يدويّاً (ADR-024 §2.2).
--
-- يُعيدُ `UNIQUE (marketplace_reservation_ref)`، **ويرفضُ صراحةً** إن وُجِدَ طلبٌ متعدِّدُ
-- الأصنافِ بمرجعٍ مكرَّر: الترجعُ طريقُ خروجٍ لا مِحرقةُ بيانات، فلا يُحذَفُ صفُّ حجزٍ نشطٍ
-- ليمرَّ القيد. المُشغِّلُ يرى الطلباتِ المانعةَ في رسالةِ الخطأ ويقرِّر.
-- @wasla-upgrade-proof: all-non-baseline

DO $$
DECLARE
  dup_refs integer;
BEGIN
  SELECT count(*) INTO dup_refs FROM (
    SELECT marketplace_reservation_ref
      FROM delivery_inventory_reservations
     GROUP BY marketplace_reservation_ref
    HAVING count(*) > 1
  ) d;
  IF dup_refs > 0 THEN
    RAISE EXCEPTION 'M5-13M rollback refused: % marketplace_reservation_ref value(s) are shared by multi-line orders; restoring UNIQUE (marketplace_reservation_ref) would require deleting live reservation rows', dup_refs
      USING ERRCODE = '23505';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "delivery_inventory_reservations" ADD CONSTRAINT "delivery_inventory_reservations_marketplace_reservation_ref_key" UNIQUE ("marketplace_reservation_ref");
