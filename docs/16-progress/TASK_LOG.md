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

## 2026-08-20 · Phase 02 MR 7 — بوابة خروج Phase 02 (E2E) وإغلاق المرحلة

**Task:** إثبات بوابة خروج Phase 02 باختبار E2E يُشغّل خدمتي Identity و Geography معاً كما في الإنتاج، ثم إغلاق المرحلة في وثائق التقدّم. **Status:** Completed (3 اختبارات E2E تنجح في CI ضد postgres:15) · **MR:** [!22](https://gitlab.com/uxxxu/wasla/-/merge_requests/22)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) `services/geography/src/__tests__/phase02-exit-gate.e2e.test.ts` (جديد، 3 اختبارات): تطبيق مخطط identity + مخطط geography + البيانات الأولية السعودية في قاعدة اختبار واحدة، تشغيل تطبيق identity على **منفذ حقيقي** (`listen({port:0})`) وتطبيق geography عبر `app.inject` موصولاً به بمحوّل الإنتاج `HttpIdentityLookupPort`. (ب) `vitest.integration.config.ts`: `fileParallelism: false`. (ج) `package.json` للجغرافيا: `@wasla/identity-service` في `devDependencies` (+ تحديث `pnpm-lock.yaml`). (د) توثيق جديد `docs/12-testing/PHASE02_EXIT_GATE_E2E.md` + إغلاق المرحلة في `MASTER_PROGRESS.md` و`ROADMAP.md` و`HANDOFF_NEXT_STEPS.md` §6.
2. **لماذا؟** كل اختبار سابق يتحقّق من خدمة واحدة معزولة: اختبارات الوحدة بمحوّلات في الذاكرة، واختبارات التكامل (MR !19) بـPostgres حقيقي لكن مع **بديل مزيّف** لمنفذ الهوية (`identityExists → true` دائماً). أي أن جوهر البوابة — «يغيّر موقعه دون إنشاء حساب جديد» — لم يُختبَر قطعاً عبر حدود الخدمتين، ولم يُختبَر محوّل `HttpIdentityLookupPort` نفسه ضد خدمة هوية حقيقية. وقانون المراحل يمنع إغلاق مرحلة ببوابة موصوفة نصّاً فقط. لذلك تستمع الهوية على منفذ حقيقي: لو استُعمل بديل في العملية نفسها، لبقي العقد بين الخدمتين غير مُثبَت.
3. **أين؟** `services/geography/` (اختبار + إعداد vitest + package.json) + `pnpm-lock.yaml` + `docs/12-testing/` + `docs/16-progress/`. لا سطر واحد من كود الإنتاج تغيّر.
4. **كيف تم اختباره؟** الاختبار نفسه هو التحقّق: (1) «تغيير الموقع دون حساب جديد» — إنشاء المستخدم في الهوية (201) → تعيين موقع (201، `version=1`) → نطاق آخر (200، `version=2`، نفس المعرّف) → `resolve` مرة أخرى (200، `created:false`، ثبات `wasla_public_id` و`internal_uuid`) → تغيير اسم المستخدم لا يمسّ الموقع → `history` بمدخلين (`old_zone` = null ثم النطاق السابق) → `outbox` يحمل `geo.user_location.set` ثم `geo.user_location.changed` بمُعرِّف aggregate = `wasla_public_id`. (2) «Geo IDs + i18n» — ar افتراضي، `Saudi Arabia` بالإنجليزية، `مدینہ علاقہ` بالأردية، الرجوع إلى ar لحي بلا ترجمة (`حي الحرة`)، ومسار النطاق الكامل بمعرّفات UUID. (3) 404 `GEO_IDENTITY_NOT_FOUND` لهوية غير موجودة (خدمة الهوية الحقيقية أجابت 404 عبر HTTP) و404 `GEO_USER_LOCATION_NOT_FOUND` لموقع غير مسجَّل. محلياً: `typecheck` لخمس حزم ✅ و96 اختبار وحدة ✅ (الـE2E مستثنى من `pnpm -r test`)؛ لا Postgres في بيئة العمل الحالية، فتنفيذ الـE2E يتم في وظيفة `geography-db-integration` في CI.
5. **ما الخطوة التالية؟** **Phase 03 — Telegram Channel Foundation** (Exit Gate: كل Bot يفتح Mini App وAdapter قابل للاستبدال بـMock)، وتبدأ بـADR لمكدّس القناة + عقودها قبل أي كود، كما بدأت 01 و02.
6. **هل مستند؟** نعم — `docs/12-testing/PHASE02_EXIT_GATE_E2E.md` (نص البوابة، مخطط الوصل، جدول القرارات، ما يتحقّق منه، التشغيل المحلي، القيود) + هذا الإدخال + `MASTER_PROGRESS.md` (Phase 02 = Completed) + `ROADMAP.md` (ملاحظة الحالة) + `HANDOFF_NEXT_STEPS.md` §6.
7. **هل مراجَع؟** مُراجَع ذاتياً مقابل نمط بوابة Phase 01 (`services/identity/src/__tests__/exit-gate.e2e.test.ts`) ومقابل البيانات الأولية الفعلية (صُحّحت توقعات الأسماء: `مدینہ علاقہ` و`حي الحرة`، وشكل `path.*` للنطاق). يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا — ADR-006 يحكم النموذج والترجمة وغياب الـFK؛ هذا إثبات تنفيذي له. لكن قرار «مخططا الخدمتين في قاعدة اختبار واحدة» موثَّق صراحةً في وثيقة الاختبار مع سببه (لا FK بين المخططين، والبوابة سلوكية لا طوبولوجية).
9. **هل يكسر backward compatibility؟** لا — إضافة اختبار وتوثيق فقط؛ لا تغيير في عقد أو كود أو مخطط.
10. **هل migration؟** لا. يُطبَّق `contracts/schema.sql` للخدمتين داخل الاختبار على قاعدة مؤقّتة تُهدم بانتهاء الوظيفة.
11. **هل توجد مخاطر؟** (أ) تسابق على الجداول: ملفّان يملكان مخطط **نفس** القاعدة → عُولج بـ`fileParallelism: false` (إلزامي لا تفضيل، وموثَّق في تعليق الإعداد). (ب) اعتماد الجغرافيا على حزمة الهوية قد يُقرأ خطأً كارتباط معماري → مقصور على `devDependencies` ومُوثَّق أن الإنتاج يبقى عبر HTTP. (ج) الاختبار يعتمد على أسماء البيانات الأولية → تغييرها يُفشله بوضوح (فشل مقصود ومفيد). (د) لا Postgres محلياً → التحقّق يعتمد على CI.
12. **هل security؟** لا أسرار ولا صلاحيات جديدة. المنفذ العشوائي محدود بـ`127.0.0.1` داخل الوظيفة، وبيانات Postgres مؤقّتة خاصة بالوظيفة.
13. **هل performance؟** الاختبار يستغرق ثوانٍ، ويضيف تشغيلاً متسلسلاً لملفَّي التكامل بدل التوازي — أثر مقبول وضروري للصحة.
14. **هل monitoring؟** إشارة CI (حالة وظيفة `geography-db-integration`) هي جرس الإنذار لأي انحدار يكسر بوابة المرحلة.

**Related:** [MR !22](https://gitlab.com/uxxxu/wasla/-/merge_requests/22)، [توثيق بوابة الخروج E2E](../12-testing/PHASE02_EXIT_GATE_E2E.md)، [تكامل قاعدة البيانات في CI](../12-testing/DB_INTEGRATION_CI.md)، [بوابة Phase 01](https://gitlab.com/uxxxu/wasla/-/merge_requests/15)، [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)، [ROADMAP](ROADMAP.md)

---

## 2026-08-20 · Phase 02 MR 6 — تكامل قاعدة البيانات في CI لخدمة geography

**Task:** تشغيل اختبارات تكامل Postgres لخدمة Geography داخل GitLab CI (خدمة `postgres:15`) بعد أن كانت موجودة منذ MR !19 لكن غير مُشغَّلة آلياً. **Status:** Completed (مُتحقَّق: `POST /ci/lint` صالح بدون أخطاء أو تحذيرات، وخط أنابيب الـMR ينفّذ الوظيفة فعلياً) · **MR:** [!21](https://gitlab.com/uxxxu/wasla/-/merge_requests/21)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) `.gitlab-ci.yml` — استُخرجت قاعدة مشتركة مخفية `.db-integration-base` (صورة `node:20-alpine` + corepack/pnpm 9 + قواعد التشغيل على أحداث MR وعلى `main`)، وأُعيد تعريف `db-integration` (identity) عبر `extends` دون تغيير سلوكها، وأُضيفت وظيفة جديدة `geography-db-integration` تشغّل `pnpm --filter @wasla/geography-service test:integration` مقابل خدمة `postgres:15` بقاعدة مستقلّة `wasla_geo_test`. (ب) حُذفت تعليقات قديمة صارت غير صحيحة («jobs الـ build لا تنفّذ حالياً لأن shared runners غير متاحة») لأن الـrunners مُفعّلة منذ 2026-08-20 وكل الوظائف تعمل. (ج) `docs/12-testing/DB_INTEGRATION_CI.md` (جديد) — استراتيجية طبقتي الاختبار، جدول الوظائف، التشغيل المحلي، خطوات إضافة خدمة جديدة، والحدود الحالية.
2. **لماذا؟** الاختبارات الأربعة للتكامل كُتبت في MR !19 لكنها كانت تُتخطّى في CI (`describe.skipIf(!DATABASE_URL)`) لأن الوظيفة الوحيدة القائمة تشغّل identity فقط — أي أن طبقة Postgres لـgeography لم تكن محميّة من الانحدار إلا بالتشغيل اليدوي. وبوابة خروج Phase 02 (MR 7) تحتاج أساساً موثوقاً يعمل ضد قاعدة حقيقية في كل MR. اختيار **قاعدة بيانات مستقلّة لكل خدمة** (لا توسيع وظيفة identity) يجعل الفشل مُنسَباً لخدمة واحدة، ويمنع أي تداخل جداول أو ترتيب ضمني بين الخدمتين، ويحترم ملكية كل خدمة لجداولها (ADR-006: لا FK من geography إلى identity).
3. **أين؟** `.gitlab-ci.yml` + `docs/12-testing/` + `docs/16-progress/`.
4. **كيف تم اختباره؟** ✅ تحقّق خادمي عبر `POST /api/v4/projects/:id/ci/lint`: `valid: true`، `errors: []`، `warnings: []`، والوظائف المُحلَّلة هي repo-structure / markdown-lint / doc-coverage / build-test / db-integration / geography-db-integration. ✅ تحقّق YAML محلي (تحليل الملف وتأكيد المفاتيح). ✅ التحقّق النهائي هو خط أنابيب هذا الـMR نفسه: الوظيفتان `db-integration` و`geography-db-integration` تعملان ضد `postgres:15` (لا يمكن تشغيل Postgres في بيئة العمل المحلية الحالية، فالتحقّق الفعلي في CI هو المصدر — والاختبارات نفسها سبق أن نجحت ضد Postgres حقيقي في MR !19).
5. **ما الخطوة التالية؟** Phase 02 MR 7 — اختبار Exit Gate E2E: تطبيق مخططي identity و geography + البيانات الأولية، إنشاء مستخدم عبر Identity، تعيين موقعه ثم تغييره، والتحقّق من ثبات `wasla_public_id`/`internal_uuid` + `history` + `outbox` + الاستجابات المترجمة (ar/en/ur)، ثم إغلاق Phase 02.
6. **هل مستند؟** نعم — هذا الإدخال + `docs/12-testing/DB_INTEGRATION_CI.md` (جديد) + `MASTER_PROGRESS.md` (صف Phase 02) + `HANDOFF_NEXT_STEPS.md` §6 (MR [6] ✅ Done، MR [7] = التالي).
7. **هل مراجَع؟** مُراجعة ذاتياً مقابل الوظيفة القائمة لـidentity (تكافؤ السلوك بعد `extends`) + تحقّق خادمي من الـlint. يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا — ADR-005/ADR-006 يوثّقان تأجيل Testcontainers والاعتماد على خدمة postgres في CI؛ هذا تنفيذ لذلك القرار.
9. **هل يكسر backward compatibility؟** لا — لا تغيير في الكود أو العقود. `db-integration` تحفظ سلوكها بالكامل (نفس الصورة والخدمة والقاعدة والأمر)، والجديد وظيفة إضافية.
10. **هل migration؟** لا — لا تغيير في `contracts/schema.sql` أو البيانات الأولية. تغيير CI فقط. القاعدة الجديدة `wasla_geo_test` تُنشأ داخل خدمة الوظيفة وتُهدم بانتهائها.
11. **هل توجد مخاطر؟** (أ) وظيفة إضافية تعني تثبيت اعتماديات مرة أخرى وزمن خط أنابيب أطول — مقبول مقابل عزل الفشل، ويُحسَّن لاحقاً بذاكرة تخزين مؤقت لـpnpm إن لزم. (ب) `extends` يعيد هيكلة وظيفة identity الناجحة — مُخفَّف بتحقّق الـlint وبتشغيل الوظيفتين في خط أنابيب هذا الـMR قبل الدمج. (ج) لا تزال اختبارات التكامل تُتخطّى صامتة عند غياب `DATABASE_URL` محلياً — مقبول ومقصود، والمتغيّر مضبوط دائماً في CI.
12. **هل security؟** لا أسرار: بيانات اعتماد Postgres خاصة بخدمة مؤقتة داخل الوظيفة (`postgres/postgres` على شبكة الوظيفة فقط) ولا تُستخدم في أي بيئة حقيقية؛ لا متغيّرات CI محميّة أُضيفت.
13. **هل performance؟** زمن خط الأنابيب يزيد بمقدار وظيفة واحدة، وتعمل بالتوازي مع `build-test` و`db-integration` في نفس المرحلة.
14. **هل monitoring؟** لا مراقبة تشغيلية؛ إشارة CI (حالة الوظيفة) هي آلية الكشف عن انحدار طبقة Postgres لـgeography.

**Related:** [MR !21](https://gitlab.com/uxxxu/wasla/-/merge_requests/21)، [توثيق تكامل قاعدة البيانات في CI](../12-testing/DB_INTEGRATION_CI.md)، [MR !19 (طبقة Postgres)](https://gitlab.com/uxxxu/wasla/-/merge_requests/19)، [MR !20 (طبقة HTTP)](https://gitlab.com/uxxxu/wasla/-/merge_requests/20)، [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)

---

## 2026-08-20 · Phase 02 MR 5 — Fastify HTTP layer + error mapping + app.inject tests (geography)

**Task:** إضافة طبقة HTTP لخدمة Geography & Localization (Fastify) تربط المسارات التسعة في العقد بحالات الاستخدام، مع تعيين أخطاء النطاق إلى استجابات تعاقدية، ومحوّل HTTP للتحقق من الهوية، واختبارات `app.inject`. **Status:** Completed (مُتحقَّق محلياً: تثبيت مُجمّد نظيف + typecheck 5 حزم + 96 اختبار وحدة منها 41 geography + تجربة تشغيل فعلية للخدمة) · **MR:** [!20](https://gitlab.com/uxxxu/wasla/-/merge_requests/20)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** `services/geography/`: (أ) `src/http/app.ts` — `createGeographyApp({deps, logger})` يبني تطبيق Fastify دون `listen` (قابل للاختبار بـ`app.inject`): `/health` + المسارات التسعة في `contracts/api.openapi.yml` (قائمة البلدان، أبناء كل مستوى، تفصيل المنطقة، GET/PUT موقع المستخدم، سجل المواقع)؛ `parseLocale` (الافتراضي `ar`، وإلا `GEO_UNSUPPORTED_LOCALE`)؛ `parseSetLocationBody` (وإلا `GEO_INVALID_REQUEST_BODY`)؛ PUT يُرجع **201** لأول تعيين و**200** للتغيير أو لإعادة التعيين المتماثلة؛ `trace_id` مأخوذ من `request.id` ويُمرّر إلى أحداث الـoutbox. (ب) `src/http/errors.ts` — `sendGeographyError` يعيّن `GeographyError` إلى `{code, message, trace_id}` + `httpStatus` من كتالوج الأخطاء، وأي خطأ غير مُصنّف إلى `GEO_INTERNAL_ERROR` (503) دون تسريب تفاصيل داخلية. (ج) `src/domain/errors.ts` — كود جديد `GEO_INVALID_REQUEST_BODY` (`validation_error`, 400) — **إضافة فقط**، لم تُغيَّر دلالة أي كود قائم. (د) `src/infrastructure/http-identity-lookup.ts` — `HttpIdentityLookupPort`: `GET {baseUrl}/identity/users/{waslaPublicId}` (200 = موجودة، 404 = غير موجودة، غير ذلك = `GEO_INTERNAL_ERROR`) مع مهلة 2000ms عبر AbortController. (هـ) `src/http/server.ts` — composition root: محوّلات Postgres إن وُجد `DATABASE_URL` وإلا in-memory، و`HttpIdentityLookupPort` إن وُجد `IDENTITY_SERVICE_URL` وإلا محوّل تطوير متسامح، و`PORT` افتراضي **8081** (Identity على 8080)، وسجلّ pino مُفعّل. (و) `package.json` — `fastify` كتبعية، `tsx` كتبعية تطوير، سكربتا `dev`/`start` (مطابقة لـIdentity). (ز) `src/index.ts` — تصدير `createGeographyApp`/`sendGeographyError`/`HttpIdentityLookupPort`. (ح) `src/__tests__/http/app.test.ts` — 16 اختبار `app.inject`. (ط) `contracts/errors.md` — توثيق الكود الجديد + حالة الحدّ الجديدة. (ي) `docs/04-api/GEOGRAPHY_HTTP.md` — توثيق طبقة HTTP الكامل.
2. **لماذا؟** النواة المجردة (MR 3) وطبقة Postgres (MR 4) لا تُعرّضان أي سطح استدعاء؛ بدون طبقة HTTP لا يمكن للبوتات/الوحدات الأخرى استعمال Geo IDs، ولا يمكن تنفيذ اختبار Exit Gate الشامل (MR 7). المكدّس مطابق لـIdentity وفق ADR-005/ADR-006 (Node 20 + Fastify + pino) لتفادي تنوّع غير مبرّر.
3. **أين؟** `services/geography/` + `docs/04-api/` + `docs/16-progress/`.
4. **كيف تم اختباره؟** ✅ تثبيت مُجمّد نظيف مطابق لـCI (`rm -rf node_modules && pnpm install --frozen-lockfile`) — تفادياً لتكرار سبب فشل CI في MR !9. ✅ `pnpm -r run typecheck` (5 حزم). ✅ `pnpm -r run test` = 96 اختباراً (geography 41 منها 16 جديدة، identity 24، contracts-identity 13، contracts-geography 15، errors 3). الاختبارات الجديدة تغطّي: الصحة؛ locale الافتراضي ar + en + ur؛ رفض locale غير مدعوم؛ اجتياز الهرم كاملاً؛ كل أكواد `*_NOT_FOUND`؛ تفصيل المنطقة؛ **201 لأول تعيين ثم 200 للتغيير** (مسار Exit Gate)؛ idempotency لنفس المنطقة؛ ترتيب السجل؛ Public ID غير صالح؛ جسم طلب غير صالح؛ منطقة مجهولة؛ هوية مجهولة؛ أنواع أحداث الـoutbox + وجود `trace_id`. ✅ تجربة تشغيل فعلية للخدمة (`PORT=8099 ... start`): `/health` → `{"status":"ok"}`؛ `/geo/countries?locale=en` → Saudi Arabia؛ `PUT /geo/users/WS-0000000009/location` → **201**؛ `history?locale=ur`. ✅ لا أسرار في الكود (كل الإعداد عبر env).
5. **ما الخطوة التالية؟** Phase 02 MR 6 — توسيع CI بوظيفة تكامل قاعدة بيانات لـgeography (خدمة `postgres:15` + `pnpm --filter @wasla/geography-service test:integration`)، ثم MR 7 — اختبار Exit Gate E2E لـPhase 02 وإغلاق المرحلة.
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + `docs/04-api/GEOGRAPHY_HTTP.md` (جديد) + تحديث `MASTER_PROGRESS.md` (صف Phase 02) + `HANDOFF_NEXT_STEPS.md` §6 (MR [5] ✅ Done، MR [6] = التالي) + `contracts/errors.md`.
7. **هل مراجَع؟** مُراجعة ذاتياً مقابل العقد (`api.openapi.yml`) مسارًا بمسار ومقابل `errors.md` كودًا بكود؛ ومقابل طبقة HTTP لـIdentity (MR !13) للاتساق في الشكل. يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا — ADR-006 (مكدّس + نموذج Geography) و ADR-005 (Fastify/Node 20) يغطّيان القرار؛ هذا تنفيذ ضد العقود.
9. **هل يكسر backward compatibility؟** لا — إضافة سطح HTTP جديد فقط. كتالوج الأخطاء تغيّر بالإضافة فقط (`GEO_INVALID_REQUEST_BODY`)، والأكواد القائمة ثابتة الدلالة، والأحداث بقيت v1 دون تغيير.
10. **هل migration؟** لا — لا تغيير في `contracts/schema.sql` ولا في البيانات الأولية. تغيير تشغيلي: `PORT` (افتراضي 8081) و`IDENTITY_SERVICE_URL` (اختياري) — موثّقان في `docs/04-api/GEOGRAPHY_HTTP.md`. `pnpm-lock.yaml` مُحدَّث (إلزامي لأن CI يستعمل `--frozen-lockfile`).
11. **هل توجد مخاطر؟** نعم: (أ) بدون `IDENTITY_SERVICE_URL` يعمل محوّل هوية متسامح — مقبول للتطوير فقط ويجب ضبط المتغيّر في الإنتاج (موثّق). (ب) التحقق من الجسم يدوي وليس عبر مخططات ajv المولّدة من OpenAPI — مقبول لهذا الحجم، ويُعاد النظر إذا تعدّدت الأجسام. (ج) اختبارات الـHTTP تعمل على in-memory؛ التحقق ضد Postgres حقيقي في CI يأتي في MR 6.
12. **هل security؟** لا أسرار في الكود؛ كل الإعداد عبر متغيّرات البيئة؛ الأخطاء الداخلية لا تُسرّب رسائل أو آثار مكدّس (تُختزل إلى `GEO_INTERNAL_ERROR`)؛ `wasla_public_id` يُتحقَّق نمطه قبل أي استعلام؛ لا FK ولا وصول لجداول الهوية (فقط استدعاء HTTP مقروء).
13. **هل performance؟** مهلة 2000ms على استدعاء خدمة الهوية تمنع تعليق الطلبات؛ لا استعلامات إضافية أُدخلت في هذه الطبقة (الاستعلامات كما في MR 4 مع التحميل الدفعي).
14. **هل monitoring؟** نعم — سجلّ Fastify/pino مُفعّل في التركيب النهائي (مُطفأ في الاختبارات لتقليل الضجيج)، و`trace_id` (معرّف الطلب) يظهر في كل استجابة خطأ وفي أحداث الـoutbox، مما يربط الطلب بالحدث.

**Related:** [MR !20](https://gitlab.com/uxxxu/wasla/-/merge_requests/20)، [توثيق طبقة HTTP](../04-api/GEOGRAPHY_HTTP.md)، [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)، [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)، [عقود geography](../../services/geography/contracts/README.md)، [MR !19 (Postgres)](https://gitlab.com/uxxxu/wasla/-/merge_requests/19)

---

## 2026-08-20 · Phase 02 MR 4 — Drizzle/Postgres persistence + Saudi seed (geography)

**Task:** تنفيذ طبقة Postgres لخدمة Geography & Localization عبر Drizzle (schema + db + repository) + بيانات أولية idempotent للمملكة العربية السعودية، مع اختبار تكامل حقيقي ضد Postgres. **Status:** Completed (مُتحقَّق محلياً: typecheck 5 حزم؛ 25 اختبار وحدة + 4 اختبارات تكامل Postgres؛ scan-secrets نظيف) · **MR:** [!19](https://gitlab.com/uxxxu/wasla/-/merge_requests/19)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** `services/geography/`: (أ) `package.json` — أُضيفت `drizzle-orm`/`pg`/`drizzle-kit` كتبعيات (مثل Identity) + سكربتات `db:generate`/`db:push`/`db:studio`/`test:integration`. (ب) `drizzle.config.ts`. (ج) `src/infrastructure/drizzle/schema.ts` — 13 جدول Drizzle تطابق `contracts/schema.sql` (geo_countries/regions/cities/districts/zones + 5 جداول names + geo_user_locations + geo_user_location_history + geo_outbox) مع قيود CHECK على wasla_public_id و status. (د) `db.ts` — `createDb` (pg.Pool + drizzle)؛ Geography لا يولّد Wasla Public IDs (مرجع opaque) فلا تسلسل public-id هنا (خلافاً Identity). (هـ) `repository.ts` — `PostgresGeographyRepository` (ينفّذ كل منافذ الـports: list/find لكل مستوى + getZoneDetail مع اجتياز المسار + find/set/recordHistory/list للموقع) + `PostgresOutbox` (append/unread). الـrepository يُرجع كل كيان مع LocalizedName الكاملة (كل اللغات)؛ طبقة use-case تطبّق fallback إلى ar — فسلوك in-memory وDrizzle متطابق. (و) `contracts/seeds/saudi-arabia.sql` — INSERT ... ON CONFLICT DO NOTHING (idempotent) للبلد SA ← منطقة المدينة ← مدينة المدينة ← حيّان (الحرة/قباء) ← منطقتان (الحرة الشرقية/قباء الشمالية) + أسماء ar/en/ur؛ المعرّفات UUID ثابتة تطابق الـin-memory fixture. حيّ الحرة ومنطقة الحرة الشرقية تنقصهما ترجمات en/ur لاختبار fallback. (ز) `src/__tests__/postgres-repository.integration.test.ts` — 4 اختبارات تكامل (مُفعّلة بـDATABASE_URL عبر describe.skipIf): تحميل الـseed + التسلسل الهرمي المُترجم؛ fallback إلى ar؛ إنشاء موقع أول (version 1 + set event)؛ تغيير مع history + changed event + idempotent-same-zone no-op. (ح) `src/index.ts` — تصدير طبقة Drizzle.
2. **لماذا؟** Phase 02 Exit Gate يتطلب تغيير الموقع دون حساب جديد + i18n ضد Postgres حقيقي. طبقة Drizzle تُحيّد النواة المجردة (MR 3) عن التخزين الفعلي وفق ADR-006 (نفس المكدّس كـIdentity). الـseed السعودي idempotent يضمن إعادة التشغيل الآمن في CI والإنتاج.
3. **أين؟** `services/geography/`.
4. **كيف تم اختباره؟** ✅ typecheck -r (5 حزم). ✅ 25 اختبار وحدة (نواة، من MR 3، لم تتأثر). ✅ 4 اختبارات تكامل Postgres ضد `geo_test` (Postgres 18): seed+hierarchy مُترجم؛ fallback ar للمناطق الناقصة en/ur؛ set (version 1 + geo.user_location.set)؛ change (history مع old_zone=null للأول + old_zone للسابق + geo.user_location.changed)؛ idempotent-same-zone (لا history/event/version جديد). ✅ scan-secrets نظيف.
5. **ما الخطوة التالية؟** Phase 02 MR 5 — Fastify HTTP layer (9 مسارات) + error mapping لأكواد Geography الـ12 إلى HTTP.
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + تحديث MASTER_PROGRESS + HANDOFF [4].
7. **هل مراجَع؟** مُراجعة ذاتياً + المستشار (تصحيحات: جداول names تُحمّل دفعياً لتفادي N+1؛ الـrepository يُرجع LocalizedName الكاملة والـuse-case يطبّق fallback؛ اختبار التكامل يستخدم delta للـoutbox لأن unread() يُرجع كل الأحداث غير المنشورة عبر المستخدمين).
8. **هل ADR مطلوب؟** لا — ADR-006 يغطي المكدّس ونموذج البيانات (من MR 2). هذا تنفيذ ضد العقود.
9. **هل يكسر backward compatibility؟** لا — إضافة طبقة persistence لخدمة قائمة؛ النواة المجردة (MR 3) لم تتأثر.
10. **هل migration؟** نعم — `contracts/schema.sql` هو عقد DDL (يُطبّق على قاعدة فارغة)؛ `contracts/seeds/saudi-arabia.sql` بيانات أولية. Drizzle schema (`src/infrastructure/drizzle/schema.ts`) يطابق الـDDL اليدوي (ADR-004/006: الـDDL اليدوي هو المصدر). لا توجد هجرة drizzle-kit مُولّدة في CI (db:generate محلي فقط).
11. **هل توجد مخاطر؟** نعم: (أ) الـin-memory seed (TS) و SQL seed يكرّران البيانات — يجب إبقاؤهما متزامنين (المعرّفات UUID ثابتة في كلاهما تخفف ذلك). (ب) اختبار التكامل لا يُشغّل في CI بعد (job db-integration يشغّل Identity فقط) — يُحلّ في MR 6. (ج) تريغر `updated_at` من schema.sql غير مُمثّل في Drizzle schema — يُطبّق عبر DDL عند إنشاء الجداول في الاختبار.
12. **هل security؟** لا أسرار؛ wasla_public_id مرجع opaque مع CHECK نمط؛ الاتصال بـPostgres عبر DATABASE_URL من env.
13. **هل performance؟** جداول names تُحمّل دفعياً (inArray) لتفادي N+1؛ فهارس على (entity_id, locale) و (wasla_public_id) في schema.sql.
14. **هل monitoring؟** لا في هذا الـMR؛ السجلّ المهيكلي (pino) يُضاف في طبقة Fastify (MR 5).

**Related:** [MR !19](https://gitlab.com/uxxxu/wasla/-/merge_requests/19)، [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)، [عقود geography](../../services/geography/contracts/README.md)، [النواة المجردة MR !18](https://gitlab.com/uxxxu/wasla/-/merge_requests/18)

---

## 2026-08-20 · Phase 02 MR 3 — geography pure core (domain/ports/in-memory/use-cases/locale fallback)

**Task:** تنفيذ النواة المجردة لخدمة Geography & Localization (domain + ports + in-memory adapters + use-cases + locale fallback) وفق Contract First، دون HTTP أو Drizzle (تأتي في MR 4/5). **Status:** Completed (مُتحقَّق محلياً: typecheck 5 حزم؛ 25 اختباراً + 80 إجمالياً؛ scan-secrets نظيف) · **MR:** [!18](https://gitlab.com/uxxxu/wasla/-/merge_requests/18)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** `services/geography/` (`@wasla/geography-service`): package.json + tsconfig + vitest.config + vitest.integration.config. `src/domain/`: model.ts (كيانات camelCase منفصلة عن DTOs: Country/Region/City/District/Zone/LocalizedName/UserLocationAssignment/UserLocationHistoryEntry + أنواع GeoStatus/Locale/LocationSource)؛ errors.ts (GeographyError + 12 كوداً مع class→HTTP)؛ locale.ts (resolveLocalizedName مع fallback إلى ar)؛ events.ts (مصانع userLocationSet/userLocationChanged). `src/ports.ts` (Clock/IdGenerator/Outbox/IdentityLookupPort.identityExists/GareographyRepository مع find+list لكل مستوى + getZoneDetail + find/set/recordHistory للموقع). `src/infrastructure/in-memory.ts` (InMemoryGeographyRepository مزروع ببيانات Saudi الثابتة + InMemoryIdentityLookupPort + SystemClock/CryptoIdGenerator/InMemoryOutbox). `src/use-cases/`: deps.ts (UseCaseDeps)؛ mappers.ts (entity+names→DTO مع locale fallback)؛ list-hierarchy.ts (6 دوال)؛ set-user-location.ts (النواة)؛ get-user-location.ts؛ get-user-location-history.ts. `src/index.ts`. 25 اختباراً (locale 4 + hierarchy 10 + user-location 11).
2. **لماذا؟** Phase 02 Exit Gate يتطلب تغيير الموقع دون حساب جديد + i18n. النواة المجردة تبني المنطق ضد العقود/الأنواع قبل HTTP/Postgres. فصل domain عن DTOs (camelCase) يجعل النواة مستقلة عن شكل API. locale fallback في طبقة use-case (لا مخفية في repo) يضمن تطابق in-memory وDrizzle لاحقاً.
3. **أين؟** `services/geography/`.
4. **كيف تم اختباره؟** ✅ typecheck -r (5 حزم). ✅ 25 اختباراً: create (set event+201)؛ change (changed event+history+version)؛ idempotent (نفس المنطقة: لا event/history/version)؛ invalid public id (400)؛ identity not found (404)؛ zone not found (404)؛ locale fallback (en مفقود→ar)؛ parent-not-found (country/region/city/district)؛ getUserLocation not found. ✅ scan-secrets نظيف.
5. **ما الخطوة التالية؟** Phase 02 MR 4 — Drizzle/Postgres persistence + Saudi seed (contracts/seeds/saudi-arabia.sql).
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + تحديث MASTER_PROGRESS + HANDOFF [3].
7. **هل مراجَع؟** مُراجعة ذاتياً + المستشار (تصحيحات: فصل domain عن DTOs، إضافة recordUserLocationHistory للـports، locale fallback في use-case لا في repo، تأكيد سلوك setUserLocation idempotent).
8. **هل ADR مطلوب؟** لا — ADR-006 يغطي المكدّس ونموذج البيانات (من MR 2). هذا تنفيذ ضد العقود.
9. **هل يكسر backward compatibility؟** لا — خدمة جديدة مستقلة، لا تمس Identity أو العقود.
10. **هل migration؟** لا — لا DB في هذا الـMR (Drizzle في MR 4).
11. **هل توجد مخاطر؟** نعم: الـin-memory seed (TS) يكرّر منطقياً SQL seed القادم في MR 4 — يجب إبقاؤهما متزامنين. التخفيف: توثيق التزامن في README.
12. **هل security؟** لا أسرار؛ wasla_public_id مرجع opaque مع CHECK نمط.
13. **هل performance؟** الـin-memory repository يستخدم Map (O(1) للبحث). بالنسبة لـPostgres (MR 4) ستُضاف فهارس.
14. **هل monitoring؟** لا في هذا الـMR؛ يُضاف في Phase 18.

**Related:** [MR !18](https://gitlab.com/uxxxu/wasla/-/merge_requests/18)، [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)، [عقود geography](../../services/geography/contracts/README.md)

---

## 2026-08-20 · Phase 02 MR 2 — عقود Geography & Localization + ADR-006

**Task:** إنشاء العقود التعاقدية لخدمة Geography & Localization وفق Contract First ([ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)) + توثيق المكدّس ونموذج البيانات في [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md). **Status:** Completed (مُتحقَّق محلياً: DDL يُطبَّق على Postgres 18؛ typecheck 4 حزم؛ 15 اختباراً + ADR) · **MR:** [!17](https://gitlab.com/uxxxu/wasla/-/merge_requests/17)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) `services/geography/contracts/`: `schema.sql` (13 جدولاً: 5 هرمي geo_countries/regions/cities/districts/zones + 5 ترجمة *_names + geo_user_locations + geo_user_location_history + geo_outbox + triggers)؛ `events.json` (حدثان: `geo.user_location.set.v1`، `geo.user_location.changed.v1`)؛ `api.openapi.yml` (9 مسارات: استعلام الهرم + موقع المستخدم GET/PUT + history)؛ `errors.md` (12 كود خطأ)؛ `README.md`. (ب) `packages/contracts/geography/` (`@wasla/contracts-geography`): package.json + tsconfig + `src/api-types.ts` (مولّد من OpenAPI عبر openapi-typescript) + `src/events-types.ts` (مشتق يدوياً) + `src/index.ts` (تصدير الأنواع + primitives: `SupportedLocale`/`LOCALE_DIRECTION`/`DEFAULT_LOCALE`) + 15 اختباراً (drift guard + contract smoke). (ج) `docs/15-decisions/ADR-006-...md`.
2. **لماذا؟** Phase 02 Exit Gate يتطلب تغيير الموقع دون حساب جديد + i18n. Contract First يوجب العقود أولاً (DDL + events + OpenAPI + errors)، ثم الأنواع المُكتبة، ثم التنفيذ. ADR-006 يوثّق قرارات التغليف (مرجع opaque لـwasla_public_id، لا FK إلى identity) + الترجمة (جداول منفصلة لا JSONB) + PostGIS/Testcontainers/i18n مستقل مؤجلة.
3. **أين؟** `services/geography/contracts/`، `packages/contracts/geography/`، `docs/15-decisions/`، `docs/16-progress/`.
4. **كيف تم اختباره؟** ✅ DDL يُطبَّق على Postgres 18 (13 جدولاً + triggers). ✅ typecheck -r (4 حزم). ✅ 15 اختباراً (5 drift guard للأحداث + 10 contract smoke). ✅ openapi-typescript يولّد api-types.ts (578 سطراً). ✅ scan-secrets نظيف.
5. **ما الخطوة التالية؟** Phase 02 MR 3 — النواة المجردة (domain + ports + in-memory + use-cases + locale fallback).
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + ADR-006 + تحديث MASTER_PROGRESS (Phase 02 → In Progress) + HANDOFF [2].
7. **هل مراجَع؟** مُراجعة ذاتياً + المستشار (خطة الـ7 MRs + قرارات التغليف/i18n).
8. **هل ADR مطلوب؟** نعم — [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md) (هذا الـ MR نفسه).
9. **هل يكسر backward compatibility؟** لا — حزمة جديدة + عقود جديدة، لا تمس Identity.
10. **هل migration؟** نعم — `schema.sql` هو عقد DDL (يُطبّق على قاعدة فارغة). الترحيل الفعلي عبر Drizzle في MR 4.
11. **هل توجد مخاطر؟** نعم: (أ) التحقق من وجود الهوية عبر `IdentityLookupPort` (HTTP في الإنتاج) يضيف قفزة شبكية — يُخفّف بـfake في الاختبارات. (ب) تغطية Saudi الأولية محدودة (تكفي لـExit Gate) — تُوسَّع لاحقاً.
12. **هل security؟** لا أسرار؛ `wasla_public_id` مرجع opaque مع CHECK نمط — لا تسريب internals.
13. **هل performance؟** جداول الترجمة مفهرسة (PK مركّب)؛ fallback إلى ar سريع.
14. **هل monitoring؟** لا في هذا الـMR؛ يُضاف في Phase 18 (Observability).

**Related:** [MR !17](https://gitlab.com/uxxxu/wasla/-/merge_requests/17)، [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)، [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)، [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)

---

## 2026-08-20 · Phase 02 MR 1 — مصالحة الوثائق بعد إغلاق Phase 01 (توثيقي)

**Task:** تصحيح الحالات القديمة في وثائق التقدم لتعكس الواقع بعد دمج Phase 01 (MR !11–!15) وإغلاق Phase 00/01، كي يعرف أي جهة تلي العمل الوضع الحالي بدقة. **Status:** Completed (توثيقي) · **MR:** [!16](https://gitlab.com/uxxxu/wasla/-/merge_requests/16)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) `ROADMAP.md`: ملاحظة «W0 لم يبدأ بعد» (عائق shared runners قديم) → «W0 = 2026-08-20، Phase 00/01 = Completed، Phase 02 قيد البدء». (ب) `TASK_LOG.md`: إدخالات MR !8–!15 كانت تقول «مفتوح للمراجعة/الدمج» → «مُدمج، CI أخضر»؛ وإدخال MR !8 صُحّح إلى «أُغلق/استُبدل، ADR-005 دخل عبر !10». (ج) `HANDOFF_NEXT_STEPS.md`: حالة MR !11–!15 → «مُدمج، CI أخضر»؛ ملاحظة Wasla Public ID القديمة («10 محارف كبيرة») → الواقع المنفّذ (`^WS-[0-9]{10}$` من تسلسل Postgres)؛ عنوان القسم 4 → «Checklist Phase 01 (مكتملة)»؛ أُضيف القسم 6 بخطة Phase 02 (7 MRs).
2. **لماذا؟** القاعدة الحاكمة: أي عمل يُدفع يجب توثيقه مع إبقاء خارطة الطريق واضحة لأي جهة تلي العمل — تعرف ماذا تمّ وماذا بقي. العبارات القديمة («مفتوح للمراجعة»، «W0 لم يبدأ») كانت تتناقض مع الواقع (الـMRs مدمجة، CI أخضر، Phase 00/01 مكتملة).
3. **أين؟** `docs/16-progress/{ROADMAP,TASK_LOG,HANDOFF_NEXT_STEPS}.md`.
4. **كيف تم اختباره؟** تحقّق من حالة الـMRs الفعلية على GitLab (!8=closed، !9–!15=merged). تحقق محلياً: grep للعبارات القديمة → 0 بعد التصحيح.
5. **ما الخطوة التالية؟** Phase 02 MR 2 — عقود geography (schema.sql + events + OpenAPI + errors) + ADR-006.
6. **هل مستند؟** نعم — هذا الإدخال.
7. **هل مراجَع؟** مُراجعة ذاتياً + المستشار.
8. **هل ADR مطلوب؟** لا — توثيقي فقط، لا انحراف.
9. **هل يكسر backward compatibility؟** لا.
10. **هل migration؟** لا.
11. **هل توجد مخاطر؟** لا — توثيقي بحت.
12. **هل security؟** لا.
13. **هل performance؟** لا.
14. **هل monitoring؟** لا.

**Related:** [MR !16](https://gitlab.com/uxxxu/wasla/-/merge_requests/16)، [HANDOFF القسم 6](HANDOFF_NEXT_STEPS.md#6-phase-02-geography--localization---العمل-الحالي)

---

## 2026-08-20 · MR 5 — Phase 01 Exit Gate E2E + إغلاق Phase 01

**Task:** اختبار E2E رسمي للـExit Gate وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) — سيناريو متكامل (إنشاء مستخدم Telegram → idempotent → تغيير Username → ثبات الهوية/Public ID) عبر كامل المكدّ (HTTP→use cases→Drizzle/Postgres) باستخدام `app.inject` ضد Postgres حقيقي، مع تأكيدات outbox/history. **Status:** Completed (مُتحقَّق محلياً + CI؛ [MR !15](https://gitlab.com/uxxxu/wasla/-/merge_requests/15) مُدمج، CI أخضر) · **MR:** [!15](https://gitlab.com/uxxxu/wasla/-/merge_requests/15)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** أُضيف اختبار E2E `exit-gate.e2e.test.ts` يُشغّل كامل التدفّق عبر `createIdentityApp` + محوّلات Postgres (بدون منفذ — `app.inject`) ضد Postgres حقيقي: (1) إنشاء مستخدم من Telegram (201) والتقاط Public ID/internal_uuid؛ (2) حلّ idempotent بنفس telegram_user_id + username (200، created=false، نفس Public ID + internal_uuid)؛ (3) تغيير Username (200، نفس Public ID + internal_uuid — هوية مستقرة)؛ (4) history يُظهر usernameEntries `[v1, v2]` مع old_value؛ (5) outbox يحوي `identity.created` + `identity.link.added` + `identity.telegram_username.changed`؛ (6) رفض ربط telegram_id مملوك لمستخدم آخر (409 `IDENTITY_LINK_ALREADY_LINKED`) مع عدم إفساد هوية المالك. كذلك تحديث إعدادات vitest لتشمل نمط `*.e2e.test.ts` (مستثنى من التشغيل الافتراضي، مُشغّل في `test:integration` الذي ينفّذه job `db-integration` في CI).
2. **لماذا؟** هذا هو تحقّق الـExit Gate لـPhase 01: «إنشاء مستخدم من Telegram وبقاء هويته مستقرة عبر تغيير Username». الاختبارات السابقة غطّت الطبقات منفصلة (وحدة، تكامل مستودع، HTTP)؛ هذا الاختبار يتحقّق من السلوك المتكامل عبر كل الطبقات في سيناريو واحد شامل.
3. **أين؟** `services/identity/src/__tests__/exit-gate.e2e.test.ts`، `services/identity/vitest.config.ts` و`vitest.integration.config.ts`، `docs/16-progress/{TASK_LOG,MASTER_PROGRESS,HANDOFF_NEXT_STEPS}.md`.
4. **كيف تم اختباره؟** محلياً: ✅ `DATABASE_URL=... pnpm test:integration` → 5 اختبارات تجتاز (2 E2E + 3 تكامل). `pnpm -r typecheck` ✅ (3 حزم)، `pnpm -r test` ✅ (24 افتراضياً، E2E مستثنى)، `scan-secrets` ✅. CI: job `db-integration` يشغّل اختبار E2E ضد خدمة postgres:15 — اجتيازه = اجتياز Exit Gate.
5. **ما الخطوة التالية؟** إغلاق Phase 01 = Completed (بعد اجتياز CI لـMR 5) ثم بدء Phase 02 (Geography & Localization).
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + تحديث `MASTER_PROGRESS.md` (Phase 01 → Completed) + `HANDOFF_NEXT_STEPS.md` (قائمة [5] + تسليم Phase 01).
7. **هل مراجَع؟** مُراجعة ذاتياً + [MR !15](https://gitlab.com/uxxxu/wasla/-/merge_requests/15) مفتوح للمراجعة.
8. **هل ADR مطلوب؟** لا — لا انحراف. استخدام `app.inject` (بدون منفذ) للاختبار E2E هو ممارسة قياسية في Fastify.
9. **هل يكسر backward compatibility؟** لا — إضافة اختبار + تحديث إعدادات vitest فقط.
10. **هل migration؟** لا.
11. **هل توجد مخاطر؟** نعم: (أ) اختبار E2E يعتمد على job `db-integration` (postgres service) في CI — مُفعّل في MR 4. (ب) حالات حافة إضافية (مثل recovery كامل، username→null) مغطّاة جزئياً في اختبارات الطبقات الأدنى؛ يمكن تعزيزها لاحقاً.
12. **هل security؟** لا أسرار؛ قاعدة اختبار فارغة في كل تشغيل.
13. **هل performance؟** اختبار E2E سريع (<200ms)؛ يُشغّل بالتوازي مع build-test في CI.
14. **هل monitoring؟** لا؛ نتيجة job تظهر في pipeline.

**Related:** [MR !15](https://gitlab.com/uxxxu/wasla/-/merge_requests/15)، [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)، MR 1-4 ([!11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11)→[!14](https://gitlab.com/uxxxu/wasla/-/merge_requests/14))

---

## 2026-08-20 · MR 4 — CI DB integration (خدمة postgres في CI)

**Task:** ربط اختبارات تكامل Postgres بـCI وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) — إضافة job `db-integration` بخدمة `postgres:15` (GitLab service) يُشغّل اختبارات التكامل ضد Postgres حقيقي في كل MR و على main، مع تصحيح مسار `schema.sql` في الاختبار. **Status:** Completed (مُتحقَّق محلياً ضد Postgres 18 + E2E؛ [MR !14](https://gitlab.com/uxxxu/wasla/-/merge_requests/14) مُدمج، CI أخضر) · **MR:** [!14](https://gitlab.com/uxxxu/wasla/-/merge_requests/14)

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

**Task:** إضافة طبقة HTTP لخدمة Identity وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) — مصنع تطبيق Fastify (`createIdentityApp`) يربط مسارات العقد الخمسة (resolve/getUser/addLink/recovery/history) بحالات الاستخدام، تعيين الأخطاء إلى رموز HTTP وأجسام الأخطاء التعاقدية، نقطة إقلاع (composition root)، واختبارات عبر `app.inject`. **Status:** Completed (مُتحقَّق محلياً + smoke test ناجح؛ [MR !13](https://gitlab.com/uxxxu/wasla/-/merge_requests/13) مُدمج، CI أخضر) · **MR:** [!13](https://gitlab.com/uxxxu/wasla/-/merge_requests/13)

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

**Task:** إضافة طبقة استمرارية Postgres لخدمة Identity وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) — Drizzle schema مطابق للـDDL التعاقدي (schema.sql)، مستودع Postgres، تسلسل Public ID، إعداد اتصال، واختبارات تكامل منفصلة. **Status:** Completed (مُتحقَّق محلياً؛ [MR !12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12) مُدمج، CI أخضر) · **MR:** [!12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12)

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

**Task:** تنفيذ النواة المجردة لخدمة Identity وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) — نماذج النطاق، المنافذ (ports)، محوّلات في الذاكرة، حالات الاستخدام، والاختبارات. **Status:** Completed (مُتحقَّق محلياً؛ [MR !11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11) مُدمج، CI أخضر) · **MR:** [!11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11)

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

**Task:** إصلاح فشل job `build-test` (typecheck) على GitLab CI بعد تفعيل shared runners — أخطاء `Cannot find module 'node:fs'` / `node:path` / `Cannot find name '__dirname'` في `packages/contracts/identity/src/__tests__/events.test.ts`. **Status:** Completed (الإصلاح مُتحقَّق محلياً بتثبيت مُجمّد نظيف مُطابق لـCI؛ [MR !9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9) مُدمج، CI أخضر) · **MR:** [!9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9)

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

**Task:** توثيق قرار اختيار المكدّس التقني لتنفيذ خدمة Identity — الخطوة الموثّقة التالية نحو Phase 01 Exit Gate. **Status:** Completed (قرار توثيقي مكتوب ومُدمج؛ [MR !8](https://gitlab.com/uxxxu/wasla/-/merge_requests/8) أُغلق/استُبدل، ودخل ADR-005 إلى main عبر [MR !10](https://gitlab.com/uxxxu/wasla/-/merge_requests/10) المُدمج، CI أخضر) · **MR:** [!8](https://gitlab.com/uxxxu/wasla/-/merge_requests/8) (مُغلق) → [!10](https://gitlab.com/uxxxu/wasla/-/merge_requests/10) (مُدمج) · **ADR:** [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)

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
