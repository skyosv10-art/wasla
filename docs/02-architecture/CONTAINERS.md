# CONTAINERS — الحاويات والخدمات

> **Scope:** الحاويات/المكونات الرئيسية في WASLA: Bots، Apps، Services، Packages، Data stores.
>
> **المرجع الأم:** أقسام 37 (Data Architecture) و38 (قاعدة البيانات) و41 (Event Bus) و142 (Queue Strategy) و143 (Object Storage) من الدليل التنفيذي.
>
> **Last Updated:** 2026-08-21 · **Status:** Baseline v1.0 (+ خدمة Customer Core §4.1 — Phase 04: العقود والأنواع المُكتبة مُنفَّذة) (+ خدمة Order Engine §4.2 — Phase 06: العقود والأنواع المُكتبة وجدول الانتقالات موثّقة) (+ خدمتا Matching وDispatch §4.3 — Phase 07: العقود والأنواع المُكتبة موثّقة) (+ طبقة القنوات §5.1 — Phase 03: نواة channel-core ومُهيّئ telegram-adapter وطبقة تشغيل البوتات `bot-runtime` مع البوتات الثلاثة ومُهيّئات `channel-postgres` ودعم المجموعات مُنفَّذة) · **Related Team:** Team 09 (Data) · Team 10 (DevOps) · Team 12 (Integration)

---

## 1. نظرة عامة على الحاويات

WASLA Monorepo يحتوي على خمس فئات من الحاويات/المكونات:

```text
1. Bots        — بوتات Telegram (3)
2. Apps        — تطبيقات الواجهة (Mini Apps + Admin Web)
3. Services    — 24 خدمة (Bounded Contexts)
4. Packages    — مكتبات مشتركة (10 مخطّطة + طبقة القنوات)
5. Data Stores — مخازن البيانات والبنية التحتية
```

---

## 2. Bots (بوتات Telegram)

| الحاوية | المسار | المسؤولية |
|---|---|---|
| Customer Bot | `bots/customer-bot/` | Start، Identity bootstrap، فتح Customer Mini App، Notifications، Links، Deep Links، حالات قصيرة سريعة — **مُنفَّذ أساسه (MR 4)** |
| Driver Bot | `bots/driver-bot/` | التسجيل، رفع المستندات، الاشتراك، فتح Driver Mini App، الطلبات العاجلة، حالة العمل، Community Group، إشعارات الطلبات — **مُنفَّذ أساسه (MR 4)** |
| Partner Bot | `bots/partner-bot/` | تسجيل الشريك، فتح Partner Mini App، إدارة الطلبات، الإشعارات المهمة، Store/Business entry — **مُنفَّذ أساسه (MR 4)** |

> لا يوجد Admin Bot كقناة أساسية — الإدارة عبر Web Admin Portal.

كل البوتات تمر عبر **Telegram Adapter** الذي يملك: Update Intake، Identity Linking، Message Delivery، Mini App Launch، Deep Links، Group Adapter، Bot Rate/Retry Control، Telegram Error Mapping.

**ما هو مُنفَّذ فعلاً بعد MR 4 (Phase 03):** كل بوت **تطبيق قابل للنشر مستقل** (رمز Telegram ورمز webhook خاصان به، ومنفذ خاص: 8083 / 8084 / 8085)، لكن الكود داخله يقتصر على **تسمية بوته**: كل السلوك في الحزمة المشتركة `@wasla/bot-runtime` (§5.1). المسارات العاملة اليوم: `POST /channel/{bot}/webhook` (بالتحقّق من الرمز أولاً) · `POST /channel/messages` · `GET /channel/{bot}/mini-app` · `POST /channel/{bot}/deep-links` · `GET /health`. الأمر المدعوم الوحيد `/start`، وردّه زر Mini App الخاص بالبوت. المسؤوليات الأخرى في الجدول أعلاه (المستندات، الاشتراك، إدارة الطلبات…) تنتظر مراحل مجالها. **التخزين دائم على Postgres** متى وُجِد `DATABASE_URL` (MR 5 · [CHANNEL_PERSISTENCE.md](CHANNEL_PERSISTENCE.md))، ومجموعة الذاكرة بغيابه للتشغيل المحلي. وبعد MR 6 يعمل البوت في **المجموعات** أيضاً: يردّ في الغرف المُعلَنة في البيئة فقط برابط عميق يفتح المحادثة الخاصة (لا زر Mini App)، ولا يُهيّئ هوية من غرفة، ويصمت في غرفة غير مُعلَنة مع تسجيل تحديثها ([CHANNEL_GROUPS.md](CHANNEL_GROUPS.md)) — التفصيل والمؤجّلات في [CHANNEL_BOTS.md](CHANNEL_BOTS.md).

---

## 3. Apps (تطبيقات الواجهة)

| التطبيق | المسار | الفريق | الوصف |
|---|---|---|---|
| Customer Mini App | `apps/customer-mini-app/` | Team 02 | واجهة العميل الثقيلة: إنشاء طلب، تتبع، تفاوض، سجل |
| Driver Mini App | `apps/driver-mini-app/` | Team 03 | واجهة السائق: حالة العمل، الطلبات، الاشتراك، السمعة، الأداء |
| Partner Mini App | `apps/partner-mini-app/` | Team 07 | واجهة الشريك: الطلبات، المتاجر، المنتجات، التوصيل، التقارير، API |
| Admin Web | `apps/admin-web/` | Team 08 | بوابة الإدارة: User/Driver/Store moderation، Manual dispatch، Broadcast، Config |

> الـMini App هي مكان الخدمات الثقيلة؛ البوت للإطلاق والتنبيه والإجراءات الصغيرة.

---

## 4. Services (الخدمات الـ24)

القائمة الكاملة والتفصيلية في [`/docs/01-product/SERVICES.md`](../01-product/SERVICES.md). الخدمات مرتبة حسب المجال:

```text
identity · auth · geography · orders · rides · delivery · matching · dispatch
drivers · subscriptions · reputation · fraud · referrals · marketplace · search
chat · translation · notifications · support · partners · billing · compliance · audit · analytics
```

> في Modular Monolith: PostgreSQL واحد مع Logical Schemas/Bounded Contexts لكل خدمة. بعد استخراج الخدمات، لا تسمح خدمة أن تقرأ جداول خدمة أخرى مباشرة.

### 4.1 خدمة Customer Core — Phase 04 (انحراف موثّق)

أُضيفت خدمة **`services/customers`** (`@wasla/customers-service`، المنفذ 8086) بقرار [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md). القائمة أعلاه لا تحوي خدمة عميل، لأن الشجرة الأصلية أسندت العميل ضمناً إلى `orders`؛ وهذا انحراف **معلَن ومُبرَّر**: مسؤوليات Phase 04 (ملف العميل · الأماكن المحفوظة · نيّة الطلب) لها بياناتها ودورة حياتها، ومالكها Team 02، ولا يجوز أن تنتظر محرّك الطلبات (Phase 06) ولا أن تسكن في Identity فتخلط «من المستخدم» بـ«ماذا يريد».

| الخدمة | المسار | الغرض | الحالة |
|---|---|---|---|
| customers | `services/customers/` | ملف العميل (ملفُّ دور) · الأماكن المحفوظة · معاينة نيّة الطلب وتسليمها عبر `OrderIntakePort` | **العقود مُنفَّذة (MR 1 · Phase 04)** — [نموذج المجال](../03-domain/CUSTOMER_CORE.md) · [العقود](../../services/customers/contracts/README.md) |

اتجاه الاعتماد أحادي وملزم:

```text
customers → identity   (قراءة عبر IdentityLookupPort)
customers → geography  (قراءة عبر GeographyPort)
customers → order engine (كتابة عبر OrderIntakePort فقط — لا وصول إلى جدول orders)
```

لا خدمة تعتمد على `customers` في هذه المرحلة، و`bots/customer-bot` مستهلك لواجهتها لا شريك في مجالها (يبقى محايد القناة — ADR-007). الأنواع المُكتبة في `packages/contracts/customer/` (`@wasla/contracts-customer`).

### 4.2 خدمة Order Engine — Phase 06

خدمة **`services/orders`** (`@wasla/orders-service`، المنفذ **8087**) موجودة في الشجرة الأصلية أعلاه، فلا انحراف هنا: [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) يُثبّت **حدودها** لا موضعها. تملك الطلب: هويته العامة (`ORD-` + عشرة أرقام من متتالية في القاعدة) · حالاته الواحد والعشرين وانتقالاتها الاثنين والسبعين · سجل التدقيق · **مراجع** الإسناد · صندوق الصادر.

| الخدمة | المسار | الغرض | الحالة |
|---|---|---|---|
| orders | `services/orders/` | آلة حالة الطلب · المعرّف العام · سجل التدقيق · مراجع الإسناد · Outbox | **العقود مُنفَّذة (MR 1 · Phase 06)** — [نموذج المجال وجدول الانتقالات](../03-domain/ORDER_ENGINE.md) · [العقود](../../services/orders/contracts/README.md) |

اتجاه الاعتماد أحادي وملزم:

```text
customers            → orders   (كتابة عبر OrderIntakePort فقط — لا وصول إلى جداول الطلب)
dispatch (Phase 07)  → orders   (تغيير الحالة عبر مسار الانتقالات وتسجيل الإسناد)
orders               → identity · geography   (قراءة عبر منافذ، غير حرجة في مسار الكتابة)
orders               → notifications (Phase 09)   (عبر Outbox فقط — لا نداء مباشر)
```

**ما لا تعرفه الخدمة** (حدٌّ يفرضه حارس اختبار لا مراجعة بشرية):

- **من هو السائق**: `driver_public_id` مرجع opaque بـCHECK **بلا FK**، فلا انتظار لـPhase 05 (Driver Core لم تبدأ) ولا حكم على الأهلية.
- **من يستحقّ العرض**: لا مرشّحين ولا أمواج ولا مهل — تلك مِلْك Phase 07. المحرّك **يسجّل** الإسناد ولا يُقرّره (§16).
- **القناة**: لا `chat_id` ولا Telegram في أي عمود أو حمولة حدث (ADR-007).

الأنواع المُكتبة في `packages/contracts/order/` (`@wasla/contracts-order`).

### 4.3 خدمتا Matching وDispatch — Phase 07

خدمتان **موجودتان في الشجرة الأصلية** أعلاه (`matching` · `dispatch`)، فلا انحراف في الموضع: [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) يُثبّت **حدودهما** وسببَ بقائهما خدمتين لا واحدة. القاعدة في §16: **لا نخلط بين Matching وDispatch** — سؤال «من يصلح؟» جواب دالّة على بيانات، وسؤال «من يأخذه الآن؟» جواب مهمّة لها حالة وزمن؛ وخلطهما يُنتج نظاماً لا يمكن أن تُجيب فيه عن «لماذا هذا السائق؟» بمعزل عن «لماذا الآن؟».

| الخدمة | المسار | الغرض | الحالة |
|---|---|---|---|
| matching | `services/matching/` | إسقاط الترشيح · الفلاتر الصلبة · الترتيب الموزون بنسخة قواعد مُقفَلة · سجل قرارات المطابقة | **مجال + استمرارية + HTTP على 8088 (MR 5b/6 · Phase 07)** — [نموذج المجال](../03-domain/MATCHING_DISPATCH.md) · [العقود](../../services/matching/contracts/README.md) · [الاستمرارية](MATCHING_PERSISTENCE.md) · [طبقة HTTP](../04-api/MATCHING_HTTP.md) |
| dispatch | `services/dispatch/` | مهمّة التوزيع · الأمواج · العروض ومهلها · النبضة · التصعيد إلى المجتمع | **مجال + استمرارية + HTTP على 8089 (MR 5b/6 · Phase 07)** — [نموذج المجال](../03-domain/MATCHING_DISPATCH.md) · [العقود](../../services/dispatch/contracts/README.md) · [الاستمرارية](DISPATCH_PERSISTENCE.md) · [طبقة HTTP](../04-api/DISPATCH_HTTP.md) |

المنافذ: **matching = 8088** · **dispatch = 8089** (بعد `orders` = 8087 و`customers` = 8086). الرقمان لم يبقيا في الوثيقة وحدها: منذ MR 5b/6 هما ثابتان مُصدَّران من حزمتي العقود (`MATCHING_SERVICE_PORT` و`DISPATCH_SERVICE_PORT`)، فيقرأهما المستهلك من العقد لا من رقم منسوخ باليد.

اتجاه الاعتماد أحادي وملزم، ولا يُعكَس:

```text
dispatch  → matching   (طلب مرشّحين مرتّبين — عبر منفذ HTTP)
dispatch  → orders     (تسجيل عرض · حسم عرض · تحريك الحالة — عبر منفذ HTTP لا جدول)
matching  → geography  (تحقّق المنطقة وهرمها — عبر منفذ)
orders    ↛ dispatch   (المحرّك لا يعرف أنّ التوزيع موجود)
matching  ↛ dispatch   (المطابقة لا تعرف أنّ عرضاً أُرسل)
```

**ما لا تعرفه المطابقة:** العرض والموجة والمهلة، ولا تكتب في محرّك الطلبات شيئاً أبداً. **وما لا تعرفه التوزيع:** الترتيب والأوزان والأهلية — يطلب المرشّحين ولا يُعيد حسابهم.

**ثلاثة حدود يفرضها حارس اختبار لا مراجعة بشرية:**

- **مرجع السائق opaque بلا FK** (`^WS-[0-9]{10}$`): Phase 05 (Driver Core) لم تبدأ وهي خارج المسار الحرج، فالأهلية **مُدّعاة** ومصدر الادّعاء مخزّن مع الصفّ (`eligibility_source`)، والمجهول ليس مرشّحاً (fail-closed).
- **الزمن نبضة لا مؤقّت**: لا حلقة خلفية ولا `setTimeout`؛ كل استحقاق مكتوب في القاعدة و`POST /dispatch/tick` هو الموضع المُعلَن الوحيد لتقديمه. لذلك `/health` عند التوزيع يُعلن `last_tick_at`.
- **الخصوصية**: `zone_id` لا إحداثيات (ADR-006) · أكواد لا نصّاً حرّاً · لا `chat_id` (ADR-007) · **ولا مُعرّفات مرشّحين ولا درجاتهم في أي حدث** (ADR-011 القرار 8) — تُقرأ من سجل التدقيق فقط.

الأنواع المُكتبة في `packages/contracts/matching/` (`@wasla/contracts-matching`) و`packages/contracts/dispatch/` (`@wasla/contracts-dispatch`).

### 4.4 خدمة Driver Core — Phase 05

خدمة **موجودة في الشجرة الأصلية** أعلاه (`drivers`)، فلا انحراف في الموضع: [ADR-012](../15-decisions/ADR-012-driver-core-eligibility-derivation-and-candidacy-publication.md) يُثبّت **حدودها** وسببَ كونها مصدر الأهليّة لا مالكها المخزَّن. القاعدة الحاكمة: **الأهليّة دالّة مُشتقّة لا عمود** — لا يوجد في مخطّط هذه الخدمة عمود `eligibility_state`، وحارس اختبار يمنع عودته.

| الخدمة | المسار | الغرض | الحالة |
|---|---|---|---|
| drivers | `services/drivers/` | ملفّ دور السائق · المركبات · الوثائق ومراجعتها · مناطق الخدمة · التوافر المُعلَن · **الأهليّة المُشتقّة** ونشرها إلى إسقاط الترشيح · الإيقاف والإرجاع | **عقود كنسية فقط (MR 1/6 · Phase 05)** — [نموذج المجال](../03-domain/DRIVER_CORE.md) · [العقود](../../services/drivers/contracts/README.md) |

المنفذ: **drivers = 8090** (بعد `dispatch` = 8089). والرقم لا يبقى في الوثيقة وحدها: هو ثابت مُصدَّر من حزمة العقد (`DRIVER_SERVICE_PORT`)، فيقرأه المستهلك من العقد لا من رقم منسوخ باليد — درس MR 5b/6 من الطور 07.

اتجاه الاعتماد أحادي وملزم، ولا يُعكَس:

```text
drivers   → matching    (نشر إسقاط الترشيح — عبر منفذ HTTP لا جدول)
drivers   → geography    (تحقّق المنطقة وهرمها — عبر منفذ)
drivers   → identity     (وجود المستخدم — مرجع opaque بلا FK)
matching  ↛ drivers      (المطابقة لا تنادي نواة السائق ولا تعرف أنّها موجودة)
dispatch  ↛ drivers      (التوزيع يكتب `busy` في الترشيح لا في ملفّ السائق)
```

**ما لا تعرفه نواة السائق:** من يُختار لطلب وبأي ترتيب، وحالة الطلب، والعرض والموجة والمهلة. **وما لا تملكه:** `busy` — توافرٌ يُشتقّ من التزام جارٍ يملكه التوزيع؛ السائق يُعلن `available` أو `offline` فقط.

**خمسة حدود يفرضها حارس اختبار لا مراجعة بشرية:**

- **لا عمود أهليّة**: `eligibility_state` و`is_eligible` ممنوعان في `driver_profiles`؛ والحالة تُحسب من الملفّ والمركبة والوثائق والمناطق مقابل **نسخة سياسة مُقفَلة** (سابقة `matching_rulesets`).
- **لا حالة غير مؤهَّلة بلا سبب**: `ck_eligibility_log_reasons` في القاعدة، وكتالوج أسباب مُقفَل مُطابَق حرفياً بين `errors.md` و`events.json` وحزمة العقد.
- **لا كتابة في قاعدة المطابقة**: النشر عبر `PUT /candidacy/{driverPublicId}` بقيمتَي `driver_core` التي انتظرها عقد المطابقة منذ الطور 07، فيُغلق الحدّ **بلا هجرة في الخدمة المجاورة**؛ وكل محاولة تُسجَّل في `driver_candidacy_publications` لأنّ فشل النشر الصامت يعني سائقاً مؤهَّلاً لا يراه أحد ولا يشتكي منه أحد.
- **الزمن نبضة لا مؤقّت**: لا حالة `expired` على وثيقة؛ الانتهاء بيانٌ يُقارَن بساعة مُحقونة، و`eligibility_recheck_at` هو فهرس `POST /drivers/eligibility/tick`. لذلك `/health` يُعلن `last_tick_at`.
- **الخصوصية**: `zone_id` لا إحداثيات (ADR-006) · أكواد لا نصّاً حرّاً · لا `chat_id` (ADR-007) · **ولا لوحة مركبة ولا `storage_ref` ولا رقم هوية في أي حدث** (ADR-012 القرار 8) — اللوحة تُخزَّن للمراجعة الإدارية ولا تعبر حدّ الخدمة أبداً.

**وما لا يوجد في هذه الخدمة بقرار** (ADR-012 القرار 7): لا `subscription_status` ولا تقييم ولا سمعة ولا حساب بنكي — لا عموداً ولا مساراً ولو معطّلاً، لأنّ عموداً يُضاف قبل مالكه يُملأ بقيَم يخترعها من لا يملك القرار. مالكوها: Phase 10 (الاشتراك) · Phase 09 (السمعة).

الأنواع المُكتبة في `packages/contracts/driver/` (`@wasla/contracts-driver`).

### 4.5 خدمة Negotiation & Chat — Phase 08

خدمة **موجودة في الشجرة الأصلية** أعلاه (`chat`)، وتُسمّى هنا `negotiations` لأنّ المحادثة وسيلةٌ فيها والتفاوض غرضُها — فلا انحراف في الموضع: [ADR-013](../15-decisions/ADR-013-negotiation-chat-agreement-boundary-and-tick-driven-expiry.md) يُثبّت **حدودها**. القاعدة الحاكمة: **يملك التفاوض «بكم اتّفقنا» ولا يكتب السعر في `orders`**.

| الخدمة | المسار | الغرض | الحالة |
|---|---|---|---|
| negotiations | `services/negotiations/` | خيط تفاوض ثنائي · الأدوار المُرقّمة ومهلها · الرسائل وتنقيحها · **الاتفاق وتسليم سعره** إلى محرّك الطلب · السياسة المُرقّمة المجمّدة · النبضة | **عقود كنسية فقط (MR 1/6 · Phase 08)** — [نموذج المجال](../03-domain/NEGOTIATION_CHAT.md) · [العقود](../../services/negotiations/contracts/README.md) |

المنفذ: **negotiations = 8091** (بعد `drivers` = 8090)، وهو ثابت مُصدّر من حزمة العقد (`NEGOTIATION_SERVICE_PORT`) لا رقماً منسوخاً باليد — درس MR 5b/6 من الطور 07، وحارسُ اختبار يمنع انتزاع منفذٍ خصّصه طورٌ سابق.

اتجاه الاعتماد أحادي وملزم، ولا يُعكس:

```text
negotiations → orders     (AgreedPricePort — نداءٌ صادر واحد، ولا قراءة لقاعدته ولا FK)
negotiations → dispatch   (DispatchOfferPort — هل العرض قائم؟ مرجع opaque)
orders       ↛ negotiations  (محرّك الطلب لا ينادي التفاوض ولا يعرف أنّه موجود)
dispatch     ↛ negotiations  (التوزيع يعرض، ولا يعرف أنّ حواراً جرى)
drivers      ↛ negotiations  (نواة السائق لا تُقرأ هنا: العرض القائم هو الدليل أنّ السائق كان مؤهّلاً حين عُرض)
```

**ما لا يعرفه التفاوض:** حالة الطلب وآلته، وأهليّة السائق، وهويّة الشخص واسمه، وقناة التوصيل. **وما لا يملكه:** عمود السعر في `orders` — المبلغ يُسلّم عبر `AgreedPricePort` ومحرّك الطلب وحده يسجّله.

**ستة حدود يفرضها حارس اختبار لا مراجعة بشرية** (70 اختباراً تقرأ العقود **من القرص** لا نسخةً منها في الكود):

- **لا كتابة في `orders`**: لا `REFERENCES orders`، ولا عمود يعكس حالة الطلب، ولا مسارٌ يكتبه. وفشلُ التسليم **لا يُبطل الاتفاق**: لا `502` ولا صنف `bad_gateway` في كتالوج الأخطاء أصلاً (سابقة حذف `DRIVER_CANDIDACY_PUBLISH_FAILED` في الطور 05).
- **الاتفاق قبولٌ لدورٍ مُرقّم**: `expected_round_no` حارسٌ تفاؤلي، ومن اقترح لا يقبل (`ck_negotiation_rounds_no_self_resolution` في القاعدة لا في الكود وحده)، ودورٌ معلّق واحد ومقبولٌ واحد لكل خيط.
- **خيطٌ ثنائي لا مزاد**: خيطٌ واحد لكل (طلب × سائق) ولكل عرض توزيع، **ولا قائمة أطراف في المخطّط** — وذاك ما يمنع المزاد لا حسنُ النيّة.
- **المال أعداد صحيحة بوحدة صغرى**: لا `NUMERIC` ولا عائم، وكل عمود مبلغ ينتهي بـ`_minor`، وعملةٌ صريحة بجانب كل مبلغ، والحدود من **سياسة مُرقّمة مجمّدة** لا من أرقام في الكود.
- **الزمن نبضة لا مؤقّت**: لا `is_expired` مخزّن؛ `expires_at` بيانٌ و`next_tick_at` فهرس `POST /negotiations/tick`. **والانتهاء يُقاس أيضاً عند كل فعل**: من اعتمد على النبضة وحدها فتح نافذةً يُشترى فيها سعرٌ انتهى.
- **الخصوصية**: `body` في `negotiation_messages` وحدها، **ولا تعبر حدّ الخدمة ولا حدثاً** — `body_length` عددٌ لا نصّ (سابقة `shipment_description` في ADR-009 §7)، ولا ترجمة مخزّنة (`source_locale` وحده)، ولا `chat_id` (ADR-007).

**وما لا يوجد في هذه الخدمة بقرار** (ADR-013 القرار 8): لا دفع ولا تسوية ولا عمولة · ولا سمعة ولا عدّاد سلوك · ولا محرّك تسعير يقترح مبلغاً · ولا مرفقات — لا عموداً ولا مساراً ولو معطّلاً. مالكوها: Phase 19 (الدفع) · Phase 09 (السمعة والاحتيال) · ومحرّك التسعير **بلا مالك بعد**.

**الدَين المُعلَن:** `orders` لا يملك عمود سعرٍ متّفق عليه بعد، فشقّ «وتسجيله في Order» من بوابة الخروج يقتضي ترحيلاً يكسب **محرّك الطلب** أربعة أعمدة في MR لاحق من هذا الطور ([التفصيل](../03-domain/NEGOTIATION_CHAT.md#8-الدَّين-المُعلَن-بوابة-الخروج)).

الأنواع المُكتبة في `packages/contracts/negotiation/` (`@wasla/contracts-negotiation`).

---

### 4.6 خدمة Reputation & Fraud — Phase 09

خدمة **موجودة في الشجرة الأصلية** أعلاه (`reputation`)، و[ADR-014](../15-decisions/ADR-014-reputation-derived-scores-and-fact-sourced-fraud-signals.md) يُثبّت حدودها. القاعدة الحاكمة: **السمعة نتيجةٌ مُشتقّة من وقائع مسجّلة، والاحتيال إشاراتٌ مُسمّاة لا حُكم، والخدمة لا تعاقب أحداً**.

| الخدمة | المسار | الغرض | الحالة |
|---|---|---|---|
| reputation | `services/reputation/` | دفترُ الوقائع append-only · النتيجةُ والرتبةُ المُشتقّتان · التقييمُ المقيَّد بواقعة · **قواعدُ الاحتيال وإشاراتها** · نسخةُ القواعد المجمّدة · النبضة | **عقود كنسية (MR 1/6) + طبقة مجالٍ نقيّة (MR 2/6) + استمراريّة Postgres ووحدةُ عملٍ ومطابقةُ مُهيئَين (MR 3/6) · Phase 09** — [REPUTATION_PERSISTENCE.md](REPUTATION_PERSISTENCE.md) — **لا HTTP بعد (4/6)** — [نموذج المجال](../03-domain/REPUTATION_FRAUD.md) · [العقود](../../services/reputation/contracts/README.md) · [نواة المجال](REPUTATION_CORE_DOMAIN.md) |

**انحرافٌ موثّق في العدد لا في الموضع:** `services/fraud/` تبقى **فارغة بقرار** ([ADR-014](../15-decisions/ADR-014-reputation-derived-scores-and-fact-sourced-fraud-signals.md) القرار 1) — قواعدُ الاحتيال تقرأ **نفس دفتر الوقائع**، وخدمةٌ ثانية تعني نسخةً ثانية من الوقائع تتباعد بصمت. والانحراف مُعلَنٌ في `README` العقود وفي حارس اختبار، لا مكتوماً في الكود.

المنفذ: **reputation = 8092** (بعد `negotiations` = 8091)، وهو ثابت مُصدّر من حزمة العقد (`REPUTATION_SERVICE_PORT`) لا رقماً منسوخاً باليد، وحارسُ اختبار يمنع انتزاع منفذٍ خصّصه طورٌ سابق.

اتجاه الاعتماد أحادي وملزم، ولا يُعكس:

```text
orders     → reputation   (حدثان منشوران: order.status_changed · order.assignment_resolved)
reputation ↛ orders       (لا نداءَ صادر ولا قراءةَ قاعدة ولا FK ولا استطلاع)
reputation ↛ drivers      (لا إيقاف ولا تعليقَ أهليّة: تلك ملكُ services/drivers — ADR-012 القرار 3)
reputation ↛ dispatch     (لا ترتيبَ مرشّحين هنا: المطابقة تقرأ الحدث وتقرّر في خدمتها)
```

**ما لا تعرفه السمعة:** آلةَ حالة الطلب، وأهليّةَ السائق وشروطها، والعرضَ والموجة، والمبلغَ والعملة، وهويّةَ الشخص، وقناةَ التوصيل. **وما لا تملكه:** أيَّ قرارٍ على أحد — تُعلن حقائق ويبني عليها غيرُها في خدمته ويملك أثره.

**سبعة حدود يفرضها حارس اختبار لا مراجعة بشرية** (81 اختباراً تقرأ العقود **من القرص** لا نسخةً منها في الكود):

- **الواقعة تُخزَّن والنقطة تُشتقّ**: لا مسار ولا عمود يضبط نقاطاً يدوياً (`setScore` · `adjustScore` · `setTier` ممنوعة بحارس سالب)، وحذفُ جدول النتائج بالكامل عملٌ بلا خسارة لأنّ `recompute` يُعيده من الدفتر.
- **مصدرُ الحقيقة حدثٌ منشور**: كل واقعةٍ تحمل `source_event_id` و`source_sequence`، والتسليم at-least-once فالتفرّد **قيدٌ في القاعدة** (`ux_reputation_facts_source`) لا فحصٌ في الكود؛ وإعادةُ التسليم نفسها تُجيب `200` بـ`duplicate:true` لا `409`.
- **الأرقام بياناتٌ لا كود**: الأوزان والعتبات والنوافذ في نسخةٍ **مجمّدة مُرقّمة** (`saudi-launch-v1`)، وكل نتيجةٍ وتقييمٍ وإشارةٍ تحمل `ruleset_version`، ولا `NUMERIC` ولا عائم في المخطّط.
- **الخدمة لا تعاقب**: لا مسارَ إيقافٍ أو حجب، ولا عمود `is_suspended` أو `is_fraudster`، ولا رمزَ خطأٍ عقابيّ في الكتالوج، ولا حدثَ `reputation.subject_suspended` — الإيقاف ملكُ `services/drivers` والقرار الإداريّ ملكُ Phase 15.
- **التقييم درجةٌ ورمزُ سبب**: لا عمود نصٍّ حرّ في `reputation_ratings` أصلاً (سابقة `shipment_description` في ADR-009 §7)، ولا تقييمَ ذاتيّاً (`ck_reputation_ratings_no_self`)، ولا من نفس الجانب (`ck_reputation_ratings_cross_side`)، وضمن نافذةٍ تُغلق.
- **الإشارة ملاحظةٌ لا حُكم**: قاعدةٌ مُسمّاة بعتبةٍ مُعلَنة ونافذةٍ محدّدة، بلا عمود `state` وبلا احتمالٍ إحصائيّ (`probability` · `confidence` · `model_version` ممنوعة بحارس سالب)، وإشارةٌ واحدة لكل (قاعدة × شخص × نافذة) فالنبضةُ تُعاد ولا تُكرّرها.
- **الزمن نبضة لا مؤقّت**: `POST /reputation/tick` وحده يُحرّك التلاشي وإعادةَ الحساب المستحقّة وتقييمَ النوافذ؛ والاستحقاق مُخزَّن ومفهرس (`ix_reputation_scores_recompute_due`)، والتلاشي حسابٌ مسجَّل لا دالّةَ قراءةٍ تُعطي جوابين في دقيقتين.

**وما لا يوجد في هذه الخدمة بقرار** (ADR-014 القرار 7 · 9): لا إيقاف ولا حجب ولا عقوبة · ولا اشتراكات ولا مكافآت · ولا تسعيرٌ يعتمد النقاط · ولا تعليقٌ نصّي ولا بلاغٌ ولا تنقيح · ولا بيانات شخصية ولا مُعرّف قناة — لا عموداً ولا مساراً ولو معطّلاً. مالكوها: Phase 15 (القرار الإداريّ) · Phase 10 (الاشتراكات) · Phase 16 (البلاغ والتنقيح) · Phase 19 (الدفع).

**الدَين المُعلَن:** ناشرُ `reputation_outbox` (نفس دَين الأطوار 06 · 07 · 08) · مستهلكُ أحداث الطلب في MR 5/6 من هذا الطور ([التفصيل](../03-domain/REPUTATION_FRAUD.md#8-الدَّين-المُعلَن)).

الأنواع المُكتبة في `packages/contracts/reputation/` (`@wasla/contracts-reputation`).

---

## 5. Packages (المكتبات المشتركة)

| الحزمة | المسار | الغرض |
|---|---|---|
| contracts | `packages/contracts/` | API/Event/Data/Error contracts (Contract First) — حزمة لكل مجال: `identity` · `geography` · `channel` (§5.1) · `customer` (§4.1) · `order` (§4.2) · `matching` و`dispatch` (§4.3) · `driver` (§4.4) · `negotiation` (§4.5) · `reputation` (§4.6) |
| events | `packages/events/` | Event schema registry، Outbox helpers |
| ui | `packages/ui/` | مكتبة واجهات مشتركة (Mini Apps) |
| i18n | `packages/i18n/` | العربية/الإنجليزية/الأردية + مستقبلًا التركية/الفارسية |
| auth-sdk | `packages/auth-sdk/` | SDK المصادقة للعملاء |
| telemetry | `packages/telemetry/` | OpenTelemetry helpers، request_id/trace_id |
| errors | `packages/errors/` | Error format موحد عبر الخدمات |
| config | `packages/config/` | Configuration management + validation |
| date-time | `packages/date-time/` | معالجة التوقيت والمناطق الزمنية |
| test-utils | `packages/test-utils/` | أدوات الاختبار المشتركة (Contract tests) |

### 5.1 طبقة القنوات (Channel Layer) — Phase 03

أُضيفت بقرار [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md). القناة **ليست خدمة** (لا تُضاف خدمة 25 إلى [SERVICES.md](../01-product/SERVICES.md)) بل طبقة توصيل مشتركة:

| الحزمة | المسار | الغرض |
|---|---|---|
| channel-core | `packages/channel-core/` | نموذج مجال محايد للقناة + المنافذ **العشرة** (Ports) + حالات الاستخدام (استقبال · منع تكرار · تسليم · إعادة محاولة · Deep Link · Mini App · نطاق المحادثة ودور المجموعة) + مُهيّئات in-memory/Mock. **صفر معرفة بـTelegram** — **مُنفَّذة (MR 2، والمنفذ العاشر `GroupRegistryPort` في MR 6 · [تفصيل](CHANNEL_LAYER_CORE.md) · [المجموعات](CHANNEL_GROUPS.md))** |
| telegram-adapter | `packages/telegram-adapter/` | **المكان الوحيد** الذي يعرف Telegram Bot API: تفسير Update · إرسال · أزرار `web_app` · تخطيط الأخطاء · ميزانية المعدّل · التحقّق من رمز الـwebhook. يُنفّذ `ChannelPort` + `UpdateParserPort` فقط — **مُنفَّذ (MR 3 · [تفصيل](CHANNEL_TELEGRAM_ADAPTER.md))** |
| bot-runtime | `packages/bot-runtime/` | ما تتشاركه البوتات الثلاثة: سطح HTTP لعقد القناة على Fastify · قراءة التهيئة من البيئة والفشل السريع · `SingleBotRegistry` (بوت واحد ⇄ Mini App واحدة) · مُهيّئ الهوية عبر HTTP · ساعة ومعرّفات الإنتاج · **التركيب** (المكان الوحيد الذي يسمّي مُهيّئاً ملموساً). **لا حالة استخدام فيها** — **مُنفَّذة (MR 4 · [تفصيل](CHANNEL_BOTS.md))** |
| channel-postgres | `packages/channel-postgres/` | مُهيّئات Postgres للمنافذ الثلاثة (`channel_updates` · `channel_deliveries` · `channel_outbox`) عبر Drizzle + `pg`، و`createChannelStores` هو الحدّ الذي يستهلكه جذر التركيب. حزمة مستقلّة لأن حراسة `channel-core` تقفل اعتمادياتها — **مُنفَّذة (MR 5 · [تفصيل](CHANNEL_PERSISTENCE.md))** |
| channel-e2e | `packages/channel-e2e/` | **حزمة اختبار فقط بلا تصدير** — مجموعة بوابة خروج المرحلة: تبني البوتات الثلاثة في عملية واحدة أمام خدمة هوية تستمع فعلياً على HTTP ومخازن مشتركة. حزمة مستقلّة لأنها الموضع الوحيد المسموح فيه استيراد **جذور التركيب الثلاثة** معاً؛ وضعها في `bot-runtime` أو `channel-postgres` يخلق دورة اعتماد — **مُنفَّذة (MR 7 · [تفصيل](../12-testing/PHASE03_EXIT_GATE_E2E.md))** |
| contracts-channel | `packages/contracts/channel/` | الأنواع المُكتبة المُولّدة من عقد القناة (`packages/channel-core/contracts/`) — **مُنفَّذة (MR 1)** |

اتجاه الاعتماد أحادي وملزم: `bots/*` → `bot-runtime` → `telegram-adapter` → `channel-core`، و`bot-runtime` → `channel-postgres` → `channel-core` (النواة لا تعرف أيّاً منهما). و`channel-e2e` تقع **خارج** هذا الاتجاه لا فوقه: لا يستوردها أي كود إنتاجي وكل اعتمادياتها `devDependencies`، فلا تُدخل حافة جديدة في الرسم. سلسلة الإرسال: `NotificationService → Channel Router → ChannelPort → TelegramChannelAdapter` — **يُمنع** على أي خدمة Core نداء واجهة Telegram مباشرة.

---

## 6. Data Stores (مخازن البيانات والبنية التحتية)

### 6.1 Data Architecture

| المخزن | الدور |
|---|---|
| **PostgreSQL** | مصدر الحقيقة (Source of truth) |
| **Redis** | Real-time state |
| **Search Index** | بحث مستقل قابل لإعادة البناء |
| **S3-compatible Object Storage** | Media / المستندات |
| **Warehouse / OLAP** | Analytics عند الحاجة |
| **Kafka (مستقبلي)** | Events عند ارتفاع Event Scale؛ يُبنى Domain Events + Outbox من البداية |

### 6.2 قاعدة البيانات (PostgreSQL)

في Modular Monolith: PostgreSQL واحد مع Logical Schemas/Bounded Contexts:

```text
auth, identity, geo, orders, dispatch, matching, drivers, subscriptions,
reputation, fraud, referrals, marketplace, stores, catalog, inventory,
search, chat, notifications, support, partners, billing, compliance, audit
```

> بعد استخراج الخدمات، لا تسمح خدمة أن تقرأ جداول خدمة أخرى مباشرة.

### 6.3 Event Bus + Outbox

- يُبنى **Domain Events** و**Outbox Pattern** من البداية بحيث يمكن إدخال Kafka دون إعادة تصميم المجال.
- **Idempotency** إلزامية لكل Event handler.
- كل تغيير حالة في Order Engine يجب أن يكون Event + Audit Record.

### 6.4 Queue Strategy

لا نستخدم HTTP request لمعالجة عمل طويل. أمثلة على ما يُعالج عبر Queue:

```text
Bulk Notifications
Search Indexing
Image Processing
Document Processing
Referral Evaluation
Reputation Recalculation
Analytics Events
Webhook Retry
```

### 6.5 Object Storage

كل `MediaAsset` يملك:

```text
id
owner_id
purpose
mime_type
size
storage_key
checksum
created_at
retention_policy
```

> المستندات الحساسة لا تستخدم public URLs مباشرة — Signed URLs + Access audit.

---

## 7. Infra (البنية التحتية)

| المكون | المسار | الغرض |
|---|---|---|
| terraform | `infra/terraform/` | Infrastructure as Code |
| docker | `infra/docker/` | حاويات التطوير المحلي |
| kubernetes | `infra/kubernetes/` | التشغيل (عند الحاجة — انظر SCALING.md) |
| environments | `infra/environments/` | dev / staging / production |

---

## 8. ملكية الحاويات

ملكية كل حاوية محددة في [`/CODEOWNERS`](../../CODEOWNERS). الأصول المشتركة (`packages/`, `services/` مشتركة) تستلزم موافقة المالك المرتبط + مراجعة عبر الفرق.

---

## 9. الروابط ذات الصلة

- [SYSTEM_CONTEXT.md](SYSTEM_CONTEXT.md) — السياق المعماري
- [SCALING.md](SCALING.md) — مسار التوسع (متى نضيف Kafka/Kubernetes/Microservice)
- [/docs/01-product/SERVICES.md](../01-product/SERVICES.md) — تفاصيل الخدمات الـ24
- [/docs/06-database/](../06-database/) — ERD + migrations + retention + indexing
