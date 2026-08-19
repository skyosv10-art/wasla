# CONTRIBUTING — دليل المساهمة في مستودع WASLA

> **النطاق:** هذا الملف إلزامي لكل من يعمل في المستودع. يحدد سير العمل وقواعد التوثيق وGit وDefinition of Done.
>
> **المرجع الأم:** أقسام 0, 104, 105, 107, 108, 109, 111, 160, 161 من الدليل التنفيذي.

---

## 1. قاعدة التوثيق غير القابلة للتجاوز

**أي شخص يقوم بأي عمل في المشروع يجب أن يوثق ما فعله في المستودع.** لا يكفي أن يكون الكود موجودًا.

عند تنفيذ أي مهمة يجب توثيق الإجابة على الـ14 سؤالًا التالية:

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

> **أي Task لا تحتوي على توثيقها تعتبر غير مكتملة.**

النسخة الكاملة للقانون في [`docs/00-rules/ENGINEERING_DOCUMENTATION_LAW.md`](docs/00-rules/ENGINEERING_DOCUMENTATION_LAW.md).

---

## 2. السجل الإلزامي لكل مهمة

لكل Issue أو Work Item يجب تحديث الحقول التالية:

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

ولا يسمح بعبارة «Done» بدون **Evidence** (رابط MR، نتائج اختبار، لقطة).

---

## 3. قاعدة عدم المعرفة المنفردة

لا يجوز أن يصبح أي جزء حرج من النظام معروفًا لشخص واحد فقط. كل Module حرج يجب أن يكون له:

```text
Primary Maintainer
Secondary Maintainer
Documentation
Tests
Runbook
Architecture Notes
```

---

## 4. قواعد Git (GitLab)

### 4.1 Main branch

- **Protected.** لا Push مباشر.
- كل التغييرات تمر عبر Merge Request.

### 4.2 Merge Request

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

### 4.3 Commit message

رسالة واضحة بصيغة `type(scope): subject`. أمثلة:

```text
feat(order): add multi-stop delivery state
fix(dispatch): prevent duplicate assignment
chore(ci): add dependency scanning
docs(rules): update security rules
refactor(identity): extract phone normalization
```

القواعد الكاملة في [`docs/00-rules/GIT_RULES.md`](docs/00-rules/GIT_RULES.md).

---

## 5. Merge Request Definition of Done

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

## 6. Definition of Ready

قبل بدء أي Feature يجب توفر:

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

## 7. Definition of Done

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

التفاصيل في [`docs/00-rules/DEFINITION_OF_DONE.md`](docs/00-rules/DEFINITION_OF_DONE.md).

---

## 8. سير العمل بين الفرق — Contract First

- الفريق المنتج لخدمة يكتب: `API Contract` + `Event Contract` + `Data Contract` + `Error Contract`.
- ثم الفريق المستهلك يطور Mock/Contract Client.
- هذا يسمح بتوازي العمل دون انتظار اكتمال الخدمة.

مثال على Parallel Stage في Phase 06 (Order Engine):

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

## 9. واجبات الفريق في كل مرحلة

كل فريق له مهمتان متوازيتان: **Build + Document**. وإذا كانت مرحلة ما تعتمد على Team آخر، لا تبدأ Business Implementation قبل توفر Contract المطلوب. لكن يمكن للفريق العمل على Interfaces / Schemas / Mock services / Contract tests بالتوازي.

---

## 10. ما الذي لا يجوز للفريق فعله

- إدخال Secret في Git.
- تعديل Production DB يدويًا بلا Runbook.
- تغيير API بلا تحديث Contract.
- تغيير Event schema بلا Versioning.
- الوصول المباشر لجدول خدمة أخرى بعد استخراجها.
- إضافة Library كبيرة بلا مبرر.
- إضافة Microservice بلا ADR.
- تغيير Business Rule دون وثيقة.
- حذف Audit trail لإخفاء أثر.
- اعتبار «الكود يعمل عندي» نجاحًا.

---

## 11. قالب تحديث المطور (Work Update)

يُلصق هذا القالب في كل Issue / MR:

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

## 12. المراحل وExit Gates

لا يتم الانتقال من مرحلة إلى التالية لمجرد انتهاء البرمجة. الانتقال يتم فقط بعد اجتياز Exit Gate (اختبارات + وثائق + أمان + تكامل). انظر [`docs/16-progress/MASTER_PROGRESS.md`](docs/16-progress/MASTER_PROGRESS.md) لحالة كل مرحلة.

## 13. أمان أولًا

قبل أول commit، اقرأ [`SECURITY.md`](SECURITY.md) و[`docs/00-rules/SECURITY_RULES.md`](docs/00-rules/SECURITY_RULES.md). لا أسرار في الكود، ولا بيانات حساسة في الـlogs، وProduction access ليس افتراضيًا للمطورين.
