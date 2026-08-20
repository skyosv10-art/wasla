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

## 2026-08-20 · MR 4 — CI DB integration (خدمة postgres في CI)

**Task:** ربط اختبارات تكامل Postgres بـCI وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) — إضافة job `db-integration` بخدمة `postgres:15` (GitLab service) يُشغّل اختبارات التكامل ضد Postgres حقيقي في كل MR و على main، مع تصحيح مسار `schema.sql` في الاختبار. **Status:** Completed (مُتحقَّق محلياً ضد Postgres 18 + E2E؛ [MR !14](https://gitlab.com/uxxxu/wasla/-/merge_requests/14) مفتوح للمراجعة/الدمج) · **MR:** [!14](https://gitlab.com/uxxxu/wasla/-/merge_requests/14)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** أُضيف job `db-integration` إلى `.gitlab-ci.yml` (مرحلة build، صورة `node:20-alpine`، خدمة `postgres:15` عبر alias `postgres`، متغيرات `POSTGRES_DB=wasla_test`/`POSTGRES_USER`/`POSTGRES_PASSWORD`، و `DATABASE_URL=postgres://postgres:postgres@postgres:5432/wasla_test`) ينفّذ `pnpm --filter @wasla/identity-service test:integration`. كذلك صُحّح مسار `schema.sql` في اختبار التكامل لاستخدام `process.cwd()` بدل `__dirname` (مستقل عن نظام الوحدات).
2. **لماذا؟** MR 4 في خطّة تنفيذ Phase 01 — التحقّق من الـExit Gate ضد Postgres في CI. اختبارات التكامل (MR 2) كانت مكتوبة ومُدقّقة أنواعياً لكنها معزولة عن التشغيل الافتراضي؛ الآن تُشغّل تلقائياً في CI ضد قاعدة حقيقية، فتتحقّق من سلوك Drizzle/Postgres runtime (وليس فقط typecheck).
3. **أين؟** `.gitlab-ci.yml`، `services/identity/src/__tests__/postgres-repository.integration.test.ts`، `docs/16-progress/`.
4. **كيف تم اختباره؟** محلياً: شغّلتُ postgres 18، وأنشأتُ قاعدة `wasla_test`، ونفّذتُ `DATABASE_URL=... pnpm test:integration` → ✅ 3 اختبارات تجتاز (إنشاء/idempotent، استقرار الهوية عبر تغيير Username، رفض التعارض). E2E: أقلعتُ الخادم بـ`DATABASE_URL` → ✅ تدفّق HTTP→Postgres كامل (resolve 201→200 idempotent→200 username-change بنفس Public ID/internal_uuid، history يُظهر sami_v1→sami_v2). CI: التحقّق عبر pipeline الـMR.
5. **ما الخطوة التالية؟** MR 5 — Exit Gate E2E رسمي (سيناريو كامل: مستخدم Telegram يُنشأ، يتغيّر Username، تبقى الهوية/Public ID مستقرة) كاختبار E2E مُفصل + توثيق اجتياز Exit Gate.
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + تحديث `MASTER_PROGRESS.md` + `HANDOFF_NEXT_STEPS.md` (قائمة [4]).
7. **هل مراجَع؟** مُراجعة ذاتياً + [MR !14](https://gitlab.com/uxxxu/wasla/-/merge_requests/14) مفتوح للمراجعة.
8. **هل ADR مطلوب؟** لا — لا انحراف. استخدام خدمة postgres في CI هو النمط القياسي لـGitLab.
9. **هل يكسر backward compatibility؟** لا — إضافة job CI جديد؛ الـ build-test الافتراضي دون تغيير (لا يحتاج DB).
10. **هل migration؟** لا — الاختبار يُطبّق schema.sql (الـDDL التعاقدي) على قاعدة فارغة في كل تشغيل.
11. **هل توجد مخاطر؟** نعم: (أ) اعتماد job على خدمة postgres في CI (يتطلب runner يدعم services) — shared runners توفّرها. (ب) التحقّق التكاملي عبر HTTP مؤجّل كاختبار E2E رسمي إلى MR 5 (لكن E2E محلي اجتاز). (ج) Testcontainers مؤجّل تماماً (لا حاجة — خدمة postgres كافية وأبسط).
12. **هل security؟** لا أسرار؛ بيانات اعتماد postgres في CI مؤقتة (job-scoped، قاعدة اختبار فارغة)؛ لا بيانات إنتاج.
13. **هل performance؟** job منفصل يُشغّل بالتوازي مع build-test؛ pnpm install مكرّر (مقبول لآن CI يُخزّن cache مستقبلاً).
14. **هل monitoring؟** لا في هذا الـMR؛ نتيجة job تظهر في GitLab pipeline.

**Related:** [MR !14](https://gitlab.com/uxxxu/wasla/-/merge_requests/14)، [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)، MR 2 ([!12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12))، MR 3 ([!13](https://gitlab.com/uxxxu/wasla/-/merge_requests/13))

---

## 2026-08-20 · MR 3 — Fastify HTTP layer (طبقة HTTP)

**Task:** إضافة طبقة HTTP لخدمة Identity وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) — مصنع تطبيق Fastify (`createIdentityApp`) يربط مسارات العقد الخمسة (resolve/getUser/addLink/recovery/history) بحالات الاستخدام، تعيين الأخطاء إلى رموز HTTP وأجسام الأخطاء التعاقدية، نقطة إقلاع (composition root)، واختبارات عبر `app.inject`. **Status:** Completed (مُتحقَّق محلياً + smoke test ناجح؛ [MR !13](https://gitlab.com/uxxxu/wasla/-/merge_requests/13) مفتوح للمراجعة/الدمج) · **MR:** [!13](https://gitlab.com/uxxxu/wasla/-/merge_requests/13)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** أُضيفت طبقة HTTP لحزمة `@wasla/identity-service`: `src/http/app.ts` (مصنع `createIdentityApp(deps)` يعرّف المسارات الخمسة + `/health` + `setErrorHandler`)، `src/http/errors.ts` (`sendIdentityError` يرمي إلى جسم الخطأ التعاقدي `{code, message, trace_id}` مع الحالة الصحيحة)، `src/http/server.ts` (نقطة الإقلاع: تكوّن المحوّلات — Postgres إن وُجد `DATABASE_URL` وإلا في الذاكرة — + الاستماع على `PORT`). أُضيف تصدير `StartRecoveryRequest` من contracts (النوع موجود في OpenAPI لكن لم يُصدّر). اعتماديات: fastify، tsx (dev).
2. **لماذا؟** MR 3 في خطّة تنفيذ Phase 01 — طبقة HTTP. النواة المجردة (MR 1) وطبقة Postgres (MR 2) لا تُستهلك عبر HTTP بعد؛ هذه الطبقة تُعرّض العقد (5 مسارات) للعملاء وتحوّل أخطاء النطاق إلى استجابات HTTP متوافقة مع `errors.md`.
3. **أين؟** `services/identity/src/http/{app,errors,server}.ts`، `services/identity/src/__tests__/http/app.test.ts`، `services/identity/src/index.ts` (تصدير HTTP)، `services/identity/package.json` (dev/start scripts)، `packages/contracts/identity/src/index.ts` (`StartRecoveryRequest`)، `pnpm-lock.yaml`.
4. **كيف تم اختباره؟** `pnpm -r typecheck` ✅ (3 حزم)، `pnpm -r test` ✅ (24 اختباراً: 15 نواة + 9 HTTP)، `scan-secrets` ✅ نظيف، **smoke test** ✅ (إقلاع الخادم في وضع الذاكرة: `/health`→200، `POST /identity/resolve`→201 بجسم مطابق، `GET` لمستخدم غير موجود→404 `{code, message, trace_id}`).
5. **ما الخطوة التالية؟** MR 4 — خدمة postgres في CI + تشغيل اختبارات التكامل، ثم MR 5 (Exit Gate E2E).
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + تحديث `MASTER_PROGRESS.md` + `HANDOFF_NEXT_STEPS.md` (قائمة [3]).
7. **هل مراجَع؟** مُراجعة ذاتياً + [MR !13](https://gitlab.com/uxxxu/wasla/-/merge_requests/13) مفتوح للمراجعة.
8. **هل ADR مطلوب؟** لا — لا انحراف. استخدام Fastify موثّق في ADR-005. مسار `/health` ليس جزءاً من سطح عقد API المُصدَر (probe تشغيلي فقط) — موثّق في الكود.
9. **هل يكسر backward compatibility؟** لا — إضافة طبقة جديدة فقط؛ حالات الاستخدام والمنافذ دون تغيير.
10. **هل migration؟** لا.
11. **هل توجد مخاطر؟** نعم: (أ) التحقق من صيغة المدخلات مُفوّض إلى حالات الاستخدام (ترمي الأكواد المستقرة) بدل schema validation في Fastify — مقصود للحفاظ على أكواد الأخطاء المستقرة. (ب) JSON مشوّه / أخطاء غير مُصنّفة تُرجَع 503 `IDENTITY_INTERNAL_ERROR` (catch-all التعاقدي). (ج) التحقق التكاملي الكامل ضد Postgres عبر HTTP مؤجّل إلى MR 4.
12. **هل security؟** لا أسرار؛ `DATABASE_URL` عبر البيئة فقط؛ `trace_id` = معرّف طلب Fastify (لا بيانات حساسة).
13. **هل performance؟** مصنع تطبيق واحد لكل عملية؛ تجمّع اتصالات pg في طبقة Postgres (MR 2)؛ سجلّ pino مهيكلي (يُفعّل عند الإقلاع الفعلي).
14. **هل monitoring؟** سجلّ pino المهيكلي فعّال عند الإقلاع (`logger:true`)؛ `/health` كـliveness probe؛ metrics/tracing مؤجّلة.

**Related:** [MR !13](https://gitlab.com/uxxxu/wasla/-/merge_requests/13)، [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)، MR 1 ([!11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11))، MR 2 ([!12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12))

---

## 2026-08-20 · MR 2 — Drizzle/Postgres persistence layer (محوّلات Postgres)

**Task:** إضافة طبقة استمرارية Postgres لخدمة Identity وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) — Drizzle schema مطابق للـDDL التعاقدي (schema.sql)، مستودع Postgres، تسلسل Public ID، إعداد اتصال، واختبارات تكامل منفصلة. **Status:** Completed (مُتحقَّق محلياً؛ [MR !12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12) مفتوح للمراجعة/الدمج) · **MR:** [!12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** أُضيفت محوّلات Postgres لحزمة `@wasla/identity-service`: Drizzle schema (`schema.ts`) مطابق لـ`schema.sql` (5 جداول: identity_users/links/history/recovery_requests/outbox مع CHECK وUNIQUE وFK ON DELETE RESTRICT والفهارس)، مستودع `PostgresIdentityRepository`، `PostgresOutbox`، `PostgresPublicIdSequence` (يسلسل `wasla_public_id_seq`)، إعداد اتصال `createDb` + `ensurePublicIdSequence`، إعداد `drizzle.config.ts`، إعدادات vitest (افتراضي يستثني `*.integration.test.ts`؛ `vitest.integration.config.ts` للاختبارات التكاملية)، واختبار تكامل `postgres-repository.integration.test.ts` (مُسيّج عبر `DATABASE_URL`، يُطبّق schema.sql + التسلسل). أُضيفت اعتماديات: drizzle-orm، pg، drizzle-kit، @types/pg.
2. **لماذا؟** MR 2 في خطّة تنفيذ Phase 01 — طبقة الاستمرارية. النواة المجردة (MR 1) تعمل على الذاكرة؛ هذه الطبقة تربطها بـPostgres الحقيقي. اختيار Drizzle (بدل Prisma) موثّق في [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md): ترابط أنواع TS مع النموذج، SQL صريح، أداء عالٍ، ودعم صريح لـJSONB (حمولات الأحداث).
3. **أين؟** `services/identity/src/infrastructure/drizzle/{schema,db,repository,public-id-sequence}.ts`، `services/identity/{drizzle.config,vitest.config,vitest.integration.config}.ts`، `services/identity/src/__tests__/postgres-repository.integration.test.ts`، `services/identity/package.json` (deps + scripts)، `services/identity/src/index.ts` (تصدير المحوّلات)، `.gitignore` (تجاهل نتاج drizzle-kit)، `pnpm-lock.yaml`.
4. **كيف تم اختباره؟** `pnpm -r typecheck` ✅ (3 حزم)، `pnpm -r test` ✅ (31 اختباراً: 13+3+15؛ التكامل مستثنى من التشغيل الافتراضي)، `drizzle-kit generate` ✅ (ولّد هجرة صالحة لـ5 جداول مطابقة لـschema.sql)، `scan-secrets` ✅ نظيف. اختبار التكامل مكتوب ومُدقّق أنواعياً لكن لا يُشغّل دون Postgres (مؤجّل إلى MR 4 مع خدمة postgres في CI).
5. **ما الخطوة التالية؟** MR 3 — طبقة Fastify HTTP (مسارات resolve/getUser/addLink/recovery/history) مع تحويل الأخطاء إلى رموز HTTP وفق `errors.md`.
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + تحديث `MASTER_PROGRESS.md` (Phase 01 blockers/evidence) + تحديث `HANDOFF_NEXT_STEPS.md` (قائمة [2]).
7. **هل مراجَع؟** مُراجعة ذاتياً + [MR !12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12) مفتوح للمراجعة.
8. **هل ADR مطلوب؟** لا — لا انحراف عن القرارات القائمة. اختيار Drizzle موثّق مسبقاً في ADR-005. schema.sql يبقى مصدر DDL الحقيقي (ADR-004)؛ Drizzle schema طبقة استعلام آمنة أنواعياً مطابقة له.
9. **هل يكسر backward compatibility؟** لا — إضافة طبقة جديدة فقط؛ المنافذ (ports) والنواة المجردة وحالات الاستخدام دون تغيير. المحوّلات الجديدة تُختار عند تكوين الجذر (composition root).
10. **هل migration؟** لا migration ملتزم. DDL التعاقدي = `schema.sql` (يُطبّق مباشرة، يشمل تريغر `updated_at`). هجر drizzle-kit نتاج عند الطلب (`db:generate`)؛ تُتجاهل في git لأنها تختلف عن schema.sql في تريغر `updated_at` (المستودع يضبط `updatedAt` صراحةً في `updateUserStatus`).
11. **هل توجد مخاطر؟** نعم: (أ) اختبار التكامل لا يُشغّل في CI بعد (لا Postgres في node:20-alpine) — يُحلّ في MR 4 عبر خدمة postgres. (ب) تريغر `updated_at` من schema.sql غير مُمثّل في Drizzle schema — معالج بضبط `updatedAt` صراحةً في المستودع (defense-in-depth). (ج) `onConflictDoNothing` يعتمد على قيد UNIQUE على (provider, external_id) — موجود في schema.sql.
12. **هل security؟** لا أسرار؛ DATABASE_URL يُحقن عبر البيئة فقط؛ لا embedding لـTelegram IDs في Public ID (ADR-001).
13. **هل performance؟** تجمع اتصالات pg (افتراضي 10)؛ فهارس على (user_internal_uuid, provider) و(user_internal_uuid, field) وoccurred_at للـoutbox.
14. **هل monitoring؟** لا في هذا الـMR؛ السجلّ المهيكلي (pino) يُضاف في طبقة Fastify (MR 3).

**Related:** [MR !12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12)، [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)، [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)، MR 1 ([!11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11))

---

## 2026-08-20 · MR 1 — Identity scaffold + pure core (النطاق والمنافذ وحالات الاستخدام)

**Task:** تنفيذ النواة المجردة لخدمة Identity وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) — نماذج النطاق، المنافذ (ports)، محوّلات في الذاكرة، حالات الاستخدام، والاختبارات. **Status:** Completed (مُتحقَّق محلياً؛ [MR !11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11) مفتوح للمراجعة/الدمج) · **MR:** [!11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11)

**ماذا تم إنجازه (1):** إنشاء حزمة `@wasla/identity-service` (services/identity) بنماذج النطاق (User/IdentityLink/HistoryEntry/RecoveryRequest مطابقة لـschema.sql)، أخطاء ثابتة (errors.ts مطابق لكتالوج errors.md)، مولّد/متحقّق Wasla Public ID (`WS-[0-9]{10}`)، مصانع أحداث المجال (identity.created / link.added / telegram_username.changed / recovery.started) وفق events.json، المنافذ (Clock/IdGenerator/PublicIdSequence/IdentityRepository/Outbox)، محوّلات في الذاكرة للاختبارات، وحالات الاستخدام: `resolveTelegramIdentity` (idempotent حسب telegram_user_id + تسجيل تغيير Username في History دون إنشاء مستخدم جديد) و`getUser` و`addIdentityLink` و`startRecovery` و`getIdentityHistory`. 15 اختباراً تجتاز.

**لماذا تم اختياره (2):** وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) وخطّة المستشار (MR 1 = scaffold + pure core). البدء بالنواة المجردة (hexagonal) قبل HTTP/Postgres يسمح باختبار سلوكيات الـExit Gate (استقرار الهوية عبر تغيير Username) دون اعتماد على Docker/Postgres (Testcontainers مؤجّل — لا Docker في بيئة CI الحالية node:20-alpine). Contract-First: أنواع API/الأحداث مستوردة من `@wasla/contracts-identity`.

**أين تم التغيير (3):** `services/identity/` (package.json، tsconfig.json، src/domain/{model,errors,public-id,events}.ts، src/ports.ts، src/infrastructure/in-memory.ts، src/use-cases/*.ts، src/index.ts، src/__tests__/*.test.ts)، `packages/contracts/identity/src/index.ts` (إضافة تصديرات `RecoveryStarted`/`IdentityHistoryEntry`/`AddIdentityLinkRequest`)، `packages/contracts/identity/package.json` (exports → src/index.ts للاستهلاك دون build)، `pnpm-lock.yaml`، `docs/16-progress/{TASK_LOG,MASTER_PROGRESS,HANDOFF_NEXT_STEPS}.md`.

**الملفات/الخدمات المتأثرة (4):** حزمة جديدة `@wasla/identity-service` (النواة المجردة)؛ حزمة `@wasla/contracts-identity` (تصديرات أنواع إضافية + exports source).

**ما الـAPI/Event/Schema الذي تغير (5):** لا تغيير في العقود (OpenAPI/events.json/schema.sql/errors.md). أُضيفت تصديرات أنواع من العقد الموجودة فقط (RecoveryStarted، IdentityHistoryEntry) — لا تغيير دلالي.

**كيف تم الاختبار (6):** `pnpm -r typecheck` ✅ (3 حزم: contracts/identity، errors، services/identity)، `pnpm -r test` ✅ (31 اختباراً: 13 + 3 + 15)، `bash scripts/checks/scan-secrets.sh` ✅ نظيف. اختبارات الـExit Gate: إنشاء مستخدم من Telegram (created:true، WS-XXX صالح، حدثان identity.created + link.added)؛ idempotent (نفس telegram_user_id → created:false، لا أحداث جديدة)؛ استقرار الهوية عبر تغيير Username (نفس public_id/internal_uuid، تسجيل history بقيم old/new، حدث telegram_username.changed)؛ استقرار عبر تغييرات متعددة (سجل كامل u1→u2→u3→u4)؛ رفض resolve بلا telegram_user_id (IDENTITY_MISSING_TELEGRAM_ID)؛ تعارض رابط (IDENTITY_LINK_ALREADY_LINKED)؛ مزوّد غير صالح (IDENTITY_LINK_INVALID_PROVIDER)؛ recovery (recovery.started)؛ history مُرشّح بحقل.

**ما المشاكل التي ظهرت (7):** (1) مسارات استيراد نسبية خاطئة في حالات الاستخدام (`../../domain/` بدل `../domain/`) — صُلحت. (2) حزمة contracts كانت تُصدِّر `dist/` غير المبنيّ → tsc لا يجد الأنواع؛ صُلح بجعل exports تشير إلى `src/index.ts` (استهلاك دون build). (3) نوع `IdentityHistoryEntry.field` في OpenAPI يقيّد على telegram_username/phone/link (بدون status) بينما DDL يشمل status؛ عُولج بترشيح إدخالات status من استجابة history endpoint. (4) `res.links` اختياري في نوع العقد؛ عُولج في الاختبار.

**ما الذي لم يكتمل (8):** طبقة HTTP (Fastify) — MR 3. طبقة Postgres/Drizzle — MR 2. اختبارات تكامل مع Postgres حقيقي — MR 4. هذه النواة تستعمل in-memory repository فقط (كافٍ لمنطق الـExit Gate).

**الخطوة التالية (9):** دمج MR !11 → اجتياز CI → MR 2 (Drizzle/Postgres persistence) ثم MR 3 (Fastify HTTP) ثم MR 4 (CI DB integration) ثم MR 5 (Exit Gate E2E).

**ما الذي يعتمد عليه العمل التالي (10):** اجتياز CI على MR !11 (shared runners مُفعّلة). لا يعتمد على Docker (النواة مجردة).

**Migration/Deployment/Config (11):** لا — نواة مجردة بلا runtime/DB. لا deployment.

**مخاطر/قرارات تحتاج مراجعة (12):** (1) جعل contracts exports تشير إلى src/index.ts بدل dist — قرار تطويري (استهلاك دون build في monorepo خاص)؛ يُراجع عند الحاجة لتغليف/dist منشور. (2) استراتيجية Wasla Public ID موثّقة في public-id.ts (WS- + 10 أرقام صفرية من سلسلة تسلسلية) — مطابقة لـschema.sql (Postgres sequence)؛ التوليد الفعلي بالـsequence في MR 2. (3) Testcontainers مؤجّل (لا Docker في CI) — مُوثّق في ADR-005. (4) لا embedding لـTelegram IDs في Public ID (ADR-001).

**الروابط (13):** MR [!11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11) · [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) · العقود `services/identity/contracts/` · حزمة `@wasla/contracts-identity` · [MASTER_PROGRESS](MASTER_PROGRESS.md) Phase 01

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (دمج MR !11 + مراجعة CODEOWNERS) · Team 01 — Identity & Auth (متابعة التنفيذ MR 2/3/4/5)

---

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
