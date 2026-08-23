# Order Engine Service — طبقة HTTP (Phase 06 · MR 4/6)

> **النوع:** توثيق واجهة (API Layer) · **Scope:** طبقة HTTP الفعلية لمحرّك الطلبات ومطابقتها للعقد، وقواعد ترويساتها، ونطاق المالك في القراءة، وحدودها مع المجال.
>
> **المصدر الكنسي للعقد:** [`services/orders/contracts/api.openapi.yml`](../../services/orders/contracts/api.openapi.yml) · [`errors.md`](../../services/orders/contracts/errors.md)
>
> **الخدمة:** `services/orders` (منفذ **8087**) · **Status:** Active · **Last Updated:** 2026-08-23
>
> **Related Code:** `services/orders/src/http/{app.ts,errors.ts,requests.ts,server.ts}` · `services/orders/src/use-cases/{read-order.ts,record-agreed-price.ts}` · `services/orders/src/{mappers.ts,runner.ts}` · `services/orders/src/infrastructure/drizzle/{runner.ts,repository.ts}` · `services/orders/src/__tests__/{http/app.test.ts,schema-drift.test.ts,postgres-repository.integration.test.ts}`
>
> **Related Team:** Team 06 — Order Engine
>
> **Related Docs:** [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) · [ORDER_CORE_DOMAIN.md](../02-architecture/ORDER_CORE_DOMAIN.md) · [ORDER_PERSISTENCE.md](../02-architecture/ORDER_PERSISTENCE.md) · [CUSTOMER_HTTP.md](CUSTOMER_HTTP.md) · [ORDER_INTAKE_HANDOVER.md](ORDER_INTAKE_HANDOVER.md) · [HANDOFF_NEXT_STEPS](../16-progress/HANDOFF_NEXT_STEPS.md) · [MASTER_PROGRESS](../16-progress/MASTER_PROGRESS.md)

---

## 1. ماذا أُضيف

`createOrderApp({ runner, logger?, health? })` — مصنع تطبيق Fastify يربط المسارات السبعة المنشورة بالـuse cases **دون بدء الاستماع**، فالاختبارات تعمل عبر `app.inject` بلا منفذ ولا مقبس. التركيب النهائي (composition root) في `src/http/server.ts` وهو **الملف الوحيد** الذي يقرأ متغيّرات البيئة أو يفتح اتصالاً بقاعدة البيانات.

```text
services/orders/src/runner.ts                      ← مقبس المعاملة: OrderRunner {write, read}
services/orders/src/infrastructure/drizzle/runner.ts ← تنفيذه فوق PostgresOrderUnitOfWork
services/orders/src/http/requests.ts               ← ترجمة snake_case (السلك) → المجال + قوائم القيم المغلقة
services/orders/src/http/errors.ts                 ← OrderError → { code, message, trace_id }
services/orders/src/http/app.ts                    ← المسارات + الترويسات + رموز الحالة + نطاق المالك
services/orders/src/http/server.ts                 ← composition root (Postgres أو in-memory)
```

**لم يتغيّر ملف واحد في `src/use-cases/`.** التغيير الوحيد في المجال هو `assertNotes` (§7) وهو إصلاح تباعد بين المحوّلين لا ميزة في الواجهة.

### 1.1 لماذا `OrderRunner` ولماذا لا يستقبل التطبيق التبعيات مباشرة

الـuse cases تستقبل `OrderDependencies`، والكتابة في هذا المحرّك **ثلاثية** (حالة + صفّ تدقيق + حدث) ويجب أن تكون ذرّية (MR 3/6). لو استقبل المصنع `deps` لكان على كل معالج مسار أن يتذكّر فتح معاملة — أي أن نسيان واحد يكسر الذرّية بصمت. المصنع يستقبل `runner` فقط:

- `runner.write(work)` — يشغّل العمل داخل وحدة عمل واحدة (`PostgresOrderUnitOfWork` في الإنتاج).
- `runner.read(work)` — يشغّل العمل على الاتصال الجذري بلا معاملة (قراءتان فقط).

فقرار المعاملة يقع في مكان واحد قابل للمراجعة، والاختبارات تُمرّر `createDirectRunner(inMemoryDeps)` في الموضع نفسه الذي يُمرّر فيه الإنتاج `PostgresOrderRunner`.

---

## 2. المسارات (مطابقة للـOpenAPI)

| Method | Path | نجاح | ترويسات إلزامية | ملاحظات |
|---|---|---|---|---|
| GET | `/health` | 200 | — | `ok` فقط مع تخزين دائم — §5 |
| POST | `/orders/intake` | **201** طلب جديد · **200** إعادة تشغيل مفتاح | `Idempotency-Key` | الجسم = `{order_public_id, accepted_at}` فقط |
| GET | `/orders/{orderId}` | 200 | `X-Customer-Public-Id` | طلب عميل آخر = **404** — §4 |
| GET | `/orders/{orderId}/history` | 200 | `X-Customer-Public-Id` | `{items:[…]}` من الأقدم إلى الأحدث |
| POST | `/orders/{orderId}/transitions` | 200 | `Idempotency-Key` | يعيد الطلب بعد الانتقال |
| POST | `/orders/{orderId}/assignments` | **201** | `Idempotency-Key` | تسجيل عرض على سائق |
| PATCH | `/orders/{orderId}/assignments/{assignmentId}` | 200 | `Idempotency-Key` | حسم العرض (accepted/rejected/expired/cancelled) |

**رموز النجاح قرارات لا أذواق:** `201` في الاستلام تعني «أُنشئ»، و`200` تعني «كان موجوداً وأعدنا لك نفسه» — فيميّز المُنادي بين الحالتين بلا مقارنة أجسام. تسجيل العرض `201` لأنه سجلّ جديد، وحسمه `200` لأنه سجلّ قائم تغيّر، والانتقال `200` لأن الطلب كان موجوداً.

---

## 3. قواعد الترويسات

| الترويسة | الحال | الحدود | عند الخطأ |
|---|---|---|---|
| `Idempotency-Key` | **إلزامية في كل كتابة** (4 مسارات) | 8–128 محرفاً | `400 ORDER_VALIDATION_FAILED` |
| `X-Customer-Public-Id` | إلزامية في القراءتين | شكل `WS-` + 10 أرقام | `400 ORDER_VALIDATION_FAILED` |
| `x-request-id` | اختيارية | ≤ 128 محرفاً | `400 ORDER_VALIDATION_FAILED` |

- **لماذا المفتاح إلزامي؟** مدخل النظام بوت: النقر المزدوج حدث عادي لا شذوذ. المفتاح يُقرأ **قبل** تحليل الجسم، فلا يمكن أن تصبح إعادة المحاولة طلباً ثانياً.
- **ترويسة مكرّرة تُرفض** ولا يُخمَّن أيّ قيمة تُحتسب: وسيط بينك وبيننا قد يضيف قيمة ثانية، والاختيار الصامت بينهما يعني أننا نقرّر عن المُنادي هل هذه إعادة محاولة أم طلب جديد.
- **`idempotency_key` في الجسم**: العقد يذكره اختيارياً (مرآةً لعقد العميل). إن حضر وخالف الترويسة ⇒ `400`؛ الترويسة هي المعتمدة عند التوافق لأنها الوسيط الذي يصفه العقد بالإلزامي.
- **`x-request-id` → `trace_id`**: مُمرَّر إلى `Fastify({ requestIdHeader })` فيصل المُعرّف نفسه إلى **صفّ التدقيق ومغلّف الحدث** لا إلى الاستجابة فقط، فتُتابع شكوى عميل من البوت إلى المحرّك بخيط واحد. غيابه لا يعطّل شيئاً (Fastify يولّد مُعرّفه).

---

## 4. نطاق المالك: الجواب **404** لا **403**

قراءة طلب عميل آخر تُجاب بـ`ORDER_NOT_FOUND` — الجواب نفسه لمُعرّف غير موجود.

`403` كان سيُثبت أن الطلب موجود، فيتحوّل المسار إلى **عرّاف وجود**: `order_public_id` تسلسلي (`ORD-` + تتابع قاعدة البيانات — ADR-010 القرار 5)، فيمكن لمُنادٍ أن يسير على الأرقام ويعدّ طلبات المنصّة ويقيس نموّها. لذلك:

- الجواب `404` بالرمز نفسه والشكل نفسه، **وفي السجلّ أيضاً** لا في الاستجابة فقط.
- القاعدة مُثبَّتة باختبار (`answers 404 — never 403 — for another customer's order`) لا بذاكرة مُراجع.

---

## 5. `/health`

```json
{ "status": "degraded", "service": "orders-service", "persistence": "memory" }
```

`ok` **فقط** عندما تكون `persistence = postgres`. خدمة تقول `ok` وهي لا تستطيع تخزين طلب بشكل دائم تُخفي انقطاعاً؛ والسقوط إلى الذاكرة (عند غياب `DATABASE_URL`) راحة تطوير **مُعلَنة** لا صامتة.

---

## 6. خريطة الأخطاء الكاملة (18 رمزاً)

الطبقة **لا تصنّف**: `OrderError` يحمل الرمز الثابت وصنفه والحالة المشتقّة منه (`httpStatusForOrderError`، محميّ من الانحراف مقابل `contracts/errors.md`). هذا الملف يكتب شكل العقد `{code, message, trace_id}` بالحالة التي قرّرها الكتالوج.

| الرمز | HTTP | يُرفع عند |
|---|---|---|
| `ORDER_VALIDATION_FAILED` | 400 | مفتاح تكرار غائب/قصير، ترويسة مكرّرة، `orderId` غير صالح، عضو تعداد مجهول، JSON تالف، حالة `to_status` غير معروفة، ملاحظات > 300 |
| `ORDER_NOT_FOUND` | 404 | مُعرّف غير موجود **أو** طلب عميل آخر |
| `ORDER_ASSIGNMENT_NOT_FOUND` | 404 | تعيين لا ينتمي إلى الطلب |
| `ORDER_ILLEGAL_TRANSITION` | 409 | الزوج (من، إلى) غير مذكور في جدول الانتقالات |
| `ORDER_IDEMPOTENCY_KEY_REUSED` | 409 | المفتاح نفسه بجسم مختلف |
| `ORDER_REQUEST_ALREADY_INGESTED` | 409 | `order_request_id` مُستهلك بمفتاح آخر |
| `ORDER_ASSIGNMENT_DUPLICATE` | 409 | عرض حيّ ثانٍ للسائق نفسه |
| `ORDER_ASSIGNMENT_ALREADY_RESOLVED` | 409 | حسم تعيين محسوم |
| `ORDER_ASSIGNMENT_REQUIRED` | 422 | `accepted` بلا تعيين مقبول مرتبط |
| `ORDER_ASSIGNMENT_FORBIDDEN` | 422 | تعيين في حالة لا تسمح به |
| `ORDER_REASON_CODE_REQUIRED` | 422 | حالة نهائية بلا سبب |
| `ORDER_REASON_CODE_UNKNOWN` | 422 | سبب خارج الكتالوج (في الانتقال **وفي حسم التعيين**) |
| `ORDER_ACTOR_REF_REQUIRED` | 422 | فاعل بشري بلا `actor_ref` |
| `ORDER_ACTOR_REF_FORBIDDEN` | 422 | `actor_ref` مع `system` |
| `ORDER_PRICE_MODE_MISMATCH` | 422 | `customer_offer` بلا مبلغ أو `negotiable` بمبلغ |
| `ORDER_SHIPMENT_NOT_ALLOWED` | 422 | تفاصيل شحنة على `ride` |
| `ORDER_STOPS_INVALID` | 422 | محطّات لا تصف رحلة |
| `ORDER_ENGINE_UNAVAILABLE` | 503 | كل ما تبقّى (خطأ مبرمج، سائق قاعدة بيانات، معاملة لم تُفتح) |

### 6.1 حدود فاصلة داخل هذا الجدول

- **`400` مقابل `422`**: `400` = «لم أفهم ما أرسلت» (شكل/تعداد/ترويسة). `422` = «فهمته ورفضته لأن معناه مخالف». حالة مُختلقة (`to_status: "teleported"`) هي `400` لا `409`: لا يوجد «تنازع» مع جدول لا تظهر فيه أصلاً.
- **`503` لا `500`**: كتالوج الأخطاء لا يحتوي صنف `service_error`، وردّ فعل المُنادي الموثَّق على `503` (إعادة المحاولة بالمفتاح نفسه) هو الصحيح لفشل داخلي عابر — والاستلام مُتماثل فلا تنتج إعادة المحاولة طلباً ثانياً.
- **`404` لمسار غير موجود لا يُترجم إلى `ORDER_NOT_FOUND`**: خطأ في الطريق ليس طلباً مفقوداً، ودمجهما يجعل خطأً مطبعياً في مسار يبدو في سجلّات المُنادي كطلب عميل اختفى. مُثبَّت باختبار.
- **الغلاف لا يحمل `details`**: `ErrorResponse` في العقد هو `{code, message, trace_id}` فقط. اسم الحقل المخالف يظهر في الرسالة البشرية وفي السجلّ، ولا يُضاف حقلاً بنيوياً قد يبني عليه المُنادي منطقاً لم نتعاقد عليه.

---

## 7. تغيير واحد في المجال: `assertNotes`

`schema.sql` كان يحمل `CHECK (notes IS NULL OR char_length(notes) <= 300)` **بلا مقابل في المجال**. النتيجة أن المحوّلين كانا يختلفان: مخزن الذاكرة يقبل ملاحظة بـ400 محرف، وPostgres يرفضها بانتهاك قيد يخرج للمُنادي كـ`503` — أي «تعطّل الخدمة» لما هو `400` صريح. أُضيف `assertNotes` إلى `src/domain/validation.ts` ويُنادى من `assertIntakeCommand`:

- خاصية «كل قاعدة في قاعدة البيانات لها خطأ مُرمَّز في المجال» عادت صحيحة بلا استثناء.
- الإصلاح في المجال لا في طبقة HTTP **لأن Phase 07 سيُنادي الـuse cases مباشرة** ويجب أن يُرفض الطلب نفسه بالطريقة نفسها.

---

## 8. اتفاق السعر بين التفاوض والطلب

المساران التاليان حدٌّ خدميّ لا واجهة عميل؛ التفاوض لا يعرف UUID الداخلي، لذا يحمل
الجسم أو الاستعلام `order_public_id`، وهو المعرّف الذي تتداوله الخدمات. لا تُقبل
`X-Customer-Public-Id` هنا: لا توجد قراءة لمحتوى عميل ولا قاعدة ملكية لنثبتها،
وإضافة الترويسة كانت ستخترع أسلوب هوية ثانياً لا يملكه المُنادي.

| Method | Path | النتيجة | لماذا الحد بهذا الشكل |
|---|---|---|---|
| POST | `/orders/agreed-prices` | **201** تسجيل أول · **200** إعادة مطابقة | السعر مورد مسجل للطلب لا مسار UUID لا يملكه التفاوض |
| GET | `/orders/lookup?order_public_id=…` | **200** ملخص | المطابقة تحتاج قرار الطلب لا تفاصيل العميل |

### 8.1 تسجيل السعر

`AgreedPriceRecord` جسم مغلق (`additionalProperties: false`) لأن تجاهل حقل مالي
مكتوب خطأً أخطر من رفضه: `order_public_id`, `negotiation_id`,
`driver_public_id`, `amount_minor`, `currency`, `agreed_at`. ترويسة
`Idempotency-Key` إلزامية و`x-request-id` اختيارية، تماماً كأي كتابة؛ إعادة نفس
الخيط والمبلغ والعملة آمنة وتجيب **200**، ولا تحتاج الخدمة ترويسة عميل.

| القاعدة | HTTP | الكود | لماذا |
|---|---:|---|---|
| لا طلب بهذا `order_public_id` | 404 | `ORDER_NOT_FOUND` | لا يوجد صف يعلّق عليه أثر الاتفاق |
| `price_mode` ليس `negotiable` | 422 | `ORDER_PRICE_NOT_NEGOTIABLE` | عرض العميل وسعر تفاوضي مصدران متناقضان للسعر |
| الحالة خارج `published/searching/offered/negotiating/accepted` | 422 | `ORDER_NOT_OPEN_FOR_AGREED_PRICE` | لا يعاد تفسير تنفيذ بدأ أو انتهى كسعر جديد |
| السعر من خيط آخر، أو الخيط مربوط بطلب آخر | 409 | `ORDER_AGREED_PRICE_ALREADY_SET` | خيط تفاوض واحد يثبت اتفاقاً واحداً |
| الخيط نفسه بمبلغ أو عملة مختلفين | 409 | `ORDER_AGREED_PRICE_MISMATCH` | إعادة المحاولة لا تعيد كتابة الدليل |
| الخيط نفسه بالمبلغ والعملة نفسيهما | 200 | — | التكرار لا ينبغي أن يحوّل إعادة الإرسال إلى نزاع |

التسجيل **لا يغيّر الحالة** ولا يكتب `order_status_history` ولا ينشئ إسناداً:
`transitionOrder` وحده حاكم دورة الحياة، وإدخال حاكم ثانٍ يجعل صف الحالة قابلاً
للتغيير من مسارين. وبالمثل لا يوجد حدث جديد في `events.json`: حقيقة الاتفاق
ملك `negotiations.agreed`، بينما الطلب يحفظ حقلاً؛ حدثان للواقعة نفسها يصنعان
مصدرَي حقيقة لا أثر تدقيق إضافياً.

### 8.2 قراءة `lookup` مصغّرة عمداً

`OrderSummary` يعيد فقط `order_public_id`, `order_id`, `status`, `price_mode`,
`order_type`, `vehicle_class`, `agreed_price`, `agreed_at`,
`agreed_negotiation_id`. لا يعيد العميل أو المحطات أو الوصف أو الملاحظات؛ تلك
نصوص كتبها مستخدم ولا تحتاجها خدمة تفاوض لتقرير قابلية التسجيل. إبقاؤها خارج
الرد يطبّق حد الخصوصية في ADR-009 §7 وADR-010 القرار 7 بدلاً من الاعتماد على
حسن نية كل مستهلك لاحق.

### 8.3 ترحيل الأعمدة ونقضه

`contracts/schema.sql` هو مصدر الحقيقة ولا يولّد Drizzle مخططاً. الأعمدة قابلة
لـNULL بلا default، لذلك إضافة الميزة عكسية ولا تعطل الصفوف الموجودة:

```sql
ALTER TABLE orders ADD COLUMN agreed_amount_minor BIGINT
  CHECK (agreed_amount_minor IS NULL OR agreed_amount_minor > 0);
ALTER TABLE orders ADD COLUMN agreed_currency TEXT
  CHECK (agreed_currency IS NULL OR agreed_currency ~ '^[A-Z]{3}$');
ALTER TABLE orders ADD COLUMN agreed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN agreed_negotiation_id UUID;
ALTER TABLE orders ADD CONSTRAINT ck_orders_agreed_price_complete CHECK (
  (agreed_amount_minor IS NULL) = (agreed_currency IS NULL)
  AND (agreed_amount_minor IS NULL) = (agreed_at IS NULL)
  AND (agreed_amount_minor IS NULL) = (agreed_negotiation_id IS NULL)
);
ALTER TABLE orders ADD CONSTRAINT ck_orders_agreed_price_only_negotiable CHECK (
  agreed_amount_minor IS NULL OR price_mode = 'negotiable'
);
CREATE UNIQUE INDEX ux_orders_agreed_negotiation
  ON orders (agreed_negotiation_id) WHERE agreed_negotiation_id IS NOT NULL;
```

والنقض الصريح، بعد التأكد تشغيلياً من عدم احتياج الأثر:

```sql
DROP INDEX IF EXISTS ux_orders_agreed_negotiation;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS ck_orders_agreed_price_only_negotiable;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS ck_orders_agreed_price_complete;
ALTER TABLE orders DROP COLUMN IF EXISTS agreed_negotiation_id;
ALTER TABLE orders DROP COLUMN IF EXISTS agreed_at;
ALTER TABLE orders DROP COLUMN IF EXISTS agreed_currency;
ALTER TABLE orders DROP COLUMN IF EXISTS agreed_amount_minor;
```

### 8.4 أدلة التنفيذ

| الدعوى | الاختبار الذي يثبتها |
|---|---|
| 201 ثم 200، وإعادة المبلغ المختلفة ترفض بالكود | `POST /orders/agreed-prices › records once with 201 then returns 200…` و`… › refuses a different amount on a repeated negotiation` |
| كل قاعدة قبول ورفض لها كود ثابت | `POST /orders/agreed-prices › answers the not-found code…` و`… › refuses a customer-offer…` و`… › refuses an order whose lifecycle…` و`… › refuses a different negotiation…` |
| `lookup` يعيد `price_mode` ولا يسرّب النصوص | `GET /orders/lookup › returns matching facts including price mode and no customer-authored fields` |
| المساران مسجلان فعلاً | `published route registration › registers both agreed-price service routes in Fastify` |
| مرآة Drizzle وDDL وكتالوج الأخطاء متوافقة | `Drizzle projection ↔ canonical DDL › keeps the agreed-price columns, checks and unique negotiation index in both mirrors` و`… › documents exactly the agreed-price error codes…` |
| PostgreSQL نفسه يفرض الاكتمال ووضع التفاوض وتفرّد الخيط | `Order Postgres adapter › the canonical database rejects incomplete, non-negotiable and reused agreement evidence` |

## 9. الانحرافات والحدود المُعلَنة

| # | الانحراف / الحد | لماذا | البديل ولماذا رُفض |
|---|---|---|---|
| 1 | `maxItems: 2` على `stops` في العقد (سابق لهذه المهمة) | محطّتان تكفيان لكل ما يشغّله MVP | — (مُعلَن في MR 1/6) |
| 2 | `{orderId}` يقبل **UUID أو `ORD-##########`** بينما العقد يصفه `format: uuid` | استجابة الاستلام تُعيد `order_public_id` **فقط** (ولا يجب أن تُعيد مُعرّفاً داخلياً ثانياً). لو قَبِل المسار الـUUID وحده، لَما استطاع مُنادٍ قراءة الطلب الذي أنشأه للحظته | كشف المُعرّف الداخلي في استجابة الاستلام — مرفوض: مقبضان لشيء واحد، وأحدهما لا يجب أن يخرج من الخدمة |
| 3 | مفتاح التكرار في `PATCH …/assignments/{id}` مطلوب ومُسجَّل، لكن **لا يوجد إلغاء تكرار حقيقي** له بعد | `ResolveAssignmentCommand` لا يملك خانة إعادة تشغيل؛ الحسم المزدوج يُرفض أصلاً بـ`409 ORDER_ASSIGNMENT_ALREADY_RESOLVED` فالضرر منتفٍ عملياً | عدم طلب المفتاح اليوم — مرفوض: إضافته غداً تصبح تغييراً كاسراً |
| 4 | **لا مصادقة**: Phase 06 يفرض **شكل** الفاعل (`actor_ref` مع البشري، ممنوع مع `system`) ولا يتحقّق أن المُنادي هو من يزعم | لا هوية تُقدَّم على هذا الحد بعد | فحص يشبه المصادقة دون أن يكون — مرفوض: أخطر من غيابه المُعلَن |
| 5 | فحص الترويسة المكررة في `services/orders/src/http/requests.ts` يرفض المصفوفة فقط ولا يرفض قيمةً مدمجةً بفاصلة | Node قد يدمج الترويسات المكررة في نص واحد؛ إصلاح الفاصلة نُفّذ في matching وdispatch فقط في MR 5b/6 | تعديل هذا الملف في عمل طبقات matching/dispatch — مرفوض: خارج النطاق؛ الدَّين مُعلن في وثيقتيهما |

---

## 10. الأدلّة (لا «Done» بلا دليل)

| البند | الدليل |
|---|---|
| اختبارات الخدمة | `pnpm --filter @wasla/orders-service test` ⇒ **8 ملفات · 635 اختباراً ناجحاً** |
| عقد الطلبات | `pnpm --filter @wasla/contracts-order test` ⇒ **119 ناجحاً** (كتالوجات التعدادات + `ORDER_SHIPMENT_TYPES` مقابل OpenAPI) |
| المستودع كاملاً | `pnpm -r typecheck` ⇒ نجاح · `pnpm -r test` ⇒ نجاح كل الحزم |
| تشغيل فعلي | `PORT=8099 node --import tsx src/http/server.ts` ⇒ `/health` = `degraded/memory`، واستلام طلب = `201` |
| التكامل مع Postgres | `order-db-integration` في CI (**32 اختباراً**؛ منها قيود اتفاق السعر). محلياً تتخطّى نفسها عند غياب `DATABASE_URL`. |

**غير مُغطّى:** `server.ts` نفسه (تركيب لا منطق — يُغطّيه التشغيل الفعلي أعلاه وبوّابة MR 6/6).

---

## 11. ماذا بعد

- **~~MR 5/6~~ — منجَزة:** خدمة العملاء صارت تُنادي `POST /orders/intake` هنا عبر `HttpOrderIntakePort` الإنتاجي، و`/health` عندها صار `ok` لأول مرة. خريطة الحالات (200 نجاح · 409 و422 رفض نهائي · 400 خطؤنا · 503 قابل لإعادة المحاولة · مهلة = غموض مُسجَّل) موثّقة في [ORDER_INTAKE_HANDOVER.md](ORDER_INTAKE_HANDOVER.md).
- **~~MR 6/6~~ — منجَزة، وPhase 06 مُغلقة:** حزمة `packages/order-e2e` تقود هذه المسارات فوق HTTP على خدمتين تعملان — رحلة كاملة من `published` إلى `completed`، ثمّ **مسح الأزواج الـ441**: 72 حافة تجيب 200 و369 تجيب 409 `ORDER_ILLEGAL_TRANSITION` **والحالة لا تتغيّر** — ووظيفة CI `order-exit-gate-e2e` ترفع الملف نفسه على Postgres. التفصيل في [PHASE06_EXIT_GATE_E2E.md](../12-testing/PHASE06_EXIT_GATE_E2E.md) ([MR !43](https://gitlab.com/uxxxu/wasla/-/merge_requests/43)).
- **Phase 07 (Dispatch & Matching MVP) — التالية:** المطابقة تستهلك مسارَي الإسناد هنا (`POST /orders/{id}/assignments` ثمّ `PATCH …/{assignmentId}`) ولا تكتب حالة الطلب بنفسها: **المحرّك يسجّل ولا يقرّر** ([ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md)). سلسلة النداء المطلوبة مكتوبة كاختبار يعمل في `packages/order-e2e/src/harness.ts` (`bindAcceptedAssignment`) — و[HANDOFF §11](../16-progress/HANDOFF_NEXT_STEPS.md) يُفصّل ما يجب أن يُقرَّر أولاً.
