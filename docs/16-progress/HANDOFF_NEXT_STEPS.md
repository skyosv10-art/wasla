# HANDOFF — تسليم حالة المشروع للجهة التالية

> **النوع:** وثيقة تسليم (Handoff) واضحة لكل من سيعمل في المستودع بعد الجلسة الحالية.
>
> **القاعدة الحاكمة:** كل عمل يُدفع إلى المستودع يجب توثيقه، ويجب أن يعرف من يأتي بعدي «ماذا تمّ وماذا بقي» بدقّة، حتى إكمال المشروع 100%.
>
> **Last Updated:** 2026-08-21 (**Phase 04 = In Progress** · MR 3/6 — استمرارية Drizzle/Postgres لخدمة العملاء ووظيفة `customer-db-integration` ([CUSTOMER_PERSISTENCE.md](../02-architecture/CUSTOMER_PERSISTENCE.md)) بعد MR 2/6 (طبقة المجال — [CUSTOMER_CORE_DOMAIN.md](../02-architecture/CUSTOMER_CORE_DOMAIN.md)) وMR 1/6 (العقود + [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md)) — انظر §9؛ **Phase 03 = Completed** · MR 7/7 — بوابة خروج المرحلة E2E وإغلاقها — انظر §7؛ المرحلة الحالية صارت Phase 04) · **Related:** [MASTER_PROGRESS.md](MASTER_PROGRESS.md) · [ROADMAP.md](ROADMAP.md) · [TASK_LOG.md](TASK_LOG.md) · MR !1..!4/!9 مدمجة · MR 5 = !28 · MR 6 = !29 · MR 7 = !30 · [ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md) · [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) · [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) · [ADR-002](../15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md)
>
> **تحديث 2026-08-20 (c):** **Phase 00 = Completed (W0)**. تحقّق المالك من namespace → تفعّل shared runners. ظهر فشل في job `build-test` (typecheck) بسبب استخدام `node:fs`/`node:path`/`__dirname` دون `@types/node` مُعلَن — صُلح عبر [MR !9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9) (إضافة `@types/node`) الذي اجتاز CI بالكامل ودُمج. pipeline على `main` نجاح كامل (build-test + markdown-lint + repo-structure ✅). **Phase 00 Exit Gate اجتاز.**
>
> **تحديث 2026-08-20 (b):** [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) يُحدّد مكدّس تنفيذ خدمة Identity (Node 20 + TS + Fastify + PostgreSQL + Drizzle). كان على فرع MR !8 غير المدمج — يُضاف إلى `main` عبر MR تنظيف الحوكمة (انظر §4).

---

## 1. أين نقف الآن (Snapshot)

```text
المرحلة الحالية: Phase 04 — Customer Core (**قيد التنفيذ**: MR 1/6 و2/6 مدمجتان — العقود وADR-009 ثم
                 طبقة المجال النقيّة بمُهيّئات ذاكرة · §9 للخطة)
المكتمل:         Phase 00 ✅ · Phase 01 ✅ · Phase 02 ✅ · Phase 03 ✅ (أُغلقت 2026-08-21 بسبع مراجعات) —
                 كل بوابات الخروج مُتحقّقة آلياً في CI (db-integration لـidentity · geography-db-integration
                 لـgeography · channel-db-integration لمُهيّئات القناة · channel-exit-gate-e2e لبوابة المرحلة 03).
المتبقّي:         Phase 04 (MR 4..6/6: HTTP على 8086 · ربط البوت · بوابة الخروج · §9) → Phase 24 (انظر §3 للمسار الكامل، و§7 لما تُسلّمه Phase 03).
الاختبارات:       553 اختبار وحدة (66 لخدمة العملاء: 48 لطبقة المجال + 17 حراسة انحراف مخطّط
                 (تقرأ schema.sql فعلياً بلا قاعدة) + 1 حارس خصوصية لوصف الشحنة — idempotency وإعادة المحاولة على الصفّ نفسه
                 وfail-closed وبحث سلبي عن أي نصّ مستخدم أو إحداثية في الأحداث
                 + 42 لعقود Customer Core منها حرّاس حدود ADR-009 وقاعدة خصوصية الأحداث
                 + 96 + 34 لعقود القناة + 102 لنواة القناة + 99 لمُهيّئ Telegram
                 + 80 لطبقة تشغيل البوتات + 18 لجذور البوتات الثلاثة + 9 لحراسة مخطط القناة
                 + 7 من بوابة المرحلة 03 التي تعمل بمخازن الذاكرة أيضاً)
                 + 68 تكامل (4 سابقة + 21 لمُهيّئات Postgres للقناة + 43 لخدمة العملاء:
                 27 للمُهيّئ أمام قاعدة حقيقية + 16 مطابقة منافذ تُنفَّذ مرّتين ذاكرة/Postgres)
                 + 5 E2E سابقة في CI
                 + 8 في بوابة خروج المرحلة 03 (446 مجموعاً عند وجود DATABASE_URL — الثامن يفحص الصفوف).
البوتات:         customer/driver/partner تطبيقات قابلة للنشر (8083/8084/8085) تخدم عقد القناة عبر
                 @wasla/bot-runtime — التخزين **دائم على Postgres** متى وُجِد DATABASE_URL
                 (منع التكرار وطابور المحاولات يعبران إعادة التشغيل)، وفي الذاكرة بغيابه للتشغيل المحلي.
المجموعات:       البوت يردّ في غرف **مُعلَنة في البيئة** فقط (دعم/تصعيد/مجتمع) برابط عميق لا بزر
                 Mini App، ولا يُهيّئ هوية من غرفة، ويصمت تماماً في غرفة غير مُعلَنة (تُسجَّل وتُدقَّق).
بوابة المرحلة:   مُثبَتة لا موصوفة — @wasla/channel-e2e يبني البوتات الثلاثة في عملية واحدة أمام خدمة
                 هوية واحدة تستمع على HTTP: كل بوت يفتح Mini App الخاصة به، وشخص واحد عبر الثلاثة
                 = هوية واحدة، والمُعاد لا يُعالَج مرّتين، والمُهيّئ قابل للاستبدال بـMockChannelAdapter.
آخر تحديث:      2026-08-21 (Phase 04 · MR 3/6 — استمرارية Postgres لخدمة العملاء + customer-db-integration — §9)
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
Phase 03 Telegram Channel Foundation ...... ✅ Completed (2026-08-21) — Exit Gate E2E في CI (§7)
Phase 04 Customer Core ................... ⏳ التالية — إنشاء Order صالح (تحمل معها ما في §7 «ما تُسلّمه Phase 03»)
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

- **حماية main (مُشدَّدة 2026-08-21):** `push_access_levels = No one` · `merge_access_levels = Maintainers` · `allow_force_push = false`. أي دفع مباشر إلى `main` مرفوض من **الجميع بما فيهم المالك**، فالطريق الوحيد إليه هو Merge Request يجتاز الأنبوب — أي أن قاعدة \"لا Push مباشر\" في [GIT_RULES.md](../00-rules/GIT_RULES.md) صارت **إلزاماً خادمياً** لا عُرفاً يُراجَع بشرياً. الدمج لا يتأثّر (صلاحية منفصلة).
  - **أثرها على من يعمل بعدك:** لا تحاول `git push origin main` ولا `commit` مباشر على `main` عبر الـAPI — سيعود 403. اعمل دائماً: فرع → دفع → MR → أنبوب أخضر → دمج (وفق [GIT_RULES.md](../00-rules/GIT_RULES.md)).
  - **كيف تُراجَع أو تُعكَس:** `GET/POST/DELETE /projects/85566384/protected_branches` (`PATCH` **لا يستبدل** مستوى الدفع بل يُضيف مستوى ثانياً، فالتعديل الصحيح حذف الحماية ثم إعادة إنشائها بـ`push_access_level=0`). العكس عند الحاجة (مثلاً إصلاح عاجل لا يمكن أن يمرّ بأنبوب) يُعاد بـ`push_access_level=40`، **ويجب أن يُعاد التشديد فوراً بعده ويُسجَّل في [TASK_LOG](TASK_LOG.md)**.
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

## 7. Phase 03 (Telegram Channel Foundation) — مكتملة ✅ (2026-08-21)

**بوابة الخروج (Exit Gate) الملزمة:** «كل Bot يفتح Mini App المناسبة، ويمكن استبدال Telegram adapter في الاختبارات بـMock Adapter» — **اجتازت في MR 7/7 بثمانية اختبارات تُشغّل البوتات الثلاثة وخدمة الهوية معاً**: [PHASE03_EXIT_GATE_E2E.md](../12-testing/PHASE03_EXIT_GATE_E2E.md).

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
[2] feat(channel-core): نموذج المجال + المنافذ + حالات الاستخدام + مُهيّئات in-memory/Mock   ← ✅ Done [MR !24]
    - المنافذ التسعة: ChannelPort · UpdateParserPort · ProcessedUpdateStorePort · DeliveryStorePort ·
      OutboxPort · IdentityBootstrapPort · MiniAppRegistryPort · ClockPort · IdGeneratorPort (+ RetryPolicy)
    - حالات الاستخدام: receiveUpdate (تفسير→رفض غير المدعوم→منع تكرار ذرّي→تهيئة هوية→فك رابط عميق→حدث)
      · sendMessage (تحقّق→إنشاء idempotent→محاولة→sent/queued/failed + أحداث) · retryDueDeliveries
      · getMiniAppLaunch + createDeepLink
    - مُهيّئات: InMemory{ProcessedUpdateStore,DeliveryStore,Outbox} · FixedClock · SequentialIdGenerator ·
      FakeIdentityBootstrap · StaticMiniAppRegistry · FakeUpdateParser · **MockChannelAdapter**
    - اختبار حراسة معماري (38 اختباراً): لا مفردات/استيرادات قناة داخل channel-core + قفل الاعتماديات
    - تعديل عقد البيانات: عمودا channel_deliveries.body + .bot (إعادة المحاولة تُرسل نفس الرسالة)
    - وثيقة: docs/02-architecture/CHANNEL_LAYER_CORE.md
[3] feat(telegram-adapter): تفسير Update + إرسال + أزرار web_app + تخطيط الأخطاء + حدود المعدّل   ← ✅ Done [MR !25]
    - packages/telegram-adapter: يُنفّذ ChannelPort (TelegramChannelAdapter) + UpdateParserPort
      (TelegramUpdateParser) فقط — لا حالة استخدام واحدة هنا
    - api-shapes (قرّاء آمنون، كل المعرّفات كسلاسل) · sanitize (محارف تحكّم/اتجاه) · keyboard
      (web_app بـHTTPS إلزامي + url من قالب الرابط العميق) · bot-api-client (fetch محقون + مهلة، بلا رمز في أي مسار خطأ)
    - error-mapping: فشل Bot API → أكواد CHANNEL_* مع retryable + احترام parameters.retry_after
    - rate-limit: token bucket (25/ث للبوت · 1/ث للمحادثة · LRU) **لا ينام أبداً** — يُرجع
      CHANNEL_RATE_LIMITED فتُعيد النواة الجدولة؛ penalise يجعل تهدئة Telegram هي المرجع
    - webhook-auth: assertWebhookSecret بمقارنة ثابتة الزمن + حد أدنى 16 محرفاً (الاستخدام في MR 4)
    - 86 اختباراً منها 8 اختبارات مطابقة منافذ تُشغّل المُهيّئ الحقيقي داخل حالات استخدام النواة
      (إثبات الاستبدال بـMock على مستوى الحزمة قبل E2E في MR 7)
    - وثيقة: docs/02-architecture/CHANNEL_TELEGRAM_ADAPTER.md
[4] feat(bots): ثلاثة جذور تركيب Fastify + /start + Identity bootstrap + أزرار Mini App + Deep Links   ← ✅ Done [MR !27]
    - packages/bot-runtime (@wasla/bot-runtime): كل ما تتشاركه البوتات — سطح HTTP لعقد القناة على Fastify
      + قراءة التهيئة من البيئة بفشل سريع + SingleBotRegistry + مُهيّئ الهوية عبر HTTP + التركيب
      (مبرّر الحزمة في CHANNEL_BOTS.md §1 حسب ENGINEERING_DOCUMENTATION_LAW §7)
    - bots/{customer,driver,partner}-bot: كل جذر يسمّي بوته فقط (buildApp + main) — لا معالج ولا قاعدة عمل
    - POST /channel/{bot}/webhook: assertWebhookSecret قبل أي معالجة → 401 CHANNEL_UNAUTHORIZED_WEBHOOK ·
      ثم receiveUpdate · 202 دائماً (بما فيه duplicate) · /start يُجاب بزر Mini App الخاص بالبوت
    - POST /channel/messages + GET /channel/{bot}/mini-app + POST /channel/{bot}/deep-links + GET /health
      (`degraded` إن لم تُوصَل خدمة الهوية؛ و/start يعود 503 قابلاً للإعادة بدل اختلاق هوية)
    - 76 اختباراً جديداً (58 للحزمة + 6 لكل بوت) بـapp.inject بلا منفذ — إجمالي المستودع 376
    - وثيقة: docs/02-architecture/CHANNEL_BOTS.md
    - ✅ أُغلق في MR 5: التخزين في الذاكرة صار اختياراً لا قدراً — مُهيّئات Postgres تُركّب عند
      وجود DATABASE_URL. (مُشغّل retryDueDeliveries الدوري لا يزال مفقوداً.)
    - ⚠️ فجوة عقد: /identity/resolve مصوغ بشكل Telegram (telegram_user_id/telegram_username) بينما
      InboundActor محايد ولا يحمل username — لا يُرسَل username، والإصلاح محلّه مرحلة القناة الثانية.
    - POST /channel/{bot}/webhook: assertWebhookSecret (من @wasla/telegram-adapter) قبل أي معالجة → 401
      CHANNEL_UNAUTHORIZED_WEBHOOK · ثم receiveUpdate · ردّ 202 دائماً (بما فيه duplicate) كما في OpenAPI
    - سجلّ بوتات مقود بالبيئة: رمز كل بوت + BotPresence (عنوان Mini App + قالب الرابط العميق) — لا سرّ في المصدر
    - مُهيّئ HTTP لمنفذ IdentityBootstrapPort مقابل خدمة identity (نمط HttpIdentityLookupPort في geography)
    - GET /channel/{bot}/mini-app + POST /channel/{bot}/deep-links + GET /health
    - اختبارات app.inject لكل بوت (رمز خاطئ · تحديث مكرر · /start يفتح Mini App الصحيحة)
[5] feat(channel): مُهيّئات Postgres (channel_updates/deliveries/outbox) + اختبارات تكامل + وظيفة CI   ← ✅ Done
    - packages/channel-postgres (@wasla/channel-postgres): حزمة مستقلّة لأن اختبار الحراسة في channel-core
      يقفل اعتمادياتها عند contracts-channel + errors (مبرّر الحزمة في CHANNEL_PERSISTENCE.md §1)
    - schema.ts مرآة Drizzle لـchannel-core/contracts/schema.sql + اختبار حراسة انحراف (9) يقرأ العقد فعلياً
    - PostgresProcessedUpdateStore: remember ذرّي بـINSERT … ON CONFLICT DO NOTHING … RETURNING
      (لا SELECT-ثم-INSERT) · processed_at = received_at بقرار موثّق (المنفذ بلا إشارة إكمال)
    - PostgresDeliveryStore: create idempotent · applyProgress يزيد version داخل UPDATE · dueForRetry
      يُرتّب بـCASE على الأولوية ثم next_attempt_at داخل SQL قبل LIMIT
    - PostgresChannelOutbox: id = event_id فإعادة الإلحاق لا تُنتج صفّاً ثانياً + unpublished() للقراءة
    - createChannelStores هو الحدّ الوحيد؛ bot-runtime يختاره عند DATABASE_URL وإلا مجموعة الذاكرة
      (runtime.persistence يُعلن أيّهما · close() مربوط بخطّاف onClose في Fastify · خيار stores للاختبار)
    - 30 اختباراً جديداً: 9 وحدة + 21 تكامل (منها 6 مطابقة منافذ تُشغّل حالات الاستخدام نفسها
      على المجموعتين وتؤكّد تطابق المُشاهدات) + 8 في bot-runtime — إجمالي المستودع 393 وحدة + 25 تكامل
    - وظيفة CI: channel-db-integration (postgres:15 · wasla_channel_test)
    - وثيقة: docs/02-architecture/CHANNEL_PERSISTENCE.md + تحديث DB_INTEGRATION_CI.md
    - ⚠️ يبقى للتالي: لا ناشر لصندوق الصادر (لا مستهلك بعد) ولا مُشغّل دوري لـretryDueDeliveries
      — الطابور صار دائماً لكن لا شيء يستدعيه دوريّاً؛ ولا سياسة احتفاظ/تقليم لـchannel_updates.
[6] feat(channel): مُهيّئ المجموعات (دعم/تصعيد) + تحديثات المجموعات   ← ✅ Done
    - ADR-008 (يُعدّل ADR-007 §2): سجل المجموعات منفذاً **عاشراً** يقرأ **الإعداد** لا جدولاً، لأن
      channel_group_bindings مؤجَّل إلى Phase 08 (يحتاج خدمة الدعم لتقول أي غرفة لأي طلب/مدينة)
    - channel-core: ConversationScope (private/group) · GroupRole (support/escalation/community) ·
      GroupPresence · GroupRegistryPort (roleFor/groupsFor) **اختياري** في InboundDeps/OutboundDeps ·
      StaticGroupRegistry + testGroupRegistry
    - receiveUpdate يُرجع scope + groupRole + replyAllowed (في فرع التكرار أيضاً)، ولا يُهيّئ الهوية
      إلا في المحادثات الخاصة — تصحيح: مرجع المجموعة مشترك فربطه بشخص واحد ربط خاطئ لا يُنقَض
    - sendMessage يرفض نيّة mini_app نحو مجموعة مُعلَنة بـCHANNEL_INVALID_MESSAGE **قبل** إنشاء صفّ
      التسليم (فلا تُستهلك خمس محاولات على ما ترفضه Telegram أصلاً خارج المحادثات الخاصة)
    - telegram-adapter: my_chat_member/chat_member داخل المجموعات → group_event بعلامة
      bot_status:<s>/member_status:<s> (غير المعروف unknown) · علامات أحداث الخدمة joined:N/left:1/
      migrated/created · isGroupChatRef + رفض زر web_app نحو غرفة (طبقة ثانية تحمي POST /channel/messages)
    - bot-runtime: SUPPORT_GROUP_CHAT_IDS · ESCALATION_GROUP_CHAT_IDS · COMMUNITY_GROUP_CHAT_IDS
      (قراءة صارمة تفشل عند الإقلاع: مرجع فارغ · أطول من الحدّ · غرفة واحدة تحت دورين) → سجلّ **واحد**
      يتشارك الاتجاهان ويُعلَن في runtime.groups
    - /start في غرفة مُعلَنة يُجاب داخلها برسالة بحسب الدور وزرّ deep_link (open_app) يفتح المحادثة
      الخاصة، ويتدهور إلى نصّ فقط بلا قالب رابط عميق؛ والغرفة **غير المُعلَنة**: تُسجَّل ويُنشر حدثها
      ويُجاب 202 و**صفر رسائل** (لم تُضَف حالة ignored إلى العقد تحديداً)
    - 45 اختباراً جديداً (16 نواة + 13 مُهيّئ + 14 طبقة تشغيل) — إجمالي المستودع 438 وحدة
    - وثيقة: docs/02-architecture/CHANNEL_GROUPS.md + ADR-008 + تحديث الوثائق الثلاث القائمة
    - ⚠️ يبقى للتالي: الغرف تُعلَن **يدوياً** في البيئة (نسيانها = بوت صامت في غرفة عاملة، لا عطل
      ظاهر) · groupsFor(role) بلا مستهلك إنتاجي (مِشبك موجِّه التصعيد في Phase 16) · تغيير العضوية
      في محادثة **خاصة** لا يزال unsupported/422 · ربط مجموعة↔طلب وإعلان الطلبات وقفل الاستلام
      وأوامر الإشراف كلّها Phase 08/16 (منطق أعمال لا يخصّ طبقة القنوات).
[7] test(channel): Exit Gate E2E (كل بوت يفتح Mini App الصحيحة + استبدال المُهيّئ بـMock) + إغلاق المرحلة   ← ✅ Done [MR !30]
    - packages/channel-e2e: حزمة **اختبارية بحتة** (بلا src/index.ts وبلا تصدير، وكل اعتمادياتها
      devDependencies) — الموضع الوحيد المسموح فيه استيراد جذور التركيب الثلاثة معاً؛ وضعها في
      bot-runtime أو channel-postgres كان يخلق دورة اعتماد (bots → bot-runtime → channel-postgres)
    - harness.ts: خدمة الهوية تستمع على منفذ حقيقي (127.0.0.1:0) ويُنادى محوّل الإنتاج عبرها بـHTTP —
      «هوية واحدة» حكمٌ تصدره الخدمة لا افتراض يصنعه الاختبار؛ والبوتات الثلاثة عبر app.inject
      بمخازن قناة **مشتركة** (وإلّا لا يظهر تصادم منع التكرار أصلاً)
    - 8 اختبارات: mini-app الخاصة بكل بوت (و404 CHANNEL_UNKNOWN_BOT للبوتين الآخرين) · /start يُنتج
      رسالة واحدة بزرّ mini_app الصحيح + حدث channel.mini_app.launched · شخص واحد عبر الثلاثة = هوية
      واحدة (created:false · identity.created مرّة واحدة · لا wasla_public_id في أحداث القناة) ·
      الإعادة = 202 duplicate برسالة واحدة · نفس update_id من بوتين = كلاهما accepted (التفرّد يشمل
      البوت) · التهيئة وحدها ⇒ TelegramChannelAdapter وتجاوز مقبس واحد ⇒ MockChannelAdapter ·
      /health يُعلن runtime.persistence · وعلى Postgres: صفوف channel_updates/deliveries/outbox
    - غير قابلة للتخطّي: تعمل بمخازن الذاكرة في كل `pnpm -r test`، وبـPostgres في وظيفة CI جديدة
      channel-exit-gate-e2e (قاعدة مستقلّة wasla_channel_e2e)
    - فحص طفرة: كسر اشتقاق Mini App في bot-runtime/src/config.ts أسقط **4 من 8** ثم أُعيد — البوابة
      حسّاسة للخطأ الذي وُضعت له
    - وثيقة: docs/12-testing/PHASE03_EXIT_GATE_E2E.md + تحديث DB_INTEGRATION_CI.md و CONTAINERS.md
      و CHANNEL_BOTS.md و CHANNEL_LAYER_CORE.md — **صفر تغيير في كود الإنتاج والعقود** (دليل لا ميزة)
    - ⚠️ حدّ معلَن: تغيير قيمة <BOT>_MINI_APP_URL لا يُسقط اختباراً (الاختبار يقارن الردّ بنفس المتغيّر
      المُركَّب) — صحّة العنوان الفعلي مسألة تهيئة بيئة، جدولها في CHANNEL_BOTS.md.
```

### ما تُسلّمه Phase 03 إلى Phase 04 (لم يُنجَز بقصد — لا تُعاد كتابته من الصفر)

```text
[أ] مُشغّل دوري لـretryDueDeliveries — الطابور دائم على Postgres ومنطق الإعادة مُختبَر، لكن لا شيء
    يستدعيه دوريّاً في الإنتاج: رسالة فشلت بخطأ retryable تبقى queued حتى يستدعيه أحد.
[ب] ناشر لصندوق الصادر (channel_outbox) — الأحداث تُكتب ولا يقرأها مستهلك بعد (لا مستهلك قائم أصلاً).
[ج] سياسة استبقاء/تقليم لـchannel_updates — يكبر بلا حدّ اليوم.
[د] إرسال telegram_username في تهيئة الهوية (متاح في التحديث، لا يُمرَّر حالياً).
[هـ] الغرف تُعلَن يدوياً في البيئة: نسيان غرفة = بوت صامت في غرفة عاملة بلا عطل ظاهر.
[و] groupsFor(role) بلا مستهلك إنتاجي (مِشبك موجِّه التصعيد → Phase 16) · تغيير العضوية في محادثة
    خاصة لا يزال unsupported/422 · ربط مجموعة↔طلب وإعلان الطلبات وقفل الاستلام وأوامر الإشراف
    → Phase 08/16 (منطق أعمال لا يخصّ طبقة القنوات).
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

## 9. Phase 04 (Customer Core) — قيد التنفيذ (بدأت 2026-08-21)

**الأساس:** [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · [CUSTOMER_CORE.md](../03-domain/CUSTOMER_CORE.md) · [عقود الخدمة](../../services/customers/contracts/README.md) · [CONTAINERS §4.1](../02-architecture/CONTAINERS.md)

**بوابة الخروج (من الوثيقة الأم §75):** «عميل ينشئ Order صالحًا ويصل إلى Order Engine دون أي Matching فعلي بعد».

**الحدّ الحاكم للمرحلة:** خدمة `services/customers` تُنتج **نيّة طلب مُتحقَّقة** وتُسلّمها عبر `OrderIntakePort`. **لا تكتب جدول `orders` ولا تُولّد `order_public_id` ولا تملك آلة حالة الطلب** (§15 · Phase 06). من يخالف هذا الحدّ تُسقطه اختبارات الحدود في `@wasla/contracts-customer`.

### خطة المراجعات (MRs) — ملزمة ومرتّبة

| # | النطاق | المخرَج | الحالة |
|---|---|---|---|
| 1 | docs + contracts | ADR-009 + `services/customers/contracts/*` + `@wasla/contracts-customer` + [CUSTOMER_CORE.md](../03-domain/CUSTOMER_CORE.md) + CONTAINERS §4.1 | ✅ **مدمجة ([!31](https://gitlab.com/uxxxu/wasla/-/merge_requests/31))** — 42 اختباراً |
| 2 | النطاق النقي | `services/customers/src/{domain,ports,use-cases,infrastructure}`: كيانات + المنافذ (`IdentityLookupPort` · `GeographyPort` · `OrderIntakePort` + مستودعات) + حالات الاستخدام (ملف · أماكن · معاينة · تسليم) + مُهيّئات in-memory/Fake — **بلا قاعدة وبلا HTTP** | ✅ **مدمجة ([!32](https://gitlab.com/uxxxu/wasla/-/merge_requests/32))** — 48 اختباراً · [CUSTOMER_CORE_DOMAIN.md](../02-architecture/CUSTOMER_CORE_DOMAIN.md) |
| 3 | الاستمرارية | `src/infrastructure/drizzle/{schema,db,repository}.ts` — مرآة Drizzle لـ`schema.sql` + `PostgresCustomerRepository` + `PostgresCustomerOutbox` + حراسة انحراف (17) + وظيفة CI `customer-db-integration` (قاعدة `wasla_customer_test`) + **مطابقة منافذ** (16 سيناريو × مُهيّئين) + حسم `shipment_description` **بالتبنّي** | ✅ **مدمجة ([!33](https://gitlab.com/uxxxu/wasla/-/merge_requests/33))** — 66 وحدة + 43 تكامل · [CUSTOMER_PERSISTENCE.md](../02-architecture/CUSTOMER_PERSISTENCE.md) |
| 4 | طبقة HTTP | تطبيق Fastify على المنفذ **8086** + تخطيط كتالوج الأخطاء إلى حالات HTTP + `/health` + اختبارات `app.inject` | ⬜ **التالية** |
| 5 | البوت | ربط `bots/customer-bot` بالخدمة (ملف · مكان محفوظ · إنشاء طلب) مع **الحفاظ على حياد القناة** (ADR-007): البوت لا يعرف مجال العميل، والمجال لا يعرف Telegram | ⬜ |
| 6 | بوابة الخروج | E2E: عميل ينشئ طلباً صالحاً يصل إلى **محرّك طلبات بديل (stub)** يحترم `OrderIntakeRequest` + وثيقة البوابة + إغلاق المرحلة | ⬜ |

**ما صار قائماً بعد MR 3/6 (لمن يبدأ MR 4/6):** خدمة `services/customers` صارت تملك **مسار تخزين دائماً** وراء منافذها نفسها: `createCustomerDb({connectionString})` يُنشئ تجمّع `pg` + `drizzle`، و`PostgresCustomerRepository` و`PostgresCustomerOutbox` ينفّذان `CustomerRepository` و`Outbox` بلا توسيع للمنافذ، وكلّها مُصدَّرة من `src/index.ts`. و**لم يتغيّر ملف واحد في `src/use-cases/`** — وهذا هو المعيار: أي اضطرار لتغيير سلوك هناك دليلٌ على أن المخطّط بدأ يقود المجال. مصدر الـDDL يبقى `contracts/schema.sql` اليدوي؛ مرآة Drizzle مستهلِك له، و`schema-drift.test.ts` يقرأ العقد فعلياً فيكسر البناء عند أي انحراف، و`drizzle.config.ts` أداة محلية لا تُشغَّل في CI.

**ما يجب أن يعرفه من يبدأ MR 4/6 قبل أن يكتب سطراً:**

1. **لا شيء يفتح اتصالاً اليوم.** لا مسار تشغيل ينادي `createCustomerDb`؛ استيراد الحزمة لا يلمس الشبكة. MR 4/6 هي أوّل من يربطه بدورة حياة (ويجب أن تُغلق التجمّع في `onClose` كما تفعل `buildBotRuntime`).
2. **دَين الذرّية بانتظارك.** كتابة الصف وإلحاق الحدث **ليسا في معاملة واحدة** (منفذان مستقلّان بلا حدّ Unit of Work)، فثمّة نافذة فشل تترك طلباً مسجّلاً بلا حدثه. لم يُسدّ هنا لأن سدّه يعني تغيير `use-cases/` — وهو ما تمنعه هذه الدفعة. MR 4/6 هي أوّل دفعة تملك دورة الطلب فهي موضع الحسم ([CUSTOMER_PERSISTENCE.md §4 و§7.1](../02-architecture/CUSTOMER_PERSISTENCE.md)).
3. **`customer_outbox` بلا `trace_id`.** الحدث المُعاد بناؤه من القاعدة يفقد معرّف ارتباطه. لم يُخترع عمود خارج العقد؛ من يحتاجه هو الناشر (Phase 09) وهو من يجب أن يُضيفه بهجرة موثّقة.
4. **`updated_at` تملكه القاعدة** عبر المُشغّل `customer_set_updated_at`، فالساعة المُحقونة لا تُطبَّق على Postgres عند التحديث. لا حالة استخدام تقرأه لاتّخاذ قرار، واختبار المطابقة يُسقطه ويتحقّق من الاتّجاه فقط. **لا تُعدّل المُشغّل لإرضاء اختبار.**
5. **`shipment.description` صار جزءاً من المجال** (حدّ 300 محرفاً، وداخل بصمة idempotency، ويُسلَّم للمحرّك) و**ممنوع أن يظهر في حدث** — حارسه في `events-privacy.test.ts`. أي DTO جديد في طبقة HTTP يجب أن يحترم هذا.
6. **لا `draft` في حالة الطلب:** القيد في `schema.sql` يسمح بـ`submitted` و`submission_failed` فقط، لأن التسليم يُحاوَل **قبل** كتابة الصف. لا تُخطّط لمسار «مسوّدة محفوظة».
7. **تشغيل التكامل محلياً:** `createdb wasla_customer_test` ثم `DATABASE_URL=… pnpm --filter @wasla/customers-service test:integration`؛ وبلا `DATABASE_URL` تُتخطّى المجموعتان ويبقى `pnpm -r test` أخضر.

### قرارات مثبَّتة لا تُعاد مناقشتها (ADR-009)

1. **ملفُّ دور لا هوية:** `wasla_public_id` مرجع opaque بـCHECK بلا FK؛ الوجود يُتحقَّق عبر `IdentityLookupPort`؛ الأدوار غير متعارضة (§7).
2. **النقطة = `zone_id` إلزامي** + `source` إلزامي؛ الإحداثية اختيارية **لا تُقرّر** تغطية ولا مطابقة ولا سعراً (لا Reverse Geocoding في النظام — §28).
3. **نقطتان بالضبط** الآن، مخزّنتان كقائمة مرتّبة، فـMulti-stop (§3.2) بلا هجرة.
4. **السعر وضعان:** `customer_offer` بمبلغ **عدد صحيح بالوحدة الصغرى** + ISO، أو `negotiable` بلا مبلغ. لا سعر استرشادي ولا `agreed_price` (Phase 08).
5. **`Idempotency-Key` إلزامي** على إنشاء طلب ومكان؛ التكرار الحقيقي يُعيد الكيان نفسه بـ200، والمفتاح نفسه بحمولة مختلفة 409.
6. **fail-closed:** تعذّر التسليم ⇒ صف `submission_failed` + حدث فشل + 503 `CUSTOMER_ORDER_INTAKE_UNAVAILABLE`. لا حفظ صامت.
7. **خصوصية الأحداث:** حمولة على مستوى المنطقة الفرعية، بلا إحداثيات خام وبلا نصوص كتبها المستخدم — قاعدة **مُختبَرة** لا موصوفة.

**مؤجّل صراحة (خارج نطاق المرحلة 04):** الطلبات المجدولة · Multi-stop · التسعير الذكي والسعر الاسترشادي · تفاوض العميل و`agreed_price` (Phase 08) · تاريخ الرحلات وسمعة السائق · `apps/customer-mini-app` (Phase 11) · تقارير الحوادث (Phase 12) · Reverse Geocoding وحساب المسافة (§28).

**العملان المنقولان من Phase 03 (لا يزالان قائمين):** مُشغّل دوري لـ`retryDueDeliveries` وناشر صندوق الصادر — انظر §7 وتفصيلهما في [CHANNEL_PERSISTENCE.md §7](../02-architecture/CHANNEL_PERSISTENCE.md). لم تلمسهما دفعة MR 1 لأنها عقود بلا تشغيل.

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
- [CHANNEL_LAYER_CORE.md — نواة طبقة القنوات (Phase 03 · MR 2)](../02-architecture/CHANNEL_LAYER_CORE.md)
- [CHANNEL_TELEGRAM_ADAPTER.md — مُهيّئ قناة Telegram (Phase 03 · MR 3)](../02-architecture/CHANNEL_TELEGRAM_ADAPTER.md)
- [CHANNEL_BOTS.md — البوتات وطبقة تشغيلها (Phase 03 · MR 4)](../02-architecture/CHANNEL_BOTS.md)
- [PHASE03_EXIT_GATE_E2E.md — بوابة خروج المرحلة 03 (Phase 03 · MR 7)](../12-testing/PHASE03_EXIT_GATE_E2E.md)
