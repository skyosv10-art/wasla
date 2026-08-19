# USER_FLOWS — تدفقات المستخدم الرئيسية

> **Scope:** التدفقات الأساسية لكل نوع مستخدم في WASLA: Customer، Driver، Partner/Store.
>
> **المرجع الأم:** أقسام 4 (قنوات المستخدم) و15 (Order Engine) و16 (Assignment) و17 (التفاوض) و113-115 (UX) من الدليل التنفيذي.
>
> **Last Updated:** 2026-08-19 · **Status:** Baseline v1.0 · **Related Team:** Team 02 (Customer) · Team 03 (Driver) · Team 07 (Partner)

---

## 1. الأدوار والقنوات

يمكن للمستخدم الواحد امتلاك عدة Profiles دون إنشاء هوية مستقلة لكل دور:

```text
Wasla User
 ├── Customer Profile
 ├── Driver Profile
 ├── Store Owner Profile
 └── Partner Profile
```

القنوات:

| القناة | الدور الأساسي |
|---|---|
| Customer Bot | عميل — Start، Identity bootstrap، فتح Mini App، Notifications، Deep Links |
| Driver Bot | سائق — التسجيل، رفع المستندات، الاشتراك، فتح Mini App، الطلبات العاجلة، حالة العمل |
| Partner Bot | شريك — تسجيل الشريك، فتح Mini App، إدارة الطلبات، Store/Business entry |
| Admin Web Portal | إدارة — لا يوجد Admin Bot كقناة أساسية |
| Telegram Support/Escalation/Driver Community Groups | تشغيل لكل مدينة |

> الـMini App هي مكان الخدمات الثقيلة؛ البوت للإطلاق، التنبيه، التوجيه، الإجراءات الصغيرة.

---

## 2. Customer Flow (العميل)

### 2.1 التدفق الرئيسي: Start → Identity → Order → Match → Ride

```text
Start (Customer Bot)
   ↓
Identity Bootstrap (ربط Telegram ID بـ Wasla User ID)
   ↓
فتح Customer Mini App
   ↓
اختيار نوع الخدمة:
   ├── 🚗 اطلب مشوار     (Ride)
   ├── 📦 اطلب توصيل     (Delivery)
   ├── 🛍 تصفح المتاجر   (Marketplace)
   └── 🔎 ابحث          (Search)
   ↓
إدخال تفاصيل الطلب:
   - Pickup / Dropoff (خريطة / Telegram location / رابط / بحث نصي / اسم مكان)
   - Vehicle Type
   - Shipment Type (optional)
   - Description (optional)
   - Weight/Size if relevant
   - Offered Price (optional)
   ↓
Order Preview
   ↓
إنشاء Order → DRAFT → PUBLISHED → SEARCHING
   ↓
Matching (Candidate search + Ranking)
   ↓
Dispatch (Offer waves → Accept/Reject)
   ↓
ACCEPTED → ASSIGNED → DRIVER_EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED
```

### 2.2 نموذج السعر (Ride)

السعر يمكن أن يبدأ بثلاثة أساليب:

1. العميل يضع سعرًا مقترحًا.
2. العميل لا يضع سعرًا، ويصل الطلب إلى سائق/سائقين مؤهلين للتفاوض.
3. لاحقًا: WASLA توفر سعرًا استرشاديًا مبنيًا على البيانات دون إلزام الطرفين.

### 2.3 الخصوصية

قبل القبول لا تظهر المعلومات غير الضرورية. يجب ألا يكشف الطلب رقم الهاتف أو البيانات الحساسة.

### 2.4 Customer Home UX

```text
🚗 اطلب مشوار
📦 اطلب توصيل
🛍 تصفح المتاجر
🔎 ابحث
📋 طلباتي
⭐ سمعتي
👤 حسابي
```

> الترتيب قابل للتجربة A/B لاحقًا.

---

## 3. Driver Flow (السائق)

### 3.1 التدفق الرئيسي: Register → Docs → Subscribe → Available → Assign → Complete

```text
التسجيل (Driver Bot)
   ↓
رفع المستندات:
   - الهوية
   - رخصة القيادة
   - استمارة المركبة
   - التأمين
   - صور المركبة
   - بيانات إضافية تطلبها المنصة/الجهة التنظيمية
   ↓
التحقق الأولي (تسجيل + جمع + التحقق من الاتساق والصلاحية)
   ↓
تفعيل Trial Subscription (أول شهر مجاني)
   ↓
تحديد Work Country / City / Preferred Districts / Preferred Zones
   ↓
تفعيل الحالة: ACTIVE / Busy / Offline
   ↓
استقبال الطلبات:
   ├── الطلبات الخاصة بالسائق المشترك → داخل Mini App / Bot flow
   └── الطلبات غير المشتركة → في Community Driver Group لكل مدينة
   ↓
عند توفر طلب في Community Group:
   - رسالة Bot تحتوي: نوع الطلب، مناطق تقريبية، السعر المعلن، نوع السيارة/الخدمة
   - السائق يضغط زر قبول
   - النظام يقفل الطلب ذريًا (يمنع سائقين آخرين)
   ↓
Assignment → DRIVER_EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED
```

### 3.2 Driver Subscription State

```text
TRIAL → ACTIVE → GRACE → EXPIRED → COMMUNITY → SUSPENDED → CANCELLED
```

- الانتقال: Trial → Active → Expired → Community (عند انتهاء الاشتراك دون تجديد).
- يمكن للسائق الحصول على أشهر مجانية/خصم/اشتراك صفر وفق Referral/Contribution Rules.

### 3.3 Community Fallback

عند عدم وجود سائق مشترك مناسب:

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

في مجموعة السائقين: الرسائل التشغيلية يرسلها Bot فقط (لا دردشة عامة للطلب). الـGroup مجرد **Dispatch Channel**، وليس للتفاوض.

### 3.4 Driver Home UX

```text
🟢 حالة العمل
📥 الطلبات
📍 مناطق العمل
💳 الاشتراك
⭐ السمعة
📊 الأداء
👤 الملف
```

---

## 4. Partner / Store Flow (الشريك)

### 4.1 التدفق الرئيسي

```text
تسجيل الشريك (Partner Bot / Portal)
   ↓
Partner onboarding / Enterprise account
   ↓
إنشاء Store من هوية المستخدم الحالية (دون هوية جديدة)
   ↓
إدارة المتجر:
   - منتجات، صور، أسعار، مخزون، Variants، خيارات
   - فروع، موظفين (Store Staff)
   - طلبات، بحث، تقييم، تقارير
   - رابط متجر، رابط منتج، نطاق جغرافي مستهدف
   - التوصيل عبر WASLA
   ↓
طلبات المتجر → Inventory reserve → Delivery request → Driver assignment
   → Store fulfillment → Pickup → Delivery → Completion → Payment evidence record
```

### 4.2 نموذج التسعير (Marketplace Delivery)

```text
Product Price
+
Delivery Estimate
=
Customer Payable Amount
```

> أموال المنتج والتوصيل لا تمر عبر Wallet/WASLA كوسيط للرحلة في الإصدار الأساسي. المتجر والعميل والسائق يتفقون على طريقة التسوية، وتستطيع WASLA تسجيل بيانات النزاع أو إثبات التحويل.

### 4.3 Partner / Enterprise API

```text
Partner onboarding
API keys / OAuth strategy
Webhooks
Idempotency
Fleet concept
SLA
Contract pricing
Batch orders
Multi-stop
```

### 4.4 Partner Home UX

```text
📦 الطلبات
🏪 المتاجر
🛍 المنتجات
🚚 التوصيل
📊 التقارير
🔌 API
💳 الفواتير
👥 الموظفون
```

---

## 5. تفاوض متعدد المرشحين

عند الحاجة للتفاوض:

```text
Order
 ↓
Candidate 1 → 10s → No agreement
 ↓
Candidate 2 → 10s → No agreement
 ↓
Candidate 3 → 10s → No agreement
 ↓
Re-open Matching
```

- يمكن تعديل عدد المحاولات من Configuration.
- لا يُعاد عرض الطلب لنفس المرشحين مباشرة في نفس الجولة.
- يجب أن يظهر Countdown واضح للمستخدم حتى لا يظن أن التطبيق متجمد.

عند الاتفاق، يُسجَّل السعر المتفق عليه ليصبح: مرجعًا للرحلة، Data point للـPricing Intelligence، دليلًا للنزاع عند الحاجة.

---

## 6. مبادئ UX الأساسية

المنتج يجب أن يكون:

- سريع.
- واضح.
- قليل النقرات.
- لا يعلق بصمت.
- كل انتظار له Feedback / Countdown / Progress.
- الأخطاء تشرح ماذا يستطيع المستخدم فعله الآن.
- الأعمال الثقيلة في Mini App وليس في Bot message flow.

> يجب ألا يختلط على المستخدم الفرق بين: طلب مشوار، طلب توصيل، شراء من متجر — هذه ثلاثة Entry Points واضحة.

---

## 7. الروابط ذات الصلة

- [VISION.md](VISION.md) — الرؤية والمبادئ
- [SERVICES.md](SERVICES.md) — الخدمات الـ24
- [/docs/02-architecture/SYSTEM_CONTEXT.md](../02-architecture/SYSTEM_CONTEXT.md) — السياق المعماري
- [/docs/03-domain/](../03-domain/) — نماذج المجال التفصيلية
