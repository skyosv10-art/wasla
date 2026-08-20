# Geography Service — طبقة HTTP (Phase 02 · MR 5)

> **Scope:** توثيق طبقة HTTP الفعلية لخدمة Geography & Localization ومطابقتها للعقد.
>
> **المصدر الكنسي للعقد:** [`services/geography/contracts/api.openapi.yml`](../../services/geography/contracts/api.openapi.yml) · [`errors.md`](../../services/geography/contracts/errors.md)
>
> **Last Updated:** 2026-08-20 · **Status:** Active · **Related:** [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md) · [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) (نفس المكدّس: Node 20 + Fastify)

---

## 1. ماذا أُضيف

`createGeographyApp({ deps, logger })` — مصنع تطبيق Fastify يربط المسارات التسعة في العقد بالـuse cases، دون بدء الاستماع (Fastify `app.inject` في الاختبارات). التركيب النهائي (composition root) في `src/http/server.ts`.

```text
services/geography/src/http/app.ts      ← المسارات + التحقق الشكلي (locale/body)
services/geography/src/http/errors.ts   ← تعيين GeographyError → {code, message, trace_id}
services/geography/src/http/server.ts   ← composition root (Postgres أو in-memory)
services/geography/src/infrastructure/http-identity-lookup.ts ← IdentityLookupPort عبر HTTP
```

---

## 2. المسارات (مطابقة للـOpenAPI)

| Method | Path | 200/201 | ملاحظات |
|---|---|---|---|
| GET | `/health` | 200 | liveness فقط — خارج العقد |
| GET | `/geo/countries` | 200 | `?locale=ar\|en\|ur` (الافتراضي `ar`) |
| GET | `/geo/countries/{countryId}/regions` | 200 | 404 `GEO_COUNTRY_NOT_FOUND` |
| GET | `/geo/regions/{regionId}/cities` | 200 | 404 `GEO_REGION_NOT_FOUND` |
| GET | `/geo/cities/{cityId}/districts` | 200 | 404 `GEO_CITY_NOT_FOUND` |
| GET | `/geo/districts/{districtId}/zones` | 200 | 404 `GEO_DISTRICT_NOT_FOUND` |
| GET | `/geo/zones/{zoneId}` | 200 | يُرجع المسار الهرمي الكامل مترجماً |
| GET | `/geo/users/{waslaPublicId}/location` | 200 | 404 `GEO_USER_LOCATION_NOT_FOUND` |
| PUT | `/geo/users/{waslaPublicId}/location` | **201** أول تعيين · **200** تغيير/idempotent | جسم: `{ zone_id, source }` |
| GET | `/geo/users/{waslaPublicId}/location/history` | 200 | `old_zone = null` في أول إدخال |

---

## 3. تعيين الأخطاء

كل خطأ يخرج بالشكل التعاقدي `{ code, message, trace_id }`:

| الحالة | Code | HTTP |
|---|---|---|
| `locale` خارج ar/en/ur | `GEO_UNSUPPORTED_LOCALE` | 400 |
| `zone_id` مفقود أو `source` غير معروف | `GEO_INVALID_REQUEST_BODY` | 400 |
| Public ID لا يطابق `^WS-[0-9]{10}$` | `GEO_INVALID_PUBLIC_ID` | 400 |
| والد/منطقة/موقع غير موجود | `GEO_*_NOT_FOUND` | 404 |
| هوية غير موجودة (عبر `IdentityLookupPort`) | `GEO_IDENTITY_NOT_FOUND` | 404 |
| منطقة غير نشطة | `GEO_LOCATION_INACTIVE` | 409 |
| هرم غير صالح | `GEO_INVALID_HIERARCHY` | 422 |
| أي خطأ غير مُصنّف / تعذّر الوصول لخدمة الهوية | `GEO_INTERNAL_ERROR` | 503 |

> **كود جديد أُضيف في هذا الـMR:** `GEO_INVALID_REQUEST_BODY` (400) — إضافة فقط، لا تغيير دلالة أي كود قائم (مسموح صريحاً في [errors.md](../../services/geography/contracts/errors.md)). سبب الإضافة: العقد يعرّف استجابة 400 لـ`PUT` بلا كود مخصّص لجسم طلب مشوّه.

---

## 4. الاعتماد على خدمة الهوية

Geography لا تملك جدول الهويات (لا FK إلى `identity_users`، وفق ADR-006). قبل تعيين موقع تتحقق من وجود الهوية عبر `IdentityLookupPort`:

- **إنتاج:** `HttpIdentityLookupPort` → `GET {IDENTITY_SERVICE_URL}/identity/users/{waslaPublicId}` — `200` = موجودة، `404` = غير موجودة، أي شيء آخر/انقطاع = `GEO_INTERNAL_ERROR` (503 متدهور، لا يُعتبر «غير موجودة»)، مع مهلة افتراضية 2000ms.
- **تطوير/اختبار:** `InMemoryIdentityLookupPort` (متسامح، أو بقائمة `knownIds` لمحاكاة الهوية المفقودة).

---

## 5. الإعداد (Config)

| المتغير | الافتراضي | الأثر |
|---|---|---|
| `PORT` | `8081` | منفذ الاستماع (Identity على 8080) |
| `DATABASE_URL` | — | إن وُجد: محوّلات Postgres/Drizzle، وإلا in-memory (تجهيزة السعودية) |
| `IDENTITY_SERVICE_URL` | — | إن وُجد: التحقق الفعلي من الهوية عبر HTTP، وإلا وضع تطوير متسامح |

> **أمن:** لا أسرار في الكود؛ كل الإعداد عبر متغيّرات البيئة. الوضع المتسامح للهوية للتطوير فقط — في الإنتاج يجب ضبط `IDENTITY_SERVICE_URL`.

---

## 6. الاختبار

`services/geography/src/__tests__/http/app.test.ts` — 16 اختبار `app.inject` يغطّي: الصحة، المسارات التسعة، locale الافتراضي + en + ur، رفض locale غير مدعوم، الأخطاء 400/404، 201 أول تعيين ثم 200 تغيير (مسار الـExit Gate)، idempotency لنفس المنطقة، سجل التغييرات، وأحداث outbox (`geo.user_location.set` ثم `geo.user_location.changed`) مع `trace_id` مأخوذ من معرّف الطلب.

نتيجة التشغيل المحلي: `pnpm -r run typecheck` ✅ · `pnpm -r run test` = **96 اختباراً** (41 منها geography) ✅ · تجربة تشغيل حقيقية (`PORT=8099 pnpm --filter @wasla/geography-service start`) على `/health` و`/geo/countries?locale=en` و`PUT .../location` (201) و`history?locale=ur` ✅.

---

## 7. الخطوة التالية

- **MR 6:** توسيع CI بـ job تكامل قاعدة بيانات لـgeography (`postgres:15` + `pnpm --filter @wasla/geography-service test:integration`).
- **MR 7:** اختبار Exit Gate E2E لـPhase 02 (identity + geography + seed في قاعدة واحدة) ثم إغلاق المرحلة.
