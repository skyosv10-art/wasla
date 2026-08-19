# SCALING — مسار التوسع

> **Scope:** متى نضيف Microservice / Kafka / Kubernetes / Multi-Region، Core Survival Mode، Graceful Degradation، Multi-Country.
>
> **المرجع الأم:** أقسام 51 (Core Survival Mode) و52 (Graceful Degradation) و128 (Scalability Path) و129 (Multi-Country) و130 (Country Isolation) و184-187 (متى نضيف Microservice/Kafka/Kubernetes/Multi-Region) و95-96 (Service Extraction) من الدليل التنفيذي.
>
> **Last Updated:** 2026-08-19 · **Status:** Baseline v1.0 · **Related Team:** Team 10 (DevOps) · Team 09 (Data) · Team 11 (Security/QA)

---

## 1. مبدأ التوسع الأساسي

> لا نفصل Microservice لأن الرسم جميل. لا نضيف Kafka/Kubernetes/Multi-Region لمجرد اكتمال الصورة المعمارية.

كل قرار توسع يجب أن يخدم سببًا واضحًا ومقاسًا، ويُوثّق في ADR قبل التنفيذ.

---

## 2. مسار التوسع (Scalability Path)

```text
Stage A
Modular Monolith
+ PostgreSQL
+ Redis
+ Search
+ Queue/Event Outbox

Stage B
Read Replicas
+ Search scaling
+ Event Bus

Stage C
Extract Matching / Dispatch / Location / Chat / Search

Stage D
Regional deployments

Stage E
Multi-region / country cells
```

---

## 3. متى نضيف Microservice؟

لا لأن «المشروع كبير». بل عند وجود:

```text
Measured bottleneck
OR
Security isolation need
OR
Independent scaling need
OR
Independent team release need
```

### قواعد الانتقال من Modular Monolith إلى Services

قبل الاستخراج يجب أن نملك:

```text
Bounded Context
API Contract
Event Contract
Data Ownership
No hidden DB coupling
Tests
Observability
Runbook
Deployment isolation
```

> إذا فشل أي شرط، لا يتم الاستخراج.

### الخدمات الأكثر ترشيحًا للاستخراج

```text
Identity
Matching
Dispatch
Location
Chat
Search
Marketplace
Notifications
Billing
```

---

## 4. متى نضيف Kafka؟

عندما تصبح Events/streams تحتاج:

- Durable stream processing.
- Multiple consumers.
- Replay.
- Analytics scale.
- Integration scale.

> حتى ذلك الحين، Outbox + queue/event abstraction يكفيان.

**مهم:** يُبنى Domain Events وOutbox من البداية بحيث يمكن إدخال Kafka دون إعادة تصميم المجال. هذا قرار معماري مسبق وليس رد فعل.

---

## 5. متى نضيف Kubernetes؟

عندما تكون:

```text
Deployment complexity
Scale
Availability
Multi-service operations
```

تبرر ذلك، وليس لمجرد اكتمال الصورة المعمارية.

---

## 6. متى نضيف Multi-Region؟

عندما توجد متطلبات:

- Geographic latency.
- Regulatory isolation.
- Availability.
- Scale.

> قبلها نستخدم architecture قابلة للانتقال.

---

## 7. Multi-Country Architecture

التوسع الجغرافي لا يعني نسخ المدينة أو الكود. كل Country Cell يحتوي Configuration:

```text
Country
Currency
Timezone
Languages
Compliance
Payment Providers
Maps Provider
Tax
Service Rules
```

> لكن Identity/Core contracts عالمية.

### Country Isolation Strategy

لا ننسخ الكود لكل دولة. نستخدم:

```text
Shared Core
+
Country Policies
+
Country Adapters
```

مثال: `CompliancePolicy.sa`، `CompliancePolicy.ae`، `CompliancePolicy.eg`.

الإضافة تتم عبر Configuration (Country، Currency، Language، Compliance، Geography، Pricing، Service Availability، Payment Providers، Messaging، Operating Hours) دون تعديل Core Domain إلا في الحالات النظامية التي تحتاج Adapter/Policy.

---

## 8. Core Survival Mode (طبقات الأهمية)

يجب أن تظل المنصة قابلة للعمل حتى لو تعطلت أنظمة ثانوية.

### Tier 0 — Core

```text
Identity
Order
Matching
Dispatch
Assignment
Customer/Driver communication
Order completion
```

### Tier 1

```text
Marketplace
Search
Subscriptions
Reputation
Support
```

### Tier 2

```text
Analytics
AI
Advanced dashboards
Admin live map
Noncritical integrations
```

> في حالة الضغط، يمكن تعطيل Tier 2 للحفاظ على Tier 0. المبدأ: **Core Survives Secondary Failure**.

---

## 9. Graceful Degradation

| التعطل | السلوك البديل |
|---|---|
| Search تعطل | fallback إلى basic query/cache |
| Maps تعطل | cached route / approximate distance / manual dispatch |
| Analytics تعطل | Core orders تستمر |
| Notification Provider تعطل | retry + alternate channel if configured |

### حالات لا يجب أن توقف الطلب

- Dashboard analytics.
- AI model.
- Live Admin Map.
- Reporting.
- Search indexing delay.
- Recommendation engine.
- Secondary SMS provider.

> المبدأ: أي ميزة ثانوية يجب ألا توقف Core Ordering/Dispatch.

---

## 10. Configuration-driven Scaling

كل القيم التشغيلية الحساسة تكون Configuration (لا Hard-coded):

```text
Dispatch timeout
Wave size
Retry count
Subscription pricing
Referral thresholds
Reputation thresholds
Tracking interval
Broadcast limits
Search weights
```

لكن لا تُترك Config بلا validation.

### Feature Flags

كل Feature خطرة أو تجريبية تستخدم Feature Flag، يمكن تفعيلها حسب: Country، City، Zone، User segment، Partner، Percentage rollout.

التفاصيل في [`/docs/02-architecture/`](.) وثائق Deployment وFeature Flags (قسم 101 من الدليل).

---

## 11. متطلبات قبل كل قرار توسع

كل قرار توسع (Microservice / Kafka / Kubernetes / Multi-Region) يجب:

1. سبب واضح ومقاس (Measured bottleneck).
2. ADR موثّق في [`/docs/15-decisions/`](../15-decisions/).
3. استيفاء شروط الاستخراج (Bounded Context، API/Event Contract، Data Ownership، Tests، Observability، Runbook).
4. خطة Rollback.
5. مراجعة Team 10 (DevOps) وTeam 11 (Security/QA).

---

## 12. الروابط ذات الصلة

- [SYSTEM_CONTEXT.md](SYSTEM_CONTEXT.md) — السياق المعماري وCore Survival Mode
- [CONTAINERS.md](CONTAINERS.md) — الحاويات والخدمات
- [/docs/15-decisions/](../15-decisions/) — سجل القرارات (ADR)
- [/docs/08-infrastructure/](../08-infrastructure/) — البنية التحتية
