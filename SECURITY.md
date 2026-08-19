# Security Policy — وَصْلة / WASLA

> **النطاق:** قواعد الأمان الإلزامية على كل من يعمل في المستودع.
>
> **المرجع الأم:** أقسام 48, 49, 122, 123, 124, 144, 157, 158 من الدليل التنفيذي.

---

## 1. القواعد الإلزامية للكود والبنية

- **لا Secrets داخل Git.** Production secrets خارج التطبيق (Environment variables / Vault / CI-protected variables).
- **2FA** للمشرفين والمستخدمين ذوي الصلاحيات العالية.
- **Protected Branches.**
- **Mandatory Merge Requests** مع MR approval.
- **SAST** — تحليل الكود الثابت.
- **Dependency Scanning** — فحص التبعيات.
- **Container Scanning** — فحص الصور.
- **Secret Scanning** — فحص الأسرار.
- **Audit** لكل عملية إدارية حساسة.
- **Least Privilege** — أقل صلاحيات ممكنة.
- **لا Production Access** للمطورين بشكل افتراضي.

---

## 2. حماية الفكرة والكود

المخاطر التي يُصمَّم النظام ضدها:

1. تسريب الفكرة قبل الإطلاق.
2. نسخ المنتج من المنافسين.
3. سرقة Source Code.
4. Insider Backdoor.
5. تسريب Secrets.
6. اختطاف حسابات GitLab.
7. Dependency compromise.
8. إساءة استخدام صلاحيات Admin.

الإجراءات المعتمدة:

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

## 3. التوكن والمدفوعات وبيانات المستخدم

### 3.1 بيانات شديدة الحساسية

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
- تسجيل الوصول (Access Audit).
- الاحتفاظ وفق سياسة.
- منع كشفها في logs.

### 3.2 المدفوعات

- مدفوعات الرحلات الأساسية تتم مباشرة بين العميل والسائق أو العميل والمتجر، مع إمكانية تسجيل إثبات الدفع والنزاع.
- اشتراكات المتاجر والمنصة تُدفع عبر بوابة دفع للمنصة، مع طبقة Payment Abstraction.
- **ممنوع خلط نوعين من الأموال:** Trip Settlement منفصل عن Platform Billing/Invoices. لا تمر أموال المنتج والتوصيل عبر Wallet/WASLA كوسيط للرحلة في الإصدار الأساسي.

### 3.3 رفع الملفات (File Upload Security)

```text
File type validation
Size limit
Malware scan where available
Private storage
Signed URLs
Access audit
Metadata stripping where necessary
```

المستندات الحساسة لا تستخدم public URLs مباشرة. كل `MediaAsset` يملك: `id`, `owner_id`, `purpose`, `mime_type`, `size`, `storage_key`, `checksum`, `created_at`, `retention_policy`.

---

## 4. حماية البيانات — Logs

**ممنوع أن تحتوي الـlogs على:**

```text
OTP
Tokens
Full phone numbers
Identity numbers
Payment secrets
Full private messages
```

يتم **masking/redaction** إلزاميًا. انظر [`docs/00-rules/SECURITY_RULES.md`](docs/00-rules/SECURITY_RULES.md).

---

## 5. الاحتفاظ بالبيانات (Data Retention)

القيم النهائية يحددها Compliance/Legal حسب الدولة. لكن التصميم يجب أن يدعم Retention Policies لكل نوع:

```text
GPS
Messages
Audit Logs
Documents
Orders
Payments
Fraud evidence
```

لا يجوز تحويل قيم Retention النهائية إلى Hard-coded values قبل ADR أو Configuration policy.

---

## 6. إدارة الحوادث (Incident Management)

كل Incident إنتاجي يمر بالحالات:

```text
Detected
Acknowledged
Contained
Resolved
Reviewed
Closed
```

يجب أن ينتج **Postmortem** للحوادث المهمة، بالقالب:

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

> لا نبحث عن «شخص مذنب»، بل عن فشل العملية — إلا في حالة خرق أمني متعمد.

الـRunbooks المتوقعة لكل Incident في [`docs/14-runbooks/`](docs/14-runbooks/) تشمل: Telegram down، Maps down، Tap down، Redis degraded، DB failover، Kafka lag، WebSocket overload، Search unavailable، Bot webhook failure، Mass notification failure، Fraud spike، Data inconsistency.

---

## 7. الإبلاغ عن الثغرات (Vulnerability Disclosure)

إذا اكتشفت ثغرة أمنية:

1. **لا** تفتح Issue عام.
2. أبلغ فريق Security / QA (Team 11) عبر القناة الخاصة المحددة داخليًا.
3. وثّق: الوصف، الخطوات، الأثر، الأصول المتأثرة.
4. لا تنشر الثغرة قبل إصلاحها والتقييم.

فريق Security / QA مسؤول عن: Test strategy، Security standards، Threat model، SAST/DAST، Contract tests، E2E، Load tests، Abuse tests، Privacy tests، Release gates.

---

## 8. وصول الإنتاج

- لا يوجد Production Access افتراضي للمطورين.
- كل وصول إلى الإنتاج يمر عبر صلاحيات مُدارة و2FA ومسجّل (Audit).
- لا تعديل Production DB يدويًا إلا عبر Runbook مُتحكم به.
- Secret rotation وإدارة صلاحيات Admin ضمن Phase 19 (Security Hardening).

---

## 9. الروابط الداخلية

- [docs/00-rules/SECURITY_RULES.md](docs/00-rules/SECURITY_RULES.md) — قواعد الأمان للكود
- [docs/07-security/](docs/07-security/) — وثائق الأمان التفصيلية
- [docs/14-runbooks/](docs/14-runbooks/) — Runbooks الحوادث
- [CONTRIBUTING.md](CONTRIBUTING.md) — سير العمل
