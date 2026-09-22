# Admin MVP — Product Specification

> **Scope:** تحديد شاشات ونطاق لوحة الإدارة (Admin MVP) كجزء من عنصر العمل M3-04.
>
> **المرجع الأم:** [VISION.md](VISION.md) · [USER_FLOWS.md](USER_FLOWS.md) · [ADR-027](../15-decisions/ADR-027-authorization-policy-matrix.md)
>
> **Last Updated:** 2026-09-22 · **Status:** Baseline v1.0 · **Related Team:** Team 04 (Ops)

---

## 1. الغرض

هذه الوثيقة تحدد ما يجب أن يبنى في لوحة الإدارة (Admin MVP) كجزء من عنصر العمل M3-04. لوحة الإدارة هي واجهة العمليات الداخلية — تتيح للمشغلين (operators) إدارة المستخدمين والسائقين والشركاء والطلبات والمدفوعات بدون تعديل مباشر على قاعدة البيانات (مبدأ M3-07).

## 2. المتطلبات الأساسية (Prerequisites)

| المتطلب | الحالة |
|---|---|
| M1-04: المصادقة المركزية (identity service) | ✅ مُنفَّذ |
| M1-05: مصفوفة سياسات التفويض (ADR-027) | ✅ مُنفَّذ |
| M2-01: صورة الحاوية وسلسلة التوريد | ✅ مُنفَّذ |
| M2-04: مخطط الإعداد ومصدر حقيقته | ✅ مُنفَّذ |
| Audit service (services/audit/) | ⚠️ scaffolded فقط — يحتاج تنفيذ |
| Services with admin endpoints | ✅ معظم الخدمات لديها مسارات إدارية |

## 3. شخصيات المستخدم (Personas)

### 3.1 المشغل (Operator)
- موظف عمليات داخلي
- صلاحيات: عرض كل المستخدمين/السائقين/الشركاء، تعليق/تفعيل الحسابات، مراجعة الوثائق، إدارة النزاعات
- لا يمكنه: تعديل المدفوعات مباشرة، حذف طلبات نهائية، تغيير سياسات النظام

### 3.2 المدير (Admin)
- مشغل بمستوى صلاحية أعلى
- صلاحيات: كل صلاحيات المشغل + تقارير النظام، إدارة الفريق الداخلي، مراجعة سجلات التدقيق
- لا يمكنه: تعديل سجلات التدقيق (audit trail immutable)

### 3.3 Non-Goals (خارج النطاق)
- لا يوجد نظام إشعارات مدمج للوحات الإدارة في هذه المرحلة — البريد الإلكتروني فقط
- لا يوجد تعديل مباشر على قاعدة البيانات — كل العمليات عبر API
- لا يوجد نظام تقارير متقدم (BI dashboards) — عرض بسيط فقط

## 4. الشاشات (Screens)

### 4.1 Dashboard
- إحصائيات سريعة: عدد المستخدمين النشطين، السائقين المتاحين، الطلبات اليوم، الإيرادات
- تنبيهات: وثائق قيد المراجعة، نزاعات مفتوحة، سائقين معلقين
- روابط سريعة لكل قسم

### 4.2 Users Management
- قائمة المستخدمين (عملاء) مع بحث وفلترة
- عرض تفاصيل المستخدم: الطلبات، التقييمات، الحالة
- تعليق/تفعيل حساب مستخدم

### 4.3 Drivers Management
- قائمة السائقين مع بحث وفلترة (الحالة، التحقق، المنطقة)
- عرض تفاصيل السائق: المركبات، الوثائق، المناطق، الأرباح
- مراجعة الوثائق (قبول/رفض مع سبب الرفض)
- تعليق/تفعيل حساب سائق
- تعديل حالة التوفر

### 4.4 Orders Management
- قائمة الطلبات مع بحث وفلترة (الحالة، التاريخ، المنطقة)
- عرض تفاصيل الطلب: المسار، السائق، العميل، الحالة، السعر
- عرض سجل تغييرات الحالة (order transitions)
- لا يمكن تعديل أو حذف الطلبات — عرض فقط

### 4.5 Audit Log
- سجل التدقيق: من فعل ماذا ومتى
- فلترة بالتاريخ، المستخدم، نوع العملية
- سجل غير قابل للتعديل (immutable)

## 5. RBAC (Role-Based Access Control)

### 5.1 الأدوار (Roles)

| الدور | الوصف | الصلاحيات |
|---|---|---|
| `operator` | مشغل عمليات يومية | users:read, users:suspend, drivers:read, drivers:review, drivers:suspend, orders:read, audit:read |
| `admin` | مدير نظام | كل صلاحيات operator + team:manage, reports:read, audit:export |

### 5.2 الإنفاذ (Enforcement)

- المصادقة عبر identity service (JWT موقّع)
- التفويض عبر authz-policy matrix (M1-05) — صلاحيات `admin:*` جديدة
- كل عملية إدارية تُسجَّل في audit log

## 6. Audit Trail

### 6.1 الأحداث المُسجَّلة (Audit Events)

| الحدث | الوصف |
|---|---|
| `user.suspended` | تعليق مستخدم |
| `user.reinstated` | تفعيل مستخدم |
| `driver.suspended` | تعليق سائق |
| `driver.reinstated` | تفعيل سائق |
| `driver.document.reviewed` | مراجعة وثيقة (قبول/رفض) |
| `driver.availability.changed` | تغيير حالة توفر سائق |
| `order.viewed` | عرض تفاصيل طلب |
| `audit.exported` | تصدير سجل تدقيق |

### 6.2 التنفيذ (Implementation)

- Audit service جديد في `services/audit/` — يستقبل الأحداث عبر HTTP API
- جدول `audit_events` (id, actor_id, actor_role, action, resource_type, resource_id, metadata JSONB, created_at)
- الأحداث غير قابلة للتعديل أو الحذف (append-only)
- retention: 90 يوم (configurable)

## 7. API Dependencies

| الخدمة | المسارات المطلوبة | الحالة |
|---|---|---|
| Identity (port 8081) | `POST /auth/token`, `GET /me` | ✅ مُنفَّذ |
| Drivers (port 8085) | `GET /drivers`, `GET /drivers/:id`, `POST /drivers/:id/suspend`, `POST /drivers/:id/reinstate`, `GET /drivers/:id/documents`, `POST /drivers/:id/documents/:docId/review` | ✅ مُنفَّذ |
| Orders (port 8087) | `GET /orders`, `GET /orders/:id` | ✅ مُنفَّذ |
| Customers (port 8080) | `GET /customers`, `GET /customers/:id`, `POST /customers/:id/suspend`, `POST /customers/:id/reinstate` | ⚠️ يحتاج مسارات إدارية |
| Audit (new) | `POST /audit/events`, `GET /audit/events` | ⚠️ جديد — يحتاج تنفيذ |

## 8. UAT Scenarios (User Acceptance Testing)

| السيناريو | الخطوات | النتيجة المتوقعة |
|---|---|---|
| UAT-01: Login | فتح لوحة الإدارة، تسجيل الدخول | عرض Dashboard |
| UAT-02: Search driver | البحث عن سائق بالاسم | عرض النتائج |
| UAT-03: Review document | عرض وثيقة سائق، قبولها | تحديث حالة الوثيفة، تسجيل audit event |
| UAT-04: Suspend driver | تعليق سائق | تحديث حالة السائق، تسجيل audit event |
| UAT-05: View order | عرض تفاصيل طلب | عرض المسار والسائق والحالة |
| UAT-06: View audit log | عرض سجل التدقيق | عرض الأحداث مع الفلترة |
| UAT-07: RBAC enforcement | محاولة operator الوصول لإدارة الفريق | رفض الوصول (403) |
| UAT-08: Audit immutability | محاولة تعديل سجل تدقيق | رفض (405 أو 403) |

## 9. خارطة الموجات (Wave Breakdown)

### Wave 1: Scaffold + Audit Service
- إعداد مشروع `apps/admin-portal/` (React + Vite)
- تنفيذ `services/audit/` (Fastify app, audit_events table, migration)
- مسار `POST /audit/events` (استقبال الأحداث)
- مسار `GET /audit/events` (عرض السجل مع فلترة)
- RBAC: إضافة صلاحيات `admin:*` و `operator:*` لمصفوفة authz-policy
- اختبارات وحدة وتكامل

### Wave 2: Users + Drivers Management
- شاشة Dashboard مع إحصائيات
- شاشة Users Management (قائمة، بحث، تعليق/تفعيل)
- شاشة Drivers Management (قائمة، بحث، مراجعة وثائق، تعليق/تفعيل)
- مسارات إدارية في customers service
- اختبارات E2E

### Wave 3: Orders + Audit Log UI
- شاشة Orders Management (قائمة، بحث، عرض تفاصيل)
- شاشة Audit Log (قائمة، فلترة، تصدير)
- اختبارات E2E + accessibility

### Wave 4: UAT + Exit Gate
- تنفيذ سيناريوهات UAT
- اختبارات Playwright E2E شاملة
- axe-core accessibility audits
- RBAC enforcement tests
- Exit gate: RBAC + audit + UAT evidence

## 10. القرارات التقنية

- **React 18 + Vite 5** — نفس بنية M3-01/M3-02
- **Hash routing** — نفس النمط
- **Zustand** — إدارة الحالة
- **API client with Bearer** — نفس نمط M3-01/M3-02
- **i18n (ar/en/ur)** — نفس الترجمات
- **Fastify** — لخدمة audit الجديدة
- **PostgreSQL** — جدول audit_events
- **Tailwind CSS** — للتصميم السريع
