# ADR-004 — توسيع العمل المسموح قبل البوابة: توليد أنواع TS من عقود Identity

> **Title:** السماح بتوليد أنواع TypeScript من عقود Identity (Contract First tooling) قبل اجتياز Phase 00 Exit Gate
>
> **Status:** Accepted
>
> **Date:** 2026-08-20
>
> **Decision Owners:** مالك المشروع · Team 01 — Identity & Auth · Team 12 — Integration
>
> **Supersedes:** —
>
> **Related:** [ADR-002](ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md) (الإطار الذي أذن بالعقود) · [ADR-003](ADR-003-monorepo-tooling.md) (أساس البناء) · [ENGINEERING_DOCUMENTATION_LAW.md §4](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) (Exit Gates)

---

## Context

Phase 00 Exit Gate لا يزال معلّقاً على معيار واحد: «CI passes» — محجوب خارجياً بـ shared runners غير المتاحة للـ namespace المجاني غير المُتحقَّق منه. تأكد (2026-08-20) أن الـ namespace لا يزال free/غير مُتحقَّق، وأن pipelines تفشل فوراً بـ0 وظائف. جميع المعايير الهندسية الأخرى لـ Phase 00 مكتملة ومدمجة ([MR !1–!5](../16-progress/MASTER_PROGRESS.md)).

مالك المشروع وجّه بشكل متكرّر ومتواصل بمتابعة العمل. مسار فكّ العائق (التحقق من namespace) هو إجراء حساب خارجي لم يُنفَّذ بعد، ولا يمكن تنفيذه برمجياً من بيئة التنفيذ.

[ADR-003](ADR-003-monorepo-tooling.md) أشار صراحةً إلى أن «TS يسمح لاحقاً بتوليد أنواع من OpenAPI/JSON Schema (Contract First → typed client)» كعمل مستقبلي.

## Decision

**توسيع نطاق العمل المسموح به قبل البوابة (بموجب هذا ADR) ليشمل:** توليد أنواع TypeScript من عقود Identity المُنتَجة (OpenAPI → أنواع TS) في حزمة `packages/contracts/identity`، باستخدام أداة `openapi-typescript`.

### القيود

1. **نطاق مسموح:** توليد أنواع TS من عقد API الموجود (`services/identity/contracts/api.openapi.yml`) فقط — **أداة Contract First**، وليس تنفيذاً لخدمة Identity أو أي منطق تشغيلي.
2. **لا يُعتبر Phase 01 = بدء التنفيذ.** يبقى ضمن نطاق «إنتاج artifacts العقد» المُذن به في [ADR-002](ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md) —只不过 الآن بالصورة المُكتبة (typed).
3. **مصدر الحقيقة الوحيد:** ملف OpenAPI هو المصدر؛ الأنواع المولّدة لا تُعدَّل يدوياً (تُولَّد عبر سكربت). يمنع الانحراف بين العقد والأنواع.
4. **لا يجاوز Exit Gate:** لا يُغيّر وضع Phase 00 (تبقى Exit Gate Pending) ولا يُجتاز Exit Gate لـ Phase 01.

### لماذا الآن

- توجيه مالك المشروع المتكرر بمتابعة العمل.
- العمل **غير محجوب** بـ shared runners (توليد الأنواع محلي).
- **فائدة فعلية:** المستهلكون (Telegram Adapter، الخدمات المستقبلية) يحصلون على أنواع TS موثوقة من العقد، مما يسرّع Phase 01 لاحقاً.
- شرط المستشار مُلبّى: «توليد الأنواع مسموح بعد CI ناجح أو بعد ADR جديد يوسّع العمل المسموح قبل البوابة» — هذا ADR الجديد.

## Rationale

- العقود المُكتبة (typed) هي امتداد طبيعي لـ Contract First (ADR-002/003).
- `openapi-typescript` أداة معيارية تركّز على توليد الأنواع فقط — لا تُضيف منطقاً تشغيلياً.
- التوثيق عبر ADR يحفظ شفافية خارطة الطريق لأي جهة تالية.

## Consequences

### إيجابية
- المستهلكون يحصلون على أنواع TS من مصدر واحد (OpenAPI) — يقلّل التباين بين العقد والتنفيذ.
- تسريع Phase 01 عند بدئه (الأنواع جاهزة).

### سلبية / تكاليف
- إضافة `openapi-typescript` كاعتماد تطوير (devDependency) — مبرّر موثّق هنا.
- يجب إعادة توليد الأنواع عند تغيير العقد (سكربت `generate`).

### مخاطر مُدارة
- خطر توليد أنواع من عقد غير نهائي: يُخفّف بأن العقد (ADR-001/002) مقبول، وأي تغيير مستقبلي يتطلب إعادة التوليد + تحديث docs/.

## Alternatives

### بديل 1: كتابة الأنواع يدوياً
- **مرفوض:** يُنشئ تبايناً بين العقد والأنواع، ويخالف مبدأ «مصدر الحقيقة الواحد».

### بديل 2: الانتظار حتى اجتياز CI قبل التوليد
- **مرفوض:** مالك المشروع وجّه بمتابعة العمل؛ التوليد محلي ولا يحتاج CI.

## Compliance Notes

- لا يُغيّر ترتيب ROADMAP ولا يُجتاز Exit Gate لـ Phase 00/01.
- يُحدَّث [MASTER_PROGRESS.md](../16-progress/MASTER_PROGRESS.md) (Phase 01: إضافة الأنواع المولّدة كـ evidence إضافي) و[TASK_LOG.md](../16-progress/TASK_LOG.md).
- عند اجتياز CI فعلياً لاحقاً، يُغلق هذا الاستثناء (Status → Superseded) ويُتابع التنفيذ وفق التدفق الطبيعي.
