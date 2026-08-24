# HANDOFF — تسليم حالة المشروع للجهة التالية

> **النوع:** وثيقة تسليم (Handoff) واضحة لكل من سيعمل في المستودع بعد الجلسة الحالية.
>
> **القاعدة الحاكمة:** كل عمل يُدفع إلى المستودع يجب توثيقه، ويجب أن يعرف من يأتي بعدي «ماذا تمّ وماذا بقي» بدقّة، حتى إكمال المشروع 100%.
>
> **Last Updated:** 2026-08-24 (**Phase 10 (Driver Subscription & Referral) قيد التنفيذ 🔄 — MR 1/6 من ستّ**: عقودُ `services/subscriptions/contracts/` مجمَّدةٌ (مخطَّطٌ بعشرةِ جداول · أحدَ عشرَ مساراً واثنتا عشرةَ عمليّةً على 8093 · ستّةُ أحداث · سبعةَ عشرَ رمزَ خطأ) وحزمةُ `@wasla/contracts-subscription` مولَّدةٌ منها مع **26 حارسَ انحرافٍ ناجحاً**، و[ADR-015](../15-decisions/ADR-015-driver-subscription-entitlement-ledger-and-derived-referral-rewards.md) يُثبّت الحدَّ. **لا كودَ خدمةٍ بعد بقرارٍ مُعلَن.** ما يجب أن تفعله المراجعةُ التالية بالحرفِ في **§18**)
>
> **Last Updated:** 2026-08-23 (**Phase 09 (Reputation + Fraud) مكتملة ✅ — MR 1/6 → 6/6 وبوابة الخروج اجتازت**: حزمة `packages/reputation-e2e` ترفع **محرّكَ الطلبِ الحقيقيَّ وخدمةَ السمعة** كمُستمعَينِ حقيقيَّين بساعتَينِ مكتوبتَين، فتسوق طلباً عبر HTTP إلى `completed` ثمّ تقرأ **صفَّ صادرِ المحرّك** فتُمرِّر الحمولةَ **التي أصدرها هو** كما هي إلى مُستهلكِ السمعة، ثمّ تقرأ النتيجةَ من `GET /reputation/scores/...` على المِقبض، ثمّ تُصرِّف صفَّ صادرِ السمعة إلى مصرفٍ مُسجِّل — **ولا حمولةَ حدثٍ واحدةً مكتوبةً بيد الاختبار**. **12/12** ومنها: العميلُ **63** والسائقُ **64** بوزنَي `saudi-launch-v1` · `source_event_id` **=** `event_id` الذي أصدره المحرّك · **لا حدثٌ من دورةِ حياةٍ كاملةٍ يُرفَض** · و**الرفضُ حقٌّ لا مخالفة: صفرٌ مُعلَنٌ والنتيجةُ تبقى 60**. المستودعُ كاملاً **2856 ناجحاً · 0 فاشل** و`typecheck` نظيفٌ على **35 مشروعاً** وحرّاسُ الخدمة **76/76** — **مقيسٌ محلّيّاً** فحصّةُ CI مُستنفَدة (§2-أ). **والتالي: Phase 10 — Driver Subscription & Referral · §17.** والدَّينُ المنقول: لا ناقلَ حقيقيّاً بين الخدمتين (قرارُه من Phase 11) · و`PostgresOutboxDrain*` غيرُ مقيسٍ على قاعدةٍ حقيقيّة · التفصيل في §16-ك)
>
> **Last Updated:** 2026-08-23 (**Phase 08 (Negotiation & Chat) قيد التنفيذ 🔄 — MR 5/6 من ستّ مدمجة في `main`**: **المنافذ الصادرة الحقيقية موصولة والدَّين المُعلَن على محرّك الطلب مسدود** — أعمدة الاتفاق الأربعة في `orders` بثلاثة قيود DDL، و`POST /orders/agreed-prices` + `GET /orders/lookup` + `GET /dispatch/offers/{offer_id}`، ومحوّلان حقيقيّان في التفاوض بلا لمس المجال، وأوامر `/negotiations` و`/accept` و`/reject` في البوتين؛ **69 اختباراً جديداً** ⇒ المستودع **2473 + 1 متروك بقصد في 149 ملفاً**، و**اختبارات التكامل على Postgres حقيقي محلّيّاً قبل الدمج** (62+32+48 · [LOCAL_POSTGRES_FOR_TESTS.md](../14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md)) · **المتبقّي: 6/6 بوابة الخروج E2E وحدها** (§14). وقبلها **طبقة HTTP على 8091** ([!60](https://gitlab.com/uxxxu/wasla/-/merge_requests/60)) بعشرة مسارات وثلاث عشرة عمليّة ومقبس معاملة واحد ومعالج خطأ واحد، و**فشل تسليم السعر يبقى 201 ومعه اتفاق** (لا 502)، و**500 غائب عن الكتالوج قصداً ومحروس**؛ **+50 اختباراً** (36 `app.inject` + 14 حارس انحراف) ⇒ **2405 في 145 ملفاً** ([NEGOTIATION_HTTP.md](../04-api/NEGOTIATION_HTTP.md)). وقبلها **MR 3/6**: استمرارية Drizzle/Postgres لخدمة التفاوض — مرآة مخطّط لجداول العقد الثمانية، وثمانية مستودعات، و`PostgresNegotiationUnitOfWork` بمعاملة واحدة لكل عمليّة تطبيقيّة **بلا تعديل سطرٍ واحد في `src/use-cases/` ولا `src/domain/` ولا `src/ports.ts`**؛ و**62 اختبار تكامل على Postgres حقيقي** (41 مستودعاً وقيوداً + 10 مطابقة منافذ ذاكرة↔Postgres + 11 ذرّية) و**27 حارس انحراف مرآة↔DDL**، ووظيفة CI `negotiations-db-integration` — والتفصيل في [NEGOTIATION_PERSISTENCE.md](../02-architecture/NEGOTIATION_PERSISTENCE.md). وقبلها **MR 2/6**: طبقة المجال النقيّة `@wasla/negotiations-service` — آلتا حالة الخيط والدور، والسياسة المُقفلة، وثمانية أفعال، و**131 اختباراً بلا قاعدة ولا شبكة ولا `sleep`** كشفت ثلاثة عيوب حقيقيّة وأصلحتها (ترتيب حرس التكرار · إلغاءٌ يترك دوراً معلّقاً · قيدان بلا اسم مميّز) — والتفصيل في [NEGOTIATION_CORE_DOMAIN.md](../03-domain/NEGOTIATION_CORE_DOMAIN.md). وقبلها **MR 1/6 مدفوعة ([!57](https://gitlab.com/uxxxu/wasla/-/merge_requests/57))**: [ADR-013](../15-decisions/ADR-013-negotiation-chat-agreement-boundary-and-tick-driven-expiry.md) + العقود الكنسية لخدمة `services/negotiations` على **8091** + `@wasla/contracts-negotiation` بـ**70 حارس انحراف** + [NEGOTIATION_CHAT.md](../03-domain/NEGOTIATION_CHAT.md) + [CONTAINERS §4.5](../02-architecture/CONTAINERS.md). القاعدة الحاكمة: **التفاوض يملك «بكم اتّفقنا» ولا يكتب السعر في `orders`** — والتفصيل الكامل لما تمّ وما بقي في **§14**. إجمالي المستودع **2405 اختباراً + 1 متروك بقصد في 145 ملفاً**. و**العائق التشغيلي قائم ولن يُرفع**: حصّة دقائق CI منتهية ولا رصيد لتجديدها، فـ**الدمج بأنبوب أحمر مأذونٌ فيه بقرار المالك بشروطه الثلاثة** — §2-أ)
>
> **Last Updated:** 2026-08-22 (**Phase 05 مكتملة ✅ — MR 6/6 مدفوعة وبوابة الخروج اجتازت**: حزمة `@wasla/driver-e2e` ترفع **سبع خدمات مُنصتة** بساعة واحدة مُحقونة، وتُثبت أن سائقاً يُسجَّل ويُراجَع فيصله عرضٌ حقيقي من التوزيع بأهليّة `driver_core` محسوبة، ثمّ **بنبضة واحدة** يخرج من التجمّع — 14 اختباراً. وقد أسقطت البوابة **عيباً حقيقياً**: تصادُم مفتاح منع التكرار تحت نبضة ساعة واحدة كان يجعل نشراً «ناجحاً» لا يُحرّك صفّ المطابقة، فأُصلح وحُرِس بحارس وحدوي بساعة مجمَّدة، والفائدة قِيست بفحص طفرة. §13)
>
> **تحديث 2026-08-20 (c):** **Phase 00 = Completed (W0)**. تحقّق المالك من namespace → تفعّل shared runners. ظهر فشل في job `build-test` (typecheck) بسبب استخدام `node:fs`/`node:path`/`__dirname` دون `@types/node` مُعلَن — صُلح عبر [MR !9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9) (إضافة `@types/node`) الذي اجتاز CI بالكامل ودُمج. pipeline على `main` نجاح كامل (build-test + markdown-lint + repo-structure ✅). **Phase 00 Exit Gate اجتاز.**
>
> **تحديث 2026-08-20 (b):** [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) يُحدّد مكدّس تنفيذ خدمة Identity (Node 20 + TS + Fastify + PostgreSQL + Drizzle). كان على فرع MR !8 غير المدمج — يُضاف إلى `main` عبر MR تنظيف الحوكمة (انظر §4).

---

## 1. أين نقف الآن (Snapshot)

```text
المرحلة الحالية: **لا مرحلة قيد التنفيذ** — آخر ما أُغلق: **Phase 08 (Negotiation & Chat) مكتملة ✅ 2026-08-23**
                 بستّ مراجعات من ستّ مدمجة في `main` وبوابة خروج اجتازت (§14)
                 (الستّ: ADR-013 + العقود الكنسية (8 جداول · 10 مسارات · 9 أحداث · 29 كود خطأ) بـ**70 حارس انحراف**
                  · طبقة المجال النقيّة بـ24 قاعدة مُسمّاة و131 اختباراً · استمرارية Drizzle/Postgres بوحدة عمل واحدة
                  · طبقة HTTP على **8091** بعشرة مسارات · المنافذ الصادرة الحقيقية وأعمدة الاتفاق في `orders`
                  وأوامر التفاوض في البوتين · **بوابة الخروج E2E**: سبع خدمات مُنصتة بساعة واحدة محقونة،
                  8/8 على الذاكرة و8/8 على Postgres 17 حقيقي — [PHASE08_EXIT_GATE_E2E.md](../12-testing/PHASE08_EXIT_GATE_E2E.md))
**المرحلة التالية: Phase 09 (Reputation + Fraud)** — شروط البدء والمخاطر في §15
                 **Phase 05 (Driver Core) أُغلقت 2026-08-22** بستّ مراجعات وبوابة خروج اجتازت (§13)
                 (المراجعات الستّ: العقود + ADR-012 · طبقة المجال النقيّة وحاسب الأهليّة بـ69 اختباراً ·
                  استمرارية Drizzle/Postgres بوحدة عمل واحدة **بلا تغيير في `src/use-cases/`** بـ28 حارس انحراف
                  و79 اختبار تكامل · طبقة HTTP على **8090** بثلاثة عشر مساراً و64 اختبار HTTP وثلاثة تصحيحات عقد ·
                  **المنافذ الصادرة الحقيقية** إلى المطابقة 8088 والجغرافيا 8081 وواجهة بوت السائق، وفيها تقاعُد 502 ·
                  و**بوابة الخروج**: سبع خدمات مُنصتة بساعة واحدة، وقد أسقطت عيب تصادُم مفتاح منع التكرار · §13)
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
المتبقّي:         **Phase 08 (خمس مراجعات من ستّ)** ثمّ Phase 09 → Phase 24 (انظر §3 للمسار الكامل، و§14 لخطّة الطور 08 كاملةً، و§13 لما تُسلّمه Phase 05).
الاختبارات:       **2355 اختباراً** (+1 متروك بقصد) في **143 ملفاً** — لقطة 2026-08-23 بعد Phase 08 · MR 3/6
                 وخارجها **62 اختبار تكامل** لخدمة التفاوض تعمل على Postgres حقيقي في وظيفة
                 `negotiations-db-integration` (لا تدخل في `pnpm -r test`)
                 (منها **70 لعقود التفاوض**: 14 عقود · 30 مخطّط · 13 أحداث · 13 حدود) · وسابقاً:
                 **2127 اختباراً على 28 مشروع عمل** (+1 متروك بقصد) في 129 ملفاً — لقطة 2026-08-22 بعد Phase 05 · MR 6/6
                 (ومنها 195 لخدمة السائقين في 13 ملفاً · 59 لعقودها · 27 لبوت السائق · **14 لبوابة خروج المرحلة**) · والتفصيل التاريخي أدناه من الطور 07:
                 **1838 اختباراً على 26 مشروع عمل** في 110 ملفات — منها **5 لبوابة خروج الطور 07** + **33 اختبار تكامل على Postgres حقيقي**
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

**قرار مالك المستودع (2026-08-23) — قاعدة الدمج مُعدَّلة صراحةً:** الحصّة **لن تُجدَّد** (لا رصيد لشراء دقائق ولا لترقية الخطة)، وانتظارُ خطٍّ أخضر يعني تعليق المشروع إلى أجلٍ غير مسمّى. فالقرار: **تُدمَج المراجعات بخطٍّ أحمر** ما دام سبب الحُمرة `ci_quota_exceeded` **وحده** — بثلاثة شروطٍ لا تُتجاوَز: **(1)** كلّ رقم يُدَّعى **مُقاسٌ محلّيّاً** ومُسجَّل في [TASK_LOG](TASK_LOG.md) باسم الأمر الذي أنتجه، ولا يُكتب رقمٌ لم يُشغَّل. **(2)** ما يحتاج محرّكاً (`test:integration` وبوابات الخروج) يُشغَّل على **Postgres حقيقي محلّيّاً** قبل الدمج، ويُعلَن صراحةً ما لم يُشغَّل ولماذا. **(3)** لا يُدمَج ما لم يُشغَّل أصلاً: **البوابة تُنقَل إلى الجهاز المحلّي لا تُلغى** — والبوابة التي تُتجاوَز مرّة تُتجاوَز دائماً. ومتى عاد CI أو سُجِّل **runner ذاتي الاستضافة** (الخيار 3 أعلاه · مجّانيّ على جهاز المالك · [CI_RUNNER_UNBLOCK.md](../14-runbooks/CI_RUNNER_UNBLOCK.md)) تُعاد الخطوط على `main` وتُصحَّح أيّ فجوة يكشفها.

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
Phase 05 Driver Core ...................... ✅ Completed (2026-08-22) — Exit Gate E2E في CI (§13)
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

## 12. (تاريخيّ) الخطوة التالية آنذاك — **Phase 08 (Negotiation & Chat)** · وسجلّ معيار الاختيار الذي أدّى إلى Phase 05

> **مُتجاوَز بالتنفيذ (2026-08-23):** الطور 08 أُغلق بستّ مراجعات وبوابة خروج اجتازت (§14). **الخطوة التالية الآن في [§15](#15-الخطوة-التالية--phase-09-reputation--fraud--ما-يجب-أن-يُقرأ-أولاً).** يبقى هذا القسم لأنّه يسجّل **كيف** اختير الطور، وهو المعيار الذي سيُعاد استخدامه عند أوّل تشعّبٍ قادم.

الطور 07 مُغلق، والمسار الحرج في [ROADMAP §3](ROADMAP.md) هو `00 → 01 → 02 → 04 → 06 → 07 → 09 → 20`. فالتالي على المسار الحرج هو **Phase 09**، لكنّها تعتمد على 07 **و08** معاً، فأمام من يأتي بعدي بابان مفتوحان لا واحد:

| الخيار | لماذا يُختار | ما يفتحه | ما يُبقيه مغلقاً |
|---|---|---|---|
| **Phase 05 — Driver Core** | يسدّ أهمّ دَيْن مُعلَن في 07: الأهليّة تصير `driver_core` بدل `claimed`، فيصير «من يصلح؟» جواباً مُتحقَّقاً لا مُدّعى. ويُلبس البوابة واجهةً: السائق يقبل من تطبيقه | التسجيل · ملفّ السائق · المستندات · كتابة `driver_candidacy` من مصدر موثوق | 09 (تحتاج 08 أيضاً) |
| **Phase 08 — Negotiation & Chat** | اعتمادها الوحيد 07 وقد أُغلقت، وهي **على المسار الحرج** فتُقرّب 09 و20 | التفاوض والتوافق على السعر وتسجيله في الطلب | دَيْن الأهليّة يبقى مفتوحاً حتى 05 |

**القرار المُتَّخذ (2026-08-22): بدأت Phase 05 وأُغلقت في اليوم نفسه بستّ مراجعات وبوابة خروج اجتازت — انظر §13.** فالمقارنة أدناه صارت **سجلّاً تاريخياً**، و**التالي بلا مقارنة هو Phase 08 (Negotiation & Chat)**: اعتمادها الوحيد 07 وقد أُغلقت، وهي على المسار الحرج `00 → 01 → 02 → 04 → 06 → 07 → 09 → 20` فتُقرّب 09 و20. وما تُسلّمه لها Phase 05 هو أنّ المرشّح صار **مُتحقَّقاً** لا مُدّعى، فالتفاوض يبني على سائق موجود فعلاً. والتوصية التي بُني عليها (وهي كانت توصية لا قراراً): ابدأ بـ**Phase 05**. السبب: البوابة الحالية تُثبت أنّ التوزيع يعمل على أهليّة **يدّعيها الاختبار**؛ وكل مرحلة تُبنى فوق 07 قبل 05 تُراكم منطقاً يفترض مرشّحين موثوقين وهم ليسوا كذلك بعد. و08 لا تفقد شيئاً بالتأخير لأنّ اعتمادها لا يتغيّر.

**وقد بدأت Phase 08 فعلاً في 2026-08-23 بـMR 1/6 — فخطّتها الكاملة وحالة كل مراجعة فيها في §14 أدناه، وهي المرجع لا هذا القسم.**

**وفي كل الأحوال، ما يجب أن يُقرأ أولاً:** §11 أعلاه (خصوصاً درس البديل الذي لا يعرف القيد) · [PHASE07_EXIT_GATE_E2E.md](../12-testing/PHASE07_EXIT_GATE_E2E.md) §5 و§8 · [MATCHING_DISPATCH §9](../03-domain/MATCHING_DISPATCH.md) للديون المفتوحة · و[PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md): لا دفعة بلا وثيقة في **نفس** الالتزام.

## 13. Phase 05 (Driver Core) — مكتملة ✅ (2026-08-22) · بوابة الخروج اجتازت (MR 1/6 → 6/6)

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
| **2/6** | طبقة مجال نقيّة `@wasla/drivers-service` — **حاسب الأهليّة أولاً** بجدولٍ صريح لكل شرط وكود عجزه وقاعدة **«كلّ الأسباب لا أوّلها»** (نُقضت هنا «السبب الأوّل يفوز» المنقولة عن المطابقة بوعي: المطابقة تُقيّم آلاف الصفوف لمُوزّع فيكفيها سبب، ونواة السائق تُجيب سائقاً واحداً عن نفسه فقائمةٌ جزئيّة تجعله يُصلح شيئاً ويُرفض مرّة أخرى — والاستثناء الوحيد `PROFILE_SUSPENDED` يقطع القائمة لأنّ الوثائق لا ترفع إيقافاً)، آلة حالة الوثيقة والمركبة، منافذ + مُهيّئات ذاكرة تُحاكي قيود `schema.sql` **بأسمائها**. بلا قاعدة وبلا HTTP | ✅ [!52](https://gitlab.com/uxxxu/wasla/-/merge_requests/52) |
| **3/6** | استمرارية Drizzle/Postgres + وحدة عمل تجعل الصفّ وسجلّ الأهليّة والصادر في معاملة واحدة + وظيفة CI `drivers-db-integration` + حارس انحراف مرآة↔DDL | ✅ **مدفوعة** |
| **4/6** | طبقة HTTP على **8090**: 13 مساراً + `/health` بحالتيه + مقبس معاملة (`DriverRunner`) فلا يملك معالج مسار فتح معاملة + `onlyKeys()` على كل حمولة | ✅ **مدفوعة** ([!54](https://gitlab.com/uxxxu/wasla/-/merge_requests/54) · [DRIVER_HTTP.md](../04-api/DRIVER_HTTP.md)) |
| **5/6** | **ناشر الترشيح الحقيقي** (`HttpCandidacyPort` إلى 8088) + واجهة بوت السائق (تسجيل · وثائق · إعلان توافر) | ✅ **مدفوعة** ([!55](https://gitlab.com/uxxxu/wasla/-/merge_requests/55) · [DRIVER_BOT_FLOWS.md](../02-architecture/DRIVER_BOT_FLOWS.md)) |
| **6/6** | **بوابة خروج المرحلة E2E** `packages/driver-e2e`: **سبع خدمات** تعمل بساعة واحدة مُحقونة — سائق يُسجَّل ويُراجَع فيصير مؤهَّلاً **بأهليّة محسوبة** فيصله عرض حقيقي من التوزيع، ثمّ تنتهي وثيقته **بنبضة واحدة** فيخرج من التجمّع، و`eligibility_source` يقرأه أحدٌ `driver_core` لا `claimed` · 14 اختباراً + [PHASE05_EXIT_GATE_E2E.md](../12-testing/PHASE05_EXIT_GATE_E2E.md) + وظيفة `driver-exit-gate-e2e` | ✅ **مدفوعة** ([!56](https://gitlab.com/uxxxu/wasla/-/merge_requests/56)) |

### ما أنجزته MR 1/6 بالضبط

- `services/drivers/contracts/schema.sql` — **ثمانية جداول** (`driver_profiles` · `driver_service_zones` · `driver_vehicles` · `driver_documents` · `driver_eligibility_policies` · `driver_eligibility_log` · `driver_candidacy_publications` · `driver_outbox`) بقيود مُسمّاة تمنع **بالبناء** ما كان سيُترك للمراجعة البشرية: إيقافٌ بلا سبب · مركبتان رئيسيّتان · مركبة مُخرَجة وهي رئيسية · وثيقة مُراجَعة بلا مُراجِع أو مرفوضة بلا سبب · وثيقةُ مركبةٍ بلا مركبة · نوعُ وثيقةٍ **مجهول** في السياسة (ومطلوبٌ لا يمكن تقديمه يجعل **كل** سائق غير مؤهَّل بصمت) · حالةٌ غير مؤهَّلة **بلا سبب واحد** · نتيجةُ نشرٍ خارج الكتالوج. وتراجعات الهجرة معلّقة في الملف نفسه.
- `services/drivers/contracts/api.openapi.yml` — 3.1 على **8090**، **13 مساراً و17 عملية و19 مخططاً** بـ`additionalProperties: false`. و`POST /drivers/eligibility/tick` **بلا `requestBody` معلَن** لأنّ Fastify يرفض جسماً فارغاً معلَناً بـ400 — درس مُقاس من الطور 07.
- `services/drivers/contracts/events.json` — أحد عشر حدثاً في مغلّف واحد بمُنتِج `drivers-service`.
- `services/drivers/contracts/errors.md` — **21 كود خطأ** + **تسعة أكواد أسباب** لعدم الأهليّة في كتالوج مُغلَق.
- `packages/contracts/driver/` (`@wasla/contracts-driver`) — أنواع مُكتبة مولّدة من العقد + **59 اختبار حارس انحراف** تقرأ ملفات العقد **من القرص وقت التشغيل**: تطابق أكواد الأخطاء في الاتجاهين · تطابق كتالوج الأسباب حرفياً بين ثلاثة مواضع · وجود القيود الحاكمة في الـDDL · بحث سلبي على عمود الأهليّة · وحارس الخصوصية الآلي.

### ما أنجزته MR 2/6 بالضبط

- `services/drivers/src/domain/` — ثمانية ملفّات: `model.ts` (النموذج، ومجموعات القيم المُقفلة **مُعاد تصديرها** من `@wasla/contracts-driver` لا مُعاد كتابتها) · `errors.ts` (21 كوداً؛ و`ConstraintViolation` **ليس** `DriverError` لأنّ قيداً يشتعل يعني أنّ المجال سمح بكتابة كان عليه رفضها — أي عيبٌ فينا، وإلباسه 4xx هو كيف يُصنَّف مشكلةَ متصل لسنة) · `policy.ts` (`saudi-launch-v1` مُقفَلة، و`requireUsablePolicy` يرفض نسخة غير مُقفَلة) · `eligibility.ts` (دالّة نقيّة، و`now` مُمرَّر لا مقروء) · `documents.ts` (آلة الحالة جدولاً + `deriveVerificationStatus`) · `vehicles.ts` · `validation.ts` · `events.ts`.
- `src/ports.ts` + `src/infrastructure/in-memory.ts` — المنافذ التي تُنجزها MR 3/6، ومُهيّئات تُحاكي **12 قيداً بالاسم الحرفيّ** الذي تحمله في `schema.sql`، وترتيب الكتابات يتبع القيد لا الراحة (الإخلاف قبل الإدخال، والتنزيل قبل الترقية) لأنّ الترتيب المعاكس ينجح في الذاكرة ويفشل على القاعدة — وهو صنف الفرق الذي وُجد المنفذ لمنعه. و`updated_at` يُختم في المخزن لا يُقبل من متصل.
- `src/use-cases/` — ستّ حالات، وكلّها تنتهي عند `recomputeEligibility` **المُقرِّر الوحيد**. والإيقاف يمنع كتابات السائق **ولا يمنع المراجعة**، لأنّ صفّ العمليّات يجب أن يُكمل العمل على الملفّ الموقوف وإلّا استحال رفعه.
- `src/mappers.ts` — الموضع الوحيد لتحويل `camelCase ⇄ snake_case`، وحارسٌ يقارن مفاتيحه بقائمة `required` في `api.openapi.yml`.
- **69 اختباراً** في خمسة ملفّات: 16 أهليّة · 20 آلات حالات · 16 نشر · **13 حارس تباعد** يقرأ العقد والوثيقة من القرص · **4 حارس خصوصيّة** يُشغّل كلّ مسارات الكتابة ثمّ يبحث في الحمولات عن اللوحة ومؤشّر الملفّ والاسم وهويّة المراجع — **قيماً وأسماء حقول** — لأنّ الاستجابة تذهب إلى قارئ واحد سألها، والحدث يذهب إلى كلّ مشترك وإلى سجلّ كلّ مشترك.
- **مخالفتان فعليّتان أمسكهما الحارسان** (لا افتراضيّتان): `EligibilityView` تسمّي الحقل `eligibility_state` لا `state` وتُعلن `additionalProperties: false` — فحُذف `recheck_at` من السلك، والقيمة غير مفقودة إذ تُنشَر `eligibility_recheck_at` على الملفّ · وسِجلّ `events.json` مستند JSON Schema فقُرئت أنواع الأحداث من `$defs[*].properties.event_type.const`، وهي القراءة التي تُمسك **إعادة تسمية** قيمة سلكيّة.
- `docs/02-architecture/DRIVER_CORE_DOMAIN.md` — كلّ قرار في هذه المراجعة مع بديله المرفوض.

### ما أنجزته MR 3/6 بالضبط

**المعيار المُعلَن مسبقاً تحقّق: لم يتغيّر أي ملفّ تحت `src/use-cases/`.** التفصيل الكامل بكل قرار وبديله المرفوض في [DRIVER_PERSISTENCE.md](../02-architecture/DRIVER_PERSISTENCE.md).

- `src/infrastructure/drizzle/{db.ts,schema.ts,repository.ts,transaction.ts}` (57 · 396 · 1033 · 141 سطراً) — **تسعة مُهيّئات تخزين** تقبل كلّها `DbOrTx` و**لا تفتح معاملة بنفسها**؛ من يملك حدود المعاملة هو `PostgresDriverUnitOfWork` وحدها. `run()` تفتح معاملة وتربط التسعة بمقبضها، و`read()` تعمل على المقبض الجذري بلا معاملة — فـGET لا يحتجز اتصالاً مقابل ضمان اتساقٍ لا تستطيع استجابة JSON واحدة أن تُظهره.
- **الحدّ هو العمليّة التطبيقيّة لا نداء المستودع.** مراجعة وثيقة واحدة تُنفَّذ عبر ستّ نداءات منافذ فتُنتج **تسع كتابات في ستّة جداول**. والبادئات المُحتملة ليست بريئة: وثيقة `superseded` بلا بديل تعني أنّ السائق **خسر ورقةً موثَّقة بسبب** رفعه نسخةً أحدث؛ ووثيقة `verified` بلا صفّ في السجلّ تعني تغيّرَ حالةٍ بلا تفسير، وهو الشيء الوحيد الذي بُنيت هذه الخدمة لمنعه؛ **والأخطر صفّ `driver_idempotency` بلا صفوف خلفه** — فتُجاب إعادة المحاولة «تمّ من قبل» من صفٍّ لا وجود له، وهو ضياعٌ دائم لا يُصلحه طلب لاحق.
- **ما يبقى خارج المعاملة عن قصد:** `candidacy` (نداء HTTP صادر — معاملةٌ مفتوحة عبر الشبكة تجعل مدّة أقفالنا رهينةَ خدمة أخرى، فمطابقةٌ بطيئة تصير عاصفة أقفال عندنا؛ والتصميم يحتمله أصلاً إذ **النشر الفاشل لا يُراجع التغيير المحليّ**) و`zoneCatalog` و`clock` و`ids`. الأربعة في `DriverSharedDeps` تُقرأ مرّةً عند التشغيل.
- **فجوة مكتشفة — منفذٌ بلا جدول** (نفس فجوة المطابقة والتوزيع): `IdempotencyStore` كان مُعلَناً في MR 2/6 ومُستعملاً في `registerVehicle` و`submitDocument` **ولا مخزن له في العقد**، والمُهيّئ في الذاكرة أخفى ذلك تماماً — الـ69 اختباراً كلّها خضراء، والخدمة كانت ستفقد ذاكرة التكرار عند كل إعادة تشغيل فتُقبَل المركبة الثانية. أُضيف `driver_idempotency` في **§9 من العقد** كترحيلٍ إضافيّ قابل للتراجع.
- **قرارٌ يخالف سابقة التوزيع عن قصد: 8..192 لا 8..128.** المفتاح المخزون ليس مفتاح المتصل بل مُنطَّقاً (`document:WS-1000000001:<key>` = 152 حرفاً)؛ بحدّ 128 كان مفتاحٌ **قانونيّ تماماً** بطول 128 يُرفض بمخالفة قيدٍ لا يستطيع المتصل تفسيرها ولا تفاديها. والحسبة مكتوبة في العقد، ويحرسها فحصٌ يتأكّد أنّ **كلا** الحدّين موجود (8..128 للأعمدة · 8..192 للجدول العامّ) — فتوحيدهما لاحقاً بحسن نيّة يُعيد الخلل. والتنطيق ليس تجميلاً: بلا البادئة، `k-1` لمركبة ثمّ `k-1` لوثيقة يُجاب على الثاني «تمّ من قبل» فلا تُرفع الوثيقة أبداً.
- `src/runner.ts` (78 سطراً) — `DriverRunner` يُخفي فرق التركيب بين الذاكرة وPostgres. وموضعه **خارج `src/use-cases/`** مقصود: مساعدٌ يُركّب المعاملات شأنُ بنية تحتيّة، ولو جلس بين حالات الاستخدام لصار المجال على استيرادٍ واحد من معرفة أنّ معاملةً موجودة. وفي `createDirectRunner` تتطابق `write` و`read` تطابقاً تامّاً — **صدقٌ لا تراخٍ**: المخازن في الذاكرة لا معاملة لها، والتظاهر بغيرها يُخفي الفرقَ الذي وُجدت مجموعة المطابقة لقياسه. MR 4/6 تستقبله ولا شيء غيره، فلن يكون أي معالج مسار في موضعٍ يستطيع فيه فتح معاملة — الخطأ **غير متاح** لا مجرّد غير مُستحسَن.
- **`updated_at` يملكه المُشغّل** (`trg_driver_profiles_updated_at` · `trg_driver_vehicles_updated_at` · `trg_driver_documents_updated_at`) ولا يكتبه أي مُهيّئ: من يستطيع كتابته يستطيع أن يجعل تغييراً قديماً يبدو جديداً. فالمُهيّئات تُعيد قراءة الصفّ بعد الكتابة، و`profiles.update` بتحويرٍ فارغ ما زالت تُنفّذ `UPDATE` لأنّ مُهيّئ الذاكرة يطبع الطابع في هذه الحالة أيضاً. وهو **الاستثناء الوحيد** في مقارنة المُهيّئين — قائمةُ استثناءات تنمو كلّما فشل اختبار تمسح الشيءَ الوحيد الذي يقيسه الملفّ.
- **28 حارس انحراف مرآة** (`schema-drift.test.ts`، بلا قاعدة، يعمل في `build-test`): يقارن العقد بإسقاط Drizzle في الاتجاهين — بما فيه «الجداول التي يُعلنها العقد وليس لها إسقاط»، وهو الاتجاه الذي كان سيكشف `driver_idempotency` قبل وجوده — ويتحقّق أنّ **كل اسم قيد** يذكره تعليقٌ أو فرعُ `switch` في `in-memory.ts` أو `repository.ts` موجود فعلاً في العقد؛ فالاسم المُخطئ **فرعٌ لا يعمل أبداً**، يسقط الـ23505 إلى خطأ المُشغّل الخام فتُجيب الواجهة 500 حيث وعدت بـ409. والنمط غير مُقيَّد بالحشو `_driver_` عن قصد: هذه الخدمة تُسمّي قيودها على المفهوم الذي تحميه (`ck_policy_required_documents_known` · `ck_candidacy_publication_outcome`)، وحارسٌ يفحص `*_driver_*` وحدها كان سيتخطّى أربعةً من الاثني عشر قيداً المُحاكاة.
- **79 اختبار تكامل** في وظيفة CI `drivers-db-integration` (قاعدة مستقلّة `wasla_drivers_test`):
  - **50 مستودع** — الفهرسان الجزئيّان مُطبَّقان فعلاً؛ و`COALESCE` إلى الـUUID الصفري هو وحده ما يمنع وثيقتَي هويّة حيّتين (فـ**NULL يختلف عن NULL** في فهرس فريد)، والتعبير مُستنسَخ في `documents.findLive` ويحرس الحارسُ وجوده في الموضعين لأنّ انحرافهما يجعل التطبيق يقرأ صفّاً والفهرس يحمي آخر وكلا النصفين يبقى «عاملاً»؛ وأعمدة `DATE` تعود يوماً تقويميّاً `"YYYY-MM-DD"` لا طابعاً زمنيّاً — وقسرُها إلى ISO يسحب توقيت الخادم إلى انتهاء رخصةٍ فيخسر سائقٌ في المدينة أهليّته **بثلاث ساعات مبكّراً**؛ و`latest()` يرتّب بـ`BIGSERIAL` لا بـ`evaluated_at` لأنّ الإلحاقات الثلاث في عمليّة واحدة تحمل **اللحظة نفسها**؛ و`23505` يُترجَم إلى خطأ مجال مُسمّى بسلسلة `cause` حتى أربع طبقات لأنّ Drizzle يُغلّف خطأ `pg`.
  - **23 مطابقة منافذ** — السيناريو الواحد يُنفَّذ مرّتين والأثران يُقارَنان **أحدهما بالآخر** لا بتوقّع مكتوب بيد، لأنّ التوقّع المكتوب بيد رأيٌ ثالث **يستطيع أن يوافق خللاً موجوداً في المُهيّئين معاً**. ثلاث قواعد تُلزم السيناريوهات: مفاتيح تكرار **ثابتة** (فـ`helpers.nextKey()` يُحرّك عدّاداً على مستوى الوحدة فيتلقّى التنفيذان مفاتيح مختلفة) · بذْرٌ عبر حالات الاستخدام وحدها (فمساعدات `helpers.ts` مُنمَّطة على بيئة الذاكرة وتمدّ يدها إلى `env.zoneCatalog.seed`) · **حرسٌ ضدّ الفراغ** قبل المقارنة، فأثران فارغان يتساويان وكان الاختبار سيمرّ وهو لا يُثبت شيئاً.
  - **6 ذرّية** — تُفشِل `outbox.append` عند النداء الـN، والـoutbox هو الموضع الصحيح للكسر لأنّه **يُكتب آخراً** فكلّ ما سبقه نجح. ومعها **حالة ضبط** تُثبت أنّ الارتكاز يحدث فعلاً (فبلا هذه الحالة قد تعني مجموعةٌ خضراء «لا شيء يُكتب أبداً») و**حالة إعادة محاولة تنجح** بعد التراجع، لأنّ التراجع لا يُفيد إن لم يُمكن إعادة تشغيل الطلب نفسه.
- `vitest.integration.config.ts` بـ`fileParallelism: false` **ضرورةً لا تفضيلاً**: كلّ ملفّ يملك مخطّط **القاعدة نفسها** (`DROP TABLE` ثمّ إعادة تشغيل الـDDL)، فملفّان متوازيان يتسابقان على تلك الجداول. والمخطّط يُطبَّق **من العقد لا من Drizzle**، فاختبارٌ يبني جداوله من الإسقاط يمرّ بينما العقد يقول شيئاً آخر — وهو الشيء الوحيد الذي وُجدت هذه الاختبارات لكشفه.
- **`resetData` يستثني `driver_eligibility_policies`** عن قصد (سابقة `matching_rulesets`، وعكس التوزيع الذي لا يزرع الـDDL فيه شيئاً): الإصدار 1 `saudi-launch-v1` المُجمَّد بذرةٌ في الـDDL فهو **بيانات عقد لا بيانات اختبار**، ويقرأه الحاسب كلّه عبر `findActive()`. تفريغه يجعل كل تسجيل تالٍ يفشل بـ`policyNotFound()` — وأسوأ من ذلك، مجموعةٌ خضراء لا تُثبت إلّا أنّ التسجيل **لا** يعمل.

### ما أنجزته MR 4/6 بالضبط (Phase 05 — طبقة HTTP على 8090، [!54](https://gitlab.com/uxxxu/wasla/-/merge_requests/54))

التفصيل الكامل بكل قرار وبديله المرفوض في [DRIVER_HTTP.md](../04-api/DRIVER_HTTP.md).

- **ثلاثة عيوب عقد صُحِّحت قبل كتابة سطر مسار واحد** — لأنّ بناء طبقة على عقد نعرف خطأه يجعل الكود صحيحاً والوثيقة كاذبة: `HealthStatus.last_tick_at` كان يُعاد ولا يُعلَن (حقلٌ غير معلَن في ردّ **انحرافٌ صامت**) · `VehiclePatch.status` ضُيِّق إلى `[retired]` وحدها لأنّ `active` كانت **وعداً لا يُنجزه أحد**: `patchVehicle` ترفضها بـ400 منذ MR 2/6 إذ إعادة التفعيل تسجيلٌ جديد لا تعديل، وإبقاؤها تدفع المستهلك لكتابة فرعٍ لا ينجح أبداً · `ErrorResponse.error.details` صار ذا خصائص معدودة، فـ`details` بلا شكل تمنع أيّ مستهلك من قراءتها بأمان. ثمّ أُعيد توليد `packages/contracts/driver/src/api-types.ts`.
- **حقلٌ زائد حُذف من السلك:** `mappers.ts` كان يضع `wasla_public_id` في `VehicleWire` و`DriverDocumentWire` وليس معلَناً في مخطّطيهما — والمعرّف في المسار أصلاً، وتكراره في العنصر يضاعف مصدر الحقيقة. وأُضيف `eligibilityTickToWire` و`healthToWire`.
- `src/http/requests.ts` (337 سطراً) — الترويسات ومعرّف `WS-` وUUID و`onlyKeys()` على كلّ حمولة، وقرّاء أشكال قياسيّة (`nullableString` · `nullableInteger` · `optionalBoolean` · `oneOf`). والرأس المكرَّر مرفوض **مصفوفةً أو نصّاً بفاصلة** لأنّ Node قد يدمج التكرار في نصّ واحد. و**لا صدى للمرفوض في أي رسالة خطأ**: رسالةٌ تُعيد ما كتبه المتصل تجعل سجلّنا مخزناً لكلّ ما كُتب في حقل.
- `src/http/idempotency.ts` (88 سطراً) — `POST /drivers` وحدها تُحسم إعادتها **عند حدّ HTTP**: `registerDriver` لا يأخذ مفتاحاً ولم نُضِفه إليه (كان سيغيّر توقيعاً يستدعيه كلّ متصل وكلّ اختبار مقابل وعدٍ لا يوجد إلّا عند الحدّ). المفتاح مُنطَّق (`profile:<id>:<key>`) والحمولة **مهضومة sha256 على صورة مرتّبة المفاتيح**، فـ**اسم السائق لا يُخزَّن قابلاً للقراءة** في سجلّ منع التكرار، وترتيب مفاتيح JSON لا يصنع «حمولة مختلفة». والتذكّر والإنشاء في **معاملة واحدة** فلا يبقى مفتاحٌ متذكَّر بلا ملفّ.
- **عيبٌ في تنفيذنا أسقطه اختبار (لا افتراضيّ):** المركبات والوثائق كانت تقرأ سجلّ المفتاح و**تُعيد السطر الموجود مباشرة**، فمفتاحٌ مُعاد **بحمولة مختلفة** يُجاب بـ200 عن مركبة ليست المطلوبة بدل 409. الآن اللمس الوحيد للسجلّ حسابُ رمز الحالة (201 أو 200)، و`registerVehicle`/`submitDocument` **يُستدعى دائماً** فيبقى قرار الإعادة أو التعارض في المجال حيث كُتب واختُبر.
- `src/use-cases/read-driver.ts` (68 سطراً) — القراءات الأربع، وكلّها تتحقّق من وجود الملفّ أولاً: المستودعات تُعيد `[]` للمعرّف المجهول، فتمريرها يجعل المسار يُجيب 200 بقائمة فارغة عن **سائق لا وجود له** — وهذا يخبر المتصل أنّ السائق موجود وبلا مركبات، وهو أسوأ من الخطأ الصريح. و`GET /eligibility` كذلك: `readEligibility` **يُغلق فاشلاً** فيعيد `unknown`، وهو الصواب داخل المجال وخطأٌ على السلك. وهو المسار القارئ الوحيد الذي يستعمل `runner.write` لأنّه **يعيد الحساب** ويُلحق سطر السجلّ.
- `src/http/app.ts` (473 سطراً) — المسارات الثلاثة عشر بلا `try/catch` واحد في معالج؛ `setErrorHandler` وحده يُغلّف. و`/drivers/eligibility/tick` مسجَّل **قبل** `/drivers/:waslaPublicId` عمداً وإلّا صار `eligibility` معرّفاً عامّاً مرشَّحاً للمطابقة. و`PATCH` الملفّ يُبنى بـ`"key" in body`: **الغائب ليس الصريح بقيمة فارغة** — `{"work_city_zone_id": null}` إلغاءُ منطقة، وغيابُه «لا تلمسها». والنبضة **لا تمرّر `traceId`**: طلبٌ واحد يعيد حساب مئات السائقين، ووسمُ أسطرهم كلّها بمعرّف طلبٍ واحد يفسد التدقيق بدل أن يخدمه.
- `/health` بثلاثة مفاتيح فقط و**بلا مفتاح `service`** — عقد السائقين لا يعلنه بخلاف عقد التوزيع، وإضافته انحرافٌ صامت. و`last_tick_at` **في الذاكرة بقصد**: مؤشّرٌ تشغيليّ لهذه العمليّة لا حقيقة مشتركة، وترقيته إلى جدول تجعله كذبةً عند تشغيل نسختين.
- **الغلاف متداخل** `{error:{code,message,details?},trace_id}` — شكل عقد السائقين لا الغلاف المسطَّح في التوزيع. والحالة تأتي من **صنف الرمز** في حزمة العقد فلا رقم HTTP مكتوب بيد. والرأس المفقود له رمزه الخاص `DRIVER_IDEMPOTENCY_KEY_REQUIRED` لا الرمز العام. وغير المصنَّف → **503 لا 500**: ما يعطب هنا تخزين أو دليل مناطق أو صندوق صادر، و503 تخبر المتصل أنّ الإعادة قد تنجح؛ والرسالة الداخلية لا تُسرَّب. ومسار Fastify المجهول يبقى 404 بشكله الافتراضي — إجابته بـ`DRIVER_NOT_FOUND` تخبر متصلاً أخطأ في كتابة **المسار** أنّ **السائق** مفقود.
- `src/http/server.ts` (153 سطراً) — جذر التركيب: `DATABASE_URL` → `PostgresDriverRunner` وإلّا ذاكرة و`degraded`؛ إنهاء المسبح على `onClose` وSIGTERM/SIGINT. و**غير مُصدَّر** من `src/index.ts` لأنّه ينتهي بـ`await main()`، فتصديره يجعل كلّ من يستورد الحزمة يحجز 8090.
- **64 اختبار HTTP** في ستّة ملفّات (إجمالي الخدمة **164 اختباراً في 12 ملفاً**): حرّاس انحراف تفرض **الاتجاهين** (كلّ عملية عقد لها مسار مسجَّل · وكلّ مسار مسجَّل معلَنٌ في العقد فلا نقطة نهاية غير موثَّقة · والعدد ثلاثة عشر وهو المتعهَّد به) · وشكل الخطأ ومعرّف التتبّع المُعاد كما أرسله المتصل · و**ربط 502 مُبرهَناً بحقن Runner يرفعه** قبل وجود أي منفذ يستطيع رفعه. وإجمالي المستودع **2061 اختباراً ناجحاً في 126 ملفاً** و`pnpm -r run typecheck` نظيف (لقطة محليّة 2026-08-22).

### ما أنجزته MR 5/6 بالضبط (Phase 05 — المنافذ الصادرة + بوت السائق)

التفصيل الكامل بكل قرار وبديله المرفوض في [DRIVER_BOT_FLOWS.md](../02-architecture/DRIVER_BOT_FLOWS.md)، وأثر تقاعُد 502 على العقد في [DRIVER_HTTP §8](../04-api/DRIVER_HTTP.md).

- **`HttpCandidacyPort` إلى المطابقة (8088)** — `services/drivers/src/infrastructure/http-candidacy.ts`. الفشل **مصنَّف لا موحَّد**: 400/409/422 جوابٌ صالح من خدمة رفضت، فيُعاد `{accepted:false, failureCode}` ويُسجَّل ويبقى التغيير المحليّ قائماً؛ وكلّ ما عداه (503 · مهلة · شبكة) **يُرفع**، لأنّ «رفَضَت» و«لم تُجِب» ليسا الشيء نفسه ومَن يخلطهما يخفي انقطاعاً كاملاً في عدّاد رفضٍ عاديّ. و`failureCode` يُقرأ من غلاف المطابقة **المسطَّح** `{code,message,trace_id}` (لا المتداخل — هذا الفرق نفسه هو ما يجعل قارئاً ساذجاً يسجّل `undefined` لكل رفض) وإلّا فـ`MATCHING_HTTP_<status>`.
- **`Idempotency-Key` لكلّ محاولة لا لكلّ محتوى**: `drv-{driverId}-{attemptMillis}-{sha256(payload).slice(0,8)}`. مفتاحٌ من هضم المحتوى وحده كان **يكسر ميزة**: `available → offline → available` يعيد الحمولة الأولى نفسها فتُجاب الثالثة «تمّ من قبل» ويبقى السائق مُعلَناً `offline` في المطابقة — أي سائقٌ يقول «أنا متاح» فلا يراه أحد، وهو بالضبط ما حذّرت منه ADR-012 القرار 3.
- **`HttpZoneCatalogPort` إلى الجغرافيا (8081)** — `http-zone-catalog.ts`. `404` ⇒ غير موجودة · `status==="active"` ⇒ موجودة · **منطقة غير نشطة ⇒ غير موجودة** (فقبولها يجعل سائقاً مؤهَّلاً لمنطقة أوقفتها العمليات) · وأيّ فشل آخر أو مهلة (2000ms) ⇒ `DRIVER_UNAVAILABLE` **بلا إعادة محاولة**: التحقّق يجري داخل معاملة، وإعادةٌ داخلية تُطيل قفلاً بقدر بطء خدمة أخرى. و**`DRIVER_DEV_ZONE_IDS` تقلّص إلى بديل تطويريّ مُعلَن بتحذير** عند غياب `GEOGRAPHY_SERVICE_URL` — فأُغلق الانحرافان 6 و7 في DRIVER_HTTP §9.
- **عيبٌ فعليّ أسقطه بناء المنافذ (لا افتراضيّ):** `recomputeEligibility` كانت تنادي `candidacy.read()` **خارج** `try/catch`، فمطابقةٌ معطوبة كانت **تُسقط عمليّة كتابةٍ محليّة نجحت** — وهو نقضٌ مباشر لـADR-012 («النشر الفاشل لا يُراجع التغيير المحليّ»). لم يظهر قبلاً لأنّ المنفذ الوحيد كان في الذاكرة ولا يفشل. نُقلت القراءة داخل الحارس، وثلاثة اختبارات أثر تُثبت أنّ قراءةً معطوبة لا تُفشِل الكتابة **ولا تستبدل صفّ `busy` مبذوراً**.
- **502 تقاعَد بدل أن يُستعمل** — `DRIVER_CANDIDACY_PUBLISH_FAILED` حُذف من العقد (عشرة مواضع) ومن `domain/errors.ts` ومن حزمة العقد و`api-types.ts`، وصارت رموز الخدمة **20 لا 21**. المسوّغ الكامل في [DRIVER_HTTP §8](../04-api/DRIVER_HTTP.md)، وخلاصته أنّ الكتابة المحليّة نجحت فمن نجح يُعيد مورده، والانقطاع له `DRIVER_UNAVAILABLE` (503). والتقاعُد **محروس**: قسمُ أكواد متقاعدة في `contracts/errors.md` يقرأه `contract-drift.test.ts` ويفشل إن عاد أحدها إلى العقد أو الكود **وبالعكس**، وحارسٌ ثانٍ يفشل إن وُجِد **مصنع خطأ مُصدَّر لا يستعمله أيّ مسار إنتاج** — فالرمز الميت لا يعود بالنسيان.
- **`outbound-wiring.ts`** — `configuredCandidacy(env)` و`configuredZoneCatalog(env, log)` **تأخذ البيئة معاملاً لا تقرأ `process.env`**، فيستطيع الاختبار وبوت السائق تركيب المنافذ نفسها بلا تلويث بيئة العملية، وتبقى المطابقة غير المهيّأة **رفضاً مُسجَّلاً** (`MATCHING_NOT_CONFIGURED`) لا نجاحاً موهوماً.
- **بوت السائق رُبِط بالمجال** — `bots/driver-bot/src/{flows.ts,driver-core.ts}`: `/start` تسجيل · `/status` الحكم بكلّ أسبابه التسعة المترجَمة · `/available` و`/offline` إعلان توافر · `/docs` قائمة الوثائق. والبوت يستدعي حالات الاستخدام **داخل العملية** لا عبر HTTP (سابقة [CUSTOMER_BOT_FLOWS §4](../02-architecture/CUSTOMER_BOT_FLOWS.md)). و`/available` **يردّ بالحكم لا بـ«تمّ»**: سائقٌ غير مؤهَّل يُجاب «تمّ» ينتظر طلبات لا تأتي أبداً ولا يعرف لماذا. وبوّابته `DRIVER_DATABASE_URL` (لا `DATABASE_URL`) فالبوت المنشور بجانب خدمة أخرى لا يفتح القاعدة الخطأ بصمت.
- **عيبٌ في مُشغِّل العملية أصاب بوت العميل المنشور** — `main.ts` كان ينادي `runBot(BOT)` فيبني التطبيق من `buildBotApp` **متخطّياً `buildApp()`**، أي جذر تركيب البوت وتدفقاته: **بوت العميل المنشور كان يخدم `/start` وحده بلا `/places` ولا `/orders` وطاقم اختباره أخضر بالكامل** لأنّ الاختبارات تنادي المسار الصحيح الذي لا يسلكه الإنتاج. أُضيف `runBotApp(bot, build)` في `@wasla/bot-runtime` (و`runBot` يفوّض إليه فلم تتغيّر واجهته)، وحُوِّلت البوتات **الثلاثة** إليه — بما فيها الشريك الذي لا تدفّق له بعد، ليكون جذره المُختبَر هو ما يستمع يوم يحصل على أوّله. التفصيل في [CHANNEL_BOTS §7.1](../02-architecture/CHANNEL_BOTS.md).
- **الأدلّة:** `outbound-ports.test.ts` **28 اختباراً** بحقن `fetch` لا بشبكة · `driver-flows.test.ts` **21 اختباراً** (بديل مُسجِّل + `app.inject` + مُهيّئ فعليّ فوق بيئة الذاكرة) · خدمة السائقين **194 اختباراً في 13 ملفاً** (كانت 164 في 12) · بوت السائق **27** (كان 6) · وإجمالي المستودع **2112 اختباراً ناجحاً في 128 ملفاً** (كان 2061 في 126) و`pnpm -r run typecheck` نظيف على **28 مشروعاً** (لقطة محليّة 2026-08-22).

### ما أنجزته MR 6/6 بالضبط (Phase 05 — بوابة خروج المرحلة، [!56](https://gitlab.com/uxxxu/wasla/-/merge_requests/56))

التفصيل الكامل بكل قرار وبديله المرفوض في [PHASE05_EXIT_GATE_E2E.md](../12-testing/PHASE05_EXIT_GATE_E2E.md).

- **`packages/driver-e2e` (خاصة، اختبارات فقط، بلا كود تشغيلي ولا تصديرات)** — الاستثناء **الخامس** المُعلَن من قاعدة استبعاد `*.e2e.test.ts`، بعد `channel-e2e` و`customer-e2e` و`order-e2e` و`dispatch-e2e`. السبب واحد: **بوابةٌ يمكن تجاوزها ليست بوابة**، فالملف يعمل على كلّ MR بمخازن ذاكرة، وتُعيده وظيفة CI على Postgres حقيقي. وموضعها خارج `services/drivers` **إلزامٌ لا ترتيب**: وضعها هناك يُلزم نواة السائق بالاعتماد على التوزيع والمحرّك والعميل، وهو **عكس** اتجاه المعرفة الأحاديّ في ADR-012.
- **سبع خدمات مُنصتة فعلاً** (أكثر ما رُفع في بوابة واحدة): الهوية · الجغرافيا · المحرّك · العميل · المطابقة · السائقون · التوزيع — كلّها Fastify على `127.0.0.1` بمنافذ عشوائيّة. ونواة السائق تصل المطابقة والجغرافيا بـ**محوّليها الإنتاجيّين** (`HttpCandidacyPort` · `HttpZoneCatalogPort`) لا بنسخة اختبار: صفّ الترشيح موجود لأنّ الكود الذي سيعمل في الإنتاج وضعه.
- **ساعة واحدة مُحقونة في الجميع** (`GateClock`) — لو كان لكلٍّ ساعتُه لكان «تقديم الزمن 15 ساعة» يُنهي وثيقةً عند خدمة ويُبقيها حيّة عند أخرى، فيقيس الاختبار فرق ساعتين لا انتهاء وثيقة. و**لا `sleep` في الملف كلّه**.
- **لحظة الانتهاء محسوبة لا مكتوبة**: `EXPIRY_ADVANCE_SECONDS` مشتقّ من `GATE_EPOCH` و`LICENCE_EXPIRES_AT`، فلو حُرّك أحدهما لاحقاً لَما استمرّ الاختبار يَعبُر الانتهاء بصمت وهو يظنّ نفسه يقيسه.
- **14 اختباراً في ستّ مجموعات** — كلّها عبر **HTTP العام** بلا قراءة مخزن ولا صفّ يُبنى بيد: المسار الكامل حتى `accepted` · الأهليّة ليست ادّعاءً (الفارق الوحيد هو المراجعة) · نبضة **واحدة** تُعيد `changed_drivers: 1` و`published: 1` وتُخرجه بسبب `DOCUMENT_EXPIRED` **بالاسم** · النبضة الثانية ساكنة (المؤشّر أُفرِغ) · `/health` بثلاثة مفاتيح و`last_tick_at` يبدأ `null` · الجغرافيا بوابة (**422 `DRIVER_ZONE_UNKNOWN` لا 503**) · `busy` لا يُرقّى · `offline` ينزل فوراً · التعليق يُنتج `suspended` **لا `ineligible`** والتمكين يُعيده · المطابقة تُنشئ الصفّ بـ**200 لا 201** · ولا مركبة ⇒ `NO_PRIMARY_VEHICLE` ⇒ لا عرض.
- **عيبٌ حقيقيّ أسقطته البوابة — وهذا مقصدها:** مفتاح منع التكرار في `HttpCandidacyPort` كان `drv-{driverId}-{attemptMillis}-{contentHash}`، **وعمق دفاعه مليّ ثانية واحدة**. فسائقٌ ينشر `offline → available → offline` داخل نبضة الساعة نفسها يُنتج نشرتين **بنفس المحتوى ونفس الطابع** ⇒ **نفس المفتاح** ⇒ المطابقة تُعيد جوابها المخزَّن بلا تطبيق: صفّها يبقى قديماً و`driver_candidacy_publications` يقول `published` والتدقيق نظيف. وهي **بالضبط** الحالة التي كُتبت فقرة الطابع الزمني لمنعها، عادت من دقّة الساعة.
- **الإصلاح والحارس:** عدّاد محاولات داخل الكائن يدخل المفتاح (`…-{seq}-{contentHash}`)، ولا يُحفَظ في قاعدة عمداً لأنّ مهمّته كسر التعادل **داخل عمليّة واحدة**. والحارس القديم «يمنح كل محاولة مفتاحاً جديداً» كان **يُقدّم الساعة ثانيةً بين المحاولتين** فيبرهن أنّ الطابع يتغيّر لا أنّ المفتاح فريد — فأُضيف حارس **بساعة مجمَّدة** ومحتوى متطابق ثلاث مرّات. **لا سطر تغيّر في `services/matching`:** سلوكها صحيح، والخلل في مُولِّد المفاتيح.
- **الفائدة قِيست بفحص طفرة لا وُصفت** (2026-08-22): بإعادة المفتاح القديم سقطت **2 من 14** في البوابة و**1 من 29** في الحارس الوحدوي، وبإرجاع الإصلاح عادت 14/14 و29/29.
- **الوعد المؤجَّل من الطور 07 أُوفي به هنا** — بوابة التوزيع تقول في رأسها إنّ إثبات `driver_core` يُترك للطور 05. وبذْرها يبقى `claimed` **بقصد**: ربطها بنواة السائق يجعلها تفشل حين تعطب نواة السائق فتخسر قدرتها على الفشل وحدها، والمسار `claimed` ليس ميتاً بل عقد المطابقة المُعلَن لكلّ متصل ليس نواة سائق (ADR-011). أُضيفت ملاحظة بهذا في رأس مِعْوان `dispatch-e2e`.
- **وظيفة CI `driver-exit-gate-e2e`** (تمتدّ `.db-integration-base` · `postgres:15` · `wasla_driver_e2e` · `DRIVER_DATABASE_URL`) — الوظيفة **التاسعة عشرة**. وما تضيفه فوق تشغيل الذاكرة ليس تكراراً: `listDueForRecheck` يقرأ **فهرساً حقيقياً** على `eligibility_recheck_at` فتصير دعوى «نبضة واحدة تكفي» مُثبَتة على المحرّك الإنتاجي، وصفوف النشر تبقى بعد انتهاء العمليّة، و`/health` يقول `ok` بدل `degraded`.
- **الأدلّة (لقطة محليّة 2026-08-22، لا نتيجة خطّ أنابيب — الرصيد منتهٍ):** البوابة **14/14** في ~1.1s · خدمة السائقين **195 اختباراً في 13 ملفاً** · المستودع كاملاً **2127 ناجحاً + 1 متجاوَز في 129 ملفاً** · `pnpm -r typecheck` نظيف على 29 مشروعاً.

### ما لم يُنجَز في MR 5/6 بقصد (Phase 05 — محلّه MR 6/6)

- **لا اختبار تكامل يُخرِج طلباً على الشبكة فعلاً**: الـ28 اختباراً تحقن `fetch` فتُثبت التحويل والتصنيف والمفتاح، **ولا تُثبت** أنّ المطابقة الحقيقية تقبل ما نرسله. مقابلة العقدين موضعها بوابة الخروج في 6/6 (مطابقة مستمعة على 8088 + جغرافيا على 8081 + Postgres).
- **لا رفع ملفّات ولا `/verify` في البوت**: `POST /documents` يأخذ `storage_ref` — أي مخزناً لا يملكه هذا الطور (Phase 12)، والمراجعة تحتاج `reviewed_by` أي هويّة إداريّة (Phase 10). فالبوت يُعرِض الوثائق ولا يرفعها، وهذا حدٌّ مُعلَن لا نقص.
- **`serviceKinds` تبقى فارغة عند `/start`**: لا واجهة اختيار نوع خدمة بعد، فيقول `/status` بصدق `NO_SERVICE_KIND` بدل أن نخترع قيمة افتراضية لا يملك قرارها إلّا السائق.
- **نافذة السباق على صفّ الترشيح ما زالت مفتوحة** (ADR-012 القرار 4): إغلاقها يحتاج `If-Match`/ETag على مقبس المطابقة — تغييرٌ في خدمة أخرى فخارج نطاق المرحلة كلّها لا هذه الدفعة.
- **لا مُشغّل دوريّ لنبضة الأهليّة**: `POST /drivers/eligibility/tick` مسارٌ يعمل ولا شيء يستدعيه دوريّاً — نفس دَين `retryDueDeliveries`، ويُحسم مع المُرحِّل في Phase 09.

### ما لم يُنجَز في MR 4/6 بقصد (Phase 05 — أُنجز في MR 5/6)

> **مرجع تاريخي: النقاط الثلاث الأولى أدناه أُنجزت أو حُسمت في MR 5/6** — 502 **تقاعَد** بدل أن يُرفَع، ودليل المناطق صار HTTP، وواجهة البوت رُبِطت. يبقى اختبار تكامل HTTP+Postgres وحده مفتوحاً إلى 6/6. الفقرة تُترك كما كُتبت لأنّ حذف ما تعهّدت به دفعةٌ سابقة يُخفي كيف تحرّك القرار.

- **`DRIVER_CANDIDACY_PUBLISH_FAILED` (502) غير قابل للحدوث بعد**: `publishCandidacy` يسجّل الفشل ويترك الكتابة المحليّة قائمة **ولا يرفع**. الربط منفَّذ ومُبرهَن، فيبقى على 5/6 قرار موضع الرفع وحده. و`UnconfiguredCandidacyPort` يُعيد `{accepted:false, failureCode:"matching_not_configured"}` — فشلٌ **مُسجَّل** لا منفذ صامت يدّعي النجاح.
- **دليل المناطق ما زال من متغيّر بيئة** (`DRIVER_DEV_ZONE_IDS`) على مسار Postgres أيضاً، إذ لا يوجد `PostgresZoneCatalogPort`؛ والدليل الحقيقي نداءُ HTTP إلى matching في 5/6 (السابقة: `services/matching/src/infrastructure/http-geography.ts`). دَينٌ مُعلَن أصدق من جاهزيّة موهومة.
- **لا اختبار تكامل HTTP مع Postgres ولا واجهة بوت سائق** — اختبارات هذا الـMR تحقن Runner ولا تبدأ خادماً مستمعاً؛ البوت في 5/6 والـE2E الكامل في 6/6.
- **تباعدٌ حُسم للتوثيق:** تعليقات `read-eligibility.ts` تنسب مسار النبضة إلى MR 5/6، وجدول المراجعات أعلاه يضع المسارات الثلاثة عشر كلّها في 4/6. حُسم لصالح **الجدول** (وهو المُلزِم)، وتأجيل المسار كان سيُخلّ بالعدد المتعهَّد به وبحرّاس الانحراف.


### ما لم يُنجَز في MR 3/6 بقصد (محلّه MR 4/6 وما بعدها)

- **لا HTTP بعد**: الخدمة لا تُقدّم منفذاً ولا `fastify` في `package.json` — حدٌّ مُعلَن لا نقص. محلّه MR 4/6 (المنفذ 8090).
- **`CandidacyProjectionPort` ما زال مُهيّئاً في الذاكرة** — محلّه MR 5/6 (`HttpCandidacyPort` إلى 8088).
- **لا سياسة تقليم (pruning) لـ`driver_idempotency`** — دَينٌ مُعلَن مكتوب في تعليق الـDDL نفسه: الجدول ينمو بلا حدّ. وهو **نفس** دَين `dispatch_idempotency` و`matching_idempotency`، فيُحسم للثلاثة بسياسة واحدة في Phase 09 لا بثلاث حلول متفرّقة.
- **مُرحِّل الـoutbox غير مُشغَّل** — `markPublished(eventIds, at)` مُنفَّذة وليست جزءاً من منفذ `Outbox` (فالمجال لا يُرحِّل)، والمُرحِّل نفسه Phase 09.
- **لا `docker-compose` محليّ لـPostgres** — فحوص التكامل تعمل في CI وتتخطّى نفسها محليّاً بلا `DATABASE_URL`، فيُطبَع «79 skipped» وينجح الأمر. مقصود، لا تعطيلٌ صامت.

### ما لم يُنجَز في MR 2/6 بقصد

- **لا قاعدة بيانات ولا HTTP**: لا `pg` ولا `drizzle` ولا `fastify` في `package.json`، والخدمة **غير قابلة للإقلاع** — حدٌّ مُعلَن لا نقص. محلّهما 3/6 و4/6.
- **لا مُنادي نبضة دوريّ ولا مُرحِّل صندوق صادر** — Phase 09. النبضة **نبضةٌ لا مؤقّت**: لا `setInterval` في هذه الخدمة، لأنّ مؤقّتاً يسكن عمليّةً يفقد كلّ انتهاء معلّق عند موتها ولا يلاحظ أحدٌ حتى يأخذ سائقٌ برخصة منتهية راكباً. الجزء الصامد هو `eligibility_recheck_at` في القاعدة، والمُنادي قابل للاستبدال.
- **`deficits` لا تُنشَر** على السلك وإن حُفظت في المجال: نشرها يدعو العملاء إلى التفريع عليها، وهي الجزء الذي نريده حرّاً للتغيير.

### ما لم يُنجَز في MR 1/6 بقصد (لا تُعِد بناءه من الصفر)

- **لا منطق ولا قاعدة ولا HTTP**: الخدمة **غير قابلة للإقلاع** بعد، ولا يوجد `services/drivers/src/` — محلّه MR 2/6→4/6.
- **لا مُرحِّل صندوق صادر ولا مُنادي نبضة دوريّ** — منقولان إلى Phase 09 مع نظيريهما من الطور 07، والمؤشّر عليهما `last_tick_at`.
- **الأرقام المُتحقَّقة محلياً لا في CI**: `@wasla/contracts-driver` **59/59**، وإجمالي المستودع **1994 اختباراً ناجحاً** (+1 متروك بقصد) في **120 ملفاً** على 27 مشروع عمل (+69 من طبقة مجال السائق، +28 من حارس انحراف مرآة الاستمرارية)، و`pnpm -r typecheck` نظيف. وخطّ الأنابيب سيظهر **أحمر** لسبب لا علاقة له بالكود: **حصّة دقائق CI منتهية** (§2-أ) — لا تُطارِده ولا تُصلحه بتعديل كود.

## 14. Phase 08 (Negotiation & Chat) — مكتملة ✅ (2026-08-23) · بوابة الخروج اجتازت (MR 1/6 → 6/6 مدمجة)

**نقطة البداية ليست كوداً.** المرحلة بدأت من حدّها: [ADR-013](../15-decisions/ADR-013-negotiation-chat-agreement-boundary-and-tick-driven-expiry.md) + عقود `services/negotiations/contracts/*` + `@wasla/contracts-negotiation` + [NEGOTIATION_CHAT.md](../03-domain/NEGOTIATION_CHAT.md) + [CONTAINERS §4.5](../02-architecture/CONTAINERS.md) — النمط نفسه الذي أنجح الأطوار 04 و06 و07 و05.

**بوابة خروج المرحلة** (من [ROADMAP §3](ROADMAP.md)): «تفاوض + توافق على السعر **وتسجيله في Order**». والشقّ الأخير ليس عمل التفاوض: التفاوض **يُسلّم** والطلب **يسجّل** — انظر «الدَّين المُعلَن» أدناه.

### ما حُسِم فعلاً (ADR-013 — لا يُعاد التفاوض عليه بلا ADR ناسخ)

1. **خدمة مستقلّة `services/negotiations`** على المنفذ **8091** (بعد 8090 سائقين)، والرقم **ثابت مُصدَّر من حزمة العقد** (`NEGOTIATION_SERVICE_PORT`). والخيط **ثنائي** مربوط بعرض توزيع واحد؛ **لا قائمة أطراف في المخطّط** فالمزاد يمنعه البناء لا حسنُ النيّة.
2. **التفاوض لا يكتب `orders` أبداً.** السعر المتَّفق عليه يُسلَّم عبر `AgreedPricePort` وحده، و**فشل التسليم لا يُبطل الاتفاق** — فلا `502` ولا صنف `bad_gateway` في الكتالوج أصلاً (سابقة تقاعُد 502 في الطور 05). و`negotiation_price_handoffs` صفٌّ لكل محاولة، لأنّ فشلاً صامتاً يعني اتفاقاً لا يعرفه الطلب ولا يشتكي منه أحد.
3. **الاتفاق قبولٌ صريح لدورٍ برقمه** لا تقارباً حسابياً ولا آخرَ رسالة: `expected_round_no` حارسٌ تفاؤلي، والتبادل إلزاميّ، و`ck_negotiation_rounds_no_self_resolution` **في القاعدة** لا في الكود وحده.
4. **المال أعداد صحيحة بوحدة صغرى وعملة صريحة**، وحدوده من **سياسة مُرقّمة مجمّدة** (`negotiation_policies` · `saudi-launch-v1`) يحملها الخيط بـ`policy_version` — فتفاوضٌ جارٍ لا تتغيّر قواعده تحته.
5. **الزمن نبضة لا مؤقّت** (`POST /negotiations/tick`) **والانتهاء يُقاس أيضاً عند كل فعل**: من اعتمد على النبضة وحدها فتح نافذةً يُشترى فيها سعرٌ انتهى. ولا `is_expired` مخزّن.
6. **المحادثة محتوى والأحداث لا تحمل محتوى**: `body_length` عددٌ لا نصّ (سابقة `shipment_description` · ADR-009 §7). **والمبلغ يعبر** لأنّه التغيّر نفسه.
7. **الترجمة عَرضٌ لا تخزين**: `source_locale` وحده ولا جدول ترجمات — نصٌّ مترجَم مخزَّن يتخلّف عن أصله ويُقرأ كأنّه قول الطرف.
8. **خارج النطاق بقرار:** الدفع والتسوية (Phase 19) · السمعة والاحتيال (Phase 09) · محرّك تسعير يقترح مبلغاً (**بلا مالك**: يحتاج بيانات تاريخية لا نملكها) · المرفقات · الخيوط الجماعية · قناة التوصيل ([ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)) — **لا عموداً ولا مساراً ولو معطّلاً**.

### خطة المراجعات (MRs) — ملزمة ومرتّبة

| MR | النطاق | الحالة |
|---|---|---|
| **1/6** | ADR-013 + `services/negotiations/contracts/{schema.sql,api.openapi.yml,events.json,errors.md,README.md}` + `@wasla/contracts-negotiation` + NEGOTIATION_CHAT.md + CONTAINERS §4.5 | ✅ **مدمجة في `main` (2026-08-22 · [!57](https://gitlab.com/uxxxu/wasla/-/merge_requests/57))** — دُمجت بقرار مالك المستودع وأنبوبها أحمر لسببٍ تشغيليّ (§2-أ) |
| **2/6** | طبقة مجال نقيّة `@wasla/negotiations-service` — آلة حالة الخيط والدور، و**حاسب الحدود من السياسة المُرقّمة** لا من أرقام في الكود، وقاعدة التبادل، ومنع القبول الذاتي، و`expected_round_no`. بلا قاعدة ولا HTTP، ومُهيّئ الذاكرة **يُطبّق 24 قاعدة مُسمّاة (قيوداً وفهارس فريدة) بأسمائها الحرفيّة** كما فعل الطوران 06 و05 · **131 اختباراً** + [NEGOTIATION_CORE_DOMAIN.md](../03-domain/NEGOTIATION_CORE_DOMAIN.md) | ✅ **مدمجة في `main` (2026-08-22 · [!58](https://gitlab.com/uxxxu/wasla/-/merge_requests/58))** |
| **3/6** | استمرارية Drizzle/Postgres + **وحدة عمل واحدة** تجعل الخيط والدور والرسالة والصادر في معاملة واحدة **بلا تغيير في `src/use-cases/`** + وظيفة CI `negotiations-db-integration` + حارس انحراف مرآة↔DDL | ✅ **مدمجة في `main` (2026-08-23 · [!59](https://gitlab.com/uxxxu/wasla/-/merge_requests/59))** — 62 اختبار تكامل على محرّك حقيقي + 27 حارس انحراف · [NEGOTIATION_PERSISTENCE.md](../02-architecture/NEGOTIATION_PERSISTENCE.md) |
| **4/6** | طبقة HTTP على **8091**: المسارات العشرة (ثلاث عشرة عمليّة) + `/health` بحالتيه و`last_tick_at` + مقبس معاملة (`NegotiationRunner`) فلا يملك معالج مسار فتح معاملة + `onlyKeys()` على كل حمولة | ✅ **مدمجة في `main` (2026-08-23 · [!60](https://gitlab.com/uxxxu/wasla/-/merge_requests/60))** — 36 اختبار `app.inject` + 14 حارس انحراف · [NEGOTIATION_HTTP.md](../04-api/NEGOTIATION_HTTP.md) |
| **5/6** | المنافذ الصادرة الحقيقية: `AgreedPricePort` → محرّك الطلب **8087** و`DispatchOfferPort` → التوزيع **8089** + تدفّقات بوتَي العميل والسائق. **وفيها ترحيل أعمدة الاتفاق في `orders`** (أدناه) | ⏳ |
| **6/6** | **بوابة خروج المرحلة E2E** `packages/negotiation-e2e`: خدمات مُنصتة حقيقية بساعة واحدة مُحقونة — طلب `negotiable` يصل سائقاً فيتفاوضان أدواراً فيتّفقان، **والسعر يظهر في محرّك الطلب فعلاً**؛ ونبضة واحدة تُنهي خيطاً مهجوراً؛ وقبولٌ متأخّر يُرفض بالاسم | ⏳ |

### ما أنجزته MR 1/6 بالضبط ([!57](https://gitlab.com/uxxxu/wasla/-/merge_requests/57))

- `services/negotiations/contracts/schema.sql` — **ثمانية جداول** (`negotiation_policies` · `negotiation_threads` · `negotiation_rounds` · `negotiation_messages` · `negotiation_agreements` · `negotiation_price_handoffs` · `negotiation_idempotency` · `negotiation_outbox`) بـ**22 قيداً مُسمّى** يمنع بالبناء ما كان سيُترك للمراجعة: خيطٌ مفتوح يحمل نتيجة · خيطٌ مُغلَق بلا سبب · خيطٌ `agreed` لا يسمّي دوره أو يسمّي دوراً غير موجود · دورٌ يحلّه مقترحُه · دورانِ معلّقان أو مقبولان · خيطانِ لطلبٍ وسائق · خيطانِ لعرض توزيع · اتفاقانِ لطلبٍ وسائق · رسالةٌ بلا نصٍّ ولا رمز · تنقيحٌ بلا سبب · تسليمٌ فاشل بلا سبب مُسمّى · مبلغٌ خارج حدود السياسة. وسياسة الانطلاق مبذورة صفّاً واحداً (`saudi-launch-v1`).
- `services/negotiations/contracts/api.openapi.yml` — 3.1 على **8091**، **عشرة مسارات** بـ`additionalProperties: false` على كل مخطّط. و`POST /negotiations/tick` بجسمٍ اختياري صريح — درسٌ مُقاس من الطورين 07 و05.
- `services/negotiations/contracts/events.json` — **تسعة أحداث** في مغلّف واحد بمُنتِج `negotiations-service`، وكلٌّ يحمل `data.occurred_for` (زمن العمل) فإعادة التشغيل تؤجّل الاكتشاف ولا تُغيّر **متى** وقع.
- `services/negotiations/contracts/errors.md` — **29 كود خطأ** في كتالوج مُغلَق، في جدول **يقرأه الحارس آلةً لا بشراً**، وبقسمٍ صريح لِما **لا** يُنتجه أي رمز فيه (وأوّله: لا رمز يقول «فشل التسليم فبطل الاتفاق»).
- `packages/contracts/negotiation/` (`@wasla/contracts-negotiation`) — أنواع مُكتبة مولّدة بـ`openapi-typescript` + **70 حارس انحراف** تقرأ ملفات العقد **من القرص وقت التشغيل**: تطابق الأكواد وأصنافها وحالات HTTP في الاتجاهين · المسارات العشرة · الأحداث التسعة ومغلّفها · و`resolve$ref` يحلّ `#/$defs/*` فتُقارَن التعدادات تعداداً بتعداد لا اسماً باسم · وحرّاس سالبة (لا `payment_status` · لا `chat_id` · لا `telegram` · لا جدول ترجمات) **مقصورة على سطح الآلة**: المخطّط بعد تجريد تعليقات `--`، وأسماء مفاتيح YAML وقيَم التعدادات وحدها — مع توكيدٍ **موجب** أنّ الشرح ما زال موجوداً، كي لا يُرضى الحارسُ بمخطّطٍ بلا تعليق.

### ما لم يُنجَز في MR 1/6 بقصد (لا تُعِد بناءه من الصفر)

- **لا `src/` ولا خادم**: الخدمة **غير قابلة للإقلاع**، ولا وظيفة CI جديدة (لا شيء يُشغَّل بعد). المنفذ 8091 مُخصَّص في العقد لا مُستمَع عليه.
- **لا مُهيّئ ذاكرة ولا Drizzle**: محلّهما 2/6 و3/6.
- **لا تدفّق بوت**: العقد يُنادى كما ينادِيه البوت، والواجهة محلّها 5/6.

### ما أنجزته MR 2/6 بالضبط ([!58](https://gitlab.com/uxxxu/wasla/-/merge_requests/58))

الحزمة `services/negotiations/` (`@wasla/negotiations-service`) — تابعيّتها الوحيدة `@wasla/contracts-negotiation`، **بلا `pg` ولا `drizzle` ولا `fastify`**، والخدمة **غير قابلة للإقلاع** بقصد. والتفصيل التعليليّ الكامل في [NEGOTIATION_CORE_DOMAIN.md](../03-domain/NEGOTIATION_CORE_DOMAIN.md)، وهذه رؤوسه:

- `src/domain/` — `model.ts` (مجموعات القيم **مُعاد تصديرها** من حزمة العقد لا مُعاد كتابتها) · `state-machine.ts` (آلتا الحالة كجدولين + `turnBelongsTo`) · `policy.ts` (`saudi-launch-v1` مُقفلة) · `money.ts` (وحدات صغرى صحيحة بعملة صريحة، ولا عدد عشريّ في أيّ مسار) · `expiry.ts` (الموضع الوحيد لحساب الوقت، و`next_tick_at = min(موعد الدور، موعد الخيط)` ويصير `NULL` عند الإغلاق) · `validation.ts` · `errors.ts` (29 كوداً منشوراً + `NegotiationConstraintViolation` **بلا كود** لقيود التماسك) · `events.ts` (تسعة مصانع، وكلٌّ يحمل `occurred_for`).
- `src/ports.ts` — المنافذ التي تُنجزها 3/6 على Postgres، و`AgreedPricePort` الذي تُنجزه 5/6. **ومنفذ الرسائل لا يملك `delete`** بل `redact`: رسالةٌ محذوفة تُفقد التسلسل فلا تحمي أحداً في الاتّجاهين.
- `src/use-cases/` — ثمانية أفعال: `open-thread` · `propose-round` · `accept-round` · `reject-round` · `post-message` · `cancel-thread` · `read-negotiation` · `run-tick`، فوق `shared.ts` و`expiry-core.ts` و`handoff.ts`.
- `src/infrastructure/in-memory.ts` — مُهيّئات تُحاكي **24 قاعدة مُسمّاة** (قيوداً وفهارس فريدة جزئيّة) **بأسمائها الحرفيّة** من `contracts/schema.sql`، فتصير 3/6 هدف تماثل: على مستودعات Postgres أن تُنجح نفس اختبارات حالات الاستخدام **بلا تعديل في `src/use-cases/`**.
- **تسليم السعر لا يرفع استثناءً أبداً**: `attemptPriceHandoff` تُصنّف ثلاث نتائج — قَبِل ⇒ `handed_off` · رفض ⇒ **نهائيّ بلا إعادة محاولة** · تعذّر الوصول ⇒ `pending` مع خمس محاولات بتراجع `30s × 2ⁿ` ثمّ `abandoned`. والاتفاق يُكتب ويُنشر `negotiations.agreed` **قبل** المحاولة، فلا يُقال لطرفين اتفقا إنّهما لم يتّفقا.
- **131 اختباراً** في تسعة ملفات: `open-thread` (15) · `rounds` (16) · `agreement` (14) · `messages` (10) · `tick` (13) · `privacy` (7) · `constraints` (25) · `read` (12) · `domain` (19). الوقت يُحرَّك بساعة مُحقونة و**لا `sleep` واحدة في المجموعة**، و`privacy.test.ts` يمشي على **كلّ مفتاح وكلّ نصّ** في كلّ حِمل حدث فيسقط عند أيّ حقل محرَّم أو أيّ ظهور لنصّ رسالة، و`constraints.test.ts` يرفع كلّ قاعدة **باسمها** بفحص تغطية يسقط إن أُضيفت قاعدة بلا اختبار.

### ثلاثة عيوب حقيقيّة كشفتها الاختبارات فأُصلحت في نفس المراجعة

1. **حرس `Idempotency-Key` كان يعمل بعد تحقّق الحالة** — فقبولٌ نجح وضاعت استجابته يُجاب على إعادة محاولته بـ`ALREADY_AGREED`: **409 على طلب نجح فعلاً**، فيذهب المتّصل يبحث عن عطبٍ لا وجود له. صار الحرس **قبل** تحقّق الحالة والوقت في المسارات الأربعة الكتابيّة (قبول · اقتراح · رفض · رسالة)، وبتعليقٍ يشرح لماذا لا يجوز «تبسيط» الترتيب لاحقاً.
2. **الإلغاء كان يترك الدور المعلّق معلّقاً** — لأنّه كان يُسوّيه **إن انقضى** فقط، والغالب أنّه لم ينقضِ (الطلب سُحب وأحدهم لا يزال يفكّر)، فيبقى صفٌّ يقول `pending` على خيطٍ انتهى ويُقرأ في كلّ تقرير كأنّه ينتظر جواباً. صارت `settlePendingRoundOnClose` تُسوّيه **دون شرط** كـ`expired` بلا تسمية طرف، و`occurred_for` لحظةُ الإغلاق لا موعد الدور — لأنّ الموعد لم يأتِ.
3. **قيدان كانا يُرفعان باسمٍ لا يميّزهما** — `threadAlreadyExists` و`alreadyAgreed` كانا يُسمّيان فهرس الطلب/السائق دائماً، وهما يُرفعان أيضاً عن فهرس عرض التوزيع وفهرس الاتفاق. صار الاسم **معامِلاً**، فيُفشل الاختبار بنفس الاسم الذي ستُفشله به القاعدة في 3/6.

### ما لم يُنجَز في MR 2/6 بقصد (لا تُعِد بناءه من الصفر)

- **لا قاعدة بيانات ولا Drizzle ولا مسار HTTP ولا وظيفة CI جديدة** — محلّها 3/6 و4/6. المنفذ 8091 لا يزال مُخصَّصاً لا مُستمَعاً عليه.
- **`AgreedPricePort` مُزيَّف في الاختبار فقط** (`mode: accept | reject | throw`) — المحوّل الحقيقي إلى محرّك الطلب **8087** محلّه 5/6، ومعه ترحيل أعمدة الاتفاق أدناه.
- **لا مُرحِّل صندوق صادر ولا مُنادي نبضة دوريّ**: `runTick` دالّة تُنادى، ومن يُناديها كلّ دقيقة محلّه 4/6 و5/6 (والدَّين العامّ للنبضة الدوريّة في الطور 09).
- **لا ترجمة ولا عرض**: `source_locale` يُخزَّن، والترجمة عَرضٌ محلّه واجهة البوت في 5/6.

### ما أنجزته MR 3/6 بالضبط ([!59](https://gitlab.com/uxxxu/wasla/-/merge_requests/59))

طبقة استمرارية كاملة **وراء المنافذ نفسها بلا تعديل سطرٍ واحد فوقها**، والتفصيل التعليليّ في [NEGOTIATION_PERSISTENCE.md](../02-architecture/NEGOTIATION_PERSISTENCE.md):

- `src/infrastructure/drizzle/schema.ts` (436 سطراً) — مرآة Drizzle لجداول العقد الثمانية بالقيود والفهارس **بأسمائها الحرفيّة**. والمرآة **لا تُنشئ** مخطّطاً: العقد `contracts/schema.sql` وحده يفعل.
- `src/infrastructure/drizzle/repository.ts` (798 سطراً) — ثمانية أصناف `Postgres*Repository` تُنجز كلّ منافذ `src/ports.ts`، وهي **حدّ التحويل الوحيد** بين صفوف SQL ونماذج المجال؛ ولا مستودع يبدأ معاملة.
- `src/infrastructure/drizzle/transaction.ts` (130 سطراً) — `PostgresNegotiationUnitOfWork` يملك حدّ المعاملة **حصراً**: `run()` معاملةٌ واحدة لكل عمليّة تطبيقيّة، و`read()` بلا معاملة. **ولا شيء غيره يستدعي `db.transaction`.**
- `src/infrastructure/drizzle/db.ts` (23 سطراً) — `createNegotiationDb` ونوعا `Db`/`DbOrTx` حتى يخدم مُهيّئٌ واحد الاتصال الجذر والمعاملة معاً.
- `src/__tests__/pg-harness.ts` (206 أسطر) — يطبّق **الـDDL الرسمي من القرص** لا مخطّطاً مولّداً من المرآة، و`resetData` تُفرّغ كلّ الجداول **ما عدا** بذرة `negotiation_policies` (`saudi-launch-v1`)، والملفّات تعمل تسلسليّاً بلا مشاركة حالة، وكلّها تتخطّى نفسها إذا كان `DATABASE_URL` غير مضبوط.
- **62 اختبار تكامل** على Postgres حقيقي: `repository.integration.test.ts` (41 — كلّ قيد من **الـ24 المسمّاة** باسمه، ورحلات ذهاب وعودة لكلّ مستودع، والأنواع `BIGINT`/`TIMESTAMPTZ`/`JSONB`، والترتيب والمرشّحات والصادر ومنع التكرار) · `port-conformance.integration.test.ts` (10 سيناريوهات ذاكرة↔Postgres بنفس الساعة والمعرّفات) · `atomicity.integration.test.ts` (11 — الارتكاز والتراجع في ستّ عمليّات، و`read()` بلا معاملة).
- **27 حارس انحراف** بلا قاعدة (`schema-drift.test.ts`): أعمدةٌ وأنواعٌ و`NOT NULL` وقيمٌ افتراضيّة وأسماء قيود وفهارس، **في الاتجاهين** مرآة↔عقد.
- وظيفة CI `negotiations-db-integration` على `wasla_negotiations_test` بنمط `drivers-db-integration`.

**الأرقام المقيسة (محليّاً · 2026-08-23):** `test:integration` = 62/62 على Postgres 18.4 · مجموعة الخدمة = **158** (131 + 27) · المستودع كامل = **2355 + 1 متروك بقصد في 143 ملفاً** · `pnpm -r typecheck` نظيف.

### ما لم يُنجَز في MR 3/6 بقصد (لا تُعِد بناءه من الصفر)

- **لا HTTP ولا `NegotiationRunner`**: محلّهما 4/6؛ المنفذ 8091 لا يزال مُخصَّصاً لا مُستمَعاً عليه.
- **لا مُرحِّل صندوق صادر ولا مُنادي نبضة دوريّ**: `runTick` دالّة تُنادى، والمُنادي محلّه 4/6 و5/6 (والدَّين العامّ في الطور 09).
- **`AgreedPricePort` و`DispatchOfferPort` ما زالا مُزيَّفين** — المحوّلان الحقيقيّان (8087 · 8089) في 5/6.
- **لا `mappers.ts` مستقلّ** بقصد: حدّ التحويل واحدٌ داخل `repository.ts`، فملفٌّ ثالث يُنشئ موضعين يجب أن يتّفقا.
- **مفتاح منع التكرار عالميّ في العقد** (`idempotency_key` مفتاحٌ أساسيّ وحده، والمنفذ لا يأخذ نطاقاً): دعمُ نفس المفتاح في نطاقين يقتضي تغيير الـDDL أو `ports.ts` — وكلاهما خارج نطاق هذه المراجعة، فهو **بندُ عقدٍ لا بندُ مُهيّئ**.

### ما أنجزته MR 4/6 بالضبط ([!60](https://gitlab.com/uxxxu/wasla/-/merge_requests/60) · طبقة HTTP على 8091)

طبقة حدٍّ **تترجم ولا تقرّر**، والتفصيل التعليليّ الكامل في [NEGOTIATION_HTTP.md](../04-api/NEGOTIATION_HTTP.md):

- `src/runner.ts` — `NegotiationRunner {write, read}` هو **مقبس المعاملة**: يُمرَّر إلى التطبيق مقبساً واحداً لا خريطة مستودعات، فلا يملك معالج مسار فتح معاملة **بالبناء لا بالمراجعة**. و`createDirectNegotiationRunner` للذاكرة و`PostgresNegotiationRunner` يفوّض إلى `PostgresNegotiationUnitOfWork` (§2 من [NEGOTIATION_PERSISTENCE.md](../02-architecture/NEGOTIATION_PERSISTENCE.md)) — نفس نمط `OrderRunner`/`DriverRunner`.
- `src/mappers.ts` — camelCase (المجال) → snake_case (السلك) وحده، ولا منطق: `threadToWire` · `roundToWire` · `messageToWire` · `agreementToWire` · `tickResultToWire` · `healthToWire`. و`messageToWire` **تُمرّر `body`** بقصد: القراءة هي المحادثة، والحدُّ الخصوصيّ على **الأحداث** لا على قراءة الطرف لخيطه.
- `src/http/errors.ts` — معالج خطأ **واحد** بأربعة فروع مرتّبة: `NegotiationError` ⇒ حالته المنشورة · قيدُ تماسكٍ في سلسلة `cause` (عمقٌ 8 وآمنٌ من الحلقات) ⇒ **500 `NEGOTIATION_INTERNAL_ERROR`** مع `details.constraint` · خطأ تحليل Fastify (400/415) ⇒ 400 `VALIDATION_FAILED` على الحقل `body` · وما بقي ⇒ **503 `NEGOTIATION_UNAVAILABLE`**. ولا `try/catch` في أيّ معالج مسار: ثلاثة عشر موضعاً تعني ثلاثة عشر رأياً في معنى الخطأ، ويكفي أن يُنسى واحد ليُسرَّب أثر كومة.
- `src/http/requests.ts` — حرّاس **الشكل لا القيم**: `Idempotency-Key` (8..128، يرفض المصفوفة والفاصلة) · `x-request-id` (≤128) · `toPathUuid` · `toPathRoundNo` (`/^[1-9][0-9]*$/` فلا `01` ولا `+1`) · `assertNoBody` · وقوائم مفاتيح مُصدَّرة (`THREAD_OPEN_KEYS` … `THREAD_LIST_QUERY_KEYS`) يقابلها حارس الانحراف بالعقد. **ولا فحص تعدادات هنا** — المجال يملك الرموز، وانحراف القوائم محروسٌ في حزمة العقد.
- `src/http/app.ts` (279 سطراً) — `createNegotiationApp({runner, health?, tickState?, logger?})` يُنشئ التطبيق **ولا يستمع**، فيُختبَر بـ`app.inject` بلا مقبس. ثلاث عشرة عمليّة على عشرة مسارات، و`requestIdHeader: "x-request-id"` فيصير `trace_id` في المغلّف هو نفس المعرّف الذي يراه المتّصل.
- `src/infrastructure/runtime.ts` — `SystemClock` · `CryptoIdGenerator` · `UnconfiguredDispatchOfferPort` (يرمي 503 **قبل** أيّ كتابة) · `UnconfiguredAgreedPricePort` (يرمي خطأً عاديّاً فيُسجَّل `unavailable` ويبقى الاتفاق قائماً — القرار 2).
- `src/http/server.ts` — **الموضع الوحيد** الذي يقرأ `process.env`: مع `DATABASE_URL` ⇒ Postgres وصحّة `ok`، وبدونه ⇒ ذاكرة وصحّة `degraded`؛ وإطفاءٌ نظيف على `SIGTERM`/`SIGINT`. و**`http/server.js` غير مُصدَّر** من `index.ts` بقصد: استيراد نقطة الإقلاع من مكتبة يُقلع خادماً كأثرٍ جانبيّ.

**Evidence (محليّاً · 2026-08-23):**

- `src/__tests__/http.test.ts` — **36 اختباراً** على `app.inject`: 201 ثمّ **200 على الإعادة** بنفس المفتاح · القبول يعيد **الاتفاق** والرفض يعيد **الخيط** · فشل تسليم السعر يبقى **201 ومعه اتفاق** بـ`handoff_state: pending` و`next_handoff_at` · القائمة بلا مرشّح ⇒ `NEGOTIATION_FILTER_REQUIRED` · `/health` بحالتيه · النبضة بلا جسم وبجسمٍ فارغ.
- `src/__tests__/http-drift.test.ts` — **14 حارس انحراف** يقرأ `api.openapi.yml` **من القرص** ويقابله بما سجّله Fastify فعلاً (`app.printRoutes`) **في الاتجاهين**، وبقوائم مفاتيح الطلب الستّ، وبمُعامِلات الاستعلام، ويؤكّد **غياب 500 و502** عن `NEGOTIATION_HTTP_STATUS_CODES` و**غياب `NEGOTIATION_INTERNAL_ERROR`** عن `NEGOTIATION_ERROR_CODES`.
- مجموعة الخدمة **208 في 12 ملفاً** (كانت 158 في 10) · المستودع **2405 + 1 متروك بقصد في 145 ملفاً** (كان 2355 في 143) · `pnpm -r typecheck` نظيف على **31 مشروعاً**.

### ما لم يُنجَز في MR 4/6 بقصد (لا تُعِد بناءه من الصفر)

- **`NEGOTIATION_INTERNAL_ERROR` و`500` غير منشورين في العقد ولن يُنشرا**: قيدُ تماسكٍ يُخالَف بعد إجازة المجال **خللٌ فينا** لا حالةٌ يتعاقد عليها مستهلك. من «أكمل» الكتالوج بهما فقد أعطى المتّصلين حقّاً في التعامل مع عطبنا.
- **لا فحص تعدادات على الحدّ ولا `onlyKeys` على القيم**: `requests.ts` يفحص الشكل، والمجال يرفع الرمز الصحيح — فمُحقِّقٌ ثانٍ يعني موضعين يجب أن يتّفقا.
- **لا مُنادي نبضة دوريّ ولا مُرحِّل صندوق صادر**: `POST /negotiations/tick` مسارٌ يُنادى، ومن يُناديه كلّ دقيقة محلّه 5/6 (والدَّين العامّ في الطور 09).
- **`AgreedPricePort` و`DispatchOfferPort` غير مُهيّئين في `server.ts`** بل مُهيّئا «غير مُكوَّن»: العرض يُرفض بـ503 **قبل الكتابة**، والسعر يُسجَّل `unavailable` **بعد** الاتفاق. المحوّلان الحقيقيّان (8087 · 8089) في 5/6.
- **لا وظيفة CI جديدة**: اختبارات HTTP بلا قاعدة فتعمل في `test` القائمة، و`negotiations-db-integration` موجودة من 3/6.
- **لا `Dockerfile` ولا manifest نشر**: نمط المستودع أنّ النشر طورٌ لاحق (`infra/`).

### 🔎 بندٌ مفتوح مكتشَف خارج النطاق: مجموعة تكامل `services/drivers` حمراء على محرّك حقيقي

عند تجهيز محرّك Postgres محليّ شُغّلت مجموعة تكامل السائقين (Phase 05) فسقط **27 اختباراً من 79**، لسببين لا يمسّان خدمة التفاوض:

1. **سبعة** في `repository.integration.test.ts` تؤكّد `.constraint` على الخطأ المُلقى مباشرةً، و`drizzle-orm` 0.45.2 المثبَّت في `pnpm-lock.yaml` **يلفّ** خطأ المشغّل فيصير الاسم في سلسلة `cause` — فالتوكيد يقيس الغلاف لا القاعدة. (طبقة التفاوض تفكّ السلسلة، فلا تقع في هذا.)
2. **عشرون** في `port-conformance.integration.test.ts` تبني جانب الذاكرة بـ`createInMemoryEnvironment(NOW)` بدل مساعد البيئة **المبذور** في `helpers.ts`، فتسقط بـ`DRIVER_ZONE_UNKNOWN` قبل أن تقيس شيئاً.

**لم يُصلَح في هذه المراجعة بقصد**: خلط إصلاح خدمةٍ أخرى في مراجعة استمرارية التفاوض يُخفي أيّ التغييرين كسر الأنبوب. ولم يُكشَف في CI لأنّ حصّة الدقائق منتهية (§2-أ) والمجموعة لم تُشغَّل على محرّك منذ كُتبت. **المطلوب: مراجعة منفصلة صغيرة بنطاق Phase 05** تُصلح التوكيدين وتُعيد تشغيل `drivers-db-integration`.

### ما أنجزته MR 5/6 بالضبط ([!62](https://gitlab.com/uxxxu/wasla/-/merge_requests/62))

**العنوان بجملة:** الخيط صار يعرف عرضاً حقيقيّاً، والاتفاق صار يصل إلى `orders` فعلاً. وبهذا **سُدّ الدَّين المُعلَن** الموصوف أدناه (بقي نصّه كسجلٍّ لِما كان).

**1) محرّك الطلب (`services/orders`) — مالك العمود هو من كتبه، لا التفاوض.**

- أربعة أعمدة على `orders`: `agreed_amount_minor` · `agreed_currency` · `agreed_at` · `agreed_negotiation_id`، وثلاثة قيود تجعل التشويه **مستحيلاً لا مستنكَراً**:
  - `ck_orders_agreed_price_complete` — الرباعيّة **كاملةٌ أو غائبة**؛ فلا مبلغ بلا عملة، ولا سعر بلا الخيط الذي أنتجه.
  - `ck_orders_agreed_price_only_negotiable` — لا سعرَ متَّفقاً عليه إلّا على `price_mode = 'negotiable'`.
  - `ux_orders_agreed_negotiation` — فريدٌ جزئيّ: **خيطُ تفاوضٍ واحد لا يُسجّل سعرَين** في طلبَين.
- `POST /orders/agreed-prices` — الجسم يحمل `order_public_id` و`negotiation_id` و`driver_public_id` و`amount_minor` و`currency` و`agreed_at`، و`Idempotency-Key` **إلزاميّ**.
  - **يقرأ الطلب بمعرّفه العام لا بـUUID** — والسبب عقديّ لا ذوقيّ: خدمة التفاوض **لا تملك UUID الطلب أصلاً**، فمسارٌ على هيئة `/orders/{orderId}` كان سيُلزمها بقراءةٍ إضافية لا تملك سببها، أو بنسخ عمودٍ ليس لها.
  - **لا ترويسة نطاق عميل** — المُنادي خدمةٌ داخليّة لا عميل، وطلبُ ترويسة عميل كان سيدفع التفاوض إلى انتحال هويّةٍ لا يملكها.
  - **لا يُغيّر حالة الطلب ولا يُصدر حدثاً جديداً**: تسجيلُ سعرٍ ليس انتقالاً في دورة حياة، وإصدار حدثٍ هنا كان سيجعل لكلّ اتفاقٍ حدثَين — واحدٌ في التفاوض وآخر في الطلب — فيختلفان يوماً.
  - الرموز: 201 جديد · 200 إعادة بنفس المفتاح · 404 طلبٌ مجهول · `ORDER_PRICE_NOT_NEGOTIABLE` · `ORDER_NOT_OPEN_FOR_AGREED_PRICE` · `ORDER_AGREED_PRICE_ALREADY_SET` · `ORDER_AGREED_PRICE_MISMATCH`.
- `GET /orders/lookup?order_public_id=…` — يُفشي حقائق السعر وحدها (`status`, `price_mode`, `order_type`, `vehicle_class`, `agreed_*`) و**لا بيانات عميل**: منفذٌ صادرٌ لخدمةٍ أخرى ليس بوّابةً لكلّ ما يعرفه الطلب.

**2) التوزيع (`services/dispatch`).** `GET /dispatch/offers/{offer_id}` يعيد `DispatchOfferDetail` = العرض + `order_public_id` و`order_id` و`order_type` و`vehicle_class` و`job_status` و**`standing`**. و`standing` **قرارُ مجالٍ في التوزيع** (العرض `offered` والمهمّة غير نهائيّة) **ولا يقارن `expires_at` بساعة الحائط**: العرض المتجاوز موعدَه يبقى قائماً حتى تسجّل النبضة حسمه — وإلّا صار لكلّ خدمةٍ تقرؤه رأيٌ مختلف في «هل انتهى؟» بحسب انحراف ساعتها.

**3) خدمة التفاوض — محوّلان حقيقيّان بلا لمس المجال.** `Unconfigured*` استُبدلا بـ`http-dispatch-offer.ts` و`http-agreed-price.ts` و`outbound-wiring.ts`، **بلا تعديل سطرٍ واحد في `src/use-cases/` ولا `src/domain/` ولا `src/ports.ts`** — لأنّ توقيع المنفذ كان مُحكَماً من MR 2/6. والتفصيل الكامل في [NEGOTIATION_HTTP.md §12](../04-api/NEGOTIATION_HTTP.md)، وأربعة قرارات منها **ملزمة لمن يأتي**:

1. **لقطة العرض تُجمَع من نداءين**: هويّة الطرفين و`standing` من التوزيع، و`negotiable` من `price_mode` في محرّك الطلب. **لا يُنسخ عمود خدمةٍ إلى أخرى** — النسخة الثانية للحقيقة تُناقض الأولى يوماً.
2. **`null` ليست خطأً والخطأ ليس `null`**: `null` ⇒ 404 حقيقيّ ⇒ **422** لا تُصلحه إعادة محاولة؛ والانقطاع والمهلة (2000ms) وأيّ رمز آخر و**الجسم المكسور** ⇒ رمي ⇒ **503**. لو قُرئ الجسم المكسور «عرضاً غير موجود» لصار خللُ خدمةٍ أخرى إنكاراً لعرضٍ قائم.
3. **مفتاح التسليم `negotiation-{threadId}` ثابت ولا يدخله رقم المحاولة**: المحاولات الخمس إعادةُ النداء نفسه لا خمسة اتفاقات؛ ولو دخل الرقم لسجّل محرّك الطلب سعراً مرّتين عند أوّل مهلةٍ كاذبة. و**409/422 رفضٌ نهائيّ** بالرمز كما جاء، و**404 و5xx والانقطاع رمي** — فـ404 تناقض واقعاً تحقّقنا منه، وعلاجها إعادة محاولةٍ ثمّ `abandoned`، لا رفضٌ أبديّ.
4. **لا عنوان افتراضيّ لـ`localhost` في التوصيل**، والنصّ الفارغ غيابٌ لا عنوان، والملاحظة **تُسمّي المتغيّر الناقص بالحرف**: الافتراض الصامت يجعل غيابَ متغيّرٍ يظهر عطلاً في خدمةٍ سليمة فيُطارِدها المُشغّل.

**4) البوتان.** `/negotiations` و`/accept` و`/reject` في بوتَي العميل والسائق، ومعهما ثلاثة قيود:

- **لا عرضٌ مضاد من المحادثة**: `ConversationEvent` لا يحمل نصّاً حرّاً ولا حمولة `callback`، والقاعدة المنتَجيّة تضع العمل الثقيل في Mini App. فالاقتراح يبقى على HTTP، والمحادثة تُقرّ أو ترفض.
- **قاعدة اللبس**: لا يُنفَّذ `accept`/`reject` إلّا إذا كان **خيطٌ واحد** بدورٍ معلّق اقترحه **الطرف الآخر**. غير ذلك رسالةُ توضيح — لا تخمين، لأنّ تخمين المال لا يُصحَّح برسالة اعتذار.
- **لا `handoff_state` ولا UUID يظهر لمستخدم**، ومفتاح التفرّد مشتقٌّ من `channelUpdateId` فإعادةُ Telegram لتحديثٍ لا تُنتج قبولاً ثانياً. و`NEGOTIATIONS_SERVICE_URL` إن غاب ⇒ `Unconfigured*` يرفع رمز تبعيّة — **ولا يُعيد قائمةً فارغة**: «لا خيوط لديك» كذبةٌ تُنهي المحاولة، والعطب المُعلَن يدعو لإعادتها.

**Evidence (كلّها مُقاسة محلّيّاً — الأوامر في [TASK_LOG](TASK_LOG.md)):** **69 اختباراً جديداً** (21 للمنافذ الصادرة · 12 للعميل · 12 للسائق · 24 لمحرّك الطلب والتوزيع) ⇒ خدمة التفاوض **229 في 13 ملفاً** · المستودع **2473 اختباراً + 1 متروك بقصد في 149 ملفاً · صفر فاشل** · `pnpm -r typecheck` نظيف على **31 مشروعاً**. و**اختبارات التكامل شُغّلت على Postgres 17 حقيقي قبل الدمج**: تفاوض **62** · طلبات **32** (منها قيود أعمدة الاتفاق الجديدة) · توزيع **48** — بمحرّك يعمل بلا `root` وبلا Docker، وصفتُه في [LOCAL_POSTGRES_FOR_TESTS.md](../14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md). **وهذه الوصفة تخصّك أكثر مما تخصّني: بها تصير بوابة ما قبل الدمج قابلة للتنفيذ على جهازك، لا وعداً.**

### ما لم يُنجَز في MR 5/6 بقصد (لا تُعِد بناءه من الصفر)

- **لا نداء عبر الشبكة في اختبارات هذه الدفعة.** المحوّلات تُختبَر بـ`fetch` مزيّف: أسرع وأثبت، لكنّه **لا يُثبت أنّ العقود الثلاثة تتفق فعلاً**. ذاك بالضبط عملُ **MR 6/6** ولا شيء غيره.
- **لا مُنادٍ دوريّ للنبضة ولا مُرحِّل لصندوق الصادر** — Phase 09، كما أُعلن من MR 3/6. وأثره العمليّ على هذه الدفعة صريح: اتفاقٌ فشل تسليمه يبقى `pending` **حتى تُنادى النبضة**، ولا شيء يناديها في الإنتاج بعد.
- **لا عرضٌ مضاد من المحادثة، ولا Mini App** — قيدٌ منتَجيّ وحدُّ عقد، لا نقص (Phase 12 وما بعدها).
- **`agreed_price` لا يُشارك في أيّ حساب تسعير أو محاسبة** — Phase 19 (الدفع). العمود اليوم **حقيقةٌ مسجَّلة** لا مدخلٌ لحساب.
- **دَين الذرّية في `services/drivers` باقٍ**، ومجموعة تكامله **حمراء على محرّكٍ حقيقيّ: 27 فاشلاً من 79** — قِسته بالمحرّك المضمَّن (§أعلاه) وهو **عطبٌ سابقٌ في التوكيدات لا في السلوك**، ونطاقه Phase 05. لم يُخلَط بهذه الدفعة قصداً: إصلاح خدمةٍ أخرى داخل مراجعة التفاوض يُخفي أيّ التغييرين كسر شيئاً.

### ✅ الدَّين المُعلَن — **سُدَّ في MR 5/6** · أعمدة الاتفاق في `orders` (مالكه محرّك الطلب لا التفاوض)

> **حالته اليوم: مدفوع.** الأعمدة الأربعة وقيودها الثلاثة ونقطة النهاية صارت في `main` — التفصيل في «ما أنجزته MR 5/6» أعلاه و[ORDER_HTTP.md](../04-api/ORDER_HTTP.md). وبقي نصّ الدَّين أدناه كما كُتب، لأنّ **سببَ** التصميم يبقى ملزماً لمن يمسّ هذه الأعمدة لاحقاً.

`orders` **لا يملك اليوم** عمود سعرٍ متَّفق عليه: `price_mode = 'negotiable'` يُجبر `offered_amount_minor` على `NULL`. فشقّ «وتسجيله في Order» من بوابة الخروج يقتضي **في MR 5/6** ترحيلاً عكسيّاً كاملاً يكسب محرّك الطلب:

| العمود | لماذا |
|---|---|
| `agreed_amount_minor` | المبلغ نفسه — ولا موضع له اليوم |
| `agreed_currency` | كل مبلغ في النظام بعملةٍ صريحة |
| `agreed_at` | «اتُّفق» ليست «سُجِّل» |
| `agreed_negotiation_id` | أثرٌ يعيد السعر إلى الخيط الذي أنتجه |

ونقطةَ نهايةٍ في محرّك الطلب يناديها `AgreedPricePort`. **ومالك التغيير محرّك الطلب** — لا يُفتَح فرعٌ يكتب فيه التفاوض جدولاً لا يملكه. وحتى ذلك الترحيل يبقى `handoff_state` في `negotiation_agreements` **مصدر الحقيقة الوحيد** عن هل عرف الطلبُ سعره.

### ما يجب أن يُقرأ أولاً قبل MR 6/6 (المراجعة الأخيرة في المرحلة)

**بوابة الخروج ليست اختباراً إضافيّاً، بل هي الموضع الوحيد الذي تُقاس فيه دعاوى المراجعات الخمس السابقة معاً.** حتى الآن كلّ خدمةٍ اختُبرت على `fetch` مزيّف أو `app.inject`؛ ولا شيء أثبت بعدُ أنّ `order_type` الذي يكتبه التوزيع هو نفسه الذي يقرؤه التفاوض، ولا أنّ `Idempotency-Key` الذي يُرسله المحوّل هو نفسه الذي ينتظره محرّك الطلب.

1. **المكان والاسم:** `packages/negotiation-e2e` (الحزمة **غير موجودة بعد** — تُنشأ)، على نمط `packages/{channel-e2e,customer-e2e,order-e2e,dispatch-e2e}` القائمة. اقرأ إحداها قبل أن تكتب سطراً: النمط مُثبَت أربع مرّات، وإعادة اختراعه إهدارُ يومٍ ومصدرُ فروقٍ لا لزوم لها.
2. **أربع خدمات تعمل معاً**: التفاوض **8091** · محرّك الطلب **8087** · التوزيع **8089** · السائقون **8090** (بحسب ما يلزم لبناء عرضٍ حقيقيّ). و`server.ts` لكلّ خدمة هو التركيب الوحيد المسموح — **لا تبنِ تركيباً بديلاً في الاختبار**، فتركيبٌ ثانٍ يُثبت صحّة ما لن يُنشَر.
3. **عبر HTTP العام وحده.** **لا قراءةَ مخزنٍ مباشرة، ولا صفٌّ يُبنى بيد**. كلّ ما يحتاجه السيناريو يُنشَأ بنقاط النهاية المنشورة: طلبٌ `negotiable` → مهمّة توزيع → عرض → خيط تفاوض → دورٌ مقترح → قبول → **تحقّقٌ من `agreed_*` عبر `GET /orders/lookup` لا عبر `SELECT`**. بذرةٌ بيدٍ في المخزن تُخفي بالضبط ما وُجدت البوابة لتكشفه.
4. **ساعةٌ واحدة محقونة عبر الخدمات، والزمن نبضة.** انتهاء صلاحية دورٍ يُقاس بتحريك الساعة ثمّ نداء `POST /negotiations/tick` — **لا `sleep`**. انتظارُ الوقت الحقيقي يجعل البوابة بطيئة وهشّة، ويُخفي أنّ الانتهاء **حَسمٌ مُسجَّل** لا مرورُ لحظة.
5. **يجب أن تُثبت البوابة بالضبط ما تعنيه بوّابة المرحلة** («تفاوض + توافق على السعر **وتسجيله في Order**»)، وأربعةٌ منها لا تُترك للاستنتاج:
   - **المسار السعيد كاملاً**: قبولٌ صريح لدورٍ مرقّم ⇒ اتفاق ⇒ `handoff_state = handed_off` ⇒ و`GET /orders/lookup` يُظهر الرباعيّة كاملة.
   - **الإعادة**: نداء القبول مرّتين بنفس المفتاح ⇒ اتفاقٌ واحد وسعرٌ واحد في `orders` (وهنا يُقاس فعلاً أنّ المفتاح لا يدخله رقم المحاولة).
   - **الرفض النهائيّ**: طلبٌ ليس `negotiable` ⇒ `handoff_state = rejected` **والاتفاق قائم** ⇒ ولا 502 في أيّ جوابٍ من التفاوض.
   - **تعذّرُ الوصول**: أوقِف محرّك الطلب ⇒ القبول يبقى **201 ومعه اتفاق** بـ`pending` وموعد إعادة ⇒ ثمّ أعِده وانادِ النبضة ⇒ `handed_off`. **وهذا هو الاختبار الذي يُثبت ADR-013 · القرار 2 عمليّاً**؛ بدونه تبقى «فشلُ التسليم لا ينقض الاتفاق» جملةً في وثيقة.
6. **يُعاد على Postgres حقيقي** في وظيفة `negotiations-exit-gate-e2e`، والبوابة تتخطّى نفسها بلا `DATABASE_URL` كسائر مجموعات التكامل. ولأنّ حصّة CI منتهية (§2-أ)، **شغّلها محلّيّاً بالمحرّك المضمَّن قبل الدمج** — [LOCAL_POSTGRES_FOR_TESTS.md](../14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md).
7. **قيودٌ دائمة لا تنتهي بدفعة:** [ADR-013](../15-decisions/ADR-013-negotiation-chat-agreement-boundary-and-tick-driven-expiry.md) كاملاً (الخيط ثنائيّ · التفاوض لا يكتب `orders` · فشل التسليم لا ينقض الاتفاق · الاتفاق قبولٌ صريح لدورٍ مرقّم · المال أعدادٌ صحيحة بعملةٍ صريحة · الزمن نبضة) · [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md) و[GIT_RULES](../00-rules/GIT_RULES.md): **لا دفع كودٍ بلا وثيقة في نفس الالتزام** · و**§2-أ**: الدمج بأنبوب أحمر مأذونٌ فيه بشروطه الثلاثة — كلّ رقم مُقاسٌ ومُسجَّل · وما يحتاج محرّكاً يُشغَّل على Postgres حقيقيّ محلّيّاً · ولا يُدمَج ما لم يُشغَّل.
8. **وحين تكتمل 6/6**: وثيقةُ البوابة في `docs/12-testing/PHASE08_EXIT_GATE_E2E.md` على نمط `PHASE0{3,4,6,7}_…`، ثمّ **تُعلَن المرحلة 08 مكتملة** في [ROADMAP](ROADMAP.md) و[MASTER_PROGRESS](MASTER_PROGRESS.md) وهنا — ولا تُعلَن قبل أن تكون البوابة خضراء على محرّكٍ حقيقيّ. المرحلة التالية **09 (Reputation + Fraud)**.

---

### ما أنجزته MR 6/6 بالضبط ([!63](https://gitlab.com/uxxxu/wasla/-/merge_requests/63) · بوابة خروج المرحلة)

**حزمة `packages/negotiation-e2e` الجديدة (`@wasla/negotiation-e2e`، خاصّة، لا تُنشَر)** على نمط `packages/{channel-e2e,customer-e2e,order-e2e,dispatch-e2e}` الأربع القائمة — قُرئت قبل كتابة سطر، فلم يُخترَع النمط من جديد.

- **`src/harness.ts`** يرفع **سبع خدمات مُنصتة فعلاً** على `127.0.0.1:0` بمنافذ يمنحها النظام: الهوية · الجغرافيا · العملاء · الطلبات · المطابقة · التوزيع · التفاوض. وكلٌّ منها يُبنى بـ`createServer`/`buildServer` الخاصّ بها — **التركيب المنشور نفسه**، ولا تركيب بديل كُتب للاختبار. ومنفذا التفاوض الخارجان يُبنيان بـ`configuredDispatchOffers(env, log)` و`configuredAgreedPrice(env, log)`، **الدالّتان نفسهما التي يناديهما `src/http/server.ts`**، فما تُثبته البوابة هو ما سيُنشَر.
- **ساعةٌ واحدة (`GateClock`) محقونة في السبع** بمبدأ `2026-08-23T09:00:00.000Z`؛ الزمن يتقدّم بـ`advance()` والحسم يقع بنداء `POST /negotiations/tick` و`POST /dispatch/tick` — **ولا `sleep` في البوابة كلّها**.
- **`stopOrderEngine()` / `startOrderEngine()`**: يُغلق مُستمع محرّك الطلب فعلاً (فتصير المحاولة رفضَ اتّصال حقيقيّاً لا `fetch` مزيّفاً يرمي)، ثمّ يُعيد الإنصات على **المنفذ نفسه المحفوظ** فوق **نفس مُشغّل الطلبات في الذاكرة** — فلا تُفقد حالةٌ ولا يُغيَّر عنوانٌ محقون مسبقاً في التفاوض.
- **رفعٌ على Postgres للتفاوض وحده** عبر `NEGOTIATION_DATABASE_URL`: إسقاط الجداول الثمانية بترتيب التبعيّة المعكوس ثمّ تطبيق `services/negotiations/contracts/schema.sql` (الذي يبذر السياسة v1). وبدون المتغيّر تعمل البوابة على الذاكرة.
- **ثمانية اختبارات** في `src/__tests__/phase08-exit-gate.e2e.test.ts`، فيها **الأربعة الملزمة** من §14 البند 5، وكلّها **عبر HTTP العام وحده** — لا `SELECT`، ولا صفٌّ مبنيٌّ بيد: التحقّق من السعر المتَّفق عليه يمرّ بـ`GET /orders/lookup`.
  1. **صحّة الخدمات السبع** + إثبات أنّ التفاوض يعمل على الاستمرارية المطلوبة.
  2. **المسار السعيد**: نيّة عميل ⇒ طلب `negotiable` **بلا سعر** ⇒ موجة توزيع حقيقيّة تُنتج عرضاً ⇒ خيطٌ على ذلك العرض ⇒ دورٌ مقترح ⇒ قبولٌ صريح ⇒ `state = "agreed"` و`close_reason_code = "agreed"` و`handoff_state = handed_off` و`handoff_attempts = 1` ⇒ و`GET /orders/lookup` يحمل المبلغ والعملة و`agreed_negotiation_id`، **وحالة الطلب لم تتغيّر** لأنّ تسجيل السعر ليس انتقالاً في آلة الحالة (ADR-010).
  2ب. **دورٌ مضادّ**: عرضٌ من طرفٍ ثمّ مضادٌّ من الآخر ثمّ قبولٌ للأخير ⇒ الاتفاق يحمل مبلغ **الدور المقبول** لا أوّل دور.
  3. **الإعادة بالمفتاح نفسه**: قبولٌ 201 ثمّ نفس المفتاح ⇒ **200 بجسمٍ متطابق حرفياً**، `handoff_attempts` ما زال **1**، ونبضةٌ بعدها **لا تُعيد التسليم** — وهنا يُقاس فعلاً أنّ مفتاح التفرّد `negotiation-{threadId}` **لا يدخله رقم المحاولة**.
  4. **الرفض النهائيّ من المحرّك**: **عرضان حيّان على طلبٍ واحد** ⇒ خيطان ⇒ اتفاقان ⇒ الأوّل `handed_off`، والثاني `rejected` يحمل **رمز المحرّك حرفيّاً** `ORDER_AGREED_PRICE_ALREADY_SET`، **والاتفاق الثاني قائمٌ صحيح والقبول 201، ولا `502`/`bad_gateway` في أيّ جواب** — ADR-013 · القرار 2 مقيسٌ لا مكتوب.
  5. **تعذّرُ الوصول**: إغلاق مُستمع المحرّك ⇒ القبول **201 ومعه اتفاق** بـ`pending` و`HANDOFF_TRANSPORT_ERROR` و`next_handoff_at` = الآن + **30s** بالثانية (`30 · 2^(n-1)`)؛ نبضةٌ **قبل** اللحظة لا تفعل شيئاً؛ ثمّ يرجع المحرّك على المنفذ نفسه وتتقدّم الساعة ⇒ **نبضةٌ واحدة** تُسلّم السعر ⇒ `handed_off` و`GET /orders/lookup` يُظهر الرباعيّة.
  6. **طلبٌ ليس `negotiable`** ⇒ `POST /negotiations` يرفض بـ**422 `NEGOTIATION_ORDER_NOT_NEGOTIABLE`** ولا يُنشئ خيطاً — حرزٌ يمنع نسخ «قابل للتفاوض» في التفاوض بدل قراءته من `price_mode` عند المحرّك.
  7. **تفاوضٌ غير موصول** (بلا `ORDERS_SERVICE_URL`) ⇒ منفذٌ رافض ⇒ **503 `NEGOTIATION_UNAVAILABLE`** لا 422 — الفرق الذي هو كلّ شيء: **`null` ⇒ 422 (عرفنا) مقابل رمي ⇒ 503 (لم نعرف)**.
- **وظيفة CI `negotiations-exit-gate-e2e`** في `.gitlab-ci.yml` (تمتدّ من `.db-integration-base`، خدمة `postgres:15`، قاعدة `wasla_negotiation_e2e`، متغيّر `NEGOTIATION_DATABASE_URL`) — والملف مُتحقَّق منه: **22 وظيفة عليا**.
- **وثيقة البوابة** [PHASE08_EXIT_GATE_E2E.md](../12-testing/PHASE08_EXIT_GATE_E2E.md) على نمط `PHASE0{3,4,6,7}_…`.

**المقيس محلّيّاً قبل الدمج** (حصّة CI منتهية — §2-أ): البوابة **8/8 على الذاكرة (~2s)** و**8/8 على Postgres 17 حقيقي** بالمحرّك المضمَّن ([LOCAL_POSTGRES_FOR_TESTS.md](../14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md)) · `pnpm -r test` **2481 اختباراً + 1 متروك بقصد في 150 ملفاً · 0 فاشل** · `pnpm -r typecheck` نظيف على **32 مشروعاً** · اختبارات خدمة التفاوض وحدها **229 في 13 ملفاً**. والبند الأحمر الوحيد هو المكتشَف سابقاً خارج النطاق: تكامل `@wasla/drivers-service` (27 فاشلاً من 79) — طور 05، ولم تلمسه هذه المراجعة.

### ما ظهر في البوابة ولم يكن معروفاً قبلها

1. **بعد `POST /negotiations` تكون `round_count = 0` و`current_round_no = 0`** — صفرٌ لا `null`، ولا جولة تُنشَأ مع الخيط. من يبني على الخيط يجب ألّا يعتمد على `null` كعلامة «لا جولة».
2. **القبول يُنفّذ التسليم داخل النداء نفسه** (يرجع `handed_off` و`handoff_attempts: 1` فوراً)، **والإعادة لا تُعيد المحاولة** — فلا يُفترض أنّ التسليم يحتاج نبضةً بعد القبول؛ النبضة للمُعاد جدولته فقط.
3. **`POST /negotiations/tick` بلا جسم**: إرسال `content-type: application/json` بلا جسمٍ يجعل Fastify يجيب **400**. أيّ عميلٍ للنبضة يجب أن يُسقط الترويسة عند غياب الجسم.

### انحرافان مُعلَنان عن نصّ §14 (مقصودان ومُبرَّران)

1. **البوابة لا تتخطّى نفسها** خلافاً للبند 6 أعلاه («تتخطّى نفسها بلا `DATABASE_URL`»): هي تعمل على الذاكرة افتراضياً وتُرفَع إلى Postgres بالمتغيّر. السبب: النمط المُثبَت في البوّابات الأربع القائمة هو **عدم التخطّي**، والتخطّي الصامت هو بالضبط العيب الذي كشفناه في MR 3/6 (140+ اختبار تكامل كانت تتخطّى نفسها بصمت). **بوابةٌ تتخطّى نفسها ليست بوابة.**
2. **الحالة الملزمة الثالثة أُعيد تصميمها**: نصّها الأصليّ («طلبٌ ليس `negotiable` ⇒ `handoff_state = rejected` والاتفاق قائم») **غير قابل للوصول عبر HTTP العام**، لأنّ `POST /negotiations` يرفض الطلب غير القابل للتفاوض بـ**422 قبل أن يُوجد خيطٌ أصلاً**. فأُثبت الرفض النهائيّ بالطريق الذي يقع فعلاً: **عرضان حيّان ⇒ اتفاقان ⇒ الثاني يُرفض بـ`ORDER_AGREED_PRICE_ALREADY_SET`**. وصار النصّ الأصلي **الاختبار السادس** (422 `NEGOTIATION_ORDER_NOT_NEGOTIABLE`)، فلم يُفقد شيء بل صار حرزَين بدل حرز.

### ما لم يُنجَز في المرحلة 08 بقصد (لا تُعِد بناءه من الصفر)

- **لا عرضٌ مضادّ من داخل المحادثة في البوتين**: أوامر `/negotiations` و`/accept` و`/reject` فقط؛ اقتراح مبلغٍ من البوت محلّه واجهةُ محادثةٍ أغنى في طور لاحق.
- **لا وسائط ولا مرفقات في الرسائل** (`negotiation_messages` نصّية)، ولا ترجمة آليّة لمحتوى المحادثة.
- **لا كشف احتيالٍ ولا سمعة على سلوك التفاوض** — هذا بابُ **Phase 09** بعينه (§15).
- **لا تشغيل نبضةٍ مجدولة في الإنتاج**: النبضة تُنادى من الخارج (`POST /negotiations/tick`)؛ جدولتها بنيةٌ تحتيّة، محلّها طور التشغيل.
- **البند الأحمر خارج النطاق** ما زال مفتوحاً: تكامل `services/drivers` على محرّكٍ حقيقيّ (تفصيله في §14 أعلاه، «بندٌ مفتوح مكتشَف خارج النطاق»).

---

## 15. (تاريخيّ) شروط بدء **Phase 09 (Reputation + Fraud)** كما كُتبت قبل بدئها — والمرحلة أُغلقت في §16

**الطور 08 مُغلق، والمسار الحرج في [ROADMAP §3](ROADMAP.md) هو `00 → 01 → 02 → 04 → 06 → 07 → 09 → 20`.** واعتماديّات 09 هما **07 و08**، وكلتاهما مكتملة الآن — فلا خيار ولا مقارنة: **التالي 09 بلا التفاف.**

**بوابة خروج 09 (من ROADMAP):** «كلّ Completed Order ينتج Reputation events». أي: **الحدث ليس تقييماً بشريّاً**، بل نتيجةٌ محسوبة من واقعةٍ مسجّلة في محرّك الطلب.

**ابدأ من الحدّ لا من الكود** — النمط الذي أنجح 04 و06 و07 و05 و08 خمس مرّات:

1. **ADR-014** يحسم قبل أيّ سطر: هل السمعة **خدمة مستقلّة** تستهلك أحداث الطلب أم جدولٌ في خدمةٍ قائمة؟ وما مصدر الحقيقة لـ«اكتمل الطلب» (حدثُ محرّك الطلب المنشور لا استعلامٌ دوريّ)؟ وهل النقاط **مُشتقّة قابلة لإعادة الحساب** أم مُجمَّعة لا رجعة فيها؟ وما حدّ «الاحتيال»: قواعدُ مُسمّاة على وقائع (إلغاءٌ متكرّر · قبولٌ ثمّ تخلٍّ · إحالاتٌ بلا نشاط) أم نموذجُ تصنيف؟ **والقرار الذي لا يُؤجَّل: أحداثُ السمعة يجب أن تكون قابلة لإعادة التوليد من الوقائع، وإلّا صارت خطأٌ في الحساب عقوبةً دائمة لا تُصلَح.**
2. **عقودٌ كنسيّة أولاً** في `services/reputation/contracts/*` (مخطّط · مسارات · أحداث · أكواد خطأ) + حزمة أنواع `@wasla/contracts-reputation` بحرّاس انحرافٍ يقرؤون العقد من القرص — كما في المراحل الخمس السابقة.
3. **ثمّ الترتيب المُثبَت ستّ مراجعات**: 1/6 عقود + ADR · 2/6 مجالٌ نقيّ (حاسب النقاط وقواعد الاحتيال، بلا I/O) · 3/6 استمرارية Drizzle/Postgres بوحدة عمل واحدة · 4/6 طبقة HTTP على **منفذٍ جديد (المقترح 8092؛ المنافذ المشغولة: 8081 · 8083-8085 · 8086 · 8087 · 8088 · 8089 · 8090 · 8091)** · 5/6 المنافذ الصادرة الحقيقية (استهلاك أحداث الطلب) · 6/6 **بوابة الخروج E2E** في `packages/reputation-e2e` تُثبت أنّ طلباً يُكمل دورته عبر HTTP العام **يُنتج حدث سمعةً واحداً لا صفراً ولا اثنين**، وأنّ إعادة الحدث نفسه لا تُضاعف النقاط.
4. **قيودٌ دائمة لا تنتهي بدفعة:** [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md) (الكود ووثيقته في **نفس الدفعة**) · [GIT_RULES](../00-rules/GIT_RULES.md) (`main` محميّ · فرعٌ ومراجعة) · [DEFINITION_OF_DONE](../00-rules/DEFINITION_OF_DONE.md) · و**§2-أ**: حصّة دقائق CI منتهية، فالقياس محلّيٌّ موثَّق في [TASK_LOG](TASK_LOG.md) قبل الدمج.
5. **ولا تُعلَن 09 مكتملة** قبل أن تكون بوابتها خضراء على **محرّكٍ حقيقيّ**، ووثيقتها في `docs/12-testing/PHASE09_EXIT_GATE_E2E.md`، والإعلان في [ROADMAP](ROADMAP.md) و[MASTER_PROGRESS](MASTER_PROGRESS.md) وهنا.

---

## 16. Phase 09 (Reputation + Fraud) — مكتملة ✅ (2026-08-23) · بوابة الخروج اجتازت (MR 1/6 → 6/6)

> **اقرأ §15 أوّلاً** (شروط بدء المرحلة كما كُتبت قبل بدئها)، ثمّ هذا القسم (ما وقع فعلاً، وما يجب أن تفعله المراجعة التالية).

### 16-أ. القاعدة الحاكمة للمرحلة — بجملة واحدة

**السمعة نتيجةٌ مُشتقّة من دفتر وقائع، والاحتيال إشاراتٌ مُسمّاة لا حُكم، والخدمة لا تعاقب أحداً.**

ثلاث نتائج تلزم كلّ مراجعةٍ قادمة في هذه المرحلة:

1. **الواقعة تُخزَّن والنقطة تُشتقّ.** `reputation_facts` جدولٌ append-only، و`reputation_scores` **ذاكرةُ حسابٍ لا مصدرَ حقيقة**: حذفُ الجدول بالكامل عملٌ **بلا خسارة** لأنّ `POST /reputation/scores/{subject}/recompute` يُعيده من الدفتر. ولذلك لا مسار ولا عمود يضبط نقاطاً يدوياً — `setScore` · `adjustScore` · `setTier` ممنوعةٌ **بحارس سالب** لا بمراجعة. *النسخة الخاطئة الأرخص:* عمود `score` يُزاد بـ`UPDATE … SET score = score + 3`، فيصير كلّ خطأٍ في الحساب **عقوبةً دائمة لا تُصلَح** ([ADR-014](../15-decisions/ADR-014-reputation-derived-scores-and-fact-sourced-fraud-signals.md) القرار 3).
2. **مصدرُ الحقيقة حدثان منشوران** من محرّك الطلب: `order.status_changed` و`order.assignment_resolved`. لا استعلامٌ دوريّ، ولا قراءةُ جدولٍ في `orders`، ولا FK. والتسليم at-least-once فالتفرّد **قيدٌ في القاعدة** (`ux_reputation_facts_source` على `subject_type · subject_public_id · fact_kind · order_public_id · source_sequence`) لا فحصٌ في الكود؛ وإعادةُ التسليم نفسها تُجيب **`200` بـ`duplicate: true`** لا `409` (الإعادة ليست خطأ المُرسِل). *النسخة الخاطئة الأرخص:* `SELECT … WHERE NOT EXISTS` قبل الإدخال — يمرّ في الاختبار ويكسر تحت التزامن.
3. **الخدمة لا تعاقب.** لا مسارَ إيقافٍ أو حجب، ولا عمود `is_suspended` أو `is_fraudster`، ولا رمزَ خطأٍ عقابيّ في الكتالوج، ولا حدثَ `reputation.subject_suspended`. الإيقاف **ملكُ `services/drivers`** (ADR-012 القرار 3) والقرار الإداريّ **ملكُ Phase 15**. السمعة تُعلن حقائق ويبني عليها غيرُها في خدمته ويملك أثره.

### 16-ب. ما أنجزته MR 1/6 بالضبط

| المُسلَّم | الموضع | الحجم |
|---|---|---|
| ADR-014 | [`docs/15-decisions/ADR-014-…`](../15-decisions/ADR-014-reputation-derived-scores-and-fact-sourced-fraud-signals.md) | **تسعة قرارات**، كلٌّ منها مقرونٌ بـ«النسخة الخاطئة الأرخص» |
| مخطّط البيانات | `services/reputation/contracts/schema.sql` | **تسعة جداول** بقيودٍ مُسمّاة وبذورِ نسخة القواعد |
| المسارات | `services/reputation/contracts/api.openapi.yml` | **تسعة مسارات** على المنفذ **8092** · **لا `502`** |
| الأحداث | `services/reputation/contracts/events.json` | **خمسة أحداث** · `additionalProperties: false` · `occurred_for` إلزاميّ |
| أكواد الخطأ | `services/reputation/contracts/errors.md` | **17 كوداً** على 400 · 404 · 409 · 422 · 503 |
| دليل العقود | `services/reputation/contracts/README.md` | من يملك ماذا · **سبعة حدود ملزمة** · ما ليس هنا |
| حزمة الأنواع | `packages/contracts/reputation/` (`@wasla/contracts-reputation`) | أنواعٌ مولّدة + ثوابت وقت تشغيل + **81 حارس انحراف** |
| نموذج المجال | [`docs/03-domain/REPUTATION_FRAUD.md`](../03-domain/REPUTATION_FRAUD.md) | تسعة أقسام على شكل `NEGOTIATION_CHAT.md` |
| المعماريّة | [`CONTAINERS §4.6`](../02-architecture/CONTAINERS.md) | اتجاه الاعتماد · المنفذ · الانحراف المُعلَن |

**ولا سطرَ تنفيذٍ واحد:** لا `services/reputation/src/`، ولا `package.json` للخدمة، ولا مخطّط Drizzle، ولا Fastify. العقد يُكتب أوّلاً ويُقاس الكود عليه (ADR-004)، لا العكس.

**الأرقام بياناتٌ لا كود.** الأوزان والعتبات والنوافذ كلّها في نسخةٍ **مجمّدة مُرقّمة** `saudi-launch-v1` (`reputation_rulesets` · `reputation_rule_weights` بتسعة صفوف · `reputation_fraud_thresholds` بخمسة)، وكلّ نتيجةٍ وتقييمٍ وإشارةٍ تحمل `ruleset_version` — فالنتيجة **قابلة للتفسير بعد سنة**، وتغييرُ الأرقام نسخةٌ جديدة لا تعديلُ ماضٍ. ولا `NUMERIC` ولا عائم في المخطّط كلّه.

**الزمن نبضة لا مؤقّت.** `POST /reputation/tick` هو **الموضع المُعلَن الوحيد** لتقديم الزمن: التلاشي وإعادةُ الحساب المستحقّة وتقييمُ نوافذ الاحتيال. والاستحقاق **مُخزَّن ومفهرس** (`ix_reputation_scores_recompute_due`)، والتلاشي **حسابٌ مسجَّل** لا دالّةَ قراءةٍ تُعطي جوابين في دقيقتين.

**والانحراف مُعلَن في العدد لا في الموضع:** خدمةٌ واحدة `services/reputation` تحمل السمعة والاحتيال، و`services/fraud/` تبقى **فارغة بقرار** ([ADR-014](../15-decisions/ADR-014-reputation-derived-scores-and-fact-sourced-fraud-signals.md) القرار 1) — لأنّ قواعد الاحتيال تقرأ **نفس دفتر الوقائع**، وخدمةٌ ثانية تعني نسخةً ثانية من الوقائع تتباعد بصمت. الانحراف مكتوبٌ في `README` العقود وفي `CONTAINERS §4.6` وفي حارس اختبار، لا مكتوماً في الكود.

**المقيس محلّيّاً (حصّة CI منتهية — §2-أ):** `pnpm --filter @wasla/contracts-reputation test` ⇒ **81 اختباراً في أربعة ملفات · 0 فاشل** (مخطّط 24 · أحداث 20 · حدود 19 · عقود 18)، و`pnpm -r test` ⇒ **2562 اختباراً + 1 متروك بقصد في 154 ملفاً · 0 فاشل**، و`pnpm -r typecheck` نظيف على 32 مشروعاً.

### 16-ج. مبدأ الحرّاس الذي يجب ألّا يُخترق في المراجعات الخمس الباقية

**الحارس السالب يقرأ سطحاً آليّاً لا نصّاً تفسيريّاً.** أي: لإثبات أنّ حقلاً **غائبٌ بقرار**، اقرأ مفاتيح المخطّط، وقيمَ التعدادات، وقيمَ `"const"` في ملف الأحداث، وSQL **بعد تجريد التعليقات** — لا الفقرةَ التي تشرح سببَ الغياب. وإلّا صار أرخصُ طريقةٍ لتخضير الاختبار **حذفَ الشرح**، فيُهدَم الحدُّ بالضبط عند من لم يقرأ ADR. (وقع هذا مرّتين في هذه المراجعة وصُحّح: فحصُ الأحداث الممنوعة يمسح `"const"` وحدها، ومُحلِّل `$ref` يفكّ `oneOf`/`anyOf` ويتجاوز فرعَ `null` فتُقابل التعدادات تعدادات.)

### 16-د. ما طُلب من MR 2/6 — **وقد تمّ** (الشرط محفوظٌ كما كُتب قبل تنفيذه، ودليلُ إنجازه في 16-هـ)

**الحدّ:** حزمة `@wasla/reputation-service` بـ`src/domain/` و`src/use-cases/` و`src/ports.ts` — **بلا قاعدة ولا HTTP ولا `sleep` ولا `Date.now()`**، والساعة مُحقونة.

ما يجب أن يوجد فيها:

1. **حاسب النقاط** دالّةٌ نقيّة: (دفتر وقائع + نسخة قواعد + لحظة) ⇒ (نتيجة · رتبة · لحظة الاستحقاق القادمة). ونفس الدخل يعطي نفس الخرج **دائماً** — وهذا ما يجعل `recompute` ممكناً أصلاً.
2. **التلاشي بنصف عمر 180 يوماً** حساباً صريحاً على وقائعَ لها تواريخ، لا «معامل نسيان» يُضرب في النتيجة السابقة (وإلّا ضاعت قابليّة إعادة التوليد التي هي كلّ المرحلة).
3. **الرتبة مُشتقّة من النتيجة وعددِ الوقائع** بالعتبات المُعلَنة (`min_facts` = 5 · `standard_at` = 50 · `trusted_at` = 80 · `under_watch_below` = 35)، و**`new` لا تملك تاريخاً** — والقيد `ck_reputation_scores_new_has_no_history` يقول ذلك في القاعدة، فليقُله المجال أيضاً بدلالةٍ صريحة لا بتصادفٍ حسابيّ.
4. **قواعد الاحتيال الخمس** كلٌّ منها دالّةٌ **مُسمّاة باسمها الحرفيّ** في `FRAUD_RULE_CODES`، تأخذ نافذةً ووقائعَ وتُعيد **إشارةً أو لا شيء**. لا نموذج، ولا `probability`، ولا `state` — والحرّاس السالبة في حزمة العقد تفشل على أوّلها.
5. **الإشارة واحدةٌ لكل (قاعدة × شخص × نافذة)** فالنبضة تُعاد ولا تُكرّرها — وهذا يعني أنّ حدّ النافذة **يُحسَب لا يُخمَّن**.
6. **مُهيّئ ذاكرة** يُطبّق **كلّ** قيدٍ اسمُه في `schema.sql` بنفس أسمائها، لتُقابله استمراريّةُ MR 3/6 بمطابقة منافذ لا بثقة.

**ولا تلمس:** أيَّ ملفٍ في `services/reputation/contracts/*` — العقد مُجمَّد لهذه المراجعة؛ إن احتجتَ تغييره فذلك **تعديلُ عقدٍ** يُوثَّق ويُعاد توليد الأنواع ويمرّ على الحرّاس الـ81، لا تصحيحٌ عابر.

**والدَّين المُعلَن الذي يبقى مفتوحاً بعد MR 1/6 و2/6:** ناشرُ `reputation_outbox` (نفس دَين الأطوار 06 · 07 · 08 — لا مُشغّل دوريّ في المستودع بعد) · مستهلكُ حدثَي الطلب مؤجَّلٌ إلى **MR 5/6** بقرار · ولا تُعلَن المرحلة مكتملة قبل **MR 6/6**: بوابةُ خروجٍ في `packages/reputation-e2e` تُثبت أنّ طلباً مكتملاً عبر HTTP العام يُنتج **حدث سمعةٍ واحداً لا صفراً ولا اثنين**، وأنّ **إعادة الحدث نفسه لا تُضاعف النقاط**، ووثيقتُها `docs/12-testing/PHASE09_EXIT_GATE_E2E.md`.

### 16-هـ. ما أنجزته MR 2/6 ([!65](https://gitlab.com/uxxxu/wasla/-/merge_requests/65)) بالضبط — طبقة المجال النقيّة `@wasla/reputation-service`

حزمة عملٍ جديدة في `services/reputation/`: **19 ملف مصدر** (4003 أسطر) و**133 اختباراً** في ثمانية ملفات، ولا سطرَ واحدٍ يعرف Postgres أو Fastify.

| ما طُلب في 16-د | أين تمّ | دليلُ إتمامه |
|---|---|---|
| 1 · حاسبٌ نقيٌّ (دفتر + نسخة قواعد + لحظة) ⇒ نتيجة · رتبة · استحقاق | `src/domain/score.ts` | `score.test.ts` — الترتيبُ لا يُغير الرقم، ونفسُ الدخل يُعطي نفسَ الخرج |
| 2 · تلاشٍ صريحٌ بنصف عمر 180 يوماً على وقائعَ لها تواريخ | `decayFactor` · `computeScore` | اختبارات عند نصف العمر وضِعفه والصفر، وأنّ `occurredAt` لا `recordedAt` هو المقياس |
| 3 · الرتبة من النتيجة **وعددِ الوقائع** | `deriveTier` | سلّمُ الرتب كاملاً بما فيه حدودها · `new` دون خمس وقائع مهما كان الرقم |
| 4 · القواعد الخمس دوالُ مُسمّاةٌ بأسمائها الحرفيّة تُعيد إشارةً أو لا شيء | `src/domain/fraud.ts` | `fraud.test.ts` — 23 اختباراً: دون العتبة، عندها، خارج النافذة، الجانب الخطأ |
| 5 · إشارةٌ واحدةٌ لكل (قاعدة × شخص × نافذة) والحدُ **يُحسب لا يُخمّن** | `fraudWindowFor` + `ux_fraud_signals_rule_window` | `run-tick.test.ts` — نبضتان في نفس اليوم ⇒ إشارةٌ واحدة وحدثٌ واحد |
| 6 · مُهيئُ ذاكرةٍ يفرض **كلّ** قيود `schema.sql` بأسمائها | `src/infrastructure/{constraints,in-memory}.ts` | `constraints.test.ts` — حارسٌ **يقرأ الـDDL نفسه** بعد حذف التعليقات: 15 قيداً، ولا قيدَ بلا فرض، ولا فرضَ بلا قيد |

**وزيادةً على المطلوب** (وكلُّها تخدم المراجعات القادمة):

- **حارسٌ سلبيٌّ للنقاء** (`purity.test.ts`) يمسح `src/` بعد حذف التعليقات ويرفض: `Date.now` · `new Date()` بلا وسيط · مؤقّت · `sleep` · `Math.random` · `fetch` · `drizzle`/`pg` · `process.env` · استيرادٌ يعبر حدَّ الخدمة · حقلَ إيقافٍ أو حظرٍ · `probability`/`riskScore` · نصّاً حرّاً في التقييم. و`new Date(x)` **بوسيط** مسموحٌ ومحروسٌ صراحةً: تحويلُ صيغةٍ نقيٌّ لا قراءةُ ساعة.
- **ترتيبُ الحرّاس في `recordFact` مُختبَرٌ:** إعادةُ التسليم تُفحص **قبل** القِدَم. ولو عُكِس لرُدّت كلُّ إعادةِ تسليمٍ طبيعيّةٍ `SOURCE_EVENT_STALE` (وهو خطأٌ يقول «توقّف» حيث يجب أن يقول «تمّ سابقاً») — `errors.md` القاعدة 4.
- **`weightFor` يرمي ولا يُصفّر:** وزنٌ غيرُ مُعلَن ⇒ `RULE_WEIGHT_MISSING` (422) و**لا كتابةَ بحال** (مُثبَتٌ باختبار: لا واقعةَ ولا نتيجةَ ولا حدث). والصفرُ المُعلَن (`assignment_rejected: 0`) يمرّ عاديّاً.
- **التقييم لا يكتب نقطةً مباشرةً:** يُخزّن، ثمّ تُشتقّ منه واقعةُ `rating_received` تمرّ من `recordFact` نفسه، ومن الدفتر تُحسب النتيجة. و`subjectType` **يُستنتَج من الدفتر** ولا يُرسله العميل.
- **النبضة تُحصي ولا ترمي:** `TickResult.failures` يُزاد ولا يعبر الاستثناء حدَّ النبضة — مُثبَتٌ بإعطاب مخزنِ شخصٍ واحد وتأكيدِ أنّ نتيجةَ الآخر كُتبت فعلاً.
- **المُرشِّح إلزامٌ في القوائم** (`FILTER_REQUIRED` 400)، واستثناءٌ واحدٌ مُعلَن: نسخُ القواعد مجموعةٌ تنمو بإصدارٍ لا بحركةِ مستخدمين.
- **حرسُ تزامنٍ متفائل** في `recomputeScore` (`ifComputedThroughFactId`) ⇒ `SCORE_STALE` (409) بدل الكتابة فوق حسابٍ أحدث.

**المقيس محلّيّاً (حصّة CI منتهية — §2-أ):** `pnpm --filter @wasla/reputation-service test` ⇒ **133 اختباراً في 8 ملفات · 0 فاشل · 1.66 ثانية**، و`pnpm -r test` ⇒ **2695 ناجحاً + 1 متخطّى في 162 ملفاً · 0 فاشل** (الأساس قبلها: 2562 + 1 في 154 ملفاً — فالفرق **+133 في +8 ملفات** ولا اختبارَ قائمٌ تغيّر)، و`pnpm -r typecheck` **نظيف على 34 مشروعاً**.

> **ملاحظة تركيبيّة لمن يُكمِل:** إضافةُ الحزمة تطلب `pnpm install --no-frozen-lockfile` مرّةً واحدة (وإلّا `ERR_PNPM_OUTDATED_LOCKFILE`)، وقد حُدِّث `pnpm-lock.yaml` في هذه المراجعة. والمشاريع صارت **34**.

### 16-و. ما طُلب من MR 3/6 — **وقد تمّ** (الشرط محفوظٌ كما كُتب قبل تنفيذه، ودليلُ إنجازه في 16-ز)

**الحدّ:** `src/infrastructure/postgres/` بمخطّط Drizzle يُقابِل `contracts/schema.sql` عموداً بعمود، وترحيلٌ **عكوس** موثّقٌ في TASK_LOG، ووحدةُ عملٍ (`ReputationRunner` على نمط `NegotiationRunner`) فلا يملك معالجُ مسارٍ فتحَ معاملة.

والشرطُ المُلزِم الذي تمّ التمهيدُ له في 2/6:

1. **نفسُ الاختبارات على المُهيئَين.** الحزمة الموجودة (133) مكتوبةٌ على المنافذ لا على المخازن، والمطلوب تشغيلُ مجموعةِ القيود والحالات **مرّتين**: مرّةً على الذاكرة ومرّةً على Postgres حقيقيّ، وتأكيدُ **رمزِ الخطأ واسمِ القيد** معاً. و`ENFORCED_CONSTRAINTS` و`details.constraint` موجودان لهذا بالضبط — دونهما تبقى «الذاكرة تُحاكي القيود» دعوى لا فحصاً.
2. **وظيفة CI `reputation-db-integration`** على نمط `drivers-db-integration` و`negotiations-db-integration` (مع ملاحظة حصّة الدقائق — §2-أ).
3. **بذرُ نسخة القواعد 1** يأتي من الترحيل لا من الكود. و`SEEDED_RULESETS` في المجال **للاختبار وحده**؛ ومصدرُ الحقيقة في الإنتاج صفوفُ القاعدة، فلا تُقرأ الأرقام من ثابتٍ مترجَم في مسارٍ حقيقيّ.
4. **جدول `reputation_outbox`** يُنشأ ويُكتب فيه في **نفس المعاملة** مع الصفّ المُحدَّث (وإلّا فقدنا أوّلَ ما وُعِد به الطور)، و`OutboxPort` موجودٌ بتوقيعه النهائيّ فلا تتغير حالاتُ الاستخدام.

**ولا تلمس:** `services/reputation/contracts/*` (مجمّد)، ولا دوالَ المجال النقيّة إلّا لإضافة، ولا الحارسين السلبيّين (`constraints.test.ts` · `purity.test.ts`) — من أراد توسيعَ ما يقرآنه فعل، ومن أراد تضييقَه فذاك **تغييرُ قرارٍ** يحتاج ADR.


### 16-ز. ما أنجزته MR 3/6 بالضبط — الاستمرارية على Postgres و**مطابقة المُهيئين**

خمسةُ ملفّاتِ مصدرٍ جديدة (1412 سطراً) وخمسةُ ملفّاتِ اختبارٍ جديدة، و**الوثيقةُ المرجعيّة الكاملة** في [REPUTATION_PERSISTENCE.md](../02-architecture/REPUTATION_PERSISTENCE.md) — اقرأها قبل أن تلمس شيئاً في هذه الطبقة.

| ما طُلب في 16-و | أين تمّ | دليلُ إتمامه |
|---|---|---|
| 1 · نفسُ الاختبارات على المُهيئَين بتأكيد **رمز الخطأ واسم القيد** | `__tests__/port-conformance.integration.test.ts` (577 سطراً · 19 اختباراً) | جدولٌ لكلّ اسمٍ في `ENFORCED_CONSTRAINTS` بمُحرِّضٍ في كلّ مُهيئ، **واختبارُ تغطيةٍ يُغلق الجدول** (المجموعة = `ENFORCED_CONSTRAINTS` بالتساوي)، وسيناريوٌ كاملٌ يُنفَّذ مرّتين بنفس الساعة ونفس مولّد المعرّفات فتُقارَن الصفوفُ **حرفياً** |
| 2 · وظيفة CI `reputation-db-integration` | `.gitlab-ci.yml` | تمتدّ من `.db-integration-base` · `postgres:15` · قاعدةٌ مستقلّة `wasla_reputation_test` · `DATABASE_URL` هو ما يقرأه `vitest.integration.config.ts` |
| 3 · بذرُ نسخة القواعد 1 من **الترحيل** لا من الكود | `contracts/schema.sql` (بذرةٌ داخله) + `repository.integration.test.ts` | الاختبار يقرأ النسخة عبر المنفذ ويؤكّد قيمَها **دون استيراد `SEEDED_RULESETS`**، و`PostgresRulesetRepository` **للقراءة وحدها** (لا `insert`) |
| 4 · `reputation_outbox` في **نفس المعاملة** و`OutboxPort` بتوقيعه النهائيّ | `infrastructure/drizzle/{transaction,repository}.ts` + `atomicity.integration.test.ts` | نجاحٌ يكتب الثلاثة (واقعة · نتيجة · ثلاثةُ أحداث)، وفشلٌ **بعد** الكتابة يُرجِع الثلاثةَ إلى ما كانت — لا سطراً واحداً |
| زيادةً · ترحيلٌ **عكوس** | `contracts/schema.sql` | `CREATE TABLE IF NOT EXISTS` + كتلةُ `DROP` بترتيب الاعتماد المعاكس **معلَّقةً**: العكوسيّةُ مكتوبةٌ ومقروءة ولا تُنفَّذ بحادثٍ عابر. **ولا مجلّد `migrations/`** — ملفٌّ ثانٍ كان سيُنشئ موضعين يجب أن يتّفقا |
| زيادةً · وحدةُ عمل | `runner.ts` | `ReputationRunner{write,read}` · **لا شيءَ غير `transaction.ts` يستدعي `db.transaction`** · طبقةُ 4/6 تستقبل المُشغّلَ **ولا شيءَ غيره**، فلا معالجُ مسارٍ يقدر أن يفتح معاملة |
| زيادةً · حارسُ انحرافٍ بلا قاعدة | `__tests__/schema-drift.test.ts` (30 اختباراً) | يقرأ `schema.sql` من القرص ويقارن الأعمدةَ وأنواعَها و`NOT NULL` والافتراضيّاتِ وأسماءَ القيودِ والفهارس **في الاتجاهين**: 15 قيداً و11 فهرساً |

**ثلاثةُ فروقٍ حقيقيّةٍ كشفتها المطابقة فأُصلحت في نفس المراجعة** (وكلُّها كانت **تمرّ** في الذاكرة):

1. **`traceId` غائبٌ من صفّ التقييم في الذاكرة و`null` منه في Postgres.** النوعُ يسمح بالاثنين فلا typecheck يراه، والأثرُ أنّ نفس الطلب كان سيُسلّم **جسمين مختلفين** على حدّ HTTP بحسب المخزن.
2. **بصمةُ الحمولة** صارت sha256 حقيقيّة (العقد يشترط طولاً 64) — وأيُّ بصمةٍ أطولَ كانت سترتدّ من القاعدة **بعد** أن تمرّ في الذاكرة. و`node:crypto` ليس خرقاً للنقاء: تلبيدٌ حتميّ لا يقرأ ساعةً ولا عشوائيّة.
3. **`subjectType` رُفع من صفّ منع التكرار**: العقدُ لا يملك عموداً له، فحملُه كان حقلاً يُحفَظ في الذاكرة ويُفقَد في Postgres.

**والانحرافُ المُعلَن الذي يجب أن يعرفه مستهلكُ الأحداث في 5/6:** `source_event_id` من نوع **`UUID`** في العقد، فمُعرّفٌ مُركّبٌ مثل `c-ORD-…` يمرّ في الذاكرة ويُرفَض بـSQLSTATE `22P02` **وبلا اسمِ قيد**. موثَّقٌ باختبارٍ مخصّصٍ في `repository.integration.test.ts` بدل أن يُكتم بتغيير المساعد المجاليّ.

**وتوسيعُ نطاقٍ لا تضييقُ حدّ في `purity.test.ts`:** طبقتا سماحٍ — `DB_DRIVER_FILES` (ملفّات `infrastructure/drizzle/*` وحدها تستورد السائق) و`DB_PATH_AWARE_FILES` (`runner.ts` والمُهيئ يعرفان **وجود** مسارٍ للقاعدة بلا سائق). وما بقي من `src/` تحت الحدّ الأصليّ كما كان. والتضييقُ ما زال يحتاج ADR.

**والمقيس محلّيّاً (حصّة CI منتهية — §2-أ):** `test:integration` ⇒ **52 ناجحاً في 3 ملفّات · 0 فاشل · ~1.9s** على **PostgreSQL 18.4** حقيقيّ · المجموعةُ السريعة ⇒ **166 في 9 ملفّات** · `pnpm -r test` ⇒ **2728 ناجحاً + 1 متروكاً بقصد · 0 فاشل** (الأساس 2695 + 1) · `pnpm -r typecheck` نظيف على 34 مشروعاً. **ووظيفةُ `reputation-db-integration` مضافةٌ وجاهزةٌ وغيرُ مُنفَّذةٍ بعد.**

### 16-ح. ما طُلب من MR 4/6 — **وقد تمّ** (الشرط محفوظٌ كما كُتب قبل تنفيذه، ودليلُ إنجازه في 16-ط)

**الحدّ:** `src/http/` بـFastify فوق **نفس** حالات الاستخدام بلا تعديلٍ في `domain/` ولا `use-cases/` — كما لم تُعدّلها 3/6.

1. **المسارات التسعة** كما في `contracts/api.openapi.yml` + `/health` بحالتيه (`memory` مقابل `postgres`) و`last_tick_at`. **ولا `502`** في الكتالوج ولا في أيّ جواب.
2. **`ReputationRunner` هو كلُّ ما تستقبله الطبقة** — لا `Db` ولا `Pool` ولا مستودعاً. فلا معالجُ مسارٍ يقدر أن يفتح معاملةً أو يلمس جدولاً: الخطأُ **غيرُ متاح** بدل أن يكون مكروهاً.
3. **سدُّ الدَّين المُعلَن:** `response_status` و`response_body` في `reputation_idempotency` يصيران **الجوابَ المحفوظَ فعلاً**، فإعادةُ المفتاح تُعيد **نفس الجسم** لا جسماً مُعاد بناؤه. القيمتان اليوم `200` و`{}` كموضعٍ محفوظٍ مُعلَن ([REPUTATION_PERSISTENCE §8-د](../02-architecture/REPUTATION_PERSISTENCE.md)).
4. **`onlyKeys()` على كلّ حمولة** وكتالوجاتُ تعدادات **وقتِ تشغيل** ترفض العضوَ المجهول على الحدّ — لا `as` ولا ثقةٌ بالأنواع المولّدة وحدها.
5. **إعادةُ التسليم تُجاب `200` بـ`duplicate: true`** لا `409` (ADR-014 · `errors.md` القاعدة 4) — والاختبارُ يقيس الجسمَ لا الرمزَ وحده.

**ولا تلمس:** `services/reputation/contracts/*` (مجمّد) · ولا حدَّ المعاملة (`transaction.ts` وحده يفتحها) · ولا الحرّاسَ السلبيّين الثلاثة (`constraints.test.ts` · `purity.test.ts` · `schema-drift.test.ts`) تضييقاً — التوسيعُ مسموح والتضييقُ يحتاج ADR.

### 16-ط. ما أنجزته MR 4/6 بالضبط — طبقة HTTP على **8092**

**الملفّاتُ الجديدة:** `src/mappers.ts` (المجال ⇄ السلك) · `src/http/{requests,errors,app,server}.ts` ·
`src/infrastructure/runtime.ts` (`SystemClock` · `CryptoIdGenerator`) · `src/__tests__/{http-harness.ts,http.test.ts,http-drift.test.ts}`.
**والمُعدَّل:** `package.json` (`fastify` · `dev` · `start`) · `src/__tests__/purity.test.ts` (**توسيعُ نطاقٍ**
باستثناءين مُسمّيين ولكلٍّ اختبارٌ موجَبٌ) · وثائقُ التقدّم والمعمارية.
**ولم يُعدَّل:** `contracts/*` ولا `src/domain/` ولا `src/use-cases/` ولا `src/ports.ts` ولا حدُّ المعاملة.

1. **تسعةُ مسارات · إحدى عشرة عمليّة** (ثمانيةٌ للسمعة + `/health`) — والعددُ **تسعةٌ لا عشرة**:
   العقدُ نفسُه يُعلن تسعةً، وحارسٌ يُثبت العددَ ويُثبت تساويها مع `REPUTATION_API_PATHS`. من قرأ
   «تسعة مسارات + `/health`» في 16-ح فليقرأ الآن العقد: `/health` **واحدٌ منها**.
2. **`ReputationRunner` وحدَه يصل إلى المعالج** — لا `Db` ولا `Pool` ولا مستودعاً. و`db.transaction`
   يُنادى في ملفٍّ واحدٍ في الحزمة كلِّها كما كان.
3. **الدَّينُ (د) مسدود:** `response_status`/`response_body` صارا الجوابَ المستحقَّ للمُعيد، يُحفظ في نفس
   المعاملة ويُعاد **كما هو**. والحقلُ في المجال `payload` لا `body` لأنّ حارسَ النقاء يمنع الثاني.
4. **`onlyKeys()` على كلّ حمولة** + كتالوجاتُ تعدادات وقتِ تشغيل عبر مُتحقّقات `domain/validation.ts` —
   **لا `as` للتحقّق** في الطبقة كلِّها.
5. **الإعادةُ `200` و`duplicate: true`**، والاختبارُ يقيس **تطابقَ الجسم** لا الرمزَ وحده.
6. **لا `502` في أيّ فرع** (حارسٌ يقرأ مصدرَ `errors.ts` بعد إسقاط التعليقات)، و**`500` انحرافٌ مُعلَن**
   لقيدِ تماسكٍ ملفوفٍ في `cause` برمزٍ **غائبٍ عن `REPUTATION_ERROR_CODES` قصداً ومحروسٍ بغيابه**.
7. **جسمٌ فارغٌ مع `content-type: application/json` ليس خطأً**: مسارا إعادةِ الحساب والنبضة لا
   `requestBody` لهما في العقد، فمُحلِّلٌ مخصّصٌ يُحوّل الفراغَ إلى `undefined` وJSON المكسور يبقى `400`.
   لولاه كان أوّلُ نداءٍ **مطابقٍ للعقد** يُردّ برسالةٍ عن نوع المحتوى.
8. **استثناءان مُسمّيان في حارس النقاء، ولكلٍّ اختبارٌ موجَبٌ يُحسب من المصدر:** `http/server.ts` وحده
   يقرأ `process.env`، و`infrastructure/runtime.ts` وحده يقرأ ساعةَ النظام. مجموعةُ من يفعل ذلك = القائمةُ
   بالتساوي، فلا تتّسع بالإهمال ولا تبقى بعد حذف صاحبها. **توسيعُ نطاقٍ لا تضييقُ حدّ** (16-و).

**الأدلّة (قياسٌ محلّيّ — حصّة دقائق CI منتهية، §2-أ):** `http.test.ts` **44** · `http-drift.test.ts` **13** ⇒
الخدمة **225 في 11 ملفّاً · 0 فاشل** · `typecheck` exit 0 · `test:integration` **52 في 3 ملفّات** على
PostgreSQL 18.4 · المستودع `pnpm -r test` **2787 ناجحاً + 1 متروكاً بقصد · 0 فاشل** و`pnpm -r typecheck`
نظيف على **34 مشروعاً**. الوثيقة: [REPUTATION_HTTP.md](../04-api/REPUTATION_HTTP.md).

### 16-ي. MR 5/6 — مستهلكُ حدثَي الطلب وناشرُ صندوق الصادر · **نُفِّذت ✅** ([!68](https://gitlab.com/uxxxu/wasla/-/merge_requests/68))

**الحدّ الذي التُزم:** لا تعديلَ في `domain/` ولا `use-cases/` ولا `contracts/*` — كما في 3/6 و4/6. وتحقّق.

البنودُ الخمسةُ التي كانت مطلوبةً وما صار إليها:

1. **مستهلكٌ لحدثَي `order.status_changed` و`order.assignment_resolved`** — `parseSourceEvent` يقرأ **نوعَ الحدثِ أوّلاً** قبل أيِّ حقلٍ آخر، فحدثٌ لا يعنينا يخرج `unsupported` بلا أن نتحقّق من حمولةٍ لا نملك عقدَها (ولو انعكس الترتيبُ لصار كلُّ حدثٍ في المنصّة يُرفَض من السمعة بـ400). و**`source_event_id` يُحرَس كـUUID على الحدّ** لا في القاعدة، فلا `22P02` بلا اسمِ قيد.
2. **at-least-once والتفرّدُ قيدٌ في القاعدة** — أُنجز، **ومقيسٌ حيث يهمّ**: إعادةُ نفسِ الحدثِ ⇒ `duplicate` **وصفرُ صفوفِ صادرٍ جديدة** (البندُ 12 في بوابةِ الخروج). والاختبارُ يعدّ ما وصل المصرفَ لا الرمزَ وحده، كما طُلب حرفيّاً.
3. **ناشرٌ يُرحّل `reputation_outbox`** — `EventSinkPort` **منفذٌ** لا `fetch` (فحرسُ النقاءِ لم يحتج تعديلاً ولا استثناءً)، و`drainOutbox` يُطالِب ثمّ يُسلّم ثمّ يُعلّم بحدٍّ إلزاميّ، و**الفشلُ لا يُعلّم الصفَّ** فيُعاد في التصريفِ التالي بلا نشرتَين لصفٍّ واحد.
4. **`x-request-id` يمرّ كما هو** — `trace_id` يُنقَل من الحدثِ الوارد إلى الواقعة إلى الحدثِ الصادر.
5. **لا مؤقّت** — لم يُضَف أيُّ مُجدوِل؛ التصريفُ يُنادى من الخارج.

**والزيادةُ على المطلوب:** `translateSourceEvent` **دالّةٌ نقيّة** تُنتج مسوّداتٍ **وأسباباً مُسمّاةً للتجاهل** (`status_not_reputable` · `status_owned_by_no_party` · `assignment_cancelled_by_system` · `driver_absent_in_payload`) — والإكمالُ **واقعتان لا واحدة** لأنّ العميلَ أكمل والسائقَ أكمل، وإلغاءُ سائقٍ بلا مُعرّفِ سائقٍ **لا يُخمَّن ولا يُسجَّل على العميل** (واقعةٌ تُنسَب إلى غير فاعلها أسوأُ من واقعةٍ لم تُسجَّل)، و`assignment_rejected` **بوزنٍ صفرٍ مُعلَن**. وعقدُ `consumeSourceEvent` سطرٌ واحد: **رجوعٌ عاديٌّ يعني «استُهلك» ورفعُ خطأٍ يعني «أعِد التسليم»** — فلا دالّةَ `requiresRedelivery` تُسأل بعد الرجوع، والرفضُ المُسمّى (400/409/422) يُجمَع في `outcomes` ولا يُعاد تسليمُه (إعادةُ واقعةٍ متأخّرةٍ ستتأخّر دائماً)، وما ليس مُسمّىً **يُرفَع كما هو**.

**المقيس:** **+57 اختباراً** (11 حارس انحرافٍ للحمولة + 22 للترجمة + 10 للمُستهلك + 14 للتصريف) ⇒ الخدمة **282 اختباراً في 15 ملفّاً**، والمستودعُ **2844 ناجحاً · 0 فاشل**. الوثيقتان: [REPUTATION_SOURCE_EVENTS.md](../02-architecture/REPUTATION_SOURCE_EVENTS.md) · [REPUTATION_OUTBOX_PUBLISHER.md](../02-architecture/REPUTATION_OUTBOX_PUBLISHER.md).

### 16-ك. MR 6/6 — بوابةُ خروج المرحلة · **نُفِّذت ✅ · والمرحلةُ مغلقة**

**الحدّ الذي التُزم:** **لا سطرَ إنتاجٍ واحدٍ تغيّر** في `services/reputation` ولا في `services/orders`. والتغييرُ الوحيدُ خارج حزمةِ الاختبار مَخرجان فرعيّان في `services/reputation/package.json` (`./http` · `./runner`) — لأنّ حرسَ النقاءِ يمنع كلمةَ `runner` في `index.ts`، **فبقي الحدُّ كما هو ولم يُثقَب استثناؤه** (توسيعُ الاستثناءِ كان تضييقَ حدٍّ يحتاج ADR).

**ما تُثبته البوابة:** حزمة `packages/reputation-e2e` ترفع **محرّكَ الطلبِ الحقيقيَّ وخدمةَ السمعة** كمُستمعَينِ حقيقيَّين، فتسوق طلباً عبر HTTP إلى `completed` ثمّ تقرأ **صفَّ صادرِ المحرّك** فتأخذ الحمولةَ **التي أصدرها هو** وتُمرِّرها كما هي إلى `consumeSourceEvent`، ثمّ تقرأ النتيجةَ من `GET /reputation/scores/...` على المِقبض، ثمّ تُصرِّف صفَّ صادرِ السمعة إلى مصرفٍ مُسجِّل. **ولا حمولةَ حدثٍ واحدةً مكتوبةً بيد الاختبار** — وذاك بالضبط ما لا تُثبته الـ282 اختباراً داخل الخدمة (تُثبت أنّ الخدمةَ تفهم العقدَ **كما فهمناه**، لا أنّ العقدَ الذي فهمناه هو الذي يُصدره المحرّك).

**12/12 ناجح**، ومنها: **العميلُ 63 والسائقُ 64** بوزنَي `saudi-launch-v1` · `source_event_id` **يساوي `event_id` الذي أصدره المحرّك** (الشرطُ الملزمُ في 16-ي حرفيّاً) · **لا حدثٌ واحدٌ من دورةِ حياةٍ كاملةٍ يُرفَض** والمقبولُ `unsupported` اثنان فقط فنوعٌ ثالثٌ يُسقط البوابةَ قصداً · إلغاءُ العميل **54** · قبولُ الإسناد **61** · و**الرفضُ حقٌّ لا مخالفة: صفرٌ مُعلَنٌ والنتيجةُ تبقى 60** — «الخدمةُ لا تعاقب أحداً» مقيسةً برقم.

**وساعتان مكتوبتان لا `SystemClock`:** السمعةُ تُذبل بنصفِ عمرٍ 180 يوماً فعمرُ الواقعةِ داخلٌ في النقاط، وساعةُ نظامٍ كانت ستجعل «63 و64» صحيحاً اليومَ وخاطئاً بعد أسابيع بلا أن يلمس أحدٌ سطراً. وترتيبُهما مقصود: ساعةُ سمعةٍ **قبل** الأحداثِ تجعل عمرَ الواقعةِ سالباً فيزن حدثٌ «من المستقبل» أكثرَ من حدثِ اليوم.

**نتيجةٌ موجبةٌ تُسجَّل:** 11 من 12 نجحت في أوّل تشغيل، **ولا حقلَ واحداً عُدِّل** في `parseSourceEvent` ولا في `translate.ts` — لأنّ حرّاسَ الانحرافِ الأحدَ عشرَ في MR 5/6 قرؤوا العقدَ من القرص. والتوكيدُ الوحيدُ الذي سقط أوّلاً كان **عدداً كلّيّاً** لصفوفِ الصادر، **والإصلاحُ في التوكيدِ لا في الكود** (`tier_changed` تُصدَر حين تتغيّر الفئةُ فقط، فعددٌ ثابتٌ كان يُقاس على تفصيلٍ داخليٍّ).

**المقيس محلّيّاً:** المستودعُ كاملاً **2856 ناجحاً · 0 فاشل** · `pnpm -r typecheck` نظيفٌ على **35 مشروعاً** · حرّاسُ الخدمة الأربعة **76/76** (`constraints` 18 · `purity` 15 · `schema-drift` 30 · `http-drift` 13). الوثيقة: [PHASE09_EXIT_GATE_E2E.md](../12-testing/PHASE09_EXIT_GATE_E2E.md).

**الدَّينُ المُعلَنُ المنقولُ من المرحلة (اقرأه قبل أن تبني عليه):**

1. **لا ناقلَ حقيقيّاً بين الخدمتين** — لا مُشترِكٌ يُنادي `consumeSourceEvent` ولا مُجدوِلٌ يُنادي `drainOutbox`. البوابةُ تُثبت **العقدَ** لا وسيطَه، و**قرارُ الناقلِ نفسِه من Phase 11** فلا تختره في مرحلةٍ أخرى بلا ADR.
2. **`PostgresOutboxDrainStore` و`PostgresOutboxDrainRunner` مكتوبان ومُنمَّطان وغيرُ مقيسَين على قاعدةٍ حقيقيّة** — لا Postgres في بيئة التنفيذ. محلُّ القياسِ حزمةُ تكاملِ الخدمةِ بمتغيّر `DATABASE_URL`، ومعه تُضاف وظيفةُ CI.
3. **`FOR UPDATE SKIP LOCKED` لا يُقاس بعاملَين متزامنَين** على مُهيّئِ الذاكرة (عمليّةٌ واحدةٌ بخيطٍ واحد).
4. **البندُ الأحمرُ خارج النطاق ما زال مفتوحاً**: تكامل `services/drivers` على محرّكٍ حقيقيّ (§14).

---

## 17. (تاريخيّ) شروطُ بدء **Phase 10 (Driver Subscription & Referral)** كما كُتبت قبل بدئها — والحالةُ الجاريةُ في §18

> **مَن سيعمل:** Team 03 — Driver (مالك `services/subscriptions/` و`services/referrals/` في [CODEOWNERS](../../CODEOWNERS)) · Team 01 — Identity (مُشارِك في `services/referrals/`) · Team 09 — Data (وقائعُ السمعة مصدرُ التأهيل).
>
> **تصحيحٌ (MR 1/6):** كان هذا السطر يقول «Team 10 — Growth & Monetization»، و`Team 10` في [CODEOWNERS](../../CODEOWNERS) هو **DevOps** ولا وجودَ لفريقٍ بهذا الاسم؛ صُحّح إلى ملّاك الملفات الفعليّين لأنّ فريقاً مُختلَقاً يجعل المراجعة تنتظر من لا يوجد.
> **الحالة عند التسليم:** Phase 09 مغلقة ✅ (§16)، وPhase 10 **Not Started** — لا سطرَ كودٍ لها ولا عقدَ ولا ADR.

**الترتيبُ في [ROADMAP](ROADMAP.md):** المسارُ الحرجُ `00 → 01 → 02 → 04 → 06 → 07 → 09 → 20`، و**Phase 10 ليست عليه** — فهي تالٍ **تعاقبيّ** لا حرجيّ. ومعنى ذلك قرارٌ يملكه صاحبُ المشروع لا المنفّذ: إمّا المضيُّ بالترتيب الرقميّ (10 ثمّ 11 …)، أو الوثبُ على المسارِ الحرجِ نحو **Phase 20 (Saudi Launch Readiness)** وتأجيلُ 10. **لا تختر ضمناً**: البندُ يُحسم بسؤالِ صاحبِ المشروع أو بـADR، لأنّ 20 تعتمد «جميعَ الفرق» فوثبُها يعني إعلانَ نقصٍ صريح.

**اعتماديّاتُ 10 المُعلَنة في ROADMAP:** الطورُ يبني على **05 (Driver Core)** و**01 (Identity)**، وكلاهما مكتمل ✅. فلا حاجزَ تقنيّاً أمام البدء.

**بوابةُ خروج 10 (من ROADMAP حرفيّاً):** «Trial → Active → Expired → Community، والإحالاتُ لا تكافئ النشاطَ المُصطنع». وهي جملتان لا واحدة:

- **الأولى دورةُ حياةِ اشتراك**: أربعُ حالاتٍ بانتقالاتٍ **مُعلَنةٍ في جدول** — لا `if` متفرّقة. والنمطُ المُثبَتُ ستَّ مرّات في هذا المستودع هو `transitionRule` في محرّك الطلب: جدولٌ واحدٌ مصدرُ الحقيقة، والحرسُ يقرؤه من المصدرِ فيسقط يومَ يُضاف انتقالٌ بلا قرار.
- **الثانية دفاعٌ عن اقتصادِ المنصّة**: «لا تكافئ النشاطَ المُصطنع» **قياسٌ لا نيّة**. ومصدرُ الحقيقةِ لهذا القياسِ صار موجوداً: `reputation_facts` دفترُ وقائعٍ حقيقيّ، و`fraud_signals` **إشاراتٌ مُسمّاةٌ لا حُكم**. فالإحالةُ لا تُكافأ على «تسجيلٍ» بل على **وقائعَ مُسجَّلةٍ للمُحال** — وذاك استهلاكٌ من السمعة لا نسخٌ لمنطقِها.

**ابدأ من الحدّ لا من الكود** — النمط الذي أنجح 04 و05 و06 و07 و08 و09 ستَّ مرّات:

1. **ADR-015 يحسم قبل أيّ سطر:** هل الاشتراكُ **خدمةٌ مستقلّة** أم جدولٌ في `services/drivers`؟ ومَن يملك الزمن (انقضاءُ الاشتراكِ حدثٌ زمنيّ، والنمطُ المستقرُّ هنا `POST /<service>/tick` من الخارجِ **بلا مؤقّتٍ داخليّ**)؟ وهل المالُ داخلٌ في المرحلة أم أنّ الفواتيرَ ملكُ **Phase 17 (Billing)**؟ — وهذا الفصلُ الأخيرُ أخطرُ ما في المرحلة: خلطُ مسارِ المال بمسارِ الحالة دَينٌ لا يُسدّ لاحقاً.
2. **عقودٌ كنسيّةٌ أوّلاً** في `services/<subscription>/contracts/*` (مخطّط · مسارات · أحداث · أكواد خطأ) + حزمةُ أنواعٍ بحرّاسِ انحرافٍ تقرأ العقدَ **من القرص**. وهذا ما جعل 11 من 12 اختباراً في بوابةِ 09 تنجح في أوّل تشغيل.
3. **ثمّ الترتيبُ المُثبَتُ ستّ مراجعات:** 1/6 عقود + ADR · 2/6 مجالٌ نقيٌّ بلا I/O · 3/6 استمراريّةٌ على Postgres بوحدةِ عملٍ ومطابقةِ مُهيئَين · 4/6 طبقةُ HTTP فوق `Runner` وحده · 5/6 التكاملُ مع ما يجاورها (السمعةُ والسائق) · 6/6 **بوابةُ الخروجِ في حزمةِ `packages/<phase>-e2e` منفصلة**.
4. **قيودٌ دائمةٌ لا تنتهي بدفعة:** [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md) (الكودُ ووثيقتُه في **نفسِ الدفعة**، والحدُّ الأدنى مُدخَلُ TASK_LOG) · [GIT_RULES](../00-rules/GIT_RULES.md) (فرعٌ `feat/<scope>-<desc>` · رسالةٌ `type(scope): subject` · ثمانيةُ أقسامٍ في وصفِ المراجعة + أحدَ عشرَ بنداً في DoD) · [ENGINEERING_DOCUMENTATION_LAW](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) (**لا «تمّ» بلا دليل**، وأيُّ حزمةٍ جديدةٍ تُبرَّر).
5. **ولا تُعلَن 10 مكتملة** قبل أن تكون بوابتها خضراء، ووثيقتُها في `docs/12-testing/PHASE10_EXIT_GATE_E2E.md`، والإعلانُ في [ROADMAP](ROADMAP.md) و[MASTER_PROGRESS](MASTER_PROGRESS.md) و§18 من هذا الملفّ.

**انحرافٌ تشغيليٌّ مُعلَنٌ سيلقاك:** **حصّةُ دقائقِ CI للمشروع مُستنفَدة** (`ci_quota_exceeded`)، فكلُّ القياسِ في المراجعتَين 5/6 و6/6 من Phase 09 **محلّيٌّ وموثَّقٌ في [TASK_LOG](TASK_LOG.md)** (الرخصةُ ومداها في §2-أ). فإن استُعيدت الحصّةُ، **أوّلُ عملٍ نافعٍ هو تشغيلُ الخطِّ على `main` والتثبيتُ في TASK_LOG** — لا بناءُ مرحلةٍ جديدةٍ على قياسٍ لم يُراجَع آليّاً.

**وما يجب أن تقرأه قبل أن تكتب سطراً:** [ROADMAP §3](ROADMAP.md) (المسار الحرج) · [MASTER_PROGRESS](MASTER_PROGRESS.md) (صفُّ 10: البوابةُ والاعتماديّاتُ والفريق) · §13 من هذا الملفّ (Phase 05 — Driver Core، فهي أرضُ المرحلة) · §16 (Phase 09 ودَينُها، فالإحالاتُ ستستهلك السمعة) · و[ADR-014](../15-decisions/ADR-014-reputation-derived-scores-and-fact-sourced-fraud-signals.md) القرارَ 7: **الخدمةُ لا تعاقب أحداً** — فمنعُ مكافأةٍ ليس عقوبةً، وحجبُ حسابٍ يكون.

---

## 18. Phase 10 (Driver Subscription & Referral) — قيد التنفيذ 🔄 · **MR 3/6 من ستّ مدفوعة** · وما تفعله المراجعةُ التالية بالحرف

> **مَن يعمل:** Team 03 — Driver (مالك `services/subscriptions/` و`services/referrals/` في [CODEOWNERS](../../CODEOWNERS)) · Team 01 — Identity (مُشارِك في `services/referrals/`) · Team 09 — Data (وقائعُ السمعةِ مصدرُ التأهيل) · Team 10 — DevOps (المُهجِّرُ والبيئةُ في MR 3/6).
>
> **المراجعاتُ المدمجة:** MR 1/6 — [!70](https://gitlab.com/uxxxu/wasla/-/merge_requests/70) (commit `7dd64147` · merge `e069d90b`) وتثبيتُ الدليل [!71](https://gitlab.com/uxxxu/wasla/-/merge_requests/71) · **MR 2/6 — [!72](https://gitlab.com/uxxxu/wasla/-/merge_requests/72)** (commit `56d1a6c7` · merge `0f0d0ccc` · 2026-08-24) وتثبيتُ الدليل [!73](https://gitlab.com/uxxxu/wasla/-/merge_requests/73). · **MR 3/6 — [!74](https://gitlab.com/uxxxu/wasla/-/merge_requests/74)** (2026-08-24 · استمراريّةُ Postgres والمُهاجرة).
>
> **الحالة عند هذا التسليم:** العقودُ مجمَّدةٌ (ومُصحَّحةٌ بملحقٍ، انظر 18.3-د) و**طبقةُ المجالِ كاملةٌ ونقيّةٌ** و**طبقةُ الاستمراريّةِ قائمةٌ على محرّكٍ حقيقيّ**: `contracts/schema.sql` **يُطبَّق** فعلاً، وبذرةُ الخطّةِ تُكتب **من `plans.ts`**، والدفترُ **إضافةٌ فقط** بلا `UPDATE` واحدٍ في `src/`. **ولا شبكةَ بعد**: لا Fastify ولا منفذَ 8093 ولا نبضةً ولا صفَّ `subscriptions` مُتحقِّقاً ولا صندوقَ صادر. من يقرأ هذا القسمَ ليعمل: مدخلُك **18.6** (نطاقُ MR 4/6) وقبلَه **18.2** — القواعدُ الأربعُ لا تُنقَض.

### 18.1 ما تمّ في MR 1/6 (وأين يُقرأ)

| ما تمّ | الملف | الرقمُ المُقاس |
|---|---|---|
| قرارُ الحدّ | [ADR-015](../15-decisions/ADR-015-driver-subscription-entitlement-ledger-and-derived-referral-rewards.md) | تسعةُ قراراتٍ مُثبَّتة (+ **ملحقُ المراجعة 2/6**) |
| نموذجُ المجال بالعربية | [DRIVER_SUBSCRIPTION_REFERRAL.md](../03-domain/DRIVER_SUBSCRIPTION_REFERRAL.md) | — |
| المخطَّط | `services/subscriptions/contracts/schema.sql` | عشرةُ جداولَ وقيودٌ مُسمّاةٌ كلُّها |
| الواجهة | `services/subscriptions/contracts/api.openapi.yml` | **أحدَ عشرَ مساراً فريداً · اثنتا عشرةَ عمليّة** · منفذ 8093 |
| الأحداث | `services/subscriptions/contracts/events.json` | ستّةُ أحداثٍ · `additionalProperties:false` |
| الأخطاء | `services/subscriptions/contracts/errors.md` | سبعةَ عشرَ رمزاً في خمسِ فئات |
| حزمةُ الأنواع | `packages/contracts/subscription/` | `@wasla/contracts-subscription` · private |
| حرّاسُ الانحراف | `packages/contracts/subscription/src/__tests__/` | **31/31 ناجح** (كانوا 26؛ +5 في MR 2/6) |
| وثيقةُ الحاويات | [CONTAINERS §4.7](../02-architecture/CONTAINERS.md) | تسعُ حدودٍ محروسة |

### 18.2 القواعدُ الأربعُ التي لا تُنقَض في بقيّةِ الطور

1. **الحالةُ لا تُخزَّن** — تُشتقّ من `subscription_periods` (append-only). لا `UPDATE state`.
2. **التجديدُ ليس انتقالاً** — سبعُ حافّاتٍ فقط في `SUBSCRIPTION_ALLOWED_TRANSITIONS`، **ولا `active → active`**.
3. **لا مالَ في هذا الحدّ** — لا عمودَ ولا حقلَ ولا رمزَ خطأٍ ماليّاً. `payment_reference` **مُعتمٌ** فقط، والمالُ لـ**Phase 17 (الفوترة)**.
4. **`community` أرضيةُ استحقاقٍ لا عقوبة** — ولا اقترانَ لها بـ`suspend`/`block`/`ban`؛ حارسا `boundary.test.ts` و`purity.test.ts` يفشلان إن ظهر.

### 18.3 ما أنجزته MR 2/6 بالضبط — طبقةُ المجالِ النقيّة `@wasla/subscriptions-service`

**أ. الملفّاتُ العشرةُ في `services/subscriptions/src/domain/`** (ولا شيءَ خارجَها):

| الملف | ما يملكه | الحدُّ المحروس |
|---|---|---|
| `contract-sets.ts` | يُعيد تصديرَ مصفوفاتِ العقدِ ويشتقّ منها الاتحادات | لا اتحادَ مكتوبٌ بيدٍ في الخدمة |
| `time.ts` | `addDays` بالميلي-ثانية · `laterOf` · `Clock`/`fixedClock` | لا `Date.now()`؛ الحسابُ **ليس تقويميّاً** فثلاثون يوماً ثلاثون في كلّ شهر |
| `errors.ts` | `SubscriptionError` ورموزُ العقدِ الثمانيةُ المستعملة | لا رمزَ خطأٍ يُخترَع خارجَ `errors.md` |
| `model.ts` | `Period`/`PeriodDraft`/`DerivedSubscription`/`Referral`… | لا حقلَ مالٍ ولا نصَّ حرّ |
| `plans.ts` | `LAUNCH_PLAN` **مُجمَّدٌ عميقاً** · `requireGrantablePlan` (404 ثمّ 422) | أرقامُ الخطّةِ من ثوابتِ العقدِ حرفياً |
| `entitlements.ts` | `effectiveEntitlements(plan, state)` وأرضيّةُ `FLOOR_STATES` | سقفٌ صفرٌ **يُسقط** `accept_orders` بدلاً من إعلانِه بحدٍّ صفر |
| `state.ts` | `coverageRuns` (دمجُ المُدَدِ المتلاصقة) · `deriveState` · `currentCoverageEnd` | `[starts_at, ends_at)` نصفُ مفتوح؛ والمهلةُ تُقاس من **آخرِ نهايةٍ مضت** لا من أبعدِ نهايةٍ في الدفتر |
| `transitions.ts` | `assertTransition` · `reasonForTransition` · `draftTransition` | الجدولُ **مقروءٌ** من الحزمة؛ وحارسٌ يفشل لو ظهر زوجٌ مكتوبٌ بيد |
| `periods.ts` | `draftPeriod`/`draftTrialPeriod`/`draftPaymentPeriod` | دفعٌ بلا مرجعٍ يُرفض، ومرجعٌ على غيرِ دفعٍ يُرفض، والأيّامُ ≥ 1 |
| `referral.ts` | `REFERRAL_REJECTION_ORDER` · `qualifyReferral` · `applyReferralReward` | مُحيلٌ **`active`** لا `trial`؛ والمكافأةُ مرّةٌ واحدةٌ تمتدّ من نهايةِ التغطية |

**ب. القراراتُ الأربعةُ التي اتُّخذت داخلَ التنفيذِ ويجب أن تُعرَف قبل البناءِ عليها:**

1. **الاشتقاقُ يعمل على «سلاسلِ تغطية»** لا على مُدَدٍ منفردة: المُدَدُ المتلاصقةُ أو المتداخلةُ تُدمَج في سلسلةٍ واحدة، فثلاثُ دفعاتٍ متتاليةٍ = حالةٌ واحدةٌ بدايتُها أوّلُ يومٍ ونهايتُها آخرُ يوم. وهذا هو **سببُ** غيابِ `active → active` بنيويّاً لا مجرّدَ منعٍ في جدول.
2. **مدةٌ مدفوعةٌ (أو مكافأةٌ) تُغطّي اللحظةَ تسبق التجربةَ** في تحديدِ الحالة، فسائقٌ دفع داخلَ تجربتِه `active` لا `trial` — ولا يقرّر ذلك ترتيبُ الفرزِ (مُختبَرٌ بالدفترِ نفسِه معكوساً).
3. **`deriveState` تُعيد `null`** لدفترٍ فارغٍ ولا تُعيد `expired`: مَن لم يبدأ لم ينقضِ عنه شيءٌ، ورسالةُ «انقضى اشتراكك» لمن لم يشترك قطُّ خطأٌ يراه السائق.
4. **`reasonForTransition` تشتقُّ السببَ ولا تقبله ممرَّراً**، وترفض `active` بلا مصدرِ مُدّةٍ: تخمينُ «دفع» كان سينسب إلى الدفعِ نموّاً سببُه إحالة.

**ج. الاختباراتُ — 100 ناجحاً في ستّةِ ملفاتٍ** (`purity` 17 · `state` 24 · `referral` 18 · `plans` 13 · `periods` 15 · `transitions` 13):

- **الأزواجُ العشرون كلُّها** (أربعُ حالاتٍ + ∅ × أربع) مُولَّدةٌ ومُختبَرة: **سبعةٌ تُقبَل** و**ثلاثةَ عشرَ تُرفض** برمز `SUBSCRIPTION_TRANSITION_NOT_ALLOWED` — منها `active → active` و`community → expired` و`trial → community`. فاختبارٌ يذكر المسموحَ وحدَه يمرّ على تنفيذٍ يقبل كلَّ شيء.
- **الحدودُ عند الميلي-ثانية**: لحظةُ البدايةِ داخلةٌ، ولحظةُ النهايةِ **خارجةٌ**، وقبلَها بميلي-ثانيةٍ داخلة؛ ومهلةُ سماحٍ **صفراً** تُنزل إلى الأرضيّةِ فوراً وما قبلَها بميلي-ثانيةٍ `active`.
- **أسبابُ رفضِ الإحالةِ الستّةُ** كلٌّ بمُدخلٍ يختلف في **شرطٍ واحدٍ فقط** عن مُدخلٍ يتأهّل، و**الترتيبُ مُثبَتٌ** بحالاتٍ يتصادم فيها سببان (ذاتيةٌ + نافذةٌ منقضية ⇒ `self_referral`).
- **التجميدُ مُختبَرٌ بمحاولةِ تعديلٍ فعليّة** (`readonly` يختفي عند التصريف، فمُنادٍ من JavaScript كان سيغيّر مدّةَ كلّ من اشترك بعده).
- **`purity.test.ts`** يمسح المصدرَ **بعد حذفِ التعليقات** (شرحُ «لا `Date.now()` هنا» كان سيُفشل حارساً يقرأ النثرَ، فيصير أرخصُ إصلاحٍ حذفَ الشرح): يمنع الساعةَ والمؤقّتَ والعشوائيّةَ والشبكةَ و`node:fs` و`process.env` و`pg`/`drizzle`/`fastify` و**كلَّ كلمةِ مالٍ** (`amount`/`currency`/`price`/`invoice`/`refund`/`wallet`/`card`…) وكلَّ كلمةِ عقوبةٍ ونصٍّ حرٍّ واستيرادٍ يعبر حدَّ الحزمة. و**يُثبت موجَباً** أنّ قوائمَ الاستثناءِ **فارغةٌ بالضبط** وأنّ تبعيّاتَ الحزمةِ `["@wasla/contracts-subscription"]` وحدَها — فيومَ تُدخل 3/6 مُهيئَ قاعدةٍ سيفشل **الاختبارُ الموجَب** فلا يمرّ استيرادٌ بلا قرارٍ يُسمّي ملفَّه.

**د. عيبان في عقدِ MR 1/6 صُحّحا، ولم يُبنَ حولَهما كودٌ** (التفصيلُ في **ملحقِ ADR-015 (المراجعة 2/6)**):

1. `subscription_plans` بلا عمودٍ لسقفِ الطلباتِ اليوميّ على الأرضيّة ⇒ أُضيف `community_daily_order_cap` بقيدٍ مُسمّى، وأُلحق بالواجهةِ وبحزمةِ الثوابتِ وبمثالَي الخطّة. لولاه لصار السقفُ رقماً في الكودِ لا في نسخةِ الخطّة، فيتغيّر لكلّ سائقٍ بنشرةٍ واحدةٍ بلا صفٍّ يشرح السبب.
2. `trial_days` و`community_grace_days`: الحدُّ الأدنى في الواجهةِ **1** بينما DDL يسمح بـ**0** ⇒ صار **0** في الاثنَين. تناقضٌ كهذا يعني خطّةً صحيحةً في القاعدةِ تُرفض في الواجهة، وهو خطأٌ لا يظهر إلّا عند أوّلِ خطّةٍ بمهلةِ صفر.
3. وأُعيد توليدُ `api-types.ts` بـ`pnpm run generate` **من الواجهةِ** لا بيد، وأُضيف **خمسةُ حرّاسَ** يُطابقان DDL بالواجهةِ (26 ⇒ **31**).

**المقيسُ محلّيّاً:** المستودعُ كاملاً **2987 ناجحاً · 0 فاشل** (الأساسُ 2882 + 5 حرّاسِ عقدٍ + 100 اختبارَ مجال) · `pnpm -r typecheck` **نظيفٌ على 36 مشروعاً**. **القياسُ محلّيٌّ لا في CI**: حصّةُ الدقائقِ مستنفدةٌ (`ci_quota_exceeded`) — انحرافٌ مُعلَنٌ وفق §2-أ.

### 18.4 ما لم تفعله MR 2/6 بقصد (لا تُعِد بناءه من الصفر)

- لا `package.json` لخدمةٍ ثانيةٍ ولا `services/referrals/src/` — **تبقى `.gitkeep`** (ADR-015 قرار 1).
- لا بُناةَ حمولاتِ أحداثٍ ولا صندوقَ صادر: الأحداثُ الستّةُ في العقدِ تُبنى في **5/6** مع الناشر، وبانيها اليومَ يبنيه على مخزنٍ غيرِ موجود.
- لا `subscription_idempotency` ولا نبضةَ `POST /subscriptions/tick`: النبضةُ **طبقةُ HTTP** (4/6) والمجالُ يُنادى منها لا يملكها.
- لا تحقّقَ من `WASLA_PUBLIC_ID_PATTERN` داخلَ المجال: مِلكُ حدِّ الإدخال (4/6)، وتكرارُه هنا يُنتج حقيقتَينِ للصلاحيّة.

### 18.5 ما أنجزته MR 3/6 بالضبط — طبقةُ الاستمراريّة `services/subscriptions/src/db/`

**النطاقُ الذي كُتب لها في التسليمِ السابقِ نُفِّذ بحرفِه، والبوابةُ الثلاثيّةُ اجتازت:** المخطَّطُ **مُطبَّقٌ فعلاً** على محرّكٍ · صفوفُ الخطّةِ **تُطابق `LAUNCH_PLAN` حقلاً بحقلٍ** باختبارٍ يقرأ الاثنَين · و**لا `UPDATE` واحدٌ** على `subscription_periods`. وفيما يلي ما يحتاجه من يبني على هذا الأساس:

**أ) ستّةُ ملفّاتٍ في `src/db/` وحدٌّ واحدٌ لكلِّ قذارة**

| الملف | مسؤوليّته | ما لا يفعله |
|---|---|---|
| `client.ts` | `createSubscriptionsDb(connectionString)` ⇒ `Pool` + Drizzle | لا يقرأ بيئةً ولا يفتح اتّصالاً عند الاستيراد |
| `schema.ts` | مرآةُ **أربعةِ جداولَ** فقط + `NOT_MIRRORED_TABLES` للستّةِ الباقية | لا يعرّف جدولاً لا تملكه 3/6 |
| `migrate.ts` | `applySubscriptionSchema` تُنفّذ **نصَّ العقد** · `seedPlanVersion`/`seedPlanCatalog` من `plans.ts` | لا `new Date()` ولا `process.env` — `frozenAt` **وسيطٌ** |
| `repository.ts` | `PostgresSubscriptionLedger`: `insertPeriod` · `listPeriods` · `insertTransition` · `toPeriod()` | **لا دالّةَ تعديلٍ ولا حذفٍ**، ولا اشتقاقَ حالةٍ (يبقى في `domain/state.ts`) |
| `migrate-cli.ts` | **القارئُ الوحيدُ** لـ`DATABASE_URL` و`new Date()` | لا منطقَ — يُنادي `migrateSubscriptions` فقط |
| `index.ts` | سطحُ التصدير (`./db`) | لا يستورد `pg` ولا `drizzle` |

**ب) خمسةُ قراراتٍ لا تُنقَض لأنّ اختباراً يحرسها**

1. **الاشتقاقُ مصدرُ حقيقةٍ واحدٌ**: `deriveState` على صفوفٍ **قُرئت من Postgres** يساوي `deriveState` على مسوّداتِ الذاكرة. ترجمةٌ تُخطئ في حقلٍ واحدٍ تسقط هنا.
2. **الإضافةُ فقط**: حارسٌ نصّيٌّ **بلا استثناءٍ واحد** يمنع `.update(` و`.delete(` و`onConflictDoUpdate` و`TRUNCATE` في `src/` كلِّه، ومعه حارسٌ **موجَبٌ** يُثبت أنّ المخزنَ يُضيف ويقرأ فعلاً فلا يمرّ المنعُ على مخزنٍ فارغ.
3. **المحرّكُ يولّد المعرّفاتِ** (`gen_random_uuid()` + `.returning()`) — فبقي `randomUUID` خارجَ `src/`.
4. **ما ليس في `TRANSLATED_CONSTRAINTS` يصعد خاماً**: `constraintOf()` تمشي في سلسلةِ `cause` حتى ثمانيةِ مستوياتٍ لأنّ Drizzle يغلّف خطأَ `pg`؛ ومُختبَرٌ صراحةً بمفتاحٍ أجنبيٍّ مفقودٍ يرفع خطأً **غيرَ** خطأِ مجالٍ ولا يكتب صفّاً.
5. **المرآةُ جزئيّةٌ بقرارٍ**: `subscriptions` و`subscription_idempotency` و`subscription_outbox` وأخواتُها تملكها 4/6 و5/6؛ و`schema-drift.test.ts` يقارن المرآةَ بالعقدِ **في الاتجاهَين** (نوعاً وإلزاماً وأسماءَ قيود) **بلا قاعدةٍ** فيسقط أوّلَ انحراف.

**ج) الأرقامُ المقيسةُ (محلّيّاً · 2026-08-24)**: تكاملٌ **21 ناجحاً** (`migrate.integration` 9 · `ledger.integration` 12) على Postgres حقيقيّ · الحزمةُ السريعةُ للخدمة **116** (كانت 100) · `pnpm -r test` **3003 ناجحاً · 0 فاشل · 181 ملفاً** · `pnpm -r typecheck` نظيفٌ على **36 مشروعاً** · و`db:migrate` طبع `subscriptions schema applied · plan versions seeded: 1`. **وكلُّ رقمٍ هنا محلّيٌّ لا من CI**: الحصّةُ مستنفدةٌ (`ci_quota_exceeded`) — **انحرافٌ مُعلَنٌ** وفق §2-أ، ووظيفةُ `subscriptions-db-integration` مُضافةٌ في `.gitlab-ci.yml` **ولم تركض على المنصّةِ بعد**.

**د) البيئةُ كما شُغِّلت**: لا Postgres نظاميٌّ ولا صلاحيّةَ تثبيتٍ ⇒ **PostgreSQL 18.4 مُدمَجٌ** على المنفذ 55432، بينما CI يستعمل `postgres:15`. لا يُستعمل شيءٌ خاصٌّ بإصدارٍ، وفارقُ الإصدارِ **دَينٌ يُقاس أوّلَ ركضةٍ على المنصّة**.

### 18.6 MR 4/6 — طبقةُ الحالاتِ وHTTP على المنفذ 8093 (النطاقُ بالحرف)

**اكتب في `services/subscriptions/src/{app,http,routes}/` و`src/db/` عندَ الحاجةِ، ولا تلمس `domain/` إلّا بإضافةٍ يبرّرها اختبار:**

1. **صفُّ `subscriptions` المُتحقِّقُ يُبنى من الدفترِ لا يُكتب بيدٍ**: مُشتقٌّ بـ`deriveState` بعد قراءةِ المُدَد. صفٌّ يُحدَّث بحالةٍ يُرسلها العميلُ = مصدرُ حقيقةٍ ثانٍ، وهو نقضُ القرار 2. وهنا **يظهر أوّلُ `UPDATE` مشروعٍ في الطور** — على المؤشِّرِ المُتحقِّقِ **لا على الدفتر**؛ فأضِفه إلى حرّاسِ `purity.test.ts` **باستثناءٍ مُسمّى للملفِّ والجدولِ معاً**، ولا تُوسّع الحارسَ ليُبيح `.update(` عامّاً.
2. **معاملةٌ واحدةٌ (Unit of Work)** تضمّ المُدّةَ والانتقالَ والمؤشِّرَ: اليومَ كلُّ عمليّةٍ صفٌّ واحدٌ فلم تُحتَج؛ ومع 4/6 تُكتب ثلاثةُ صفوفٍ فإمّا تنجح كلُّها أو لا شيء.
3. **`POST /subscriptions/tick`** بساعةٍ **محقونةٍ** من الحدِّ لا مقروءةٍ في المجال، و**التجديدُ يُضيف مُدّةً ولا يكتب انتقالاً** (سبعُ حافّاتٍ فقط — لا `active→active`).
4. **حلقةُ إعادةٍ لتسلسلِ الانتقالات**: الحارسُ اليومَ قيدٌ متفرّدٌ يُنتج خطأً لا صفّاً مكسوراً؛ إعادةُ المحاولةِ عند التزامنِ **مِلكُ 4/6**.
5. **كلُّ عمليّةٍ من الاثنتَي عشرةَ في الواجهةِ المجمَّدةِ لها اختبارُ عقدٍ برموزِ حالتِها**، و`WASLA_PUBLIC_ID_PATTERN` يُتحقَّق **في الحدِّ وحدَه** (لا داخلَ المجال).
6. **ولا مالٌ**: `payment_reference` يبقى **معرّفاً معتماً** يُخزَّن ولا يُفسَّر، ولا مبلغَ ولا عملةَ ولا بوّابةَ دفعٍ في هذا الطور.

**بوابةُ قبولِ MR 4/6:** خدمةٌ ترفع على 8093 · صفُّ `subscriptions` **مُشتقٌّ** ومُختبَرٌ بمساواةِ مؤشِّرِه للاشتقاقِ من الدفتر · معاملةٌ تُثبِتُ الذرّيّةَ بفشلٍ مُصطنعٍ في منتصفِها لا يترك صفّاً · واستثناءُ التعديلِ في `purity.test.ts` **مُسمّى ومحدودٌ بالمؤشِّر**.

### 18.7 بقيّةُ الطريقِ في هذا الطور

| المراجعة | المدى | البوابة |
|---|---|---|
| ~~2/6~~ | ~~طبقةُ مجالٍ نقيّة~~ | ✅ **تمّت** — 100 اختباراً · [!72](https://gitlab.com/uxxxu/wasla/-/merge_requests/72) |
| ~~3/6~~ | ~~استمراريّةُ Postgres + مُهجِّرٌ يُطبّق `schema.sql` ويكتب بذرةَ الخطّة~~ | ✅ **تمّت** — 21 اختبارَ تكاملٍ · [!74](https://gitlab.com/uxxxu/wasla/-/merge_requests/74) · التفصيلُ في 18.5 |
| **4/6** | طبقةُ HTTP على **8093** + `POST /subscriptions/tick` + صفُّ `subscriptions` مُشتقّاً + معاملةٌ واحدة | **النطاقُ بالحرف في 18.6** — كلُّ عمليّةٍ من الاثنتَي عشرةَ لها اختبارُ عقدٍ برموزِ حالتِها |
| 5/6 | مستهلكُ وقائعِ السمعة + ناشرُ الصادر + `subscription_idempotency` | تسليمٌ مرّةً واحدةً مُثبَتٌ (دَينُ MR 1/6، بند 5) |
| 6/6 | **بوابةُ الخروج**: حزمةُ e2e ترفع الخدمةَ **وخدمةَ السمعةِ الحقيقيّةَ** بساعةٍ محقونة | الجملتان تُثبتان لا تُوصفان: الأربعُ حالاتٍ بنبضةٍ حقيقيّة · إحالةٌ لا تُكافأ لأنّ الوقائعَ لم تبلغ الحدَّ |

### 18.8 الدَّينُ المُعلَنُ المنقولُ (اقرأه قبل أن تبني عليه)

1. ~~**لا Postgres في بيئةِ التنفيذ**~~ ✅ **سُدَّ في MR 3/6**: المخطَّطُ مُطبَّقٌ على محرّكٍ حقيقيّ. والباقي منه: **مُدمَجٌ 18.4 محلّيّاً مقابل `postgres:15` في CI** (18.5-د).
2. ~~**بذرةُ الخططِ في الكودِ لا في القاعدة**~~ ✅ **سُدَّ في MR 3/6**: المُهاجرةُ تكتبها **من `plans.ts` نفسِه**، واختبارٌ يقارن الصفَّ المقروءَ بـ`LAUNCH_PLAN` حقلاً بحقل.
3. **الحرّاسُ نصّيّةٌ لا دلاليّة** — تمنع تسريبَ حدٍّ (ساعةٌ · مالٌ · عقوبةٌ · قاعدةٌ)، ولا تُثبت صحّةَ الاشتقاق؛ الاشتقاقُ يُثبته `state.test.ts` وحدَه.
4. **حصّةُ CI مستنفدة** — كلُّ رقمٍ في هذا القسمِ **مقيسٌ محلّيّاً**؛ أوّلُ ما يفعله من يملك الحصّةَ: تشغيلُ pipeline على `main` وتثبيتُ الرقمِ هنا.
5. **البندُ الأحمرُ خارج النطاق ما زال مفتوحاً**: تكامل `services/drivers` على محرّكٍ حقيقيّ (§14).
6. **دَينٌ جديدٌ من MR 3/6 يملكه 4/6**: لا صفَّ `subscriptions` مُتحقِّقاً · لا معاملةَ · لا حلقةَ إعادةٍ لتسلسلِ الانتقالات · و`subscriptions-db-integration` مُضافةٌ ولم تركض (18.5-ج).

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
