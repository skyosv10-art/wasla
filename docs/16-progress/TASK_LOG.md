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

### [2026-08-22] Phase 05 · MR 6/6 — بوابة خروج المرحلة E2E بسبع خدمات مُنصتة، وعيب تصادُم مفتاح منع التكرار

- **Files:** `packages/driver-e2e/{package.json,tsconfig.json,vitest.config.ts}` و`src/harness.ts` و`src/__tests__/phase05-exit-gate.e2e.test.ts` (جديدة) · `services/drivers/src/infrastructure/http-candidacy.ts` (إصلاح المفتاح) · `services/drivers/src/__tests__/outbound-ports.test.ts` (حارس بساعة مجمَّدة) · `packages/dispatch-e2e/src/harness.ts` (ملاحظة الوعد المُوفى) · `.gitlab-ci.yml` (وظيفة `driver-exit-gate-e2e`) · `docs/12-testing/PHASE05_EXIT_GATE_E2E.md` (جديدة) · `docs/04-api/DRIVER_HTTP.md` §11 · `docs/16-progress/{HANDOFF_NEXT_STEPS.md,MASTER_PROGRESS.md,ROADMAP.md,TASK_LOG.md}`
- **Services:** السبع كلّها في عملية اختبار واحدة — `identity` (8080) · `geography` (8081) · `customers` (8086) · `orders` (8087) · `matching` (8088) · `dispatch` (8089) · `drivers` (8090) — كلٌّ مُنصت Fastify حقيقي على `127.0.0.1` بمنفذ عشوائي.
- **Why:** MR 6/6 من خطّة Phase 05 المُلزِمة (HANDOFF §13) وبوابة إغلاق المرحلة. **حزمة جديدة إلزامٌ لا ترتيب:** وضعها في `services/drivers` يُلزم نواة السائق بالاعتماد على التوزيع والمحرّك والعميل وهو عكس اتجاه المعرفة الأحاديّ في ADR-012؛ ووضعها في `dispatch-e2e` يُفقد بوابة الطور 07 قدرتها على الفشل وحدها. **وساعة واحدة مُحقونة في الجميع** لأنّ ساعتين تجعلان الاختبار يقيس فرقهما لا انتهاء وثيقة.
- **Tests:** `pnpm --filter @wasla/driver-e2e test` ⇒ **14/14 في ملف واحد** (~1.1s، بلا `sleep`) · خدمة السائقين **195 اختباراً في 13 ملفاً** · `pnpm -r run test` ⇒ **2127 اختباراً ناجحاً + 1 متروك بقصد في 129 ملفاً** على 28 مشروع عمل · `pnpm -r run typecheck` نظيف على **29 مشروعاً** · وظيفة `driver-exit-gate-e2e` تُعيد الملف على Postgres 15 عبر `DRIVER_DATABASE_URL`. **لقطة محليّة — رصيد CI منتهٍ (`ci_quota_exceeded`).**
- **ما ظهر:** **عيبٌ حقيقيّ أسقطته البوابة في أول تشغيل (2 من 14)**: مفتاح منع التكرار `drv-{driverId}-{attemptMillis}-{contentHash}` عمق دفاعه **مليّ ثانية واحدة**، فسائق ينشر `offline → available → offline` داخل نبضة الساعة نفسها يُنتج مفتاحاً مكرّراً ⇒ المطابقة تُعيد جوابها المخزَّن بلا تطبيق ⇒ صفّها يبقى قديماً و`driver_candidacy_publications` يقول `published` والتدقيق نظيف. والحارس الوحدوي القائم لم يكشفه لأنه كان **يُقدّم الساعة ثانيةً بين المحاولتين** فيبرهن أنّ الطابع يتغيّر لا أنّ المفتاح فريد. **الإصلاح:** عدّاد محاولات داخل المفتاح + حارس **بساعة مجمَّدة** ومحتوى متطابق ثلاث مرّات. **لا سطر تغيّر في `services/matching`** — سلوكها صحيح والخلل في مُولِّد المفاتيح. **والفائدة قِيست بفحص طفرة:** بإعادة المفتاح القديم تسقط 2 من 14 في البوابة و1 من 29 في الحارس، وبإرجاعه تعود 14/14 و29/29.
- **الحدود المُعلَنة:** المطابقة والتوزيع والمحرّك والعميل والهوية والجغرافيا في الذاكرة (متانتها تملكها بوابات 07 و06 و04 و02) · `DRIVER_DATABASE_URL` يرفع **نواة السائق وحدها** · لا بوت سائق في المسار (مسارات 8090 تُنادى **كما ينادِيها البوت**) · نافذة السباق على صفّ الترشيح تبقى مفتوحة (ADR-012 القرار 4 — تحتاج `If-Match` في خدمة أخرى) · سائق واحد في التجمّع كي يكون العرض منسوباً بيقين.
- **Next:** **Phase 05 مُغلقة ✅.** التالي **Phase 08 (Negotiation & Chat)** — اعتمادها الوحيد 07 وقد أُغلقت، وهي على المسار الحرج `00 → 01 → 02 → 04 → 06 → 07 → 09 → 20`. وما تُسلّمه لها Phase 05: المرشّح صار **مُتحقَّقاً** لا مُدّعى. والدَّين المُعلَن المُسنَد: مُشغِّل النبضة الدوريّ ومُرحِّل الصادر والتقليم ⇒ Phase 09 · رفع الملفّات ⇒ Phase 12 · `reviewed_by` ⇒ Phase 10.
- **Related:** Phase 05 · MR 6/6 ([!56](https://gitlab.com/uxxxu/wasla/-/merge_requests/56)) · [PHASE05_EXIT_GATE_E2E.md](../12-testing/PHASE05_EXIT_GATE_E2E.md) · [ADR-012](../15-decisions/ADR-012-driver-core-eligibility-derivation-and-candidacy-publication.md) · [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) القرار 2 · [HANDOFF §13](HANDOFF_NEXT_STEPS.md)

---

### [2026-08-22] Phase 05 · MR 5/6 — المنافذ الصادرة الحقيقية (8088 · 8081) وواجهة بوت السائق، وتقاعُد 502

- **Files:** `services/drivers/src/infrastructure/{http-candidacy.ts,http-zone-catalog.ts,outbound-wiring.ts}` (جديدة) · `services/drivers/src/{ports.ts,domain/errors.ts,use-cases/recompute-eligibility.ts,infrastructure/in-memory.ts,http/app.ts,http/server.ts,index.ts}` · `services/drivers/contracts/{api.openapi.yml,errors.md}` · `packages/contracts/driver/src/{index.ts,api-types.ts}` + `__tests__/contracts.test.ts` · `services/drivers/src/__tests__/{outbound-ports.test.ts (جديد),http-errors.test.ts,contract-drift.test.ts}` · `packages/bot-runtime/src/{http/server.ts,index.ts}` (+`runBotApp`) · `bots/driver-bot/src/{flows.ts,driver-core.ts}` (جديدة) + `{server.ts,index.ts,main.ts,package.json}` + `__tests__/driver-flows.test.ts` (جديد) · `bots/{customer,partner}-bot/src/main.ts` · `pnpm-lock.yaml` · `docs/02-architecture/{DRIVER_BOT_FLOWS.md (جديدة),CHANNEL_BOTS.md}` · `docs/04-api/DRIVER_HTTP.md` · `docs/16-progress/{HANDOFF_NEXT_STEPS,MASTER_PROGRESS,ROADMAP,TASK_LOG}.md`
- **Services:** `services/drivers` (`@wasla/drivers-service` · 8090 → 8088 مطابقة و8081 جغرافيا) · `bots/driver-bot` (8084) · `packages/bot-runtime` · وأثرٌ مقصود على `bots/customer-bot` و`bots/partner-bot`
- **Why:** MR 5/6 من خطّة Phase 05 المُلزِمة (HANDOFF §13). **الفشل مصنَّف لا موحَّد:** 400/409/422 من المطابقة جوابٌ صالح من خدمة رفضت فيُسجَّل ويبقى التغيير المحليّ قائماً، وكلّ ما عداه (503 · مهلة · شبكة) يُرفع — فخلطُهما يخفي انقطاعاً كاملاً في عدّاد رفضٍ عاديّ. و`Idempotency-Key` **لكلّ محاولة** لا لكلّ محتوى، لأنّ مفتاحاً من هضم المحتوى يجعل `available → offline → available` يُجاب «تمّ من قبل» فيبقى السائق `offline` في المطابقة — أي بالضبط ما تحذّر منه ADR-012 القرار 3. ودليل المناطق صار HTTP إلى الجغرافيا و**المنطقة غير النشطة غير موجودة** (قبولها يجعل سائقاً مؤهَّلاً لمنطقة أوقفتها العمليات)، و`DRIVER_DEV_ZONE_IDS` تقلّصت إلى بديل تطويريّ **بتحذير مُسجَّل** فأُغلق الانحرافان 6 و7. **وعيبٌ فعليّ أسقطه بناء المنافذ:** `candidacy.read()` كانت **خارج** `try/catch` في `recomputeEligibility` فمطابقةٌ معطوبة تُسقط كتابةً محليّة نجحت — نقضٌ مباشر لـADR-012، لم يظهر قبلاً لأنّ المنفذ الوحيد كان في الذاكرة ولا يفشل. **و502 تقاعَد بدل أن يُستعمل** (`DRIVER_CANDIDACY_PUBLISH_FAILED` حُذف من عشرة مواضع في العقد ومن الكود، فصارت الرموز 20 لا 21): مَن نجحت كتابته يُعيد مورده لا رمزاً يأمر بإعادة عملية تمّت، والانقطاع له `DRIVER_UNAVAILABLE` (503)، والفشل يبقى مرئياً عند المشغّل في `last_published_state` و`publish_failures`. **وعيبٌ في مُشغِّل العملية أصاب بوت العميل المنشور:** `main.ts` كان ينادي `runBot(BOT)` فيتخطّى `buildApp()` أي جذر تركيب البوت — فالبوت المنشور يخدم `/start` وحده بلا `/places` ولا `/orders` **وطاقم اختباره أخضر بالكامل** لأنّ الاختبارات تسلك المسار الصحيح الذي لا يسلكه الإنتاج؛ أُضيف `runBotApp(bot, build)` وحُوِّلت البوتات الثلاثة إليه.
- **Tests:** `pnpm -r run typecheck` نظيف على **28 مشروعاً** · `pnpm -r run test` ⇒ **2112 اختباراً ناجحاً + 1 متروك بقصد في 128 ملفاً** (كان 2061 في 126). منها: `outbound-ports.test.ts` **28 اختباراً** بحقن `fetch` لا بشبكة (التحويل · تصنيف الفشل · شكل المفتاح · المهلة · **وثلاثة اختبارات أثر تُثبت أنّ قراءةً معطوبة لا تُفشِل الكتابة المحليّة ولا تستبدل صفّ `busy` مبذوراً**) · `driver-flows.test.ts` **21 اختباراً** (بديل مُسجِّل + `app.inject` + مُهيّئ فعليّ فوق بيئة الذاكرة) · وحارسان جديدان في `contract-drift.test.ts`: الأكواد المتقاعدة في الاتجاهين، و**«كلّ مصنع خطأ مُصدَّر يستعمله مسار إنتاج»** فلا يبقى رمزٌ ميت. خدمة السائقين **194 في 13 ملفاً** (كانت 164 في 12) وبوت السائق **27** (كان 6). **الأرقام محليّة:** خطّ الأنابيب سيظهر أحمر لأنّ حصّة دقائق CI نافدة ([HANDOFF §2-أ](HANDOFF_NEXT_STEPS.md)) لا لعلّة في الكود.
- **Next:** MR 6/6 — **بوابة خروج Phase 05 E2E**: سائق يُسجَّل ويُراجَع فيصير مؤهَّلاً بأهليّة محسوبة فيصله عرض حقيقي من التوزيع، ثمّ تنتهي وثيقته بنبضة واحدة فيخرج من التجمّع. وهي **موضع اختبار التكامل الغائب هنا**: منافذ صادرة على مطابقة وجغرافيا مستمعتين فعلاً + Postgres، إذ الـ28 اختباراً تحقن `fetch` فتُثبت التحويل ولا تُثبت أنّ المطابقة تقبل ما نرسله.
- **Related:** Phase 05 · MR 5/6 ([!55](https://gitlab.com/uxxxu/wasla/-/merge_requests/55)) · [ADR-012](../15-decisions/ADR-012-driver-core-eligibility-derivation-and-candidacy-publication.md) · [DRIVER_BOT_FLOWS.md](../02-architecture/DRIVER_BOT_FLOWS.md) · [DRIVER_HTTP §8](../04-api/DRIVER_HTTP.md) · [CHANNEL_BOTS §7.1](../02-architecture/CHANNEL_BOTS.md) · [HANDOFF_NEXT_STEPS §13](HANDOFF_NEXT_STEPS.md)

---

### [2026-08-22] Phase 05 · MR 4/6 — طبقة HTTP لخدمة السائقين على 8090 بمقبس معاملة واحد

- **Files:** `services/drivers/src/http/{app.ts,errors.ts,requests.ts,idempotency.ts,server.ts}` (جديدة) · `services/drivers/src/use-cases/read-driver.ts` (جديد) · `services/drivers/contracts/api.openapi.yml` (ثلاثة تصحيحات عقد) · `packages/contracts/driver/src/api-types.ts` (مُعاد توليده) · `services/drivers/src/{mappers.ts,index.ts,package.json}` · `services/drivers/src/__tests__/{http-harness.ts,http-profile.test.ts,http-vehicles.test.ts,http-documents.test.ts,http-eligibility.test.ts,http-errors.test.ts,http-drift.test.ts}` (جديدة) · `services/drivers/src/__tests__/contract-drift.test.ts` · `pnpm-lock.yaml` (fastify) · `docs/04-api/DRIVER_HTTP.md` (جديدة) · `docs/16-progress/{HANDOFF_NEXT_STEPS,MASTER_PROGRESS,ROADMAP,TASK_LOG}.md`
- **Services:** `services/drivers` (`@wasla/drivers-service`) — المنفذ **8090** من `DRIVER_SERVICE_PORT` لا رقماً مكتوباً في ملف خادم
- **Why:** MR 4/6 من خطّة Phase 05 المُلزِمة (HANDOFF §13): ثلاثة عشر مساراً و`/health` بحالتيه، والمعالج يستقبل **`DriverRunner` وحده** فلا يملك أحدها فتح معاملة — الخطأ **غير متاح** لا غير مُستحسَن. وقبل كتابة سطر مسار صُحِّحت ثلاثة عيوب عقد، لأنّ بناء طبقة على عقد نعرف خطأه يجعل الكود صحيحاً والوثيقة كاذبة: `HealthStatus.last_tick_at` كان يُعاد ولا يُعلَن · `VehiclePatch.status` ضُيِّق إلى `[retired]` لأنّ `active` كانت وعداً ترفضه `patchVehicle` بـ400 منذ MR 2/6 · `ErrorResponse.error.details` بلا شكل تمنع أيّ مستهلك من قراءتها. وحُذف `wasla_public_id` الزائد من `VehicleWire` و`DriverDocumentWire`. **وعيبٌ في تنفيذنا أسقطه اختبار:** المركبات والوثائق كانت تُعيد السطر الموجود لمفتاح مُعاد **بحمولة مختلفة** فتُجيب 200 عن مركبة ليست المطلوبة بدل 409 — الآن يُستدعى المجال دائماً ويبقى قرار الإعادة والتعارض له. و`POST /drivers` تُحسم إعادتها عند حدّ HTTP ببصمة sha256 على صورة مرتّبة المفاتيح، فاسم السائق **لا يُخزَّن قابلاً للقراءة**. والقوائم و`GET /eligibility` تُجيب **404 صريحاً** لا قائمة فارغة ولا حكم `unknown` fail-closed على السلك.
- **Tests:** `pnpm --filter @wasla/drivers-service test` ⇒ **164 اختباراً في 12 ملفاً** (منها 64 اختبار HTTP جديداً) · `npx tsc --noEmit` نظيف · وعلى المستودع كلّه `pnpm -r run typecheck` نظيف و`pnpm -r run test` ⇒ **2061 اختباراً ناجحاً في 126 ملفاً**. ومن الحرّاس: كلّ عملية عقد لها مسار مسجَّل · وكلّ مسار مسجَّل معلَنٌ في العقد (فلا نقطة نهاية غير موثَّقة) · وربط `DRIVER_CANDIDACY_PUBLISH_FAILED` → 502 **مُبرهَن بحقن Runner يرفعه** قبل وجود منفذ يستطيع رفعه.
- **Next:** MR 5/6 — `HttpCandidacyPort` إلى 8088 (وهو الموضع الذي يصير فيه 502 قابلاً للحدوث) + دليل مناطق عبر HTTP يُلغي الاعتماد على `DRIVER_DEV_ZONE_IDS` على مسار Postgres + واجهة بوت السائق. ثمّ MR 6/6 بوابة خروج المرحلة E2E.
- **Related:** Phase 05 · MR 4/6 ([!54](https://gitlab.com/uxxxu/wasla/-/merge_requests/54)) · [ADR-012](../15-decisions/ADR-012-driver-core-eligibility-derivation-and-candidacy-publication.md) · [DRIVER_HTTP.md](../04-api/DRIVER_HTTP.md) · [HANDOFF_NEXT_STEPS §13](HANDOFF_NEXT_STEPS.md)

---

### [2026-08-22] Phase 05 · MR 3/6 — استمرارية السائق على Drizzle/Postgres بوحدة عمل واحدة

- **Files:** `services/drivers/src/infrastructure/drizzle/{db.ts,schema.ts,repository.ts,transaction.ts}` (جديدة) · `services/drivers/src/runner.ts` (جديد) · `services/drivers/contracts/schema.sql` (+§9 `driver_idempotency`) · `services/drivers/src/index.ts` · `services/drivers/package.json` · `services/drivers/vitest.integration.config.ts` (جديد) · `services/drivers/src/__tests__/{pg-harness.ts,schema-drift.test.ts,repository.integration.test.ts,port-conformance.integration.test.ts,atomicity.integration.test.ts}` (جديدة) · `.gitlab-ci.yml` (+`drivers-db-integration`) · `docs/02-architecture/DRIVER_PERSISTENCE.md` (جديدة) · `docs/12-testing/DB_INTEGRATION_CI.md` · `docs/16-progress/{ROADMAP,MASTER_PROGRESS,TASK_LOG,HANDOFF_NEXT_STEPS}.md`
- **Services:** `services/drivers` (`@wasla/drivers-service`)
- **Why:** MR 2/6 سلّمت مجالاً صحيحاً بمخازن ذاكرة لا يعيش عبر إعادة تشغيل واحدة، وهذه خدمة تحمل رخصاً ووثائق هويّة — ففقد حالتها مطالبةُ آلاف السائقين برفع أوراقهم من جديد. والحدّ المُختار هو **العمليّة التطبيقيّة لا نداء المستودع**، لأنّ مراجعة وثيقة واحدة تُنفَّذ عبر ستّ نداءات منافذ فتُنتج تسع كتابات في ستّة جداول؛ ولو فتح كلّ مُهيّئ معاملته لارتكزت **بادئة**: وثيقة `superseded` بلا بديل (خسر ورقة موثَّقة **بسبب** رفعه أحدث منها)، أو `verified` بلا صفّ سجلّ (تغيّرُ حالةٍ بلا تفسير — وهو ما بُنيت الخدمة لمنعه)، أو **صفّ `driver_idempotency` بلا صفوف خلفه** فتُجاب إعادة المحاولة «تمّ من قبل» من صفٍّ لا وجود له: ضياعٌ دائم لا يُصلحه طلب لاحق. وكُشف **منفذٌ بلا جدول**: `IdempotencyStore` مُستعمل في `registerVehicle` و`submitDocument` ولا مخزن له في العقد، فأُضيف `driver_idempotency` **بعرض 8..192 لا 8..128** (سابقة التوزيع) لأنّ المفتاح المخزون مُنطَّق (`document:WS-XXXXXXXXXX:<key>` = 152 حرفاً) — وبالحدّ الأضيق كان مفتاحٌ قانونيّ تماماً بطول 128 يُرفض بقيدٍ لا يستطيع المتصل تفسيره ولا تفاديه. **والمعيار المُعلَن مسبقاً تحقّق: لم يتغيّر أي ملفّ تحت `src/use-cases/`.**
- **Tests:** `pnpm -r run test` → **1994 ناجحاً + 1 متجاوَز في 120 ملفاً** (+28 حارس انحراف مرآة يعمل بلا قاعدة في `build-test`) · `pnpm -r run typecheck` نظيف · **79 اختبار تكامل** مكتوبة وتتخطّى نفسها بلا `DATABASE_URL` وتعمل في وظيفة CI الجديدة `drivers-db-integration` على `wasla_drivers_test`: 50 مستودع (الفهرسان الجزئيّان · `COALESCE` إلى الـUUID الصفري الذي وحده يمنع وثيقتَي هويّة حيّتين · أعمدة `DATE` يوماً تقويميّاً لا طابعاً زمنيّاً · ترتيب `latest()` بـ`BIGSERIAL` لأنّ إلحاقات العمليّة الواحدة تحمل اللحظة نفسها · ترجمة 23505) · 23 مطابقة منافذ تُنفّذ السيناريو مرّتين وتقارن الأثرين **أحدهما بالآخر** لا بتوقّع مكتوب بيد · 6 ذرّية بحالة ضبط وبإعادة محاولة تنجح بعد التراجع. **الأرقام محليّة:** خطّ الأنابيب سيظهر أحمر لأنّ **حصّة دقائق CI منتهية** (HANDOFF §2-أ) لا لعلّة في الكود.
- **Next:** MR 4/6 — طبقة HTTP على المنفذ **8090**: 13 مساراً و17 عمليّة، و`/health` بحالتيه، و`onlyKeys()` على كل حمولة، و**`DriverRunner` مقبس المعاملة** فلا يكون معالج مسار في موضعٍ يستطيع فيه فتح معاملة.
- **Related:** [DRIVER_PERSISTENCE.md](../02-architecture/DRIVER_PERSISTENCE.md) · [DRIVER_CORE_DOMAIN.md](../02-architecture/DRIVER_CORE_DOMAIN.md) · [ADR-012](../15-decisions/ADR-012-driver-core-eligibility-derivation-and-candidacy-publication.md) · [DB_INTEGRATION_CI.md](../12-testing/DB_INTEGRATION_CI.md) · [HANDOFF §13](HANDOFF_NEXT_STEPS.md)

### [2026-08-22] Phase 05 · MR 2/6 — طبقة مجال السائق النقيّة وحاسب الأهليّة
- **Files:** `services/drivers/{package.json,tsconfig.json,vitest.config.ts,README.md}` · `services/drivers/src/domain/{model,errors,policy,eligibility,documents,vehicles,validation,events}.ts` · `services/drivers/src/{ports,mappers,index}.ts` · `services/drivers/src/infrastructure/in-memory.ts` · `services/drivers/src/use-cases/{register-driver,manage-profile,manage-vehicles,manage-documents,recompute-eligibility,read-eligibility}.ts` · `services/drivers/src/__tests__/{helpers,eligibility,state-machines,publication,contract-drift,privacy}.ts` · `docs/02-architecture/DRIVER_CORE_DOMAIN.md` · `docs/16-progress/{ROADMAP,MASTER_PROGRESS,TASK_LOG,HANDOFF_NEXT_STEPS}.md`
- **Services:** `drivers` (مجال فقط — **لا `pg` ولا `drizzle` ولا `fastify` في التبعيّات؛ غير قابلة للإقلاع بقصد**)
- **Why:** قواعد القرار هي الجزء الذي يجب أن يكون صحيحاً، وأرخص وقت للجدال فيها قبل الالتزام بجدول أو مسار — فالنتيجة 69 اختباراً تكتمل في ثانية وتختبر قاعدة مجال لا تركيباً، والمُهيّئات تُحاكي 12 قيداً **بأسمائها الحرفيّة** فتصير MR 3/6 هدف تماثل لا عملاً مفتوحاً. والقاعدة الحاكمة **لا تغيّر حالة بلا إعادة قرار**: كل كتابة تنتهي عند `recomputeEligibility` وحدها، لأنّ مُقرِّراً ثانياً يعني جوابين بعد أوّل حادثة. وثلاثة قرارات نُقضت بها الخطّة أو أُكملت: (1) **«كلّ الأسباب لا أوّلها»** بديلاً عن «السبب الأوّل يفوز» المنقولة عن المطابقة — المطابقة تُقيّم آلاف الصفوف لمُوزّع فيكفيها سبب، ونواة السائق تُجيب سائقاً واحداً عن نفسه فالجواب **قائمة عمل** لا تعليل رفض، وقائمةٌ جزئيّة تجعله يُصلح شيئاً ويُرفض مرّة أخرى؛ و`PROFILE_SUSPENDED` القاطع الوحيد لأنّ الوثائق لا ترفع إيقافاً؛ و`PROFILE_NOT_VERIFIED` سببٌ **احتياطيّ** يُبلَّغ حين لا أخصّ منه، فلا يخرج حكم `ineligible` بقائمة فارغة أبداً. (2) **`verification_status` مُشتَقّ** بكاتب واحد (`syncVerificationStatus`) على الأنواع المطلوبة وحدها، ومنفصلٌ عن `status` كي يبقى «سائق موثَّق أُوقف» مقروءاً عند استئنافه بعد أسبوع. (3) **`occurred_for` صار له تعريف مكتوب**: لحظة السريان لا لحظة الإنتاج، ولا يفترقان إلّا في `expiry_tick` — فنبضةٌ تأخّرت ستّة أشهر لا تقول إنّ الرخصة انتهت متأخّرةً ستّة أشهر. والانتهاء **تاريخٌ يُقارَن** لا حالةً تُكتب: لا حالة `expired` في آلة الوثيقة، لأنّ حالةً تحتاج كاتباً ستحسب وثيقةً سارية على سائق يوم لا يُشغّل أحدٌ شيئاً.
- **Tests:** `pnpm --filter @wasla/drivers-service test` ⇒ **69/69** في خمسة ملفات · repo-wide `pnpm -r run test` ⇒ **1966 ناجحاً** (+1 متروك بقصد) في 119 ملفاً و`pnpm -r run typecheck` نظيف. وحارسا التباعد أدّيا عملهما بإسقاط **مخالفتين فعليّتين** في العقد لا افتراضيّتين: `EligibilityView` تسمّي الحقل `eligibility_state` لا `state` وتُعلن `additionalProperties: false` فحُذف `recheck_at` من السلك (والقيمة غير مفقودة — تُنشَر `eligibility_recheck_at` على الملفّ)، وسِجلّ `events.json` مستند JSON Schema فقُرئت أنواع الأحداث من `$defs[*].properties.event_type.const` — وهي القراءة التي تُمسك **إعادة تسمية** قيمة سلكيّة، أي التغيير الذي يكسر المشتركين فعلاً.
- **Next:** MR 3/6 — استمرارية Drizzle/Postgres بوحدة عمل تجعل الصفّ والسجلّ والصادر في معاملة واحدة، ومعيار القبول أن تُنجح المستودعات **نفس** اختبارات حالات الاستخدام بلا تعديل في `src/use-cases/` (سابقة [ORDER_PERSISTENCE.md](../02-architecture/ORDER_PERSISTENCE.md)). ⚠️ خطّ أنابيب CI أحمر لأنّ **حصّة دقائق CI للـnamespace نافدة** لا لعيبٍ في العمل — التفصيل في [HANDOFF_NEXT_STEPS §2-أ](HANDOFF_NEXT_STEPS.md) و[CI_RUNNER_UNBLOCK.md](../14-runbooks/CI_RUNNER_UNBLOCK.md).
- **Related:** [MR !52](https://gitlab.com/uxxxu/wasla/-/merge_requests/52) · [MR !51](https://gitlab.com/uxxxu/wasla/-/merge_requests/51) (MR 1/6 — العقود) · [ADR-012](../15-decisions/ADR-012-driver-core-eligibility-derivation-and-candidacy-publication.md) (القرار 4 — `busy` ليست من كلمات السائق · القرار 5 — النبضة نبضةٌ لا مؤقّت) · [DRIVER_CORE_DOMAIN.md](../02-architecture/DRIVER_CORE_DOMAIN.md)

### [2026-08-22] Phase 05 · MR 1/6 — ADR-012 وعقود Driver Core الكنسية وحزمة أنواعها
- **Files:** `docs/15-decisions/ADR-012-driver-core-eligibility-derivation-and-candidacy-publication.md` · `services/drivers/contracts/{schema.sql,api.openapi.yml,events.json,errors.md,README.md}` · `packages/contracts/driver/**` (`@wasla/contracts-driver`) · `docs/03-domain/DRIVER_CORE.md` · `docs/02-architecture/CONTAINERS.md` (§4.4 + صفّ الحزم) · `docs/16-progress/{ROADMAP.md,MASTER_PROGRESS.md,HANDOFF_NEXT_STEPS.md,TASK_LOG.md}`
- **Services:** `drivers` (عقود فقط — الخدمة غير قابلة للإقلاع بعد؛ لا `src/`)
- **Why:** المرحلة تبدأ من حدّها لا من كودها (سابقة 04 و06 و07). والقرار الحاكم أنّ **الأهليّة دالّة مُشتقّة لا عمود**: عمودٌ يُكتب باليد يتخلّف عن مصادره لحظةَ انتهاء وثيقة و**لا يشرح نفسه**، فالحساب يجري مقابل **نسخة سياسة مُقفَلة** ويُخرج جوابه وسببه معاً و`unknown` fail-closed. وأهمّ دَيْن في الطور 07 يُسدَّد **بلا هجرة في الخدمة المجاورة**: النشر عبر `PUT /candidacy/{driverPublicId}` بقيمتَي `driver_core` التي انتظرها عقد المطابقة أصلاً، وكل محاولة تُسجَّل لأنّ فشل النشر الصامت يعني سائقاً مؤهَّلاً لا يراه أحد ولا يشتكي منه أحد. و`busy` ليست من كلمات السائق («الالتزام الجاري يعلو على الإعلان»)، والانتهاء بيانٌ يُقارَن بساعة مُحقونة لا حالةٌ تُكتب، واللوحة تُخزَّن ولا تُنشَر.
- **Tests:** `pnpm --filter @wasla/contracts-driver test` ⇒ **59/59** في أربعة ملفات (عقود · أحداث · مخطّط · حدود) — حرّاس انحراف تقرأ ملفات العقد من القرص وقت التشغيل: تطابق أكواد الأخطاء في الاتجاهين · كتالوج الأسباب مُطابَق حرفياً بين `errors.md` و`events.json` والحزمة · القيود الحاكمة موجودة في الـDDL · **بحث سلبي** على `eligibility_state`/`is_eligible` · حارس خصوصية ينفي اللوحة و`storage_ref` والهوية والإحداثية و`chat_id` من كل حمولة. و`pnpm -r run test` على المستودع كلّه ⇒ **1897 اختباراً ناجحاً** (+1 متروك بقصد) في 114 ملفاً على 27 مشروع عمل، و`pnpm -r typecheck` نظيف. ⚠️ **خطّ الأنابيب سيظهر أحمر لسبب لا يخصّ الكود: حصّة دقائق CI للمساحة منتهية** ([HANDOFF §2-أ](HANDOFF_NEXT_STEPS.md) · [CI_RUNNER_UNBLOCK.md](../14-runbooks/CI_RUNNER_UNBLOCK.md)) — لا تُطارَد بتعديل كود.
- **Next:** ✅ أُنجزت — MR 2/6 — طبقة مجال نقيّة `@wasla/drivers-service`: **حاسب الأهليّة أولاً** بجدولٍ صريح لكل شرط وكود عجزه، وقاعدة **«كلّ الأسباب لا أوّلها»** (نُقضت «السبب الأوّل يفوز» المنقولة عن المطابقة عند التنفيذ — انظر مدخل 2026-08-22 · MR 2/6 أعلاه)، وآلة حالة الوثيقة والمركبة، ومُهيّئات ذاكرة تُحاكي قيود `schema.sql` بأسمائها — بلا قاعدة وبلا HTTP. الخطّة الكاملة للمراجعات الستّ في [HANDOFF_NEXT_STEPS §13](HANDOFF_NEXT_STEPS.md).
- **Related:** ADR-012 · [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) (القرار 2 — مصدر الأهليّة) · [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md) (المنطقة لا الإحداثية) · [DRIVER_CORE.md](../03-domain/DRIVER_CORE.md) · Phase 05 · MR 1/6

## 2026-08-22 · Phase 07 MR 6/6 — بوابة الخروج: ستّ خدمات وساعة واحدة، وعيبٌ كان يُسقط كل قبول سائق

**Task:** تنفيذ بوابة خروج الطور 07 بصيغة قابلة للتشغيل لا موصوفة: حزمة `@wasla/dispatch-e2e` تُقلع هوية وجغرافيا ومحرّك طلبات ونواة عميل ومطابقة وتوزيع كستّة مُنصتات حقيقية على `127.0.0.1:0`، وتقود طلباً حقيقياً إلى سائق حقيقي عبر HTTP العام وحده، ثمّ وظيفة CI تُعيد الملف نفسه على Postgres، ثمّ إغلاق الطور بالدليل.
**Status:** ✅ مكتملة — **الطور 07 مُغلق**
**MR:** [!50](https://gitlab.com/uxxxu/wasla/-/merge_requests/50)
**ADR:** [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) (فصل الخدمتين واتجاه المعرفة) · [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) (حدّ الإسناد — سبب العيب أدناه)
**الوثيقة:** [PHASE07_EXIT_GATE_E2E.md](../12-testing/PHASE07_EXIT_GATE_E2E.md) (جديدة)

### 1. ما سُلِّم

- `packages/dispatch-e2e/` — `package.json` · `tsconfig.json` · `vitest.config.ts` (يُضمّن `*.e2e.test.ts` صراحةً: **الاستثناء المُعلَن الرابع** بعد `channel-e2e` و`customer-e2e` و`order-e2e`، لأنّ بوابةً يمكن تجاوزها ليست بوابة) · `src/harness.ts` (المِعْوان: ستّة مُنصتات · ساعة واحدة · تحضير مخطّطَي المطابقة والتوزيع على القاعدة عند رفعها) · `src/__tests__/phase07-exit-gate.e2e.test.ts` (**خمسة اختبارات**).
- `.gitlab-ci.yml` — وظيفة `dispatch-exit-gate-e2e` على `wasla_dispatch_e2e` عبر **`DISPATCH_DATABASE_URL`** (لا `DATABASE_URL`: الثاني مخزن طبقة القناة، ولو ضُبط هنا لصار الفشل منسوباً إلى غير سببه). صار عدد وظائف CI **15**.
- إصلاحان في `services/dispatch` — انظر §3 و§4.

**ما تُثبته البوابة:** سائق يُوجد (رفض ← موجة تستثني الرافض ← قبول ⇒ المهمّة `assigned` والطلب `accepted` مربوطاً بالسائق وإسقاط الجهوزية `busy`) · سائق يصمت (المهلة تنقضي بساعة مُحقونة، **بلا `sleep` في الملف كلّه**) · لا أحد متاح (نبضة واحدة تُنفق الموجات الثلاث وتُصعِّد والطلب لا يزال `searching`، ثمّ `no_driver_found` عند نهاية نافذة التصعيد بالضبط) · سائقان لطلب واحد (الخاسر `superseded` **لا** `rejected`) · والصحّة صادقة (`postgres`/`ok` أو `memory`/`degraded`).

**قرار مُعلَن:** كل توكيد يمرّ بـ**HTTP العام** — لا قراءة مباشرة من مخزن. بوابةٌ تقرأ القاعدة التي تفحصها قد تنجح بينما الواجهة التي يستعملها الجميع مكسورة.

### 2. لماذا ساعة واحدة لا ساعتان

`GateClock` واحد يُحقَن في المطابقة والتوزيع معاً. لو كان لكلٍّ ساعته لكان مُرشِّح «طزاجة الترشيح» (`candidacyFreshnessSeconds = 120`) يقيس **فرق ساعتين** لا مرور الوقت، فتصير نتيجة خضراء تعني أنّ الساعتين متقاربتان لا أنّ المنطق صحيح.

### 3. العيب الأول: **لا قبول سائق واحد كان ممكناً في النظام**

`POST /dispatch/offers/{id}/accept` كان يُرجع دائماً **422 `DISPATCH_ORDER_ENGINE_REJECTED`**، و**225 اختبار وحدة في التوزيع خضراء**.

- **السبب:** `accept-offer.ts` كان ينادي `transitionOrder(→accepted)` **قبل** `resolveAssignment(→accepted)`. لكنّ المحرّك يعامل `accepted` كحالة مربوطة بسائق (`assignmentRequirement === "required"`) ويقرأ السائق من **سجلّ الإسنادات** ويكتبه **في نفس عبارة `UPDATE`** التي تُحرّك الحالة — إجباراً لا اختياراً: `ck_orders_assignment_matches_status` يمنع طلباً `offered` من حمل إسناد نشط ([ADR-010 §4/§7](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md)). فحين طُلب الانتقال أوّلاً لم يكن هناك إسناد مقبول ليُقرأ، فرفض المحرّك بـ`ORDER_ASSIGNMENT_REQUIRED`.
- **لماذا لم يُكشَف:** `FakeOrderEngine` في مِعْوان التوزيع كان يُحاكي **جدول الانتقالات** ولا يُحاكي **اقتران الإسناد بالحالة**، فقَبِل ما ترفضه الخدمة الحقيقية. البديل الذي لا يعرف قاعدةً يُخفيها.
- **الإصلاح (ثلاث خطوات، في هذه الدفعة نفسها):** (أ) عكس الترتيب في `accept-offer.ts` إلى ما يفرضه عقد المحرّك · (ب) `services/dispatch/src/__tests__/harness.ts` يستورد `assignmentRequirement` من `@wasla/orders-service` ويرفض بـ`ORDER_ASSIGNMENT_REQUIRED` أيّ انتقال إلى حالة تطلب إسناداً مقبولاً بلا إسناد — **البديل عُلِّم القاعدة لئلّا يعود الاختفاء** · (ج) `accept-offer.test.ts` يُوكِّد صراحةً أنّ `resolve:accepted` **يسبق** `transition:accepted`، فصار الترتيب عقداً مُختبَراً لا تفصيلاً عابراً.
- **القياس لا الوصف:** أُعيد الترتيب القديم مؤقتاً وأُعيد تشغيل البوابة فأسقطت **اختبارين** بـ422 مقابل 200 المتوقّع، ثمّ أُرجع الإصلاح. البوابة تكشف العيب فعلاً.
- **الدَين المُعلَن مقابل الإصلاح:** نافذة انعكاس — لو سُجّل الإسناد `accepted` ثمّ فشل تحريك الحالة، يبقى سجلّ إسناد مقبول بلا حالة تطابقه؛ العرض يبقى `offered` والنبضة تظلّ مالكة المهمّة **فلا يضيع الطلب**. البديل (الترتيب المعاكس) لا يعمل أصلاً. مُدوَّن في [MATCHING_DISPATCH §9](../03-domain/MATCHING_DISPATCH.md) ووثيقة البوابة §8.

### 4. العيب الثاني: خطأ أنواع كان مخفياً عن `pnpm -r test`

`services/dispatch/src/__tests__/tick.test.ts:477` كان يبني `CandidateRequest` بلا `orderId`/`orderPublicId` بعد إضافتهما إلى العقد في MR 5b/6. `vitest` لا يفحص الأنواع، فبقي الخطأ يمرّ في المسح كاملاً ويظهر في `pnpm -r typecheck` وحده. أُصلح مع تعليق يشرح **لماذا** المُعرّفان جزء من العقد: المطابقة تَسِم كل قرار تُسجّله بالطلب الذي قرّرت فيه، وطلبٌ بلا مُعرّفين لا يمكن تدقيقه لاحقاً.

### 5. ثلاثة فروق بين ما تصوّرته البوابة وما فعله النظام — صُحّح التوقّع لا الكود

1. **`POST /dispatch/tick` لا يقبل جسماً.** مساعد النداء كان يُرسل `content-type: application/json` دائماً، وFastify يرفض جسم JSON فارغاً معلَناً بـ400 قبل أي مسار. صار الترويسة تُرسَل **مع الجسم فقط**: مساعدٌ يُفشل البوابة لأجل راحته ليس مساعداً.
2. **`offer_sent` يُنشَر قبل `wave_opened`.** لأنّ حدث الموجة يحمل `offer_count`، فلا يصدق قبل أن توجد عروضها. مُوثَّق في البوابة كسلوك مقصود لا كترتيب عارض.
3. **قبولٌ على عرضٍ مُنتهٍ يُرفض 409 `DISPATCH_OFFER_ALREADY_RESOLVED`** لا 422. رمز الحالة نفسه عقد، فوُكِّد كما هو.

### 6. الاختبار والتحقق

| التشغيل | النتيجة |
| --- | --- |
| `pnpm --filter @wasla/dispatch-e2e test` | **5/5** — ‎~1.5s |
| `pnpm --filter @wasla/dispatch-service test` | **225/225** (19 ملفاً) |
| `pnpm -r run test` | **1838 ناجحاً + 1 متجاوَز** في 110 ملفات |
| `pnpm -r run typecheck` | **نظيف** (بعد إصلاح §4) |
| `dispatch-exit-gate-e2e` (Postgres 15) | نفس الملف على `wasla_dispatch_e2e` |

**حدود التشغيل المحلّي، مُعلَنة:** لا Postgres ولا Docker في بيئة هذه الدفعة، فمسار القاعدة **لم يُشغَّل محلياً** وإثباته على وظيفة CI في هذه الـMR. من يراجع: النتيجة الخضراء المطلوبة هي وظيفة `dispatch-exit-gate-e2e` لا التشغيل المحلّي.

- **Files:** `packages/dispatch-e2e/**` (جديد) · `services/dispatch/src/use-cases/accept-offer.ts` · `services/dispatch/src/__tests__/{harness,accept-offer.test,tick.test}.ts` · `.gitlab-ci.yml` · `pnpm-lock.yaml` · `docs/12-testing/PHASE07_EXIT_GATE_E2E.md` (جديد) · `docs/03-domain/MATCHING_DISPATCH.md` · `docs/16-progress/{ROADMAP,MASTER_PROGRESS,TASK_LOG,HANDOFF_NEXT_STEPS}.md`
- **Services:** `dispatch` (إصلاح ترتيب القبول) · والبوابة تُقلع `identity`/`geography`/`orders`/`customers`/`matching`/`dispatch` بلا تعديل فيها
- **Why:** بوابة الخروج هي الشرط الوحيد لإغلاق الطور 07، و«مُنجَز» بلا دليل ممنوع في [DEFINITION_OF_DONE](../00-rules/DEFINITION_OF_DONE.md). والبوابة أدّت وظيفتها: أظهرت عيباً كان يُعطّل كل قبول سائق في الإنتاج بعد أن مرّ من 225 اختبار وحدة.
- **Tests:** الجدول في §6 أعلاه
- **Next:** **Phase 05 (Driver Core)** — تحويل الأهليّة من `claimed` إلى `driver_core` وإلباس البوابة واجهةً؛ أو **Phase 08 (Negotiation & Chat)** لأنّ اعتمادها الوحيد 07 وقد أُغلقت. معايير الاختيار في [HANDOFF_NEXT_STEPS.md](HANDOFF_NEXT_STEPS.md)
- **Related:** MR [!50](https://gitlab.com/uxxxu/wasla/-/merge_requests/50) · [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) · [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md)

---

## 2026-08-22 · Phase 07 MR 5b/6 — طبقة HTTP للخدمتين: النبضة تُنادى من الخارج والمعاملة تُفتح بعد الشبكة لا حولها

**Task:** إقلاع خدمة المطابقة على المنفذ **8088** وخدمة التوزيع على **8089** بالعقود المنشورة، واستبدال المُهيّئات المحلّية بمحوّلات HTTP إنتاجية (محرّك الطلبات · المطابقة · الجغرافيا)، وسدّ دَين «نداءات الشبكة داخل المعاملة» الذي أعلنته MR 5a/6 (§7.2) — **بلا بوابة خروج E2E** (وهي MR 6/6).
**Status:** ✅ مكتملة
**MR:** [!49](https://gitlab.com/uxxxu/wasla/-/merge_requests/49)
**ADR:** [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) (تنفيذ) · [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) (حدّ الإسناد) · [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md) (العقد مصدر الحقيقة)
**الوثيقة:** [MATCHING_HTTP.md](../04-api/MATCHING_HTTP.md) و[DISPATCH_HTTP.md](../04-api/DISPATCH_HTTP.md) (جديدتان)

### 1. ما سُلِّم

**المطابقة (8088):** `src/runner.ts` (60) — مقبس المعاملة `MatchingRunner {write, read}` · `src/http/{requests,errors,app,server}.ts` (185 · 54 · 147 · 90) بسبعة مسارات · `src/infrastructure/http-geography.ts` (96) — `HttpZoneHierarchy`. وستّة ملفات اختبار (`http-candidates` · `http-candidacy` · `http-health` · `http-errors` · `http-geography` + مُسخّر `http-support.ts`).

**التوزيع (8089):** `src/runner.ts` (39) · `src/run-tick.ts` (68) · `src/http/{requests,errors,app,server}.ts` (70 · 38 · 143 · 112) بثمانية مسارات · `src/infrastructure/http-matching.ts` (125) · `src/infrastructure/http-order-engine.ts` (143). وثمانية ملفات اختبار (`http-errors` · `http-health` · `http-jobs` · `http-matching` · `http-offers` · `http-order-engine` · `http-tick` · `run-tick`).

المنفذان صارا **ثابتين مُصدَّرين من حزم العقود** لا رقمين مكتوبين في ملفَي خادم: `MATCHING_SERVICE_PORT = 8088` في `@wasla/contracts-matching` و`DISPATCH_SERVICE_PORT = 8089` في `@wasla/contracts-dispatch`. رقمٌ يُكتب في موضعين ينحرف في أحدهما، والمنادي هو من يدفع الثمن.

`createMatchingApp` و`createDispatchApp` يستقبلان **Runner لا تبعيات**؛ فلا يملك معالج مسارٍ القدرة على فتح معاملة أصلاً. هذا ليس أسلوباً بل منعٌ بالنوع.

### 2. الدَين الذي جاءت هذه الدفعة لتسدّه: النبضة

MR 5a/6 §7.2 أعلنت أنّ نداء المنافذ داخل المعاملة «مقبولٌ الآن وغير مقبول بعد MR 5b/6». والسبب صار ملموساً هنا: نبضة واحدة تُنادي محرّك الطلبات لكل إسناد وخدمة المطابقة لجمع المرشّحين — كلّها الآن **نداءات HTTP**. لو بقيت داخل معاملة واحدة، فمطابقةٌ بطيئة تحتجز اتصال Postgres طوال انتظارها، ومهلةٌ منقضية في منتصف الموجة تُراجِع عملاً صحيحاً ارتكز قبلها.

الحلّ في `src/run-tick.ts`: **قراءة واحدة** قبل أي معاملة تجمع المهام النشطة و`tickAt`، ثمّ **معاملة واحدة لكل مهمة** بساعةٍ مُجمّدة على `tickAt` نفسها (فلا تختلف قراءتان في النبضة الواحدة على «الآن»). و`scopeToJob()` تبني **كائناً حرفياً مُفوِّضاً صريحاً** يقصر التبعيات على مهمّة واحدة — ولم تُنسخ بـspread على نسخة صنف، لأنّ نشر نسخة صنفٍ يفقد سلسلة النموذج الأولي فتصير التبعيات كائناً يشبه التبعيات ولا يعمل عملها.

`use-cases/tick.ts` **لم يتغيّر منطقه**. تغيّر من يفتح المعاملة ومتى، لا ما يجري داخلها.

**والدَين لم يُمحَ بل قُلِّص وقيسَ:** عمر المعاملة الواحدة صار ≈ (2 + `waveSize`) × مهلة العميل، وهذا حدٌّ أعلى معروف لا مفتوح. المتبقّي مُخفَّف بمهلٍ صارمة عبر `AbortController` في المحوّلين، لا مُزال. البديل الكامل (saga أو تجميع كل النداءات قبل فتح أي معاملة) يعني نقل قرار «من يستحق العرض» خارج حماية الصفّ المقفول، وهو تغييرٌ معماري يحتاج ADR لا دفعةً.

### 3. ثلاثة أخطاء حقيقية كشفها الحدّ الشبكي

**(أ) Node يدمج الترويسة المكرّرة بفاصلة، فحارس المصفوفة كان حارساً في الورق.** كان الفحص `Array.isArray(raw)`؛ وNode لا يعطي مصفوفة للترويسات المكرّرة (إلّا `set-cookie`) بل **نصاً واحداً مفصولاً بفاصلة**. فمُنادٍ يرسل `Idempotency-Key` مرّتين كان يصل بقيمة `"a, b"` — مفتاحٌ لم يرسله أحد، ويُقبل. أُضيف فحص الفاصلة في المطابقة والتوزيع كلتيهما، والرفض `400` بلا صدى للقيمة.

> **الفجوة نفسها باقية في `services/orders/src/http/requests.ts:95-107`** ولم تُصلَح هنا بقصد (انضباط النطاق: محرّك الطلبات ليس في هذه الدفعة). مُعلَنة كدَين في [ORDER_HTTP §الانحرافات](../04-api/ORDER_HTTP.md) و§10 من [MATCHING_HTTP](../04-api/MATCHING_HTTP.md)، وهي عملٌ مستقلّ صغير لا يجوز أن يُنسى.

**(ب) `CandidateRequest` كان بلا مرجع للطلب.** طلبُ مرشّحين لا يقول لأيّ طلبٍ هو: المُهيّئ المحلّي لم يكن يحتاج ذلك، والعقد الشبكي يحتاجه. أُضيف `orderId` و`orderPublicId` و`dispatchJobId?` إلى `ports.ts`، و`openWave` في `use-cases/tick.ts` يملؤها. والمحوّل **لا يرسل `evaluated_at`** — وقت التقييم تملكه المطابقة، ومُنادٍ يُملي على خدمةٍ متى قيّمت يُتيح تسميم سجلّ التدقيق.

**(ج) استجابةٌ 2xx بجسم فاسد كانت تُحسَب نجاحاً.** في `http-order-engine.ts` صار المسار: `jsonObjectFrom` تعيد `null` لجسم لا يُفكّ أو ليس كائناً ⇒ النتيجة `unavailable` لا نجاح. وأُحكِمت خريطة الحالات: `200` ⇒ `already_applied` · `201` ⇒ `applied` · `409`/`422` ⇒ `rejected` · ما عداها ⇒ `unavailable` · `AbortError` ⇒ `timeout`. ومعرّفات المسار غير الـUUID تُرفض `400` قبل أي نداء (`toPathId` بتعبير UUID)، بدل أن تُسلَّم إلى Postgres ليردّها `22P02`.

### 4. رفض المفتاح غير المُعلَن في العقد

مخططات `api.openapi.yml` تعلن `additionalProperties: false`، ومحوّلات المطابقة كانت **تنتقي الحقول المعروفة وتتجاهل الزائد بصمت**. الأثر ليس شكلياً: مُنادٍ كتب `pickup_zone` بدل `pickup_zone_id` كان يتلقّى خطأ «حقل مفقود» غامضاً لا يشير إلى خطئه، ومُنادٍ يرسل حقلاً أُزيل من العقد كان يظنّ أنّه ما زال يعمل. أُضيفت `onlyKeys()` إلى `services/matching/src/http/requests.ts` بقوائم مُقارَنة حرفياً بالعقد على الحمولات الثلاث، مع أربعة اختبارات على مستوى HTTP منها اختبارٌ يتحقّق أنّ **قيمة** المفتاح المرفوض لا تظهر في الرد. التوزيع كان يفعل ذلك أصلاً، فصارت الخدمتان على قاعدة واحدة.

### 5. تغطية التوزيع: 13 اختباراً رُفضت، و65 كشفت خطأين

المحاولة الأولى للحدّ الشبكي للتوزيع جاءت بـ13 حالة — تكفي لتقول «المسارات موجودة» ولا تقول شيئاً عن الحدود. رُفضت وطُلب ≥55؛ وسُلّمت 65، وهي التي كشفت الخطأين (ب) و(ج) في §3 أعلاه. الرقم ليس هدفاً بذاته: القيمة أنّ التغطية التي تفحص كل فرعٍ في خريطة الحالات هي التي تُخرج الأخطاء، والتي تفحص «المسار يرد 200» لا تُخرج شيئاً.

### 6. لماذا لا وظيفة CI جديدة

`build-test` في `.gitlab-ci.yml` (على `node:20-alpine` مع corepack pnpm@9) تُشغّل `pnpm install --frozen-lockfile` ثمّ `pnpm -r run typecheck` ثمّ `pnpm -r run test` — والاختبارات الجديدة كلّها تبني التطبيق بـ`app.inject` بلا منفذ ولا قاعدة، فتُغطّى تلقائياً. و`matching-db-integration` و`dispatch-db-integration` موجودتان من MR 3/6 و5a/6. **وظيفة الخدمات المُقلِعة تنتمي إلى MR 6/6** حيث تُشغَّل خمس خدمات فعلاً؛ إضافتها الآن تعني وظيفةً لا شيء لها لتشغّله.

### 7. ما لم يُنجَز بقصد

1. **لا بوابة خروج E2E** — `packages/dispatch-e2e` والمسار الكامل عبر خمس خدمات مُقلِعة في MR 6/6، ومعها `docs/12-testing/PHASE07_EXIT_GATE_E2E.md`.
2. **فجوة الفاصلة في `services/orders`** — §3(أ) أعلاه؛ عملٌ مستقلّ.
3. **لا مُرحِّل لصندوق الصادر** — `markPublished` موجودة ولا أحد يناديها (المرحلة 09).
4. **لا نادٍ دوريّ للنبضة** — `POST /dispatch/tick` ينتظر مُنادياً خارجياً؛ ولا `setTimeout` ولا حلقة خلفية في الخدمة بقصد (المرحلة 09).
5. **دَين MR 4/6 السلوكي باقٍ كما أُعلن** — العروض المنتهية تُقرَأ `offered` حتى النبضة التالية، والتأجيل وسط الموجة قد يعطي موجةً أصغر من `waveSize`.

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** صارت الخدمتان قابلتين للإقلاع والنداء: سبعة مسارات على 8088 وثمانية على 8089 بالعقود المنشورة، ومعها `MatchingRunner`/`DispatchRunner` كحدٍّ وحيد للمعاملة، وثلاثة محوّلات HTTP إنتاجية (`HttpZoneHierarchy` · `HttpMatchingPort` · `HttpOrderEnginePort`)، و`run-tick.ts` يعيد ترتيب حدود المعاملة في النبضة. والمنفذان صارا ثابتين مُصدَّرين من حزمتي العقود. وسُدّ دَين نداء الشبكة داخل المعاملة (تقليصاً مقيساً لا محواً).
2. **لماذا؟** لأنّ MR 5a/6 سلّمت خدمةً تحفظ حالتها ولا يستطيع أحدٌ مخاطبتها: مجالٌ صحيح واستمراريةٌ ذرّية بلا سطحٍ شبكي = كودٌ لا يعمل في أي بيئة. ولأنّ الدَين المُعلَن في 5a/6 §7.2 كان مشروطاً بوصول HTTP، ووصل.
3. **أين؟** `services/matching/src/{runner.ts, http/{requests,errors,app,server}.ts, infrastructure/http-geography.ts}` (جديدة) · `services/matching/src/__tests__/http-{candidates,candidacy,health,errors,geography}.test.ts` + `http-support.ts` (جديدة) · `services/dispatch/src/{runner.ts, run-tick.ts, http/{requests,errors,app,server}.ts, infrastructure/{http-matching,http-order-engine}.ts}` (جديدة) · `services/dispatch/src/__tests__/http-{errors,health,jobs,matching,offers,order-engine,tick}.test.ts` + `run-tick.test.ts` (جديدة) · `services/dispatch/src/{ports.ts, use-cases/tick.ts}` (مرجع الطلب في `CandidateRequest`) · `packages/contracts/matching/src/index.ts` و`packages/contracts/dispatch/src/index.ts` (ثابتا المنفذ) · `services/{matching,dispatch}/package.json` + `pnpm-lock.yaml` (fastify · tsx) · `docs/04-api/{MATCHING_HTTP,DISPATCH_HTTP}.md` (جديدتان) · `docs/04-api/ORDER_HTTP.md` · `docs/02-architecture/{DISPATCH_PERSISTENCE,MATCHING_PERSISTENCE,CONTAINERS}.md` · `docs/16-progress/{MASTER_PROGRESS,HANDOFF_NEXT_STEPS,TASK_LOG}.md`.
4. **كيف تم اختباره؟** `pnpm -r typecheck` ✅ نظيف · `pnpm -r test` ✅ **1833 اختباراً ناجحاً + 1 متخطّى** (كان 1829 + 1) — المطابقة **160** (كانت 136، أي +24) والتوزيع **225** (كان 160، أي +65). كل اختبارات الحدّ الشبكي تعمل بـ`app.inject` بلا منفذ مفتوح ولا قاعدة، ومحوّلات HTTP تُختبر بـ`fetch` محقون. `scripts/checks/scan-secrets.sh` ✅.
5. **ما الخطوة التالية؟** MR 6/6 — بوابة خروج Phase 07: `packages/dispatch-e2e` تُقلع خمس خدمات وتمشي المسار الكامل في [MATCHING_DISPATCH §8](../03-domain/MATCHING_DISPATCH.md)، ووظيفة CI لها، و`docs/12-testing/PHASE07_EXIT_GATE_E2E.md`، ثمّ إغلاق الطور.
6. **هل موثّق؟** نعم — [MATCHING_HTTP.md](../04-api/MATCHING_HTTP.md) و[DISPATCH_HTTP.md](../04-api/DISPATCH_HTTP.md) (جديدتان، كلٌّ بقسم انحرافات مُعلَنة وقسم أدلّة) + [DISPATCH_PERSISTENCE §7.1](../02-architecture/DISPATCH_PERSISTENCE.md) (الدَين مشطوبٌ مع مقياس قبل/بعد وبديلين مرفوضين) + [MATCHING_PERSISTENCE §7](../02-architecture/MATCHING_PERSISTENCE.md) + [CONTAINERS §4.3](../02-architecture/CONTAINERS.md) + [ORDER_HTTP](../04-api/ORDER_HTTP.md) (صفّ دَين الفاصلة) + هذا الإدخال + [HANDOFF §11](HANDOFF_NEXT_STEPS.md) + [MASTER_PROGRESS](MASTER_PROGRESS.md).
7. **هل مراجَع؟** مراجعة ذاتية + [MR !49](https://gitlab.com/uxxxu/wasla/-/merge_requests/49) بقالب المراجعة كاملاً. وأثرُ المراجعة الأهمّ مسجَّل في §5: دفعةٌ بـ13 اختباراً رُفضت وأُعيدت بـ65، فكشفت خطأين.
8. **هل ADR مطلوب؟** لا. القرارات المعمارية كلّها منصوصة سابقاً في ADR-010 وADR-011 (فصل المطابقة عن التوزيع · النبضة مُقدِّم الزمن الوحيد · محرّك الطلبات لا يعرف التوزيع · لا `rules` في جسم إنشاء المهمّة)، وهذه الدفعة تُنفّذها ولا تُعدّلها. **البديل الكامل لدَين المعاملة (saga) يحتاج ADR** — ولذلك لم يُنفَّذ هنا.
9. **هل يكسر توافقاً خلفياً؟** لا مستهلك خارجياً قبل هذه الدفعة (لم يكن هناك HTTP لتكسره). داخلياً: `CandidateRequest` صار يطلب `orderId` و`orderPublicId` — كاسرٌ لمنفذٍ لا يُنفّذه إلّا مُهيّئان كلاهما في المستودع، ويكشفه `tsc` لا التشغيل. والعقود المنشورة لم تُغيَّر إلّا بإضافة ثابتَي المنفذ.
10. **هل migration؟** لا ترحيل قاعدة بيانات. تغييرات نشر: `fastify ^5.12.1` و`tsx ^4.23.12` أُضيفتا للخدمتين و`pnpm-lock.yaml` تغيّر — وCI يستعمل `--frozen-lockfile`، ففرعٌ بلا قفل محدَّث يفشل عند التثبيت. وتهيئة: `DATABASE_URL` (وإلّا ذاكرة مُعلَنة) · `GEOGRAPHY_BASE_URL` (افتراضي `http://localhost:8081`) · عنوانا المطابقة ومحرّك الطلبات للتوزيع · المنفذان من ثابتي العقود.
11. **هل توجد مخاطر؟** أربع مُعلَنة: (أ) **بقيّة دَين المعاملة** — عمرها الأعلى ≈ (2 + `waveSize`) × مهلة العميل، مُخفَّف بمهلٍ صارمة لا مُزال (§2). (ب) **`onlyKeys` بقوائم مكتوبة بيد** لا مُولَّدة من المخطط؛ الاتساق محميّ باختبارات حارس انحراف حزم العقود ومراجعةٍ بشرية، والتوليد مقترحٌ في §10 من [MATCHING_HTTP](../04-api/MATCHING_HTTP.md). (ج) **فجوة الفاصلة في `services/orders`** باقية ومُعلَنة — من ينساها يترك ثغرة قبولٍ لمفتاح عدم تكرار مدموج في خدمةٍ تعمل. (د) **لا مُنادي للنبضة بعد**، فالخدمة لا تُقدّم الزمن بنفسها؛ نشرٌ بلا مُنادٍ = مهامٌ لا تُخدَم أبداً وهي حالة صامتة لا تُنبّه.
12. **هل security؟** فحص الأسرار نظيف، ولا سرّ في كود أو ملف. حدّ الخصوصية محفوظ: لا `chat_id` ولا إحداثية ولا معرّف مرشّح ولا درجة في أي **حمولة حدث**، ورسائل الخطأ لا تردّ صدى القيمة المرفوضة (اختبارٌ صريح لهذا في §4). معرّفات المرشّحين و`score_bp` **موجودة بحقّ** في استجابة `CandidateResult` لأنّ المخطط المنشور يعرّفها والتوزيع يحتاجها ليبني العروض — وهذا انحرافٌ مُعلَن لا سهو، مشروحٌ في [MATCHING_HTTP §8](../04-api/MATCHING_HTTP.md). `x-request-id` مقصورٌ على 128 محرفاً قبل أن يصل أيّ سجلّ. وسطح شبكي جديد: منفذان داخليان بلا مصادقة في هذا الطور — والملكية تُردّ `404` لا `403` فلا يُستدلّ على وجود كيان.
13. **هل performance؟** `HttpZoneHierarchy` يحلّ المعرّفات الفريدة **بالتوازي** بمهلة 2000ms لكل طلب وبلا حلقة إعادة محاولة (إعادة المحاولة داخل معاملة تضاعف عمرها). القراءات لا تفتح معاملة أصلاً. والنبضة صارت قراءةً واحدة ثمّ معاملةً لكل مهمّة بدل معاملة واحدة تغطّي كل النداءات (§2). ولا فهرس أُضيف ولا استعلام تغيّر.
14. **هل monitoring؟** `/health` صار قائماً على الخدمتين: `ok` فقط مع `persistence: "postgres"` — والمطابقة تشترط زيادةً نسخة قواعد نشطة **مجمّدة**، والتوزيع يعلن `last_tick_at` (يبدأ `null` ولا يتحدّث إلّا بعد نبضة ناجحة، فهو المؤشّر الذي يكشف الخطر (د) في السؤال 11). و`x-request-id` يصير `trace_id` في كل حدث وكل رد خطأ. والمُرحِّل والمقاييس المُصدَّرة تبقى للمرحلة 09.

**Related:** [MR !49](https://gitlab.com/uxxxu/wasla/-/merge_requests/49) · MR 5a/6 ([!48](https://gitlab.com/uxxxu/wasla/-/merge_requests/48)) · MR 4/6 ([!47](https://gitlab.com/uxxxu/wasla/-/merge_requests/47)) · [MATCHING_HTTP.md](../04-api/MATCHING_HTTP.md) · [DISPATCH_HTTP.md](../04-api/DISPATCH_HTTP.md) · [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md)

---

## 2026-08-22 · Phase 07 MR 5a/6 — استمرارية التوزيع: النبضة كلّها ترتكز أو تتراجع، وموجةٌ مفتوحة فارغة تعطّل المهمة إلى الأبد

**Task:** وضع Postgres وراء منافذ التوزيع نفسها بوحدة عمل واحدة، وإثبات أنّ إضافة القاعدة لم تُغيّر سلوكاً — **بلا HTTP وبلا عميل مطابقة حقيقي** (كلاهما MR 5b/6).
**Status:** ✅ مكتملة ومدموجة
**MR:** [!48](https://gitlab.com/uxxxu/wasla/-/merge_requests/48)
**ADR:** [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) (تنفيذ) · [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md) (العقد مصدر الحقيقة)
**الوثيقة:** [DISPATCH_PERSISTENCE.md](../02-architecture/DISPATCH_PERSISTENCE.md) (جديدة)

### 1. تقسيم مُعلَن: MR 5/6 صارت 5a/6 و5b/6

الخطة الملزمة في [HANDOFF §11](HANDOFF_NEXT_STEPS.md) كانت تضع في MR 5/6 **الاستمرارية وطبقة HTTP والمحوّلات الإنتاجية معاً**: مرآة Drizzle + وحدة عمل + منفذ 8089 بثمانية مسارات + منفذ 8088 للمطابقة (التي لا `src/http` فيها بعد) + `HttpOrderEnginePort` + عميل HTTP للمطابقة + محوّل الجغرافيا. هذا ليس دفعةً واحدة قابلة للمراجعة، والأخطر أنّه يخلط سؤالين مختلفين: «هل الحالة تعيش؟» و«هل العقد الشبكي مُطبَّق؟». دفعةٌ تفشل فيها لا يُعرَف أيّ السؤالين فشل.

فُصلت إلى:
- **MR 5a/6 (هذه):** استمرارية Postgres + وظيفة CI `dispatch-db-integration`.
- **MR 5b/6:** طبقة HTTP 8089 و8088 + المحوّلات الإنتاجية (محرّك الطلبات · المطابقة · الجغرافيا).

التقسيم مسجَّل في [ROADMAP](ROADMAP.md) و[MASTER_PROGRESS](MASTER_PROGRESS.md) و[HANDOFF §11](HANDOFF_NEXT_STEPS.md) وأُبلِغ به المالك، فلا يقرأ أحدٌ لاحقاً «MR 5/6 مدموجة» ويظنّ أنّ HTTP جاهز.

### 2. ما سُلِّم

أربعة ملفات بنية تحتية (1247 سطراً): `drizzle/schema.ts` (280 — مرآة الجداول الخمسة) · `drizzle/db.ts` (55 — تجمّع `pg` + النوع `DbOrTx`) · `drizzle/repository.ts` (~775 — خمسة مُهيّئات) · `drizzle/transaction.ts` (137 — `PostgresDispatchUnitOfWork` + `bindDispatchAdapters`). وأربعة ملفات اختبار + مُسخّر: `pg-harness.ts` (152) · `schema-drift.test.ts` (187 — **18 فحصاً، بلا قاعدة**) · `repository.integration.test.ts` (29) · `port-conformance.integration.test.ts` (12) · `atomicity.integration.test.ts` (6).

المُهيّئات كلّها تقبل `DbOrTx` و**لا تفتح معاملة بنفسها**؛ حدود المعاملة تملكها وحدة العمل وحدها. `run()` تفتح معاملة و`read()` لا تفتح — فـGET لا يحتجز اتصالاً مقابل ضمان اتساقٍ لا تستطيع استجابة JSON واحدة أن تُظهره.

### 3. الفشل الذي تمنعه هذه الدفعة، بالتحديد

النبضة الواحدة تكتب صفَّ موجة، ثمّ صفَّ عرضٍ لكل مرشّح، ثمّ حالة المهمّة، ثمّ حدثاً لكل ذلك. لو ارتكز صفُّ الموجة ولم ترتكز العروض، صار للمهمة موجة `open` **لا شيء فيها يُحلّها**، والفهرس الجزئي `ux_dispatch_waves_one_open_job` يرفض بعدها كل موجة تالية لتلك المهمة إلى الأبد: العميل ينتظر بلا نهاية، وإعادة المحاولة لا تُصلح شيئاً، ولا يُصلحه إلّا إنسان يحذف صفّاً بيده. وهذا أسوأ من الخطأ الأصلي.

`atomicity.integration.test.ts` يُثبت المنع بطريقةٍ واحدة: **يكسر الخطوة الأخيرة ويتحقّق أنّ الأولى غابت.** صندوق الصادر مُلَفٌّ بمُزخرِف يرفع استثناءً على الإلحاق المُختار — بعد أن كُتبت الموجة وعرضاها فعلاً — ثمّ يُتحقَّق أنّ الموجة والعروض والأحداث غائبة، وأنّ الحالة عادت `pending`، وأنّ **إعادة المحاولة تنجح** وتفتح الموجة رقم 1. والاختبارات الستّة ليست تكراراً: حالة ضابطة (بلاها ينجح اختبار التراجع تلقائياً على محوّلٍ لا يكتب شيئاً) · فشلٌ على الإلحاق الأخير · فشلٌ على الإلحاق **الأول** (يُثبت أنّ المعاملة تغطّي أول جملة؛ محوّلٌ يرتكز مبكّراً ثمّ ينضم للمعاملة ينجح في الأوّل ويفشل هنا) · غيابُ الموجة المفتوحة · مفتاح عدم التكرار لا ينجو من التراجع (مفتاحٌ باقٍ بلا مهمة يجعل إعادة المحاولة تُجاب كتكرارٍ لمهمة غير موجودة: 200 يشير إلى لا شيء) · ومسار القراءة يقرأ المُرتكِز بلا معاملة.

### 4. فجوتان في العقد اكتُشفتا بالتنفيذ

**(أ) `dispatch_idempotency` — منفذٌ بلا مخزن.** منفذ `IdempotencyStore` مُستخدَم في `create-job.ts` ولا جدول له. `dispatch_jobs.created_idempotency_key` يحمي **إنشاء المهمة** وحده، وكل كتابة أخرى تصل بمفتاح `Idempotency-Key` (وهو إلزامي على كل كتابة في `api.openapi.yml`) لم يكن لها مكان تُتذكَّر فيه. أُضيف الجدول كـ§5 في `schema.sql` (ترحيل إضافي عكوس + سطر تراجع)، وأُعيد ترقيم قسم مُشغّل `updated_at` من 5 إلى 6. نفس الفجوة بحرفها وُجدت في المطابقة (MR 3/6) — وهي إذن **نمط لا حادثة**: منفذ عدم التكرار يُنسى في العقد لأنّه لا يظهر في أي مسار OpenAPI بجسمٍ خاص.

**(ب) `dispatch_waves.expires_at` — الانحراف المقصود عن معيار «لا سطر في use-cases».** العمود `NOT NULL` في العقد، ولم يكن للموجة في المجال حقلٌ يقابله؛ ومُهيّئ الذاكرة كان يقبل ذلك بصمت. البدائل الثلاثة وواحدها الصحيح: حسابُ القيمة داخل المُهيّئ يعني أن يعرف محوّل التخزين قاعدة عمل، فتصير للموجة مهلتان تُصانان في موضعين · وجعلُ العمود يقبل `NULL` يعدّل العقد ليخفي فجوة المجال ويُفرِغ الفهرس الجزئي `ix_dispatch_waves_open_due` من معناه · وإضافةُ الحقل إلى المجال هي ما فُعل. أُضيف `expiresAt` إلى `DispatchWave` و`InsertWaveInput` و`InMemoryWaveRepository.insert`، و**تغيّرت ثلاثة أسطر في `src/use-cases/tick.ts`** لتمرير قيمةٍ كانت تُحسَب أصلاً في نفس الدالة لكل عرض ولا تُكتَب للموجة. الانحراف مُعلَن هنا وفي [DISPATCH_PERSISTENCE §2.2](../02-architecture/DISPATCH_PERSISTENCE.md)، والفرق الجوهري أنّ المعيار وُضع ليمنع المخطّطَ من تشكيل المجال، وما حدث عكسه: المخطّط كشف حقلاً يحتاجه حدثُ `dispatch.wave_opened` نفسه (يحمل `expires_at` في `events.json`) وكان يحصل عليه بحسابٍ موازٍ. وأنّ السلوك لم يتغيّر يُثبته `port-conformance`: الأثران متطابقان.

**(ج) أربعة أسماء قيود في تعليقات `in-memory.ts` لا وجود لها في الـDDL** — صُحّحت، وأُضيف حارسٌ ثالث في `schema-drift.test.ts` يُفشِل البناء على أيّ اسم قيد (`ck_*` · `ux_*` · `ix_*` · `trg_dispatch_*`) يذكره تعليقٌ في `in-memory.ts` أو `repository.ts` ولا يوجد في العقد. التعليق الذي يكذب أسوأ من غيابه، لأنّ من يقرأه يبني عليه.

### 5. الاستثناء الوحيد في المقارنة، وخطأٌ كشفته القاعدة الحقيقية

`EXCLUDED_KEYS` في `port-conformance.integration.test.ts` تحوي **مفتاحاً واحداً**: `updatedAt` — يملكه المُشغّل `trg_dispatch_*_updated_at` فيكتب `now()` فوق `changedAt` المُمرَّر من الساعة المحقونة. لذلك مُعامل `_changedAt` في `PostgresJobRepository.updateStatus` **لا يُكتَب بقصد** (البادئة `_` تقول ذلك، و[DISPATCH_PERSISTENCE §4](../02-architecture/DISPATCH_PERSISTENCE.md) يقول لماذا، و`schema.sql` §6 يشير إلى القسم صراحةً). كل حقل آخر يُقارَن حرفياً؛ مفتاحٌ ثانٍ في هذه المجموعة يعني سلوكاً اختلف لا تفصيلاً تشغيلياً.

وخطأٌ حقيقي كشفه هذا الملف: `FakeOrderEngine` كان يولّد معرّفات إسناد بصيغة `assignment-N`، و`dispatch_offers.order_assignment_id` نوعه **UUID**؛ Postgres يرفضها بـ`22P02` والذاكرة تقبلها بصمت. المُهيّئ الوهمي الآن يولّد UUID صحيح الشكل — خطأٌ لا في القاعدة ولا في المجال، بل في مُهيّئ اختبارٍ كان يُجيز شكلاً لا يُجيزه العقد.

### 6. وظيفة CI

`dispatch-db-integration` في `.gitlab-ci.yml` (تمتدّ من `.db-integration-base`) تُشغّل `pnpm --filter @wasla/dispatch-service test:integration` أمام `postgres:15` على قاعدة مستقلّة `wasla_dispatch_test`، فيبقى الفشل منسوباً لخدمة واحدة. حارس الانحراف يبقى في `build-test` بلا قاعدة لأنّه يقرأ `schema.sql` من القرص. وأُضيفت إلى [DB_INTEGRATION_CI.md](../12-testing/DB_INTEGRATION_CI.md) صفوفُ التوزيع والمطابقة والطلبات — الأخيرتان كانتا **ناقصتين من جدول الوثيقة** وإن كانت الوظيفتان موجودتين في CI فعلاً.

### 7. ما لم يُنجَز بقصد

1. **لا طبقة HTTP** — المنفذ 8089 وثمانية مسارات في MR 5b/6.
2. **منافذ الشبكة تُنادى داخل المعاملة** — مقبولٌ الآن لأنّ المُهيّئات محلّية، **وغير مقبول** بعد MR 5b/6 حين تصبح نداءات HTTP: نداءٌ بطيء يحتجز اتصالاً ويطيل المعاملة، ومهلةٌ منقضية تُراجِع عملاً صحيحاً. القرار (تجميع النداءات قبل فتح المعاملة أو saga) يُحسَم في MR 5b/6 لأنّه يحتاج المُهيّئ الحقيقي أمامه ليُقاس.
3. **لا مُرحِّل لصندوق الصادر** — `markPublished` موجودة ولا أحد يناديها.
4. **لا نادٍ للنبضة** — المُشغِّل الدوري في المرحلة 09.
5. **دَين MR 4/6 السلوكي باقٍ كما أُعلن** — العروض المنتهية تُقرَأ `offered` حتى النبضة التالية، والتأجيل وسط الموجة قد يعطي موجةً أصغر من `waveSize`، وموجةٌ مرفوضة بالكامل تنتظر النبضة التالية.

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** أُضيفت طبقة استمرارية Postgres لخدمة التوزيع: أربعة ملفات في `src/infrastructure/drizzle/` + مُسخّر قاعدة + أربعة ملفات اختبار (65 اختباراً: 18 بلا قاعدة و47 أمام Postgres) + وظيفة CI `dispatch-db-integration`. وأُضيف `dispatch_idempotency` إلى `contracts/schema.sql` كترحيل إضافي عكوس، وأُضيف حقل `expiresAt` للموجة في المجال (ثلاثة أسطر في `tick.ts`). ولا شيء من HTTP في الدفعة.
2. **لماذا؟** لأنّ MR 4/6 سلّمت مجالاً صحيحاً سلوكياً **لا يعيش عبر إعادة تشغيل واحدة**، وهذه خدمة تحمل مهمّة عميلٍ ينتظر سيارة: فقدُ حالتها ليس فقدَ صفوف بل فقدَ رحلة. والوعد في `schema.sql` §4 (الحدث في معاملة التغيير) بلا قيمة إن لم يُزِل الفشلُ كلَّ أثر العملية.
3. **أين؟** `services/dispatch/src/infrastructure/drizzle/{db,schema,repository,transaction}.ts` (جديدة) · `services/dispatch/src/__tests__/{pg-harness.ts,schema-drift.test.ts,repository.integration.test.ts,port-conformance.integration.test.ts,atomicity.integration.test.ts}` (جديدة) · `services/dispatch/src/__tests__/harness.ts` (سطر واحد: UUID لمعرّف الإسناد) · `services/dispatch/src/{domain/model.ts,ports.ts,infrastructure/in-memory.ts,use-cases/tick.ts,index.ts}` · `services/dispatch/{package.json,vitest.integration.config.ts}` · `services/dispatch/contracts/schema.sql` · `pnpm-lock.yaml` · `.gitlab-ci.yml` · `docs/02-architecture/DISPATCH_PERSISTENCE.md` (جديدة) · `docs/12-testing/DB_INTEGRATION_CI.md` · `docs/16-progress/{ROADMAP,MASTER_PROGRESS,HANDOFF_NEXT_STEPS,TASK_LOG}.md`.
4. **كيف تم اختباره؟** `pnpm -r typecheck` ✅ نظيف على 25 مشروع عمل · `pnpm -r test` ✅ **1744 اختباراً ناجحاً + 1 متخطّى** (كان 1726، أي +18 وهي حارس الانحراف — الـ47 الأخرى لا تعمل في `pnpm -r test` بقصد) · `pnpm --filter @wasla/dispatch-service test:integration` ✅ **47 اختباراً** أمام Postgres حقيقي محلّياً · `scripts/checks/scan-secrets.sh` ✅.
5. **ما الخطوة التالية؟** MR 5b/6 — طبقة HTTP للتوزيع (8089) وللمطابقة (8088، ولا `src/http` فيها بعد) + `HttpOrderEnginePort` + عميل HTTP للمطابقة + محوّل الجغرافيا. القيدان المُعلَنان يبقيان: **لا `rules` في جسم الطلب**، و**لا تُفتَح موجة في مسار HTTP متزامن**.
6. **هل موثّق؟** نعم — [DISPATCH_PERSISTENCE.md](../02-architecture/DISPATCH_PERSISTENCE.md) (جديدة، تحمل الفجوتين والانحراف المُعلَن ودَين النداء داخل المعاملة) + [DB_INTEGRATION_CI.md](../12-testing/DB_INTEGRATION_CI.md) + هذا الإدخال + [HANDOFF §1 و§11](HANDOFF_NEXT_STEPS.md) + [MASTER_PROGRESS](MASTER_PROGRESS.md) + [ROADMAP](ROADMAP.md).
7. **هل مراجَع؟** مراجعة ذاتية + [MR !48](https://gitlab.com/uxxxu/wasla/-/merge_requests/48) بقالب المراجعة كاملاً، ودُمج بعد خطّ أنابيب أخضر.
8. **هل ADR مطلوب؟** لا. الانحراف الوحيد (ثلاثة أسطر في `tick.ts`) ليس انحرافاً معمارياً بل **إتماماً لنموذج المجال** كشفه العقد، ولا يُغيّر قراراً في ADR-011؛ وهو مُعلَن في موضعين. ونمط وحدة العمل مُوسَّس أصلاً في MR 3/6 و[ORDER_PERSISTENCE](../02-architecture/ORDER_PERSISTENCE.md).
9. **هل يكسر توافقاً خلفياً؟** لا مستهلك خارجياً للخدمة بعد (لا HTTP). داخلياً: `InsertWaveInput` صار يطلب `expiresAt` — تغييرٌ كاسر لمنفذٍ **لا يُنفّذه إلّا مُهيّئان كلاهما في هذه الدفعة**، ويكشفه `tsc` لا التشغيل. ولا عقد منشور تغيّر إلّا بإضافة جدول.
10. **هل migration؟** نعم، واحدة إضافية عكوسة: `CREATE TABLE IF NOT EXISTS dispatch_idempotency` (§5) + إعادة ترقيم القسم 5→6 + سطر تراجع في ذيل الملف. لا جدول قائم يُلمس ولا عمود يُحذف. وبند نشر: `pnpm-lock.yaml` تغيّر (drizzle-orm · pg · @types/pg) وCI يستعمل `--frozen-lockfile`، ففرعٌ بلا قفل محدَّث يفشل عند التثبيت.
11. **هل توجد مخاطر؟** ثلاث مُعلَنة: (أ) **نداءات الشبكة داخل المعاملة** — البند الأول في §7، يُحسَم في MR 5b/6. (ب) **CI على `postgres:15` والتطوير المحلّي جرى على 18.4** — لا ميزة خارج 15 مستخدمة، والوظيفة هي المرجع لا الجهاز المحلّي. (ج) **`resetData` تُفرغ ولا تبذر** — صحيحٌ هنا لأنّ عقد التوزيع بلا بذور تعاقدية (القواعد تصل عبر `RulesProvider`)، وترتيب التفريغ معكوس احتراماً للـFK؛ من يُضيف بذرةً لاحقاً عليه تعديل المُسخّر.
12. **هل security؟** لا أسرار ولا سطح شبكي جديد (فحص الأسرار نظيف). و`DATABASE_URL` يُقرأ من البيئة ولا يُكتَب في ملف. وحدّ الخصوصية باقٍ: صفوف العروض تحمل `driver_public_id` لا `chat_id`، ولا إحداثية في أي جدول من الخمسة.
13. **هل performance؟** الفهارس كلّها من العقد لا مُضافة هنا، والاستعلامات مُفلترة عليها. تحديثات الحالة تستعمل `SELECT … FOR UPDATE` ثمّ **نفس دوالّ آلة الحالات** في المجال — قفلُ صفٍّ واحد لا جدول. ومجموعة التكامل كلّها تعمل في ~2.5 ثانية.
14. **هل monitoring؟** ليس في هذه الدفعة (لا خادم يُقلِع)، ومادة المراقبة صارت مُستمرّة: صندوق الصادر يحمل الآن أحداثاً **مُرتكِزة** لا في الذاكرة، و`ix_dispatch_outbox_unpublished` جاهز للمُرحِّل، وكل حدث يحمل `trace_id`. و`/health` في MR 5b/6.

**Related:** [MR !48](https://gitlab.com/uxxxu/wasla/-/merge_requests/48) · MR 4/6 ([!47](https://gitlab.com/uxxxu/wasla/-/merge_requests/47)) · MR 3/6 ([!46](https://gitlab.com/uxxxu/wasla/-/merge_requests/46)) · [DISPATCH_PERSISTENCE.md](../02-architecture/DISPATCH_PERSISTENCE.md) · [MATCHING_PERSISTENCE.md](../02-architecture/MATCHING_PERSISTENCE.md) · [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md)

## 2026-08-22 · Phase 07 MR 4/6 — مجال التوزيع النقي: النبضة مُقدِّم الزمن الوحيد، وسباق القبول محسومٌ بترتيب مُعلَن

**Task:** تنفيذ طبقة مجال `services/dispatch` كاملةً فوق عقود MR 1/6: آلات حالات المهمّة والموجة والعرض · المواعيد المحفوظة · النبضة مصدراً وحيداً لتقدّم الزمن · القبول والرفض والإلغاء والقراءة · تصنيف نتائج محرّك الطلبات · مُهيّئات الذاكرة — **بلا قاعدة بيانات وبلا HTTP وبلا عميل مطابقة حقيقي**.
**Status:** ✅ مكتملة ومدموجة
**MR:** [!47](https://gitlab.com/uxxxu/wasla/-/merge_requests/47)
**ADR:** [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) (تنفيذ، بلا انحراف) · [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) (حدّ الإسناد مُحترَم)
**الوثيقة:** [DISPATCH_CORE_DOMAIN.md](../02-architecture/DISPATCH_CORE_DOMAIN.md) (جديدة)

### 1. ما سُلِّم

مشروع عمل جديد `@wasla/dispatch-service` فيه **19 ملف مصدر** (3372 سطراً): `domain/` سبعة (النموذج · آلات الحالات · الأخطاء · التحقّق · المواعيد · المفاتيح · الأحداث) · `ports.ts` · `mappers.ts` · `infrastructure/in-memory.ts` · `index.ts` · `use-cases/` ثمانية (الإنشاء · محرّك الطلبات · النبضة · منع التكرار · القبول · الرفض · الإلغاء · القراءة). و**142 اختباراً** في عشرة ملفات (2828 سطراً): النبضة 26 · القبول 17 · الإلغاء 14 · انحراف العقد 14 · الإنشاء 13 · آلة الحالات 19 · الرفض 12 · المواعيد 10 · الخرائط 9 · عقد الأحداث 8. ولا سطر واحد يعرف Postgres أو Fastify.

### 2. القرار المركزي: مُنسّق يُثبَت بلا بنية تحتية

المطابقة دالّة، أما التوزيع فمُنسّق يكتب في خدمة أخرى ويحسم سباقاً بين سائقين. وخطأ المُنسّق يظهر **بيانات متناقضة لا استثناءً**: عرضان مقبولان لطلب واحد، أو مهمّة تنتظر إلى الأبد بعد إعادة نشر. فبُنيت الطبقة على ساعة مُثبَّتة ومُعرّفات متتابعة ومُزيّفات تُسجّل **ترتيب** النداءات، حتى صار «ماذا يحدث إن انقطعت خدمة الطلبات في منتصف موجة؟» سؤالاً له اختبار لا تقدير. المجموعة تعمل في ~3.4 ثانية بلا قاعدة ولا شبكة؛ ولو احتاجت Postgres لَما شُغِّلت قبل الدفع ولا مرّة.

وثلاث قواعد لا تُساوَم، كلٌّ منها بثمنٍ مُعلَن:

1. **الزمن يُخزَّن ولا يُجدوَل.** `expiresAt = createdAt + maxWaves × offerTimeoutSeconds` و`escalationExpiresAt = expiresAt + escalationTimeoutSeconds`، ولا مؤقّت في العملية. المؤقّت يموت مع العملية فيُنسي النظام كل عرضٍ مُعلَّق؛ الموعد المخزَّن ينجو، وتأخّر النبضة يُنتج **تأخّر** القرار لا فقدانه.
2. **النبضة وحدها تُقدّم الزمن.** الإنشاء لا يفتح الموجة الأولى، ورفض السائق لا يُكمِل الموجة ولا يفتح التالية. لسؤال «ما الذي يفتح موجة؟» جوابٌ واحد. الثمن: تأخّر يصل إلى دورة نبضة قبل أول عرض، وموجة رُفضت كلّها تنتظر خامدةً.
3. **كل نداء لمحرّك الطلبات يسبق الكتابة المحلّية.** العكس يُنتج عرضاً مقبولاً في التوزيع وطلباً لا يعرف عنه شيئاً — تناقضٌ لا يُصلحه إلا إنسان. وهذا الترتيب يُنتج في أسوأ حال **تكراراً** يمتصّه `already_applied`، ولذلك هو في اتحاد النتائج بحكم التصميم لا حالةً شاذّة.

### 3. ترتيب القبول: عُدِّل في هذه المراجعة عن قصد

كان القبول يحسم الإسناد ثمّ ينقل حالة الطلب، وصار **نقل الحالة أولاً ثمّ حسم الإسناد**: النقل عديم الأثر عند التكرار (`already_applied`)، أما الحسم فهو القرار المرجعي في السباق. بالترتيب القديم كان مُمكناً أن يُحسَم إسنادٌ ثمّ يُرفَض النقل، فيبقى إسناد حيّ لطلبٍ في حالة لا تسمح به. وأُسقط سلوكٌ قديم كان يُلغي المهمّة عند رفض المحرّك: رفضُ المحرّك يعني «حالة الطلب تغيّرت من تحتك» لا «هذا الطلب ميّت»، وإلغاء طلبٍ بسبب اشتباك تزامن عقوبةٌ على العميل. الآن: رفضُ النقل ⇒ `DISPATCH_ORDER_ENGINE_REJECTED` **ولا شيء عُدِّل**، وخسارة السباق ⇒ عرضنا `superseded` بـ`respondedAt = null` (فالسائق لم يفعل شيئاً خاطئاً) ثمّ `DISPATCH_OFFER_SUPERSEDED`.

وأُضيف حارسان صريحان: **عرض مُنتهٍ لم تمرّ عليه نبضة بعد يُرفَض بلا أي تعديل** (`DISPATCH_OFFER_ALREADY_RESOLVED`) — وإلا صار الفوز مرتبطاً بتأخّر النبضة؛ و**حالة المهمّة يجب أن تكون `dispatching` أو `escalated_community`** وإلا `DISPATCH_JOB_NOT_DISPATCHABLE`.

### 4. أخطاء ودقائق أقرّها الاختبار

1. **دلالة كود السبب المجهول:** كانت سلسلة سليمة الشكل خارج الكتالوج تُنتج `DISPATCH_VALIDATION_FAILED`. صارت `DISPATCH_REASON_CODE_UNKNOWN` (422) مع `details.allowed`، لأن الخطأين مختلفان في العلاج: الأول يُخبر المُنادي بالقائمة المسموحة فيصلح نداءه، والثاني يتركه يخمّن.
2. **تعليق غير صحيح في مُهيّئ الذاكرة** كان يزعم أن فرادة `order_id`/`order_public_id` فهرسٌ باسم `ux_`، وهي **مضمّنة في العمود**. صُحِّح وصُدِّر `DISPATCH_INDEX_NAMES` (خمسة أسماء) ليقارنها حارس الانحراف بـ`schema.sql`.
3. **سلوكان مُثبَّتان بعد انقطاع طويل**: قد يكون الموعدان ماضيين معاً فتُصعِّد نبضة واحدة المهمّة **وتستنفدها** في الدورة نفسها؛ وموجة أولى متأخّرة جداً **تُفتَح** ولا تُصعَّد المهمّة من `pending` مباشرةً، فقد تتجاوز السقف المحفوظ بمهلة عرض واحدة — ونُفضّل ذلك على تصعيد مهمّة لم تُعرَض على أحدٍ قط بحجّة «استُنفدت الموجات». كلاهما مُعلَن في [§9 من وثيقة الطبقة](../02-architecture/DISPATCH_CORE_DOMAIN.md).

### 5. الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** أُضيف مشروع عمل `services/dispatch` (`@wasla/dispatch-service`): 19 ملف مصدر + 9 ملفات اختبار + مُسخّر (`harness.ts`) + `package.json`/`tsconfig.json`/`vitest.config.ts`. آلات الحالات جداول بيانات بمُشغّل مسموح لكل انتقال (8 للمهمّة · 2 للموجة · 5 للعرض) والحالات النهائية **مُستنبَطة** لا مكتوبة بيد؛ المواعيد محفوظة و`isDue` شاملة للطرفين؛ النبضة حتميّة بنيويّاً بلا مؤشّر وبسقف `MAX_STEPS_PER_JOB`؛ الأحداث التسعة؛ الخرائط تحجب `payload_fingerprint` و`created_idempotency_key` و`order_assignment_id` و`deferredJobs`. **ولم يتغيّر ملف واحد خارج `services/dispatch/` والوثائق** (ولا سطر في خدمتَي المطابقة والطلبات).
2. **لماذا؟** MR 4/6 من خطة Phase 07 الملزمة في [HANDOFF §11](HANDOFF_NEXT_STEPS.md)، وهي الطبقة التي تُحوّل «قائمة مرشّحين مرتّبة» إلى «سائق مُسنَد» — وبلا مجالٍ نقيّ أولاً يتوزّع حسم السباق على معالج HTTP واستعلام SQL فيصير غير قابل للإثبات.
3. **أين؟** `services/dispatch/**` (جديد بالكامل: `package.json` · `tsconfig.json` · `vitest.config.ts` · `src/domain/*` · `src/ports.ts` · `src/mappers.ts` · `src/infrastructure/in-memory.ts` · `src/use-cases/*` · `src/index.ts` · `src/__tests__/*`) · `pnpm-lock.yaml` · `docs/02-architecture/DISPATCH_CORE_DOMAIN.md` (جديدة) · `docs/03-domain/MATCHING_DISPATCH.md` (سطر الحالة) · `docs/16-progress/{ROADMAP,MASTER_PROGRESS,HANDOFF_NEXT_STEPS,TASK_LOG}.md`.
4. **كيف تم اختباره؟** `pnpm --filter @wasla/dispatch-service typecheck` ✅ · `pnpm -r run typecheck` ✅ نظيف على **25** مشروع عمل · `pnpm -r run test` ✅ **1726 اختباراً ناجحاً** + 1 مُتخطّى (كان 1584، أي +142) · `scripts/checks/scan-secrets.sh` ✅. ولا اختبار تكامل قاعدة في هذه المراجعة **بقصد**: لا مُهيّئ Postgres بعد (MR 5/6).
5. **ما الخطوة التالية؟** MR 5/6 — استمرارية التوزيع (مرآة Drizzle + وحدة عمل + وظيفة CI `dispatch-db-integration`) وسطح HTTP على 8088/8089، و`HttpOrderEnginePort` الإنتاجي، ومحوّل الجغرافيا. والمعيار المكتوب سلفاً: نفس اختبارات حالات الاستخدام تنجح على Postgres **بلا تعديل سطر في `src/use-cases/`**.
6. **هل موثّق؟** نعم — [DISPATCH_CORE_DOMAIN.md](../02-architecture/DISPATCH_CORE_DOMAIN.md) الجديدة بعشرة أقسام (لماذا مجال نقيّ · اللقطة والمواعيد · آلات الحالات وجدول تبعيّة حالة الطلب للموجة · النبضة وتصنيف نتائج المحرّك · ترتيب القبول · الإلغاء والقراءات وأكواد الأسباب · مُهيّئات الذاكرة · حدّ العقد · **ما لم يُنجَز بقصد** · الأرقام) + هذا الإدخال + [HANDOFF §11](HANDOFF_NEXT_STEPS.md) + [MASTER_PROGRESS](MASTER_PROGRESS.md) + [ROADMAP](ROADMAP.md).
7. **هل مراجَع؟** مراجعة ذاتية + [MR !47](https://gitlab.com/uxxxu/wasla/-/merge_requests/47) بقالب المراجعة كاملاً، ودُمج بعد خطّ أنابيب أخضر.
8. **هل ADR مطلوب؟** لا. القرارات كلّها **تنفيذ** لقرارات ADR-011 الثمانية (الزمن نبضةً · لقطة القواعد · فصل الخدمتين) ولحدّ الإسناد في ADR-010، وتوثيقها محلّه وثيقة الطبقة حسب [قانون التوثيق §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md). وتغيير ترتيب نداءَي المحرّك في القبول (القسم 3) قرارٌ **داخل** الحدّ الذي رسمه ADR-010 لا انحراف عنه.
9. **هل يكسر توافقاً خلفياً؟** لا. لا عقد منشور تغيّر — ولا حرف في `services/dispatch/contracts/` ولا في `packages/contracts/dispatch/`؛ هذه المراجعة **تُنفّذ** العقد الذي دُفع في MR 1/6، ولا مستهلك لهذه الحزمة بعد.
10. **هل migration؟** لا. لا DDL ولا جدول ولا عمود، ولا منفذ يُفتح، ولا متغيّر بيئة جديد. بند نشر واحد: `pnpm-lock.yaml` تغيّر بإضافة مشروع العمل الجديد وتبعيّاته الداخلية (`@wasla/contracts-dispatch` · `@wasla/errors` · `@wasla/orders-service` للاختبار)، وCI يستعمل `--frozen-lockfile` ففرعٌ بلا قفل محدَّث يفشل عند التثبيت.
11. **هل توجد مخاطر؟** (أ) **لا استمرارية** — كل شيء في الذاكرة، فالخدمة غير قابلة للتشغيل اليوم؛ MR 5/6. وأخطر ما ينتظرها القيد `ux_dispatch_offers_one_accepted_job`: هو الحارس النهائي ضدّ عرضين مقبولين، ومَحَلّه القاعدة، والمُهيّئ الذاكري يُحاكيه بالاسم كي تفشل اختبارات السباق هنا كما ستفشل هناك. (ب) **تأخيرٌ في منتصف الموجة يُنتج موجة أصغر من `waveSize`**، وفي أسوأ حال موجة مفتوحة بصفر عرض تُكمِلها النبضة التالية بـ`NO_DRIVER_AVAILABLE` فتُستهلك موجة بلا عرض — مقبول لأن البديل معاملة موزّعة على خدمتين. (ج) **صفّ العرض المُنتهي يقرأ `offered` حتى النبضة التالية**؛ القبول محميّ منه، لكن أي عارض يجب أن يحسب الانتهاء من `expires_at`. (د) **لا مُنادٍ للنبضة** (Phase 09): النبضة اليوم دالّة تُنادى من اختبار. (هـ) **الدُّيون الموروثة** من MR 2/6–3/6 كما هي: أهليّة مُدّعاة غير مُتحقَّقة (Phase 05) · لا ترتيب بـETA/مسافة/تقييم (Phase 10) · لا مُرحِّل صادر (Phase 09).
12. **هل security؟** لا أسرار ولا سطح شبكي جديد (فحص الأسرار نظيف). وحدّ الخصوصية **مُثبَت لا موصوف**: الخرائط تُقارَن مجموعةَ مفاتيحها بما يُعلنه `contracts/api.openapi.yml` **مقروءاً من القرص وقت التشغيل**، فبصمة الحمولة ومفتاح المُنادي ومُعرّف إسناد الطلب لا تُنشَر — الأول والثاني يسلّمان مُهاجماً طريقةً لاستكشاف مفاتيحنا، والثالث مفتاح خدمة أخرى. وحمولات الأحداث التسعة تُفحَص سلبياً ضدّ `chat_id`/`telegram` ([ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)).
13. **هل performance؟** مجموعة التوزيع ~3.4 ثانية بلا قاعدة ولا شبكة. والنبضة **تُؤخّر ولا تنفجر**: مهمّة يفشل فيها نداء المحرّك تُحسَب في `deferredJobs` وتُترَك للدورة القادمة، فسائقٌ واحد عالق لا يُوقف مدينة؛ وسقف `MAX_STEPS_PER_JOB = maxWaves × 2 + 4` يمنع حلقةً لا نهائية من احتجاز الدورة. أما فهارس المسار (`ix_dispatch_jobs_status_due` و`ix_dispatch_offers_open_due` وأخواتها) فمكتوبة في العقد ويُثبِتها MR 5/6.
14. **هل monitoring؟** ليس في هذه الطبقة (لا خادم يُقلِع بعد)، لكنّ مادّته موجودة: `TickResult` يُعلن أربعة عدّادات عمل (`timed_out_offers` · `opened_waves` · `escalated_jobs` · `exhausted_jobs`) مع `tick_at` **الساعة المحقونة لا وقتاً أرسله عميل**، و`deferredJobs` عدّاد داخلي يُفصح عن تابعٍ متدهور ولا يُنشَر في العقد. و`/health` على 8089 في MR 5/6.

**Related:** [MR !47](https://gitlab.com/uxxxu/wasla/-/merge_requests/47)، MR 3/6 ([!46](https://gitlab.com/uxxxu/wasla/-/merge_requests/46))، MR 2/6 ([!45](https://gitlab.com/uxxxu/wasla/-/merge_requests/45))، MR 1/6 ([!44](https://gitlab.com/uxxxu/wasla/-/merge_requests/44))، [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md)، [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md)، [DISPATCH_CORE_DOMAIN.md](../02-architecture/DISPATCH_CORE_DOMAIN.md)، [MATCHING_CORE_DOMAIN.md](../02-architecture/MATCHING_CORE_DOMAIN.md)، [MATCHING_DISPATCH.md](../03-domain/MATCHING_DISPATCH.md)

## 2026-08-22 · Phase 07 MR 3/6 — استمرارية المطابقة: مرآة Drizzle ووحدة عمل، وجدولٌ ناقص في العقد اكتُشف وسُدّ

**Task:** وضع Postgres وراء منافذ المطابقة الثمانية دون تغيير سلوك واحد ودون لمس ملف في `src/use-cases/`
**Status:** ✅ مكتملة ومدموجة
**MR:** [!46](https://gitlab.com/uxxxu/wasla/-/merge_requests/46)
**ADR:** [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) (تنفيذ، بلا انحراف)
**الوثيقة:** [MATCHING_PERSISTENCE.md](../02-architecture/MATCHING_PERSISTENCE.md) (جديدة)

### 1. ما سُلِّم

خمسة مُهيّئات Postgres (`Candidacy` · `Ruleset` · `Decision` · `Outbox` · `Idempotency`) + مرآة Drizzle للجداول الستّة + `PostgresMatchingUnitOfWork`، وأربعة ملفات اختبار: حارس انحراف يقرأ العقد من القرص (19 فحصاً، بلا قاعدة)، ومُهيّئ أمام محرّك حقيقي (17)، ومطابقة منافذ (11)، وذرّية (5).

### 2. الفجوة التي كشفتها الدفعة: منفذٌ بلا مخزن

`MatchingDependencies` يضمّ `IdempotencyStore` وكلّ حالة كتابة تناديه، ولم يكن في `contracts/schema.sql` جدولٌ يخزّنه. `Map` في المُهيّئ الذاكري أخفت النقص تماماً، فمرّت MR 2/6 و117 اختباراً دون أن يظهر. الأثر لو لم يُكتشف: مفاتيح عدم التكرار تعيش في ذاكرة العملية، فإعادة تشغيل واحدة (أو عمليتان وراء موازن حِمل) تجعل إعادة المحاولة **كتابة ثانية** — حدثان لنفس التغيير، وسائق يُعاد ترتيبه على تاريخ عرضٍ مضاعف. سُدَّت بهجرة إضافية عكوسة (القسم 6 في العقد)، بحدَّي طول `8..128` **مطابقين حرفياً** لِـ`assertIdempotencyKey`، والتطابق نفسه مُثبَّت باختبار.

### 3. لماذا وحدة عمل لا مستودع يفتح معاملته

كلّ حالة كتابة تُنفّذ ثلاث كتابات في ثلاثة `await`: `replace` → `remember` → `outbox.append`. مُهيّئٌ يرتكز معاملته في كلّ نداء لا يغطّي أبداً النداءين التاليين، والانهيار بين الثاني والثالث يُنتج أسوأ حالة: صفٌّ تغيّر، ومفتاحٌ يقول «تمّت المعالجة»، وحدثٌ غائب — فإعادة محاولة العميل تُرفض كتكرار والتغيير لا يُنشر أبداً. `zones` و`clock` و`ids` تبقى **خارج** المعاملة بقصد؛ أهمّها `zones` فهو منفذ على خدمة أخرى (ADR-006)، وإدخاله يعني حجز اتصال Postgres عبر نداء شبكي — بها يُستنزف التجمّع بسبب تابعٍ متدهور لا معطّل. و`read()` بلا معاملة أصلاً، مُثبَتاً بغياب أي اتصال `idle in transaction` في `pg_stat_activity`.

### 4. خطأ حقيقي كشفته القاعدة الحقيقية

`sqlState` قرأت `error.code` مباشرةً، وهي لا تعمل: Drizzle يغلّف خطأ المُشغّل في `DrizzleQueryError` رسالتُه نصّ SQL، ويعلّق `pg.DatabaseError` الحقيقي على `cause`. فكانت كلّ مخالفة قيد تُفلت بلا ترجمة. **خمسة من 33 اختبار تكامل فشلت على Postgres حقيقي بسبب هذا بالضبط**، ولم يكن أيٌّ منها قابلاً للكشف بمُهيّئ ذاكري. الحلّ يسير على سلسلة `cause` بعمق محدود ويشترط كوداً من خمسة أحرف (حتى لا يُخطئ `ECONNREFUSED` بـSQLSTATE)، و`rethrowNamed` يُقدّم اسم القيد المخالف في رسالة أي خطأ لا يُترجَم.

### 5. الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** أُضيفت طبقة استمرارية لخدمة المطابقة: أربعة ملفات في `src/infrastructure/drizzle/` (`schema.ts` مرآة الجداول الستّة · `db.ts` تجمّع + `DbOrTx` · `repository.ts` خمسة مُهيّئات · `transaction.ts` وحدة العمل + `bindMatchingAdapters`)، وخمسة ملفات اختبار (`schema-drift` · `pg-harness` · `postgres-repository.integration` · `port-conformance.integration` · `atomicity.integration`)، و`vitest.integration.config.ts`، ووظيفة CI `matching-db-integration`. وفي العقد: **جدول `matching_idempotency` الجديد**. **ولم يتغيّر ملف واحد في `src/use-cases/`.**
2. **لماذا؟** MR 3/6 من خطة Phase 07 الملزمة في [HANDOFF §11](HANDOFF_NEXT_STEPS.md). ومجالٌ نقيّ لا يعيش عبر إعادة تشغيل واحدة: صحيحٌ سلوكياً وعديم القيمة تشغيلياً. والمعيار مكتوب سلفاً في إدخال MR 2/6: نفس الاختبارات تنجح على Postgres بلا تعديل حالة استخدام — وهو ما يُبرهنه `port-conformance` لا ما يُدّعيه هذا السطر.
3. **أين؟** `services/matching/contracts/schema.sql` (قسم 6 جديد) · `services/matching/src/infrastructure/drizzle/*` · `services/matching/src/__tests__/{schema-drift,pg-harness,postgres-repository.integration,port-conformance.integration,atomicity.integration}.*` · `services/matching/{package.json,vitest.integration.config.ts}` · `services/matching/src/index.ts` (تصديرات) · `pnpm-lock.yaml` · `.gitlab-ci.yml` · `docs/02-architecture/MATCHING_PERSISTENCE.md` (جديدة) · `docs/03-domain/MATCHING_DISPATCH.md` (سطر الحالة) · `docs/16-progress/{ROADMAP,MASTER_PROGRESS,HANDOFF_NEXT_STEPS,TASK_LOG}.md`.
4. **كيف تم اختباره؟** `pnpm -r run typecheck` ✅ نظيف على 24 مشروعاً · `pnpm -r run test` ✅ **1584 اختباراً ناجحاً** (كان 1565، أي +19 حارس انحراف) · `pnpm --filter @wasla/matching-service test:integration` ✅ **33 اختباراً على Postgres حقيقي** (17 مُهيّئ + 11 مطابقة منافذ + 5 ذرّية) · نفس الأمر **بلا** `DATABASE_URL` ✅ 33 تتخطّى نفسها · `scripts/checks/scan-secrets.sh` ✅. والفشل الخمسة المذكورة في القسم 4 حدثت فعلاً وأُصلحت، ولم تكن مرئية لأي اختبار وحدة.
5. **ما الخطوة التالية؟** MR 4/6 — مجال Dispatch النقي: موجة العروض والمُهَل و`POST /dispatch/tick` كالمصدر الوحيد لتقدّم الزمن. بلا قاعدة وبلا HTTP.
6. **هل موثّق؟** نعم — [MATCHING_PERSISTENCE.md](../02-architecture/MATCHING_PERSISTENCE.md) الجديدة تحمل الهجرة وخطة تراجعها، وحدّ الذرّية، والقرارات الأربعة ببديلها المرفوض، والخطأ الذي كشفته القاعدة، وجدول «ما لا يُثبته إلّا محرّك حقيقي»، وجدول الحدود والدَين المعلن + هذا الإدخال + [HANDOFF §11](HANDOFF_NEXT_STEPS.md) + [MASTER_PROGRESS](MASTER_PROGRESS.md) + [ROADMAP](ROADMAP.md).
7. **هل مراجَع؟** مراجعة ذاتية + [MR !46](https://gitlab.com/uxxxu/wasla/-/merge_requests/46) بقالب المراجعة كاملاً، ودُمج بعد خطّ أنابيب أخضر يشمل `matching-db-integration`.
8. **هل ADR مطلوب؟** لا. جدول `matching_idempotency` **تنفيذٌ** لمنفذ قرّره ADR-011 لا انحرافٌ عنه، وسائر القرارات تنفيذية موثّقة في وثيقة الطبقة حسب [قانون التوثيق §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md). ولا قرار من قرارات ADR-011 الثمانية أُعيد فتحه.
9. **هل يكسر توافقاً خلفياً؟** لا. لا عقد منشور تغيّر، ولا مستهلك لهذه الحزمة بعد. الإضافة إلى `schema.sql` **إضافية بحتة**: جدول جديد، ولا عمود قائم تغيّر ولا قيد قائم شُدِّد.
10. **هل migration؟** نعم، واحدة وعكوسة: `CREATE TABLE IF NOT EXISTS matching_idempotency` (+ قيدا طول). **خطة التراجع:** `DROP TABLE matching_idempotency;` بلا فقدان بيانات قائمة، فالجدول جديد ولا يُشير إليه شيء. لا تهيئة بيئة جديدة ولا منفذ يُفتح؛ وبند نشر واحد: `pnpm-lock.yaml` تغيّر بإضافة `drizzle-orm` و`pg` و`@types/pg`، وCI يستعمل `--frozen-lockfile` ففرعٌ بلا قفل محدَّث يفشل عند التثبيت.
11. **هل توجد مخاطر؟** (أ) **لا فلترة في SQL** — كلّ صفوف الترشيح تُقرأ في الذاكرة للتقييم؛ مقصود لأن الدفع إلى SQL يُغيّر معنى `counts.considered` وينقل ترتيب الفلاتر و`empty_reason_code` من كود مُختبَر إلى خطّة استعلام. دَينٌ معلن للمرحلة 09 حين يبرّره عدد الصفوف. (ب) **لا تقليم** للقرارات ولا للصادر ولا لمفاتيح عدم التكرار — الصفوف تتراكم بقصد: حدثٌ لم يُخزَّن أسوأ من حدثٍ لم يُنشر؛ سياسة الاحتفاظ للمرحلة 09. (ج) **CI يشغّل postgres:15 والتحقّق المحلّي جرى على 18** — الـDDL قياسي بلا ميزة خاصة بإصدار (فهارس جزئية و GIN على `TEXT[]` مدعومة في 15)، والوظيفة نفسها هي البرهان النهائي. (د) **لا مُهيّئ للجغرافيا بعد**، فالتوافق مُثبَت بمناطق في الذاكرة في التنفيذين — ينتهي في MR 5/6.
12. **هل security؟** لا أسرار ولا سطح شبكي جديد (فحص الأسرار نظيف)، ولا سلسلة اتصال في الكود: `DATABASE_URL` من البيئة وحدها. وحدّ الخصوصية مُشدَّد لا مُخفَّف: اختبارٌ يمرّ على **أعمدة** جدول الصادر ويرفض أي عمود يطابق `driver|score|candidate|notes|label|phone|latitude|longitude` — فحمولة الحدث أعدادٌ فقط (ADR-011 قرار 8) وصار للحدّ حارسان: نصّ الحمولة في حزمة العقود، والأعمدة هنا.
13. **هل performance؟** الفهارس التي يعتمد عليها المسار موجودة ومُتحقَّق منها بالاسم في القاعدة: `ix_candidacy_ready` الجزئي (يجعل المسح متناسباً مع المتاحين الآن لا مع كلّ من سُجّل يوماً) و`ix_candidacy_zones`/`ix_candidacy_services` (GIN) و`ix_decisions_order` و`ix_matching_outbox_unpublished`. ومجموعة التكامل تعمل في ~1.5 ثانية. والحدّ الأدائي المعروف هو دَين الفلترة في البند 11(أ).
14. **هل monitoring؟** ليس في هذه الطبقة (لا خادم يُقلِع بعد)، لكنّ مادّته صارت **دائمة** لا متبخّرة: كلّ تقييم — بما فيه الفارغ — يُخزَّن كصفّ قرار بكود سبب وأعداد مراحل، وصفوف الصادر تحمل `published_at IS NULL` فطول صفّ غير المنشور صار قابلاً للقياس. و`/health` في MR 5/6.

**Related:** [MR !46](https://gitlab.com/uxxxu/wasla/-/merge_requests/46)، MR 2/6 ([!45](https://gitlab.com/uxxxu/wasla/-/merge_requests/45))، MR 1/6 ([!44](https://gitlab.com/uxxxu/wasla/-/merge_requests/44))، [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md)، [MATCHING_PERSISTENCE.md](../02-architecture/MATCHING_PERSISTENCE.md)، [MATCHING_CORE_DOMAIN.md](../02-architecture/MATCHING_CORE_DOMAIN.md)، [ORDER_PERSISTENCE.md](../02-architecture/ORDER_PERSISTENCE.md)

## 2026-08-22 · Phase 07 MR 2/6 — مجال المطابقة النقي: ثمانية فلاتر مرتّبة، ودرجة صحيحة، وتعادلٌ محسوم — بلا قاعدة وبلا HTTP

**Task:** تنفيذ طبقة مجال `services/matching` كاملةً فوق عقود MR 1/6: الفلاتر الصلبة الثمانية بترتيبها وأكواد عجزها · الدرجة بنسخة القواعد 1 بحساب صحيح بالنقاط الأساسية · حسم التعادل المُعلَن · المنافذ وحالات الاستخدام ومُهيّئات الذاكرة — **بلا قاعدة بيانات وبلا HTTP**. **Status:** Completed · **MR:** [!45](https://gitlab.com/uxxxu/wasla/-/merge_requests/45) · **ADR:** [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) · **الوثيقة:** [MATCHING_CORE_DOMAIN.md](../02-architecture/MATCHING_CORE_DOMAIN.md)

### 1. ماذا تم إنجازه

- **مشروع عمل جديد `@wasla/matching-service`** (14 ملف مصدر): `domain/` (النموذج · الأخطاء · نسخة القواعد · الفلاتر · الدرجة · الأحداث · التحقّق) · `ports.ts` (ثمانية منافذ) · `use-cases/` (ستّ حالات) · `mappers.ts` · `infrastructure/in-memory.ts` · `index.ts`.
- **الفلاتر الثمانية جدولاً صريحاً** (`HARD_FILTER_STAGES`) لكل مرحلة رقمها واسمها وكود عجزها (`NO_CANDIDACY_ROWS` … `ALL_CANDIDATES_EXCLUDED`)، وقاعدة **السبب الأوّل يفوز** مُثبَتة على صفٍّ يفشل في ثلاث مراحل معاً.
- **حساب الدرجة صحيحاً بالكامل** (`BP_SCALE = 10000`): سلّم قرب المنطقة (10000/7500/5000/2500/1000 و`null` عند انعدام الجدَّ المشترك) · الإتمام متشبّعاً عند 20 · القبول محيّداً (5000) لمن لا سجلّ له · العدالة مسقوفة بأفقها.
- **نسخة القواعد 1** (`phase07-mvp-zone-and-fairness`) مُقفَلة مجموعها 100، و`assertRankable` يرفض غير المُقفَل وغير المتّسق المجموع.
- **حسم تعادل ثلاثي مُسجَّل لكل مرشّح** (`score` · `last_offered_at` · `driver_public_id`) — فقرارٌ يستطيع تسمية «لماذا هو لا هيّ».
- **ستّ حالات استخدام**: التقييم (الشكل ⇒ القواعد ⇒ منطقة الانطلاق 422 ⇒ الفلاتر ⇒ الترتيب ⇒ قرار واحد + حدث أعداد فقط) · الترشيح استبدالاً كاملاً · التوافر (404 بلا إنشاء ضمني) · القراءة (`is_fresh` محسوب) · التدقيق · القواعد.
- **117 اختباراً جديداً** منها **حارس انحراف ثلاثي** يقرأ `contracts/schema.sql` و`docs/03-domain/MATCHING_DISPATCH.md` §5 من القرص وقت التشغيل ويقارنهما بثوابت الكود، و**حارس خصوصية سلبي** ينفي أي مُعرّف مرشّح أو `score_bp` أو `chat_id` في أي حمولة حدث.
- **الوثيقة المعمارية** [MATCHING_CORE_DOMAIN.md](../02-architecture/MATCHING_CORE_DOMAIN.md) (ثمانية أقسام: لماذا دالّة قبل القاعدة · جدول الفلاتر · الدرجة والسقوف · المنافذ وقواعد الكتابة · حدّ الخصوصية · معيار MR 3/6 · ما لم يُنجَز بقصد · الأرقام).

### 2. لماذا هكذا

المطابقة **دالّة لا مُنسّق**، فكل ما يستحقّ الجدل فيها قابل للإثبات بلا قاعدة ولا شبكة: ترتيب الفلاتر، ومعنى الصفر، وسلوك التعادل، وما يُبَثّ. ولو بدأنا بالقاعدة أو الـHTTP لَتوزّع القرار على `WHERE` و`if` ومُعامل تهيئة، فصار سؤال «لماذا هذا السائق؟» غير قابل للجواب إلا بتشغيل النظام كاملاً. وترتيب الفلاتر ليس تفصيلاً تنفيذياً بل **يحدّد بأيّ عجزٍ يُخبَر المُشغّل**: «لا أحد متاح» و«الجميع قديم» يُرسلان شخصين مختلفين إلى مشكلتين مختلفتين. والحساب صحيح لأن المقارنة العشرية تجعل تعادلاً حقيقياً يبدو فرقاً، وتجعل قراراً مُخزَّناً غير قابل لإعادة الإنتاج حرفياً بعد شهر.

### 3. ما أقرّه الاختبار من علل حقيقية (أُصلحت في المجال لا في التوقّع)

1. **مقارنة التعادل لم تكن انعكاسية** (`compare(x, x) = 1`)، كشفها اختبار تباديل — ومقارنةٌ كهذه ليست ترتيباً، و`Array.prototype.sort` يصير حرّاً في أي ناتج.
2. **مفتاح منع تكرار من فراغات بيضاء كان يُقبَل** — فكان كل طلب كهذا سيصير «إعادة محاولة» لأوّله؛ صار `MATCHING_IDEMPOTENCY_KEY_REQUIRED`.
3. **`counts.excluded`** كان يعدّ ما طلبه المُنادي لا ما أُقصي فعلاً — فكان مُعرّف إقصاء غير موجود يرفع العدّاد، فيكذب صفّ التدقيق.

وأُصلح توقّعان في الاختبار نفسه بعد الرجوع إلى العقد: أكواد أخطاء لا توجد في `errors.md`، وفئة مركبة `"bike"` ليست من القائمة المُغلقة (`motorcycle`).

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** أُضيف مشروع عمل `services/matching` (`@wasla/matching-service`) بـ14 ملف مصدر وستّ ملفات اختبار + مُسخّر اختبار: طبقة مجال نقيّة (فلاتر · درجة · نسخة قواعد · أخطاء · أحداث · تحقّق)، ثمانية منافذ، ستّ حالات استخدام، خرائط سلكية `snake_case`، ومُهيّئات ذاكرة. **ولا سطر يعرف Postgres أو Fastify.**
2. **لماذا؟** MR 2/6 من خطة Phase 07 الملزمة في [HANDOFF §11](HANDOFF_NEXT_STEPS.md)، وهو نفس نمط Phase 06 (مجال نقيّ قبل الاستمرارية قبل HTTP).
3. **أين؟** `services/matching/{package.json,tsconfig.json,vitest.config.ts}`، `services/matching/src/**`، `pnpm-lock.yaml`، `docs/02-architecture/MATCHING_CORE_DOMAIN.md` (جديد)، `docs/03-domain/MATCHING_DISPATCH.md` (سطر الحالة)، `docs/16-progress/{ROADMAP,MASTER_PROGRESS,HANDOFF_NEXT_STEPS,TASK_LOG}.md`.
4. **كيف تم اختباره؟** `pnpm -r run typecheck` ✅ نظيف على 23 مشروع عمل · `pnpm -r run test` ✅ **1565 اختباراً ناجحاً** (كان 1448، أي +117) · `scripts/checks/scan-secrets.sh` ✅ · `scripts/checks/require-doc-update.sh` ✅ · markdown lint ✅. ومن الـ117: 22 للفلاتر · 29 للدرجة والتعادل · 26 للتقييم من طرف إلى طرف · 23 للترشيح والتدقيق · 9 للخرائط والأحداث · 8 حارس انحراف.
5. **ما الخطوة التالية؟** MR 3/6 — استمرارية المطابقة (مرآة Drizzle لـ`schema.sql` + وحدة عمل + وظيفة CI `matching-db-integration`)، **ومعيارها مكتوب**: نفس اختبارات حالات الاستخدام تنجح على Postgres بلا تعديل ملف واحد في `src/use-cases/`.
6. **هل موثّق؟** نعم — وثيقة معمارية جديدة [MATCHING_CORE_DOMAIN.md](../02-architecture/MATCHING_CORE_DOMAIN.md) + هذا الإدخال + [HANDOFF §11](HANDOFF_NEXT_STEPS.md) (لقطة §1 · جدول المراجعات · «ما أنجزته MR 2/6 بالضبط» و«ما لم يُنجَز بقصد») + [MASTER_PROGRESS](MASTER_PROGRESS.md) + [ROADMAP](ROADMAP.md).
7. **هل مراجَع؟** مراجعة ذاتية + [MR !45](https://gitlab.com/uxxxu/wasla/-/merge_requests/45) بقالب المراجعة كاملاً، ودُمج بعد خطّ أنابيب أخضر.
8. **هل ADR مطلوب؟** لا — لا انحراف: كل قرار هنا تنفيذٌ لـ[ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) ولـ[نموذج المجال](../03-domain/MATCHING_DISPATCH.md). والانحراف الوحيد عن §30.2 (تصفير ETA والمسافة والتقييم) مُعلَن في ADR-011 القرار 6 ولم يُوسَّع هنا.
9. **هل يكسر توافقاً خلفياً؟** لا — مشروع عمل جديد بالكامل، ولا ملفٌ قائم خارج الوثائق و`pnpm-lock.yaml` مُسّ. ولا مستهلك لهذه الحزمة بعد.
10. **هل migration؟** لا — لا قاعدة في النطاق (MR 3/6)، ولا تهيئة بيئة جديدة، ولا منفذ يُفتح.
11. **هل توجد مخاطر؟** نعم ثلاث مُعلَنة: (أ) **الأهليّة مُدّعاة لا مُتحقّقة** حتى Phase 05 — والتخفيف fail-closed وتخزين مصدر الادّعاء. (ب) **الطابع الزمني في المستقبل يُعَدّ حديثاً** — ثمنٌ مدفوع بوعي: إسقاطه يُفرِغ مدينةً عند انحراف ساعة بوت. (ج) **مُهيّئات الذاكرة تُحاكي القيود ولا تُبرهنها** — البرهان على Postgres في MR 3/6.
12. **هل security؟** لا أسرار ولا شبكة ولا مدخل خارجي في هذه الطبقة. و**حدّ الخصوصية مُشدَّد لا مُخفَّف**: حدث التقييم أعدادٌ فقط بلا مُعرّف مرشّح ولا درجة (ADR-011 قرار 8)، مُثبَتاً ببحث سلبي في نصّ الحمولة، ولا `chat_id` ولا إحداثية في أي موضع.
13. **هل performance؟** المجموعة تعمل في ~1.2 ثانية بلا بنية تحتية، والترتيب مرور واحد ثمّ فرز مقطوع بـ`maxCandidates`. والحساب صحيح بلا عدد عشري.
14. **هل monitoring؟** ليس في هذه الطبقة (لا خادم يُقلِع) — لكن **كل تقييم يترك أثراً قابلاً للتدقيق بما في ذلك التقييم الفارغ**: قرار + كود سبب + أعداد مراحل، وهو مادة لوحة المراقبة لاحقاً. و`/health` في MR 5/6.

**Related:** [MR !45](https://gitlab.com/uxxxu/wasla/-/merge_requests/45)، MR 1/6 ([!44](https://gitlab.com/uxxxu/wasla/-/merge_requests/44))، [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md)، [MATCHING_CORE_DOMAIN.md](../02-architecture/MATCHING_CORE_DOMAIN.md)، [MATCHING_DISPATCH.md](../03-domain/MATCHING_DISPATCH.md)

---

## 2026-08-21 · Phase 07 MR 1/6 — ADR-011 وعقود المطابقة والتوزيع: خدمتان، أهليّة مُدّعاة مُعلَنة، وزمنٌ نبضةً لا مؤقّتاً

**Task:** بدء Phase 07 (Dispatch & Matching MVP) بالعقد أولاً: حسم الأسئلة الأربعة التي تركتها Phase 06 مفتوحة في [HANDOFF §11](HANDOFF_NEXT_STEPS.md)، ثمّ كتابة العقود الكنسية للخدمتين وأنواعها المُنمَّطة ونموذج المجال — بلا سطر تنفيذ واحد.

### 1. ماذا تم إنجازه

- **[ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md)** (مقبول، 166 سطراً) — ثمانية قرارات لكل واحد بديلُه المرفوض وثمنه: **خدمتان لا واحدة** (`services/matching` :8088 دالّة · `services/dispatch` :8089 مهمّة، وكلتاهما في شجرة §68 فلا انحراف) · **مصدر المرشّحين** إسقاط `driver_candidacy` بمرجع opaque بلا FK وأهليّة **مُدّعاة ومصدرها مخزّن** والمجهول ليس مرشّحاً · **الزمن نبضة** `POST /dispatch/tick` بساعة مُحقونة لا مؤقّت خفيّ · **الأمواج** بلقطة إعداد على المهمّة وأوّل قبول يفوز بقيد في القاعدة · **تصعيد المجتمع** قراراً هنا وتوصيلاً في طبقة القناة · **الأوزان بيانات بنسخة مُقفَلة** مجموعها 100 بقيد · **المحرّك هو الحاكم** (409 يُسجَّل لا يُصحَّح) · **الخصوصية**: لا مُعرّف مرشّح ولا درجة في أي حدث.
- **`services/matching/contracts/`** — `schema.sql` (خمسة جداول: الترشيح · نسخ القواعد بقيد `ck_ruleset_weights_sum_100` والنسخة 1 مبذورة ومُقفَلة · القرارات ومرشّحوها بدرجات بالنقاط الأساسية وفهرس رتبة فريد · صندوق صادر) · `api.openapi.yml` (المرشّحون · الترشيح · التوافر · القواعد · قرار مُدقَّق) · `events.json` (ثلاثة أحداث بأعداد فقط) · `errors.md` (أكواد + **كتالوج ثمانية أسباب للقائمة الفارغة**) · `README.md` (تسعة حدود ملزمة).
- **`services/dispatch/contracts/`** — `schema.sql` (مهمّة · موجة · عرض · صادر، بفهرسين فريدين جزئيين: موجة مفتوحة واحدة وعرض مقبول واحد لكل مهمّة، وفريد `(job_id, driver_public_id)`، وقيود «كل نهاية لها سبب» وترتيب المواعيد ومُشغّلات `updated_at`) · `api.openapi.yml` · `events.json` (تسعة أحداث) · `errors.md` · `README.md`.
- **`packages/contracts/matching`** و**`packages/contracts/dispatch`** — حزمتان خاصّتان ESM، أنواع API **مُولَّدة** بـ`openapi-typescript` من العقد نفسه، وأنواع أحداث مُشتقّة، وكتالوجات أكواد ثابتة، وتبرير عربي صريح لوجود كل حزمة (قانون التوثيق §7).
- **[`docs/03-domain/MATCHING_DISPATCH.md`](../03-domain/MATCHING_DISPATCH.md)** (247 سطراً) — ما يملكه المجال وما لا يعرفه · الحدّ بين الخدمتين والمحرّك برسم · إسقاط الترشيح والأهليّة المُدّعاة · **ترتيب الفلاتر الثمانية وكود عجز كل واحد** · جدول الأوزان بالانحراف المُعلَن عن §30.2 وحسم التعادل · دلالة النبضة · دورة حياة المهمّة والعرض وحسم السباق · **المسار الكامل الذي تُثبته بوابة الطور** · سبعة ديون مُعلَنة بمُسدِّديها.
- **[CONTAINERS §4.3](../02-architecture/CONTAINERS.md)** — الخدمتان بمنفذيهما واتجاه اعتمادهما وثلاثة حدود يفرضها حارس اختبار.
- **وثائق التقدّم**: [ROADMAP](ROADMAP.md) · [MASTER_PROGRESS](MASTER_PROGRESS.md) (Phase 07 = In Progress + قياس البوابة) · [HANDOFF §11](HANDOFF_NEXT_STEPS.md) (القرارات المحسومة + خطة الست مراجعات + ما لم يُنجَز بقصد).

### 2. لماذا هكذا

خلط «من يصلح؟» بـ«من يأخذه الآن؟» في خدمة واحدة أرخص اليوم ويجعل السؤال «لماذا هذا السائق؟» غير قابل للجواب بمعزل عن «لماذا الآن؟» غداً. والانتظار حتى تُنجَز Phase 05 لأجل الأهليّة يوقف المسار الحرج، فالبديل المُعلَن: أهليّة مُدّعاة **ومصدر الادّعاء مخزّن** ودَينٌ مكتوب في الوثيقة بمُسدِّده. والمؤقّت الخفيّ يجعل المهلة تُفقَد عند إعادة التشغيل وتُنفَّذ مرّتين عند وجود نسختين ويجعل الاختبار ينتظر عشر ثوان، فالنبضة تُحوّل الزمن إلى **مُدخَل صريح**.

### 3. الاختبارات والتحقق

- **46 حارس انحراف جديداً**: `@wasla/contracts-matching` 24/24 · `@wasla/contracts-dispatch` 22/22 — تقرأ العقود من القرص وقت التشغيل، وتؤكّد على **الأكواد الثابتة** لا على النصّ العربي.
- **`pnpm -r test`: 1448 اختباراً ناجحاً** + 1 متجاوَز (كان 1402) بلا قاعدة بيانات. **`pnpm -r typecheck` نظيف.**
- حارس الروابط النسبية في الوثائق نظيف، وصُحّحت أربعة روابط مكسورة سابقة لا علاقة لها بهذه المرحلة (مُعلَنة في وصف المراجعة).
- مسارات Postgres في `schema.sql` **لم تُشغَّل بعد** — لا وظيفة قاعدة لهذه الخدمتين حتى MR 3/6 و5/6، وهذا مكتوب لا مسكوت عنه.

### 4. ما بقي

MR 2/6 (طبقة مجال المطابقة النقيّة: الفلاتر والترتيب بحساب صحيح) ⇒ 3/6 استمرارية + CI ⇒ 4/6 طبقة مجال التوزيع والنبضة ⇒ 5/6 استمرارية وHTTP ومنفذ المحرّك الإنتاجي ⇒ 6/6 بوابة الخروج `packages/dispatch-e2e` + إغلاق الطور.

- **Files:** `docs/15-decisions/ADR-011-*.md` · `services/matching/contracts/*` · `services/dispatch/contracts/*` · `packages/contracts/{matching,dispatch}/**` · `docs/03-domain/MATCHING_DISPATCH.md` · `docs/02-architecture/CONTAINERS.md` · `docs/16-progress/{ROADMAP,MASTER_PROGRESS,HANDOFF_NEXT_STEPS,TASK_LOG}.md` · `pnpm-lock.yaml` · إصلاح روابط في `docs/00-rules/PUSH_DOCUMENTATION_RULE.md` و`services/geography/contracts/README.md` و`packages/contracts/identity/README.md`
- **Services:** matching (عقود) · dispatch (عقود)
- **Why:** بدء Phase 07 بالعقد أولاً وحسم أسئلتها المفتوحة بقرار موثّق قبل أي تنفيذ
- **Tests:** 46 حارس انحراف جديداً · إجمالي 1448 ناجحاً + 1 متجاوَز · typecheck نظيف · 10 وظائف CI خضراء
- **Next:** MR 2/6 — طبقة مجال المطابقة النقيّة
- **Related:** [!44](https://gitlab.com/uxxxu/wasla/-/merge_requests/44) · [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) · [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) · [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)

---

## 2026-08-21 · Phase 06 MR 6/6 — بوابة خروج الطور فوق HTTP: 441 زوجاً على خدمتين تعملان · **Phase 06 مُغلقة**

**Task:** إثبات بوابة خروج المرحلة 06 («طلب يعيش دورة حياته كاملة، ولا يصل طلب إلى حالة غير مسموح بها») على التركيب الكامل لا على وحدة، ثمّ إغلاق الطور وفتح Phase 07.

### 1. ماذا تم إنجازه

حزمة اختبار بحتة جديدة **`packages/order-e2e`** (`private: true`، بلا كود تشغيلي وبلا تصديرات، بلا اعتمادية جديدة على المستودع):

- **`src/harness.ts`** — يُشغّل **أربعة مُنصتات حقيقية** على منافذ عشوائية: `services/identity` · `services/geography` (بذرة السعودية) · `services/customers` · `services/orders`. التسليم بين النواة والمحرّك يمرّ بـ**`HttpOrderIntakePort` الإنتاجي** من MR 5/6 لا بنسخة منه، فالطلبات موجودة في المحرّك لأنّ الكود الذي يعمل في الإنتاج وضعها هناك. مخزن المحرّك Postgres عند وجود `ORDER_DATABASE_URL` (`PostgresOrderRunner` + الـDDL مُعاد تشغيلها من `contracts/schema.sql`) وإلّا ذاكرة، والمخزن المُختار **يُطبَع في أول السجل** لأن نتيجة خضراء لا تعني شيئاً قبل معرفة ما عملت عليه.
- **`src/__tests__/phase06-exit-gate.e2e.test.ts`** — 16 اختباراً في ستّ مجموعات: التسليم حقيقي · الرحلة الكاملة والسجلّ · **الجدول كاملاً (441 زوجاً)** · حارس انزلاق الحدّ · وعود السلسلة · صدق `/health` على الطرفين.
- **`vitest.config.ts`** — يُضمّن `*.e2e.test.ts` صراحةً (الاستثناء الثالث المُعلَن بعد `channel-e2e` و`customer-e2e`) مع `fileParallelism: false` ومهلة 120s.
- **`.gitlab-ci.yml`** — وظيفة **`order-exit-gate-e2e`** على `postgres:15` بقاعدة مستقلّة `wasla_order_e2e` ومتغيّر **`ORDER_DATABASE_URL`**.
- **`services/orders/src/index.ts`** — تصديران فقط: `createOrderDb` و`PostgresOrderOutbox` (بتعليق يبرّرهما).
- **وثيقة البوابة** `docs/12-testing/PHASE06_EXIT_GATE_E2E.md` (127 سطراً) بحدودها المُعلَنة.

### 2. لماذا هكذا لا بالنسخة الأرخص

- **حزمة مستقلّة لا اختبار داخل إحدى الخدمتين.** البوابة تحتاج الطرفين معاً؛ وضعها في `services/orders` يُلزم المحرّك بالاعتماد على `services/customers` — عكسٌ لاتجاه الاعتماد، ووضعها في النواة يُلزمها بمخطّط قاعدة المحرّك. ووضعها في `packages/customer-e2e` يُفسد سؤال المرحلة 04: **محرّكها البديل مُجمَّد بقصد**، ولو استُبدل بالمحرّك الحقيقي لتغيّر ما تمّ التوقيع عليه.
- **المسار إلى كل حالة يُحسَب من الجدول لا يُكتَب بيد.** `shortestPath` في المِعْوان بحثٌ بالعرض على `allowedTargets` — قائمةُ مشيات مكتوبة يدوياً كانت ستَرِث الجدول القديم بصمت وتصير البوابة تُثبت نفسها.
- **الرفض يُقاس بأثره لا بردّه.** بعد كل واحد من الـ369 رفضاً تُقرأ حالة الطلب من المحرّك: **رفضٌ يُغيّر الحالة أسوأ من قبول**، وهذا ما لا يظهر في اختبار يفحص رمز الاستجابة فقط.
- **حارس الانزلاق يقرأ العقد وقت التشغيل.** قائمة `required` تُحلَّل من `api.openapi.yml` نصّياً (لا اعتمادية yaml في المستودع، ومطابقة الوثيقتين محروسة أصلاً داخل `@wasla/contracts-order`) وتُقارَن بمفاتيح ما يُنتجه `toOrderIntakeRequestDto` **فعلاً**. لا يمكن لنوعٍ أن يرى هذا الانحراف: الطرفان يستوردان النوع من الحزمة نفسها.
- **`bindAcceptedAssignment` جُعل خامل التكرار (idempotent)** بمعالجة `ORDER_ASSIGNMENT_FORBIDDEN` كـ«مُسنَد بالفعل»، لأن المشية التي تُوصل الطلب إلى حالته قد تكون أسندت سائقاً — والرفض نفسه مُوكَّد في اختبار مستقلّ فلا يُخفى شيء.
- **التوكيدات على رموز الأخطاء لا على النصّ العربي:** الرسالة قابلة للتحسين والرمز عقد.

### 3. ما أثمرته البوابة في يومها الأول — عيبٌ إنتاجي أُوقف قبل الدمج

أوّل تشغيل على **Postgres** في CI أسقط أربعة اختبارات بـ`503 ORDER_ENGINE_UNAVAILABLE` وهي خضراء على الذاكرة:

- **السبب:** `resolveAssignment(accepted)` كان يُنادي `setActiveAssignment` فوراً، فيكتب صفّ طلبٍ حالته `offered` **بإسناد نشط** — وهو ما يمنعه القيد `ck_orders_assignment_matches_status`، وهو حرفياً **الصورة الرابعة للحالة المستحيلة** في ADR-010 §7. أي أن **قبول أي سائق كان يفشل في الإنتاج**، ولم يظهر لأن مُهيّئ الذاكرة كان يقبل ما ترفضه القاعدة فمرّت 621 اختباراً على حالة مستحيلة. الوثيقة كانت صحيحة والكود مخالفاً.
- **الإصلاح (لا تجاوز):** الربط انتقل إلى `transitionOrder` — يقرأ الإسناد المقبول من سجلّ الإسنادات ويكتبه في **نفس عبارة `UPDATE`** التي تُحرّك الحالة، فلا يظهر الصفّ لحظةً في وضعٍ يرفضه القيد؛ والقبول يبقى تسجيلاً لا قراراً (السائق يُقرأ من المقبول لا من الطلب الشبكي).
- **وسدّ الحُفرة لا الأعراض:** `InMemoryOrderRepository.setActiveAssignment` صار يفرض القيد نفسه (`ORDER_ASSIGNMENT_FORBIDDEN` / `ORDER_ASSIGNMENT_REQUIRED`)، وثلاثة اختبارات وحدة جديدة تُثبت: القبول لا يربط · الانتقال يربط بكتابة واحدة · المخزن يرفض ربطاً في حالة تمنعه. الاختبار الذي كان يُثبت السلوك الخاطئ أُعيد كتابته لا حُذف.

### 4. الديون المُعلَنة (لا مكتشفة)

- **مخزن العميل في الذاكرة داخل هذه البوابة** — سؤال ذرّية صفّ الطلب ونقاطه تملكه بوابة المرحلة 04 (`customer-exit-gate-e2e`)؛ تكراره هنا يضاعف سطح الفشل بلا معلومة.
- **لا Matching** — الإسنادات تُسجَّل من الاختبار بالشكل نفسه الذي ستُسجّله المرحلة 07 (المحرّك يسجّل ولا يقرّر — ADR-010).
- **لا تفويض ولا صلاحيات** (Phase 09) — ما يُثبَت هنا نطاق الملكية في القراءة (404 لا 403) وشكل الفاعل، لا الإذن.
- **لا مُرحِّل لصندوق الصادر** — الأحداث تُقرأ من الصندوق مباشرةً؛ نشرها خارج الخدمة محلّه Phase 09.

### 5. التفاصيل

- **Files:** `packages/order-e2e/{package.json,tsconfig.json,vitest.config.ts}` · `packages/order-e2e/src/harness.ts` · `packages/order-e2e/src/__tests__/phase06-exit-gate.e2e.test.ts` · `services/orders/src/{index.ts,use-cases/transition-order.ts,use-cases/manage-assignments.ts,infrastructure/in-memory.ts,__tests__/assignments.test.ts}` · `.gitlab-ci.yml` · `docs/12-testing/PHASE06_EXIT_GATE_E2E.md` · `docs/04-api/{ORDER_HTTP.md,ORDER_INTAKE_HANDOVER.md}` · `docs/16-progress/{MASTER_PROGRESS.md,ROADMAP.md,HANDOFF_NEXT_STEPS.md,TASK_LOG.md}` · `pnpm-lock.yaml`
- **Services:** `orders` (تصديران) · `customers` (بلا تغيير — تُستهلك كما هي) · `identity` و`geography` (تُستهلكان كما هما)
- **Why:** بوابة الخروج هي الصيغة التنفيذية لجملة المرحلة، لا وصفٌ لها: ما لم تنجح لا تُغلق المرحلة 06.
- **Tests:** `pnpm --filter @wasla/order-e2e test` ⇒ **16/16** (المسح كاملاً في ~1.7s، مخزن ذاكرة) · `pnpm -r test` ⇒ **1402 اختباراً ناجحاً + 1 متجاوَز** بلا قاعدة بيانات · `pnpm -r typecheck` نظيف · وظيفة `order-exit-gate-e2e` ترفع الملف نفسه على Postgres 15.
- **Next:** **Phase 07 — Dispatch & Matching MVP**: قرار مكان المطابقة (خدمة مستقلّة لا داخل المحرّك) ومصدر قائمة المرشّحين والأمواج والمهل — يستحقّ ADR-011 قبل أول سطر. التفصيل في [HANDOFF §11](HANDOFF_NEXT_STEPS.md).
- **Related:** [MR !43](https://gitlab.com/uxxxu/wasla/-/merge_requests/43) · [PHASE06_EXIT_GATE_E2E.md](../12-testing/PHASE06_EXIT_GATE_E2E.md) · [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) · [ORDER_HTTP.md](../04-api/ORDER_HTTP.md) · [ORDER_INTAKE_HANDOVER.md](../04-api/ORDER_INTAKE_HANDOVER.md)

---

## 2026-08-21 · Phase 06 MR 5/6 — محوّل التسليم الإنتاجي: خدمة العميل تُنادي المحرّك فعلاً

**Task:** استبدال `UnavailableOrderIntake` في `services/customers` بمحوّل إنتاجي `HttpOrderIntakePort` ينادي `POST /orders/intake` على 8087، بخريطة حالات مُصرَّحة تُترجم كل إجابة إلى الصفّ والحدث الصحيحين — فيصبح `/health` في خدمة العميل `ok` لأول مرة في تاريخ المشروع. **Status:** Completed · **MR:** [!42](https://gitlab.com/uxxxu/wasla/-/merge_requests/42) · **ADR:** [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · **الوثيقة:** [ORDER_INTAKE_HANDOVER.md](../04-api/ORDER_INTAKE_HANDOVER.md)

### 1. ماذا تم إنجازه

- **`services/customers/src/infrastructure/http-order-intake.ts`** — `HttpOrderIntakePort`: يُرسل `toOrderIntakeRequestDto(request)` (محوّل الخدمة نفسه، لا خريطة ثانية) إلى `POST {ORDER_SERVICE_URL}/orders/intake` بمفتاح تكرار العميل كما هو، ويتحقّق من شكل المرجع العائد (`ORD-##########` + `accepted_at`) قبل أن يُسمّيه قبولاً.
- **خريطة الحالات** كما يُصرّح بها عقد المحرّك: **201/200** نجاح (200 = إعادة نفس المفتاح) · **409 و422** ⇒ `REJECTED` نهائي · **400/415/404 وأي 4xx** ⇒ `UNAVAILABLE` (المحرّك لم يفهمنا: خطؤنا) · **5xx وانقطاع** ⇒ `UNAVAILABLE` قابل لإعادة المحاولة بنفس المفتاح · **لا إجابة** ⇒ `TIMEOUT`.
- **`src/ports.ts`** — `OrderIntakeCallContext { traceId? }` معاملاً ثانياً **اختيارياً** في `submitOrderRequest`، فلا مُهيّئ قائم يتغيّر.
- **`src/use-cases/order-requests.ts`** — سطر واحد: تمرير `deps.traceId` بجانب الحمولة لا داخلها.
- **`src/http/server.ts`** — `buildOrderIntake()`: `ORDER_SERVICE_URL` ⇒ المحوّل و`order_intake: configured`، وغيابه ⇒ `UnavailableOrderIntake` و`unconfigured`؛ المُهيّئ وملصق الصحّة يُبنيان معاً فلا يختلفان. و`ORDER_SERVICE_TIMEOUT_MS` (افتراضي 2000).
- **`src/__tests__/http-order-intake.test.ts`** — **17 اختباراً** على مُنصت حقيقي على منفذ محلي (لا `fetch` مُزيَّف).
- **`packages/customer-e2e/src/order-intake-http.ts`** — توثيق فقط: يُشير إلى محوّل الإنتاج ويُعلن **لماذا لا يستورده** (بوابة Phase 04 إثبات مُجمَّد).

### 2. لماذا تم اختياره

- **200 نجاحٌ لا تعارض** — البديل الأرخص (كل ما ليس 201 فشل) يقلب صفّاً `submitted` إلى `submission_failed` عند إعادة محاولة بريئة، فيُخبر العميل أن طلبه لم يصل وهو واصل.
- **409 رفض نهائي لا انقطاع** — لو صُنّف انقطاعاً لدخلنا حلقة إعادة محاولة أبدية لطلب سيُرفض بنفس الجواب أبداً؛ وأنه خطؤنا يُقال في الرسالة والسجلّ لا في كود يراه العميل.
- **400 انقطاع لا رفض** — نصّ عقد المحرّك: «`400` يعامله المُسلِّم كخطئه». تصنيفه رفضاً يُخبر العميل أن طلبه مرفوض والحقيقة أنه لم يُفهَم، ويضيع التنبيه الذي كان يجب أن يصلنا.
- **`TIMEOUT` منفصلاً** — «لم يصل» و«لا نعرف» حقيقتان تشغيليتان مختلفتان، ومن يُشغّل النظام يحتاج التمييز عند التسوية.
- **السياق معاملاً لا حقلاً في الحمولة** — الحمولة عقد منشور ومعرّف الارتباط نقل؛ خلطهما يُنتج `trace_id` في مخطّط طلب.
- **لا مُهيّئ تطوير متسامح للمحرّك** — مُهيّئ «يقبل» بلا محرّك يكتب صفوفاً تقول إن طلب عميل وصل إلى محرّك غير موجود، وهو ما يمنعه §53.

### 3. الديون والحدود المُعلَنة

- لا حلقة إعادة محاولة داخل المحوّل (متى نُعيد قرارٌ يخصّ تجربة العميل والطوابير؛ إعادة مخفيّة تضرب مهلة العميل في عددها).
- لا مصادقة بين الخدمتين (Phase 06) · لا قراءة للطلبات (المقبس بدالة واحدة) · غموض المهلة بلا تسوية آلية حتى ناشر الصادر (Phase 09).

### 4. الملفات/الخدمات المتأثرة

- **Files:** `services/customers/src/infrastructure/http-order-intake.ts` · `services/customers/src/{ports.ts,index.ts,http/server.ts,use-cases/order-requests.ts}` · `services/customers/src/__tests__/http-order-intake.test.ts` · `packages/customer-e2e/src/order-intake-http.ts` · `docs/04-api/{ORDER_INTAKE_HANDOVER.md,CUSTOMER_HTTP.md,ORDER_HTTP.md}` · `docs/16-progress/*`
- **Services:** `@wasla/customers-service` (المحرّك لم يتغيّر بحرف)
- **Why:** الوعد المكتوب في Phase 04 كان «استبدال مُهيّئ واحد ولا شيء آخر»؛ MR 4/6 جعلت المحرّك قابلاً للتشغيل، وهذه الدفعة تُثبت أن الحدّ كان مرسوماً صحيحاً — المجال وحالات الاستخدام لم تتغيّر (إلا سطر السياق).
- **Tests:** `pnpm -r typecheck` ✅ · `pnpm -r test` ✅ (`@wasla/customers-service` **117 اختباراً** في 9 ملفات، منها 17 للمحوّل) · **تسليم حقيقي بين خدمتين تعملان:** 201 ⇒ `ORD-0000000001`، إعادة نفس المفتاح ⇒ نفس المرجع بلا طلب ثانٍ، قراءة الطلب = `published`، قراءته بعميل آخر = **404**، ملاحظة 400 محرف ⇒ `UNAVAILABLE` لا `REJECTED`، و`x-request-id` ظهر في سجلّ المحرّك خيطَ ارتباط واحد · `/health` للعميل = `{"status":"ok","order_intake":"configured"}`.
- **Next:** MR 6/6 — `packages/order-e2e`: بوابة خروج Phase 06 تسوق **هذا المحوّل** إلى `createOrderApp` الحقيقي فوق HTTP، ثم إغلاق الطور.
- **Related:** [MR !42](https://gitlab.com/uxxxu/wasla/-/merge_requests/42) · [ORDER_INTAKE_HANDOVER.md](../04-api/ORDER_INTAKE_HANDOVER.md) · [ORDER_HTTP.md](../04-api/ORDER_HTTP.md) · [HANDOFF §10](HANDOFF_NEXT_STEPS.md)

---

## 2026-08-21 · Phase 06 MR 4/6 — طبقة HTTP لمحرّك الطلبات على المنفذ 8087 (الخدمة صارت قابلة للتشغيل)

**Task:** ربط المسارات السبعة المنشورة في `services/orders/contracts/api.openapi.yml` بحالات الاستخدام عبر Fastify، بمقبس معاملة صريح (`OrderRunner`) يجعل كل كتابة داخل وحدة عمل واحدة، وبنطاق مالك يجيب **404 لا 403** على قراءة طلب عميل آخر — **بلا تغيير في `src/use-cases/`**. **Status:** Completed · **MR:** [!41](https://gitlab.com/uxxxu/wasla/-/merge_requests/41) · **ADR:** [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) · **الوثيقة:** [ORDER_HTTP.md](../04-api/ORDER_HTTP.md)

### 1. ماذا تم إنجازه

- **`src/runner.ts`** — `OrderRunner {write, read}` و`createDirectRunner(deps)`: مقبس واحد يحمل قرار المعاملة. المصنع لا يستقبل `deps` أبداً، فلا يمكن لمعالج مسار أن ينسى فتح معاملة.
- **`src/infrastructure/drizzle/runner.ts`** — `PostgresOrderRunner(db, {clock, ids})`: `write` عبر `PostgresOrderUnitOfWork.run` (الكتابة الثلاثية ذرّية) و`read` على الاتصال الجذري بلا معاملة.
- **`src/http/requests.ts`** — ترجمة السلك → المجال، وقراءة الترويسات بحدودها (`Idempotency-Key` 8–128 · `X-Customer-Public-Id` بشكل `WS-` · `x-request-id` ≤128)، و**ترويسة مكرّرة تُرفض** بدل تخمين أيّ قيمة تُحتسب، و`toOrderRef` يقبل UUID أو `ORD-##########`.
- **`src/http/errors.ts`** — `OrderError` → `{code, message, trace_id}` بالحالة التي قرّرها الكتالوج؛ أخطاء Fastify للجسم (400/415) ⇒ `ORDER_VALIDATION_FAILED`، وما تبقّى ⇒ `ORDER_ENGINE_UNAVAILABLE` (503). **404 لمسار غير موجود لا يُترجَم إلى `ORDER_NOT_FOUND`.**
- **`src/http/app.ts`** — `createOrderApp({runner, health?, logger?})`: سبعة مسارات + `/health`. الاستلام **201** جديد و**200** إعادة تشغيل مفتاح؛ تسجيل عرض **201** وحسمه **200**.
- **`src/http/server.ts`** — التركيب النهائي: `DATABASE_URL` ⇒ Postgres، وإلا مُهيّئات الذاكرة و`/health` = `degraded`؛ `SystemClock` و`CryptoIdGenerator` (لا مُعرّفات قابلة للعدّ في الإنتاج)؛ إغلاق التجمّع في `onClose` واستجابة لـSIGTERM/SIGINT.
- **`packages/contracts/order`** — كتالوجات القيم المغلقة وقت التشغيل (`ORDER_TYPES` … `ORDER_SHIPMENT_TYPES`) لأن الأنواع تتبخّر عند التشغيل والحدّ يجب أن يرفض عضواً مجهولاً بـ400 لا أن يحمله إلى الداخل؛ **+11 اختباراً** تقارن كل كتالوج بتعداد OpenAPI (119 إجمالاً).
- **`src/domain/validation.ts`** — `assertNotes` (≤300): كان القيد في `schema.sql` بلا مقابل في المجال، فمخزن الذاكرة يقبل ملاحظة بـ400 محرف وPostgres يرفضها بـ503. صار الرفض **400 من المجال** في المحوّلين معاً.
- **`src/__tests__/http/app.test.ts`** — **46 اختباراً** عبر `app.inject`.

### 2. لماذا تم اختياره

- **`OrderRunner` لا `deps` في المصنع** — الكتابة ثلاثية وذرّيتها سُدّت في MR 3/6؛ لو استقبل المصنع التبعيات لكان على كل مسار أن يتذكّر المعاملة، ونسيانٌ واحد يكسر الذرّية بصمت.
- **404 لا 403 لطلب عميل آخر** — `order_public_id` تسلسلي، فـ403 يحوّل المسار إلى **عرّاف وجود** يُعدّ به طلبات المنصّة. القاعدة مُثبَّتة باختبار لا بذاكرة مُراجع.
- **`assertNotes` في المجال لا في HTTP** — Phase 07 سيُنادي حالات الاستخدام مباشرة، فقاعدةٌ تُكتب في الواجهة قاعدةٌ لا يراها المستهلك الداخلي.
- **`{orderId}` يقبل المُعرّف العام أيضاً** (انحراف مُعلَن رقم 2) — استجابة الاستلام تُعيد `order_public_id` فقط، ولا يجب أن نكشف مُعرّفاً داخلياً ثانياً كي تصبح القراءة ممكنة.

### 3. الديون والحدود المُعلَنة

- مفتاح التكرار في `PATCH …/assignments/{id}` مطلوب ومُسجَّل بلا إلغاء تكرار حقيقي (الحسم المزدوج يُرفض بـ409 أصلاً).
- **لا مصادقة**: الشكل فقط (`actor_ref` مع البشري وممنوع مع `system`).
- لا ناشر لصندوق الصادر (Phase 09) · غلاف الخطأ بلا `details` مطابقةً للعقد.

### 4. الملفات/الخدمات المتأثرة

- **Files:** `services/orders/src/http/{app,errors,requests,server}.ts` · `services/orders/src/runner.ts` · `services/orders/src/infrastructure/drizzle/runner.ts` · `services/orders/src/infrastructure/in-memory.ts` · `services/orders/src/domain/validation.ts` · `services/orders/src/index.ts` · `services/orders/package.json` · `services/orders/src/__tests__/http/app.test.ts` · `packages/contracts/order/src/{index.ts,__tests__/contracts.test.ts}` · `docs/04-api/ORDER_HTTP.md` · `docs/16-progress/{MASTER_PROGRESS,ROADMAP,HANDOFF_NEXT_STEPS,TASK_LOG}.md`
- **Services:** `@wasla/orders-service` · `@wasla/contracts-order`
- **Why:** الخدمة كانت مكتملة المجال والاستمرارية و**غير قابلة للتشغيل**؛ ولا يمكن أن تبدأ MR 5/6 (استبدال `UnavailableOrderIntake`) بلا مسار HTTP حقيقي تُنادى عليه.
- **Tests:** `pnpm -r typecheck` ✅ · `pnpm -r test` ✅ (`@wasla/orders-service` **621** في 8 ملفات · `@wasla/contracts-order` **119**) · تشغيل فعلي: `PORT=8099 node --import tsx src/http/server.ts` ⇒ `/health` = `{"status":"degraded","persistence":"memory"}` واستلام طلب = **201**.
- **Next:** MR 5/6 — `HttpOrderIntakePort` في `services/customers` بدل `UnavailableOrderIntake`، ثمّ MR 6/6 — `packages/order-e2e` وبوابة خروج Phase 06.
- **Related:** [MR !41](https://gitlab.com/uxxxu/wasla/-/merge_requests/41) · [ORDER_HTTP.md](../04-api/ORDER_HTTP.md) · [HANDOFF §10](HANDOFF_NEXT_STEPS.md)

---

## 2026-08-21 · Phase 06 MR 3/6 — استمرارية Drizzle/Postgres لمحرّك الطلبات + وحدة عمل تُسدّ دَين الذرّية

**Task:** تنفيذ التخزين الدائم والكتابة الثلاثية الذرّية لمحرّك الطلبات: مرآة Drizzle لـ`schema.sql`، ومُهيّئات Postgres وراء المنافذ نفسها، و**`PostgresOrderUnitOfWork`** يفتح معاملة واحدة ويسلّم نفس المقبض للمستودع والصادر، فلا تُكتب حالة دون تدقيقها وصادرها — **بلا تغيير في `src/use-cases/`**. **Status:** Completed · **MR:** [!40](https://gitlab.com/uxxxu/wasla/-/merge_requests/40) · **ADR:** [ADR-010 §127](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) · **الوثيقة:** [ORDER_PERSISTENCE.md](../02-architecture/ORDER_PERSISTENCE.md)

### 1. ماذا تم إنجازه

خدمة الطلبات صارت تملك مسار تخزين دائماً وذرّياً في `services/orders/src/infrastructure/drizzle/`:

- **`schema.ts`** — مرآة Drizzle للجداول الخمسة + متتالية `order_public_id_seq`. الفروقات المعروفة مُوثَّقة: `event_id` في `order_outbox` مفتاح أساسي (لا `bigserial`)، و`sequence` للأوقفات/الإسناد `smallint`، وFK `fk_orders_active_assignment` يُضاف بـ`ALTER TABLE` لاعتماد متبادل.
- **`db.ts`** — `createOrderDb(config)` و`Db`/`DbOrTx` (يقبل الجذر أو مقبض معاملة).
- **`repository.ts`** — `PostgresOrderRepository` (القراءات الكاملة + الكتابات الذرّية داخل المعاملة) · `PostgresOrderOutbox` (إلحاق ونشر بأسماء الأعمدة) · `PostgresOrderPublicIdGenerator` (`nextval` للمتتالية) — كلّها تقبل `DbOrTx`. `translateWriteError` يُحوّل SQLSTATE 23505/23503/23514 إلى كوديات المجال بأسماء القيود.
- **`transaction.ts`** — `PostgresOrderUnitOfWork.run(shared, callback)` يفتح `db.transaction` ويُنشئ المُهيّئات الثلاثة على نفس `tx` ويسلّمها للاستخدام.
- **`__tests__/`** — `schema-drift.test.ts` (17 حراسة انحراف بلا قاعدة) · `postgres-repository.integration.test.ts` (19 اختبار مستودع) · `atomicity.integration.test.ts` (4 اختبارات ذرّية، أحدها يفشل بعد عودة حالة الاستخدام فيُثبت أنّ صفّ الصادر الحقيقي غائب) · `port-conformance.integration.test.ts` (7 سيناريوهات تُكتب مرّة وتُنفَّذ على الذاكرة وPostgres بصادر حقيقي) · **30 اختبار تكامل**. إجمالي المستودع **1323 اختباراً**.
- **`.gitlab-ci.yml`** — وظيفة `order-db-integration` (postgres:15 + `wasla_orders_test` + `fileParallelism: false`).
- **الوثيقة** `docs/02-architecture/ORDER_PERSISTENCE.md` + تحديث لوحة المراحل وخارطة الطريق ووثيقة التسليم §10.

### 2. لماذا تم اختياره

- **وحدة العمل لا نشر الحدث في حالة الاستخدام** — سدّ الذرّية بتغيير `use-cases/` كان سيكسر المعيار الذي تقوم عليه المرحلة كلّها («أي اضطرار لتغيير سلوك هناك دليلٌ على أن المخطّط بدأ يقود المجال»). وحدة العمل تُسدّها **خارج** المجال: الاستخدامات تعمل كما هي، والمعاملة تُغلّفها.
- **`DbOrTx` لا `Db` فقط** — المُهيّئ نفسه يعمل على الجذر (للقراءات خارج المعاملة) وداخل المعاملة (للكتابات الذرّية)، فلا نُكرّر مُهيّئاً ثانياً.
- **`nextval` للمعرّف العام لا عدّاد تطبيقي** — القاعدة هي مصدر الحقيقة للمعرّف، فلا تصادم بين نسختين، ولا يحتاج التطبيق لحفظ آخر قيمة.

### 3. الديون المُعلَنة

- `nextval()` ليس ذرّياً في PostgreSQL — قد تظهر فجوات في الترقيم بعد التراجع/إعادة المحاولة، والمُلزَم هو التفرّد والرتابة لا التسلسل بلا فجوات.
- لا ناشر لصندوق الصادر بعد — محله Phase 09. الذرّية تضمن أنّ الحدث إن وُجد فهو ملتزم مع الطلب، لكنه قد يبقى غير منشور.
- لا HTTP بعد — الخدمة غير قابلة للتشغيل حتى MR 4/6.

### 4. الملفات/الخدمات المتأثرة

- **Files:** `services/orders/src/infrastructure/drizzle/{schema,db,repository,transaction}.ts` · `services/orders/src/__tests__/{schema-drift,postgres-repository.integration,atomicity.integration,port-conformance.integration,pg-harness}.{test,ts}` · `services/orders/{drizzle.config,vitest.integration.config}.ts` · `services/orders/package.json` · `.gitlab-ci.yml` · `docs/02-architecture/ORDER_PERSISTENCE.md` · `docs/16-progress/{MASTER_PROGRESS,ROADMAP,HANDOFF_NEXT_STEPS,TASK_LOG}.md`
- **Services:** `@wasla/orders-service`
- **Why:** سدّ دَين الذرّية ([ADR-010 §127](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md)) بلا تغيير في حالات الاستخدام، وإثبات أنّ المخزنَين (ذاكرة/Postgres) يُنتجان نفس النتيجة والأحداث.
- **Tests:** `pnpm -r run typecheck` ✅ · `pnpm -r run test` (افتراضي 575) ✅ · `pnpm -F @wasla/orders-service run test:integration` (تكامل 30) ✅ على Postgres 18.6 حقيقي.
- **Next:** MR 4/6 — طبقة HTTP على المنفذ 8087 + مسارات سبعة + `/health`.
- **Related:** [MR !40](https://gitlab.com/uxxxu/wasla/-/merge_requests/40) · [ORDER_PERSISTENCE.md](../02-architecture/ORDER_PERSISTENCE.md) · [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md)

---

## 2026-08-21 · Phase 06 MR 2/6 — طبقة مجال محرّك الطلبات: الجدول كوداً يُنفَّذ، ومسح الـ441 زوجاً

**Task:** تنفيذ السلوك الذي نشرته MR 1/6 كعقد: جدول الانتقالات الاثنان والسبعون داخل الكود بحارس مطابقة مزدوج مع الوثيقة، وحالات الاستخدام الأربع (استلام · انتقال · إسناد · قراءة)، ومُهيّئات ذاكرة تُطبّق قيود `schema.sql` بأسمائها — **بلا قاعدة وبلا HTTP**. **Status:** Completed · **MR:** [!39](https://gitlab.com/uxxxu/wasla/-/merge_requests/39) · **ADR:** [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) · **الوثيقة:** [ORDER_CORE_DOMAIN.md](../02-architecture/ORDER_CORE_DOMAIN.md)

### 1. ماذا تم إنجازه

مشروع العمل العشرون `@wasla/orders-service` — طبقة مجال كاملة في `services/orders/src/`:

- **`domain/state-machine.ts`** — جدول `ORDER_TRANSITIONS` بـ**72 صفّاً صريحاً**، كل صفّ `{from, to, expectedActor, typicalReason}`. والاشتقاقات محسوبة من الجدول لا مُعلَنة: `DERIVED_TERMINAL_STATUSES` · `reachableStatuses`/`unreachableStatuses` · `requiresReasonCode` · `allowedTargets` · `assignmentRequirement` بثلاث درجات (`required` 6 · `forbidden` 4 · `optional` 11) · وثابتان مُصدَّران `ORDER_TRANSITION_COUNT` (72) و`ORDER_TRANSITION_SPACE` (441).
- **`domain/{model,errors,validation,events}.ts`** — الكيانات والأوامر بـcamelCase · `OrderError` من كتالوج العقود بحالة HTTP مُشتقّة · تحقّق نقيّ (وضع السعر · النقاط · الشحنة · شكل الفاعل · المعرّفات · اللحظات) · أربعة مصانع أحداث تبني المغلّف نفسه.
- **`ports.ts`** — خمسة منافذ في `OrderDependencies`: `OrderRepository` · `Outbox` · `Clock` · `IdGenerator` · `OrderPublicIdGenerator`.
- **`use-cases/`** — `ingest-order.ts` (بصمة + ثلاث نتائج idempotency + رابعة للطلب المُسلَّم سابقاً) · `transition-order.ts` (ترتيب فحص ثابت) · `manage-assignments.ts` (تسجيل وحلّ) · `read-order.ts` (بالمعرّفين).
- **`mappers.ts`** — الترجمة المجال ⇄ العقد في موضع واحد.
- **`infrastructure/in-memory.ts`** — مستودع يُطبّق القيود المسمّاة بنفسه + `FixedClock` + `SequentialIdGenerator` + `InMemoryOutbox`.
- **`__tests__/`** — ستّة ملفات، **558 اختباراً**، منها مسح 441 زوجاً وحارس مطابقة مزدوج مع الوثيقة.
- **الوثيقة** `docs/02-architecture/ORDER_CORE_DOMAIN.md` + تحديث لوحة المراحل وخارطة الطريق ووثيقة التسليم §10.

### 2. لماذا تم اختياره

**لماذا الجدول صريح داخل الكود ولماذا الوثيقة هي المصدر:** قيمة المحرّك في ما يمنعه، وقواعد المنع إن كُتبت في مُعالِج HTTP أو في `CHECK` صارت غير قابلة للقراءة كوحدة. والجدول الصريح يجعل ثلاثة أسئلة قابلة للحساب: كم انتقالاً مسموحاً · أي حالة لا تُبلَغ · أي نهائية لها مخرج. و**حارس المطابقة المزدوج** يمنع ما يحدث دائماً بمرور الوقت: أن يتقدّم الكود وتبقى الوثيقة. صفٌّ في الكود غير موثّق يُسقط المجموعة، وصفٌّ موثّق غير مُنفَّذ كذلك.

**لماذا أُنجز مسح الـ441 زوجاً الآن لا في MR 6/6:** بوابة الخروج ستُعيده على التركيب الكامل، لكن تأجيله كان سيعني بناء ثلاث دفعات (استمرارية · HTTP · تسليم بين خدمتين) فوق آلة حالة لم يُتحقَّق منها إلا بالعيّنة. المسح في طبقة المجال يعمل في 137 مللي ثانية بلا قاعدة، فلا سبب لتأجيله.

**لماذا الاشتقاق لا الإعلان:** `is_terminal` مكتوبةٌ يدوياً تُنسى عند إضافة حالة؛ محسوبةٌ من الجدول تستحيل أن تكذب. وكذلك النهائيات: تُشتقّ ثم تُقارن بالعقد، فسهمٌ يُضاف خارج `expired` غداً يُسقط الاختبار بدل أن تبقى ثابتة العقد تكذب على الجدول.

**قرارات لكلٍّ منها نسخة أرخص وخاطئة:**

| القرار | النسخة الأرخص وسبب رفضها |
|---|---|
| ترتيب الفحص: 404 → 409 (الجدول) → 422 (السبب) → 422 (الفاعل) → 422 (الإسناد) | فحص السبب أولاً: يخرج للمنادي «سبب مفقود» على انتقالٍ ما كان ليُقبَل بأي سبب |
| الفاعل: **الشكل** مُلزَم والهوية لا، ومكتوب صراحةً | إلزام العمود بلا مصادقة: يُقرَأ العمود كضمان أمني غير موجود |
| القبول لا يُحرّك حالة الطلب | تحريكها في `resolveAssignment`: تغييرُ حالةٍ واحد لم يمرّ بالجدول ⇒ ثغرة في الضمان كلّه |
| لا فرع «تحرير» في حلّ العرض | فرع يفكّ إسناداً نشطاً: كود غير قابل للوصول يتنكّر في هيئة حارس، ويُوهم أن لفكّ الإسناد مالكين |
| البصمة تتجاهل `traceId` والمفتاح | حساب البصمة من الحمولة كاملة: إعادة محاولة بتتبّع جديد تُقرأ طلباً مختلفاً ⇒ 409 على تكرار مشروع |
| رابعة للاستلام: `ORDER_REQUEST_ALREADY_INGESTED` | الاعتماد على المفتاح وحده: المفتاح يحمي من تكرار **النداء**، لا من تسليم **الطلب** عبر نداءين مختلفين |

### 3. أين تم التغيير

- **جديد:** `services/orders/{package.json,tsconfig.json,vitest.config.ts}` · `services/orders/src/index.ts` · `src/domain/{state-machine,model,errors,validation,events}.ts` · `src/ports.ts` · `src/mappers.ts` · `src/infrastructure/in-memory.ts` · `src/use-cases/{ingest-order,transition-order,manage-assignments,read-order}.ts` · `src/__tests__/{harness,state-machine,transition-order,ingest-order,assignments,read-order,mappers}.ts`
- **جديد:** `docs/02-architecture/ORDER_CORE_DOMAIN.md`
- **مُحدَّث:** `docs/16-progress/{MASTER_PROGRESS,ROADMAP,HANDOFF_NEXT_STEPS,TASK_LOG}.md` · `pnpm-lock.yaml`

### 4. الملفات/الخدمات المتأثرة

`services/orders` **وحدها** (جديدة). لا تغيير في `services/customers` ولا `services/identity` ولا `services/geography` ولا في أي حزمة قائمة ولا في `.gitlab-ci.yml`. الاعتماد الوحيد للحزمة الجديدة: `@wasla/contracts-order` (workspace) + `vitest` و`@types/node` تطويراً — **لا حزمة خارجية جديدة** (§7 من قانون التوثيق: لا مبرّر مطلوب لأنه لم يُضَف شيء).

### 5. ما الـAPI/Event/Schema الذي تغير

**لا شيء.** الدفعة تُنفّذ العقود المنشورة في MR 1/6 ولا تُعدّلها: لا مسار OpenAPI جديد · لا حدث جديد · لا تعديل على `schema.sql` · لا كود خطأ جديد (الثمانية عشر كما هي) · لا سبب جديد (الأربعة والعشرون كما هي). و`ORDER_TRANSITIONS` في الكود يُطابق [ORDER_ENGINE §4](../03-domain/ORDER_ENGINE.md) صفّاً بصفّ في الاتجاهين — وهذا **مُختبَر لا موصوف**.

### 6. كيف تم الاختبار

**558 اختباراً** لمحرّك الطلبات (`pnpm --filter @wasla/orders-service test`، ~1.4 ثانية، بلا قاعدة ولا شبكة):

| الملف | العدد | ما يُثبته |
|---|---|---|
| `transition-order.test.ts` | 459 | **مسح 441 زوجاً** (طلب يُساق بأقصر مسار BFS إلى كل حالة ثمّ يُجرَّب الانتقال إلى كل حالة) + التدقيق + الأحداث + الأسباب + شكل الفاعل + حرّاس الإسناد + 404 |
| `state-machine.test.ts` | 28 | حارس المطابقة المزدوج مع الوثيقة + شكل الرسم + النهائيات المشتقّة + الوصول + قرارات ADR-010 + اقتران الإسناد |
| `ingest-order.test.ts` | 27 | ثلاث نتائج idempotency + رابعة · البصمة تتجاهل التتبّع · اللحظتان · الحدثان · التحقّق · لا كتابة عند الفشل |
| `assignments.test.ts` | 19 | العرض سجل لا محرّك · التكرار 409 · الحلّ مرّة واحدة · التراجع انتقالٌ لا تحريرٌ · الرفض لا يُنهي الطلب |
| `mappers.test.ts` | 14 | رحلة ذهاب وعودة · إحداثيتان كاملتان أو `null` · لا تسريب للمفتاح ولا للبصمة |
| `read-order.test.ts` | 11 | القراءة بالمعرّفين · **حدث لكل صفّ تاريخ عبر رحلة كاملة** · العنونة · عزل الطلبات |

**خصائص [ORDER_ENGINE §5](../03-domain/ORDER_ENGINE.md): 1–11 كلّها مُثبَتة** (12 = تطابق المخزنين، محلّها MR 3/6).

**التحقّق على المستودع كاملاً:** `pnpm -r run typecheck` نظيف على **20 مشروع عمل**، و`pnpm -r run test` = **1293 اختباراً على 19 مشروع اختبار** (+1 متروك بقصد) — كان 735 على 18 قبل الدفعة. وخطّ التكامل أخضر بثماني وظائف.

### 7. ما المشاكل التي ظهرت

1. **`TransitionRequest.reason_code` مُكتَّب `string` في الأنواع المُولَّدة من OpenAPI** لا كاتحاد محصور، فـ`transitionCommandFromWire` كان سيُسرّب نصّاً حرّاً إلى المجال. **الحلّ:** المُخطِّط ينادي `assertReasonCodeKnown` ثمّ يُضيّق النوع — فالحدّ يرفض ما لا يعرفه بدلاً من تصديقه، ويُختبَر بسبب مُختلَق (`MADE_UP`).
2. **`shortestPath` في مُهيّئ الاختبار كان يُعيد `OrderStatus[]`** بينما المستهلك يستحيل أن يستقبل `published` (فهي نقطة البداية) — أنتج خطأ نوع صامتاً في `strict`. **الحلّ:** ضُيِّق النوع إلى `Exclude<OrderStatus, "published">` بتعليق يشرح لماذا، بدل تخفيف `strict` أو حَشْو `any`.
3. **فرع «تحرير» في `resolveAssignment` كان كوداً غير قابل للوصول:** كُتب ليفكّ إسناداً نشطاً عند الإلغاء، لكن الحلّ لا ينطبق إلا على عرضٍ `offered` والعرض النشط `accepted` بالضرورة. **الحلّ:** حُذف الفرع وكُتب في مكانه تعليق يشرح أن لفكّ الإسناد **مالكاً واحداً** هو `transitionOrder`، وأُبدل الاختبار ليُثبت القاعدة الصحيحة: التراجع بعد القبول انتقالٌ إلى `driver_cancelled` والقبول يبقى في التاريخ.
4. **متغيّران غير مستعملين** بعد إعادة صياغة اختبارين (`noUnusedLocals`)، و`.catch()` أضاع تضييق النوع فصار `OrderError | TransitionOutcome`. **الحلّ:** استُعمل `.then(onOk, onErr)` بدل `.catch`.

**لا مشكلة في المطابقة مع الوثيقة:** الجدولان تطابقا من أول تشغيل (72/72، فرقا المجموعتين خاليان).

### 8. ما الذي لم يكتمل

- **لا استمرارية ولا HTTP** — الخدمة **غير قابلة للتشغيل**: المُهيّئ الوحيد للمستودع في الذاكرة، ولا تطبيق على المنفذ 8087.
- **لا ذرّية بين المستودع والصادر** — `InMemoryOrderRepository` و`InMemoryOutbox` منفذان بلا حدّ معاملة. الكتابة الثلاثية (حالة · تدقيق · صادر) في معاملة واحدة هي عمل MR 3/6 صراحةً (§7 من ORDER_ENGINE).
- **الخاصية 12 (تطابق المخزنين)** غير مُثبَتة لعدم وجود مخزن ثانٍ — والمجموعة مكتوبة أصلاً لتُشغَّل عليه بلا تعديل.
- **لا إلزام لهوية الفاعل** — الشكل فقط، لعدم وجود مصادقة في المرحلة.
- **`UnavailableOrderIntake` باقٍ في `services/customers`** — يُستبدل في MR 5/6 لا قبلها.

### 9. الخطوة التالية

**MR 3/6 — الاستمرارية:** مرآة Drizzle لـ`schema.sql` · `PostgresOrderRepository` و`PostgresOrderOutbox` · **الكتابة الثلاثية في معاملة واحدة** · اختبارات حراسة انحراف تقرأ `schema.sql` فعلياً · **اختبارات مطابقة منافذ تُكتَب مرّة وتُنفَّذ مرّتين** (ذاكرة/Postgres) لإثبات الخاصية 12 · وظيفة CI `order-db-integration` (مُشار إليها أصلاً في `vitest.config.ts` الذي يستثني `*.integration.test.ts`).

**المعيار الملزم:** تُنفَّذ **بلا تغيير في `src/use-cases/`** — أي اضطرار لتغيير سلوك هناك دليلٌ على أن المخطّط بدأ يقود المجال (نفس المعيار المكتوب في Phase 04 MR 3/6).

### 10. ما الذي يعتمد عليه العمل التالي

- **`OrderDependencies` هو نقطة الحقن الوحيدة** — أي مُهيّئ جديد يدخل من خلاله فلا يمسّ حالات الاستخدام.
- **`InMemoryOrderRepository` هو المواصفة التنفيذية لمُهيّئ Postgres:** القيود التي يُطبّقها بأسمائها (`ux_order_status_history_order_sequence` · `ux_order_assignments_order_driver` · `ck_orders_assignment_matches_status` …) هي ما يجب أن يُطابقه المُهيّئ الحقيقي، وأخطاؤه هي الرسائل التي على مُهيّئ Postgres أن يُترجم إليها (نفس درس Phase 04 MR 3/6: الترجمة بمشي سلسلة `cause`).
- **ترتيب الفحص في `transitionOrder` عقدٌ لطبقة HTTP** (MR 4/6): تخطيط الأكواد إلى حالات HTTP يعتمد عليه.
- **`ORDER_TRANSITION_SPACE` (441) ثابت مُصدَّر** — على MR 6/6 استيراده لا إعادة حسابه.
- **مُهيّئ الاختبار `__tests__/harness.ts`** (`shortestPath`/`driveTo`/`orderInStatus`) هو ما تبني عليه بوابة الخروج مسحها، فتوسيعه أرخص من كتابة سَوق حالة جديد.

### 11. Migration/Deployment/Config

**لا شيء.** لا هجرة (لا مساس بالمخطّط) · لا متغيّر بيئة جديد · لا خدمة تُنشَر (الحزمة `private` بلا `main` ولا تُبنى إلى `dist` في CI) · لا تعديل على `.gitlab-ci.yml` — الحزمة تدخل تلقائياً في `pnpm -r run typecheck` و`pnpm -r run test` داخل وظيفة `build-test`. **مُلاحظة للدفعات القادمة:** `pnpm-lock.yaml` مُحدَّث ومدفوع مع الدفعة (وظيفة `build-test` تعمل بـ`--frozen-lockfile`).

### 12. مخاطر/قرارات تحتاج مراجعة

| البند | التقييم |
|---|---|
| **حارس المطابقة يعتمد على تنسيق جداول Markdown في الوثيقة** | مقبول ومقصود: إعادة تنسيق §4 ستُسقط الاختبار — وهذا هو الغرض (الوثيقة عقد لا تعليق). لكن **مَن يُعدّل §4 يجب أن يُعدّل الجدول في الكود في الدفعة نفسها**. |
| **عدم إلزام هوية الفاعل** | دَين **مُعلَن** لا مُكتشَف: مكتوب في الكود وفي §4.4 من الوثيقة المعمارية وفي §10 من وثيقة التسليم. محلّه Phase 09+. |
| **لا ذرّية بين المستودع والصادر** | نفس دَين Phase 04، وهنا **محدَّد الموضع والدفعة**: MR 3/6 وليس أبعد، لأن الكتابة الثلاثية جزء من بوابة خروج المرحلة (§7). |
| **`FixedClock` يبدأ من 2026-01-01Z** | اختباري فقط. لا يُستعمل في تركيب إنتاجي (لا تركيب إنتاجي بعد). |
| **حالة `under_review` من الدرجة `optional`** | مقصود: المراجعة قد تحدث على طلب بسائق مربوط أو بلا سائق. مُختبَر ومطابق للقيد في `schema.sql`. |

### 13. الروابط

- **MR:** [!39](https://gitlab.com/uxxxu/wasla/-/merge_requests/39) · السابقة: [!38](https://gitlab.com/uxxxu/wasla/-/merge_requests/38) (MR 1/6)
- **ADR:** [ADR-010 — موضع محرّك الطلبات وآلة الحالة وحدّ الإسناد](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md)
- **الوثائق:** [ORDER_CORE_DOMAIN.md](../02-architecture/ORDER_CORE_DOMAIN.md) · [ORDER_ENGINE.md](../03-domain/ORDER_ENGINE.md) · [عقود الخدمة](../../services/orders/contracts/README.md)
- **التقدّم:** [MASTER_PROGRESS](MASTER_PROGRESS.md) · [ROADMAP](ROADMAP.md) · [HANDOFF §10](HANDOFF_NEXT_STEPS.md)
- **النمط المُتّبع:** [CUSTOMER_CORE_DOMAIN.md](../02-architecture/CUSTOMER_CORE_DOMAIN.md) (Phase 04 MR 2/6)

### 14. الشخص/الفريق الذي يتابع

**@uxxxu** — مالك `/services/orders/` في `CODEOWNERS` (السطر 60). المتابعة المباشرة: **MR 3/6 (الاستمرارية)** حسب §9 أعلاه.

---

## 2026-08-21 · Phase 06 MR 1/6 — ADR-010 وعقود محرّك الطلبات وجدول الانتقالات (72 من 441)

**Task:** بدء Phase 06 (Order Engine) من **حدّها** لا من كودها: تثبيت قرارات المرحلة في ADR، ونشر عقود `services/orders`، وكتابة جدول الانتقالات الكامل، وجعل الوثيقة **مُختبَرة** لا مقروءة. **Status:** Completed · **MR:** [!38](https://gitlab.com/uxxxu/wasla/-/merge_requests/38) · **ADR:** [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) · [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md) · [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) · **الوثيقة:** [ORDER_ENGINE.md](../03-domain/ORDER_ENGINE.md)

**ماذا تم إنجازه (1):** كتبت [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) فثبّتت موضع الخدمة (`services/orders` · `@wasla/orders-service` · المنفذ **8087**) وستّة قرارات حاكمة، ثمّ نشرت عقود الخدمة الأربعة: `schema.sql` بخمسة جداول (`orders` · `order_stops` · `order_status_history` · `order_assignments` · `order_outbox`) ومتتالية `order_public_id_seq` ودالّة trigger، وقيوداً **مُسمّاة** تمنع بالبناء ما كان سيُترك للمراجعة البشرية · `api.openapi.yml` بسبعة مسارات · `events.json` بأربعة أحداث في مغلّف واحد · `errors.md` بـ**18 كود خطأ و24 سبباً** في كتالوج مُغلَق. وأضفت الحزمة الثانية عشرة من العقود `@wasla/contracts-order` بالأنواع المُكتبة و**108 اختباراً**. وكتبت [ORDER_ENGINE.md](../03-domain/ORDER_ENGINE.md) بجدول الانتقالات الكامل: **اثنان وسبعون زوجاً مسموحاً من أصل 441**، صفّاً صفّاً بالفاعل والسبب لكل سهم. و**الوثيقة نفسها صارت مُختبَرة**: `transitions-doc.test.ts` يقرأ §4 من الملف الفعلي (21 اختباراً) فيفشل إن اختلف العدد المعلن في ترويسة القسم عن عدد الصفوف، أو ظهر انتقال ذاتي، أو خرج سهم من حالة نهائية، أو أشار سهم إلى حالة أو سبب غير موجود في الكتالوج، أو صارت حالة **غير قابلة للوصول** من `published`.

**لماذا تم اختياره (2):** بوابة خروج المرحلة في الوثيقة الأم §77 هي «دون **حالات مستحيلة**» — وهي عبارة لا تُختبَر كما كُتبت. فالعمل الأول في المرحلة كان **تعريفها قابلة للقياس** في أربع صور: انتقال خارج الجدول · سهم من حالة نهائية · حالة لا يمكن الوصول إليها · وصفٌّ يخالف قيداً مُسمّى. وكل قرار في ADR-010 له نسخة أرخص وخاطئة رفضتها بحجّة مكتوبة: **(أ) لا حالة `draft`** لأن Phase 04 تُسلّم نيّة **مُتحقَّقة بالفعل** عبر `OrderIntakePort`، فمسوّدة تكرّر تحقّقاً قائماً وتُنتج طلبات معلّقة بلا مالك وبمعرّف عامّ لا يستحقّه شيء. **(ب) جدول صريح لا قاعدة عامة مُشتَقّة** («لا رجوع للخلف» مثلاً): القاعدة العامة تفشل **بصمت** في الحالة الشاذّة، والحالة المستحيلة هي بالضبط الاستثناء الذي تنساه — ولذلك دفعت ثمن كتابة 72 صفّاً يدوياً. **(ج) `driver_public_id` نصّ بقيد CHECK على الشكل بلا FK** لأن المحرّك يخزّن مرجعاً ولا يحكم على أهلية سائق، فلا ينتظر Phase 05 (Driver Core) التي لم تبدأ — وهي خارج المسار الحرج أصلاً، فلا انحراف عن ترتيب [ROADMAP §3](ROADMAP.md) ولا هجرة على من يبني 05 لاحقاً. **(د) `ORD-` + عشرة أرقام من متتالية القاعدة**: لا UUID ظاهر لأن العميل يقرأ الرقم بصوته في محادثة دعم، ولا عدّاد تطبيقي لأنه يتصادم عند أول نسختين. **(هـ) الأحداث بالمنطقة لا بالإحداثية** وبلا نصّ كتبه المستخدم (ADR-007 وسابقة Phase 04). **(و) المحرّك يُسجّل الإسناد ولا يُقرّره**: لا مرشّحين ولا أمواج ولا مهل — تلك مِلْك Phase 07 (§16)، وخلطها هنا كان سيجعل تغيير سياسة توزيع يمسّ آلة الحالة.

**أين تم التغيير (3):** `docs/15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md` (جديد) · `services/orders/contracts/` (جديد: `schema.sql` · `api.openapi.yml` · `events.json` · `errors.md` · `README.md`) · `packages/contracts/order/` (جديد: الحزمة كاملة) · `docs/03-domain/ORDER_ENGINE.md` (جديد) · `docs/02-architecture/CONTAINERS.md` (**§4.2 جديد** + `order` في جدول الحزم §5 + سطر الحالة) · `docs/16-progress/{MASTER_PROGRESS.md,ROADMAP.md,HANDOFF_NEXT_STEPS.md,TASK_LOG.md}`.

**الملفات/الخدمات المتأثرة (4):** خدمة **جديدة** على مستوى العقد: `services/orders` — لا كود تشغيلي بعد. حزمة **جديدة** `packages/contracts/order` (`@wasla/contracts-order`، الحزمة الثانية عشرة من العقود). **لا خدمة قائمة تغيّرت ولا سطر منطق إنتاجي واحد** — `services/customers` لم تُلمس ويظلّ `UnavailableOrderIntake` مُهيّئها حتى MR 5/6. مبرّر الحزمة الجديدة (§7 من قانون التوثيق): الأنواع المُكتبة يستهلكها **أكثر من طرف** — خدمة الطلبات (MR 2–4) وخدمة العملاء (MR 5) وطبقة Dispatch في Phase 07 — فوضعها داخل إحدى الخدمات كان سيجبر الأخرى على الاعتماد على خدمة، وهو ما تمنعه اتجاهات الاعتماد في [CONTAINERS §4.2](../02-architecture/CONTAINERS.md).

**ما الـAPI/Event/Schema الذي تغير (5):** **API (جديد، المنفذ 8087):** `GET /health` · `POST /orders/intake` · `GET /orders/{orderId}` · `GET /orders/{orderId}/history` · `POST /orders/{orderId}/transitions` · `POST /orders/{orderId}/assignments` · `PATCH /orders/{orderId}/assignments/{assignmentId}`. **Events (جديدة، v1):** `OrderCreatedV1` · `OrderStatusChangedV1` · `OrderAssignmentOfferedV1` · `OrderAssignmentResolvedV1` — بمغلّف موحّد ولا حمولة تحمل إحداثية ولا نصّاً كتبه المستخدم. **Schema (جديد):** خمسة جداول ومتتالية ودالّة trigger؛ القيود الحاكمة `ck_orders_assignment_matches_status` · `ck_orders_terminal_needs_reason` · `ck_orders_price_mode_amount` · `ck_orders_money_complete` · `ck_orders_shipment_only_delivery` · `ck_order_stops_coordinates_complete` · `ck_order_status_history_progresses` · `ck_order_status_history_actor_ref` · `ck_order_assignments_state_timestamp` + فرائد التسلسل. **الأخطاء (جديدة، 18):** من `ORDER_VALIDATION_FAILED` و`ORDER_ILLEGAL_TRANSITION` و`ORDER_IDEMPOTENCY_KEY_REUSED` إلى `ORDER_ENGINE_UNAVAILABLE`. **مُطابقة مقصودة مع عقد العميل** في `vehicle_class` (ستّة أصناف بما فيها `truck_small`) وحقول الشحنة (`shipment_type` · `description` · `weight_kg`)، **والانحراف الوحيد المقصود** هو `maxItems: 2` على `stops` وهو موثّق في موضعه.

**كيف تم الاختبار (6):** ثلاث طبقات. **(أ) حراسة العقد** — 38 اختبار عقود + 31 اختبار حدود تقرأ `schema.sql` و`api.openapi.yml` و`errors.md` **فعلياً** فتفشل إن ظهر `draft` في enum، أو FK عبر الخدمات على مرجع السائق، أو مال عشري، أو كود خطأ غير موثّق، أو حمولة حدث تحمل إحداثية. **(ب) حراسة الوثيقة** — 21 اختباراً تُعرِب جدول §4 من ملف الماركداون وتتحقّق من الصور الأربع للحالة المستحيلة، ومنها اختبار وصول (BFS من `published`) يفشل إن صارت حالة معزولة، واختبار يشتقّ الحالات النهائية من الجدول ويطابقها مع `ORDER_TERMINAL_STATUSES`. **(ج) حراسة الأحداث** — 18 اختباراً على مخطّطات JSON. **و`schema.sql` مُتحقَّقة على Postgres 18.4 حقيقي لا مقروءة**: الجداول الخمسة أُنشئت، والقيود رفضت فعلاً كل حالة من ستّ حالات مخالفة (إسناد نشيط في `searching` · حالة `assigned` بلا إسناد · حالة نهائية بلا سبب · عرض عميل بلا مبلغ · حقول شحنة على رحلة · معرّف مشوّه `ORD-42`)، وأول إدخال صالح أنتج `ORD-0000000001`. الإجماليات: **108 اختباراً للحزمة الجديدة**، و**735 اختباراً** على مستوى المستودع في 18 مشروع اختبار (19 مشروع عمل)، و`pnpm -r run typecheck` نظيف.

**ما المشاكل التي ظهرت (7):** **(أ)** كسر اختباران من حرّاس الانحراف بسبب كلمة `'draft'` **داخل تعليق SQL** في كتلة `CHECK (status IN (...))`: الحارس يبحث في نصّ الملف عن القيم الممنوعة بين علامتَي اقتباس مفردتين ولا يميّز التعليق من الكود — والحلّ الصحيح كان **إعادة صياغة التعليق** لا إضعاف الحارس، لأن حارساً يتجاهل التعليقات يمكن تخديره بتعليق. **(ب)** اكتشفت عند مقارنة العقود أن `vehicle_class` كان ناقصاً `truck_small` (خمسة أصناف بدل ستّة) وأن أسماء حقول الشحنة تخالف ما ينشره عقد العميل — أي أن طلباً صالحاً من Phase 04 كان سيُرفَض من محرّك Phase 06 بصمت؛ صُحّح في العقد قبل أن يُبنى منطق عليه. **(ج)** كانت `events.json` أوّلاً بنمط `oneOf` بينما عقد العملاء يستعمل `$defs` وحدها بأسماء PascalCase — وحّدت النمط، فتعدّد أنماط المخطّطات في مستودع واحد يجعل كل مستهلك جديد يخترع مُعرِباً خاصاً. **(د) القيد الحقيقي في هذه الدفعة كان الجدول نفسه**: 21 حالة تعني 441 زوجاً، وتحديد المسموح احتاج أن تكون كل حالة قابلة للوصول ولها مخرج — وظهرت **حالتان كانتا مستحيلتين في المسوّدة الأولى**: `partner_cancelled` لم يكن يصلها سهم من أي حالة (فأُضيفت من ثماني حالات نشيطة)، و`payment_disputed` كانت تُفضي إلى ثلاثة أحكام مباشرة فحُصرت في `under_review` وحدها ليكون للحكم مصدر واحد.

**ما الذي لم يكتمل (8):** **لا منطق ولا قاعدة ولا HTTP** — الدفعة عقود ووثائق فقط، وهو النمط نفسه المتّبع في المراحل 02 و04. `services/orders/src/` غير موجود و`state-machine.ts` لم يُكتب. `UnavailableOrderIntake` باقٍ في `services/customers` فتسليم الطلب بين الخدمتين لا يزال fail-closed حتى MR 5/6. ولا وظيفة CI للطلبات بعد (`order-db-integration` محلّها MR 3/6)، فقيود القاعدة مُتحقَّقة **يدوياً** في هذه الجلسة لا آلياً في كل دفع — وهذا نقص حقيقي أعترف به: تحقّق يدوي لا يمنع انحدارَ غد.

**الخطوة التالية (9):** **MR 2/6 — طبقة المجال النقيّة**: `services/orders/src/domain/state-machine.ts` بجدول **صريح** يجب أن يُنتج **الأزواج الاثنين والسبعين نفسها** التي تنشرها الوثيقة (حارس مطابقة مزدوج: الوثيقة ↔ الكود، ومجموعة نهائية مُشتَقّة من الجدول تُطابَق مع `ORDER_TERMINAL_STATUSES`) + الكيانات والتحقّق ومصانع الأحداث + المنافذ ومُهيّئات الذاكرة — بلا قاعدة وبلا HTTP.

**ما الذي يعتمد عليه العمل التالي (10):** MR 2/6 تعتمد على `@wasla/contracts-order` وعلى جدول [ORDER_ENGINE.md §4](../03-domain/ORDER_ENGINE.md) كمواصفة تنفيذية. MR 3/6 تعتمد على `schema.sql` كمصدر وحيد للمخطّط (مرآة Drizzle لا العكس). MR 4/6 تعتمد على `api.openapi.yml` و`errors.md`. MR 5/6 تعتمد على وجود المسار `POST /orders/intake` فعلياً. MR 6/6 تعتمد على الأربع السابقة، وعلى `packages/customer-e2e/src/stub-order-engine.ts` كمواصفة قائمة لسلوك المحرّك في حدّ التسليم.

**Migration/Deployment/Config (11):** **لا هجرة ولا نشر ولا إعداد جديد في هذه الدفعة** — `schema.sql` وثيقة عقد ولا تُطبَّق آلياً بعد؛ تطبيقها يبدأ في MR 3/6 مع `ORDERS_DATABASE_URL` (بالنمط نفسه المتّبع في `CUSTOMER_DATABASE_URL`). المنفذ **8087** محجوز في العقد وغير مستمع عليه بعد. ولا متغيّر بيئة جديد ولا سرّ.

**مخاطر/قرارات تحتاج مراجعة (12):** **(أ)** الجدول 72 صفّاً كُتب يدوياً؛ الحرّاس يضمنون **تماسكه** (لا انتقال ذاتي، لا حالة معزولة، لا سهم من حالة نهائية) ولا يضمنون **صوابه التجاري** — أن يكون سهمٌ ما مطلوباً فعلاً في التشغيل السعودي مسألة منتج تُراجَع مع Phase 07. **(ب)** غياب `in_progress → customer_cancelled` قرار مقصود موثّق: إلغاء رحلة جارية يفتح سؤال دفع لا جواب له قبل Phase 12، والنسخة الأرخص (السماح به وترك المال معلّقاً) كانت ستُنتج طلبات ملغاة بمال محتجز. **(ج)** `payment_disputed → under_review` وحده يجعل المراجعة نقطة عنق؛ مقبول لأن الحكم يجب أن يكون له مصدر واحد. **(د)** مرجع السائق بلا FK يعني أن مرجعاً لسائق محذوف قد يبقى في `order_assignments`؛ هذا **ثمن مقصود** لفصل المرحلتين، ومحلّ معالجته تقرير اتساق في Phase 05 لا FK هنا.

**الروابط (13):** [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) · [ORDER_ENGINE.md](../03-domain/ORDER_ENGINE.md) · [عقود الخدمة](../../services/orders/contracts/README.md) · [CONTAINERS §4.2](../02-architecture/CONTAINERS.md) · [MASTER_PROGRESS — Phase 06](MASTER_PROGRESS.md) · [HANDOFF §10](HANDOFF_NEXT_STEPS.md) · [MR !38](https://gitlab.com/uxxxu/wasla/-/merge_requests/38)

**الشخص/الفريق الذي يتابع (14):** Team 02 (Order Engine) مالكاً — `/services/orders/` في [CODEOWNERS](../../CODEOWNERS) بمشاركة معلَنة. وTeam 04 (Customer) معنيّ بـMR 5/6، وTeam 07 (Dispatch) معنيّ بحدّ الإسناد في Phase 07.

## 2026-08-21 · Phase 04 MR 6/6 — بوابة خروج المرحلة E2E (محرّك طلبات بديل) وإغلاق Phase 04

**Task:** إثبات بوابة خروج المرحلة 04 — «عميل ينشئ Order صالحًا ويصل إلى Order Engine (بدون Matching فعلي)» — تنفيذياً لا وصفياً، ثمّ إغلاق المرحلة. **Status:** Completed · **MR:** [!37](https://gitlab.com/uxxxu/wasla/-/merge_requests/37) · **ADR:** [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) · [ADR-001](../15-decisions/ADR-001-identity-decoupled-from-telegram.md) · **الوثيقة:** [PHASE04_EXIT_GATE_E2E.md](../12-testing/PHASE04_EXIT_GATE_E2E.md)

**ماذا تم إنجازه (1):** أنشأت حزمة اختبار بحتة `@wasla/customer-e2e` (`packages/customer-e2e`، `private: true`، بلا كود تشغيلي وبلا تصديرات) تبني في **عملية واحدة**: خدمة هوية حقيقية تستمع على HTTP · خدمة جغرافيا حقيقية ببذرة السعودية تستمع على HTTP · نواة العميل عبر `createCustomerApp` على منفذ حقيقي مربوطة بـ`HttpIdentityLookupPort` و`HttpGeographyPort` الإنتاجيين · بوت العميل عبر `buildCustomerBot` بـ`MockChannelAdapter` وبـ**نفس كائن `UseCaseDeps`** الذي يخدم مسار HTTP · و**محرّك طلبات بديل** على `node:http` (`stub-order-engine.ts`) يتحقّق من عقد `OrderIntakeRequest` ويرفض بـ400 أي جسم لا يطابقه (بما فيه أي مفتاح camelCase أو مبلغ غير صحيح أو عدد محطّات ≠ 2). و11 اختباراً تُثبت السلسلة كاملة ومسارات فشلها الأربعة، تعمل بمخازن الذاكرة **وعلى Postgres حقيقي** بالمُهيّئات نفسها. وأضفت وظيفة CI `customer-exit-gate-e2e`. **صفر تغيير في منطق الإنتاج** — التغيير الوحيد خارج الحزمة هو تصدير `ORDER_STATUS_TEXT` و`ORDER_TYPE_TEXT` من `bots/customer-bot/src/index.ts` (ثابتان قائمان، رُفعا إلى السطح العامّ).

**لماذا تم اختياره (2):** البوابة تسأل سؤالاً لا يستطيع اختبار وحدة الإجابة عنه: **هل تصل الحمولة فعلاً إلى طرف آخر يقرأ العقد؟** نداء دالّة داخل العملية لا يُسَلسِل شيئاً، فمفتاح camelCase أو سعر عشري يمرّ بلا أن يُلاحَظ حتى تصل المرحلة 06 فتفشل عليها. لذلك جُعل المحرّك عملية HTTP منفصلة **تقرأ العقد وترفض**، لا مسجّلاً يقبل ما يُلقى إليه. و[§7 من قانون التوثيق](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) يطلب تبرير أي حزمة جديدة: البوابة تحتاج الاعتماد على البوت والنواة والهوية والجغرافيا **معاً**، ولا بيت لها في أيٍّ منها بلا عكس اتّجاه الاعتماد — داخل `services/customers` تُلزم الخدمة بمعرفة البوت الذي يستهلكها، وداخل `bots/customer-bot` تُلزم البوت بمعرفة خدمتين لا يعرفهما، وداخل `@wasla/channel-e2e` تخلط بوابتَي مرحلتين فيصبح الفشل غير منسوب. والحزمة **لم تُدخل أي اعتمادية خارجية جديدة على المستودع** (`vitest`, `pg`, `@types/*` مُستعملة أصلاً)، والمحرّك البديل بُني على `node:http` تحديداً حتى لا يُدخل إطاراً ثانياً يفشل لأسبابه الخاصة. وشاركُ البوت وHTTP **نفس `UseCaseDeps`** قرارٌ مقصود: لو فتح كلٌّ تجمّعه لَنجحت البوابة حتى لو نظر الطرفان إلى بيانات مختلفة.

**أين تم التغيير (3):** حزمة جديدة `packages/customer-e2e/` · تصديران في `bots/customer-bot/src/index.ts` · وظيفة في `.gitlab-ci.yml` · وثيقة بوابة جديدة في `docs/12-testing/` · وتحديث وثائق التقدّم والتسليم وخريطة الطريق ووثيقة تدفقات البوت.

**الملفات/الخدمات المتأثرة (4):**
- **جديد:** `packages/customer-e2e/{package.json,tsconfig.json,vitest.config.ts}` · `packages/customer-e2e/src/{harness.ts,stub-order-engine.ts,order-intake-http.ts}` · `packages/customer-e2e/src/__tests__/phase04-exit-gate.e2e.test.ts` · `docs/12-testing/PHASE04_EXIT_GATE_E2E.md`
- **مُعدَّل:** `bots/customer-bot/src/index.ts` (تصديران) · `.gitlab-ci.yml` (وظيفة `customer-exit-gate-e2e`) · `pnpm-lock.yaml` · `docs/16-progress/{MASTER_PROGRESS.md,ROADMAP.md,HANDOFF_NEXT_STEPS.md,TASK_LOG.md}` · `docs/02-architecture/CUSTOMER_BOT_FLOWS.md`
- **غير مُلمَس:** `services/customers/**` بالكامل · `packages/{channel-core,telegram-adapter,bot-runtime,channel-postgres,channel-e2e}` · `services/{identity,geography}`

**ما الـAPI/Event/Schema الذي تغير (5):** **لا شيء.** لا مسار HTTP جديد، ولا حدث جديد، ولا تعديل على `schema.sql` ولا على `api.openapi.yml` ولا على كتالوج الأخطاء. البوابة **مستهلك** للعقود القائمة: تُسَلسِل عبر مخطّط الخدمة نفسه `toOrderIntakeRequestDto` (لا تخطيط خاص بها — وإلّا لَفحصت فكرتها عن التسليم لا فكرة الخدمة)، وتقرأ الأحداث من `customer_outbox` كما هي، وتؤكّد الأكواد المنشورة: `CUSTOMER_IDEMPOTENCY_KEY_REUSED` (409) · `CUSTOMER_ZONE_NOT_FOUND` (404) · `CUSTOMER_ORDER_INTAKE_UNAVAILABLE` (503). التصديران في البوت إضافة إلى **السطح العامّ** لا تغيير في عقد شبكي.

**كيف تم الاختبار (6):** 11 اختباراً في `phase04-exit-gate.e2e.test.ts`: (1) `/start` وحده يُنشئ هوية وملفاً مقروءاً عبر HTTP وطبقة القناة لا تحمل `wasla_public_id` · (2) طلب صالح ⇒ 201 والمحرّك استلم الحقول المنشورة (snake_case · معرّفات مناطق نشيطة · `amount_minor` عدد صحيح · `idempotency_key` · محطّتان بمصدرهما) والصفّ يحمل `order_public_id` **الذي منحه المحرّك** · (3) إعادة المفتاح ⇒ 200 وصفّ واحد و**نداء واحد** · (4) المفتاح نفسه بجسم مختلف ⇒ 409 · (5) رفض المحرّك (422) ⇒ `submission_failed` + حدث بـ`…_REJECTED` + 503 والبوت يعرض «لم يصل للمحرّك» · (6) تعطّل (500) ⇒ `…_UNAVAILABLE` · (7) انعدام الإجابة ⇒ `…_TIMEOUT` **مع تسجيل أنّ الطلب وصل** · (8) منطقة مجهولة ⇒ 404 وصفر نداء وصفر صفوف · (9) مكان يُحفَظ عبر HTTP يظهر في `/places` في البوت · (10) مسح خصوصية على كل الأحداث: لا إحداثية ولا نصّ كتبه المستخدم · (11) `/health` = `ok` فقط لتركيب يستطيع إتمام تسليم. **الأدلة:** 11/11 بمخازن الذاكرة · 11/11 على Postgres حقيقي (بعد تطبيق `contracts/schema.sql`) · `pnpm -r test` = **627 اختباراً** (كانت 616؛ +11) · `pnpm -r run typecheck` نظيف على **18 مشروعاً**.

**ما المشاكل التي ظهرت (7):**
1. **`DATABASE_URL` كان يُفشل البوابة لسبب غير سببها.** ضبطه يجعل بوت العميل يُركّب مخازن **طبقة القناة** فيطلب جداول `channel_*` لا تملكها هذه البوابة. الحلّ: البوابة تقرأ `CUSTOMER_DATABASE_URL` **وحده**، ووظيفة CI تضبطه وحده على قاعدة منفصلة `wasla_customer_e2e` — وسُجّل السبب تعليقاً عربياً في `.gitlab-ci.yml` لأنّ من سيقرأه لاحقاً سيظنّه سهواً.
2. **العزل بين الاختبارات لا يمكن أن يكون تفريغ جداول:** لا يوجد «تفريغ» لمخزن الذاكرة، فأي تفريغ يجعل الوضعين مختلفين والبوابة تُثبت شيئاً في وضع وشيئاً آخر في الآخر. اعتُمد **العزل بالبيانات**: مستخدم قناة جديد لكل اختبار ⇒ `wasla_public_id` خاص، وقراءة الأحداث عبر `eventsFor()`، و`reset()` لا يمسّ إلّا مسجّلات المحرّك والقناة.
3. **الأكواد الدقيقة للفشل لا توجد في كتالوج الأخطاء:** لا `…_REJECTED` ولا `…_TIMEOUT` في الرأس المنشور — الثلاثة تُجيب بـ503 `…_UNAVAILABLE` بقصد. فأُعيد توجيه التأكيد إلى موضعه الصحيح: `failureReasonCode` في الصفّ و`reason_code` في حدث الفشل، لا في جسم الردّ.
4. **المحرّك البديل كان يقبل كل شيء في أول تنفيذ**، فكان يمرّ حتى لو أرسلنا camelCase — أي بوابة تُثبت أن الشبكة تعمل لا أن العقد محترم. أُضيف تحقّق صريح ورَفضٌ بـ400 يُسجَّل في `malformed`.

**ما الذي لم يكتمل (8):** **لا محوّل تسليم إنتاجي** — المحوّل في `order-intake-http.ts` **مملوك للبوابة** بقصد، لأنّ `api.openapi.yml` ينصّ على أنّ Phase 06 تملك عنوان المحرّك ومصادقته وسياسة إعادة محاولته. **إنشاء الطلب من رسالة تيليجرام** غير مُثبَت: البوابة تُطلق السلسلة من `POST /order-requests` (Phase 11 تملك الواجهة). **دَين الذرّية** بين كتابة الصفّ ونشر الحدث ما زال قائماً وموضعه **Phase 09** — بوابة خروج ليست موضع تغيير معماري. ولا **ناشر `customer_outbox`** ولا **مُشغّل دوري لـ`retryDueDeliveries`** (Phase 09). و`/health` للبوت لا يُعلن غياب النواة (المؤشّر الحالي: 422 على `/places` و`/orders`)، ومسار المنطقة البشري غير مُحلّ في قوائم الأماكن.

**الخطوة التالية (9):** **Phase 04 مُغلَقة.** التالي **Phase 06 — Order Engine**: تنفيذ آلة حالة الطلب وملكية `order_public_id` و`HttpOrderIntakePort` الإنتاجي. المدخل الجاهز: `stub-order-engine.ts` هو **المواصفة التنفيذية** لما نرسله ولدلالة الحالات (`201`/`200` نجاح · `422` مرفوض · أي حالة أخرى بما فيها `400` = غير متاح لأنه خطؤنا · انعدام الإجابة = مهلة تُلزم المحرّك بمعاملة المفتاح كأنّه **قد** رُئي).

**ما الذي يعتمد عليه العمل التالي (10):** Phase 06 تعتمد على هذه البوابة كشرط انحدار: أي تغيير في شكل الحمولة يجب أن يبدأ من **العقد** ثمّ `toOrderIntakeRequestDto` ثمّ المحرّك البديل — لا العكس. Phase 09 تعتمد على صفوف `submission_failed` وأحداث `customer.order_request.submission_failed` التي تُنتجها البوابة كحالات حقيقية لناشر الصندوق. Phase 11 تعتمد على مسارات HTTP نفسها التي تُشغّلها البوابة.

**Migration/Deployment/Config (11):** **لا هجرة ولا نشر.** لا تغيير في `schema.sql` ولا في أي متغيّر بيئة إنتاجي. المتغيّر الوحيد الجديد **خاص بالاختبار**: `CUSTOMER_DATABASE_URL` في وظيفة `customer-exit-gate-e2e` نحو قاعدة `wasla_customer_e2e` في خدمة `postgres:15` الخاصة بالوظيفة (**لا** `DATABASE_URL` — انظر المشكلة 1). الوظيفة تُنشئ مخطّطها من `services/customers/contracts/schema.sql` وتُسقط جداولها قبل ذلك، فهي لا تعتمد على حالة سابقة. الهوية والجغرافيا لا تحتاجان مخطّطاً هنا لأنّ مخازنهما in-memory.

**مخاطر/قرارات تحتاج مراجعة (12):**
1. **الجغرافيا والهوية بمخازن ذاكرة داخل البوابة.** الحدّ الذي تفحصه هذه البوابة هو **العقد بين الخدمات**، وتخزينهما تُثبته بوابتا المرحلتين 01 و02. لو أُريد لاحقاً تشغيلهما على Postgres، فذلك توسيعٌ لا تصحيح.
2. **`fileParallelism: false` مقصود:** الحزمة تملك مخطّط العميل في القاعدة الهدف (إسقاط ثمّ DDL)؛ أي ملف اختبار ثانٍ يُضاف لاحقاً لا يجوز أن يتسابق على الجداول نفسها.
3. **إغراء إعادة استخدام محوّل البوابة في الإنتاج.** لا يجوز: هو بلا مصادقة وبلا إعادة محاولة وبمهلة 2000ms ثابتة، ويعيش في حزمة خاصة تحديداً كي لا يُستورَد.
4. **الاختبار يقارن بثوابت البوت المُصدَّرة** (`ORDER_STATUS_TEXT`) لا بنصوص عربية مكرّرة؛ من يغيّر الصياغة يجب أن يغيّر الثابت — وهذا هو المقصود، لولاه لَنجحت البوابة بينما البوت يعرض نصّاً آخر.

**الروابط (13):** [PHASE04_EXIT_GATE_E2E.md](../12-testing/PHASE04_EXIT_GATE_E2E.md) · [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · [CUSTOMER_BOT_FLOWS.md](../02-architecture/CUSTOMER_BOT_FLOWS.md) · [CUSTOMER_HTTP.md](../04-api/CUSTOMER_HTTP.md) · [CUSTOMER_PERSISTENCE.md](../02-architecture/CUSTOMER_PERSISTENCE.md) · [PHASE03_EXIT_GATE_E2E.md](../12-testing/PHASE03_EXIT_GATE_E2E.md) (النمط المُتّبع) · [MASTER_PROGRESS.md](MASTER_PROGRESS.md) · [HANDOFF §9](HANDOFF_NEXT_STEPS.md) · [MR !37](https://gitlab.com/uxxxu/wasla/-/merge_requests/37)

**الشخص/الفريق الذي يتابع (14):** **Team 06 — Order Engine** (المتابع الأساسي: المحرّك البديل مواصفته) · Team 04 — Customer Core (مالك البوابة وصاحب إبقائها خضراء) · Team 09 — Reputation/Outbox (دَين الذرّية والناشر) · Team 11 — Mini App (إنشاء الطلب من الواجهة).

---

## 2026-08-21 · Phase 04 MR 5/6 — ربط بوت العميل بالنواة عبر بذرة محادثة محيّدة

**Task:** ربط `bots/customer-bot` بحالات استخدام نواة العميل بلا أن تتعلّم طبقة القناة وجود مجال، وربط ثلاثة تدفقات (`/start`، `/places`، `/orders`) بمفاتيح idempotency مشتقّة من تحديث القناة. **Status:** Completed · **MR:** [!36](https://gitlab.com/uxxxu/wasla/-/merge_requests/36) · **ADR:** [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) · [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · **الوثيقة:** [CUSTOMER_BOT_FLOWS.md](../02-architecture/CUSTOMER_BOT_FLOWS.md)

**ماذا تم إنجازه (1):** أضفت **بذرة محادثة محيّدة** في `packages/bot-runtime/src/conversation.ts` (`ConversationEvent` محايد + `ConversationReply` + `buildConversationReply`) وخيار `onConversation` في `createBotApp`/`startBot`، فصار الجذر يُسلّم إلى طبقة القناة **دالّة واحدة** بدل أن تعرف الطبقة مجالاً. وأتحت الفاعل المحيّد من `receiveUpdate` (`ReceiveUpdateResult.actor`) لتحليل الهوية المتأخّر. وفي البوت: `flows.ts` (سلوك ونصّ عربي وراء `CustomerFlowsPort`، بلا أي تحقّق وبلا مُهيّئ) و`customer-core.ts` (**الملف الوحيد** الذي يستورد `@wasla/customers-service` من بوت) و`server.ts` (يُركّب التدفقات ويُسجّل الأمرين عند وجود `CUSTOMER_DATABASE_URL` وحده، ويُغلق التجمّع في `onClose`). **صفر تغيير في `services/customers`.**

**لماذا تم اختياره (2):** MR 5/6 هي الدفعة المُلزَمة التالية في [HANDOFF §9](HANDOFF_NEXT_STEPS.md)، وبلا مستهلك حقيقي تبقى النواة الجاهزة (MR 1/6 → 4/6) كوداً لا يناديه أحد. والشكل اختير على البديل الأرخص (`if (bot === "customer")` داخل مسار الويب هوك) لأن ذاك يهدم ADR-007 rule 2 ويُدخل فروع مجالات في المسار الأمني الوحيد غير المُصادَق في وصلة.

**أين تم التغيير (3):** جديد: `packages/bot-runtime/src/conversation.ts` · `packages/bot-runtime/src/__tests__/conversation.test.ts` · `bots/customer-bot/src/{flows.ts,customer-core.ts}` · `bots/customer-bot/src/__tests__/customer-flows.test.ts` · `docs/02-architecture/CUSTOMER_BOT_FLOWS.md`. مُعدَّل: `packages/bot-runtime/src/{http/app.ts,http/server.ts,index.ts,__tests__/harness.ts}` · `packages/channel-core/src/use-cases/receive-update.ts` + اختباره · `bots/customer-bot/src/{server.ts,index.ts}` · `bots/customer-bot/package.json` · `pnpm-lock.yaml` · `docs/02-architecture/CHANNEL_BOTS.md` · `docs/16-progress/{MASTER_PROGRESS,HANDOFF_NEXT_STEPS,TASK_LOG}.md`.

**الملفات/الخدمات المتأثرة (4):** `@wasla/customer-bot` (سلوك جديد) · `@wasla/bot-runtime` و`@wasla/channel-core` (إضافة اختيارية بحتة) · بوتا السائق والشريك: **لا فرق في مسارهما** — لا يُسلّمان `onConversation` فلا يُنادى شيء (مُثبَت باختباراتهما الستّة لكل واحد بلا تعديل). `@wasla/customers-service`: مستهلَكة، غير مُعدَّلة.

**ما الـAPI/Event/Schema الذي تغير (5):** **لا تغيير في أي عقد** — لا `api.openapi.yml` (القناة أو العميل) ولا `errors.md` ولا `events.json` ولا `schema.sql`، ولا كود خطأ جديد. الأكواد المُستخدَمة كلها قائمة: `CHANNEL_UNSUPPORTED_COMMAND` · `CHANNEL_IDENTITY_BOOTSTRAP_FAILED` · أكواد `CUSTOMER_*` تُترجَم إلى نصّ ولا تُعاد كما هي إلى المستخدم.

**كيف تم الاختبار (6):** `pnpm -r run typecheck` نظيف على 17 مشروعاً · `pnpm -r test` = **616 اختبار وحدة** (كانت 587؛ +29: `bot-runtime` 93، `customer-bot` 20، `channel-core` 104) · اختبارات التكامل الـ43 لم تُمسّ · لا اختبار يفتح منفذاً ولا يحتاج قاعدة بيانات ولا رمز تيليجرام (`app.inject` + نواة في الذاكرة). أهمّ ما يُثبَت: مفاتيح `flow:customer:<updateId>[:step]` وتكرارٌ لا يُنتج رسالة ثانية · **الحدث محايد بمفاتيح مُثبَّتة بالاسم** فلا يتسلّل حقل قناة · هوية واحدة لسؤالين وصفر عند `/start` · لا نداء تدفّق على مكرَّر ولا في غرفة مجهولة · فشل التدفّق ⇒ 202 وصمت · بلا `CUSTOMER_DATABASE_URL` ⇒ 422 و`/start` سليم.

**ما المشاكل التي ظهرت (7):** (1) **`/start` كان سيُرسل رسالتين** (ترحيب النواة + ردّ التدفّق) → التدفّق يُعيد `null` عند `start` ويكتفي بضمان الملف صامتاً. (2) **`upsert` أعمى في `ensureProfile` كان سيستبدل الاسم** الذي ضبطه المستخدم في التطبيق المصغّر عند كل `/start` → قراءة ثمّ إنشاء عند الغياب فقط، مع اختبار يحرس ذلك. (3) **تحليل الهوية لكل تحديث** كان سيُضيف رحلة شبكة إلى كل رسالة نصّية عابرة → `resolveIdentity()` متأخّر ومُخزَّن. (4) رفع الخطأ من التدفّق كان سيُرجع 5xx فيُعيد تيليجرام تحديثاً مُسجَّلاً كمُعالَج → يُسجَّل بـ`trace_id` ويبقى 202. (5) `GroupPresence` لا يملك `title` بل `label` — أوقفه `tsc`.

**ما الذي لم يكتمل (8):** **إنشاء الطلب من البوت لم يُنفَّذ، خلافاً لِما وعدت به دفعة MR 4/6 نصّاً** («تدفّق حفظ مكان وتدفّق تقديم طلب»). السبب: الطلب الصالح يحتاج محطّتين بمنطقة ومصدر لكل واحدة وصنف مركبة ونمط سعر (ADR-009 §4)، وجمع ذلك عبر رسائل يعني اختراع تدفّق منتج داخل دفعة هندسية، بينما [USER_FLOWS §1 و§6](../01-product/USER_FLOWS.md) يضع «الأعمال الثقيلة» في التطبيق المصغّر ويُبقي البوت «للإطلاق والتنبيه والتوجيه والإجراءات الصغيرة». فأُسنِد إنشاء الطلب — وحفظ مكان جديد معه — إلى **Phase 11**. · مسار المنطقة البشري لا يُحلّ في قوائم الأماكن (نداء جغرافيا لكل مكان). · `/health` للبوت لا يُعلن غياب نواة العميل. · **دَين الذرّية باقٍ في Phase 09** كما أُعيد إسناده. · لا ناشر لـ`customer_outbox` بعد. · `retryDueDeliveries` ما زال بلا مُشغّل دوري (دَين المرحلة 03).

**الخطوة التالية (9):** MR 6/6 — **بوابة خروج المرحلة 04 من طرف إلى طرف**: محرّك طلبات بديل يحترم `OrderIntakeRequest`، ومسار حقيقي (تحديث قناة → تدفّق → حالة استخدام → Postgres → صندوق صادر) في وظيفة CI مستقلّة، ووثيقة بوابة خروج تُغلق المرحلة.

**ما الذي يعتمد عليه العمل التالي (10):** لا شيء خارجي. المحرّك البديل داخل نطاق MR 6/6. وإنشاء الطلب من واجهة صار يعتمد على **Phase 11** لا على هذه الطبقة.

**Migration/Deployment/Config (11):** لا هجرة. اعتماديتان في `bots/customer-bot`: `@wasla/customers-service: workspace:*` و`pg@^8.23.0` (+ `@types/pg` تطويراً) — **لا حزمة خارجية جديدة على المستودع** (كلتاهما مُستعمَلة أصلاً في `services/customers`)، فشرط [ENGINEERING_DOCUMENTATION_LAW §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) لا يُفتَح. متغيّرات بيئة جديدة للبوت: `CUSTOMER_DATABASE_URL` (بوّابة التدفقات) · `GEOGRAPHY_SERVICE_URL` (اختياري). `pnpm-lock.yaml` مُحدَّث (CI بـ`--frozen-lockfile`). لا أسرار في الكود.

**مخاطر/قرارات تحتاج مراجعة (12):** (أ) **تضييق نطاق مُعلَن**: إنشاء الطلب انتقل إلى Phase 11 — قرار منتجي يستحق مراجعة مالك المشروع (الحجّة في [CUSTOMER_BOT_FLOWS §3](../02-architecture/CUSTOMER_BOT_FLOWS.md)). (ب) **البوت ينادي حالات الاستخدام داخل العملية**، فهو يحمل بيانات عملاء في ذاكرته ويحتاج بيانات اعتماد قاعدة العميل: مقبول اليوم (نشر واحد، شبكة داخلية) ويحتاج مراجعة عند أول فصل نشر — والمنفذ `CustomerFlowsPort` يجعله استبدالاً. (ج) **`/health` لا يرى غياب النواة**؛ المؤشّر الحالي رفض الأمرين بـ422. (د) نافذة اللاذرّية خطر تشغيلي قائم لم يتغيّر.

**الروابط (13):** MR [!36](https://gitlab.com/uxxxu/wasla/-/merge_requests/36) · [CUSTOMER_BOT_FLOWS.md](../02-architecture/CUSTOMER_BOT_FLOWS.md) · [CHANNEL_BOTS.md](../02-architecture/CHANNEL_BOTS.md) · [CUSTOMER_HTTP.md](../04-api/CUSTOMER_HTTP.md) · [USER_FLOWS.md](../01-product/USER_FLOWS.md) · [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) · [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · [HANDOFF §9](HANDOFF_NEXT_STEPS.md)

**الشخص/الفريق الذي يتابع (14):** Team 04 — Customer Core (MR 6/6 وبوابة الخروج) · Team 03 — Channel Layer (البذرة صارت سطحاً عامّاً في `bot-runtime`) · Team 11 — Customer Mini App (إنشاء الطلب وحفظ مكان) · Team 09 — Notifications/Events (الذرّية + ناشر الصادر).

---

## 2026-08-21 · Phase 04 MR 4/6 — طبقة HTTP لخدمة العملاء (المنفذ 8086)

**Task:** تعريض حالات استخدام Customer Core عبر HTTP مطابقةً لـ`contracts/api.openapi.yml` (عشرة مسارات + `/health`)، وتخطيط كتالوج الأخطاء الثمانية عشر إلى حالات HTTP، ومحوّلات HTTP لمنفذَي الهوية والجغرافيا، وتركيب نهائي يُغلق تجمّع الاتصالات. **Status:** Completed · **MR:** [!35](https://gitlab.com/uxxxu/wasla/-/merge_requests/35) · **ADR:** [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · **الوثيقة:** [CUSTOMER_HTTP.md](../04-api/CUSTOMER_HTTP.md)

**ماذا تم إنجازه (1):** أنشأت `src/http/requests.ts` (ترجمة snake_case→camelCase بتحقّق شكلي فقط) و`errors.ts` (`CustomerError` → `{code,message,trace_id}` بحالة الكتالوج نفسها) و`app.ts` (`createCustomerApp` — عشرة مسارات، 201 مقابل 200، 204 بلا جسم للحذف، `SAVED_PLACES_LIMIT` في استجابة القائمة، `zone_path` أفضل-جهد) و`server.ts` (تركيب نهائي على 8086، Postgres عند وجود `DATABASE_URL` وإلا ذاكرة، إغلاق التجمّع في `onClose`، SIGTERM/SIGINT). وأضفت `infrastructure/http-identity-lookup.ts` و`http-geography.ts`. و`__tests__/http/app.test.ts` = **34 اختبار `app.inject`**. وفعّلت `requestIdHeader: "x-request-id"` ليعبر معرّف الارتباط من المنادي إلى `trace_id` وإلى مغلّفات الأحداث. **صفر تغيير في `src/domain/` و`src/use-cases/`.**

**لماذا تم اختياره (2):** MR 4/6 هي الدفعة المُلزَمة التالية في [HANDOFF §9](HANDOFF_NEXT_STEPS.md). وبلا طبقة HTTP لا يمكن لأي مستهلك خارج العملية أن يستعمل الخدمة، ولا يمكن لبوابة خروج المرحلة (6/6) أن تشغّل مساراً حقيقياً من طرف إلى طرف.

**أين تم التغيير (3):** `services/customers/src/http/{requests,errors,app,server}.ts` (جديدة) · `services/customers/src/infrastructure/{http-identity-lookup,http-geography}.ts` (جديدة) · `services/customers/src/__tests__/http/app.test.ts` (جديد) · `services/customers/src/index.ts` (تصديرات) · `services/customers/package.json` (`fastify`، `tsx`، سكربتا `dev`/`start`) · `pnpm-lock.yaml` · `docs/04-api/CUSTOMER_HTTP.md` (جديدة) · `docs/02-architecture/CUSTOMER_PERSISTENCE.md` (§7 و§8) · `docs/16-progress/{MASTER_PROGRESS,HANDOFF_NEXT_STEPS,TASK_LOG}.md`.

**الملفات/الخدمات المتأثرة (4):** `@wasla/customers-service` وحدها. لا بوت مربوط بعد (MR 5/6) ولا بوابة (Phase 06)، فسطح التأثير الخارجي ما زال صفراً؛ لكن الخدمة صارت **قابلة للتشغيل** لأول مرة.

**ما الـAPI/Event/Schema الذي تغير (5):** **لا تغيير في أي عقد** — لا `api.openapi.yml` ولا `errors.md` ولا `events.json` ولا `schema.sql`، ولا كود خطأ جديد. هذه الدفعة **تنفيذٌ للعقد القائم** لا تعديل له.

**كيف تم الاختبار (6):** `pnpm -r run typecheck` نظيف على 17 مشروعاً · `pnpm -r test` = **587 اختبار وحدة** ناجحة (خدمة العملاء **100**، كانت 66) · اختبارات التكامل (43) لم تُمسّ · **تشغيل حقيقي** `PORT=8099 pnpm --filter @wasla/customers-service start`: `/health` = `degraded/memory/unconfigured` · `PUT profile` = 201 ثم `GET` يعيد الاسم العربي سليماً · `POST places` بلا ترويسة = `CUSTOMER_MISSING_IDEMPOTENCY_KEY` · تسليم بمنطقة غير مسجّلة = `CUSTOMER_ZONE_NOT_FOUND` مع `trace_id: smoke-1` (انتشار `x-request-id` مُثبت) · مسار مجهول = 404 نقل.

**ما المشاكل التي ظهرت (7):** (1) **`requestIdHeader` معطّل افتراضياً في Fastify 5** فكان `trace_id` محلياً للعملية ولا يعبر حدود الخدمات → فُعِّل `x-request-id` صراحةً (والأمر نفسه ما زال ناقصاً في Geography — دين مُعلن). (2) **جسم ليس JSON كان سيصير 503** لأن الملتقط الشامل يصنّف كل ما ليس `CustomerError` خطأً داخلياً، وهذا يأمر البوت بإعادة محاولة طلبٍ لن ينجح أبداً → خطأ نقل بحالة 400/415 يُخطَّط إلى `CUSTOMER_INVALID_REQUEST_BODY`. (3) `as OrderRequestDraft` من `Record<string, unknown>` رفضه `tsc` → صُرِّح المرور عبر `unknown` بتعليق يقول إن هذه الطبقة لا تدّعي صلاحية القيم. (4) استيراد `FakeIdentityLookup` غير مستعمل في `server.ts` → أُزيل.

**ما الذي لم يكتمل (8):** **دَين الذرّية لم يُسدّ هنا خلافاً لما وعدت به دفعة MR 3/6.** منفذ وحدة-عمل يمسّ أربع حالات استخدام ومُهيّئين وطاقم مطابقة المنافذ، فهو دفعة كاملة لا إضافة على طبقة توصيل؛ وأُعيد إسناده إلى **Phase 09 (ناشر صندوق الصادر)** حيث يظهر أول مستهلك يتضرّر من حدثٍ ناقص. مذكور صريحاً في [CUSTOMER_PERSISTENCE.md §7](../02-architecture/CUSTOMER_PERSISTENCE.md) و[CUSTOMER_HTTP.md §8](../04-api/CUSTOMER_HTTP.md). · **لا مصادقة على المسارات** (قرار البوابة — Phase 06). · **استدعاء جغرافيا لكل منطقة مميّزة** بلا دالة دفعة. · **لا مُهيّئ حقيقي لـ`OrderIntakePort`** فـ`/health` يبقى `degraded` وكل تسليم يفشل مغلقاً — بقصد حتى Phase 07.

**الخطوة التالية (9):** MR 5/6 — ربط `bots/customer-bot` بحالات الاستخدام **مباشرة** (لا HTTP) حفاظاً على حياد القناة ([ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)): تدفّق حفظ مكان وتدفّق تقديم طلب مع مفاتيح idempotency مشتقّة من رسالة القناة.

**ما الذي يعتمد عليه العمل التالي (10):** لا شيء خارجي. MR 5/6 تستهلك حالات الاستخدام القائمة، وMR 6/6 تحتاج **محرّك طلبات بديلاً** يحترم `OrderIntakeRequest` وهو داخل نطاق تلك الدفعة.

**Migration/Deployment/Config (11):** لا هجرة. اعتماديتان في `services/customers`: `fastify@^5.12.1` (تشغيل) و`tsx@^4.23.12` (تطوير) + `pnpm-lock.yaml` مُحدَّث (CI بـ`--frozen-lockfile`). سكربتان جديدان: `dev` و`start`. متغيّرات بيئة: `PORT` (8086) · `HOST` · `DATABASE_URL` · `IDENTITY_SERVICE_URL` · `GEOGRAPHY_SERVICE_URL` · `IDENTITY_TIMEOUT_MS` · `GEOGRAPHY_TIMEOUT_MS` (2000). لا أسرار في الكود.

**مخاطر/قرارات تحتاج مراجعة (12):** (أ) **نقض وعد سابق**: دَين الذرّية كان مُسنَداً إلى هذه الدفعة وأُعيد إسناده إلى Phase 09 — قرار يستحق مراجعة مالك المشروع. (ب) **الخدمة بلا مصادقة** وتثق بشبكتها الداخلية؛ أي تعريض قبل Phase 06 خطر أمني مباشر. (ج) **الافتراضي المحلي للهوية متسامح** (يقبل أي `WS-`) — للتطوير فقط، وضبط `IDENTITY_SERVICE_URL` إلزامي في الإنتاج. (د) نافذة اللاذرّية ما زالت خطراً تشغيلياً قائماً.

**الروابط (13):** MR [!35](https://gitlab.com/uxxxu/wasla/-/merge_requests/35) · [CUSTOMER_HTTP.md](../04-api/CUSTOMER_HTTP.md) · [CUSTOMER_PERSISTENCE.md](../02-architecture/CUSTOMER_PERSISTENCE.md) · [GEOGRAPHY_HTTP.md](../04-api/GEOGRAPHY_HTTP.md) · [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · [HANDOFF §9](HANDOFF_NEXT_STEPS.md)

**الشخص/الفريق الذي يتابع (14):** Team 04 — Customer Core (MR 5/6 ثم بوابة الخروج) · Team 06 — Gateway (المصادقة) · Team 09 — Notifications/Events (الذرّية + ناشر الصادر) · Team 02 — Geography (تفعيل `requestIdHeader`).

---

## 2026-08-21 · Phase 04 MR 3/6 — استمرارية Drizzle/Postgres لخدمة العملاء

**Task:** استبدال مُهيّئ التخزين في الذاكرة لخدمة العملاء بمرآة Drizzle لـ`contracts/schema.sql` مع حراسة انحراف واختبارات مطابقة منافذ ووظيفة CI مستقلّة، وحسم دَين `shipment_description`. **Status:** Completed · **MR:** [!34](https://gitlab.com/uxxxu/wasla/-/merge_requests/34) · **ADR:** [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · **الوثيقة المعمارية:** [CUSTOMER_PERSISTENCE.md](../02-architecture/CUSTOMER_PERSISTENCE.md)

**ماذا تم إنجازه (1):** أنشأت `src/infrastructure/drizzle/schema.ts` (مرآة الجداول الخمسة) و`db.ts` (`createCustomerDb` = تجمّع `pg` + `drizzle`) و`repository.ts` (`PostgresCustomerRepository` ينفّذ `CustomerRepository` و`PostgresCustomerOutbox` ينفّذ `Outbox` + `markPublished` جاهزاً للناشر). أضفت `schema-drift.test.ts` (17 اختباراً بلا قاعدة) و`postgres-repository.integration.test.ts` (27) و`port-conformance.integration.test.ts` (16 سيناريو تُنفَّذ مرّتين: ذاكرة وPostgres) و`vitest.integration.config.ts` + سكربت `test:integration` + وظيفة CI `customer-db-integration` (قاعدة `wasla_customer_test`). وحسمت دَين `shipment_description` **بالتبنّي** مع حارس خصوصية في `events-privacy.test.ts`. **صفر تغيير في `src/use-cases/`** عدا نشر الحقل المتبنّى في `mappers.ts`.

**لماذا تم اختياره (2):** MR 3/6 هي الدفعة التالية المُلزَمة في خطة [HANDOFF §9](HANDOFF_NEXT_STEPS.md)؛ وبلا استمرارية تبقى الخدمة صحيحة سلوكياً ولا تعيش عبر إعادة تشغيل واحدة، فلا يمكن أن تُبنى فوقها طبقة HTTP (MR 4/6) ولا بوابة خروج المرحلة.

**أين تم التغيير (3):** `services/customers/src/infrastructure/drizzle/{schema,db,repository}.ts` · `services/customers/src/__tests__/{schema-drift,postgres-repository.integration,port-conformance.integration,pg-harness,events-privacy}.ts` · `services/customers/src/{domain/model.ts,domain/validation.ts,use-cases/mappers.ts,index.ts}` · `services/customers/{package.json,drizzle.config.ts,vitest.integration.config.ts}` · `pnpm-lock.yaml` · `.gitlab-ci.yml` · `docs/02-architecture/{CUSTOMER_PERSISTENCE.md (جديدة),CUSTOMER_CORE_DOMAIN.md}` · `docs/12-testing/DB_INTEGRATION_CI.md` · `docs/16-progress/{MASTER_PROGRESS,HANDOFF_NEXT_STEPS,TASK_LOG}.md`.

**الملفات/الخدمات المتأثرة (4):** `@wasla/customers-service` وحدها. لا خدمة أخرى ولا حزمة تعتمد عليها بعد (لا HTTP ولا بوت مربوط حتى MR 4/6 و5/6)، فسطح التأثير الخارجي صفر.

**ما الـAPI/Event/Schema الذي تغير (5):** **لا تغيير في أي عقد** — لا `api.openapi.yml` ولا `events.json` ولا `schema.sql` ولا `errors.md`. التغيير الوحيد ذو الأثر العقدي هو أن المجال صار **يحترم** حقلاً كان العقد ينشره ويُسقطه المجال بصمت (`ShipmentDetails.description`، حدّ 300 محرفاً)؛ فهو **لحاقٌ بالعقد لا تعديلٌ له**. ولم يُضَف أي عمود إلى المخطّط.

**كيف تم الاختبار (6):** `pnpm -r run typecheck` نظيف على 17 مشروعاً · `pnpm -r run test` = **553 اختبار وحدة** ناجحة (خدمة العملاء 66: 48 سابقة + 17 حراسة انحراف + 1 حارس خصوصية) · `DATABASE_URL=… pnpm --filter @wasla/customers-service test:integration` = **43 اختبار تكامل** ناجحة على Postgres حقيقي. اختبار المطابقة هو الحارس الأساسي: 16 سيناريو تُكتَب مرّة وتُنفَّذ عبر حالات الاستخدام نفسها بمُهيّئي ذاكرة وPostgres بساعة ومعرّفات ثابتة، والنتيجة **والأحداث** تُقارَن حرفياً.

**ما المشاكل التي ظهرت (7):** (1) **العقد كان يخالف التوثيق:** `CUSTOMER_CORE_DOMAIN.md` كان يقول إن OpenAPI لا تنشر `description`، والعقد ينشره واختبار العقود يُمرّره → عُكس القرار من الإسقاط إلى التبنّي وصُحّح التوثيق صراحةً. (2) **Drizzle يلفّ خطأ المُشغّل:** SQLSTATE `23505` واسم القيد يسكنان `error.cause` لا الخطأ المرفوع → مشي سلسلة `cause` بعمق ≤5 في `translateUniqueViolation`. (3) **`updated_at` يملكه مُشغّل قاعدة البيانات** فالساعة المُحقونة لا تُطبَّق على Postgres → أُسقط من المقارنة مع التحقّق من الاتّجاه، ورُفض تعديل المُشغّل لإرضاء اختبار. (4) لا `draft` في قيد حالة الطلب (`submitted`/`submission_failed` فقط) → صُحّحت مبانٍ اختبارية كانت تفترضه. (5) قيد طول مفتاح الـidempotency (8..128) والفريدة الجزئية على `order_public_id` → ضُبطت المبانٍ. (6) لا Postgres ولا صلاحية جذر في بيئة التطوير → قاعدة اختبار محلية عبر `embedded-postgres` (18.4) والتحقّق النهائي مرجعه CI (`postgres:15`).

**ما الذي لم يكتمل (8):** **لا ذرّية بين كتابة الصف وإلحاق الحدث** — منفذان مستقلّان بلا حدّ معاملة؛ سدُّه يعني تغيير `use-cases/` وهو ما تمنعه هذه الدفعة، فمحلّه MR 4/6. · **`customer_outbox` بلا عمود `trace_id`** فيفقد الحدث المُعاد بناؤه معرّف ارتباطه (لم يُخترع عمود خارج العقد). · **لا ناشر لصندوق الصادر** (`markPublished` جاهز وغير مستعمل). · لا هجرات مولّدة في CI. كلّها مكتوبة في [CUSTOMER_PERSISTENCE.md §7](../02-architecture/CUSTOMER_PERSISTENCE.md).

**الخطوة التالية (9):** MR 4/6 — تطبيق Fastify على المنفذ **8086** + تخطيط كتالوج الأخطاء (18 كوداً) إلى حالات HTTP + `/health` + اختبارات `app.inject` + ربط `createCustomerDb` بدورة حياة تُغلق التجمّع في `onClose` — وهي الموضع المُحدَّد لسدّ دَين الذرّية أعلاه.

**ما الذي يعتمد عليه العمل التالي (10):** لا شيء خارجي. الاستمرارية والمنافذ ومُهيّئاتها قائمة ومُختبَرة؛ MR 4/6 طبقة توصيل فوق ما صار جاهزاً. (بوابة الخروج 6/6 تحتاج **محرّك طلبات بديلاً** يحترم `OrderIntakeRequest`، وهو داخل نطاق تلك الدفعة.)

**Migration/Deployment/Config (11):** لا هجرة ولا تغيير في `schema.sql` — الجداول الخمسة قائمة منذ MR 1/6. اعتماديات جديدة في `services/customers`: `drizzle-orm@^0.45.2` و`pg@^8.23.0` (تشغيل) و`@types/pg` و`drizzle-kit` (تطوير) + `pnpm-lock.yaml` مُحدَّث (CI يعمل بـ`--frozen-lockfile`). متغيّر بيئة واحد: `DATABASE_URL` — بغيابه تُتخطّى اختبارات التكامل ولا يُفتح أي اتصال. وظيفة CI جديدة `customer-db-integration` بقاعدة مستقلّة `wasla_customer_test`.

**مخاطر/قرارات تحتاج مراجعة (12):** (أ) **تبنّي `shipment_description`** يعكس قراراً موثّقاً سابقاً — المبرّر أن السابق قام على قراءة خاطئة للعقد، ويستحق تأكيد مالك المجال. (ب) **مُهيّئ صندوق صادر أُضيف مع المستودع** بينما نصّ HANDOFF قال «مُهيّئ واحد فقط»؛ المبرّر أن ترك الحدث في الذاكرة مع صفٍّ دائم يُنتج تناقضاً صامتاً (§2 من الوثيقة المعمارية). (ج) **نافذة اللاذرّية** خطر تشغيلي حقيقي حتى MR 4/6. (د) التحقّق المحلي جرى على Postgres 18.4 لا 15.

**الروابط (13):** MR [!34](https://gitlab.com/uxxxu/wasla/-/merge_requests/34) · [CUSTOMER_PERSISTENCE.md](../02-architecture/CUSTOMER_PERSISTENCE.md) · [CUSTOMER_CORE_DOMAIN.md](../02-architecture/CUSTOMER_CORE_DOMAIN.md) · [DB_INTEGRATION_CI.md](../12-testing/DB_INTEGRATION_CI.md) · [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · [HANDOFF §9](HANDOFF_NEXT_STEPS.md)

**الشخص/الفريق الذي يتابع (14):** Team 04 — Customer Core (MR 4/6: طبقة HTTP وسدّ دَين الذرّية) · مالك المجال (تأكيد قرار تبنّي `description`) · Team 09 — Notifications/Events (ناشر صندوق الصادر وعمود `trace_id`).

---

## 2026-08-21 · Phase 04 MR 2/6 — نطاق Customer Core ومنافذه وحالات استخدامه

**Task:** تنفيذ ما وعدت به عقود MR 1/6: سلوك مجال العميل **كاملاً وبلا بنية تحتية** — كيانات وتحقّق وأحداث ومنافذ وحالات استخدام ومُهيّئات ذاكرة — لتكون القرارات الصعبة (من يملك الطلب · ما يُثبِّت النقطة · ماذا يحدث حين لا يستجيب المحرّك) محكومةً باختبارات تُقرأ كنصّ سياسة لا بطبقة SQL أو HTTP. **Status:** Completed (48 اختباراً جديداً · إجمالي **535** وحدة على **17** مشروعاً) · **MR:** [!32](https://gitlab.com/uxxxu/wasla/-/merge_requests/32) · **ADR:** لا حاجة (انطباق تنفيذي لـ[ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) — انظر السؤال 8)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر?** مشروع عمل جديد `@wasla/customers-service` (السابع عشر) بطبقة مجال مُنفّذة كاملة: (أ) `src/domain/` — `model.ts` (كيانات ومسودّات وأنواع محصورة) · `errors.ts` (`CustomerError` مبنية من كتالوج العقود + `OrderIntakeFailure`) · `validation.ts` (تحقّق نقيّ يرمي أكواداً موثّقة + تحذيرات + بصمة التكرار) · `events.ts` (ستة مصانع أحداث وقاعدة الخصوصية في موضع واحد). (ب) `src/ports.ts` — سبعة منافذ: `Clock` · `IdGenerator` · `CustomerRepository` · `IdentityLookupPort` · `GeographyPort` · `OrderIntakePort` · `Outbox`. (ج) `src/use-cases/` — `deps.ts` · `zones.ts` · `customer-profile.ts` · `saved-places.ts` · `order-requests.ts` · `mappers.ts` (المجال → DTO المنشور + حمولة التسليم). (د) `src/infrastructure/in-memory.ts` — مستودع يُطبّق قيود `schema.sql` بنفسه + ساعة ثابتة + مولّد متسلسل + صندوق صادر + `FakeIdentityLookup` + `FakeGeography` + `UnavailableOrderIntake` (fail-closed) + `RecordingOrderIntake`. (هـ) ستة ملفات اختبار (48 اختباراً). (و) توثيق: [CUSTOMER_CORE_DOMAIN.md](../02-architecture/CUSTOMER_CORE_DOMAIN.md) (جديد) + [CUSTOMER_CORE.md](../03-domain/CUSTOMER_CORE.md) (عمود حالة التنفيذ) + `MASTER_PROGRESS.md` + `ROADMAP.md` + `HANDOFF_NEXT_STEPS.md` §9 + هذا الإدخال. **لا قاعدة بيانات ولا HTTP في الدفعة** ولم يُلمس أي عقد منشور.
2. **لماذا?** لأن القرارات الحاكمة هنا سلوكية لا تقنية، ولو كُتبت داخل مُعالِج HTTP أو استعلام SQL لصارت مرهونة بهما: كل تحقّق من سياسة يحتاج قاعدة تعمل وطلباً شبكياً. وأخطر من ذلك: لو بُنيت الاستمرارية أولاً لـ**فُرض المخطّط على المجال**، فصار ما تسهل كتابته في SQL هو ما يقرّره النطاق — وهذا بالضبط ما منعه [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) حين جعل المرساة `zone_id` والإحداثية لا تقرّر شيئاً. ولأن الدفعة القادمة (Postgres) والتي بعدها (Fastify) تدخلان **من خلال المنافذ نفسها**، فأي منهما غيّر سلوكاً واحداً من الثمانية والأربعين أسقط اختباراً.
3. **أين?** `services/customers/{package.json,tsconfig.json,vitest.config.ts}` (جديدة) · `services/customers/src/{index.ts,ports.ts,domain/*,use-cases/*,infrastructure/in-memory.ts,__tests__/*}` (جديدة) · `pnpm-lock.yaml` (ربط المشروع) · `docs/02-architecture/CUSTOMER_CORE_DOMAIN.md` (جديد) · `docs/03-domain/CUSTOMER_CORE.md` · `docs/16-progress/{MASTER_PROGRESS.md,ROADMAP.md,HANDOFF_NEXT_STEPS.md,TASK_LOG.md}`.
4. **كيف تم اختباره?** `corepack pnpm -r run typecheck` نطيف على **17** مشروعاً، و`corepack pnpm -r run test` = **535 اختباراً تنجح** (487 سابقاً + 48 جديداً)، و`scripts/checks/scan-secrets.sh` نطيف. والـ48 تقيس **أثراً لا نداءً**: (أ) الملف (8) — الافتراضات `ar`/`active` · رفض معرّف غير مطابق للنمط · هوية مجهولة · تحقّق المنطقة الافتراضية · **تحديث جزئي يحفظ ما لم يُذكر وتفريغ حقل بـ`null`** · وتحديث بلا تغيير **لا يُنتج حدثاً**؛ (ب) الأماكن (10) — حد 20 · تسمية مكرّرة **بلا حساسية لحالة الأحرف** · إعادة المفتاح تُعيد المكان نفسه بحدث واحد · مفتاح مفقود ≠ معطوب · مكان عميل آخر 404؛ (ج) المعاينة (13) — معاينة صالحة **لا تكتب ولا تُحدِث** · وضع السعر في الاتجاهين · أكثر من نقطتين بكوده الخاص · شحنة على مشوار مرفوضة · ملف موقوف 409؛ (د) التسليم (11) — **حمولة التسليم نفسها** تُقارن بعقد `OrderIntakeRequest` · إعادة بلا تسليم ثانٍ · حمولة مختلفة 409 · **fail-closed**: 503 + صفّ `submission_failed` + حدث فشل · حفظ السبب التشغيلي · **إعادة المحاولة على الصفّ نفسه** بحدثين مرتّبين · مكان لا يملكه العميل 404 **قبل أي تسليم** · قصر القراءة على المالك؛ (هـ) الخصوصية (2) — رحلة عميل كاملة ثم **بحث سلبي في الأحداث المُسلسَلة** عن الاسم والتسمية والعنوان والملاحظات والإحداثيتين؛ (و) التخطيط (4) — أسماء الحقول المنشورة وغياب `order_public_id` قبل قبول المحرّك.
5. **ما الخطوة التالية?** MR 3/6: مستودعات Drizzle/Postgres مرآةً لـ`schema.sql` + اختبار حراسة انحراف + وظيفة CI `customer-db-integration` (قاعدة `wasla_customer_test`)، **وفيها يُحسم أمر `shipment_description`** (انظر السؤال 11). الخطة الستّة في [HANDOFF §9](HANDOFF_NEXT_STEPS.md).
6. **هل مستند?** نعم: [CUSTOMER_CORE_DOMAIN.md](../02-architecture/CUSTOMER_CORE_DOMAIN.md) يحمل البنية الفعلية، وجدول المنافذ وما رُكّب في كل منها، و**عشرة قرارات سلوكية بمبرّر كلّ منها وبديله المرفوض** (ترتيب الفحوص · حلّ المناطق بالتسلسل · البصمة بلا عمود · التسليم قبل الكتابة · إعادة المحاولة على الصفّ · اسما الفشل · لا حدث للاشيء · المفقود ≠ المعطوب · الخصوصية مركزية · فصل التسمية)، وجدول الـ48 اختباراً، وجدول **ما لم تفعله الدفعة بقصد** وموضع كل بند. و[CUSTOMER_CORE.md](../03-domain/CUSTOMER_CORE.md) صار يربط كل حالة استعمال بملفّها المُنفّذ.
7. **هل مراجَع?** مُتحقّق آلياً (typecheck على 17 مشروعاً + 535 اختباراً + فحص الأسرار)، والتوثيق يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب?** **لا.** كل قرار معماري في الدفعة منصوص في ADR-009 (ملفّ الدور · مرساة المنطقة · نقطتان كقائمة مرتّبة · وضعا السعر · Idempotency · fail-closed · خصوصية الأحداث)، وهذه الدفعة **تنفّذها ولا تُعيد النقاش فيها**. والقرار الوحيد الجديد تنفيذي: **مشروع عمل جديد** `services/customers` — موضعه موسّس أصلاً في ADR-009 و[CONTAINERS §4.1](../02-architecture/CONTAINERS.md)، ومبرّره حسب [قانون التوثيق §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) موجود في وثيقة الطبقة.
9. **backward compatibility?** لا كسر: لا عقد منشور تغيّر ولا كود خدمة قائمة تُلمس (الهوية · الجغرافيا · القناة). المشروع الجديد `private` ولا مستهلك له بعد (البوت يُربط في MR 5/6)، والحزمة الوحيدة التي يعتمد عليها `@wasla/contracts-customer` قراءةً فقط.
10. **migration?** لا هجرة ولا تعديل مخطّط ولا جدول يُلمس — لا قاعدة في الدفعة أصلاً. بند نشر واحد: `pnpm-lock.yaml` تغيّر بربط المشروع السابع عشر، وCI يستعمل `--frozen-lockfile`، ففرع بلا قفل محدَّث يفشل عند التثبيت.
11. **مخاطر?** (أ) **`shipment_description` في المخطّط بلا مقابل في المجال** — مُعلَن لا مسكوت عنه: `ShipmentDetails` في OpenAPI تنشر `shipment_type` و`weight_kg` فقط، وإدخال حقل نصّي بلا مسار عرض ولا سياسة خصوصية يخلق بياناً لا مالك له؛ وموعد الحسم (استعماله في العقد أو إسقاطه من المخطّط) MR 3/6 حين تُبنى المرآة. (ب) **مستودع الذاكرة قد يختلف عن Postgres** في دقائق الفريدة والترتيب — مُخفّف بأن المستودع يرفض التكرار بنفسه (تسمية ومفتاح) ويرتّب كما ترتّب فهارس `schema.sql`، وبأن MR 3/6 ملزمة بـ**اختبارات مطابقة منافذ** تُشغّل المجموعتين داخل حالات الاستخدام نفسها (كما في Phase 03 MR 5). (ج) **لا معاملة واحدة بين الكتابة وإلحاق الحدث** في الذاكرة — مقبول مرحلياً لأن المنفذين منفصلان بقصد، وصندوق الصادر في MR 3/6 يكتب في **نفس معاملة** الصفّ كما ينصّ المخطّط. (د) **التسليم قبل الكتابة** يعني أن انقطاعاً بين قبول المحرّك وحفظ الصفّ يترك طلباً مقبولاً بلا سجل عندنا — مُحتوى بأن مفتاح Idempotency **يُرسل مع الحمولة**، فإعادة المحاولة لا تُنشئ طلباً ثانياً عند المحرّك؛ والبديل (صفّ `pending` قبل النداء) يخلق حالة ثالثة تحتاج من يُنظّفها ولا أحد ينتظرها.
12. **security?** لا أسرار ولا سطح شبكي جديد (فحص الأسرار نطيف). قرارات أمنية مُنفّذة فعلاً: (أ) **الخصوصية مركزية** — مصانع الأحداث وحدها تبني الحمولة، واختبار سلبي يفتّش الناتج المُسلسَل؛ (ب) **قصر كل قراءة وكل حذف على مالك المورد** — مورد عميل آخر يُردّ 404 لا 403، فلا يُسرّب الردّ وجود المورد؛ (ج) **حدود أطوال ومدى** على كل نصّ ورقم يدخل المجال (تسمية · عنوان · ملاحطات · وزن · إحداثية · مبلغ موجب بعملة ISO)؛ (د) **لا معرّف مُخمّن** — معرّفات الكيانات تأتي من `IdGenerator` لا من مدخل المتصل.
13. **performance?** لا مسار تشغيل بعد. المجموعة كلّها تعمل في ~1.2 ثانية، وقرار أدائي مقصود واحد: **حلّ المناطق بالتسلسل لا بالتوازي** — نداءان لا أكثر، والحتمية في أيّ خطأ يراه العميل أغلى من توفير ملّي ثانية. والمستودع يقرأ `countPlaces` قبل الإدخال لا يجلب القائمة كلّها — في Postgres يصير `COUNT` مفهرساً لا مسحاً.
14. **monitoring?** مؤجّل إلى طبقة HTTP (MR 4/6). ومادة المراقبة صارت موجودة فعلاً: كل محاولة تسليم تنتهي بـ**حدث واحد يطابق ما كُتب** (`submitted` أو `submission_failed`)، والسبب التشغيلي يُحفظ في الصفّ ويُنشَر في الحدث، فللفشل **اسم قابل للقياس** لا عدّاد 503 مبهم، و`traceId` يُمرّر من `UseCaseDeps` إلى مغلّف كل حدث وإلى كائن الخطأ.

**Related:** [CUSTOMER_CORE_DOMAIN.md](../02-architecture/CUSTOMER_CORE_DOMAIN.md) · [CUSTOMER_CORE.md](../03-domain/CUSTOMER_CORE.md) · [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · [عقود الخدمة](../../services/customers/contracts/README.md) · [MASTER_PROGRESS](MASTER_PROGRESS.md) · [HANDOFF §9](HANDOFF_NEXT_STEPS.md)

---

## 2026-08-21 · Phase 04 MR 1/6 — عقود Customer Core وحدّ تسليم الطلب (ADR-009)

**Task:** فتح Phase 04 من طرفها الصحيح: تعريف **ما يملكه العميل** (ملفه · أماكنه · نيّة طلبه) وتثبيت **الحدّ** بينه وبين محرّك الطلبات غير الموجود بعد، عقوداً أولاً (ADR-004) قبل أي سطر تنفيذ. **Status:** Completed (42 اختباراً جديداً · إجمالي 487 وحدة) · **MR:** [!31](https://gitlab.com/uxxxu/wasla/-/merge_requests/31) · **ADR:** [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) بسبعة قرارات: خدمة `services/customers` مستقلّة (انحراف معلَن عن شجرة §68) · ملف العميل **ملفُّ دور** مفتاحه `wasla_public_id` بلا FK إلى الهوية · `OrderIntakePort` منفذاً واحداً للتسليم والخدمة لا تكتب `orders` · النقطة تُعرَّف بـ`zone_id` إلزامياً والإحداثية اختيارية لا تُقرّر شيئاً · النقاط قائمة مرتّبة بنقطتين في هذه المرحلة · السعر وضعان صريحان (`customer_offer` / `negotiable`) بلا سعر استرشادي · `Idempotency-Key` إلزامي على الكتابات. (ب) عقود الخدمة في `services/customers/contracts/`: `api.openapi.yml` (سبعة مسارات) + `events.json` (ستة أحداث v1) + `schema.sql` (خمسة جداول + محفّزات) + `errors.md` (18 كوداً ثابتاً + جدول أسباب فشل التسليم + مسارات الفشل) + `README.md`. (ج) حزمة `@wasla/contracts-customer`: أنواع مُولّدة من OpenAPI + أنواع أحداث مكتوبة يدوياً بحرّاس انحراف + **كتالوج أكواد الأخطاء** وصنف كلٍّ منها ودالة استخراج حالة HTTP + ثوابت سياسة المرحلة. (د) توثيق: [CUSTOMER_CORE.md](../03-domain/CUSTOMER_CORE.md) (جديد) + [CONTAINERS.md §4.1](../02-architecture/CONTAINERS.md) + `MASTER_PROGRESS.md` + `ROADMAP.md` + `HANDOFF_NEXT_STEPS.md` §9 + هذا الإدخال. **لا كود تنفيذ في هذه الدفعة** — لا نطاق ولا منافذ مُنفَّذة ولا HTTP.
2. **لماذا؟** لأن السؤال الحاكم في هذه المرحلة ليس «كيف نخزّن طلباً» بل «**من يملك الطلب**». محرّك الطلبات مرحلته السادسة، وإن سمحنا لخدمة العميل أن تكتب `orders` اليوم فسيصير التنظيف في Phase 06 هجرة بيانات لا إعادة توصيل. ولذلك ثُبّت الحدّ عقداً واحداً (`OrderIntakePort`) ومُنع الوصول المباشر، وحُرِس المنع **باختبارات تقرأ `schema.sql` و`api.openapi.yml`** لا بتعليق في وثيقة. وثانياً لأن الإحداثية مُغرية: النظام لا يملك Reverse Geocoding ولا حساب مسافة (§28 مؤجّل)، فلو صارت الإحداثية أساس النقطة لصار المجال يعتمد على قدرة لا وجود لها؛ المرساة هي `zone_id` من هرم [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)، والإحداثية للعرض والتسليم فقط.
3. **أين؟** `docs/15-decisions/ADR-009-*.md` (جديد) · `services/customers/contracts/{api.openapi.yml,events.json,schema.sql,errors.md,README.md}` (جديدة) · `packages/contracts/customer/{package.json,tsconfig.json,src/{index.ts,api-types.ts,events-types.ts,__tests__/{contracts.test.ts,events.test.ts}}}` (جديدة) · `pnpm-lock.yaml` (ربط الحزمة) · `docs/03-domain/CUSTOMER_CORE.md` (جديد) · `docs/02-architecture/CONTAINERS.md` · `docs/16-progress/*`.
4. **كيف تم اختباره؟** `corepack pnpm -r run typecheck` نظيف على **16** مشروعاً، و`corepack pnpm -r run test` = **487 اختباراً تنجح** (445 سابقاً + 42 جديداً)، و`scripts/checks/scan-secrets.sh` نظيف. الـ42 ليست فحص أنواع فقط: **حرّاس انحراف** يقرأون ملفات العقد نفسها ويفشلون إذا انفصل الرمز عن الوثيقة — (أ) كتالوج `CUSTOMER_ERROR_CODES` يُقارَن سطراً بسطر بجدول `errors.md`، وصنف كل كود يُقارَن بما هو موثّق، ولا حالة HTTP خارج الأصناف الخمسة؛ (ب) `CUSTOMER_EVENT_TYPES` يُقارَن بحروف `event_type` في `events.json` مع تأكيد `producer` و`event_version`؛ (ج) **قاعدة الخصوصية مُختبَرة**: أي حمولة حدث تحوي `latitude`/`longitude`/`label`/`notes`/`description`/`display_name` تُسقط الاختبار؛ (د) **حرّاس حدود ADR-009** على `schema.sql`: لا `CREATE TABLE orders` ولا `REFERENCES orders` ولا FK إلى `identity_users`/`geo_zones`، والمال `BIGINT` لا `NUMERIC`، و`order_public_id` يبقى قابلاً لـ`NULL`، والنقاط مفتاحها `(order_request_id, sequence)` **بلا** فريدة على `kind` (وإلا استحال Multi-stop بلا هجرة)؛ (هـ) على `api.openapi.yml`: `Idempotency-Key` مُعلَن `required: true` ومرجوع إليه في الكتابتين، والنقاط `minItems: 2` و`maxItems: 2`، **ولا مسار ولا عملية تمسّ الطلبات**.
5. **ما الخطوة التالية؟** MR 2/6: نطاق العميل ومنافذه وحالات استخدامه ومُهيّئاته in-memory (`services/customers/src/{domain,ports,use-cases,infrastructure}`) — بلا قاعدة بيانات وبلا HTTP. الخطة الستّة كاملة في [HANDOFF §9](HANDOFF_NEXT_STEPS.md).
6. **هل مستند؟** نعم: ADR-009 يحمل القرارات وبدائلها ونتائجها، و[CUSTOMER_CORE.md](../03-domain/CUSTOMER_CORE.md) يحمل الكيانات وحالات الاستعمال والمنافذ واتجاه التبعية وسياسة Idempotency والفشل وجدول **المؤجّل صراحةً مع مرحلة كلٍّ منه**، و[CONTAINERS.md §4.1](../02-architecture/CONTAINERS.md) يحمل الانحراف عن شجرة الخدمات مُعلَناً لا مسكوتاً عنه.
7. **هل مراجَع؟** الكود والعقود مُتحقَّقة آلياً (typecheck على 16 مشروعاً + 487 اختباراً + فحص الأسرار)، والتوثيق يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** **نعم — وهو ADR-009 نفسه.** الدفعة تُقرّر ثلاثة قرارات لا رجعة فيها بلا ثمن: موضع خدمة جديدة خارج شجرة §68، وملكية الطلب (من يُولّد `order_public_id`)، وتعريف النقطة الجغرافية. كلٌّ منها كان سيصير في Phase 06 هجرة بيانات لو تُرك ضمنياً.
9. **backward compatibility؟** لا كسر: لا تُعدَّل عقود قائمة (الهوية · الجغرافيا · القناة) ولا يُلمس كودها. الحزمة الجديدة `private` ولا مستهلك لها بعد.
10. **migration؟** `schema.sql` جديد بالكامل (`CREATE TABLE IF NOT EXISTS`) وبقسم تراجع معلَّق بترتيب عكسي. لا جدول قائم يُعدَّل. تشغيل الترحيل فعلياً يقع في MR 3/6 مع مُهيّئات Postgres ووظيفة CI الخاصة بها.
11. **مخاطر؟** (أ) **العقد يسبق التنفيذ** فقد يظهر في MR 2/6 أن حقلاً ناقص — مُحتوى لأن العقد لم يُنشر لمستهلك خارجي بعد، وأي تعديل يمرّ بـMR وبحرّاس الانحراف. (ب) **الخدمة تعتمد على محرّك غير موجود** — مُحتوى بأن المحوّل الافتراضي **fail-closed**: بلا تهيئة يُرجع 503 ويُسجّل `submission_failed` وحدث فشل، فلا طلب صامت بلا مالك. (ج) **قيد النقطتين** قد يُقرأ لاحقاً كتصميم دائم — مُحتوى بأن التخزين قائمة مرتّبة والقيد في طبقة الاستعمال ومُختبَر أنه ليس في المخطّط.
12. **security؟** لا أسرار في الدفعة (فحص الأسرار نظيف). قرارات أمنية موجبة: الأحداث **لا تنشر** إحداثيات خام ولا نصوص المستخدم (قاعدة مُختبَرة) · لا FK بين الخدمات يمنع ربط بيانات عبر الحدود بقاعدة واحدة · `Idempotency-Key` يمنع تكرار الكتابة من قناة عامة · وصف الشحنة والملاحظات محدودة الطول بقيود قاعدة.
13. **performance؟** لا مسار تشغيل في الدفعة. المخطّط يحمل فهارس القراءات المتوقّعة: أماكن العميل مرتّبة بالأحدث استعمالاً، طلباته بالأحدث إنشاءً، فريدتا Idempotency، وفهرس جزئي على غير المنشور في صندوق الصادر، وفريدة جزئية على `order_public_id` عند وجوده.
14. **monitoring؟** مؤجّل إلى طبقة HTTP (MR 4/6): `/health` مُعلَن في العقد على المنفذ 8086. وأسباب فشل التسليم الثلاثة (`UNAVAILABLE`/`REJECTED`/`TIMEOUT`) مُعرَّفة الآن ليكون للفشل **اسم قابل للقياس** لا كود 503 مُبهم.

**Related:** [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · [CUSTOMER_CORE.md](../03-domain/CUSTOMER_CORE.md) · [عقود الخدمة](../../services/customers/contracts/README.md) · [CONTAINERS §4.1](../02-architecture/CONTAINERS.md) · [MASTER_PROGRESS](MASTER_PROGRESS.md) · [HANDOFF §9](HANDOFF_NEXT_STEPS.md)

---

## 2026-08-21 · Phase 03 MR 7/7 — بوابة خروج المرحلة (E2E) وإغلاق Phase 03

**Task:** تحويل نصّ بوابة الخروج المنشور («كل Bot يفتح Mini App المناسبة، ويمكن استبدال Telegram adapter في الاختبارات بـMock Adapter») من جملة في خريطة الطريق إلى **اختبار يفشل إذا كُسر**: البوتات الثلاثة معاً في عملية واحدة، أمام خدمة هوية واحدة تستمع فعلياً على HTTP، ومخازن قناة مشتركة — ثم إغلاق المرحلة. **Status:** Completed (446 اختباراً تنجح محلياً: 445 بمخازن الذاكرة + اختبار صفوف يعمل مع `DATABASE_URL`؛ الجديد: 8) · **MR:** [!30](https://gitlab.com/uxxxu/wasla/-/merge_requests/30) · **ADR:** لا حاجة (انظر السؤال 8)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) حزمة جديدة **اختبارية بحتة** `packages/channel-e2e` (`@wasla/channel-e2e`، بلا `src/index.ts` وبلا تصدير، وكل اعتمادياتها `devDependencies`): `src/__tests__/harness.ts` يبني خدمة الهوية على منفذ حقيقي (`127.0.0.1:0`) بمحوّلات in-memory، ويُنتج بيئة كل بوت (`envFor`) ويبنيه بتجاوز مقبس القناة إلى `MockChannelAdapter` (`buildGateBot`/`buildGateBots`)، ويقرأ صندوق الصادر من المصدر الفعلي (SQL عند وجود قاعدة، وإلّا `InMemoryOutbox.events`) بشكل موحّد، ويُطبّق `packages/channel-core/contracts/schema.sql` ويُفرغ جداوله. و`src/__tests__/phase03-exit-gate.e2e.test.ts` = ثمانية اختبارات (تفصيلها في السؤال 4). (ب) `.gitlab-ci.yml`: وظيفة `channel-exit-gate-e2e` تُوسّع `.db-integration-base` بخدمة `postgres:15` وقاعدة مستقلّة `wasla_channel_e2e`. (ج) توثيق: [PHASE03_EXIT_GATE_E2E.md](../12-testing/PHASE03_EXIT_GATE_E2E.md) (جديد) + [DB_INTEGRATION_CI.md](../12-testing/DB_INTEGRATION_CI.md) (صفّ الوظيفة + الاستثناء المقصود + تصحيح حدّ قديم صار غير صحيح) + [CONTAINERS.md](../02-architecture/CONTAINERS.md) (صفّ الحزمة + موقعها خارج رسم الاعتماد) + [CHANNEL_BOTS.md](../02-architecture/CHANNEL_BOTS.md) + [CHANNEL_LAYER_CORE.md](../02-architecture/CHANNEL_LAYER_CORE.md) (صفّا المؤجّل يصيران ✅ ويُفرَز منهما ما **لم** يُنجَز) + `MASTER_PROGRESS.md` + `ROADMAP.md` + `HANDOFF_NEXT_STEPS.md` + هذا الإدخال. **لم يُلمس أي كود إنتاجي:** لا عقود (`api.openapi.yml` · `events.json` · `schema.sql` · كتالوج الأخطاء)، ولا نواة، ولا مُهيّئ، ولا طبقة تشغيل، ولا جذور البوتات. الدفعة **دليل** لا ميزة.
2. **لماذا؟** لأن الأخطاء التي وُضعت البوابة لأجلها **لا تظهر في أي اختبار بوت واحد**، فهي أخطاء علاقة لا أخطاء وحدة: (أ) بوت يُجيب بزر Mini App بوتٍ آخر — البوت المقيس بنفسه يبقى متّسقاً مع نفسه أياً كان اشتقاقه؛ (ب) ثلاثة بوتات تُنشئ **ثلاثة حسابات** لشخص واحد — تعدّد الحسابات يحتاج ثلاثة عملاء يقصدون **خدمة هوية واحدة**؛ (ج) `update_id` واحد من بوتين يتصادم في فهرس منع التكرار **المشترك** — لا تصادم إذا لم يشترك أكثر من بوت في مخزن واحد. ولذلك خدمة الهوية تستمع على منفذ حقيقي ويُستدعى محوّل الإنتاج عبر HTTP: «هوية واحدة» يجب أن يكون حكماً تصدره الخدمة لا افتراضاً يصنعه الاختبار.
3. **أين؟** `packages/channel-e2e/{package.json,tsconfig.json,vitest.config.ts,src/__tests__/{harness.ts,phase03-exit-gate.e2e.test.ts}}` (جديدة) + `.gitlab-ci.yml` + `pnpm-lock.yaml` (ربط الحزمة) + `docs/12-testing/` + `docs/02-architecture/` + `docs/16-progress/`.
4. **كيف تم اختباره؟** `corepack pnpm -r run typecheck` نظيف على **15** مشروعاً، و`corepack pnpm -r run test` = **445 اختباراً تنجح** (438 سابقاً + 7 بمخازن الذاكرة)، وبـ`DATABASE_URL` على Postgres 15 محلي: **8 من 8** بما فيها اختبار الصفوف، و`scripts/checks/scan-secrets.sh` نظيف. ما تُثبته الثمانية: (أ) `GET /channel/<bot>/mini-app` يُعيد Mini App البوت وتسميته وعنوانه، وللبوتين الآخرين **404 `CHANNEL_UNKNOWN_BOT`**. (ب) `/start` → 202 و**رسالة واحدة** من نوع `text_with_buttons` بمفتاح `start:<bot>:<update_id>` وزرّ واحد `{type: mini_app, miniApp: <bot>}`: customer→customer · driver→driver · partner→partner، مع `channel.mini_app.launched` لكل بوت في صندوق الصادر. (ج) نفس `telegram_user_id` عبر البوتات الثلاثة ⇒ سؤال الهوية مباشرة يُعيد **200** و`created: false` و`WS-\d{10}`، وحدث `identity.created` **مرّة واحدة**، ولا يظهر `wasla_public_id` في أي حدث قناة (ADR-007 قاعدة 4). (د) إعادة نفس التحديث ⇒ **202 `duplicate`** (لا 4xx: كل ردّ غير 2xx يُغري Telegram بمزيد من الإعادة) ورسالة واحدة وحدث `channel.update.received` واحد. (هـ) نفس `update_id` من customer وdriver ⇒ **كلاهما `accepted`** ولكلٍّ زرّه — أي أنّ مفتاح التفرّد يشمل البوت فعلاً. (و) بوت مبنيّ من **التهيئة وحدها** يحمل `TelegramChannelAdapter`، ونفسه بتجاوز مقبس واحد يحمل `MockChannelAdapter`، والاثنان يجيبان `channel === telegram` — فالاستبدال تجاوزٌ لافتراضٍ حقيقي لا مسارٌ وحيد. (ز) `GET /health` = 200 و`runtime.persistence` يُعلن ما رُكِّب به فعلاً. (ح) على Postgres: صفّ `channel_updates` واحد لكل (بوت، تحديث) بحالة `processed`، وصفّ `channel_deliveries` واحد لكل بوت `sent` بمحاولة واحدة و`body.buttons[0].miniApp` صحيح (لأن الجسم المحفوظ هو ما ستُعيد المحاولة إرساله)، و`channel_outbox.aggregate_id` = مرجع المحادثة لا أي معرّف هوية. **وفحص طفرة**: عند جعل اشتقاق Mini App يُعيد `customer` دائماً في `bot-runtime/src/config.ts` سقطت **4 اختبارات** من الثمانية، ثم أُعيد التعديل — فالبوابة حسّاسة للخطأ الذي وُضعت له، لا خضراء بالمجاملة.
5. **ما الخطوة التالية؟** **Phase 03 مغلقة**؛ التالي Phase 04 حسب [ROADMAP](ROADMAP.md). ويُنقَل إلى أول عمل تشغيلي في المرحلة القادمة عملان مُعلَنان من MR 5 **لم تُنجزهما هذه الدفعة بقصد** (البوابة لا تنصّ عليهما وإدخالهما كان سيُخرجها عن نطاقها): **مُشغّل دوري** لـ`retryDueDeliveries` و**ناشر صندوق الصادر**، ومعهما سياسة استبقاء لـ`channel_updates` وإرسال `telegram_username` في تهيئة الهوية.
6. **هل مستند؟** نعم: [PHASE03_EXIT_GATE_E2E.md](../12-testing/PHASE03_EXIT_GATE_E2E.md) يحمل نصّ البوابة، وجدول الأخطاء الثلاثة التي لا يراها اختبار بوت واحد، ورسم التركيب، وجدول القرارات المقصودة بمبرّر كلٍّ منها، وتفصيل الثمانية، ونتيجة فحص الطفرة **وحدوده** (تغيير قيمة `_MINI_APP_URL` لا يُسقط شيئاً لأن الاختبار يقارن الردّ بنفس المتغيّر المُركَّب — وصحّة العنوان في الإنتاج مسألة تهيئة لا اختبار)، وطريقة التشغيل محلياً وفي CI، والقيود الواعية.
7. **هل مراجَع؟** الكود مُتحقَّق آلياً (typecheck على 15 مشروعاً + 445 وحدة + 8/8 على Postgres + فحص الأسرار) والتوثيق يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** **لا.** الدفعة لا تُقرّر شيئاً معمارياً: لا منفذ جديد ولا عقد ولا سياسة سلوك؛ هي **إثبات** لما قرّرته [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) و[ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md). القرار الوحيد فيها هيكلي وموضعه هذا السجل + وثيقة البوابة + [CONTAINERS.md](../02-architecture/CONTAINERS.md): **حزمة اختبار جديدة** — مبرَّرة حسب [قانون التوثيق §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) بأنها الموضع الوحيد المسموح فيه استيراد جذور التركيب الثلاثة معاً؛ وضع المجموعة في `bot-runtime` أو `channel-postgres` يخلق دورة اعتماد (`bots → bot-runtime → channel-postgres`)، و`packages/test-utils` موثّقة لأدوات مشتركة لا لمجموعة اختبار قائمة بذاتها.
9. **هل يكسر backward compatibility؟** لا شيء إطلاقاً: صفر تغيير في كود الإنتاج والعقود. الحزمة الجديدة **لا يستوردها** أي كود إنتاجي، فلا حافة جديدة في رسم الاعتماد.
10. **هل migration؟** لا هجرة ولا تعديل مخطّط. بند نشر واحد: `pnpm-lock.yaml` تغيّر بربط الحزمة، وCI يستعمل `--frozen-lockfile` — فأي فرع لا يحمل القفل المحدَّث يفشل عند التثبيت.
11. **هل توجد مخاطر؟** (أ) **حزمة اختبار في `packages/`** قد تُقرأ لاحقاً كأنها مكتبة — مُخفَّف بأنها بلا `src/index.ts` وبلا تصدير، وبصفّ صريح في CONTAINERS يقول ذلك. (ب) **هوية in-memory داخل البوابة** — استمرارية الهوية بوابة Phase 01 ومغطّاة في `db-integration`؛ تكرارها هنا كان سيقيس نفس الشيء مرّتين ويُضيف مخطّطاً ثانياً لهذه الوظيفة بلا مقابل. (ج) **لا شبكة Telegram حقيقية** — العقد مع Bot API مغطّى في 99 اختباراً للمُهيّئ، والبوابة تفحص أنه المُركَّب افتراضياً فقط. (د) **الاختبار يعمل مرّتين في CI** (بمخازن الذاكرة داخل `build-test`، وبـPostgres في وظيفته) — تكلفة زمن مقصودة: بوابةٌ يمكن تخطّيها ليست بوابة. (هـ) **حدّ فحص الطفرة** أعلاه: صحّة عنوان Mini App الفعلي مسألة تهيئة بيئة، ومعلَنة في وثيقة البوابة حتى لا تُقرأ البوابة أوسع مما تُثبت.
12. **هل security؟** لا سطح جديد. وتُثبِت الدفعة قاعدتين أمنيتين قائمتين: **لا ربط `chatRef ↔ waslaPublicId` في طبقة القنوات** (يُفحَص بأن المعرّف العام لا يظهر في أي حدث قناة)، و**التحقّق من رمز الـwebhook** يعمل في المسار الكامل (كل نداء في البوابة يمرّ بالترويسة الصحيحة). ولا رمز ولا مرجع غرفة حقيقي في الملفات الجديدة: كلها قيم اختبار صريحة، و`scan-secrets` نظيف.
13. **هل performance؟** المجموعة كلّها ~0.2 ثانية بمخازن الذاكرة و~0.4 ثانية على Postgres (البوتات عبر `app.inject` بلا منافذ، وخدمة الهوية وحدها تحمل منفذاً). القرار المتعمَّد: خدمة هوية جديدة لكل اختبار — كلفة ملّي ثانية مقابل أن يُثبَت «هوية واحدة» من سجلٍّ فارغ لا موروثاً من اختبار سابق.
14. **هل monitoring؟** لا مقياس جديد، لكن البوابة تُثبت أنّ آثار المراقبة القائمة تُكتب فعلاً في المسار الكامل: صفوف `channel_updates` بحالتها، وصفوف `channel_deliveries` بمحاولاتها، وأحداث `channel.update.received` و`channel.mini_app.launched` في صندوق الصادر — وهي المادة التي سيقوم عليها الناشر والتنبيهات في Phase 04.

**Related:** [PHASE03_EXIT_GATE_E2E.md](../12-testing/PHASE03_EXIT_GATE_E2E.md)، [DB_INTEGRATION_CI.md](../12-testing/DB_INTEGRATION_CI.md)، [CONTAINERS.md](../02-architecture/CONTAINERS.md)، [CHANNEL_BOTS.md](../02-architecture/CHANNEL_BOTS.md)، [CHANNEL_LAYER_CORE.md](../02-architecture/CHANNEL_LAYER_CORE.md)، [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)، [ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md)، [ROADMAP](ROADMAP.md)، [HANDOFF §7](HANDOFF_NEXT_STEPS.md)، [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md)

---

## 2026-08-21 · Phase 03 MR 6 — مُهيّئ المجموعات (دعم/تصعيد) وتحديثات المجموعات

**Task:** تنفيذ البند الموثّق الأخير قبل بوابة الخروج: أن تعرف طبقة القنوات أنّ محادثةً ما **مجموعة**، وأنها **مجموعتنا**، و**ما يجوز أن يُرسَل إليها** — تنفيذاً للقاعدة 9 في [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) («المجموعة نوع محادثة داخل نفس المنافذ، لا مسار كود مُوازٍ») ومع سياسة صريحة: لا تهيئة هوية داخل غرفة · لا زر Mini App نحو غرفة · صمت تام في غرفة غير مُعلَنة · وأحداث العضوية تصبح مرئية بدل 422. **Status:** Completed (438 اختبار وحدة تنجح محلياً؛ الجديد: 45) · **MR:** [!29](https://gitlab.com/uxxxu/wasla/-/merge_requests/29) · **ADR:** [ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) `packages/channel-core`: `domain/model.ts` يكتسب `ConversationScope` (`private`/`group`) و`GroupRole` (`support`/`escalation`/`community`) و`GroupPresence`؛ `ports.ts` يكتسب المنفذ **العاشر** `GroupRegistryPort` (`roleFor` · `groupsFor`) وتُعاد ترقيم قسم الساعة/المولّد؛ `use-cases/deps.ts` يُضيف `groups?` **اختياريّاً** إلى `InboundDeps` و`OutboundDeps`؛ `use-cases/receive-update.ts` يشتقّ `scope` ويقرأ `groupRole` من السجل ويحسب `replyAllowed` ويقصر تهيئة الهوية على المحادثات الخاصة (وتُعاد الحقول الثلاثة في فرع التكرار أيضاً)؛ `use-cases/send-message.ts` يرفض نيّة `mini_app` نحو مجموعة مُعلَنة **قبل** إنشاء صفّ التسليم؛ `infrastructure/in-memory.ts` يُضيف `StaticGroupRegistry` + `testGroupRegistry`. (ب) `packages/telegram-adapter`: `api-shapes.ts` يُضيف `MEMBERSHIP_FIELDS` وقائمة الحالات المسموحة؛ `update-parser.ts` يُحلّل `my_chat_member`/`chat_member` **داخل المجموعات** إلى `group_event` بعلامة (`bot_status:<s>` / `member_status:<s>`، وغير المعروف `unknown`) ويُميّز علامات أحداث الخدمة (`joined:N` · `left:1` · `migrated` · `created`)؛ `keyboard.ts` يُصدّر `isGroupChatRef` ويرفض زر `web_app` نحو غرفة؛ `channel-adapter.ts` يُمرّر `chatRef` إلى بناء لوحة الأزرار. (ج) `packages/bot-runtime`: `config.ts` يُضيف `GROUP_ENV_NAMES` و`loadGroupPresences` (قراءة صارمة تفشل عند الإقلاع) و`BotConfig.groups`؛ `runtime.ts` يبني **سجلّاً واحداً** يتشارك الاتجاهان ويُعلنه في `BotRuntime.groups`؛ `welcome.ts` يُضيف نصوص المجموعات لكل دور و`buildGroupStartReply` بزرّ `deep_link`؛ `http/app.ts` يُوجّه الردّ حسب `replyAllowed` و`scope`؛ `http/server.ts` يُخبر التطبيق بتوفّر قالب الرابط العميق. (د) اختبارات: `channel-core/src/__tests__/groups.test.ts` + `telegram-adapter/src/__tests__/group-updates.test.ts` + `bot-runtime/src/__tests__/groups.test.ts` وتمديد الـharness بمساعدَي تحديث. (هـ) توثيق: [ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md) (جديد) + [CHANNEL_GROUPS.md](../02-architecture/CHANNEL_GROUPS.md) (جديد — ثمانية أقسام) + تحديث `CHANNEL_LAYER_CORE.md` (تسعة → عشرة منافذ) و`CHANNEL_TELEGRAM_ADAPTER.md` و`CHANNEL_BOTS.md` (ثلاثة متغيّرات بيئة جديدة) و`CHANNEL_PERSISTENCE.md` (تصحيح محلّ المؤجّل) + `HANDOFF_NEXT_STEPS.md` + `MASTER_PROGRESS.md` + هذا الإدخال. **لم تُلمس** العقود: لا `api.openapi.yml` ولا `events.json` ولا `schema.sql` ولا كتالوج الأخطاء، ولا `.gitlab-ci.yml`، ولا حزمة جديدة.
2. **لماذا؟** لأن ثلاث فجوات كانت ستُغلق بقرار ضمني في الكود لو لم تُوثَّق: (أ) **من يعرف أنّ الغرفة غرفتنا؟** الجدول المُصمَّم لذلك (`channel_group_bindings`) مؤجَّل إلى Phase 08 لأنه يحتاج خدمة الدعم؛ فجُعلت المعرفة **منفذاً يقرأ الإعداد** لا جدولاً — نفس منطق ADR-007 حين جعل عنوان Mini App إعداداً محقوناً، وثمنه استبدال محوّل واحد لاحقاً بدل تعديل النواة والبوتات. (ب) **الهوية.** الكود قبل هذه الدفعة كان يُهيّئ الهوية لأي `/start` يحمل فاعلاً — بما في ذلك داخل مجموعة. ومرجع المجموعة **مشترك بين كل الأعضاء**، فتهيئتها من غرفة تربط شخصاً واحداً بغرفة كاملة، وهو ربط خاطئ لا يُنقَض لاحقاً. (ج) **سطح التشغيل.** Telegram ترفض زر `web_app` خارج المحادثات الخاصة بخطأ 400 غامض، فالمحاولة تستهلك خمس محاولات إعادة بلا جدوى؛ والصحيح رابط عميق يفتح المحادثة الخاصة حيث يصير الزر شرعيّاً. ورابعة أمنية: **أي شخص يستطيع إضافة البوت إلى غرفة**، فاعتبار كل غرفة شرعية يحوّل البوت إلى ناشر لروابط تطبيقاتنا في غرف لا نعرفها.
3. **أين؟** `packages/channel-core/src/{domain/model.ts,ports.ts,index.ts,use-cases/{deps,receive-update,send-message}.ts,infrastructure/in-memory.ts}` + `packages/telegram-adapter/src/{api-shapes,update-parser,keyboard,channel-adapter,index}.ts` + `packages/bot-runtime/src/{config,runtime,welcome,index}.ts` و`src/http/{app,server}.ts` + ثلاثة ملفات اختبار جديدة وharness + `docs/15-decisions/` + `docs/02-architecture/` + `docs/16-progress/`.
4. **كيف تم اختباره؟** `corepack pnpm -r run typecheck` نظيف على 14 مشروعاً، و`corepack pnpm -r run test` = **438 اختباراً تنجح** (393 سابقاً + 45: النواة 18 · المُهيّئ 13 · طبقة التشغيل 14)، و`scripts/checks/scan-secrets.sh` نظيف (لا مرجع غرفة حقيقي في المستودع — كلّها من البيئة). ما تُثبته: (أ) **النطاق** — تحديث مجموعة يُنتج `scope = group`، والدور يُقرأ من السجل، و`replyAllowed` صحيحة للخاص وللغرفة المُعلَنة وخاطئة للغرفة المجهولة، والحقول الثلاثة تعود **في فرع التكرار أيضاً** (وإلا لتصرّف البوت في إعادة الإرسال تصرّفاً مختلفاً). (ب) **الهوية** — `/start` في مجموعة **لا يُنادي** مُهيّئ الهوية إطلاقاً، بينما في الخاص يُناديه؛ والتحديث يُسجَّل ويُنشر حدثه في الحالتين. (ج) **سطح التشغيل** — نيّة `mini_app` نحو مجموعة مُعلَنة ترفع `CHANNEL_INVALID_MESSAGE` **ولا تُنشئ صفّ تسليم** (يُثبَت بإعادة إرسال بنفس مفتاح الـidempotency فتُنشئ صفّاً جديداً لا تجد قديماً)، و`buildInlineKeyboard` ترفض الزر نحو معرّف سالب مستقلّةً عن السجل. (د) **الردّ** — الغرفة المُعلَنة تُجاب داخلها بزرّ `deep_link` ونصّ يخصّ الدور، وبوت بلا قالب رابط عميق يُجاب بنصّ فقط، ونفس مفتاح منع التكرار يجعل إعادة إرسال Telegram بلا رسالة ثانية. (هـ) **الصمت** — الغرفة المجهولة: 202 · تحديث مُسجَّل · حدث منشور · **صفر رسائل**. (و) **العضوية** — إضافة البوت إلى غرفة تُقبَل `group_event` بعلامة الحالة بدل `unsupported`/422، والحالة غير المعروفة تُبلَّغ `unknown`، وتغيير العضوية في محادثة خاصة يبقى `unsupported` بقصد. (ز) **الإقلاع** — مرجع فارغ أو أطول من الحدّ أو غرفة واحدة تحت دورين ⇒ فشل إقلاع صريح. (ح) **الحراسة المعمارية** — `neutrality.guard.test.ts` يمرّ: لا مفردة قناة في الكود الجديد للنواة. الاختبارات تتحقّق من **الأكواد** لا من النصوص العربية ([DEFINITION_OF_DONE](../00-rules/DEFINITION_OF_DONE.md)).
5. **ما الخطوة التالية؟** MR 7/7: بوابة خروج المرحلة 03 — E2E يُثبت أن كل بوت يفتح Mini App المناسبة وأن مُهيّئ القناة قابل للاستبدال بـMock، ثم إغلاق المرحلة. ويبقى عملان تشغيليان مُعلَنان من MR 5: **مُشغّل دوري** لـ`retryDueDeliveries` و**ناشر صندوق الصادر**.
6. **هل مستند؟** نعم: [CHANNEL_GROUPS.md](../02-architecture/CHANNEL_GROUPS.md) بثمانية أقسام تحمل سبب وجود القطعة وحدودها، وجدول حقول القرار (`scope`/`groupRole`/`replyAllowed`)، والمنفذ العاشر ومتغيّراته، والقواعد الأربع بمبرّر كلٍّ منها، وجدول أحداث حياة المجموعة، وخريطة «أين يعيش كل شيء»، وحالة التحقّق، وجدول المؤجّلات ومحلّ كل مؤجّل. ومعها تحديث الوثائق الثلاث القائمة حتى لا يبقى فيها «تسعة منافذ» ولا صفّ مؤجّل يقول «MR 6».
7. **هل مراجَع؟** الكود مُتحقَّق آلياً (typecheck + 438 وحدة + فحص الأسرار) والتوثيق يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** **نعم — وكُتِب: [ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md).** السبب أن الدفعة تُعدّل قائمة منصوصة في ADR-007 §2 (تسعة منافذ ⇒ عشرة) وتُقرّر سياسة لم يحسمها ADR-007: مصدر معرفة المجموعات إعدادٌ لا جدول، ومنع تهيئة الهوية في المجموعات (وهو **تصحيح** لسلوك قائم)، ومنع سطح التشغيل نحو غرفة، والصمت في الغرفة المجهولة مع 202. القرار لا يُلغي ADR-007 بل يُعدّله ويعلن كيف يعود التنفيذ إلى الجدول في Phase 08/16.
9. **هل يكسر backward compatibility؟** لا على مستوى العقد ولا الـHTTP: لا مسار ولا رمز خطأ ولا حالة استجابة تغيّرت (`accepted`/`duplicate` كما هما — ولم تُضَف `ignored` تحديداً لتجنّب تغيير عقد لا حاجة له). `GroupRegistryPort` **اختياري** في حزم الاعتماديات فبوت بلا مجموعات يعمل كما كان حرفياً. و`ReceiveUpdateResult` **اكتسب** حقولاً ولم يفقد شيئاً. التغيير السلوكي الوحيد مقصود ومُبرَّر: `/start` داخل مجموعة لم يعد يُهيّئ هوية.
10. **هل migration؟** لا هجرة بيانات ولا تعديل مخطّط. لكن **للنشر بند جديد**: الغرف تُعلَن في `SUPPORT_GROUP_CHAT_IDS` / `ESCALATION_GROUP_CHAT_IDS` / `COMMUNITY_GROUP_CHAT_IDS`، وغيابها ليس عطلاً بل **صمت** — البوت المُضاف إلى غرفة لن يردّ فيها حتى تُعلَن. مكتوب في جدول الإعداد وفي HANDOFF حتى لا يُقرأ الصمت كخلل.
11. **هل توجد مخاطر؟** (أ) **إعلان يدوي للغرف** — تغيير غرفة يعني تغيير إعداد ونشراً، ونسيانه يعني بوتاً صامتاً في غرفة عاملة؛ مقبول لأن عدد الغرف في هذه المرحلة صغير ومملوك للتشغيل، ومُخفَّف بفشل إقلاع صريح على أي إعلان متضارب. (ب) **الغرفة المجهولة صامتة تماماً** — لا رسالة تُنبّه من أضاف البوت أنّ الغرفة غير مُعلَنة؛ مقصود (الرد يُغري بإساءة الاستخدام)، والأثر مُخفَّف بأن التحديث يُسجَّل فيبقى قابلاً للتدقيق. (ج) **`groupsFor(role)` بلا مستهلك إنتاجي** — رمز مُنفَّذ ومُختبر ينتظر موجِّه التصعيد؛ أُبقي لأنه المِشبك الذي يجعل Phase 16 بلا تعديل منفذ، ومُعلَن في جدول المؤجّلات لا مخبوءاً. (د) **تغيير العضوية في محادثة خاصة يظلّ `unsupported`/422** — قيد قائم قبل هذه الدفعة ولم تُدخله، ومُقيَّد في HANDOFF. (هـ) **الأدوار خشنة** (دعم/تصعيد/مجتمع) ولا تعرف مدينةً ولا طلباً؛ مقصود لأن التفصيل يحتاج مالكاً في خدمة الدعم.
12. **هل security؟** نعم، وهي محور الدفعة: (أ) **قائمة سماح لا اكتشاف تلقائي** — البوت لا يتكلّم إلا في غرفة أعلنها المشغّل؛ إضافةُ غريبٍ للبوت إلى غرفة لا تُنتج نشراً لروابط تطبيقاتنا. (ب) **لا ربط هوية من محادثة مشتركة** — يحفظ [ADR-001](../15-decisions/ADR-001-identity-decoupled-from-telegram.md) والقاعدة 4 من ADR-007 (طبقة القنوات لا تُخزّن رسم `chatRef ↔ waslaPublicId`). (ج) **رفض سطح التشغيل من طبقتين** — النواة تحمي المسار المعروف، والمُهيّئ يحمي أي مُرسِل داخلي عبر `POST /channel/messages` لا يعرف السجل. (د) مراجع الغرف تُقرأ من البيئة ولا تُطبع في رسالة خطأ ولا تُخزَّن في المستودع (`scan-secrets` نظيف)، ورسائل فشل الإقلاع تسمّي المتغيّر ولا تطبع قيمته ([SECURITY_RULES](../00-rules/SECURITY_RULES.md)).
13. **هل performance؟** الكسب أوضح من الكلفة: `roleFor` بحث في خريطة داخل الذاكرة (السجل إعداد يُبنى مرة عند الإقلاع لا استعلام لكل تحديث)، ورفض سطح التشغيل يحدث **قبل** إدخال صفّ التسليم فيمنع خمس محاولات محكومة بالفشل مع كتاباتها، وأحداث العضوية صارت تُقبَل بدل 422 فتوقّفت إعادة الإرسال الدورية من Telegram لتحديثات لا تُشتكى منها. سجل واحد مُشترك بين الاتجاهين لا سجلّان، فلا تكرار في البناء ولا احتمال تباعد.
14. **هل monitoring؟** `BotRuntime.groups` يجعل ما يعرفه البوت من غرف قابلاً للفحص من خارج مسار الطلب، وفشل ردّ المجموعة يُسجَّل بكوده ولا يُحوّل الـwebhook إلى خطأ، وتحديثات المجموعات صارت صفوفاً في `channel_updates` (بعد MR 5) فيمكن قياس نشاط الغرف وكشف غرفة تُغرق البوت. تنبيه على «تحديثات من غرف غير مُعلَنة» يصبح ممكناً بهذه البيانات ولم يُبنَ بعد.

**Related:** [ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md)، [CHANNEL_GROUPS.md](../02-architecture/CHANNEL_GROUPS.md)، [CHANNEL_LAYER_CORE.md](../02-architecture/CHANNEL_LAYER_CORE.md)، [CHANNEL_TELEGRAM_ADAPTER.md](../02-architecture/CHANNEL_TELEGRAM_ADAPTER.md)، [CHANNEL_BOTS.md](../02-architecture/CHANNEL_BOTS.md)، [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)، [HANDOFF §7](HANDOFF_NEXT_STEPS.md)، [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md)

---

## 2026-08-21 · Phase 03 MR 5 — تخزين دائم لطبقة القنوات `@wasla/channel-postgres`

**Task:** سداد الدَّين المُعلن في MR 4: نقل المنافذ الثلاثة (`ProcessedUpdateStorePort` · `DeliveryStorePort` · `OutboxPort`) من الذاكرة إلى Postgres مقابل `channel_updates` / `channel_deliveries` / `channel_outbox`، بحيث يعبر منع التكرار وطابور إعادة المحاولة إعادة تشغيل العملية، مع اختبارات تكامل على قاعدة حقيقية ووظيفة CI مستقلّة. **Status:** Completed (393 اختبار وحدة + 25 اختبار تكامل تنجح محلياً؛ الجديد: 30) · **MR:** [!28](https://gitlab.com/uxxxu/wasla/-/merge_requests/28)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) حزمة جديدة `packages/channel-postgres` (`@wasla/channel-postgres`): `schema.ts` (مرآة Drizzle لـ`packages/channel-core/contracts/schema.sql` بكل قيود `CHECK` وفريدَي الـidempotency وفهارس الطابور/المحادثة/غير المنشور) · `db.ts` (`createChannelDb` → `{ pool, db }` على `pg.Pool` + `drizzle/node-postgres`) · `processed-update-store.ts` · `delivery-store.ts` · `outbox.ts` · `stores.ts` (`createChannelStores` — الحدّ الوحيد الذي يستهلكه جذر التركيب، يُرجع الثلاثة + `close()`) · `index.ts` · `drizzle.config.ts` + `vitest.config.ts` + `vitest.integration.config.ts` (بـ`fileParallelism: false`) · و`src/__tests__/` (harness يُطبّق العقد ويُفرغ الجداول + 9 اختبارات وحدة لحراسة الانحراف + 15 اختبار تكامل للمخازن + 6 اختبارات مطابقة منافذ). (ب) `packages/bot-runtime`: `config.ts` يقرأ `DATABASE_URL` ويرفض ما ليس `postgres://`/`postgresql://` عند الإقلاع؛ `runtime.ts` يختار المجموعة (`buildStoreSet`) ويُعلن `persistence` ويُصدر `close()` و`ChannelStoreSet` وخيار `stores` للحقن؛ `http/server.ts` يربط `runtime.close()` بخطّاف `onClose`؛ `index.ts` يُصدّر النوع الجديد؛ و8 اختبارات جديدة (5 للتهيئة + 3 لاختيار التخزين وتحرير المجموعة). (ج) `.gitlab-ci.yml`: وظيفة `channel-db-integration` تُوسّع `.db-integration-base` بخدمة `postgres:15` وقاعدة `wasla_channel_test`. (د) توثيق: `docs/02-architecture/CHANNEL_PERSISTENCE.md` (جديد — ثمانية أقسام) + `docs/12-testing/DB_INTEGRATION_CI.md` (صفّ الوظيفة الثالثة + التشغيل المحلي + حدّ التسلسل) + `HANDOFF_NEXT_STEPS.md` (§1 لقطة · §7 البند [4] دَينه مُغلق والبند [5] ✅ Done بتفصيله والبند [6] ← التالي) + `MASTER_PROGRESS.md` (صفّ Phase 03) + هذا الإدخال. (هـ) `pnpm-lock.yaml` للحزمة الجديدة. **لم يُلمس** سطر واحد في `channel-core` ولا في `telegram-adapter` ولا في `bots/*` ولا في العقود.
2. **لماذا؟** لأن الحالة السابقة كانت **صحيحة السلوك وكاذبة الضمان**: `remember` ذرّي في الذاكرة، فإذا أُعيد تشغيل البوت نُسِي كل ما عُولج وتكرّرت رسائل الترحيب، وتبخّر طابور التسليمات المستحقّة بما فيه. وثلاثة قرارات تستحق تبريراً: (أ) **حزمة مستقلّة لا مجلّد في النواة** — اختبار الحراسة `neutrality.guard.test.ts` يقفل اعتماديات النواة عند `@wasla/contracts-channel` و`@wasla/errors`، فإضافة `drizzle-orm`/`pg` إليها تُفشله عن حق: نواة تعرف قاعدة بيانات لم تبقَ قابلة للاستبدال في الاختبار. (ب) **المخازن الثلاثة تُختار معاً** — طابور دائم خلف مجموعة منع تكرار في الذاكرة يفقد الضمان نفسه بعد الإقلاع، فالخلط يشتري لا شيء ويُخفي الخسارة. (ج) **`DATABASE_URL` اختياري لا إلزامي** — المساهم بلا قاعدة محلية يجب أن يبقى قادراً على تشغيل بوت واختباراته، بشرط أن يكون النقص **مُعلَناً** في `runtime.persistence` لا مخبوءاً.
3. **أين؟** `packages/channel-postgres/` (كل الكود الجديد) + `packages/bot-runtime/src/{config.ts,runtime.ts,index.ts,http/server.ts,__tests__/{config,runtime}.test.ts}` + `.gitlab-ci.yml` + `docs/02-architecture/` + `docs/12-testing/` + `docs/16-progress/` + `pnpm-lock.yaml`.
4. **كيف تم اختباره؟** `pnpm -r run typecheck` نظيف على 14 مشروعاً، و`pnpm -r run test` = **393 اختباراً تنجح** (376 سابقاً + 9 حراسة انحراف + 8 في طبقة التشغيل)، و`DATABASE_URL=… pnpm --filter @wasla/channel-postgres test:integration` = **21 اختباراً تنجح** على Postgres 15 حقيقي. ما تُثبته: (أ) **منع التكرار** — نفس التحديث يُطالَب به مرّة واحدة، ونفس المعرّف لبوتين حدثان مستقلّان، و**المطالبة تنجو من إعادة الإقلاع** (مجموعة مخازن جديدة على نفس القاعدة ترى المُطالَب به)، ومطالبتان متزامنتان تُنتجان فائزاً واحداً. (ب) **التسليم** — `create` بنفس مفتاح الـidempotency يُعيد نفس الصفّ لا صفّاً ثانياً، `applyProgress` يزيد النسخة ويرفض صفّاً غير موجود بـ`CHANNEL_INTERNAL_ERROR`، والطابور يُرتّب بالأولوية ثم الزمن ويستثني غير المستحقّ ويحترم `limit`، والجسم والأزرار والبوت تعود كما دخلت و`traceId` يغيب حين يكون `NULL` لا يعود `null`. (ج) **صندوق الصادر** — الإلحاق يظهر في `unpublished()` وإعادة إلحاق نفس الحدث لا تُنتج صفّاً ثانياً. (د) **مطابقة المنافذ** — `receiveUpdate`/`sendMessage`/`retryDueDeliveries` تُشغَّل على مجموعة الذاكرة ومجموعة Postgres وتُقارَن المُشاهدات فتتطابق. (هـ) **حراسة الانحراف بلا قاعدة بيانات** — الاختبار يقرأ `schema.sql` فعلياً ويقارن أعمدة كل جدول بالمرآة ويؤكّد وجود الفريدين وأن الأسماء محيّدة (لا مفردة قناة) ولا مفتاح أجنبي إلى الهوية. (و) **طبقة التشغيل** — الافتراضي `memory`، ووجود `DATABASE_URL` يُنتج `postgres`، وصندوق الصادر نفسه يُشارَك بين المسارين، وإغلاق تطبيق Fastify يُحرّر المجموعة مرّة واحدة، ومخطّط غير Postgres يُفشل الإقلاع.
5. **ما الخطوة التالية؟** MR 6/7: مُهيّئ المجموعات (دعم/تصعيد) + تحديثات المجموعات. ثم MR 7: بوابة خروج المرحلة E2E. ويبقى عملان تشغيليان مُعلَنان: **مُشغّل دوري** يستدعي `retryDueDeliveries` (الطابور صار دائماً لكن لا شيء يستدعيه)، و**ناشر صندوق الصادر** حين يوجد مستهلك.
6. **هل مستند؟** نعم: `CHANNEL_PERSISTENCE.md` بثمانية أقسام تحمل مبرّر الحزمة الجديدة (ENGINEERING_DOCUMENTATION_LAW §7) وجدول المنافذ ↔ الجداول ↔ الضمان المُشترى، وستّة قرارات مُبرَّرة (الإدخال الذرّي بدل `SELECT`-ثم-`INSERT` · `processed_at = received_at` · `event_id` مفتاحاً للصادر · ترتيب الطابور داخل SQL قبل `LIMIT` · زيادة `version` داخل `UPDATE` · المخازن تُختار معاً)، وجدول الإعداد، وحالة التحقّق، وجدول المؤجّلات ومحلّ كل مؤجّل، وأثر أمني. ومعها تحديث `DB_INTEGRATION_CI.md` حتى يجد من يأتي بعدنا الوظيفة الثالثة وأمر تشغيلها محلياً في نفس المكان.
7. **هل مراجَع؟** الكود مُتحقَّق آلياً (typecheck + 393 وحدة + 21 تكامل) والتوثيق يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا. هذه **تنفيذ** لـ[ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) لا انحراف عنه: المنافذ كما هي، والاتجاه الأحادي محفوظ (`channel-postgres → channel-core` ولا شيء في النواة يعرفه)، والمكدّس نفسه المُقرّ في [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)/[ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md) (Postgres + Drizzle + `schema.sql` يدوي مصدراً كنسياً). ولا تعديل عقد: لا `schema.sql` ولا `events.json` ولا `api.openapi.yml` ولا كتالوج الأخطاء لُمس.
9. **هل يكسر backward compatibility؟** لا. `BotConfig.databaseUrl` اختياري وغيابه يُنتج سلوك MR 4 حرفياً؛ و`BotRuntime` اكتسب حقلين (`persistence` + `close`) ولم يفقد شيئاً؛ ولا مسار HTTP تغيّر.
10. **هل migration؟** لا هجرة بيانات (لا بيانات قائمة). لكن **للنشر شرط جديد**: يجب تطبيق `packages/channel-core/contracts/schema.sql` على القاعدة وتمرير `DATABASE_URL`؛ بغيره يعمل البوت **في الذاكرة** — وهذا يعني عملياً أن نسيان المتغيّر في الإنتاج ليس عطلاً ظاهراً بل ضماناً مفقوداً، ولذلك يُعلنه `runtime.persistence` صراحةً ويجب فحصه في قائمة النشر.
11. **هل توجد مخاطر؟** (أ) **الغياب الصامت لـ`DATABASE_URL`** — أخطر بند في الدفعة: الفشل ليس صاخباً (البوت يعمل) بل ضمانٌ يذوب؛ خُفِّف بإعلانه في `persistence` وبكتابته في الوثيقة وHANDOFF، ولم يُجعَل إلزامياً حتى لا يُكسر التشغيل المحلي والاختبارات. (ب) **`processed_at = received_at`** — قيمة صادقة بمعنى «وقت المطالبة» لا «وقت إتمام المعالجة»؛ إشارة إكمال حقيقية تستلزم توسيع المنفذ في العقد لا تخميناً في المُهيّئ. (ج) **`channel_updates` ينمو بلا سياسة تقليم** — لا قياس بعد لبناء سياسة احتفاظ؛ مُعلَن كمؤجّل. (د) **لا ناشر للصادر** — الأحداث تُخزَّن دائماً ولا تُنشَر بعد؛ مقصود لأن ناشراً بلا مستهلك رمز ميت. (هـ) **بركة اتصالات لكل بوت** — ثلاثة بوتات × سقف البركة على قاعدة واحدة؛ الحدّ افتراضي اليوم ويُضبط عند أول قياس حقيقي.
12. **هل security؟** سلسلة الاتصال سرّ: تُقرأ من البيئة فقط، ولا تُطبع في رسالة خطأ ولا سجلّ ولا استجابة — ورفض المخطّط الخاطئ يسمّي المتغيّر ولا يطبع قيمته ([SECURITY_RULES](../00-rules/SECURITY_RULES.md)). لا ربط بين محادثة القناة والهوية يُخزَّن، ولا مفتاح أجنبي إلى `identity_users` ([ADR-001](../15-decisions/ADR-001-identity-decoupled-from-telegram.md)) — فتسريب جداول القناة لا يكشف رسم هوية. وكل استعلام يمرّ ببارامترات Drizzle لا بتركيب نصّي، والقيم المخزّنة سبق أن طُهِّرت وحُدَّت عند حدّ المُهيّئ.
13. **هل performance؟** مسار الـwebhook يكسب إدخالاً واحداً بدل عمل في الذاكرة، وهو الثمن الحقيقي للضمان. `dueForRetry` يُرتّب ويقصر **داخل** SQL على الفهرس المعرَّف في العقد فلا تُجلب صفوف لتُرمى، و`remember` إدخال واحد لا قراءة ثم كتابة (نداء واحد بدل اثنين ونافذة تعارض معدومة)، و`applyProgress` يزيد النسخة داخل العبارة فلا دورة قراءة-تعديل-كتابة. البركة تُحرَّر عند إغلاق التطبيق فلا اتصالات معلّقة بين النشرات.
14. **هل monitoring؟** `runtime.persistence` يُخبر المشغّل بأيّ مجموعة يعمل، و`unpublished()` يجعل عمق صندوق الصادر قابلاً للقياس، وطابور الاستحقاق صار قابلاً للاستعلام من خارج العملية (`status = 'queued'` + `next_attempt_at`) — أي أن المراقبة الأعمق التي أُجّلت في MR 4 صارت ممكنة فعلاً. ربطها بلوحة أو تنبيه يحتاج مُشغّلاً دوريّاً وناشراً، وهما مؤجّلان مُعلَنان.

**Related:** MR [!28](https://gitlab.com/uxxxu/wasla/-/merge_requests/28) (`feat/channel-postgres-stores`)، [CHANNEL_PERSISTENCE.md](../02-architecture/CHANNEL_PERSISTENCE.md)، [CHANNEL_BOTS.md](../02-architecture/CHANNEL_BOTS.md)، [DB_INTEGRATION_CI](../12-testing/DB_INTEGRATION_CI.md)، [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)، [HANDOFF §7](HANDOFF_NEXT_STEPS.md)، [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md)

---

## 2026-08-21 · Phase 03 MR 4 — البوتات الثلاثة وطبقة تشغيلها `@wasla/bot-runtime`

**Task:** جعل الشطر الأول من بوابة خروج المرحلة 03 قابلاً للتشغيل: ثلاثة تطبيقات قابلة للنشر (customer · driver · partner) كل واحد يخدم عقد القناة على Fastify، يتحقّق من رمز الـwebhook قبل أي معالجة، ويُجيب `/start` بزر يفتح **Mini App الخاصة به** ويرفض البوتين الآخرين. **Status:** Completed (376 اختبار وحدة تنجح محلياً، منها 76 جديدة) · **MR:** [!27](https://gitlab.com/uxxxu/wasla/-/merge_requests/27)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) حزمة جديدة `packages/bot-runtime` (`@wasla/bot-runtime`): `config.ts` (البيئة → `BotConfig` بفحص صارم + `SingleBotRegistry`) · `system.ts` (`SystemClock` + `CryptoIdGenerator`) · `identity-bootstrap.ts` (`HttpIdentityBootstrap` على `POST /identity/resolve`) · `welcome.ts` (نص الترحيب + بناء ردّ `/start` بزر `mini_app` واحد ومفتاح تكرار `start:<bot>:<update>`) · `runtime.ts` (التركيب — المكان الوحيد الذي يسمّي مُهيّئاً ملموساً) · `http/app.ts` (المسارات الخمسة كما في `api.openapi.yml`) · `http/errors.ts` · `http/server.ts` (`buildBotApp`/`startBot`/`runBot`) · `index.ts` + 58 اختباراً في ستة ملفات. (ب) ثلاثة تطبيقات: `bots/{customer,driver,partner}-bot` بـ`package.json` + `tsconfig.json` + `src/server.ts` (`buildApp` بلا أثر جانبي) + `src/main.ts` (الملف الوحيد الذي يربط منفذاً) + `src/index.ts` + 6 اختبارات لكل بوت؛ وحُذفت ملفات `.gitkeep` الثلاثة. (ج) توثيق: `docs/02-architecture/CHANNEL_BOTS.md` (جديد — عشرة أقسام) + `CONTAINERS.md` (§2 حالة البوتات الفعلية بعد MR 4 · §5.1 صفّ `bot-runtime` واتجاه الاعتماد) + `HANDOFF_NEXT_STEPS.md` (§1 لقطة · §7 البند [4] ✅ Done والبند [5] ← التالي مع تحذيرَي التخزين والفجوة · §8 رابط) + `MASTER_PROGRESS.md` (صفّ Phase 03) + هذا الإدخال. (د) `pnpm-lock.yaml` للحزم الأربع الجديدة. **لم يُلمس** سطر واحد في `channel-core` ولا في `telegram-adapter` ولا في الخدمات ولا في `.gitlab-ci.yml`.
2. **لماذا؟** لأن بوابة الخروج تقول «**كل** Bot يفتح Mini App المناسبة»، وهذا لا يُثبَت بحزمة مكتبة بل بتطبيق قابل للنشر. وثلاثة قرارات تستحق التبرير: (أ) **ثلاثة تطبيقات لا واحد** — لكل بوت رمز Telegram ورمز webhook خاصان، فدمجها يجعل تسريب رمز واحد تسريباً للثلاثة ويجعل عطل بوت العميل يوقف السائقين والشركاء؛ الفصل فصل نطاق ضرر. (ب) **حزمة مشتركة لا ثلاث نسخ** — الـwebhook هو نقطة الدخول الوحيدة غير الموثوقة في وصلة، والتحقّق من رمزه *هو* مصادقته؛ ثلاث نسخ من هذا الفحص ثلاثة مواضع تتعفّن مستقلةً وإحداها ستنسى الفحص، كما أن قاعدة «بوت واحد ⇄ Mini App واحدة» تُفرَض حينها في مكان واحد (`SingleBotRegistry`) بدل أن تُراجع ثلاثاً. (ج) **الجذر لا يحمل منطقاً** — كل ما يميّز التطبيق هو اسم بوته، وأي سلوك يُكتب فيه يصبح فوراً سلوكاً بلا نظير في البوتين الآخرين.
3. **أين؟** `packages/bot-runtime/` + `bots/customer-bot/` + `bots/driver-bot/` + `bots/partner-bot/` + `docs/02-architecture/` + `docs/16-progress/` + `pnpm-lock.yaml`.
4. **كيف تم اختباره؟** `corepack pnpm -r run typecheck` نظيف على 12 مشروعاً، و`corepack pnpm -r run test` = **376 اختباراً تنجح** (300 سابقاً + 76 جديداً)، كلّها بـ`app.inject` بلا فتح منفذ: (أ) **الحدّ غير الموثوق** — رمز خاطئ · ترويسة مفقودة · **رمز غير مُهيّأ في النشر** ⇒ 401 `CHANNEL_UNAUTHORIZED_WEBHOOK` مع التحقّق **صفر معالجة** (لا تفسير ولا تخزين ولا إرسال). (ب) **بوابة الخروج** — `/start` للبوتات الثلاثة يُنتج زراً واحداً `mini_app` يطابق `BOT_MINI_APP[bot]`، وكل تطبيق يرفض البوتين الآخرين بـ404 `CHANNEL_UNKNOWN_BOT` على الـwebhook وعلى `mini-app` معاً. (ج) **سلوك Telegram** — تحديث مُعاد ⇒ `202 duplicate` بلا إرسال ثانٍ، وفشل ردّ الترحيب لا يُحوّل الـwebhook إلى خطأ. (د) **الصادر** — تخطيط `snake_case` → أمر محايد، تكرار المفتاح ⇒ `duplicate`، فشل قابل للإعادة ⇒ `queued`، فشل دائم ⇒ كود القناة نفسه (`failed` ليست حالة في العقد). (هـ) **التهيئة** — كل خطأ نشر يُلتقط عند الإقلاع (رمز ناقص · سرّ < 16 · `http` في عنوان Mini App · قالب بلا `{payload}` · منفذ غير رقمي). (و) **الأكسيوم** — نفس دالة التركيب تُبنى مرة بـ`TelegramChannelAdapter` ومرة بـ`MockChannelAdapter` + `FakeIdentityBootstrap` بلا تغيير سطر فوقها. الاختبارات تتحقّق من **الأكواد** لا من النصوص العربية.
5. **ما الخطوة التالية؟** MR 5/7: مُهيّئات Postgres لـ`channel_updates` / `channel_deliveries` / `channel_outbox` + اختبارات تكامل + وظيفة CI — تستبدل ثلاثة أسطر في `runtime.ts` ولا شيء غيرها، ومعها مُشغّل دوري لـ`retryDueDeliveries`.
6. **هل مستند؟** نعم: `CHANNEL_BOTS.md` بعشرة أقسام تحمل **جدول متغيّرات البيئة كاملاً** ومبرّر الحزمة الجديدة (ENGINEERING_DOCUMENTATION_LAW §7) وترتيب فحص الرمز ولماذا `202` حتى للتكرار وقائمة المؤجّلات ومحلّ كل مؤجّل، وأمر تشغيل بوت محلياً. من يأتي بعدنا لا يحتاج قراءة الكود ليعرف أيّ متغيّر ينقصه.
7. **هل مراجَع؟** الكود مُتحقَّق آلياً (typecheck + 376 اختباراً) والتوثيق يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا. هذه **تنفيذ** لـ[ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) لا انحراف عنه: `bots/*` بقيت جذور تركيب رقيقة، والحزمة الجديدة طبقة تشغيل داخل نفس الاتجاه الأحادي `bots/*` → `bot-runtime` → `telegram-adapter` → `channel-core`. مبرّر وجودها موثّق في وثيقتها كما تفرض قوانين المستودع.
9. **هل يكسر backward compatibility؟** لا. لا سطح قائم تغيّر: المسارات كلها جديدة ومطابقة لعقد القناة المدمج في MR 1، ولا تعديل على حزمة قائمة.
10. **هل migration؟** لا هجرة بيانات في هذه الدفعة (لا Postgres بعد). **لكن للنشر شرط**: بلا `<BOT>_BOT_TOKEN` و`<BOT>_BOT_WEBHOOK_SECRET` و`<BOT>_BOT_MINI_APP_URL` لا يُقلع البوت أصلاً — وهذا مقصود.
11. **هل توجد مخاطر؟** نعم، خطران معلومان ومكتوبان: (أ) **التخزين في الذاكرة** — إعادة تشغيل العملية تُنسي أيّ تحديث تمّت معالجته، فمنع التكرار لا يعبر الإقلاع وقد تتكرّر رسالة ترحيب بعد إعادة نشر؛ مقبول لتشغيل محلي وغير مقبول للإنتاج، ومحلّه MR 5. (ب) **فجوة عقد الهوية** — `/identity/resolve` مصوغ بشكل Telegram (`telegram_user_id` / `telegram_username`) بينما `InboundActor` في النواة محايد ولا يحمل `username` أصلاً؛ فلا نُرسل `username`، وقناة غير Telegram ستحتاج تعديل عقد خدمة قائمة. لم يُصلَح الآن لأن إصلاحه تغيير عقد خدمة أخرى، ومحلّه مرحلة القناة الثانية — مذكور في الوثيقة وفي HANDOFF حتى لا يُكتشَف متأخراً. (ج) مخاطرة مُغلقة: بلا خدمة هوية مُهيّأة يرفض البوت `/start` بـ503 قابلاً للإعادة و`/health` يقول `degraded` — **لا هوية مُختلَقة** لأن معرّفاً مُختلَقاً سيُخزَّن عبر حدث ولا يمكن مطابقته بعدها.
12. **هل security؟** نعم، وهي جوهر الدفعة: (أ) `assertWebhookSecret` **قبل قراءة الجسم وقبل معرفة أيّ بوت** — أي عمل قبل المصادقة عمل يُجبرنا الغريب عليه؛ ومقارنة ثابتة الزمن من المُهيّئ. (ب) **الفشل مغلق**: نسيان المتغيّر يعني 401 للجميع لا webhook مفتوحاً، ولا قيمة افتراضية لأي سرّ ولا وضع «تطوير» يتجاوز الفحص. (ج) رسائل أخطاء التهيئة **تسمّي المتغيّر ولا تطبع قيمته أبداً**، والرمز لا يظهر في أي مسار خطأ ([SECURITY_RULES](../00-rules/SECURITY_RULES.md)). (د) عنوان Mini App يجب أن يكون HTTPS، والزرّ يجب أن يطابق Mini App البوت (مفروض في طبقتين). (هـ) `POST /channel/messages` **داخلي** ويجب ألا يُنشَر خارج شبكة الكلستر — مكتوب في §3 من الوثيقة.
13. **هل performance؟** لا عمل ثقيل في مسار الـwebhook: تفسير + كتابة في الذاكرة + نداء هوية واحد لـ`/start` بمهلة 2000ms، وردّ الترحيب لا يُعيق الاستجابة لأن فشله لا يُنشر. المُحدِّد في المُهيّئ لا ينام (MR 3)، فلا طلب webhook محتجز.
14. **هل monitoring؟** `GET /health` يُميّز `ok` من `degraded` (خدمة الهوية غير موصولة)، وسجلّ Fastify مُفعَّل مع `request.id` كمعرّف تتبّع، وفشل ردّ الترحيب يُسجَّل بكوده. مراقبة أعمق (عمق صندوق الصادر والتسليمات المستحقّة) تصبح ذات معنى بعد MR 5.

**Related:** [MR !27](https://gitlab.com/uxxxu/wasla/-/merge_requests/27)، [CHANNEL_BOTS.md](../02-architecture/CHANNEL_BOTS.md)، [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)، [HANDOFF §7](HANDOFF_NEXT_STEPS.md)، [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md)

---

## 2026-08-21 · حوكمة — تشديد حماية `main` إلى «No one» للدفع المباشر

**Task:** إغلاق السؤال المعلّق في [HANDOFF §5](HANDOFF_NEXT_STEPS.md): مواءمة الإعداد الفعلي على GitLab مع قاعدة «لا Push مباشر» في [GIT_RULES §1](../00-rules/GIT_RULES.md). **Status:** Completed (مُطبَّق على المشروع + موثّق) · **MR:** [!26](https://gitlab.com/uxxxu/wasla/-/merge_requests/26)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) **إعداد على GitLab لا كود**: حماية الفرع `main` أُعيد إنشاؤها بـ`push_access_level = 0` («No one») مع الإبقاء على `merge_access_level = 40` (Maintainers) و`allow_force_push = false`. (ب) توثيق: `docs/00-rules/GIT_RULES.md` §1 — جدول الإعداد الفعلي الثلاثي مع مبرّر كل قيمة وطريقة المراجعة/العكس؛ `docs/16-progress/HANDOFF_NEXT_STEPS.md` §5 — التوصية صارت حالة مُطبَّقة، مع أثرها العملي على من يعمل بعدنا وكيفية عكسها؛ ولقطة §1 (تاريخ آخر تحديث)؛ وهذا الإدخال.
2. **لماذا؟** لأن القاعدة كانت **عُرفاً يعتمد على انتباه من يملك الصلاحية**: `Maintainers` تسمح بالدفع المباشر، وسطر واحد بالخطأ (`git push origin main`) يتجاوز CI والمراجعة و`doc-coverage` معاً — أي أن كل قوانين المستودع كانت قابلة للتجاوز بأمر واحد. مع «No one» يصير التجاوز **مستحيلاً تقنياً** لا مذموماً أخلاقياً، وهو نفس منطق المستودع في مواضع أخرى (اختبار الحراسة المعماري في `channel-core` يفشل البناء بدل أن «يُنصح» بعدم تسريب مفردات القناة).
3. **أين؟** إعدادات المشروع على GitLab (`/projects/85566384/protected_branches`) + `docs/00-rules/GIT_RULES.md` + `docs/16-progress/HANDOFF_NEXT_STEPS.md` + هذا الإدخال. **لا سطر كود.**
4. **كيف تم اختباره؟** (أ) `GET /protected_branches` بعد التغيير يُظهر `push_access_levels = [No one]` ومستوىً واحداً فقط، و`merge_access_levels = [Maintainers]`، و`allow_force_push = false`. (ب) الدليل العملي أن الدمج لم يتأثّر: هذه الدفعة نفسها مرّت بالمسار الكامل (فرع → MR → أنبوب أخضر → دمج) بعد التشديد. (ج) **درس تقني مهم**: `PATCH /protected_branches/main` بـ`allowed_to_push` **أضاف** مستوى «No one» **بجانب** «Maintainers» بدل أن يستبدله — أي أن الدفع بقي مسموحاً فعلياً؛ فالطريق الصحيح `DELETE` ثم `POST` بـ`push_access_level=0`، وقد وُثّق ذلك في المكانين حتى لا يظنّ من يأتي بعدنا أنه شدّد الحماية وهو لم يفعل.
5. **ما الخطوة التالية؟** لا أثر على خطة المرحلة: التالي كما هو MR 4/7 `feat(bots)` — ثلاثة جذور تركيب Fastify + `POST /channel/{bot}/webhook` بالتحقّق من الرمز + سجلّ بوتات مقود بالبيئة + مُهيّئ HTTP لتهيئة الهوية ([HANDOFF §7](HANDOFF_NEXT_STEPS.md)).
6. **هل مستند؟** نعم — وهذا جوهر الدفعة: إعداد غير موثّق يُعادل إعداداً غير موجود، لأن من يجد 403 بلا تفسير قد يُعطّل الحماية ظنّاً أنها خلل. لذلك يحمل التوثيق **القيم الثلاث ومبرّراتها وأمر المراجعة وطريقة العكس المشروط**.
7. **هل مراجَع؟** الإعداد مُتحقَّق منه بالقراءة من الـAPI بعد الكتابة، والتوثيق يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا. هذا **تنفيذ** لقاعدة قائمة في GIT_RULES §1 لا قرار جديد يخالفها. (العكس هو الذي يستلزم قراراً موثّقاً: GIT_RULES §1 ينص أن تعطيل الحماية لا يجوز إلا بـADR ومبرّر تشغيلي.)
9. **هل يكسر backward compatibility؟** لا على مستوى الكود. أما على مستوى سير العمل فيكسر **عادة** واحدة: الدفع المباشر إلى `main` صار يعود 403 للجميع بما فيهم المالك — وهذا هو المقصود، ومُعلَن في HANDOFF §5 وGIT_RULES §1.
10. **هل migration؟** لا.
11. **هل توجد مخاطر؟** الخطر الوحيد تشغيلي: إصلاح عاجل لا يمكن أن ينتظر أنبوباً يصبح متعذّراً بالدفع المباشر. المقايضة مقبولة لأن الأنبوب دقائق، ولأن البديل (باب خلفي دائم) يُفقد كل ضمانات المستودع قيمتها. مسار العكس المشروط موثّق في المكانين، ويُلزم بإعادة التشديد فوراً وبتسجيل الحادثة هنا. ملاحظة ثانية: من يعمل بأدوات آلية يجب أن يُنشئ فرعاً دائماً — وهو ما نفعله أصلاً في كل دفعات المرحلة 03.
12. **هل security؟** نعم، وهي دفعة أمن حوكمة بالكامل: إغلاق مسار يتجاوز المراجعة وCI (بما فيه `repo-structure` الذي يفحص الأسرار، و`doc-coverage`)؛ وبقاء `allow_force_push = false` يمنع إعادة كتابة تاريخ `main`. يبقى بند [HANDOFF §5](HANDOFF_NEXT_STEPS.md) الآخر قائماً بلا تغيير: **رمز الوصول الذي ظهر في محادثة يجب إبطاله/تدويره**.
13. **هل performance؟** لا أثر.
14. **هل monitoring؟** الرفض يظهر كـ403 من GitLab، وسجلّ الأحداث في المشروع يُظهر تغيير الحماية بفاعله ووقته. لا مراقبة إضافية مطلوبة.

**Related:** [MR !26](https://gitlab.com/uxxxu/wasla/-/merge_requests/26)، [GIT_RULES §1](../00-rules/GIT_RULES.md)، [HANDOFF §5](HANDOFF_NEXT_STEPS.md)، [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md)

---

## 2026-08-20 · Phase 03 MR 3 — مُهيّئ قناة Telegram `@wasla/telegram-adapter`

**Task:** تنفيذ المكان **الوحيد** في المستودع الذي يعرف Telegram Bot API وفق [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md): تفسير التحديثات + الإرسال + أزرار `web_app` + تخطيط أخطاء Bot API إلى أكواد `CHANNEL_*` مع احترام `retry_after` + ميزانية معدّل + التحقّق من رمز الـwebhook — يُنفّذ منفذين فقط ولا يعرف حالة استخدام واحدة. **Status:** Completed (300 اختبار وحدة تنجح محلياً، منها 86 جديدة) · **MR:** [!25](https://gitlab.com/uxxxu/wasla/-/merge_requests/25)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) حزمة جديدة `packages/telegram-adapter` (`@wasla/telegram-adapter`): `package.json` + `tsconfig.json`. (ب) `src/api-shapes.ts` — الوصف الجزئي الوحيد لسلك Bot API + قرّاء آمنون (`readIdentifier` يحوّل كل معرّف إلى **سلسلة**، `readEnvelope` يقرأ `ok`/`result`/`description`/`error_code`/`parameters.retry_after`). (ج) `src/sanitize.ts` — `cleanLine`/`cleanText`/`cleanLanguageCode`: حذف محارف التحكّم ومحارف عكس الاتجاه (U+202A–U+202E · U+2066–U+2069) مع إبقاء الأسطر في نص الرسالة. (د) `src/update-parser.ts` — `TelegramUpdateParser` يُنفّذ `UpdateParserPort`: أمر (بحذف `@botname` وتصغير الحرف واستخراج الوسيط) · نص · استجابة زر · جهة اتصال · موقع (إحداثيات مُتحقَّقة → `"lat,lon"`) · حدث مجموعة · `message|edited_message|channel_post|edited_channel_post`. (هـ) `src/keyboard.ts` — نيّة الزر → `inline_keyboard` بزرّ واحد لكل صف: `mini_app` → `web_app` (HTTPS إلزامي · المسار يُحلّل على أساس عنوان البوت · تغيير النطاق مرفوض · يجب أن يطابق Mini App البوت) و`deep_link` → `url` من قالب البوت بترميز `encodeDeepLinkPayload`. (و) `src/error-mapping.ts` — `mapTelegramFailure` → `{errorCode, retryAfterSeconds?}`. (ز) `src/rate-limit.ts` — `TokenBucketRateLimiter` (25/ث للبوت · 1/ث للمحادثة · سقف 5000 محادثة بـLRU) على منفذ الساعة، بـ`take` **لا ينام** و`penalise` يجعل تهدئة Telegram هي المرجع. (ح) `src/bot-api-client.ts` — عميل رقيق بـ`fetch` محقون ومهلة `AbortController`، لا يرمي أبداً ولا يُظهر الرمز في أي مسار. (ط) `src/channel-adapter.ts` — `TelegramChannelAdapter` يُنفّذ `ChannelPort`، نموذج واحد لكل بوت. (ي) `src/webhook-auth.ts` — `assertWebhookSecret` بمقارنة ثابتة الزمن وحدّ أدنى 16 محرفاً وقراءة ترويسة غير حسّاسة لحالة الأحرف. (ك) `src/index.ts` + `src/__tests__/` (86 اختباراً في سبعة ملفات منها **8 اختبارات مطابقة منافذ**). (ل) توثيق: `docs/02-architecture/CHANNEL_TELEGRAM_ADAPTER.md` (جديد) + `CONTAINERS.md` §5.1 + `HANDOFF_NEXT_STEPS.md` (§1 + §7: MR [3] ✅ Done و MR [4] = التالي بتفصيله + §8) + `MASTER_PROGRESS.md` (صف Phase 03) + هذا الإدخال. (م) `pnpm-lock.yaml` للحزمة الجديدة. **لم يُلمس** أي سطر في `channel-core` ولا في الخدمات القائمة ولا في `.gitlab-ci.yml`.
2. **لماذا؟** لأن «إمكانية استبدال المُهيّئ بـMock» تفرض أن تكون معرفة Telegram كلها في حزمة واحدة قابلة للحذف، لا موزّعة في البوتات والخدمات؛ فهذه الحزمة هي حدّ الترجمة: تُحوّل السلك إلى مفردات محايدة وتُحوّل الفشل إلى كود، ثم تتوقّف. وثلاثة قرارات تستحق التبرير: (أ) **الفوضى الشكلية تُرمى وغير المدعوم يُعاد كـ`unsupported`** — لأن رفض غير المدعوم كود `CHANNEL_UNSUPPORTED_UPDATE` وهو قرار النواة؛ لو رماه المفسّر لانقسمت السياسة على مكانين ولما استطاعت النواة تغيير قائمة المدعوم دون لمس المُهيّئ. (ب) **`send` لا يرمي أبداً** — سياسة إعادة المحاولة ملك النواة، واستثناء يعبر الحدود يجعل حالة التسليم غير محدّدة (أُرسِلت؟ لا؟) بينما نتيجة تحمل كوداً تُترجم فوراً إلى `sent`/`queued`/`failed` مع حدث. (ج) **المُحدِّد لا ينام** — النوم داخل `send` يحتجز طلب webhook مفتوحاً ويُخفي عمق الطابور، أما إرجاع `CHANNEL_RATE_LIMITED` فيُظهر الرسالة المُهدَّأة كـ`queued` بزمن استحقاق يقرأه المراقب.
3. **أين؟** `packages/telegram-adapter/` (كل الكود الجديد) + `docs/02-architecture/` + `docs/16-progress/` + `pnpm-lock.yaml`.
4. **كيف تم اختباره؟** محلياً كما في CI: `pnpm -r run typecheck` ✅ (ثماني حزم/خدمات) و`pnpm -r run test` ✅ **300 اختباراً** (214 سابقة + 86 جديدة: مفسّر 23 · مُهيّئ بـfetch مزيف 17 · أزرار 12 · تخطيط أخطاء 10 · معدّل 8 · رمز webhook 8 · **مطابقة منافذ 8**). الاختبارات تُثبت سلوكاً لا شكلاً: معرّف مجموعة فائقة يتجاوز المدى الآمن للأعداد يعود **سلسلة** بلا فقدان دقّة؛ `/start@wasla_bot payload` يعود أمراً `start` بوسيط؛ إحداثيات مستحيلة تعود `unsupported` لا موقعاً؛ محارف عكس الاتجاه تُحذف من الاسم المعروض؛ 403 يعود غير قابل للإعادة و429 قابلاً للإعادة **بتهدئة Telegram نفسها**؛ الرمز لا يظهر في الجسم ولا في `describe()`؛ رمز webhook أقصر من 16 محرفاً يُرفض ولا «يُعطّل التحقّق»؛ ومُهيّئ فشل بناء الزر لا يُصدر نداءً شبكياً واحداً. الاختبارات تؤكّد **أكواد** الأخطاء لا نصوصها العربية، وقابلية الإعادة تُقرأ من كتالوج العقود لا تُكرَّر حرفياً. واختبار الحراسة المعماري في `channel-core` بقي أخضر — أي لم تتسرّب مفردة Telegram إلى النواة.
5. **ما الخطوة التالية؟** MR 4/7: `feat(bots)` — ثلاثة جذور تركيب Fastify (customer/driver/partner) تفتح `POST /channel/{bot}/webhook` بالتحقّق من الرمز **قبل أي معالجة** ثم `receiveUpdate` وردّ 202 دائماً، مع سجلّ بوتات مقود بالبيئة (رمز + `BotPresence`) ومُهيّئ HTTP لمنفذ تهيئة الهوية على نمط `HttpIdentityLookupPort` في geography. التفصيل في [HANDOFF §7](HANDOFF_NEXT_STEPS.md).
6. **هل مستند؟** نعم — `docs/02-architecture/CHANNEL_TELEGRAM_ADAPTER.md` (لماذا توجد الحزمة · البنية ملفاً ملفاً · شجرة قرار التفسير · جدول القرارات السلوكية بمبرّراتها · سياسة التطهير · تدفّق الإرسال · جدول تخطيط الأخطاء بعمود قابلية الإعادة · ميزانية المعدّل · أمن الحدود · حالة التحقّق · جدول المؤجّلات وأين يُنجَز كل مؤجّل · مثال الاستبدال بـMock) + `CONTAINERS §5.1` + `HANDOFF §1/§7/§8` + `MASTER_PROGRESS` + هذا الإدخال. كل ملف مصدري يبدأ بتعليق يشرح **لماذا** يوجد.
7. **هل مراجَع؟** مُراجَع ذاتياً مقابل قواعد ADR-007 السبع الملزمة في HANDOFF §7: النيّة تُبنى زرّاً في المُهيّئ لا في النواة ✅ · أخطاء Telegram تُترجم عند حدّ المُهيّئ مع `retryable` ✅ · روابط عميقة بلا حالة ≤64 (الترميز من النواة) ✅ · لا تخزين لربط `chat_ref` ↔ هوية ✅ (لا مخزن هنا أصلاً) · المجموعات نوع محادثة لا مسار مواز ✅ · كل منفذ له بديل Mock ✅. القاعدتان المتبقيتان (مدخل واحد بالتحقّق من الرمز · مخرج واحد) تحتاجان طبقة HTTP: أداة التحقّق جاهزة هنا و**استخدامها** في MR 4، ومُعلَن في §9. يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا — ADR-007 يحكم البنية والمنافذ والمكدّس وهذه المراجعة تنفيذه الحرفي. ولا تعديل عقد في هذه الدفعة: لا `schema.sql` ولا `events.json` ولا `api.openapi.yml` ولا كتالوج الأخطاء لُمس، والأكواد كلها مستهلَكة من `@wasla/contracts-channel` كما هي.
9. **هل يكسر backward compatibility؟** لا. حزمة جديدة لا مستهلك لها بعد (البوتات في MR 4)، ولا تغيير في سطح `channel-core` ولا في العقود.
10. **هل migration؟** لا — لا لمس لقاعدة بيانات ولا لعقد بياناتها؛ مُهيّئات Postgres في MR 5.
11. **هل توجد مخاطر؟** (أ) **أشكال Bot API موصوفة جزئياً**: حقل يغيّره Telegram قد يُقرأ كـ`unsupported` بدل أن يُفسَّر — مقصود، فالبديل (أنواع كاملة) عبء صيانة بلا مستهلك، والقرّاء الآمنون يمنعون الانهيار. (ب) **ميزانية المعدّل داخل العملية فقط**: مع عدة نسخ من البوت يبقى الحدّ الحقيقي محفوظاً بتهدئة Telegram وحدها حتى يُنفَّذ `channel_rate_budgets` المؤجّل — طبقة أمان لا ضمان، مُعلَن في §6 و§9. (ج) **مطابقة الوصف نصّية**: Telegram يخلط حالات كثيرة تحت 400/403 فتُطابَق أوصافه بجدولين؛ الوصف المجهول يتدهور إلى رمز الحالة بدل أن يُسقط الإرسال. (د) `answerCallbackQuery` غير مُنفَّذ ⇒ دوّارة زر الاستجابة تبقى ظاهرة حتى MR 4/6 (لا تأثير على التسليم).
12. **هل security؟** نعم، وهو نصف قيمة هذه الحزمة: **رمز الـwebhook** يُقارَن بزمن ثابت برسالة واحدة بلا تفاصيل (فلا يصلح أوراكل)، ورمز غير مُهيَّأ أو أقصر من 16 محرفاً = **رفض** لا تعطيل للتحقّق. **رمز البوت** من البيئة فقط، لا حرف منه في المصدر، ويوجد داخل مسار الطلب وحده؛ `describe()` بلا رمز والاستثناءات تُبتلع لأن سببها قد يحمل المسار والمسار يحمل الرمز. **المدخلات غير الموثوقة** تُطهَّر وتُحدَّ عند الحدّ الخارجي (محارف تحكّم واتجاه · حدود `LIMITS` · `language_code` يُرفض ولا يُصلَح لأن locale خاطئاً يغيّر لغة الردّ بصمت). **العناوين** من الإعداد لا من المصدر، وزر `web_app` يشترط HTTPS ويرفض مساراً يغيّر النطاق. **نصوص أخطاء Telegram** تُطابَق ثم تُهمَل فلا تظهر في سجلّ ولا حدث ولا استجابة.
13. **هل performance؟** ميزانية المعدّل تمنع 429 قبل وقوعها (النداء المرفوض يُحسب على البوت والاندفاع يُطيل التهدئة)، والتهدئة تُحسب بحيث يتاح أول رمز **عند** انتهائها بالضبط فلا ينزلق تسليم جدولته النواة خطوة تباطؤ كاملة بسبب مُحدِّدنا. خريطة المحادثات مقيّدة بسقف LRU لأن خريطة بلا سقف تعني تخصيصاً تحكمه رسائل الغرباء. للنداءات مهلة صريحة (10 ثوانٍ) عبر `AbortController` — بدونها يعلق طلب webhook على اتصال ميت.
14. **هل monitoring؟** لا يُصدر المُهيّئ أحداثاً (ملك النواة) لكنه يُغني إشاراتها: كل فشل يعود بكود `CHANNEL_*` وعلم قابلية إعادة، فيُميّز `channel.message.failed` بين «محادثة غير قابلة للوصول» و«خلل نشر» و«تجاوز معدّل»؛ والتجاوز يعود بـ`retryAfterSeconds` فيظهر سبب التأخير في `nextAttemptAt`. المراقبة عبر HTTP (رموز 202/401 وزمن الاستجابة) تأتي مع MR 4.

**Related:** [MR !25](https://gitlab.com/uxxxu/wasla/-/merge_requests/25)، [وثيقة المُهيّئ](../02-architecture/CHANNEL_TELEGRAM_ADAPTER.md)، [وثيقة النواة](../02-architecture/CHANNEL_LAYER_CORE.md)، [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)، [كتالوج أخطاء القناة](../../packages/channel-core/contracts/errors.md)، [SECURITY_RULES](../00-rules/SECURITY_RULES.md)، [CONTAINERS §5.1](../02-architecture/CONTAINERS.md)

---

## 2026-08-20 · Phase 03 MR 2 — نواة `@wasla/channel-core` المحايدة

**Task:** تنفيذ نواة طبقة القنوات وفق [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md): نموذج مجال محايد + المنافذ التسعة + حالات الاستخدام (استقبال ومنع تكرار · تسليم وإعادة محاولة · فتح Mini App · روابط عميقة) + مُهيّئات in-memory وMock — بلا أي معرفة بقناة، مع اختبار حراسة معماري يُفشل البناء عند أي تسريب. **Status:** Completed (214 اختبار وحدة تنجح محلياً، منها 84 جديدة) · **MR:** [!24](https://gitlab.com/uxxxu/wasla/-/merge_requests/24)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) حزمة جديدة `packages/channel-core` (`@wasla/channel-core`): `package.json` + `tsconfig.json`؛ `src/domain/` = `model.ts` (مفردات محيّدة: `ChatRef`/`ChannelUserRef` كسلاسل opaque · `InboundUpdate` · `ButtonIntent` كنيّة لا زر · `DeliveryRecord` مطابق للـDDL · `BotPresence` · `LIMITS`)، `errors.ts` (`ChannelError` يشتق الصنف والحالة و`retryable` من كتالوج العقود — لا كتالوج ثانٍ)، `events.ts` (بناة الأحداث الأربعة بمغلّف واحد)، `deep-link.ts` (ترميز/فك base64url بحد 64 حرفاً)، `retry.ts` (تباطؤ أسّي + jitter + احترام تهدئة القناة + الجدول المنشور). (ب) `src/ports.ts` — المنافذ التسعة: `ChannelPort` · `UpdateParserPort` · `ProcessedUpdateStorePort` · `DeliveryStorePort` · `OutboxPort` · `IdentityBootstrapPort` · `MiniAppRegistryPort` · `ClockPort` · `IdGeneratorPort`. (ج) `src/use-cases/` — `deps.ts` + `receiveUpdate` + `sendMessage` (+`attemptDelivery` المشترك) + `retryDueDeliveries` + `getMiniAppLaunch`/`createDeepLink`. (د) `src/infrastructure/in-memory.ts` — تسعة مُهيّئات اختبار منها **`MockChannelAdapter`** و`FakeUpdateParser` و`FixedClock` و`SequentialIdGenerator`. (هـ) `src/__tests__/` — 84 اختباراً في ستة ملفات منها **38 اختبار حراسة معماري**. (و) تعديل عقد البيانات: عمودا `channel_deliveries.body` (JSONB) و`.bot` في `packages/channel-core/contracts/schema.sql`. (ز) توثيق: `docs/02-architecture/CHANNEL_LAYER_CORE.md` (جديد) + `CONTAINERS.md` §5.1 (حالة الحزم) + `HANDOFF_NEXT_STEPS.md` (لقطة §1 + §7: MR [2] ✅ Done و MR [3] = التالي بتفصيله) + `MASTER_PROGRESS.md` (صف Phase 03) + هذا الإدخال. (ح) `pnpm-lock.yaml` للحزمة الجديدة.
2. **لماذا؟** بوابة خروج المرحلة نصفها الأول «إمكانية استبدال مُهيّئ القناة بـMock» لا يمكن إثباته إلا إذا كان **كل** منطق القناة في حزمة لا تعرف قناة وتتصل بالعالم عبر منافذ فقط؛ لذلك سبقت النواة المُهيّئ (MR 3) والبوتات (MR 4). وفصل الساعة ومولّد المعرّفات كمنفذين ليس تجميلاً: بدونهما تصير اختبارات التباطؤ الأسّي وأزمنة `nextAttemptAt` رهينة التوقيت، فيتحوّل الفشل من «سلوك خاطئ» إلى «اختبار متقلّب». وترتيب خطوات الاستقبال (رفض غير المدعوم **قبل** تسجيل منع التكرار، وتهيئة الهوية **بعده**) اختيار سلوكي مقصود: الأول يحفظ إمكانية إعادة المحاولة بنفس المعرّف بعد الإصلاح، والثاني يمنع قصف خدمة الهوية بإعادة إرسال القناة لنفس التحديث.
3. **أين؟** `packages/channel-core/` (كل الكود الجديد) + `packages/channel-core/contracts/schema.sql` (تعديل) + `docs/02-architecture/` + `docs/16-progress/` + `pnpm-lock.yaml`. لم تُلمس أي خدمة قائمة (identity/geography) ولا `.gitlab-ci.yml`.
4. **كيف تم اختباره؟** محلياً كما في CI: `pnpm -r run typecheck` ✅ (سبع حزم/خدمات) و`pnpm -r run test` ✅ **214 اختباراً** (130 سابقة + 84 جديدة: استقبال 10 · إرسال 14 · إعادة محاولة 9 · روابط عميقة 8 · سطوح تشغيل 5 · حراسة 38). الاختبارات تُثبت سلوكاً لا شكلاً: التحديث المكرر يُرجع `duplicate` **بلا حدث وبلا نداء ثانٍ للهوية**؛ منع التكرار مُقيَّد بالبوت فبوتان يريان نفس المعرّف بشكل مشروع؛ الأمر غير المدعوم يُرفض ولا يُسجَّل (فتبقى إعادة المحاولة ممكنة)؛ فشل الهوية يُترجم إلى `CHANNEL_IDENTITY_BOOTSTRAP_FAILED` قابل للإعادة؛ مفتاح منع التكرار المتكرر لا يُرسل ثانية (`sent.length === 1`)؛ الفشل القابل للإعادة يُعيد **نفس** التسليم إلى الطابور بـ`nextAttemptAt` محسوب ودون حدث؛ تهدئة القناة الأطول تفوز على الحساب؛ الفشل النهائي يُصدر `channel.message.failed` **مرة واحدة** بعد استنزاف السقف؛ زر Mini App يُصدر `channel.mini_app.launched`؛ وسبع حالات تحقّق تُرفض **قبل** لمس المُهيّئ (`sent.length === 0`). اختبار الحراسة يقرأ كل ملف `.ts` بعد إزالة التعليقات ويفشل عند أي مفردة قناة أو استيراد ممنوع، ويقفل اعتماديات وقت التشغيل على العقود والأخطاء فقط. أكّدت الاختبارات على **أكواد** الأخطاء لا على نصوصها العربية القابلة للتغيير.
5. **ما الخطوة التالية؟** MR 3/7: `feat(telegram-adapter)` — حزمة تُنفّذ `ChannelPort` + `UpdateParserPort` فقط: تفسير حِمل التحديث، الإرسال، أزرار `web_app`، تخطيط أخطاء Bot API إلى أكواد `CHANNEL_*` مع `retryable` واحترام `retry_after`، وحدود المعدّل. لا تعرف أي حالة استخدام، ولا تستوردها النواة أبداً (اختبار الحراسة يفشل إن حدث). الخطة الكاملة في [HANDOFF §7](HANDOFF_NEXT_STEPS.md).
6. **هل مستند؟** نعم — `docs/02-architecture/CHANNEL_LAYER_CORE.md` (البنية الداخلية · جدول المنافذ التسعة بمُهيّئ الاختبار ومُهيّئ الإنتاج لكل منفذ · تدفّق كل حالة استخدام بترتيب خطواتها ومبرّره · سياسة إعادة المحاولة والجدول المنشور · تخطيط الأخطاء · اختبار الحراسة · حالة التحقّق · جدول المؤجّلات وأين يُنجَز كل مؤجّل) + `CONTAINERS.md` §5.1 + `HANDOFF §1/§7` + `MASTER_PROGRESS` + هذا الإدخال. كل ملف مصدري يبدأ بتعليق يشرح **لماذا** يوجد لا ماذا يفعل.
7. **هل مراجَع؟** مُراجَع ذاتياً مقابل نمط `services/geography` (نفس ترتيب `domain/ports/use-cases/infrastructure` وأسلوب المُهيّئات في الذاكرة) ومقابل قواعد ADR-007 التسع بنداً بنداً: مخرج وحيد ✅ · منع تكرار في الاتجاهين ✅ · لا تخزين ربط `chat_ref` ↔ هوية ولا FK ✅ · نيّة Mini App لا زر قناة ✅ · روابط عميقة عديمة الحالة ≤64 ✅ · تخطيط الأخطاء عند حدود المُهيّئ ✅ · المجموعات نوع محادثة لا مسار مواز ✅ (حقل `isGroup` في نفس التدفّق). ما لا يشمله هذا الـMR من القواعد (التحقّق من secret token عند المدخل) يخصّ طبقة HTTP في MR 4 ومُعلَن في §9 من الوثيقة. يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا ADR جديد — ADR-007 يحكم البنية والمنافذ والمكدّس، وهذه المراجعة تنفيذه الحرفي. لكن **تعديل عقد بيانات** حدث ويُعلَن هنا صراحةً: أُضيف عمودا `channel_deliveries.body` و`.bot`. السبب أن النواة أثبتت أن إعادة المحاولة تُرسل *نفس* الرسالة، فجسمها يجب أن يُخزَّن مع التسليم — لا يمكن إعادة بنائه من المُنادي لاحقاً (قد لا يكون موجوداً)، والبديل (تسليم بلا جسم) يجعل إعادة المحاولة وهماً. التعديل إضافة على عقد **لم يُطبَّق على أي قاعدة بعد** (تنفيذ الجداول في MR 5)، فلا هجرة ولا كسر.
9. **هل يكسر backward compatibility؟** لا. حزمة جديدة لا مستهلك لها بعد (المُهيّئ والبوتات في MR 3/4)، وتعديل الـDDL على عقد غير مُطبَّق. الأحداث والأكواد كلها من `@wasla/contracts-channel` بلا إضافة أو تعديل.
10. **هل migration؟** لا. `schema.sql` عقد منشور لا يُنفَّذ بعد؛ إنشاء الجداول ومُهيّئات Drizzle/Postgres في MR 5، ومُعلَن في ADR-007 §5 وفي §9 من وثيقة النواة.
11. **هل توجد مخاطر؟** (أ) كل المُهيّئات حالياً في الذاكرة ⇒ منع التكرار وطابور إعادة المحاولة يُفقدان بإعادة التشغيل — قيد معروف موثّق في ADR-007 ويُرفع في MR 5؛ ولا نشر قبل ذلك. (ب) `retryDueDeliveries` لا يجدول نفسه ⇒ بلا مجدول (MR 5) لا تُعاد أي محاولة فعلياً؛ مقصود (لا مؤقّتات في النواة) ومُعلَن في الوثيقة. (ج) تسليم مستحقّ فقد جسمه المخزَّن: يُفشل صراحةً بـ`CHANNEL_INTERNAL_ERROR` بدل اختراع رسالة بديلة، وله اختبار. (د) اختبار الحراسة يعتمد على قائمة مفردات ⇒ قد تظهر مفردة قناة جديدة غير مُدرَجة؛ خُفِّف بإدراج أسماء دوال Bot API الشائعة ومكتبات البوتات وبقفل الاعتماديات، ويجب تمديد القائمة عند دخول أي قناة جديدة. (هـ) لا `jitter` في الاختبارات (`NO_JITTER`) ⇒ الجدول المنشور مُثبَت بلا عشوائية، أما سلوك الإنتاج فيضيف 20% ومُعلَن في العقد.
12. **هل security؟** نعم بالتصميم وإن لم تُضف أسرار: `chatRef` و`channelUserRef` سلاسل opaque بلا معنى مُستخرَج، ولا تخزين لربط `chat_ref` ↔ `wasla_public_id` في هذه الطبقة (ملك Identity — ADR-001)، والهوية تُنال عبر منفذ لا استعلام مباشر، وكل حقل داخل يُتحقّق قبل استخدامه (نوع/أمر/حدود طول/عدد أزرار/طول حمولة رابط)، وحمولات الروابط العميقة عديمة الحالة ومحدودة بـ64 حرفاً ويُرفض فيها أي فعل غير مُسجَّل (منع تمرير أفعال مُزوّرة)، والنواة لا تُسجّل ولا تُعيد نص خطأ من القناة. لا رموز ولا مفاتيح في الكود.
13. **هل performance؟** إعادة المحاولة تباطؤ أسّي مع jitter وسقف خمس محاولات واحترام تهدئة القناة — لتجنّب عاصفة إعادة محاولة؛ ودفعة الاستنزاف محدودة افتراضياً بـ25 تسليماً (ضغط عكسي) وتُرتَّب بالأولوية ثم وقت الاستحقاق مطابقةً للفهرس الجزئي في الـDDL؛ ومسار الاستقبال يرفض قبل أي كتابة، ومنع التكرار عملية واحدة ذرّية لا «اقرأ ثم اكتب». لا قياس تشغيلي بعد (لا خدمة تعمل).
14. **هل monitoring؟** الأحداث الأربعة هي إشارات المراقبة: `channel.message.failed` يحمل كود الخطأ وعلم `retryable` و`attempts`، و`channel.mini_app.launched` هو أثر نصف بوابة الخروج، وقرار إعادة المحاولة يحمل `source` (`backoff` أو `channel_cooldown`) ليُقرأ سبب التأخير في السجلات لاحقاً. آلياً الآن: `build-test` يشغّل الاختبارات الـ84 (منها اختبار الحراسة الذي يمنع انحراف المعمارية) و`doc-coverage` يمنع دفع كود بلا توثيق.

**Related:** [MR !24](https://gitlab.com/uxxxu/wasla/-/merge_requests/24)، [وثيقة النواة](../02-architecture/CHANNEL_LAYER_CORE.md)، [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)، [ADR-001](../15-decisions/ADR-001-identity-decoupled-from-telegram.md)، [عقود القناة](../../packages/channel-core/contracts/README.md)، [CONTAINERS §5.1](../02-architecture/CONTAINERS.md)، [HANDOFF §7](HANDOFF_NEXT_STEPS.md)

---

## 2026-08-20 · Phase 03 MR 1 — ADR-007 + عقود طبقة القنوات + `@wasla/contracts-channel`

**Task:** بدء المرحلة 03 (Telegram Channel Foundation) بالقرار المعماري الحاكم لموقع كود القناة وحدود عزلها، ثم نشر عقود القناة (API + أحداث + بيانات + أخطاء) وحزمة الأنواع المُكتبة — قبل أي كود قناة. **Status:** Completed (130 اختبار وحدة تنجح محلياً، منها 34 جديدة لعقود القناة) · **MR:** [!23](https://gitlab.com/uxxxu/wasla/-/merge_requests/23)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) `docs/15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md` (جديد): القناة **طبقة توصيل لا خدمة** — `packages/channel-core` (نموذج مجال + منافذ، صفر معرفة بـTelegram) + `packages/telegram-adapter` (المكان الوحيد الذي يعرف Bot API) + `packages/contracts/channel` (أنواع) + `bots/*` جذور تركيب رقيقة؛ مع جدول المنافذ التسعة ومُهيّئ إنتاج/اختبار لكل منفذ، والمكدّس (Node 20 + TS strict + Fastify + webhook لا long polling + بلا مكتبة بوتات + Drizzle/Postgres في MR 5)، وتسع قواعد تصميم ملزمة، وقائمة المؤجّلات، وسبعة بدائل مرفوضة بأسبابها. (ب) `packages/channel-core/contracts/` (جديد): `api.openapi.yml` (مدخل وحيد `POST /channel/{bot}/webhook` بترويسة secret token + مخرج وحيد `POST /channel/messages` + `GET /channel/{bot}/mini-app` + `POST /channel/{bot}/deep-links` + `/health`)، `events.json` (أربعة أحداث v1 بمنتج `channel-adapter` وaggregate `channel_chat`)، `schema.sql` (`channel_updates` + `channel_deliveries` + `channel_outbox` مع فهارس منع التكرار وطابور إعادة المحاولة)، `errors.md` (14 كود `CHANNEL_*` + خطة إعادة المحاولة)، و`README.md`. (ج) `packages/contracts/channel/` (حزمة جديدة `@wasla/contracts-channel`): أنواع API مُولّدة بـ`openapi-typescript`، أنواع الأحداث مشتقّة يدوياً، كتالوج الأخطاء ككائن مُكتب + `statusForChannelError`/`isChannelErrorCode`، وثوابت `BOT_MINI_APP`/`DEEP_LINK_MAX_PAYLOAD_LENGTH`/`MAX_DELIVERY_ATTEMPTS`؛ 34 اختباراً في ثلاثة ملفات. (د) توثيق: `docs/02-architecture/CONTAINERS.md` §5.1 (طبقة القنوات) + `HANDOFF_NEXT_STEPS.md` (لقطة الحالة محدّثة + §7 خطة السبع مراجعات + §8 للروابط) + `MASTER_PROGRESS.md` (Phase 03 = In Progress + كيف تُثبت البوابة آلياً) + `ROADMAP.md` (ملاحظة الحالة). (هـ) `pnpm-lock.yaml` للحزمة الجديدة.
2. **لماذا؟** بوابة خروج المرحلة تنص على «إمكانية استبدال Telegram adapter بـMock Adapter»، وهذا **قرار بنيوي لا تفصيل تنفيذي**: لو سكن كود القناة في حزمة واحدة أو داخل خدمة، لبقيت قابلية الاستبدال عُرفاً يُراجَع بشرياً. بفصل `channel-core` عن `telegram-adapter` وجعل الاعتماد أحادي الاتجاه (`bots/*` → `telegram-adapter` → `channel-core`) يصبح أي تسريب لتفاصيل Telegram إلى المجال **فشل بناء لا ملاحظة مراجعة**. ورُفضت خدمة `services/telegram` لأنها تضيف خدمة 25 غير موجودة في `SERVICES.md` وتُثبّت اسم القناة في اسم مكوّن معماري — عكس مبدأ محايدة القناة الذي تفرضه المرحلة 23 (Channel Independence). كما تفرض القوانين البدء بالعقود قبل الكود (ADR-004)، وهو ما فعلته المرحلتان 01 و02.
3. **أين؟** `docs/15-decisions/` + `packages/channel-core/contracts/` + `packages/contracts/channel/` + `docs/02-architecture/` + `docs/16-progress/` + `pnpm-lock.yaml`. **لا سطر واحد من كود تنفيذي للقناة** — هذه المراجعة عقود وقرار وتوثيق فقط.
4. **كيف تم اختباره؟** محلياً بمُثبِّت مُجمّد مطابق لـCI: `pnpm -r run typecheck` ✅ لست حزم (منها الحزمة الجديدة) و`pnpm -r run test` ✅ **130 اختباراً** (96 سابقة + 34 جديدة). الاختبارات الجديدة ليست تجميلية: (أ) **حراسة انحراف الأحداث** — تقرأ `events.json` وتؤكد تطابق `CHANNEL_EVENT_TYPES` مع القيم الحرفية، وتثبيت `producer` و`aggregate.type`، ووجود `channel` في حمولة كل حدث، ومطابقة `required` لكل حدث مع النوع المقابل، وغياب أي اسم حقل `telegram_*` من العقد. (ب) **حراسة انحراف كتالوج الأخطاء** — تُحلّل جدول `errors.md` سطراً سطراً وتؤكد أن الأكواد والأصناف وأعلام `retryable` مطابقة تماماً للكائن المُصدَّر، فأي كود يُضاف في الوثيقة دون الكود (أو العكس) يُفشل CI. (ج) **حراسة حدود ADR-007** على ملف OpenAPI نفسه: وجود مدخل واحد ومخرج واحد، غياب أي نقطة إرسال لكل بوت، إلزامية ترويسة secret token، وغياب أسماء حقول خاصة بـtelegram. (د) اختبارات عقد تُثبت خريطة بوت↔Mini App واحدة لواحدة.
5. **ما الخطوة التالية؟** MR 2/7: نواة `@wasla/channel-core` — نموذج المجال + المنافذ التسعة + حالات الاستخدام (استقبال+منع تكرار · تسليم+إعادة محاولة · تشغيل Mini App · ترميز/فك Deep Link) + مُهيّئات in-memory وMock + اختبار حراسة يمنع أي ذكر لـTelegram داخل النواة. الخطة الكاملة (7 مراجعات) في [HANDOFF §7](HANDOFF_NEXT_STEPS.md).
6. **هل مستند؟** نعم — ADR-007 (القرار وبدائله ونتائجه)، `README.md` للعقود، `CONTAINERS.md` §5.1 (موقع الطبقة واتجاه الاعتماد)، `HANDOFF §7` (خطة المراجعات + سبعة قيود ملزمة + المؤجّلات)، `MASTER_PROGRESS` (الحالة + كيف تُثبت البوابة آلياً)، `ROADMAP` (ملاحظة الحالة)، وهذا الإدخال.
7. **هل مراجَع؟** مُراجَع ذاتياً مقابل ADR-006 (نفس القالب والحجّة)، ومقابل بنية عقود `services/geography/contracts/` وحزمة `@wasla/contracts-geography` (نفس الأسماء والنصوص التوضيحية وأسلوب حراسة الانحراف)، ومقابل نصوص المرحلة في `ROADMAP` والدليل التنفيذي (ثلاثة بوتات · أوامر · deep links · Mini App · identity bootstrap · retry/de-duplication · تجريد المُهيّئ · مُهيّئ المجموعات). يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** نعم، وهو جوهر هذه المراجعة: ADR-007. سببان يفرضانه: (أ) [ENGINEERING_DOCUMENTATION_LAW §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) يمنع إضافة حزم جديدة بلا مبرر موثّق، وهنا تُضاف ثلاث. (ب) القرار يُنشئ حدّاً معمارياً ملزماً لكل من يعمل بعدنا (يُمنع نداء `telegram.sendMessage()` من أي خدمة Core). ملاحظة توثيقية: قائمة الـADRs في الدليل التنفيذي «أمثلة أولية» وتذكر ترقيماً مختلفاً (ADR-008)؛ التزمنا بترقيم المستودع التسلسلي كما في المراحل السابقة.
9. **هل يكسر backward compatibility؟** لا. عقود وأنواع جديدة فقط؛ لا مستهلك قائم لطبقة القنوات (البوتات أدلة فارغة). أحداث القناة تبدأ من `v1` وأي تغيير غير متوافق لاحقاً يلزمه `v2` + ADR.
10. **هل migration؟** لا في هذه المراجعة. `schema.sql` عقد بيانات منشور لا يُطبَّق بعد؛ تنفيذ جداوله عبر Drizzle + اختبارات تكامل مُخطَّط لـMR 5، ومُعلَن صراحةً في تعليق أعلى الملف وفي ADR-007 §5.
11. **هل توجد مخاطر؟** (أ) بدء المرحلة بمُهيّئات in-memory يعني أن أي نشر قبل MR 5 يفقد منع التكرار عند إعادة التشغيل → موثّق كقيد معروف في ADR-007 (Consequences) وفي جدول المنافذ. (ب) كتابة عميل Bot API يدوياً تعني تحمّل صيانته → مقصور على نداءات قليلة داخل حزمة واحدة قابلة للاستبدال. (ج) انحراف العقود عن الكود → حُيِّد بثلاث طبقات حراسة آلية (أحداث · أخطاء · حدود OpenAPI). (د) حدّ 64 حرفاً لحمولة Deep Link قد يقيّد أفعالاً مستقبلية → أُعلن في العقد بخطأ مخصّص `CHANNEL_DEEP_LINK_TOO_LONG` وبمؤجَّل `channel_deep_link_tokens` بدلاً من تجاهله. (هـ) `packages/channel-core/` يحتوي حالياً `contracts/` فقط دون `package.json` — pnpm يتجاهله حتى MR 2، ولا يؤثر على `--frozen-lockfile`.
12. **هل security؟** نعم بالتصميم: التحقّق من `X-Telegram-Bot-Api-Secret-Token` **قبل** أي تفسير للجسم (401 `CHANNEL_UNAUTHORIZED_WEBHOOK`)، واعتبار كل حقل قادم من القناة غير موثوق ويُتحقّق داخل حدود المُهيّئ، ومنع تخزين ربط `chat_ref` ↔ `wasla_public_id` في طبقة القنوات (ملك Identity — ADR-001)، ولا FK إلى `identity_users`، ولا رموز في الكود (كلها من البيئة)، وترجمة أخطاء القناة فلا يتسرّب نصها إلى الـCore أو إلى المستخدم. لا أسرار أُضيفت في هذه المراجعة.
13. **هل performance؟** العقد يفرض استجابة `202` سريعة للـwebhook (لا معالجة ثقيلة تحجب القناة)، وفهرساً جزئياً لطابور إعادة المحاولة (`WHERE status='queued'`)، وتباطؤاً أسّياً مع jitter واحتراماً لـ`retry_after` لتجنّب عاصفة إعادة محاولة، وحدّ خمس محاولات. لا أثر تشغيلي الآن (لا كود يعمل بعد).
14. **هل monitoring؟** أحداث `channel.message.delivered` و`channel.message.failed` (بكود الخطأ وعلم `retryable`) و`channel.mini_app.launched` هي إشارات المراقبة المستقبلية لطبقة القنوات، و`/health` يُبلّغ `ok|degraded`. آلياً الآن: وظائف CI (`build-test` تُشغّل اختبارات الحراسة الـ34، و`doc-coverage` تمنع أي دفعة كود بلا توثيق).

**Related:** [MR !23](https://gitlab.com/uxxxu/wasla/-/merge_requests/23)، [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)، [ADR-001](../15-decisions/ADR-001-identity-decoupled-from-telegram.md)، [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)، [CONTAINERS §5.1](../02-architecture/CONTAINERS.md)، [HANDOFF §7](HANDOFF_NEXT_STEPS.md)، [ROADMAP](ROADMAP.md)

---

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
