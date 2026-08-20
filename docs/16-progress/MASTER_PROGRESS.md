# MASTER_PROGRESS — لوحة تقدم المراحل

> **النطاق:** حالة جميع المراحل Phase 00 → Phase 24 (المراحل 71-103 + المراحل الفرعية في الدليل التنفيذي).
>
> **المرجع الأم:** أقسام 71-103 من الدليل التنفيذي + القسم 106 (Progress Ledger).
>
> **Last Updated:** 2026-08-20 · **Status:** Active · **Related Team:** جميع الفرق (كل فريق يحدّث حالة مرحلته)
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
| 00 | Repository Foundation | **Engineering work complete** — Exit Gate Pending (التحقق من CI فقط) | CI passes، لا أسرار، جميع الفرق clone/build/test، Docs structure، Main branch protected، MR template active | جميع الفرق (Team 10 CI، Team 11 gates، Team 12 Telegram skeleton، Team 09 DB conventions) | **معيار واحد متبقّي: «CI passes»** — محجوب خارجياً بـ shared runners غير المتاحة للـ namespace المجاني غير المُتحقَّق منه. جميع المعايير الأخرى (لا أسرار، clone/build/test، Docs structure، main محمي، MR template) مكتملة ومدمجة. التحقق من CI يتطلب إجراء مالك الحساب (انظر [Runbook فكّ عائق CI](../14-runbooks/CI_RUNNER_UNBLOCK.md)). **تفاصيل التسليم: [HANDOFF_NEXT_STEPS.md](HANDOFF_NEXT_STEPS.md)** | 2026-08-20 | **[MR !1](https://gitlab.com/uxxxu/wasla/-/merge_requests/1) + [MR !3](https://gitlab.com/uxxxu/wasla/-/merge_requests/3) + [MR !4](https://gitlab.com/uxxxu/wasla/-/merge_requests/4) مدمجة** — بنية المستودع + القوانين + قالب MR + حماية main + سكربت فحص أسرار + doc-coverage + **أساس بناء (pnpm+TS+Vitest) عبر [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md)** مع job `build-test` في CI. التحقق محلياً: typecheck ✅ + test ✅ (3 اختبارات) + scan-secrets ✅ + CI lint صالح. | **إجراء مالك الحساب**: حلّ عائق CI (verify namespace أو runner خاص دائم) → تشغيل pipeline على `main` → اعتماد Phase 00 = Completed (يحدّد W0) |
| 01 | Identity Foundation | **In Progress** — عقود مدمجة + أنواع TS (API + أحداث) + اختيار المكدّ (ADR-005) (Contract First ~40%) | إنشاء مستخدم من Telegram وبقاء هويته مستقرة عبر تغيير Username | 01, 09, 10, 11, 12 | (1) ~~اختيار المكدّ التقني~~ → **حُلّ عبر [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)** (Node 20 + TS + Fastify + PostgreSQL + Drizzle). (2) تنفيذ فعلي ضد العقود + اختبارات Contract (consumer/provider) — معلّق على اجتياز Phase 00 Exit Gate (CI passes). (3) shared runners لا يزال يعيق التحقق من CI (يؤثر على التحقق، لا على العقود/الأنواع/اختيار المكدّ). بدء العقود رغم العائق موثّق في [ADR-002](../15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md)؛ الأنواع (API + أحداث) موثّقة في [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)؛ اختيار المكدّ موثّق في [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md). | 2026-08-20 | **[MR !2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2) مدمج** (عقود OpenAPI/JSON Schema/DDL/errors) + حزمة `@wasla/contracts-identity` (أنواع API مولّدة + أنواع أحداث مشتقّة ب اختبار حماية انحراف، 13 اختبار) + **[ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)** (اختيار مكدّ التنفيذ: Node 20 + TS + Fastify + PostgreSQL + Drizzle). | التنفيذ ضد العقود/الأنواع (معلّق على Phase 00 Exit Gate) → Contract tests → اجتياز Exit Gate |
| 02 | Geography & Localization Foundation | Not Started | المستخدم يغيّر موقعه دون حساب جديد، وكل Module يستعمل Geo IDs | 01, 02, 03, 06, 07, 08, 09 | — | — | — | Country/Region/City/District/Zone + i18n (AR/EN/UR) |
| 03 | Telegram Channel Foundation | Not Started | كل Bot يفتح Mini App، وAdapter قابل للاستبدال بـMock | 12, 01, 02, 03, 07 | — | — | — | Three bots + Deep links + Group adapter |
| 04 | Customer Core | Not Started | عميل ينشئ Order صالحًا ويصل إلى Order Engine دون Matching فعلي | 02, 01, 11, 12 | — | — | — | Customer profile + Create ride/delivery request |
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
