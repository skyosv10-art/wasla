# HANDOFF — تسليم حالة المشروع للجهة التالية

> **النوع:** وثيقة تسليم (Handoff) واضحة لكل من سيعمل في المستودع بعد الجلسة الحالية.
>
> **القاعدة الحاكمة:** كل عمل يُدفع إلى المستودع يجب توثيقه، ويجب أن يعرف من يأتي بعدي «ماذا تمّ وماذا بقي» بدقّة، حتى إكمال المشروع 100%.
>
> **Last Updated:** 2026-08-22 (**Phase 07 = Completed** — MR 6/6 بوابة الخروج مدمجة وبها أُغلق الطور: `packages/dispatch-e2e` تُقلع ستّ خدمات بساعة واحدة مُحقونة وتُثبت المسار الكامل وثلاث نهايات غير سعيدة، ووظيفة `dispatch-exit-gate-e2e` تُعيدها على Postgres — والبوابة أسقطت عيباً كان يجعل **كل** قبول سائق يُرفض 422. التفصيل §11 و[PHASE07_EXIT_GATE_E2E.md](../12-testing/PHASE07_EXIT_GATE_E2E.md). **التالي: Phase 05 (Driver Core) أو Phase 08 (Negotiation & Chat) — §12**)
>
> **تحديث 2026-08-20 (c):** **Phase 00 = Completed (W0)**. تحقّق المالك من namespace → تفعّل shared runners. ظهر فشل في job `build-test` (typecheck) بسبب استخدام `node:fs`/`node:path`/`__dirname` دون `@types/node` مُعلَن — صُلح عبر [MR !9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9) (إضافة `@types/node`) الذي اجتاز CI بالكامل ودُمج. pipeline على `main` نجاح كامل (build-test + markdown-lint + repo-structure ✅). **Phase 00 Exit Gate اجتاز.**
>
> **تحديث 2026-08-20 (b):** [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) يُحدّد مكدّس تنفيذ خدمة Identity (Node 20 + TS + Fastify + PostgreSQL + Drizzle). كان على فرع MR !8 غير المدمج — يُضاف إلى `main` عبر MR تنظيف الحوكمة (انظر §4).

---

## 1. أين نقف الآن (Snapshot)

```text
المرحلة الحالية: **Phase 05 (Driver Core) — قيد التنفيذ** · MR 1/6 مدفوعة (العقود + ADR-012) · التالي MR 2/6 (§13)
                 (القرار اتُّخذ بالتوصية المكتوبة في §12: 05 قبل 08، لأنّ كل مرحلة تُبنى فوق 07
                  قبل 05 تُراكم منطقاً يفترض مرشّحين موثوقين وهم مُدّعون بعد)
                 Phase 07 أُغلقت 2026-08-22 بستّ مراجعات وبوابة خروج اجتازت (§11)
                 (المراجعات الستّ: العقود + ADR-011 · مجال المطابقة النقي · استمرارية المطابقة ·
                  مجال التوزيع النقي بالنبضة مُقدِّماً وحيداً للزمن · استمرارية التوزيع بوحدة عمل ·
                  طبقة HTTP على 8088/8089 والمحوّلات الإنتاجية · و**بوابة الخروج**: ستّ خدمات
                  مُنصتة بساعة واحدة مُحقونة، وقد أسقطت عيباً كان يُرفض به **كل** قبول سائق · §11)
                 (Phase 06 **أُغلقت** 2026-08-21 بستّ مراجعات وبوابة خروج اجتازت · §10)
المكتمل:         Phase 00 ✅ · Phase 01 ✅ · Phase 02 ✅ · Phase 03 ✅ · Phase 04 ✅ (أُغلقت 2026-08-21 بستّ مراجعات) —
                 كل بوابات الخروج مُتحقّقة آلياً في CI (db-integration لـidentity · geography-db-integration
                 لـgeography · channel-db-integration لمُهيّئات القناة · channel-exit-gate-e2e لبوابة المرحلة 03 · customer-db-integration و**customer-exit-gate-e2e** لبوابة المرحلة 04).
المتبقّي:         Phase 05 و Phase 08 → Phase 24 (انظر §3 للمسار الكامل، و§10 لما تُسلّمه Phase 06، و§11 لحالة المرحلة الحالية).
الاختبارات:       **1838 اختباراً على 26 مشروع عمل** (+1 متروك بقصد) في 110 ملفات — منها **5 لبوابة خروج الطور 07** + **33 اختبار تكامل على Postgres حقيقي**
                 في وظيفة `matching-db-integration` (Phase 07 · MR 3/6: 17 مُهيّئ + 11 مطابقة منافذ + 5 ذرّية —
                 تتخطّى نفسها بلا `DATABASE_URL`) + **47 اختبار تكامل في وظيفة `dispatch-db-integration`**
                 (Phase 07 · MR 5a/6: 29 مُهيّئ أمام قاعدة حقيقية + 12 مطابقة منافذ تُنفَّذ مرّتين
                 ذاكرة/Postgres والأثران يُقارَنان أحدهما بالآخر + 6 ذرّية تُثبت أنّ نبضةً كاملة
                 تتراجع بأسرها — تتخطّى نفسها بلا `DATABASE_URL`) — منها **160 لمجال التوزيع**
                 (142 من MR 4/6 + **18 حارس انحراف مرآة Drizzle↔DDL من MR 5a/6 يعمل بلا قاعدة**)
                 (Phase 07 · MR 4/6:
                 26 للنبضة + 17 للقبول + 14 للإلغاء + 14 حارس انحراف عقد يقرأ schema.sql وOpenAPI
                 وevents.json وerrors.md من القرص + 19 لآلات الحالات الثلاث + 13 للإنشاء + 12 للرفض
                 + 10 للمواعيد + 9 للخرائط + 8 لعقد الأحداث) و**136 لمجال المطابقة** (Phase 07 · MR 2/6 و3/6:
                 22 للفلاتر الثمانية بترتيبها وأكواد عجزها + 29 للدرجة وحسم التعادل + 26 للتقييم
                 من طرف إلى طرف + 23 للترشيح والتدقيق + 9 للخرائط والأحداث + 8 حارس انحراف ثلاثي
                 يقرأ schema.sql ووثيقة المجال من القرص) و24 لعقود المطابقة و22 لعقود التوزيع (MR 1/6)
                 و**558 لمحرّك الطلبات** (Phase 06 · MR 2/6:
                 441 مسح أزواج + 28 حارس مطابقة مزدوج مع ORDER_ENGINE §4 + الاستلام والإسناد والقراءة والتخطيط)
                 و108 لعقوده (MR 1/6)
                 (ومنها 11 اختبار بوابة خروج المرحلة 04 تعمل بمخازن الذاكرة
                 في كل `pnpm -r test` وعلى Postgres في وظيفة `customer-exit-gate-e2e`) (100 لخدمة العملاء: 48 لطبقة المجال + 34 لطبقة HTTP (`app.inject`) + 17 حراسة انحراف مخطّط
                 (تقرأ schema.sql فعلياً بلا قاعدة) + 1 حارس خصوصية لوصف الشحنة — idempotency وإعادة المحاولة على الصفّ نفسه
                 وfail-closed وبحث سلبي عن أي نصّ مستخدم أو إحداثية في الأحداث
                 + 42 لعقود Customer Core منها حرّاس حدود ADR-009 وقاعدة خصوصية الأحداث
                 + 96 + 34 لعقود القناة + 102 لنواة القناة + 99 لمُهيّئ Telegram
                 + 80 لطبقة تشغيل البوتات + 18 لجذور البوتات الثلاثة + 9 لحراسة مخطط القناة
                 + 7 من بوابة المرحلة 03 التي تعمل بمخازن الذاكرة أيضاً)
                 + 68 تكامل (4 سابقة + 21 لمُهيّئات Postgres للقناة + 43 لخدمة العملاء:
                 27 للمُهيّئ أمام قاعدة حقيقية + 16 مطابقة منافذ تُنفَّذ مرّتين ذاكرة/Postgres)
                 + 5 E2E سابقة في CI
                 + 8 في بوابة خروج المرحلة 03 (الثامن يفحص الصفوف).
                 التحقّق الكامل: `pnpm -r run typecheck` + `pnpm -r run test` — كلاهما نظيف على 20 مشروع عمل.
البوتات:         customer/driver/partner تطبيقات قابلة للنشر (8083/8084/8085) تخدم عقد القناة عبر
                 @wasla/bot-runtime — التخزين **دائم على Postgres** متى وُجِد DATABASE_URL
                 (منع التكرار وطابور المحاولات يعبران إعادة التشغيل)، وفي الذاكرة بغيابه للتشغيل المحلي.
المجموعات:       البوت يردّ في غرف **مُعلَنة في البيئة** فقط (دعم/تصعيد/مجتمع) برابط عميق لا بزر
                 Mini App، ولا يُهيّئ هوية من غرفة، ويصمت تماماً في غرفة غير مُعلَنة (تُسجَّل وتُدقَّق).
بوابة المرحلة:   مُثبَتة لا موصوفة — @wasla/channel-e2e يبني البوتات الثلاثة في عملية واحدة أمام خدمة
                 هوية واحدة تستمع على HTTP: كل بوت يفتح Mini App الخاصة به، وشخص واحد عبر الثلاثة
                 = هوية واحدة، والمُعاد لا يُعالَج مرّتين، والمُهيّئ قابل للاستبدال بـMockChannelAdapter.
آخر تحديث:      2026-08-22 (Phase 07 · MR 5a/6 — استمرارية التوزيع مُنفَّذة ومُختبَرة أمام Postgres حقيقي ·
                 التالية **MR 5b/6**: طبقة HTTP 8088/8089 والمحوّلات الإنتاجية — §11)
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

## 2-أ. ⛔ عائق CI قائم الآن (2026-08-22) — **حصّة دقائق التشغيل نفدت**

**العَرَض:** كل وظيفة في كل خط أنابيب منذ **2026-08-22 ~13:40 UTC** تفشل فوراً — قبل تنزيل الشيفرة — و`failure_reason` من واجهة GitLab هو **`ci_quota_exceeded`** لجميع الوظائف الثلاث عشرة بلا استثناء.

**التشخيص:** ليس عيباً في الشيفرة ولا في `.gitlab-ci.yml`. آخر خط أنابيب أخضر هو **#200** (`feat/dispatch-matching-http`، 11:44 UTC). ما بعده — بما فيه خط أنابيب `main` بعد دمج MR !49 وخط أنابيب MR !50 — فشل كلّه بالسبب نفسه. **دقائق CI المجانية للـnamespace نفدت.**

**ما لا يعنيه:** لا يعني أنّ MR !50 مكسورة. الأدلّة المحلّية مُسجَّلة في [TASK_LOG](TASK_LOG.md#) §6: البوابة 5/5 · المستودع 1838 ناجحاً + 1 متجاوَز في 110 ملفات · `typecheck` نظيف. المتعذّر إثباته حتى يُرفع العائق هو **مسار Postgres وحده** (وظيفة `dispatch-exit-gate-e2e`)، لأنّ بيئة التطوير في تلك الدفعة كانت بلا Postgres وبلا Docker.

**من يرفعه ⇒ مالك الحساب لا المطوّر.** أحد ثلاثة:

1. شراء دقائق إضافية أو ترقية الخطة للـnamespace `uxxxu`.
2. انتظار تجديد الحصّة الشهرية.
3. **الأمتن للمدى الطويل:** تسجيل **runner ذاتي الاستضافة** للمشروع (`Settings → CI/CD → Runners`)، فتصير الخطوط مستقلّة عن الحصّة المشتركة. وهذا خيار مذكور أصلاً في [CI_RUNNER_UNBLOCK.md](../14-runbooks/CI_RUNNER_UNBLOCK.md).

**قاعدة الدمج تبقى كما هي:** MR !50 **لا تُدمَج بخطّ أنابيب أحمر**؛ بعد رفع العائق يُعاد تشغيل الخط ويُشترَط خُضرة `dispatch-exit-gate-e2e` قبل الدمج. **لا يُستثنى أحد من البوابة لأنّ الحصّة نفدت** — البوابة التي تُتجاوَز مرّة تُتجاوَز دائماً.

---

## 2. عائق CI السابق — تمّ الحل ✅

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
Phase 04 Customer Core ................... ✅ Completed (2026-08-21) — Exit Gate E2E في CI (§9)
Phase 05 Driver Core ...................... ⏳ مفتوحة — Driver profile → Candidate pool (تسدّ دَيْن الأهليّة `claimed` → `driver_core` · §12)
Phase 06 Order Engine ..................... ✅ Completed (2026-08-21) — Exit Gate E2E في CI (§10)
Phase 07 Dispatch & Matching MVP .......... ✅ Completed (2026-08-22) — Exit Gate E2E في CI (§11)
Phase 08 Negotiation & Chat ............... ⏳ مفتوحة — تفاوض + توافق سعر (اعتمادها 07 وقد أُغلقت · على المسار الحرج · §12)
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

## 9. Phase 04 (Customer Core) — مكتملة ✅ (2026-08-21) · بوابة الخروج اجتازت

**الأساس:** [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · [CUSTOMER_CORE.md](../03-domain/CUSTOMER_CORE.md) · [عقود الخدمة](../../services/customers/contracts/README.md) · [CONTAINERS §4.1](../02-architecture/CONTAINERS.md)

**بوابة الخروج (من الوثيقة الأم §75):** «عميل ينشئ Order صالحًا ويصل إلى Order Engine دون أي Matching فعلي بعد».

**الحدّ الحاكم للمرحلة:** خدمة `services/customers` تُنتج **نيّة طلب مُتحقَّقة** وتُسلّمها عبر `OrderIntakePort`. **لا تكتب جدول `orders` ولا تُولّد `order_public_id` ولا تملك آلة حالة الطلب** (§15 · Phase 06). من يخالف هذا الحدّ تُسقطه اختبارات الحدود في `@wasla/contracts-customer`.

### خطة المراجعات (MRs) — ملزمة ومرتّبة

| # | النطاق | المخرَج | الحالة |
|---|---|---|---|
| 1 | docs + contracts | ADR-009 + `services/customers/contracts/*` + `@wasla/contracts-customer` + [CUSTOMER_CORE.md](../03-domain/CUSTOMER_CORE.md) + CONTAINERS §4.1 | ✅ **مدمجة ([!31](https://gitlab.com/uxxxu/wasla/-/merge_requests/31))** — 42 اختباراً |
| 2 | النطاق النقي | `services/customers/src/{domain,ports,use-cases,infrastructure}`: كيانات + المنافذ (`IdentityLookupPort` · `GeographyPort` · `OrderIntakePort` + مستودعات) + حالات الاستخدام (ملف · أماكن · معاينة · تسليم) + مُهيّئات in-memory/Fake — **بلا قاعدة وبلا HTTP** | ✅ **مدمجة ([!32](https://gitlab.com/uxxxu/wasla/-/merge_requests/32))** — 48 اختباراً · [CUSTOMER_CORE_DOMAIN.md](../02-architecture/CUSTOMER_CORE_DOMAIN.md) |
| 3 | الاستمرارية | `src/infrastructure/drizzle/{schema,db,repository}.ts` — مرآة Drizzle لـ`schema.sql` + `PostgresCustomerRepository` + `PostgresCustomerOutbox` + حراسة انحراف (17) + وظيفة CI `customer-db-integration` (قاعدة `wasla_customer_test`) + **مطابقة منافذ** (16 سيناريو × مُهيّئين) + حسم `shipment_description` **بالتبنّي** | ✅ **مدمجة ([!34](https://gitlab.com/uxxxu/wasla/-/merge_requests/34))** — 66 وحدة + 43 تكامل · [CUSTOMER_PERSISTENCE.md](../02-architecture/CUSTOMER_PERSISTENCE.md) |
| 4 | طبقة HTTP | `src/http/{requests,errors,app,server}.ts` — تطبيق Fastify على المنفذ **8086** + عشرة مسارات + تخطيط الأكواد الثمانية عشر إلى حالات HTTP (بلا كود جديد) + `/health` بحالتيه + محوّلا HTTP للهوية والجغرافيا + `x-request-id` → `trace_id` | ✅ **مدمجة ([!35](https://gitlab.com/uxxxu/wasla/-/merge_requests/35))** — 34 اختبار `app.inject` · [CUSTOMER_HTTP.md](../04-api/CUSTOMER_HTTP.md) |
| 5 | البوت | ربط `bots/customer-bot` بالخدمة مع **الحفاظ على حياد القناة** (ADR-007) عبر **بذرة محادثة محيّدة** في `@wasla/bot-runtime`: `/start` (ضمان الملف صامتاً) · `/places` · `/orders`. **إنشاء الطلب أُسنِد إلى Phase 11** بحجّة منتجية مكتوبة لا بحجّة تقنية | ✅ **مدمجة ([!36](https://gitlab.com/uxxxu/wasla/-/merge_requests/36))** — 29 اختباراً · [CUSTOMER_BOT_FLOWS.md](../02-architecture/CUSTOMER_BOT_FLOWS.md) |
| 6 | بوابة الخروج | E2E: عميل ينشئ طلباً صالحاً يصل إلى **محرّك طلبات بديل (stub)** يحترم `OrderIntakeRequest` + وظيفة CI `customer-exit-gate-e2e` + وثيقة البوابة + إغلاق المرحلة | ✅ **مدمجة ([!37](https://gitlab.com/uxxxu/wasla/-/merge_requests/37))** — 11 اختباراً (ذاكرة + Postgres) · [PHASE04_EXIT_GATE_E2E.md](../12-testing/PHASE04_EXIT_GATE_E2E.md) |

**ما صار قائماً بعد MR 3/6:** خدمة `services/customers` صارت تملك **مسار تخزين دائماً** وراء منافذها نفسها: `createCustomerDb({connectionString})` يُنشئ تجمّع `pg` + `drizzle`، و`PostgresCustomerRepository` و`PostgresCustomerOutbox` ينفّذان `CustomerRepository` و`Outbox` بلا توسيع للمنافذ، وكلّها مُصدَّرة من `src/index.ts`. و**لم يتغيّر ملف واحد في `src/use-cases/`** — وهذا هو المعيار: أي اضطرار لتغيير سلوك هناك دليلٌ على أن المخطّط بدأ يقود المجال. مصدر الـDDL يبقى `contracts/schema.sql` اليدوي؛ مرآة Drizzle مستهلِك له، و`schema-drift.test.ts` يقرأ العقد فعلياً فيكسر البناء عند أي انحراف، و`drizzle.config.ts` أداة محلية لا تُشغَّل في CI.

**ما صار قائماً بعد MR 5/6:** للنواة **مستهلك حقيقي**. `@wasla/bot-runtime` يقبل الآن `onConversation`: دالّة واحدة يُسلّمها الجذر، تأخذ `ConversationEvent` محايداً وتُعيد نصاً أو `null`. طبقة القناة **لم تتعلّم** وجود مجال (لا فرع `bot === "customer"`)، و`receiveUpdate` صار يُتيح `actor` المحيّد ليُحلّ الهوية عند أمر غير `start`. وبوت العميل يربط ثلاثة تدفقات في `flows.ts` وراء `CustomerFlowsPort`، والاعتماد على `@wasla/customers-service` يعيش في **ملف واحد** (`customer-core.ts`). و`CUSTOMER_DATABASE_URL` هو **بوّابة** التدفقات: بغيابه لا يُسجَّل `/places` ولا `/orders` (422) ولا يوجد بديل في الذاكرة — عن قصد ([CUSTOMER_BOT_FLOWS §8](../02-architecture/CUSTOMER_BOT_FLOWS.md)).

**ما صار قائماً بعد MR 6/6 (إغلاق المرحلة):** بوابة الخروج **مُثبَتة لا موصوفة**. `packages/customer-e2e` (خاصة، اختبارات فقط، بلا كود تشغيلي) تبني في عملية واحدة: خدمة هوية حقيقية على HTTP، خدمة جغرافيا حقيقية ببذرة السعودية، نواة العميل عبر `createCustomerApp` على منفذ حقيقي، بوت العميل بـ`MockChannelAdapter` وبـ**نفس `UseCaseDeps`** التي يستعملها مسار HTTP، ومحرّك طلبات بديل على `node:http` **يقرأ عقد `OrderIntakeRequest` ويرفض بـ400 أي جسم لا يطابقه** (بما فيه أي مفتاح camelCase). المحوّل الذي يُسلّم إليه **مملوك للبوابة لا للإنتاج** ويُسَلسِل عبر مخطّط الخدمة نفسه `toOrderIntakeRequestDto`. النتيجة: 11/11 بمخازن الذاكرة **و**على Postgres حقيقي، و`pnpm -r test` = 627 اختباراً على 18 مشروعاً.

**ما يجب أن يعرفه من يبدأ Phase 06 (Order Engine) قبل أن يكتب سطراً:**

1. **المحرّك البديل هو مواصفتك التنفيذية.** `packages/customer-e2e/src/stub-order-engine.ts` يقول بالضبط ما نرسله: `order_request_id` · `customer_public_id` · `order_type` · `vehicle_class` · `price_mode` · `offered_price {amount_minor عدد صحيح, currency}` · `stops` **نقطتان** بـ`zone_id` و`source` و`kind` · `shipment` · `notes` · `requested_at` · `idempotency_key`، وترويسة `Idempotency-Key` بمفتاح **العميل** لا بمفتاح ثانٍ.
2. **دلالة الحالات مُثبَّتة باختبار:** `201`/`200` مع `{order_public_id, accepted_at}` ⇒ نجاح · `422` ⇒ «فهمتُ ورفضت» ⇒ `CUSTOMER_ORDER_INTAKE_REJECTED` · أي حالة أخرى (بما فيها `400`) ⇒ `CUSTOMER_ORDER_INTAKE_UNAVAILABLE` لأنها خطؤنا لا رفضك · انعدام الإجابة ⇒ `CUSTOMER_ORDER_INTAKE_TIMEOUT`. **والحالة الأخيرة تُلزمك بمعاملة المفتاح كأنّه قد رُئي** — البوابة تُثبت أن الطلب وصلك قبل أن تنقطع الإجابة.
3. **أنت من يُنفّذ `HttpOrderIntakePort` الإنتاجي** (عنوان المحرّك ومصادقته وسياسة إعادة محاولته)، كما ينصّ `OrderIntakeRequest` في `services/customers/contracts/api.openapi.yml`. لا تُعِد استخدام محوّل البوابة: هو أداة اختبار في حزمة خاصة بقصد.
4. **`order_public_id` تملكه أنت.** خدمة العملاء تخزّن ما أعطيتها ولا تولّده، ولا تملك آلة حالة الطلب. أي تغيير يجعل الخدمة تُولّده يكسر حرّاس حدود `@wasla/contracts-customer`.
5. **بوابة المرحلة 04 يجب أن تبقى خضراء بعد عملك.** إن غيّرت شكل الحمولة، فالمكان الذي يجب أن يُعدَّل هو **العقد ثمّ `toOrderIntakeRequestDto`**، والمحرّك البديل يُحدَّث معهما — لا العكس.

**ما يجب أن يعرفه من يبدأ MR 6/6 قبل أن يكتب سطراً** (بقي هنا كسجلٍّ لِما كان ملزماً، والنقاط 3..7 قيود دائمة لا تنتهي بدفعة) (النقطتان 1 و2 حُسمتا في MR 4/6):

1. **حُسمت في MR 4/6:** `src/http/server.ts` صار التركيب النهائي والمنادي الوحيد لـ`createCustomerDb`، ويُغلق التجمّع في `onClose`. استيراد الحزمة ما زال لا يلمس الشبكة. **ولا تربط البوت بـHTTP:** البوت ينادي حالات الاستخدام **مباشرة** في العملية نفسها (ADR-007)، فطبقة HTTP للمستهلكين خارج العملية لا للقناة.
2. **دَين الذرّية ما زال قائماً وأُعيد إسناده — بصراحة.** كتابة الصف وإلحاق الحدث **ليسا في معاملة واحدة**، فثمّة نافذة فشل تترك طلباً مسجّلاً بلا حدثه. **MR 4/6 لم تسدّه خلافاً لما وعدت به هذه الفقرة سابقاً:** منفذ وحدة-عمل يمسّ أربع حالات استخدام ومُهيّئين وطاقم مطابقة المنافذ، فهو دفعةٌ كاملة لا إضافة على طبقة توصيل، وسدُّه داخل MR 4/6 كان سيخلط تغييراً معمارياً بطبقة نقل في مراجعة واحدة. أُعيد إسناده إلى **Phase 09 (ناشر صندوق الصادر)** حيث يظهر أول مستهلك يتضرّر من حدثٍ ناقص ([CUSTOMER_PERSISTENCE.md §7](../02-architecture/CUSTOMER_PERSISTENCE.md) · [CUSTOMER_HTTP.md §8](../04-api/CUSTOMER_HTTP.md)). **لا تُسدّه في MR 5/6 ولا 6/6** — بوابة الخروج ليست موضع تغيير معماري.
3. **`customer_outbox` بلا `trace_id`.** الحدث المُعاد بناؤه من القاعدة يفقد معرّف ارتباطه. لم يُخترع عمود خارج العقد؛ من يحتاجه هو الناشر (Phase 09) وهو من يجب أن يُضيفه بهجرة موثّقة.
4. **`updated_at` تملكه القاعدة** عبر المُشغّل `customer_set_updated_at`، فالساعة المُحقونة لا تُطبَّق على Postgres عند التحديث. لا حالة استخدام تقرأه لاتّخاذ قرار، واختبار المطابقة يُسقطه ويتحقّق من الاتّجاه فقط. **لا تُعدّل المُشغّل لإرضاء اختبار.**
5. **`shipment.description` صار جزءاً من المجال** (حدّ 300 محرفاً، وداخل بصمة idempotency، ويُسلَّم للمحرّك) و**ممنوع أن يظهر في حدث** — حارسه في `events-privacy.test.ts`. أي DTO جديد في طبقة HTTP يجب أن يحترم هذا.
6. **لا `draft` في حالة الطلب:** القيد في `schema.sql` يسمح بـ`submitted` و`submission_failed` فقط، لأن التسليم يُحاوَل **قبل** كتابة الصف. لا تُخطّط لمسار «مسوّدة محفوظة».
7. **تشغيل التكامل محلياً:** `createdb wasla_customer_test` ثم `DATABASE_URL=… pnpm --filter @wasla/customers-service test:integration`؛ وبلا `DATABASE_URL` تُتخطّى المجموعتان ويبقى `pnpm -r test` أخضر.
8. **حدّ التحقّق مضبوط ولا يُنقَل:** طبقة HTTP تتحقّق من **الشكل فقط**، وكل قاعدة ذات معنى في `domain/validation.ts`. سبب ذلك هو أنت: البوت ينادي حالات الاستخدام مباشرة، فأي قاعدة تُكتب في HTTP تصبح قاعدة لا تراها القناة، فيُقبل عبر تلغرام ما يُرفض عبر HTTP. **لا تكتب تحقّقاً في `bots/customer-bot` أيضاً** — اشتقّ رسالة المستخدم من كود الخطأ المرفوع.
9. **مفتاح الـidempotency للبوت يجب أن يكون مشتقّاً من رسالة القناة** (لا مولَّداً عند كل نقرة)، وإلا فإعادة إرسال تلغرام للتحديث نفسه تُنتج طلبين. طبقة القناة تملك منع تكرار التحديثات على مستوى البوت، لكن الطلب يحتاج مفتاحه الخاص بطول 8..128.
10. **~~`/health` يبقى `degraded`~~ — حُسم في Phase 06 · MR 5/6:** المُهيّئ الحقيقي (`HttpOrderIntakePort`) موجود، و`ORDER_SERVICE_URL` مضبوطاً يجعل `/health` = `ok`؛ وبغيره يبقى `degraded` وكل تسليم يفشل مغلقاً كما كان. لا «تُصلح» هذا في MR 5/6 بجعل الافتراضي متسامحاً: كل تسليم يجب أن يفشل مغلقاً حتى يوجد محرّك — وبوابة الخروج 6/6 هي من تُدخل **محرّكاً بديلاً (stub)** يحترم `OrderIntakeRequest`، لا مُهيّئاً متسامحاً.
11. **إنشاء الطلب ليس في البوت ولن يكون في MR 6/6.** MR 5/6 أسنَدته إلى **Phase 11** (التطبيق المصغّر) لأن الطلب الصالح يحتاج محطّتين بمنطقة ومصدر وصنف مركبة ونمط سعر، و[USER_FLOWS §1 و§6](../01-product/USER_FLOWS.md) يضع الأعمال الثقيلة في التطبيق. فبوابة الخروج تُشغّل المسار **من حالة الاستخدام** (`submitOrderRequest`) لا من رسالة تلغرام: هي تُثبت أن السلسلة تعمل، لا أنها تُدار من محادثة.
12. **بذرة المحادثة سطح عامّ الآن.** أي تدفّق لبوت السائق (Phase 06) أو الشريك (Phase 08) يجب أن يُبنى عليها لا بفرع في طبقة القناة، والحدث المحايد **مفاتيحه مُثبَّتة باختبار**: إضافة حقل قناة إليه تُفشِل `conversation.test.ts` بقصد.
13. **لا تُصلح صمت الفشل غير المجاليّ.** فشل غير متوقّع في تدفّق يُسجَّل بـ`trace_id` ويبقى الويب هوك 202: إرجاع 5xx يجعل تيليجرام يُعيد تحديثاً مُسجَّلاً كمُعالَج فيُرفَض كتكرار — تُفقَد الرسالة **و**يُستهلك بدل المحاولات.

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

## 10. Phase 06 (Order Engine) — مكتملة ✅ (2026-08-21) · بوابة الخروج اجتازت (MR 1/6 → 6/6 مدمجة)

**الأساس:** [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) · [ORDER_ENGINE.md](../03-domain/ORDER_ENGINE.md) · [عقود الخدمة](../../services/orders/contracts/README.md) · [CONTAINERS §4.2](../02-architecture/CONTAINERS.md)

**بوابة الخروج (من الوثيقة الأم §77):** «يمكن إنشاء Order وتغييره عبر الحالة **دون حالات مستحيلة**».

**لماذا تُنفَّذ 06 قبل 05 (Driver Core):** لأن المحرّك يخزّن **مرجع** سائق (`driver_public_id` نصّ بقيد CHECK على الشكل، **بلا FK**) ولا يحكم على أهليّته. المسار الحرج في [ROADMAP §3](ROADMAP.md) هو `00 → 01 → 02 → 04 → 06 → 07 → 09 → 20` — و05 خارجه أصلاً، فلا انحراف عن الترتيب ولا ADR ترتيب مطلوب. من يبني Phase 05 لاحقاً **لا يحتاج هجرة**: يضيف خدمته ويظلّ المرجع كما هو.

### تعريف «الحالة المستحيلة» — قابل للقياس لا بلاغي

عبارةُ بوابة الخروج غامضة كما كُتبت، فعُرِّفت في ADR-010 §7 في **أربع صور** يفشل البناء إن ظهرت أيٌّ منها:

1. **انتقال خارج الجدول المنشور** — الجدول 72 زوجاً من 441، وما ليس فيه مرفوض بـ`ORDER_ILLEGAL_TRANSITION`.
2. **سهم يخرج من حالة نهائية** — الحالات النهائية السبع مُغلَقة، فلا «إحياء» طلب مُلغى.
3. **حالة لا يمكن الوصول إليها من `published`** — حالةٌ لا يصلها أحد هي حالة ميتة في الكود وكذبة في الوثيقة.
4. **صفٌّ في القاعدة يخالف قيداً مُسمّى** — مثل حالة `assigned` بلا إسناد نشيط، أو حالة نهائية بلا سبب.

الصور الأربع تُختبَر على **ثلاث طبقات**: العقد (منجَز · MR 1/6) · المجال (منجَز · MR 2/6 — **مسح 441 زوجاً فعلي** في `transition-order.test.ts`) · القاعدة (منجَز · MR 3/6 — مُهيّئات Postgres + حراسة انحراف). و**بوابة الخروج (MR 6/6 · منجَزة) أعادت المسح على التركيب الكامل فوق HTTP** — 441 زوجاً على خدمتين تستمعان فعلاً، فصارت الصور الأربع مُثبَتة على أربع طبقات لا ثلاث.

### خطة المراجعات (MRs) — ملزمة ومرتّبة

| # | النطاق | المخرَج | الحالة |
|---|---|---|---|
| 1 | docs + contracts | ADR-010 + `services/orders/contracts/*` (schema.sql · api.openapi.yml · events.json · errors.md) + `@wasla/contracts-order` + [ORDER_ENGINE.md](../03-domain/ORDER_ENGINE.md) + CONTAINERS §4.2 | ✅ **منجَزة** — **108 اختباراً** (38 عقود · 31 حدود · 21 جدول انتقالات · 18 أحداث) |
| 2 | المجال النقي | `services/orders/src/{domain,ports,use-cases,infrastructure}`: `domain/state-machine.ts` بجدول **صريح** + الكيانات + التحقّق + مصانع الأحداث + المنافذ ومُهيّئات الذاكرة — **بلا قاعدة وبلا HTTP** | ✅ **منجَزة** — **558 اختباراً** ([ORDER_CORE_DOMAIN.md](../02-architecture/ORDER_CORE_DOMAIN.md) · [MR !39](https://gitlab.com/uxxxu/wasla/-/merge_requests/39)) |
| 3 | الاستمرارية | مرآة Drizzle لـ`schema.sql` + `PostgresOrderRepository` + سجل التدقيق و`order_outbox` في **معاملة واحدة** مع تغيير الحالة + حراسة انحراف + وظيفة CI `order-db-integration` + مطابقة منافذ | ✅ **منجَزة** — **30 اختبار تكامل** (19 مستودع + 4 ذرّية + 7 مطابقة منافذ) ([ORDER_PERSISTENCE.md](../02-architecture/ORDER_PERSISTENCE.md) · [MR !40](https://gitlab.com/uxxxu/wasla/-/merge_requests/40)) |
| 4 | طبقة HTTP | تطبيق Fastify على المنفذ **8087** + المسارات السبعة + `POST /orders/intake` + مسار الانتقالات + تخطيط الأكواد الثمانية عشر + `/health` | ✅ **منجَزة** — **46 اختبار `app.inject`** (621 للخدمة) + مقبس معاملة `OrderRunner` + نطاق مالك 404 ([ORDER_HTTP.md](../04-api/ORDER_HTTP.md) · [MR !41](https://gitlab.com/uxxxu/wasla/-/merge_requests/41)) |
| 5 | سدّ دَين Phase 04 | `HttpOrderIntakePort` **إنتاجي** داخل `services/customers` بدلاً من `UnavailableOrderIntake` — فيصبح تسليم الطلب حقيقياً بين خدمتين | ✅ **منجَزة** — **17 اختباراً على مُنصت حقيقي** (117 للحزمة) + خريطة حالات مُصرَّحة + `/health` = `ok` + تسليم فعلي بين خدمتين تعملان ([ORDER_INTAKE_HANDOVER.md](../04-api/ORDER_INTAKE_HANDOVER.md) · [MR !42](https://gitlab.com/uxxxu/wasla/-/merge_requests/42)) |
| 6 | بوابة الخروج | `packages/order-e2e`: رحلة طلب كاملة + **محاولة الـ441 زوجاً** + وظيفة CI + وثيقة البوابة + إغلاق المرحلة | ✅ **منجَزة** — **16 اختباراً** (رحلة كاملة + مسح 441 زوجاً فوق HTTP + حارس انزلاق يقرأ العقد وقت التشغيل) بمخزن ذاكرة وعلى Postgres في وظيفة `order-exit-gate-e2e` · إجمالي المستودع **1402 اختباراً** ([PHASE06_EXIT_GATE_E2E.md](../12-testing/PHASE06_EXIT_GATE_E2E.md) · [MR !43](https://gitlab.com/uxxxu/wasla/-/merge_requests/43)) |

### ما أنجزته MR 1/6 بالضبط

- **`services/orders/contracts/schema.sql`** — خمسة جداول (`orders` · `order_stops` · `order_status_history` · `order_assignments` · `order_outbox`) + متتالية `order_public_id_seq` + دالّة trigger للتحديث. القيود **مُسمّاة** لتمنع بالبناء ما كان سيُترك للمراجعة البشرية: `ck_orders_assignment_matches_status` (لا إسناد نشيط في حالة بحث، ولا حالة مُسنَدة بلا إسناد) · `ck_orders_terminal_needs_reason` · `ck_orders_price_mode_amount` و`ck_orders_money_complete` (مبلغ **عدد صحيح** بالوحدة الصغرى) · `ck_orders_shipment_only_delivery` · `ck_order_status_history_progresses` · وفرائد التسلسل. **والـDDL مُتحقَّقة على Postgres 18.4 فعلياً** لا مقروءة: الجداول أُنشئت، والقيود رفضت الستّ حالات المخالفة، وأول إدخال صالح أنتج `ORD-0000000001`.
- **`api.openapi.yml`** — المنفذ 8087 وسبعة مسارات: `/health` · `POST /orders/intake` · `GET /orders/{id}` · `GET /orders/{id}/history` · `POST /orders/{id}/transitions` · `POST /orders/{id}/assignments` · `PATCH …/assignments/{assignmentId}`.
- **`events.json`** — أربعة أحداث (`OrderCreatedV1` · `OrderStatusChangedV1` · `OrderAssignmentOfferedV1` · `OrderAssignmentResolvedV1`) في مغلّف واحد، **بالمنطقة لا بالإحداثية** وبلا نصّ كتبه المستخدم.
- **`errors.md`** — **18 كود خطأ و24 سبباً** في كتالوج **مُغلَق**: كودٌ غير مذكور فيه يُسقط اختبار حراسة.
- **`@wasla/contracts-order`** — الأنواع المُكتبة (مُولَّدة من OpenAPI) + **108 اختباراً**، منها **21 اختباراً تقرأ جدول الانتقالات من الوثيقة نفسها** (`docs/03-domain/ORDER_ENGINE.md`) فتفشل إن اختلف العدد المعلن عن عدد الصفوف، أو ظهر انتقال ذاتي، أو خرج سهم من حالة نهائية، أو صارت حالة غير قابلة للوصول. **الوثيقة صارت مُختبَرة، لا مقروءة.**

### ما أنجزته MR 2/6 بالضبط

مشروع العمل العشرون `@wasla/orders-service` — طبقة مجال كاملة **بلا بنية تحتية**: تعمل في ~1.4 ثانية بلا قاعدة ولا شبكة. التفصيل المعماري في [ORDER_CORE_DOMAIN.md](../02-architecture/ORDER_CORE_DOMAIN.md)، وما يجب معرفته قبل MR 3/6:

- **`domain/state-machine.ts` هو الجدول نفسه** — 72 صفّاً صريحاً، كل صفّ يُسمّي المصدر والهدف والفاعل المتوقَّع والسبب النمطي. والاشتقاقات تُحسَب منه لا تُعلَن: `DERIVED_TERMINAL_STATUSES` (وتُختبَر مطابقتها لـ`ORDER_TERMINAL_STATUSES`) · `reachableStatuses` · `requiresReasonCode` · `assignmentRequirement` بثلاث درجات `{required: 6, forbidden: 4, optional: 11}` مرآةً لقيد `ck_orders_assignment_matches_status`.
- **حارس المطابقة المزدوج يعمل** — `state-machine.test.ts` تقرأ [ORDER_ENGINE §4](../03-domain/ORDER_ENGINE.md) وتُقارنها بالكود **في الاتجاهين** صفّاً بصفّ (المصدر · الهدف · الفاعل · السبب)، وتتحقّق أن العدد المعلن في كل عنوان حالة يطابق صفوفه. صفٌّ في الكود غير موثّق يُسقط المجموعة، وصفٌّ موثّق غير مُنفَّذ كذلك. **الوثيقة هي المصدر، لا التعليق.**
- **المسح الحقيقي منجَز الآن لا في MR 6/6** — `transition-order.test.ts` تُنشئ طلباً وتسوقه إلى كل حالة من الـ21 بأقصر مسار ثمّ تُجرّب الانتقال إلى كل حالة من الـ21: المسموح ينجح والباقي `ORDER_ILLEGAL_TRANSITION` (409). 441 حالة اختبار فعلية.
- **خصائص [ORDER_ENGINE §5](../03-domain/ORDER_ENGINE.md): 1–11 مُثبَتة**، والخاصية 12 (تطابق المخزنين) محلّها MR 3/6 — والمجموعة مكتوبة أصلاً لتُشغَّل على مخزن ثانٍ بلا تعديل (المُهيّئات كلّها وراء `OrderDependencies`).
- **ترتيب الفحص عقدٌ مُختبَر** لا تفصيل تنفيذ: 404 → 409 (الجدول) → 422 (السبب) → 422 (شكل الفاعل) → 422 (حرّاس الإسناد). من يبني طبقة HTTP في MR 4/6 يعتمد عليه.
- **الفاعل: الشكل مُلزِم والهوية لا** — عمود «الفاعل المتوقَّع» في الجدول **ليس** مُلزَماً في Phase 06 لعدم وجود مصادقة؛ المُلزَم هو `system` بلا مرجع، والبشري بمرجع يطابق `WS-##########`. مكتوب صراحةً في الكود كي لا يُقرَأ العمود كضمانٍ غير موجود.
- **الإسناد سجلٌّ لا محرّك — والقبول لا يربط ولا يُحرّك الحالة** — `resolveAssignment(accepted)` يكتب سجلّ الإسناد فقط؛ **الربط يحدث داخل `transitionOrder` في نفس عبارة التحديث التي تُحرّك الحالة** (صُحّح في MR 6/6: الربط الفوري كان يُنتج صفّاً `offered` بإسناد نشط ترفضه القاعدة — انظر [وثيقة البوابة §5](../12-testing/PHASE06_EXIT_GATE_E2E.md)). وتحريك الحالة عند القبول كان سيُنتج تغييرَ حالةٍ واحداً لم يمرّ بالجدول. وفكّ الإسناد له **مالك واحد**: `transitionOrder` حين يعود الطلب إلى ما قبل القبول. ولا فرع «تحرير» في الحلّ: العرض يُحلّ مرّة واحدة، وسائقٌ يتراجع بعد القبول هو انتقالٌ إلى `driver_cancelled` لا صفٌّ يُعاد كتابته.
- **الاستلام: ثلاث نتائج + رابعة** — مفتاح جديد ⇒ إنشاء بحدثين · مفتاح مُعاد بحمولة مطابقة ⇒ نفس الطلب بلا حدث ثانٍ · بحمولة مختلفة ⇒ `ORDER_IDEMPOTENCY_KEY_REUSED` · و`order_request_id` مُسلَّم سابقاً بمفتاح آخر ⇒ `ORDER_REQUEST_ALREADY_INGESTED`. والبصمة تتجاهل `traceId` والمفتاح، فإعادة المحاولة بتتبّع جديد تبقى إعادة محاولة.
- **التدقيق والنشر متلازمان بالعدد** — صفوف التاريخ = الانتقالات + 1، وأحداث `status_changed` = صفوف التاريخ، والصفوف متلاصقة، و`from_status = null` مرّة واحدة في عمر الطلب. مقيسة لا موصوفة.

### ما أنجزته MR 3/6 بالضبط

خدمة الطلبات صارت تملك **مسار تخزين دائماً وذرّياً** وراء منافذها نفسها: `infrastructure/drizzle/{schema,db,repository,transaction}.ts`. التفصيل المعماري في [ORDER_PERSISTENCE.md](../02-architecture/ORDER_PERSISTENCE.md)، وما يجب معرفته قبل MR 4/6:

- **`PostgresOrderUnitOfWork` يُسدّ دَين الذرّية** ([ADR-010 §127](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md)) — يفتح معاملة Drizzle واحدة ويسلّم **نفس المقبض** (`DbOrTx`) إلى `PostgresOrderRepository` و`PostgresOrderOutbox` و`PostgresOrderPublicIdGenerator`، فالكتابة الثلاثية (تغيير الحالة · صفّ التدقيق · صفّ الصادر) ذرّية: إخفاقٌ بعد كتابة المستودع يتراجع بكل ما كُتب. و**لم يتغيّر ملف واحد في `src/use-cases/`** — وهو المعيار المكتوب، والمعاكس له في Phase 04 ([CUSTOMER_PERSISTENCE.md](../02-architecture/CUSTOMER_PERSISTENCE.md)).
- **المُهيّئات بلا توسيع للمنافذ** — `PostgresOrderRepository` و`PostgresOrderOutbox` ينفّذان `OrderRepository` و`Outbox` كما هما، يقبلان `DbOrTx` فيمكن أن يعملا على الجذر أو داخل معاملة. `PostgresOrderPublicIdGenerator` يستخدم `nextval('order_public_id_seq')` لا عدّاد تطبيقي.
- **ترجمة أخطاء القاعدة إلى كوديات المجال** — SQLSTATE 23505 (تكرار) يُترجَم إلى `ORDER_IDEMPOTENCY_KEY_REUSED`/`ORDER_REQUEST_ALREADY_INGESTED`، و23503 (مفتاح غريب) إلى `ORDER_NOT_FOUND`/`ORDER_ASSIGNMENT_NOT_FOUND`، و23514 (CHECK) إلى `ORDER_ASSIGNMENT_FORBIDDEN`.
- **ثلاث طبقات تحقّق**: **17** حراسة انحراف تقرأ `schema.sql` فعلياً (تعمل بلا قاعدة) · **19** اختبار مستودع على Postgres حقيقي · **16** اختبار مطابقة منافذ تُكتب مرّة وتُنفَّذ مرّتين (ذاكرة/Postgres) داخل حالات الاستخدام نفسها ببصمة مطابقة، **الفرق الوحيد المُسموح هو `orderPublicId` (متتالية Postgres) و`updatedAt` (توقيت السطر)**.
- **أربعة اختبارات ذرّية** تُثبت التراجع: (1) صادر يفشل بعد كتابة المستودع ⇒ كل الصفوف غائبة · (2) فشلٌ بعد عودة حالة الاستخدام ⇒ صفّ الصادر الحقيقي غائب · (3) فشلٌ أثناء الانتقال ⇒ الحالة لم تتغيّر · (4) نجاح ⇒ الكتابة الثلاثية كلّها ملتزمة.
- **محدودية مُعلَنة:** `nextval()` ليس ذرّياً في PostgreSQL — قد تظهر فجوات في الترقيم بعد التراجع/إعادة المحاولة، والمُلزَم هو التفرّد والرتابة لا التسلسل بلا فجوات ([ORDER_PERSISTENCE.md §7](../02-architecture/ORDER_PERSISTENCE.md)).

### ما أنجزته MR 4/6 بالضبط ([!41](https://gitlab.com/uxxxu/wasla/-/merge_requests/41))

خدمة الطلبات صارت **قابلة للتشغيل**: `src/http/{requests,errors,app,server}.ts` + `src/runner.ts` + `infrastructure/drizzle/runner.ts`. التفصيل في [ORDER_HTTP.md](../04-api/ORDER_HTTP.md)، وما يجب معرفته قبل MR 5/6:

- **`OrderRunner` هو مقبس المعاملة، والمصنع لا يستقبل تبعيات.** `createOrderApp({runner, health?, logger?})`: `runner.write(work)` يشغّل العمل داخل `PostgresOrderUnitOfWork` (فالكتابة الثلاثية تبقى ذرّية) و`runner.read(work)` على الاتصال الجذري. **لا تُمرّر `deps` إلى التطبيق** ولا تفتح معاملة داخل معالج مسار: قرار المعاملة يقع في موضع واحد قابل للمراجعة، ولذلك لم يتغيّر ملف واحد في `src/use-cases/` في هذه الدفعة أيضاً.
- **القراءة مقصورة على المالك بـ404 لا 403.** `X-Customer-Public-Id` إلزامية في القراءتين، وطلب عميل آخر يُجاب بـ`ORDER_NOT_FOUND` بالشكل نفسه **وفي السجلّ أيضاً**، لأن `order_public_id` تسلسلي فـ403 يحوّل المسار إلى عرّاف وجود يُعدّ به من يشاء طلبات المنصّة. **لا تُحوّلها إلى 403 «لأنها أوضح».**
- **`{orderId}` يقبل UUID أو `ORD-##########`** (انحراف مُعلَن رقم 2 في [ORDER_HTTP.md §8](../04-api/ORDER_HTTP.md)) لأن استجابة الاستلام تُعيد المُعرّف العام فقط. **لا تُضِف المُعرّف الداخلي إلى استجابة الاستلام** كي «يُبسّط» المسار: مقبضان لشيء واحد وأحدهما لا يجب أن يخرج.
- **الاستلام 201 جديد · 200 إعادة تشغيل مفتاح** — MR 5/6 يعتمد على هذا التمييز بلا مقارنة أجسام. وتسجيل العرض 201 وحسمه 200.
- **`Idempotency-Key` إلزامية في الكتابات الأربع كلّها** (8–128)، تُقرأ **قبل** تحليل الجسم، وترويسة مكرّرة تُرفض بدل تخمين القيمة، و`idempotency_key` في الجسم إن خالف الترويسة ⇒ 400.
- **كتالوجات التعدادات صارت قيماً وقت التشغيل** في `@wasla/contracts-order` (`ORDER_TYPES` … `ORDER_SHIPMENT_TYPES`) وكلٌّ منها مُقارَن باختبار بتعداد `api.openapi.yml`. الأنواع تتبخّر عند التشغيل، فالحدّ يرفض عضواً مجهولاً بـ400 ولا يحمله إلى الداخل. **أضِف أي تعداد جديد هنا لا في مصفوفة داخل معالج مسار.**
- **`assertNotes` أُضيف إلى المجال** لأن قيد `notes ≤ 300` في `schema.sql` كان بلا مقابل مُرمَّز: مخزن الذاكرة يقبل 400 محرف وPostgres يرفضها بـ503 لما هو 400. الإصلاح في `domain/validation.ts` **لا في HTTP** لأن Phase 07 ينادي حالات الاستخدام مباشرة.
- **غلاف الخطأ `{code, message, trace_id}` فقط** مطابقةً لـ`ErrorResponse`؛ اسم الحقل المخالف في الرسالة والسجلّ لا في حقل بنيوي. و**404 لمسار غير موجود لا يُترجَم إلى `ORDER_NOT_FOUND`** (اختبار صريح).
- **الأدلّة:** `@wasla/orders-service` **621 اختباراً** (منها 46 عبر `app.inject`) · `@wasla/contracts-order` **119** · `pnpm -r typecheck` و`pnpm -r test` ✅ · تشغيل فعلي على منفذ حقيقي: `/health` = `degraded/memory` واستلام = 201.

### ما أنجزته MR 5/6 بالضبط ([!42](https://gitlab.com/uxxxu/wasla/-/merge_requests/42))

`UnavailableOrderIntake` لم يعد المُهيّئ الوحيد: `services/customers/src/infrastructure/http-order-intake.ts` هو محوّل التسليم الإنتاجي. التفصيل في [ORDER_INTAKE_HANDOVER.md](../04-api/ORDER_INTAKE_HANDOVER.md)، وما يجب أن يعرفه من يكمل:

- **خريطة الحالات هي المُنتَج، لا نداء الشبكة.** `201/200` نجاح (و**200 إعادة نفس المفتاح لا تعارض** — تصنيفها فشلاً يقلب صفّاً `submitted` إلى `submission_failed` عند إعادة محاولة بريئة) · `409/422` ⇒ `REJECTED` **نهائي** لأن إعادة المحاولة بنفس المفتاح لا تُغيّر الجواب أبداً · `400/415/404` وأي 4xx ⇒ `UNAVAILABLE` لأن المحرّك **لم يفهم حمولتنا** فهو خطؤنا لا رفض تجاري (نصّ عقد المحرّك يقول هذا حرفياً) · `5xx`/انقطاع ⇒ `UNAVAILABLE` قابل لإعادة المحاولة **بنفس المفتاح** · لا إجابة ⇒ `TIMEOUT`. **لا تُدمج `TIMEOUT` في `UNAVAILABLE`:** «لم يصل» و«لا نعرف» حقيقتان تشغيليتان مختلفتان عند التسوية.
- **قبولٌ لا يُقرأ ليس قبولاً.** الرد الناجح يُتحقَّق شكلاً (`ORD-##########` + `accepted_at` غير فارغ) قبل تسميته قبولاً؛ صفّ `submitted` بلا مرجع صالح يترك طلباً لا يستطيع العميل ولا الدعم ولا السائق الرجوع إليه.
- **العميل يرى رمزاً واحداً** (`CUSTOMER_ORDER_INTAKE_UNAVAILABLE`, 503) والتمييز الثلاثي يُسجَّل في `failure_reason_code` وحدث الفشل — للتشغيل لا للعميل (ADR-009 §3). **لا تُسرّب أسباب رفض المحرّك إلى ردّ العميل.**
- **`OrderIntakeCallContext { traceId? }` معامل ثانٍ اختياري** في `OrderIntakePort`. اختياريّته مقصودة: `UnavailableOrderIntake` و`RecordingOrderIntake` ومحوّل بوابة Phase 04 لم تتغيّر بحرف. **لا تُضِف `traceId` إلى `OrderIntakeRequestInput`**: الحمولة عقد منشور والارتباط نقل.
- **`ORDER_SERVICE_URL` بلا مُهيّئ تطوير متسامح** — غيابه = فشل صريح لكل تسليم. مُهيّئ «يقبل» بلا محرّك يكتب صفوفاً تقول إن طلب عميل وصل إلى محرّك غير موجود (§53). والمُهيّئ وملصق `/health` يُبنيان في دالة واحدة حتى لا تُعلن عملية `configured` وهي تحمل المُهيّئ الفاشل. `ORDER_SERVICE_TIMEOUT_MS` افتراضه 2000 لأن التسليم داخل طلب العميل: المهلة وعدٌ للعميل لا إعداد شبكة.
- **`/health` عند خدمة العميل صار `ok`** لأول مرة في تاريخ المشروع.
- **بوابة Phase 04 لم تُلمَس.** `packages/customer-e2e/src/order-intake-http.ts` ما زال يستخدم محوّله الخاص، وأُضيف إليه تعليق يشرح **لماذا**: البوابة إثبات مُجمَّد عن Phase 04، ولو استوردت محوّل الإنتاج لأصبح أي تغيير لاحق في خريطة الحالات إعادةَ كتابة صامتة لما تمّ التوقيع عليه.
- **الأدلّة:** 17 اختباراً للمحوّل على **مُنصت حقيقي على منفذ محلي** (لا `fetch` مُزيَّف — كل الخطر على السلك) · `@wasla/customers-service` **117 اختباراً** · `pnpm -r typecheck` و`pnpm -r test` ✅ · تسليم حقيقي بين خدمتين تعملان: 201 ⇒ `ORD-0000000001` · إعادة نفس المفتاح ⇒ نفس المرجع بلا طلب ثانٍ · قراءة الطلب = `published` · بعميل آخر = **404** · ملاحظة 400 محرف ⇒ `UNAVAILABLE` لا `REJECTED` · `x-request-id` ظهر في سجلّ المحرّك.

### ما أنجزته MR 6/6 بالضبط ([!43](https://gitlab.com/uxxxu/wasla/-/merge_requests/43))

بوابة خروج المرحلة، في حزمة اختبار بحتة `packages/order-e2e`. التفصيل الكامل في [PHASE06_EXIT_GATE_E2E.md](../12-testing/PHASE06_EXIT_GATE_E2E.md)، وما يجب أن يعرفه من يكمل:

- **البوابة تقود المحوّل الإنتاجي، لا نسخةً منه.** `HttpOrderIntakePort` من MR 5/6 هو ما يُركَّب داخل نواة العميل، ومحرّك الطلبات خدمة ثانية تستمع على منفذها. الطلبات موجودة في المحرّك **لأن الكود الذي يعمل في الإنتاج وضعها هناك** — وبوابةٌ تختبر نسخة لا تُثبت شيئاً عن الإنتاج. أربعة مُنصتات حقيقية: هوية · جغرافيا · نواة عميل · محرّك.
- **المسح كاملاً فوق HTTP: 441 زوجاً.** لكل حالة من الـ21 يُقاد طلب إليها ثمّ تُجرَّب الـ21 هدفاً كلّها: 72 حافة منشورة تجيب **200** والحالة تتغيّر فعلاً، و369 تجيب **409 `ORDER_ILLEGAL_TRANSITION`** — و**الحالة تُقرأ بعد كل رفض للتأكّد أنها لم تتغيّر**، لأن رفضاً يُغيّر الحالة أسوأ من قبول. المسار إلى كل حالة يُحسب بـBFS من `allowedTargets` (الجدول نفسه)، فتغيير حافة يُغيّر المشية تلقائياً ولا تصير البوابة تُثبت نفسها.
- **الرحلة الكاملة عبر HTTP:** `published → searching → offered → accepted → assigned → driver_en_route → arrived → in_progress → completed`، بإسناد **مسجَّل ومقبول** قبل الحوافّ المحروسة، وسجلّ تدقيق كامل يبدأ بصفّ المولد بأرقام `sequence` متسلسلة بلا فجوة، ومسار النزاع/المراجعة بعد الإكمال يبقى مفتوحاً، والرجوع من الحالة النهائية مرفوض.
- **حارس انزلاق الحدّ يعمل وقت التشغيل لا على نسخة.** مفاتيح ما يُنتجه `toOrderIntakeRequestDto` فعلاً تُقارَن بقائمة `required` **مقروءةً من `services/orders/contracts/api.openapi.yml` نفسه** (بتحليل نصّي — لا اعتمادية yaml في المستودع، ومطابقة الوثيقتين محروسة أصلاً داخل `@wasla/contracts-order`)، ويُتحقَّق أن كل مفتاح snake_case ومنشور في العقد. لا يمكن لنوعٍ أن يرى هذا الانحراف: الطرفان يستوردان النوع من الحزمة نفسها، فإعادة تسمية حقل تُعيد تسميته عندهما وتُترجم.
- **بقيّة ما تُثبته:** إعادة مفتاح العميل ⇒ نفس المرجع ولا طلب ثانٍ · طلب عميل آخر ⇒ **404 لا 403** · حافة محروسة بلا إسناد مقبول ⇒ 422 `ORDER_ASSIGNMENT_REQUIRED` · سبب خارج الكتالوج ⇒ 422 · `Idempotency-Key` غائب ⇒ 400 · فاعل بلا `actor_ref` حيث يطلبه الجدول ⇒ 422 `ORDER_ACTOR_REF_REQUIRED` · `/health` = `degraded` على الذاكرة و`ok` على Postgres، ونواة العميل `ok`. **كل التوكيدات على رموز الأخطاء لا على النصّ العربي.**
- **البوابة غير قابلة للتخطّي.** `vitest.config.ts` يُضمّن ملف `*.e2e.test.ts` صراحةً، فهي تعمل في كل `pnpm -r test` بمخزن ذاكرة، وترتفع على Postgres في وظيفة `order-exit-gate-e2e` بقاعدة مستقلّة `wasla_order_e2e` ومتغيّر **`ORDER_DATABASE_URL`** (بقصد لا `DATABASE_URL`: الثاني مخزن طبقة القناة ووظائف تكامل المحرّك). المخزن المُستعمل يُطبَع في أول السجل.
- **تصديران أُضيفا إلى `services/orders/src/index.ts`** — `createOrderDb` و`PostgresOrderOutbox` (بتعليق يبرّرهما): جذر التركيب يحتاجهما، والمستودع ومولّد المُعرّف العام يبقيان مخفيّين لأن أحداً خارج الخدمة لا يجوز أن يبنيهما دون المُشغّل.
- **وأثمرت في يومها الأول:** أوّل تشغيل على Postgres أسقط **قبول الإسناد** بـ503 — `resolveAssignment` كان يربط السائق على صفّ حالته `offered`، وهو ما يمنعه `ck_orders_assignment_matches_status` وهو الصورة الرابعة للحالة المستحيلة في ADR-010 §7. أي أن **كل قبول سائق كان يفشل في الإنتاج** ومرّ من 621 اختباراً لأن مُهيّئ الذاكرة كان يقبل ما ترفضه القاعدة. صُحّح: الربط داخل `transitionOrder` في **نفس عبارة التحديث** التي تُحرّك الحالة، ومُهيّئ الذاكرة صار يفرض القيد، وثلاثة اختبارات وحدة جديدة تُثبت السلوك الصحيح (التفصيل في [وثيقة البوابة §5](../12-testing/PHASE06_EXIT_GATE_E2E.md)).
- **الأدلّة:** `pnpm --filter @wasla/order-e2e test` ⇒ **16/16** (المسح كاملاً في ~1.7s) · `pnpm -r test` ⇒ **1402 اختباراً ناجحاً + 1 متجاوَز** بلا قاعدة بيانات · `pnpm -r typecheck` نظيف · ووظيفة CI ترفع الملف نفسه على Postgres 15.
- **حدود البوابة مُعلَنة لا مسكوت عنها:** مخزن العميل في الذاكرة (سؤال ذرّية صفّ الطلب تملكه بوابة المرحلة 04) · لا قناة ولا بوت (المرحلة 03 و04) · **لا Matching** (الإسنادات تُسجَّل من الاختبار كما ستُسجّلها المرحلة 07) · لا تفويض (المرحلة 09) · لا مُرحِّل أحداث · لا حساب أسعار.

### قرارات مثبَّتة لا تُعاد مناقشتها (ADR-010)

1. **لا حالة `draft`** — الطلب يبدأ `published`. Phase 04 تُسلّم نيّة **مُتحقَّقة**، فمسوّدةٌ تكرّر تحقّقاً وتُنتج طلبات معلّقة بلا مالك. حارس يفشل إن ظهر `draft` في أي enum.
2. **جدول انتقالات صريح** — لا قاعدة عامة مُشتَقّة: قاعدةٌ عامة تفشل بصمت في الشاذّ، والحالة المستحيلة هي بالضبط الاستثناء الذي تنسى.
3. **`driver_public_id` opaque بلا FK** — يفصل المحرّك عن Phase 05.
4. **`ORD-` + عشرة أرقام من متتالية القاعدة** — لا UUID ظاهر (العميل يقرأه في محادثة دعم) ولا عدّاد تطبيقي (يتصادم عند أول نسختين).
5. **`Idempotency-Key` إلزامي على كل كتابة** (§43) — مفتاح بجسم مختلف ⇒ 409.
6. **المحرّك يُسجّل الإسناد ولا يُقرّره** — لا مرشّحين ولا أمواج ولا مهل: تلك Phase 07 (§16).

### ما لم يُنجَز بقصد (لا تُعِد بناءه من الصفر)

- **~~لا HTTP بعد~~ — حُسم في MR 4/6:** `services/orders` صارت قابلة للتشغيل على **8087** بتركيب نهائي واحد في `src/http/server.ts` (Postgres عند وجود `DATABASE_URL`، وإلا ذاكرة و`/health` = `degraded`). استيراد الحزمة ما زال لا يلمس الشبكة ولا القاعدة.
- **لا ناشر لصندوق الصادر** — `PostgresOrderOutbox` يكتب الصفوف لكن لا يُرسلها لـKafka؛ محله Phase 09. والذرّية التي سُدّت هنا تضمن أن الحدث إن وُجد فهو ملتزم مع الطلب، لكنه قد يبقى غير منشور حتى ظهور الناشر.
- **لا إلزام لهوية الفاعل** — الشكل فقط. الإلزام يدخل مع طبقة المصادقة (Phase 09+)، ولا يُغيّر جدول الانتقالات.
- **`ORDER_TRANSITION_SPACE` ثابت مُصدَّر (441)** — لا تُعِد حسابه في MR 6/6؛ استورده كي يبقى للفضاء معنًى واحد في المستودع.
- **~~`UnavailableOrderIntake` باقٍ في `services/customers`~~ — استُبدل في MR 5/6:** المُهيّئ الإنتاجي `HttpOrderIntakePort` هو ما يُركَّب عند وجود `ORDER_SERVICE_URL`، ويبقى `UnavailableOrderIntake` هو الافتراضي fail-closed بغيره.
- **`maxItems: 2` على `stops`** هو الانحراف الوحيد المقصود عن عقد العميل، موثّق في مكانه: Multi-stop يوسّع الحدّ بلا هجرة.

---

## 11. Phase 07 (Dispatch & Matching MVP) — مكتملة ✅ (2026-08-22) · بوابة الخروج اجتازت (MR 1/6 → 6/6 مدمجة)

**بوابة الخروج (من الوثيقة الأم §78 و[ROADMAP](ROADMAP.md)):** «Request كامل من Customer إلى Driver assignment في بيئة اختبار حقيقية.»

**الأساس الذي وجدته جاهزاً — لا تُعِد بناءه:**

- **مقبس الإسناد موجود ومُختبَر.** `POST /orders/{id}/assignments` يسجّل عرضاً لسائق (201) و`PATCH …/assignments/{assignmentId}` يحسمه (`accepted`/`rejected`, 200). المطابقة تنادي هذين المسارين ولا تكتب حالة الطلب بنفسها: **المحرّك يسجّل الإسناد ولا يقرّره** ([ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) قرار 6) — وقبول العرض **لا يُحرّك الحالة**، تحريكها انتقالٌ صريح يمرّ بالجدول ويورث صفّ تدقيق.
- **الشكل الذي يجب أن تُنتجه المطابقة مكتوب كاختبار يعمل**: `bindAcceptedAssignment` في `packages/order-e2e/src/harness.ts` هو تلك السلسلة بالضبط فوق HTTP. اقرأها قبل أن تبدأ.
- **`driver_public_id` مرجع opaque بقيد شكل بلا FK** — فالمطابقة تعمل قبل وجود Phase 05 (Driver Core)، والمُعرّف يأتي من خدمة الهوية. لكن **الأهليّة والمركبة والموقع الحقيقي للسائق ليست في المستودع بعد**: قرارك الأول في هذه المرحلة هو من أين تأتي قائمة المرشّحين، وهو قرار **يستحقّ ADR** (المسار الحرج `00 → 01 → 02 → 04 → 06 → 07 → 09 → 20` يضع 05 خارجه، فلا يجوز أن تُدخلها ضمناً من الباب الخلفي).
- **الجغرافيا تُعطي التغطية** (`services/geography`، هرم [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)): المطابقة بالمنطقة، **ولا Reverse Geocoding في النظام**، ولا إحداثية في أي حمولة حدث.

**الأسئلة الأربعة الآتية كانت مفتوحة، وقد حُسِمت جميعاً في [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) (مقبول) — تُقرأ هنا للسياق لا لإعادة فتحها:**

1. **مكان المطابقة**: خدمة `services/matching` مستقلّة أم داخل المحرّك؟ داخل المحرّك أرخص اليوم ويهدم ADR-010 غداً (المحرّك يصير يقرّر).
2. **الأمواج والمهل** (dispatch waves): من يملك المؤقّت؟ مُشغّل دوري لا وجود له بعد في المستودع — ولا ناشر لصندوق الصادر (Phase 09). لا تفترض وجود أيّهما.
3. **العرض المتزامن**: عرضان لطلب واحد ممنوعان بقيد مُسمّى في القاعدة (`ORDER_ASSIGNMENT_DUPLICATE` · `ORDER_ASSIGNMENT_FORBIDDEN`) — فالموجة تعني عرضاً واحداً بعد آخر، أو تعميماً بلا عرض مُسجَّل. اختر واكتب لماذا.
4. **fallback المجتمع** (Community fallback في عمود ROADMAP): مرحلة لاحقة أم داخل هذه؟ إن كانت داخلها فلها بوابتها.

### ما حُسِم فعلاً (ADR-011 — لا يُعاد التفاوض عليه بلا ADR ناسخ)

1. **خدمتان لا واحدة** (وكلتاهما في الشجرة الأصلية §68 فلا انحراف): `services/matching` (`@wasla/matching-service`، **8088**) يجيب «من المرشّحون وبأي ترتيب؟» **دالّةً** بلا حالة زمنية؛ `services/dispatch` (`@wasla/dispatch-service`، **8089**) يجيب «من يأخذه الآن، وماذا عند الرفض أو المهلة؟» **مهمّةً** لها حالة وزمن. الاتجاه: `dispatch → matching` و`dispatch → orders` و`matching → geography`، و**المحرّك لا يعرف أنّ التوزيع موجود**.
2. **مصدر المرشّحين**: إسقاط `driver_candidacy` تملكه المطابقة، مفتاحه `driver_public_id` opaque بـCHECK بلا FK، يُكتَب بـ`PUT /candidacy/{id}` (بوت السائق أو الإدارة اليوم، Driver Core لاحقاً **بلا هجرة**). الأهليّة **مُدّعاة لا مُتحقَّقة**، ومصدر الادّعاء مخزّن (`eligibility_source`)، و**المجهول أو القديم ليس مرشّحاً** (fail-closed بـ`CANDIDACY_FRESHNESS_SECONDS`). فبهذا لا تنتظر Phase 05، والدَين مُعلَن في [نموذج المجال §9](../03-domain/MATCHING_DISPATCH.md).
3. **الزمن نبضة لا مؤقّت**: كل مهمّة وموجة وعرض تحمل `expires_at` من **ساعة مُحقونة**، و`POST /dispatch/tick` (قابل لإعادة النداء بلا أثر مضاعف) هو الموضع المُعلَن الوحيد الذي يتقدّم فيه الزمن. **من ينادي النبضة خارج نطاق المرحلة** (مُشغّل Phase 09)، و`/health` يُعلن `last_tick_at` كي يكون غيابه عطلاً مرئياً.
4. **العرض المتزامن والأمواج**: الموجة تعرض على `wave_size` سائقاً **في وقت واحد**، وأوّل قبول يفوز بفهرس فريد جزئي في القاعدة (لا بـ`if` في التطبيق)، والخاسرون `superseded` بسبب مُسجَّل، ولا إعادة عرض على من رفض في المهمّة نفسها (ثلاثة حرّاس: استثناء في الطلب · قيد في التوزيع · قيد في المحرّك).
5. **fallback المجتمع داخل هذه المرحلة قراراً لا توصيلاً**: عند استنفاد الأمواج تُسجَّل `escalated_community` + `DispatchEscalatedV1` **والطلب يبقى `searching`**؛ وإن مضى `escalation_expires_at` بلا قبول ⇒ `exhausted` والطلب `no_driver_found` بسبب `NO_DRIVER_AVAILABLE`. إرسال الرسالة إلى مجموعة تلغرام **مِلْك طبقة القناة** لا هذه المرحلة.
6. **الأوزان بيانات بنسخة مُقفَلة** مجموعها 100 بقيد في القاعدة، والدرجة عدد صحيح من عشرة آلاف. النسخة 1 تُصفّر ETA والمسافة والتقييم **بانحراف مُعلَن عن §30.2** (لا خدمة مسار ولا محرّك سمعة بعد)، وترفع قرب المنطقة والإتمام والقبول والعدالة. حسم التعادل مُصرَّح: الدرجة ثمّ الأقدم عرضاً ثمّ المُعرّف معجمياً.

### خطة المراجعات (MRs) — ملزمة ومرتّبة

| MR | المحتوى | الحالة |
|---|---|---|
| 1/6 | ADR-011 + عقود الخدمتين (`schema.sql` · `api.openapi.yml` · `events.json` · `errors.md`) + `@wasla/contracts-matching` و`@wasla/contracts-dispatch` + [نموذج المجال](../03-domain/MATCHING_DISPATCH.md) + [CONTAINERS §4.3](../02-architecture/CONTAINERS.md) | **مدمجة** ([!44](https://gitlab.com/uxxxu/wasla/-/merge_requests/44)) |
| 2/6 | طبقة مجال المطابقة النقيّة: الفلاتر الصلبة الثمانية بترتيبها وأكواد عجزها · الترتيب بنسخة القواعد 1 بحساب صحيح · حسم التعادل — بلا قاعدة وبلا HTTP | **مدمجة** ([!45](https://gitlab.com/uxxxu/wasla/-/merge_requests/45)) |
| 3/6 | استمرارية المطابقة (Drizzle/Postgres مرآةً لـ`schema.sql`) + وحدة عمل + وظيفة CI `matching-db-integration` | **مدمجة** ([!46](https://gitlab.com/uxxxu/wasla/-/merge_requests/46)) |
| 4/6 | طبقة مجال التوزيع النقيّة: آلة المهمّة/الموجة/العرض + دلالة النبضة بساعة مُحقونة + منفذ محرّك الطلبات مُزيَّفاً | **مدمجة** ([!47](https://gitlab.com/uxxxu/wasla/-/merge_requests/47)) |
| ~~5/6~~ | **قُسِمت** إلى 5a/6 و5b/6 — لأنّها كانت تخلط سؤالين يفشل أحدهما فلا يُعرَف أيّهما: «هل الحالة تعيش؟» و«هل العقد الشبكي مُطبَّق؟» | — |
| 5a/6 | استمرارية التوزيع: مرآة Drizzle لـ`schema.sql` + `PostgresDispatchUnitOfWork` + وظيفة CI `dispatch-db-integration` | **مدمجة** ([!48](https://gitlab.com/uxxxu/wasla/-/merge_requests/48)) |
| 5b/6 | طبقة HTTP (8089 للتوزيع و8088 للمطابقة) + `HttpOrderEnginePort` الإنتاجي + عميل HTTP للمطابقة + محوّل الجغرافيا + حسم دَيْن «نداءات الشبكة داخل المعاملة» | **مدمجة** ([!49](https://gitlab.com/uxxxu/wasla/-/merge_requests/49)) |
| 6/6 | **بوابة الخروج** `packages/dispatch-e2e`: ستّ خدمات تعمل، المسار الكامل في [نموذج المجال §8](../03-domain/MATCHING_DISPATCH.md) + ثلاث نهايات غير سعيدة، ووثيقة [PHASE07_EXIT_GATE_E2E.md](../12-testing/PHASE07_EXIT_GATE_E2E.md) ووظيفة `dispatch-exit-gate-e2e` | **مدمجة** ([!50](https://gitlab.com/uxxxu/wasla/-/merge_requests/50)) |

### ما أنجزته MR 1/6 بالضبط ([!44](https://gitlab.com/uxxxu/wasla/-/merge_requests/44))

- **[ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md)** (مقبول): القرارات الثمانية أعلاه، ولكل واحد بديلُه المرفوض وثمنه.
- **عقود المطابقة** `services/matching/contracts/`: `schema.sql` (`driver_candidacy` · `matching_rulesets` بقيد مجموع الأوزان 100 والنسخة 1 مبذورة ومُقفَلة · `matching_decisions` + مرشّحوها بدرجات بالنقاط الأساسية · صندوق صادر) · `api.openapi.yml` (المرشّحون · الترشيح · التوافر · القواعد · قرار مُدقَّق) · `events.json` (**أعداد فقط، لا مُعرّف مرشّح ولا درجة**) · `errors.md` (أكواد الأخطاء + **كتالوج ثمانية أسباب للقائمة الفارغة** — و«لا مرشّح» جوابه `200` لا خطأ).
- **عقود التوزيع** `services/dispatch/contracts/`: `schema.sql` (مهمّة · موجة · عرض · صادر، بفهارس فريدة جزئية: **موجة مفتوحة واحدة** و**عرض مقبول واحد** لكل مهمّة، وفريد `(job_id, driver_public_id)`، و«كل نهاية لها سبب» قيداً) · `api.openapi.yml` (المهمّة · القبول · الرفض · **النبضة**) · `events.json` (تسعة أحداث) · `errors.md`.
- **حزمتا الأنواع** بـ**46 حارس انحراف** تقرأ العقود من القرص وقت التشغيل: كل كود في `errors.md` مُصدَّر وبالعكس · كل حدث مُعلَن · كل حمولة `additionalProperties: false` · قيود `schema.sql` الحاكمة موجودة · **حارس خصوصية** يمنع `chat_id` والإحداثيات ومُعرّفات المرشّحين ودرجاتهم في أي حمولة · وحارس حدٍّ يمنع ظهور «عرض/موجة/مهلة» في سطح المطابقة و«أوزان/ترتيب» في سطح التوزيع.
- **إجمالي المستودع 1448 اختباراً ناجحاً** (كان 1402) بلا قاعدة، و`pnpm -r typecheck` نظيف، والوظائف العشر في CI خضراء.
- إصلاح عابر مُعلَن: أربعة روابط نسبية مكسورة سابقة (`PUSH_DOCUMENTATION_RULE` · `services/geography/contracts/README` · `packages/contracts/identity/README`) — لا علاقة لها بهذه المرحلة، صُحّحت لأن حارس الروابط يجب أن يبقى ذا معنى.

### ما أنجزته MR 2/6 بالضبط ([!45](https://gitlab.com/uxxxu/wasla/-/merge_requests/45))

مشروع العمل الجديد `@wasla/matching-service` — طبقة مجال كاملة **بلا بنية تحتية**: تعمل في ~1.2 ثانية بلا قاعدة ولا شبكة. التفصيل المعماري في [MATCHING_CORE_DOMAIN.md](../02-architecture/MATCHING_CORE_DOMAIN.md)، وما يجب معرفته قبل MR 3/6:

- **الفلاتر الثمانية جدولٌ صريح** (`domain/filters.ts`) لكل مرحلة رقمها واسمها وكود عجزها، والحلقة تمشي الجدول — فإضافة فلتر بلا كود عجز مستحيلة بالبناء. و**السبب الأوّل يفوز**: صفٌّ يفشل في ثلاث مراحل يُبلَّغ عنه بأُولاها لا بآخرها، لأن «لا أحد متاح» و«الجميع قديم» يُرسلان شخصين مختلفين إلى مشكلتين مختلفتين.
- **الحداثة fail-closed** بحدّ مُختبَر على الطرفين (`120s` بالثانية الدقيقة)، **والطابع في المستقبل يُعَدّ حديثاً** بقصد: انحراف الساعة مشكلة تشغيل، ولو أسقطنا الصفّ لَبدت الساعة المنحرفة مدينةً فارغة.
- **الدرجة عدد صحيح من عشرة آلاف** بلا عدد عشري في المسار، وسلّم قرب المنطقة يُعيد `null` **لا صفراً** عند انعدام أي جدٍّ مشترك — الفارق بين «مرتبة متأخّرة» و«ليس مرشّحاً»، وصفرٌ هنا يُبقي سائقاً غير قادر على الوصول في القائمة حتى تعرض عليه موجةٌ عميقة الطلب.
- **الإتمام يتشبّع عند 20 طلباً · القبول محيّد (5000) لمن لا سجلّ له · العدالة مسقوفة بأفقها** — والثلاثة مسقوفة بقصد: بلا سقوف يفوز أقدم حساب في المدينة إلى الأبد، أو يفوز أكثر السائقين إهمالاً بلا نظرٍ إلى شيء آخر.
- **حارس انحراف ثلاثي** يقرأ `contracts/schema.sql` و`docs/03-domain/MATCHING_DISPATCH.md` §5 **من القرص وقت التشغيل** ويقارنهما بثوابت الكود: هو المُلزِم الفعلي لقاعدة «الأوزان بيانات لا كود»، إذ يكفي بغيابه تعديل 40% إلى 50% في موضعٍ واحد من ثلاثة ليعتقد كل قارئ بعده وجود نظام مختلف بلا اختبار فاشل.
- **ترتيب الفحص عَقد**: الشكل ⇒ نسخة القواعد (مُقفَلة ومجموعها 100) ⇒ **منطقة الانطلاق في الهرم (422)** ⇒ الفلاتر ⇒ الترتيب فالتدقيق فالحدث. منطقة انطلاق مجهولة خطأ مُنادٍ لا `NO_ZONE_MATCH`، وإلّا ذهب مُشغّل يبحث عن نقص تغطية ومشكلته مُعرّف خاطئ. و**القرار الوحيد لا يُكتَب عند رفض الاستعلام** (لا صفّ تدقيق ولا حدث).
- **«لا مرشّح» جوابٌ لا خطأ**: قائمة فارغة + كود سبب + **صفّ تدقيق يُكتب أيضاً** — فالجواب الفارغ قرارٌ كذلك.
- **قواعد الكتابة الثلاث مُثبَتة**: استبدال كامل لا دمج (مع الحفاظ على عدّادات لا يملكها الكاتب) · `updated_at` تكتبه الخدمة لا المُنادي (عمود الحكم في الحداثة) · منع تكرار ببصمة حمولة (إعادة محاولة = بلا حدث ثانٍ، ومفتاح مُعاد بحمولة مختلفة = 409). وتغيير التوافر **يرفض** سائقاً بلا صفّ (404) ولا يُنشئ له صفّاً ضمنياً.
- **حدّ الخصوصية مُثبَت سلبياً**: حدث `matching.evaluated` أعدادٌ فقط — بحثٌ في نصّ الحمولة ينفي أي مُعرّف مرشّح أو `score_bp` أو `candidates`، وآخر ينفي `chat_id`/`telegram`.
- **117 اختباراً جديداً · إجمالي المستودع 1565 ناجحاً** (كان 1448)، و`pnpm -r typecheck` نظيف على 23 مشروع عمل.
- **علّتان حقيقيتان كشفهما الاختبار وأُصلحتا في المجال** (لا في الاختبار): مقارنة التعادل لم تكن انعكاسية (`compare(x, x) = 1`) فكسرها اختبار تباديل — ومقارنةٌ كهذه ليست ترتيباً و`sort` يصير حرّاً في أي شيء؛ ومفتاح منع تكرار من فراغات بيضاء كان يُقبَل، فكان كل طلب كهذا سيصير «إعادة محاولة» لأوّله.

### ما لم يُنجَز في MR 2/6 بقصد (محلّه MR 3/6 وما بعدها)

- **لا قاعدة ولا مرآة Drizzle ولا وحدة عمل** — و**معيار MR 3/6 مكتوب**: مُهيّئ Postgres يجب أن يُنجح نفس اختبارات حالات الاستخدام **بلا تعديل ملف واحد في `src/use-cases/`**.
- **لا HTTP ولا المنفذ 8088** (MR 5/6): جدول المسارات في الوثيقة المعمارية §4 خريطة عزمٍ لا شيء مُنفَّذ.
- **لا كتابة للعدّادات ولا لطابعَي `last_offered_at`/`last_assigned_at`**: يكتبهما مسار العرض في التوزيع (MR 4/6–5/6)، وبذرهما اليوم مِلْك الاختبارات عبر باب `seed` **خارج المنفذ** كي لا تصل إليه حالة استخدام.
- **لا ناشر لصندوق الصادر** (Phase 09) ولا تقليم لسجل القرارات (دَين مُعلَن في العقد).

### ما لم يُنجَز في MR 1/6 بقصد (لا تُعِد بناءه من الصفر)

- **لا سطر تنفيذ واحد**: لا `src/` في الخدمتين، ولا آلة حالة، ولا وصول قاعدة، ولا HTTP. هذه قِطَع Contract First ([ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)).
- **لا هجرات ولا مرآة Drizzle** — `schema.sql` هو المصدر، والمرآة في MR 3/6 و5/6 (بحارس انحراف كما في المراحل السابقة).
- **لا مُنادٍ للنبضة، ولا ناشر لصندوق الصادر** (Phase 09)، ولا أولوية للمشتركين (مرحلة الاشتراكات)، ولا تقليم لسجل القرارات.

**اقرأ قبل البدء:** [PHASE06_EXIT_GATE_E2E.md](../12-testing/PHASE06_EXIT_GATE_E2E.md) (§8 حدود البوابة = ما تملكه أنت) · [ORDER_HTTP.md](../04-api/ORDER_HTTP.md) (مسارا الإسناد) · [ORDER_ENGINE.md](../03-domain/ORDER_ENGINE.md) §4 (الجدول: أيّ حافة يجوز لك أن تطلبها) · [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md) · [القاعدة الحاكمة](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) و[GIT_RULES](../00-rules/GIT_RULES.md).

---


### ما أنجزته MR 3/6 بالضبط ([!46](https://gitlab.com/uxxxu/wasla/-/merge_requests/46))

Postgres وراء منافذ المطابقة نفسها، **بلا تغيير ملف واحد في `src/use-cases/`** — وهو المعيار الذي كتبته MR 2/6 سلفاً، ويُبرهنه `port-conformance.integration.test.ts` لا يدّعيه. التفصيل الكامل في [MATCHING_PERSISTENCE.md](../02-architecture/MATCHING_PERSISTENCE.md)، وما يجب معرفته قبل MR 4/6:

- **العقد كان ناقصاً، وهذه الدفعة كشفته.** منفذ `IdempotencyStore` كان مُستخدَماً في كل حالة كتابة **بلا جدول يخزّنه**، و`Map` في المُهيّئ الذاكري أخفت النقص فمرّت MR 2/6 و117 اختباراً دون أن يظهر. لو لم يُكتشف: مفاتيح عدم التكرار تعيش في ذاكرة العملية، فإعادة تشغيل واحدة (أو عمليتان وراء موازن حِمل) تحوّل إعادة المحاولة إلى **كتابة ثانية** — حدثان لنفس التغيير وسائق يُعاد ترتيبه على تاريخ عرضٍ مضاعف. سُدَّت بجدول `matching_idempotency` (**هجرة إضافية عكوسة**، تراجعها `DROP TABLE`)، وحدّا طوله `8..128` **مطابقان حرفياً** لِـ`assertIdempotencyKey` والتطابق مُثبَّت باختبار — فمفتاحٌ يقبله التطبيق وترفضه القاعدة خطأ 500 بلا سبب مفهوم. **الدرس للجهة التالية: قبل بناء استمرارية أي خدمة، تحقّق أنّ لكل منفذ في `ports.ts` مخزناً في `contracts/schema.sql`.**
- **وحدة عمل لا مستودعاً يفتح معاملته.** كل حالة كتابة تُنفّذ ثلاث كتابات في ثلاثة `await` (`replace` → `remember` → `outbox.append`)، ومُهيّئٌ يرتكز معاملته في كل نداء لا يغطّي النداءين التاليين أبداً. الانهيار بين الثاني والثالث يُنتج أسوأ حالة ممكنة: صفٌّ تغيّر ومفتاحٌ يقول «تمّت المعالجة» وحدثٌ غائب — فإعادة محاولة العميل تُرفض كتكرار والتغيير لا يُنشر أبداً. `PostgresMatchingUnitOfWork.run()` يفتح معاملة واحدة و`bindMatchingAdapters` يبني المُهيّئات الخمسة على مقبضها.
- **`zones` تبقى خارج المعاملة بقصد** — منفذٌ على خدمة أخرى ([ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md))، وإدخاله يعني إبقاء اتصال Postgres مفتوحاً عبر نداء شبكي إلى خدمة قد تكون بطيئة: بهذا يُستنزف تجمّع الاتصالات بسبب تابعٍ **متدهور فقط** لا معطّل. و`read()` بلا معاملة أصلاً، مُثبَتاً بغياب أي اتصال `idle in transaction` في `pg_stat_activity`.
- **علّة حقيقية لم يكن لأي اختبار وحدة أن يكشفها.** `sqlState` قرأت `error.code` مباشرةً، وهي **لا تعمل**: Drizzle يغلّف خطأ المُشغّل في `DrizzleQueryError` رسالتُه نصّ SQL، ويعلّق `pg.DatabaseError` الحقيقي — حامل `code` و`constraint` — على `cause`. فكانت كل مخالفة قيد تُفلت بلا ترجمة كرسالة غامضة. **خمسة من 33 اختبار تكامل فشلت على Postgres حقيقي بسبب هذا بالضبط.** الحلّ يسير على سلسلة `cause` بعمق محدود ويشترط كوداً من خمسة أحرف (حتى لا يُخطئ `ECONNREFUSED` بـSQLSTATE)، و`rethrowNamed` يُقدّم اسم القيد المخالف في رسالة أي خطأ لا يُترجَم. **هذه الأسطر هي المبرّر الكامل لوجود وظيفة `matching-db-integration`، وستحتاجها خدمة التوزيع حرفياً في MR 5/6.**
- **مطابقة المنافذ تُقارن المُهيّئين ببعضهما لا بتوقّع مكتوب بيد.** أحد عشر سيناريو مكتوبة مرّة واحدة وتُنفَّذ مرّتين، والنتيجتان تُقارَنان إحداهما بالأخرى. الفرق ليس تجميلياً: التوقّع المكتوب بيد ينحرف تدريجياً إلى ما يفعله المُهيّئ الأحدث، أمّا مقارنة المُهيّئين فلا تستطيع — لأن يوم اختلافهما هو نفسه يوم فشل المقارنة. معرّفات السائقين **ثوابت حرفية** لا العدّاد المشترك في `harness.ts` (العدّاد يمنح التنفيذ الثاني معرّفات مختلفة فتفشل المقارنة على المعرّفات بدل السلوك)، ونسخة القواعد تُقارَن **بالأرقام فقط** (الصفّ المبذور يأخذ طوابعه من `now()` بينما نسخة المجال تحمل طابع epoch).
- **المخطّط يُطبَّق من العقد لا من المرآة.** `pg-harness.ts` يُسقط الجداول ويُعيد تطبيق `contracts/schema.sql`؛ اختبارٌ يبني جداوله من مرآة Drizzle سينجح بينما العقد يقول شيئاً آخر — وهو الشيء الوحيد الذي وُجدت هذه الاختبارات لتصطاده. وبين الاختبارات تُفرَّغ جداول البيانات فقط وتُحفَظ نسخة القواعد 1 لأنّها **بيانات عقد** (بذرة في `schema.sql`) لا بيانات اختبار. و`fileParallelism: false` ضرورة لا تفضيل: كل ملفّ يملك مخطّط **نفس** القاعدة.
- **حارس انحراف المرآة يعمل بلا قاعدة** (19 فحصاً في `build-test`): يقرأ العقد من القرص ويقارن أسماء الجداول ومجموعات الأعمدة، ويُثبّت مع ذلك ما يمحوه إعادةُ هيكلة حسنة النيّة — لا مفتاح خارجي يعبر حدّ خدمة، ومجموع الأوزان، ورتبة فريدة داخل القرار، و**بحث سلبي على أعمدة جدول الصادر** يرفض أي عمود يطابق `driver|score|candidate|notes|label|phone|latitude|longitude`. فصار لحدّ الخصوصية ([ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) قرار 8) حارسان: نصّ الحمولة في حزمة العقود، والأعمدة هنا.
- **`pnpm -r typecheck` نظيف على 24 مشروعاً · 1584 اختباراً ناجحاً** (كان 1565) · **33 اختبار تكامل على Postgres حقيقي**، وتتخطّى نفسها كلّها بلا `DATABASE_URL` فالأمر آمن في أي بيئة.

### ما لم يُنجَز في MR 3/6 بقصد (محلّه MR 4/6 وما بعدها)

- **لا مُهيّئ Postgres لِـ`ZoneHierarchyPort`** — بقصد: المناطق مملوكة لخدمة الجغرافيا (ADR-006)، وقراءتها من جدولٍ هنا تنسخ ملكيةً ليست لنا. المُهيّئ الإنتاجي عميل HTTP في **MR 5/6**، وحتى ذلك الحين التوافق مُثبَت بمناطق في الذاكرة في التنفيذين.
- **لا فلترة في SQL**: `listForEvaluation` يُعيد **كل** الصفوف. الدفع إلى SQL يُغيّر معنى `counts.considered` (يعرّفه العقد بأنّه كل صفٍّ شارك) وينقل ترتيب الفلاتر و`empty_reason_code` من كود مجال مُختبَر إلى خطّة استعلام — **دَينٌ معلن للمرحلة 09** حين يبرّره عدد الصفوف وتُحسب العدّادات في SQL معه.
- **لا HTTP ولا المنفذ 8088 ولا خادم Fastify** (MR 5/6).
- **لا ناشر (relay) لصندوق الصادر**: `markPublished` موجود ومُختبَر، والعملية التي تناديه تأتي مع طبقة النقل (Phase 09).
- **لا تقليم** للقرارات ولا للصادر ولا لمفاتيح عدم التكرار — الصفوف تتراكم بقصد: حدثٌ لم يُخزَّن أبداً أسوأ من حدثٍ مُخزَّن لم يُنشر. سياسة الاحتفاظ للمرحلة 09.
- **لا `drizzle-kit` في CI**: المخطّط يُطبَّق من `contracts/schema.sql` وحده، وهو مصدر الحقيقة.

### ما أنجزته MR 4/6 بالضبط ([!47](https://gitlab.com/uxxxu/wasla/-/merge_requests/47))

مشروع العمل الجديد `@wasla/dispatch-service` — طبقة مجال كاملة **بلا بنية تحتية**: 19 ملف مصدر و142 اختباراً تعمل في ~3.4 ثانية بلا قاعدة ولا شبكة. التفصيل المعماري في [DISPATCH_CORE_DOMAIN.md](../02-architecture/DISPATCH_CORE_DOMAIN.md)، وما **يجب** معرفته قبل MR 5/6:

- **النبضة هي المُقدِّم الوحيد للزمن، وهذا قيد لا تفصيل.** الإنشاء **لا يفتح الموجة الأولى** (المهمّة تُولد `pending`)، ورفض السائق **لا يُكمِل الموجة ولا يفتح التالية**. لسؤال «ما الذي يفتح موجة؟» جوابٌ واحد؛ ولو فتح الإنشاء موجة لَصار للزمن مُقدّمان (مسار متزامن ونبضة) فيعتمد السلوك على أيّهما سبق — وهو عدم حتمية يعمل دائماً في الاختبار وينكسر تحت الحمل. **لا تُدخِل فتح موجة في مسار HTTP متزامن في MR 5/6.**
- **المواعيد مخزَّنة ولا يُجدوَل شيء**: `expiresAt = createdAt + maxWaves × offerTimeoutSeconds` و`escalationExpiresAt = expiresAt + escalationTimeoutSeconds`، و`isDue` شاملة (`now >= deadline`) بكلا حدَّيها مُختبَراً. فتأخّر النبضة يُنتج **تأخّر** القرار لا فقدانه، وإعادة النشر لا تُنسي عرضاً معلَّقاً.
- **القواعد ملك الخدمة لا المُنادي**: `RulesProvider` منفذ، و`CreateDispatchJobRequest` **بلا حقل `rules`**. لو حملها لَصار كل مُنادٍ قادراً على تعيين `max_waves = 99` من بوت. **لا تُضِف `rules` إلى جسم الطلب في MR 5/6.**
- **كل نداء لمحرّك الطلبات يسبق الكتابة المحلّية**، و`already_applied` في اتحاد النتائج **بحكم التصميم** لأن إعادة المحاولة بالمفتاح الحتمي هي المسار الطبيعي. العكس (الكتابة أولاً) يُنتج عرضاً مقبولاً في التوزيع وطلباً لا يعرف عنه شيئاً. والمفاتيح حتميّة: `dispatch:offer:<offerId>:<action>` و`dispatch:order:<jobId>:<to>:<sequence>`.
- **حالة الطلب تتبع الموجة لا كل عرض** — وهذا أهمّ سطر عند بناء الطبقة الإنتاجية: موجة فيها عرض ⇒ `offered`؛ موجة انتهت برفض ⇒ `driver_rejected` ثمّ `searching`؛ بمُهَل فقط ⇒ `driver_timeout` ثمّ `searching`؛ **بصفر مرشّح ⇒ لا انتقال** (الطلب باقٍ `searching`، فإرسال `driver_timeout` بلا عرضٍ واحد كذبٌ في سجلّ الطلب).
- **سباق القبول محسوم بترتيب مُعلَن**: عرض مُنتهٍ لم تمرّ عليه نبضة **يُرفَض بلا تعديل** (`DISPATCH_OFFER_ALREADY_RESOLVED`) وإلا صار الفوز مرتبطاً بتأخّر النبضة · حالة المهمّة يجب أن تكون `dispatching`/`escalated_community` وإلا `DISPATCH_JOB_NOT_DISPATCHABLE` · **`transitionOrder(accepted)` ثمّ `resolveAssignment(accepted)`** (النقل عديم الأثر عند التكرار، والحسم هو القرار المرجعي) · نقلٌ مرفوض ⇒ خطأ **ولا شيء عُدِّل** · خسارة السباق ⇒ عرضنا `superseded` بـ`respondedAt = null` · ثمّ الأشقّاء `superseded` **بلا حدث** · ثمّ `matching.markUnavailable` **أفضلَ جهد** يُعلَن في `availabilitySynced` ولا يُلغي إسناداً ناجحاً.
- **قائمة مرشّحين فارغة جوابٌ صحيح** (موجة بصفر عرض تُكمِلها النبضة بـ`NO_DRIVER_AVAILABLE`)، و`DISPATCH_MATCHING_RESULT_INVALID` محفوظ للجواب **غير القابل للاستعمال** وحده.
- **الإلغاء لا ينقل حالة الطلب** ([ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md)): التوزيع يُنظّف عروضه وموجته فقط ويترك مصير الطلب لصاحبه، وإلا صار لسلطة الإلغاء مصدران.
- **مُهيّئات الذاكرة تُحاكي القيود بأسمائها** (`DISPATCH_INDEX_NAMES` مُصدَّرة، خمسة أسماء)، وأهمّها `ux_dispatch_offers_one_accepted_job` — الحارس النهائي ضدّ عرضين مقبولين، **ومَحَلّه القاعدة**. و**محرّك الطلبات المُزيَّف يستخدم جدول الانتقالات الحقيقي** من `@wasla/orders-service`، فمُزيّفٌ متسامح يُخضّر كل شيء ثمّ ينكسر في أول تكامل.
- **حرّاس انحراف العقد 14** تقرأ `schema.sql` و`api.openapi.yml` و`events.json` و`errors.md` من القرص، **والخرائط تُقارَن مجموعةَ مفاتيحها بما يُعلنه OpenAPI** فلا يُنشَر `payload_fingerprint` ولا `created_idempotency_key` ولا `order_assignment_id` ولا `deferredJobs`.
- **`pnpm -r typecheck` نظيف على 25 مشروعاً · 1726 اختباراً ناجحاً** (كان 1584).

### ما لم يُنجَز في MR 4/6 بقصد (محلّه MR 5/6 وما بعدها)

- **لا استمرارية ولا مرآة Drizzle ولا وحدة عمل** — و**معيار MR 5/6 مكتوب**: مُهيّئ Postgres يجب أن يُنجح **نفس** اختبارات حالات الاستخدام **بلا تعديل سطر في `src/use-cases/`**. وستحتاج حرفياً درسَ `sqlState`/`cause` من MR 3/6.
- **لا HTTP ولا المنفذان 8088/8089** ولا `HttpOrderEnginePort` إنتاجي ولا عميل مطابقة حقيقي (MR 5/6).
- **لا مُنادٍ للنبضة** (Phase 09): النبضة اليوم دالّة تُنادى من اختبار، و`last_tick_at` في `/health` ينتظر MR 5/6.
- **لا مُرحِّل لصندوق الصادر** (Phase 09).
- **لا حدث للاستبدال (`superseded`)** — قرار عَقد لا نقص تنفيذ.
- **صفّ العرض المُنتهي يقرأ `offered` حتى النبضة التالية**: القبول محميّ منه، لكن **أي عارض (بوت أو Mini App) يجب أن يحسب الانتهاء من `expires_at` لا من `status`**.
- **تأخيرٌ في منتصف الموجة يُنتج موجة أصغر من `waveSize`**، وفي أسوأ حال موجة مفتوحة بصفر عرض تُكمِلها النبضة التالية بـ`NO_DRIVER_AVAILABLE` فتُستهلك موجة بلا عرض — البديل معاملة موزّعة على خدمتين لا نملكها.
- **موجة رُفضت كلّها تنتظر النبضة**، و**موجة أولى متأخّرة جداً قد تتجاوز السقف المحفوظ بمهلة عرض واحدة** (نُفضّل ذلك على تصعيد مهمّة لم تُعرَض على أحدٍ قط).

### ما أنجزته MR 5a/6 بالضبط ([!48](https://gitlab.com/uxxxu/wasla/-/merge_requests/48))

طبقة استمرارية Postgres وراء منافذ التوزيع نفسها. التفصيل المعماري كاملاً في [DISPATCH_PERSISTENCE.md](../02-architecture/DISPATCH_PERSISTENCE.md)، وما **يجب** معرفته قبل MR 5b/6:

- **المعيار المُعلَن تحقّق، بانحرافٍ واحدٍ مُعلَن.** مُهيّئات Postgres تُنجح اختبارات حالات الاستخدام نفسها، و`port-conformance.integration.test.ts` (12 سيناريو) يُنفّذ كل سيناريو **مرّتين** — ذاكرة وPostgres — ويقارن الأثرين **أحدهما بالآخر** لا بتوقّعٍ مكتوبٍ بيد. الانحراف: **ثلاثة أسطر في `src/use-cases/tick.ts`** لأنّ `dispatch_waves.expires_at` كان `NOT NULL` في العقد بلا حقلٍ مقابل في المجال؛ التفصيل والبديلان المرفوضان في [DISPATCH_PERSISTENCE §2.2](../02-architecture/DISPATCH_PERSISTENCE.md).
- **حدود المعاملة تملكها وحدة العمل وحدها.** المُهيّئات الخمسة تقبل `DbOrTx` و**لا تفتح معاملة بنفسها**. `PostgresDispatchUnitOfWork.run()` تفتح معاملة واحدة وتُسلّم **نفس المقبض** للخمسة، و`read()` تعمل على المقبض الجذري بلا معاملة — فـGET لا يحتجز اتصالاً مقابل ضمان اتساقٍ لا تستطيع استجابة JSON واحدة أن تُظهره. **في MR 5b/6: لا تفتح معاملة داخل مُعالِج HTTP؛ استعمل `run`/`read`.**
- **الذرّية هي كل قيمة هذه الدفعة، وسببها محدَّد:** موجة `open` ارتكزت بلا عروضها تعني أنّ `ux_dispatch_waves_one_open_job` يرفض كل موجة تالية لتلك المهمة **إلى الأبد** — العميل ينتظر بلا نهاية ولا يُصلحه إلّا حذفٌ بشري لصفّ. `atomicity.integration.test.ts` (6) يكسر الإلحاق الأخير ثمّ الأول ويتحقّق أنّ كل شيء غاب وأنّ **إعادة المحاولة تنجح**.
- **`updated_at` يملكه المُشغّل لا المُنادي.** `EXCLUDED_KEYS` في اختبار المطابقة تحوي مفتاحاً واحداً فقط (`updatedAt`)، ومُعامل `_changedAt` في `PostgresJobRepository.updateStatus` **لا يُكتَب بقصد**. مفتاحٌ ثانٍ في تلك المجموعة يعني سلوكاً اختلف؛ `schema.sql` §6 و[DISPATCH_PERSISTENCE §4](../02-architecture/DISPATCH_PERSISTENCE.md) يشرحان لماذا.
- **فجوتان في العقد سُدَّتا:** `dispatch_idempotency` أُضيف كـ§5 (منفذ `IdempotencyStore` كان بلا جدول — **نفس فجوة المطابقة حرفياً، فهو نمط لا حادثة**)، و`expiresAt` أُضيف للموجة في المجال. وأربعة أسماء قيود في تعليقات `in-memory.ts` **لا وجود لها في الـDDL** صُحّحت، وصار `schema-drift.test.ts` (18 فحصاً، بلا قاعدة) يُفشِل البناء على أيّ اسم قيد يذكره تعليقٌ ولا يوجد في العقد.
- **`SELECT … FOR UPDATE` ثمّ نفس دوالّ آلة الحالات** في المجال — القاعدة تقفل صفّاً واحداً والقرار يبقى في موضع واحد. ومُهيّئ الأخطاء يترجم `23505`/`23514` إلى **نفس** رموز `errors.md` التي يرفعها مُهيّئ الذاكرة، بالمشي على سلسلة `.cause` لأنّ Drizzle تُغلّف خطأ المُشغّل.
- **خطأ كشفته القاعدة الحقيقية وحدها:** `FakeOrderEngine` كان يولّد `assignment-N` و`dispatch_offers.order_assignment_id` نوعه **UUID** — الذاكرة تقبل والقاعدة ترفض بـ`22P02`. المُهيّئ الوهمي الآن يولّد UUID صحيح الشكل.
- **`pnpm -r typecheck` نظيف على 25 مشروعاً · 1744 اختباراً ناجحاً** (كان 1726؛ الزيادة كلّها حارس الانحراف، فاختبارات التكامل الـ47 لا تعمل في `pnpm -r test` بقصد) · **47 اختبار تكامل** أمام Postgres حقيقي في `dispatch-db-integration` على قاعدة مستقلّة `wasla_dispatch_test`.

### ما لم يُنجَز في MR 5a/6 بقصد (محلّه MR 5b/6 وما بعدها)

- **لا طبقة HTTP ولا المنفذان 8088/8089** ولا `HttpOrderEnginePort` إنتاجي ولا عميل مطابقة حقيقي ولا محوّل جغرافيا — كلّها MR 5b/6. و`last_tick_at` في `/health` ينتظرها.
- **⚠️ منافذ الشبكة تُنادى داخل المعاملة — أوّل ما يجب حسمه في MR 5b/6.** `tick.ts` ينادي `matching.getCandidates` و`orders.registerAssignment` بينما معاملة Postgres مفتوحة. مقبولٌ اليوم لأنّ المُهيّئات محلّية وسريعة، و**غير مقبول** حين تصبح نداءات HTTP: نداءٌ بطيء يحتجز اتصالاً من التجمّع ويطيل عمر المعاملة، ومهلةٌ منقضية تُراجِع عملاً صحيحاً. المعالجة (تجميع نداءات الشبكة قبل فتح المعاملة، أو saga) **لم تُقرَّر هنا بقصد** لأنّها تحتاج المُهيّئ الحقيقي أمامها لتُقاس.
- **لا مُرحِّل لصندوق الصادر** (Phase 09): الصفوف تُكتَب و`markPublished` موجودة **ولا أحد يناديها**، و`ix_dispatch_outbox_unpublished` جاهز له.
- **لا مُنادٍ للنبضة** (Phase 09) — النبضة اليوم دالّة تُنادى من اختبار.
- **`resetData` تُفرغ ولا تبذر** — صحيحٌ لأنّ عقد التوزيع بلا بذور تعاقدية (القواعد تصل عبر `RulesProvider`)؛ من يُضيف بذرةً لاحقاً عليه تعديل `pg-harness.ts`.
- **دَين MR 4/6 السلوكي باقٍ كما أُعلن أعلاه بحرفه** — العروض المنتهية تُقرَأ `offered` حتى النبضة التالية (فأي عارض يحسب الانتهاء من `expires_at` لا من `status`)، والتأجيل وسط الموجة قد يعطي موجةً أصغر من `waveSize`، وموجةٌ مرفوضة بالكامل تنتظر النبضة التالية.

### ما أنجزته MR 5b/6 بالضبط ([!49](https://gitlab.com/uxxxu/wasla/-/merge_requests/49))

الخدمتان صارتا تُنادَيان عبر الشبكة. التفصيل الكامل في [MATCHING_HTTP.md](../04-api/MATCHING_HTTP.md) و[DISPATCH_HTTP.md](../04-api/DISPATCH_HTTP.md)، وما **يجب** معرفته قبل MR 6/6:

- **دَيْن «نداءات الشبكة داخل المعاملة» حُسم كما وَعَدت وثيقة 5a/6.** القرار: `src/run-tick.ts` يقرأ المهام النشطة ولحظة النبضة في **قراءة واحدة**، ثم يفتح **معاملة مستقلّة لكل مهمة** بساعة مُجمّدة واحدة للنبضة كلّها. **منطق `src/use-cases/tick.ts` لم يتغيّر سطراً واحداً**. الأثر: عمر المعاملة صار ≈ (2 + حجم الموجة) × مهلة العميل بدل مجموع نداءات كل المهام، ووعد «الفشل محصور في مهمته» صار صحيحاً بنيوياً. **الخطر مُخفَّف لا مُزال**، والمُخفِّف هو مهل `AbortController` الصارمة — [DISPATCH_PERSISTENCE §7](../02-architecture/DISPATCH_PERSISTENCE.md).
- **ثلاثة محوّلات إنتاجية تترجم الشبكة إلى لغة المجال، بلا حلقة إعادة محاولة:** `HttpZoneHierarchy` للمطابقة (404 ⇒ حذف من الخريطة، فشل النقل ⇒ عدم توفّر صريح)، و`HttpMatchingPort` و`HttpOrderEnginePort` للتوزيع (خريطة حالات كاملة: 201 ⇒ مُطبَّق · 200 ⇒ مُطبَّق من قبل · 409/422 ⇒ رفض نهائي · بقية الأخطاء ⇒ عدم توفّر · إلغاء المهلة ⇒ مهلة متميّزة). **استجابة 2xx بجسم JSON تالف لا تُعَدّ نجاحاً** — خلل كشفته التغطية الموسّعة وأُصلِح.
- **الثوابت المعمارية صَمَدت:** لا `rules` في جسم إنشاء المهمة (تأتي من `RulesProvider`) · لا موجة تُفتَح في معالج HTTP متزامن · الزمن يتقدّم عبر `POST /dispatch/tick` وحده · لا معاملة تُفتَح داخل معالج (طبقة HTTP تستقبل Runner لا اعتماديات) · «لا مرشّح» = 200 مع `empty_reason_code` لا خطأ.
- **فجوة أمنية حقيقية كُشفت في فحص الترويسة المكرّرة.** Node **يدمج** الترويسات المتكرّرة بفاصلة ولا يسلّمها مصفوفة، ففحص `Array.isArray` وحده كان **عاطلاً على HTTP الحقيقي**: إرسال `Idempotency-Key` مرتين كان ينتج مفتاحاً ثالثاً لم يرسله أحد. أُضيف رفض القيمة الحاملة لفاصلة في **المطابقة والتوزيع**، مع اختبار على مستوى HTTP لا على مستوى الدالة وحدها.
- **العقد الداخلي `CandidateRequest` وُسّع بمرجع الطلب** (`orderId` · `orderPublicId` · `dispatchJobId?`)، لأنّ قرار مطابقة يُحفَظ للتدقيق بلا مرجع طلب لا يستطيع لاحقاً الإجابة عن «لِمَ هذا السائق لهذا الطلب؟». والمحوّل **لا يرسل `evaluated_at`**: لحظة التقييم تملكها ساعة المطابقة.
- **المنفذان صارا ثابتين مُصدَّرين من حزمتي العقود** (`MATCHING_SERVICE_PORT` · `DISPATCH_SERVICE_PORT`) لا رقمين منسوخين في كل `server.ts`.
- **الأدلّة:** `pnpm -r typecheck` نطيف · **1833 اختباراً ناجحاً واختبار واحد مُتجاوَز** (كان 1829 + 1 مُتجاوَز) — المطابقة 160 (كانت 136) والتوزيع 225 (كان 160)، ولا حاجة لوظيفة CI جديدة لأنّ `build-test` يُشغّل `pnpm -r test`/`typecheck` فتُغطّى الطبقة الجديدة تلقائياً.

### ما لم يُنجَز في MR 5b/6 بقصد (محلّه MR 6/6 وما بعدها)

- **لا بوابة خروج e2e.** `packages/dispatch-e2e` هي MR 6/6 وحدها؛ ما أُنجز هنا مختبرٌ على مستوى الخدمة الواحدة بـ`app.inject` ومحوّلات مُزَيّفة للشبكة، **لا خمس خدمات تعمل معاً**. لا تقرأ هذه الدفعة إقراراً بأنّ المسار الكامل يعمل فعلاً.
- **⚠️ دَيْن مُعلَن جديد: الفجوة نفسها في `services/orders/src/http/requests.ts` لم تُصلَح بقصد** (انضباط النطاق: مراجعة التوزيع والمطابقة لا تلمس خدمة ثالثة مدمجة). خدمة الطلبات ما زالت تقبل `Idempotency-Key` مكرّراً مدموجاً بفاصلة مفتاحاً واحداً. **مراجعة مستقلّة واجبة.**
- **`POST /dispatch/tick` يشترط `Idempotency-Key` ولا يستخدمه لمنع التكرار** — مقبول لأنّ النبضة عديمة الأثر بالبناء، وتخزين مدخلة لكل نبضة ينمو بلا حدّ.
- **لا مُرحِّل لصندوق الصادر ولا مُنادٍ للنبضة** — المرحلة 09، كما أُعلن من MR 4/6.
- **دَيْن MR 4/6 السلوكي باقٍ بحرفه** — العروض المنتهية تُقرَأ `offered` حتّى النبضة التالية، والتأجيل وسط الموجة قد يعطي موجةً أصغر من `waveSize`.

### ما أنجزته MR 6/6 بالضبط ([!50](https://gitlab.com/uxxxu/wasla/-/merge_requests/50))

**الطور مُغلق بالدليل لا بالوصف.** التفصيل الكامل في [PHASE07_EXIT_GATE_E2E.md](../12-testing/PHASE07_EXIT_GATE_E2E.md)، وهذا ما يحتاجه من يأتي بعدي:

- **`packages/dispatch-e2e` — ستّ خدمات مُنصتة، ساعة واحدة، وHTTP عام وحده.** هوية · جغرافيا (بذرة السعودية) · محرّك طلبات · نواة عميل · مطابقة · توزيع، كلّها على `127.0.0.1:0`؛ والتوزيع يسأل المطابقة بـ`HttpMatchingPort` ويخاطب المحرّك بـ`HttpOrderEnginePort` — **المحوّلان الإنتاجيان نفساهما**. `GateClock` واحد يُحقَن في المطابقة والتوزيع معاً، وإلّا صار مُرشِّح الطزاجة يقيس فرق ساعتين لا مرور الوقت. **لا قراءة مباشرة من مخزن في أي توكيد**: بوابةٌ تقرأ القاعدة التي تفحصها قد تنجح بينما الواجهة مكسورة.
- **خمسة اختبارات، أربع نهايات + الصحّة:** المسار السعيد (رفض ← موجة تستثني الرافض ← قبول ⇒ `assigned`/`accepted` + `busy`) · انقضاء المهلة (`responded_at` يبقى `null`) · التصعيد ثمّ النفاد (نبضة واحدة تُنفق الموجات الثلاث، والطلب يبقى `searching`، ثمّ `no_driver_found` عند `escalation_expires_at` بالضبط) · السبق (`superseded` لا `rejected`) · و`/health` يُصرِّح بمخزنه.
- **وظيفة `dispatch-exit-gate-e2e`** على `wasla_dispatch_e2e` عبر **`DISPATCH_DATABASE_URL`** — متغيّر بغرضٍ مُسمّى لا `DATABASE_URL`، ومتغيّر واحد يرفع الخدمتين لأنّ سؤال البوابة هو العقد بينهما ولأنّ لكلٍّ بادئة جداولها (`matching_*` مقابل `dispatch_*`).
- **⚠️ العيب الذي أسقطته البوابة، وهو أهمّ ما في هذه الدفعة: لا قبول سائق واحد كان ممكناً في النظام.** `accept-offer.ts` كان ينادي `transitionOrder(accepted)` **قبل** `resolveAssignment(accepted)`، والمحرّك يقرأ السائق من سجلّ الإسنادات ويكتبه **في نفس `UPDATE`** التي تُحرّك الحالة (إجباراً: `ck_orders_assignment_matches_status` يمنع طلباً `offered` من حمل إسناد نشط — [ADR-010 §4/§7](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md)). فكان كل قبول يُرفض 422، و**225 اختبار وحدة خضراء** لأنّ `FakeOrderEngine` يُحاكي جدول الانتقالات ولا يُحاكي اقتران الإسناد بالحالة. أُصلح الترتيب، و**عُلِّم البديل القاعدة نفسها** في الدفعة ذاتها، وصار ترتيب النداءين توكيداً صريحاً في `accept-offer.test.ts`. **الدرس القابل للنقل: أيّ بديل (fake/stub) لا يعرف قيداً في القاعدة سيُخفي مخالفته — فكل قيدٍ يُعلّم للبديل يوم يُكتشف، لا يوم يُكسر.**
- **⚠️ ودَيْن مُعلَن جديد مقابل الإصلاح — نافذة انعكاس في القبول:** لو سُجّل الإسناد `accepted` ثمّ فشل تحريك الحالة، يبقى سجلّ إسناد مقبول بلا حالة تطابقه. العرض يبقى `offered` والنبضة تظلّ مالكة المهمّة **فلا يضيع الطلب**، والبديل (الترتيب المعاكس) لا يعمل أصلاً. الإغلاق بمعاملة موزّعة أو مسح مُصالحة في مرحلة المتانة — مُدوَّن في [MATCHING_DISPATCH §9](../03-domain/MATCHING_DISPATCH.md).
- **عيب أنواع كان مخفياً عن `pnpm -r test`:** `tick.test.ts` كان يبني `CandidateRequest` بلا `orderId`/`orderPublicId`. `vitest` لا يفحص الأنواع، فالخطأ يظهر في `pnpm -r typecheck` وحده. **من يأتي بعدي: `pnpm -r run typecheck` ليس اختياراً بعد `pnpm -r run test`.**
- **ثلاثة توقّعات خاطئة صُحّحت في الاختبار لا في الكود:** `POST /dispatch/tick` لا يقبل جسماً (فترويسة `content-type` تُرسَل مع الجسم فقط) · `offer_sent` يُنشَر **قبل** `wave_opened` لأنّ حدث الموجة يحمل `offer_count` فلا يصدق قبل وجود عروضها · وقبولٌ على عرضٍ مُنتهٍ يُرفض **409** `DISPATCH_OFFER_ALREADY_RESOLVED` لا 422.
- **الأدلّة:** البوابة **5/5** · التوزيع **225/225** · المطابقة **160/160** · المستودع **1838 ناجحاً + 1 متجاوَز** في 110 ملفات · `pnpm -r run typecheck` نظيف · وظائف CI صارت **15**.
- **⚠️ حدّ التشغيل المحلّي، مُعلَناً:** بيئة هذه الدفعة بلا Postgres وبلا Docker، فمسار القاعدة **لم يُشغَّل محلياً** وإثباته على وظيفة CI في هذه الـMR. **من يراجع: النتيجة المطلوبة هي خُضرة `dispatch-exit-gate-e2e` لا التشغيل المحلّي.**

### ما لم يُنجَز في الطور 07 بقصد (لا تُعِد بناءه من الصفر)

- **لا مُرحِّل لصندوق الصادر ولا مُنادٍ دوريّ للنبضة** — المرحلة 09، كما أُعلن من MR 4/6. وغياب الثاني يعني مهامّ لا تُخدَم أبداً وهي **حالة صامتة**، فـ`last_tick_at` في `/health` هو مؤشّرها (صار مُوكَّداً في البوابة).
- **الأهليّة مُدّعاة ومصدر الادّعاء مخزّن** (`eligibility_source = claimed`) — المرحلة 05 هي التي تجعله `driver_core`. المجهول ليس مرشّحاً (fail-closed) فلا شيء يتعطّل انتظاراً لها.
- **لا واجهة سائق.** البوابة تنادي `POST /dispatch/offers/{id}/accept` مباشرةً كما سيناديه تطبيق السائق؛ «السائق يرى العرض ويضغط قبول» تملكه المرحلة 05.
- **لا سباق حقيقي متزامن.** السيناريو الرابع يُثبت **النتيجة** لا **التزامن**؛ منع القبول الثاني تحت تزامن حقيقي يملكه فهرس القاعدة، ووظيفة CI هي التي ترفعه.
- **الفجوة نفسها (دمج الترويسة المكرّرة) باقية في `services/orders/src/http/requests.ts`** ولم تُلمس — انضباط نطاق من MR 5b/6، ودَيْنٌ مفتوح على مالك محرّك الطلبات.
- **دَيْن MR 4/6 السلوكي باقٍ بحرفه:** العروض المنتهية تُقرَأ `offered` حتّى النبضة التالية.
- **لا أسعار ولا محاسبة ولا إنصاف مُقاس** — أوزان `RULESET_V1` مُجمَّدة؛ البوابة تُثبت أنّ الترتيب **يُحترم** لا أنّه **عادل**.

## 12. الخطوة التالية — Phase 05 أو Phase 08، ومعيار الاختيار

الطور 07 مُغلق، والمسار الحرج في [ROADMAP §3](ROADMAP.md) هو `00 → 01 → 02 → 04 → 06 → 07 → 09 → 20`. فالتالي على المسار الحرج هو **Phase 09**، لكنّها تعتمد على 07 **و08** معاً، فأمام من يأتي بعدي بابان مفتوحان لا واحد:

| الخيار | لماذا يُختار | ما يفتحه | ما يُبقيه مغلقاً |
|---|---|---|---|
| **Phase 05 — Driver Core** | يسدّ أهمّ دَيْن مُعلَن في 07: الأهليّة تصير `driver_core` بدل `claimed`، فيصير «من يصلح؟» جواباً مُتحقَّقاً لا مُدّعى. ويُلبس البوابة واجهةً: السائق يقبل من تطبيقه | التسجيل · ملفّ السائق · المستندات · كتابة `driver_candidacy` من مصدر موثوق | 09 (تحتاج 08 أيضاً) |
| **Phase 08 — Negotiation & Chat** | اعتمادها الوحيد 07 وقد أُغلقت، وهي **على المسار الحرج** فتُقرّب 09 و20 | التفاوض والتوافق على السعر وتسجيله في الطلب | دَيْن الأهليّة يبقى مفتوحاً حتى 05 |

**القرار المُتَّخذ (2026-08-22): بدأت Phase 05 فعلاً — انظر §13.** والتوصية التي بُني عليها (وهي كانت توصية لا قراراً): ابدأ بـ**Phase 05**. السبب: البوابة الحالية تُثبت أنّ التوزيع يعمل على أهليّة **يدّعيها الاختبار**؛ وكل مرحلة تُبنى فوق 07 قبل 05 تُراكم منطقاً يفترض مرشّحين موثوقين وهم ليسوا كذلك بعد. و08 لا تفقد شيئاً بالتأخير لأنّ اعتمادها لا يتغيّر.

**وفي كل الأحوال، ما يجب أن يُقرأ أولاً:** §11 أعلاه (خصوصاً درس البديل الذي لا يعرف القيد) · [PHASE07_EXIT_GATE_E2E.md](../12-testing/PHASE07_EXIT_GATE_E2E.md) §5 و§8 · [MATCHING_DISPATCH §9](../03-domain/MATCHING_DISPATCH.md) للديون المفتوحة · و[PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md): لا دفعة بلا وثيقة في **نفس** الالتزام.

## 13. Phase 05 (Driver Core) — قيد التنفيذ 🚧 (بدأت 2026-08-22) · MR 1/6 مدفوعة

**نقطة البداية ليست كوداً.** المرحلة بدأت من حدّها: [ADR-012](../15-decisions/ADR-012-driver-core-eligibility-derivation-and-candidacy-publication.md) + عقود `services/drivers/contracts/*` + `@wasla/contracts-driver` + [DRIVER_CORE.md](../03-domain/DRIVER_CORE.md) + [CONTAINERS §4.4](../02-architecture/CONTAINERS.md). وهذا هو النمط نفسه الذي أعطى المراحل 04 و06 و07 بوابات خروج مُقاسة، ولا يُعاد التفاوض عليه.

### ما حُسِم فعلاً (ADR-012 — لا يُعاد التفاوض عليه بلا ADR ناسخ)

1. **خدمة مستقلّة `services/drivers`** على المنفذ **8090** (بعد 8086 عميل · 8087 طلبات · 8088 مطابقة · 8089 توزيع)، والرقم **ثابت مُصدَّر من حزمة العقد** (`DRIVER_SERVICE_PORT`) لا رقم مكتوب في ملف خادم — درس MR 5b/6 من الطور 07.
2. **الأهليّة دالّة مُشتقّة لا عمود.** لا `eligibility_state` ولا `is_eligible` في `driver_profiles`، وحارس اختبار يفشل على عودتهما بالاسم. السبب: عمودٌ يُكتب باليد يتخلّف عن مصادره لحظةَ انتهاء وثيقة، **ولا يشرح نفسه** — فبعد شهر لا أحد يعرف لماذا كُتب. والحساب يُجري مقابل **نسخة سياسة مُقفَلة** (`driver_eligibility_policies` · النسخة 1 `saudi-launch-v1`) على سابقة `matching_rulesets`: تغيير المطلوب = نسخة جديدة، فيبقى قرار الأمس مفهوماً بقواعد الأمس. و`unknown` = fail-closed.
3. **لا كتابة في قاعدة المطابقة.** النشر عبر `PUT /candidacy/{driverPublicId}` بقيمتَي `eligibility_source = driver_core` و`updated_by = driver_core` التي انتظرها عقد المطابقة منذ الطور 07 ([ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) القرار 2)، فيُسدَّد أهمّ دَيْن مُعلَن **بلا سطر يتغيّر في `services/matching`**. وكل محاولة تُسجَّل في `driver_candidacy_publications` بنتيجتها، لأنّ **فشل النشر الصامت أسوأ الحالات: سائق مؤهَّل لا يراه أحد ولا يشتكي منه أحد** — لا العميل (وجد غيره) ولا السائق (لا يعلم أنّه غاب).
4. **«الالتزام الجاري يعلو على الإعلان».** السائق يُعلن `available|offline` فقط؛ `busy` يملكها التوزيع. **دَيْن مُعلَن:** نافذة سباق بين قراءة الصفّ وكتابته، إغلاقها يحتاج `If-Match`/ETag على مقبس الترشيح — تغييرٌ في خدمة أخرى فخارج نطاق المرحلة.
5. **الزمن نبضة لا مؤقّت.** لا حالة `expired` على وثيقة؛ الانتهاء بيانٌ يُقارَن بساعة مُحقونة، و`eligibility_recheck_at` فهرسُ `POST /drivers/eligibility/tick`، ومؤشّر غياب المُنادي هو `last_tick_at` في `/health`.
6. **الوثائق مراجع لا محتوى** (`storage_ref`)، ونسخة سارية واحدة لكل نوع، والاستبدال يُبقي القديمة `superseded` **ولا يحذفها** لأنّ التدقيق يحتاج أن يرى ما كان مقبولاً **يوم اتُّخذ القرار**.
7. **خارج النطاق بقرار:** لا اشتراك (Phase 10) ولا سمعة/تقييم (Phase 09) ولا حساب بنكي — **لا عموداً ولا مساراً ولو معطّلاً**، لأنّ عموداً يُضاف قبل مالكه يُملأ بقيَم يخترعها من لا يملك القرار.
8. **الخصوصية آلية لا مراجعة:** حارس ينفي من **كل** حمولة حدث اسماً وهاتفاً ورقم هوية ورخصة و**لوحة مركبة** و`storage_ref` وIBAN وإحداثية و`chat_id`. اللوحة **تُخزَّن** للمراجعة الإدارية ولا تعبر حدّ الخدمة أبداً — فالحدّ «لا تُنشَر» لا «لا تُخزَّن».

### خطة المراجعات (MRs) — ملزمة ومرتّبة

| MR | النطاق | الحالة |
|---|---|---|
| **1/6** | ADR-012 + `services/drivers/contracts/{schema.sql,api.openapi.yml,events.json,errors.md,README.md}` + `@wasla/contracts-driver` + DRIVER_CORE.md + CONTAINERS §4.4 | ✅ **مدفوعة** |
| **2/6** | طبقة مجال نقيّة `@wasla/drivers-service` — **حاسب الأهليّة أولاً** بجدولٍ صريح لكل شرط وكود عجزه وقاعدة «السبب الأوّل يفوز»، آلة حالة الوثيقة والمركبة، منافذ + مُهيّئات ذاكرة تُحاكي قيود `schema.sql` **بأسمائها**. بلا قاعدة وبلا HTTP | ⬜ التالي |
| **3/6** | استمرارية Drizzle/Postgres + وحدة عمل تجعل الصفّ وسجلّ الأهليّة والصادر في معاملة واحدة + وظيفة CI `drivers-db-integration` + حارس انحراف مرآة↔DDL | ⬜ |
| **4/6** | طبقة HTTP على **8090**: 13 مساراً + `/health` بحالتيه + مقبس معاملة (`DriverRunner`) فلا يملك معالج مسار فتح معاملة + `onlyKeys()` على كل حمولة | ⬜ |
| **5/6** | **ناشر الترشيح الحقيقي** (`HttpCandidacyPort` إلى 8088) + واجهة بوت السائق (تسجيل · وثائق · إعلان توافر) | ⬜ |
| **6/6** | **بوابة خروج المرحلة E2E**: سائق يُسجَّل ويُراجَع فيصير مؤهَّلاً **بأهليّة محسوبة** فيصله عرض حقيقي من التوزيع، ثمّ تنتهي وثيقته **بنبضة واحدة** فيخرج من التجمّع — و`eligibility_source` يقرأه أحدٌ `driver_core` لا `claimed` | ⬜ |

### ما أنجزته MR 1/6 بالضبط

- `services/drivers/contracts/schema.sql` — **ثمانية جداول** (`driver_profiles` · `driver_service_zones` · `driver_vehicles` · `driver_documents` · `driver_eligibility_policies` · `driver_eligibility_log` · `driver_candidacy_publications` · `driver_outbox`) بقيود مُسمّاة تمنع **بالبناء** ما كان سيُترك للمراجعة البشرية: إيقافٌ بلا سبب · مركبتان رئيسيّتان · مركبة مُخرَجة وهي رئيسية · وثيقة مُراجَعة بلا مُراجِع أو مرفوضة بلا سبب · وثيقةُ مركبةٍ بلا مركبة · نوعُ وثيقةٍ **مجهول** في السياسة (ومطلوبٌ لا يمكن تقديمه يجعل **كل** سائق غير مؤهَّل بصمت) · حالةٌ غير مؤهَّلة **بلا سبب واحد** · نتيجةُ نشرٍ خارج الكتالوج. وتراجعات الهجرة معلّقة في الملف نفسه.
- `services/drivers/contracts/api.openapi.yml` — 3.1 على **8090**، **13 مساراً و17 عملية و19 مخططاً** بـ`additionalProperties: false`. و`POST /drivers/eligibility/tick` **بلا `requestBody` معلَن** لأنّ Fastify يرفض جسماً فارغاً معلَناً بـ400 — درس مُقاس من الطور 07.
- `services/drivers/contracts/events.json` — أحد عشر حدثاً في مغلّف واحد بمُنتِج `drivers-service`.
- `services/drivers/contracts/errors.md` — **21 كود خطأ** + **تسعة أكواد أسباب** لعدم الأهليّة في كتالوج مُغلَق.
- `packages/contracts/driver/` (`@wasla/contracts-driver`) — أنواع مُكتبة مولّدة من العقد + **59 اختبار حارس انحراف** تقرأ ملفات العقد **من القرص وقت التشغيل**: تطابق أكواد الأخطاء في الاتجاهين · تطابق كتالوج الأسباب حرفياً بين ثلاثة مواضع · وجود القيود الحاكمة في الـDDL · بحث سلبي على عمود الأهليّة · وحارس الخصوصية الآلي.

### ما لم يُنجَز في MR 1/6 بقصد (لا تُعِد بناءه من الصفر)

- **لا منطق ولا قاعدة ولا HTTP**: الخدمة **غير قابلة للإقلاع** بعد، ولا يوجد `services/drivers/src/` — محلّه MR 2/6→4/6.
- **لا مُرحِّل صندوق صادر ولا مُنادي نبضة دوريّ** — منقولان إلى Phase 09 مع نظيريهما من الطور 07، والمؤشّر عليهما `last_tick_at`.
- **الأرقام المُتحقَّقة محلياً لا في CI**: `@wasla/contracts-driver` **59/59**، وإجمالي المستودع **1897 اختباراً ناجحاً** (+1 متروك بقصد) في 114 ملفاً على 27 مشروع عمل، و`pnpm -r typecheck` نظيف. وخطّ الأنابيب سيظهر **أحمر** لسبب لا علاقة له بالكود: **حصّة دقائق CI منتهية** (§2-أ) — لا تُطارِده ولا تُصلحه بتعديل كود.

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
