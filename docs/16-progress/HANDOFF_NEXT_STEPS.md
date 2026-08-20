# HANDOFF — تسليم حالة المشروع للجهة التالية

> **النوع:** وثيقة تسليم (Handoff) واضحة لكل من سيعمل في المستودع بعد الجلسة الحالية.
>
> **القاعدة الحاكمة:** كل عمل يُدفع إلى المستودع يجب توثيقه، ويجب أن يعرف من يأتي بعدي «ماذا تمّ وماذا بقي» بدقّة، حتى إكمال المشروع 100%.
>
> **Last Updated:** 2026-08-20 · **Related:** [MASTER_PROGRESS.md](MASTER_PROGRESS.md) · [ROADMAP.md](ROADMAP.md) · [TASK_LOG.md](TASK_LOG.md) · MR !1 · [ADR-002](../15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md) · MR !2
>
> **تحديث 2026-08-20:** بدأت عقود Identity (Contract First) كأول خطوة نحو Phase 01 Exit Gate — موثّق في ADR-002 وMR !2. **لا يُلغي هذا بدء Phase 01 حقيقة أن Phase 00 = Exit Gate Pending** (لأن CI لم يجتز فعلياً على GitLab بعد).

---

## 1. أين نقف الآن (Snapshot)

```text
المرحلة الحالية: Phase 00 (مدمج) → Phase 01 — Identity Foundation (عقود مدمجة)
الحالة:          MR !1 وMR !2 مدمجان إلى main؛ Phase 00 Exit Gate لا يزال معلّقاً
                 على التحقق من CI (عائق shared runners خارجي). W0 لم يبدأ بعد.
آخر تحديث:      2026-08-20 (بعد الدمج)
```

**ما تم دمجه إلى main:**
- [MR !1](https://gitlab.com/uxxxu/wasla/-/merge_requests/1) (commit `cba9a75`) — إصلاح فحص الأسرار في CI + أساس Phase 00.
- [MR !2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2) (commit `a15985d`) — عقود Identity بمنهج Contract First (API/Event/Data/Error).

العمل المنجز (كلّه موثّق في [TASK_LOG](TASK_LOG.md)):

| # | العنصر | الحالة |
|---|---|---|
| 1 | استيراد (clone) المستودع من GitLab | ✅ تم |
| 2 | قراءة الوثائق وتحديد الخطوة الموثّقة التالية (إكمال Phase 00 Exit Gate) | ✅ تم |
| 3 | اكتشاف خطأ في CI: فحص الأسرار كان يطابق `.gitlab-ci.yml` نفسه فيفشل دائماً | ✅ تم تشخيصه |
| 4 | إنشاء `scripts/checks/scan-secrets.sh` (git grep، يتجاهل .git، يستثني ملفات الكاشف) | ✅ تم |
| 5 | ربط فحص الأسرار بـ `scripts/hooks/pre-push` | ✅ تم |
| 6 | تحديث `.gitlab-ci.yml` لاستدعاء السكربت بدل الفحص المكسور | ✅ تم |
| 7 | التحقق: المستودع النظيف يمر، السر يُرفض (exit 1)، doc-coverage E2E يعمل | ✅ تم |
| 8 | التحقق من حماية فرع main (GitLab API: محمي، Maintainers فقط، لا force push) | ✅ تم |
| 9 | التحقق من صحة CI config على خادم GitLab (CI lint: valid) | ✅ تم |
| 10 | تحديث `MASTER_PROGRESS.md` + `TASK_LOG.md` (قاعدة التوثيق مع الدفع) | ✅ تم |
| 11 | دفع الفرع + فتح MR !1 بتعبئة قالب GIT_RULES | ✅ تم |
| 12 | **اجتياز pipeline فعلياً على GitLab** | ⛔ محجوب (انظر §2) |

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
[6] ابدأ Phase 01 — Identity Foundation (التالية حسب ROADMAP)
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
