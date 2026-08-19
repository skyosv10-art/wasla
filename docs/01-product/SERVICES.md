# SERVICES — قائمة الخدمات الـ24

> **Scope:** قائمة الخدمات (Bounded Contexts) في مستودع WASLA مع وصف موجز ومسؤوليات كل خدمة.
>
> **المرجع الأم:** القسم 68 (Repository Structure) وأقسام الخدمات الفردية من الدليل التنفيذي.
>
> **Last Updated:** 2026-08-19 · **Status:** Baseline v1.0 · **Related Team:** حسب ملكية كل خدمة في [CODEOWNERS](../../CODEOWNERS)

---

## نظرة عامة

المستودع Monorepo يحتوي على **24 خدمة** تحت `services/`. كل خدمة تمثل Bounded Context مستقل منطقيًا. في البداية تعمل كـModular Monolith على PostgreSQL واحد مع Logical Schemas، وقابلية للاستخراج لاحقًا إلى Microservices عند وجود سبب واضح (انظر [`SCALING.md`](../02-architecture/SCALING.md)).

> **قاعدة:** بعد استخراج الخدمات، لا تسمح خدمة أن تقرأ جداول خدمة أخرى مباشرة — الاتصال عبر Contracts فقط.

---

## جدول الخدمات

| # | الخدمة | الفريق المالك | الوصف المختصر |
|---|---|---|---|
| 1 | `identity` | Team 01 | هوية المستخدم، Wasla Public ID، Identity Links، Identity History، Recovery |
| 2 | `auth` | Team 01 | Session/token strategy، RBAC/permission primitives، Phone normalization/verification |
| 3 | `geography` | Team 01/02/03 | التسلسل الجغرافي: Country → Region → City → District → Zone، أسماء متعددة اللغات |
| 4 | `orders` | Team 02/05 | Order Engine الموحد: state machine، Order IDs، Cancellation states، Audit، Idempotency، Outbox |
| 5 | `rides` | Team 05 | Ride Orders ضمن Order Engine (Mobility) |
| 6 | `delivery` | Team 05 | Delivery Orders ضمن Order Engine (طرود، طعام، شحنات، Multi-stop) |
| 7 | `matching` | Team 04 | Candidate search، Hard constraints، Ranking، Fairness، Reputation inputs، ETA، Eligibility |
| 8 | `dispatch` | Team 05 | DispatchJob، Offer waves، Timeouts، Assignment، Reassignment، Community fallback، Duplicate prevention |
| 9 | `drivers` | Team 03 | Driver Profile، الوثائق، المركبة، الحالة، Work City/District/Zone، Community mode |
| 10 | `subscriptions` | Team 03 | اشتراك السائق: 250/250/400 SAR، Trial، States (TRIAL/ACTIVE/GRACE/EXPIRED/COMMUNITY/SUSPENDED/CANCELLED) |
| 11 | `reputation` | Team 04/05/11 | Reputation Engine: Profile، Events، Ratings، Score، Status labels، Recoverable |
| 12 | `fraud` | Team 11/04/05 | Fraud & Trust Engine: إشارات احتيال، Moderation cases، Trust signals |
| 13 | `referrals` | Team 03/01 | Referral Engine: كود إحالة، Attribution، Qualified referral، Rewards، Anti-abuse |
| 14 | `marketplace` | Team 06 | Store، Catalog، Product، Inventory، Store Staff، Store billing contracts |
| 15 | `search` | Team 06 | Search Engine: بحث متعدد اللغات، Store/Product/Geo search، Ranking، Index rebuild |
| 16 | `chat` | Team 12 | Conversation، Message، Countdown، Negotiation state، Price agreement، Closing conversation |
| 17 | `translation` | Team 12 | Translation provider abstraction (للـChat والمحتوى متعدد اللغات) |
| 18 | `notifications` | Team 12 | Notification Engine: Template، Channel، Priority، Audience، Retry، Deduplication، Delivery status |
| 19 | `support` | Team 08/11 | Ticketing، Support/Escalation groups integration، Order context، Evidence، Audit |
| 20 | `partners` | Team 07 | Partner onboarding، Enterprise، Partner API، Webhooks، B2B SLA، Fleet، Contract pricing |
| 21 | `billing` | Team 12/09 | Invoice Domain، Subscription billing، Tap، Store fixed/variable fee، منفصل عن Trip Settlement |
| 22 | `compliance` | Team 12 | Compliance Policy لكل دولة، KYC adapters، قواعد الامتثال |
| 23 | `audit` | Team 09 | Audit trail لكل عملية حساسة، Audit integrity، لا حذف للأثر |
| 24 | `analytics` | Team 09 | Analytics، Warehouse/OLAP، Reporting foundations، KPIs (Fill Rate، ETA Accuracy، ...) |

---

## تفاصيل إضافية

### Order Engine (`orders`)

Order Engine موحد في البداية، لكن Domain Model يدعم:

```text
Order
 ├── Ride Order
 ├── Delivery Order
 ├── Store Delivery Order
 ├── Partner Order
 └── Future Order Types
```

دورة حياة الطلب (Order lifecycle):

```text
DRAFT → PUBLISHED → SEARCHING → OFFERED → NEGOTIATING (optional) → ACCEPTED → ASSIGNED → DRIVER_EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED
```

حالات جانبية: `EXPIRED`, `NO_DRIVER_FOUND`, `DRIVER_REJECTED`, `DRIVER_TIMEOUT`, `DRIVER_CANCELLED`, `CUSTOMER_CANCELLED`, `PARTNER_CANCELLED`, `PAYMENT_DISPUTED`, `FAILED`, `BLOCKED`, `UNDER_REVIEW`.

> كل تغيير حالة يجب أن يكون Event + Audit Record.

### Matching vs Dispatch

- **Matching** يجيب: من المرشحون؟ (Candidate search, Hard constraints, Ranking, Fairness, ETA, Eligibility)
- **Dispatch** يجيب: من يستلم العرض؟ متى؟ ماذا يحدث عند الرفض أو الانتهاء؟ (Offer waves, Timeouts, Assignment, Reassignment)
- **Assignment** هو السجل النهائي: `order_id`, `driver_id`, `offered_at`, `accepted_at`, `rejected_at`, `expired_at`, `cancelled_at`, `assignment_state`, `sequence`.

### Identity (`identity` + `auth`)

لكل مستخدم:

```text
internal_uuid          UUID            # لا يظهر للمستخدم
wasla_public_id        WS-XXXXXXXXXX  # رقم الهوية المرئي والدائم
telegram_user_id       nullable external identifier
telegram_username      history-aware
phone_number           encrypted / normalized where available
```

### Subscriptions (`subscriptions`)

```text
Delivery only      250 SAR / month
Ride only          250 SAR / month
Both               400 SAR / month
```

أول شهر مجاني بعد إكمال التسجيل. التجديد شهري. لا يوجد حد أقصى افتراضي للأشهر المجانية.

### Notifications (`notifications`)

القنوات: Telegram، Mini App / WebSocket، Push-like web/app، SMS (critical fallback)، Email (invoices/reports).

---

## البيانات الأساسية لكل خدمة

كل خدمة تملك Logical Schema مستقل ضمن PostgreSQL (في المرحلة المعيارية):

```text
auth, identity, geo, orders, dispatch, matching, drivers, subscriptions,
reputation, fraud, referrals, marketplace, stores, catalog, inventory,
search, chat, notifications, support, partners, billing, compliance, audit
```

التفاصيل الكاملة في [`/docs/06-database/`](../06-database/).

---

## الروابط ذات الصلة

- [USER_FLOWS.md](USER_FLOWS.md) — تدفقات المستخدم
- [/docs/02-architecture/CONTAINERS.md](../02-architecture/CONTAINERS.md) — الحاويات والخدمات
- [/docs/06-database/](../06-database/) — قواعد البيانات
- [CODEOWNERS](../../CODEOWNERS) — ملكية كل خدمة
