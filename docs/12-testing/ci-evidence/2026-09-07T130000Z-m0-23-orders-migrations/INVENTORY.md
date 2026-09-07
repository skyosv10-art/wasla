# M0-23 الموجة 2b-1 — جرد ومصالحة orders

**الحجز:** `CLM-0101` · **الفرع:** `feat/m0-23-orders-migrations` · **التاريخ:** 2026-09-07

## الجرد (inventory)

| الأصل | المسار | الملاحظة |
|---|---|---|
| العقد | `services/orders/contracts/schema.sql` (297 سطراً) | 6 جداول + متتالية + دالة + مُطلِقان |
| الإسقاط | `services/orders/src/infrastructure/drizzle/schema.ts` (338 سطراً) | إسقاطٌ جزئيٌّ باصطلاحِ تسميةٍ مختلفٍ |
| drizzle.config | `services/orders/drizzle.config.ts` | موجود |
| package scripts | `db:generate` | **مفقود** — يُضاف |
| اختبارات | `test` + `test:integration` | موجودة |
| ترحيلات | `services/orders/drizzle/` | لا توجد بعد |

## المقارنة: contract ↔ schema.ts

الانحرافُ ليس "28 قيداً مفقوداً" فحسب، بل **اختلافٌ منهجيٌّ في اصطلاحِ التسمية**:

### 1. القيودُ العموديّة (column CHECK) — اختلافُ أسماء

العقدُ يكتبُ القيودَ inline فتولّدُها PostgreSQL بالاسمِ الافتراضيِّ `<table>_<column>_check`.
أمّا `schema.ts` فيُسمّيها يدويّاً `ck_orders_*_shape` / `ck_orders_*_domain`.

| القيدُ في العقدِ (PG-default) | الموجودُ في schema.ts | الحالة |
|---|---|---|
| `orders_order_public_id_check` | `ck_orders_public_id_shape` | إعادةُ تسميةٍ |
| `orders_customer_public_id_check` | `ck_orders_customer_public_id_shape` | إعادةُ تسميةٍ |
| `orders_order_type_check` | `ck_orders_order_type_domain` | إعادةُ تسميةٍ |
| `orders_vehicle_class_check` | `ck_orders_vehicle_class_domain` | إعادةُ تسميةٍ |
| `orders_status_check` | `ck_orders_status_domain` | إعادةُ تسميةٍ |
| `orders_price_mode_check` | `ck_orders_price_mode_domain` | إعادةُ تسميةٍ |
| `orders_status_reason_code_check` | — | **مفقود** |
| `orders_offered_amount_minor_check` | — | **مفقود** |
| `orders_offered_currency_check` | — | **مفقود** |
| `orders_agreed_amount_minor_check` | — | **مفقود** |
| `orders_agreed_currency_check` | — | **مفقود** |
| `orders_shipment_description_check` | — | **مفقود** |
| `orders_shipment_type_check` | — | **مفقود** |
| `orders_shipment_weight_kg_check` | — | **مفقود** |
| `orders_notes_check` | — | **مفقود** |
| `orders_idempotency_key_check` | — | **مفقود** |
| `orders_payload_fingerprint_check` | — | **مفقود** |

ونفسُ النمطِ في `order_stops` و`order_status_history` و`order_assignments` و`order_outbox`.

### 2. القيودُ الجدوليّة (table CHECK) — متطابقةٌ بالاسم

`ck_orders_price_mode_amount` · `ck_orders_money_complete` · `ck_orders_agreed_price_complete` ·
`ck_orders_agreed_price_only_negotiable` · `ck_orders_shipment_only_delivery` ·
`ck_orders_assignment_matches_status` — **كلُّها متطابقةٌ بالاسمِ والمعنى**.

**مفقودٌ واحد:** `ck_orders_terminal_needs_reason`.

### 3. قيودُ UNIQUE — uniqueIndex بدلَ قيدِ UNIQUE

العقدُ يستخدمُ `UNIQUE` inline (PG: `orders_<col>_key`).
`schema.ts` يستخدمُ `uniqueIndex("ux_...")` فيُنشئُ فهرساً فريداً **لا قيدَ UNIQUE**.
مثال: `orders_order_public_id_key` (قيدٌ) مقابل `ux_orders_public_id` (فهرسٌ).

### 4. أسماءُ FK — مفقودة

- `order_stops_order_id_fkey` · `order_status_history_order_id_fkey` · `order_assignments_order_id_fkey` — بلا `name`.
- `fk_orders_active_assignment` — مفقودٌ كليّاً (التعليقُ يقولُ "يُضافُ بالـDDL الكنسيّ" لكنّ الترحيلَ يحتاجُه).

### 5. فهارسُ DESC

`ix_orders_customer` · `ix_orders_status` · `ix_order_assignments_driver` — تستخدمُ `.desc()` فتُضيفُ `NULLS LAST`، والعقدُ `DESC` مجرّداً.

### 6. المتتالية + الدالة + المُطلِقات

- `order_public_id_seq` — موجودٌ بـ`pgSequence`.
- `order_set_updated_at()` + `trg_orders_updated_at` + `trg_order_assignments_updated_at` — خارجَ نطاقِ التوليدِ (إلحاقٌ مُراجَع).

## القرارُ: هل الاختلافُ شكليٌّ أم مؤثِّرٌ؟

**الاختلافُ شكليٌّ في الأداءِ (runtime-cosmetic) لكنّه جوهريٌّ في الأدواتِ (migration-significant):**

- **وقتُ التشغيلِ:** دلالاتُ `CHECK` تُفرَضُ بلا اعتبارٍ للاسمِ — `orders_order_public_id_check` و`ck_orders_public_id_shape` يرفضانِ الصفَّ نفسَه.
- **الأدواتُ:** تكافؤُ الكتالوجِ (يُقارنُ `conname`)، والتراجعُ العكسيُّ (`DROP CONSTRAINT` بالاسمِ)، والترحيلاتُ المستقبليّةُ (`ALTER/DROP CONSTRAINT`)، وحارسُ CI — **كلُّها تعتمدُ أسماءً كنسيّةً مستقرّة**. فلو بقيَ الإسقاطُ بأسماءِ `ck_*`، لاختلفَ كتالوجُ الترحيلِ عن العقدِ رغمَ تطابقِ السلوكِ، ولانكسرَ حارسُ `validate-migrations.sh` (البابُ 13).

**القرارُ:** محاذاةُ `schema.ts` إلى أسماءِ العقدِ (ADR-024: العقدُ هو المصدرُ القانونيُّ). **لا يُغيَّرُ العقدُ** ما لم يكشفِ الجردُ عن عيبٍ دلاليٍّ — ولم يكشف.

## خطةُ المصالحة

1. إعادةُ تسميةِ جميعِ `check()` إلى `<table>_<col>_check` (أسماءُ PG الافتراضيّةُ المطابقةُ للعقدِ).
2. إضافةُ القيودِ العموديّةِ المفقودةِ (11 في orders + نظيراتُها في الجداولِ الأربعةِ الأخرى).
3. إضافةُ `ck_orders_terminal_needs_reason`.
4. تحويلُ `uniqueIndex` → `unique("..._key").on(...)` لقيودِ `UNIQUE`.
5. إضافةُ `name` لكلِّ `foreignKey` + إضافةُ `fk_orders_active_assignment`.
6. فهارسُ `DESC` بـ`sql\`${col} DESC\`` بدلَ `.desc()`.
7. توليدُ الترحيلِ + إلحاقُ الدالةِ والمُطلِقَينِ.
8. رفيقُ الترجعِ + اختبارُ الدورةِ.
