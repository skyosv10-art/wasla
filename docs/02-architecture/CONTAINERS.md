# CONTAINERS — الحاويات والخدمات

> **Scope:** الحاويات/المكونات الرئيسية في WASLA: Bots، Apps، Services، Packages، Data stores.
>
> **المرجع الأم:** أقسام 37 (Data Architecture) و38 (قاعدة البيانات) و41 (Event Bus) و142 (Queue Strategy) و143 (Object Storage) من الدليل التنفيذي.
>
> **Last Updated:** 2026-08-21 · **Status:** Baseline v1.0 (+ خدمة Customer Core §4.1 — Phase 04: العقود والأنواع المُكتبة مُنفَّذة) (+ خدمة Order Engine §4.2 — Phase 06: العقود والأنواع المُكتبة وجدول الانتقالات موثّقة) (+ طبقة القنوات §5.1 — Phase 03: نواة channel-core ومُهيّئ telegram-adapter وطبقة تشغيل البوتات `bot-runtime` مع البوتات الثلاثة ومُهيّئات `channel-postgres` ودعم المجموعات مُنفَّذة) · **Related Team:** Team 09 (Data) · Team 10 (DevOps) · Team 12 (Integration)

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

---

## 5. Packages (المكتبات المشتركة)

| الحزمة | المسار | الغرض |
|---|---|---|
| contracts | `packages/contracts/` | API/Event/Data/Error contracts (Contract First) — حزمة لكل مجال: `identity` · `geography` · `channel` (§5.1) · `customer` (§4.1) · `order` (§4.2) |
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
