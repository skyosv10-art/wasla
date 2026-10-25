# CLM-0618 — G-S9.1: منتقي «اسمِ مكانٍ» محفوظٍ للالتقاطِ/الوصولِ

**الحجزُ:** CLM-0618 · **العنصرُ:** M0-53 · **الأساسُ:** main `4c1032a7` (بعدَ دمجِ #768 / CLM-0617). **النطاقُ:** G-S9.1 وحدَه — فرعُ «اسمِ مكانٍ» من مصادرِ الالتقاطِ/الوصولِ (RQ-CMA-15)؛ لا تغييرَ لعقدِ الـAPI ولا لقائمةِ سماحِ الحدِّ ولا لـ`production_open`. **لا يُعلَنُ أنَّ الميزةَ متاحةٌ للمستخدمينَ.**

## §1 القياسُ قبلَ

| المصدرُ | النصُّ/السلوكُ |
|---|---|
| المواصفةُ CMS §3.2 L52-53 | نقطةُ الالتقاطِ/الوصولِ: «خريطة / موقع تلغرام / بحث نصي / **اسم مكان**» |
| العقدُ `GET /customers/:id/places` | قائمٌ (G-S7 / CLM-0609): `items` (حتى 5) بـ`place_id` · `label` · `zone_id` · `zone_path` |
| عقدُ التوقفِ `StopInput.source` | `StopSource` يعلنُ `saved_place` أصلًا في `order-form.ts` |
| الشاشتانِ `RideOrder.tsx`/`DeliveryOrder.tsx` (قبلَ) | حقلُ منطقةٍ نصّيٌّ وحدَه؛ `source` مُصلَّبٌ `manual_zone` في `buildOrderRequest` |
| تفكيكُ [CLM-0611](../2026-10-18T093000Z-clm-0611-gs9-customer-decomposition/README.md) §2 | G-S9.1 «الآنَ-شاشةٌ» — العقدُ قائمٌ والعملُ في الشاشةِ وحدَها |

## §2 التغييرُ

- `apps/customer-mini-app/src/components/SavedPlacePicker.tsx` (جديدٌ): منتقيٍّ يقرأُ متجرَ الأماكنِ المشتركَ (`store/places`) ويحمّلُه بـ`GET /customers/:id/places` مرةً لكلِ تركيبٍ (إعادةُ محاولةٍ بعدَ فشلٍ سابقٍ)؛ الخيارُ = `label — zone_path`.
- `apps/customer-mini-app/src/screens/RideOrder.tsx` و`DeliveryOrder.tsx`: منتقيانِ (التقاط/وصول) فوقَ حقلَي المنطقةِ؛ اختيارُ مكانٍ يملأُ `zone_id` و`label` ويضبطُ `source=saved_place`؛ **التحريرُ اليدويُّ لحقلِ المنطقةِ يعيدُ `manual_zone`** ويفرّغُ المنتقيَ (المصدرُ يبقى صادقًا معَ آخرِ فعلٍ للمستخدمِ).
- `apps/customer-mini-app/src/store/order-form.ts`: `pickupSource`/`dropoffSource` في الحالةِ (افتراضيٌّ `manual_zone` · يُعادُ في `resetForm`) ويمرّانِ إلى `buildOrderRequest`.
- `i18n/index.ts`: ثلاثُ مفاتيحٍ جديدةٍ × ثلاثِ لغاتٍ (ar/en/ur).
- لا تغييرَ في أيِّ خدمةٍ ولا عقدٍ.

## §3 الاختباراتُ (التوكيدُ لا الاسمُ)

**الشاشتانِ** (محاكاةُ `apiClient` — دليلُ ما ترسلُه الشاشةُ):

| الملفُ | التوكيدُ |
|---|---|
| `RideOrder.test.tsx` | يعرضُ المنتقيَينِ · تحميلُ الأماكنِ عندَ التركيبِ (`/customers/WS-1234567890/places`) وخياراتُها في القائمةِ · الإرسالُ بعدَ اختيارِ مكانَينِ: `stops[0]` = `{zone_id: z-home, source: saved_place, label: المنزل}` و`stops[1]` كذلك (`saved_place` · zone/label المكانِ) · تحريرُ المنطقةِ يدويًّا بعدَ الاختيارِ ← `source: manual_zone` و`zone_id` المحرَّرُ |
| `DeliveryOrder.test.tsx` | يعرضُ المنتقيَينِ · الإرسالُ بعدَ اختيارِ مكانِ التقاطٍ: `stops[0]` بـ`saved_place` (zone/label المكانِ) و`stops[1]` يدويًّا `manual_zone` |

**المحليُّ:** customer-mini-app vitest **96/96** (كانَ 90 — 6 اختباراتٍ جديدةً) · `tsc` 0. [raw](raw/).

**طفراتٌ مقيسةٌ (مُلتقَطةٌ):** (أ) حذفُ `setPickupSource("saved_place")` من الشاشةِ ← إخفاقٌ [raw](raw/mutation-a-no-saved-place-source.txt) · (ب) تثبيتُ `manual_zone` في `buildOrderRequest` ← إخفاقانِ [raw](raw/mutation-b-hardcoded-manual-zone.txt) · (ج) حذفُ تعبئةِ `label` من المكانِ ← إخفاقٌ [raw](raw/mutation-c-no-label-fill.txt). بعدَ كلِّ طفرةٍ أُعيدَ الملفُّ الأصليُّ وتأكّدَ الأخضرُ (96/96) [raw](raw/vitest-final-green.txt).

**Playwright:** لم يُشغَّلْ محلّيًّا (بيئةُ التنفيذِ بلا متصفّحاتٍ) — حكمُهُ من وظيفةِ CI.

## §4 الحوكمةُ والأساسُ

لا ملفَّ اختبارٍ جديدٌ (الاختباراتُ داخلَ `RideOrder.test.tsx` و`DeliveryOrder.test.tsx` القائمَينِ) ← `test_files_tracked` بلا تغييرٍ (578) ← لا إعادةَ توليدٍ. الفحوصُ الأربعةُ على الأساسِ في وصفِ الـPR. النشرُ: `apps/**` ← render-deploy بعدَ الدمجِ (التطبيقُ خلفَ حدٍّ مغلقٍ `production_open=false`).

## §5 الإغلاقُ

G-S9.1 وRQ-CMA-15 (فرعُ «اسمِ مكانٍ») يُغلقانِ في سجلٍّ لاحقٍ بعدَ نجاحِ WASLA CI على SHA الدمجِ في main وتوثيقِ النشرِ. **G-S9 الأمُّ تبقى مفتوحةً** (بقيّةُ الفروعِ: G-S9.2–G-S9.4 · G-S9.15 قرارُ نطاقٍ).
