# Error Contract — Customer Core Service (Phase 04)

> **Scope:** كتالوج أكواد الأخطاء الثابتة لخدمة Customer Core.
>
> **القاعدة:** أكواد الأخطاء ثابتة (stable) ولا تتغير دلالتها بعد الإصدار. الأكواد الجديدة تُضاف فقط. أي تغيير في الدلالة يتطلب إصداراً جديداً + ADR. الاختبارات تتحقّق من **الأكواد** لا من النص العربي.
>
> **Related:** [api.openapi.yml](api.openapi.yml) · [schema.sql](schema.sql) · [ADR-009](../../../docs/15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md)

---

## أصناف الأخطاء

| الصنف (Class) | HTTP | الوصف |
|---|---|---|
| `validation_error` | 400 | مدخلات غير صالحة شكلياً (معرّف/جسم طلب/ترويسة) |
| `not_found` | 404 | الكيان المطلوب غير موجود (ملف · مكان · طلب · هوية · منطقة) |
| `conflict` | 409 | تعارض حالة (تسمية مأخوذة · مفتاح Idempotency أُعيد بحمولة مختلفة) |
| `unprocessable` | 422 | صالح شكلياً وغير مقبول منطقياً (وضع سعر متناقض · أكثر من نقطتين) |
| `service_unavailable` | 503 | تبعية غير متاحة (محرّك الطلبات) أو خطأ داخلي غير مصنّف |

---

## كتالوج الأكواد

| Code | Class | الوصف | متى يُرجَع |
|---|---|---|---|
| `CUSTOMER_INVALID_PUBLIC_ID` | `validation_error` | صيغة Wasla Public ID غير صالحة | لا تطابق `^WS-[0-9]{10}$` |
| `CUSTOMER_INVALID_REQUEST_BODY` | `validation_error` | جسم الطلب غير صالح شكلياً | حقل مفقود/نوع خاطئ/قيمة خارج enum |
| `CUSTOMER_MISSING_IDEMPOTENCY_KEY` | `validation_error` | ترويسة `Idempotency-Key` مفقودة | POST على `/order-requests` أو `/places` بلا الترويسة (§43) |
| `CUSTOMER_PROFILE_NOT_FOUND` | `not_found` | لا ملف عميل لهذا المعرّف | GET `/customers/{id}/profile` لمستخدم لم يُنشئ ملف عميل |
| `CUSTOMER_IDENTITY_NOT_FOUND` | `not_found` | الهوية المُشار إليها غير موجودة | `wasla_public_id` لا يُطابق مستخدماً (عبر `IdentityLookupPort`) |
| `CUSTOMER_ZONE_NOT_FOUND` | `not_found` | المنطقة الفرعية غير موجودة | `zone_id` غير موجود (عبر `GeographyPort`) |
| `CUSTOMER_PLACE_NOT_FOUND` | `not_found` | المكان المحفوظ غير موجود | DELETE/استعمال `place_id` لا يملكه هذا العميل أو محذوف |
| `CUSTOMER_ORDER_REQUEST_NOT_FOUND` | `not_found` | طلب العميل غير موجود | GET `/order-requests/{id}` لمعرّف لا يملكه هذا العميل |
| `CUSTOMER_PLACE_LABEL_TAKEN` | `conflict` | تسمية المكان مستعملة لهذا العميل | إضافة «البيت» وهي موجودة (مقارنة بلا حساسية حالة أحرف) |
| `CUSTOMER_IDEMPOTENCY_KEY_REUSED` | `conflict` | المفتاح نفسه بحمولة مختلفة | إعادة استعمال `Idempotency-Key` لجسم طلب مختلف (التكرار الحقيقي يُعيد الكيان نفسه بـ200) |
| `CUSTOMER_ZONE_INACTIVE` | `conflict` | المنطقة الفرعية غير نشطة | نقطة في منطقة `status='inactive'` |
| `CUSTOMER_PROFILE_SUSPENDED` | `conflict` | ملف العميل موقوف | إنشاء طلب من ملف `status='suspended'` |
| `CUSTOMER_PLACE_LIMIT_REACHED` | `unprocessable` | بلغ الحدّ الأقصى للأماكن المحفوظة | إضافة مكان بعد الوصول إلى الحدّ (20 — سياسة طبقة الاستعمال) |
| `CUSTOMER_PRICE_MODE_MISMATCH` | `unprocessable` | وضع السعر لا يوافق الحمولة | `customer_offer` بلا مبلغ، أو `negotiable` بمبلغ (ADR-009 §6) |
| `CUSTOMER_MULTI_STOP_NOT_SUPPORTED` | `unprocessable` | أكثر من نقطتين غير مدعوم بعد | أكثر من pickup+dropoff — Multi-stop مؤجّل (§3.2) |
| `CUSTOMER_SHIPMENT_NOT_ALLOWED_FOR_RIDE` | `unprocessable` | تفاصيل شحنة في طلب مشوار | `order_type='ride'` مع `shipment` |
| `CUSTOMER_ORDER_INTAKE_UNAVAILABLE` | `service_unavailable` | محرّك الطلبات غير متاح | `OrderIntakePort` غير مُهيّأ أو فشل/انتهت مهلته — **fail-closed** لا حفظ صامت |
| `CUSTOMER_INTERNAL_ERROR` | `service_unavailable` | خطأ داخلي غير متوقّع | خطأ غير مُصنّف (degraded) |

---

## مثال حمولة الخطأ

```json
{
  "code": "CUSTOMER_PRICE_MODE_MISMATCH",
  "message": "لا يمكن إرسال مبلغ في الوضع التفاوضي",
  "trace_id": "01HXY..."
}
```

---

## أسباب فشل التسليم (Intake Failure Reasons)

`customer.order_request.submission_failed.v1` يحمل `reason_code` أدقّ من كود HTTP، وكلّها تُعرَض للعميل بكود واحد هو `CUSTOMER_ORDER_INTAKE_UNAVAILABLE` (503) — التمييز للتشغيل لا للعميل:

| `reason_code` | متى |
|---|---|
| `CUSTOMER_ORDER_INTAKE_UNAVAILABLE` | لا محوّل مُهيّأ للمحرّك (حالة Phase 04 الافتراضية) أو تعذّر الاتصال |
| `CUSTOMER_ORDER_INTAKE_REJECTED` | المحرّك ردّ برفض الحمولة |
| `CUSTOMER_ORDER_INTAKE_TIMEOUT` | انتهت مهلة الانتظار قبل ردّ المحرّك |

---

## مسار الفشل (Failure Paths) — وفق قاعدة «لا Feature بلا مسار فشل»

| السيناريو | السلوك المتوقّع |
|---|---|
| إنشاء ملف عميل لمعرّف لا هوية له | التحقق عبر `IdentityLookupPort` → `CUSTOMER_IDENTITY_NOT_FOUND` (404) |
| طلب بنقطة في منطقة غير موجودة/غير نشطة | `CUSTOMER_ZONE_NOT_FOUND` (404) أو `CUSTOMER_ZONE_INACTIVE` (409) |
| ضغط العميل زرّ «إرسال الطلب» مرّتين | المفتاح نفسه + الحمولة نفسها → **الطلب نفسه** بـ200، لا طلب ثانٍ |
| المفتاح نفسه بحمولة مختلفة | `CUSTOMER_IDEMPOTENCY_KEY_REUSED` (409) — لا كتابة |
| محرّك الطلبات غير متاح | `CUSTOMER_ORDER_INTAKE_UNAVAILABLE` (503) + صف `submission_failed` + حدث فشل — الطلب مرئي لا مفقود |
| العميل يحذف مكاناً مستعملاً في طلب ماضٍ | يُحذف المكان؛ الطلب الماضي يبقى صحيحاً (`saved_place_id` بلا FK) |
| تسمية مكان مكرّرة باختلاف حالة الأحرف | `CUSTOMER_PLACE_LABEL_TAKEN` (409) — الفريدة على `lower(label)` |
