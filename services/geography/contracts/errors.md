# Error Contract — Geography Service (Phase 02)

> **Scope:** كتالوج أكواد الأخطاء الثابتة لخدمة Geography & Localization.
>
> **القاعدة:** أكواد الأخطاء ثابتة (stable) ولا تتغير دلالتها بعد الإصدار. الأكواد الجديدة تُضاف فقط. أي تغيير في الدلالة يتطلب إصداراً جديداً + ADR.
>
> **Related:** [api.openapi.yml](api.openapi.yml) · [ADR-006](../../../docs/15-decisions/ADR-006-geography-localization-stack-and-model.md)

---

## أصناف الأخطاء

| الصنف (Class) | HTTP | الوصف |
|---|---|---|
| `validation_error` | 400 | مدخلات غير صالحة شكلياً (معرّف/locale) |
| `not_found` | 404 | الكيان الجغرافي أو موقع المستخدم غير موجود |
| `unprocessable` | 422 | المدخلات صالحة شكلياً لكن غير مقبولة منطقياً (هرم غير صالح) |
| `conflict` | 409 | تعارض حالة (موقع غير نشط) |
| `service_unavailable` | 503 | الخدمة في وضع متدهور (degraded mode) |

---

## كتالوج الأكواد

| Code | Class | الوصف | متى يُرجَع |
|---|---|---|---|
| `GEO_INVALID_PUBLIC_ID` | `validation_error` | صيغة Wasla Public ID غير صالحة | لا تطابق `^WS-[0-9]{10}$` |
| `GEO_UNSUPPORTED_LOCALE` | `validation_error` | locale غير مدعوم | locale ليس ضمن `ar`/`en`/`ur` |
| `GEO_INVALID_REQUEST_BODY` | `validation_error` | جسم الطلب غير صالح شكلياً | PUT /geo/users/{id}/location بـ `zone_id` مفقود/غير نصي أو `source` خارج القيم المسموحة (أُضيف في MR 5 — طبقة HTTP) |
| `GEO_COUNTRY_NOT_FOUND` | `not_found` | لا بلد بهذا المعرّف | GET /geo/countries/{id}/regions لبلد غير موجود |
| `GEO_REGION_NOT_FOUND` | `not_found` | لا منطقة بهذا المعرّف | GET /geo/regions/{id}/cities لمنطقة غير موجودة |
| `GEO_CITY_NOT_FOUND` | `not_found` | لا مدينة بهذا المعرّف | GET /geo/cities/{id}/districts لمدينة غير موجودة |
| `GEO_DISTRICT_NOT_FOUND` | `not_found` | لا حي بهذا المعرّف | GET /geo/districts/{id}/zones لحي غير موجود |
| `GEO_ZONE_NOT_FOUND` | `not_found` | لا منطقة فرعية بهذا المعرّف | PUT /geo/users/{id}/location بـ zone_id غير موجود |
| `GEO_USER_LOCATION_NOT_FOUND` | `not_found` | لا موقع معيّن لهذا المستخدم | GET /geo/users/{id}/location لمستخدم بلا موقع |
| `GEO_LOCATION_INACTIVE` | `conflict` | المنطقة المطلوبة غير نشطة | إسناد موقع لمنطقة status='inactive' |
| `GEO_INVALID_HIERARCHY` | `unprocessable` | المنطقة المطلوبة لا تنتمي للهرم المتوقّع | zone_id لا ينتمي للمسار الصحيح |
| `GEO_IDENTITY_NOT_FOUND` | `not_found` | الهوية المُشار إليها غير موجودة | wasla_public_id لا يُطابق مستخدماً (عبر IdentityLookupPort) |
| `GEO_INTERNAL_ERROR` | `service_unavailable` | خطأ داخلي غير متوقع | خطأ غير مُصنّف (degraded) |

---

## مثال حمولة الخطأ

```json
{
  "code": "GEO_ZONE_NOT_FOUND",
  "message": "المنطقة الفرعية المطلوبة غير موجودة",
  "trace_id": "01HXY..."
}
```

---

## مسار الفشل (Failure Paths) — وفق قاعدة «لا Feature بلا مسار فشل»

| السيناريو | السلوك المتوقّع |
|---|---|
| طلب location لـ wasla_public_id غير موجود | التحقق عبر `IdentityLookupPort` → `GEO_IDENTITY_NOT_FOUND` (404) |
| تعيين موقع لمنطقة محذوفة/غير نشطة | `GEO_ZONE_NOT_FOUND` (404) أو `GEO_LOCATION_INACTIVE` (409) |
| تغيير الموقع لنفس المنطقة | idempotent: يُرجَع الموقع الحالي دون إنشاء حدث تغيير (200) |
| مهلة (timeout) أثناء كتابة الموقع | المعاملة تُتراجع (rollback)؛ لا موقع جزئي ولا حدث في outbox |
| locale غير مدعوم (مثال: `fr`) | `GEO_UNSUPPORTED_LOCALE` (400) |
| جسم PUT بلا `zone_id` أو بـ `source` غير معروف | `GEO_INVALID_REQUEST_BODY` (400) — يُرفض قبل الوصول للـuse case |
| طلب أبناء مستوى لوالد غير موجود | `*_NOT_FOUND` (404) للجد الأصلي |
