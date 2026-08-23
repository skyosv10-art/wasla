# Dispatch Service — طبقة HTTP (Phase 07 · MR 5b/6)

> **النوع:** توثيق واجهة (API Layer) · **Scope:** طبقة HTTP الفعلية لخدمة التوزيع، النبضة الصريحة، حدود المعاملة، محولي المطابقة ومحرك الطلبات، ومطابقتها للعقد.
>
> **المصدر الكنسي للعقد:** [`services/dispatch/contracts/api.openapi.yml`](../../services/dispatch/contracts/api.openapi.yml) · [`errors.md`](../../services/dispatch/contracts/errors.md) · [`@wasla/contracts-dispatch`](../../packages/contracts/dispatch)
>
> **الخدمة:** `services/dispatch` (منفذ **8089**) · **Status:** Active · **Last Updated:** 2026-08-23
>
> **Related Code:** `services/dispatch/src/http/{app.ts,errors.ts,requests.ts,server.ts}` · `services/dispatch/src/{runner.ts,run-tick.ts,ports.ts,mappers.ts}` · `services/dispatch/src/infrastructure/{http-matching.ts,http-order-engine.ts}` · `services/dispatch/src/__tests__/{http-*.test.ts,run-tick.test.ts}`
>
> **Related Team:** Team 05 — Dispatch
>
> **Related Docs:** [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) · [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) · [DISPATCH_CORE_DOMAIN.md](../02-architecture/DISPATCH_CORE_DOMAIN.md) · [DISPATCH_PERSISTENCE.md](../02-architecture/DISPATCH_PERSISTENCE.md) · [MATCHING_HTTP.md](MATCHING_HTTP.md)

---

## 1. ماذا أُضيف

`createDispatchApp({ runner, health?, tickState?, logger? })` مصنع Fastify لمسارات الصحة والمهام والعروض والنبضة، ولا يبدأ الاستماع. جذر التركيب يختار Postgres مع محولي HTTP الحقيقيين عند وجود `DATABASE_URL`، وإلا يركّب ذاكرة مع منفذي matching وorders غير متاحين عمداً.

```text
services/dispatch/src/runner.ts                    ← مقبس المعاملة: DispatchRunner {write, read}
services/dispatch/src/run-tick.ts                  ← قراءة النشطين والساعة مرة، ثم معاملة لكل مهمة
services/dispatch/src/http/requests.ts             ← الترويسات ومسارات UUID ورفض المفاتيح الزائدة
services/dispatch/src/http/errors.ts               ← DispatchError أو فشل النقل → { code, message, trace_id }
services/dispatch/src/http/app.ts                  ← المسارات + /health + tickState
services/dispatch/src/infrastructure/http-matching.ts ← عميل المرشحين وتحديث توافر القبول
services/dispatch/src/infrastructure/http-order-engine.ts ← تسجيل العرض وحسمه وانتقال الطلب
services/dispatch/src/http/server.ts               ← composition root (Postgres أو memory)
```

أضيفت حالة استخدام القراءة `readDispatchOffer` إلى `src/use-cases/read-job.ts`: تقرأ العرض ثم مهمته بلا كتابة، وتعيد `null` للعرض الغائب كي يترجمه حد HTTP إلى `404`. لا يعيد `run-tick.ts` تنفيذ منطق `src/use-cases/tick.ts`: يقرأ المهام النشطة والساعة، ثم يستدعي `tick` لكل مهمة مع نطاقها وساعة النبضة المجمدة.

### 1.1 لماذا `DispatchRunner` ولماذا لا يستقبل التطبيق التبعيات مباشرة

الكتابات العادية تستدعي `options.runner.write`، والقراءات تستدعي `options.runner.read`؛ تنفيذ Postgres يمرر الكتابة إلى وحدة العمل. لا يفتح معالج HTTP المعاملة بنفسه.

النبضة لها حد أوضح: `runTick` يقرأ قائمة المهام النشطة و`clock.now()` في قراءة واحدة، ثم يفتح **معاملة كتابة لكل مهمة**. `scopeToJob` ليس نسخة spread من المستودع؛ إنه كائن تفويض صريح، لأن نشر نسخة صنف لا يحفظ دواله. `withTickClock` يمرر ساعة تعيد `tickAt` نفسه لكل مهمة.

---

## 2. المسارات (مطابقة للـOpenAPI)

| Method | Path                                 | نجاح                               | ترويسات إلزامية   | ملاحظات                                          |
| ------ | ------------------------------------ | ---------------------------------- | ----------------- | ------------------------------------------------ |
| GET    | `/health`                            | 200                                | —                 | يعلن التخزين و`last_tick_at` — §5                |
| POST   | `/dispatch/jobs`                     | **201** جديد · **200** إعادة مفتاح | `Idempotency-Key` | الإنشاء لا يفتح موجة                             |
| GET    | `/dispatch/jobs/{job_id}`            | 200                                | —                 | `job_id` UUID فقط                                |
| GET    | `/dispatch/jobs/{job_id}/offers`     | 200                                | —                 | `{items:[…]}` من المستودع                        |
| GET    | `/dispatch/offers/{offer_id}`        | 200                                | —                 | عرض واحد مع سياق مهمته و`standing`              |
| POST   | `/dispatch/tick`                     | 200                                | `Idempotency-Key` | جسم غائب فقط؛ هو الموضع HTTP الوحيد لتحريك الزمن |
| POST   | `/dispatch/offers/{offer_id}/accept` | 200                                | `Idempotency-Key` | يقبل عرضاً موجوداً                               |
| POST   | `/dispatch/offers/{offer_id}/reject` | 200                                | `Idempotency-Key` | الجسم يحوي `reason_code`                         |
| POST   | `/dispatch/jobs/{job_id}/cancel`     | 200                                | `Idempotency-Key` | الجسم يحوي `reason_code`                         |

`POST /dispatch/jobs` يميز 201 عن 200 باستخدام `result.replayed`. لا يفتح إنشاء المهمة موجة؛ الاختبار يثبت أن الموجة تفتح عبر `POST /dispatch/tick` فقط. لا حلقة خلفية ولا `setTimeout` في معالج HTTP.


---

## 3. قراءة عرض واحد للتفاوض

`GET /dispatch/offers/{offer_id}` يعيد حقول `DispatchOffer` نفسها، ومعها `order_public_id` و`order_id`
و`order_type` و`vehicle_class` و`job_status` و`standing`. المستهلك المقصود هو خدمة التفاوض على
المنفذ **8091** قبل أن تفتح خيطاً: وجود معرّف العرض وحده لا يكفي لفتح خيط على عرضٍ انتهت صلاحيته
تشغيلياً أو على مهمة وصلت إلى نهاية نهائية.

| الحقل | لماذا يُعاد |
| ----- | ----------- |
| `order_public_id` و`order_id` | مرجعان opaque للطلب الذي سيُربط به خيط التفاوض؛ لا يعيدان حالة orders ولا سجله. |
| `order_type` و`vehicle_class` | سياق العرض المثبت في المهمة، لا قرار أهلية أو ترتيب بديل. |
| `job_id` و`job_status` | يبيّنان المهمة التي تملك العرض وما إذا كانت ما زالت قابلة للمسار. |
| `standing` | قرار مجال محسوب: `status = offered` والمهمة ليست نهائية. |

لا يحسب `standing` من مقارنة `expires_at` بساعة الحائط. في التوزيع الزمن **نبضة لا مؤقت**: النبضة
وحدها تسجل انتقال العرض من `offered` إلى `timed_out`. لذلك إذا مضى الموعد المحفوظ وتأخرت النبضة،
يبقى `standing: true` عمداً حتى تسجل النبضة القرار؛ جعل القراءة تقلبه محلياً ينتج حقيقتين لنفس
العرض، ويجعل زيارة صفحة أو نداء تفاوض يبدو كأنه تقدم دورة حياته بلا حدث أو سجل.

هذه قراءة فقط، لذلك لا تطلب `Idempotency-Key` ولا تدخل `runner.write`: لا تكتب قراراً ولا تعيد
محاولة أثر شبكي. تستخدم `runner.read` كي لا تحتجز معاملة كتابة من أجل استجابة JSON واحدة؛ أما
`404` فيصدر عندما تعيد حالة الاستخدام `null` للعرض الغائب، فيظل غياب المورد نتيجة HTTP لا استثناء
مجالياً.

---

## 4. قواعد الترويسات

| الترويسة          | الحال                                             | الحدود                             | عند الخطأ                        |
| ----------------- | ------------------------------------------------- | ---------------------------------- | -------------------------------- |
| `Idempotency-Key` | إلزامية في الكتابات الخمس، ومنها `/dispatch/tick` | 8–128 محرفاً؛ قيمة مفردة بلا فاصلة | `400 DISPATCH_VALIDATION_FAILED` |
| `x-request-id`    | اختيارية                                          | ≤ 128 محرفاً؛ قيمة مفردة بلا فاصلة | `400 DISPATCH_VALIDATION_FAILED` |

- `requestIdHeader: "x-request-id"` يجعل `request.id` هو `trace_id` المار إلى حالات الاستخدام وردود الخطأ.
- `singleHeader` يرفض المصفوفة والقيمة التي تحوي فاصلة، لأن Node قد يدمج الرأس المكرر في نص واحد.
- `toCreateJobRequest` و`toRejectOfferRequest` و`toCancelJobRequest` ترفض المفاتيح غير المعلنة؛ ومعرفات `job_id` و`offer_id` تمر عبر تعبير UUID قبل استدعاء حالة الاستخدام.
- كل رد خطأ يقتصر على `{code, message, trace_id}` ولا يضيف حقلاً مستقلاً لقيمة المعرف أو المفتاح المرفوضة.

---

## 5. حصر الملكية والردّ 404 لا 403

لا توجد مصادقة أو ترويسة مالك في طبقة HTTP هذه، ولذلك لا يوجد قرار ملكية من نوع 404 بدلاً من 403. `404` ينشأ فقط من مهمة أو عرض لا تجدهما خدمة التوزيع (`DISPATCH_JOB_NOT_FOUND` و`DISPATCH_OFFER_NOT_FOUND`).

حصر الملكية المعماري يقع في الاتجاه لا في تفويض مستخدم: التوزيع منسق؛ يطلب المرشحين من matching عبر `HttpMatchingPort` ويسجل العرض وحسمه وانتقال الطلب عبر `HttpOrderEnginePort`. لا يقرأ جدول خدمة أخرى ولا ينسخ آلة حالات الطلب أو ترتيب المرشحين، وهو ما يحفظه ADR-010 وADR-011.

---

## 6. `/health`

```json
{
  "status": "degraded",
  "service": "dispatch-service",
  "persistence": "memory",
  "last_tick_at": null
}
```

الحالة `ok` عندما يركّب جذر التطبيق `persistence: "postgres"`؛ وإلا فهي `degraded`. `last_tick_at` كائن حالة حقني يبدأ `null`، ولا يحدّثه معالج النبضة إلا بعد عودة `runTick` بنجاح؛ فشل النبضة يبقي القيمة السابقة.

---

## 7. خريطة الأخطاء الكاملة (16 رمزاً)

طبقة HTTP تمرر `DispatchError` بحالته ورمزه من حزمة العقد. خطأ Fastify ذي الحالة 400 أو 415 يصبح `400 DISPATCH_VALIDATION_FAILED`، وما عداه يصبح `503 DISPATCH_ENGINE_UNAVAILABLE`.

| الرمز                              | HTTP | يُرفع عند                               |
| ---------------------------------- | ---: | --------------------------------------- |
| `DISPATCH_VALIDATION_FAILED`       |  400 | جسم أو معامل مسار أو رأس مخالف للعقد    |
| `DISPATCH_JOB_NOT_FOUND`           |  404 | مهمة توزيع غائبة                        |
| `DISPATCH_OFFER_NOT_FOUND`         |  404 | عرض توزيع غائب                          |
| `DISPATCH_IDEMPOTENCY_KEY_REUSED`  |  409 | المفتاح نفسه بحمولة مختلفة              |
| `DISPATCH_JOB_ALREADY_EXISTS`      |  409 | للطلب مهمة قائمة أو نهائية              |
| `DISPATCH_JOB_NOT_CANCELLABLE`     |  409 | المهمة لا تقبل الإلغاء من حالتها        |
| `DISPATCH_OFFER_ALREADY_RESOLVED`  |  409 | العرض حُسم مسبقاً                       |
| `DISPATCH_OFFER_SUPERSEDED`        |  409 | فاز عرض آخر للمهمة                      |
| `DISPATCH_WAVE_ALREADY_OPEN`       |  409 | محاولة فتح موجة نشطة ثانية للمهمة       |
| `DISPATCH_REASON_CODE_REQUIRED`    |  422 | نتيجة نهائية بلا `reason_code`          |
| `DISPATCH_REASON_CODE_UNKNOWN`     |  422 | كود سبب غير معروف للفعل أو الحالة       |
| `DISPATCH_JOB_NOT_DISPATCHABLE`    |  422 | حالة المهمة تمنع خطوة التوزيع           |
| `DISPATCH_ORDER_ENGINE_REJECTED`   |  422 | محرك الطلبات رفض العرض أو الحسم نهائياً |
| `DISPATCH_MATCHING_RESULT_INVALID` |  422 | جواب المطابقة لا يصلح لفتح موجة         |
| `DISPATCH_ENGINE_UNAVAILABLE`      |  503 | التخزين أو matching أو orders غير متاح  |
| `DISPATCH_ORDER_ENGINE_TIMEOUT`    |  503 | لم يجب محرك الطلبات قبل المهلة          |

### 7.1 الحدود

- `400` للهيئة، و`422` لطلب مفهوم مرفوض من منطق التوزيع أو من محرك الطلبات؛ `409` لتعارض الحالة أو التكرار.
- محول matching يعامل `503` أو انقطاع الشبكة أو المهلة كـ`DISPATCH_ENGINE_UNAVAILABLE`، ويعامل كل استجابة غير `200` أو جسماً لا يملك الشكل المطلوب كـ`DISPATCH_MATCHING_RESULT_INVALID`.
- محول orders يصنف 409 و422 من المحرك `rejected`، وأي 5xx أو حالة أخرى `unavailable`، و`AbortError` `timeout`. لا يتعلم المجال أرقام HTTP مباشرة.
- `toApiTickResult` يسقط `deferredJobs`: هو عداد نطاقي تشغيلي لا حقل في `TickResult` المنشور.

---

## 8. تغييرات المجال

التغيير عند الحد هو توسيع `CandidateRequest` في `services/dispatch/src/ports.ts` بـ`orderId` و`orderPublicId` و`dispatchJobId?`. يرسل `HttpMatchingPort` المرجعين إلى `CandidateQuery` ويرسل `dispatch_job_id` عند وجوده؛ هذه مراجع تدقيق فقط، لا سعر ولا محطات ولا قناة ولا معرفة بعرض أو موجة.

المحوّل **لا يرسل** `evaluated_at`؛ يقرأ جواب المطابقة `evaluated_at` ويتحقق من كونه نصاً، أما لحظة التقييم فيملكها matching. كما أن التوزيع لا يمرر درجات المرشحين إلى مجاله: محلل جواب matching يقبل `driver_public_id` و`rank` فقط من كل مرشح.

---

## 9. الانحرافات والحدود المُعلَنة

| #   | الانحراف / الحد                                                                                                        | لماذا                                                                                                                                                                                                | البديل ولماذا رُفض                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | `CandidateRequest` يضم `orderId` و`orderPublicId` و`dispatchJobId?` فوق حقول منطقة/نوع/مركبة/موجة                      | `CandidateQuery` المنشور يطلب مرجع الطلب، وقرار matching محفوظ للتدقيق؛ قرار بلا مرجع لا يجيب لاحقاً عن سبب ترشيح سائق لهذا الطلب                                                                    | إبقاء العقد الناقص وإرسال حمولة لا تطابق `CandidateQuery` — مرفوض                                           |
| 2   | محول matching لا يرسل `evaluated_at`                                                                                   | `HttpMatchingPort.candidates` لا يبني الحقل، بينما يستقبله فقط عند قراءة رد المطابقة؛ ساعة التقييم تملكها خدمة matching                                                                              | تمرير وقت موزع إلى التقييم — مرفوض: يبدل مالك لحظة التقييم                                                  |
| 3   | `/dispatch/tick` يطلب ويتحقق من `Idempotency-Key` لكنه لا يخزنه أو يستعمله لمنع تكرار النبضة                           | `app.ts` يستدعي `requireIdempotencyKey` ثم `runTick` بلا تمرير المفتاح. منع الأثر المكرر بنيوي: نبضة ثانية في اللحظة نفسها لا تجد انتقالاً مستحقاً بعد حسم الحالة، وتخزين مدخلة لكل نبضة ينمو بلا حد | إسقاط الرأس من العقد — مرفوض: العقد يطلبه على كل كتابة                                                      |
| 4   | النبضة تقرأ الساعة مرة وتفتح معاملة لكل مهمة؛ عمرها التقريبي `(2 + حجم الموجة) × مهلة العميل`                          | يحصر الفشل والاحتجاز في مهمة ولا يلغي تقدم مهام سليمة. هذا يحسم الدَّين المؤجل في `DISPATCH_PERSISTENCE.md` §7.1                                                                                     | معاملة واحدة لكل المهام — مرفوض: تشمل كل النداءات وتلغي تقدم مهام سليمة عند فشل واحدة                       |
| 5   | نداءات HTTP الحقيقية تبقى داخل معاملة المهمة                                                                           | المهل الصارمة في محولي matching وorders، الافتراضية 2000ms، تخفف خطر احتجاز اتصال؛ الخطر لم يزل                                                                                                      | الادعاء بأن الخطر أزيل، أو نشر المعاملة على كل النبضة — مرفوض: الكود ما زال ينفذ `tick` داخل `runner.write` |
| 6   | رفض الرؤوس المكررة بفاصلة أضيف هنا وفي matching، بينما `services/orders/src/http/requests.ts` يفحص `Array.isArray` فقط | Node قد يدمج التكرار في نص مفصول بفاصلة؛ معالجة محرك الطلبات ليست ضمن نطاق هذه الوثيقة                                                                                                               | تعديل orders ضمن هذا العمل — مرفوض: دين معلن لانضباط النطاق                                                 |

---

## 10. الأدلّة (لا «Done» بلا دليل)

| الادّعاء                                           | الدليل                                                                                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| المسارات وحالات نجاحها                             | `services/dispatch/src/http/app.ts:49-140`                                                                                                                                             |
| قراءة عرض واحد وحقول المهمة كاملة                     | `src/__tests__/http-offer-detail.test.ts` — `يعيد 200 بكل حقول العرض وسياق الوظيفة عبر مقبس القراءة فقط`                                                                              |
| الزمن نبضة لا مؤقت في `standing`                       | `src/__tests__/http-offer-detail.test.ts` — `يبقي standing: true بعد الموعد ما لم تمر نبضة` و`يعيد standing: false بعد أن تسجل النبضة انتهاء العرض`                                  |
| إغلاق العرض أو المهمة يلغي `standing`                  | `src/__tests__/http-offer-detail.test.ts` — `يعيد standing: false بعد رفض العرض` و`يعيد standing: false إذا كانت الوظيفة نهائية ولو بقي العرض offered`                                |
| المسار والعقد ومُخرِج التفصيل متطابقون                 | `src/__tests__/contract-drift.test.ts` — `registers the offer-detail GET route that the contract declares` · `src/__tests__/mappers.test.ts` — `keeps DispatchOfferDetail keys aligned with the contract in both directions` |
| إنشاء 201 ثم إعادة 200 وعدم فتح موجة               | `src/__tests__/http-jobs.test.ts` — `تنشئ 201 ثم تعيد 200 للمفتاح والحمولة نفسيهما` و`لا يفتح موجة عند إنشاء مهمة جديدة`                                                               |
| النبضة بلا جسم ولا تحرك الزمن إلا عبرها            | `src/__tests__/http-tick.test.ts` — `لا تقبل جسماً وتفتح الموجة عبر النبضة فقط`                                                                                                        |
| تحديث `last_tick_at` بعد النجاح فقط                | `src/__tests__/http-tick.test.ts` — `يحدّث آخر نبضة فقط بعد نبضة ناجحة` و`لا يحدّث آخر نبضة عندما تفشل النبضة`                                                                         |
| معاملة لكل مهمة وساعة موحدة                        | `services/dispatch/src/run-tick.ts:42-67` · `src/__tests__/run-tick.test.ts` — `يفتح معاملة كتابة واحدة لكل واحدة من ثلاث مهام نشطة` و`يثبّت ساعة واحدة لكل المهام ويعيد اللحظة نفسها` |
| حمولة matching بلا `evaluated_at` وبلا مفتاح تكرار | `services/dispatch/src/infrastructure/http-matching.ts:30-43` · `src/__tests__/http-matching.test.ts` — `يرسل استعلام المرشحين كاملاً بلا مفتاح تكرار ويقبل القائمة الفارغة`           |
| تصنيف أخطاء HTTP وغلافها                           | `services/dispatch/src/http/errors.ts:16-38` · `src/__tests__/http-errors.test.ts` — `لا يعيد صدى المعرّف غير المقبول`                                                                 |
| اختبارات الخدمة                                    | `pnpm --filter @wasla/dispatch-service test` ⇒ **20 ملفاً · 236 اختباراً ناجحاً** (لقطة 2026-08-23)                                                                                    |

**غير مُغطّى هنا:** `server.ts` تركيب؛ اختبارات HTTP تحقن Runner ولا تبدأ خادماً مستمعاً.

---

## 11. ماذا بعد

- قرار لاحق يفصل نداءات matching وorders عن عمر معاملة المهمة أو ينفذ saga؛ المهل الصارمة الحالية تخفيف لا إزالة للخطر.
- يبقى محرك الطلبات مالك حالة الطلب وفق [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md)، وتبقى المطابقة مالكة التقييم وفق [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md).
