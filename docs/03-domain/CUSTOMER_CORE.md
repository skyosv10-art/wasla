# Customer Core — نموذج المجال (Phase 04)

> **Scope:** نموذج مجال العميل: ملف العميل · الأماكن المحفوظة · نيّة الطلب (Order Request) وحدّها مع محرّك الطلبات.
>
> **الحدّ الحاكم:** هذه الخدمة تُنتج **نيّة طلب مُتحقَّقة** وتُسلّمها. لا تملك الطلب ولا آلة حالته ولا المطابقة ولا التسعير (§15 · §16 · Phase 06+).
>
> **Related:** [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · [عقود الخدمة](../../services/customers/contracts/README.md) · [CONTAINERS](../02-architecture/CONTAINERS.md) · [ADR-001](../15-decisions/ADR-001-identity-decoupled-from-telegram.md) · [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)

---

## 1. لماذا خدمة مستقلة

Phase 04 تملك ما يفعله العميل: ملفه، أماكنه، وطلبه قبل أن يصبح طلباً في النظام. هذه مسؤوليات لها بياناتها الخاصة ودورة حياتها الخاصة، وإسنادها إلى Identity كان سيخلط **من هو المستخدم** بـ**ماذا يريد**، وإسنادها إلى محرّك الطلبات (غير الموجود بعد) كان سيؤجّلها كلّها. التفصيل والانحراف الموثّق عن شجرة §68 في [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md).

---

## 2. الكيانات

### 2.1 ملف العميل (Customer Profile)

| الحقل | النوع | ملاحظات |
|---|---|---|
| `wasla_public_id` | مفتاح أساسي | مرجع opaque إلى الهوية — **لا FK** (تغليف بين الخدمات) |
| `display_name` | نص اختياري | 1..80 — ما يظهر للسائق، لا اسم قانوني |
| `preferred_locale` | `ar` \| `en` \| `ur` | افتراضي `ar` (ADR-006) |
| `default_zone_id` | UUID اختياري | مرجع opaque إلى الجغرافيا — يختصر خطوة في البوت |
| `status` | `active` \| `suspended` | الإيقاف يمنع إنشاء الطلبات لا قراءة البيانات |

**ملفُّ دور لا هوية:** إنشاء ملف عميل **لا يُنشئ مستخدماً**؛ يشترط وجود هوية سابقة يتحقّق منها `IdentityLookupPort`. والشخص نفسه قد يكون عميلاً وسائقاً وشريكاً — الأدوار غير متعارضة (§7 · ADR-001).

### 2.2 المكان المحفوظ (Saved Place)

| الحقل | النوع | ملاحظات |
|---|---|---|
| `id` | UUID | |
| `label` | نص 1..60 | فريد لكل عميل بلا حساسية حالة الأحرف |
| `zone_id` | UUID | **إلزامي** — المرساة الحقيقية للمكان |
| `address_text` | نص اختياري ≤160 | وصف حرّ للسائق |
| `latitude` / `longitude` | اختياريان معاً | إحداثية ناقصة مرفوضة بقيد قاعدة |
| `idempotency_key` | نص 8..128 | فريد لكل (عميل، مفتاح) |
| `last_used_at` | زمن اختياري | لترتيب الأماكن الأكثر استعمالاً في البوت |

الحدّ الأقصى **20 مكاناً لكل عميل**، مُطبَّق في طبقة الاستعمال لا في المخطّط، لأنه سياسة قابلة للتغيير لكل عميل لاحقاً. تجاوزه → `CUSTOMER_PLACE_LIMIT_REACHED` (422).

حذف مكان **لا يُبطل طلباً ماضياً**: `saved_place_id` في نقاط الطلب بلا FK، والطلب يحمل نسخته من المنطقة والتسمية.

### 2.3 نيّة الطلب (Customer Order Request)

| الحقل | ملاحظات |
|---|---|
| `id` | UUID تملكه هذه الخدمة |
| `status` | `submitted` \| `submission_failed` — حالة **التسليم** لا حالة الطلب |
| `order_type` | `ride` \| `delivery` |
| `vehicle_class` | enum مغلق: `sedan`, `suv`, `van`, `pickup`, `motorcycle`, `truck_small` |
| `price_mode` | `customer_offer` (مبلغ إلزامي) \| `negotiable` (مبلغ ممنوع) |
| `offered_amount_minor` + `currency` | عدد صحيح بالوحدة الصغرى + ISO — لا عدد عشري في المال |
| `shipment_*` + `weight_kg` | للتوصيل فقط؛ في المشوار مرفوضة بقيد قاعدة |
| `order_public_id` | مرجع يملكه المحرّك — `NULL` حتى القبول |
| `failure_reason_code` | سبب تشغيلي عند فشل التسليم |

**النقاط قائمة مرتّبة** (`sequence`) لا عمودين: نقطتان بالضبط في هذه المرحلة (pickup + dropoff)، فيرفع Multi-stop (§3.2) القيد في مرحلته **بلا هجرة**. تجاوز النقطتين الآن → `CUSTOMER_MULTI_STOP_NOT_SUPPORTED` (422).

كل نقطة تُعرَّف بـ`zone_id` **إلزامياً** + `source` إلزامي (`map`, `telegram_location`, `link`, `text_search`, `saved_place`, `manual_zone`). الإحداثية اختيارية **للعرض والتسليم فقط**: لا Reverse Geocoding ولا حساب مسافة في النظام (§28 مؤجّل)، فلا تُقرّر الإحداثية تغطية ولا مطابقة ولا سعراً.

---

## 3. حالات الاستعمال

| الاستعمال | المخرَج | الفشل الأساسي |
|---|---|---|
| `GetCustomerProfile` | الملف | `CUSTOMER_PROFILE_NOT_FOUND` (404) |
| `UpsertCustomerProfile` | الملف + حدث created/updated | `CUSTOMER_IDENTITY_NOT_FOUND` (404) |
| `ListSavedPlaces` | قائمة مرتّبة بالأحدث استعمالاً | — |
| `SavePlace` | المكان + حدث saved | `CUSTOMER_PLACE_LABEL_TAKEN` (409) · `CUSTOMER_PLACE_LIMIT_REACHED` (422) |
| `RemoveSavedPlace` | 204 + حدث removed | `CUSTOMER_PLACE_NOT_FOUND` (404) |
| `PreviewOrderRequest` | نتيجة تحقّق + تحذيرات، **بلا كتابة** | أخطاء التحقّق نفسها بلا صف محفوظ |
| `SubmitOrderRequest` | الطلب + حدث submitted/failed | `CUSTOMER_ORDER_INTAKE_UNAVAILABLE` (503) |
| `ListOrderRequests` / `GetOrderRequest` | طلبات هذا العميل | `CUSTOMER_ORDER_REQUEST_NOT_FOUND` (404) |

**المعاينة تقرأ ولا تكتب.** قيمتها أن العميل يرى ما سيُرسل قبل إرساله: التحذيرات (`same_zone_pickup_and_dropoff`, `no_price_offered`) **لا تمنع** الإرسال — تصف حالة قد تُبطئ القبول لا خطأ.

---

## 4. المنافذ (Ports) واتجاه التبعية

| المنفذ | الاتجاه | Phase 04 | لاحقاً |
|---|---|---|---|
| `IdentityLookupPort` | customers → identity (قراءة) | HTTP/fake | كما هو |
| `GeographyPort` | customers → geography (قراءة) | HTTP/fake | كما هو |
| `OrderIntakePort` | customers → order engine (كتابة عبر عقد) | test double + fail-closed | محوّل HTTP في Phase 06 |
| `CustomerRepositoryPort` وأخواتها | customers → قاعدتها | in-memory ثم Postgres | كما هو |

لا خدمة تعتمد على `customers` في هذه المرحلة. البوت (`bots/customer-bot`) مستهلك للواجهة لا شريك في المجال، ويبقى **محايد القناة** (ADR-007).

`OrderIntakePort` بعقد واحد: `submitOrderRequest(OrderIntakeRequest) → { order_public_id, accepted_at }`. الخدمة **لا تكتب جدول `orders`** ولا تُولّد معرّفه — اختبارات الحدود في `@wasla/contracts-customer` تحرس ذلك على مستوى المخطّط والعقد.

---

## 5. Idempotency والفشل

مدخل النظام بوت، وضغط الزر مرّتين حالة عادية لا شاذّة، فـ`Idempotency-Key` **إلزامي** على إنشاء طلب وإضافة مكان (§43):

- المفتاح نفسه + الحمولة نفسها → **الكيان نفسه** بـ200، بلا تسليم ثانٍ إلى المحرّك.
- المفتاح نفسه + حمولة مختلفة → `CUSTOMER_IDEMPOTENCY_KEY_REUSED` (409) بلا كتابة.
- المفتاح مفقود → `CUSTOMER_MISSING_IDEMPOTENCY_KEY` (400).

**الفشل مرئي (fail-closed):** تعذّر تسليم الطلب إلى المحرّك يُنتج صفاً بحالة `submission_failed` + حدث فشل + `CUSTOMER_ORDER_INTAKE_UNAVAILABLE` (503). البديل — حفظ الطلب بصمت وانتظار محرّك غير موجود — يخلق طلبات بلا مالك، وهو ما يمنعه §53.

---

## 6. الأحداث والخصوصية

الأحداث الستّة في [events.json](../../services/customers/contracts/events.json). قاعدة الخصوصية مُلزِمة ومُختبَرة: الحمولة تحمل الموقع **على مستوى المنطقة الفرعية** ولا تحمل إحداثيات خام ولا نصوصاً كتبها المستخدم (تسمية · وصف شحنة · ملاحظات · اسم العرض). المستهلك (تحليلات · مطابقة · سمعة) يحتاج التصنيف لا المحتوى، ونشر النص يُصدِّر بيانات شخصية إلى كل مشترك بلا حاجة (§12.3 · §48).

---

## 7. مؤجّل صراحةً (وإلى أين)

| المؤجّل | إلى |
|---|---|
| الطلبات المجدولة (scheduled orders) | Phase 06+ |
| Multi-stop | §3.2 · Phase 13 |
| التسعير الذكي / السعر الاسترشادي | Phase 08 |
| تفاوض العميل على السعر و`agreed_price` | Phase 08 |
| تاريخ الرحلات وسمعة السائق للعميل | Phase 09+ |
| `apps/customer-mini-app` (واجهة ويب كاملة) | Phase 11 |
| تقارير الحوادث والشكاوى | Phase 12 |
| Reverse Geocoding وحساب المسافة | §28 (خارج نطاق النظام حالياً) |

---

## Related

- [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md)
- [عقود Customer Core](../../services/customers/contracts/README.md) · [errors.md](../../services/customers/contracts/errors.md)
- [MASTER_PROGRESS](../16-progress/MASTER_PROGRESS.md) — Phase 04
- [HANDOFF_NEXT_STEPS](../16-progress/HANDOFF_NEXT_STEPS.md) — §9
