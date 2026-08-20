# packages/contracts/identity — Consumer Entry Point

> **Scope:** نقطة الدخول للمستهلكين لعقود خدمة Identity (Contract First).
>
> **Last Updated:** 2026-08-20 · **Status:** v1 + typed package · **Related Team:** Team 01 (producer) · جميع الفرق المستهلكة
>
> **التحديث (2026-08-20):** أنواع TypeScript مولّدة الآن من OpenAPI — راجع [§الأنواع المولّدة](#الأنواع-المولّدة-typescript) أدناه.

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

راجع: [ADR-001](../../docs/15-decisions/ADR-001-identity-decoupled-from-telegram.md) · [ADR-002](../../docs/15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md) · [ADR-004](../../docs/15-decisions/ADR-004-typed-contracts-from-openapi.md)

---

## الأنواع المولّدة (TypeScript)

أُضيف حزمة `@wasla/contracts-identity` التي تولّد أنواع TS من `api.openapi.yml` عبر `openapi-typescript` (وفق [ADR-004](../../docs/15-decisions/ADR-004-typed-contracts-from-openapi.md)).

**الاستخدام:**

```ts
import type {
  ResolveIdentityRequest,
  ResolveIdentityResponse,
  IdentityUser,
  IdentityLink,
  paths,
} from "@wasla/contracts-identity";

// البطاقة التي يُرسلها Telegram Adapter لإنشاء/حل مستخدم:
const req: ResolveIdentityRequest = {
  telegram_user_id: 987654321,
  telegram_username: "wasla_user",
  source: "customer_bot",
};
```

**إعادة التوليد عند تغيير العقد:**

```bash
pnpm --filter @wasla/contracts-identity generate
```

> **القاعدة:** الأنواع مولّدة (لا تُعدَّل يدوياً) — المصدر الكنسي هو `api.openapi.yml`. أي تغيير في العقد يتطلب إعادة التوليد + تحديث docs/.
