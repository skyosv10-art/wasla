# Customer Core Contracts (Phase 04)

> **Scope:** العقود التعاقدية لخدمة Customer Core وفق [ADR-009](../../../docs/15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) — Contract First (ADR-004).

## الملفات

| الملف | الوصف |
|---|---|
| `schema.sql` | DDL لملف العميل + الأماكن المحفوظة + طلبات العميل ونقاطها + outbox |
| `events.json` | عقد أحداث المجال (JSON Schema 2020-12): `customer.profile.created.v1`، `customer.profile.updated.v1`، `customer.place.saved.v1`، `customer.place.removed.v1`، `customer.order_request.submitted.v1`، `customer.order_request.submission_failed.v1` |
| `api.openapi.yml` | عقد واجهة OpenAPI 3.1: الملف · الأماكن المحفوظة · معاينة الطلب وإنشاؤه · `OrderIntakeRequest` |
| `errors.md` | كتالوج أكواد الأخطاء الثابتة + مسارات الفشل |

## المبادئ

- **ملفُّ دور لا هوية:** مفتاح الملف `wasla_public_id` مرجع opaque (CHECK `^WS-[0-9]{10}$`) — **لا FK إلى `identity_users`**، والتحقّق من وجود الهوية عبر `IdentityLookupPort`. الشخص نفسه قد يكون عميلاً وسائقاً (§7).
- **حدود المجال:** `zone_id` مرجع opaque إلى الجغرافيا بلا FK (خدمة أخرى · قاعدة أخرى)، والتحقّق عبر `GeographyPort`.
- **الطلب ليس مِلكها:** الخدمة تُسلّم `OrderIntakeRequest` عبر `OrderIntakePort` ولا تكتب جدول `orders` ولا تملك آلة حالة الطلب (§15 · Phase 06). `order_public_id` يملكه المحرّك.
- **المال عدد صحيح:** `offered_amount_minor` بالوحدة الصغرى + `currency` بصيغة ISO — لا عدد عشري في المال. وضعا السعر صريحان: `customer_offer` أو `negotiable`، بلا سعر تقديري في هذه المرحلة.
- **Idempotency شرط كتابة:** ترويسة `Idempotency-Key` مطلوبة في إنشاء طلب أو مكان محفوظ؛ التكرار الحقيقي يُعيد الكيان نفسه (200)، والمفتاح نفسه بحمولة مختلفة يُرفض (409).
- **خصوصية الأحداث:** الحمولة على مستوى المنطقة الفرعية — بلا إحداثيات خام وبلا نصوص كتبها المستخدم.
- **الفشل مرئي:** تعذّر تسليم الطلب يُسجَّل صفاً `submission_failed` + حدث فشل + `CUSTOMER_ORDER_INTAKE_UNAVAILABLE` (503) — لا طلب صامت بلا مالك.

## الأنواع المُولّدة

الأنواع تُولّد في الحزمة `@wasla/contracts-customer`:

```bash
pnpm --filter @wasla/contracts-customer generate   # openapi-typescript
```

## Related

- [ADR-009](../../../docs/15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md)
- [CUSTOMER_CORE.md](../../../docs/03-domain/CUSTOMER_CORE.md) — نموذج المجال
- [MASTER_PROGRESS](../../../docs/16-progress/MASTER_PROGRESS.md) — Phase 04
