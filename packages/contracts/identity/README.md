# packages/contracts/identity — Consumer Entry Point

> **Scope:** نقطة الدخول للمستهلكين لعقود خدمة Identity (Contract First).
>
> **Last Updated:** 2026-08-20 · **Status:** Draft v1 · **Related Team:** Team 01 (producer) · جميع الفرق المستهلكة

---

## المصدر الموثّق (Canonical source)

العقود الكنسية (canonical) لخدمة Identity تعيش في:

```
services/identity/contracts/
├── README.md        # فهرس العقود
├── api.openapi.yml   # API Contract (OpenAPI 3.0.3)
├── events.json      # Event Contract (JSON Schema)
├── schema.sql        # Data Contract (PostgreSQL DDL)
└── errors.md         # Error Contract (كتالوج)
```

> **القاعدة:** لا تُنسخ العقود إلى حزم المستهلكين. المستهلك يبني Mock/Contract client ضد المصدر الكنسي، أو يولّد أنواعاً (code generation) منه. النسخ يخلق تبايناً بين النسخ.

---

## كيف يستهلك الفريق عقود Identity

1. **Contract First:** اقرأ `services/identity/contracts/README.md` أولاً.
2. **Mock client:** ابنِ Mock للعمليات التي تحتاجها من `api.openapi.yml` دون انتظار تنفيذ Identity.
3. **Contract tests:** اكتب اختبارات ضد العقد (وليس ضد التنفيذ) لضمان التوافق.
4. **الأحداث:** اشترك في أحداث `events.json` عبر Outbox/Kafka (لا تصل مباشرة لجدول الخدمة بعد فصلها).

راجع: [ADR-001](../../docs/15-decisions/ADR-001-identity-decoupled-from-telegram.md) · [ADR-002](../../docs/15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md)
