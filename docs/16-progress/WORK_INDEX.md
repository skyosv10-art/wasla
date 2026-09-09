# فهرس ملكية العمل (Work Index)

**الحالة:** إلزامي · **آخر تحديث:** `2026-09-09` (مبني على فحص فعلي لشجرة المستودع)
**المرجع الحاكم:** [`LAUNCH_TO_100_ROADMAP.md`](LAUNCH_TO_100_ROADMAP.md) · [`README.md`](README.md)

> **الغرض:** جواب فوري لسؤال «هل هذا مبني أصلًا، ومن يملكه؟» قبل أن يفتح أحد عملًا مكررًا.
>
> **حد هذه الوثيقة:** تعكس ما هو **موجود في الشجرة**، لا ما هو **مُثبَت بالتشغيل**. إثبات التشغيل مسؤولية بوابات M0-08 و`docs/12-testing/`.
>
> **إلزامي:** يُحدَّث هذا الفهرس في نفس المراجعة التي تُنشئ منطقة كود جديدة أو تنقل حالتها.

## مفتاح الحالة

| الحالة | المعنى |
|---|---|
| `Implemented` | كود حقيقي موجود ومغطى ببوابة خروج موثقة |
| `In Progress` | يوجد حجز نشط أو عنصر لوحة جارٍ |
| `Placeholder` | المجلد موجود بـ `.gitkeep` فقط — **لا كود** |
| `Missing` | لا يوجد أصلًا |

---

## 1. الخدمات (`services/`)

| منطقة الكود | الحالة | العنصر المالك | المرحلة | ملاحظة |
|---|---|---|---|---|
| `services/identity/` | Implemented | M1-02 … M1-09 (دَين أمني) · M0-23 (موجة 2a) | Phase 01 | المصادقة على الحدود غير مكتملة (AUD-004). **M1-01 أُنجز:** النموذجُ في `packages/auth-sdk` و[ADR-018](../15-decisions/ADR-018-unified-principal-model-and-user-service-boundary.md) يُلزِم أن يكون إصدارُ هويّةِ المستخدمِ من هنا لا من خدمةٍ ثانية. **M0-23 (موجة 2a · [PR #50](https://github.com/skyosv10-art/wasla/pull/50)):** انتظمَ في الترحيلاتِ المولَّدةِ العكوسةِ (`drizzle/0000_*.sql` + `down.sql` + اختبارُ الدورةِ) |
| `services/geography/` | Implemented | M0-23 (موجة 2a) | Phase 02 | **M0-23 (موجة 2a · [PR #50](https://github.com/skyosv10-art/wasla/pull/50)):** انتظمَ في الترحيلاتِ المولَّدةِ العكوسةِ (`drizzle/0000_*.sql` + `down.sql` + اختبارُ الدورةِ) |
| `services/customers/` | Implemented | — | Phase 04 | |
| `services/drivers/` | Implemented | — | Phase 05 | |
| `services/orders/` | Implemented | M0-23 (موجة 2b-1) | Phase 06 | **M0-23 (موجة 2b-1 · [PR #52](https://github.com/skyosv10-art/wasla/pull/52)):** انتظمَ في الترحيلاتِ المولَّدةِ العكوسةِ بعدَ مصالحةٍ كاملةٍ لـ`schema.ts` مع العقدِ (إعادةُ تسميةِ القيودِ إلى أسماءِ PG الافتراضيّةِ + إلحاقُ القيودِ المفقودةِ + تحويلُ `uniqueIndex` إلى قيودِ `UNIQUE` + أسماءُ FK + FK النشطُ المتبادلُ) |
| `services/matching/` | Implemented | — | Phase 07 | |
| `services/dispatch/` | Implemented | — | Phase 07 | |
| `services/negotiations/` | Implemented | — | Phase 08 | |
| `services/reputation/` | Implemented | M0-08 (دليل تشغيل) | Phase 09 | |
| `services/subscriptions/` | Implemented | M0-23 (ترحيلات عكوسة) | Phase 10 | بوابة الخروج اجتازت · `__tests__/composition.test.ts` يحرس حقنَ الساعةِ والمُوَلِّدِ في `http/server.ts` · **انتظَمَت في الترحيلاتِ المولَّدةِ العكوسةِ (ADR-024 · الموجة 3 · CLM-0109):** مصالحةُ `schema.ts` مع العقدِ (41 قيدَ CHECK كنونيّاً + تسميةُ PK المركّبةِ + فهارسُ جزئيّةٌ + `bigint`) وترحيلٌ عكوسٌ + اختبارُ دورةٍ 4/4 (تكافؤُ سبعةِ أبعادِ كتالوجٍ · ترجعٌ نظيفٌ · إعادةُ تطبيقٍ) على PostgreSQL 18 |
| `services/marketplace/` | Implemented | M5-11 (مُغلقٌ 2026-09-08 بقرارِ مالكِ البرنامجِ) | Phase 11 | **6/6 مراجعات · بوّابةُ الخروجِ خضراءُ محلّيّاً 2026-08-29 (6/6 · 0 فاشلٌ) في `packages/marketplace-e2e` — والإغلاقُ قرارُ مالكٍ.** وما قبلَها — 5/6 مراجعات · الحدُّ HTTP قائمٌ (`docs/04-api/MARKETPLACE_HTTP.md`) · **الصادرُ وتزامنُ المخزون** قائمانِ 2026-08-28 (`src/db/outbox.ts` · `src/domain/events.ts` · [`docs/02-architecture/MARKETPLACE_EVENTS.md`](../02-architecture/MARKETPLACE_EVENTS.md)) — **ولا ناقلَ بعدُ** (دَينُ الطورِ 09). ومجموعةُ التكاملِ **شُغِّلت على PostgreSQL 17 في 2026-08-29: 118/118**، وأسقطَ التشغيلُ عيبَ ترتيبٍ أُصلح (`RISK-0012`) · **انتظَمَت في الترحيلاتِ المولَّدةِ العكوسةِ (ADR-024 · الموجة 3 · CLM-0110):** مصالحةُ `schema.ts` مع العقدِ (57 قيدَ CHECK كنونيّاً + فهارسٌ تعبيريةٌ وجزئيّةٌ + `DESC` + تسميةُ PK المركّبةِ) وترحيلٌ عكوسٌ بلا بذورٍ (شجرةُ التصنيفاتِ فارغةٌ بقرارٍ معلَنٍ) + اختبارُ دورةٍ 3/3 على PostgreSQL 18 — **ختامُ الموجةِ 3: 12/12** |
| `services/search/` | Implemented | M5-12 (مُغلقٌ 2026-09-09 بقرارِ مالكِ البرنامجِ) | Phase 12 | **[ADR-025](../15-decisions/ADR-025-marketplace-search-read-model.md):** البحثُ نموذجُ قراءةٍ مشتقٌّ من أحداثِ السوقِ لا قراءةٌ مباشرةٌ. **المراجعةُ 2/N (Relay Consumer):** ثلاثةُ منافذَ + نواةُ إسقاطٍ (`projector.ts`) + محرّكُ relay (`relay.ts`: تماثُلٌ · إعادةٌ · سمٌّ · نقطةُ تقدُّمٍ · إعادةُ بناءٍ) + خمسُ جداولِ حالةٍ + ثلاثُ محوّلاتِ PostgreSQL حقيقيّة. **43 اختبارَ وحدةٍ + 4 اختباراتِ تكاملٍ على PostgreSQL 17 حقيقيٍّ** تُثبتُ `outbox event → relay → search read model → correct resulting state`. الحالةُ تبقى `In Progress` (قرارُ مالكِ البرنامجِ §9). **أُنجزت طبقةُ HTTP (المراجعةُ 3/N):** تطبيقُ Fastify مُحقَنٌ بمنفذِ قراءةٍ (`SearchProductsReadPort`)، مسارا `GET /search/products` + `GET /search/health`، معالجُ أخطاءٍ واحدٌ (503 لا 500)، قارئُ pg `SearchIndexReader`، 19 اختبارًا جديدًا (وحدةٌ بمنفذٍ وهميٍّ + تكاملٌ يتخطّى بلا DB). **المراجعةُ 4/N (بوّابةُ relevance/load) مُنجزةٌ:** حزمةُ `@wasla/search-e2e` (20 اختباراً على PostgreSQL وسلكٍ حقيقيَّين، الفهرسُ ناتجُ الـrelay لا مبذورٌ باليد): 8 أحكامِ صلةٍ + سلّمُ رُتَبٍ · 5 أسبابِ حجبٍ · مخزونٌ يُخفي ويُعيدُ بلا حذفٍ · ترقيمٌ وفرزٌ · 7 رموزِ خطأٍ بـtrace_id · حملٌ مقيسٌ (2006 وثيقةً · متتابعٌ p95≈15ms · متزامنٌ p95≈390ms · 0 أخطاءٍ) · تهدُّمٌ ⇒ 503 مُسمّىً. **ووظيفتا CI مُنجزتانِ** (`db-integration (search…)` · `exit-gate-e2e (search…)`) وساقٌ ثالثةٌ في القاعدةِ المشتركةِ **13/13**. [`PHASE12_EXIT_GATE_E2E.md`](../12-testing/PHASE12_EXIT_GATE_E2E.md). **خطرانِ جديدانِ مقيسانِ:** [RISK-0029](../07-security/RISK_REGISTER.md) (سقفُ 500 يقطعُ العدَّ) · RISK-0030 (الصحّةُ ليست جاهزيّةً). **يبقى مؤجَّلاً:** رفعُ السقفِ · مسارُ جاهزيّةٍ. **المراجعةُ 5/N (2026-09-09 · [PR #81](https://github.com/skyosv10-art/wasla/pull/81)):** `total` صارَ عدَّ المطابقاتِ لا عدَّ الملتقَطِ (`count(*) OVER ()`)، والسقفُ صارَ **نافذةَ ترتيبٍ مُعلَنةً** (`DEFAULT_RANKING_WINDOW = 5000`) تَرُدُّ الصفحةَ الأعمقَ بـ`400 SEARCH_PAGE_OUT_OF_RANGE`، وأُضيفَ `GET /search/ready` بمنفذٍ ومحوّلٍ يسألانِ الفهرسَ فعلاً (`503 SEARCH_INDEX_DEGRADED`) بينما بقيَ `/search/health` نبضةَ حياةٍ — فأُغلقَ `RISK-0029` و`RISK-0030`. **إغلاقُ العنصرِ 2026-09-09 بقرارِ مالكِ البرنامجِ (§9)** على `main` عندَ `6ba362a` بتشغيلٍ أخضرَ 29/29. **وحدٌّ مفتوحٌ مُعلَنٌ:** `RISK-0032` — الجاهزيّةُ تقيسُ الوصولَ لا الحداثةَ. |
| `services/delivery/` | In Progress | M5-13 | Phase 13 | **المراجعةُ 1/N (`CLM-0120`):** عقودُ الخدمةِ (`schema.sql` بستّةِ جداولٍ · `api.openapi.yml` مُعرَّفاً · `events.json` باثني عشرَ حدثاً · `errors.md`) ونواةُ النطاقِ (model · state-machine بـ14+7+19 حافّةً تُطابِقُ [ADR-026](../15-decisions/ADR-026-store-orders-and-delivery-boundary.md) §3 حرفاً وتُحرسُ باختبارٍ · events · validation · errors) واختباراتُ الوحدةِ 24/24. القرارُ الحاكمُ: طلبُ المتجرِ مجموعةٌ مستقلّةٌ · الدفعُ مرآةٌ · التوصيلُ مرآةٌ خشنةٌ لـ`dispatch` · لا `delivered` بلا إثباتٍ. تُؤجَّلُ (مُعلَنٌ في ADR-026 §4): relay · HTTP · تكاملٌ وCI · بوّابةُ خروجٍ · ترحيلاتٌ مولّدةٌ. **المراجعةُ 2/N (`CLM-0121`):** مستهلكُ `dispatch.*` نواةً كاملةً (`consumed-events` · `dispatch-mirror` · `ports` · `relay`) — وحدةُ الخدمةِ 67/67 (43 جديداً) · والنتيجةُ غيرُ القابلةِ للإسقاطِ سمٌّ لا تخطٍّ ([ADR-026 §4.6](../15-decisions/ADR-026-store-orders-and-delivery-boundary.md)). |
| `services/partners/` | Placeholder | M5-14 | Phase 14 | |
| `services/rides/` | Placeholder | M5-15 | Phase 15 | |
| `services/referrals/` | Placeholder | M5-16 | Phase 16 | |
| `services/billing/` | Placeholder | M5-17 | Phase 17 | |
| `services/auth/` | Placeholder **بقرار** | — | — | **حُسم في [ADR-018](../15-decisions/ADR-018-unified-principal-model-and-user-service-boundary.md) (M1-01): لا خدمةَ `auth` مستقلّة.** الإصدارُ يتبع `identity` والفرضُ مكتبةُ `auth-sdk`. المجلَّدُ فارغٌ **بقرارٍ لا بإغفال** — لا يُملأ بلا ADR ناقض |
| `services/notifications/` | Placeholder | M3 | — | |
| `services/chat/` | Placeholder | M5 | Phase 08 | جزء من التفاوض حاليًا |
| `services/fraud/` | Placeholder | M6-19 | Phase 09 | |
| `services/compliance/` | Placeholder | M7 | Phase 20 | |
| `services/audit/` | Placeholder | M2 | Phase 18 | |
| `services/analytics/` | Placeholder | M8 | Phase 21+ | ما بعد الإطلاق |
| `services/support/` | Placeholder | M8 | Phase 21+ | ما بعد الإطلاق |
| `services/translation/` | Placeholder | M8 | Phase 21+ | ما بعد الإطلاق |

**الإجمالي المتحقق: 11 خدمة تحوي كودًا · 15 خدمة placeholder.**

---

## 2. الواجهات (`apps/`) — كلها Placeholder

| منطقة الكود | الحالة | العنصر المالك | ملاحظة |
|---|---|---|---|
| `apps/customer-mini-app/` | Placeholder | M3 | حاجز إطلاق |
| `apps/driver-mini-app/` | Placeholder | M3 | حاجز إطلاق |
| `apps/partner-mini-app/` | Placeholder | M3 | حاجز إطلاق |
| `apps/admin-web/` | Placeholder | M3 | حاجز إطلاق |

> **لا يوجد أي منتج قابل للاستخدام في هذا المستودع حتى الآن.** أي وثيقة تدّعي غير ذلك باطلة.

---

## 3. البنية التحتية (`infra/`) — كلها Placeholder

| منطقة الكود | الحالة | العنصر المالك |
|---|---|---|
| `infra/terraform/` | Placeholder | M2 |
| `infra/kubernetes/` | Placeholder | M2 |
| `infra/docker/` | Placeholder | M2 |
| `infra/environments/` | Placeholder | M2 |

---

## 4. القنوات (`bots/`)

| منطقة الكود | الحالة | ملاحظة |
|---|---|---|
| `bots/customer-bot/` | Implemented | Phase 03 |
| `bots/driver-bot/` | Implemented | Phase 03 |
| `bots/partner-bot/` | Implemented | جزئي — يتبع M5-14 |

---

## 5. الحزم المشتركة (`packages/`)

| المجموعة | الحزم | ملاحظة الملكية |
|---|---|---|
| نواة | `config` · `contracts` · `errors` · `events` · `telemetry` · `date-time` · `i18n` · `ui` | **مشتركة عالية الخطورة** — أي تعديل يحتاج حجزًا صريحًا للمسار الفرعي |
| قنوات | `channel-core` · `channel-postgres` · `telegram-adapter` · `bot-runtime` | M0-23 (موجة 2b-2) |
| أمن | `auth-sdk` | **Implemented (M1-01)** — نموذجُ `Principal` الموحَّدُ وقراءتُه وقراراتُ التفويضِ وتمثيلُه الآمن ([ADR-018](../15-decisions/ADR-018-unified-principal-model-and-user-service-boundary.md)). نقطةُ الفرضِ الوحيدةُ لكلِّ حدٍّ؛ M1-02..M1-05 تبني عليها ولا تُنشئ نموذجاً موازياً |
| اختبار | `test-utils` · `channel-e2e` · `customer-e2e` · `driver-e2e` · `order-e2e` · `dispatch-e2e` · `negotiation-e2e` · `reputation-e2e` · `subscription-e2e` · `search-e2e` | كل حزمة `*-e2e` مربوطة ببوابة خروج مرحلتها |

> **تحذير التكرار:** `packages/contracts/` أكثر مسار يتصادم عليه العمل. احجز المسار الفرعي المحدد (مثل `packages/contracts/src/marketplace/`) لا الحزمة كاملة.

---

## 6. الحوكمة والفحوصات

| منطقة الكود | الحالة | العنصر المالك |
|---|---|---|
| `docs/16-progress/` (نظام السجلات) | Implemented | M0-05 |
| `scripts/checks/` | Implemented | M0-05 |
| `scripts/hooks/pre-push` | Implemented | M0-05 |
| `.gitlab-ci.yml` — `governance-guard` | Implemented | M0-05, M0-04 |
| `scripts/checks/test-governance.sh` | Implemented | M0-12, M0-04 |
| `scripts/verify.sh` — الأمرُ الموحَّد | Implemented | M0-04 |
| `scripts/checks/validate-repo-structure.sh` | Implemented | M0-04 |
| `scripts/checks/validate-ci-mandatory.sh` | Implemented | M0-04 |
| `scripts/checks/validate-dependency-audit.sh` | Implemented | M0-06 |
| `scripts/checks/validate-risk-register.sh` | Implemented | M0-07 |
| `docs/07-security/RISK_REGISTER.md` | Implemented | M0-07 |
| `scripts/baseline.sh` + `scripts/checks/lib/baseline_canon.py` | Implemented | M0-08 |
| `scripts/checks/validate-baseline.sh` | Implemented | M0-08 |
| `docs/12-testing/BASELINE.json` + `BASELINE_FORMAT.md` | Implemented | M0-08 |
| `scripts/checks/lib/required-artifacts.sh` — مصدرٌ واحدٌ للإلزام | Implemented | M0-04 |
| `docs/00-rules/VERIFY_COMMAND.md` | Implemented | M0-04 |
| `.gitlab-ci.yml` — `verify` (أرتفاكت `when: always`) | Implemented | M0-04 |
| `scripts/checks/lib/check-shared-ledgers.py` | Implemented | M0-12 |
| `scripts/checks/require-doc-update.sh` | Implemented | M0-11, M0-12 |
| `scripts/checks/validate-work-claims.sh` | Implemented | M0-05, M0-12, M0-13 |
| `scripts/checks/validate-launch-board.sh` | Implemented | M0-05, M0-11 |
| `scripts/checks/lib/meaningful-paths.sh` | Implemented | M0-14, M0-15 |
| `scripts/checks/validate-claim-freshness.sh` | Implemented | M0-16 |
| `scripts/checks/validate-mr-target.sh` | Implemented | M0-17 |
| `scripts/checks/validate-integration-isolation.sh` | Implemented | M0-03 |
| `docs/00-rules/TESTING_RULES.md` §1 (عزلُ اختباراتِ التكامل) | Implemented | M0-03 |
| `services/identity/vitest.integration.config.ts` (تسلسلُ الملفّات) | Implemented | M0-03 |
| `docs/00-rules/GIT_RULES.md` §3.1 (هدفُ الطلب) | Implemented | M0-17 |
| `docs/00-rules/WORK_CLAIM_RULE.md` | Implemented | M0-05, M0-13 |
| `.gitlab-ci.yml` — بوابات E2E حتى Phase 10 | Implemented | M0-08 |
| `.gitlab-ci.yml` — `marketplace-db-integration` | Implemented | M5-11 |
| `packages/marketplace-e2e/` — بوّابةُ خروجِ الطورِ 11 (6/6 محلّيّاً · [تفصيل](../12-testing/PHASE11_EXIT_GATE_E2E.md)) | Implemented | M5-11 |
| `packages/search-e2e/` — بوّابةُ خروجِ الطورِ 12 (22/22 محلّيّاً · [تفصيل](../12-testing/PHASE12_EXIT_GATE_E2E.md)) | Implemented | M5-12 |
| `.gitlab-ci.yml` — `marketplace-exit-gate-e2e` (قاعدةٌ مستقلّةٌ `wasla_marketplace_e2e` · لم تركض على المُشغِّل: `RISK-0001`) | Implemented | M5-11 |
| CI: Load / Chaos / DR / DAST | Missing | M6 |
