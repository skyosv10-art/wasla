# Definition of Ready / Definition of Done

> **Scope:** معايير قبول المهمة قبل البدء وبعد الإنجاز — إلزامية لكل فريق.
>
> **المرجع الأم:** أقسام 160 (Definition of Ready) و161 (Definition of Done) من الدليل التنفيذي.
>
> **Last Updated:** 2026-08-19 · **Status:** Active · **Related Team:** جميع الفرق

---

## 1. Definition of Ready (DoR)

> **بند صفري مُضاف (2026-08-25 · [ADR-017](../15-decisions/ADR-017-unified-roadmap-governance-and-work-claim-system.md)):** لا يُعدّ العمل `Ready` قبل تشغيل `bash scripts/checks/find-existing-work.sh "<المجال>"` والتأكد أن لا جهة أخرى تعمله، ثم إضافة سطر حجز نشط في [`WORK_CLAIMS.md`](../16-progress/WORK_CLAIMS.md) بنطاق مسارات محدّد. القاعدة: [`WORK_CLAIM_RULE.md`](WORK_CLAIM_RULE.md).

قبل بدء أي Feature يجب توفر:

```text
No duplicate work (find-existing-work.sh)
Active scope claim (WORK_CLAIMS.md)
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

### تفصيل البنود

- **Problem defined:** ما المشكلة التي نحلها ولماذا الآن؟
- **Acceptance criteria:** متى نعتبر الميزة مكتملة بشكل قابل للقياس؟
- **Dependencies:** على أي Contract أو خدمة أو فريق آخر تعتمد؟
- **API contract if needed:** عقد الـAPI موثّق إن كان التغيير يؤثر واجهة.
- **Data changes:** هل هناك تغيير في الـschema أو retention؟
- **Security impact:** هل تُمس البيانات الحساسة أو الصلاحيات؟ (انظر [`SECURITY_RULES.md`](SECURITY_RULES.md))
- **Observability impact:** ما المقاييس/التنبيهات المطلوبة؟
- **Failure mode:** مسار الفشل معرّف وفق قاعدة «بلا Feature بلا مسار فشل» (10 أسئلة).
- **Owner team:** الفريق المسؤول والمالك الثانوي وفق قاعدة عدم المعرفة المنفردة.

> لا تبدأ Business Implementation قبل توفر Contract المطلوب من الفرق الأخرى. يمكن العمل على Interfaces / Schemas / Mock services / Contract tests بالتوازي.

---

## 2. Definition of Done (DoD)

```text
Implementation
Tests
Docs
Ledger + Board updated
Claim released
Observability
Security
Migration
Rollback
Review
Evidence
```

### تفصيل البنود

- **Implementation:** الكود مكتمل وفق الـAcceptance criteria.
- **Tests:** Unit + Integration + Contract حيث يلزم، وE2E للمسارات الحرجة. لا نعتمد نسبة Coverage عامة كبديل للحكم الهندسي.
- **Docs:** الوثائق حُدّثت وفق [قانون التوثيق](ENGINEERING_DOCUMENTATION_LAW.md) (14 سؤالًا).
- **Observability:** Logs / Metrics / Tracing / Errors / Alerts موجودة. كل Request يحتاج `request_id`, `trace_id`, `service`, `operation`, `latency`, `status`, `error_code`.
- **Security:** Security impact مُقيّم، ولا أسرار في الكود، ولا بيانات حساسة في الـlogs.
- **Migration:** إن وجدت DB migration، فهي مرفقة وقابلة للتراجع.
- **Rollback:** خطة التراجع معروفة قبل Deploy.
- **Review:** مراجعة المالك (CODEOWNERS) وملاحظاته محلولة.
- **Evidence:** دليل الإنجاز (رابط MR، نتائج اختبار، لقطة) — لا «Done» بدون Evidence.

---

## 3. MR Definition of Done (Checklist)

عند فتح/دمج Merge Request يجب أن تكون كل الخانات محققة:

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

## 4. علاقة DoR/DoD بالمراحل

الانتقال بين المراحل يتطلب اجتياز **Exit Gate** التي تتضمن تحقق DoD لكل Task داخل المرحلة. انظر [`/docs/16-progress/MASTER_PROGRESS.md`](../16-progress/MASTER_PROGRESS.md).

### الحد الأدنى الموصى به للاختبار

```text
Core Domain coverage: high
Critical paths: near-total branch coverage
Public APIs: contract covered
Order lifecycle: E2E covered
Payment subscription: E2E covered
Reputation: deterministic rule tests
Dispatch: concurrency tests
```

### عزل اختبارات التكامل (شرطٌ في DoD)

- [ ] خدمةٌ لها ملفّانِ تكامليّانِ أو أكثر: `vitest.integration.config.ts` فيه
      `fileParallelism: false` (أو وسمُ `GOV-ISOLATION: schema-per-worker`)، وملفّاتُ
      التكاملِ مستثناةٌ من `vitest.config.ts` الافتراضيّ.
      المرجع: [TESTING_RULES.md §1](TESTING_RULES.md) · محروسٌ بالفحصِ 7 في `verify-governance.sh`.

### اختبارات التزامن (Concurrency Tests) المطلوبة خصوصًا

- Two drivers accept same order.
- Duplicate webhook.
- Two cancellations.
- Subscription renewal race.
- Inventory race.
- Referral reward race.
- Reputation double event.

---

## 5. الروابط ذات الصلة

- [ENGINEERING_DOCUMENTATION_LAW.md](ENGINEERING_DOCUMENTATION_LAW.md)
- [GIT_RULES.md](GIT_RULES.md) — قواعد Git وMR
- [TESTING_RULES.md](TESTING_RULES.md) — قواعد الاختبار · §1 عزلُ اختباراتِ التكامل (M0-03)
- [SECURITY_RULES.md](SECURITY_RULES.md) — الأمان
- [/CONTRIBUTING.md](../../CONTRIBUTING.md) — قالب تحديث المطور
