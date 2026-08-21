# كتالوج أخطاء محرّك الطلبات — Order Engine Errors

- **Scope:** أكواد أخطاء `services/orders` وأكواد أسباب انتقالات الحالة (`reason_code`).
- **Last Updated:** 2026-08-21
- **Status:** Active (Phase 06 · MR 1/6 — عقد فقط، التنفيذ في MR 2/6–4/6)
- **Related Code:** [`services/orders/contracts/api.openapi.yml`](api.openapi.yml) · [`services/orders/contracts/events.json`](events.json) · [`services/orders/contracts/schema.sql`](schema.sql)
- **Related Team:** Team 06 — Order Engine

## القاعدة

كل خطأ **كود ثابت** يقرأه البرنامج، ورسالة يقرأها الإنسان. الاختبارات تتحقّق من **الكود** لا من النص،
فتغيير الصياغة لا يكسر شيئاً وتغيير الكود تغيير عقد.

`reason_code` ليس نصّاً حرّاً: هو كود من الكتالوج أدناه. سبب حرّ يُنتج تحليلات لا تُجمَع،
ونصّاً كتبه مستخدم قد يعبر إلى الأحداث فيخترق حدّ الخصوصية (ADR-010 القرار 7).

## أصناف الأخطاء

| الصنف | HTTP | متى |
|---|---|---|
| `validation_error` | 400 | الجسم أو المعامل لا يطابق العقد شكلياً |
| `not_found` | 404 | الكيان غير موجود، **أو** موجود وليس مملوكاً للقارئ |
| `conflict` | 409 | تعارض حالة: انتقال غير مسموح · إعادة مفتاح بحمولة مختلفة · إسناد مكرَّر |
| `unprocessable` | 422 | صالح شكلياً ومرفوض منطقياً |
| `service_unavailable` | 503 | الخدمة في وضع متدهور (لا تخزين دائم) |

**لماذا 404 لطلب عميل آخر ولا 403:** جواب 403 يُثبت أن المُعرّف موجود. عدّاد مُعرّفات مع 403
يكشف حجم النظام وأرقام طلبات حقيقية. عدم إثبات الوجود ليس تجميلاً — هو الحدّ.

## أكواد الأخطاء

| الكود | HTTP | المعنى | ملاحظة للمستهلك |
|---|---|---|---|
| `ORDER_VALIDATION_FAILED` | 400 | الجسم لا يطابق العقد | خدمة العميل تعامله **كخطئها** (`UNAVAILABLE`) لا كرفض تجاري — [بوابة Phase 04](../../../docs/12-testing/PHASE04_EXIT_GATE_E2E.md) |
| `ORDER_NOT_FOUND` | 404 | لا طلب بهذا المُعرّف في نطاق القارئ | لا تُفرّق بين «غير موجود» و«ليس لك» |
| `ORDER_ASSIGNMENT_NOT_FOUND` | 404 | لا إسناد بهذا المُعرّف على هذا الطلب | |
| `ORDER_ILLEGAL_TRANSITION` | 409 | الزوج (from, to) غير مذكور في جدول الانتقالات | التفاصيل تحمل `from` و`to`؛ الجدول في [ORDER_ENGINE.md](../../../docs/03-domain/ORDER_ENGINE.md) |
| `ORDER_IDEMPOTENCY_KEY_REUSED` | 409 | نفس `Idempotency-Key` بحمولة مختلفة | يُقاس ببصمة الحمولة لا بمقارنة الحقول |
| `ORDER_ASSIGNMENT_DUPLICATE` | 409 | الطلب نفسه عُرض على السائق نفسه مرّتين | إعادة العرض على من رفض إزعاج لا سياسة |
| `ORDER_ASSIGNMENT_ALREADY_RESOLVED` | 409 | العرض انتهى (مقبول/مرفوض/منتهٍ/ملغى) ولا يُحدَّث مرّتين | |
| `ORDER_ASSIGNMENT_REQUIRED` | 422 | الانتقال إلى حالة تُسمّي سائقاً بلا إسناد نشط مقبول | حرّاس ADR-010 القرار 3.8 |
| `ORDER_ASSIGNMENT_FORBIDDEN` | 422 | الحالة الحالية قبل القبول ولا يجوز أن تحمل إسناداً نشطاً | |
| `ORDER_REASON_CODE_REQUIRED` | 422 | انتقال إلى حالة نهائية بلا `reason_code` | لا نهاية بلا سبب |
| `ORDER_REASON_CODE_UNKNOWN` | 422 | `reason_code` ليس من الكتالوج أدناه | |
| `ORDER_ACTOR_REF_REQUIRED` | 422 | `actor_type` بشري بلا `actor_ref` | لا فعل بشري بلا فاعل معروف |
| `ORDER_ACTOR_REF_FORBIDDEN` | 422 | `actor_type = system` مع `actor_ref` | النظام ليس شخصاً |
| `ORDER_PRICE_MODE_MISMATCH` | 422 | `customer_offer` بلا مبلغ، أو `negotiable` بمبلغ | عرض بلا مبلغ ليس عرضاً |
| `ORDER_SHIPMENT_NOT_ALLOWED` | 422 | تفاصيل شحنة على طلب `ride` | |
| `ORDER_STOPS_INVALID` | 422 | ليست نقطتين، أو ليست (pickup ثمّ dropoff) | |
| `ORDER_REQUEST_ALREADY_INGESTED` | 409 | `order_request_id` نفسه وصل بمفتاح idempotency مختلف | نيّة واحدة = طلب واحد |
| `ORDER_ENGINE_UNAVAILABLE` | 503 | لا تخزين دائم مضبوط | يوافق `degraded` في `/health` |

## كتالوج أكواد الأسباب (`reason_code`)

قائمة **مُقفلة**: إضافة كود تغيير عقد يُوثَّق في TASK_LOG. الأحداث تحمل هذه الأكواد فقط.

### انتهاء وعدم توفّر

| الكود | الحالة الناتجة | المعنى |
|---|---|---|
| `SEARCH_WINDOW_EXPIRED` | `expired` | انتهت نافذة البحث قبل أي قبول |
| `NO_CANDIDATES_FOUND` | `no_driver_found` | لا مرشّح طابق الطلب |
| `ALL_CANDIDATES_DECLINED` | `no_driver_found` | كل من عُرض عليه رفض أو انتهت مهلته |

### إلغاء

| الكود | الحالة الناتجة | المعنى |
|---|---|---|
| `CUSTOMER_CHANGED_MIND` | `customer_cancelled` | العميل ألغى بلا سبب تشغيلي |
| `CUSTOMER_WAIT_TOO_LONG` | `customer_cancelled` | العميل ألغى لطول الانتظار |
| `CUSTOMER_PRICE_REJECTED` | `customer_cancelled` | العميل ألغى بعد تفاوض لم ينجح |
| `DRIVER_UNAVAILABLE` | `driver_cancelled` | السائق تعذّر بعد قبوله |
| `DRIVER_VEHICLE_ISSUE` | `driver_cancelled` | عطل مركبة |
| `DRIVER_NO_SHOW_CUSTOMER` | `driver_cancelled` | العميل لم يحضر |
| `PARTNER_CANCELLED_ORDER` | `partner_cancelled` | الشريك ألغى (Phase 13+) |
| `PARTNER_OUT_OF_STOCK` | `partner_cancelled` | الطلب غير قابل للتنفيذ عند الشريك |

### إسناد

| الكود | الحالة الناتجة | المعنى |
|---|---|---|
| `DRIVER_DECLINED` | `driver_rejected` (عابرة) | السائق رفض العرض — **الطلب يعود للبحث** |
| `OFFER_TIMED_OUT` | `driver_timeout` (عابرة) | لم يُجب السائق داخل المهلة — **الطلب يعود للبحث** |
| `SEARCH_RESUMED` | `searching` | استُؤنف البحث بعد رفض أو مهلة |

### حجب ومراجعة وفشل

| الكود | الحالة الناتجة | المعنى |
|---|---|---|
| `FRAUD_SUSPECTED` | `blocked` | اشتباه سلوك مسيء |
| `POLICY_VIOLATION` | `blocked` | خرق سياسة |
| `SAFETY_INCIDENT` | `blocked` | حادثة سلامة |
| `TECHNICAL_FAILURE` | `failed` | فشل تقني منع الإتمام |
| `PAYMENT_FAILED` | `failed` | لم يتمّ الدفع (Phase 12+) |
| `DISPUTE_OPENED` | `payment_disputed` | نزاع مالي بعد الإتمام |
| `MANUAL_REVIEW_OPENED` | `under_review` | فتح مشرف مراجعة |
| `REVIEW_CLEARED` | `completed` | أُغلقت المراجعة لصالح الإتمام |
| `REVIEW_UPHELD_BLOCK` | `blocked` | أُغلقت المراجعة بالحجب |
| `REVIEW_UPHELD_FAILURE` | `failed` | أُغلقت المراجعة بالفشل |

## ما ليس خطأً هنا

- **رفض السائق** ليس خطأ HTTP: هو انتقال مسموح يُسجَّل بكود سبب. جعله خطأً يُخفيه عن التدقيق.
- **أهلية السائق** ليست خطأً في المحرّك: المحرّك لا يعرف ملفّ السائق (ADR-010 القرار 4).
  التحقّق مِلْك Phase 05/07، وخطؤه يُرفع هناك.
- **منطقة غير معروفة**: خدمة العميل تحقّقت منها قبل التسليم (`CUSTOMER_ZONE_NOT_FOUND` 404).
  المحرّك يتحقّق من الشكل فقط، فلا يستدعي الجغرافيا في مسار الكتابة الحرج.
