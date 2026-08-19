# SYSTEM_CONTEXT — السياق المعماري العام

> **Scope:** السياق العام للنظام: التدفق من Telegram عبر Adapters إلى WASLA Core، ثم Data/Events، التوسع الدولي، واستقلالية القنوات.
>
> **المرجع الأم:** أقسام 5 (Telegram Adapter Architecture) و19 (نطاق المنتج) و51 (Core Survival Mode) و154 (Cancellation Scoring) و205 (الخلاصة) من الدليل التنفيذي.
>
> **Last Updated:** 2026-08-19 · **Status:** Baseline v1.0 · **Related Team:** Team 12 (Integration) · Team 09 (Data) · Team 10 (DevOps)

---

## 1. الصورة الكبرى

```text
Telegram
    ↓
Adapters
    ↓
WASLA Core
    ↓
Identity · Orders · Matching · Dispatch · Marketplace · Reputation · Trust · Referral · Chat · Search · Partners · Billing · Support · Admin
    ↓
Data + Events + Observability
    ↓
Country / Regional Expansion
    ↓
Future Channel Independence
```

---

## 2. طبقة Telegram Adapter

```text
Telegram Bots
   │
   ├── Customer Bot
   ├── Driver Bot
   └── Partner Bot
           │
           ▼
   Telegram Adapter
           │
           ├── Update Intake
           ├── Identity Linking
           ├── Message Delivery
           ├── Mini App Launch
           ├── Deep Links
           ├── Group Adapter
           ├── Bot Rate/Retry Control
           └── Telegram Error Mapping
           │
           ▼
      WASLA Core
```

### المبدأ الأساسي

يجب ألا يعرف Order Engine أو Reputation Engine تفاصيل Telegram.

- ❌ خطأ: `telegram.sendMessage()` داخل Business Logic.
- ✅ صحيح:

```text
NotificationService
      ↓
Channel Router
      ↓
Telegram Adapter
```

بحيث يمكن لاحقًا إضافة:

```text
Telegram Adapter
Web Adapter
Mobile Adapter
WhatsApp Adapter
```

دون تعديل Core Domain.

> Telegram يدعم إطلاق Web Apps عبر أزرار `web_app`، ويوفر Bot API للحصول على `User` و`contact` و`location` ضمن الحالات التي يوافق فيها المستخدم. لذلك يجب أن يكون الحصول على البيانات الخارجية والتحقق منها داخل Adapter/Identity boundary وليس داخل الخدمات التجارية.

المراجع التقنية: [Telegram Bot API](https://core.telegram.org/bots/api)، [Web Apps](https://core.telegram.org/bots/webapps)، [Web Events](https://core.telegram.org/api/web-events).

---

## 3. المبادئ المعمارية غير القابلة للتغيير

1. **Telegram قناة، وليس قلب النظام.**
2. **Wasla User ID هو الهوية الداخلية الأساسية** — Telegram IDs وأرقام الهواتف روابط Identity وليست مفتاح النظام النهائي.
3. لا يوجد اعتماد مباشر بين خدمة وخدمة عبر قاعدة بيانات خدمة أخرى بعد فصل الخدمات؛ الاتصال عبر Contracts.
4. جميع API/Event contracts قابلة للإصدار Versioning.
5. أي ميزة ثانوية يجب ألا توقف Core Ordering/Dispatch.
6. جميع الخدمات الحساسة قابلة للتدقيق Audit.
7. Matching وDispatch منفصلان منطقيًا.
8. Search منصة مستقلة منطقيًا.

التفاصيل الكاملة في [`/docs/01-product/VISION.md`](../01-product/VISION.md).

---

## 4. طبقة Data + Events + Observability

| المكون | التقنية / النمط |
|---|---|
| مصدر الحقيقة (Source of truth) | PostgreSQL |
| Real-time state | Redis |
| Search | Search Index مستقل قابل لإعادة البناء |
| Media | S3-compatible Object Storage |
| Analytics | Warehouse / OLAP عند الحاجة |
| Events | Kafka عندما يرتفع Event Scale؛ يُبنى Domain Events وOutbox من البداية بحيث يمكن إدخال Kafka دون إعادة تصميم المجال |

### Observability (من البداية)

```text
Logs
Metrics
Tracing
Errors
Alerts
```

التوصية: OpenTelemetry · Prometheus · Grafana · Loki / ELK-compatible logging · Alertmanager.

كل Request يحتاج:

```text
request_id
trace_id
service
operation
latency
status
error_code
```

---

## 5. Core Survival Mode (طبقات الأهمية)

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

> في حالة الضغط، يمكن تعطيل Tier 2 للحفاظ على Tier 0.

### Graceful Degradation

| التعطل | السلوك |
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

---

## 6. Country Expansion (التوسع الدولي)

التوسع الجغرافي لا يعني نسخ المدينة أو الكود. كل دولة كيان Configuration مستقل:

```text
Country
Currency
Language
Compliance
Geography
Pricing
Service Availability
Payment Providers
Messaging
Operating Hours
```

### Multi-Country Architecture

كل Country Cell يحتوي Configuration:

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

لكن Identity/Core contracts عالمية.

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

التفاصيل في [`SCALING.md`](SCALING.md).

---

## 7. Channel Independence (استقلالية القنوات)

عندما يصبح Telegram unavailable في سوق معينة:

```text
Wasla Core
      │
      ├── Telegram Adapter
      ├── Web Adapter
      ├── Mobile Adapter
      └── Future Channels
```

لا تُعاد كتابة: Order Engine، Reputation Engine، Marketplace، Dispatch، Matching.

---

## 8. قواعد انتقال الطلب والطلب

### انتقال الطلب إلى Community

```text
Order Created
   ↓
Subscribed Matching
   ↓
No suitable/available acceptance
   ↓
Community Fallback
   ↓
City Driver Group
```

### Group Safety

- الـGroup مجرد **Dispatch Channel** وليس للتفاوض.
- بعد الضغط على قبول، يُنقل التواصل إلى Chat منفصل.
- البيانات الحساسة لا تظهر في رسالة Group.

التفاصيل في [`/docs/01-product/USER_FLOWS.md`](../01-product/USER_FLOWS.md).

---

## 9. الروابط ذات الصلة

- [CONTAINERS.md](CONTAINERS.md) — الحاويات والخدمات
- [SCALING.md](SCALING.md) — مسار التوسع
- [/docs/01-product/VISION.md](../01-product/VISION.md) — المبادئ
- [/docs/15-decisions/ADR-001-identity-decoupled-from-telegram.md](../15-decisions/ADR-001-identity-decoupled-from-telegram.md) — فصل الهوية عن Telegram
