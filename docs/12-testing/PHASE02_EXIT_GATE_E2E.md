# اختبار بوابة خروج Phase 02 (E2E)

> **الحالة:** مُنفَّذ · Phase 02 · MR 7 · آخر تحديث 2026-08-20
> **الملف:** `services/geography/src/__tests__/phase02-exit-gate.e2e.test.ts`

## البوابة المطلوبة

نص بوابة الخروج كما هو موثَّق في [خريطة الطريق](../16-progress/ROADMAP.md) و[لوحة التقدّم](../16-progress/MASTER_PROGRESS.md):

> «المستخدم يغيّر موقعه دون إنشاء حساب جديد، وكل Module يستعمل Geo IDs + i18n (AR/EN/UR).»

هذا الاختبار هو **الدليل التنفيذي** على البوابة، لا وصفاً لها: ما لم ينجح، لا تُغلق المرحلة.

## لماذا اختبار واحد يجمع الخدمتين؟

كل الاختبارات السابقة تتحقّق من خدمة واحدة معزولة: اختبارات الوحدة تستخدم محوّلات في الذاكرة، واختبارات التكامل (MR !19) تستخدم Postgres حقيقياً لكن مع **بديل مزيّف** لمنفذ الهوية (`identityExists → true` دائماً). أي أن الشرط الحقيقي للبوابة — «دون إنشاء حساب جديد» — لم يكن مُختبَراً أبداً عبر الحدود بين الخدمتين.

لذلك يُشغّل هذا الاختبار الخدمتين معاً كما في الإنتاج:

```text
identity (Fastify)  → Postgres (identity_*)     يستمع فعلياً على 127.0.0.1:<port عشوائي>
        ▲
        │ HTTP (GET /identity/users/{waslaPublicId})
        │
geography (Fastify) → Postgres (geo_*)          يُستدعى عبر app.inject
        └── HttpIdentityLookupPort ──────────────┘
```

قرارات مقصودة:

| القرار | السبب |
| --- | --- |
| خدمة الهوية **تستمع على منفذ حقيقي** (`port: 0`) | لتشغيل محوّل الإنتاج `HttpIdentityLookupPort` عبر HTTP فعلي — لا بديل مزيّف. هذا ما يُثبت العقد بين الخدمتين. |
| خدمة الجغرافيا عبر `app.inject` | لا حاجة لمنفذ ثانٍ؛ `inject` يشغّل نفس مسار Fastify كاملاً. |
| المخططان في **نفس قاعدة الاختبار** | البوابة تتحقّق من التكامل السلوكي لا من طوبولوجيا النشر؛ ولا يوجد أي FK بين المخططين ([ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)) فلا يخلق ذلك ارتباطاً. |
| `wasla_public_id` مرجع مُعتَّم | الجغرافيا لا تقرأ جداول الهوية أبداً؛ تسأل الهوية عبر HTTP فقط. |

## ما يتحقّق منه فعلياً

**1) تغيير الموقع دون حساب جديد**

- إنشاء المستخدم في الهوية فقط (`POST /identity/resolve` → 201، `WS-\d{10}`).
- أول تعيين موقع → **201** و`version = 1` (الجغرافيا تتحقّق من وجود الهوية عبر HTTP).
- الانتقال إلى نطاق آخر → **200**، نفس `wasla_public_id`، `version = 2`.
- إعادة `resolve` بعد الانتقال → **200** مع `created: false` وثبات `wasla_public_id` و`internal_uuid` → لم يُنشأ حساب ثانٍ.
- تغيير اسم مستخدم تلغرام → الهوية ثابتة، والموقع كما هو.
- `history` يحمل مدخلين: الأول `old_zone = null`، والثاني `old_zone` = النطاق السابق → المستخدم **انتقل** ولم يُعَد إنشاؤه.
- `outbox` يحمل لهذا المستخدم `geo.user_location.set` ثم `geo.user_location.changed` بالترتيب، ومُفتَّحة بـ`wasla_public_id` كمُعرِّف الـaggregate.

**2) Geo IDs + i18n في كل مستوى**

- `countries` بلا `locale` → العربية (الافتراضي)، و`locale=en` → `Saudi Arabia`.
- `regions?locale=ur` → `مدینہ علاقہ`.
- `cities?locale=en` تُرجع المدينة بمعرّفها (Geo ID) لا باسم نصّي.
- `districts?locale=en` لحي الحرة → ترجمته الحقيقية `Al-Hara District`، و`locale=ur` (لا ترجمة أردية في البيانات الأولية) → **يرجع إلى العربية**: `حي الحرة`.
- `zones?locale=en` لنطاق الحرة الشرقية (بالعربية فقط) → **يرجع إلى العربية**: `الحرة الشرقية`.
- `GET /geo/zones/{id}` يُرجع المسار الكامل (`path.district/city/region/country`) بمعرّفات UUID مع الأسماء المترجمة.

**3) لا مواقع معلّقة بلا هوية**

- `PUT` لمعرّف عام صحيح الشكل لكن غير موجود (`WS-9999999999`) → **404 `GEO_IDENTITY_NOT_FOUND`**، لأن خدمة الهوية الحقيقية أجابت 404 عبر HTTP.
- `GET` لموقع غير مُسجَّل → **404 `GEO_USER_LOCATION_NOT_FOUND`**.

## كيف يُشغَّل

في CI: داخل وظيفة `geography-db-integration` تلقائياً (انظر [تكامل قاعدة البيانات في CI](DB_INTEGRATION_CI.md)) — الملف يطابق نمط `src/__tests__/*.{integration,e2e}.test.ts` في `vitest.integration.config.ts`.

محلياً:

```bash
docker run -d --name wasla-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:15
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/postgres"
pnpm --filter @wasla/geography-service test:integration
```

بدون `DATABASE_URL` تُتخطّى المجموعة كاملة (`describe.skipIf`)، وهي خارج `pnpm -r test` الافتراضي.

## قيود واعية

- **التنفيذ متسلسل إلزاماً:** `fileParallelism: false` في `vitest.integration.config.ts`. كل ملف تكامل يملك مخطط **نفس** القاعدة (DROP + DDL + seed)، فالتوازي يسبّب تسابقاً على الجداول.
- `@wasla/identity-service` أُضيفت في `devDependencies` للجغرافيا **لأجل هذا الاختبار وحده**؛ لا كود إنتاجي في الجغرافيا يستوردها، والاتصال في الإنتاج يبقى عبر HTTP.
- البيانات الأولية المستخدمة سعودية/المدينة فقط (نطاقان)، وهي كافية لتغطية fallback الترجمة وتغيير النطاق.
- لا يغطّي الاختبار ناقل الأحداث (outbox → مستهلك)؛ النشر الفعلي للأحداث مؤجَّل لمرحلة لاحقة، والتحقّق هنا يقف عند كتابة الحدث في `geo_outbox`.

## مراجع

- [بوابات المراحل وخريطة الطريق](../16-progress/ROADMAP.md)
- [تكامل قاعدة البيانات في CI](DB_INTEGRATION_CI.md)
- [واجهة HTTP لخدمة الجغرافيا](../04-api/GEOGRAPHY_HTTP.md)
- [ADR-006 — نموذج الجغرافيا والترجمة](../15-decisions/ADR-006-geography-localization-stack-and-model.md)
