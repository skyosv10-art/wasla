# Error Contract — Identity Service (Phase 01)

> **Scope:** كتالوج أكواد الأخطاء الثابتة لخدمة Identity.
>
> **القاعدة:** أكواد الأخطاء ثابتة (stable) ولا تتغير دلالتها بعد الإصدار. الأكواد الجديدة تُضاف فقط. أي تغيير في الدلالة يتطلب إصداراً جديداً + ADR.
>
> **Related:** [api.openapi.yml](api.openapi.yml) · [ADR-001](../../../docs/15-decisions/ADR-001-identity-decoupled-from-telegram.md)

---

## أصناف الأخطاء

| الصنف (Class) | HTTP | الوصف |
|---|---|---|
| `validation_error` | 400 | مدخلات غير صالحة شكلياً |
| `not_found` | 404 | الكيان غير موجود |
| `conflict` | 409 | تعارض حالة (مثلاً رابط مرتبط بمستخدم آخر) |
| `unprocessable` | 422 | المدخلات صالحة شكلياً لكن غير مقبولة منطقياً |
| `service_unavailable` | 503 | الخدمة في وضع متدهور (degraded mode) |

---

## كتالوج الأكواد

| Code | Class | الوصف | متى يُرجَع |
|---|---|---|---|
| `IDENTITY_INVALID_PUBLIC_ID` | `validation_error` | صيغة Wasla Public ID غير صالحة | لا تطابق `^WS-[0-9]{10}$` |
| `IDENTITY_MISSING_TELEGRAM_ID` | `validation_error` | طلب resolve بدون `telegram_user_id` | POST /identity/resolve بلا الحقل الإلزامي |
| `IDENTITY_NOT_FOUND` | `not_found` | لا مستخدم بهذا Wasla Public ID | GET /identity/users/{id} لمستخدم غير موجود |
| `IDENTITY_LINK_ALREADY_LINKED` | `conflict` | الرابط الخارجي مرتبط بمستخدم آخر | إضافة رابط (provider, external_id) مستخدم بالفعل من مستخدم آخر |
| `IDENTITY_LINK_INVALID_PROVIDER` | `unprocessable` | مزوّد رابط غير مدعوم | provider ليس ضمن القائمة المعتمدة |
| `IDENTITY_USERNAME_NO_CHANGE` | `unprocessable` | Username الجديد مطابق للقديم | تسجيل تغيير username بنفس القيمة |
| `IDENTITY_RECOVERY_METHOD_INVALID` | `unprocessable` | وسيلة تحقق غير مدعومة أو تعتمد على Telegram كمصدر وحيد | POST /recovery بـ verification_method غير صالح |
| `IDENTITY_USER_SUSPENDED` | `conflict` | المستخدم موقوف والعملية غير مسموحة | محاولة إضافة رابط لمستخدم موقوف |
| `IDENTITY_INTERNAL_ERROR` | `service_unavailable` | خطأ داخلي غير متوقع | خطأ غير مُصنّف (degraded) |

---

## مثال حمولة الخطأ

```json
{
  "code": "IDENTITY_LINK_ALREADY_LINKED",
  "message": "رابط الهوية الخارجي مرتبط بمستخدم آخر",
  "trace_id": "01HXY..."
}
```

---

## مسار الفشل (Failure Paths) — وفق قاعدة «لا Feature بلا مسار فشل»

| السيناريو | السلوك المتوقّع |
|---|---|
| طلب مكرر (duplicate) لـ resolve بنفس `telegram_user_id` | idempotent: يُرجَع المستخدم الحالي دون إنشاء (200) |
| مهلة (timeout) أثناء الحلّ | يُرجَع `service_unavailable` مع `trace_id`؛ لا تُنشأ حالة ناقصة |
| فشل شبكة أثناء كتابة Identity Link | المعاملة تُتراجع (rollback)؛ لا رابط جزئي |
| تغيير Username إلى نفس القيمة | `IDENTITY_USERNAME_NO_CHANGE` (422) |
| محاولة recovery لمستخدم محذوف | `IDENTITY_NOT_FOUND` (404) |
| مستخدم خبيث يحاول ربط telegram_id لمستخدم آخر | `IDENTITY_LINK_ALREADY_LINKED` (409) + Audit |
