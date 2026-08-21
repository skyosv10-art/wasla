# محرّك الطلبات — نموذج المجال ودورة حياة الطلب

- **Scope:** الطلب: هويته · حالاته · انتقالاته المسموحة · مراجع الإسناد · التدقيق · الأحداث. **لا** يشمل اختيار السائق المرشّح ولا الأمواج ولا المهل (Phase 07) ولا ملفّ السائق (Phase 05) ولا التسعير (Phase 12+).
- **Last Updated:** 2026-08-21
- **Status:** Active — Phase 06 · MR 1/6 (العقد والجدول موثّقان؛ التنفيذ في MR 2/6–4/6)
- **Related Code:** [`services/orders/contracts/`](../../services/orders/contracts/README.md) · [`packages/contracts/order`](../../packages/contracts/order) · `services/orders/src/domain/state-machine.ts` (MR 2/6)
- **Related Team:** Team 06 — Order Engine

> **لمن يقرأ هذه الوثيقة أولاً:** الجدول في §4 هو **المصدر الوحيد** لما يجوز أن يحدث للطلب.
> إن وجدت في الكود انتقالاً غير مذكور هنا، فالكود هو الخطأ. وإن احتجت انتقالاً جديداً،
> فالتغيير يبدأ من هذه الوثيقة ومن `state-machine.ts` معاً، وبـMR وسجل في
> [TASK_LOG](../16-progress/TASK_LOG.md).

---

## 1. ما يملكه هذا المجال

| المفهوم | المعنى | من يملكه |
|---|---|---|
| **Order** | طلب مُتحقَّق دخل النظام وله حالة واحدة في كل لحظة | هذا المجال |
| **`order_public_id`** | `ORD-` + عشرة أرقام من متتالية في القاعدة، يُصدَر مرّة ولا يتغيّر | هذا المجال |
| **Stops** | نقطتان مرتّبتان (pickup ثمّ dropoff) بمستوى منطقة | هذا المجال (المنطقة نفسها من الجغرافيا) |
| **Status** | حالة الطلب من واحد وعشرين حالة (§3) | هذا المجال |
| **Status History** | صفّ تدقيق لكل انتقال بلا استثناء | هذا المجال |
| **Assignment** | **سجل** عرض إسناد على سائق ونتيجته | هذا المجال (سجلاً) · Phase 07 (قراراً) |
| **Outbox** | حدث لكل انتقال في المعاملة نفسها | هذا المجال (الناشر: Phase 09) |

وما **لا** يملكه، ولا يعرف عنه شيئاً:

- **من هو السائق**: `driver_public_id` نصّ opaque. لا اسم ولا مركبة ولا تقييم ولا أهلية (Phase 05).
- **من يستحقّ العرض**: لا مرشّحين ولا نطاق جغرافي ولا موجة ولا مهلة (Phase 07).
- **القناة**: لا `chat_id` ولا Telegram. الإشعار مجال آخر (Phase 09) والبوت مستهلك (ADR-007).
- **السعر النهائي والدفع**: يحمل عرض العميل فقط؛ الفاتورة والمحفظة لمراحلها.

---

## 2. الطلب يبدأ مُتحقَّقاً — ولا مسوّدة

خدمة العميل (Phase 04) تتحقّق من النيّة **قبل** التسليم، ثمّ تُسلّمها عبر `OrderIntakePort`
(ADR-009). فالمحرّك لا يستقبل نصف طلب، ولذلك:

> **حالة البدء هي `published`. لا توجد حالة `draft`.**

لماذا هذا قرار وليس تفصيلاً: حالة لا يوجد مسار يُدخل الطلب إليها ولا يُخرجه منها هي **حالة
مستحيلة**، وبوابة خروج هذه المرحلة تنصّ على انعدام الحالات المستحيلة. تركيب الطلب خطوة خطوة
(اختيار النقاط، تعديل السعر) يحدث في المِني-آب ونيّة العميل (Phase 11)، لا في المحرّك.

---

## 3. الحالات الواحد والعشرون

### 3.1 المسار التشغيلي

| الحالة | المعنى | يُسمّي سائقاً؟ |
|---|---|---|
| `published` | دخل الطلب النظام مُتحقَّقاً | لا |
| `searching` | البحث عن سائق جارٍ (Phase 07 تُدير البحث) | لا |
| `offered` | عُرض على سائق واحد أو أكثر وينتظر جواباً | لا |
| `negotiating` | تفاوض سعري قائم (وضع `negotiable`) | لا |
| `accepted` | قبل سائق العرض | **نعم** |
| `assigned` | ثُبّت الطلب على السائق المقبول | **نعم** |
| `driver_en_route` | السائق متوجّه إلى نقطة الانطلاق | **نعم** |
| `arrived` | السائق وصل نقطة الانطلاق | **نعم** |
| `in_progress` | التنفيذ جارٍ (الرحلة/التوصيل) | **نعم** |
| `completed` | تمّ التنفيذ | **نعم** |

**الحالات التي تُسمّي سائقاً تستلزم إسناداً نشطاً مقبولاً**، وإلّا رُفض الانتقال بـ422
`ORDER_ASSIGNMENT_REQUIRED`. والحالات الأربع قبل القبول (`published` · `searching` · `offered` ·
`negotiating`) **لا يجوز** أن تحمل إسناداً نشطاً، وإلّا 422 `ORDER_ASSIGNMENT_FORBIDDEN`.
القيدان مفروضان في المجال **و** في القاعدة (`ck_orders_assignment_matches_status`).

### 3.2 حالتان عابرتان — لا نهائيتان

| الحالة | المعنى |
|---|---|
| `driver_rejected` | رفض السائق العرض |
| `driver_timeout` | لم يُجب السائق داخل المهلة |

المستند الرئيس (§15.1) عدّهما ضمن الحالات النهائية، و§16 يصف موجات عرض متتالية على أكثر من سائق.
النصّان متناقضان: لو كان رفض سائق يُنهي الطلب لَما كانت هناك موجة ثانية. **القرار
([ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) القرار 3.5):
الحالتان عابرتان**، ومنهما يرجع الطلب إلى `searching` أو يستقرّ على `no_driver_found` أو `expired`
أو إلغاء العميل. رفض سائق واحد لا يُسقط طلباً.

### 3.3 الحالات النهائية السبع

`expired` · `no_driver_found` · `customer_cancelled` · `driver_cancelled` · `partner_cancelled` ·
`blocked` · `failed`

**لا انتقال يخرج منها**، و**كلٌّ منها يستلزم `reason_code`** من
[الكتالوج المُقفل](../../services/orders/contracts/errors.md#كتالوج-أكواد-الأسباب-reason_code)
(مفروض في القاعدة بـ`ck_orders_terminal_needs_reason`). نهاية بلا سبب تعني تحليلات لا تُجمَع
ودعماً لا يستطيع الجواب.

### 3.4 ما بعد الإتمام

| الحالة | المعنى |
|---|---|
| `payment_disputed` | نزاع مالي بعد الإتمام (Phase 12+) |
| `under_review` | مراجعة بشرية مفتوحة |

`under_review` **تُحلّ إلى `completed` أو `blocked` أو `failed`، ولا ترجع إلى الحالة السابقة**.
تخزين «الحالة قبل المراجعة» للرجوع إليها يُنتج حالات مستحيلة بنفسه (طلب `under_review` يحمل
حالةً كامنة، فأيّهما الحقيقية؟). المراجعة تُنتج حكماً، لا رجوعاً.

---

## 4. جدول الانتقالات — المصدر الوحيد

اثنان وسبعون زوجاً مسموحاً من أصل 441 (21 × 21). كل ما ليس في هذا الجدول **مرفوض** بـ409
`ORDER_ILLEGAL_TRANSITION` مع `from` و`to` في التفاصيل.

القراءة: كل صفّ زوج `(من → إلى)`. `الفاعل` هو `actor_type` المتوقّع، و`السبب` هو `reason_code`
النمطي — **إلزامي** حيث تكون الحالة الهدف نهائية، اختياري فيما عداها.

### 4.1 من `published` (6)

| إلى | الفاعل | السبب النمطي | ملاحظة |
|---|---|---|---|
| `searching` | `system` | — | Phase 07 بدأت البحث |
| `customer_cancelled` | `customer` | `CUSTOMER_CHANGED_MIND` | إلغاء قبل أي بحث |
| `partner_cancelled` | `partner` | `PARTNER_CANCELLED_ORDER` | طلب شريك (Phase 13+) |
| `expired` | `system` | `SEARCH_WINDOW_EXPIRED` | انتهت النافذة قبل البحث |
| `blocked` | `admin` | `FRAUD_SUSPECTED` | حجب فوري |
| `failed` | `system` | `TECHNICAL_FAILURE` | فشل تقني قبل البحث |

### 4.2 من `searching` (7)

| إلى | الفاعل | السبب النمطي | ملاحظة |
|---|---|---|---|
| `offered` | `system` | — | عُرض على سائق (Phase 07) |
| `no_driver_found` | `system` | `NO_CANDIDATES_FOUND` | لا مرشّح |
| `expired` | `system` | `SEARCH_WINDOW_EXPIRED` | انتهت نافذة البحث |
| `customer_cancelled` | `customer` | `CUSTOMER_WAIT_TOO_LONG` | |
| `partner_cancelled` | `partner` | `PARTNER_OUT_OF_STOCK` | |
| `blocked` | `admin` | `POLICY_VIOLATION` | |
| `failed` | `system` | `TECHNICAL_FAILURE` | |

### 4.3 من `offered` (9)

| إلى | الفاعل | السبب النمطي | ملاحظة |
|---|---|---|---|
| `accepted` | `driver` | — | **يستلزم إسناداً مقبولاً مُسجَّلاً** |
| `negotiating` | `driver` | — | وضع `negotiable` فقط |
| `driver_rejected` | `driver` | `DRIVER_DECLINED` | عابرة |
| `driver_timeout` | `system` | `OFFER_TIMED_OUT` | عابرة |
| `customer_cancelled` | `customer` | `CUSTOMER_CHANGED_MIND` | |
| `partner_cancelled` | `partner` | `PARTNER_CANCELLED_ORDER` | |
| `expired` | `system` | `SEARCH_WINDOW_EXPIRED` | |
| `blocked` | `admin` | `SAFETY_INCIDENT` | |
| `failed` | `system` | `TECHNICAL_FAILURE` | |

### 4.4 من `negotiating` (8)

| إلى | الفاعل | السبب النمطي | ملاحظة |
|---|---|---|---|
| `accepted` | `customer` | — | العميل قبل السعر المقابل |
| `driver_rejected` | `driver` | `DRIVER_DECLINED` | عابرة |
| `driver_timeout` | `system` | `OFFER_TIMED_OUT` | عابرة |
| `customer_cancelled` | `customer` | `CUSTOMER_PRICE_REJECTED` | لم ينجح التفاوض |
| `partner_cancelled` | `partner` | `PARTNER_CANCELLED_ORDER` | |
| `expired` | `system` | `SEARCH_WINDOW_EXPIRED` | |
| `blocked` | `admin` | `POLICY_VIOLATION` | |
| `failed` | `system` | `TECHNICAL_FAILURE` | |

### 4.5 من `accepted` (6)

| إلى | الفاعل | السبب النمطي | ملاحظة |
|---|---|---|---|
| `assigned` | `system` | — | تثبيت الطلب على السائق |
| `driver_cancelled` | `driver` | `DRIVER_UNAVAILABLE` | |
| `customer_cancelled` | `customer` | `CUSTOMER_CHANGED_MIND` | |
| `partner_cancelled` | `partner` | `PARTNER_CANCELLED_ORDER` | |
| `blocked` | `admin` | `FRAUD_SUSPECTED` | |
| `failed` | `system` | `TECHNICAL_FAILURE` | |

### 4.6 من `assigned` (6)

| إلى | الفاعل | السبب النمطي |
|---|---|---|
| `driver_en_route` | `driver` | — |
| `driver_cancelled` | `driver` | `DRIVER_VEHICLE_ISSUE` |
| `customer_cancelled` | `customer` | `CUSTOMER_CHANGED_MIND` |
| `partner_cancelled` | `partner` | `PARTNER_CANCELLED_ORDER` |
| `blocked` | `admin` | `SAFETY_INCIDENT` |
| `failed` | `system` | `TECHNICAL_FAILURE` |

### 4.7 من `driver_en_route` (6)

| إلى | الفاعل | السبب النمطي |
|---|---|---|
| `arrived` | `driver` | — |
| `driver_cancelled` | `driver` | `DRIVER_VEHICLE_ISSUE` |
| `customer_cancelled` | `customer` | `CUSTOMER_CHANGED_MIND` |
| `partner_cancelled` | `partner` | `PARTNER_CANCELLED_ORDER` |
| `blocked` | `admin` | `SAFETY_INCIDENT` |
| `failed` | `system` | `TECHNICAL_FAILURE` |

### 4.8 من `arrived` (6)

| إلى | الفاعل | السبب النمطي |
|---|---|---|
| `in_progress` | `driver` | — |
| `driver_cancelled` | `driver` | `DRIVER_NO_SHOW_CUSTOMER` |
| `customer_cancelled` | `customer` | `CUSTOMER_CHANGED_MIND` |
| `partner_cancelled` | `partner` | `PARTNER_CANCELLED_ORDER` |
| `blocked` | `admin` | `SAFETY_INCIDENT` |
| `failed` | `system` | `TECHNICAL_FAILURE` |

### 4.9 من `in_progress` (4)

| إلى | الفاعل | السبب النمطي |
|---|---|---|
| `completed` | `driver` | — |
| `driver_cancelled` | `driver` | `DRIVER_VEHICLE_ISSUE` |
| `blocked` | `admin` | `SAFETY_INCIDENT` |
| `failed` | `system` | `TECHNICAL_FAILURE` |

> **لا `in_progress` → `customer_cancelled`.** رحلة جارية لا تُلغى بزرّ: إمّا تُكمَل، أو يُلغيها
> السائق، أو تفشل، أو يحجبها مشرف. لو سمحنا للعميل بالإلغاء هنا لَاحتجنا سؤالاً لا جواب له في
> النموذج: من يدفع مقابل المسافة المقطوعة؟ ذلك سؤال Phase 12، ولا يُفتح بحالة.

### 4.10 من `driver_rejected` (4) — عابرة

| إلى | الفاعل | السبب النمطي | ملاحظة |
|---|---|---|---|
| `searching` | `system` | `SEARCH_RESUMED` | الموجة التالية (Phase 07) |
| `no_driver_found` | `system` | `ALL_CANDIDATES_DECLINED` | نفدت المرشّحون |
| `expired` | `system` | `SEARCH_WINDOW_EXPIRED` | |
| `customer_cancelled` | `customer` | `CUSTOMER_WAIT_TOO_LONG` | |

### 4.11 من `driver_timeout` (4) — عابرة

| إلى | الفاعل | السبب النمطي |
|---|---|---|
| `searching` | `system` | `SEARCH_RESUMED` |
| `no_driver_found` | `system` | `ALL_CANDIDATES_DECLINED` |
| `expired` | `system` | `SEARCH_WINDOW_EXPIRED` |
| `customer_cancelled` | `customer` | `CUSTOMER_WAIT_TOO_LONG` |

### 4.12 من `completed` (2)

| إلى | الفاعل | السبب النمطي |
|---|---|---|
| `payment_disputed` | `customer` | `DISPUTE_OPENED` |
| `under_review` | `admin` | `MANUAL_REVIEW_OPENED` |

### 4.13 من `payment_disputed` (1)

| إلى | الفاعل | السبب النمطي | ملاحظة |
|---|---|---|---|
| `under_review` | `admin` | `MANUAL_REVIEW_OPENED` | **كل نزاع يُحلّ عبر المراجعة**، فنقطة الحكم واحدة |

### 4.14 من `under_review` (3)

| إلى | الفاعل | السبب النمطي |
|---|---|---|
| `completed` | `admin` | `REVIEW_CLEARED` |
| `blocked` | `admin` | `REVIEW_UPHELD_BLOCK` |
| `failed` | `admin` | `REVIEW_UPHELD_FAILURE` |

### 4.15 من الحالات النهائية السبع (0)

`expired` · `no_driver_found` · `customer_cancelled` · `driver_cancelled` · `partner_cancelled` ·
`blocked` · `failed` → **لا شيء**. طلب انتهى لا يُبعَث. العميل يُنشئ طلباً جديداً، وهذا سلوك
مقصود: إحياء طلب منتهٍ يجعل تاريخه كذبة.

---

## 5. خصائص يجب أن يُثبتها الاختبار

الاختبارات في MR 2/6 و MR 6/6 لا تكتفي بأمثلة، بل تمرّ على الفضاء كلّه (21 × 21 = 441 زوجاً):

| # | الخاصية | كيف تُثبَت |
|---|---|---|
| 1 | **لا حالة معزولة** | لكل حالة (غير `published`) مسار داخل واحد على الأقل، ولكل حالة غير نهائية مسار خارج |
| 2 | **`published` هي البداية الوحيدة** | لا حالة أخرى تُنشأ ابتداءً |
| 3 | **النهائيات مُغلقة** | مجموعة الخارج من كلٍّ منها فارغة، والمجموعة المُشتقّة من الجدول تُطابق `ORDER_TERMINAL_STATUSES` |
| 4 | **العابرتان ليستا نهائيتين** | لكلٍّ منهما مخرج إلى `searching` |
| 5 | **كل زوج غير مذكور مرفوض** | المرور على 441 زوجاً: المذكور ينجح والباقي 409 |
| 6 | **لا انتقال إلى الحالة نفسها** | 21 زوجاً `(s → s)` كلّها مرفوضة |
| 7 | **كل انتقال يُدقَّق** | عدد صفوف التاريخ = عدد الانتقالات + 1 (الإنشاء) |
| 8 | **كل انتقال يُنشر** | عدد صفوف الصادر = عدد صفوف التاريخ |
| 9 | **حرّاس الإسناد** | الحالات التي تُسمّي سائقاً بلا إسناد ⇒ 422، وما قبل القبول بإسناد ⇒ 422 |
| 10 | **نهاية بلا سبب مرفوضة** | كل نهائية بلا `reason_code` ⇒ 422 |
| 11 | **`is_terminal` مُشتقّ** | القيمة في الحدث تُحسَب من الجدول، لا تُكتَب يدوياً |
| 12 | **تطابق المخزنين** | الاختبارات نفسها تعمل على مخزن الذاكرة وعلى Postgres |

---

## 6. الإسناد: سجل لا محرّك

المحرّك يُسجّل ما قرّرته Phase 07، ودورة حياة العرض الواحد:

```text
offered ──accepted──▶ accepted     (يُصبح الإسناد النشط، فيُمكن الانتقال إلى الحالات التي تُسمّي سائقاً)
        ──rejected──▶ rejected     (الطلب يعود للبحث — لا ينتهي)
        ──expired───▶ expired      (كذلك)
        ──cancelled─▶ cancelled
```

قواعد ملزمة:

- **`driver_public_id` مرجع opaque بـCHECK بلا FK** — ولذلك تعمل Phase 06 قبل Phase 05
  (ADR-010 القرار 4). المحرّك لا يسأل: هل هذا السائق موجود؟ مؤهَّل؟ متاح؟ ذلك ليس سؤاله.
- **لا عرض مكرَّر**: الطلب نفسه على السائق نفسه مرّتين ⇒ 409 `ORDER_ASSIGNMENT_DUPLICATE`.
- **العرض يُحلّ مرّة واحدة**: تحديث عرض محلول ⇒ 409 `ORDER_ASSIGNMENT_ALREADY_RESOLVED`.
- **الطابع الزمني يطابق الحالة**: «مقبول» بلا `accepted_at` سجلٌّ يكذب (`ck_order_assignments_state_timestamp`).
- **`sequence`** يحفظ ترتيب المحاولات على الطلب، فتاريخ الإسناد قابل للقراءة بعد سنة.

---

## 7. التدقيق والأحداث في معاملة واحدة

كل انتقال يكتب **ثلاثة أشياء معاً أو لا شيء**:

1. حالة الطلب في `orders`
2. صفّ في `order_status_history` (بـ`sequence` متسلسل لكل طلب)
3. حدث في `order_outbox`

هذه هي الذرّية التي لم تكن ممكنة في Phase 04 (هناك كان الحدث يعبر منفذاً في خدمة أخرى)؛ وهنا
الجداول الثلاثة لخدمة واحدة وقاعدة واحدة، فالمعاملة الواحدة كافية — ولذلك أُغلق الدين في هذه
المرحلة لا بعدها. **الناشر (publisher) الذي يقرأ الصادر ويرسل، مِلْك Phase 09.**

الأحداث الأربعة: `order.created` · `order.status_changed` · `order.assignment_offered` ·
`order.assignment_resolved` ([العقد](../../services/orders/contracts/events.json)).
حدّ الخصوصية: مستوى منطقة فقط · مُعرّفات opaque · أكواد أسباب من كتالوج · **لا** إحداثيات خام ·
**لا** نصّ كتبه مستخدم · **لا** مُعرّف قناة. يفرضه حارس تنقيب يمرّ على كل حمولة
(`packages/contracts/order/src/__tests__/boundary.test.ts`).

---

## 8. الإتقانية (Idempotency)

`Idempotency-Key` إلزامي على كل كتابة (§43): مدخل النظام بوت، وضغط الزر مرّتين حالة عادية لا
استثناء.

| الحالة | الجواب |
|---|---|
| مفتاح جديد | 201 وطلب جديد |
| نفس المفتاح + نفس الحمولة | **200** ونفس `order_public_id` — بلا صفّ ثانٍ وبلا حدث ثانٍ |
| نفس المفتاح + حمولة مختلفة | **409** `ORDER_IDEMPOTENCY_KEY_REUSED` |
| نيّة (`order_request_id`) وصلت بمفتاح آخر | **409** `ORDER_REQUEST_ALREADY_INGESTED` |

الفرق يُقاس ببصمة الحمولة المخزّنة (`payload_fingerprint`) لا بمقارنة الحقول واحداً واحداً:
مقارنة الحقول تنسى حقلاً جديداً بعد ستة أشهر، والبصمة لا تنسى.

---

## 9. الحدود مع الخدمات الأخرى

```text
customers  ──OrderIntakePort──▶  orders        (كتابة عبر HTTP فقط، لا وصول إلى الجداول)
orders     ──ports──▶            identity · geography   (قراءة، غير حرجة في مسار الكتابة)
dispatch (Phase 07) ──transition API──▶ orders
notifications (Phase 09) ◀──outbox──  orders
```

اتجاه الاعتماد **أحادي**: خدمة العميل تعرف المحرّك، والمحرّك لا يعرف خدمة العميل. من عكس هذا
الاتجاه أنشأ حلقة تجعل نشر أيّ منهما مرهوناً بالآخر.

---

## 10. ما لم يُنجَز بعد

| البند | مكانه |
|---|---|
| `state-machine.ts` وحالات الاستخدام ومخزن الذاكرة | MR 2/6 |
| Postgres + التدقيق + الصادر في معاملة واحدة + وظيفة CI | MR 3/6 |
| طبقة HTTP على المنفذ 8087 | MR 4/6 |
| `HttpOrderIntakePort` الإنتاجي في `services/customers` (دين Phase 04) | MR 5/6 |
| بوابة الخروج E2E: لا حالات مستحيلة | MR 6/6 |
| ناشر الصادر | Phase 09 |
| اختيار المرشّحين والأمواج والمهل | Phase 07 |
| إنشاء الطلب من البوت | Phase 11 |
| السعر النهائي والدفع والنزاعات فعلياً | Phase 12+ |
| Multi-stop (أكثر من نقطتين) | Phase 13 |

---

## 11. الروابط

- [ADR-010 — موضع محرّك الطلبات وآلة الحالة وحدّ الإسناد](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md)
- [ADR-009 — موضع Customer Core وحدّ تسليم الطلب](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md)
- [عقود خدمة المحرّك](../../services/orders/contracts/README.md) · [الأخطاء وكتالوج الأسباب](../../services/orders/contracts/errors.md)
- [نموذج مجال العميل](CUSTOMER_CORE.md) · [بوابة خروج Phase 04](../12-testing/PHASE04_EXIT_GATE_E2E.md)
- [الحاويات §4.2](../02-architecture/CONTAINERS.md) · [خارطة الطريق](../16-progress/ROADMAP.md)
