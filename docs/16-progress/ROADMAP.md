# ROADMAP — خارطة طريق التنفيذ الزمنية (ملزمة)

> **النوع:** مصدر الحقيقة للتسلسل الزمني للتنفيذ (Binding Execution Roadmap).
>
> **القاعدة الملزمة:** هذا هو المسار الرسمي. أي شخص يعمل في المشروع — مطور أو وكيل آلي — يسير على هذه الوثيقة بترتيبها. لا تبدأ مرحلة قبل اجتياز **Exit Gate** للمرحلة السابقة.
>
> **العلاقة مع [MASTER_PROGRESS.md](MASTER_PROGRESS.md):** هذه الوثيقة = التسلسل والزمن. تلك = لوحة الحالة اللحظية فقط. لا تعارض بينهما؛ التقدم الفعلي يُسجّل هناك، والترتيب يُقرأ من هنا.
>
> **المرجع الأم:** أقسام 71–103 و162 من الدليل التنفيذي (مؤرشف في `docs/99-reference/`).
>
> **الحالة:** Baseline v1.0 · **آخر تحديث:** 2026-08-21 (Phase 06 · MR 6/6 — **المرحلة مكتملة** · البوابة أسقطت عيب ربط الإسناد فصُحّح) · سابقاً 2026-08-21 (Phase 06 · MR 5/6 ثم MR 4/6 ثم MR 3/6) · سابقاً 2026-08-21 (Phase 06 · MR 2/6) · سابقاً 2026-08-20 (بعد دمج [MR !1](https://gitlab.com/uxxxu/wasla/-/merge_requests/1) و[MR !2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2))
>
> **ملاحظة الحالة (2026-08-21، محدّث):** **W0 = 2026-08-20** (اجتازت Phase 00 Exit Gate — CI أخضر على main). **Phase 00 = Completed**، **Phase 01 = Completed** (خدمة Identity: Fastify + Drizzle/Postgres + Exit Gate E2E في CI)، و**Phase 02 = Completed** (خدمة Geography: عقود + ADR-006 + نواة مجردة + Drizzle/Postgres + Saudi seed + Fastify HTTP + وظيفة `geography-db-integration` + [بوابة خروج E2E](../12-testing/PHASE02_EXIT_GATE_E2E.md) تُشغّل identity و geography معاً في CI). **Phase 03 = Completed (2026-08-21)** — سبع مراجعات مدمجة على أساس [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) (القناة طبقة توصيل لا خدمة: `packages/channel-core` محايد + `packages/telegram-adapter` وحده يعرف Bot API + `bots/*` جذور تركيب) و[ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md) (سجل المجموعات منفذاً عاشراً)، و**بوابة الخروج مُثبَتة لا موصوفة**: [PHASE03_EXIT_GATE_E2E.md](../12-testing/PHASE03_EXIT_GATE_E2E.md) — البوتات الثلاثة في عملية واحدة أمام خدمة هوية واحدة على HTTP، كل بوت يفتح Mini App الخاصة به، وشخص واحد = هوية واحدة، والمُهيّئ قابل للاستبدال بـ`MockChannelAdapter`. **Phase 04 (Customer Core) = Completed (2026-08-21)** — ستّ مراجعات مدمجة على أساس [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) (خدمة `services/customers` مستقلّة بانحراف معلَن · ملف العميل **ملفُّ دور** مفتاحه `wasla_public_id` بلا FK · **حدّ تسليم الطلب** عبر `OrderIntakePort` وحده: الخدمة لا تكتب `orders` ولا تُولّد `order_public_id`): MR 1/6 العقود ونموذج المجال · 2/6 طبقة المجال النقيّة (سبعة منافذ + ثماني حالات استخدام) · 3/6 استمرارية Drizzle/Postgres ووظيفة `customer-db-integration` · 4/6 طبقة HTTP على المنفذ 8086 ([CUSTOMER_HTTP.md](../04-api/CUSTOMER_HTTP.md)) · 5/6 ربط بوت العميل بالنواة عبر بذرة محادثة محيّدة ([CUSTOMER_BOT_FLOWS.md](../02-architecture/CUSTOMER_BOT_FLOWS.md)) · و**6/6 بوابة الخروج مُثبَتة لا موصوفة**: [PHASE04_EXIT_GATE_E2E.md](../12-testing/PHASE04_EXIT_GATE_E2E.md) — بوت العميل والنواة في عملية واحدة أمام هوية وجغرافيا على HTTP حقيقي ومحرّك طلبات بديل يرفض أي جسم لا يطابق `OrderIntakeRequest`، فيُثبَت أنّ **طلباً صالحاً يصل إلى المحرّك بحمولته المنشورة**، وأنّ كل مسارات الفشل fail-closed (11/11 بمخازن الذاكرة وعلى Postgres، ووظيفة `customer-exit-gate-e2e` في CI). **Phase 06 (Order Engine) = Completed (2026-08-21)** — ستّ مراجعات مدمجة، والمحرّك البديل في `packages/customer-e2e/src/stub-order-engine.ts` كان مواصفتها التنفيذية فصار المحرّك الحقيقي يجيب مكانه. **MR 1/6 و2/6 و3/6 منجَزة** على أساس [ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md): عقود `services/orders/contracts/*` و`@wasla/contracts-order` و[جدول الانتقالات الكامل](../03-domain/ORDER_ENGINE.md) (72 زوجاً مسموحاً من 441) و[CONTAINERS §4.2](../02-architecture/CONTAINERS.md)؛ ثمّ **طبقة المجال `@wasla/orders-service`** — الاثنان والسبعون صفّاً صريحاً في `domain/state-machine.ts` بحارس مطابقة مزدوج مع الوثيقة في الاتجاهين، و**مسح الـ441 زوجاً منجَز فعلاً في اختبار وحدة** لا مؤجَّلاً إلى بوابة الخروج، و558 اختباراً بلا قاعدة ولا HTTP ([ORDER_CORE_DOMAIN.md](../02-architecture/ORDER_CORE_DOMAIN.md))؛ ثمّ **الاستمرارية Drizzle/Postgres** — مرآة `schema.sql` + `PostgresOrderRepository` و`PostgresOrderOutbox` و`PostgresOrderPublicIdGenerator` + **`PostgresOrderUnitOfWork` يُسدّ دَين الذرّية** ([ADR-010 §127](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md)): معاملة واحدة وسلّم نفس المقبض للمستودع والصادر، فالكتابة الثلاثية (حالة · تدقيق · صادر) ذرّية **بلا تغيير في `src/use-cases/`** · 17 حراسة انحراف + 30 اختبار تكامل (19 مستودع + 4 ذرّية + 7 مطابقة منافذ بصادر حقيقي) · إجمالي المستودع 1323 اختباراً ([ORDER_PERSISTENCE.md](../02-architecture/ORDER_PERSISTENCE.md)). **MR 4/6 منجَزة:** طبقة HTTP على المنفذ **8087** — سبعة مسارات + `/health` بحالتيه، و**`OrderRunner` مقبس معاملة** يجعل كل كتابة داخل وحدة عمل واحدة بلا أن يتذكّرها أي معالج مسار، ونطاق مالك يجيب **404 لا 403** لأن المُعرّف العام تسلسلي، والاستلام **201** جديد و**200** إعادة تشغيل مفتاح، وكتالوجات تعدادات وقت التشغيل ترفض العضو المجهول بـ400 على الحدّ، و`assertNotes` يُصلح تباعداً بين المحوّلين كان يُخرج 503 حيث يجب 400 · 46 اختبار `app.inject` · 621 اختباراً للخدمة ([ORDER_HTTP.md](../04-api/ORDER_HTTP.md)). **MR 5/6 منجَزة:** `HttpOrderIntakePort` الإنتاجي في خدمة العميل يستبدل `UnavailableOrderIntake` وينادي `POST /orders/intake`؛ خريطة الحالات مُصرَّحة (200 نجاح · 409/422 رفض نهائي · 400 خطؤنا لا رفض تجاري · 5xx قابل لإعادة المحاولة بنفس المفتاح · مهلة = `TIMEOUT` مُسجَّل)، ومفتاح التكرار و`x-request-id` يمرّان كما هما، و`/health` عند خدمة العميل صار **`ok` لأول مرة** · 17 اختباراً على مُنصت حقيقي + تسليم فعلي بين خدمتين تعملان ([ORDER_INTAKE_HANDOVER.md](../04-api/ORDER_INTAKE_HANDOVER.md)). **MR 6/6 منجَزة — بوابة الخروج مُثبَتة لا موصوفة**: [PHASE06_EXIT_GATE_E2E.md](../12-testing/PHASE06_EXIT_GATE_E2E.md) ([!43](https://gitlab.com/uxxxu/wasla/-/merge_requests/43)) — حزمة `@wasla/order-e2e` تُشغّل هوية وجغرافيا ونواة عميل ومحرّك طلبات كأربعة مُنصتات حقيقية، والتسليم بينها **بالمحوّل الإنتاجي نفسه** لا بنسخة منه، فيُقاد الطلب عبر HTTP من `published` إلى `completed` بسجلّ تدقيق كامل مرتّب، ثمّ **يُمسح فضاء الانتقالات كاملاً فوق HTTP: 441 زوجاً — 72 تنجح و369 تُرفض بـ`ORDER_ILLEGAL_TRANSITION` والحالة لا تتغيّر**، ويُحرَس انزلاق الحدّ بقراءة قائمة `required` من ملف العقد وقت التشغيل — 16/16 بمخزن ذاكرة وعلى Postgres (وظيفة `order-exit-gate-e2e`)، وإجمالي المستودع **1402 اختباراً**. **المرحلة الحالية: Phase 07 (Dispatch & Matching MVP) — قيد التنفيذ: MR 1/6 مدمجة ([!44](https://gitlab.com/uxxxu/wasla/-/merge_requests/44)): [ADR-011](../15-decisions/ADR-011-matching-dispatch-separation-candidate-source-and-tick-driven-time.md) يحسم أربعة أسئلة كانت مفتوحة — **خدمتان لا واحدة** (`services/matching` :8088 دالّة «من يصلح؟» · `services/dispatch` :8089 مهمّة «من يأخذه الآن؟»، والمحرّك لا يعرف أنّ التوزيع موجود) · **مصدر المرشّحين** إسقاط `driver_candidacy` مفتاحه `driver_public_id` بلا FK والأهليّة فيه **مُدّعاة ومصدر الادّعاء مخزّن**، والمجهول ليس مرشّحاً (fail-closed) فلا تنتظر Phase 05 · **الزمن نبضة لا مؤقّت**: كل استحقاق في القاعدة و`POST /dispatch/tick` هو الموضع المُعلَن الوحيد لتقديمه، فإعادة التشغيل لا تُفقد مهلة والاختبار يُقدّم الساعة بلا انتظار · **الأوزان بيانات بنسخة مُقفَلة** مجموعها 100 بقيد في القاعدة، وصفر ETA والمسافة والتقييم **صفرٌ مُعلَن** لا إغفال، وحسم التعادل مُصرَّح. وسُلّمت العقود الكنسية للخدمتين و`@wasla/contracts-matching` و`@wasla/contracts-dispatch` بـ46 حارس انحراف و[نموذج المجال](../03-domain/MATCHING_DISPATCH.md) و[CONTAINERS §4.3](../02-architecture/CONTAINERS.md) — إجمالي المستودع 1448 اختباراً** — الإسنادات في بوابة المرحلة 06 مُسجَّلة بالشكل نفسه الذي يجب أن تُنتجه المطابقة، فالمحرّك **يسجّل الإسناد ولا يقرّره** ([ADR-010](../15-decisions/ADR-010-order-engine-state-machine-and-assignment-boundary.md)): المطابقة تنادي `POST /orders/{id}/assignments` ثمّ `PATCH …/{assignmentId}` ولا تكتب حالة الطلب بنفسها. **وترتيب المسار لم يُخترق: Phase 06 تسبق Phase 05 عن قصد وبقرار موثّق** — `driver_public_id` مرجع opaque بلا FK، فالمحرّك لا يحتاج جدول سائقين ليعمل، وPhase 05 (Driver Core) تبقى خارج المسار الحرج `00 → 01 → 02 → 04 → 06 → 07 → 09 → 20` كما هي في §3 أدناه. لا تعديل على الترتيب ⇒ لا ADR ترتيب مطلوب (§7). **المُنقَل إلى Phase 09:** ذرّية كتابة الصفّ ونشر الحدث + ناشر `customer_outbox` + مُشغّل دوري لـ`retryDueDeliveries` (دَين المرحلة 03). **المُنقَل إلى Phase 11:** إنشاء الطلب وحفظ مكان من التطبيق المصغّر — [HANDOFF §9](HANDOFF_NEXT_STEPS.md).** Timeline أدناه نسبية إلى W0 (المُعتمد).

---

## 1. مبدأ الزمن النسبي (يمنع تقادم الوثيقة)

```text
W0 = اليوم الذي تجتاز فيه Phase 00 Exit Gate — وليس يوم إنشاء المستودع.
```

كل المدد أدناه **نسبية إلى W0**. لا تواريخ ثابتة مقفلة. الأسبوع الزمني تقديري لتخطيط الفريق، لكن:

> **الانتقال الفعلي بين المراحل لا يتم بالوقت، بل باجتياز Exit Gate.**
> إذا لم يُجتز الـ Exit Gate، يبقى النظام في المرحلة رغم انتهاء الأسبوع المقدر.

---

## 2. الخط الزمني الكلي (Baseline v1.0)

```text
┌──────────── الجذر الأساسي ────────────┐
│ W0  – W1   : Phase 00 — Repository Foundation
├────────── الهوية والأساس ────────────┤
│ W1  – W6   : Phases 01–03 — Identity, Geography, Telegram Foundation
├────────── المحرك التشغيلي ──────────┤
│ W6  – W15  : Phases 04–10 — Customer, Driver, Order, Dispatch, Matching, Reputation, Subscription
├────────── النظام التجاري ───────────┤
│ W16 – W26  : Phases 11–17 — Marketplace, Search, Store Orders, Partner, Admin, Support, Billing
├────────── الجاهزية للإطلاق ──────────┤
│ W26 – W30  : Phases 18–20 — Observability, Security, Saudi Launch Readiness
│            ★ MILESTONE: SAUDI LAUNCH (نهاية ~W30)
├────────── ما بعد الإطلاق ───────────┤
│ W30+       : Phases 21–24 — Regional, Global, Channel Independence, Service Extraction
└──────────────────────────────────────┘
```

---

## 3. جدول المراحل بالتفصيل

| Phase | العنوان | Start (نسبية) | المدة المقدرة | يعتمد على | Owner Teams | Exit Gate (ملخص) |
|---|---|---|---|---|---|---|
| 00 | Repository Foundation | W0 | ~1 أسبوع | — | جميع الفرق | CI passes، لا أسرار، Docs structure، main محمي، MR template |
| 01 | Identity Foundation | W1 | ~2 أسبوعين | 00 Exit Gate | 01,09,10,11,12 | هوية مستقرة عبر تغيير Username |
| 02 | Geography & Localization | W3 | ~2 أسبوعين | 00 + (01 جزئياً) | 01,02,03,06,07,08,09 | تغيير الموقع دون حساب جديد + i18n (AR/EN/UR) |
| 03 | Telegram Channel Foundation | W4 | ~2 أسبوعين | 00 + 01 | 12,01,02,03,07 | كل Bot يفتح Mini App + Adapter قابل للاستبدال بـMock |
| 04 | Customer Core | W6 | ~2 أسبوعين | 01,02,03 | 02,01,11,12 | عميل ينشئ Order صالحاً يصل لـ Order Engine |
| 05 | Driver Core | W6 | ~2 أسبوعين (توازٍ مع 04) | 01,02,03 | 03,01,11,12,09 | Driver profile قابل للإدخال في Candidate pool |
| 06 | Order Engine | W8 | ~3 أسابيع | 04,05 | 02,03,04,05,09,11 | Order + State machine بلا حالات مستحيلة + Outbox + Audit |
| 07 | Dispatch & Matching MVP | W11 | ~3 أسابيع | 06 | 04,05,03,02,09,11 | Customer → Driver assignment في بيئة اختبار — **قيد التنفيذ (MR 1/6 و2/6 مدمجتان: العقود ثمّ مجال المطابقة النقي · المتبقّي 3/6 استمرارية المطابقة · 4/6 مجال التوزيع · 5/6 HTTP · 6/6 البوابة)** |
| 08 | Negotiation & Chat | W13 | ~2 أسبوعين | 07 | 02,03,12,09,11 | تفاوض + توافق على السعر + تسجيله في Order |
| 09 | Reputation + Fraud | W14 | ~2 أسبوعين | 07,08 | 01,04,05,08,09,11 | كل Completed Order ينتج Reputation events |
| 10 | Driver Subscription & Referral | W15 | ~2 أسبوعين | 05,09 | 03,01,09,12,08,11 | Trial→Active→Expired→Community + إحالات بلا نشاط وهمي |
| 11 | Marketplace Foundation | W16 | ~3 أسابيع | 01,07 | 06,01,07,02,03,09,11 | مستخدم قائم ينشئ Store + منتج + طلب مراجعة |
| 12 | Marketplace Search | W18 | ~2 أسبوعين | 11 | 06,09,12,11 | منتج يُعثر عليه بالعربي والإنجليزي + جاهز للغات |
| 13 | Store Orders + Delivery | W19 | ~3 أسابيع | 11,12,07 | 06,05,04,03,02,07 | شراء→تجهيز→إسناد→Pickup→Delivery→Completion |
| 14 | Partner / Enterprise | W21 | ~3 أسابيع | 07,13 | 07,06,05,04,12,11 | Partner ينشئ طلباً عبر Portal/API وتتبع حالته |
| 15 | Admin Operations | W23 | ~2 أسبوعين | 14,11 | 08,01,03,04,05,06,07,11 | الإدارة تشغّل اليوميات دون تعديل DB يدوي |
| 16 | Support & Escalation | W24 | ~2 أسبوعين | 15 | 08,02,03,11,12 | نزاع كامل → Support → Escalation → Resolution → Reputation |
| 17 | Billing & Store Fees | W25 | ~2 أسبوعين | 16,10 | 09,12,07,06,08,11 | Billing قابل للتدقيق بلا خلط مع Trip Settlement |
| 18 | Observability & Resilience | W26 | ~2 أسبوعين | 17 | 10,11,09,12 | تعطيل خدمة ثانوية بلا إسقاط Core + استعادة وفق RTO/RPO |
| 19 | Security Hardening | W27 | ~2 أسبوعين | 18 | 11,10,01,12 | لا ثغرات حرجة + الأسرار خارج Git + Production access مضبوط |
| 20 | **Saudi Launch Readiness** | W28 | ~2 أسبوعين | 19 | جميع الفرق | E2E + Load + DR + Runbooks + Docs complete |
|  | ★ **MILESTONE: SAUDI LAUNCH** | ~W30 | — | 20 Exit Gate | — | دخول الإنتاج |
| 21 | Gulf/Egypt/Jordan Expansion | W30+ | ~4 أسابيع | 20 | جميع الفرق حسب المجال | Configuration لكل دولة بلا تعديل Core |
| 22 | Global Expansion | W33+ | ~4 أسابيع | 21 | جميع الفرق | Country Packs + adapters محلية |
| 23 | Channel Independence | W36+ | ~3 أسابيع | 22 | 12 + جميع الفرق | Core يعمل عبر Telegram/Web/Mobile |
| 24 | Service Extraction | W38+ | مستمر | 23 | حسب الخدمة | فصل Microservices عند سبب واضح + ADR |

---

## 4. المسار الحرج (Critical Path)

المسار الذي لا يمكن تأخيره دون تأخير الإطلاق:

```text
Phase 00 → 01 → 02 → 04 → 06 → 07 → 09 → 20 (Launch)
```

المراحل **خارج** المسار الحرج يمكن تأخيرها أو إعادة ترتيبها دون تهديد موعد الإطلاق، شأن يعامل عبر ADR.

---

## 5. فرص التوازي (Parallelization)

| المجموعة | المراحل | ملاحظة |
|---|---|---|
| الأساس | 01 + 02 | 02 يبدأ بعد الجزء الأول من 01 (Identity link جاهز). |
| الكور | 04 + 05 | Driver و Customer يعملان بالتوازي بعد 01/02/03. |
| التجاري | 11 + 12 | Search يبدأ بعد أن يكون Catalog جاهزاً من 11. |
| الجاهزية | 18 + 19 | Observability و Security يعملان بالتوازي بعد 17. |

التوازي مُجدول ضمن المدة المقدرة للمجموعة، لا يضيف أسابيع منفصلة.

---

## 6. المعالم (Milestones)

| المعلم | عند | المعنى |
|---|---|---|
| M0 — Foundation Ready | نهاية W1 | المستودع جاهز، CI يعمل، الفرق تستطيع البناء. |
| M1 — Identity Stable | نهاية W3 | المستخدم يُنشأ من Telegram ويبقى مستقراً. |
| M2 — Order Lifecycle | نهاية W10 | Order يتحرك عبر الحالات بلا حالات مستحيلة. |
| M3 — End-to-End Dispatch | نهاية W13 | طلب كامل من عميل إلى إسناد سائق. |
| **M4 — SAUDI LAUNCH** | ~W30 | دخول الإنتاج السعودي. |
| M5 — Regional Expansion | W30+ | الخليج + مصر + الأردن. |
| M6 — Channel Independence | W36+ | Core يعمل عبر قنوات متعددة. |

---

## 7. قاعدة تعديل الخارطة (Roadmap Change Log)

الخارطة ليست «وثيقة تجميد». عند تغيير الترتيب أو المدد أو إدخال مرحلة جديدة:

```text
القرار القديم
    ↓
ADR (docs/15-decisions/)
    ↓
تحديث ROADMAP.md + تسجيل التغيير في سجل التعديلات أدناه
    ↓
تحليل الأثر (Impact Analysis)
    ↓
خطة الانتقال (Migration Plan)
```

**لا تُغيَّر المدد أو الترتيب بلا ADR.** التعديلات المباشرة للجدول دون ADR تعتبر مخالفة.

---

## 8. سجل تعديل الخارطة

| الإصدار | التاريخ | التغيير | المرجع |
|---|---|---|---|
| v1.0 | 2026-08-19 | إنشاء خارطة الطريق الأساسية (Baseline) من أقسام 71–103 | [TASK_LOG](TASK_LOG.md) |

---

## 9. ملخص

> **الزمن تقديري للتخطيط. الانتقال الفعلي يتم باجتياز Exit Gate لا بالوقت.** أي تعديل في الترتيب أو المدد يجب أن يمرّ عبر ADR. وهذا التعديل نفسه — كونه مسّ مسار `docs/` و `scripts/` — رافقه إدخال في [TASK_LOG.md](TASK_LOG.md) والتزاماً بقاعدة [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md).
