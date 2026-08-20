# Identity Service — Contracts (Contract First)

> **Scope:** العقود الأساسية لخدمة Identity — Phase 01 (Identity Foundation).
>
> **المبدأ (ADR-001):** Wasla User ID هو الهوية الداخلية الأساسية؛ معرّفات Telegram/الهاتف روابط Identity مع History.
>
> **منهجية:** Contract First — العقود تُنتج قبل التنفيذ، مستقلة عن المكدّ التقني، ومُصدّرة (versioned).
>
> **Last Updated:** 2026-08-20 · **Status:** Draft v1 (Contract First stage) · **Related Team:** Team 01 — Identity & Auth · Team 12 — Integration

---

## فهرس العقود

| العقد | الملف | الصيغة | الوصف |
|---|---|---|---|
| API Contract | [api.openapi.yml](api.openapi.yml) | OpenAPI 3.0.3 | عمليات resolve/getUser/addLink/recovery/history |
| Event Contract | [events.json](events.json) | JSON Schema 2020-12 | identity.created / link.added / telegram_username.changed / recovery.started (v1) |
| Data Contract | [schema.sql](schema.sql) | PostgreSQL DDL | identity_users / identity_links / identity_history / recovery_requests / outbox |
| Error Contract | [errors.md](errors.md) | Markdown | كتالوج أكواد أخطاء ثابتة + مسارات الفشل |

---

## ملاحظات للمنفّذ التالي

1. **الإصدار (Versioning):** أي تغيير غير متوافق للخلف يتطلب إصداراً جديداً (v2) + ADR. لا تُغيَّر دلالة الأكواد أو الـ payloads بعد الإصدار.
2. **Outbox:** تُبنى Domain Events عبر Outbox (جدول `identity_outbox`) من البداية بحيث يمكن إدخال Kafka لاحقاً دون إعادة تصميم المجال.
3. **التنفيذ:** اختيار المكدّ التقني (TS/Go/...) قرار منفصل يتطلب ADR مستقبلي. العقود الحالية مستقلة عن المكدّ.
4. **الاختبارات:** عند ظهور التنفيذ، تُكتب Contract tests (consumer + provider) ضد هذه العقود، وليس ضد التنفيذ.
5. **الـ Wasla Public ID:** صيغة `WS-[0-9]{10}`. التوليد الفعلي يُترك للتنفيذ؛ العقد يحدّد الصيغة فقط.

---

## العلاقة مع Phase 01 Exit Gate

Exit Gate لـ Phase 01: «إنشاء مستخدم من Telegram وبقاء هويته مستقرة عبر تغيير Username».

هذه العقود هي **الخطوة الأولى (Contract First)** نحو هذا Exit Gate — وليست اجتيازه. اجتياز Exit Gate يتطلب تنفيذاً فعلياً + اختبارات + توثيق + أمان + تكامل.

راجع: [ADR-002](../../../docs/15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md) (سبب بدء العقود رغم عائق shared runners) · [ADR-001](../../../docs/15-decisions/ADR-001-identity-decoupled-from-telegram.md) (فصل الهوية عن Telegram) · [MASTER_PROGRESS.md](../../../docs/16-progress/MASTER_PROGRESS.md) (حالة Phase 01).
