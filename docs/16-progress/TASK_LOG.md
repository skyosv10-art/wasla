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

## 2026-08-20 · إصلاح فشل job `build-test` في CI: إضافة @types/node لعقد Identity

**Task:** إصلاح فشل job `build-test` (typecheck) على GitLab CI بعد تفعيل shared runners — أخطاء `Cannot find module 'node:fs'` / `node:path` / `Cannot find name '__dirname'` في `packages/contracts/identity/src/__tests__/events.test.ts`. **Status:** Completed (الإصلاح مُتحقَّق محلياً بتثبيت مُجمّد نظيف مُطابق لـCI؛ [MR !9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9) مفتوح للمراجعة/الدمج) · **MR:** [!9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9)

**ماذا تم إنجازه (1):** إضافة `@types/node@^20.0.0` كاعتماد تطوير صريح في `packages/contracts/identity/package.json`، وإعادة توليد `pnpm-lock.yaml`. هذا يجعل `node:fs` / `node:path` / `__dirname` (المستعملة في اختبار حماية انحراف الأحداث `events.test.ts`) قابلة للتحليل بواسطة `tsc` دون الاعتماد على `@types/node` عام خارج المستودع.

**لماذا تم اختياره (2):** السبب الجذري: `events.test.ts` يستعمل واجهات Node.js (`node:fs`/`node:path`/`__dirname`) لكن `@types/node` لم يكن مُعلَناً في أي `package.json`. كان `@types/node` مُشاراً إليه في الـlockfile كـpeer dependency اختياري فقط (غير مُثبّت فعلياً). محلياً كان typecheck يجتاز صدفةً بسبب وجود `@types/node` عام في `/home/user/node_modules/@types/node` (خارج المستودع) يحلّه `tsc` عبر تسلّق الأدلة — لكن CI (`node:20-alpine` نظيف) لا يملكه، ففشل. الإصلاح الصحيح: جعل `@types/node` اعتماداً صريحاً للحزمة التي تستعمله، وفق مبدأ «لا اعتماد غير مُعلَن».

**أين تم التغيير (3):** `packages/contracts/identity/package.json` (إضافة `@types/node` إلى devDependencies)، `pnpm-lock.yaml` (إعادة توليد)، `docs/16-progress/TASK_LOG.md` (هذا الإدخال)، `docs/16-progress/MASTER_PROGRESS.md` (تحديث Open Blockers لـ Phase 00).

**الملفات/الخدمات المتأثرة (4):** حزمة `@wasla/contracts-identity` (devDependency + lockfile)؛ job `build-test` في CI (Phase 00).

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيء — لم تُغيَّر العقود. تغيير اعتماديات تطوير فقط.

**كيف تم الاختبار (6):** إعادة إنتاج بيئة CI بدقّة: `rm -rf node_modules packages/*/node_modules` → `pnpm install --frozen-lockfile` (مُطابق لأمر CI تماماً) → `pnpm -r typecheck` ✅ (حزمتان)، `pnpm -r test` ✅ (16 اختباراً: 3 + 13)، `bash scripts/checks/scan-secrets.sh` ✅ نظيف. تأكد أن `@types/node` أصبح في نطاق الحزمة: `packages/contracts/identity/node_modules/@types/node` موجود. قبل الإصلاح، التثبيت المُجمّد النظيف كان يُنتج نفس الفشل (لا `@types/node` في نطاق الحزمة).

**ما المشاكل التي ظهرت (7):** (1) التضليل الأولي: typecheck كان يجتاز محلياً رغم أن `@types/node` غير مُعلَن — بسبب `@types/node` عام خارج المستودع. كُشف عبر `tsc --traceResolution` الذي أظهر أن `node:fs` يُحلّ من `/home/user/node_modules/@types/node/fs.d.ts` (خارج المستودع). (2) إعادة إنتاج الفشل محلياً تطلّب مسح `node_modules` والتثبيت المُجمّد النظيف (مُطابق CI) — قبل ذلك بدا أن كل شيء سليم.

**ما الذي لم يكتمل (8):** اجتياز pipeline فعلياً على GitLab لـ MR !9 (بعد دمجه) — يتطلب تشغيل shared runners (الآن مُفعّلة بعد تحقق المالك من namespace). عند اجتيازه: Phase 00 = Completed (W0).

**الخطوة التالية (9):** دمج MR !9 → اجتياز pipeline على `main` (job `build-test`) → اعتماد Phase 00 = Completed (W0) → بدء تنفيذ خدمة Identity وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) (إضافة الاعتماديات عبر MR مستقل + تنفيذ ضد العقود/الأنواع + Contract tests).

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد على اجتياز CI على MR !9 (shared runners الآن مُفعّلة). لا يعتمد على شيء آخر — الإصلاح مكتمل ومُتحقَّق محلياً.

**Migration/Deployment/Config (11):** لا — تغيير اعتماديات تطوير فقط (devDependency + lockfile). لا migration ولا deployment.

**مخاطر/قرارات تحتاج مراجعة (12):** إضافة `@types/node` كاعتماد تطوير — مبرّر ومُوثّق (الاختبار يستعمل واجهات Node.js). لا مخاطر أمنية. راجع [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md) — هذا التغيير يمسّ `packages/` لذا رافقه تحديث `docs/` (هذا الإدخال).

**الروابط (13):** MR [!9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9) · job `build-test` في `.gitlab-ci.yml` · حزمة `@wasla/contracts-identity` · [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) (أساس البناء) · [MASTER_PROGRESS](MASTER_PROGRESS.md) Phase 00

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (دمج MR !9 + التحقق من اجتياز CI) · Team 10 — DevOps (مراقبة job build-test) · Team 01 — Identity (التنفيذ بعد W0 وفق ADR-005)

---

## 2026-08-20 · اختيار مكدّس تنفيذ خدمة Identity (ADR-005)

**Task:** توثيق قرار اختيار المكدّس التقني لتنفيذ خدمة Identity — الخطوة الموثّقة التالية نحو Phase 01 Exit Gate. **Status:** Completed (قرار توثيقي مكتوب ومحقّق محلياً؛ [MR !8](https://gitlab.com/uxxxu/wasla/-/merge_requests/8) مفتوح للمراجعة/الدمج) · **MR:** [!8](https://gitlab.com/uxxxu/wasla/-/merge_requests/8) · **ADR:** [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)

**ماذا تم إنجازه (1):** إنشاء [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) الذي يُحدّد مكدّس تنفيذ خدمة Identity: Node.js 20 (LTS) + TypeScript 5 (strict) + Fastify (HTTP runtime + ajv للتحقق من مخططات OpenAPI) + PostgreSQL 15+ (وفق عقد البيانات) + Drizzle ORM (schema-first، ترحيلات عكوسة) + Drizzle Kit + Vitest + Testcontainers + pino. لا يُضيف اعتماديات أو كوداً تنفيذياً في هذا الـ MR — قرار توثيقي فقط.

**لماذا تم اختياره (2):** الخطوة الموثّقة التالية في [MASTER_PROGRESS](MASTER_PROGRESS.md) و[HANDOFF_NEXT_STEPS](HANDOFF_NEXT_STEPS.md) صراحةً هي «اختيار المكدّ التقني (ADR منفصل)» قبل التنفيذ. تسجيل الاختيار مسبقاً يزيل القرار المعلّق (Open Blocker 1 لـ Phase 01) ويجعل التنفيذ جاهزاً للبدء فور رفع عائق CI. المكدّس متوافق مع أساس البناء المعتمد في [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) (Node 20 + TS + Vitest)، ويحترم مبدأ «مصدر الحقيقة الواحد» في [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md) (العقود كمصدر، الأنواع المُولّدة كجسر). يتوافق مع نهج MRs السابقة (التحقق محلياً دون shared runners).

**أين تم التغيير (3):** `docs/15-decisions/ADR-005-identity-service-implementation-stack.md` (جديد)، `docs/16-progress/MASTER_PROGRESS.md` (Phase 01: Open Blocker 1 → محلول عبر ADR-005؛ Next Step محدّث)، `docs/16-progress/TASK_LOG.md` (هذا الإدخال)، `docs/16-progress/HANDOFF_NEXT_STEPS.md` (ملاحظة اختيار المكدّ + بقاء التنفيذ معلّقاً).

**الملفات/الخدمات المتأثرة (4):** خدمة Identity (Phase 01) — قرار معماري يمسّ اختيار مكدّها التنفيذي. لا تغيير برمجي (لا packages/ ولا services/ ولا apps/).

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيء — لم تُغيَّر العقود (OpenAPI / JSON Schema / DDL / errors.md). هذا قرار اختيار مكدّ تنفيذ فقط.

**كيف تم الاختبار (6):** (أ) التحقق من سلسلة البناء محلياً لإثبات أن المكدّس الحالي يعمل: `pnpm install` ✅، `pnpm -r typecheck` ✅ (حزمتان)، `pnpm -r test` ✅ (16 اختباراً: 3 في @wasla/errors + 13 في @wasla/contracts-identity)، `bash scripts/checks/scan-secrets.sh` ✅ نظيف. (ب) التحقق من اتساق ADR-005 مع ADR-001..004 (مراجع متبادلة صحيحة). (ج) التحقق من أن MR وثائق فقط → يجتاز قاعدة `doc-coverage` (التغييرات كلها في `docs/` وهي معفاة).

**ما المشاكل التي ظهرت (7):** لا مشاكل. قرار توثيقي بحت.

**ما الذي لم يكتمل (8):** تنفيذ خدمة Identity الفعلي (resolve/getUser/addLink/recovery/history + outbox + توليد Wasla Public ID + سجل تغيير Username) — **معلّق على اجتياز Phase 00 Exit Gate (CI passes)**، وهو محجوب خارجياً بـ shared runners. اختيار المكدّ هنا لا يُجتاز Exit Gate ولا يبدأ التنفيذ.

**الخطوة التالية (9):** (خارجي — إجراء مالك الحساب) حلّ عائق CI (verify namespace أو runner خاص دائم) وفق [Runbook فكّ عائق CI](../14-runbooks/CI_RUNNER_UNBLOCK.md) → اجتياز CI على `main` → اعتماد Phase 00 = Completed (W0) → بدء تنفيذ خدمة Identity وفق ADR-005 (إضافة الاعتماديات عبر MR مستقل + تنفيذ ضد العقود/الأنواع + Contract tests). بديل: إن رغب المالك بالبدء قبل رفع عائق CI، يتطلب ذلك تفويضاً صريحاً بتنفيذ قبل البوابة عبر ADR منفصل (على غرار نمط ADR-002/004).

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد التنفيذ على اجتياز Phase 00 Exit Gate (CI passes) — أو على تفويض صريح بتنفيذ قبل البوابة. يعتمد كذلك على العقود المُنتَجة ([MR !2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2)) والأنواع المُولّدة ([MR !6](https://gitlab.com/uxxxu/wasla/-/merge_requests/6)/[!7](https://gitlab.com/uxxxu/wasla/-/merge_requests/7)) واختيار المكدّ (هذا ADR-005).

**Migration/Deployment/Config (11):** لا — قرار توثيقي فقط. عند بدء التنفيذ لاحقاً: إعداد Testcontainers/Postgres محلي + `corepack enable` (مُوثّق في CONTRIBUTING) + ترحيل DDL عبر Drizzle Kit.

**مخاطر/قرارات تحتاج مراجعة (12):** اختيار مكدّ قد يتغيّر لاحقاً — مُخفّف بالاتساق مع ADR-003 وأي تبديل موثّق بـ ADR. خطر الانحراف بين Drizzle schema وعقد DDL — مُدار عبر اشتقاق schema من العقد + اختبار حماية انحراف. كل اعتمادية تُضاف لاحقاً عبر MR مستقل مع تبرير مرجعي لهذا الـ ADR. راجع [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md).

**الروابط (13):** MR [!8](https://gitlab.com/uxxxu/wasla/-/merge_requests/8) · [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) · [ADR-001](../15-decisions/ADR-001-identity-decoupled-from-telegram.md) · [ADR-002](../15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md) · [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) · [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md) · [MASTER_PROGRESS](MASTER_PROGRESS.md) · [HANDOFF_NEXT_STEPS](HANDOFF_NEXT_STEPS.md)

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (حلّ عائق CI / أو تفويض تنفيذ قبل البوابة) · Team 01 — Identity & Auth (التنفيذ بعد W0 وفق ADR-005) · Team 10 — DevOps (إعداد Testcontainers/Postgres عند بدء التنفيذ)

---

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

---

## 2026-08-20 · توليد أنواع TypeScript من عقود Identity (ADR-004)

**Task:** توليد أنواع TypeScript من عقد OpenAPI لخدمة Identity في حزمة `@wasla/contracts-identity`. **Status:** Completed · **MR:** [!6](https://gitlab.com/uxxxu/wasla/-/merge_requests/6) · **ADR:** [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)

**ماذا تم إنجازه (1):** أنشأت حزمة `packages/contracts/identity` كهيكل pnpm workspace، ثبّتت `openapi-typescript@7.13.0`، ولدّت `src/api-types.ts` من `services/identity/contracts/api.openapi.yml`. أضفت `src/index.ts` (إعادة تصدير الأنواع الرئيسية: ResolveIdentityRequest/Response, IdentityUser, IdentityLink, paths, components) + 6 اختبارات دخان (typecheck + runtime).

**لماذا تم اختياره (2):** توجيه مالك المشروع المتكرر بمتابعة العمل؛ العمل غير محجوب بـ shared runners (توليد محلي). توسيع نطاق العمل المسموح قبل البوابة موثّق في ADR-004 (يشترط المستشار: «بعد CI ناجح أو بعد ADR جديد يوسّع العمل المسموح قبل البوابة»). ليست تنفيذاً للخدمة (أداة Contract First فقط).

**أين تم التغيير (3):** `packages/contracts/identity/` (package.json, tsconfig.json, src/index.ts, src/api-types.ts [مولّد], src/__tests__/contracts.test.ts)؛ `packages/contracts/identity/README.md`؛ `pnpm-workspace.yaml` (إضافة `packages/contracts/*`)؛ `package.json` (root، openapi-typescript devDep)؛ `pnpm-lock.yaml`؛ `docs/15-decisions/ADR-004-*.md`؛ `docs/16-progress/{MASTER_PROGRESS,HANDOFF_NEXT_STEPS,TASK_LOG}.md`.

**الملفات/الخدمات المتأثرة (4):** حزمة @wasla/contracts-identity فقط (نوع + اختبار، لا منطق تشغيلي).

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيء — العقد (OpenAPI) لم يُغيَّر؛ الأنواع مولّدة منه فقط.

**كيف تم الاختبار (6):** typecheck (2 حزم) ✅ + test (9 اختبارات: 6+3) ✅ + scan-secrets ✅ + CI lint صالح (server-side) ✅.

**ما المشاكل التي ظهرت (7):** (1) مسار tsconfig خاطئ (2 مستويات بدل 3) → صُحّح إلى `../../../tsconfig.json`. (2) اختبار @ts-expect-error كان حسّاساً لموضع التوجيه → استُبدل باختبار enum إيجابي. (3) حزمة متداخلة لم تطابق glob `packages/*` → أضيف `packages/contracts/*` لـ pnpm-workspace.

**ما الذي لم يكتمل (8):** أنواع أحداث events.json (JSON Schema → TS) — مؤجلة كعمل لاحق عند الحاجة (موثّقة كـ future في ADR-004). تنفيذ خدمة Identity — يتطلب اجتياز Phase 00 Exit Gate أولاً.

**الخطوة التالية (9):** (خارجي) حلّ عائق CI (verify namespace) → اجتياز CI على main → Phase 00 = Completed (W0) → اختيار مكدّ تنفيذ Identity (ADR منفصل) → تنفيذ ضد العقود/الأنواع المولّدة + Contract tests.

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد كلياً على حلّ عائق shared runners الخارجي.

**Migration/Deployment/Config (11):** أضيف `packages/contracts/*` إلى pnpm-workspace.yaml (تهيئة monorepo).

**مخاطر/قرارات تحتاج مراجعة (12):** إضافة `openapi-typescript` كاعتماد تطوير — مبرّر وموثّق في ADR-004. الأنواع مولّدة من عقد قد يتغير (العقد مقبول عبر ADR-001/002)؛ أي تغيير مستقبلي يتطلب إعادة التوليد + تحديث docs/.

**الروابط (13):** MR [!6](https://gitlab.com/uxxxu/wasla/-/merge_requests/6) · [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md) · حزمة `@wasla/contracts-identity`

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (حلّ عائق CI) · Team 01 — Identity (التنفيذ بعد W0) · المستهلكون (استخدام الأنواع المولّدة).

---

## 2026-08-20 · أنواع أحداث Identity مشتقّة من events.json (ADR-004 Addendum)

**Task:** إضافة أنواع TypeScript لأحداث Identity مشتقّة من عقد `events.json` (JSON Schema) إلى حزمة `@wasla/contracts-identity`. **Status:** Completed · **MR:** [!7](https://gitlab.com/uxxxu/wasla/-/merge_requests/7) · **ADR:** [ADR-004 Addendum](../15-decisions/ADR-004-typed-contracts-from-openapi.md)

**ماذا تم إنجازه (1):** أنشأت `src/events-types.ts` (EventEnvelope + 4 أحداث v1: IdentityCreated/LinkAdded/TelegramUsernameChanged/RecoveryStarted + union IdentityEvent + IdentityEventByType map) مشتقّة يدوياً من `events.json`. أضفت `src/__tests__/events.test.ts` (7 اختبارات) منها **اختبار حماية انحراف** يقرأ `events.json` ويتحقق أن أنواع `event_type` الحرفية + بنى الـ payload متوافقة مع الأنواع اليدوية.

**لماذا تم اختياره (2):** إكمال قصة العقود المُكتبة (API + أحداث) — آخر جزء Contract First متبقٍ غير محجوب. توجيه مالك المشروع بمتابعة العمل.

**أين تم التغيير (3):** `packages/contracts/identity/src/{events-types.ts, __tests__/events.test.ts}`؛ `src/index.ts` (إعادة تصدير أنواع الأحداث)؛ `package.json` (root، json-schema-to-typescript devDep للتحقيق)؛ `pnpm-lock.yaml`؛ `docs/15-decisions/ADR-004-*.md` (ملحق توسيع النطاق للأحداث)؛ `docs/16-progress/{MASTER_PROGRESS,HANDOFF_NEXT_STEPS,TASK_LOG}.md`؛ `packages/contracts/identity/README.md`.

**الملفات/الخدمات المتأثرة (4):** حزمة @wasla/contracts-identity فقط (أنواع + اختبارات، لا منطق تشغيلي).

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيء — عقود events.json/OpenAPI لم تُغيَّر؛ الأنواع مشتقّة منها فقط.

**كيف تم الاختبار (6):** typecheck (2 حزم) ✅ + test (16 اختبار: 13+3) ✅ + scan-secrets ✅. اختبار حماية الانحراف يقرأ events.json فعلياً ويتحقق التوافق.

**ما المشاكل التي ظهرت (7):** (1) `json-schema-to-typescript` أنتج نوعاً عاماً غير صالح (جذر `$defs` فقط) → استُبدل بالاشتقاق اليدوي مع اختبار حماية انحراف. (2) مسار قراءة events.json في الاختبار كان خاطئاً (4 مستويات بدل 5) → صُحّح. (3) تأكيد `in` على كائن فارغ كان منطقاً خاطئاً → استُبدل بفحص نوعي.

**ما الذي لم يكتمل (8):** تنفيذ خدمة Identity — يتطلب اجتياز Phase 00 Exit Gate أولاً.

**الخطوة التالية (9):** (خارجي) حلّ عائق CI (verify namespace) → اجتياز CI على main → Phase 00 = Completed (W0) → اختيار مكدّ تنفيذ Identity (ADR منفصل) → تنفيذ ضد العقود/الأنواع + Contract tests.

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد كلياً على حلّ عائق shared runners الخارجي.

**Migration/Deployment/Config (11):** لا تغيير (json-schema-to-typescript للتحقيق فقط).

**مخاطر/قرارات تحتاج مراجعة (12):** أنواع الأحداث مشتقّة يدوياً (ليست مولّدة آلياً) — مخاطرة الانحراف مُدارة باختبار حماية يقرأ المصدر الكنسي. العقد مُصدّر v1 (أي تغيير غير متوافق يتطلب v2 + ADR).

**الروابط (13):** MR [!7](https://gitlab.com/uxxxu/wasla/-/merge_requests/7) · [ADR-004 Addendum](../15-decisions/ADR-004-typed-contracts-from-openapi.md)

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (حلّ عائق CI) · Team 01 — Identity (التنفيذ بعد W0).
