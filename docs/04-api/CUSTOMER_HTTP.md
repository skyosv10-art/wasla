# Customer Core Service — طبقة HTTP (Phase 04 · MR 4/6)

> **Scope:** توثيق طبقة HTTP الفعلية لخدمة Customer Core ومطابقتها للعقد، وحدودها مع المجال، ومحوّلاتها الخارجية.
>
> **المصدر الكنسي للعقد:** [`services/customers/contracts/api.openapi.yml`](../../services/customers/contracts/api.openapi.yml) · [`errors.md`](../../services/customers/contracts/errors.md)
>
> **الخدمة:** `services/customers` (منفذ **8086**) · **Status:** Active · **Last Updated:** 2026-08-21
>
> **Related Code:** `services/customers/src/http/{app.ts,errors.ts,requests.ts,server.ts}` · `services/customers/src/infrastructure/{http-identity-lookup.ts,http-geography.ts}` · `services/customers/src/__tests__/http/app.test.ts`
>
> **Related Team:** Team 04 — Customer Core
>
> **Related Docs:** [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · [CUSTOMER_CORE_DOMAIN.md](../02-architecture/CUSTOMER_CORE_DOMAIN.md) · [CUSTOMER_PERSISTENCE.md](../02-architecture/CUSTOMER_PERSISTENCE.md) · [GEOGRAPHY_HTTP.md](GEOGRAPHY_HTTP.md) · [HANDOFF_NEXT_STEPS](../16-progress/HANDOFF_NEXT_STEPS.md) · [MASTER_PROGRESS](../16-progress/MASTER_PROGRESS.md)

---

## 1. ماذا أُضيف

`createCustomerApp({ deps, logger?, health? })` — مصنع تطبيق Fastify يربط المسارات العشرة بالـuse cases **دون بدء الاستماع**، فالاختبارات تعمل عبر `app.inject` بلا منفذ ولا مقبس. التركيب النهائي (composition root) في `src/http/server.ts` وهو **الملف الوحيد** الذي يفتح اتصالاً أو يقرأ متغيّرات البيئة.

```text
services/customers/src/http/requests.ts   ← ترجمة snake_case (السلك) → camelCase (المجال)
services/customers/src/http/errors.ts     ← CustomerError → { code, message, trace_id }
services/customers/src/http/app.ts        ← المسارات + الترويسات + رموز الحالة
services/customers/src/http/server.ts     ← composition root (Postgres أو in-memory)
services/customers/src/infrastructure/http-identity-lookup.ts ← IdentityLookupPort عبر HTTP
services/customers/src/infrastructure/http-geography.ts       ← GeographyPort عبر HTTP
```

**لم يتغيّر ملف واحد في `src/use-cases/` ولا في `src/domain/`.** هذه الطبقة نقل لا قرار.

---

## 2. المسارات (مطابقة للـOpenAPI)

| Method | Path | نجاح | ملاحظات |
|---|---|---|---|
| GET | `/health` | 200 | `ok` أو `degraded` — انظر §5 |
| GET | `/customers/{id}/profile` | 200 | 404 `CUSTOMER_PROFILE_NOT_FOUND` |
| PUT | `/customers/{id}/profile` | **201** أول إنشاء · **200** تحديث | الحقل الغائب = «اتركه»، و`null` الصريح = «امسحه» |
| GET | `/customers/{id}/places` | 200 | `{ items, limit }` — `limit` = `SAVED_PLACES_LIMIT` (20) من العقد |
| POST | `/customers/{id}/places` | **201** إنشاء · **200** إعادة تشغيل نفس المفتاح | `Idempotency-Key` إلزامية |
| DELETE | `/customers/{id}/places/{placeId}` | **204** بلا جسم | 404 لمكان عميل آخر |
| POST | `/customers/{id}/order-requests/preview` | 200 | **لا كتابة، لا تسليم، لا حدث** |
| POST | `/customers/{id}/order-requests` | **201** تسليم · **200** إعادة تشغيل | `Idempotency-Key` إلزامية · fail-closed (§4) |
| GET | `/customers/{id}/order-requests` | 200 | `?status=` · `?limit=` (1..50، الافتراضي 20) |
| GET | `/customers/{id}/order-requests/{orderRequestId}` | 200 | 404 لطلب عميل آخر |

`{id}` هو `wasla_public_id` المعتّم (`^WS-[0-9]{10}$`). القراءات كلها **محدودة بالمالك**: معرّف يملكه عميل آخر يعيد **404 لا 403**، لأن 403 تعترف بوجود الكيان (ADR-009).

---

## 3. حدّ التحقق: من يقرّر ماذا

طبقة HTTP تتحقّق من **الشكل فقط**: هل الجسم كائن، هل `stops` مصفوفة، هل `limit` عدد صحيح داخل الحدود المنشورة، هل ترويسة `Idempotency-Key` موجودة. كل قاعدة ذات معنى تبقى في `domain/validation.ts`.

هذا ليس تفضيلاً أسلوبياً: **البوت في MR 5/6 ينادي الـuse cases مباشرة** بلا HTTP (ADR-007 — حياد القناة). أي قاعدة تُكتب هنا تصبح قاعدة لا تراها القناة، فتُقبَل عبر تلغرام ما تُرفَض عبر HTTP. ولهذا لا يوجد JSON Schema للمسارات: التحقق التعاقدي المزدوج يخلق مصدرَي حقيقة.

نتيجة عملية: `limit=abc` تُرفض ولا تُقصّ إلى 20 — القصّ الصامت يخفي عطباً في المنادي، والحدود منشورة في العقد.

---

## 4. الاعتماديات الخارجية وسلوكها عند الفشل

| المنفذ | المُهيّئ | 200 | 404 | غير ذلك / انقطاع |
|---|---|---|---|---|
| `IdentityLookupPort` | `HttpIdentityLookupPort` → `GET {IDENTITY_SERVICE_URL}/identity/users/{id}` | موجودة | غير موجودة → `CUSTOMER_IDENTITY_NOT_FOUND` (404) | `CUSTOMER_INTERNAL_ERROR` (503) — **لا تُعتبر «غير موجودة»** |
| `GeographyPort` | `HttpGeographyPort` → `GET {GEOGRAPHY_SERVICE_URL}/geo/zones/{id}?locale=ar` | `{ zoneId, status, path }` | `null` → `CUSTOMER_ZONE_NOT_FOUND` (404) | `CUSTOMER_INTERNAL_ERROR` (503) |
| `OrderIntakePort` | — (لا مُهيّئ في Phase 04) | — | — | `UnavailableOrderIntake` → 503 fail-closed |

**التسليم fail-closed:** فشل محرّك الطلبات لا يُسقط نيّة العميل. يُكتب صفّ بحالة `submission_failed`، ويُنشر حدث فشل، ويعود 503 `CUSTOMER_ORDER_INTAKE_UNAVAILABLE`. الطلب يظهر في `GET /order-requests` — مثبَّتٌ باختبار.

**`zone_path` أفضل-جهد:** عند قراءة مكان محفوظ أو طلب، يُستدعى الجغرافيا لعرض المسار المترجم. إن فشل النداء يعود `zone_path: null` ولا يفشل الطلب: منطقةٌ لا نعرف اسمها اليوم لا تبرّر حجب بيانات العميل المحلية عنه. الاستدعاء مرّة واحدة لكل منطقة مميّزة (لا توجد دالة دفعة في `GeographyPort`) — **دين مُعلن**، انظر §7.

**الافتراضي المحلي مقيّد لا متسامح:** بلا `GEOGRAPHY_SERVICE_URL` يُركَّب `FakeGeography([])`، أي أن كل منطقة غير موجودة. هذا مقصود: تجهيزةُ تطوير تقبل أي `zone_id` تُخفي عطباً حقيقياً حتى الإنتاج.

---

## 5. `/health` — لماذا `degraded` هو الافتراضي

| الحالة | الشرط |
|---|---|
| `ok` | استمرارية مضبوطة **و** `order_intake: configured` |
| `degraded` | `order_intake: unconfigured` (افتراضي Phase 04) |

بناءٌ لا يستطيع إتمام تسليم طلب واحد لا يحقّ له أن يقول `ok`. الحقلان `persistence` و`order_intake` معلنان في العقد، فالمراقبة تعرف **لماذا** تدهورت الخدمة لا أنها تدهورت فقط.

---

## 6. تعيين الأخطاء والتتبّع

كل خطأ يخرج بالشكل التعاقدي `{ code, message, trace_id }`. لا إعادة تصنيف في هذه الطبقة: كل `CustomerError` يحمل `httpStatus` من كتالوج `@wasla/contracts-customer` (المحروس ضد الانحراف باختبار)، والطبقة تكتبه كما هو.

| الحالة | Code | HTTP |
|---|---|---|
| ترويسة `Idempotency-Key` مفقودة | `CUSTOMER_MISSING_IDEMPOTENCY_KEY` | 400 |
| `id` لا يطابق النمط | `CUSTOMER_INVALID_PUBLIC_ID` | 400 |
| جسم مشوّه · `limit` خارج الحدود · **جسم ليس JSON صالحاً** | `CUSTOMER_INVALID_REQUEST_BODY` | 400 |
| كيان غير موجود / مملوك لغيره | `CUSTOMER_*_NOT_FOUND` | 404 |
| نفس المفتاح بحمولة مختلفة · وسم مكرّر · ملف موقوف · منطقة غير نشطة | `CUSTOMER_*` | 409 |
| خرق قاعدة عمل (سعر، محطات، شحنة) | `CUSTOMER_*` | 422 |
| محرّك الطلبات غير متاح · أي خطأ غير مُصنّف | `CUSTOMER_ORDER_INTAKE_UNAVAILABLE` · `CUSTOMER_INTERNAL_ERROR` | 503 |

**لا كود جديد أُضيف في هذا الـMR** — الأكواد الثمانية عشر كلها كانت معرّفة في العقد منذ MR 1/6.

قراران في `errors.ts` يستحقّان التسمية:

1. **جسم ليس JSON → 400 لا 503.** خطأ نقل من Fastify (`statusCode` 400 أو 415) هو خطأ منادٍ، وتسميته 503 تُخبر البوت أن يعيد المحاولة على طلبٍ لن ينجح أبداً.
2. **404 لمسار غير معروف يبقى 404 نقل** بشكل Fastify، ولا يُترجم إلى كود عميل: مسارٌ غير موجود ليس «كياناً مفقوداً»، وخلطهما يجعل خطأ إعداد يبدو خطأ بيانات.

**التتبّع:** `requestIdHeader: "x-request-id"` مُفعَّل (معطّل افتراضياً في Fastify 5)، فمعرّف الارتباط الذي يرسله المنادي هو نفسه الذي يظهر في `trace_id` وفي مغلّفات أحداث الـoutbox. غياب الترويسة يعيدنا إلى معرّف Fastify المولّد، فلا شيء يعتمد على المنادي.

---

## 7. الإعداد (Config)

| المتغير | الافتراضي | الأثر |
|---|---|---|
| `PORT` | `8086` | منفذ الاستماع |
| `HOST` | `0.0.0.0` | — |
| `DATABASE_URL` | — | إن وُجد: محوّلات Postgres، وإلا in-memory (تُفقد عند إعادة التشغيل) |
| `IDENTITY_SERVICE_URL` | — | إن وُجد: تحقّق فعلي من الهوية، وإلا وضع تطوير متسامح |
| `GEOGRAPHY_SERVICE_URL` | — | إن وُجد: جغرافيا فعلية، وإلا `FakeGeography([])` المقيّد |
| `IDENTITY_TIMEOUT_MS` · `GEOGRAPHY_TIMEOUT_MS` | `2000` | مهلة كل نداء صادر |

> **أمن:** لا أسرار في الكود ولا في الوثائق؛ كل الإعداد عبر البيئة. الوضع المتسامح للهوية للتطوير فقط — في الإنتاج **يجب** ضبط `IDENTITY_SERVICE_URL` و`GEOGRAPHY_SERVICE_URL`، وإلا فالخدمة تقبل هويات وهمية وترفض كل المناطق. المسارات لا تحمل ترخيصاً بعد: البوابة (Phase 06) هي من يحمل المصادقة، والخدمة تثق بشبكتها الداخلية — دين معلن في §8.

---

## 8. الديون المعلنة (منقولة بأمانة)

| الدين | لماذا لم يُحلّ هنا | إلى أين |
|---|---|---|
| **الذرّية بين الكتابة والـoutbox** | منفذ وحدة-عمل يمسّ 4 use cases ومُهيّئين وطاقم المطابقة — دفعة كاملة بحدّ ذاتها | Phase 09 (ناشر الـoutbox) — لا مستهلك اليوم فلا ضرر واقع. مذكور في [CUSTOMER_PERSISTENCE.md §7](../02-architecture/CUSTOMER_PERSISTENCE.md) |
| **استدعاء جغرافيا لكل منطقة مميّزة** | `GeographyPort` لا يعرّف دالة دفعة؛ إضافتها تغيير عقد | Phase 06 أو حين يظهر قياس فعلي |
| **لا مصادقة على المسارات** | الترخيص قرار البوابة لا قرار الخدمة (ADR-009) | Phase 06 — البوابة |
| **`requestIdHeader` غير مُفعَّل في Geography** | خارج نطاق هذه الدفعة | يُضبط عند أول عمل يمسّ `services/geography/src/http/app.ts` |

---

## 9. الاختبار والدليل

`services/customers/src/__tests__/http/app.test.ts` — **34 اختبار `app.inject`** يغطّي: `/health` في حالتيه، المسارات العشرة، 201 مقابل 200 على الإنشاء وإعادة التشغيل، 204 بلا جسم للحذف، رفض الكتابة بلا `Idempotency-Key`، 409 لنفس المفتاح بحمولة مختلفة، 404 لكيان عميل آخر، جدول تعيين 400/404/409/422، fail-closed 503 مع بقاء الصفّ والحدث، معاينة لا تكتب شيئاً، تحذيرات غير حاجبة، رفض `limit` خارج الحدود، جسم ليس JSON → 400، مسار مجهول → 404 نقل، وانتشار `x-request-id` إلى `trace_id` وإلى مغلّف الحدث.

**الدليل (تشغيل محلي):**

- `pnpm -r run typecheck` ✅
- `pnpm -r test` = **587 اختباراً** في 17 مشروعاً (خدمة العملاء: **100**، كانت 66) ✅
- تشغيل حقيقي `PORT=8099 pnpm --filter @wasla/customers-service start`: `/health` = `degraded/memory/unconfigured` · `PUT profile` = **201** ثم `GET profile` يعيد الاسم · `POST places` بلا ترويسة = `CUSTOMER_MISSING_IDEMPOTENCY_KEY` · تسليم بمنطقة غير مسجّلة = `CUSTOMER_ZONE_NOT_FOUND` بـ`trace_id: smoke-1` (انتشار الترويسة مُثبت) · مسار مجهول = 404 ✅
- اختبارات التكامل (43) لم تتغيّر ولم تُمسّ.

---

## 10. الخطوة التالية

- **MR 5/6:** ربط `bots/customer-bot` بالـuse cases **مباشرة** (لا HTTP) حفاظاً على حياد القناة (ADR-007).
- **MR 6/6:** بوابة خروج E2E للمرحلة 04 + وظيفة CI، ثم إغلاق المرحلة.
