# ADR-006 — مكدّس تنفيذ خدمة Geography & Localization + نموذج البيانات

> **Title:** اعتماد Node 20 + TypeScript + Fastify + PostgreSQL + Drizzle ORM لمكدّس تنفيذ خدمة Geography، مع نموذج بيانات هرمي (Country→Region→City→District→Zone) + جداول ترجمة منفصلة + مرجع هوية opaque
>
> **Status:** Accepted
>
> **Date:** 2026-08-20
>
> **Decision Owners:** مالك المشروع · Team 02 — Geography & Localization · Team 06 — i18n · Team 09 — Database · Team 10 — DevOps · Team 11 — Platform
>
> **Supersedes:** — (لا يُلغي أي قرار سابق)
>
> **Related:** [ADR-001](ADR-001-identity-decoupled-from-telegram.md) (هوية Wasla الأساسية) · [ADR-003](ADR-003-monorepo-tooling.md) (أساس البناء) · [ADR-004](ADR-004-typed-contracts-from-openapi.md) (العقود المُكتبة) · [ADR-005](ADR-005-identity-service-implementation-stack.md) (مكدّس Identity — نفس النمط) · [ROADMAP.md §3](../16-progress/ROADMAP.md) (Phase 02) · [ENGINEERING_DOCUMENTATION_LAW.md §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) (إضافة Library كبيرة بلا مبرر موثّق)

---

## Context

Phase 01 (Identity Foundation) مكتملة وفق [ADR-005](ADR-005-identity-service-implementation-stack.md): خدمة Identity (Fastify + Drizzle/Postgres) تعمل بوضعين (Postgres عبر `DATABASE_URL` أو في الذاكرة)، وExit Gate مُتحقَّق في CI (اختبار E2E ضد خدمة postgres:15).

الخطوة الموثّقة التالية نحو Phase 02 Exit Gate («المستخدم يغيّر موقعه دون إنشاء حساب جديد، وكل Module يستعمل Geo IDs + i18n AR/EN/UR») — كما هو موثّق في [MASTER_PROGRESS.md](../16-progress/MASTER_PROGRESS.md) و[HANDOFF_NEXT_STEPS.md §6](../16-progress/HANDOFF_NEXT_STEPS.md) — تبدأ بـ **اختيار المكدّس التقني للتنفيذ عبر ADR منفصل**، ثم التنفيذ ضد العقود/الأنواع، ثم اختبارات Contract، ثم اجتياز Exit Gate.

هذا الـ ADR هو ذلك القرار المنفصل: يُحدّد مكدّس التنفيذ + نموذج البيانات لخدمة Geography & Localization.

---

## Decision

### 1) المكدّس التقني

اعتماد نفس مكدّس Identity ([ADR-005](ADR-005-identity-service-implementation-stack.md)) لضمان الاتساق:

| المكوّن | الاختيار | المبرّر |
|---|---|---|
| Runtime | Node.js 20 (LTS) | متوافق مع [ADR-003](ADR-003-monorepo-tooling.md) |
| اللغة | TypeScript 5 (strict) | العقود المُكتبة بـTS |
| HTTP Runtime | Fastify + ajv | التحقق من مخططات OpenAPI مباشرة |
| قاعدة البيانات | PostgreSQL 15+ | عقد البيانات مكتوب بـPostgreSQL DDL |
| ORM | Drizzle ORM (schema-first) | مطابقة الـDDL التعاقدي |
| الاختبارات | Vitest | متوافق مع [ADR-003](ADR-003-monorepo-tooling.md) |
| التسجيل | pino | متوافق مع Identity |

**لا اعتماديات جديدة غير معتمدة في ADR-005** (drizzle-orm, drizzle-kit, pg, fastify, pino, tsx) — إعادة استخدام نفس المكدّس.

### 2) نموذج البيانات (Data Model)

العقد التعاقدي (`services/geography/contracts/schema.sql`) يُحدّد:

- **التسلسل الهرمي:** `geo_countries` → `geo_regions` → `geo_cities` → `geo_districts` → `geo_zones`. كل مستوى UUID PK + كود readable فريد ضمن سياقه (مثال: `(country_id, code)`) + status (active/inactive) + version (optimistic concurrency).
- **الترجمة (i18n):** جداول `*_names` منفصلة لكل مستوى (`geo_country_names`, `geo_region_names`, ...) — اسم واحد لكل (كيان، locale ∈ ar/en/ur). **لا JSONB.**
- **موقع المستخدم:** `geo_user_locations` keyed بـ`wasla_public_id` (PK، CHECK `^WS-[0-9]{10}$`).
- **السجل:** `geo_user_location_history` (old_zone_id, new_zone_id, changed_at, source).
- **Outbox:** `geo_outbox` (Domain Events من البداية).

### 3) قرار التغليف بين الخدمات (Service Decoupling)

- `geo_user_locations` تخزّن `wasla_public_id` كـ**مرجع opaque** — **لا FK إلى `identity_users`**. هذا يحقق تغليفاً بين الخدمتين: Geography لا تعرف internals الخاصة بـIdentity (لا تعتمد على `internal_uuid` أو بنية جداولها).
- التحقق من وجود الهوية يتم عبر **`IdentityLookupPort`** (منفذ في نواة Geography):
  - **الإنتاج:** استدعاء HTTP إلى خدمة Identity (`GET /identity/users/{waslaPublicId}`).
  - **الاختبار:** fake/in-process (لا اتصال شبكي حقيقي بين الخدمتين في اختبارات الوحدة/التكامل).
- نتائج البحث الجغرافي تُرجَع بالاسم المترجم حسب `locale` المطلوب، مع **fallback** إلى `ar` (اللغة الافتراضية/الأساسية) عند غياب الترجمة المطلوبة.

### 4) قرار الترجمة (i18n)

- i18n **داخل خدمة Geography** لهذه المرحلة — **لا حزمة i18n مستقلة بعد**. يُستخرج حزمة localization عامة لاحقاً فقط عند حاجة مرحلة أخرى لترجمة غير جغرافية قابلة لإعادة الاستخدام.
- **جداول ترجمة منفصلة (لا JSONB):** تكامل مرجعي (FK + ON DELETE CASCADE)، قيد فرادة `(entity, locale)`، فهرسة، وسلوك fallback نظيف. JSONB يفقد كل هذه المزايا.
- اللغات المدعومة: `ar` (الأساسية، RTL)، `en` (LTR)، `ur` (RTL). الأسماء العربية إلزامية لكل كيان (`ar` required في `LocalizedName`).

### 5) بيانات Saudi الأولية (Seed)

- ملف منفصل `contracts/seeds/saudi-arabia.sql` (لا يُدمج في `schema.sql`) — بيانات أولية idempotent (`INSERT ... ON CONFLICT DO NOTHING`).
- النطاق الأولي: بلد السعودية + منطقة المدينة + مدينة المدينة + حيّان/منطقتان على الأقل (لإثبات تغيير الموقع في Exit Gate). يُوسَّع لاحقاً لتغطية وطنية كاملة بعد التحقق من مصدر رسمي.

---

## Consequences

- **إيجابي:** تغليف نظيف بين Geography وIdentity (لا اقتران DB) — يسمح بتطوير/نشر كل خدمة بشكل مستقل. نموذج الترجمة بجداول منفصلة يوفر تكامل مرجعي وقيد فرادة وفهرسة. إعادة استخدام مكدّس Identity يقلل التعقيد.
- **سلبي:** التحقق من وجود الهوية عبر HTTP في الإنتاج يضيف قفزة شبكية (يُخفّف: port + fake في الاختبارات؛ يمكن إضافة cache قصير لاحقاً عند الحاجة).
- **مؤجّل (صريح):**
  - **PostGIS:** لا يُستعمل الآن (لا استعلامات مكانية في Phase 02 — الهرم إداري فقط). يُضاف لاحقاً عند الحاجة لبحث جغرافي مكاني (عبر ADR).
  - **Testcontainers:** مؤجّل — خدمة postgres في CI كافية وأبسط (كما في Identity).
  - **حزمة i18n مستقلة:** مؤجّلة حتى تحتاج مرحلة أخرى ترجمة غير جغرافية.
  - **تغطية Saudi كاملة:** مؤجّلة — البيانات الأولية تكفي لـExit Gate + bootstrap.

---

## Alternatives Considered

1. **JSONB للترجمة** (عمود `names JSONB` بدل جداول منفصلة): مرفوض — يفقد تكامل FK + قيد الفرادة + الفهرسة + fallback النظيف.
2. **FK من `geo_user_locations.wasla_public_id` إلى `identity_users`**: مرفوض — يقترن الخدمتان على مستوى DB، يكسر التغليف، ويمنع النشر المستقل.
3. **حزمة i18n مستقلة الآن**: مرفوض للمرحلة — لا حاجة فعلية بعد؛ YAGNI. يُستخرج عند ظهور طلب.
4. **PostGIS الآن**: مرفوض — لا استعلامات مكانية في Phase 02. يُضاف عند الحاجة عبر ADR.
5. **مكدّس مختلف عن Identity**: مرفوض — الاتساق يقلل التعقيد؛ نفس المكدّس أثبت نجاحه في Phase 01.

---

## Decision Drivers

- **القاعدة الحاكمة:** Contract First ([ADR-004](ADR-004-typed-contracts-from-openapi.md)) — العقود أولاً، ثم الأنواع المُكتبة، ثم التنفيذ.
- **Exit Gate لـPhase 02:** تغيير الموقع دون إنشاء هوية جديدة + i18n. نموذج البيانات + `IdentityLookupPort` يحققان هذا مباشرة.
- **التغليف:** لا اقتران DB بين الخدمات — قابلية النشر المستقل والتطوير المتوازي.

---

## Next Actions

تنفيذ خدمة Geography عبر MRs مستقلة وفق [HANDOFF_NEXT_STEPS.md §6](../16-progress/HANDOFF_NEXT_STEPS.md):

1. ~~عقود Geography + هذا الـ ADR~~ (هذا الـ MR).
2. النواة المجردة (domain + ports + in-memory + use-cases + locale fallback).
3. طبقة Drizzle/Postgres + Saudi seed.
4. طبقة Fastify HTTP.
5. تكامل CI/DB.
6. Exit Gate E2E (cross-service: identity + geography) + إغلاق Phase 02.
