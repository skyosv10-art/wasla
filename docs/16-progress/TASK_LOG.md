# TASK_LOG — سجل المهام بكل دفع (ملزم)

> **النوع:** سجل إلزامي. كل دفع يمس الكود يجب أن يرافقه إدخال هنا (الحد الأدنى لقاعدة [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md)).
>
> **القاعدة:** الإدخال يُكتب **قبل أو مع** الدفع، ويصف ماذا ولماذا وأين وكيف تم الاختبار وما الخطوة التالية.
>
> **التنسيق:** الأحدث في الأعلى.

---

## قالب الإدخال

```markdown
### [YYYY-MM-DD] <عنوان التغيير>
- **Files:** <الملفات/المسارات المتأثرة>
- **Services:** <الخدمات إن وجدت، أو «—»>
- **Why:** <السبب / القرار>
- **Tests:** <كيف تم الاختبار / التحقق>
- **Next:** <الخطوة التالية>
- **Related:** <MR / Issue / ADR>
```

---

## السجل

### [2026-08-20] إنشاء وثيقة تسليم (Handoff) واضحة للجهة التالية
- **Files:** `docs/16-progress/HANDOFF_NEXT_STEPS.md` (جديد)، `docs/16-progress/MASTER_PROGRESS.md` (إشارة)، `docs/16-progress/TASK_LOG.md` (هذا الإدخال)
- **Services:** — (وثائق فقط)
- **Why:** القاعدة الحاكمة تُلزم بإبقاء خارطة الطريق واضحة لكل من سيعمل في المستودع بعد هذه الجلسة: ماذا تمّ، ماذا بقي، والخطوات الدقيقة. كانت هذه المعلومة موزّعة بين MASTER_PROGRESS/TASK_LOG/ROADMAP، فجُمعت في وثيقة تسليم واحدة قابلة للتنفيذ.
- **Decision:** إنشاء `HANDOFF_NEXT_STEPS.md` يلخّص: (1) Snapshot للحالة الحالية وPhase 00 = Exit Gate Pending، (2) العائق الوحيد المتبقي (shared runners — إجراء خارجي من مالك الحساب) مع حلّين دقيقين، (3) المسار الكامل Phase 00→24 حتى 100%، (4) Checklist فوري لمن يأتي بعدي، (5) ملاحظات أمنية (تدوير الرمز، تشديد حماية main).
- **Tests:** التحقق من صحة الروابط النسبية داخل الوثيقة، واتساق الحالة مع MASTER_PROGRESS (Phase 00 = Exit Gate Pending).
- **Next:** بعد تفعيل shared runners من مالك الحساب واجتياز pipeline على MR !1 ودمجه، يُحدّث Phase 00 → Completed ويُبدأ Phase 01.
- **Related:** [MR !1](https://gitlab.com/uxxxu/wasla/-/merge_requests/1) · [HANDOFF](HANDOFF_NEXT_STEPS.md)

### [2026-08-20] إصلاح فحص الأسرار في CI وإكمال متطلبات Phase 00 Exit Gate
- **Files:** `scripts/checks/scan-secrets.sh` (جديد)، `scripts/hooks/pre-push` (تعديل — ربط فحص الأسرار بالـ hook)، `.gitlab-ci.yml` (تعديل job `repo-structure`)، `docs/16-progress/MASTER_PROGRESS.md` (تحديث حالة Phase 00)، `docs/16-progress/TASK_LOG.md` (هذا الإدخال)
- **Services:** — (بنية المستودع و CI فقط)
- **Why:** فحص الأسرار القديم في `.gitlab-ci.yml` كان يستعمل `grep -rE '...' .` فيطابق ملف `.gitlab-ci.yml` نفسه (يحتوي على أنماط الكشف كنص حرفي مثل `glpat-` و`ghp_`) فيفشل job الـ `repo-structure` دائماً. هذا يكسر شرط «CI passes» في Phase 00 Exit Gate.
- **Decision:** استبدال الفحص المضمّن بـسكربت منفصل `scripts/checks/scan-secrets.sh` يستعمل `git grep` (يتجاهل `.git` تلقائياً ويفحص الملفات المتتبعة فقط)، مع استثناء ملفات «الكاشف» نفسها (`.gitlab-ci.yml` و`scan-secrets.sh`) لأنها تحتوي على توقيعات الكشف لا أسراراً.
- **Tests:** (1) المستودع النظيف يمر (exit 0). (2) ملف متتبع يحوي `AKIA...`/`glpat-...`/`ghp_...` يُرفض (exit 1) ويلتقط الثلاثة. (3) بعد الحذف يمر مجدداً. (4) `bash -n` للسكربتات الثلاثة + صحة YAML للـ `.gitlab-ci.yml`. (5) doc-coverage E2E: تغيير كود فقط → FAIL، تغيير كود+توثيق → PASS. (6) فحص بنية المستودع كاملة نجحت محلياً. (7) التحقق من حماية فرع main عبر GitLab API (محمي، Maintainers فقط، لا force push). (8) محاكاة pre-push hook: ملف يحوي سر → exit 1 (يُحجب)، نظيف → exit 0.
- **Next:** دفع هذا الإصلاح عبر MR (لا دفع مباشر إلى main)، اجتياز pipeline فعلياً على GitLab، ثم اعتماد Phase 00 = Completed وبدء Phase 01 (Identity Foundation). كما يجب تفعيل `core.hooksPath scripts/hooks` على نسخ المطورين (`git config core.hooksPath scripts/hooks`).
- **Related:** جزء من Phase 00 Exit Gate؛ راجع [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md) و[MASTER_PROGRESS](MASTER_PROGRESS.md) صف Phase 00.

### [2026-08-19] إضافة خارطة الطريق وقاعدة التوثيق مع الدفع
- **Files:** `docs/16-progress/ROADMAP.md`، `docs/16-progress/TASK_LOG.md`، `docs/00-rules/PUSH_DOCUMENTATION_RULE.md`، `scripts/checks/require-doc-update.sh`، `scripts/hooks/pre-push`، `.gitlab/merge_request_templates/Default.md`، `.gitlab-ci.yml` (تعديل)، `docs/16-progress/MASTER_PROGRESS.md` (تعديل)، `CONTRIBUTING.md` (تعديل)، `README.md` (تعديل)
- **Services:** — (بنية المستودع والوثائق فقط)
- **Why:** المشروع يحتاج ترتيباً زمنياً ملزماً للمراحل (لم يكن موجوداً)، وقاعدة ميكانيكية تُلزم كل دفع بأن يرافقه توثيق يدخل شجرة المستودع. الترتيب سابقاً كان قائماً على Exit Gates فقط دون تخطيط زمني واضح.
- **Decision:** اعتماد أسابيع نسبية (W0 = اجتياز Phase 00 Exit Gate) لمنع تقادم الوثيقة. الانتقال الفعلي يتم بالـ Exit Gate لا بالوقت. الإلزام خادمياً عبر CI job `doc-coverage` (الفشل يمنع الدمج) + hook محلي كتنبيه مبكر.
- **Tests:** فحص bash syntax للسكربتات (`bash -n`)، فحص صحة YAML للـ `.gitlab-ci.yml`، التحقق من روابط الوثائق النسبية.
- **Next:** تفعيل `core.hooksPath` على نسخ المطورين، وإثبات أن job الـ `doc-coverage` يعمل عند أول MR (جزء من Phase 00 Exit Gate).
- **Related:** ADR-001 (Identity) — لا تعارض؛ الخارطة تضع 01 ضمن W1–W3.

---

## 2026-08-20 · Phase 01 — Identity Foundation: عقود Contract First (الخطوة الأولى)

**Task:** إنتاج عقود خدمة Identity بمنهجية Contract First (مستقلة عن المكدّ التقني) كأول خطوة نحو Phase 01 Exit Gate. **Status:** Completed (Contract First stage) · **MR:** [!2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2)

**ماذا تم إنجازه (1):** إنتاج أربعة عقود لخدمة Identity — API Contract (OpenAPI 3.0.3)، Event Contract (JSON Schema 2020-12)، Data Contract (PostgreSQL DDL)، Error Contract (كتالوج أخطاء) — بالإضافة إلى فهرس المستهلك في `packages/contracts/identity/`.

**لماذا تم اختياره (2):** منهجية Contract First الموثّقة في README §7 تسمح بالإنتاج المتوازي للعقود قبل التنفيذ؛ العقود مستقلة عن المكدّ التقني فلا تتطلب اختيار TS/Go الآن؛ العمل لا يعتمد على تشغيل CI (متجاوزةً عائق shared runners المؤقت).

**أين تم التغيير (3):** `services/identity/contracts/` (جديد: api.openapi.yml, events.json, schema.sql, errors.md, README.md)، `packages/contracts/identity/README.md` (جديد)، `docs/15-decisions/ADR-002-*.md` (جديد)، `docs/16-progress/MASTER_PROGRESS.md` (Phase 01 → In Progress)، `docs/16-progress/TASK_LOG.md` (هذا الإدخال).

**الملفات/الخدمات المتأثرة (4):** خدمة Identity (Phase 01)؛ الحزم المستهلكة: packages/contracts, packages/events (مرجعية فقط).

**ما الـAPI/Event/Schema الذي تغير (5):** جديد بالكامل (لا تنفيذ سابق). API: resolve/getUser/addLink/recovery/history. Events v1: identity.created / link.added / telegram_username.changed / recovery.started. Schema: identity_users, identity_links, identity_history, identity_recovery_requests, identity_outbox.

**كيف تم الاختبار (6):** `yaml.safe_load` + `openapi-spec-validator` → OpenAPI 3.0.3 صالح؛ `Draft202012Validator.check_schema` → JSON Schema صحيح؛ فحص عبارات DDL؛ مراجعة يدوية لاتساق العقود مع ADR-001.

**ما المشاكل التي ظهرت (7):** خطأ صياغة YAML (علامة `: ` داخل قيمة description) — صُلح بالتضمين بعلامات اقتباس. تكرار أعمدة عند تعديل سطر Phase 01 — صُلح.

**ما الذي لم يكتمل (8):** تنفيذ فعلي للعقود (يتطلب اختيار المكدّ بـADR منفصل)؛ اختبارات Contract (consumer/provider)؛ اجتياز Phase 01 Exit Gate فعلياً.

**الخطوة التالية (9):** اختيار المكدّ التقني لخدمة Identity (ADR مستقبلي) → تنفيذ ضد العقود → كتابة Contract tests → اجتياز Exit Gate «إنشاء مستخدم من Telegram وبقاء هويته مستقرة عبر تغيير Username». لكن قبل ذلك: تفعيل shared runners ودمج MR !1 لاعتماد Phase 00 = Completed.

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد على العقود المُنتَجة هنا؛ ويعتمد على حلّ عائق shared runners (إجراء مالك الحساب) لاجتياز Phase 00 Exit Gate والانتقال الكامل لتنفيذ Phase 01.

**Migration/Deployment/Config (11):** لا — العقود تعريفات فقط، لا migration ولا deployment.

**مخاطر/قرارات تحتاج مراجعة (12):** انحراف عن تسلسل Exit Gates موثّق في [ADR-002](../15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md) — يجب مراجعته وقبوله. اختيار المكدّ التقني معلّق.

**الروابط (13):** MR [!2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2) · [ADR-001](../15-decisions/ADR-001-identity-decoupled-from-telegram.md) · [ADR-002](../15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md) · [HANDOFF_NEXT_STEPS.md](HANDOFF_NEXT_STEPS.md)

**الشخص/الفريق الذي يتابع (14):** Team 01 — Identity & Auth (التنفيذ بعد اختيار المكدّ) · Team 12 — Integration (الاستهلاك عبر العقود).

---

## 2026-08-20 · تحديث خارطة الطريق بعد دمج MR !1 وMR !2

**Task:** تحديث وثائق التقدم والخارطة لتعكس دمج MR !1 (Phase 00 CI fix) وMR !2 (Phase 01 Identity contracts) إلى main. **Status:** Completed · **MR:** [!3](https://gitlab.com/uxxxu/wasla/-/merge_requests/3)

**ماذا تم إنجازه (1):** تأكد من دمج MR !1 (commit `cba9a75`) وMR !2 (commit `a15985d`) إلى `main`. حدّثت MASTER_PROGRESS (Phase 00 → Merged to main / Exit Gate Pending للتحقق من CI؛ Phase 01 → عقود مدمجة إلى main، In Progress) وROADMAP (آخر تحديث + ملاحظة حالة: W0 لم يبدأ بعد) وHANDOFF.

**لماذا تم اختياره (2):** يجب أن تعكس وثائق التقدم الحالة الفعلية للمستودع بعد الدمج — كي يعرف من يأتي بعدي أن الكود على main، وأن العائق الوحيد المتبقي للـ Exit Gate هو التحقق من CI (shared runners).

**أين تم التغيير (3):** `docs/16-progress/MASTER_PROGRESS.md`، `docs/16-progress/ROADMAP.md`، `docs/16-progress/TASK_LOG.md` (هذا الإدخال)، `docs/16-progress/HANDOFF_NEXT_STEPS.md`.

**الملفات/الخدمات المتأثرة (4):** وثائق التقدم فقط (لا تغيير برمجي).

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيء — فقط توثيق حالة الدمج.

**كيف تم الاختبار (6):** `git fetch` + `git pull` للتأكد من تطابق main المحلي مع البعيد؛ التحقق من حالة الدمج عبر GitLab API (state: merged لـ !1 و!2)؛ فحص أن العقود والسكربت موجودة على main (`git ls-files`).

**ما المشاكل التي ظهرت (7):** لا مشاكل. كلا الـ MR دُمجا دون تعارضات.

**ما الذي لم يكتمل (8):** **التحقق الفعلي من اجتياز CI على main** — لم يحدث بعد لأن shared runners غير متاحة. Phase 00 Exit Gate لا يُعتبر مجتازاً بمجرد الدمج.

**الخطوة التالية (9):** (أ) تفعيل shared runners (إجراء مالك الحساب) ثم تشغيل pipeline على main للتحقق من اجتياز CI → اعتماد Phase 00 = Completed = بداية W0. (ب) اختيار المكدّ التقني لـ Identity (ADR) → تنفيذ ضد العقود → Contract tests → اجتياز Phase 01 Exit Gate.

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد على حلّ عائق shared runners (إجراء خارجي) لاجتياز Phase 00 Exit Gate وبدء W0.

**Migration/Deployment/Config (11):** لا.

**مخاطر/قرارات تحتاج مراجعة (12):** الدمج تم دون اجتياز CI فعلي (بسبب shared runners) — مخالفة محتملة لقاعدة «CI passes» في Exit Gate. يُخفّف: الكود تم التحقق منه محلياً (scan-secrets + doc-coverage + OpenAPI/JSON Schema validation) قبل الدمج، والعائق بيئي وليس خطأ كود. **يُنصح بشدّ حماية main لمنع الدفع/الدمج دون CI ناجح مستقبلاً.**

**الروابط (13):** MR [!1](https://gitlab.com/uxxxu/wasla/-/merge_requests/1) · MR [!2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2) · MR [!3](https://gitlab.com/uxxxu/wasla/-/merge_requests/3) · [ADR-002](../15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md)

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (تفعيل shared runners) · Team 01 — Identity & Auth (تنفيذ بعد اختيار المكدّ).

---

## 2026-08-20 · Phase 00 — أساس بناء المستودع (Monorepo Tooling Foundation)

**Task:** إعداد أساس بناء Monorepo (pnpm + TypeScript + Vitest) لخدمة معيار Exit Gate «جميع الفرق clone/build/test». **Status:** Completed · **MR:** [!4](https://gitlab.com/uxxxu/wasla/-/merge_requests/4)

**ماذا تم إنجازه (1):** إعداد أساس بناء كامل: `package.json` جذري + `pnpm-workspace.yaml` + `tsconfig.json` (strict) + حزمة `@wasla/errors` فعليّة (وحدة + اختبار دخان بـ3 اختبارات) + job `build-test` في `.gitlab-ci.yml` + `pnpm-lock.yaml` مُلتزم. توثيق الاختيار في [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md).

**لماذا تم اختياره (2):** معيار Exit Gate «clone/build/test» غير مُلبّى بدون إعداد بناء؛ البنية و`.gitignore` توحيان بـNode/TS؛ العمل محلي ولا يحتاج shared runners؛ لا يتجاوز Phase 01 (أساس بناء، ليس تنفيذ Identity).

**أين تم التغيير (3):** الجذر (`package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `pnpm-lock.yaml`, `.gitlab-ci.yml`)، `packages/errors/` (`package.json`, `tsconfig.json`, `src/index.ts`, `src/__tests__/errors.test.ts`)، `docs/15-decisions/ADR-003-*.md`، `docs/16-progress/{MASTER_PROGRESS,TASK_LOG,HANDOFF}.md`، `CONTRIBUTING.md`.

**الملفات/الخدمات المتأثرة (4):** البنية التحتية للمستودع (Phase 00)؛ حزمة `@wasla/errors` (مشتركة).

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيء — أساس بناء فقط. حزمة `@wasla/errors` تقدّم صنف `WaslaError` يتوافق مع عقد الأخطاء (code ثابت + traceId).

**كيف تم الاختبار (6):** `pnpm --filter @wasla/errors typecheck` → نجح؛ `pnpm --filter @wasla/errors test` → 3 اختبارات اجتازت؛ `scan-secrets.sh` → نظيف؛ CI lint خادمي → صالح (True، بلا أخطاء/تحذيرات)؛ code paths مصحوبة بـdocs/ (اجتاز قاعدة doc-coverage).

**ما المشاكل التي ظهرت (7):** مسار استيراد خاطئ في الاختبار (`../src/index.js` بدل `../index`) — صُلح. pnpm latest يتطلب Node 22+ — صُلح باعتماد pnpm 9 (متوافق Node 20).

**ما الذي لم يكتمل (8):** job `build-test` في CI لا تنفّذ فعلياً (shared runners غير متاحة) — جاهزة للعمل عند تفعيلها. ESLint/Next.js/Turbo مؤجلة (ADR منفصل عند الحاجة).

**الخطوة التالية (9):** تفعيل shared runners → تشغيل pipeline على `main` (job `build-test`) للتحقق من اجتياز CI → اعتماد Phase 00 = Completed (W0). ثم اختيار مكدّ تنفيذ Identity (ADR) → تنفيذ ضد العقود → Contract tests.

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد على حلّ عائق shared runners لاجتياز Phase 00 Exit Gate وبدء W0.

**Migration/Deployment/Config (11):** إعداد بيئة: `corepack enable` + `corepack prepare pnpm@9 --activate` مطلوب على بيئات المطورين (مُوثّق في CONTRIBUTING).

**مخاطر/قرارات تحتاج مراجعة (12):** اعتماد pnpm 9 مع Node 20 — يحتاج ترقية pnpm لاحقاً عند الانتقال إلى Node 22+. تأجيل ESLint/Next/Turbo مقصود (تضخّم نطاق مبكّر). راجع [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md).

**الروابط (13):** MR [!4](https://gitlab.com/uxxxu/wasla/-/merge_requests/4) · [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) · MR [!1](https://gitlab.com/uxxxu/wasla/-/merge_requests/1) · MR [!2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2) · MR [!3](https://gitlab.com/uxxxu/wasla/-/merge_requests/3)

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (تفعيل shared runners) · Team 10 — DevOps (إعداد بيئات المطورين) · Team 01 — Identity & Auth (التنفيذ بعد اختيار المكدّ).

---

## 2026-08-20 · التوفيق بعد دمج MR !4 + محاولة فكّ عائق CI

**Task:** توفيق وثائق التقدم بعد دمج MR !4 (أساس البناء)، وتوثيق محاولة فكّ عائق CI عبر runner خاص. **Status:** Completed · **MR:** [!5](https://gitlab.com/uxxxu/wasla/-/merge_requests/5)

**ماذا تم إنجازه (1):** تأكد من دمج MR !4 (commit `052d3ff`) إلى main. حدّثت MASTER_PROGRESS (Phase 00 → «Engineering work complete — Exit Gate Pending للتحقق من CI فقط») وROADMAP وHANDOFF. أنشأت [Runbook فكّ عائق CI](../14-runbooks/CI_RUNNER_UNBLOCK.md) بمساري الحلّ الدائمين.

**لماذا تم اختياره (2):** يجب أن تعكس الوثائق أن جميع المعايير الهندسية لـ Phase 00 مكتملة، وأن العائق الوحيد المتبقّي خارجي (CI). توثيق محاولة runner يمنع تكرارها عبثاً.

**أين تم التغيير (3):** `docs/16-progress/{MASTER_PROGRESS,ROADMAP,HANDOFF_NEXT_STEPS,TASK_LOG}.md`، `docs/14-runbooks/CI_RUNNER_UNBLOCK.md` (جديد).

**الملفات/الخدمات المتأثرة (4):** وثائق فقط.

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيء.

**كيف تم الاختبار (6):** التحقق من دمج MR !4 عبر GitLab API (state: merged). محاولة تجريبية لتثبيت Docker وتشغيل الـ daemon (نجح البدء بـ`--bridge=none` لكن الـ daemon لا يستمر بين الأوامر وbridge/iptables غير مدعوم).

**ما المشاكل التي ظهرت (7):** استضافة runner خاص من بيئة التنفيذ **غير مجدية**: (1) العمليات الخلفية تُنهى بين الأوامر، (2) bridge networking/iptables غير مدعوم. مؤكد أن الحلّ يتطلب جهازاً مستمراً.

**ما الذي لم يكتمل (8):** اجتياز CI فعلياً على GitLab — لا يزال معلّقاً على إجراء مالك الحساب (verify namespace أو runner دائم على جهاز مستمر).

**الخطوة التالية (9):** إجراء مالك الحساب: حلّ عائق CI وفق [Runbook](../14-runbooks/CI_RUNNER_UNBLOCK.md) → تشغيل pipeline على `main` → اعتماد Phase 00 = Completed (W0) → اختيار مكدّ تنفيذ Identity (ADR) → تنفيذ ضد العقود → Contract tests.

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد كلياً على حلّ عائق shared runners الخارجي.

**Migration/Deployment/Config (11):** لا.

**مخاطر/قرارات تحتاج مراجعة (12):** لا مخاطر هندسية متبقّية. العائق خارجي بحت. يُنصح بشدّ حماية main لمنع الدمج دون CI ناجح مستقبلاً.

**الروابط (13):** MR [!5](https://gitlab.com/uxxxu/wasla/-/merge_requests/5) · [Runbook فكّ عائق CI](../14-runbooks/CI_RUNNER_UNBLOCK.md) · MR [!4](https://gitlab.com/uxxxu/wasla/-/merge_requests/4) · [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md)

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (حلّ عائق CI) · Team 10 — DevOps (إعداد runner دائم إن اختير المسار 2) · Team 01 — Identity (التنفيذ بعد W0).
