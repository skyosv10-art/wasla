# Matching Service — طبقة HTTP (Phase 07 · MR 5b/6)

> **النوع:** توثيق واجهة (API Layer) · **Scope:** طبقة HTTP الفعلية لخدمة المطابقة، حدود معاملاتها، ترويساتها، وردودها المطابقة للعقد المنشور.
>
> **المصدر الكنسي للعقد:** [`services/matching/contracts/api.openapi.yml`](../../services/matching/contracts/api.openapi.yml) · [`errors.md`](../../services/matching/contracts/errors.md) · [`@wasla/contracts-matching`](../../packages/contracts/matching)
>
> **الخدمة:** `services/matching` (منفذ **8088**) · **Status:** Active · **Last Updated:** 2026-08-22
>
> **Related Code:** `services/matching/src/http/{app.ts,errors.ts,requests.ts,server.ts}` · `services/matching/src/runner.ts` · `services/matching/src/infrastructure/http-geography.ts` · `services/matching/src/{mappers.ts,domain/events.ts}` · `services/matching/src/__tests__/http-*.test.ts`
>
> **Related Team:** Team 04 — Matching
>
> **Related Docs:** [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) · [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) · [MATCHING_CORE_DOMAIN.md](../02-architecture/MATCHING_CORE_DOMAIN.md) · [MATCHING_PERSISTENCE.md](../02-architecture/MATCHING_PERSISTENCE.md) · [DISPATCH_HTTP.md](DISPATCH_HTTP.md)

---

## 1. ماذا أُضيف

`createMatchingApp({ runner, logger?, health? })` مصنع Fastify يربط المسارات السبعة المنشورة ولا يبدأ الاستماع؛ لذلك تستدعيه الاختبارات عبر `app.inject`. جذر التركيب في `src/http/server.ts` يختار Postgres عند وجود `DATABASE_URL`، أو ذاكرة معلنة، ويركّب `HttpZoneHierarchy` على `GEOGRAPHY_BASE_URL` أو `http://localhost:8081`.

```text
services/matching/src/runner.ts                    ← مقبس المعاملة: MatchingRunner {write, read}
services/matching/src/http/requests.ts             ← الترويسات وشكل JSON والسلك snake_case → المجال
services/matching/src/http/errors.ts               ← MatchingError أو فشل النقل → { code, message, trace_id }
services/matching/src/http/app.ts                  ← المسارات + حدود القراءة/الكتابة + /health
services/matching/src/http/server.ts               ← composition root (Postgres أو memory)
services/matching/src/infrastructure/http-geography.ts ← هرم المناطق عبر HTTP ومهلة 2000ms افتراضياً
```

**لم يُضَف سطرٌ واحد إلى `src/use-cases/` من أجل طبقة HTTP.** الحدّ النقلـي يستدعي حالات الاستخدام كما هي ولا ينسخ تحققها؛ تقييم المرشحين يكتب قرار تدقيق وحدثاً، ولذلك يعبر `runner.write` رغم أنه لا يغيّر ترشيحاً ولا ينشئ عرضاً.

### 1.1 لماذا `MatchingRunner` ولماذا لا يستقبل التطبيق التبعيات مباشرة

الواجهة تستقبل `MatchingRunner` لا `MatchingDependencies`. الكتابات تمر عبر `runner.write(work)`، والقراءات عبر `runner.read(work)`؛ وتنفيذ Postgres يمرر الكتابة إلى `PostgresMatchingUnitOfWork.run` والقراءة إلى `read`، بينما يبقي `createDirectRunner` السطح نفسه في الذاكرة.

- `POST /matching/candidates` كتابة لأن التقييم يحفظ قرار التدقيق ويضيف حدثاً.
- `PUT /candidacy/{driverPublicId}` و`POST /candidacy/{driverPublicId}/availability` كتابتان؛ القراءة اللاحقة للصف تقع داخل معاملة الكتابة نفسها.
- بقية مسارات القراءة لا تفتح معاملة كتابة.

بهذا يبقى قرار حد المعاملة في Runner، لا في معالج المسار. والقراءة اللاحقة بعد الكتابة لا تخمّن `is_fresh`: الخاصية محسوبة في `readCandidacy` ولا توجد في صف `Candidacy` المعاد من عمليتي الكتابة.

---

## 2. المسارات (مطابقة للعقد مع الحدود المُعلَنة في §8)

| Method | Path                                       | نجاح | ترويسات إلزامية   | ملاحظات                                                                 |
| ------ | ------------------------------------------ | ---- | ----------------- | ----------------------------------------------------------------------- |
| GET    | `/health`                                  | 200  | —                 | `ok` يتطلب Postgres ونسخة قواعد نشطة مجمّدة — §5                        |
| POST   | `/matching/candidates`                     | 200  | —                 | يقيّم ويكتب قرار تدقيق؛ «لا مرشّح» = قائمة فارغة مع `empty_reason_code` |
| PUT    | `/candidacy/{driverPublicId}`              | 200  | `Idempotency-Key` | استبدال كامل لصف الترشيح ثم إعادته مع `is_fresh` المحسوب                |
| GET    | `/candidacy/{driverPublicId}`              | 200  | —                 | صف غائب = 404                                                           |
| POST   | `/candidacy/{driverPublicId}/availability` | 200  | `Idempotency-Key` | يغيّر التوافر فقط؛ صف غائب = 404                                        |
| GET    | `/matching/rulesets`                       | 200  | —                 | يعيد `{rulesets:[…]}`                                                   |
| GET    | `/matching/decisions/{decisionId}`         | 200  | —                 | قراءة قرار التدقيق ومرشحيه ودرجاتهم                                     |

التقييم لا يطلب `Idempotency-Key` في التطبيق؛ ويرسل محوّل التوزيع الإنتاجي طلب المرشحين بلا هذا الرأس. نتيجة بلا مرشحين تظل `200`، ولا يرفعها مسار التقييم خطأً.

---

## 3. قواعد الترويسات

| الترويسة          | الحال                   | الحدود                   | عند الخطأ                                                                                            |
| ----------------- | ----------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `Idempotency-Key` | إلزامية في الكتابتين    | 8–128 محرفاً؛ قيمة مفردة | غائبة: `400 MATCHING_IDEMPOTENCY_KEY_REQUIRED`؛ خارج الحد أو مكررة: `400 MATCHING_VALIDATION_FAILED` |
| `x-request-id`    | اختيارية في كل المسارات | ≤ 128 محرفاً؛ قيمة مفردة | `400 MATCHING_VALIDATION_FAILED`                                                                     |

- `Fastify({ requestIdHeader: "x-request-id" })` يجعل `request.id` هو `trace_id` الممرر إلى حالات الاستخدام وردود الخطأ.
- المكررة تُرفض إن وصلت مصفوفة **أو** نصاً يحوي فاصلة. Node قد يدمج التكرار في قيمة مفصولة بفاصلة، ولذلك لا يكفي فحص `Array.isArray`.
- التحقق من طول معرّف الطلب يسبق كل مسار حتى لا يصل معرّف أطول من الحد إلى سجل التدقيق.
- لا يضيف جسم الخطأ حقلاً مستقلاً لقيمة الرأس أو الحقل المرفوضة؛ شكله `{code, message, trace_id}`.

---

## 4. حصر الملكية والردّ 404 لا 403

لا يطبق هذا الحد مصادقة أو رأس مالك، لذلك لا توجد في الكود قاعدة ملكية تقارن بين مُنادٍ وكيان، ولا حالة «404 بدلاً من 403» مماثلة لمحرك الطلبات. ردود `404` هنا تعني أن صف الترشيح أو قرار التدقيق غير موجودين، وتخرج بالرمزين `MATCHING_CANDIDACY_NOT_FOUND` و`MATCHING_DECISION_NOT_FOUND`.

ملكية البيانات تبقى مفصولة: المطابقة لا تعرف عرضاً ولا موجة ولا تكتب في محرك الطلبات؛ وهي تستدعي الجغرافيا فقط عبر `HttpZoneHierarchy`. `GET /matching/decisions/{decisionId}` مسار تشغيل وتدقيق، لا تدفق عميل أو سائق عام.

---

## 5. `/health`

```json
{
  "status": "degraded",
  "service": "matching-service",
  "persistence": "memory",
  "active_ruleset_version": 1
}
```

الحالة `ok` فقط عندما تكون `persistence = postgres` **وعندما** تعيد `runner.read(deps => deps.rulesets.findActive())` نسخة نشطة مجمّدة. فشل قراءة النسخة أو غيابها يعطي `active_ruleset_version: null` وحالة `degraded`؛ والذاكرة تبقى `degraded` حتى إن وجدت نسخة نشطة مجمّدة.

---

## 6. خريطة الأخطاء الكاملة (12 رمزاً)

طبقة HTTP لا تعيد تصنيف `MatchingError`: الرمز وحالة HTTP يأتيان من `@wasla/contracts-matching`. خطأ Fastify ذي الحالة 400 أو 415 يصبح `400 MATCHING_VALIDATION_FAILED`، وكل خطأ آخر يصبح `503 MATCHING_UNAVAILABLE`.

| الرمز                               | HTTP | يُرفع عند                                                                           |
| ----------------------------------- | ---: | ----------------------------------------------------------------------------------- |
| `MATCHING_VALIDATION_FAILED`        |  400 | جسم أو معامل أو رأس لا يطابق الشكل المتوقع؛ ومنها رأس مكرر أو `x-request-id` متجاوز |
| `MATCHING_IDEMPOTENCY_KEY_REQUIRED` |  400 | كتابة بلا `Idempotency-Key`                                                         |
| `MATCHING_CANDIDACY_NOT_FOUND`      |  404 | قراءة أو تغيير توافر لصف ترشيح غائب                                                 |
| `MATCHING_DECISION_NOT_FOUND`       |  404 | قراءة قرار تدقيق غائب                                                               |
| `MATCHING_IDEMPOTENCY_KEY_REUSED`   |  409 | المفتاح نفسه بحمولة مختلفة                                                          |
| `MATCHING_ZONE_UNKNOWN`             |  422 | منطقة لا يعثر عليها هرم الجغرافيا                                                   |
| `MATCHING_VEHICLE_CLASS_UNKNOWN`    |  422 | صنف مركبة خارج القائمة المغلقة                                                      |
| `MATCHING_SERVICE_KIND_UNKNOWN`     |  422 | نوع خدمة خارج `ride` و`delivery`                                                    |
| `MATCHING_RULESET_NOT_FOUND`        |  422 | نسخة قواعد مطلوبة غير موجودة                                                        |
| `MATCHING_RULESET_NOT_FROZEN`       |  422 | نسخة قواعد موجودة وغير مجمّدة                                                       |
| `MATCHING_RULESET_WEIGHTS_INVALID`  |  422 | مجموع أوزان النسخة ليس 100                                                          |
| `MATCHING_UNAVAILABLE`              |  503 | فشل غير معروف أو جغرافيا غير متاحة أو رد جغرافيا لا يمكن الوثوق ببنيته              |

### 6.1 الحدود

- `400` للهيئة والنقل؛ `422` لمدخل مفهوم لكن مرفوض من المجال، مثل `MATCHING_ZONE_UNKNOWN`.
- `404` من الجغرافيا لا يضاف إلى خريطة المناطق، أما أي حالة جغرافيا غير 200/404 أو انقطاع أو مهلة فتتحول إلى `MATCHING_UNAVAILABLE`؛ لا إعادة محاولة داخل المحوّل.
- لا مرشّح ليس خطأ: `CandidateResult` يعيد `candidates: []` و`empty_reason_code` عند النتيجة الفارغة.
- لا يحمل رد الخطأ `details` ولا صدى للقيمة المرفوضة، وإن كانت تفاصيل مقيدة موجودة داخل الخطأ المجالي.

---

## 7. تغييرات المجال

لم تضف طبقة HTTP قاعدة عمل جديدة إلى المجال. التحويل في `requests.ts` يتحقق من كون الجسم كائناً ومن حقول المصفوفات، ثم يمرر القيم إلى تحقق المجال؛ والمحوّل في `mappers.ts` هو الموضع الصريح لتحويل camelCase إلى snake_case.

الحد الخارجي للجغرافيا جزء من التركيب: يحل `HttpZoneHierarchy.resolve` المعرفات الفريدة بالتوازي، بمهلة افتراضية 2000ms لكل طلب، ويستخدم فقط `GET /geo/zones/{id}`. لا يعامل انقطاع الجغرافيا منطقةً مجهولة.

---

## 8. الانحرافات والحدود المُعلَنة

| #   | الانحراف / الحد                                                                                                                                               | لماذا                                                                                                                                                                                                               | البديل ولماذا رُفض                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `POST /matching/candidates` يعيد `driver_public_id` و`score_bp` ضمن `candidates`، رغم أن وصف العقد العام يقول إن الدرجات لا تعاد في مسار عام                  | مخطط `CandidateResult` المنشور يعرّف الحقلين، و`HttpMatchingPort` في التوزيع يحتاج معرف السائق ليبني العروض. الخصوصية محصورة في **حمولات الأحداث**: `matchingEvaluated` لا يضع قائمة مرشحين ولا درجات ولا معرف سائق | حذف الحقول من الاستجابة — مرفوض: التوزيع لن يعرف السائق الذي يسجل له العرض، وسيخالف المخطط المنشور                                                                                  |
| 2   | فحص الرأس المكرر يرفض الفاصلة إلى جانب المصفوفة                                                                                                               | Node قد يدمج الرؤوس المكررة في نص بفاصلة؛ قبول النص المدموج يعطي الخدمة مفتاحاً لم يرسله مُنادٍ منفرد                                                                                                               | قبول القيمة المدموجة — مرفوض: اختيار صامت لقيمة غامضة. `services/orders/src/http/requests.ts` ما زال يفحص `Array.isArray` وحدها ولا يفحص الفاصلة؛ لم يُصلح هنا عمداً لانضباط النطاق |
| 3   | بعد PUT أو تغيير التوافر يعيد التطبيق قراءة الترشيح داخل المعاملة                                                                                             | `isFresh` محسوب وغائب عن `Candidacy` المعادة من الكتابتين، فلا يجوز لطبقة النقل اختراعه                                                                                                                             | اشتقاقه في HTTP من الصف — مرفوض: منطق وقت موازٍ لمسار GET                                                                                                                           |
| 4   | `/health` يحتاج Postgres **ونسخة قواعد نشطة مجمّدة** ليعلن `ok`                                                                                               | وجود مخزن دائم وحده لا يكفي لتقييم ترتيب إذا لم يمكن قراءة نسخة قواعد نشطة مجمّدة                                                                                                                                   | إعلان `ok` من حالة التخزين وحدها — مرفوض: يخفي فشلاً سيظهر عند أول تقييم                                                                                                            |
| 5   | فرض `additionalProperties: false` يقع في `onlyKeys` داخل `requests.ts`، بقائمة مفاتيح مكتوبة بيد لكل حمولة، لا بمُحقِّق مُولَّد من المخطط | كانت المحوّلات تنتقي الحقول المعروفة وتتجاهل الزائد بصمت — فمُنادٍ كتب `pickup_zone` بدل `pickup_zone_id` كان يتلقّى خطأ حقل مفقود غامضاً، ومُنادٍ أرسل حقلاً أُزيل من العقد كان يظنّ أنه ما زال يعمل. القبول الصامت يحوّل خطأ المُنادي إلى سلوك صحيح ظاهرياً | ربط مُحقِّق JSON Schema من العقد بمسارات Fastify — مرفوض في هذه الدفعة لا في المبدأ: يُدخل مُحقِّقاً ثانياً بجوار تحقق المجال فيصير للرفض موضعان ورسالتان. القائمة اليدوية مقبولة لأن حرّاس انحراف حزمة العقود تُفشل البناء إن تغيّر المخطط، والقائمة تُراجَع معه |

---

## 9. الأدلّة (لا «Done» بلا دليل)

| الادّعاء                         | الدليل                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| جميع مسارات التطبيق وحدود Runner | `services/matching/src/http/app.ts:49-146`                                                                                                             |
| كتابة التقييم ونتيجة الفراغ      | `services/matching/src/http/app.ts:80-87` · `src/__tests__/http-candidates.test.ts` — `يعيد 200 وسبب الفراغ ولا يطلب Idempotency-Key`                  |
| التفصيل في مسار القرار           | `src/__tests__/http-candidates.test.ts` — `يمرر النتيجة التفصيلية المنشورة إلى مسار التدقيق`                                                           |
| رفض الرأس المكرر                 | `services/matching/src/http/requests.ts:40-47` · `src/__tests__/http-errors.test.ts` — `يرد 400 لترويسة منع تكرار مكررة في المسار HTTP`                |
| شرط صحة الخدمة المزدوج           | `services/matching/src/http/app.ts:61-78` · `src/__tests__/http-health.test.ts` — `لا يعلن ok إلا مع Postgres ونسخة قواعد مجمدة`                       |
| خصوصية حدث التقييم               | `services/matching/src/domain/events.ts:102-135` · `src/__tests__/evaluate-candidates.test.ts` — `emits counts only — never a candidate id or a score` |
| محوّل الجغرافيا والمهلة          | `services/matching/src/infrastructure/http-geography.ts:63-95` · `src/__tests__/http-geography.test.ts` — `يلغي الطلب عند انقضاء المهلة الصارمة`       |
| رفض المفتاح غير المُعلَن في العقد | `services/matching/src/http/requests.ts` — `onlyKeys` · `src/__tests__/http-errors.test.ts` — `يرفض مفتاحاً زائداً في حمولة المرشحين لأن العقد يمنع الخصائص الإضافية` وأخواتها الثلاث |
| اختبارات الخدمة                  | `pnpm --filter @wasla/matching-service test` ⇒ **12 ملفاً · 160 اختباراً ناجحاً** (لقطة 2026-08-22)                                                    |

**غير مُغطّى هنا:** `server.ts` تركيب وتشغيل؛ الاختبارات تبني التطبيق بحقن Runner، ولا تفتح منفذاً أو اتصال قاعدة بيانات.

---

## 10. ماذا بعد

- استخلاص قوائم `onlyKeys` من `api.openapi.yml` وقت البناء بدل كتابتها بيد، حتى لا يبقى الاتساق معتمداً على مراجعةٍ بشرية بجوار حارس الانحراف.
- إزالة فجوة فحص الفاصلة في `services/orders/src/http/requests.ts` في عمل مستقل؛ هذه الوثيقة لا تعدّل محرك الطلبات.
- يبقى تشغيل التوزيع المستهلك للمطابقة موثقاً في [DISPATCH_HTTP.md](DISPATCH_HTTP.md)، وتبقى حدود عدم خلط المطابقة بالتوزيع في [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md).
