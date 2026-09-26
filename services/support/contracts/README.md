# Support & Escalation — Service Contracts

> **المنفذ:** `8095` · **المرجع الحاكم:** [ADR-049](../../../docs/15-decisions/ADR-049-support-escalation-ticket-model-and-service-boundary.md)

| الملف | المحتوى | الدور |
|---|---|---|
| [`api.openapi.yml`](api.openapi.yml) | مسار الصحة وكتالوج الأخطاء | طبقة HTTP ومولّد الأنواع |
| [`events.json`](events.json) | ثلاثة أحداث (ticket_opened/escalated/resolved) | كتالوج الأحداث الكنسيّ |
| [`errors.md`](errors.md) | سبعة رموز أخطاء | كتالوج الأخطاء الكنسيّ |
| [`schema.sql`](schema.sql) | ثلاثة جداول (tickets/evidence/outbox) | مخطّط PostgreSQL |

## القواعد الحاكمة

1. **لا يعاقب.** لا إيقاف ولا حجب (ADR-049 §1 — كـ ADR-014 §7).
2. **الدليل شرط.** لا تحقيق بلا دليل (بوّابة الدليل — ADR-049 §4).
3. **لا قفز.** لا resolved قبل investigating (ADR-049 §2).
4. **لا PII.** لا اسم ولا هاتف ولا إحداثيّات ولا مُعرّف قناة (ADR-049 §8).
5. **لا FK عابر.** لا REFERENCES إلى جدول خارج حدّ الخدمة.
