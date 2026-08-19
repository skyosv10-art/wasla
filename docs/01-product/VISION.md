# VISION — رؤية منصة وَصْلة / WASLA

> **Scope:** الرؤية، الهوية، سوق الإطلاق، المبادئ غير القابلة للتغيير، الصورة الكبرى.
>
> **المرجع الأم:** أقسام 1 (هوية المشروع) و2 (المبادئ غير القابلة للتغيير) و205 (الخلاصة التنفيذية) من الدليل التنفيذي.
>
> **Last Updated:** 2026-08-19 · **Status:** Baseline v1.0 · **Related Team:** جميع الفرق

---

## 1. الاسم والوصف الرسمي

- **الاسم:** وَصْلة / WASLA
- **الوصف الرسمي:** WASLA — Global Logistics OS

منصة لوجستية وتشغيلية عالمية، تبدأ من Telegram، وتجمع النقل، التوصيل، الإسناد، المتاجر، البحث، السمعة، الثقة، التشغيل، ودعم الشركاء في Core واحد قابل للتوسع إلى دول وقنوات أخرى.

---

## 2. الرؤية

الهدف بعيد المدى هو أن تصبح WASLA قابلة للاستخدام في **كل دولة يتوفر فيها Telegram**، مع إمكانية إضافة قنوات بديلة لاحقًا دون إعادة بناء الـCore.

> WASLA يجب ألا تُبنى كـ«Telegram bot project». تُبنى كنظام تراكمي يفصل القناة (Channel) عن القلب (Core).

---

## 3. سوق الإطلاق

```text
Initial Country: Saudi Arabia
Initial Geographic Scope: All Saudi Cities
Year 1 Target Expansion: Gulf + Egypt + Jordan
Long-Term: Global
Base Currency: SAR
Languages: Arabic, English, Urdu
Future Search / Localization: Turkish, Persian and additional locales
```

> التوسع الجغرافي لا يعني أن جميع الدول تشترك في نفس قواعد التسعير أو التشغيل أو الامتثال. الدولة كيان Configuration مستقل.

---

## 4. المبدأ الجوهري

> **Telegram قناة، وليس قلب النظام.**

يجب ألا يعرف Order Engine أو Reputation Engine تفاصيل Telegram. لا نضع `telegram.sendMessage()` داخل Business Logic. المسار الصحيح:

```text
NotificationService
      ↓
Channel Router
      ↓
Telegram Adapter
```

بحيث يمكن لاحقًا إضافة `Web Adapter` و`Mobile Adapter` و`WhatsApp Adapter` دون تعديل Core Domain.

---

## 5. المبادئ غير القابلة للتغيير (الـ20)

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

> هذه المبادئ **غير قابلة للتغيير** إلا عبر قرار موثّق في ADR مع مبرر قوي ومراجعة فريق Security / QA.

---

## 6. نطاق المنتج الكامل

WASLA ليست تطبيق مشاوير فقط. النطاق المستهدف يشمل:

- **Mobility:** مشاوير أفراد، مشاوير مجدولة، أنواع مركبات متعددة، طلبات تفاوضية، اختيار السائق من المرشحين، Shared/Community Driver Pool.
- **Delivery:** طرود، مستندات، طعام، منتجات متاجر، شحنات متعددة الأحجام، Multi-stop، Scheduled Delivery، Partner Dispatch.
- **Marketplace:** أي مستخدم ينتقل من User إلى Store Owner أو Partner دون هوية جديدة. المتجر يدعم منتجات، صور، أسعار، مخزون، Variants، فروع، موظفين، طلبات، بحث، تقييم، تقارير، روابط.
- **B2B / Partners:** مطاعم، متاجر، صيدليات، شركات، سلاسل، شركات نقل صغيرة، أصحاب أساطيل، Enterprise API.
- **Operations:** Dispatch، Support، Escalation، Moderation، Compliance، Fraud، Reputation، Analytics، Broadcasting.

---

## 7. الصورة الكبرى (Architecture Stack)

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

### القاعدة الأعمق

> **نحن لا نبني Features منفصلة. نحن نبني نظامًا تراكميًا؛ كل مرحلة تجعل المرحلة التالية أسهل، وكل قرار يجب أن يخدم الاستمرارية والتوسع والسمعة والأمان.**

---

## 8. القرارات القابلة للضبط لاحقًا (ليست افتراضات مخفية)

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

> لا يجوز تحويل هذه النقاط إلى Hard-coded values قبل ADR أو Configuration policy.

---

## 9. الروابط ذات الصلة

- [SERVICES.md](SERVICES.md) — قائمة الخدمات الـ24
- [USER_FLOWS.md](USER_FLOWS.md) — تدفقات المستخدم الرئيسية
- [/docs/02-architecture/SYSTEM_CONTEXT.md](../02-architecture/SYSTEM_CONTEXT.md) — السياق المعماري
- [/docs/15-decisions/](../15-decisions/) — سجل القرارات (ADR)
