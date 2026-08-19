# CONTAINERS — الحاويات والخدمات

> **Scope:** الحاويات/المكونات الرئيسية في WASLA: Bots، Apps، Services، Packages، Data stores.
>
> **المرجع الأم:** أقسام 37 (Data Architecture) و38 (قاعدة البيانات) و41 (Event Bus) و142 (Queue Strategy) و143 (Object Storage) من الدليل التنفيذي.
>
> **Last Updated:** 2026-08-19 · **Status:** Baseline v1.0 · **Related Team:** Team 09 (Data) · Team 10 (DevOps) · Team 12 (Integration)

---

## 1. نظرة عامة على الحاويات

WASLA Monorepo يحتوي على خمس فئات من الحاويات/المكونات:

```text
1. Bots        — بوتات Telegram (3)
2. Apps        — تطبيقات الواجهة (Mini Apps + Admin Web)
3. Services    — 24 خدمة (Bounded Contexts)
4. Packages    — مكتبات مشتركة (9)
5. Data Stores — مخازن البيانات والبنية التحتية
```

---

## 2. Bots (بوتات Telegram)

| الحاوية | المسار | المسؤولية |
|---|---|---|
| Customer Bot | `bots/customer-bot/` | Start، Identity bootstrap، فتح Customer Mini App، Notifications، Links، Deep Links، حالات قصيرة سريعة |
| Driver Bot | `bots/driver-bot/` | التسجيل، رفع المستندات، الاشتراك، فتح Driver Mini App، الطلبات العاجلة، حالة العمل، Community Group، إشعارات الطلبات |
| Partner Bot | `bots/partner-bot/` | تسجيل الشريك، فتح Partner Mini App، إدارة الطلبات، الإشعارات المهمة، Store/Business entry |

> لا يوجد Admin Bot كقناة أساسية — الإدارة عبر Web Admin Portal.

كل البوتات تمر عبر **Telegram Adapter** الذي يملك: Update Intake، Identity Linking، Message Delivery، Mini App Launch، Deep Links، Group Adapter، Bot Rate/Retry Control، Telegram Error Mapping.

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

---

## 5. Packages (المكتبات المشتركة)

| الحزمة | المسار | الغرض |
|---|---|---|
| contracts | `packages/contracts/` | API/Event/Data/Error contracts (Contract First) |
| events | `packages/events/` | Event schema registry، Outbox helpers |
| ui | `packages/ui/` | مكتبة واجهات مشتركة (Mini Apps) |
| i18n | `packages/i18n/` | العربية/الإنجليزية/الأردية + مستقبلًا التركية/الفارسية |
| auth-sdk | `packages/auth-sdk/` | SDK المصادقة للعملاء |
| telemetry | `packages/telemetry/` | OpenTelemetry helpers، request_id/trace_id |
| errors | `packages/errors/` | Error format موحد عبر الخدمات |
| config | `packages/config/` | Configuration management + validation |
| date-time | `packages/date-time/` | معالجة التوقيت والمناطق الزمنية |
| test-utils | `packages/test-utils/` | أدوات الاختبار المشتركة (Contract tests) |

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
