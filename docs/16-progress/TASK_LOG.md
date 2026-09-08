# TASK_LOG — سجل المهام بكل دفع (ملزم)

## 2026-09-08 · M5-12 · المراجعةُ 4/N — بوّابةُ خروجِ relevance/load + وظيفتا CI · `CLM-0115`

**Work Item(s):** M5-12 · **Branch:** `feat/m5-12-search-exit-gate` · **Claim:** `CLM-0115` (`@uxxxu (agent:perplexity-computer)` · 2026-09-08 → ينتهي 2026-09-22 · Active)

**ماذا تم إنجاز (1):** رُفعت الديونُ الثلاثةُ المُعلَنةُ في [ADR-025 §4](../15-decisions/ADR-025-marketplace-search-read-model.md) و[SEARCH_HTTP §5.6](../04-api/SEARCH_HTTP.md) حرفاً: **(أ)** بوّابةُ خروجِ المرحلةِ 12 في حزمةٍ جديدةٍ `@wasla/search-e2e` — **عشرونَ اختباراً** على PostgreSQL حقيقيٍّ وسلكٍ حقيقيٍّ (`port: 0`)، والفهرسُ فيها **ناتجُ `runRelayBatch` لا مبذورٌ باليد**: ثمانيةُ أحكامِ صلةٍ (تطابقٌ تامٌّ · تشكيلٌ وتطويلٌ · SKU · نصٌّ إنجليزيٌّ · بادئةٌ عربيّةٌ · خطأٌ إملائيٌّ عبرَ `pg_trgm` · كلمةٌ مفردةٌ · مُرشِّحُ تصنيفٍ) + سلّمُ رُتَبٍ (تامٌّ > بادئةٌ > نصٌّ كاملٌ > تشابُهٌ)، وخمسةُ أسبابِ حجبٍ في استعلامٍ واحدٍ، ومخزونٌ يُخفي ويُعيدُ **بلا حذفِ صفٍّ**، وترقيمٌ وفرزٌ بالسعرِ، وسبعةُ رموزِ خطأٍ بـ`trace_id`، وحملٌ مقيسٌ على 2006 وثيقةٍ، وتهدُّمٌ ⇒ `503 · SEARCH_INDEX_DEGRADED`. **(ب)** وظيفةُ CI `search-db-integration` — ساقُ `search` في مصفوفةِ `db-integration` على `wasla_search_test`، فاختباراتُ التكاملِ العشرةُ التي كانت **تُكتَبُ ولا تُشغَّلُ** صارت تُشغَّلُ. **(ج)** وظيفةُ CI `search-exit-gate-e2e` — ساقٌ في مصفوفةِ `exit-gate-e2e` على `wasla_search_e2e`، ومقابِلاتُها في `.gitlab-ci.yml`، وساقٌ ثالثةٌ في `db-integration-shared` (13/13). والوثيقةُ الحاكمةُ: [`PHASE12_EXIT_GATE_E2E.md`](../12-testing/PHASE12_EXIT_GATE_E2E.md).

**لماذا تم اختياره (2):** لأنّها **الخطوةُ التاليةُ المُسجَّلةُ حرفاً** في إدخالِ المراجعةِ 3/N («الخطوةُ التالية (9)»)، ولأنّ بوّابةً مؤجَّلةً تُبقي المرحلةَ 12 مبنيّةً على وصفٍ لا على قياسٍ: طبقاتُ 1/N و2/N و3/N كلٌّ منها مُثبَتٌ في عزلِه، ولا اختبارَ واحدٌ كان يصلُ `outbox → relay → index → HTTP` من طرفِه إلى طرفِه.

**أين تم التغيير (3):** حزمةٌ جديدةٌ `packages/search-e2e/` (خمسةُ ملفّاتٍ) · `services/search/src/index.ts` (تصديرُ ثلاثةِ محوّلاتٍ) · `services/search/src/__tests__/pg-harness.ts` (مطابقةُ عقدِ الصادرِ) · `.github/workflows/ci.yml` · `.gitlab-ci.yml` · `scripts/ci/run-shared-db-integration.sh` · وثائقُ `docs/12-testing` و`docs/04-api` و`docs/15-decisions` و`docs/07-security` و`docs/16-progress`.

**ما الـAPI/Event/Schema الذي تغير (5):** **لا شيءَ.** لم يُمسَّ عقدٌ ولا مخطّطٌ ولا مسارٌ: البوّابةُ تقيسُ ما هو قائمٌ. والتغييرُ الوحيدُ في شيفرةِ الخدمةِ تصديرُ ثلاثةِ محوّلاتٍ مكتوبةٍ سلفاً (`marketplace-event-source` · `projection-store` · `catalog-read-port`) — كُشِفَ نقصُها **لأنّ** البوّابةَ تستوردُ من السطحِ العامِّ لا من مساراتٍ داخليّةٍ.

**كيف تم الاختبار (6):** محلّيّاً على PostgreSQL 18: بوّابةُ الخروجِ **20/20** ثابتةً على ثلاثِ تشغيلاتٍ · تكاملُ الخدمةِ **10/10** على قاعدةٍ نقيّةٍ **وعلى القاعدةِ المشتركةِ** سواءً · `run-shared-db-integration.sh` **13/13** تِباعاً على قاعدةٍ واحدةٍ · `pnpm -r typecheck` و`pnpm -r test` ⇒ 0. **والحملُ مقيسٌ لا مُدَّعىً:** متتابعٌ (n=200) p50 13.3ms · p95 14.4ms · p99 18.6ms · 0 أخطاءٍ؛ متزامنٌ (n=60) p50 238.8ms · p95 382.0ms · جدارٌ ~402ms · 0 أخطاءٍ. والميزانيّاتُ المُعلَنةُ أوسعُ بمراتبَ (120ms/300ms/1500ms) عمداً — البوّابةُ حارسُ انحدارٍ لا اختبارُ عتادٍ متذبذبٌ.

**ما المشاكل التي ظهرت (7):** **ثلاثٌ، اثنتانِ منها كانتا خطأً في افتراضي لا في الشيفرةِ، والثالثةُ عيبٌ حقيقيٌّ.** **(أ)** أوّلُ تشغيلٍ للبوّابةِ أخفقَ في توكيدَين توقّعتُ فيهما صفَّ فهرسٍ لكلِّ منتجٍ محجوبٍ؛ والصوابُ أنّ `indexEffectFor` في `projector.ts` **لا يكتبُ وثيقةَ فهرسٍ إلّا عندَ `became_visible`**، فمنتجٌ لم يُرَ قطُّ لا صفَّ له أصلاً. فأُعيدت كتابةُ التوكيدِ على مجموعةِ الوثائقِ **بالضبطِ** (خمسٌ مرئيّةٌ + المؤرشَفُ الذي كان مرئيّاً) مع توكيداتِ جداولِ الحالةِ للأربعةِ الباقيةِ — **البوّابةُ عُدِّلت لتُطابقَ السلوكَ المُثبَتَ، ولم يُعدَّلْ سلوكٌ لتُطابقَه البوّابةُ.** **(ب)** خطأُ نوعٍ في `BatchOutcome` (توقّعتُ `ignored` والشكلُ الحقيقيُّ `{processed, applied, skipped, poisoned, advancedTo}`) — كشفَه `typecheck` قبلَ أوّلِ تشغيلٍ. **(ج) العيبُ الحقيقيُّ:** ضمُّ ساقِ البحثِ إلى القاعدةِ المشتركةِ أسقطَها بـ`null value in column "outbox_id"` — لأنّ مِعْوانَي الاختبارِ كانا يُنشئانِ `marketplace_outbox` **أليَنَ من عقدِ السوقِ** (مفتاحٌ بقيمةٍ افتراضيّةٍ وبلا قيودِ `CHECK`)، و`CREATE TABLE IF NOT EXISTS` لا يفعلُ شيئاً حينَ يكونُ الجدولُ الحقيقيُّ موجوداً. فمجموعةٌ تنجحُ على قاعدةٍ نقيّةٍ وتُخفِقُ على مشتركةٍ، **والأسوأُ أنّها كانت تسمحُ ببذرِ حدثٍ لا يستطيعُ السوقُ إصدارَه**. عُولِجَ بجذرِه: طابَقَ المِعْوانانِ العقدَ حرفاً وصارَ البذرُ يُمرِّرُ `outbox_id` صراحةً.

**ما الذي لم يكتمل (8):** رفعُ سقفِ المُرشَّحينَ (500) — [`RISK-0029`](../07-security/RISK_REGISTER.md) · مسارُ جاهزيّةٍ يسألُ الفهرسَ — [`RISK-0030`](../07-security/RISK_REGISTER.md) · **وإضافةُ الوظيفتَينِ الجديدتَينِ إلى `required_status_checks` في حمايةِ الفرعِ: إعدادٌ خارجَ المستودعِ يملكُه المالكُ وحدَه**، ولذلك يُخفِقُ الفحصُ 8 حتّى يُنفَّذَ ثمّ يُعادَ قياسُ [`MERGE_BLOCKING.json`](../12-testing/MERGE_BLOCKING.json). ولم يُقَسْ زمنُ البوّابةِ على عتادِ CI (PostgreSQL 15 · `ubuntu-latest`) — أوّلُ تشغيلٍ هناك أوّلُ قياسٍ.

**الخطوة التالية (9):** انتظارُ CI على الفرعِ، ثمّ قرارُ المالكِ في `required_status_checks`، ثمّ الدمجُ وإقفالُ دورةِ §8.1 (تحريرُ `CLM-0115`). وبعدَها: قرارُ مالكِ البرنامجِ في نقلِ M5-12 من `In Progress` إلى `Completed` (§9).


## 2026-09-08 · M5-12 · إقفالُ دورةِ §8.1 — تحريرُ CLM-0114 بعدَ دمجِ PR #77 (طبقةُ HTTP · المراجعة 3/N)

**Work Item(s):** M5-12 · **Branch:** `feat/m5-12-search-http` (مُحذوفٌ بعدَ الدمجِ) · **Scope:** سجلاتٌ مشتركةٌ مستثناةٌ من الحجزِ (M0-14) + نطاقُ الحجزِ نفسِه المُحرَّرُ هنا

**ماذا تم إنجاز (1):** حُرِّرَ حجزُ `CLM-0114` (search HTTP boundary) من «الحجوزاتِ النشطةِ» ونُقلَ إلى «المحرَّرة» بدليلِ دمجِه في [PR #77](https://github.com/skyosv10-art/wasla/pull/77) (مُدمجٌ 2026-09-08T18:45:50Z · الالتزامُ `66dc44959885a5b0d430cf4902b5adece7cde3e9` · squash). CI مقيسٌ: تشغيلُ الفرعِ [`34264340278`](https://github.com/skyosv10-art/wasla/actions/runs/34264340278) — **28 وظيفةً كلُّها `success`** (governance-guard ✓ · verify ✓ · typecheck ✓ · test ✓ · doc-coverage ✓ · repo-structure ✓ · Devin Review ✓ · 13 × db-integration ✓ · 9 × exit-gate-e2e ✓ · db-integration-shared ✓).

**لماذا تم اختياره (2):** المراجعةُ 3/N (طبقةُ HTTP) اكتملت بدليلٍ أخضرَ كاملٍ على الفرعِ (28/28)، فيُحرَّرُ الحجزُ وفقَ البروتوكولِ §8.1. الحالةُ تبقى `In Progress` لأنّ مركّبَ M5-12 لم يكتمل (مراجعاتٌ لاحقةٌ: exit gate · تكاملٌ وCI) — نقلُه إلى `Completed` قرارُ مالكِ البرنامجِ §9.

**أين تم التغيير (3):** `docs/16-progress/WORK_CLAIMS.md` (تحريرُ CLM-0114) · `docs/16-progress/TASK_LOG.md` (هذا الإدخالُ).

**الملفات/الخدمات المتأثرة (4):** دفاترُ الحوكمةِ فقط.

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيءَ جديدٌ في هذا الإغلاقِ (الكلُّ دُفعَ في المراجعةِ 3/N عبر PR #77).

**كيف تم الاختبار (6):** CI على الفرعِ قبلَ الدمجِ — 28/28 `success`.

**ما المشاكل التي ظهرت (7):** توسيعُ نطاقِ الحجزِ من `CLM-0113` إلى `CLM-0114` بعدَ بدءِ الكتابةِ (إضافةُ `fastify` حرّكتْ `pnpm-lock.yaml` خارجَ النطاقِ) — عُولِجَ بالبديلِ الثالثِ المُجازِ (تحريرٌ وإعادةُ حجزٍ بنطاقٍ أوسعَ) كسابقَتيه. وسجِّلْ أيضًا: تشغيلُ الدمجِ على `main` [`34264978773`](https://github.com/skyosv10-art/wasla/actions/runs/34264978773) فشلَ في الفحصِ #4 (بياتُ الحجوزاتِ) لأنّ الفرعَ حُذفَ والحجزُ لا يزالُ نشطًا — وهذا متوقَّعٌ ويُحلُّ بهذا طلبُ الإصدارِ نفسِه.

**ما الذي لم يكتمل (8):** مراجعاتُ M5-12 اللاحقةُ (exit gate · تكاملٌ وCI) — مُعلَنةٌ في ADR-025 §4.

**الخطوة التالية (9):** المراجعةُ 4/N: بوّابةُ خروجِ relevance/load (exit gate) ووظيفةُ CI `search-db-integration` و`search-exit-gate-e2e`.


## 2026-09-08 · M5-12 · المراجعةُ 3/N — طبقةُ HTTP (Fastify) لخدمةِ البحثِ · `CLM-0114`

**Work Item(s):** M5-12 · **Branch:** `feat/m5-12-search-http` · **Claim:** `CLM-0114` (`@uxxxu (agent:perplexity-computer)` · 2026-09-08 → ينتهي 2026-09-22 · Active). **تنويهٌ على الحجز:** `CLM-0113` حُرِّر بقرارٍ توثيقيٍّ بعدَ بدءِ الكتابةِ — إضافةُ `fastify` حرّكتْ `pnpm-lock.yaml` خارجَ النطاقِ، و§6 تمنعُ التوسيعَ في مكانِه، فاتُّبعَ البديلُ الثالثُ (كسابقَتيه `CLM-0024`⇒`CLM-0025` و`CLM-0081`⇒`CLM-0082`): تحريرٌ وإعادةُ حجزٍ بـ`CLM-0114` بنطاقٍ أوسعَ يضمُّ `pnpm-lock.yaml` على الفرعِ والمالكِ نفسَيهما. سُجِّلَ في [WORK_CLAIMS.md](WORK_CLAIMS.md) §3.

**ماذا تم إنجاز (1):** أُنشئت طبقةُ HTTP لخدمةِ البحثِ (المراجعةُ 3/N) فوقَ المراجعتَين 1/N (العقدُ والنطاقُ) و2/N (المستهلكُ relay). التطبيقُ `buildSearchHttpApp({ searchReadPort })` (`src/http/app.ts`) بمسارَين فقط: `GET /search/products` و`GET /search/health`، يعتمدُ على منفذِ قراءةٍ مُحقَنٍ `SearchProductsReadPort` (أُضيف إلى `src/ports.ts`) — فلا يفتحُ التطبيقُ اتصالاً بقاعدةِ البياناتِ بنفسِه. معالجُ أخطاءٍ واحدٌ (`setErrorHandler` + `sendSearchError`) بلا try/catch في المعالِجات، و**503 كملاذٍ أخيرٍ لا 500** (نموذجُ القراءةِ المشتقُّ يعتمدُ على حالةٍ عابرةٍ قابلةٍ لإعادةِ المحاولة). شكلُ الخطأِ مسطّحٌ `{ code, message, trace_id }` حسب `contracts/errors.md`.

أُنشئت: `src/http/{errors,requests,mappers,app,server}.ts` (التحققُ والتحويلُ والتوصيلُ على المنفذِ 8012) · `src/infrastructure/search-index-reader.ts` (القارئُ الإنتاجيُّ فوقَ `pg.Pool`، يقرأُ **فقط** `search_product_index` بلا JOIN لجداولِ السوقِ — حدُّ ADR-016 decision 9؛ الظهورُ شرطُ WHERE على الأعمدةِ الأربعةِ لا رايةٌ مُخزَّنة؛ مطابقةٌ على مرحلتَين: SQL يُضيِّقُ المُرشَّحينَ ثمَّ ترتيبُ النطاقِ `rankAndSort` يُعيدُ التسجيلَ بسُلَّمِ exact > prefix > fts > trigram). واختباراتُ وحدةٍ: `__tests__/http-requests.test.ts` (12 حالةً: التحليلُ والتحققُ، رفضُ المصفوفاتِ، الأكوادُ الصحيحةُ) و`__tests__/http-app.test.ts` (7 حالاتٍ: 200 للنتائج، 400 للتحققِ، 503 للتعطّلِ، ولا 500 أبدًا) بمنفذٍ وهميٍّ بلا DB. واختبارُ تكاملٍ `__tests__/search-index-reader.integration.test.ts` يتخطّى نفسَه بلا `DATABASE_URL` (كالـrelay) — يُثبتُ الظهورَ (إخفاءُ المخزونِ المُنفدِ وغيرِ المعتمدِ) والترتيبَ والتجزئةَ والفلترَةَ. أُضيفت اعتماديّةُ `fastify` (الإصدارُ 5.x المطابقُ لخدمةِ السوقِ) إلى `services/search/package.json`.

**لماذا تم اختياره (2):** ADR-025 §2.3.2 كان قد أجّلَ HTTP Layer صراحةً حتّى اكتمالِ الـrelay (تبعيّةٌ رسميّةٌ) — فاكتملَ relay في المراجعةِ 2/N، وصارَ بناءُ HTTP ممكنًا. اختيرَ التصميمُ المُحقَنُ (لا متصلٌ) ليتحقّقَ العقدُ عبرَ منفذٍ وهميٍّ بلا قاعدةِ بيانات، تمامًا كما في خدمةِ السوقِ (`marketplace/src/http/`) — فيبقى التطبيقُ قابلًا للاختبارِ في أجزاءٍ من الثانيةِ. اختيرَ 503 لا 500 لأنّ إخفاقاتِ الفهرسِ المشتقِّ غالبًا عابرةٌ (اتصالٌ، مهلةٌ، تأخّرُ relay)، فبحثٌ ينجحُ بعدَ ثانيتَين لا يُهجَرُ بعميلٍ حذر.

**أين تم التغيير (3):** `services/search/src/ports.ts` (إضافةُ `SearchProductsReadPort` + `SearchProductsQuery` + `SearchSort`) · `services/search/src/http/{errors,requests,mappers,app,server}.ts` (جديدٌ) · `services/search/src/infrastructure/search-index-reader.ts` (جديدٌ) · `services/search/src/index.ts` (تصديرُ HTTP والقارئ) · `services/search/src/__tests__/{http-requests,http-app,search-index-reader.integration}.test.ts` (جديدٌ) · `services/search/package.json` (اعتماديّةُ `fastify`) · `docs/04-api/SEARCH_HTTP.md` (القسمُ §5 + تحديثُ الترويسةِ) · `docs/15-decisions/ADR-025-marketplace-search-read-model.md` (§2.3.2 و§4: HTTP أُنجزَ) · `docs/12-testing/BASELINE.json` (إعادةُ التوليدِ: test_files_tracked 289→292 + بصمةُ القفلِ) · دفاترُ الحوكمةِ المشتركةُ (`WORK_CLAIMS`/`TASK_LOG`/`WORK_INDEX`/`LAUNCH_EXECUTION_BOARD`).

**الملفات/الخدمات المتأثرة (4):** `services/search/` (طبقةُ HTTP + قارئُ pg + اختبارات) · وثائقُ `M5-12` (SEARCH_HTTP · ADR-025) · الأساسُ الآليُّ (`BASELINE.json`).

**ما الـAPI/Event/Schema الذي تغير (5):** لا تغييرَ في العقدِ (`api.openapi.yml`/`schema.sql`/`events.json`/`errors.md` ثابتةٌ) — هذه المراجعةُ **تُنفّذُ** العقدَ المُحدَّدَ في 1/N، لا تُعدِّلُه. المسارانِ `GET /search/products` و`GET /search/health` وأكوادُ الأخطاءِ كلُّها كانت مُعلَنةً في العقودِ.

**كيف تم الاختبار (6):** محليًّا: `pnpm --filter @wasla/search-service test` → **62/62 نجاحًا** (19 جديدةً: 12 للطلبات + 7 للتطبيق). `pnpm -r typecheck` نجحَ. `pnpm -r test` نجحَ كلُّه. `bash scripts/checks/verify-governance.sh` نجحَ (13 فحصًا، تخطٍّ متوقَّعٌ واحدٌ: #8 CI مانعٌ حيًّا). أُعيدَ توليدُ `BASELINE.json` بدورتَين (قياسٌ مزدوجٌ لحلِّ التبعيةِ الدائريّةِ بين الحوكمةِ والأساسِ): verify_overall=passed · tests_passed=3894 · governance_suite_failed=0.

**ما المشاكل التي ظهرت (7):** (أ) قيمُ `page`/`page_size` تصلُ كنصوصٍ من querystring — صُحِّحَ `parsePositiveInt` ليقبلَ النصَّ العدديَّ ويرفضَ غيرَ الصحيح. (ب) الأحرفُ العربيةُ في سلسلةِ URL في الاختبارِ تُفسَّرُ خطأً — استُخدمَ كائنُ `query` في `fastify.inject`. (ج) الحوكمةُ فشلت في #11 (الأساسُ الآليُّ) لأنّ عدَّادَ test_files_tracked تغيّرَ — حُلَّ بإعادةِ التوليدِ بقرارٍ مكتوبٍ (`BASELINE_DIRTY_REASON`) وقياسٍ مزدوج.

**ما الذي لم يكتمل (8):** بوّابةُ relevance/load (exit gate) · وظيفةُ CI `search-db-integration` (تشغيلُ اختبارِ التكاملِ في CI) · وظيفةُ CI `search-exit-gate-e2e` · رفعُ سقفِ المُرشَّحينَ (v1: 500). كلُّها مُعلَنةٌ في ADR-025 §4 وSEARCH_HTTP §5.6.

**الخطوة التالية (9):** دفعُ الفرعِ وفتحُ طلبِ الدمجِ وانتظارُ CI (28 وظيفةً)، ثمَّ الدمجُ بـsquash، ثمَّ طلبُ إصدارِ CLM-0114 (كما في CLM-0112).

**ما الذي يعتمد عليه العمل التالي (10):** المستهلكُ (relay) المُدمجُ في 2/N (يبني `search_product_index` الذي يقرأُ منه القارئُ) · طبقةُ HTTP في هذه المراجعةِ (الأساسُ لبوّابةِ exit gate).

**Migration/Deployment/Config (11):** لا ترحيلٌ جديد. التوصيلُ: `DATABASE_URL` من البيئةِ فقط (لا يُلتزَم في الشفرة)، المنفذُ 8012 (`PORT`).

**مخاطر/قرارات تحتاج مراجعة (12):** سقفُ المُرشَّحينَ (500) حدٌّ مُعلَنٌ لـv1 — يُرفعُ فوقَ بوّابةِ الحملِ لاحقًا. مطابقةُ العربيّةِ FTS بلغةِ `english` لا تُدركُ العربيةَ — يعوّضُها trigram، والفجوةُ مُعلَنةٌ (ADR-025 §2.4).

**الروابط (13):** [ADR-025](../15-decisions/ADR-025-marketplace-search-read-model.md) · [SEARCH_HTTP.md](../04-api/SEARCH_HTTP.md) · [WORK_CLAIMS.md](WORK_CLAIMS.md) (`CLM-0114`) · [BASELINE.json](../12-testing/BASELINE.json)

**الشخص/الفريق الذي يتابع (14):** `@uxxxu (agent:perplexity-computer)` — حجزٌ نشطٌ (`CLM-0114` · ينتهي 2026-09-22).

## 2026-09-08 · M5-12 · إقفالُ دورةِ §8.1 — تحريرُ CLM-0112 بعدَ دمجِ PR #75 (relay consumer · المراجعة 2/N)

**Work Item(s):** M5-12 · **Branch:** `feat/m5-12-search-relay-consumer` (مُحذوفٌ بعدَ الدمجِ) · **Scope:** سجلاتٌ مشتركةٌ مستثناةٌ من الحجزِ (M0-14) + نطاقُ الحجزِ نفسِه المُحرَّرُ هنا

**ماذا تم إنجاز (1):** حُرِّرَ حجزُ `CLM-0112` (search relay consumer) من «الحجوزاتِ النشطةِ» ونُقلَ إلى «المحرَّرة» بدليلِ دمجِه في [PR #75](https://github.com/skyosv10-art/wasla/pull/75) (مُدمجٌ 2026-09-08T17:21:20Z · الالتزامُ `18ba793a7e91ca8a6a7a4a402584d403eca85364` · squash). CI مقيسٌ: تشغيلُ الفرعِ [`34256193059`](https://github.com/skyosv10-art/wasla/actions/runs/34256193059) — **28 وظيفةً كلُّها `success`** (governance-guard ✓ · verify ✓ · typecheck ✓ · test ✓ · doc-coverage ✓ · repo-structure ✓ · Devin Review ✓ · 13 × db-integration ✓ · 9 × exit-gate-e2e ✓ · db-integration-shared ✓).

**لماذا تم اختياره (2):** المراجعةُ 2/N (relay consumer) اكتملت بدليلٍ أخضرَ كاملٍ على الفرعِ (28/28)، فيُحرَّرُ الحجزُ وفقَ البروتوكولِ §8.1. الحالةُ تبقى `In Progress` لأنّ مركّبَ M5-12 لم يكتمل (مراجعاتٌ لاحقةٌ: exit gate · HTTP · تكاملٌ وCI) — نقلُه إلى `Completed` قرارُ مالكِ البرنامجِ §9.

**أين تم التغيير (3):** `docs/16-progress/WORK_CLAIMS.md` (تحريرُ CLM-0112) · `docs/16-progress/TASK_LOG.md` (هذا الإدخالُ).

**الملفات/الخدمات المتأثرة (4):** دفاترُ الحوكمةِ فقط.

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيءَ جديدٌ في هذا الإغلاقِ (الكلُّ دُفعَ في المراجعةِ 2/N).

**كيف تم الاختبار (6):** CI على الفرعِ قبلَ الدمجِ — 28/28 `success`.

**ما المشاكل التي ظهرت (7):** لا شيءَ.

**ما الذي لم يكتمل (8):** مراجعاتُ M5-12 اللاحقةُ (exit gate · HTTP · تكاملٌ وCI) — مُعلَنةٌ في ADR-025 §4.

**الخطوة التالية (9):** المراجعةُ 3/N: بوّابةُ خروجِ relevance/load (exit gate) وطبقةُ HTTP (Fastify).

**ما الذي يعتمد عليه العمل التالي (10):** المستهلكُ (relay) المُدمجُ في هذه المراجعةِ.

**Migration/Deployment/Config (11):** لا شيءَ جديد.

**مخاطر/قرارات تحتاج مراجعة (12):** قراراتُ ADR-025 المؤجَّلةُ.

**الروابط (13):** [PR #75](https://github.com/skyosv10-art/wasla/pull/75) (الدمجُ `18ba793`) · [ADR-025](../15-decisions/ADR-025-marketplace-search-read-model.md) · [WORK_CLAIMS.md](WORK_CLAIMS.md) · البروتوكول §8.1

**الشخص/الفريق الذي يتابع (14):** `@uxxxu (agent:perplexity-computer)` — نفّذَ التوثيقَ. مالكُ البرنامجِ (`@uxxxu`) صرّحَ بالدمجِ.

## 2026-09-08 · M5-12 · المراجعةُ 2/N — Relay Consumer (تصميمٌ وتنفيذٌ وإثباتٌ end-to-end)

**Work Item(s):** M5-12 · **Branch:** `feat/m5-12-search-relay-consumer` · **Claim:** CLM-0112 (نشط) · **Scope:** `services/search/` (عقود + نطاق + منافذ + relay + بنية تحتية + اختبارات) · `packages/contracts/search/` · `docs/15-decisions/ADR-025` (ملحق §2.3.1/§2.3.2) · دفاترُ مشتركةٌ مستثناةٌ (M0-14)

**ماذا تم إنجاز (1):** صُمِّمَ ونُفِّذَ المستهلكُ (relay) لأحداثِ `marketplace_outbox` وفقَ ADR-025: ثلاثةُ منافذَ (`MarketplaceEventSource` · `CatalogReadPort` · `ProjectionStore`)، ونواةُ الإسقاطِ `projector.ts` (كشفُ قِدَمٍ بالتسلسلِ + انتقالاتُ الظهورِ)، ومحرّكُ الـrelay `relay.ts` (تماثُلٌ · إعادةٌ · سمٌّ · نقطةُ تقدُّمٍ · إعادةُ بناءٍ). خمسُ جداولِ حالةِ جديدةٍ في `schema.sql` (`search_marketplace_store_state` · `search_marketplace_product_state` · `search_outbox` · `search_relay_consumed_events` · `search_relay_checkpoint`) ووثيقةُ الفهرسِ تحملُ الآنَ أعمدةَ الحالةِ المُستهلَكةِ. ثلاثُ محوّلاتِ PostgreSQL حقيقيّةٍ. **43 اختبارَ وحدةٍ + 4 اختباراتِ تكاملٍ على PostgreSQL 17 حقيقيٍّ** (المسارُ الكاملُ · التسليمُ المزدوجُ · إعادةُ الترتيبِ · إعادةُ البناءِ) تُثبتُ `outbox event → relay → search read model → correct resulting state`.

**لماذا تم اختياره (2):** المراجعةُ 2/N هي الخطوةُ الصحيحةُ التاليةُ لأنّ القرارَ المعماريَّ (ADR-025) يجعلُ `marketplace_outbox` مصدرَ الأحداثِ لنموذجِ القراءةِ — فلا يُبنى الـHTTP ولا بوّابةُ relevance/load قبلَ اكتمالِ الـrelay (تبعيّةٌ رسميّةٌ). كشفَ التنفيذُ ثلاثَ فجواتٍ بنيويّةٍ في العقودِ التأسيسيّةِ (نقصُ أعمدةِ الحالةِ · غيابُ العنوان/السعرِ عن الأحداثِ · غيابُ `markPublished`) وعُولِجَت كلُّها، لا إخفاءً.

**أين تم التغيير (3):** `services/search/contracts/schema.sql` (6 جداول) · `services/search/src/domain/{consumed-events.ts,projector.ts,model.ts,visibility.ts,ranking.ts}` · `services/search/src/ports.ts` · `services/search/src/relay.ts` · `services/search/src/infrastructure/{marketplace-event-source.ts,catalog-read-port.ts,projection-store.ts}` · `services/search/src/__tests__/{relay.test.ts,relay.integration.test.ts,projector.test.ts,event-coverage.test.ts,pg-harness.ts}` · `services/search/vitest.{config,integration.config}.ts` · `packages/contracts/search/src/{api-types.ts,__tests__/contracts.test.ts}` · `docs/15-decisions/ADR-025-*.md` · `docs/12-testing/BASELINE.json` · `docs/16-progress/{TASK_LOG,WORK_INDEX,LAUNCH_EXECUTION_BOARD,WORK_CLAIMS}.md`

**الملفات/الخدمات المتأثرة (4):** خدمةُ البحثِ `@wasla/search-service` (نطاقٌ + منافذُ + relay + بنيةٌ تحتيةٌ + اختبارات) · حزمةُ عقودِ البحثِ `@wasla/contracts-search` (الأنواعُ + عقودُ المخططِ).

**ما الـAPI/Event/Schema الذي تغير (5):** مخططُ `search_product_index` توسَّعَ بأعمدةِ الحالةِ المُستهلَكةِ (`store_state`/`product_state`/`moderation_state`/`quantity_on_hand`/`sku`/`category_slug`) وحُذفَ منه `category_id`/`product_slug`/`is_visible` (الظهورُ مشتقٌّ لا مخزَّن). أُضيفَت 5 جداولِ حالةِ/استهلاكٍ. عقدُ البحثِ `ProductSearchResult` و`SearchQuery` استبدلا `category_id`←`category_slug` و`product_slug`←`sku`. لا تغييرَ في أحداثِ السوقِ ولا في مخططِ `marketplace_outbox` (يُقرأُ فقط).

**كيف تم الاختبار (6):** typecheck نظيفٌ (خدمةُ البحثِ + كاملُ المستودعِ) · **43/43 اختبارَ وحدةٍ** · **4/4 اختباراتِ تكاملٍ على PostgreSQL 17 مدمجٍ حقيقيٍّ** (`DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres`) · إثباتُ حمايةِ انحرافِ الأحداثِ (13 نوعاً مُصنَّفاً صريحاً) · verify-governance (13/13) · BASELINE مُحدَّثٌ. **عيبٌ صريحٌ وُجِدَ وأُصلِح:** كانَ `applyEvent` يُحدّثُ الحالةَ قبلَ جلبِ الكتالوجِ، فالفشلُ العابرُ يتركُ الحالةَ مُتحوّلةً فتتخطّى إعادةَ المحاولةِ بناءَ الوثيقةِ — صُحِّحَ بجلبِ الكتالوجِ قبلَ تحويرِ الحالةِ (إعادةُ المحاولةِ آمنةٌ).

**ما المشاكل التي ظهرت (7):** (1) فجوةُ بنيةِ الفهرسِ: لا أعمدةَ حالةٍ → لا كشفَ تغيُّرٍ. عولجَ بجداولِ الحالةِ. (2) أحداثُ السوقِ بلا عنوانٍ/سعرٍ → منفذُ قراءةِ كتالوجٍ مُصرَّحٌ. (3) لا `markPublished` → نقطةُ تقدُّمٍ يملكُها البحثُ في `search_relay_checkpoint`. (4) اصطدامُ تسلسلِ `moderation_sequence` (تهيئةٌ 1 تتصادمُ مع أوّلِ قرارٍ) → التهيئةُ 0 والقيدُ `>=0`. (5) عدمُ تزامُنِ تحويرِ الحالةِ مع جلبِ الكتالوجِ → أُعيدَ ترتيبُ `applyEvent`.

**ما الذي لم يكتمل (8):** بوّابةُ HTTP Layer وrelevance/load (تبعيّةٌ رسميّةٌ على اكتمالِ الـrelay — تُؤجَّلُ لمراجعةٍ لاحقةٍ) · وظيفةُ CI `search-db-integration` (تتخطّى بلا `DATABASE_URL`؛ مستوى الجمعِ مع محرّكِ Postgres المدمجِ غيرُ جاهزٍ بعدُ) · تكاملُ HTTP الفعليُّ بينَ الخدمتَين (يُتركُ لوقتِ التشغيلِ). M5-12 تبقى **In Progress**.

**الخطوة التالية (9):** بعدَ دمجِ هذه المراجعةِ: المراجعةُ 3/N — HTTP Layer (Fastify) لخدمةِ البحثِ — لا تُبدأُ إلّا بعدَ اكتمالِ الـrelay وتصديقِ مالكِ البرنامجِ.

**ما الذي يعتمد عليه العمل التالي (10):** اكتمالُ المستهلكِ (relay) وإثباتُه end-to-end — مُستوفىً في هذه المراجعةِ.

**Migration/Deployment/Config (11):** مخططُ البحثِ يُطبَّقُ عبرَ `applySearchSchema` (DROP+CREATE في بيئةِ الاختبارِ). لا ترحيلاتٍ إنتاجيّةٍ بعدُ (طورُ التأسيسِ). منفذُ الكتالوجِ `GET /products/{productId}` مُصرَّحٌ بهِ في ADR-025 §2.3.

**مخاطر/قرارات تحتاج مراجعة (12):** (1) تكاملُ HTTP الفعليُّ بينَ الـrelay ومنفذِ الكتالوجِ يُتركُ لوقتِ التشغيلِ (الـrelay مُختبرٌ بـfake catalog؛ المنفذُ مُختبرٌ في عزلٍ). (2) الترتيبُ يعتمدُ على `created_at` + `outbox_id` — يُضمنُ الترتيبَ ضمنَ المعاملةِ الواحدةِ (`clock_timestamp`) لا عبرَ الخدماتِ. (3) `markPublished` دَينُ طورِ 09 — يُسجَّل في `search_relay_checkpoint` مملوكاً للبحثِ.

**الروابط (13):** PR (قيدُ الإنشاءِ) · [ADR-025 §2.3.1](../15-decisions/ADR-025-marketplace-search-read-model.md) · [BASELINE](../12-testing/BASELINE.json)

**الشخص/الفريق الذي يتابع (14):** مالكُ البرنامجِ (`@uxxxu`) — تصديقُ الاكتمالِ ونقلُ M5-12 إلى `Completed` قرارُه §9.

---

## 2026-09-08 · M5-12 · إقفالُ دورةِ §8.1 — تحريرُ CLM-0111 بعدَ دمجِ PR #73

**Work Item(s):** M5-12 · **Branch:** `feat/m5-12-marketplace-search` (مُحذوفٌ بعدَ الدمجِ) · **Scope:** سجلاتٌ مشتركةٌ مستثناةٌ من الحجزِ (M0-14) + نطاقُ الحجزِ نفسِه المُحرَّرُ هنا

**ماذا تم إنجاز (1):** حُرِّرَ حجزُ `CLM-0111` (search) من «الحجوزاتِ النشطةِ» ونُقلَ إلى «المحرَّرة» بدليلِ دمجِه في [PR #73](https://github.com/skyosv10-art/wasla/pull/73) (مُدمجٌ 2026-09-08 · الالتزامُ `002d3bb7461a9b973eacac1b5b91dcd800f2c489` · squash). CI مقيسٌ: تشغيلُ الفرعِ [`34243325054`](https://github.com/skyosv10-art/wasla/actions/runs/34243325054) — **27 وظيفةً كلُّها `success`** (governance-guard ✓ · verify ✓ · typecheck ✓ [بعدَ إعادةِ تشغيلٍ لوظيفةٍ فشلَ رفعُ سجلِّها بـ403 من وسيطٍ لا عيبَ في الأنواع] · test ✓ · doc-coverage ✓ · repo-structure ✓ · Devin Review ✓ · 13 × db-integration ✓ · 9 × exit-gate-e2e ✓ · db-integration-shared ✓).

**لماذا تم اختياره (2):** المراجعةُ التأسيسيّةُ (1/N) لمركّبِ البحثِ اكتملت بدليلٍ أخضرَ كاملٍ على الفرعِ، فيُحرَّرُ الحجزُ وفقَ البروتوكولِ §8.1. الحالةُ تبقى `In Progress` لأنّ مركّبَ M5-12 لم يكتمل (مراجعاتٌ لاحقةٌ: relay · exit gate · HTTP · تكاملٌ وCI) — نقلُه إلى `Completed` قرارُ مالكِ البرنامجِ §9.

**أين تم التغيير (3):** `docs/16-progress/WORK_CLAIMS.md` (تحريرُ CLM-0111) · `docs/16-progress/TASK_LOG.md` (هذا الإدخالُ).

**الملفات/الخدمات المتأثرة (4):** دفاترُ الحوكمةِ فقط.

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيءَ جديدٌ في هذا الإغلاقِ (الكلُّ دُفعَ في المراجعةِ التأسيسيّةِ).

**كيف تم الاختبار (6):** CI على الفرعِ قبلَ الدمجِ — 27/27 `success`. والدليلُ مُقيسٌ على `main` بعدَ الدمجِ (الالتزامُ `002d3bb7`).

**ما المشاكل التي ظهرت (7):** فحصُ `typecheck` فشلَ أوّلاً برفعِ سجلِّ الأنواعِ بـ`403 Forbidden` من وسيطِ تخزينِ القطعِ (لا عيبَ في الأنواعِ نفسِها — `pnpm -r run typecheck` نجحَ وأنتجَ `typecheck.log`). أُعيدَ تشغيلُ الوظيفةِ فاجتازت. لا علاقةَ بالكودِ.

**ما الذي لم يكتمل (8):** مراجعاتُ M5-12 اللاحقةُ (relay · exit gate · HTTP · تكاملٌ وCI) — مُعلَنةٌ في ADR-025 §4.

**الخطوة التالية (9):** المراجعةُ 2/N: المستهلكُ (relay) لأحداثِ `marketplace_outbox` وإعادةُ بناءِ الفهرسِ من الحالةِ المستهلكةِ.

**ما الذي يعتمد عليه العمل التالي (10):** مخطّطُ `marketplace_outbox` القائمُ في `services/marketplace/contracts/schema.sql` (مُنجزٌ M5-11).

**Migration/Deployment/Config (11):** لا شيءَ جديد.

**مخاطر/قرارات تحتاج مراجعة (12):** قراراتُ ADR-025 المؤجَّلةُ.

**الروابط (13):** [PR #73](https://github.com/skyosv10-art/wasla/pull/73) (الدمجُ `002d3bb7`) · [ADR-025](../15-decisions/ADR-025-marketplace-search-read-model.md) · [WORK_CLAIMS.md](WORK_CLAIMS.md) · البروتوكول §8.1

**الشخص/الفريق الذي يتابع (14):** `@uxxxu (agent:perplexity-computer)` — نفّذَ التوثيقَ. مالكُ البرنامجِ (`@uxxxu`) صرّحَ بالدمجِ.

## 2026-09-08 · M5-12 · المراجعةُ التأسيسيّةُ (review 1/N) — ADR-025 + عقودُ البحث + هيكلُ الخدمةِ

**Work Item(s):** M5-12 · **Branch:** `feat/m5-12-marketplace-search` · **Claim:** `CLM-0111` (`@uxxxu (agent:perplexity-computer)` · 2026-09-08 → ينتهي 2026-09-22 · Active)

**ماذا تم إنجاز (1):** بدأت المراجعةُ التأسيسيّةُ لمركّبِ `M5-12 Marketplace Search`. صُدِّرَ [ADR-025](../15-decisions/ADR-025-marketplace-search-read-model.md) يُقرّرُ: (أ) فهرسُ البحثِ **نموذجُ قراءةٍ مشتقٌّ** يُعادُ بناؤه من أحداثِ صندوقِ الصادرِ (`marketplace_outbox`) لا قراءةٌ مباشرةٌ من جداولِ السوقِ (قراءةٌ مباشرةٌ تكسرُ حدَّ الخدمةِ — ADR-016 decision 9، رُفضَت). (ب) الظهورُ مُشتقٌّ من الحالةِ المستهلكةِ (not `store_active` · `product_status='published'` · `moderation_status='approved'` · `quantity_minor_units > 0`) لا رايةٌ مُخزَّنةٌ (`is_visible`). (ج) الترتيبُ مفسَّرٌ بأربعِ درجات: `exact match` > `prefix` > `full-text` > `trigram` similarity. (د) المعالجةُ ثنائيّةُ اللغةِ (AR/EN) بتطبيعٍ يُزيلُ التشكيلَ والتطويلَ ويُوحِّدُ الحالة. أُنشئت حزمةُ عقودٍ جديدةٌ `@wasla/contracts-search` (`packages/contracts/search/`) تُصدّرُ `api-types` (مساراتُ `GET /search/products` و`GET /search/health` + المخطّطات: `SearchQuery` · `ProductSearchResult` · `SearchPage`) و`events-types` (`SearchIndexRebuiltV1` · `SearchIndexDegradedV1` بمُغلَّفٍ موحَّدٍ). وأُنشئت خدمةُ `services/search/` بعقودِها (`contracts/schema.sql` بجدولِ `search_product_index` وفهارسِ `tsvector`+`pg_trgm` وعمودِ `price_minor_units INTEGER` بالحلال، و`contracts/api.openapi.yml`، و`contracts/events.json`، و`contracts/errors.md`، و`contracts/README.md`) ونواةِ نطاقِها (`src/domain/model.ts` · `query.ts` يُطبيعُ الاستعلامَ ويُزيلُ التشكيلَ والتطويلَ، `visibility.ts` يُطبِّقُ شروطَ ADR-016 decision 3 الأربعةَ، `ranking.ts` بسُلَّمِ الدرجاتِ الأربع، `index.ts`). واختباراتُ وحدةٍ في `src/__tests__/` (24 تأكيداً: تطبيعُ العربية/الإنجليزيّةِ، كشفُ الفراغِ، حدُّ الطول، تكافؤُ الثنائيّةِ، شروطُ الظهورِ الأربعة، الدرجاتُ والترتيب) واختباراتُ عقودٍ في `packages/contracts/search/src/__tests__/contracts.test.ts` (9 توكيداتٍ تُثبتُ غيابَ عمودِ `is_visible` وقيمةَ `price_minor_units` بالحلال وصحّةَ المُنتِج = `search-service`). وتُحدِّثُ ترويسةُ اللوحةِ و`WORK_INDEX` و`LAUNCH_EXECUTION_BOARD` لتعكسَ `M5-12 = In Progress`.

**لماذا تم اختياره (2):** `M5-12` هو أوّلُ عنصرٍ على الطريقِ بعدَ إغلاقِ `M5-11`، واعتمادُه (`M5-11`) صارَ مُستوفىً. القرارُ المعماريُّ (فهرسٌ مشتقٌّ لا قراءةٌ مباشرةٌ) يلتزمُ بحدِّ الخدمةِ من ADR-016 decision 9 الذي كان قد أجّلَ البحثَ صراحةً إلى هذا الطورِ («البحثُ يُملَكُ لاحقاً بـPhase 12، وفهرسٌ نصفُ مبنيٍّ هنا كان سيصيرُ مصدرَ حقيقةٍ ثانياً»). أُنجزت المراجعةُ التأسيسيّةُ (1/N) لأنّ البحثَ مركّبٌ (استهلاكُ أحداث + إعادةُ بناءِ فهرس + بوّابةُ خروج) فلا يُبني دفعةً واحدةً، بل يبدأ بالقرارِ المعماريِّ والعقودِ والنواةِ القابلةِ للاختبارِ بلا قاعدةِ بيانات، ثمّ تُبنى عليها المراجعاتُ التاليةُ.

**أين تم التغيير (3):** `docs/15-decisions/ADR-025-marketplace-search-read-model.md` (جديد) · `packages/contracts/search/` (جديد: `package.json` · `tsconfig.json` · `src/index.ts` · `src/api-types.ts` · `src/events-types.ts` · `src/__tests__/contracts.test.ts`) · `services/search/` (جديد: `contracts/{schema.sql,api.openapi.yml,events.json,errors.md,README.md}` · `package.json` · `tsconfig.json` · `vitest.config.ts` · `src/index.ts` · `src/domain/{model,query,visibility,ranking}.ts` · `src/__tests__/{query,visibility,ranking}.test.ts`) · `docs/04-api/SEARCH_HTTP.md` (جديد) · `docs/12-testing/BASELINE.json` (مُحدَّث: `packages` 43←45 · `test_files_tracked` 281←285 · البصمةُ `sha256:f0a8ad35…`) · `docs/16-progress/{LAUNCH_EXECUTION_BOARD,WORK_INDEX,TASK_LOG}.md` · `pnpm-lock.yaml` (حزمةٌ جديدة + اختباراتها).

**الملفات/الخدمات المتأثرة (4):** `services/search/` (جديد بالكامل) · `packages/contracts/search/` (جديد بالكامل) · لا يُمسُّ `services/marketplace/**` إطلاقاً (الحدُّ من ADR-016 decision 9).

**ما الـAPI/Event/Schema الذي تغير (5):** API جديدٌ `GET /search/products` و`GET /search/health` (مُختبرٌ نوعيّاً بالعقود، غيرُ مُشغَّلٍ بـFastify بعد) · أحداثُ `SearchIndexRebuiltV1` و`SearchIndexDegradedV1` (مُنتِجُها `search-service`) · مخطّطٌ جديدٌ `search_product_index` (جدولُ قراءةٍ مشتقٌّ بفهارسِ `tsvector`+`pg_trgm`، بلا `is_visible`).

**كيف تم الاختبار (6):** `pnpm --filter @wasla/contracts-search test` — **9/9 توكيداتٍ خضراء** (4ms) · `pnpm --filter @wasla/search-service test` — **24/24 توكيداً أخضر** · `pnpm -r typecheck` — نظيفٌ (40→42 حزمة) · `pnpm -r test` (تشغيلٌ كاملٌ أخضرُ بلا قاعدةِ بيانات: **3850 اختباراً ناجحاً**، اختباراتُ التكاملِ تُتخطّى لغيابِ `DATABASE_URL`) · `bash scripts/checks/verify-governance.sh` — **رمزُ الخروجِ 0** · 13 فحصاً ناجحاً · 0 فاشلاً · تخطّيانِ مُعلَنانِ (8) CI مانعٌ جزئيٌّ (لقطةٌ مؤرَّخةٌ) · (9) تدقيقُ الاعتمادياتِ جزئيٌّ (لا شبكة). وأُعيدَ توليدُ الأساسِ الآليِّ (M0-08) من سجلٍّ أخضرَ مقيسٍ: `packages` 43←45 · `test_files_tracked` 281←285 · `tests_passed` = 3850 · البصمةُ `sha256:f0a8ad35…`.

**ما المشاكل التي ظهرت (7):** عقبةُ حوكمةٍ في أوّلِ تشغيلٍ: إضافةُ حزمتَينِ جديدتَينِ غيّرَت العدَّاداتِ الساكنةَ في الأساسِ (43→45) فأخفقَ البابُ الثاني من الفحصِ الحادي عشر. عولجت بإعادةِ توليدِ الأساسِ من تشغيلٍ أخضرَ كاملٍ (الخطواتُ أعلاه). كما اكتُشفَ أنّ حزمةَ `@wasla/contracts-search` كانت تُفشلُ `pnpm -r test` لأنّها بلا ملفِّ اختبارٍ (vitest يخرجُ برمزِ 1)، فأُضيفَ `contracts.test.ts` (9 توكيداتٍ) فصارَت خضراءَ.

**ما الذي لم يكتمل (8):** (مُعلَنٌ صراحةً في ADR-025 §4): المستهلكُ الكاملُ (relay) لأحداثِ `marketplace_outbox` الذي يُعيدُ بناءَ الفهرس · بوّابةُ خروجِ relevance/load (exit gate) · طبقةُ HTTP الكاملةُ (Fastify) · اختباراتُ التكاملِ على PostgreSQL حقيقيٍّ ووظائفُ CI المقابلةُ (`search-db-integration` · `search-exit-gate-e2e`) · التحقّقُ من `verify-overall=passed` (الأساسُ الحاليُّ `verify_overall=failed` لأنّ الفحصَ الحادي عشر كان يفشلُ قبلَ إعادةِ التوليدِ — تناقضٌ دوريٌّ يُحلُّ عندَ دمجِ هذا الأساسِ وتشغيلٍ جديد). لا يُدَّعى إنجازُ أيٍّ من هذه في هذه المراجعة.

**الخطوة التالية (9):** دفعُ الفرعِ وفتحُ طلبِ دمجٍ، ثمّ مراقبةُ CI (27 وظيفةً). بعدَ الدمج: المراجعةُ 2/N تُضيفُ المستهلكَ (relay) لأحداثِ outbox السوقِ وإعادةَ بناءِ الفهرس من الحالةِ المستهلكةِ.

**ما الذي يعتمد عليه العمل التالي (10):** استهلاكُ `marketplace_outbox` يعتمدُ على مخطّطِه القائمَ في `services/marketplace/contracts/schema.sql` (مُنجزٌ في M5-11) — لا تعديلَ على السوقِ مطلوبٌ، قراءةٌ فقط.

**Migration/Deployment/Config (11):** مخطّطٌ جديدٌ `search_product_index` (ترحيلٌ يُولَّدُ لاحقاً عندَ إضافةِ طبقةِ قاعدةِ البيانات — لا يُطبَّقُ في هذه المراجعةِ).

**مخاطر/قرارات تحتاج مراجعة (12):** قراراتُ ADR-025 المؤجَّلةُ (مولِّدُ الترتيبِ الفعليِّ، سياسةُ إعادةِ البناءِ، بوّابةُ relevance/load، اختيارُ مُحرّكِ FTS). لا مخاطرَ مفتوحةٌ جديدةٌ تُسجَّلُ في هذا الطورِ.

**الروابط (13):** [ADR-025](../15-decisions/ADR-025-marketplace-search-read-model.md) · [SEARCH_HTTP.md](../04-api/SEARCH_HTTP.md) · [WORK_CLAIMS.md](WORK_CLAIMS.md) (`CLM-0111`) · ADR-016 decision 9 (الأصلُ الذي أجّلَ البحثَ إلى هذا الطورِ)

**الشخص/الفريق الذي يتابع (14):** `@uxxxu (agent:perplexity-computer)` — حجزٌ نشطٌ (`CLM-0111` · ينتهي 2026-09-22). القرارُ المعماريُّ في ADR-025 مُسلَّمٌ للمُراجِعِ.

## 2026-09-08 · M5-11 · إغلاقٌ بقرارِ مالكِ البرنامجِ (`M5-11 OWNER-CLOSEOUT`) — فتحُ بوابةِ M5-12

**Work Item(s):** M5-11 · **Branch:** `chore/m5-11-owner-closeout` · **Scope:** `docs/16-progress/{LAUNCH_EXECUTION_BOARD,TASK_LOG,WORK_INDEX}.md` (سجلاتٌ مشتركةٌ مستثناةٌ من الحجزِ — M0-14)

**ماذا تم إنجاز (1):** نُقلَ عنصرُ `M5-11 Marketplace Foundation` من `In Progress` إلى `Completed` في [`LAUNCH_EXECUTION_BOARD.md`](LAUNCH_EXECUTION_BOARD.md) بقرارٍ صريحٍ من مالكِ البرنامجِ (`@uxxxu`) مُتَّخذٍ في هذه الجلسةِ (2026-09-08). ونُقلَتْ حالةُ `services/marketplace/` في [`WORK_INDEX.md`](WORK_INDEX.md) من `In Progress` إلى `Implemented`. وتُحدِّثُ ترويسةُ اللوحةِ «المرحلةُ الجاريةُ فعلًا» لتُشيرَ إلى `Phase 12 — Marketplace Search` (`M5-12`).

**لماذا تم اختياره (2):** القيدُ الحاكمُ في البروتوكولِ §9 يمنعُ الوكيلَ من نقلِ أيِّ عنصرٍ إلى `Completed` — فهو قرارُ مالكِ البرنامجِ. وكان آخرُ عاملٍ تركَ السجلَّ صراحةً على هذا القرارِ: «الخطوةُ التاليةُ: قرارُ مالكِ البرنامجِ في نقلِ `M5-11` إلى `Completed` — لا ينقلُه عاملٌ، ولا يُبدأُ `M5-12` لأنّ اعتمادَه `M5-11` ليس `Completed`». وعندما عُرضَ القرارُ على مالكِ البرنامجِ في هذه الجلسةِ، اختارَ «نعم، أُصرِّحُ بالإغلاقِ». فيُلغي هذا الإغلاقُ القيدَ الذي كان يحجبُ بدءَ `M5-12`.

**أين تم التغيير (3):** `docs/16-progress/LAUNCH_EXECUTION_BOARD.md` (صفُّ M5-11 + ترويسةُ «المرحلةُ الجاريةُ») · `docs/16-progress/WORK_INDEX.md` (صفُّ `services/marketplace/`) · `docs/16-progress/TASK_LOG.md` (هذا الإدخالُ).

**الملفات/الخدمات المتأثرة (4):** دفاترُ الحوكمةِ فقط — لا شيفرةَ ولا مخطَّطاتٍ ولا اعتمادياتٍ.

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيء.

**كيف تم الاختبار (6):** `bash scripts/checks/verify-governance.sh` على فرعِ الإغلاقِ — **رمزُ الخروجِ 0** · 11 فحصاً ناجحاً · 0 فاشلاً · تخطّيانِ مُعلَنانِ (8) CI مانعٌ جزئيٌّ (لقطةٌ مؤرَّخةٌ لا حيّة) · (9) تدقيقُ الاعتمادياتِ جزئيٌّ (لا `pnpm` ولا شبكةٌ في البيئة). والدليلُ المقيسُ سلفاً والمعتمَدُ في الإغلاقِ: 6/6 مراجعاتٍ مدموجةٌ في `main` ([MR !112](https://gitlab.com/uxxxu/wasla/-/merge_requests/112) · الدمجُ `0a21f29b` · 2026-08-29) وبوّابةُ الخروجِ خضراءُ محلّيّاً (6/6 ناجحةٌ · 0 فاشلٌ) في `packages/marketplace-e2e` وحزمةُ إثباتِ الحوكمةِ 141 ناجحاً · 0 فاشلاً.

**ما المشاكل التي ظهرت (7):** لا شيءَ جديدٌ. والإغلاقُ لا يُغلقُ المخاطرَ المفتوحةَ بقرارٍ: `RISK-0012` (شكلُ الصندوقِ الموحَّدِ عبرَ الأطوارِ — قرارٌ معماريٌّ) و`RISK-0013` (دعوى تطابقِ البايتاتِ في JSONB) و`RISK-0001` (حصّةُ CI) — كلُّها مُسجَّلةٌ بمالكٍ وتاريخِ مراجعةٍ، ولا تمنعُ الإغلاقَ لأنّ معيارَ القبولِ («phase exit gate») مُستوفىً بالدليلِ.

**ما الذي لم يكتمل (8):** لا خطَّ CI أخضرَ على `main` (`ci_quota_exceeded` · `RISK-0001`) فدليلُ البوّابةِ محلّيٌّ وفقَ البروتوكولِ §8.1 — يُقالُ ولا يُقالُ إنّه شُغِّل في الخطِّ. والمخاطرُ الثلاثةُ أعلاهُ تبقى مفتوحةً بقرارِ مالكِها.

**الخطوة التالية (9):** بدءُ `M5-12 Marketplace Search` في فرعٍ مستقلٍ `feat/m5-12-marketplace-search` — قراءةُ متطلباتِ search ADR وبوّابةِ relevance/load، ثمّ حجزُ نطاقٍ ضيّقٍ في `WORK_CLAIMS.md` باسمِ مسؤولٍ بشريٍّ، ثمّ بناءُ `services/search/` حسبَ العقودِ والمخطّط.

**ما الذي يعتمد عليه العمل التالي (10):** اعتمادُ `M5-12` على `M5-11` — صارَ مُستوفىً بهذا الإغلاقِ.

**Migration/Deployment/Config (11):** لا شيء.

**مخاطر/قرارات تحتاج مراجعة (12):** `RISK-0012` · `RISK-0013` · `RISK-0001` (تبقى مفتوحةً بقرارٍ لا يُغلقُها هذا الإغلاقُ).

**الروابط (13):** [MR !112](https://gitlab.com/uxxxu/wasla/-/merge_requests/112) (الدمجُ `0a21f29b`) · [PHASE11_EXIT_GATE_E2E.md](../12-testing/PHASE11_EXIT_GATE_E2E.md) · [WORK_INDEX.md](WORK_INDEX.md) · البروتوكول §8.1 و§9

**الشخص/الفريق الذي يتابع (14):** مالكُ البرنامجِ (`@uxxxu`) — صرّحَ بالإغلاقِ في هذه الجلسةِ. الوكيلُ: `@uxxxu (agent:perplexity-computer)` — نفّذَ التوثيقَ لا القرارَ.
## 2026-09-08 · M0-23 · إقفالُ دورةِ §8.1 — تحريرُ CLM-0110 بعدَ دمجِ PR #70 (ختامُ الموجةِ 3)

**Work Item(s):** M0-23 · **Branch:** `chore/m0-23-release-claim-clm-0110` · **Scope:** `docs/16-progress/`

**ماذا تم إنجاز (1):** حُرِّرَ حجزُ `CLM-0110` (marketplace) من «الحجوزات النشطة» ونُقلَ إلى «المحرَّرة» (§3) بدليلِ دمجِه في [PR #70](https://github.com/skyosv10-art/wasla/pull/70) (مُدمجٌ 2026-09-08T05:56:13Z · التزامُ الدمجِ [`36846ba`](https://github.com/skyosv10-art/wasla/commit/36846bab2ad0f373deb7768f97736b9e6de94528)). CI مقيسٌ: تشغيلُ الفرعِ [`34188952241`](https://github.com/skyosv10-art/wasla/actions/runs/34188952241) — 27 وظيفةً كلُّها `success` (governance-guard ✓ · verify ✓ · typecheck ✓ · test ✓ · 13 × db-integration ✓ منها `marketplace-db-integration` باختبارِ الدورةِ الكاملةِ 3/3 على PostgreSQL 15 · 9 × exit-gate-e2e ✓) · Devin Review ✓. وتشغيلُ الدمجِ على `main` ([`34192558384`](https://github.com/skyosv10-art/wasla/actions/runs/34192558384)) نجحَ كلُّه — فالفرعُ لم يُحذفْ بعدُ فلا حجزَ بائتاً هذه المرّةَ، وهذا الإقفالُ استباقيٌّ موفِّقٌ لدورةِ §8.1 لا علاجُ بياتٍ. بهذا **اكتملت الموجةُ 3 من `M0-23`: 12/12 خدمةً/حزمةً منتظِمةً في الترحيلاتِ المولَّدةِ العكوسةِ** (customers · identity · geography · orders · channel-postgres · dispatch · matching · drivers · negotiations · reputation · subscriptions · marketplace).

**لماذا (1):** قاعدةُ الحجوزاتِ (§8.1) تُوجبُ تحريرَ الحجزِ بعدَ دمجِ عملِه، بدليلِ CI مقيسٍ، قبلَ أيِّ حجزٍ جديدٍ على `M0-23` — وما يلي من بابِ `RISK-0020` يحتاجُ حجزاً جديداً نظيفاً على نطاقٍ معلَن.

**النتيجة/الأثر (1):** صار سجلُ الحجوزاتِ خالياً من النشطِ على `M0-23`، والحالةُ الكاملةُ للموجةِ 3 موثقةٌ في مكانِها، وبقي `M0-23` على `In Progress` لأنَّ المنطقةَ المعلنةَ الوحيدةَ الباقية في `RISK-0020` (إثباتُ الترقيةِ على قاعدةٍ ذاتِ بياناتٍ سابقةٍ) لم تُنجَزْ بعد.

**ماذا تم إنجاز (2):** لا شيءَ ثانياً — دفعةُ إقفالٍ نقيةٌ بلا مساسٍ بالشيفرة.

**لماذا (2):** عزلُ الحوكمةِ عن الشيفرةِ يُبقي إقفالَ الدورةِ قابلاً للمراجعةِ وحده.

**النتيجة/الأثر (2):** فرقُ الدفعةِ محصورٌ في `WORK_CLAIMS.md` و`TASK_LOG.md` حصراً.

**التوثيق:** لا تغييرَ فوقَ هذه الدفعة — البُنيةُ والقواعدُ قائمة.

**القرارات:** لا قرارَ فنّيّاً جديداً — تنفيذُ §8.1 كما هو.

**قِيَاس:** التشغيلُ [`34188952241`](https://github.com/skyosv10-art/wasla/actions/runs/34188952241) (فرع) 27/27 `success` + Devin Review، والتشغيلُ [`34192558384`](https://github.com/skyosv10-art/wasla/actions/runs/34192558384) (main) `success`.

**الأدلةُّ:** روابطُ CI والتزامُ الدمجِ في السطرِ المحرَّرِ أعلاه.

**المخاطرُّ:** لا مخاطرَ جديدةً — إقفالُ حوكمةٍ فقط.

**التبعيات:** لا تبعياتٍ واردةٍ؛ ما بعدَها: حجزٌ جديدٌ لبابِ `RISK-0020` (إثباتُ الترقيةِ على قاعدةٍ ذاتِ بياناتٍ سابقةٍ).

**الفروعُ/الدمج:** هذا الفرعُ نفسُه (`chore/m0-23-release-claim-clm-0110`) ثمَّ دمجُه في `main`.

**ملاحظاتُ المالك:** المالكُ أمرَ بدمجِ PR #70 وأقرَّ إقفالَ دورةِ CLM-0110 حصراً «وفقَ آلةِ حالِ المستودع» — مع النصِّ الصريحِ على إبقاءِ `RISK-0020` مفتوحاً حتى إثباتِ الترقيةِ المأمول.

**الفشلُ المُعلَنُ وكيفَ عولج:** لم يقعْ فشلٌ في هذه الدفعة؛ فشلُ بياتٍ سابقٌ عولجَ في PR #69.

**الحوكمةُ والتوثيقُ والقواعدُ والالتزامُ بها:** هذه الدفعةُ نفسُها التزامٌ حاكم (§8.1) — بلا حجزٍ نشطٍ جديدٍ لأنَّها إقفالُ حجزٍ قائمٍ نطاقُه `docs/16-progress/` الشاملُ للسجلاتِ المشتركة.

**إعداداتُ CI:** لا تغييرَ في CI — الوظائفُ الـ27 قائمةٌ كما هي.

**القواعدُ الناظمةُ للتوثيق:** [`WORK_CLAIM_RULE.md` §8.1](docs/00-rules/WORK_CLAIM_RULE.md) · [`ADR-024`](docs/15-decisions/ADR-024-generated-reversible-migrations.md).
