# قانون التوثيق الهندسي الإلزامي — ENGINEERING DOCUMENTATION LAW

> **Scope:** كل من يعمل في مستودع WASLA — إلزامي غير قابل للتجاوز.
>
> **المرجع الأم:** القسم 0 (قانون المستودع) من الدليل التنفيذي.
>
> **Last Updated:** 2026-08-19 · **Status:** Active · **Related Team:** جميع الفرق

---

## 0. القاعدة الكلية

> **أي شخص يقوم بأي عمل في المشروع يجب أن يوثق ما فعله في المستودع.**

لا يكفي أن يكون الكود موجودًا. الكود هو المرجع التنفيذي؛ الوثيقة هي المرجع المعرفي، ويجب ألا يتناقضا.

**أي Task لا تحتوي على توثيقها تعتبر غير مكتملة.**

---

## 1. الـ14 سؤالًا الإلزامية

عند تنفيذ أي مهمة يجب توثيق الإجابة على الأسئلة التالية:

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

> لا يسمح بعبارة «Done» بدون **Evidence** (رابط MR، نتائج اختبار، لقطة).

القالب العملي للتحديث اليومي موجود في [`/CONTRIBUTING.md`](../../CONTRIBUTING.md) (قسم قالب تحديث المطور).

---

## 3. قاعدة عدم المعرفة المنفردة

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

إذا غاب `Primary Maintainer` يجب أن يستطيع `Secondary Maintainer` متابعة العمل دون فقدان السياق.

---

## 4. قاعدة عدم تجاوز المراحل (Exit Gates)

لا يتم الانتقال من مرحلة إلى المرحلة التالية لمجرد انتهاء البرمجة.

الانتقال يتم فقط بعد اجتياز **Exit Gate** الخاصة بالمرحلة، بما فيها:

- الاختبارات.
- الوثائق.
- الأمان.
- التكامل.

حالة كل مرحلة موثقة في [`/docs/16-progress/MASTER_PROGRESS.md`](../16-progress/MASTER_PROGRESS.md).

---

## 5. قاعدة عدم وجود Feature بلا مسار فشل

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

## 6. ملكية الوثائق (Documentation Ownership)

كل وثيقة يجب أن تحمل:

```text
Scope
Last Updated
Status
Related Code
Related Team
```

الـCode هو المرجع التنفيذي؛ الوثيقة هي المرجع المعرفي، ويجب ألا يتناقضا. أي تعارض يُحل بجعل الكود والوثيقة متطابقين، مع تسجيل السبب في ADR.

---

## 7. ما الذي لا يجوز للفريق فعله (متعلق بالتوثيق)

- تغيير API بلا تحديث Contract.
- تغيير Event schema بلا Versioning.
- تغيير Business Rule دون وثيقة.
- حذف Audit trail لإخفاء أثر.
- اعتبار «الكود يعمل عندي» نجاحًا.
- إضافة Microservice بلا ADR.
- إضافة Library كبيرة بلا مبرر موثّق.

---

## 8. العلاقة مع باقي القوانين

- سير العمل وقوالب التحديث: [`/CONTRIBUTING.md`](../../CONTRIBUTING.md)
- قواعد Git وMR: [`GIT_RULES.md`](GIT_RULES.md)
- قواعد الأمان للكود: [`SECURITY_RULES.md`](SECURITY_RULES.md)
- Definition of Ready / Done: [`DEFINITION_OF_DONE.md`](DEFINITION_OF_DONE.md)
- القرارات (ADR): [`/docs/15-decisions/`](../15-decisions/)
- حالة المراحل: [`/docs/16-progress/MASTER_PROGRESS.md`](../16-progress/MASTER_PROGRESS.md)
