-- M5-13M (CLM-0378): مرجعُ حجزِ السوقِ مرجعُ **طلبٍ** لا مرجعُ **صنف**.
--
-- لماذا: `delivery_inventory_reservations` صفٌّ لكلِّ صنف، والسوقُ يُعيدُ مرجعاً واحداً
-- للطلبِ كلِّهِ (مفتاحُهُ مشتقٌّ من `order_public_id`)، فكان `UNIQUE (marketplace_reservation_ref)`
-- يُسقِطُ الصنفَ الثانيَ من كلِّ طلبٍ متعدِّدِ الأصنافِ بـ`23505` → `500 DELIVERY_INTERNAL_ERROR`،
-- والطلبُ يبقى `placed` بمخزونٍ `none` بعدَ أن خصمَ السوقُ الكميّات.
--
-- يبقى `UNIQUE (order_id, product_id)` — وهوَ التفرّدُ الصحيح: صنفٌ واحدٌ مرّةً واحدةً في الطلب.
-- لا تعبئةَ ولا تغييرَ لصفٍّ قائم: إسقاطُ قيدٍ لا يُبطِلُ بياناً.
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE "delivery_inventory_reservations" DROP CONSTRAINT IF EXISTS "delivery_inventory_reservations_marketplace_reservation_ref_key";
