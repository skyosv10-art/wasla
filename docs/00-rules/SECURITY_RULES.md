# قواعد الأمان الإلزامية للكود — SECURITY RULES

> **Scope:** قواعد الأمان التي يجب أن يلتزم بها كل كود يُكتب في المستودع.
>
> **المرجع الأم:** القسم 48 (Security — قواعد إلزامية) و49 (حماية الفكرة والكود) و122-124 و144 من الدليل التنفيذي.
>
> **Last Updated:** 2026-08-19 · **Status:** Active · **Related Team:** Team 11 (Security / QA) + جميع الفرق

---

## 1. القواعد الإلزامية للكود

```text
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
```

---

## 2. لا أسرار في الكود / الـLogs

### 2.1 لا Secrets في الكود

- لا توكنات، لا مفاتيح API، لا كلمات مرور، لا شهادات داخل الكود أو Git.
- Production secrets تُحقن عبر Environment variables / Vault / CI-protected variables.
- ملف `.env` محجوب في `.gitignore`؛ يُسمح فقط بـ`.env.example` بقيم وهمية.

### 2.2 Logs ممنوع أن تحتوي

```text
OTP
Tokens
Full phone numbers
Identity numbers
Payment secrets
Full private messages
```

يتم **masking/redaction** إلزاميًا لكل ما سبق قبل كتابته في أي log.

---

## 3. بيانات المستخدم والمدفوعات

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
- الاحتفاظ وفق سياسة (Retention).
- منع كشفها في logs.

### 3.2 التوكن والصلاحيات

- كل توكن/مفتاح له أقل صلاحيات ممكنة (Least Privilege).
- 2FA إلزامي للمشرفين والمستخدمين ذوي الصلاحيات العالية.
- لا Production Access افتراضي للمطورين — الوصول يُمنح عبر صلاحيات مُدارة ومسجلة.

### 3.3 المدفوعات

- **ممنوع خلط نوعين من الأموال:** Trip Settlement (مباشر بين الأطراف) منفصل عن Platform Billing/Invoices.
- اشتراكات المتاجر والمنصة تُدفع عبر بوابة دفع للمنصة مع طبقة Payment Abstraction.
- لا تمر أموال المنتج والتوصيل عبر Wallet/WASLA كوسيط للرحلة في الإصدار الأساسي.
- يُسجَّل إثبات الدفع والنزاع عند الحاجة.

---

## 4. رفع الملفات (File Upload Security)

```text
File type validation
Size limit
Malware scan where available
Private storage
Signed URLs
Access audit
Metadata stripping where necessary
```

- المستندات الحساسة لا تستخدم public URLs مباشرة.
- كل `MediaAsset` يملك: `id`, `owner_id`, `purpose`, `mime_type`, `size`, `storage_key`, `checksum`, `created_at`, `retention_policy`.

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

## 6. حماية الفكرة والكود

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

## 7. مسار الحوادث (Incident Management)

كل Incident إنتاجي يمر بالحالات:

```text
Detected
Acknowledged
Contained
Resolved
Reviewed
Closed
```

يجب أن ينتج **Postmortem** للحوادث المهمة (Impact, Timeline, Root Cause, Contributing Factors, Detection, Response, Resolution, Why tests missed it, Preventive actions, Documentation updates).

> لا نبحث عن «شخص مذنب»، بل عن فشل العملية — إلا في حالة خرق أمني متعمد.

التفاصيل في [/SECURITY.md](../../SECURITY.md).

---

## 8. مسؤوليات فريق Security / QA

```text
Test strategy
Security standards
Threat model
SAST/DAST
Contract tests
E2E
Load tests
Abuse tests
Privacy tests
Release gates
```

فريق Security / QA (Team 11) مسؤول عن Release gates — لا يصل الكود إلى الإنتاج قبل اجتياز فحوصات الأمان.

---

## 9. الإبلاغ عن الثغرات

إذا اكتشفت ثغرة أمنية:

1. **لا** تفتح Issue عام.
2. أبلغ فريق Security / QA عبر القناة الخاصة المحددة داخليًا.
3. وثّق: الوصف، الخطوات، الأثر، الأصول المتأثرة.
4. لا تنشر الثغرة قبل إصلاحها والتقييم.

التفاصيل في [/SECURITY.md](../../SECURITY.md).

---

## 10. الروابط ذات الصلة

- [/SECURITY.md](../../SECURITY.md) — سياسة الأمان الكاملة والإبلاغ
- [ENGINEERING_DOCUMENTATION_LAW.md](ENGINEERING_DOCUMENTATION_LAW.md) — قانون التوثيق
- [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md) — DoR/DoD (Security impact)
- [/docs/07-security/](../07-security/) — وثائق الأمان التفصيلية
- [/docs/14-runbooks/](../14-runbooks/) — Runbooks الحوادث
- [§11 اعتماديات الطرف الثالث](#11-اعتمادياتُ-الطرفِ-الثالثِ-وتدقيقُ-الثغرات) — تدقيقُ الثغراتِ وقبولُ الخطرِ المؤقّت
- [`RISK_REGISTER.md`](../07-security/RISK_REGISTER.md) — سجلُّ المخاطرِ والاستثناءاتِ (`M0-07`): كلُّ خطرٍ بمالكٍ ومهلةِ مراجعةٍ، محروسٌ بالفحصِ 10

---

## 11. اعتمادياتُ الطرفِ الثالثِ وتدقيقُ الثغرات

**القاعدة:** ما يُشحَن للمستخدمِ لا ثغرةَ معروفةً فيه، وما يبقى في أدواتِ التطويرِ لا يبقى **بلا تاريخِ انتهاء**.

**الحارسُ:** `scripts/checks/validate-dependency-audit.sh` — يجري في البوّابةِ (الفحصُ 9) وفي `pnpm verify`، وأبوابُه أربعةٌ:

1. `pnpm audit --prod` = **صفرُ ثغراتٍ**، ولا استثناءَ في هذا الباب.
2. كلُّ ثغرةٍ في الشجرةِ كاملةً (شاملةً أدواتِ التطوير) يجب أن يكون معرِّفُها `GHSA` مكتوباً في الكتلةِ أدناه **بمالكٍ وتاريخِ انتهاء**؛ وغيرُ المكتوبِ يُسقِط البوّابةَ، والمنقضيةُ مهلتُه يُسقِطها كذلك.
3. `packageManager` مثبَّتٌ بنسخةٍ صريحةٍ و`pnpm-lock.yaml` موجودٌ — بغيرِهما التدقيقُ خبرٌ عن آلةٍ لا عن مستودع.
4. كلُّ مفتاحٍ في `pnpm.overrides` مُبرَّرٌ في الكتلةِ أدناه — فالتثبيتُ القسريُّ يُغلق ثغرةً اليومَ ويُجمِّد نسخةً مثقوبةً غداً إن لم يُراجَع.

**متى يُقبَل الخطرُ مؤقّتاً؟** حين تكون الثغرةُ في أداةِ تطويرٍ لا تُشحَن، **ولا يُشغَّل** في المستودعِ المسارُ الذي تُستغلُّ منه (مثالٌ: خادمُ `vitest --ui`)، **ولا نسخةَ مُصلَحةً** متاحةً دون كسرٍ واسع. ويُكتب القبولُ بمالكٍ ومهلةٍ **لا تزيد على 90 يوماً**، ويُعاد النظرُ فيه عند انتهائها لا قبلَه ولا بعدَه.

**الكتلةُ المُعلَنة** — سطرٌ لكلِّ سجلٍّ، والحارسُ يقرأها حرفيّاً:

```text
# استثناءاتُ الثغرات: GHSA-… | expires:YYYY-MM-DD | owner:@من | السبب
# (لا استثناءَ ساريَ المفعولِ اليومَ: تدقيقُ 2026-08-27 انتهى إلى صفرِ ثغراتٍ بعدَ رفعِ النسخ.)
# تثبيتاتٌ قسريّةٌ: override:<الحزمة> | expires:YYYY-MM-DD | owner:@من | السبب
override:vitest | expires:2026-11-25 | owner:@uxxxu | يرفع vitest إلى 3.2.7 في المستودعِ كلِّه لإغلاقِ CVE-2026-47429 (حرِجةٌ، CVSS 9.8) — والنطاقاتُ المُعلَنةُ في 39 ملفَّ package.json ما زالت ^2.1.0، وتوحيدُها يحتاج لمسَ services/drivers/ المحجوزةِ في CLM-0004، فيُرفَع التثبيتُ حين تُحرَّر.
override:vite | expires:2026-11-25 | owner:@uxxxu | يضمن vite ≥ 6.4.3 (CVE-2026-53571 عاليةٌ · CVE-2026-53632 · CVE-2026-39365) — وهي اعتماديةٌ غيرُ مباشرةٍ تأتي مع vitest، فلا مالكَ لنسختِها في أيِّ package.json.
override:esbuild | expires:2026-11-25 | owner:@uxxxu | يضمن esbuild ≥ 0.25.12 (GHSA-67mh-4wv8-2f99) في سلسلتَين: vitest>vite>esbuild، وdrizzle-kit>@esbuild-kit/*>esbuild@0.18.20 — و@esbuild-kit مهجورٌ وdrizzle-kit 0.31.10 أحدثُ المتاحِ، فلا مخرجَ إلّا التثبيتُ القسريّ.
```

**كلُّ سجلٍّ في الكتلةِ أعلاه له خطرٌ مُسجَّلٌ** في [`RISK_REGISTER.md`](../07-security/RISK_REGISTER.md) (`M0-07`) بمالكٍ وتاريخِ مراجعةٍ **أسبقَ من `expires:`** — يقابلهما البابُ الثالثُ في `validate-risk-register.sh` صفّاً بصفٍّ، فلا استثناءَ هنا يمضي بلا خطرٍ يُراجَع هناك.

**إعادةُ التدقيقِ:** `pnpm audit` و`pnpm audit --prod` قبلَ كلِّ دفعٍ يمسُّ `package.json` أو `pnpm-lock.yaml`، ونتيجتُهما تُكتب في `TASK_LOG.md` رقماً لا وصفاً.
