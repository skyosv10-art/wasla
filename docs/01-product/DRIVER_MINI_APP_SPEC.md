# Driver Mini App — Product Specification

> **Scope:** تحديد شاشات تطبيق السائق المصغّر (Driver Mini App)، رحلات المستخدم، معايير القبول، وحدود المرحلة الأولى.
>
> **المرجع الأم:** [VISION.md](VISION.md) §4-6 · [USER_FLOWS.md](USER_FLOWS.md) §3 · [ADR-045](../15-decisions/ADR-045-driver-mini-app-architecture.md)
>
> **Last Updated:** 2026-09-22 · **Status:** Baseline v1.0 · **Related Team:** Team 01 (Drivers) · Team 03 (Channel/UI)

---

## 1. الغرض

هذه الوثيقة تحدد ما يجب أن يبنى في تطبيق السائق المصغّر (Telegram Mini App) كجزء من عنصر العمل M3-02. تطبيق السائق هو «مكان الخدمات الثقيلة» (مبدأ 5) — البوت للإطلاق والتنبيه والتوجيه، والتطبيق المصغّر للخدمات الثقيلة: قبول/رفض العروض، إدارة دورة حياة المهمة (pickup → dropoff)، تحديث حالة الطلب، إدارة المركبات والمناطق، وعرض الأرباح.

## 2. المتطلبات الأساسية (Prerequisites)

| المتطلب | الحالة |
|---|---|
| M1-02: دورة حياة الجلسة وinitData (ADR-019) | ✅ مُنفَّذ |
| M1-04: الوسيط المركزي للهوية | ✅ مُنفَّذ |
| M1-05: مصفوفة الصلاحيات | ✅ مُنفَّذ |
| M2-02: النشر والبيئة | ✅ مُنجَز (staging) |
| Driver HTTP API (14 مسار) | ✅ مُنفَّذ (Port 8085) |
| Dispatch HTTP API (8 مسارات) | ✅ مُنفَّذ (Port 8084) |
| Order HTTP API (9 مسارات) | ✅ مُنفَّذ (Port 8087) |

## 3. شخصيات المستخدم (Personas)

### 3.1 السائق النشط (Active Driver)
- لديه مركبة مسجّلة ووثائق مُعتمدة
- حالته: `available` أو `busy`
- يحصل على عروض مهام في الوقت الفعلي
### 3.2 السائق غير المؤهل (Ineligible Driver)
- لم يكمل التسجيل أو وثائقه قيد المراجعة
- يرى شاشة حالة فقط (لا عروض)

### Non-Goals (خارج النطاق)
- لا يوجد نظام ملاحة مدمج (خرائط) في هذه المرحلة — الروابط الخارجية فقط
- لا يوجد محادثة بين السائق والعميل داخل التطبيق
- لا يوجد تتبّع GPS مباشر من التطبيق
- لا يوجد نظام دفع داخل التطبيق
- لا يوجد تعديل الأسعار من السائق (التفاوض يتم عبر خدمة المنفصلة)

## 4. شاشات التطبيق (Screen Inventory)

### 4.1 شاشة التهيئة/الجلسة (Session/Loading)

```text
┌─────────────────────────────┐
│        وَصْلة                │
│                             │
│      ⏳ جارٍ التحقق...       │
│                             │
└─────────────────────────────┘
```

- تستخدم Telegram initData لإنشاء جلسة عبر خدمة الهوية
- في حالة الفشل: تعرض رسالة خطأ مع زر إعادة المحاولة
- لا تخزّن الرمز في localStorage/sessionStorage (ADR-019)

### 4.2 الشاشة الرئيسية (Home)

```text
┌─────────────────────────────┐
│        وَصْلة                │
│                             │
│  🟢 متاح للعمل               │
│  📋 المهام النشطة            │
│  📊 أرباحي                   │
│  🚗 مركباتي                  │
│  📍 مناطق عملي               │
│  📄 وثائقي                   │
│  👤 حسابي                    │
└─────────────────────────────┘
```

- تبديل حالة التوفر (`available` / `busy`) عبر `PUT /drivers/:id/availability`
- عرض حالة الأهلية (إذا كان غير مؤهل، يظهر تنبيه)
- قائمة المهام النشطة (إن وُجدت) تعرض كأول عنصر

### 4.3 شاشة العروض/المهام المتاحة (Offer Feed)

```text
┌─────────────────────────────┐
│   عرض جديد                  │
│                             │
│  📍 من: المنطقة A            │
│  📍 إلى: المنطقة B           │
│  🚗 نوع: مشوار               │
│  💰 السعر المقترح: 25 ر.س    │
│  ⏱ 3:00 للرد                │
│                             │
│  [✅ قبول]  [❌ رفض]         │
└─────────────────────────────┘
```

- تجلب العروض النشطة عبر `GET /dispatch/jobs/:job_id/offers`
- القبول عبر `POST /dispatch/offers/:offer_id/accept`
- الرفض عبر `POST /dispatch/offers/:offer_id/reject`
- مؤقت تنازلي للعرض (timeout من البيانات الخلفية)
- في حالة عدم وجود عروض: تعرض رسالة فارغة مناسبة

### 4.4 شاشة تفاصيل المهمة (Job Detail)

```text
┌─────────────────────────────┐
│   مهمة #12345               │
│                             │
│  الحالة: في الطريق          │
│  📍 نقطة الالتقاط: ...      │
│  📍 نقطة التسليم: ...       │
│  🚗 نوع المركبة: سيارة       │
│  📝 ملاحظات: ...            │
│                             │
│  [📍 ابدأ الرحلة]            │
│  [✅ وصلت]                  │
│  [📦 بدأ التسليم]            │
│  [✅ اكتمل التسليم]          │
└─────────────────────────────┘
```

- تعرض تفاصيل المهمة عبر `GET /dispatch/jobs/:job_id`
- أزرار الإجراءات تعتمد على الحالة الحالية:
  - `assigned` → زر «ابدأ الرحلة» (transition: `assigned → driver_en_route`)
  - `driver_en_route` → زر «وصلت» (transition: `driver_en_route → arrived`)
  - `arrived` → زر «بدأ التسليم» (transition: `arrived → in_progress`)
  - `in_progress` → زر «اكتمل التسليم» (transition: `in_progress → completed`)
- تحديث الحالة عبر `POST /orders/:orderId/transitions`
- إلغاء المهمة عبر `POST /dispatch/jobs/:job_id/cancel` (مع سبب)

### 4.5 شاشة سجل المهام والأرباح (Job History / Earnings)

```text
┌─────────────────────────────┐
│   أرباحي                    │
│                             │
│  اليوم: 5 مهام · 125 ر.س    │
│  الأسبوع: 28 مهمة · 720 ر.س │
│                             │
│  ┌─────────────────────┐    │
│  │ #12345 · مشوار      │    │
│  │ 25 ر.س · مكتمل      │    │
│  └─────────────────────┘    │
└─────────────────────────────┘
```

- تعرض المهام المكتملة والأرباح
- تصفية حسب الفترة (اليوم/الأسبوع/الشهر)
- البيانات من `GET /orders/lookup` مع فلترة حسب السائق

### 4.6 شاشة المركبات (Vehicles)

```text
┌─────────────────────────────┐
│   مركباتي                   │
│                             │
│  ┌─────────────────────┐    │
│  │ سيارة · تويوتا      │    │
│  │ ABC-1234 · نشطة     │    │
│  └─────────────────────┘    │
│                             │
│  [+ إضافة مركبة]            │
└─────────────────────────────┘
```

- قائمة المركبات عبر `GET /drivers/:id/vehicles`
- إضافة مركبة عبر `POST /drivers/:id/vehicles`
- تعديل مركبة عبر `PATCH /drivers/:id/vehicles/:vehicleId`

### 4.7 شاشة المناطق (Zones)

```text
┌─────────────────────────────┐
│   مناطق عملي                │
│                             │
│  ☑ المنطقة الشمالية          │
│  ☑ المنطقة الشرقية           │
│  ☐ المنطقة الجنوبية          │
│                             │
│  [💾 حفظ]                   │
└─────────────────────────────┘
```

- قائمة المناطق عبر `GET /drivers/:id/zones`
- تحديث المناطق عبر `PUT /drivers/:id/zones`

### 4.8 شاشة الوثائق (Documents)

```text
┌─────────────────────────────┐
│   وثائقي                    │
│                             │
│  📄 رخصة القيادة ✅          │
│  📄 رخصة المركبة ✅          │
│  📄 التأمين ⏳ قيد المراجعة  │
│                             │
│  [+ رفع وثيقة]              │
└─────────────────────────────┘
```

- قائمة الوثائق عبر `GET /drivers/:id/documents`
- رفع وثيقة عبر `POST /drivers/:id/documents`
- حالة كل وثيقة (موافق عليها / قيد المراجعة / مرفوضة)

### 4.9 شاشة الملف الشخصي (Profile)

```text
┌─────────────────────────────┐
│   حسابي                     │
│                             │
│  الاسم: أحمد                │
│  الهاتف: +966...            │
│  حالة الأهلية: مؤهل ✅       │
│                             │
│  [💾 حفظ التغييرات]         │
└─────────────────────────────┘
```

- بيانات السائق عبر `GET /drivers/:id`
- تحديث البيانات عبر `PATCH /drivers/:id`
- حالة الأهلية عبر `GET /drivers/:id/eligibility`

## 5. مصفوفة عقد API (API Contract Matrix)

| الشاشة | Method | Path | الخدمة | Scope | Idempotency |
|---|---|---|---|---|---|
| الجلسة | — | initData → identity | identity | — | — |
| Home (توفّر) | PUT | `/drivers/:id/availability` | drivers | `drivers:availability:write` | — |
| Home (أهلية) | GET | `/drivers/:id/eligibility` | drivers | `drivers:eligibility:read` | — |
| العروض | GET | `/dispatch/jobs/:job_id/offers` | dispatch | `dispatch:offer:read` | — |
| العروض | POST | `/dispatch/offers/:offer_id/accept` | dispatch | `dispatch:offer:accept` | — |
| العروض | POST | `/dispatch/offers/:offer_id/reject` | dispatch | `dispatch:offer:reject` | — |
| المهمة | GET | `/dispatch/jobs/:job_id` | dispatch | `dispatch:job:read` | — |
| المهمة (حالة) | POST | `/orders/:orderId/transitions` | orders | `orders:transition:write` | نعم (Idempotency-Key) |
| المهمة (إلغاء) | POST | `/dispatch/jobs/:job_id/cancel` | dispatch | `dispatch:job:cancel` | — |
| السجل | GET | `/orders/lookup` | orders | `orders:read` | — |
| المركبات | GET | `/drivers/:id/vehicles` | drivers | `drivers:vehicle:read` | — |
| المركبات | POST | `/drivers/:id/vehicles` | drivers | `drivers:vehicle:write` | نعم (Idempotency-Key) |
| المركبات | PATCH | `/drivers/:id/vehicles/:vehicleId` | drivers | `drivers:vehicle:write` | — |
| المناطق | GET | `/drivers/:id/zones` | drivers | `drivers:zone:read` | — |
| المناطق | PUT | `/drivers/:id/zones` | drivers | `drivers:zone:write` | — |
| الوثائق | GET | `/drivers/:id/documents` | drivers | `drivers:document:read` | — |
| الوثائق | POST | `/drivers/:id/documents` | drivers | `drivers:document:write` | نعم (Idempotency-Key) |
| الملف الشخصي | GET | `/drivers/:id` | drivers | `drivers:profile:read` | — |
| الملف الشخصي | PATCH | `/drivers/:id` | drivers | `drivers:profile:write` | — |

## 6. قواعد آلة الحالات (State Machine Rules)

تطبيق السائق يتفاعل مع حالات الطلب التالية (مأخوذة من `ORDER_ENGINE.md`):

```text
assigned → driver_en_route → arrived → in_progress → completed
```

الانتقالات التي يقوم بها السائق:
- `assigned → driver_en_route` (السائق يبدأ التحرك)
- `driver_en_route → arrived` (السائق وصل لنقطة الالتقاط)
- `arrived → in_progress` (بدأ التسليم/الرحلة)
- `in_progress → completed` (اكتمل التسليم)

**قاعدة حرجة:** لا يمكن للواجهة إنشاء انتقال غير مسموح به. كل زر يظهر فقط عندما تكون حالة الطلب تسمح بالانتقال المناسب. الانتقالات غير القانونية تُرفض بـ 409 من الخلفية.

## 7. حالات الفشل وغير المتصلة (Failure/Offline States)

- **انقطاع الشبكة:** عرض رسالة «لا يوجد اتصال» مع زر إعادة المحاولة
- **انتهاء صلاحية الجلسة:** إعادة التهيئة تلقائيًا عبر initData
- **لا توجد عروض:** عرض رسالة إيجابية («لا توجد عروض حاليًا، ابقَ متاحًا»)
- **لا توجد مهام مكتملة:** عرض رسالة مناسبة في شاشة الأرباح
- **سائق غير مؤهل:** عرض سبب عدم الأهلية مع رابط لرفع الوثائق

## 8. التدويل (i18n)

- العربية (افتراضي، RTL)
- الإنجليزية
- الأردية
- يتم ضبط `dir="rtl"` على `<html>` للعربية والأردية

## 9. إمكانية الوصول (Accessibility)

- إطار العرض: `width=device-width, initial-scale=1` (لا تعطيل التكبير)
- WCAG 2.0 مستوى A/AA
- تسميات ARIA لكل عناصر التفاعل
- تباين ألوان كافٍ
- دعم لوحة المفاتيح للتنقل

## 10. معايير القبول (Acceptance Criteria)

1. جميع الشاشات التسعة مُنفَّذة وقابلة للتنقل
2. تبديل حالة التوفر يعمل (PUT availability)
3. قبول/رفض العروض يعمل مع التحقق من الـscope
4. انتقالات حالة الطلب تعمل فقط في المسارات المسموح بها
5. إدارة المركبات (إضافة/تعديل/عرض) تعمل
6. إدارة المناطق (عرض/تحديث) تعمل
7. إدارة الوثائق (رفع/عرض) تعمل
8. عرض الأرباح وسجل المهام يعمل
9. i18n: العربية + الإنجليزية + الأردية
10. E2E: اختبارات Playwright تغطي دورة حياة المهمة كاملة
11. Accessibility: 0 انتهاكات WCAG 2.0 A/AA
12. لا تخزين رمز الجلسة في localStorage/sessionStorage
13. كل طلبات API تحمل `Authorization: Bearer <token>`

## 11. خطة الاختبار وخروج المرحلة (Test Plan & Exit Gate)

| النوع | الأداة | النطاق |
|---|---|---|
| Unit/Component | Vitest | منطق الشاشات، stores، API client |
| E2E | Playwright | دورة حياة المهمة، قبول/رفض العروض، تنقل |
| Accessibility | axe-core (@axe-core/playwright) | WCAG 2.0 A/AA لجميع الشاشات |

**Exit gate:** secure UI E2E + accessibility evidence exists (مثل M3-01).
