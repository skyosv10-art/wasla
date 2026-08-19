# وَصْلة / WASLA — Master Execution & Engineering Handbook

> **النوع:** الدليل التنفيذي الأم للمستودع
>
> **الهدف:** تحويل رؤية «وصلة» إلى نظام برمجي قابل للبناء والصيانة والتوسع عالميًا، بحيث يستطيع فريق من 12 مبرمجًا العمل على أجزاء مختلفة دون فقدان السياق أو كسر أجزاء أخرى من النظام.
>
> **الحالة:** Baseline Architecture — v1.0
>
> **ملاحظة:** هذه الوثيقة ليست وثيقة عرض. هذه وثيقة تشغيل وهندسة وقرارات. أي قرار جديد يجب أن يدخل سجل القرارات قبل اعتباره جزءًا من النظام.

---

# 0. قانون المستودع — إجباري

## 0.1 قاعدة التوثيق غير القابلة للتجاوز

**أي شخص يقوم بأي عمل في المشروع يجب أن يوثق ما فعله في المستودع.**

لا يكفي أن يكون الكود موجودًا.

عند تنفيذ أي مهمة يجب توثيق:

1. ماذا تم إنجازه؟
2. لماذا تم اختياره؟
3. أين تم التغيير؟
4. ما الملفات والخدمات والمكونات المتأثرة؟
5. ما الـAPI أو الـEvent أو الـDatabase schema الذي تغير؟
6. كيف تم الاختبار؟
7. ما المشاكل التي ظهرت وكيف حُلت؟
8. ما الذي لم يكتمل؟
9. ما الخطوة التالية؟
10. ما الذي يعتمد عليه العمل التالي؟
11. هل توجد Migration أو Deployment أو Configuration Change؟
12. هل توجد مخاطر أو قرارات تحتاج مراجعة؟
13. ما الروابط إلى Issue / Merge Request / ADR؟
14. ما الشخص أو الفريق الذي يستطيع متابعة المهمة؟

**أي Task لا تحتوي على توثيقها تعتبر غير مكتملة.**

## 0.2 السجل الإلزامي لكل مهمة

لكل Issue أو Work Item يجب تحديث:

```text
Status
Completed
Changed
Tests
Docs
Known Issues
Blocked By
Next Step
Related Files
Related Services
Related API/Event
Migration Needed
Deployment Needed
Security Impact
Decision Needed
```

## 0.3 قاعدة عدم المعرفة المنفردة

لا يجوز أن يصبح أي جزء حرج من النظام معروفًا لشخص واحد فقط.

كل Module حرج يجب أن يكون له:

```text
Primary Maintainer
Secondary Maintainer
Documentation
Tests
Runbook
Architecture Notes
```

## 0.4 قاعدة عدم تجاوز المراحل

لا يتم الانتقال من مرحلة إلى المرحلة التالية لمجرد انتهاء البرمجة.

الانتقال يتم فقط بعد اجتياز **Exit Gate** الخاصة بالمرحلة، بما فيها الاختبارات والوثائق والأمان والتكامل.

## 0.5 قاعدة عدم وجود Feature بلا مسار فشل

كل Feature يجب أن يجيب قبل اعتماده عن:

```text
What happens on success?
What happens on timeout?
What happens on duplicate request?
What happens on network failure?
What happens if a dependency is down?
What happens if data is missing?
What happens if the user retries?
What happens if the user is malicious?
What happens if the external provider changes?
What happens in degraded mode?
```

---

# 1. هوية المشروع

## 1.1 الاسم

**وَصْلة / WASLA**

## 1.2 الوصف الرسمي

**WASLA — Global Logistics OS**

منصة لوجستية وتشغيلية عالمية، تبدأ من Telegram، وتجمع النقل، التوصيل، الإسناد، المتاجر، البحث، السمعة، الثقة، التشغيل، ودعم الشركاء في Core واحد قابل للتوسع إلى دول وقنوات أخرى.

## 1.3 الرؤية

الهدف بعيد المدى هو أن تصبح WASLA قابلة للاستخدام في كل دولة يتوفر فيها Telegram، مع إمكانية إضافة قنوات بديلة لاحقًا دون إعادة بناء الـCore.

## 1.4 سوق الإطلاق

```text
Initial Country: Saudi Arabia
Initial Geographic Scope: All Saudi Cities
Year 1 Target Expansion: Gulf + Egypt + Jordan
Long-Term: Global
Base Currency: SAR
Languages: Arabic, English, Urdu
Future Search / Localization: Turkish, Persian and additional locales
```

> التوسع الجغرافي لا يعني أن جميع الدول يجب أن تشترك في نفس قواعد التسعير أو التشغيل أو الامتثال. الدولة كيان Configuration مستقل.

---

# 2. المبادئ غير القابلة للتغيير

1. **Telegram قناة، وليس قلب النظام.**
2. **Wasla User ID هو الهوية الداخلية الأساسية.**
3. Telegram IDs وأرقام الهواتف والهويات الخارجية روابط Identity وليست مفتاح النظام النهائي.
4. لا يوجد تطبيق Driver Native في نطاق هذه النسخة؛ السائق يعمل عبر Telegram Bot + Mini App.
5. الـMini App هي مكان الخدمات الثقيلة؛ البوت للإطلاق، التنبيه، التوجيه، الإجراءات الصغيرة، والقروبات التشغيلية.
6. العميل مجاني في نموذج الإطلاق؛ لا توجد عمولة على العميل من WASLA.
7. لا توجد Wallet أو Escrow لرحلات العملاء في الإصدار الأساسي.
8. اشتراك السائق هو نموذج الإيرادات الأساسي المباشر.
9. مدفوعات الرحلات الأساسية تتم مباشرة بين العميل والسائق أو العميل والمتجر وفق الاتفاق، مع إمكانية تسجيل إثبات الدفع والنزاع.
10. اشتراكات المتاجر والمنصة تُدفع عبر بوابة دفع للمنصة، مع طبقة Payment Abstraction.
11. Reputation Engine جزء أساسي من النظام وليس Feature تجميلية.
12. Referral Engine مستقل ويحسب المستخدمين الفعليين، وليس مجرد فتح البوت.
13. Marketplace أصل من أصول المنصة وليس قسمًا ثانويًا.
14. Order Engine موحد في البداية، وحدود المجال مصممة بحيث يمكن فصل Ride وDelivery لاحقًا دون إعادة البناء.
15. Matching وDispatch منفصلان منطقيًا.
16. Search منصة مستقلة منطقيًا.
17. جميع الخدمات الحساسة قابلة للتدقيق Audit.
18. أي ميزة ثانوية يجب ألا توقف Core Ordering/Dispatch.
19. لا يوجد اعتماد مباشر بين خدمة وخدمة عبر قاعدة بيانات خدمة أخرى بعد فصل الخدمات؛ الاتصال عبر Contracts.
20. جميع API/Event contracts قابلة للإصدار Versioning.

---

# 3. نطاق المنتج الكامل

WASLA ليست تطبيق مشاوير فقط. النطاق المستهدف:

## 3.1 Mobility

- مشاوير أفراد.
- مشاوير مجدولة.
- أنواع مركبات متعددة.
- طلبات تعتمد على عرض العميل للسعر أو التفاوض.
- اختيار السائق من المرشحين.
- Shared/Community Driver Pool عند عدم كفاية السائقين المشتركين.

## 3.2 Delivery

- طرود.
- مستندات.
- طعام.
- منتجات متاجر.
- شحنات متعددة الأحجام.
- Multi-stop.
- Scheduled Delivery.
- Partner Dispatch.

## 3.3 Marketplace

أي مستخدم يمكنه الانتقال من User إلى Store Owner أو Partner دون إنشاء هوية جديدة.

المتجر يدعم:

- منتجات.
- صور.
- أسعار.
- مخزون.
- Variants.
- خيارات.
- فروع.
- موظفين.
- طلبات.
- بحث.
- تقييم.
- تقارير.
- رابط متجر.
- رابط منتج.
- نطاق جغرافي مستهدف.
- التوصيل عبر WASLA.

## 3.4 B2B / Partners

- مطاعم.
- متاجر.
- صيدليات.
- شركات.
- سلاسل.
- شركات نقل صغيرة.
- أصحاب أساطيل.
- Enterprise API.

## 3.5 Operations

- Dispatch.
- Support.
- Escalation.
- Moderation.
- Compliance.
- Fraud.
- Reputation.
- Analytics.
- Broadcasting.

---

# 4. قنوات المستخدم

## 4.1 Customer Bot

مسؤول عن:

- Start.
- Identity bootstrap.
- فتح Customer Mini App.
- Notifications المهمة.
- Links.
- Deep Links.
- حالات قصيرة وسريعة.

## 4.2 Driver Bot

مسؤول عن:

- التسجيل.
- رفع المستندات.
- الاشتراك.
- فتح Driver Mini App.
- الطلبات العاجلة.
- حالة العمل.
- الانتقال إلى Community Driver Group.
- إشعارات الطلبات.

## 4.3 Partner Bot

مسؤول عن:

- تسجيل الشريك.
- فتح Partner Mini App.
- إدارة الطلبات.
- الإشعارات المهمة.
- Store / Business entry.

## 4.4 Admin

لا يوجد Admin Bot كقناة أساسية.

الإدارة عبر Web Admin Portal.

## 4.5 Support / Escalation

قنوات التشغيل الحالية:

- Telegram Support Groups لكل مدينة.
- Telegram Escalation Groups لكل مدينة.
- Driver Community Group لكل مدينة.
- Admin Web Portal للتحكم الكامل.

---

# 5. Telegram Adapter Architecture

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

يجب ألا يعرف Order Engine أو Reputation Engine تفاصيل Telegram.

مثلاً لا نضع `telegram.sendMessage()` داخل Business Logic.

الصحيح:

```text
NotificationService
      ↓
Channel Router
      ↓
Telegram Adapter
```

بحيث يمكن لاحقًا:

```text
Telegram Adapter
Web Adapter
Mobile Adapter
WhatsApp Adapter
```

من دون تعديل Core Domain.

Telegram يدعم إطلاق Web Apps عبر أزرار `web_app`، كما يوفر Bot API الحصول على `User` و`contact` و`location` ضمن الحالات التي يوافق فيها المستخدم، لذلك يجب أن يكون الحصول على البيانات الخارجية والتحقق منها داخل Adapter/Identity boundary وليس داخل الخدمات التجارية. citeturn670862search0turn670862search2

---

# 6. الهوية — Identity Model

## 6.1 المعرفات

لكل مستخدم:

```text
internal_uuid          UUID
wasla_public_id        WS-XXXXXXXXXX
telegram_user_id       nullable external identifier
telegram_username      history-aware
phone_number           encrypted / normalized where available
```

**internal_uuid** لا يظهر للمستخدم.

**wasla_public_id** هو رقم الهوية المرئي والدائم.

مثال:

```text
WS-0000010427
```

## 6.2 استرجاع الحساب

إذا فقد المستخدم Telegram، يمكنه لاحقًا بدء Recovery باستخدام Wasla Public ID + وسيلة تحقق مناسبة يحددها النظام.

هذا لا يعني السماح بتجاوز الهوية؛ Recovery يجب أن يمر بخطوات تحقق مناسبة وفق مستوى الحساب والمخاطر.

## 6.3 تغيّر Username

تغيير Telegram Username لا ينشئ User جديدًا.

يسجل في Identity History:

```text
old_username
new_username
effective_at
source
```

## 6.4 تغيّر الدولة/المدينة/المنطقة

الموقع الحالي ليس جزءًا ثابتًا من الهوية.

لدينا:

```text
country
region
city
district
zone
```

كمراجع جغرافية مستقلة، مع History للتغييرات.

---

# 7. الأدوار

يمكن للمستخدم الواحد امتلاك عدة Profiles.

```text
Wasla User
 ├── Customer Profile
 ├── Driver Profile
 ├── Store Owner Profile
 └── Partner Profile
```

هذا يسمح للمستخدم:

- أن يكون عميلًا وسائقًا.
- سائقًا وصاحب متجر.
- عميلًا وصاحب متجر.
- Partner يدير عدة متاجر.

ولا يتم إنشاء هوية مستقلة لكل دور.

---

# 8. الجغرافيا

التسلسل:

```text
Country
  ↓
Region
  ↓
City
  ↓
District
  ↓
Zone
```

كل كيان جغرافي له:

```text
id
name_ar
name_en
name_ur
name_tr
name_fa
code
parent_id
status
polygon/geospatial reference (optional)
```

المستخدم العادي يستطيع تغيير الدولة/المدينة/الموقع حسب حاجته.

السائق المشترك يستطيع تحديد:

```text
Work Country
Work City
Preferred District
Preferred Zones
```

الموقع الجغرافي التشغيلي ليس بالضرورة نفس دولة إقامة الحساب.

---

# 9. نموذج السائق

## 9.1 Driver Profile

يشمل على الأقل:

```text
user_id
verification_status
subscription_status
service_capabilities
vehicle_type
vehicle_details
current_operational_status
work_city
preferred_districts
preferred_zones
rating
reputation_score
completion_rate
acceptance_rate
```

## 9.2 الوثائق

- الهوية.
- رخصة القيادة.
- استمارة المركبة.
- التأمين.
- صور المركبة.
- بيانات إضافية تطلبها المنصة أو الجهة التنظيمية لاحقًا.

التحقق الأولي من المنصة هنا هو **تسجيل وجمع والتحقق من الاتساق والصلاحية حسب المتوفر**، وليس قرارًا تعسفيًا بقبول/رفض وفق طلب المستخدم؛ طبقة Compliance مصممة بحيث يمكن ربطها لاحقًا بالأنظمة الحكومية أو مزودي التحقق.

## 9.3 الحساب البنكي

اختياري في المرحلة الحالية.

---

# 10. اشتراك السائق

الخيار المعتمد كبداية:

```text
Delivery only      250 SAR / month
Ride only          250 SAR / month
Both               400 SAR / month
```

أول شهر مجاني بعد إكمال التسجيل والبيانات المطلوبة.

التجديد شهري.

يمكن للسائق الحصول على أشهر مجانية أو خصم أو اشتراك صفر وفق Referral/Contribution Rules.

لا يوجد حد أقصى افتراضي للأشهر المجانية؛ الإدارة تستطيع تعديل السياسة.

## 10.1 Driver Subscription State

```text
TRIAL
ACTIVE
GRACE
EXPIRED
COMMUNITY
SUSPENDED
CANCELLED
```

---

# 11. Community Driver Pool

السائق غير المشترك لا يعني مستخدمًا مجهولًا.

يدخل من Driver Bot ويقدم الحد الأدنى من البيانات المطلوبة، ليظل معروف الهوية داخل المنصة.

الفرق:

```text
SUBSCRIBED DRIVER
→ Bot + Mini App + private matching offers + preferred zones

COMMUNITY DRIVER
→ Driver Bot + City Community Group
→ receives only fallback/unassigned opportunities
```

## 11.1 انتقال الطلب

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

في مجموعة السائقين:

- الرسائل التشغيلية يرسلها Bot.
- المستخدمون لا يحولون المجموعة إلى دردشة عامة للطلب.
- الرسالة تحتوي نوع الطلب، مناطق تقريبية/معلومات مسموحة، السعر المعلن إن وجد، ونوع السيارة/الخدمة المطلوبة.
- السائق يضغط زر قبول.
- النظام يقفل الطلب ذريًا، ويمنع حصول سائقين على نفس الطلب.

---

# 12. نموذج السعر

## 12.1 Ride

السعر يمكن أن يبدأ بثلاثة أساليب:

1. العميل يضع سعرًا مقترحًا.
2. العميل لا يضع سعرًا، ويصل الطلب إلى سائق/سائقين مؤهلين للتفاوض.
3. لاحقًا يمكن أن توفر WASLA سعرًا استرشاديًا مبنيًا على البيانات دون إلزام الطرفين به.

## 12.2 التفاوض

عند دخول السائق في طلب تفاوضي:

```text
Offer → Candidate → Chat/Negotiation → Agreement
```

إذا تم الاتفاق، يوجد خيار قوي افتراضيًا لتسجيل السعر المتفق عليه في النظام.

هذا السعر يصبح:

- مرجعًا للرحلة.
- Data point للـPricing Intelligence.
- دليلًا للنزاع عند الحاجة.

## 12.3 الخصوصية

قبل القبول لا تظهر المعلومات غير الضرورية.

يجب ألا يكشف الطلب رقم الهاتف أو البيانات الحساسة.

---

# 13. نموذج التوصيل

العميل يدخل:

```text
Pickup
Dropoff
Vehicle Type
Shipment Type (optional)
Description (optional)
Weight/Size if relevant
Offered Price (optional)
```

يمكن إدخال الموقع:

- من الخريطة.
- Telegram location.
- رابط موقع.
- بحث نصي.
- اسم المكان.

إذا احتاج الطلب مركبة معينة بسبب حجم الشحنة، يجب اختيارها.

---

# 14. السعر داخل Marketplace Delivery

نموذج مقترح معتمد:

```text
Product Price
+
Delivery Estimate
=
Customer Payable Amount
```

لكن أموال المنتج والتوصيل في الإصدار الأساسي لا تمر عبر Wallet/حتى حساب WASLA كوسيط للرحلة.

المتجر والعميل والسائق يتفقون على طريقة التسوية التجارية بينهم، وتستطيع WASLA تسجيل بيانات النزاع أو إثبات التحويل عند الحاجة.

في حالات التوصيل التجاري، يقترح النظام أجرة توصيل للسائق بناء على قواعد المدينة/المسافة/المركبة، بينما السعر النهائي الذي يدفعه العميل يظهر من خلال متجر/Order UX وفق السياسة المعتمدة.

---

# 15. Order Engine

Order Engine موحد في البداية.

لكن Domain Model يجب أن يدعم:

```text
Order
 ├── Ride Order
 ├── Delivery Order
 ├── Store Delivery Order
 ├── Partner Order
 └── Future Order Types
```

## 15.1 Order lifecycle

```text
DRAFT
  ↓
PUBLISHED
  ↓
SEARCHING
  ↓
OFFERED
  ↓
NEGOTIATING (optional)
  ↓
ACCEPTED
  ↓
ASSIGNED
  ↓
DRIVER_EN_ROUTE
  ↓
ARRIVED
  ↓
IN_PROGRESS
  ↓
COMPLETED
```

حالات جانبية:

```text
EXPIRED
NO_DRIVER_FOUND
DRIVER_REJECTED
DRIVER_TIMEOUT
DRIVER_CANCELLED
CUSTOMER_CANCELLED
PARTNER_CANCELLED
PAYMENT_DISPUTED
FAILED
BLOCKED
UNDER_REVIEW
```

كل تغيير حالة يجب أن يكون Event + Audit Record.

---

# 16. Assignment Model

لا نخلط بين Matching وDispatch.

## Matching

يجيب:

> من المرشحون؟

## Dispatch

يجيب:

> من يستلم العرض؟ متى؟ ماذا يحدث عند الرفض أو الانتهاء؟

## Assignment

هو السجل النهائي:

```text
order_id
driver_id
offered_at
accepted_at
rejected_at
expired_at
cancelled_at
assignment_state
sequence
```

---

# 17. التفاوض متعدد المرشحين

عند الحاجة:

```text
Order
 ↓
Candidate 1
 ↓ 10s
No agreement
 ↓
Candidate 2
 ↓ 10s
No agreement
 ↓
Candidate 3
 ↓ 10s
No agreement
 ↓
Re-open Matching
```

يمكن تعديل عدد المحاولات من Configuration.

لا يُعاد عرض الطلب لنفس المرشحين مباشرة في نفس الجولة، ما لم تقرر قواعد Dispatch خلاف ذلك.

يجب أن يظهر Countdown واضح للمستخدم حتى لا يظن أن التطبيق متجمد.

---

# 18. Reputation Engine

هذا محرك Core وليس مجرد جدول تقييم.

## 18.1 المكونات

```text
Reputation Profile
Reputation Events
Ratings
Complaints
Disputes
Cancellation Impact
Fraud Signals
Verification Signals
Contribution Signals
History
```

## 18.2 Score

النموذج المرن:

```text
-100 ───────── 0 ───────── +100
```

لكن الـUI لا يعتمد الرقم وحده، بل يعرض تصنيفًا:

```text
Trusted
Good
Normal
Caution
High Risk
Restricted
```

يمكن عرض الرقم للطرفين إذا كانت سياسة الإصدار تقرر ذلك، مع منع كشف قواعد مكافحة الاحتيال الداخلية.

## 18.3 السمعة تتحسن

يمكن للمستخدم إصلاح السمعة عبر:

- إكمال طلبات بنجاح.
- الالتزام.
- خفض الإلغاء.
- عدم وجود نزاعات مؤكدة.
- مساهمات مجتمعية موثوقة.
- توثيق ناجح.

تاريخ السمعة لا يُحذف بسبب حذف الحساب؛ لكن النتيجة الحالية قابلة للتحسن.

## 18.4 تأثير السمعة

السمعة قد تؤثر على:

- المطابقة.
- ترتيب المرشحين.
- تحذير الطرف الآخر.
- السماح بخدمات معينة.
- Community fallback.
- Fraud review.

لا تجعل السمعة وحدها تمنع الخدمة دون قواعد واضحة ومراجعة مناسبة في الحالات الحرجة.

---

# 19. Fraud & Trust Engine

من المرحلة المبكرة، وليس بعد سنوات.

## إشارات أساسية

```text
Multiple accounts
Repeated Telegram identity changes
Phone reuse
Identity reuse
Referral abuse
Fake activity
Abnormal cancellation patterns
Collusive ratings
Payment disputes
Impossible location movement
Order looping
Group abuse
Device/session anomalies where legally and technically available
```

المحرك ينتج:

```text
Risk Score
Risk Level
Recommended Action
Evidence Set
```

والإجراء قد يكون:

```text
ALLOW
CHALLENGE
LIMIT
REVIEW
SUSPEND
BLOCK
```

---

# 20. Referral Engine

Referral Engine مستقل.

## 20.1 Referral identity

كل مستخدم يستطيع امتلاك:

```text
Referral Code
Referral Link
Campaign Attribution
```

Deep Link مثال مفاهيمي:

```text
Telegram Bot
  ↓
/start referral_code
  ↓
Attribution Service
```

## 20.2 Referral success

لا تُحسب الإحالة عند فتح البوت فقط.

الحد الأدنى:

```text
Join
+
Identity Bootstrap
+
Meaningful Activity
```

ولـCustomer/SDriver في الأساس:

```text
First Completed Order
```

## 20.3 المكافآت

المكافآت يمكن أن تكون:

- خصم الاشتراك.
- شهر مجاني.
- عدة أشهر مجانية.
- Upgrade في الثقة.
- أهلية لبرنامج المساهمين.
- وظيفة مجتمعية مدفوعة لاحقًا بعد مراجعة بشرية.

## 20.4 Anti-abuse

يمنع النظام احتساب:

- حسابات وهمية.
- تكرار الهوية.
- نشاط غير حقيقي.
- حلقات إحالة.

---

# 21. Wasla Contribution Program

نظام منفصل عن Referral المالي.

مستويات محتملة:

```text
Verified Contributor
Community Helper
Moderator
Dispatcher
Support Agent
Paid Operator
```

الترقية النهائية إلى أدوار حساسة ليست آلية بالكامل؛ النظام يرشح، والمشرف البشري يقرر.

---

# 22. Marketplace Architecture

```text
Marketplace
 ├── Store Service
 ├── Product Service
 ├── Inventory Service
 ├── Order Service (shared order core integration)
 ├── Search Service
 ├── Catalog Moderation
 ├── Store Staff / RBAC
 ├── Store Billing
 ├── Review Service
 └── Store Analytics
```

## 22.1 Store lifecycle

```text
DRAFT
↓
SUBMITTED
↓
REVIEW
↓
APPROVED
↓
ACTIVE
↓
PAUSED
↓
SUSPENDED
↓
ARCHIVED
```

## 22.2 Product lifecycle

```text
DRAFT
PENDING_REVIEW
PUBLISHED
HIDDEN
OUT_OF_STOCK
SUSPENDED
ARCHIVED
```

## 22.3 المتجر غير مرتبط بنشاط صاحبه اللحظي

المتجر كيان تجاري مستقل في النظام.

صاحبه قد يكون Offline، لكن:

- يتم حفظ الطلب.
- يتم إشعار الأجهزة المرتبطة بالمتجر.
- يمكن لموظف آخر التعامل معه إذا كانت الصلاحيات تسمح.
- الإدارة تستطيع تعليق المتجر دون حذف بياناته.

---

# 23. Store Devices & Staff

المتجر يمكن أن يربط مستخدمين:

```text
Owner
Manager
Cashier
Fulfillment
Delivery Coordinator
Analyst
```

والإشعارات توجه إلى:

- Mini App.
- Web Portal.
- الأجهزة المرتبطة حسب إعدادات المتجر.

---

# 24. Store Pricing / Billing

نموذج Hybrid:

```text
Fixed Subscription
+
Variable Sales-Based Fee where appropriate
```

لكن الأسعار لا تكون عشوائية.

Price Engine يقررها وفق:

```text
business_type
size
volume
category
estimated_sales
region
service_level
enterprise_status
```

والإدارة تستطيع Override وفق سياسة موثقة.

Enterprise يمكن أن يحصل على Contract خاص.

---

# 25. Search Engine

Search مطلوب من البداية كقدرة منطقية.

## 25.1 نطاق البحث

```text
Products
Stores
Categories
Services
Marketplace content
```

## 25.2 اللغات

```text
Arabic
English
Urdu
Turkish
Persian
```

## 25.3 البحث الجغرافي

يدعم:

```text
Nearby
City
District
Zone
Target Delivery Area
```

## 25.4 Ranking

الترتيب يمكن أن يعتمد على:

```text
Relevance
Distance
Popularity
Freshness
Rating
Availability
Inventory
Delivery Capability
Store Quality
```

لا يسمح ranking المدفوع بإفساد relevance.

## 25.5 التنفيذ

- PostgreSQL هو المصدر الرسمي للبيانات.
- Search Index يكون قابلًا لإعادة البناء.
- OpenSearch/Elastic-compatible abstraction يستخدم عندما يصل البحث إلى مستوى يستحقه.
- يجب أن يتمكن النظام من إعادة بناء الـIndex من المصدر من دون فقد البيانات.

---

# 26. Chat & Translation

Chat ليس داخل Bot كنظام أساسي.

Chat داخل Mini App.

```text
Client
 ↓
WebSocket Gateway
 ↓
Conversation Service
 ↓
Message Service
 ↓
Translation Service
```

## 26.1 فتح Chat

الأصل:

```text
قبل Assignment: ممنوع Chat مباشر
بعد قبول/بدء التفاوض المسموح: Chat
بعد الإكمال: يغلق تلقائيًا
```

عند استخدام Chat للتفاوض على السعر، يفتح مؤقتًا أثناء نافذة التفاوض.

## 26.2 الرسالة

```text
message_id
conversation_id
sender_id
receiver_id
original_text
source_language
translated_text
translated_language
attachments
created_at
status
```

يُحفظ النص الأصلي والترجمة عند توفرهما.

## 26.3 أنواع المحتوى

المراحل الأساسية:

- نص.
- صورة.
- ملف عند الحاجة.

الصوت والفيديو ميزات لاحقة، ولا تجعل Core ينتظرها.

---

# 27. الموقع والتتبع

لا نرسل GPS كـstream دائم بلا داعٍ.

نستخدم Dynamic Tracking Interval.

مثال سياسة منطقية قابلة للتعديل:

```text
Before pickup:
low frequency

Near pickup:
higher frequency

In trip:
higher frequency

Near destination:
high frequency

After complete:
stop tracking
```

العميل يرى موقع السائق وفق سياسة زمنية، وليس بالضرورة كل تحديث GPS داخلي.

Live Map في الإدارة Feature قابلة للتعطيل عند ضغط التكلفة.

---

# 28. Route / Maps Abstraction

```text
MapsProvider
 ├── geocode()
 ├── reverseGeocode()
 ├── route()
 ├── distanceMatrix()
 ├── eta()
 └── mapTile/URL configuration
```

مزود واحد في البداية.

لكن يجب أن يكون استبداله ممكنًا عبر Adapter.

Fallback عند فشل المزود:

```text
Cached Route
Last ETA
Approximate Distance
Manual Dispatch
```

والنظام لا يتوقف كليًا بسبب تعطل Maps.

---

# 29. Dispatch Engine

## Inputs

```text
Order
Candidate Drivers
Reputation
Capability
Location
Subscription
Zone
Availability
Existing Assignment
```

## Outputs

```text
Offer
Assignment
Timeout
Reassign
Fallback
Community Escalation
```

## Wave Dispatch

بدل الانتظار الطويل:

```text
Wave 1
small candidate set
short timeout

Wave 2
larger candidate set
short timeout

Wave 3
expanded search

Fallback
Community Group
```

الأرقام النهائية Configuration وليست Hard-coded في Business Logic.

---

# 30. Matching Engine

## 30.1 Hard Filters أولًا

لا يدخل ranking إلا السائق المؤهل.

أمثلة:

```text
Available
Correct service
Correct vehicle
Allowed zone
Verified/eligible
Not already assigned
Not blocked by customer rules
Not blocked by driver rules
```

## 30.2 Ranking ثانيًا

النموذج الافتراضي:

```text
ETA                         35%
Distance / Route            20%
Completion                  15%
Rating                      10%
Acceptance                 10%
Fairness / Distribution     10%
```

لكن النسب Configuration.

---

# 31. Fairness

النظام لا يجب أن يعطي الطلبات دائمًا لنفس مجموعة السائقين.

يجب مراعاة:

- جودة الخدمة.
- Availability.
- الوقت منذ آخر طلب.
- عدد الطلبات المنفذة.
- العدالة بين السائقين المؤهلين.

هذا يحسن Supply Health.

---

# 32. Admin Broadcast Engine

الإدارة تستطيع إرسال رسائل محددة إلى:

```text
All users
Customers
Drivers
Subscribed Drivers
Community Drivers
Partners
Store Owners
Specific Country
Specific City
Specific Zone
Specific Store Type
Specific Segment
```

يجب أن يكون هناك:

```text
Campaign
Audience
Template
Schedule
Delivery Status
Retry
Audit
```

والإرسال الجماعي لا يتم كحلقة blocking داخل HTTP request.

---

# 33. Support / Escalation

لكل مدينة:

```text
Driver Group
Support Group
Escalation Group
```

الدعم يستطيع:

- تعليق مستخدم.
- فك تعليق.
- فتح تذكرة.
- تصعيد.
- رؤية Order context.
- رؤية Reputation context حسب الصلاحية.

كل إجراء إداري حساس يسجل Audit.

---

# 34. النزاعات

### مثال

```text
Customer claims payment
Driver denies
```

فتح Case:

```text
DISPUTE_OPEN
↓
EVIDENCE_COLLECTION
↓
SUPPORT_REVIEW
↓
ESCALATION (if needed)
↓
RESOLUTION
↓
REPUTATION_UPDATE (if applicable)
```

لا تحذف الأدلة.

---

# 35. Payment Architecture

## 35.1 ممنوع خلط نوعين من الأموال

### Trip money

بين العميل والسائق / المتجر / السائق.

WASLA ليست Wallet في الإصدار الأساسي.

### Platform money

اشتراكات السائقين والمتاجر وخدمات المنصة.

هذه يمكن أن تستخدم Tap عبر Payment Abstraction.

## 35.2 Payment Abstraction

```text
PaymentService
 ↓
PSP Adapter
 ↓
Tap
```

والتصميم يسمح لاحقًا بـ:

```text
Moyasar
HyperPay
Checkout
Other PSP
```

دون تغيير Business Logic.

---

# 36. الفواتير

المنصة تحتاج Invoice Domain لـ:

- اشتراك السائق.
- اشتراك المتجر.
- Contract للشركات.
- رسوم الخدمات المستقبلية.

الفواتير تكون منفصلة عن Trip Order.

---

# 37. Data Architecture

## مصدر الحقيقة

PostgreSQL.

## Real-time state

Redis.

## Search

Search Index مستقل قابل لإعادة البناء.

## Media

S3-compatible Object Storage.

## Analytics

Warehouse / OLAP عند الحاجة.

## Events

Kafka عندما يبدأ Event Scale بالارتفاع؛ يتم بناء Domain Events وOutbox من البداية بحيث يمكن إدخال Kafka دون إعادة تصميم المجال.

---

# 38. قاعدة البيانات

في Modular Monolith:

PostgreSQL واحد مع Logical Schemas/Bounded Contexts.

مقترح:

```text
auth
identity
geo
orders
dispatch
matching
drivers
subscriptions
reputation
fraud
referrals
marketplace
stores
catalog
inventory
search
chat
notifications
support
partners
billing
compliance
audit
```

بعد استخراج الخدمات، لا تسمح خدمة أن تقرأ جداول خدمة أخرى مباشرة.

---

# 39. أهم Entities

```text
User
IdentityLink
UserProfile
Role
UserRole
Country
Region
City
District
Zone
LocationHistory
DriverProfile
DriverDocument
Vehicle
DriverSubscription
DriverServiceCapability
Partner
PartnerStaff
Store
StoreBranch
StoreStaff
Product
ProductVariant
InventoryItem
CatalogCategory
MarketplaceOrder
Order
OrderItem
Ride
Delivery
DispatchJob
DispatchOffer
Assignment
Conversation
Message
Translation
Notification
ReputationProfile
ReputationEvent
Rating
Report
FraudCase
ModerationCase
ReferralCode
ReferralAttribution
ReferralReward
PaymentRecord
Invoice
Subscription
SearchDocumentReference
AuditLog
MediaAsset
BroadcastCampaign
```

---

# 40. قواعد البيانات المهمة

## User

```text
id
public_id
status
created_at
updated_at
```

## IdentityLink

```text
id
user_id
provider
provider_subject
username
phone_hash
phone_encrypted
verified_at
first_seen_at
last_seen_at
status
```

## DriverSubscription

```text
driver_id
plan
trial_started_at
trial_ends_at
active_from
expires_at
source
reward_override
status
```

## Order

```text
id
public_id
customer_id
partner_id
store_id
order_type
status
origin
payment_mode
currency
estimated_price
agreed_price
created_at
updated_at
completed_at
```

## Assignment

```text
id
order_id
driver_id
sequence
state
offered_at
accepted_at
expired_at
rejected_at
cancelled_at
```

## ReputationEvent

```text
id
subject_user_id
actor_user_id
source_type
source_id
event_type
score_delta
confidence
evidence_ref
created_at
```

لا يجب تعديل Reputation Score يدويًا من فريق الدعم بلا Event موثق.

---

# 41. Event Bus

الأحداث الأساسية:

```text
identity.user_created.v1
identity.telegram_linked.v1
identity.phone_verified.v1
identity.location_changed.v1

order.created.v1
order.published.v1
order.searching.v1
order.accepted.v1
order.assigned.v1
order.cancelled.v1
order.completed.v1
order.failed.v1

matching.candidates_found.v1
matching.offer_created.v1
matching.offer_expired.v1

assignment.created.v1
assignment.accepted.v1
assignment.rejected.v1
assignment.timed_out.v1

location.driver_updated.v1
location.route_deviation_detected.v1

reputation.rating_submitted.v1
reputation.updated.v1
fraud.risk_detected.v1
fraud.case_created.v1

referral.attributed.v1
referral.qualified.v1
referral.reward_granted.v1

store.created.v1
store.approved.v1
store.suspended.v1
product.created.v1
product.published.v1
inventory.changed.v1

conversation.created.v1
message.sent.v1
message.translated.v1

billing.subscription_created.v1
billing.payment_succeeded.v1
billing.payment_failed.v1
billing.invoice_created.v1

support.ticket_created.v1
support.ticket_escalated.v1
```

كل Event Versioned.

---

# 42. Outbox Pattern

أي Transaction مهمة تنتج Domain Event يجب أن تستخدم Outbox حتى لا يحدث:

```text
DB committed
but event lost
```

النمط:

```text
Business Transaction
        ↓
DB Write + Outbox row
        ↓
Publisher
        ↓
Message/Event Bus
```

---

# 43. Idempotency

كل endpoint ينتج أثرًا غير قابل للتكرار يجب أن يقبل Idempotency Key حيث يلزم.

أمثلة:

```text
Create Order
Accept Assignment
Submit Rating
Create Store Order
Subscribe Driver
Pay Invoice
Webhook
```

---

# 44. API Standards

كل API:

```text
/api/v1/...
```

يجب أن يحتوي على:

```text
request_id
trace_id
user context
version
error code
message
validation errors
```

## Error format

```json
{
  "error": {
    "code": "ORDER_ALREADY_ASSIGNED",
    "message": "The order is already assigned.",
    "request_id": "..."
  }
}
```

---

# 45. API Contract قبل التنفيذ

كل API يبدأ بـ:

```text
OpenAPI Contract
↓
Contract Tests
↓
Implementation
```

لا يتم تغيير endpoint breaking change بدون Version أو Migration Plan.

---

# 46. WebSocket

نستخدم WebSocket للـMini App في:

- Chat.
- Order status.
- Driver location updates.
- Notifications التي تتطلب real-time.

Channels:

```text
ws/orders/{orderId}
ws/conversations/{conversationId}
ws/drivers/{driverId}
```

يجب التحقق من Authorization لكل subscription.

لا يمكن للمستخدم الاشتراك في قناة لا يملك صلاحية رؤيتها.

---

# 47. Authentication & Authorization

نموذج:

```text
Authentication
→ Who are you?

Authorization
→ What can you do?

Context
→ Where can you do it?
```

RBAC + scoped permissions.

أمثلة:

```text
SUPER_ADMIN
COUNTRY_ADMIN
CITY_ADMIN
ZONE_OPERATOR
SUPPORT_AGENT
ESCALATION_OFFICER
FINANCE_OPERATOR
COMPLIANCE_OPERATOR
STORE_OWNER
STORE_MANAGER
STORE_CASHIER
DRIVER
CUSTOMER
```

---

# 48. Security — قواعد إلزامية

- لا Secrets داخل Git.
- Production secrets خارج التطبيق.
- 2FA للمشرفين والمستخدمين ذوي الصلاحيات العالية.
- Protected Branches.
- Mandatory Merge Requests.
- SAST.
- Dependency Scanning.
- Container Scanning.
- Secret Scanning.
- Audit لكل عملية إدارية حساسة.
- Least Privilege.
- لا Production Access للمطورين بشكل افتراضي.

---

# 49. حماية الفكرة والكود

المخاطر التي يجب تصميم النظام ضدها:

1. تسريب الفكرة قبل الإطلاق.
2. نسخ المنتج من المنافسين.
3. سرقة Source Code.
4. Insider Backdoor.
5. تسريب Secrets.
6. اختطاف حسابات GitLab.
7. Dependency compromise.
8. إساءة استخدام صلاحيات Admin.

الإجراءات:

```text
GitLab 2FA
Protected branches
MR approval
CODEOWNERS
Security review
Dependency pinning
SBOM
Secret scanning
Production access control
Audit logging
Backup
Incident response
```

---

# 50. Observability

من البداية:

```text
Logs
Metrics
Tracing
Errors
Alerts
```

التوصية:

```text
OpenTelemetry
Prometheus
Grafana
Loki / ELK-compatible logging
Alertmanager
```

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

# 51. Core Survival Mode

يجب أن تظل المنصة قابلة للعمل حتى لو تعطلت أنظمة ثانوية.

## Tier 0 — Core

```text
Identity
Order
Matching
Dispatch
Assignment
Customer/Driver communication
Order completion
```

## Tier 1

```text
Marketplace
Search
Subscriptions
Reputation
Support
```

## Tier 2

```text
Analytics
AI
Advanced dashboards
Admin live map
Noncritical integrations
```

في حالة الضغط، يمكن تعطيل Tier 2 للحفاظ على Tier 0.

---

# 52. Graceful Degradation

إذا تعطل Search:

```text
fallback to basic query/cache
```

إذا تعطل Maps:

```text
cached route / approximate distance / manual dispatch
```

إذا تعطلت Analytics:

```text
Core orders continue
```

إذا تعطلت Notification Provider:

```text
retry + alternate channel if configured
```

---

# 53. حالات لا يجب أن توقف الطلب

- Dashboard analytics.
- AI model.
- Live Admin Map.
- Reporting.
- Search indexing delay.
- Recommendation engine.
- Secondary SMS provider.

---

# 54. Notifications

القنوات:

```text
Telegram
Mini App / WebSocket
Push-like web/app mechanisms where available
SMS for critical fallback if configured
Email for invoices/reports
```

Notification Engine يملك:

```text
Template
Channel
Priority
Audience
Retry
Deduplication
Delivery status
```

---

# 55. Team Structure

لا يتم توزيع الفريق حسب “ملفات صغيرة”، بل حسب **Bounded Areas** مع عقود واضحة.

الفريق المعتمد:

```text
Team 01 — Identity & Auth
Team 02 — Customer
Team 03 — Driver
Team 04 — Matching
Team 05 — Dispatch
Team 06 — Marketplace
Team 07 — Partner
Team 08 — Admin
Team 09 — Data
Team 10 — DevOps
Team 11 — Security / QA
Team 12 — Integration
```

---

# 56. Team 01 — Identity & Auth

مسؤول عن:

- User.
- IdentityLink.
- Public Wasla ID.
- Telegram Identity Adapter contract.
- Phone normalization/verification.
- Session/token strategy.
- RBAC/permission primitives.
- Recovery.
- Identity History.
- Country/City user profile links.

ملفات أساسية:

```text
services/identity/
services/auth/
packages/identity-contracts/
packages/auth-sdk/
docs/03-domain/identity.md
docs/04-api/auth.md
docs/15-decisions/ADR-identity.md
```

---

# 57. Team 02 — Customer

مسؤول عن:

- Customer Profile.
- Customer Mini App flows.
- Create order UI/logic contract.
- Saved places.
- Customer history.
- Customer view of reputation.
- Customer-side negotiation.
- Customer incident/report flow.

لا يملك Matching logic.

---

# 58. Team 03 — Driver

مسؤول عن:

- Driver Profile.
- Driver documents.
- Vehicle.
- Driver subscription.
- Driver Mini App.
- Driver state.
- Community fallback UI.
- Driver preferences.
- Driver Work City / District / Zone.
- Driver-side order acceptance/rejection.

لا يملك Dispatch algorithm.

---

# 59. Team 04 — Matching

مسؤول عن:

- Candidate search.
- Hard constraints.
- Ranking.
- Fairness.
- Reputation inputs.
- ETA input.
- Driver eligibility.
- Matching configuration.

لا يملك final Assignment state transitions.

---

# 60. Team 05 — Dispatch

مسؤول عن:

- DispatchJob.
- Offer waves.
- Timeouts.
- Assignment.
- Reassignment.
- Community fallback.
- Duplicate acceptance prevention.
- Driver busy/free state transitions coordination.

---

# 61. Team 06 — Marketplace

مسؤول عن:

- Store.
- Catalog.
- Product.
- Inventory.
- Store Staff.
- Marketplace order integration.
- Search indexing contracts.
- Product/store moderation integration.
- Store billing contracts.

---

# 62. Team 07 — Partner

مسؤول عن:

- Partner onboarding.
- Enterprise account.
- Partner API.
- Webhooks.
- Contract configuration.
- B2B SLA.
- Fleet integration.
- Partner Portal.

---

# 63. Team 08 — Admin

مسؤول عن:

- Admin Portal.
- Role-specific dashboards.
- City/Zone controls.
- User management.
- Store moderation.
- Broadcasts.
- Support and escalation views.
- Manual dispatch tools.
- Configuration UI.

---

# 64. Team 09 — Data

مسؤول عن:

- PostgreSQL schemas.
- Redis patterns.
- Event schema registry.
- Outbox.
- Search index pipelines.
- Analytics.
- Data retention.
- Data quality.
- Warehouse.
- Reporting foundations.

---

# 65. Team 10 — DevOps

مسؤول عن:

- GitLab CI/CD.
- Containers.
- Environments.
- IaC.
- Secrets integration.
- Backups.
- Monitoring infrastructure.
- Deployment.
- Scaling.
- Disaster Recovery.

---

# 66. Team 11 — Security / QA

مسؤول عن:

- Test strategy.
- Security standards.
- Threat model.
- SAST/DAST.
- Contract tests.
- E2E.
- Load tests.
- Abuse tests.
- Privacy tests.
- Release gates.

---

# 67. Team 12 — Integration

مسؤول عن:

- Telegram Adapter.
- Maps Provider.
- Tap Provider.
- SMS/Email adapters.
- Translation provider.
- External KYC/Compliance adapters.
- Webhook gateways.
- External partner connectivity.

---

# 68. Repository Structure

المستودع Monorepo.

```text
wasla/
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CODEOWNERS
├── CHANGELOG.md
├── .gitlab-ci.yml
├── .gitignore
├── apps/
│   ├── customer-mini-app/
│   ├── driver-mini-app/
│   ├── partner-mini-app/
│   └── admin-web/
├── bots/
│   ├── customer-bot/
│   ├── driver-bot/
│   └── partner-bot/
├── services/
│   ├── identity/
│   ├── auth/
│   ├── geography/
│   ├── orders/
│   ├── rides/
│   ├── delivery/
│   ├── matching/
│   ├── dispatch/
│   ├── drivers/
│   ├── subscriptions/
│   ├── reputation/
│   ├── fraud/
│   ├── referrals/
│   ├── marketplace/
│   ├── search/
│   ├── chat/
│   ├── translation/
│   ├── notifications/
│   ├── support/
│   ├── partners/
│   ├── billing/
│   ├── compliance/
│   ├── audit/
│   └── analytics/
├── packages/
│   ├── contracts/
│   ├── events/
│   ├── ui/
│   ├── i18n/
│   ├── auth-sdk/
│   ├── telemetry/
│   ├── errors/
│   ├── config/
│   ├── date-time/
│   └── test-utils/
├── infra/
│   ├── terraform/
│   ├── docker/
│   ├── kubernetes/
│   └── environments/
├── scripts/
└── docs/
    ├── 00-rules/
    ├── 01-product/
    ├── 02-architecture/
    ├── 03-domain/
    ├── 04-api/
    ├── 05-events/
    ├── 06-database/
    ├── 07-security/
    ├── 08-infrastructure/
    ├── 09-apps/
    ├── 10-admin/
    ├── 11-partners/
    ├── 12-testing/
    ├── 13-observability/
    ├── 14-runbooks/
    ├── 15-decisions/
    ├── 16-progress/
    └── 17-launch/
```

---

# 69. وثائق إلزامية داخل docs

## 00-rules

```text
ENGINEERING_DOCUMENTATION_LAW.md
DEFINITION_OF_DONE.md
CODE_STYLE.md
GIT_RULES.md
BRANCH_RULES.md
SECURITY_RULES.md
INCIDENT_RULES.md
```

## 01-product

```text
VISION.md
PERSONAS.md
SERVICES.md
USER_FLOWS.md
PRICING_MODEL.md
REFERRAL_MODEL.md
MARKETPLACE_MODEL.md
```

## 02-architecture

```text
SYSTEM_CONTEXT.md
CONTAINERS.md
COMPONENTS.md
DEPLOYMENT.md
DEGRADED_MODES.md
SCALING.md
```

## 03-domain

لكل bounded context وثيقة Domain مستقلة.

## 04-api

OpenAPI + شرح بشري لكل API.

## 05-events

Event catalog + schemas + compatibility policy.

## 06-database

ERD + migrations + retention + indexing.

---

# 70. Architecture Decision Records

كل قرار معماري مهم = ADR.

القالب:

```text
# ADR-XXX

Title:
Status:
Date:
Decision Owners:

Context:

Decision:

Alternatives:

Why:

Trade-offs:

Security Impact:

Operational Impact:

Migration Plan:
```

أمثلة أولية:

```text
ADR-001 Identity decoupled from Telegram
ADR-002 Modular monolith before service extraction
ADR-003 PostgreSQL as source of truth
ADR-004 Matching / Dispatch separation
ADR-005 Reputation as core domain
ADR-006 Marketplace as core domain
ADR-007 Payment abstraction
ADR-008 Telegram adapter isolation
ADR-009 Event outbox
ADR-010 Community Driver fallback
```

---

# 71. Phase 00 — Repository Foundation

## الهدف

وضع هذه الوثيقة داخل GitLab وبناء هيكل المستودع وقواعد العمل.

## الفرق

- جميع الفرق يراجعون قواعد المستودع.
- Team 10 يبني CI skeleton.
- Team 11 يبني quality/security gates.
- Team 12 يثبت Telegram integration contract skeleton.
- Team 09 يثبت DB migration conventions.

## المخرجات

```text
Monorepo created
Docs skeleton created
CI pipeline skeleton
Protected branches
CODEOWNERS
Issue templates
MR template
Architecture ADR template
Migration convention
Testing convention
```

## Exit Gate

```text
CI passes
No secrets in repo
All teams can clone/build/test
Docs structure exists
Main branch protected
MR template active
```

---

# 72. Phase 01 — Identity Foundation

## الهدف

تشغيل User + Wasla ID + Identity Links.

## Teams

01 + 09 + 10 + 11 + 12

## المطلوب

- User creation.
- Wasla Public ID.
- Internal UUID.
- Telegram linkage.
- Username history.
- Phone capture when available/consented.
- Recovery design.
- Session/auth primitives.

## Exit Gate

إنشاء مستخدم من Telegram وبقاء هويته مستقرة عبر تغيير Username.

---

# 73. Phase 02 — Geography & Localization Foundation

## الفرق

01 + 02 + 03 + 06 + 07 + 08 + 09

## المطلوب

- Country.
- Region.
- City.
- District.
- Zone.
- User location history.
- i18n.
- Arabic/English/Urdu.
- Search-ready multilingual fields.

## Exit Gate

المستخدم يستطيع تغيير موقعه دون إنشاء حساب جديد، وكل Module يستعمل Geo IDs وليس أسماء نصية فقط.

---

# 74. Phase 03 — Telegram Channel Foundation

## الفرق

12 + 01 + 02 + 03 + 07

## المطلوب

- Three bots.
- Commands.
- Deep links.
- Mini App launch.
- Identity bootstrap.
- Retry/de-duplication.
- Bot adapter abstraction.
- Group adapter.

## Exit Gate

كل Bot يفتح Mini App المناسبة ويمكن استبدال Telegram adapter في الاختبارات بMock Adapter.

---

# 75. Phase 04 — Customer Core

## الفرق

02 + 01 + 11 + 12

## المطلوب

- Customer profile.
- Create ride request.
- Create delivery request.
- Pickup/dropoff.
- Optional price.
- Vehicle selection.
- Saved places.
- Order preview.

## Exit Gate

عميل ينشئ Order صالحًا ويصل إلى Order Engine دون أي Matching فعلي بعد.

---

# 76. Phase 05 — Driver Core

## الفرق

03 + 01 + 11 + 12 + 09

## المطلوب

- Driver registration.
- Documents.
- Vehicle.
- Trial subscription.
- Active/Busy/Offline states.
- Service capabilities.
- Work City / District / Zone.
- Community mode.

## Exit Gate

وجود Driver profile مكتمل وقابل للإدخال إلى Candidate pool.

---

# 77. Phase 06 — Order Engine

## الفرق

02 + 03 + 04 + 05 + 09 + 11

## المطلوب

- State machine.
- Order IDs.
- Assignment references.
- Cancellation states.
- Audit.
- Idempotency.
- Outbox.

## Exit Gate

يمكن إنشاء Order وتغييره عبر الحالة دون حالات مستحيلة.

---

# 78. Phase 07 — Dispatch & Matching MVP

## الفرق

04 + 05 + 03 + 02 + 09 + 11

## المطلوب

- Candidate filtering.
- Ranking.
- Dispatch waves.
- Offer timeout.
- Accept/reject.
- Busy/free transitions.
- Fallback to community group.

## Exit Gate

Request كامل من Customer إلى Driver assignment في بيئة اختبار حقيقية.

---

# 79. Phase 08 — Negotiation & Chat

## الفرق

02 + 03 + 12 + 09 + 11

## المطلوب

- Conversation.
- Message.
- Countdown.
- Negotiation state.
- Price agreement.
- Translation.
- Closing conversation.

## Exit Gate

عميل وسائق يمكنهما التفاوض والتوافق على السعر وتسجيله في Order.

---

# 80. Phase 09 — Reputation + Fraud Foundation

## الفرق

01 + 04 + 05 + 08 + 09 + 11

## المطلوب

- Ratings.
- Reputation events.
- Score.
- Status labels.
- Reports.
- Fraud signals.
- Moderation cases.
- History.

## Exit Gate

كل Completed Order يستطيع إنتاج Reputation events، ويمكن للدعم مراجعة سبب التغير.

---

# 81. Phase 10 — Driver Subscription & Referral

## الفرق

03 + 01 + 09 + 12 + 08 + 11

## المطلوب

- 250/250/400 plans.
- One month trial.
- Billing contract.
- Tap adapter.
- Referral code.
- Referral attribution.
- Qualified referral.
- Rewards.
- Community transition.

## Exit Gate

السائق يستطيع الانتقال Trial → Active → Expired → Community، والإحالات لا تكافئ النشاط الوهمي.

---

# 82. Phase 11 — Marketplace Foundation

## الفرق

06 + 01 + 07 + 02 + 03 + 09 + 11

## المطلوب

- Store.
- Store owner.
- Store staff.
- Product.
- Categories.
- Inventory.
- Product moderation.
- Store approval.
- Store URLs/deep links.

## Exit Gate

مستخدم قائم يستطيع إنشاء Store من هويته الحالية، إضافة منتج، وطلب مراجعة المتجر.

---

# 83. Phase 12 — Marketplace Search

## الفرق

06 + 09 + 12 + 11

## المطلوب

- Multilingual search.
- Store search.
- Product search.
- Geo search.
- Ranking.
- Search history.
- Index rebuild.

## Exit Gate

منتج منشور يمكن العثور عليه بالعربي والإنجليزي على الأقل مع التصميم الجاهز لإضافة بقية اللغات.

---

# 84. Phase 13 — Store Orders + Delivery

## الفرق

06 + 05 + 04 + 03 + 02 + 07

## المطلوب

- Store order.
- Inventory reserve.
- Delivery request.
- Driver assignment.
- Store fulfillment.
- Delivery completion.
- Payment evidence record.

## Exit Gate

شراء منتج → تجهيز → إسناد سائق → Pickup → Delivery → Completion.

---

# 85. Phase 14 — Partner / Enterprise

## الفرق

07 + 06 + 05 + 04 + 12 + 11

## المطلوب

- Partner onboarding.
- API keys / OAuth strategy.
- Webhooks.
- Idempotency.
- Fleet concept.
- SLA.
- Contract pricing.
- Batch orders.
- Multi-stop.

## Exit Gate

Partner يستطيع إنشاء طلب عبر Portal أو API وتتبع حالته.

---

# 86. Phase 15 — Admin Operations

## الفرق

08 + 01 + 03 + 04 + 05 + 06 + 07 + 11

## المطلوب

- User search.
- User moderation.
- Driver moderation.
- Store moderation.
- Reputation view.
- Fraud view.
- Manual dispatch.
- Broadcast.
- City/Zone configuration.
- Role management.

## Exit Gate

الإدارة تستطيع تشغيل الحالات اليومية دون تعديل قاعدة البيانات يدويًا.

---

# 87. Phase 16 — Support & Escalation

## الفرق

08 + 02 + 03 + 11 + 12

## المطلوب

- Ticketing.
- Support group integration.
- Escalation group integration.
- User action.
- Order context.
- Evidence.
- Audit.

## Exit Gate

نزاع كامل من العميل/السائق → Support → Escalation → Resolution → Reputation.

---

# 88. Phase 17 — Billing & Store Platform Fees

## الفرق

09 + 12 + 07 + 06 + 08 + 11

## المطلوب

- Invoice.
- Subscription billing.
- Tap.
- Store fixed/variable fee.
- Refund for platform subscriptions where applicable.

## Exit Gate

Billing كامل قابل للتدقيق ولا يختلط بأموال Trip Settlement.

---

# 89. Phase 18 — Observability & Resilience

## الفرق

10 + 11 + 09 + 12

## المطلوب

- OpenTelemetry.
- Metrics.
- Logs.
- Tracing.
- Alerts.
- Retry.
- Circuit breakers.
- Dead-letter handling.
- Backups.
- Restore drill.

## Exit Gate

يمكن تعطيل خدمة ثانوية دون إسقاط Core Orders، ويمكن استعادة النظام من Backup وفق RTO/RPO المعتمدين.

---

# 90. Phase 19 — Security Hardening

## الفرق

11 + 10 + 01 + 12

## المطلوب

- Threat model.
- Security scan.
- Pen test fixes.
- Secret rotation.
- Admin hardening.
- Production access controls.
- Audit integrity.
- Abuse scenarios.

## Exit Gate

لا توجد ثغرات حرجة مفتوحة، والأسرار لا توجد في Git، وProduction access مضبوط.

---

# 91. Phase 20 — Saudi Launch Readiness

## الفرق

كل الفرق حسب المجال.

## قبل الإطلاق يجب تحقق:

```text
Identity
Customer
Driver
Order
Matching
Dispatch
Community fallback
Reputation
Support
Admin
Marketplace basic
Subscriptions
Billing
Monitoring
Backup
Security
```

## لا يدخل النظام الإنتاج إلا بعد:

- E2E pass.
- Load baseline.
- Disaster recovery proof.
- Support runbook.
- Rollback runbook.
- Incident runbook.
- Documentation complete.

---

# 92. Phase 21 — Gulf / Egypt / Jordan Expansion

الهدف ليس نسخ المدينة.

يجب أن تصبح Configuration:

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

ثم إضافة الدولة دون تعديل Core Domain إلا في الحالات النظامية التي تحتاج Adapter/Policy.

---

# 93. Phase 22 — Global Expansion

إضافة:

- Country Packs.
- New Telegram/localization policies.
- Local payment adapters.
- Local KYC adapters.
- Local Maps adapters.
- Local compliance.
- Timezone.
- Currency.
- Tax.
- Regional Search.

---

# 94. Phase 23 — Channel Independence

عندما يصبح Telegram unavailable في سوق معينة:

```text
Wasla Core
      │
      ├── Telegram Adapter
      ├── Web Adapter
      ├── Mobile Adapter
      └── Future Channels
```

لا تعاد كتابة:

- Order Engine.
- Reputation Engine.
- Marketplace.
- Dispatch.
- Matching.

---

# 95. Phase 24 — Service Extraction

لا نفصل Microservice لأن الرسم جميل.

نفصل الخدمة فقط عندما يوجد سبب واضح مثل:

```text
Independent scaling
Independent deployment
Different runtime profile
Team ownership boundary
Reliability isolation
Security isolation
Traffic profile
```

الخدمات الأكثر ترشيحًا للاستخراج:

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

# 96. قواعد الانتقال من Modular Monolith إلى Services

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

إذا فشل أي شرط، لا يتم الاستخراج.

---

# 97. Testing Pyramid

```text
Unit Tests
    ↓
Integration Tests
    ↓
Contract Tests
    ↓
Component Tests
    ↓
E2E Tests
    ↓
Load Tests
    ↓
Security / Abuse Tests
```

## حد أدنى موصى به

```text
Core Domain coverage: high
Critical paths: near-total branch coverage
Public APIs: contract covered
Order lifecycle: E2E covered
Payment subscription: E2E covered
Reputation: deterministic rule tests
Dispatch: concurrency tests
```

لا نعتمد نسبة Coverage عامة كبديل للحكم الهندسي.

---

# 98. Concurrency Tests

مطلوب خصوصًا لـ:

- Two drivers accept same order.
- Duplicate webhook.
- Two cancellations.
- Subscription renewal race.
- Inventory race.
- Referral reward race.
- Reputation double event.

---

# 99. Data Integrity Rules

- Foreign keys حيثما تناسب.
- Unique constraints.
- Optimistic/pessimistic locking عند الحاجة.
- Idempotency.
- Transaction boundaries.
- No silent state transitions.
- No manual production SQL except controlled runbooks.

---

# 100. Configuration

كل القيم التشغيلية الحساسة تكون Configuration:

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

---

# 101. Feature Flags

كل Feature خطرة أو تجريبية تستخدم Feature Flag.

مثال:

```text
marketplace.store_creation
smart_eta
live_admin_map
community_dispatch
ai_translation
new_matching_v2
```

يمكن تفعيلها حسب:

```text
Country
City
Zone
User segment
Partner
Percentage rollout
```

---

# 102. Runbooks

لكل Incident متوقع يجب ملف Runbook:

```text
Telegram down
Maps down
Tap down
Redis degraded
DB failover
Kafka lag
WebSocket overload
Search unavailable
Bot webhook failure
Mass notification failure
Fraud spike
Data inconsistency
```

---

# 103. Release Process

```text
Feature complete
↓
Tests pass
↓
Docs updated
↓
Security checks
↓
MR review
↓
Staging
↓
Smoke tests
↓
Canary / controlled release
↓
Production
↓
Monitoring
↓
Release note
```

Rollback يجب أن يكون معروفًا قبل Deploy.

---

# 104. GitLab Rules

## Main branch

Protected.

لا Push مباشر.

## Merge Request

يجب أن يحتوي:

```text
What
Why
Scope
Tests
Migration
Docs
Security Impact
Rollback Plan
```

## Commit

رسالة واضحة.

مثال:

```text
feat(order): add multi-stop delivery state
fix(dispatch): prevent duplicate assignment
chore(ci): add dependency scanning
```

---

# 105. Merge Request Definition of Done

```text
[ ] Code complete
[ ] Tests complete
[ ] API contract updated
[ ] Event contract updated
[ ] DB migration added if needed
[ ] Docs updated
[ ] Audit impact checked
[ ] Security impact checked
[ ] Observability added
[ ] Rollback understood
[ ] Reviewer comments resolved
```

---

# 106. Progress Ledger

يجب أن يحتوي المستودع:

```text
docs/16-progress/MASTER_PROGRESS.md
```

وفيه كل مرحلة:

```text
Phase
Status
Exit Gate
Teams
Open Blockers
Last Update
Evidence
Next Step
```

ولا يسمح بعبارة “Done” بدون Evidence.

---

# 107. قالب تحديث المطور

يوضع في:

```text
CONTRIBUTING.md
```

القالب:

```text
## Work Update

### Completed
- 

### Changed
- 

### Files
- 

### Services
- 

### API/Event Changes
- 

### Tests
- 

### Documentation
- 

### Not Completed
- 

### Blockers
- 

### Next Step
- 

### Risks
- 
```

---

# 108. واجبات الفريق في كل مرحلة

كل فريق له مهمتان متوازيتان:

```text
Build
+
Document
```

وإذا كانت مرحلة ما تعتمد على Team آخر، لا تبدأ Business Implementation قبل توفر Contract المطلوب.

لكن يمكن للفريق العمل على:

- Interfaces.
- Schemas.
- Mock services.
- Contract tests.

بالتوازي.

---

# 109. أسلوب العمل بين الفرق

## Contract First

الفريق المنتج لخدمة يكتب:

```text
API Contract
Event Contract
Data Contract
Error Contract
```

ثم الفريق المستهلك يطور Mock/Contract Client.

هذا يسمح بتوازي العمل دون انتظار اكتمال الخدمة.

---

# 110. مثال على Parallel Stage

في Phase 06 يمكن:

```text
Team 02 → Customer Order API consumer
Team 03 → Driver order state consumer
Team 04 → Matching interface
Team 05 → Dispatch interface
Team 09 → Order DB schema / Outbox
Team 11 → Contract tests
Team 12 → Telegram adapter
```

كلهم يعملون بالتوازي على Contracts، ثم الربط النهائي يتم عند Exit Gate.

---

# 111. ما الذي لا يجوز للفريق فعله

- إدخال Secret في Git.
- تعديل Production DB يدويًا بلا Runbook.
- تغيير API بلا تحديث Contract.
- تغيير Event schema بلا Versioning.
- الوصول المباشر لجدول خدمة أخرى بعد استخراجها.
- إضافة Library كبيرة بلا مبرر.
- إضافة Microservice بلا ADR.
- تغيير Business Rule دون وثيقة.
- حذف Audit trail لإخفاء أثر.
- اعتبار “الكود يعمل عندي” نجاحًا.

---

# 112. Core UX Principles

المنتج يجب أن يكون:

- سريع.
- واضح.
- قليل النقرات.
- لا يعلق بصمت.
- كل انتظار له Feedback/Countdown/Progress.
- الأخطاء تشرح ماذا يستطيع المستخدم فعله الآن.
- الأعمال الثقيلة في Mini App وليس في Bot message flow.

---

# 113. Customer Home UX

المستخدم يصل إلى:

```text
🚗 اطلب مشوار
📦 اطلب توصيل
🛍 تصفح المتاجر
🔎 ابحث
📋 طلباتي
⭐ سمعتي
👤 حسابي
```

والترتيب قابل للتجربة A/B لاحقًا.

---

# 114. Driver Home UX

```text
🟢 حالة العمل
📥 الطلبات
📍 مناطق العمل
💳 الاشتراك
⭐ السمعة
📊 الأداء
👤 الملف
```

الطلبات غير المشتركة تصل في Community Group؛ الطلبات الخاصة بالسائق المشترك داخل Mini App/Bot flow.

---

# 115. Partner Home UX

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

# 116. Marketplace UX

التصميم لا يجعل المستخدم يختلط عليه الفرق بين:

```text
طلب مشوار
طلب توصيل
شراء من متجر
```

هذه ثلاثة Entry Points واضحة.

---

# 117. Search UX

بحث واحد قادر على:

```text
Products
Stores
Services
```

مع فلاتر:

```text
Near me
Category
Price
Rating
Availability
Delivery
```

---

# 118. Notifications UX

يجب تصنيف الإشعار:

```text
ACTION_REQUIRED
IMPORTANT
INFO
MARKETING
```

ولا ترسل Marketing بنفس مستوى SOS/Trip state.

---

# 119. SOS

SOS مجاني.

الإجراء يتضمن حسب التكوين:

```text
Emergency action
Share location
Support escalation
Incident record
Trip context
```

لا تبنى آلية SOS على “رسوم”.

---

# 120. مشاركة الرحلة

ينتج رابط مشاركة محدود الصلاحية.

يحتوي الحد الأدنى:

```text
Order/Trip reference
Driver public display name/identity allowed by policy
Vehicle summary
ETA
Current approximate position
Status
```

ولا يكشف البيانات الحساسة.

---

# 121. Broadcast Safety

أي Broadcast جماعي:

- يجب أن يكون Audience واضحًا.
- Preview قبل الإرسال.
- صلاحية مناسبة.
- Rate limiting.
- Audit.
- Delivery metrics.

---

# 122. Data Privacy

بيانات شديدة الحساسية:

```text
Identity docs
Phone
Government identifiers
Location history
Payment metadata
Fraud evidence
Support evidence
```

يجب:

- تشفير البيانات المناسبة.
- عزل الصلاحيات.
- تسجيل الوصول.
- الاحتفاظ وفق سياسة.
- منع كشفها في logs.

---

# 123. Logs ممنوع أن تحتوي

- OTP.
- Tokens.
- Full phone numbers.
- Identity numbers.
- Payment secrets.
- Full private messages.

يتم masking/redaction.

---

# 124. Data Retention

القيم النهائية يحددها Compliance/Legal حسب الدولة.

لكن التصميم يجب أن يدعم Retention Policies لكل نوع:

```text
GPS
Messages
Audit Logs
Documents
Orders
Payments
Fraud evidence
```

---

# 125. Analytics

المقاييس الأساسية:

```text
Orders Created
Orders Completed
Fill Rate
Matching Success
Dispatch Time
Acceptance Rate
Cancellation Rate
ETA Accuracy
Driver Utilization
Customer Repeat Rate
Marketplace Search-to-Order
Store Activation
Referral Conversion
Contribution Margin where applicable
```

---

# 126. CEO / Operations KPIs

لوحة أساسية:

```text
Fill Rate
ETA Accuracy
Cancellation Rate
Driver Acceptance
Driver Utilization
Customer Repeat Rate
Store Conversion
Referral Conversion
Support Response Time
Incident Rate
```

---

# 127. Performance Targets

لا نفترض أرقامًا نهائية قبل Load Testing.

يجب إنشاء Performance Budget لكل API حرج.

الهدف هو:

```text
Fast
Predictable
Observable
Degradable
```

وليس رقمًا تسويقيًا مثل “1M concurrent” بلا workload model.

---

# 128. Scalability Path

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

# 129. Multi-Country Architecture

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

---

# 130. Country Isolation Strategy

لا ننسخ الكود لكل دولة.

نستخدم:

```text
Shared Core
+
Country Policies
+
Country Adapters
```

مثال:

```text
CompliancePolicy.sa
CompliancePolicy.ae
CompliancePolicy.eg
```

---

# 131. AI Seeds

AI ليس شرطًا لتشغيل Core.

لكن نزرع منذ البداية البيانات اللازمة لـ:

- Smart ETA.
- Demand Forecasting.
- Fraud models.
- Matching optimization.
- Translation assistance.
- Support classification.
- Marketplace ranking.

لا يسمح لأي AI أن يغير قرارًا حساسًا بلا Policy/Explainability/Override حيث يكون ذلك مطلوبًا.

---

# 132. AI Integration Boundary

```text
AI Gateway
 ├── ETA Model
 ├── Fraud Model
 ├── Support Model
 ├── Ranking Model
 └── Translation Model
```

يمكن استبدال النموذج دون تغيير Domain Services.

---

# 133. Search Intelligence

لاحقًا:

- Synonym engine.
- Transliteration.
- Semantic search.
- Image similarity.
- Personalized ranking.

هذه ليست شرطًا لأول تشغيل للبحث الأساسي.

---

# 134. Marketplace Growth Loop

التصميم المقصود:

```text
User
 ↓
Store
 ↓
Share Store Link
 ↓
New Customer
 ↓
Search
 ↓
Purchase
 ↓
Delivery
 ↓
New Telegram User
 ↓
More Marketplace usage
```

هذه دورة نمو مقصودة، وليست مجرد صفحة متجر.

---

# 135. Driver Growth Loop

```text
Driver joins
 ↓
Trial
 ↓
Receives orders
 ↓
Invites customers/drivers
 ↓
Qualified referrals
 ↓
Subscription discount/free
 ↓
Higher participation
 ↓
Better supply
```

Anti-abuse يمنع التلاعب.

---

# 136. Customer Growth Loop

```text
Free Customer
 ↓
Ride / Delivery / Store
 ↓
Good experience
 ↓
Share trip/store/product
 ↓
New user
```

---

# 137. Community Growth Loop

```text
Strong user
 ↓
High contribution
 ↓
Trusted
 ↓
Community role
 ↓
Support / moderation / operations
 ↓
Possible paid role
```

الترقية الحساسة تتطلب مراجعة بشرية.

---

# 138. Manual Dispatch

Admin يجب أن يستطيع عند الضرورة:

```text
Open Order
→ View eligible drivers
→ Select Driver
→ Confirm
```

كل Manual Assignment يسجل:

```text
actor
reason
previous state
new state
timestamp
```

---

# 139. Admin Config System

الإدارة تستطيع تعديل:

- Service enable/disable.
- Zone service.
- Subscription plans.
- Matching weights.
- Dispatch timeouts.
- Referral thresholds.
- Broadcast audiences.
- Store rules.
- Feature flags.

لكن Config نفسها Versioned/Audited.

---

# 140. Critical Administrative Actions

تحتاج تأكيدًا أو صلاحية خاصة:

- Permanent Block.
- Unblock high-risk identity.
- Change billing policy.
- Change matching weights globally.
- Modify reputation manually.
- Export sensitive data.
- Delete evidence.

ويفضل Two-Person Approval للأفعال الأعلى خطورة.

---

# 141. API Rate Limits

يجب أن تكون حسب:

```text
User
IP
Client
Partner
Endpoint
Country
```

والـAdmin والـInternal Service لها سياسات منفصلة.

---

# 142. Queue Strategy

لا نستخدم HTTP request لمعالجة عمل طويل.

أمثلة:

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

---

# 143. Object Storage

كل MediaAsset يملك:

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

المستندات الحساسة لا تستخدم public URLs مباشرة.

---

# 144. File Upload Security

- File type validation.
- Size limit.
- Malware scan where available.
- Private storage.
- Signed URLs.
- Access audit.
- Metadata stripping where necessary.

---

# 145. Telegram Groups Automation

Group Adapter يدعم:

```text
Join/leave state
Order announcement
Accept callback
Claim lock
Moderator signals
Escalation
Support command
```

ولا يضع Business Logic داخل Group Message Handler مباشرة.

---

# 146. Group Order Announcement

رسالة مفاهيمية:

```text
🚗 مشوار متاح

من: [المنطقة]
إلى: [المنطقة]
نوع السيارة: [..]
السعر المعروض: [..] SAR
حالة العميل: [تصنيف السمعة]

[قبول الطلب]
```

البيانات الحساسة لا تظهر.

---

# 147. Group Safety

إذا كان هناك Chat داخل Group، الهدف هو عدم استخدام Group للتفاوض.

الـGroup مجرد **Dispatch Channel**.

بعد الضغط على قبول:

```text
Group
↓
Mini App
↓
Private conversation
```

---

# 148. Search Index Integrity

لا يعتبر Search Index مصدر حقيقة.

إذا حذف أو فسد:

```text
PostgreSQL source
↓
Rebuild index
```

---

# 149. Inventory Integrity

المخزون الحقيقي يجب ألا يعتمد على Search Index.

القرار النهائي للـInventory في transactional store.

---

# 150. Order vs Marketplace Order

```text
MarketplaceOrder
↓
Order
↓
Delivery
```

هذا يسمح لاحقًا بفصل Marketplace Checkout عن Logistics Dispatch دون كسر Delivery.

---

# 151. Store Delivery Pricing

Pricing Engine لاحقًا يمكن أن يأخذ:

```text
distance
vehicle
zone
weight
volume
priority
time
multi-stop
```

ويعيد:

```text
estimated_delivery_fee
recommended_driver_payout
```

لكن الدفع الفعلي للرحلة لا يمر عبر Wallet في الإصدار الأساسي.

---

# 152. Driver Busy State

بعد قبول طلب:

```text
AVAILABLE
↓
RESERVED
↓
BUSY
↓
COMPLETING
↓
AVAILABLE
```

الانتقالات atomic.

سائق Busy لا يدخل Matching لطلبات متعارضة إلا إذا كان نوع الخدمة يسمح بذلك مستقبلًا.

---

# 153. Customer Availability

عميل لديه Order مفتوح قد يمنع إنشاء Order آخر لنفس الخدمة إذا كانت السياسة لا تسمح بالتوازي.

هذا يجب أن يكون Configuration وليس hard-coded.

---

# 154. Cancellation Scoring

الإلغاء ينتج Event.

القرار يعتمد على:

```text
who cancelled
when
before/after acceptance
how long driver traveled
cost / damage
pattern
previous cancellations
```

وقد يؤثر على Reputation.

---

# 155. No-show

يجب أن يكون كيانًا أو Event واضحًا.

```text
Customer No-show
Driver No-show
Store not ready
Pickup unavailable
```

حتى يمكن إدخاله في Reputation وAnalytics.

---

# 156. Audit Model

كل فعل حساس:

```text
actor_id
actor_role
action
entity_type
entity_id
before_state
after_state
reason
metadata
created_at
```

Audit append-only منطقيًا.

---

# 157. Incident Management

كل Incident إنتاجي:

```text
Detected
Acknowledged
Contained
Resolved
Reviewed
Closed
```

يجب أن ينتج Postmortem للحوادث المهمة.

---

# 158. Postmortem

القالب:

```text
Impact
Timeline
Root Cause
Contributing Factors
Detection
Response
Resolution
Why tests missed it
Preventive actions
Documentation updates
```

ولا نبحث عن “شخص مذنب”، بل عن فشل العملية إلا في حالة خرق أمني متعمد.

---

# 159. Documentation Ownership

كل وثيقة يجب أن تحمل:

```text
Scope
Last Updated
Status
Related Code
Related Team
```

والـCode هو المرجع التنفيذي؛ الوثيقة هي المرجع المعرفي، ويجب ألا يتناقضا.

---

# 160. Definition of Ready

قبل بدء أي Feature:

```text
Problem defined
Acceptance criteria
Dependencies
API contract if needed
Data changes
Security impact
Observability impact
Failure mode
Owner team
```

---

# 161. Definition of Done

```text
Implementation
Tests
Docs
Observability
Security
Migration
Rollback
Review
Evidence
```

---

# 162. المرحلة صفر — ترتيب التنفيذ داخل المستودع

الترتيب الأولي:

```text
1. هذا الدليل داخل /docs
2. Repo skeleton
3. CI
4. Protected branches
5. Database migration system
6. Local dev environment
7. Identity contracts
8. Telegram adapter contracts
9. Test harness
10. Logging/Tracing baseline
```

لا يتم بناء واجهة تجارية كاملة قبل وجود هذه الأساسات.

---

# 163. Local Development Standard

كل Developer يجب أن يستطيع:

```text
clone
install
start dependencies
run migrations
run tests
start apps
```

بدون طلب أسرار Production.

Use local/mock providers:

```text
Mock Telegram
Mock Maps
Mock Tap
Mock SMS
```

---

# 164. Environments

على الأقل:

```text
local
ci
staging
production
```

لاحقًا:

```text
sandbox / regional environments
```

---

# 165. Database Migrations

كل Migration:

```text
version
purpose
up
rollback strategy
data impact
```

لا Migration تغيّر بيانات ضخمة في Production بلا خطة تشغيلية.

---

# 166. Seed Data

نحتاج Seed data لـ:

- Countries.
- Saudi regions.
- Saudi cities.
- Initial zones where available.
- Languages.
- Vehicle types.
- Order types.
- Permissions.
- Feature flags.

---

# 167. Seed Data Rule

لا تحفظ IDs ثابتة داخل Business Logic.

استخدم Codes مستقرة.

مثال:

```text
vehicle.economy
vehicle.family
vehicle.luxury
```

---

# 168. Localization

كل النصوص الخارجية من Translation Catalog.

ممنوع Hard-code:

```text
Arabic text inside business service
```

---

# 169. Translation Quality

النظام يحفظ:

```text
original
translated
source_language
target_language
confidence/provider
```

وعند تعذر الترجمة:

> اعرض النص الأصلي.

لا تجعل فشل الترجمة يفشل الرسالة الأساسية.

---

# 170. Accessibility

Mini Apps وAdmin/Web يجب أن تراعي:

- Keyboard navigation حيث ينطبق.
- Contrast.
- Screen reader semantics.
- Large touch targets.
- RTL.

---

# 171. Performance UX

لا توجد شاشة انتظار فارغة.

كل عملية طويلة تعرض:

```text
Skeleton
Progress
Countdown
Retry
Current State
```

---

# 172. Security UX

لا تعرض للمستخدم رسالة عامة مثل:

> Error 500.

بل:

```text
لم نتمكن من إسناد الطلب الآن.
نحاول البحث عن سائق آخر…
```

لكن logs تحتوي تفاصيل تقنية.

---

# 173. Documentation Navigation

README الرئيسي يجب أن يوجه المطور إلى:

```text
Getting Started
Architecture
Domain
API
Events
Database
Security
Runbooks
Progress
```

---

# 174. أول يوم للمطور الجديد

يجب أن يستطيع قراءة:

```text
README
ENGINEERING_DOCUMENTATION_LAW
ARCHITECTURE
TEAM AREA
CURRENT PHASE
```

ثم تشغيل المشروع محليًا.

---

# 175. Onboarding Acceptance

المطور الجديد ينجز:

```text
Local build
Test pass
Read architecture
Read domain
Open sample PR
Update documentation
```

ولا يبدأ في Core مباشرة قبل ذلك.

---

# 176. Future Mobile Apps

لا يتم تنفيذ Driver Native App في نطاق هذه الخطة.

إذا تغير القرار مستقبلًا:

```text
Driver Adapter
```

يستهلك نفس Driver APIs/Events.

لا تتم إعادة بناء Driver Domain.

---

# 177. Future Web Customer

بنفس الطريقة:

```text
Customer Web Adapter
```

يستهلك Core نفسه.

---

# 178. Legal/Compliance Adapter

جهات التحقق الحكومية أو مزودو التحقق الخارجيين يدخلون عبر:

```text
Compliance Provider Interface
```

ولا يتم ربط Driver Domain مباشرة بنظام خارجي واحد.

---

# 179. External Provider Rule

كل مزود خارجي:

```text
Adapter
Health Check
Retry Policy
Timeout
Fallback
Monitoring
Contract Test
```

---

# 180. Provider Failure

لا يسمح لمزود واحد بإسقاط Core إن كانت الخدمة قابلة للتشغيل بدونه.

---

# 181. Launch Checklist

```text
[ ] Identity
[ ] Telegram Bots
[ ] Mini Apps
[ ] Customer
[ ] Driver
[ ] Order Engine
[ ] Matching
[ ] Dispatch
[ ] Community fallback
[ ] Reputation
[ ] Referral
[ ] Driver subscription
[ ] Marketplace basic
[ ] Search
[ ] Store moderation
[ ] Support
[ ] Admin
[ ] Billing
[ ] Tap
[ ] Maps
[ ] Chat
[ ] Translation
[ ] Monitoring
[ ] Backup
[ ] Security
[ ] Runbooks
[ ] Documentation
```

---

# 182. Production Freeze Rules

قبل كل Release كبير:

- Freeze migrations الخاصة بالمسارات غير الضرورية.
- مراجعة Open Incidents.
- مراجعة DB changes.
- Backup verified.
- Rollback verified.
- Metrics dashboard ready.

---

# 183. Post-Launch Feedback Loop

بعد كل استخدام حقيقي:

```text
Usage
↓
Metrics
↓
Incidents
↓
Support signals
↓
Reputation signals
↓
Product decisions
↓
ADR if architecture changes
```

---

# 184. متى نضيف Microservice؟

لا لأن “المشروع كبير”.

بل عند وجود:

```text
Measured bottleneck

OR

Security isolation need

OR

Independent scaling need

OR

Independent team release need
```

---

# 185. متى نضيف Kafka؟

عندما تصبح Events/streams تحتاج:

- Durable stream processing.
- Multiple consumers.
- Replay.
- Analytics scale.
- Integration scale.

حتى ذلك الحين، Outbox + queue/event abstraction يكفيان.

---

# 186. متى نضيف Kubernetes؟

عندما تكون:

```text
Deployment complexity
Scale
Availability
Multi-service operations
```

تبرر ذلك، وليس لمجرد اكتمال الصورة المعمارية.

---

# 187. متى نضيف Multi-Region؟

عندما توجد متطلبات:

- Geographic latency.
- Regulatory isolation.
- Availability.
- Scale.

وقبلها نستخدم architecture قابلة للانتقال.

---

# 188. مبدأ “Make Illegal States Unrepresentable”

حاول أن تمنع الأخطاء بالـdomain types/state machines بدل الاعتماد على المطور.

مثال:

لا تسمح لـCompleted Order بالانتقال إلىSearching إلا عبر Recovery workflow واضح.

---

# 189. مبدأ “Audit Before Automation”

أي Automation حساسة يجب أن تسجل:

```text
why
what
which rule
what evidence
what result
```

وهذا مهم خصوصًا Reputation/Fraud/Moderation.

---

# 190. مبدأ “Human Override”

الأنظمة الآلية تستطيع اقتراح:

```text
Suspend
Warn
Escalate
```

لكن القرارات الحساسة القابلة للخطأ يجب أن تملك Human Override ومسار Appeal.

---

# 191. مبدأ “Fairness by Design”

Matching لا يقتصر على الأقرب.

يتوازن بين:

```text
ETA
Quality
Reliability
Fair Distribution
```

---

# 192. مبدأ “Reputation is Recoverable”

لا نحكم على مستخدم إلى الأبد بناء على واقعة واحدة.

مع وجود حالات حرجة ثابتة حسب سياسات الأمان والقانون.

---

# 193. مبدأ “Core Survives Secondary Failure”

المنصة يجب أن تستمر في الطلبات الأساسية مع فقد بعض الخدمات الثانوية.

---

# 194. مبدأ “Document the Why”

كل قرار معماري يجب أن يشرح:

> لماذا؟

لا يكفي:

> استخدمنا Redis.

بل:

> استخدمناه لهذه الحالة بسبب هذا النمط من الوصول، وهذا هو البديل الذي رفضناه ولماذا.

---

# 195. مبدأ “No Hidden Coupling”

أي اعتماد بين فرق يجب أن يكون ظاهرًا في:

```text
Contract
Docs
Dependency Map
```

---

# 196. Dependency Map

كل Team يجب أن يملك ملف:

```text
TEAM-XX-DEPENDENCIES.md
```

مثلاً:

```text
Consumes:
- Identity API
- Order Events

Provides:
- Matching API
- matching.events
```

---

# 197. Stage Board

ملف:

```text
docs/16-progress/STAGE_BOARD.md
```

يحتوي:

```text
Current Phase
Phase owner teams
Completed
Blocked
Waiting for Contract
Ready for Test
Ready for Exit Gate
```

---

# 198. Phase Exit Review

قبل الانتقال:

```text
Tech
Product
Security
QA
Operations
```

مراجعة النتائج، حتى لو كان التنفيذ بالكامل هندسيًا.

---

# 199. Final Operating Rule

إذا اختلف عضوان على تنفيذ:

1. ارجعا إلى هذه الوثيقة.
2. ابحثا عن ADR أو Contract.
3. إن لم يوجد قرار، اكتبوا ADR.
4. لا تنتقل الخلافات إلى تنفيذين متعارضين.
5. القرار النهائي المعتمد يصبح جزءًا من الوثيقة.

---

# 200. الصورة الكبرى

```text
                         WASLA — Logistics OS
                                  │
          ┌───────────────────────┼────────────────────────┐
          │                       │                        │
      CHANNELS                CORE LOGIC                TRUST
          │                       │                        │
 Customer Bot              Identity / Auth          Reputation
 Driver Bot                Order Engine             Fraud
 Partner Bot               Matching                 Compliance
 Mini Apps                 Dispatch                 Safety
 Admin Web                 Marketplace              Audit
          │                Search / Chat                  │
          └───────────────────────┼────────────────────────┘
                                  │
                            DATA PLATFORM
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
          PostgreSQL            Redis              Search
              │                   │                   │
              └───────────────────┼───────────────────┘
                                  │
                         EVENTS / OUTBOX
                                  │
                  ┌───────────────┼───────────────┐
                  │               │               │
             Notifications    Analytics      Integrations
                  │               │               │
                  └───────────────┼───────────────┘
                                  │
                           INFRA / SECURITY
                                  │
                 CI/CD — Observability — Backup
                                  │
                         Country / Region Cells
                                  │
                      Future Channel Independence
```

---

# 201. ماذا يجب أن يفعل الفريق بعد وضع هذه الوثيقة؟

**لا يبدأ أي فريق في بناء Feature تجارية عشوائية.**

التسلسل الإلزامي:

```text
1. وضع الوثيقة في /docs
2. إنشاء Repo skeleton
3. إنشاء قواعد GitLab
4. إنشاء CI
5. إنشاء ADR system
6. إنشاء Progress Board
7. تنفيذ Phase 00
8. مراجعة Exit Gate
9. تنفيذ Phase 01
10. مراجعة Exit Gate
11. الاستمرار بالتسلسل
```

يمكن لبعض الفرق العمل **بالتوازي داخل المرحلة نفسها** إذا كانت Contracts واضحة.

لكن لا يجوز القفز إلى مرحلة تعتمد على Domain/Contract لم يُثبت بعد.

---

# 202. أول مجموعة ملفات يجب إنشاؤها في المستودع

```text
README.md
CONTRIBUTING.md
SECURITY.md
CODEOWNERS
.gitlab-ci.yml

docs/00-rules/ENGINEERING_DOCUMENTATION_LAW.md
docs/00-rules/DEFINITION_OF_DONE.md
docs/00-rules/GIT_RULES.md
docs/00-rules/SECURITY_RULES.md

docs/01-product/VISION.md
docs/01-product/SERVICES.md
docs/01-product/USER_FLOWS.md

docs/02-architecture/SYSTEM_CONTEXT.md
docs/02-architecture/CONTAINERS.md
docs/02-architecture/SCALING.md

docs/15-decisions/ADR-001-identity-decoupled-from-telegram.md
docs/16-progress/MASTER_PROGRESS.md
```

---

# 203. Rule for the future Master Document

هذه الوثيقة نفسها ليست “وثيقة تجميد”.

عندما يتغير قرار، لا نمسح التاريخ.

يجب:

```text
Old Decision
↓
ADR
↓
New Decision
↓
Impact Analysis
↓
Docs Update
↓
Migration Plan
```

---

# 204. القرارات التي ما زالت قابلة للضبط وليست افتراضات مخفية

هذه النقاط لا تمنع البناء، لكن يجب تثبيتها عبر ADR عند وصول العمل إليها:

- مزود الخرائط النهائي.
- مزود الترجمة النهائي.
- تفاصيل أرصدة الاشتراك والمكافآت.
- تفاصيل سياسات الامتثال لكل دولة.
- قيم Retention حسب المتطلبات النظامية.
- أرقام Dispatch timeout النهائية.
- وزن Matching النهائي بعد البيانات.
- سياسة الرسوم التجارية للمتاجر حسب السوق.
- حدود Enterprise SLA.
- RTO / RPO النهائيان بعد قياس التكلفة.

لا يجوز تحويل هذه النقاط إلى Hard-coded values قبل ADR أو Configuration policy.

---

# 205. الخلاصة التنفيذية

WASLA يجب ألا تبنى كـ “Telegram bot project”.

يجب أن تبنى كالتالي:

```text
Telegram
    ↓
Adapters
    ↓
WASLA Core
    ↓
Identity
Orders
Matching
Dispatch
Marketplace
Reputation
Trust
Referral
Chat
Search
Partners
Billing
Support
Admin
    ↓
Data + Events + Observability
    ↓
Country / Regional Expansion
    ↓
Future Channel Independence
```

القاعدة الأهم:

> **نحن لا نبني Features منفصلة. نحن نبني نظامًا تراكميًا؛ كل مرحلة تجعل المرحلة التالية أسهل، وكل قرار يجب أن يخدم الاستمرارية والتوسع والسمعة والأمان.**

---

# 206. سجل التعديلات

| الإصدار | الحالة | التغيير |
|---|---|---|
| v1.0 | Baseline | إنشاء الدليل التنفيذي الأساسي بناءً على القرارات المعتمدة |

**أي تعديل لاحق يجب أن يضاف هنا.**

---

# 207. مراجع تقنية خارجية

- Telegram Bot API: https://core.telegram.org/bots/api
- Telegram Web Apps / Mini Apps: https://core.telegram.org/bots/webapps
- Telegram Web Events: https://core.telegram.org/api/web-events

هذه المراجع تستخدم للتحقق من قدرات Telegram الحالية، ولا تجعل Telegram جزءًا من Core Domain.

