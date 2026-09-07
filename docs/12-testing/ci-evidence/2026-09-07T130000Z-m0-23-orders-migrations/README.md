# CI Evidence — M0-23 الموجة 2b-1: ترحيلات orders العكوسة (مصالحة العقد)

**العنصر:** M0-23 · **الفرع:** `feat/m0-23-orders-migrations` · **الحجز:** CLM-0101
**التاريخ:** 2026-09-07 · **الالتزام الأساس:** `0e57807` (PR #51)

## النطاق

إلحاقُ خدمةِ `orders` بنظامِ الترحيلاتِ المولَّدةِ العكوسةِ (ADR-024)، بعدَ **مصالحةٍ
كاملةٍ للإسقاطِ مع العقدِ** — لا مجرّدَ إضافةِ القيودِ المفقودةِ.

## القرارُ: الاختلافُ شكليٌّ في الأداءِ لكنّه جوهريٌّ في الأدواتِ

راجِع [INVENTORY.md](./INVENTORY.md) للتحليلِ الكاملِ. الخلاصةُ:

- **وقتُ التشغيلِ:** دلالاتُ `CHECK` تُفرَضُ بلا اعتبارٍ للاسمِ — `orders_order_public_id_check`
  و`ck_orders_public_id_shape` يرفضانِ الصفَّ نفسَه.
- **الأدواتُ:** تكافؤُ الكتالوجِ (يُقارنُ `conname`)، والتراجعُ العكسيُّ (`DROP CONSTRAINT` بالاسمِ)،
  والترحيلاتُ المستقبليّةُ، وحارسُ CI — **كلُّها تعتمدُ أسماءً كنسيّةً مستقرّة**.
- **القرارُ:** محاذاةُ `schema.ts` إلى أسماءِ العقدِ (ADR-024: العقدُ هو المصدرُ القانونيُّ). لم يُغيَّرِ العقدُ.

## المصالحةُ المنفَّذة

| الانحرافُ | العلاجُ في `schema.ts` |
|---|---|
| 11 قيدَ CHECK بأسماءٍ `ck_*_shape/domain` | إعادةُ تسميةٍ إلى `<table>_<col>_check` (أسماءُ PG الافتراضيّةُ) |
| 17 قيدَ CHECK مفقودٌ | إلحاقُها صريحةً (status_reason_code · offered/agreed_amount_minor · offered/agreed_currency · shipment_description/type/weight_kg · notes · idempotency_key · payload_fingerprint · order_stops label/latitude/longitude · order_status_history reason_code/trace_id · order_assignments reason_code · order_outbox event_version/trace_id) |
| `ck_orders_terminal_needs_reason` مفقودٌ | إلحاقُها |
| `uniqueIndex("ux_...")` بدلَ قيدِ UNIQUE | تحويلٌ إلى `unique("..._key").on(...)` لقيودِ UNIQUE inline |
| أسماءُ FK مفقودةٌ | `name` داخلَ كائنِ الإعدادِ (order_stops/status_history/assignments `_order_id_fkey`) |
| `fk_orders_active_assignment` مفقودٌ | إلحاقٌ في قسمِ الإلحاقِ (ALTER TABLE — مرجعٌ متبادلٌ) |
| فهارسُ `DESC` بـ`.desc()` (NULLS LAST) | raw SQL `sql\`${col} DESC\`` |
| `db:generate` script مفقودٌ | إضافته إلى package.json |

## أرتفاكتاتُ الترحيلِ

- `drizzle/0000_colossal_havok.sql` — مولَّدٌ + قسمُ إلحاقٍ مُراجَعٍ (الدالةُّ + 2 مُطلِقٍ + FK النشط).
- `drizzle/0000_colossal_havok.down.sql` — رفيقُ الترجعِ (ترتيبٌ عكسيٌّ، مع تمييزِ فهارسِ القيودِ).
- `drizzle/meta/_journal.json` + `0000_snapshot.json`.
- `src/__tests__/migrations.integration.test.ts` — اختبارُ الدورةِ.

## التحقّقُ

| البُعدُ | النتيجةُ |
|---|---|
| تكافؤُ الكتالوجِ (7 أبعادٍ) | **0 فروقٍ** |
| اختبارُ الدورةِ | 3/3 (تكافؤٌ · ترجعٌ نظيفٌ · إعادةُ تطبيقٍ) |
| تكامليٌّ | 35/35 (3 ترحيلٍ + 21 postgres + 7 port-conformance + 4 atomicity) |
| وحدويٌّ | 646/646 |
| `validate-migrations.sh` | ✓ (4 خدماتٍ منتظِمةٌ: customers · identity · geography · orders) |
| `validate-baseline.sh` | ✓ (4 أبوابٍ) |
| `verify-governance.sh` | ✓ كلُّ الفحوصِ المُنفَّذةِ نجحت |
| الأساسُ الآليُّ | `test_files_tracked` 272→273 · بصمةٌ `8b612165` |

## ملاحظةٌ على رفيقِ الترجعِ

فهارسُ قيودِ `UNIQUE` (مثلُ `ux_order_assignments_order_driver`) **مملوكةٌ للقيدِ**
ولا يجوزُ `DROP INDEX` عليها — تُحذفُ تلقائيّاً مع الجدولِ. رفيقُ الترجعِ يميِّزُ بينَ
فهارسِ القيودِ (تُتركُ للجدولِ) والفهارسِ المستقلّةِ (`DROP INDEX`).
