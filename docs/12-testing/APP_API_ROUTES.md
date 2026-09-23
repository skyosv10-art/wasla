# عقدُ المسارِ بين التطبيقِ والخدمةِ — الفحصُ 24

> **Scope:** كلُّ نداءِ API في `apps/*/src` (بلا الاختبارات) مقابلَ المساراتِ المُسجَّلةِ في `services/*/src`.
>
> **المحرِّك:** [`scripts/checks/lib/app_api_routes.py`](../../scripts/checks/lib/app_api_routes.py) · **المُشغِّل:** [`scripts/checks/validate-app-api-routes.sh`](../../scripts/checks/validate-app-api-routes.sh) · **حالاتُ الطفرة:** [`gov-cases-app-api-routes.sh`](../../scripts/checks/lib/gov-cases-app-api-routes.sh)
>
> **Last Updated:** 2026-09-23 · **Work Item:** `M3-08` · **Claim:** `CLM-0313`

---

## 1. السؤالُ الذي يجيبُ عنه

**مسارٌ يناديه تطبيقٌ: أله مسارٌ بالطريقةِ نفسِها في خدمةٍ، أم يُنادي فراغاً واختباراتُه خضراء؟**

## 2. لماذا وُجِد (قياس 2026-09-23 على `main` @ `a9e028f`)

اختباراتُ الواجهاتِ الثلاث (Vitest وPlaywright) تعترض **كلَّ** نداءٍ بمحاكاة (`page.route()` و`vi.fn()`). لذلك لا يوجد اختبارٌ واحد يثبت أنّ المسارَ **موجودٌ** في الخدمة. والقياسُ الأوّل لهذا المحرِّك وجد **10 نداءاتٍ مختلفة** بلا مسار، مع أنّ CI كلَّه أخضر:

- **لوحةُ الإدارة (`M3-04`، وكانت Completed):** تسعةُ نداءاتٍ بلا مسار، منها `GET /customers` و`POST /customers/:id/suspend` و`GET /drivers` (قائمة). ومنها أيضًا أربعةُ نداءاتٍ بالبادئة `/api/audit/…` و`/api/orders/…`، ولا بوّابةَ في المستودع تحذف هذه البادئة. وخدمةُ `services/audit/` التي تشترطها [`ADMIN_MVP_SPEC.md`](../01-product/ADMIN_MVP_SPEC.md) §6.2 **محذوفةٌ** (`96928bd`).
- **تطبيقُ السائق (`M3-02`، وكان Completed):** `GET /drivers/:id/jobs` هو ما تقوم عليه شاشةُ الأرباح وسجلِّ المهام (معيارُ القبول 8 في [`DRIVER_MINI_APP_SPEC.md`](../01-product/DRIVER_MINI_APP_SPEC.md) §10)، ولا مسارَ له.
- **تطبيقُ العميل (`M3-01`):** كلُّ نداءاته الـ13 المختلفة تطابق مسارًا قائمًا.

## 3. الأبوابُ الخمسة

| البابُ | ما يُسقِطُ الدفعة |
| --- | --- |
| 1 | نداءٌ لا يُقرأ مسارُه: ليس نصًّا حرفيًّا، ولا ثابتًا محلّيًّا يُحَلُّ إلى نصّ، ولا شرطيًّا فرعاه مسارٌ واحد. **العجزُ يُعلَن ولا يُقرأ مرورًا.** والاستثناءُ الوحيد وحدةُ النقلِ المُعلَنة أدناه |
| 2 | نداءٌ لا يطابق أيَّ مسارٍ في خدمة (الطريقة + القطع؛ معاملُ الخدمة `:x` يقبل أيَّ قطعة) ولا صفَّ له في §4 |
| 3 | **فجوةٌ ميتة:** صفٌّ في §4 صار له مسار، أو لم يَعُدْ مُنادى |
| 4 | فجوةٌ مملوكةٌ لبندٍ غيرِ موجودٍ في اللوحة، **أو لبندٍ `Completed`**، وهذا تناقض: إمّا أنّ البند لم يكتمل وإمّا أنّ الفجوة ليست فجوة |
| 5 | رقمٌ منشورٌ في §5 يخالف القياسَ الحيّ |

وحدةُ النقل هي الملفُّ الذي يُركِّب `${baseUrl}${path}`؛ مسارُه يأتيه من المُنادي، والمُنادي هو ما يُقاس:

<!-- app-api-transport:start -->
| الملف |
|---|
| apps/admin-portal/src/api/client.ts |
| apps/customer-mini-app/src/api/client.ts |
| apps/driver-mini-app/src/api/client.ts |
<!-- app-api-transport:end -->

## 4. سجلُّ الفجوات المُسجَّلة

كلُّ صفٍّ هنا يمثّل نداءً قائمًا في التطبيق **لا تخدمه أيُّ خدمة اليوم**. الصفُّ لا يبرّر الفجوة، بل يعلنها ويحدّد مالكها، ومالكُها لا يُكتب `Completed` ما دام الصفُّ حيًّا (البابُ 4). ويُحذف الصفُّ حين يُبنى المسار أو يُزال النداء (البابُ 3).

<!-- app-api-gaps:start -->
| التطبيق | الطريقة | المسار | البند المالك | السبب |
|---|---|---|---|---|
| admin-portal | GET | /api/audit/audit/events | M3-04 | `services/audit/` غيرُ موجودة (ADMIN_MVP_SPEC §6.2)؛ ولا بوّابةَ تحذف البادئة `/api/audit` |
| admin-portal | GET | /api/orders/orders/lookup | M3-04 | المسارُ `GET /orders/lookup` قائمٌ في `orders`، لكنّ البادئة `/api/orders` لا تُحذف في أيِّ طبقة |
| admin-portal | GET | /api/orders/orders/:orderId | M3-04 | كالسابق: `GET /orders/:orderId` قائمٌ والبادئة لا تُحذف |
| admin-portal | GET | /api/orders/orders/:orderId/history | M3-04 | كالسابق: `GET /orders/:orderId/history` قائمٌ والبادئة لا تُحذف |
| admin-portal | GET | /customers | M3-04 | لا مسارَ لقائمة العملاء في `customers` (ADMIN_MVP_SPEC §7: «يحتاج مسارات إدارية») |
| admin-portal | GET | /customers/:id | M3-04 | لا مسارَ لتفاصيل العميل للمشغّل؛ الموجودُ `/customers/:id/profile` بنطاق المالك |
| admin-portal | POST | /customers/:id/suspend | M3-04 | لا مسارَ لتعليق العميل |
| admin-portal | POST | /customers/:id/reinstate | M3-04 | لا مسارَ لإعادة تفعيل العميل |
| admin-portal | GET | /drivers | M3-04 | `drivers` تعرّف `POST /drivers` فقط، ولا قائمةَ للمشغّل |
| driver-mini-app | GET | /drivers/:id/jobs | M3-02 | شاشةُ الأرباح وسجلِّ المهام (معيارُ القبول 8) بلا مسار في `drivers` ولا في `dispatch` |
<!-- app-api-gaps:end -->

## 5. الأرقامُ المقيسة — تُقاس ولا تُكتب

<!-- app-api-counts:start -->
```
APPS_SCANNED = 3
SERVICE_ROUTES = 136
APP_CALL_SITES = 46
DISTINCT_APP_CALLS = 43
MATCHED_CALL_SITES = 36
REGISTERED_GAPS = 10
```
<!-- app-api-counts:end -->

| العدّاد | ما يقيسه |
| --- | --- |
| `APPS_SCANNED` | مجلّداتُ `apps/*/src` |
| `SERVICE_ROUTES` | أزواجٌ مختلفة (طريقة، مسار مُطبَّع) في `services/*/src` |
| `APP_CALL_SITES` | مواضعُ النداء المقروءة (`apiClient.x(...)` و`fetch(...)`) |
| `DISTINCT_APP_CALLS` | أزواجٌ مختلفة (تطبيق، طريقة، مسار) |
| `MATCHED_CALL_SITES` | مواضعُ تطابق مسارًا في خدمة |
| `REGISTERED_GAPS` | صفوفُ §4 |

## 6. حدودٌ مُعلَنة

1. **يقيس وجودَ المسار، ولا يقيس الوصولَ إليه.** التطبيقاتُ الثلاثة تُنشئ عميلها بـ`baseUrl` فارغ (أو `VITE_API_BASE_URL` في لوحة الإدارة)، والخدماتُ مضيفاتٌ منفصلة، ولا بوّابةَ ولا نشرَ للتطبيقات في المستودع. فمسارٌ «يطابق» هنا قد لا يُبلَغ في أيِّ بيئة. هذا بندٌ مستقلّ هو `M3-09`.
2. **لا يقيس شكلَ الجسم ولا الصلاحية.** الصلاحيةُ يغطّيها الفحصان 12 و16، وأمّا شكلُ الجسم فبلا حارس اليوم.
3. **يقرأ نمطين للنداء فقط:** `apiClient|api|client.<method>(...)` و`fetch(...)`. ونداءٌ بنمطٍ ثالث لا يُرى؛ لذلك يُقاس `APP_CALL_SITES` ويُنشر حتى يظهر النقصانُ عند مراجعة الفرق.
