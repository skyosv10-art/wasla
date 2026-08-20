# packages/contracts/identity — Consumer Entry Point

> **Scope:** نقطة الدخول للمستهلكين لعقود خدمة Identity (Contract First).
>
> **Last Updated:** 2026-08-20 · **Status:** v1 + typed package · **Related Team:** Team 01 (producer) · جميع الفرق المستهلكة
>
> **التحديث (2026-08-20):** أنواع TypeScript متوفرة الآن لكلٍّ من **عقد API** (مولّدة من OpenAPI) و**عقد الأحداث** (مشتقّة من events.json) — راجع [§الأنواع المولّدة](#الأنواع-المولّدة-typescript) أدناه.

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

أُضيف حزمة `@wasla/contracts-identity` التي توفّر أنواع TS لكلٍّ من عقد API وعقد الأحداث (وفق [ADR-004](../../docs/15-decisions/ADR-004-typed-contracts-from-openapi.md)).

### أنواع API (مولّدة آلياً)

مولّدة من `api.openapi.yml` عبر `openapi-typescript`.

```ts
import type {
  ResolveIdentityRequest,
  ResolveIdentityResponse,
  IdentityUser,
  IdentityLink,
  paths,
} from "@wasla/contracts-identity";

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

### أنواع الأحداث (مشتقّة يدوياً + اختبار حماية انحراف)

مشتقّة من `events.json` يدوياً (لأن `json-schema-to-typescript` يُنتج نوعاً عاماً غير صالح للجذر ذي `$defs` فقط)، مع اختبار `events.test.ts` يقرأ `events.json` ويتحقق من توافق أنواع `event_type` + بنى الـ payload.

```ts
import type {
  IdentityEvent,
  IdentityCreatedV1,
  IdentityLinkAddedV1,
  TelegramUsernameChangedV1,
  RecoveryStartedV1,
  IdentityEventType,
} from "@wasla/contracts-identity";

const ev: IdentityEvent = {
  event_id: "550e8400-e29b-41d4-a716-446655440000",
  event_type: "identity.created",
  event_version: "v1",
  occurred_at: "2026-08-20T11:00:00Z",
  producer: "identity-service",
  aggregate: { type: "user", id: "550e8400-e29b-41d4-a716-446655440000" },
  payload: { wasla_public_id: "WS-0000010427", source: "customer_bot" },
};
```

> **القاعدة:** أنواع API مولّدة (لا تُعدَّل يدوياً)؛ أنواع الأحداث مشتقّة يدوياً مع اختبار حماية انحراف. المصدر الكنسي هو `api.openapi.yml` و`events.json`. أي تغيير يتطلب إعادة التوليد/التحديث + إعادة الاختبار + تحديث docs/.
