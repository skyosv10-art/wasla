# كتالوج أخطاء خدمة الدعم والتصعيد — Support & Escalation Errors

> **المرجع الحاكم:** [ADR-049](../../../docs/15-decisions/ADR-049-support-escalation-ticket-model-and-service-boundary.md)
> **العقود المرافقة:** [`api.openapi.yml`](api.openapi.yml) · [`schema.sql`](schema.sql) · [`events.json`](events.json)
> **السطح المُصدَّر:** `@wasla/contracts-support` — `SUPPORT_ERROR_CODES` و`httpStatusForSupportError()`

---

## القاعدة

الرمز عقد، والرسالة ترجمة. يتعاقد المستهلك على `error.code` لا على نصّ `error.message`.

1. **كل رمز ينتمي إلى صنفٍ واحد**، والصنف يحدّد رمز HTTP وحده.
2. **لا رمز في هذا الكتالوج بلا مسارٍ يُنتجه.**
3. **لا رمز عقابيّ.** لا `SUBJECT_SUSPENDED` ولا `SUBJECT_BLOCKED` (ADR-049 §1).
4. **الخطأ لا يُعيد قيمة المدخل.** `details.field` يسمّي الحقل ولا يردّ ما كُتب فيه.
5. **`details.constraint`** يسمّي قيد القاعدة الذي كان سيرفض الكتابة.

---

## الرموز

| الرمز | HTTP | الصنف | المعنى |
|---|---|---|---|
| `SUPPORT_VALIDATION_FAILED` | 422 | validation | فشل التحقّق من شكل المدخل |
| `SUPPORT_TICKET_NOT_FOUND` | 404 | not_found | التذكرة غير موجودة |
| `SUPPORT_EVIDENCE_REQUIRED` | 409 | conflict | لا يمكن التحقيق بلا دليل (بوّابة الدليل) |
| `SUPPORT_RESOLUTION_REASON_REQUIRED` | 422 | validation | القرار يحتاج سبباً مغلقاً |
| `SUPPORT_INVALID_STATE_TRANSITION` | 409 | conflict | انتقال حالة غير صالح (لا قفز) |
| `SUPPORT_TICKET_ALREADY_CLOSED` | 409 | conflict | التذكرة مغلقة بالفعل |
| `SUPPORT_EVIDENCE_NOT_FOUND` | 404 | not_found | الدليل غير موجود |
