# Geography & Localization Contracts (Phase 02)

> **Scope:** العقود التعاقدية لخدمة Geography & Localization وفق [ADR-006](../../../docs/15-decisions/ADR-006-geography-localization-stack-and-model.md) — Contract First (ADR-004).

## الملفات

| الملف | الوصف |
|---|---|
| `schema.sql` | DDL للتسلسل الهرمي الجغرافي + جداول الترجمة + موقع المستخدم + history + outbox |
| `events.json` | عقد أحداث المجال (JSON Schema 2020-12): `geo.user_location.set.v1`، `geo.user_location.changed.v1` |
| `api.openapi.yml` | عقد واجهة OpenAPI 3.1: استعلام الهرم + موقع المستخدم |
| `errors.md` | كتالوج أكواد الأخطاء الثابتة |

## المبادئ

- **التسلسل الهرمي:** Country → Region → City → District → Zone. كل مستوى UUID + كود readable فريد ضمن سياقه.
- **الترجمة (i18n):** جداول `*_names` منفصلة لكل مستوى — اسم واحد لكل (كيان، locale ∈ ar/en/ur). **لا JSONB.** ar = اللغة الافتراضية/الأساسية (fallback).
- **تغليف الخدمات:** `geo_user_locations` تخزّن `wasla_public_id` كمرجع opaque (CHECK `^WS-[0-9]{10}$`) — **لا FK إلى `identity_users`**. التحقق من وجود الهوية عبر `IdentityLookupPort` (إنتاج: HTTP إلى identity؛ اختبار: fake).
- **استقرار الهوية:** تغيير الموقع لا يُنشئ هوية جديدة — يُسجَّل في `geo_user_location_history` + حدث في `geo_outbox`.

## الأنواع المُولّدة

الأنواع تُولّد في الحزمة `@wasla/contracts-geography`:

```bash
pnpm --filter @wasla/contracts-geography generate   # openapi-typescript
```

## Related

- [ADR-006](../../../docs/15-decisions/ADR-006-geography-localization-stack-and-model.md)
- [MASTER_PROGRESS](../../../docs/16-progress/MASTER_PROGRESS.md) — Phase 02
