# HANDOFF — تسليم حالة المشروع للجهة التالية

> **النوع:** وثيقة تسليم (Handoff) واضحة لكل من سيعمل في المستودع بعد الجلسة الحالية.
>
> **القاعدة الحاكمة:** كل عمل يُدفع إلى المستودع يجب توثيقه، ويجب أن يعرف من يأتي بعدي «ماذا تمّ وماذا بقي» بدقّة، حتى إكمال المشروع 100%.
>
> **Last Updated:** 2026-08-20 · **Related:** [MASTER_PROGRESS.md](MASTER_PROGRESS.md) · [ROADMAP.md](ROADMAP.md) · [TASK_LOG.md](TASK_LOG.md) · MR !1/!2/!3/!4 · [ADR-002](../15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md) · [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) · [Runbook فكّ عائق CI](../14-runbooks/CI_RUNNER_UNBLOCK.md)
>
> **تحديث 2026-08-20 (b):** أُنشئ [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) — اختيار مكدّس تنفيذ خدمة Identity (Node 20 + TS + Fastify + PostgreSQL + Drizzle). هذا قرار توثيقي فقط يزيل Open Blocker 1 لـ Phase 01؛ **لا يبدأ التنفيذ** ولا يجتاز Exit Gate. التنفيذ لا يزال معلّقاً على اجتياز Phase 00 Exit Gate (CI passes — محجوب خارجياً بـ shared runners).
>
> **تحديث 2026-08-20:** MR !1/!2/!3/!4 مدمجة إلى main. جميع المعايير الهندسية لـ Phase 00 مكتملة (بما فيها أساس البناء). المعيار الوحيد المتبقّي للـ Exit Gate هو «CI passes» — محجوب خارجياً بـ shared runners. مسارا الحلّ في [Runbook فكّ عائق CI](../14-runbooks/CI_RUNNER_UNBLOCK.md).

---

## 1. أين نقف الآن (Snapshot)

```text
المرحلة الحالية: Phase 00 (مدمج + أساس بناء مُضاف) → Phase 01 — Identity Foundation (عقود + أنواع + اختيار مكدّ مُوثّق)
الحالة:          MR !1..!7 مدمجة إلى main؛ أساس بناء (pnpm+TS+Vitest) مُضاف؛
                 [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) يُحدّد مكدّس التنفيذ (Node+TS+Fastify+Postgres+Drizzle)؛
                 Phase 00 Exit Gate لا يزال معلّقاً على التحقق من CI (shared runners). W0 لم يبدأ بعد.
                 تنفيذ خدمة Identity معلّق على اجتياز Phase 00 Exit Gate أو تفويض صريح بتنفيذ قبل البوابة.
آخر تحديث:      2026-08-20 (بعد اختيار المكدّس عبر ADR-005)
```

**ما تم دمجه إلى main:**
- [MR !1](https://gitlab.com/uxxxu/wasla/-/merge_requests/1) (commit `cba9a75`) — إصلاح فحص الأسرار في CI + أساس Phase 00.
- [MR !2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2) (commit `a15985d`) — عقود Identity بمنهج Contract First (API/Event/Data/Error).
- [MR !3](https://gitlab.com/uxxxu/wasla/-/merge_requests/3) (commit `0576365`) — تحديث خارطة الطريق بعد الدمج.

**أساس البناء (مدمج عبر MR !4، commit `052d3ff`):**
- pnpm 9 workspaces + tsconfig strict + Vitest + حزمة `@wasla/errors` (اختبار دخان: 3 اختبارات تجتاز).
- job `build-test` في CI (typecheck + test) — جاهزة للعمل عند تفعيل shared runners.
- توثيق الاختيار في [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) + تعليمات الإعداد في [CONTRIBUTING.md](../../CONTRIBUTING.md).

**محاولة runner خاص من بيئة التنفيذ (غير مجدية):** Docker يُثبَّت والـ daemon يبدأ بـ`--bridge=none`، لكن بيئة التنفيذ تُنهي العمليات الخلفية بين الأوامر، وbridge/iptables غير مدعوم. **لا يمكن استضافة runner دائم من هذه البيئة** — يتطلب جهازاً مستمراً. مسارا الحلّ الدائمان موثّقان في [Runbook فكّ عائق CI](../14-runbooks/CI_RUNNER_UNBLOCK.md): (1) التحقق من namespace، (2) runner خاص على جهاز مستمر.

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
| 10 | اختيار مكدّس تنفيذ Identity (ADR-005) | ✅ جاهز للمراجعة عبر [MR !8](https://gitlab.com/uxxxu/wasla/-/merge_requests/8) (مفتوح/قابل للدمج) — قرار توثيقي، لا كود تنفيذي |

> تفاصيل الخطوات التفصيلية لـ Phase 00 (تشخيص فحص الأسرار، ربط pre-push، التحقق من حماية main، CI lint) موثّقة في [TASK_LOG.md](TASK_LOG.md). **الخطوة الوحيدة غير المكتملة: اجتياز pipeline فعلياً على GitLab — محجوبة خارجياً (انظر §2).**

---

## 2. العائق الوحيد المتبقي لـ Phase 00 (خارجي — إجراء من مالك الحساب)

### العَرَض
الـ pipelines على GitLab تفشل **فوراً دون إنشاء أي وظيفة** (0 jobs، `created_at == finished_at`). هذا حدث **قبل** تعديلاتي أيضاً (على `main` منذ 2026-08-19)، أي أنه بيئي وليس بسبب الإصلاح. CI config صالح (server-side lint valid).

### السبب
**GitLab shared runners غير متاحة لهذا الـ namespace** (خطة مجانية `free`، غير مُتحقَّق منها). GitLab.com يمنع تشغيل الوظائف على shared runners للـ namespaces غير المُتحقَّق منها (إجراء مضاد للإساءة).

### الحل (خطوة واحدة — يقوم بها مالك الحساب)
اختر **أحد** المسارين:

**المسار أ (مُوصى به — دائم):** التحقق من namespace لتفعيل shared runners لجميع الـ pipelines المستقبلية:
1. افتح [User Settings → Billing](https://gitlab.com/-/user_settings/billing)
2. أضف وسيلة دفع (بطاقة ائتمان) — **لا تُخصم أي رسوم** على الخطة المجانية؛ الهدف التحقق من الحساب فقط
3. (بديل) رابط التحقق المباشر: <https://gitlab.com/users/namespace/verify>

**المسار ب (بديل — runner خاص):** تسجيل self-managed GitLab Runner على جهازك الخاص (يحتاج Docker لتشغيل `image: alpine:3.20`):
1. ثبّت `gitlab-runner` على جهاز دائم
2. أنشئ runner للمشروع: Settings → CI/CD → Runners → New project runner (with Docker executor, run_untagged=true)
3. سجّله وشغّله

### بعد تفعيل الـ runners
- سيعمل pipeline على [MR !1](https://gitlab.com/uxxxu/wasla/-/merge_requests/1) تلقائياً ويجتاز (الإصلاح متحقَّق منه محلياً + lint صالح).
- عند اجتيازه: ادمج MR !1 إلى `main`.
- بعد الدمج: يُعتبر شرط **"CI passes"** محققاً → **Phase 00 = Completed** → ابدأ **Phase 01 (Identity Foundation)**.

---

## 3. المسار الكامل إلى 100% (حسب [ROADMAP.md](ROADMAP.md))

```text
Phase 00 Repository Foundation ............ Exit Gate Pending (هذه الجلسة)
Phase 01 Identity Foundation .............. التالي بعد Phase 00 (Telegram → هوية مستقرة)
Phase 02 Geography & Localization ......... Geo IDs + i18n AR/EN/UR
Phase 03 Telegram Channel Foundation ...... 3 بوتات + Mini Apps + Adapter قابل للاستبدال
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

## 4. ما يجب على من يأتي بعدي فعله فوراً (Checklist)

```text
[1] فعّل shared runners على GitLab (§2 المسار أ) أو شغّل runner خاصاً (المسار ب)
[2] انتظر اجتياز pipeline على MR !1
[3] راجع MR !1 (CODEOWNERS) ثم ادمجه إلى main
[4] فعّل hooks محلياً:  git config core.hooksPath scripts/hooks
                       chmod +x scripts/hooks/pre-push scripts/checks/*.sh
[5] حدّث MASTER_PROGRESS.md: Phase 00 → Completed (مع Evidence = رابط pipeline ناجح)
[6] ابدأ Phase 01 — Identity Foundation: المكدّس مُختار في [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) (Node+TS+Fastify+Postgres+Drizzle)؛ أضِف الاعتماديات عبر MR مستقل → نفّذ ضد العقود/الأنواع → Contract tests → Exit Gate
```

---

## 5. ملاحظات سياسية وأمنية

- **حماية main:** محمية (Maintainers فقط، لا force push)، لكن تسمح لـMaintainers بالدفع المباشر لـ`main`. يُنصح بتشديد `push_access_levels` إلى «No one» لمواءمتها مع قاعدة "لا Push مباشر" في [GIT_RULES.md](../00-rules/GIT_RULES.md).
- **رمز الوصول (glpat):** استُخدم للاستنساخ والدفع وفتح MR. **يجب إبطاله/تدويره** من [Personal Access Tokens](https://gitlab.com/-/user_settings/personal_access_tokens) لأنه ظهر في المحادثة.
- **قاعدة التوثيق مع الدفع:** كل دفع يمس `apps/bots/services/packages/infra/scripts/` يجب أن يرافقه تحديث في `docs/` (إلزام خادمي عبر CI job `doc-coverage`). الحد الأدنى: إدخال في `docs/16-progress/TASK_LOG.md`.

---

## 6. روابط سريعة

- [MR !1 — إصلاح فحص الأسرار في CI](https://gitlab.com/uxxxu/wasla/-/merge_requests/1)
- [MASTER_PROGRESS.md — لوحة المراحل](MASTER_PROGRESS.md)
- [ROADMAP.md — خارطة الطريق الملزمة](ROADMAP.md)
- [TASK_LOG.md — سجل المهام](TASK_LOG.md)
- [README.md — نظرة عامة](../../README.md)
- [CONTRIBUTING.md — سير العمل](../../CONTRIBUTING.md)
- [GIT_RULES.md — قواعد Git/MR](../00-rules/GIT_RULES.md)
