# ADR-005 — اختيار مكدّس تنفيذ خدمة Identity (Implementation Stack)

> **Title:** اعتماد Node 20 + TypeScript + Fastify + PostgreSQL + Drizzle ORM لمكدّس تنفيذ خدمة Identity
>
> **Status:** Accepted
>
> **Date:** 2026-08-20
>
> **Decision Owners:** مالك المشروع · Team 01 — Identity & Auth · Team 10 — DevOps · Team 11 — Platform
>
> **Supersedes:** — (لا يُلغي أي قرار سابق)
>
> **Related:** [ADR-001](ADR-001-identity-decoupled-from-telegram.md) (هوية Wasla الأساسية) · [ADR-002](ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md) (إطار بدء العقود قبل البوابة) · [ADR-003](ADR-003-monorepo-tooling.md) (أساس البناء pnpm+TS+Vitest) · [ADR-004](ADR-004-typed-contracts-from-openapi.md) (العقود المُكتبة) · [ROADMAP.md §3](../16-progress/ROADMAP.md) (Phase 01) · [ENGINEERING_DOCUMENTATION_LAW.md §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) (إضافة Library كبيرة بلا مبرر موثّق)

---

## Context

عقود خدمة Identity (Contract First) مُنتَجة ومدمجة إلى `main` وفق [ADR-002](ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md): عقد API (OpenAPI 3.0.3)، عقد الأحداث (JSON Schema 2020-12)، عقد البيانات (PostgreSQL DDL)، وعقد الأخطاء (كتالوج أكواد ثابتة). كما أُنتجت الأنواع المُكتبة في حزمة `@wasla/contracts-identity` وفق [ADR-004](ADR-004-typed-contracts-from-openapi.md) (`api-types.ts` مولّدة من OpenAPI، `events-types.ts` مشتقّة من `events.json` مع اختبار حماية انحراف).

الخطوة الموثّقة التالية نحو Phase 01 Exit Gate («إنشاء مستخدم من Telegram وبقاء هويته مستقرة عبر تغيير Username») — كما هو موثّق في [MASTER_PROGRESS.md](../16-progress/MASTER_PROGRESS.md) و[TASK_LOG.md](../16-progress/TASK_LOG.md) و[HANDOFF_NEXT_STEPS.md](../16-progress/HANDOFF_NEXT_STEPS.md) — تبدأ بـ **اختيار المكدّس التقني للتنفيذ عبر ADR منفصل**، ثم التنفيذ ضد العقود/الأنواع، ثم اختبارات Contract، ثم اجتياز Exit Gate.

هذا الـ ADR هو ذلك القرار المنفصل: يُحدّد مكدّس التنفيذ لخدمة Identity بحيث يصير التنفيذ جاهزاً للبدء فور اجتياز Phase 00 Exit Gate (أو فور تفويض صريح بتنفيذ قبل البوابة إن اختار المالك ذلك).

> **عائق خارجي معروف:** Phase 00 Exit Gate لا يزال معلّقاً على معيار «CI passes» — محجوب خارجياً بـ shared runners غير المتاحة للـ namespace المجاني غير المُتحقَّق منه (انظر [Runbook فكّ عائق CI](../14-runbooks/CI_RUNNER_UNBLOCK.md)). **هذا الـ ADR لا يُجتاز Exit Gate ولا يُلغي العائق**؛ هو قرار توثيقي يُسجّل الاختيار مسبقاً لتسريع التنفيذ عند رفع العائق.

---

## Decision

اعتماد المكدّس التالي لتنفيذ خدمة Identity (Phase 01):

| المكوّن | الاختيار | الدور | المبرّر |
|---|---|---|---|
| **Runtime** | Node.js 20 (LTS) | بيئة تشغيل الخدمة | متوافق مع أساس البناء المعتمد في [ADR-003](ADR-003-monorepo-tooling.md)؛ العقود والأنواع بـTypeScript؛ توافق كامل مع بيئة التطوير الحالية (Node 20). |
| **اللغة** | TypeScript 5 (strict) | لغة/مُحوِّل | العقود المُكتبة (`@wasla/contracts-identity`) بـTS؛ يمنع الانحراف بين العقد والتنفيذ عبر الأنواع. |
| **HTTP Runtime** | Fastify | خادم API + توجيه + تحقق المخططات | خفيف، سريع، أصيل TS، يعتمد ajv للتحقق — يسمح بالتحقق من مخططات OpenAPI مباشرة؛ نضج إنتاجي موثّق. |
| **قاعدة البيانات** | PostgreSQL 15+ | مصدر الحقيقة (source of truth) | عقد البيانات مكتوب بـPostgreSQL DDL (`gen_random_uuid`, `JSONB`, `BIGSERIAL`, triggers) — العقد يفترض Postgres. |
| **ORM/استعلام** | Drizzle ORM | طبقة وصول بيانات مُكتبة schema-first | schema-first يتطابق مع فلسفة «العقد كمصدر»؛ TS-native خفيف بلا تجريد ثقيل؛ يتوافق مع قاعدة «لا Library كبيرة بلا مبرر» ([ENGINEERING_DOCUMENTATION_LAW.md §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md))؛ يدعم الترحيلات العكوسة (reversible migrations). |
| **الترحيلات** | Drizzle Kit | إدارة schema migrations | ترحيلات عكوسة (مطلوبة في عقد البيانات وقاعدة TASK_LOG)؛ توليد SQL من schema. |
| **التحقق من المدخلات** | ajv (عبر Fastify) باستخدام مخططات OpenAPI | التحقق من طلبات API | مصدر واحد للتحقق = عقد OpenAPI؛ يمنع تباين التحقق بين العقد والتنفيذ. |
| **الاختبارات** | Vitest + Testcontainers (Postgres) | اختبارات وحدة/تكامل/Contract | Vitest معتمد ([ADR-003](ADR-003-monorepo-tooling.md))؛ Testcontainers يوفّر Postgres حقيقية لاختبارات التكامل وExit Gate دون اعتماد على shared runners (محلي). |
| **التسجيل/المراقبة** | pino (عبر Fastify) + معرّفات `trace_id`/`request_id` | observability أساسي | يتوافق مع DoD (لكل request: `request_id`, `trace_id`, `service`, `operation`, `latency`, `status`, `error_code`)؛ التفصيل الكامل مؤجّل لـ Phase 18. |
| **الـ Outbox / النشر** | كتابة إلى جدول `identity_outbox` (متوفر في عقد البيانات) | Domain Events من البداية | الناشر (relay → Kafka) مؤجّل لمرحلة لاحقة؛ العقد يفصل الكتابة عن النشر بحيث يُدخل Kafka لاحقاً دون إعادة تصميم المجال. |

### نطاق هذا القرار (ما يُسموح به الآن)

1. **هذا الـ ADR قرار توثيقي فقط.** لا يُضيف اعتماديات إلى المستودع في هذا الـ MR، ولا يُنشئ كوداً تنفيذياً. تسجيل الاختيار هنا لا يتجاوز Phase 00 Exit Gate ولا يبدأ تنفيذ Phase 01.
2. **لا يُعتبر Phase 01 = بدء التنفيذ.** التنفيذ الفعلي للخدمة يبقى معلّقاً على اجتياز Phase 00 Exit Gate (CI passes) — ما لم يُفوّض المالك صراحةً تنفيذاً قبل البوابة عبر ADR منفصل (على غرار نمط ADR-002/004).
3. **عند بدء التنفيذ**، كل اعتمادية تُضاف (Fastify, Drizzle, pino, testcontainers, ajv) تُضاف كـ MR مستقل مع تبرير مرجعي لهذا الـ ADR، ويلتزم بقاعدة `doc-coverage` (توثيق + TASK_LOG مع كل دفعة).
4. **مصدر الحقيقة يبقى العقود** (OpenAPI / JSON Schema / DDL / errors.md). تنفيذ Drizzle schema يُشتقّ من عقد DDL، وأي انحراف يتطلب تحديث العقد + ADR + إعادة توليد الأنواع (وفق [ADR-004](ADR-004-typed-contracts-from-openapi.md)).

### ما يُؤجَّل (يتطلب ADR منفصل عند الحاجة)

- اختيار مكدّ كتابة السجلات/المقاييس المتقدّم (OpenTelemetry SDK) — يُربط بـ Phase 18 (Observability & Resilience).
- آلية نشر الـ Outbox (relay إلى Kafka) — مرحلة لاحقة.
- اعتماد إطار عمل HTTP بديل (Hono) — يُقيّم فقط إذا ظهر قيد في Fastify.
- مصادقة الخدمة (authn) بين الخدمات (mTLS/JWT) — يُربط بـ Phase 19 (Security Hardening).

---

## Rationale

- **اتساق مع أساس البناء:** المكدّس مبنيّ على Node 20 + TS + Vitest المعتمدة في [ADR-003](ADR-003-monorepo-tooling.md) — لا يُدخل تعارضاً مع أداة البناء.
- **العقود هي المصدر:** Drizzle (schema-first) وajv (OpenAPI schemas) يجعلان العقد (`services/identity/contracts/*`) المصدر الواحد، والأنواع المُولّدة (`@wasla/contracts-identity`) الجسر بين العقد والتنفيذ — يقلّل التباين ويحترم مبدأ «مصدر الحقيقة الواحد» في [ADR-004](ADR-004-typed-contracts-from-openapi.md).
- **لا اعتماد على shared runners:** الاختبارات (Vitest + Testcontainers) محلية — تتوافق مع نهج MRs السابقة (التحقق محلياً دون CI).
- **خفّة وتجنّب التضخّم:** Fastify وDrizzle خفيفان وTS-native؛ لا يُضاف إطار عمل ثقيل (مثل NestJS) دون مبرر — يحترم قاعدة «لا Library كبيرة بلا مبرر موثّق».
- **قابلية الاسترجاع:** Drizzle Kit يوفّر ترحيلات عكوسة (مطلوبة في عقد البيانات وقاعدة TASK_LOG).
- **التوثيق عبر ADR:** اختيار مكدّ تنفيذي قرار معماري يتطلّب ADR — يحفظ شفافية الخارطة لأي جهة تالية.

---

## Consequences

### إيجابية

- يزيل القرار المعلّق «اختيار المكدّ التقني» المُدرج في [MASTER_PROGRESS.md](../16-progress/MASTER_PROGRESS.md) (Phase 01، Open Blocker 1) — التنفيذ يصير جاهزاً للبدء فور رفع عائق CI.
- اتساق كامل بين العقود والأنواع والتنفيذ (TS كخيط ناظم).
- اختبارات Contract/تكامل محلية دون shared runners.

### سلبية / تكاليف

- إضافة اعتماديات جديدة (Fastify, Drizzle, pino, testcontainers, ajv, drizzle-kit) عند بدء التنفيذ — مبرّر هنا ومُدار عبر MRs مستقلة.
- Testcontainers يتطلب Docker في بيئة الاختبار المحلية (متوفر عادةً؛ يُوثّق في CONTRIBUTING عند بدء التنفيذ).
- تثبيت Postgres لتشغيل الاختبارات محلياً (عبر Testcontainers أو Docker Compose) — يُضاف دليل إعداد عند بدء التنفيذ.

### مخاطر مُدارة

- **خطر اختيار مكدّ يتغيّر لاحقاً:** يُخفّف بأن الاختيار متوافق مع أساس البناء الموجود، وأي تبديل موثّق بـ ADR.
- **خطر الانحراف بين Drizzle schema وعقد DDL:** يُدار عبر اشتقاق schema Drizzle من عقد DDL + اختبار حماية انحراف (مثل نمط `events.test.ts`).
- **خطر اعتمادية غير مبرّرة:** كل اعتمادية تُضاف عبر MR مع تبرير مرجعي لهذا الـ ADR.

---

## Alternatives

### بديل 1: Hono بدل Fastify

- **مقيّم:** Hono أخف وأسرع، يعمل على بيئات متعددة (Workers/Node).
- **مرفوض حالياً:** Fastify أكثر نضجاً إنتاجياً ونظام plugins أوسع؛ Hono يُترك كخيار يُقيّم فقط إذا ظهر قيد في Fastify.

### بديل 2: node-postgres (pg) خام بدل Drizzle ORM

- **مقيّم:** تجنّب إضافة ORM.
- **مرفوض حالياً:** Drizzle يوفّر أمان أنواع متطابقاً مع الـTS-first approach دون تجريد ثقيل؛ pg خام يُترك للاستعلامات الخام داخل Drizzle عند الحاجة.

### بديل 3: NestJS كإطار متكامل

- **مرفوض حالياً:** تضخّم نطاق مبكّر؛ إطار ثقيل بلا مبرر يحتاجه نطاق خدمة Identity الحالي. يخالف قاعدة «لا Library كبيرة بلا مبرر موثّق».

### بديل 4: تأجيل اختيار المكدّ حتى بدء التنفيذ الفعلي

- **مرفوض:** الخطوة الموثّقة التالية في [MASTER_PROGRESS.md](../16-progress/MASTER_PROGRESS.md) صراحةً هي «اختيار المكدّ التقني (ADR منفصل)» قبل التنفيذ؛ تأجيلها يُجمّد القرار المعلّق دون سبب.

---

## Compliance Notes

- **لا يُغيّر ترتيب ROADMAP** ولا يُعتبر Phase 00 = Completed (تبقى Exit Gate Pending) ولا يُجتاز Exit Gate لـ Phase 01.
- **لا يبدأ تنفيذ Phase 01.** هذا قرار توثيقي فقط؛ التنفيذ الفعلي يتطلب اجتياز Phase 00 Exit Gate (CI passes) أو تفويضاً صريحاً بتنفيذ قبل البوابة عبر ADR منفصل.
- يُحدَّث [MASTER_PROGRESS.md](../16-progress/MASTER_PROGRESS.md) (Phase 01: Open Blocker 1 «اختيار المكدّ» → مُحلّ عبر هذا الـ ADR؛ التنفيذ لا يزال معلّقاً على Phase 00 Exit Gate) و[TASK_LOG.md](../16-progress/TASK_LOG.md) و[HANDOFF_NEXT_STEPS.md](../16-progress/HANDOFF_NEXT_STEPS.md).
- عند بدء التنفيذ لاحقاً، كل اعتمادية تُضاف عبر MR مستقل مع تبرير مرجعي لهذا الـ ADR + التزاماً بقاعدة [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md).
- عند اجتياز CI فعلياً لاحقاً (أو تفويض تنفيذ قبل البوابة)، يُتابع التنفيذ وفق التدفق الطبيعي؛ لا حاجة لجعل هذا الـ ADR Superseded لأنه قرار اختيار مكدّس دائم (وليس استثناءً مؤقتاً كـ ADR-002/004).
