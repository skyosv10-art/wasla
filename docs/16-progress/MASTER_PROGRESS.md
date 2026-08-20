# MASTER_PROGRESS — لوحة تقدم المراحل

> **النطاق:** حالة جميع المراحل Phase 00 → Phase 24 (المراحل 71-103 + المراحل الفرعية في الدليل التنفيذي).
>
> **المرجع الأم:** أقسام 71-103 من الدليل التنفيذي + القسم 106 (Progress Ledger).
>
> **Last Updated:** 2026-08-21 (Phase 03 مغلقة باجتياز بوابة الخروج في MR 7/7 — المرحلة الحالية صارت Phase 04 · Customer Core) · **Status:** Active · **Related Team:** جميع الفرق (كل فريق يحدّث حالة مرحلته)
>
> **القاعدة:** لا يسمح بعبارة «Done» بدون **Evidence** (رابط MR، نتائج اختبار، لقطة).
>
> **هذه الوثيقة = لوحة الحالة اللحظية فقط.** التسلسل والزمن ومسار التنفيذ الرسمي يعيش في [ROADMAP.md](ROADMAP.md). لا تعارض بينهما: التقدم يُسجّل هنا، والترتيب يُقرأ من هناك. أي تغيير في الترتيب يتطلب ADR (انظر قسم 7 في ROADMAP).

---

## كيفية التحديث

لكل مرحلة، يحدّث الفريق المسؤول الحقول التالية عند كل تغيير:

```text
Phase
Status
Exit Gate
Teams
Open Blockers
Last Update
Evidence
Next Step
```

الانتقال بين المراحل يتم فقط بعد اجتياز **Exit Gate** (اختبارات + وثائق + أمان + تكامل). لا يتم الانتقال لمجرد انتهاء البرمجة.

### قيم Status المعتمدة

```text
Not Started
In Progress
Blocked
Exit Gate Pending
Completed
```

---

## لوحة المراحل

| Phase | العنوان | Status | Exit Gate | Owner Teams | Open Blockers | Last Update | Evidence | Next Step |
|---|---|---|---|---|---|---|---|---|
| 00 | Repository Foundation | **Completed (W0: 2026-08-20)** — Exit Gate اجتاز | CI passes ✅ (main pipeline 2776059637)، لا أسرار، جميع الفرق clone/build/test، Docs structure، Main branch protected، MR template active | جميع الفرق (Team 10 CI، Team 11 gates، Team 12 Telegram skeleton، Team 09 DB conventions) | **لا عوائق.** shared runners مُفعّلة (تحقّق المالك من namespace). build-test CI صُلح عبر [MR !9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9) (إضافة `@types/node`) ودُمج. pipeline على `main` يجتاز بالكامل (build-test + markdown-lint + repo-structure ✅). **تفاصيل التسليم: [HANDOFF_NEXT_STEPS.md](HANDOFF_NEXT_STEPS.md)** | 2026-08-20 | **[MR !1](https://gitlab.com/uxxxu/wasla/-/merge_requests/1) + [MR !3](https://gitlab.com/uxxxu/wasla/-/merge_requests/3) + [MR !4](https://gitlab.com/uxxxu/wasla/-/merge_requests/4) + [MR !9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9) مدمجة** — بنية المستودع + القوانين + قالب MR + حماية main + فحص أسرار + doc-coverage + أساس بناء (pnpm+TS+Vitest) عبر [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) مع job `build-test` في CI + إصلاح `@types/node`. pipeline على main: نجاح كامل. | **بدء Phase 01**: تنفيذ خدمة Identity وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) عبر MRs مستقلة (إضافة اعتماديات + تنفيذ ضد العقود/الأنواع + Wasla Public ID + outbox + Contract tests) |
| 01 | Identity Foundation | **Completed (W0: 2026-08-20)** — Exit Gate اجتاز | مستخدم Telegram يُنشأ، تتغيّر Username، تبقى الهوية/Public ID/internal_uuid مستقرة، ويسجّل التاريخ/outbox | 01, 09, 10, 11, 12 | **لا عوائق.** Exit Gate مُتحقَّق عبر اختبار E2E في CI (job `db-integration` ضد postgres:15). | 2026-08-20 | عقود ([MR !2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2)) + `@wasla/contracts-identity` (13) + [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) + MR 1 ([!11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11): نواة 15) + MR 2 ([!12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12): Drizzle/Postgres + 3 تكامل) + MR 3 ([!13](https://gitlab.com/uxxxu/wasla/-/merge_requests/13): Fastify HTTP + 9) + MR 4 ([!14](https://gitlab.com/uxxxu/wasla/-/merge_requests/14): CI `db-integration` + postgres service) + **MR 5 ([!15](https://gitlab.com/uxxxu/wasla/-/merge_requests/15): Exit Gate E2E — 2 اختبار)**. 24 وحدة + 3 تكامل + 2 E2E. | بدء Phase 02 (Geography & Localization) |
| 02 | Geography & Localization Foundation | **Completed (2026-08-20)** — Exit Gate اجتاز: عقود + ADR-006 (!17) + النواة المجردة (!18) + Drizzle/Postgres + Saudi seed (!19) + طبقة HTTP (!20) + تكامل CI لقاعدة البيانات (!21) + Exit Gate E2E (!22) | المستخدم يغيّر موقعه دون حساب جديد، وكل Module يستعمل Geo IDs | 01, 02, 03, 06, 07, 08, 09 | **لا عوائق.** بوابة الخروج مُتحقَّقة باختبار E2E في CI (وظيفة `geography-db-integration` ضد postgres:15) يُشغّل الخدمتين معاً كما في الإنتاج: خدمة Identity تستمع على منفذ حقيقي وخدمة Geography تسألها عبر `HttpIdentityLookupPort` — تغيير الموقع مرتين دون إنشاء حساب ثانٍ، ثبات `wasla_public_id`/`internal_uuid`، `history` + `outbox`، وأسماء مترجمة ar/en/ur مع الرجوع إلى ar. إجمالاً 96 اختبار وحدة (41 geography) + 4 تكامل + 3 E2E. | 2026-08-20 | [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md) + `@wasla/contracts-geography` (15) + [MR !17](https://gitlab.com/uxxxu/wasla/-/merge_requests/17) (عقود) + `@wasla/geography-service` pure core (25 اختباراً) + [MR !18](https://gitlab.com/uxxxu/wasla/-/merge_requests/18) (domain/ports/in-memory/use-cases/locale fallback) + [MR !19](https://gitlab.com/uxxxu/wasla/-/merge_requests/19) (Drizzle/Postgres + Saudi seed + 4 تكامل) + [MR !20](https://gitlab.com/uxxxu/wasla/-/merge_requests/20) (Fastify HTTP + تعيين الأخطاء + 16 اختبار app.inject) + [MR !21](https://gitlab.com/uxxxu/wasla/-/merge_requests/21) (وظيفة geography-db-integration في CI). + **MR 7 ([!22](https://gitlab.com/uxxxu/wasla/-/merge_requests/22): بوابة الخروج E2E — 3 اختبارات تجمع identity + geography)** | بدء Phase 03 (Telegram Channel Foundation)
| 03 | Telegram Channel Foundation | **Completed (2026-08-21)** — Exit Gate اجتاز · MR 7/7: [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) + عقود القناة + `@wasla/contracts-channel` (!23) + نواة `@wasla/channel-core` المحايدة (!24) + مُهيّئ `@wasla/telegram-adapter` (!25) + طبقة تشغيل البوتات `@wasla/bot-runtime` والبوتات الثلاثة (!27) + مُهيّئات Postgres `@wasla/channel-postgres` ووظيفة `channel-db-integration` (!28) + مُهيّئ المجموعات وسجلّها منفذاً عاشراً بـ[ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md) ([!29](https://gitlab.com/uxxxu/wasla/-/merge_requests/29)) | كل Bot يفتح Mini App، وAdapter قابل للاستبدال بـMock | 12, 01, 02, 03, 07 | **لا عوائق.** القناة طبقة توصيل لا خدمة (`packages/channel-core` محايد + `packages/telegram-adapter` وحده يعرف Bot API + `bots/*` جذور تركيب). المنافذ **العشرة** قائمة و`MockChannelAdapter` مُنفَّذ، والمُهيّئ الحقيقي صار قابلاً للتشغيل داخل حالات استخدام النواة (8 اختبارات مطابقة منافذ في MR 3) — أي نصف بوابة الخروج (استبدال المُهيّئ) صار مُبرهناً على مستوى الحزمة. وبعد MR 4 صار **الشطر الثاني من بوابة الخروج قابلاً للتشغيل**: ثلاثة تطبيقات قابلة للنشر (8083/8084/8085) كل واحد يخدم بوته ويفتح Mini App الخاصة به ويرفض البوتين الآخرين بـ404، والسلوك كلّه في حزمة واحدة `@wasla/bot-runtime` (بوت واحد ⇄ Mini App واحدة مفروضة في مكان واحد) — يبقى E2E الجامع في MR 7. وبعد MR 5 صار **التخزين دائماً**: مُهيّئات Postgres للمنافذ الثلاثة تُركّب عند وجود `DATABASE_URL` (ومجموعة الذاكرة بغيابه للتشغيل المحلي)، فمنع التكرار وطابور إعادة المحاولة يعبران إعادة التشغيل — مُثبَت بـ**21 اختبار تكامل** على Postgres حقيقي منها 6 اختبارات مطابقة منافذ تقارن المجموعتين داخل حالات الاستخدام نفسها. وبعد MR 6 صارت **المجموعات مدعومة داخل نفس المنافذ** لا في مسار مُوازٍ: سجل مجموعات منفذاً عاشراً يقرأ الغرف من البيئة (دعم/تصعيد/مجتمع)، ولا تهيئة هوية من غرفة (المرجع مشترك)، ولا زر Mini App نحو غرفة بل رابط عميق يفتح المحادثة الخاصة، وصمت تام في غرفة غير مُعلَنة مع تسجيلها و202 — وأحداث العضوية صارت `group_event` بدل 422. و**بوابة الخروج نفسها صارت مُثبَتة في MR 7** لا موصوفة: حزمة اختبار بحتة `@wasla/channel-e2e` تبني البوتات الثلاثة في عملية واحدة أمام **خدمة هوية واحدة تستمع فعلياً على HTTP** ومخازن قناة مشتركة، فتُقاس الأخطاء التي لا يراها اختبار بوت واحد: كل بوت يُجيب `/start` بزرّ Mini App **الخاص به** (customer→customer · driver→driver · partner→partner) وبأثر `channel.mini_app.launched` منسوب إليه · شخص واحد عبر البوتات الثلاثة = **هوية واحدة** (`created: false` و`identity.created` مرّة واحدة) · التحديث المُعاد **لا يُعالَج مرّتين** (202 `duplicate`) ومنع التكرار **مقيَّد بالبوت** لا بالرقم · و`MockChannelAdapter` **تجاوزٌ لافتراض حقيقي** هو `TelegramChannelAdapter` لا مسارٌ وحيد. والبوابة غير قابلة للتخطّي: تعمل بمخازن الذاكرة في كل `pnpm -r test` وبـPostgres في وظيفة `channel-exit-gate-e2e`، وفحص طفرة أسقط 4 من 8 اختبارات عند كسر اشتقاق Mini App ([تفصيل](../12-testing/PHASE03_EXIT_GATE_E2E.md)). إجمالاً 445 اختبار وحدة + 25 تكامل + 8 بوابة خروج القناة. **يُنقَل إلى Phase 04**: مُشغّل دوري لـ`retryDueDeliveries` وناشر لصندوق الصادر (موثّقان في [CHANNEL_PERSISTENCE.md §7](../02-architecture/CHANNEL_PERSISTENCE.md)) وسياسة استبقاء لـ`channel_updates`. | 2026-08-20 | [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) + `packages/channel-core/contracts/` (api.openapi.yml + events.json + schema.sql + errors.md) + `@wasla/contracts-channel` (34 اختباراً) + [MR !23](https://gitlab.com/uxxxu/wasla/-/merge_requests/23) + **MR 2 ([!24](https://gitlab.com/uxxxu/wasla/-/merge_requests/24): نموذج المجال + المنافذ التسعة + 4 حالات استخدام + مُهيّئات in-memory/Mock + 84 اختباراً منها 38 اختبار حراسة معماري — إجمالي المستودع 214 اختبار وحدة)** + [CHANNEL_LAYER_CORE.md](../02-architecture/CHANNEL_LAYER_CORE.md) + **MR 3 ([!25](https://gitlab.com/uxxxu/wasla/-/merge_requests/25): `@wasla/telegram-adapter` — TelegramUpdateParser + TelegramChannelAdapter + عميل Bot API + أزرار `web_app` + تخطيط أخطاء Bot API مع `retry_after` + ميزانية معدّل لا تنام + التحقّق من رمز الـwebhook · 86 اختباراً منها 8 مطابقة منافذ — إجمالي المستودع 300 اختبار وحدة)** + [CHANNEL_TELEGRAM_ADAPTER.md](../02-architecture/CHANNEL_TELEGRAM_ADAPTER.md) + **MR 4 ([!27](https://gitlab.com/uxxxu/wasla/-/merge_requests/27): `@wasla/bot-runtime` — سطح HTTP لعقد القناة على Fastify + تهيئة من البيئة بفشل سريع + `SingleBotRegistry` + مُهيّئ الهوية عبر HTTP + التركيب؛ و`bots/{customer,driver,partner}-bot` جذور تسمّي بوتها فقط · 76 اختباراً — إجمالي المستودع 376 اختبار وحدة)** + [CHANNEL_BOTS.md](../02-architecture/CHANNEL_BOTS.md) + **MR 5 ([!28](https://gitlab.com/uxxxu/wasla/-/merge_requests/28): `@wasla/channel-postgres` — مرآة Drizzle لـ`schema.sql` مع اختبار حراسة انحراف + منع تكرار ذرّي بـ`ON CONFLICT DO NOTHING … RETURNING` + تسليم idempotent وطابور استحقاق مُرتّب في SQL + صندوق صادر بمفتاح `event_id` + `createChannelStores` مربوطاً في `buildBotRuntime` و`onClose` · 30 اختباراً جديداً + وظيفة `channel-db-integration`)** + [CHANNEL_PERSISTENCE.md](../02-architecture/CHANNEL_PERSISTENCE.md) + **MR 6 ([!29](https://gitlab.com/uxxxu/wasla/-/merge_requests/29): `GroupRegistryPort` منفذاً عاشراً من الإعداد + `ConversationScope`/`GroupRole`/`GroupPresence` + قصر تهيئة الهوية على المحادثات الخاصة + رفض سطح التشغيل نحو غرفة من طبقتين + تحليل `my_chat_member`/`chat_member` إلى `group_event` + ثلاثة متغيّرات بيئة للغرف + ردّ مجموعة برابط عميق وصمت في الغرفة المجهولة · 45 اختباراً جديداً — إجمالي المستودع 438 اختبار وحدة)** + [ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md) + [CHANNEL_GROUPS.md](../02-architecture/CHANNEL_GROUPS.md)  + **MR 7 ([!MR7](https://gitlab.com/uxxxu/wasla/-/merge_requests/MR7): `@wasla/channel-e2e` — بوابة خروج المرحلة E2E بثمانية اختبارات + وظيفة `channel-exit-gate-e2e` في CI + [وثيقة البوابة](../12-testing/PHASE03_EXIT_GATE_E2E.md) · صفر تغيير في كود الإنتاج)** | بدء Phase 04 (Customer Core) |
| 04 | Customer Core | Not Started — **المرحلة الحالية بعد إغلاق Phase 03** | عميل ينشئ Order صالحًا ويصل إلى Order Engine دون Matching فعلي | 02, 01, 11, 12 | — | — | — | Customer profile + Create ride/delivery request |
| 05 | Driver Core | Not Started | Driver profile مكتمل قابل للإدخال في Candidate pool | 03, 01, 11, 12, 09 | — | — | — | Registration + Documents + Trial subscription + States |
| 06 | Order Engine | Not Started | إنشاء Order وتغييره عبر الحالة دون حالات مستحيلة | 02, 03, 04, 05, 09, 11 | — | — | — | State machine + Idempotency + Outbox + Audit |
| 07 | Dispatch & Matching MVP | Not Started | Request كامل من Customer إلى Driver assignment في بيئة اختبار | 04, 05, 03, 02, 09, 11 | — | — | — | Candidate filtering + Ranking + Dispatch waves + Community fallback |
| 08 | Negotiation & Chat | Not Started | عميل وسائق يمكنهما التفاوض والتوافق على السعر وتسجيله في Order | 02, 03, 12, 09, 11 | — | — | — | Conversation + Countdown + Translation |
| 09 | Reputation + Fraud Foundation | Not Started | كل Completed Order ينتج Reputation events، والدعم يراجع التغير | 01, 04, 05, 08, 09, 11 | — | — | — | Ratings + Score + Fraud signals + Moderation |
| 10 | Driver Subscription & Referral | Not Started | Trial → Active → Expired → Community، والإحالات لا تكافئ النشاط الوهمي | 03, 01, 09, 12, 08, 11 | — | — | — | 250/250/400 plans + Tap + Referral attribution |
| 11 | Marketplace Foundation | Not Started | مستخدم قائم ينشئ Store من هويته الحالية، ويضيف منتج، ويطلب المراجعة | 06, 01, 07, 02, 03, 09, 11 | — | — | — | Store + Catalog + Inventory + Moderation |
| 12 | Marketplace Search | Not Started | منتج منشور يُعثر عليه بالعربي والإنجليزي + جاهز لإضافة اللغات | 06, 09, 12, 11 | — | — | — | Multilingual + Geo search + Ranking + Index rebuild |
| 13 | Store Orders + Delivery | Not Started | شراء → تجهيز → إسناد سائق → Pickup → Delivery → Completion | 06, 05, 04, 03, 02, 07 | — | — | — | Store order + Inventory reserve + Payment evidence |
| 14 | Partner / Enterprise | Not Started | Partner ينشئ طلبًا عبر Portal أو API وتتبع حالته | 07, 06, 05, 04, 12, 11 | — | — | — | Partner onboarding + Webhooks + Fleet + SLA + Multi-stop |
| 15 | Admin Operations | Not Started | الإدارة تشغّل الحالات اليومية دون تعديل DB يدويًا | 08, 01, 03, 04, 05, 06, 07, 11 | — | — | — | Moderation + Manual dispatch + Broadcast + Config UI |
| 16 | Support & Escalation | Not Started | نزاع كامل من العميل/السائق → Support → Escalation → Resolution → Reputation | 08, 02, 03, 11, 12 | — | — | — | Ticketing + Support/Escalation groups + Evidence |
| 17 | Billing & Store Platform Fees | Not Started | Billing كامل قابل للتدقيق ولا يختلط بأموال Trip Settlement | 09, 12, 07, 06, 08, 11 | — | — | — | Invoice + Subscription billing + Tap + Store fees |
| 18 | Observability & Resilience | Not Started | تعطيل خدمة ثانوية دون إسقاط Core، واستعادة من Backup وفق RTO/RPO | 10, 11, 09, 12 | — | — | — | OpenTelemetry + Circuit breakers + Dead-letter + Restore drill |
| 19 | Security Hardening | Not Started | لا ثغرات حرجة، الأسرار ليست في Git، Production access مضبوط | 11, 10, 01, 12 | — | — | — | Threat model + Pen test + Secret rotation + Audit integrity |
| 20 | Saudi Launch Readiness | Not Started | E2E pass + Load baseline + DR proof + Runbooks + Docs complete | جميع الفرق حسب المجال | — | — | — | Launch checklist + Rollback runbook + Incident runbook |
| 21 | Gulf / Egypt / Jordan Expansion | Not Started | Configuration لكل دولة دون تعديل Core Domain | جميع الفرق حسب المجال | — | — | — | Country/Currency/Language/Compliance/Pricing Config |
| 22 | Global Expansion | Not Started | Country Packs + adapters محلية | جميع الفرق حسب المجال | — | — | — | Local payment/KYC/Maps adapters + Timezone/Tax |
| 23 | Channel Independence | Not Started | Core يعمل عبر Telegram/Web/Mobile/Future | 12 + جميع الفرق | — | — | — | Web Adapter + Mobile Adapter دون إعادة كتابة Core |
| 24 | Service Extraction | Not Started | فصل Microservices عند سبب واضح + ADR | حسب الخدمة | — | — | — | Bounded Context + Contracts + Data Ownership قبل الاستخراج |

---

## Exit Gates التفصيلية للمراحل الحرجة

### Phase 00 — Repository Foundation (Exit Gate)

```text
CI passes
No secrets in repo
All teams can clone/build/test
Docs structure exists
Main branch protected
MR template active
```

**المخرجات:** Monorepo created، Docs skeleton created، CI pipeline skeleton، Protected branches، CODEOWNERS، Issue templates، MR template، Architecture ADR template، Migration convention، Testing convention.

### Phase 01 — Identity Foundation (Exit Gate)

إنشاء مستخدم من Telegram وبقاء هويته مستقرة عبر تغيير Username.

### Phase 03 — Telegram Channel Foundation (Exit Gate)

كل Bot يفتح Mini App المناسبة ويمكن استبدال Telegram adapter في الاختبارات بـMock Adapter.

كيف يُثبت آلياً (وفق [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)): اختبار E2E (MR 7 من خطة المرحلة) يبني كل بوت بـ`MockChannelAdapter` بدلاً من `TelegramChannelAdapter` دون تعديل الـCore، ويؤكد أن كل بوت يُنتج زر Mini App الخاص به (`customer→customer` · `driver→driver` · `partner→partner`) وأن التحديث المكرر لا يُعالَج مرتين.

### Phase 06 — Order Engine (Exit Gate)

يمكن إنشاء Order وتغييره عبر الحالة دون حالات مستحيلة.

### Phase 07 — Dispatch & Matching MVP (Exit Gate)

Request كامل من Customer إلى Driver assignment في بيئة اختبار حقيقية.

### Phase 20 — Saudi Launch Readiness (Exit Gate)

```text
Identity, Customer, Driver, Order, Matching, Dispatch, Community fallback,
Reputation, Support, Admin, Marketplace basic, Subscriptions, Billing,
Monitoring, Backup, Security
```

لا يدخل النظام الإنتاج إلا بعد: E2E pass، Load baseline، Disaster recovery proof، Support runbook، Rollback runbook، Incident runbook، Documentation complete.

---

## روابط ذات صلة

- [README.md](../../README.md) — نظرة عامة ومراحل
- [/CONTRIBUTING.md](../../CONTRIBUTING.md) — سير العمل وExit Gates
- [/docs/00-rules/DEFINITION_OF_DONE.md](../00-rules/DEFINITION_OF_DONE.md) — DoR/DoD
- [/docs/15-decisions/](../15-decisions/) — سجل القرارات (ADR)
