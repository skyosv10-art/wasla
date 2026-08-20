# HANDOFF — تسليم حالة المشروع للجهة التالية

> **النوع:** وثيقة تسليم (Handoff) واضحة لكل من سيعمل في المستودع بعد الجلسة الحالية.
>
> **القاعدة الحاكمة:** كل عمل يُدفع إلى المستودع يجب توثيقه، ويجب أن يعرف من يأتي بعدي «ماذا تمّ وماذا بقي» بدقّة، حتى إكمال المشروع 100%.
>
> **Last Updated:** 2026-08-20 · **Related:** [MASTER_PROGRESS.md](MASTER_PROGRESS.md) · [ROADMAP.md](ROADMAP.md) · [TASK_LOG.md](TASK_LOG.md) · MR !1..!4/!9 مدمجة · [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) · [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) · [ADR-002](../15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md)
>
> **تحديث 2026-08-20 (c):** **Phase 00 = Completed (W0)**. تحقّق المالك من namespace → تفعّل shared runners. ظهر فشل في job `build-test` (typecheck) بسبب استخدام `node:fs`/`node:path`/`__dirname` دون `@types/node` مُعلَن — صُلح عبر [MR !9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9) (إضافة `@types/node`) الذي اجتاز CI بالكامل ودُمج. pipeline على `main` نجاح كامل (build-test + markdown-lint + repo-structure ✅). **Phase 00 Exit Gate اجتاز.**
>
> **تحديث 2026-08-20 (b):** [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) يُحدّد مكدّس تنفيذ خدمة Identity (Node 20 + TS + Fastify + PostgreSQL + Drizzle). كان على فرع MR !8 غير المدمج — يُضاف إلى `main` عبر MR تنظيف الحوكمة (انظر §4).

---

## 1. أين نقف الآن (Snapshot)

```text
المرحلة الحالية: Phase 00 = Completed (W0: 2026-08-20) → بدء Phase 01 — Identity Foundation (التنفيذ الفعلي)
الحالة:          Phase 00 Exit Gate اجتاز بالكامل (CI green على main).
                 [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) يُحدّد مكدّس التنفيذ
                 (Node 20 + TS strict + Fastify + PostgreSQL 15+ + Drizzle + Vitest + pino).
                 التنفيذ الفعلي لخدمة Identity مُلغى التعلّق الآن — يبدأ عبر MRs مستقلة وفق §4.
آخر تحديث:      2026-08-20 (بعد دمج MR !9 + اجتياز CI على main)
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
Phase 01 Identity Foundation .............. قيد البدء (التنفيذ الفعلي وفق ADR-005 — Telegram → هوية مستقرة)
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

## 4. ما يجب فعله الآن (Checklist) — بدء Phase 01 (التنفيذ الفعلي لخدمة Identity)

```text
[0] MR تنظيف الحوكمة (أولاً): إضافة ملف ADR-005 إلى main + توفيق HANDOFF/التقدم + إغلاق MR !8 (مُلغى) → CI green
[1] MR 1 — Identity scaffold + pure core:
    - إنشاء حزمة services/identity (إضافة إلى workspace)
    - مولّد + مُتحقّق Wasla Public ID (WS-XXXXXXXXXX، 10 محارف كبيرة)
    - نماذج النطاق (identity domain) + واجهات repository/outbox
    - repository في الذاكرة (in-memory) للاختبارات
    - حالة استخدام resolveTelegramIdentity + سلوك username-change history
    - اختبارات: إنشاء هوية من Telegram، idempotent، استقرار الهوية/Public ID عبر تغيير Username، تسجيل history، إصدار أحداث outbox بالأنواع المعروفة
    - تحديث docs/ (TASK_LOG, MASTER_PROGRESS, HANDOFF)
[2] MR 2 — Drizzle/Postgres persistence:
    - إضافة drizzle-orm, pg, drizzle-kit, @types/pg (في الحزمة التي تستعملها فقط)
    - Drizzle schema مطابق لـ DDL الموجود (services/identity/contracts/)
    - تطبيق repository؛ اختبارات DB منفصلة عن pnpm -r test الافتراضي حتى يدعم CI قاعدة بيانات
[3] MR 3 — Fastify HTTP layer:
    - app factory + مسارات resolve/getUser/addLink/recovery/history ضد المنافذ (ports)
    - اختبارات عبر app.inject + in-memory repo؛ التحقق من استجابات العقود/الأنواع
[4] MR 4 — CI-backed DB integration:
    - GitLab service postgres:15 أولاً (أبسط)؛ Testcontainers فقط بعد التحقق من دعم runner (Docker daemon)
[5] MR 5 — Phase 01 Exit Gate:
    - E2E: مستخدم Telegram يُنشأ، يتغيّر Username، تبقى الهوية/Public ID مستقرة
    - تأكيدات outbox/history + Contract/provider tests
    - تعليم Phase 01 = Completed فقط بعد اجتياز CI
```

> **ملاحظات تنفيذية:**
> - **Testcontainers:** لا تبدأ بها في MR 1. بيئة التنفيذ الحالية بلا Docker، وCI هو `node:20-alpine` بسيط. ابدأ بـ in-memory repository seam + اختبارات وحدة/contract. أضِف Postgres فعلي لاحقاً عبر GitLab service (الأبسط) أو Testcontainers بعد التحقق من دعم runner. إذا تمّ الاستغناء عن Testcontainers نهائياً رغم ADR-005، وثّق ذلك كتعديل ADR.
> - **الاعتماديات:** أضِف فقط ما يُستعمل في كل MR. كل حزمة جديدة يجب أن تمرّ typecheck + test فوراً. لا تعتمد على typings عامة/شاملة مرة أخرى — إذا استعمل كود واجهات Node، أعلِن `@types/node` في تلك الحزمة. أبقِ اختبارات DB خارج `pnpm -r test` الافتراضي حتى يدعم CI قاعدة بيانات.
> - **Wasla Public ID:** لا تخترع alphabet/checksum غير موثّق. ابحث في العقود/الـDDL عن `WS-`, `public_id`, `pattern`. إذا كان القيد الوحيد هو `WS-XXXXXXXXXX`، نفّذ أضيق سلوك آمن: `WS-` + 10 محارف كبيرة مولّدة، فرادة عبر قيد DB unique + إعادة محاولة. تجنّب المتتالية ولا تُضمّن Telegram IDs. أي اختيار غير موثّق يُسجَّل في ADR/TASK_LOG.

---

## 5. ملاحظات سياسية وأمنية

- **حماية main:** محمية (Maintainers فقط، لا force push)، لكن تسمح لـMaintainers بالدفع المباشر لـ`main`. يُنصح بتشديد `push_access_levels` إلى «No one» لمواءمتها مع قاعدة \"لا Push مباشر\" في [GIT_RULES.md](../00-rules/GIT_RULES.md).
- **رمز الوصول (glpat):** استُخدم للاستنساخ والدفع وفتح/دمج MRs. **يجب إبطاله/تدويره** من [Personal Access Tokens](https://gitlab.com/-/user_settings/personal_access_tokens) لأنه ظهر في المحادثة.
- **قاعدة التوثيق مع الدفع:** كل دفع يمس `apps/bots/services/packages/infra/scripts/` يجب أن يرافقه تحديث في `docs/` (إلزام خادمي عبر CI job `doc-coverage`). الحد الأدنى: إدخال في `docs/16-progress/TASK_LOG.md`.

---

## 6. روابط سريعة

- [MR !9 — إصلاح job build-test (CI green)](https://gitlab.com/uxxxu/wasla/-/merge_requests/9)
- [ADR-005 — مكدّس تنفيذ خدمة Identity](../15-decisions/ADR-005-identity-service-implementation-stack.md)
- [MASTER_PROGRESS.md — لوحة المراحل](MASTER_PROGRESS.md)
- [ROADMAP.md — خارطة الطريق الملزمة](ROADMAP.md)
- [TASK_LOG.md — سجل المهام](TASK_LOG.md)
- [README.md — نظرة عامة](../../README.md)
- [CONTRIBUTING.md — سير العمل](../../CONTRIBUTING.md)
- [GIT_RULES.md — قواعد Git/MR](../00-rules/GIT_RULES.md)
