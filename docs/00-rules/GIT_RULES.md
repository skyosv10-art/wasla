# قواعد Git — GIT RULES

> **Scope:** قواعد Git وGitLab الإلزامية لكل من يعمل في المستودع.
>
> **المرجع الأم:** أقسام 104 (GitLab Rules) و105 (MR DoD) من الدليل التنفيذي.
>
> **Last Updated:** 2026-08-21 · **Status:** Active · **Related Team:** جميع الفرق

---

## 1. حماية الفرع الرئيسي (Main branch)

```text
Protected.
لا Push مباشر.
```

- فرع `main` محمي (Protected) ولا يقبل Push مباشر.
- كل التغييرات تمر عبر **Merge Request**.
- لا يجوز تعطيل الحماية إلا عبر قرار موثّق (ADR) مع مبرر تشغيلي.

**الإعداد الفعلي على GitLab (مُطبَّق 2026-08-21 — إلزام خادمي لا عُرف):**

| الصلاحية | القيمة | لماذا |
|---|---|---|
| Allowed to push and merge | **No one** | الدفع المباشر مرفوض من **الجميع بما فيهم المالك**؛ الطريق الوحيد إلى `main` هو MR يجتاز الأنبوب |
| Allowed to merge | **Maintainers** | الدمج صلاحية منفصلة عن الدفع، فلا يتعطّل سير العمل |
| Allow force push | **false** | تاريخ `main` لا يُعاد كتابته — وإلا فقدت المراجعات والأنابيب مرجعها |

> لماذا «No one» ولا يكفي «Maintainers»؟ لأن قاعدة «لا Push مباشر» كانت — قبل هذا التاريخ — تعتمد على انتباه من يملك الصلاحية؛ وسطر واحد بالخطأ (`git push origin main`) يتجاوز CI والمراجعة معاً. مع «No one» يصير التجاوز **مستحيلاً تقنياً** لا مذموماً أخلاقياً.
>
> **للمراجعة أو العكس:** `GET/POST/DELETE /projects/<id>/protected_branches` — انتبه أن `PATCH` **يُضيف** مستوى دفع ولا يستبدله، فالتعديل الصحيح: حذف الحماية ثم إعادة إنشائها بـ`push_access_level=0`. أي عكس مؤقّت (إصلاح عاجل) يجب أن يُعاد تشديده فوراً بعده ويُسجَّل في [TASK_LOG](../16-progress/TASK_LOG.md).

---

## 2. قواعد الفروع (Branch rules)

- يتم إنشاء فرع فرعي لكل مهمة من `main`.
- اسم الفرع يوضح النوع والنطاق، مثال: `feat/identity-recovery`، `fix/dispatch-duplicate`، `docs/security-rules`.
- لا يُدمج فرع في `main` إلا بعد اجتياز CI ومراجعة المالك (CODEOWNERS).
- بعد الدمج، يُحذف الفرع الفرعي.

### تسمية الفروع (مقترحة)

```text
feat/<scope>-<short-desc>
fix/<scope>-<short-desc>
chore/<scope>-<short-desc>
docs/<scope>-<short-desc>
refactor/<scope>-<short-desc>
```

---

## 3. Merge Request

يجب أن يحتوي كل MR على:

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

### 3.1 هدفُ الطلب: `main` ـ إلّا بسببٍ مكتوب (مفروضٌ آليّاً ـ `M0-17`)

الأصلُ أن يستهدفَ كلُّ طلبِ دمجٍ **الفرعَ الافتراضيَّ `main`**. واستهدافُ فرعٍ آخرَ (تكديسٌ) جائزٌ بشرطَين:
أن يكونَ الهدفُ **قائماً** في المستودع، وأن يكونَ **غيرَ مدموجٍ** في `main` بعد.

> **لِمَ قاعدةٌ لا نصيحةٌ:** في [MR !96](https://gitlab.com/uxxxu/wasla/-/merge_requests/96) استُهدف
> `chore/m0-15-closeout` وكان **قد دُمج في `main` قبلَ ذلك**. فنجح الدمجُ ظاهريّاً وذهب عملُ `M0-16` كلُّه
> إلى فرعٍ لا يُدمَج بعدَه شيءٌ، ولم يبلغ `main` إلّا بطلبٍ ثانٍ. الأسوأُ أن يُحذَف الهدفُ فيبقى العملُ
> معلَّقاً بلا مسارٍ إلى `main` أصلاً. لا يكشف ذلك تدقيقُ الشيفرةِ لأنّ الشيفرةَ سليمةٌ ـ العيبُ في **الوجهةِ**.

يفرضه `scripts/checks/validate-mr-target.sh` داخلَ البوّابةِ الموحّدةِ فحصاً خامساً:

| حالةُ الهدف | الحكم |
|---|---|
| الهدفُ `main` (الافتراضيّ) | يمرّ |
| هدفٌ قائمٌ متقدِّمٌ على `main` (تكديسٌ مشروع) | يمرّ **بتنبيه** ـ والمسؤوليّةُ أن يُدمَج الهدفُ أوّلاً |
| هدفٌ مدموجٌ أصلاً في `main` | **يُرفَض** |
| هدفٌ محذوفٌ من المستودع | **يُرفَض** |
| لا طلبَ دمجٍ (خطُّ `main`، تشغيلٌ يدويّ) | «لا ينطبق» ـ لا حكمَ ولا نقصَ |
| هدفٌ معلومُ الاسمِ ولا وصولَ إلى المستودع | **تخطٍّ مُعلَنٌ** موسومٌ «جزئي» ـ لا يُدَّعى النجاح |

وحدُّ الفحصِ المُعلَن: يحكم على **حالةِ الهدفِ الآن** ولا يقرأ طلباتِ الدمجِ المفتوحةَ، فلا يضمن أنّ هدفاً
متقدِّماً سيُدمَج لاحقاً. ومنعُ التكديسِ كلِّه كان تعطيلاً لا حراسةً، فلم يُفعل.

### MR Definition of Done (Checklist)

```text
[ ] الهدف `main` ـ أو فرعٌ قائمٌ غيرُ مدموجٍ (§3.1)
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

## 4. رسائل Commit (Commit message)

رسالة واضحة بصيغة `type(scope): subject`.

أمثلة:

```text
feat(order): add multi-stop delivery state
fix(dispatch): prevent duplicate assignment
chore(ci): add dependency scanning
docs(rules): update security rules
refactor(identity): extract phone normalization
```

### أنواع Commit المعتمدة

| النوع | الاستخدام |
|---|---|
| `feat` | ميزة جديدة |
| `fix` | إصلاح خلل |
| `chore` | مهام صيانة/CI/تبعيات |
| `docs` | وثائق |
| `refactor` | إعادة هيكلة دون تغيير سلوك |
| `test` | إضافة/تحسين اختبارات |
| `perf` | تحسين أداء |
| `ci` | تغييرات pipeline |
| `build` | نظام البناء/التبعيات |

### قواعد إضافية

- الـsubject بأمر حاضر، حرف صغير، بدون نقطة في النهاية، أقل من 72 حرفًا.
- الجسم (body) يشرح **لماذا** وليس فقط **ماذا** (وفق مبدأ «Document the Why»).
- إذا كان التغيير مرتبطًا بـIssue أو ADR، أشر إليه.

---

## 5. المراجعة والموافقة (Review & Approval)

- **CODEOWNERS** يحدد مالك كل مسار إلزاميًا — لا دمج بدون موافقة المالك.
- للأصول المشتركة (packages/, services/ مشتركة) تستلزم موافقة المالك المرتبط + مراجعة عبر الفرق.
- كل MR يجب أن يحل ملاحظات المراجعين قبل الدمج.

---

## 6. ما الذي لا يجوز فعله (متعلق بـGit)

- إدخال Secret في Git.
- تغيير API بلا تحديث Contract.
- تغيير Event schema بلا Versioning.
- الوصول المباشر لجدول خدمة أخرى بعد استخراجها.
- إضافة Microservice بلا ADR.
- حذف Audit trail لإخفاء أثر.
- اعتبار «الكود يعمل عندي» نجاحًا.

---

## 7. سير العمل (Workflow)

```text
1. إنشاء Issue + تعيين Owner team
2. إنشاء فرع فرعي من main
3. التطبيق + الاختبار + التوثيق (14 سؤالًا)
4. فتح MR مع تعبئة القالب (What/Why/Scope/Tests/.../Rollback)
5. CI يعمل + مراجعة CODEOWNERS
6. حل الملاحظات
7. الدمج (Merge) + حذف الفرع الفرعي
8. تحديث Progress Ledger للمرحلة
```

---

## 8. العلاقة مع باقي القوانين

- قانون التوثيق: [ENGINEERING_DOCUMENTATION_LAW.md](ENGINEERING_DOCUMENTATION_LAW.md)
- DoR / DoD: [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md)
- الأمان: [SECURITY_RULES.md](SECURITY_RULES.md)
- سير العمل الكامل: [/CONTRIBUTING.md](../../CONTRIBUTING.md)
