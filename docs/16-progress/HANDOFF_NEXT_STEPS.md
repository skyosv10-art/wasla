# HANDOFF — تسليم حالة المشروع للجهة التالية

> **النوع:** وثيقة تسليم (Handoff) واضحة لكل من سيعمل في المستودع بعد الجلسة الحالية.
>
> **القاعدة الحاكمة:** كل عمل يُدفع إلى المستودع يجب توثيقه، ويجب أن يعرف من يأتي بعدي «ماذا تمّ وماذا بقي» بدقّة، حتى إكمال المشروع 100%.
>
> **Last Updated:** 2026-08-20 (Phase 03 بدأت — انظر §7) · **Related:** [MASTER_PROGRESS.md](MASTER_PROGRESS.md) · [ROADMAP.md](ROADMAP.md) · [TASK_LOG.md](TASK_LOG.md) · MR !1..!4/!9 مدمجة · [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) · [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) · [ADR-002](../15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md)
>
> **تحديث 2026-08-20 (c):** **Phase 00 = Completed (W0)**. تحقّق المالك من namespace → تفعّل shared runners. ظهر فشل في job `build-test` (typecheck) بسبب استخدام `node:fs`/`node:path`/`__dirname` دون `@types/node` مُعلَن — صُلح عبر [MR !9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9) (إضافة `@types/node`) الذي اجتاز CI بالكامل ودُمج. pipeline على `main` نجاح كامل (build-test + markdown-lint + repo-structure ✅). **Phase 00 Exit Gate اجتاز.**
>
> **تحديث 2026-08-20 (b):** [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) يُحدّد مكدّس تنفيذ خدمة Identity (Node 20 + TS + Fastify + PostgreSQL + Drizzle). كان على فرع MR !8 غير المدمج — يُضاف إلى `main` عبر MR تنظيف الحوكمة (انظر §4).

---

## 1. أين نقف الآن (Snapshot)

```text
المرحلة الحالية: Phase 03 — Telegram Channel Foundation (قيد التنفيذ — انطلقت 2026-08-20)
المكتمل:         Phase 00 ✅ · Phase 01 ✅ · Phase 02 ✅ — كل بوابات الخروج مُتحقّقة آلياً في CI
                 (job db-integration لـidentity · job geography-db-integration لـgeography + E2E يجمعهما).
المتبقّي:         Phase 03 → Phase 24 (انظر §3 للمسار الكامل و§7 لخطة المرحلة 03 بالتفصيل).
الاختبارات:       130 اختبار وحدة (96 + 34 لعقود القناة) + 4 تكامل + 5 E2E في CI.
آخر تحديث:      2026-08-20 (بعد دمج MR !22 وإغلاق Phase 02، وبدء Phase 03 بـADR-007 + عقود القناة)
ملاحظة:         ما تحت هذا القسم من تفاصيل MR !1..!9 مرجع تاريخي لـPhase 00.
```

**ما تم دمجه إلى main:**
- [MR !1](https://gitlab.com/uxxxu/wasla/-/merge_requests/1) (commit `cba9a75`) — إصلاح فحص الأسرار في CI + أساس Phase 00.
- [MR !2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2) (commit `a15985d`) — عقود Identity بمنهج Contract First (API/Event/Data/Error).
- [MR !3](https://gitlab.com/uxxxu/wasla/-/merge_requests/3) (commit `0576365`) — تحديث خارطة الطريق بعد الدمج.
- [MR !4](https://gitlab.com/uxxxu/wasla/-/merge_requests/4) (commit `052d3ff`) — أساس البناء (pnpm 9 + tsconfig strict + Vitest + حزمة `@wasla/errors`).
- [MR !9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9) (commit `3cb0d03`) — إصلاح job `build-test` (إضافة `@types/node`) — يجتاز CI بالكامل.

**أساس البناء (مدمج عبر MR !4 + إصلاح MR !9):**
- pnpm 9 workspaces + tsconfig strict + Vitest + حزمة `@wasla/errors` (3 اختبارات) + حزمة `@wasla/contracts-identity` (13 اختباراً).
- job `build-test` في CI (typecheck + test) — **تعمل وتجتاز** على shared runners (الآن مُفعّلة).
- توثيق الاختيار في [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) + تعليمات الإعداد في [CONTRIBUTING.md](../../CONTRIBUTING.md).

العمل المنجز (كلّه موثّق في [TASK_LOG](TASK_LOG.md)):

| # | العنصر | الحالة |
|---|---|---|
| 1 | بنية المستودع + القوانين الأساسية | ✅ مدمج (MR !1) |
| 2 | قالب MR + حماية main + فحص أسرار | ✅ مدمج (MR !1) |
| 3 | doc-coverage (CI) | ✅ مدمج (MR !1) |
| 4 | عقود Identity (Contract First) | ✅ مدمج (MR !2) |
| 5 | تحديث خارطة الطريق بعد الدمج | ✅ مدمج (MR !3) |
| 6 | أساس البناء (pnpm+TS+Vitest) + @wasla/errors | ✅ مدمج (MR !4) |
| 7 | أنواع TS مولّدة من OpenAPI + @wasla/contracts-identity | ✅ مدمج (MR !6) |
| 8 | توفيق وثائق التقدم بعد MR !4 + Runbook فكّ عائق CI | ✅ مدمج (MR !5) |
| 9 | أنواع أحداث Identity مشتقّة من events.json + اختبار حماية انحراف | ✅ مدمج (MR !7) |
| 10 | اختيار مكدّس تنفيذ Identity (ADR-005) | ✅ يُضاف إلى main عبر MR تنظيف الحوكمة (§4) |
| 11 | إصلاح job `build-test` CI (إضافة `@types/node`) | ✅ مدمج (MR !9) — CI green على main |

---

## 2. عائق CI — تمّ الحل ✅

**الحالة السابقة:** shared runners غير متاحة للـ namespace المجاني غير المُتحقَّق منه؛ pipelines تفشل فوراً (0 jobs).

**الحل (تمّ):** تحقّق المالك من namespace (2026-08-20) → تفعّل shared runners. ظهر فشل حقيقي في job `build-test` (typecheck: `Cannot find module 'node:fs'` / `node:path` / `__dirname`) لأن `events.test.ts` يستعمل واجهات Node.js دون `@types/node` مُعلَن (كان يُحلّ محلياً صدفةً عبر `@types/node` عام خارج المستودع). **صُلح عبر [MR !9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9)** (إضافة `@types/node@^20.0.0` + إعادة توليد الـlockfile)، مُتحقَّق محلياً بتثبيت مُجمّد نظيف مُطابق لـCI. pipeline على `main` يجتاز بالكامل (build-test + markdown-lint + repo-structure ✅).

> Runbook فكّ عائق CI لا يزال صالحاً كمرجع: [CI_RUNNER_UNBLOCK.md](../14-runbooks/CI_RUNNER_UNBLOCK.md).

---

## 3. المسار الكامل إلى 100% (حسب [ROADMAP.md](ROADMAP.md))

```text
Phase 00 Repository Foundation ............ ✅ Completed (W0: 2026-08-20) — CI green على main
Phase 01 Identity Foundation .............. ✅ Completed (2026-08-20) — Exit Gate E2E في CI
Phase 02 Geography & Localization ......... ✅ Completed (2026-08-20) — Exit Gate E2E في CI
Phase 03 Telegram Channel Foundation ...... ⏳ قيد التنفيذ (انطلقت بـADR-007 + عقود القناة — انظر §7)
Phase 04 Customer Core ................... إنشاء Order صالح
Phase 05 Driver Core ...................... Driver profile → Candidate pool
Phase 06 Order Engine ..................... State machine + Outbox + Audit
Phase 07 Dispatch & Matching MVP .......... Customer → Driver assignment
Phase 08 Negotiation & Chat ............... تفاوض + توافق سعر
Phase 09 Reputation + Fraud Foundation ..... Reputation events لكل Completed Order
Phase 10 Driver Subscription & Referral ... Trial → Active → Expired → Community
Phase 11 Marketplace Foundation ........... Store + Catalog + Moderation
Phase 12 Marketplace Search ............... بحث متعدد اللغات
Phase 13 Store Orders + Delivery .......... شراء → تجهيز → إسناد → توصيل
Phase 14 Partner / Enterprise ............. Partner portal/API + Fleet + SLA
Phase 15 Admin Operations ................. تشغيل يومي دون SQL يدوي
Phase 16 Support & Escalation ............. نزاع → Resolution → Reputation
Phase 17 Billing & Store Fees ............. Billing قابل للتدقيق منفصل
Phase 18 Observability & Resilience ....... OpenTelemetry + Circuit breakers + DR
Phase 19 Security Hardening ............... لا ثغرات حرجة + أسرار خارج Git
Phase 20 Saudi Launch Readiness ........... E2E + Load + DR + Runbooks
   ★ MILESTONE: SAUDI LAUNCH (~W30)
Phase 21 Gulf/Egypt/Jordan Expansion ...... Configuration لكل دولة
Phase 22 Global Expansion ................. Country Packs + adapters
Phase 23 Channel Independence ............ Core عبر Telegram/Web/Mobile
Phase 24 Service Extraction .............. فصل Microservices + ADR
```

> **المسار الحرج (Critical Path):** `00 → 01 → 02 → 04 → 06 → 07 → 09 → 20 (Launch)`.
> **قاعدة الانتقال:** لا تبدأ مرحلة قبل اجتياز Exit Gate للمرحلة السابقة (أي تعديل للترتيب يتطلب ADR في `docs/15-decisions/`).

---

## 4. Checklist Phase 01 (مكتملة بالكامل) — للمرجع التاريخي

> جميع بنود القائمة أدناه (MR !11–!15) **مُدمجة، CI أخضر**. Phase 01 Exit Gate اجتاز. القائمة محفوظة للمرجع. **العمل الحالي: Phase 02 (Geography & Localization) — انظر القسم 6.**

```text
[0] ✅ MR تنظيف الحوكمة: أُضيف ADR-005 إلى main + توفيق HANDOFF/التقدم + إغلاق MR !8 (مُلغى) → [MR !10](https://gitlab.com/uxxxu/wasla/-/merge_requests/10) مدمج، CI green
[1] ✅ MR 1 — Identity scaffold + pure core: حزمة `@wasla/identity-service` (domain/ports/in-memory/use-cases) + Wasla Public ID (`WS-[0-9]{10}`) + 15 اختباراً للـExit Gate (إنشاء، idempotent، استقرار الهوية عبر تغيير Username، outbox) → [MR !11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11) (مُدمج، CI أخضر)
[2] ✅ MR 2 — Drizzle/Postgres persistence: Drizzle schema مطابق لـschema.sql (5 جداول) + `PostgresIdentityRepository`/`PostgresOutbox`/`PostgresPublicIdSequence` + `createDb`/`ensurePublicIdSequence` + `drizzle.config.ts` + إعدادات vitest (التكامل مستثنى) + اختبار تكامل مُسيّج عبر `DATABASE_URL` → [MR !12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12) (مُدمج، CI أخضر)
[3] ✅ MR 3 — Fastify HTTP layer: `createIdentityApp` (5 مسارات: resolve/getUser/addLink/recovery/history + `/health`) + `sendIdentityError` (تعيين إلى `{code, message, trace_id}` + HTTP status وفق `errors.md`) + `server.ts` (composition root: Postgres إن وُجد `DATABASE_URL` وإلا في الذاكرة) + 9 اختبارات `app.inject` + smoke test ناجح → [MR !13](https://gitlab.com/uxxxu/wasla/-/merge_requests/13) (مُدمج، CI أخضر)
[4] ✅ MR 4 — CI DB integration: job `db-integration` في `.gitlab-ci.yml` بخدمة `postgres:15` (GitLab service) + `DATABASE_URL` ينفّذ `pnpm --filter @wasla/identity-service test:integration` في كل MR و على main؛ تصحيح مسار `schema.sql` (`process.cwd()`). مُتحقَّق محلياً (3 اختبارات تكامل + E2E HTTP→Postgres) → [MR !14](https://gitlab.com/uxxxu/wasla/-/merge_requests/14) (مُدمج، CI أخضر)
[5] ✅ MR 5 — Phase 01 Exit Gate E2E: اختبار E2E رسمي (`exit-gate.e2e.test.ts`) يُشغّل كامل التدفّق HTTP→use cases→Drizzle/Postgres عبر `app.inject` ضد Postgres حقيقي: إنشاء (201) + idempotent (200، نفس Public ID/internal_uuid) + تغيير Username (200، هوية مستقرة) + history (`[v1,v2]`) + outbox (`identity.created`/`identity.link.added`/`identity.telegram_username.changed`) + رفض ربط متضارب (409). مُتحقَّق محلياً (5 اختبارات: 2 E2E + 3 تكامل) و في CI عبر job `db-integration` → [MR !15](https://gitlab.com/uxxxu/wasla/-/merge_requests/15) (مُدمج، CI أخضر)
```

## Phase 01 — مُسلّمة

✅ **Phase 01 (Identity Foundation) = Completed.** الـExit Gate اجتاز: مستخدم Telegram يُنشأ، تتغيّر Username، تبقى الهوية/Public ID/internal_uuid مستقرة، ويسجّل التاريخ/outbox — مُتحقَّق بـاختبار E2E في CI ضد Postgres حقيقي.

**النطاق المُسلّم:**
- عقود + أنواع (`@wasla/contracts-identity`، 13 اختباراً) — [MR !2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2)
- [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) (اختيار المكدّ)
- نواة مجردة: Domain + Ports + In-memory + Use cases + Wasla Public ID + outbox (15 اختباراً) — [MR !11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11)
- طبقة Postgres: Drizzle schema مطابق لـschema.sql + Repository/Outbox/Sequence + createDb + drizzle.config + 3 اختبارات تكامل مُسيّجة عبر DATABASE_URL — [MR !12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12)
- طبقة Fastify HTTP: 5 مسارات + `/health` + تعيين أخطاء + composition root (Postgres إن وُجد DATABASE_URL وإلا في الذاكرة) + 9 اختبارات `app.inject` — [MR !13](https://gitlab.com/uxxxu/wasla/-/merge_requests/13)
- تكامل CI/DB: job `db-integration` بخدمة `postgres:15` يُشغّل اختبارات التكامل في كل MR وعلى main — [MR !14](https://gitlab.com/uxxxu/wasla/-/merge_requests/14)
- Exit Gate E2E: سيناريو متكامل (إنشاء→idempotent→تغيير Username→ثبات الهوية) عبر كامل المكدّ ضد Postgres + تأكيدات outbox/history + رفض التعارض (409) — [MR !15](https://gitlab.com/uxxxu/wasla/-/merge_requests/15)

**مجموع الاختبارات:** 24 وحدة + 3 تكامل + 2 E2E = 29 اختباراً (الـE2E/التكامل مُشغّلة في CI ضد Postgres حقيقي).

**ملاحظات للتسليم:**
- خدمة Identity تعمل في وضعين: Postgres (إنتاج) عبر `DATABASE_URL`، أو في الذاكرة (تطوير/اختبار).
- سيناريو الـExit Gate (ثبات الهوية عبر تغيير Username) مُتحقَّق آلياً في CI.
- Testcontainers مؤجّل تماماً (خدمة postgres في CI كافية وأبسط).
- الخطوة التالية: بدء Phase 02 (Geography & Localization Foundation) — Country/Region/City/District/Zone + i18n (AR/EN/UR).

> **ملاحظات تنفيذية:**
> - **Testcontainers:** لا تبدأ بها في MR 1. بيئة التنفيذ الحالية بلا Docker، وCI هو `node:20-alpine` بسيط. ابدأ بـ in-memory repository seam + اختبارات وحدة/contract. أضِف Postgres فعلي لاحقاً عبر GitLab service (الأبسط) أو Testcontainers بعد التحقق من دعم runner. إذا تمّ الاستغناء عن Testcontainers نهائياً رغم ADR-005، وثّق ذلك كتعديل ADR.
> - **الاعتماديات:** أضِف فقط ما يُستعمل في كل MR. كل حزمة جديدة يجب أن تمرّ typecheck + test فوراً. لا تعتمد على typings عامة/شاملة مرة أخرى — إذا استعمل كود واجهات Node، أعلِن `@types/node` في تلك الحزمة. أبقِ اختبارات DB خارج `pnpm -r test` الافتراضي حتى يدعم CI قاعدة بيانات.
> - **Wasla Public ID (مُحدّث):** تمّ التنفيذ والاعتماد — النمط `^WS-[0-9]{10}$` (`WS-` + 10 أرقام صفرية مُولّدة من تسلسل Postgres `wasla_public_id_seq`)، الفرادة عبر قيد DB `unique`، وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) و`schema.sql`. لا تُغيّر النمط دون ADR.

---

## 5. ملاحظات سياسية وأمنية

- **حماية main:** محمية (Maintainers فقط، لا force push)، لكن تسمح لـMaintainers بالدفع المباشر لـ`main`. يُنصح بتشديد `push_access_levels` إلى «No one» لمواءمتها مع قاعدة \"لا Push مباشر\" في [GIT_RULES.md](../00-rules/GIT_RULES.md).
- **رمز الوصول (glpat):** استُخدم للاستنساخ والدفع وفتح/دمج MRs. **يجب إبطاله/تدويره** من [Personal Access Tokens](https://gitlab.com/-/user_settings/personal_access_tokens) لأنه ظهر في المحادثة.
- **قاعدة التوثيق مع الدفع:** كل دفع يمس `apps/bots/services/packages/infra/scripts/` يجب أن يرافقه تحديث في `docs/` (إلزام خادمي عبر CI job `doc-coverage`). الحد الأدنى: إدخال في `docs/16-progress/TASK_LOG.md`.

---

## 6. Phase 02 (Geography & Localization) — مكتملة ✅

> **Exit Gate:** المستخدم يغيّر موقعه دون إنشاء حساب جديد، وكل Module يستعمل Geo IDs + i18n (AR/EN/UR).
> **التسلسل الهرمي:** Country/Region/City/District/Zone + أسماء مترجمة (جداول ترجمة منفصلة، لا JSONB).
> **الفرق:** 01,02,03,06,07,08,09. **يعتمد على:** 00 + (01 جزئياً).

**خطة الـMRs (7) — وفق توصية المستشار:**

```text
[1] docs(progress): reconcile roadmap after Phase 01   ← هذا الـMR (توثيقي)
[2] contracts(geography): Phase 02 contracts + ADR-006   ← ✅ Done [MR !17]
    - packages/contracts/geography: schema.sql + events.json + api.openapi.yml + errors.md
    - جداول: geo_countries/regions/cities/districts/zones + *_names (ترجمة) + geo_user_locations
      (keyed by wasla_public_id كمرجع opaque، CHECK ^WS-[0-9]{10}$، بدون FK إلى identity) +
      geo_user_location_history + geo_outbox
    - OpenAPI: /geo/countries, /geo/.../regions|cities|districts|zones, /geo/users/{id}/location (GET/PUT) + history
    - events: geo.user_location.set.v1, geo.user_location.changed.v1
    - ADR-006-geography-localization-stack-and-model.md
[3] feat(geography): pure core (domain + ports + in-memory + use-cases + locale fallback)   ← ✅ Done [MR !18]
[4] feat(geography): Drizzle/Postgres persistence + Saudi seed loader   ← ✅ Done [MR !19]
    - contracts/seeds/saudi-arabia.sql (بلد SA + Madinah + 2 districts + 2 zones + أسماء ar/en/ur، idempotent ON CONFLICT DO NOTHING)
    - src/infrastructure/drizzle/{schema,db,repository}.ts (13 جدول Drizzle + PostgresGeographyRepository + PostgresOutbox)
    - 4 اختبارات تكامل Postgres (seed+hierarchy/localized/fallback/set+change+idempotent+outbox)
[5] feat(geography): Fastify HTTP layer + error mapping + app.inject tests   ← ✅ Done [MR !20]
    - src/http/{app,errors,server}.ts + src/infrastructure/http-identity-lookup.ts
    - 9 مسارات العقد + /health؛ PUT = 201 لأول تعيين ، 200 للتغيير/idempotent
    - كود خطأ جديد (إضافة فقط): GEO_INVALID_REQUEST_BODY (400)
    - 16 اختبار app.inject (إجمالي geography = 41)؛ توثيق: docs/04-api/GEOGRAPHY_HTTP.md
    - منافذ: identity 8080 ، geography 8081؛ IDENTITY_SERVICE_URL يُفعّل HttpIdentityLookupPort
[6] ci(geography): DB integration (geography-db-integration job)   ← ✅ Done [MR !21]
    - .gitlab-ci.yml: قاعدة مشتركة .db-integration-base + وظيفة geography-db-integration
    - قاعدة بيانات مستقلّة wasla_geo_test (postgres:15) لعزل الفشل عن identity
    - التوثيق: docs/12-testing/DB_INTEGRATION_CI.md
[7] test(geography): Phase 02 Exit Gate E2E + close Phase 02   ← ✅ Done [MR !22] — Phase 02 مُغلقة
    - services/geography/src/__tests__/phase02-exit-gate.e2e.test.ts (3 اختبارات)
    - تُشغّل الخدمتين كما في الإنتاج: identity يستمع على منفذ حقيقي (port 0) و
      geography يسأله عبر HttpIdentityLookupPort عبر HTTP فعلي (لا fake)
    - تطبّق schema(identity) + schema(geography) + Saudi seed في قاعدة اختبار واحدة
    - تعيين موقع (201) → تغييره (200) → ثبات wasla_public_id/internal_uuid و created:false
      + تغيير username لا يمسّ الموقع + history (old/new zone) + outbox (set ثم changed)
    - i18n: ar افتراضي، en، ur، والرجوع إلى ar لصف بلا ترجمة + Geo IDs في كل مستوى
    - 404 GEO_IDENTITY_NOT_FOUND لهوية غير موجودة (الهوية الحقيقية أجابت 404)
    - fileParallelism: false في vitest.integration.config.ts (ملفّان يملكان مخطط نفس القاعدة)
    - @wasla/identity-service في devDependencies للجغرافيا — لأجل هذا الاختبار وحده
    - التوثيق: docs/12-testing/PHASE02_EXIT_GATE_E2E.md
```

**حالة Phase 02: مكتملة (2026-08-20).** بوابة الخروج مُتحقَّقة آلياً في CI عبر وظيفة
`geography-db-integration` (4 اختبارات تكامل + 3 اختبارات E2E). الخطوة التالية: **Phase 03 —
Telegram Channel Foundation** (Exit Gate: كل Bot يفتح Mini App، وAdapter قابل للاستبدال بـMock؛
يعتمد على 12,01,02,03,07 — انظر [ROADMAP.md](ROADMAP.md) و[MASTER_PROGRESS.md](MASTER_PROGRESS.md)).
تبدأ Phase 03 بـADR لمكدّس قناة تلغرام + عقود القناة قبل أي كود، تماماً كما بدأت 01 و02.

**ملاحظات معمارية:**
- Geography تملك `geo_user_locations` وتخزّن `wasla_public_id` كمرجع opaque — **لا FK إلى identity_users**.
- `IdentityLookupPort` للتحقق من وجود الهوية دون معرفة internals الخاصة بـidentity (إنتاج: HTTP إلى identity؛ اختبار: fake/in-process).
- i18n داخل geography لهذه المرحلة (لا حزمة i18n مستقلة بعد) — جداول ترجمة منفصلة لكل مستوى.
- Testcontainers مؤجّل (خدمة postgres في CI كافية).

---

## 7. Phase 03 (Telegram Channel Foundation) — قيد التنفيذ ⏳

**بوابة الخروج (Exit Gate) الملزمة:** «كل Bot يفتح Mini App المناسبة، ويمكن استبدال Telegram adapter في الاختبارات بـMock Adapter».

**القرار المعماري الحاكم:** [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) — القناة **طبقة توصيل لا خدمة**: `packages/channel-core` (محايد، صفر معرفة بـTelegram) + `packages/telegram-adapter` (المكان الوحيد الذي يعرف Bot API) + `bots/*` جذور تركيب رقيقة. اتجاه الاعتماد: `bots/*` → `telegram-adapter` → `channel-core`.

### خطة المراجعات (MRs) — ملزمة ومرتّبة

```text
[1] docs+contracts(channel): ADR-007 + عقود القناة + @wasla/contracts-channel   ← ✅ Done [MR !23]
    - docs/15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md
    - packages/channel-core/contracts/: api.openapi.yml + events.json + schema.sql + errors.md + README.md
    - OpenAPI: POST /channel/{bot}/webhook (مدخل وحيد + secret token) · POST /channel/messages
      (مخرج وحيد) · GET /channel/{bot}/mini-app · POST /channel/{bot}/deep-links · GET /health
    - events: channel.update.received.v1 · channel.message.delivered.v1 ·
      channel.message.failed.v1 · channel.mini_app.launched.v1 (producer: channel-adapter)
    - schema.sql: channel_updates (فريد channel+bot+channel_update_id) + channel_deliveries
      (فريد channel+idempotency_key + محاولات/backoff) + channel_outbox — لا FK إلى identity
    - errors.md: 14 كود CHANNEL_* + خطة إعادة المحاولة (5 محاولات، تباطؤ أسّي مع jitter)
    - packages/contracts/channel: 34 اختباراً (أنواع مُولّدة + حراسة انحراف للأحداث
      ولكتالوج الأخطاء + حراسة حدود ADR-007 على ملف OpenAPI)
    - docs/02-architecture/CONTAINERS.md §5.1 (موقع طبقة القنوات)
[2] feat(channel-core): نموذج المجال + المنافذ + حالات الاستخدام + مُهيّئات in-memory/Mock   ← التالي
    - ChannelPort · UpdateParserPort · ProcessedUpdateStorePort · DeliveryStorePort · OutboxPort ·
      IdentityBootstrapPort · MiniAppRegistryPort · ClockPort · RetryPolicy
    - حالات الاستخدام: intake+dedup · deliver+retry · launchMiniApp · encode/decodeDeepLink
    - اختبار حراسة: لا استيرادات/نصوص Telegram داخل channel-core
[3] feat(telegram-adapter): تفسير Update + إرسال + أزرار web_app + تخطيط الأخطاء + حدود المعدّل
[4] feat(bots): ثلاثة جذور تركيب Fastify + /start + Identity bootstrap + أزرار Mini App + Deep Links
[5] feat(channel): مُهيّئات Postgres (channel_updates/deliveries/outbox) + اختبارات تكامل + وظيفة CI
[6] feat(channel): مُهيّئ المجموعات (دعم/تصعيد) + تحديثات المجموعات
[7] test(channel): Exit Gate E2E (كل بوت يفتح Mini App الصحيحة + استبدال المُهيّئ بـMock) + إغلاق المرحلة
```

**قيود ملزمة لمن يكمل المرحلة** (مفصّلة في [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) §4):

1. مدخل واحد (`webhook` مع التحقّق من secret token قبل أي معالجة) ومخرج واحد (`POST /channel/messages`).
2. منع التكرار في الاتجاهين — المكرر يُرجَع `duplicate` بـ202 ولا يُصدر حدثاً.
3. لا تخزين لربط `chat_ref` ↔ `wasla_public_id` في طبقة القنوات (ملك Identity — [ADR-001](../15-decisions/ADR-001-identity-decoupled-from-telegram.md)).
4. الـCore يصرّح بالنية فقط (`{type: mini_app, mini_app: driver}`) والمُهيّئ يبني زر `web_app`.
5. أخطاء Telegram تُترجم داخل المُهيّئ إلى أكواد `CHANNEL_*` مع علم `retryable`.
6. Deep Links بلا حالة (base64url ≤ 64 حرفاً) — التجاوز 422 `CHANNEL_DEEP_LINK_TOO_LONG`.
7. كل منفذ له مُهيّئ Mock في الاختبارات — وإلا فبوابة الخروج غير مُحقّقة.

**مؤجّل صراحة (خارج نطاق المرحلة 03):** بناء واجهات Mini App نفسها (`apps/*-mini-app`) · مُهيّئات Web/Mobile/WhatsApp · `channel_deep_link_tokens` · `channel_group_bindings` · `channel_rate_budgets` · Channel Router داخل خدمة `notifications`.

---

## 8. روابط سريعة

- [MR !9 — إصلاح job build-test (CI green)](https://gitlab.com/uxxxu/wasla/-/merge_requests/9)
- [ADR-005 — مكدّس تنفيذ خدمة Identity](../15-decisions/ADR-005-identity-service-implementation-stack.md)
- [MASTER_PROGRESS.md — لوحة المراحل](MASTER_PROGRESS.md)
- [ROADMAP.md — خارطة الطريق الملزمة](ROADMAP.md)
- [TASK_LOG.md — سجل المهام](TASK_LOG.md)
- [README.md — نظرة عامة](../../README.md)
- [CONTRIBUTING.md — سير العمل](../../CONTRIBUTING.md)
- [GIT_RULES.md — قواعد Git/MR](../00-rules/GIT_RULES.md)
- [ADR-007 — عزل قناة Telegram (Phase 03)](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)
