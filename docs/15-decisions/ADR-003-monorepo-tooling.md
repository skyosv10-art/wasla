# ADR-003 — اختيار أداة بناء المستودع (Monorepo Tooling)

> **Title:** اعتماد pnpm workspaces + TypeScript + Vitest كأساس بناء Phase 00
>
> **Status:** Accepted
>
> **Date:** 2026-08-20
>
> **Decision Owners:** Team 10 — DevOps · Team 11 — Platform · جميع الفرق (مستهلكون)
>
> **Related:** [ROADMAP.md §2](../16-progress/ROADMAP.md) · [ENGINEERING_DOCUMENTATION_LAW.md §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) (إضافة Library كبيرة بلا مبرر موثّق) · [ADR-002](ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md)

---

## Context

Phase 00 Exit Gate يتضمن معيار **«جميع الفرق clone/build/test»**. المستودع حتى الآن يحتوي على الوثائق والهياكل الفارغة (`.gitkeep`) فقط — **لا يوجد إعداد بناء**: لا `package.json`، لا `tsconfig`، لا مدير حزم، لا أداة اختبار. بالتالي معيار «build/test» غير مُلبّى بعد.

بنية المستودع توحي بالمكدّ: ملف `.gitignore` يتضمن `node_modules/` و`.next/`، والحزم (`contracts, events, ui, i18n, auth-sdk, telemetry, errors, config, date-time, test-utils`) هي حزم نمطية كلاسيكية لـ monorepo من نوع **Node.js / TypeScript**، وتطبيق الويب (apps) يوحي بـ Next.js مستقبلاً.

عائق shared runners لا يمنع إعداد أساس البناء محلياً (البناء/الاختبار يتم محلياً دون CI).

## Decision

اعتماد الأدوات التالية كأساس بناء المستودع (Phase 00 Repository Foundation):

| الأداة | الدور | المبرر |
|---|---|---|
| **pnpm 9** (workspaces) | مدير حزم Monorepo | الأسرع، إدارة قرص فعّالة، دعم workspaces مدمج؛ متوافق مع Node 20 (بيئة التطوير الحالية) |
| **TypeScript 5** (strict) | لغة/مُحوِّل | البنية النمطية تتطلب أنواعاً قوية؛ العقود (OpenAPI/JSON Schema) تتوافق مع توليد أنواع TS لاحقاً |
| **Vitest** | أداة اختبار | متوافقة مع Vite، دعم TS أصلي، سريعة، مناسبة لاختبارات Contract لاحقاً |

### النطاق المُتبنّى الآن (تلافياً لتضخّم النطاق)

- `package.json` جذري + `pnpm-workspace.yaml` (يشمل `packages/*, services/*, apps/*, bots/*`).
- `tsconfig.json` جذري (strict) + tsconfig لكل حزمة.
- حزمة واحدة فعليّة مع اختبار دخان (smoke test) لإثبات أن السلسلة تعمل: `packages/errors`.
- job بناء/اختبار في `.gitlab-ci.yml` (يُوثَّق أنه لا ينفّذ حالياً بسبب shared runners، لكنه جاهز للعمل عند تفعيلها).
- `pnpm-lock.yaml` مُلتزم في المستودع (قفل الإصدارات).

### مؤجَّل (يتطلب ADR منفصل عند الحاجة)

- ESLint/Prettier (أداة جودة، ليست شرطاً لـ Exit Gate).
- Next.js / React (تطبيقات apps — مرحلة لاحقة).
- Turbo / Nx (محرّك بناء Monorepo — يُضاف عند الحاجة فقط).
- توليد أنواع TS من العقود (OpenAPI → types) — يُربط بتنفيذ Phase 01.

## Rationale

- **يلبّي معيار Exit Gate «build/test»** دون الحاجة لـ shared runners.
- **لا يتجاوز Phase 01**: هذا عمل أساس بناء (Phase 00)، وليس تنفيذ خدمة Identity.
- **مكدّ موحى به**: البنية و`.gitignore` تحدد Node/TS؛ لا اختيار تعسّفي.
- **التوافق مع العقود**: TS يسمح لاحقاً بتوليد أنواع من OpenAPI/JSON Schema (Contract First → typed client).
- التوثيق عبر ADR لأن إضافة أداة/مكتبة كبيرة تتطلّب مبرراً موثّقاً ([ENGINEERING_DOCUMENTATION_LAW.md §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md)).

## Consequences

### إيجابية
- الفرق تستطيع `pnpm install` + `pnpm build` + `pnpm test` محلياً بعد الـ clone.
- أساس موحّد للبناء يمنع تفرّق الأدوات بين الفرق.
- job CI جاهز للتحقق فور تفعيل shared runners.

### سلبية / تكاليف
- تثبيت pnpm مطلوب على بيئات المطورين (`corepack enable` أو تثبيت pnpm 9). يُوثّق في CONTRIBUTING.
- قفل pnpm 9 مع Node 20 — يحتاج ترقية pnpm لاحقاً عند الانتقال إلى Node 22+.

### مخاطر مُدارة
- خطر اختيار مكدّ لم يقصده المشروع: يُخفّف بأن البنية و`.gitignore` توحيان به بالفعل، وأي تبديل لاحق موثّق بـ ADR.

## Alternatives

### بديل 1: npm workspaces (بدل pnpm)
- **مرفوض حالياً:** pnpm أفضل في إدارة القرص والسرعة لـ monorepo؛ npm يُترك كخيار احتياطي. (قد يُعاد التقييم إن تطلّب ذلك.)

### بديل 2: تأجيل إعداد البناء حتى تفعيل shared runners
- **مرفوض:** يؤخّر معيار «build/test» لـ Exit Gate دون مبرر؛ الإعداد محلي ولا يحتاج CI.

### بديل 3: اعتماد Turbo/Nx فوراً
- **مرفوض حالياً:** تضخّم نطاق مبكّر؛ يُضاف عند الحاجة فقط (عندما يصير بناء الحزم المتداخلة معقّداً).

## Compliance Notes

- لا يُغيّر ترتيب ROADMAP ولا يُعتبر Phase 00 = Completed (تبقى Exit Gate Pending حتى اجتياز CI فعلياً على GitLab).
- يُحدَّث [MASTER_PROGRESS.md](../16-progress/MASTER_PROGRESS.md) (Phase 00 → أساس بناء مُضاف، التحقق من CI معلّق) و[TASK_LOG.md](../16-progress/TASK_LOG.md) و[HANDOFF_NEXT_STEPS.md](../16-progress/HANDOFF_NEXT_STEPS.md).
