# CLM-0661 — تدقيقُ ما بعدَ CLM-0658: خطُّ الأساسِ، المخاطرُ ذاتُ الأولويّةِ، #730، ومسارُ البحثِ عبرَ Channel Edge

- **Claim:** `CLM-0661` · **Branch:** `stage-zero/clm-0661-post-0658-audit` · **التاريخ:** 2026-10-22
- **Kind:** docs-only + قياسٌ محلّيٌّ — لا تغييرَ شيفرةٍ إنتاجيّةٍ، لا نشرَ، لا كتابةَ إنتاجٍ، لا Telegram، لا T1/T2، لا تغييرَ حمايةٍ أو أسرارٍ.
- **ملاحظةُ حدودٍ:** هذا الدليلُ **قياسٌ لا قرارُ مالكٍ** — لا يُغلقُ خطرًا، ولا يرقّي عنصرًا، ولا يرفعُ حكمَ الإطلاقِ (**NO-GO**). M6-18B تبقى **Blocked**.

مفتاحُ الأدلّة: **[CI@SHA]** حكمُ GitHub Actions على بصمةٍ مُسمّاةٍ · **[API]** قراءةُ واجهةِ GitHub مباشرةً · **[محلّي]** قياسٌ في بيئةِ الوكيلِ (ليس CI ولا إنتاجًا) · **[قراءةُ شيفرة]** استنتاجٌ من نصِّ الشيفرةِ دونَ تنفيذٍ.

## 1. خطُّ الأساس (2026-10-22T09:12:39Z)

| البند | القيمة | النوع |
|---|---|---|
| `main` | `ac3af2a57e342c27cb4a15e740b6bea096f4ad2f` (دمجُ #807 · 08:54:54Z) · شجرةُ العملِ نظيفة | [API] |
| WASLA CI على `ac3af2a5` | [39751349909](https://github.com/skyosv10-art/wasla/actions/runs/39751349909) push · success · 41/41 مهمّة | [CI@ac3af2a5] |
| Roadmap freshness على `ac3af2a5` | [39751350080](https://github.com/skyosv10-art/wasla/actions/runs/39751350080) push · success | [CI@ac3af2a5] |
| check-runs على `ac3af2a5` | 42 = السياقاتُ الإلزاميّةُ الـ41 كلُّها success + `roadmap` (غيرُ إلزاميٍّ) | [API] |
| PRs المفتوحة | **#730 وحده** (رأسُ `c5480eb6`) | [API] |
| Issues المفتوحة | #797 (سجلُّ التسليم) · #736 (service-health) · #570 (db-backup · RISK-0055) — لا غيرَها | [API] |

### 1.1 حمايةُ `main` — الخامُ في [`raw/branch-protection-main.json`](raw/branch-protection-main.json)

`strict=true` · `enforce_admins=true` · `required_approving_review_count=0` · `dismiss_stale_reviews=false` · `require_code_owner_reviews=false` · `require_last_push_approval=false` · `allow_force_pushes=false` · `allow_deletions=false` · `required_linear_history=false` · `required_signatures=false` · `required_conversation_resolution=false` · **41 سياقًا إلزاميًّا** (`contexts` و`checks` كلاهما 41، بلا تكرار). `GET /rulesets` ← `[]` و`GET /rules/branches/main` ← `[]`: **لا Rulesets مؤثّرة**.

**تفسيرُ 44 مقابلَ 41 (مؤكَّد):** «44» خطأُ نسخٍ من الوكيلِ في `CLM-0658/raw/chain-verdicts.txt` وليس تغييرًا في الحماية. الدليلُ ([`raw/context-count-history.txt`](raw/context-count-history.txt)): كلُّ لقطةٍ خامٍ محفوظةٍ في المستودعِ منذ 2026-09-04 لا تتجاوزُ 41 (40 حتى 2026-09-28 ← 41 منذ 2026-10-14)؛ وقراءتانِ حيّتانِ في الجلسةِ (00:48:58Z و01:21:42Z) وقراءةُ هذا التدقيقِ أعادتْ القائمةَ نفسَها (41، مطابقةٌ حرفيًّا). كذلك «44/44 check-runs» لـ#804 و#806 في الملفِّ نفسِه لا يطابقانِ القياسَ: [`raw/required-41-per-merged-head.txt`](raw/required-41-per-merged-head.txt) يُظهرُ 43 لـ`5acfaa22` و45 لـ`9495d88b` (44 success + 1 skipped)، والفرقُ كلُّه سياقاتٌ غيرُ إلزاميّةٍ (`roadmap` · `cleanup` بعدَ الدمج · مهمّتا DR). **ما يثبتُ:** السياقاتُ الإلزاميّةُ الـ41 كلُّها success على رؤوسِ الدمجِ الثمانيةِ (#802 · #800 · #801 · #803 · #804 · #806 · #805 · #807).

مهمّتا DR على `9495d88b` (#806): `dr-replacement-restore.yml` يعملُ على `pull_request` حينَ يُلمسُ `packages/resilience/**` — `scenario2` (Postgres محلّيٌّ + وكيلُ أعطالٍ) success، و`replacement` (يستعملُ الأسرارَ ويكتبُ مشروعَ DR) **skipped** بالشرطِ `github.event_name != 'pull_request'`. لا وصولَ إنتاجيًّا.

### 1.2 انحرافٌ إجرائيٌّ في مسارِ الدمج (تصحيحٌ بالإضافة)

[ADR-071](../../../15-decisions/ADR-071-approval-not-required-for-merge.md) يجعلُ `scripts/ops/merge-on-approved-head.sh` **مسارَ الدمجِ الوحيدَ للوكيل**، ويعدُّ `gh pr merge` المباشرَ مخالفةً لقواعدِ التشغيل. **#804 و#806 و#805 و#807 دُمجتْ بـ`gh pr merge <n> --squash --delete-branch --match-head-commit <sha>` مباشرةً** (مقيسٌ من سجلِّ أوامرِ الجلسة)، و#802/#800/#801/#803 **غيرُ قابلةٍ للتحقُّقِ** من السجلّاتِ المتاحة. الشروطُ الجوهريّةُ التي يفرضُها السكربتُ تحقّقتْ يدويًّا في كلِّ دمجٍ مقيسٍ (رأسٌ مقروءٌ قبلَ الدمج · `--match-head-commit` بالبصمةِ الكاملة · لا `--admin` · لا CHANGES_REQUESTED · فحوصٌ ناجحة)، **لكنّ المسارَ المعتمدَ لم يُستعمل** — والتقريرُ السابقُ الذي سمّى ذلك «الآليّة الآمنة المعتمدة» كانَ غيرَ دقيق. من هذا الحجزِ فصاعدًا: الدمجُ عبرَ السكربتِ وحدَه.

## 2. المخاطرُ ذاتُ الأولويّة

الحالاتُ مقروءةٌ من §3 في [`RISK_REGISTER.md`](../../../07-security/RISK_REGISTER.md) على `ac3af2a5`.

| الخطر | الحالة · المراجعة | ما ثبت | ما لم يثبت | النوع |
|---|---|---|---|---|
| RISK-0027 | open · 2026-11-03 | نمطُ البابِ 7 (`RAW_PATTERN` في `validate-service-auth-coverage.sh`) يرى: النداءَ المباشرَ، `this.fetchImpl(`، الربطَ `= fetch`، `window.fetch`، `typeof fetch`؛ ويرى الملفَّ كلَّه إن ذُكرَ الاسمُ في سطرٍ منه (فالأسماءُ المتعدّدةُ داخلَ ملفٍّ واحدٍ تُرى عرَضًا). **يفوتُه:** `globalThis["fetch"]` · `Reflect.get(globalThis,"fetch")` · مفتاحٌ مركَّب · `const { fetch: f } = globalThis` · `export { fetch as t }` · المستهلكُ في ملفٍّ آخرَ · `node:https`/`http.request` ([`raw/guard-pattern-limits-*.txt`](raw/guard-pattern-limits-lines.txt)) | أيُّ تحليلٍ AST أو dataflow — **غيرُ موجود**؛ الحارسُ مطابقةُ نصٍّ لكلِّ ملفٍّ | [محلّي] على النمطِ لا على الحارسِ كاملًا |
| RISK-0070 | mitigating · 2026-11-03 | الإخفاقُ في [39640217300](https://github.com/skyosv10-art/wasla/actions/runs/39640217300) المحاولة 1 (job 119361455817 · `16e7f44e`) كانَ `relay-concurrent-dedupe` «two concurrent relay instances» `expected +0 to be 1` — **قبلَ** قفلِ CLM-0655 (#803 ← `2a1f7348`). على `ac3af2a5` نجحَ الملفُّ نفسُه (6 حالاتٍ) ضمنَ 87/87 في job 119732424452. القاتلُ الموثوقُ للطفراتِ M1/M2 هو **الحالةُ الحتميّةُ** (B يقرأُ أثناءَ قفلِ A)؛ المضخِّمُ (60 جولةً · 0/300 بالقفلِ مقابلَ 2/300 بدونه) **احتماليٌّ وإشارةُ انحدارٍ لا قاتلٌ** ([CLM-0655](../2026-10-21T090000Z-clm-0655-gs9-20-relay-consumer-lock/README.md)) | سببُ الإخفاقِ على `16e7f44e` — **يبقى غيرَ مفسَّر**: تطابقُ العَرَضِ مع سباقِ G-S9.20 استنتاجٌ لا تشخيص؛ والمضخِّمُ والطفراتُ قياسٌ محلّيٌّ على PostgreSQL 17 | [CI@16e7f44e] · [CI@ac3af2a5] · [محلّي] |
| RISK-0071 | open · 2026-11-03 | `escapeLike` + `ESCAPE` صريحٌ مدموجٌ في #804؛ حالاتُ PostgreSQL للمحارفِ `%`/`_`/`\` نجحتْ على `ac3af2a5` (job 119732424452 · `search-index-reader.integration` 17/17) | الإغلاقُ — **قرارُ مالكٍ** لم يُتَّخذ | [CI@ac3af2a5] |
| RISK-0050 | open · 2026-12-15 | Trivy على `ac3af2a5` (أرتفاكت 39751349909): **26** HIGH/CRITICAL (1 CRITICAL) كلُّها `stdlib v1.23.12` داخلَ `@esbuild/linux-x64@0.25.12/bin/esbuild`؛ تطابقُ الاستثناءاتِ الـ26 في `IMAGE_VULN_EXCEPTIONS.yaml` (لا زائدَ ولا ناقص) — [`raw/trivy-main-ac3af2a5-high-critical.tsv`](raw/trivy-main-ac3af2a5-high-critical.tsv) | **الثغرةُ لم تُزَل** — الثنائيُّ المتأثّرُ ما زالَ في الصورة؛ الاستثناءُ يخفّفُ الحاجزَ فقط حتى **2026-12-15** | [CI@ac3af2a5] |
| RISK-0052 | mitigating · 2026-11-05 | الوظائفُ الـ13 في `ci.yml` كلُّها بـ`timeout-minutes` (10–45) والبابُ 5 يفرضُها. قياسُ انتظارِ الطابورِ لمرّةٍ واحدةٍ (25 تشغيلًا · 1025 وظيفةً · 2026-10-21T10:56Z..2026-10-22T08:54Z): p50 14 ث · p90 74 ث · p99 153 ث · أقصى 178 ث ([`raw/ci-job-queue-summary.txt`](raw/ci-job-queue-summary.txt)) | **آليّةُ مراقبةِ الانتظارِ لم تُبنَ**: لا شيءَ في المستودعِ يُنذرُ أو يُخفقُ على زمنِ الطابور؛ والحارسُ نفسُه يقولُ إنّ المهلةَ «تقيسُ التنفيذَ بعدَ الالتقاطِ لا الانتظارَ قبله» | [API] |
| RISK-0055 | closed · قرارُ مالك ([ADR-066](../../../15-decisions/ADR-066-permanent-rpo-amendment.md)) | الإغلاقُ **قبولٌ إداريٌّ لـRPO المقيس**. آخرُ 40 نسخةً (2026-10-11..22) كلُّها success، والفجوةُ بينَ النسخِ وسيطُها 5.72 س وأقصاها **12.47 س** ([`raw/db-backup-last-40.txt`](raw/db-backup-last-40.txt)) — **هدفُ 6 س غيرُ مُحقَّقٍ** في هذه النافذة؛ آخرُ تمرينِ استعادةٍ 2026-10-19 success | **PITR غيرُ مُثبَت** · **RTO الإنتاجيُّ غيرُ مُثبَت** · استعادةُ auth/storage/vault غيرُ مُثبَتةٍ إنتاجيًّا — القبولُ لا يُثبتُ أيًّا منها | [API] |
| RISK-0031 · RISK-0062 | closed · قرارُ المالكِ «ترقية 4.1.12» (#806) | `vitest@4.1.12` و`@vitest/mocker@4.1.12` في القفل؛ CI 41/41 على main بعدَ الدمجِ وبعدَه | التكافؤُ السلوكيُّ للمشغّلِ أبعدَ ممّا تقيسُه الفحوص — غيرُ مُدَّعى | [CI@76a223a2] |
| RISK-0010 | mitigating · 2026-10-29 | `pnpm.overrides.vitest = "4.1.12"`؛ استثناءُ `override:vitest` ينتهي 2026-11-25 | نصُّ الاستثناءِ ما زالَ يبدأُ بـ«يرفع vitest إلى 3.2.7» ثم إضافةُ CLM-0660 — متقادمٌ صياغةً لا حكمًا | [قراءةُ ملف] |
| RISK-0028 | closed · 2026-09-30 | **تصحيح:** التقريرُ السابقُ وصفَه «mitigating» — خطأٌ في التقريرِ لا في السجلّ | — | [قراءةُ ملف] |
| RISK-0058 · 0066 · 0067 | mitigating · open · mitigating — **المراجعةُ 2026-10-22 (اليوم)** | محاكاةُ `RISK_TODAY=2026-10-23` تُسقطُ البابَ 2 بثلاثِ مشكلاتٍ ([`raw/risk-register-simulated-2026-10-23.txt`](raw/risk-register-simulated-2026-10-23.txt)) — **ابتداءً من 2026-10-23 UTC يفشلُ `governance-guard` و`verify` على كلِّ PR** حتى يُراجَعَ الخطرُ أو تُمدَّ المهلةُ **بقرارٍ مكتوبٍ من المالك** | — | [محلّي] |
| RISK-0068 · 0069 | open · 2026-10-26 | — | — | [قراءةُ ملف] |

## 3. #730 وINC-0007 — **HOLD**

[`raw/pr-730-status.txt`](raw/pr-730-status.txt): الرأسُ `c5480eb679b8b791c5de21646d5a059aef019ba2` · `mergeable=false` · `mergeable_state=dirty` · متقدّمٌ 15 ومتأخّرٌ **102** عن `ac3af2a5` · قاعدتُه `9d82ea2f` · 42/42 check-runs success **على 2026-10-17** (فلا تصلحُ دليلًا لدمجٍ على `ac3af2a5`) · ثلاثُ موافقاتٍ على `c5480eb6` (آخرُها 5610945166 · 2026-10-22T07:57:39Z). **الموافقةُ دليلُ مراجعةٍ لا تفويضَ مالكٍ لـINC-0007.**

- **أثرُ الدمجِ على النشر:** `render-deploy.yml` بـ`workflow_dispatch` وحدَه، فلا يبدأُ الدمجُ نشرًا بذاتِه؛ `deploy-target.json` على `mode=frozen` · `environment=test` · `owner_id=null` · `isolation_evidence=null`؛ #730 يلمسُ `ci.yml` و`scripts/ci/verify-sbom-attestations*.sh` و`validate-workflow-supply-chain.sh` (بوّابةُ CI لا نشر).
- **INC-0007** ([INCIDENTS.md](../../../07-security/INCIDENTS.md)) `Open`. بياناتُ الأسرارِ (أسماءٌ وتواريخُ فقط — [`raw/secret-metadata-names-timestamps.txt`](raw/secret-metadata-names-timestamps.txt)): `RENDER_API_KEY` آخرُ تحديثٍ 2026-10-08 وتوكناتُ البوتاتِ 2026-10-06 — **كلُّها قبلَ التعرّضِ (2026-10-15)**. هذا لا يُثبتُ عدمَ التدويرِ في Render نفسِه، لكنّه **لا يُثبتُ التدويرَ**؛ وإبطالُ المفتاحِ القديمِ غيرُ قابلٍ للتحقّقِ من هنا دونَ استعمالِه — وهو ممنوع.
- **الناقص قبلَ أيِّ دمج:** تأكيدُ المالكِ كتابةً (تدويرُ مفتاحِ Render · تحديثُ السرِّ في GitHub/Render · تحقّقٌ آمنٌ من صلاحيّةِ الجديد · إبطالُ القديم) ← إعادةُ تأسيسِ #730 على main وحلُّ التعارض ← CI على الرأسِ الجديد ← مراجعةٌ مستقلّةٌ على ذلك الرأسِ نفسِه ← `merge-on-approved-head.sh`.

## 4. G-S9.7 — التطبيقُ ← Channel Edge ← هويّةُ الخدمة ← search

**ما ثبتَ سابقًا ولا يتغيّر:** داخلَ خدمةِ search فقط (أحداثُ السوقِ ← الناقلُ ← الفهرسُ ← `GET /search/stores` بهويّةٍ حقيقيّةٍ على Postgres) — [CI@1e50fce] ([CLM-0649](../2026-10-20T150000Z-clm-0649-gs9-7-store-search/README.md)). `production_open=false` لـ`/search/stores`، ومدخلُ P مغلقٌ، وبرهانُ E-20 للمتاجرِ غيرُ موجود.

**اكتشافٌ جديدٌ (هذا الحجز):** مسارُ الحدِّ **لا يمكنُ أن يوصلَ طلبًا إلى search في حالتِه الحاليّة**، ولو فُتحَ المدخل. قياسٌ محلّيٌّ بـvitest على `packages/channel-edge` بلا شبكةٍ ولا أسرارٍ ([`raw/edge-probe.log`](raw/edge-probe.log) · [`raw/edge-probe.test.ts.txt`](raw/edge-probe.test.ts.txt)):

| # | العيب | الدليل | النوع |
|---|---|---|---|
| D1 | `loadAllowlist` يرشّحُ `entries` بـ`e.surface === "customer-mini-app"`، والملفُّ يضعُ `surface` في الجذرِ و**لا مدخلَ فيه يحملُ `surface`** (0/16) ← لا يُسجَّلُ أيُّ مسارِ توجيهٍ | P1: القائمةُ الحقيقيّةُ ← المساراتُ `/edge/session` و`/edge/session/logout` فقط و`GET /search/stores` ← 404 · P2: كلُّ المداخلِ `production_open=true` ← **404 أيضًا** | [محلّي] |
| D8 | `proxyRequest` يحذفُ `authorization` (ضمنَ `STRIPPED_INBOUND_HEADERS`) **قبلَ** قراءتِه ← كلُّ طلبٍ يُردُّ 401 `EDGE_UNAUTHENTICATED` | P3: مداخلُ بـ`surface` و`/search/stores` مفتوحٌ و`Authorization: Bearer` ← 401 · 0 نداءٍ خلفيٍّ · 0 توقيع | [محلّي] |
| D2 | الهدفُ `identityUrl + entry.path` لكلِّ خدمةٍ — `entry.service` لا يُستعمل | P4 (نسخةٌ معدّلةٌ للقياسِ فقط تقرأُ الترويسةَ قبلَ الحذفِ — [`raw/edge-probe-counterfactual-patch.diff`](raw/edge-probe-counterfactual-patch.diff)): `GET /search/stores?q=abc&page=2` ← `http://identity.probe/search/stores` | [محلّي · افتراضيّ] |
| D3 | سلسلةُ الاستعلامِ تُسقَط (`entry.path` لا `request.url`) — `q`/`page`/`page_size` لا تصلُ أبدًا | P4: الهدفُ بلا `?q=abc&page=2` | [محلّي · افتراضيّ] |
| D4 | المساراتُ ذاتُ المعاملاتِ (`/stores/{storeSlug}`) تُسجَّلُ وتُوجَّهُ بالقالبِ حرفيًّا | `app.route({ url: entry.path })` و`target = …/entry.path` | [قراءةُ شيفرة] |
| D5 | موقِّعُ الحدِّ في `bots/customer-bot/src/edge.ts` بـ`audience: "identity"` ثابتًا — لا هويّةَ خدمةٍ موجّهةً إلى search | `audience: "identity"` في السطرَين 55 و73 من `edge.ts` | [قراءةُ شيفرة] |
| D6 | `bots/customer-bot/src/main.ts` لا يركّبُ `edge.ts` (يصدّرُه `index.ts` فقط) — CLM-0630 قائمٌ | `rg edge bots/customer-bot/src/main.ts` ← لا شيء | [قراءةُ شيفرة] |
| D7 | خطّةُ T1 في `deploy-target.json` تضمُّ `wasla-customer-app · wasla-customer-bot · wasla-customers · wasla-geography · wasla-identity` — **لا `wasla-search`** ← حتى T1 معتمدٌ لا يقيسُ G-S9.7 | `jq .test_plan_items.T1.services` | [قراءةُ ملف] |

ولا اختبارَ في المستودعِ يمرُّ بمسارِ توجيهٍ ناجحٍ: `create-channel-edge.test.ts` يفحصُ التفعيلَ والقائمةَ الفارغة، و`app-edge-e2e` يفحصُ E-09 (404) وE-10 (401) بقائمةِ `file:///dev/null`. **الحكم:** G-S9.7 من طرفٍ إلى طرفٍ **غيرُ مُثبَتٍ ومحجوبٌ بعيوبٍ شيفريّةٍ** قبلَ أيِّ تفويضِ T1؛ إصلاحُها يمسُّ حدَّ الأمانِ (ADR-069) ويحتاجُ حجزًا مستقلًّا بقرارِ تصميمٍ (خريطةُ عناوينِ الخدماتِ · موقِّعٌ لكلِّ جمهور · تمريرُ الاستعلامِ والمعاملاتِ مقيَّدًا بالعقد) واختباراتٍ سلبيّةً وطفرات. لم يُشغَّلْ T1/T2 ولم يُتّصلْ ببيئةٍ إنتاجيّة.

## 5. #736 و#570

- **#736:** 19 تشغيلًا متتاليًا success منذ آخرِ إخفاقٍ (2026-10-17T04:34:20Z)؛ آخرُ تقريرٍ 39725122520 ← 14/14 ([`raw/service-health-last-60.txt`](raw/service-health-last-60.txt)). السببُ الجذريُّ للإخفاقاتِ الثلاثةِ **غيرُ مفسَّر**، والتعافي **مرصودٌ لا مفسَّر**. الإغلاقُ قرارُ مالك.
- **#570:** 40/40 نسخةً ناجحةً في النافذة؛ السببُ القديمُ `ENETUNREACH` (IPv6) موثَّقٌ في التعليقات. الإغلاقُ قرارُ مالكٍ ولا يُثبتُ PITR ولا RTO.

## 6. تصحيحاتٌ بالإضافةِ في هذا الحجز

1. سطرٌ مدموجٌ في [`LAUNCH_EXECUTION_BOARD.md`](../../../16-progress/LAUNCH_EXECUTION_BOARD.md): حلُّ تعارضِ إعادةِ التأسيسِ في #807 أسقطَ فاصلَ السطرِ فالتصقَ عنوانُ `### M1 — الهوية والأمن` بآخرِ صفِّ M0-53. يُعادُ السطرُ كما كانَ على `affdda63`؛ وحارسُ اللوحةِ لم يلتقطِ العيب.
2. «44» في CLM-0658 ← 41 (§1.1) — بإضافةٍ مؤرّخةٍ في دليلِ CLM-0658، لا بمحوِ نصِّه.
3. مسارُ الدمج (§1.2) — بإضافةٍ مؤرّخةٍ في دليلِ CLM-0658.

## 7. حدودُ هذا الدليل

- قياسُ النمطِ (RISK-0027) والمسبارُ (G-S9.7) **محلّيّانِ** — ليسا بوّابةَ CI ولا دليلَ إنتاج؛ P4 على نسخةٍ معدّلةٍ للقياسِ فقط، لا على الشيفرةِ المدموجة.
- قياسُ الطابورِ قراءةُ API لمرّةٍ واحدةٍ — لا مراقبةَ ولا حدَّ.
- لا يُغلقُ هذا الحجزُ خطرًا ولا يغيّرُ حالةَ عنصرٍ على اللوحة.
