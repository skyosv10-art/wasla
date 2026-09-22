# Customer Mini App — Product Specification

> **Scope:** تحديد شاشات تطبيق العميل المصغّر (Customer Mini App)، رحلات المستخدم، معايير القبول، وحدود المرحلة الأولى.
>
> **المرجع الأم:** [VISION.md](VISION.md) §4-6 · [USER_FLOWS.md](USER_FLOWS.md) §2 · [ADR-044](../15-decisions/ADR-044-customer-mini-app-architecture.md)
>
> **Last Updated:** 2026-09-22 · **Status:** Baseline v1.0 · **Related Team:** Team 02 (Customer) · Team 03 (Channel/UI)

---

## 1. الغرض

هذه الوثيقة تحدد ما يجب أن يبنى في تطبيق العميل المصغّر (Telegram Mini App) كجزء من عنصر العمل M3-01. تطبيق العميل هو «مكان الخدمات الثقيلة» (مبدأ 5) — البوت للإطلاق والتنبيه والتوجيه والإجراءات الصغيرة، والتطبيق المصغّر للخدمات الثقيلة: إنشاء الطلبات، إدارة الأماكن، تصفح المتاجر، البحث، ومتابعة الطلبات.

## 2. المتطلبات الأساسية (Prerequisites)

| المتطلب | الحالة |
|---|---|
| M1-02: دورة حياة الجلسة وinitData (ADR-019) | ✅ مُنفَّذ |
| M1-04: الوسيط المركزي للهوية | ✅ مُنفَّذ |
| M1-05: مصفوفة الصلاحيات | ✅ مُنفَّذ |
| M2-02: النشر والبيئة | ✅ مُنجَز (staging) |
| Customer HTTP API (10 مسارات) | ✅ مُنفَّذ (Port 8086) |
| Order HTTP API (7 مسارات) | ✅ مُنفَّذ (Port 8087) |
| Search HTTP API | ✅ مُنفَّذ |
| Marketplace HTTP API | ✅ مُنفَّذ |

## 3. شاشات التطبيق (Screen Inventory)

### 3.1 الشاشة الرئيسية (Home)

```text
┌─────────────────────────────┐
│        وَصْلة                │
│                             │
│  🚗 اطلب مشوار              │
│  📦 اطلب توصيل              │
│  🛍 تصفح المتاجر            │
│  🔎 ابحث                    │
│  📋 طلباتي                  │
│  ⭐ سمعتي                   │
│  👤 حسابي                   │
└─────────────────────────────┘
```

**الترتيب قابل للتجربة A/B لاحقًا** (USER_FLOWS §2.4). الشاشة الرئيسية هي نقطة الدخول الوحيدة بعد التهيئة.

### 3.2 شاشة إنشاء مشوار (Ride Order Form)

| الحقل | مطلوب | مصدر | التحقق |
|---|---|---|---|
| نقطة الالتقاط (Pickup) | نعم | خريطة / موقع تلغرام / بحث نصي / اسم مكان | منطقة صالحة (GeographyPort) |
| نقطة الوصول (Dropoff) | نعم | خريطة / موقع تلغرام / بحث نصي / اسم مكان | منطقة صالحة (GeographyPort) |
| نوع المركبة | نعم | قائمة مغلقة | قيمة من العقود |
| نمط الشحن (Shipment Type) | لا | قائمة مغلقة | — |
| وصف (Description) | لا | نص حر | ≤ 500 حرف |
| السعر المقترح | لا | رقم | > 0 إن وُجد |

**معاينة الطلب:** قبل الإرسال، تُعرض معاينة بلا كتابة (POST `/customers/{id}/order-requests/preview`). المستخدم يرى المسار والمنطقة والحالة المتوقعة.

**الإرسال:** POST `/customers/{id}/order-requests` مع `Idempotency-Key`. الرد 201 يعني نُشر الطلب، 200 يعني إعادة تشغيل نفس المفتاح.

### 3.3 شاشة إنشاء توصيل (Delivery Order Form)

نفس شاشة المشوار مع حقول إضافية:
- نوع الطرد (صندوق/مظروف/أخرى)
- الوزن وال حجم (اختياري)

### 3.4 شاشة تصفح المتاجر (Marketplace Browse)

- قائمة المتاجر المتاحة في منطقة العميل
- بحث نصي بالاسم
- النقر على متجر → صفحة المنتجات

**API:** Marketplace HTTP API — قائمة المتاجر والمنتجات.

### 3.5 شاشة البحث (Search)

- بحث نصي عن متاجر أو منتجات أو أماكن
- نتائج مرتبة بالصلة والمسافة

**API:** Search HTTP API.

### 3.6 شاشة طلباتي (My Orders)

- قائمة آخر 5 طلبات مع التاريخ، النوع، الحالة، ومرجع الطلب
- النقر على طلب → تفاصيل الحالة والمسار
- التحديث المباشر للحالة (Polling أو WebSocket لاحقًا)

**API:** GET `/customers/{id}/order-requests?limit=5` + GET `/customers/{id}/order-requests/{orderRequestId}`

### 3.7 شاشة سمعتي (Reputation)

- عرض نتيجة السمعة الحالية
- عدد الرحلات المنجزة
- التقييمات الأخيرة

**API:** Reputation HTTP API.

### 3.8 شاشة حسابي (Profile)

- عرض وتعديل الملف الشخصي
- إدارة الأماكن المحفوظة (إضافة/حذف)

**API:** GET/PUT `/customers/{id}/profile` · GET/POST/DELETE `/customers/{id}/places`

## 4. تدفق المصادقة (Auth Flow)

```text
Telegram WebView
    ↓ initData (موقَّع HMAC-SHA256)
    ↓
POST /identity/sessions/telegram  →  200 { token, expires_at }
    ↓
تخزين الرمز في الذاكرة (localStorage محظور — ADR-019 §2.5)
    ↓
كل طلب API: Authorization: Bearer <token>
    ↓
الرمز ينتهي بعد 4 ساعات → إعادة initData → رمز جديد
```

**ملاحظات أمانية:**
- initData يُستعمل مرة واحدة فقط (Postgres unique constraint على init_data_hash)
- الرمز مُعتِم عشوائي (32 بايت) ومُخزَّن مهشَّر (sha256)
- الضغطة المزدوجة على زر «إرسال» تُنتج 409 لا جلستَين — الواجهة تمنع الإرسال المزدوج
- لا localStorage للرمز — الجلسة في الذاكرة (in-memory) فقط

## 5. معايير القبول (Acceptance Criteria)

### 5.1 واجهة آمنة (Secure UI)
- [ ] initData يُحقَّق منه مرة واحدة عند فتح التطبيق
- [ ] الرمز يُخزَّن في الذاكرة لا في localStorage
- [ ] كل طلب API يحمل Authorization: Bearer
- [ ] انتهاء الرمز يُعالج بإعادة تهيئة الجلسة تلقائيًا
- [ ] لا بيانات حساسة في URL أو console

### 5.2 إمكانية الوصول (Accessibility)
- [ ] دعم RTL كامل (العربية لغة أساسية)
- [ ] تباين ألوان WCAG AA على الأقل
- [ ] أحجام خطوط قابلة للقراءة (16px كحد أدنى للنص الأساسي)
- [ ] تنقل بلوحة المفاتيح (Tab/Enter/Escape)
- [ ] تسميات ARIA للعناصر التفاعلية
- [ ] دعم قارئ الشاشة (aria-label)

### 5.3 تجربة المستخدم (UX)
- [ ] زمن تحميل أولي < 3 ثوان
- [ ] منع الإرسال المزدوج (disabled button أثناء الطلب)
- [ ] رسائل خطأ واضحة بالعربية
- [ ] حالة فارغة (empty state) لكل قائمة
- [ ] مؤشر تحميل أثناء العمليات

### 5.4 الاختبار (E2E)
- [ ] اختبار E2E: إنشاء مشوار من البداية للنهاية
- [ ] اختبار E2E: إدارة الأماكن (إضافة/حذف)
- [ ] اختبار E2E: متابعة الطلبات
- [ ] اختبار الوصول (axe-core أو ما يعادله)

## 6. اللغات المدعومة

| اللغة | الأولوية | ملاحظات |
|---|---|---|
| العربية | أساسية | RTL |
| الإنجليزية | ثانوية | LTR |
| الأردية | ثانوية | RTL |

الترجمة عبر مفاتيح i18n قابلة للتبديل. مبدأ 3 من VISION: اللغات الأساسية هي Arabic, English, Urdu.

## 7. حدود المرحلة الأولى (Out of Scope)

- الدفع الإلكتروني (مبدأ 7: لا Wallet/Escrow في الإصدار الأساسي)
- محادثة داخل التطبيق (التفاوض عبر Negotiation Service منفصل)
- إشعارات داخل التطبيق (الإشعارات عبر البوت)
- خريطة تفاعلية متقدمة (GeoJSON/Polyline) — مرحلة لاحقة
- تقييم السائق من داخل التطبيق — مرحلة لاحقة

## 8. الاعتماديات على الخدمات

| الخدمة | المنفذ | المسارات المستخدمة |
|---|---|---|
| identity | 8081 | POST /identity/sessions/telegram |
| customers | 8086 | كل المسارات العشرة |
| orders | 8087 | GET /orders/{id} |
| search | 8088 | GET /search/* |
| marketplace | 8089 | GET /marketplace/stores, GET /marketplace/stores/{slug}/products |
| geography | 8082 | GET /geo/zones/{id} |
| reputation | 8090 | GET /reputation/scores/{id} |

## 9. مراجع

- [VISION.md](VISION.md) — رؤية المنتج والمبادئ
- [USER_FLOWS.md](USER_FLOWS.md) §2 — تدفقات العميل
- [ADR-019](../15-decisions/ADR-019-human-session-lifecycle-and-init-data-verification.md) — دورة حياة الجلسة
- [ADR-044](../15-decisions/ADR-044-customer-mini-app-architecture.md) — قرار المعمارية التقنية
- [CUSTOMER_HTTP.md](../04-api/CUSTOMER_HTTP.md) — عقد HTTP لخدمة العميل
- [ORDER_HTTP.md](../04-api/ORDER_HTTP.md) — عقد HTTP لمحرّك الطلبات
- [CUSTOMER_BOT_FLOWS.md](../02-architecture/CUSTOMER_BOT_FLOWS.md) — تدفقات بوت العميل
