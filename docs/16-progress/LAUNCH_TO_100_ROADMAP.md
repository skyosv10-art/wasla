# WASLA — خارطة الطريق الرئيسية الحاكمة حتى الإطلاق 100%

**الإصدار:** `v3.0 — Unified Master Roadmap (مدموجة في المستودع ومصحّحة بفحص فعلي)`  
**تاريخ الدمج في المستودع:** `2026-08-25`  
**آخر تحقق من الحالة الفعلية:** `2026-08-25` — فحص مباشر لشجرة المستودع (انظر القسم 0.15)  
**المرجع الحاكم الوحيد:** هذا الملف.
**حالة الإصدار:** `NO-GO` حتى إغلاق جميع بوابات الإطلاق.

> هذه الوثيقة تدمج خارطة التنفيذ التفصيلية مع نظام الحوكمة والتوثيق. لا توجد خارطة أخرى مستقلة يجوز اعتبارها مصدرًا للحقيقة.

## 0. القانون الحاكم للعمل

### 0.1 لا عمل بلا Work Item
كل عمل ذي معنى يجب أن يرتبط بـ **Work Item واحد على الأقل** في `docs/16-progress/LAUNCH_EXECUTION_BOARD.md`. إذا لم يوجد Work Item مناسب، يُنشأ أولًا بمالك أساسي وثانوي، تبعيات، نطاق، معيار قبول، مخاطر، وخطة rollback.

### 0.2 لا Done بلا Evidence
وجود الكود أو قول «تم» لا يعني الاكتمال. لا تنتقل المهمة إلى `Completed` إلا بعد تنفيذ الاختبارات المطلوبة، نجاح بوابة الخروج، مراجعة المالك الثانوي، وربط دليل قابل لإعادة التشغيل.

### 0.3 لا دفع بلا تسجيل
أي مساهم — إنسانًا أو وكيلًا آليًا — يعدّل `apps/`, `bots/`, `services/`, `packages/`, `infra/`, `scripts/` أو إعدادات/عقود المشروع يجب أن يحدّث في **النطاق نفسه**:
1. `TASK_LOG.md` بإدخال جديد يحمل `Work Item(s)`.
2. `LAUNCH_EXECUTION_BOARD.md` بتحديث العنصر نفسه.
3. وثيقة المجال/العقد/القرار/التشغيل المتأثرة متى تغيّرت الحقيقة الهندسية.

الهدف ليس زيادة الأوراق؛ الهدف هو أن يعرف أي شخص لاحقًا ماذا فُعل، أين، لماذا، كيف اختُبر، ماذا بقي، ومن يملك الخطوة التالية، بحيث لا يُعاد العمل مرتين.

### 0.4 ترتيب السجلات
عند التعارض: `ADR معتمد` ← **هذه الخارطة** ← `LAUNCH_EXECUTION_BOARD.md` ← `TASK_LOG.md` ← `MASTER_PROGRESS.md`. لا يجوز حذف السجل التاريخي لتسوية التعارض.

### 0.5 حالات العمل
`Not Started → In Progress → Ready for Gate → Completed`

وحالة `Blocked` تستخدم فقط مع سبب مكتوب، مالك للعائق، تاريخ مراجعة، وخطة بديلة. لا يجوز القفز فوق حالة أو إغلاق بوابة بالتعليق فقط.

## 0.6 Definition of Ready
قبل البدء يجب أن تكون: النتيجة المطلوبة، النطاق وغير النطاق، المالكين، التبعيات، API/Event/DB impact، خطة الاختبار، مخاطر الأمن والبيانات، الحاجة إلى migration/deployment، وخطة rollback معروفة.

## 0.7 Definition of Done
المهمة لا تصبح `Completed` إلا عند تحقق: implementation + negative/failure tests + contract update + migration handling عند الحاجة + security review + tests green + CI green + docs updated + roadmap updated + MR merged + evidence recorded.

## 0.8 قاعدة منع التكرار
لا يبدأ أي شخص عملًا جديدًا قبل فحص `LAUNCH_EXECUTION_BOARD.md` و`TASK_LOG.md` عن نفس المجال/المشكلة. إذا كان العمل موجودًا، يُستكمل العنصر نفسه أو يُفتح عنصرًا تابعًا صريحًا؛ لا تنشأ مهمة ثانية لنفس السبب.

## 0.9 قاعدة كل اكتشاف جديد
أي فجوة أو bug أو عمل ضروري يظهر أثناء التنفيذ ولا يوجد في الخارطة لا يُنفّذ بصمت. يُسجّل كـ Work Item جديد أو كـ discovered task مرتبط، مع تحديد أثره على البوابات.

## 0.10 مرجع التشغيل
اللوحة = **ماذا نعمل الآن**.  
السجل = **ماذا حدث تاريخيًا**.  
سجل الحجز = **من يعمل عليه الآن وعلى أي مسارات بالضبط**.  
هذه الخارطة = **لماذا نعمله، وبأي ترتيب، وما تعريف الإكمال**.

## 0.11 قاعدة الحجز — لا عمل بلا Claim نشط

قاعدة `0.8` لا تُنفّذ نفسها: نية البحث في اللوحة لا تمنع جهتين من بدء نفس العمل في نفس اليوم. لذلك يُضاف سجل ثالث **إلزامي ومفروض آليًا**: [`WORK_CLAIMS.md`](WORK_CLAIMS.md).

> **قبل أول commit على أي فرع، يجب أن يوجد سطر حجز نشط باسم المنفّذ في `WORK_CLAIMS.md` يذكر: معرّف الحجز، معرّف الـWork Item، المالك، الفرع، مسارات النطاق المحجوزة، تاريخ البدء، وتاريخ الانتهاء.**

ما يفرضه `scripts/checks/validate-work-claims.sh` آليًا:

1. **لا حجز مزدوج:** لا يوجد حجزان نشطان لنفس الـWork Item.
2. **لا تقاطع نطاقات:** لا يتقاطع نطاق حجز نشط مع نطاق حجز نشط آخر. التقاطع = تكرار عمل محتمل ⇒ رفض فوري.
3. **لا عمل خارج النطاق:** كل ملف مُغَيّر في الدفع يجب أن يقع داخل نطاق حجز الفرع نفسه، وإلا يُرفض الدفع. هذا يمنع التوسع الصامت الذي يصطدم بعمل جهة أخرى.
4. **لا حجز منتهٍ:** الحجز الذي تجاوز `Expires` يُعامل كمنتهٍ ولا يغطي الدفع؛ يُمدَّد بقرار مكتوب أو يُحرَّر لغيره.
5. **الفرع يطابق الحجز:** اسم الفرع الفعلي = حقل `Branch` في سطر الحجز.
6. **الإغلاق يُحرِّر:** بعد الدمج يُنقل السطر إلى قسم الحجوزات المحرَّرة بحالة `Released` مع رابط الدليل.

وقبل إنشاء أي عنصر أو حجز جديد، الأمر الإلزامي:

```bash
bash scripts/checks/find-existing-work.sh "<كلمة المجال أو المسار>"
```

يُخرِج كل ما هو موجود مسبقًا في الخارطة واللوحة والفهرس والحجوزات والسجل والـADRs. **إن ظهر عمل مطابق فلا يُنشَأ عنصر موازٍ**؛ يُستكمل العنصر القائم أو يُنشَأ عنصر تابع يشير إليه صراحةً.

## 0.12 نطاق الحجز يُكتب بمسارات لا بكلام

النطاق قائمة بادئات مسارات مفصولة بفواصل، مثل:

```text
services/marketplace/,packages/contracts/src/marketplace/,docs/04-api/MARKETPLACE_HTTP.md
```

لا يُقبل نطاق مثل «السوق» أو «تحسينات عامة». والسجلات المشتركة التالية مستثناة دائمًا من فحص التقاطع لأن القاعدة تُلزم الجميع بالكتابة فيها:

```text
docs/16-progress/TASK_LOG.md
docs/16-progress/LAUNCH_EXECUTION_BOARD.md
docs/16-progress/WORK_CLAIMS.md
docs/16-progress/MASTER_PROGRESS.md
```

أي مسار مشترك آخر (مثل `packages/contracts/` كاملًا أو `.gitlab-ci.yml`) إن احتاجه حجزان في وقت واحد، فالحل ليس تعطيل الفحص، بل تقسيم العنصر أو تسلسله بقرار Program Owner مسجَّل في اللوحة.

---

## 0.13 بنية التنفيذ داخل المستودع

```text
docs/16-progress/
├── README.md                     ← نقطة الدخول: أي سجل يخدم أي غرض وترتيب السلطة
├── LAUNCH_TO_100_ROADMAP.md      ← مصدر الحقيقة الوحيد للنطاق والبوابات (هذا الملف)
├── LAUNCH_EXECUTION_BOARD.md     ← الحالة الحالية لكل Work Item
├── WORK_CLAIMS.md                ← من يعمل الآن وعلى أي مسارات (منع التكرار)
├── WORK_INDEX.md                 ← فهرس: منطقة الكود ← العنصر المالك ← الحالة
├── TASK_LOG.md                   ← السجل الزمني الإلزامي لكل دفع ذي معنى
├── ROADMAP_OPERATING_PROTOCOL.md ← قواعد التشغيل اليومية
├── MASTER_PROGRESS.md             ← ملخص المراحل والبوابات
├── ROADMAP.md                     ← تسلسل المراحل Phase 00–24؛ لا يناقض هذه الوثيقة
└── HANDOFF_NEXT_STEPS.md          ← سجل تاريخي للتسليم؛ ليس مصدر حقيقة للحالة
```

والتحقق الآلي — كله يُنفَّذ من مدخل واحد `bash scripts/checks/verify-governance.sh`:

| الفحص | ما يمنعه |
|---|---|
| `require-doc-update.sh` | دفع ذي معنى بلا تحديث `TASK_LOG` واللوحة في النطاق نفسه. |
| `validate-launch-board.sh` | حالة غير معتمدة، ID مكرر، `Completed` بلا دليل، إحالة إلى Work Item غير موجود. |
| `validate-work-claims.sh` | حجز مزدوج، تقاطع نطاقات بين جهتين، تعديل خارج النطاق المحجوز، حجز منتهٍ. |
| `scan-secrets.sh` | دخول أسرار إلى الشجرة. |
| `find-existing-work.sh` | (أداة بحث إلزامية قبل إنشاء عنصر) بدء عمل موجود مسبقًا. |

---

## 0.14 المراحل مقابل المعالم — منع تعارض الترقيم

في المستودع محورا ترقيم، وخلطهما من أكبر أسباب تكرار العمل. الفصل بينهما إلزامي:

| المحور | يعرّف | يُقرأ من |
|---|---|---|
| **Phase 00 → 24** | تسلسل بناء المجال والمنتج وبوابة خروج كل مرحلة | [`ROADMAP.md`](ROADMAP.md) · [`MASTER_PROGRESS.md`](MASTER_PROGRESS.md) · `docs/12-testing/PHASExx_EXIT_GATE_E2E.md` |
| **M0 → M7** | معالم جاهزية الإطلاق وترتيب البوابات | هذه الخارطة · [`LAUNCH_EXECUTION_BOARD.md`](LAUNCH_EXECUTION_BOARD.md) |

**جدول التطابق الملزم:**

| معلم الإطلاق | يغطّي | العلاقة بمحور المراحل |
|---|---|---|
| M0 | استعادة الثقة والحوكمة | عرضي على كل المراحل — لا يقابل مرحلة |
| M1 | الهوية والأمن عند الحدود | دَين عرضي على المراحل 01–10 المنفَّذة، ويسبق أي مرحلة جديدة |
| M2 | المنصة والبيانات والتشغيل | جزء من Phase 18 مُقدَّم لأنه شرط نشر لا تحسين |
| M3 | المنتج الأدنى الحقيقي (`apps/*`) | لم تُغطَّ بأي Phase منفَّذة |
| M4 | Beta مسيطر عليها | بوابة إثبات، لا تقابل مرحلة |
| M5-11 … M5-17 | النطاقات الموعودة | **مطابقة حرفيًا** للمراحل 11 → 17: Marketplace · Search · Store Orders+Delivery · Partner/Enterprise · Admin Ops · Support · Billing |
| M6-18A/B/C · M6-19A/B/C | المرونة والأمن | Phase 18 (Observability & Resilience) + Phase 19 (Security Hardening) |
| M7-01 … M7-06 | الإطلاق النهائي | Phase 20 — Saudi Launch Readiness |
| M8 | ما بعد الإطلاق | Phases 21–24 — **ليست شرطًا في 100%** |

> **القاعدة:** «Phase 11» و«M5-11» اسمان لعمل واحد لا لعملين. من يفتح عنصرًا باسم Phase وآخر باسم M لنفس النطاق فقد أنشأ تكرارًا يُرفض في مراجعة اللوحة. المعرّف المعتمد في `TASK_LOG` وفي وصف أي MR هو **معرّف اللوحة `Mx-yy`** دائمًا، ورقم المرحلة يُذكر كسياق فقط.
>
> و`ROADMAP.md` لا يستخدم معرّفات `Mx` أصلًا، بل أرقام مراحل ومَعلمًا واحدًا نصّيًا `★ MILESTONE: SAUDI LAUNCH (~W30)` — وهو **نفس بوابة ما بعد M7** لا معلمًا مستقلًا. **يُحظر** إدخال أي ترقيم `M` جديد في `ROADMAP.md`، ويُحظر إدخال أي ترقيم `Phase` جديد في اللوحة، حتى يبقى لكل محور مالك واحد.

---


## 0.15 حالة الانطلاق المعتمدة — مصحّحة بفحص فعلي للمستودع

بُنيت هذه الخارطة أصلًا على تدقيق جنائي بتاريخ `2026-08-24`، وعند دمجها في المستودع أُعيد التحقق من الشجرة فعليًا بتاريخ `2026-08-25` وصُحِّحت البنود التي تقادمت. **ما في هذا القسم هو خط الأساس المعتمد، وأي رقم يخالفه في أي وثيقة أخرى باطل.**

### 0.15.1 ما تم التحقق منه في الشجرة

| الحقيقة | القياس الفعلي | الأثر |
|---|---|---|
| خدمات تحوي كودًا | **11 من 26**: `reputation` · `subscriptions` · `dispatch` · `negotiations` · `drivers` · `marketplace` · `matching` · `orders` · `customers` · `geography` · `identity` | النواة الخلفية حقيقية وليست مدّعاة |
| خدمات placeholder | **15**: `analytics` · `audit` · `auth` · `billing` · `chat` · `compliance` · `delivery` · `fraud` · `notifications` · `partners` · `referrals` · `rides` · `search` · `support` · `translation` | نطاقات M5 غير مبنية |
| `apps/*` | أربعة مجلدات تحوي `.gitkeep` فقط | **لا يوجد منتج للمستخدم** ⇒ M3 حاجز |
| `infra/*` | `terraform` · `kubernetes` · `docker` · `environments` كلها `.gitkeep` فقط | **لا نشر قابل للتكرار** ⇒ M2 حاجز |
| `bots/*` | ثلاثة بوتات تحوي كودًا | قناة تيليجرام قائمة |
| بوابات الخروج | `docs/12-testing/PHASE02..PHASE10_EXIT_GATE_E2E.md` موجودة ولها وظائف CI مقابلة في `.gitlab-ci.yml` | Phase 10 مغلقة فعلًا |
| ADRs | ADR-001 → ADR-016 | القرارات موثقة حتى حد السوق |

### 0.15.2 تصحيحات على خط أساس التدقيق

| بند التدقيق الأصلي | التصحيح بعد الفحص |
|---|---|
| «Phase 10 منفّذة 5/6 = 83.3%» | **Phase 10 مكتملة 6/6 وبوابة الخروج اجتازت** — وظيفة `subscription-exit-gate-e2e` موجودة في CI ووثيقة البوابة موجودة. |
| «Subscription Exit Gate غير مكتمل في CI» | **موجود كوظيفة CI مستقلة** بقاعدة `wasla_subscription_e2e` معزولة. |
| «Reputation E2E غير مربوط بوظيفة CI» | مربوط عبر `reputation-db-integration` وحزمة `packages/reputation-e2e`؛ المتبقي هو توثيق دليل التشغيل تحت M0-08. |
| «الاكتمال ≈ 43.3%» | يبقى **مؤشرًا تقريبيًا لا قيمة حاكمة**. الحالة المعتمدة: **Phase 11 (Marketplace Foundation) جارية عند 3/6 مراجعات**؛ لا تُتخذ نسبة مئوية واحدة قرارًا للإطلاق. |

### 0.15.3 ما لم يتغير ولا يجوز تجاوزه

- المصادقة والتفويض على حدود HTTP الأساسية غير مكتملين — **حاجز إطلاق إنتاجي** (AUD-004، AUD-005).
- دورة migrations الإنتاجية غير مكتملة، ولا توجد بنية نشر تشغيلية.
- لا Load ولا Chaos ولا DR، ولا DAST كامل، ولا Frontend E2E فعلي — لأنه لا يوجد Frontend أصلًا.
- القياسات أعلاه مأخوذة من شجرة الملفات، **وليست إثباتًا لنجاح تشغيل** الاختبارات في بيئة نطيفة؛ إثبات التشغيل هو مخرج M0-08.

**قرار إدارة البرنامج:** المشروع ليس في مرحلة «إصلاحات نهائية»؛ بل يحتاج برنامج إكمال ثانٍ كبير يغطي Product Surface + Platform + Security + Operations + Launch. **قرار الإصدار الحالي: NO-GO.**

---

# 1. الهدف النهائي

## 1.1 تعريف "الإطلاق 100%"

لا تعني 100% أن كل فكرة مستقبلية في الرؤية قد تم تنفيذها.

تعني 100% أن:

1. كل نطاقات الإطلاق المحددة تجاريًا وتقنيًا موصولة ببعضها.
2. كل API حرجة محمية Authentication/Authorization.
3. كل قاعدة بيانات إنتاجية لها lifecycle وترقية/rollback موثقة.
4. كل خدمة لها:
   - build
   - test
   - health
   - readiness
   - metrics
   - logs
   - tracing حيث يلزم
   - graceful shutdown
5. كل workflow حرجة لها E2E.
6. كل خدمة production لها deployment manifest وإعدادات أسرار آمنة.
7. النسخ الاحتياطي والاستعادة تم اختباره فعليًا.
8. هناك Load/Stress/Failure/Chaos evidence.
9. يوجد Runbook لكل Incident رئيسي.
10. لا توجد blocker حرجة أو عالية مفتوحة دون قبول مخاطر رسمي.
11. CI/CD يمنع الدمج والإطلاق عند كسر بوابات الجودة.
12. خارطة الطريق نفسها محدثة حتى آخر commit/PR.
13. يوجد Release Candidate قابل لإعادة البناء بنفس المدخلات.
14. تم اجتياز Saudi Launch Gate.
15. تم تنفيذ Post-Launch validation قبل إعلان Production Complete.

---

# 2. قاعدة العمل الإلزامية للمشروع

## 2.1 قاعدة "كل تغيير له أثر موثق"

أي شخص يقوم بأي من التالي:

- تعديل كود
- إضافة كود
- حذف كود
- تعديل API
- تعديل Schema
- إضافة migration
- تعديل configuration
- تعديل environment variable
- إضافة dependency
- تعديل test
- تعديل CI
- تعديل Docker/Kubernetes/Terraform
- تعديل bot flow
- تعديل domain rule
- إضافة feature
- إصلاح bug
- إضافة AI/Agent behavior
- تعديل security policy
- تعديل operational runbook

**يجب أن يحدّث خارطة الطريق في نفس الـPR.**

لا يوجد استثناء إلا لتغيير آلي بحت لا يغير سلوك النظام، وحتى عندها يجب ذكر السبب في PR.

---

## 2.2 قاعدة "لا يوجد Done بدون Evidence"

كل Task يجب أن يحتوي في بطاقة التنفيذ أو PR على:

- `Task ID`
- الوصف
- المالك
- النطاق
- الملفات/المكونات المتأثرة
- المتطلبات/Dependencies
- Acceptance Criteria
- الاختبارات
- نتيجة CI
- الأدلة
- الوثائق المحدثة
- المخاطر
- Migration impact
- Security impact
- Rollback plan
- Roadmap update

### الحالة المسموح بها

`PLANNED → IN_PROGRESS → IMPLEMENTED → TESTED → REVIEWED → CI_PASS → ACCEPTED → RELEASED`

ولا يمكن الانتقال إلى `ACCEPTED` إلا بعد المرور بالبوابات السابقة.

---

# 3. قاعدة الـPR الإلزامية

كل PR يجب أن يحتوي على:

```text
## Task
ROADMAP-XXXX

## Change Type
Feature / Bugfix / Refactor / Security / Infrastructure / Test / Docs

## Why
...

## Scope
...

## Implementation
...

## Contracts Changed
...

## Database Changed
Yes / No

## Migration
...

## Security Impact
...

## Tests Added/Changed
...

## Tests Executed
...

## CI Evidence
...

## Documentation Updated
...

## Operational Impact
...

## Rollback Plan
...

## Risks / Uncertainty
...

## Roadmap Updated
Yes

## Follow-up Tasks
...
```

### قاعدة صلبة

إذا كان `Roadmap Updated = No` وسبب التغيير ليس آليًا بحتًا، فالـPR **لا يُقبل**.

---

# 4. قاعدة الـCommit

يفضّل استخدام:

```text
<type>(<scope>): <summary>
```

أمثلة:

```text
feat(orders): add authenticated driver assignment
fix(dispatch): prevent duplicate offer acceptance
test(subscription): add cross-service exit gate
security(auth): enforce service identity on internal APIs
infra(k8s): add production readiness probes
docs(roadmap): update phase status and evidence
```

كل commit مرتبط بمهمة Roadmap واحدة أو مجموعة محددة من المهام.

---

# 5. نظام تعريف المهام

كل مهمة تحمل ID ثابت:

```text
WASLA-FOUND-xxx
WASLA-AUTH-xxx
WASLA-DB-xxx
WASLA-API-xxx
WASLA-UI-xxx
WASLA-TEST-xxx
WASLA-SEC-xxx
WASLA-INFRA-xxx
WASLA-OPS-xxx
WASLA-AI-xxx
WASLA-LAUNCH-xxx
```

---

# 6. مراحل البرنامج التنفيذي

## المرحلة A — تثبيت الأساس الحالي

### الهدف

إغلاق الفجوات في Core قبل بناء الطبقات التجارية والعملياتية فوقها.

### A1 — إغلاق Phase 10

المهام:

- [ ] إكمال Driver Subscription & Referral Exit-Gate E2E.
- [ ] إضافة cross-service scenario حقيقي.
- [ ] اختبار replay/idempotency عبر HTTP.
- [ ] ربط Subscription E2E في CI.
- [ ] التأكد من ledger → projection → outbox.
- [ ] التحقق من referral reward derivation.
- [ ] اختبار duplicate event delivery.
- [ ] اختبار retry بعد failure.
- [ ] اختبار transaction rollback.
- [ ] توثيق كل edge cases.
- [ ] تحديث roadmap إلى 100% فقط بعد نجاح جميع البوابات.

### Exit Gate

- جميع tests خضراء.
- E2E يمر من نقطة البداية إلى النتيجة النهائية.
- CI ينفذه تلقائيًا.
- لا يوجد known blocker.
- Documentation محدثة.

---

# 7. المرحلة B — Production Identity & Security Boundary

> **هذه المرحلة Critical Path ولا يجوز تأجيلها إلى ما بعد بناء المنتج.**

## B1 — Authentication Architecture

- [ ] تحديد نموذج هوية المستخدم.
- [ ] تحديد Identity Provider.
- [ ] تحديد access token model.
- [ ] تحديد refresh/revocation model.
- [ ] تعريف identity claims.
- [ ] تعريف actor types.
- [ ] تعريف session lifecycle.
- [ ] تعريف service-to-service identity.
- [ ] تعريف machine credentials.
- [ ] تعريف admin identities.

## B2 — Authorization

- [ ] بناء RBAC أو Policy-based Authorization.
- [ ] تعريف customer permissions.
- [ ] تعريف driver permissions.
- [ ] تعريف partner permissions.
- [ ] تعريف admin permissions.
- [ ] تعريف support permissions.
- [ ] تعريف service permissions.
- [ ] تعريف object-level authorization.
- [ ] منع IDOR.
- [ ] منع privilege escalation.
- [ ] توثيق جميع policy rules.

## B3 — API Gateway / Edge

- [ ] Gateway.
- [ ] TLS termination.
- [ ] Rate limiting.
- [ ] Request size limits.
- [ ] Auth validation.
- [ ] Request ID.
- [ ] Correlation ID.
- [ ] IP/abuse policies.
- [ ] API versioning.
- [ ] Error normalization.
- [ ] WAF strategy.

## B4 — Service Identity

- [ ] Internal authentication.
- [ ] Service identity propagation.
- [ ] Token validation.
- [ ] Trust boundaries.
- [ ] Service allow-list.
- [ ] Prevent direct public access to internal services.

### Exit Gate

- لا يوجد production HTTP API حر بدون identity verification.
- جميع actors verified.
- جميع internal calls authenticated.
- Authorization tests موجودة.
- Abuse/rate-limit tests ناجحة.

---

# 8. المرحلة C — Database Production Lifecycle

## C1 — Migration System

- [ ] اختيار migration authority واحدة.
- [ ] تحويل schema snapshots إلى migrations قابلة للتطبيق.
- [ ] ترتيب migrations.
- [ ] Migration metadata table.
- [ ] checksum/immutability.
- [ ] forward migration.
- [ ] rollback strategy.
- [ ] expand/contract strategy.
- [ ] backward compatibility.
- [ ] zero/low-downtime strategy.

## C2 — Data Safety

- [ ] Backup policy.
- [ ] PITR إذا كان مناسبًا.
- [ ] Backup encryption.
- [ ] Backup retention.
- [ ] Restore procedure.
- [ ] Restore automation.
- [ ] Restore test دوري.
- [ ] RPO.
- [ ] RTO.

## C3 — Schema Governance

لكل تغيير:

```text
Contract
→ schema change
→ migration
→ test
→ deploy
→ verify
```

### Exit Gate

- يمكن بناء Database Production من الصفر.
- يمكن ترقيتها من نسخة سابقة.
- يمكن استعادة نسخة احتياطية.
- يوجد دليل إثبات Restore.
- لا يوجد اختلاف غير موثق بين runtime schema والعقد.

---

# 9. المرحلة D — Marketplace Foundation

## D1 — Domain

- [ ] Merchant/Store identity.
- [ ] Product catalog.
- [ ] Categories.
- [ ] Availability.
- [ ] Pricing.
- [ ] Inventory.
- [ ] Store status.
- [ ] Customer eligibility.
- [ ] Marketplace policies.

## D2 — Contracts

- [ ] OpenAPI.
- [ ] Error catalog.
- [ ] Events.
- [ ] SQL schema.
- [ ] TypeScript generated contracts.
- [ ] Idempotency rules.

## D3 — Persistence

- [ ] Postgres schema.
- [ ] indexes.
- [ ] constraints.
- [ ] repository.
- [ ] transactional seams.
- [ ] migration.

## D4 — Tests

- [ ] Domain tests.
- [ ] Repository tests.
- [ ] Contract tests.
- [ ] HTTP tests.
- [ ] schema drift.
- [ ] E2E.

### Exit Gate

Marketplace يمكنه إنتاج catalog فعلي قابل للاستخدام من APIs محمية وقابلة للتشغيل.

---

# 10. المرحلة E — Search

- [ ] تحديد search use cases.
- [ ] تحديد ranking.
- [ ] query normalization.
- [ ] Arabic handling.
- [ ] typo tolerance.
- [ ] filtering.
- [ ] geo filtering.
- [ ] pagination.
- [ ] indexing strategy.
- [ ] reindexing.
- [ ] consistency expectations.
- [ ] performance SLO.

### اختبارات إلزامية

- [ ] Arabic.
- [ ] mixed Arabic/English.
- [ ] typo.
- [ ] empty query.
- [ ] malicious query.
- [ ] high cardinality.
- [ ] timeout.
- [ ] stale index.
- [ ] pagination stability.

---

# 11. المرحلة F — Store Orders & Delivery

## F1 — Order Lifecycle

- [ ] cart/order creation.
- [ ] payment state separation.
- [ ] fulfillment state.
- [ ] cancellation.
- [ ] rejection.
- [ ] substitution.
- [ ] delivery assignment.
- [ ] delivery completion.
- [ ] refund edge cases.

## F2 — Delivery

- [ ] delivery eligibility.
- [ ] driver matching.
- [ ] dispatch.
- [ ] acceptance.
- [ ] timeout.
- [ ] reassignment.
- [ ] live status.
- [ ] proof of delivery.

## Exit Gate

من إنشاء الطلب وحتى التسليم أو الفشل أو الإلغاء يجب أن يكون workflow كاملًا ومختبرًا.

---

# 12. المرحلة G — Partner / Enterprise

- [ ] Partner identity.
- [ ] tenant model.
- [ ] tenant isolation.
- [ ] partner users.
- [ ] partner roles.
- [ ] partner API.
- [ ] API credentials.
- [ ] webhooks.
- [ ] usage limits.
- [ ] audit.
- [ ] billing hooks.
- [ ] onboarding.
- [ ] suspension/offboarding.

### Enterprise Gate

- [ ] Tenant isolation proven.
- [ ] authorization proven.
- [ ] audit trail.
- [ ] operational support.
- [ ] SLA model.
- [ ] incident model.

---

# 13. المرحلة H — Admin Operations

## Admin Console

يجب أن توجد وظائف إدارية واضحة:

- [ ] user search.
- [ ] order search.
- [ ] driver search.
- [ ] investigation view.
- [ ] fraud flags.
- [ ] reputation view.
- [ ] dispatch intervention.
- [ ] subscription state.
- [ ] partner management.
- [ ] feature flags.
- [ ] audit logs.
- [ ] access management.

### Admin Security

كل إجراء إداري عالي الخطورة يجب أن يكون:

- authenticated
- authorized
- audited
- attributable
- reversible حيث يمكن
- protected by approval حيث يلزم

---

# 14. المرحلة I — Support / Escalation

- [ ] support tickets.
- [ ] case lifecycle.
- [ ] priority.
- [ ] SLA.
- [ ] escalation.
- [ ] internal notes.
- [ ] customer communication.
- [ ] driver communication.
- [ ] dispute handling.
- [ ] evidence attachment.
- [ ] audit trail.
- [ ] resolution code.

### Exit Gate

يجب أن يستطيع فريق Support معالجة الحالة دون الوصول المباشر إلى قاعدة البيانات.

---

# 15. المرحلة J — Billing & Store Fees

- [ ] pricing model.
- [ ] subscription billing.
- [ ] store fees.
- [ ] commissions.
- [ ] invoices.
- [ ] ledger.
- [ ] refunds.
- [ ] disputes.
- [ ] failed payment handling.
- [ ] reconciliation.
- [ ] accounting export.
- [ ] billing audit.

### قاعدة

لا يجوز أن يعتمد billing النهائي على mutable derived state فقط؛ يجب وجود ledger/source-of-truth واضح.

---

# 16. المرحلة K — Frontend / Mini Apps

## Customer

- [ ] onboarding.
- [ ] location.
- [ ] create order.
- [ ] order status.
- [ ] offers.
- [ ] negotiation.
- [ ] history.
- [ ] support.

## Driver

- [ ] onboarding.
- [ ] eligibility.
- [ ] availability.
- [ ] offers.
- [ ] acceptance.
- [ ] active order.
- [ ] earnings.
- [ ] reputation.
- [ ] subscription.

## Partner

- [ ] onboarding.
- [ ] catalog.
- [ ] orders.
- [ ] delivery.
- [ ] reports.

## Admin

- [ ] dashboard.
- [ ] operations.
- [ ] support.
- [ ] users.
- [ ] security.
- [ ] audit.

### Frontend Quality Gate

- [ ] accessibility.
- [ ] localization.
- [ ] Arabic RTL.
- [ ] mobile responsiveness.
- [ ] error states.
- [ ] loading states.
- [ ] offline/degraded states حيث يلزم.
- [ ] frontend E2E.

---

# 17. المرحلة L — Observability & Reliability

## L1 — Logging

- [ ] structured logs.
- [ ] no secrets.
- [ ] no sensitive payload leakage.
- [ ] request ID.
- [ ] correlation ID.
- [ ] actor ID حيث مسموح.
- [ ] service name.
- [ ] environment.
- [ ] version.

## L2 — Metrics

لكل خدمة:

- [ ] request count.
- [ ] error rate.
- [ ] latency p50/p95/p99.
- [ ] dependency failures.
- [ ] DB latency.
- [ ] pool utilization.
- [ ] queue/outbox lag.
- [ ] business metrics المناسبة.

## L3 — Tracing

- [ ] trace propagation.
- [ ] cross-service correlation.
- [ ] sampling strategy.
- [ ] sensitive-data controls.

## L4 — Readiness

الـreadiness يجب أن تتحقق من قدرة الخدمة على العمل، وليس فقط أن العملية تعمل.

## L5 — Graceful Shutdown

- [ ] stop accepting work.
- [ ] drain in-flight requests.
- [ ] stop ticks.
- [ ] finish transactional work.
- [ ] flush telemetry.
- [ ] exit safely.

---

# 18. المرحلة M — Resilience Engineering

- [ ] timeouts.
- [ ] retries.
- [ ] exponential backoff.
- [ ] jitter.
- [ ] circuit breakers.
- [ ] bounded concurrency.
- [ ] bulkheads.
- [ ] dependency failure behavior.
- [ ] outbox recovery.
- [ ] duplicate event tolerance.

## Failure Scenarios

يجب تنفيذ وقياس:

- [ ] DB unavailable.
- [ ] DB slow.
- [ ] service unavailable.
- [ ] network timeout.
- [ ] duplicate request.
- [ ] duplicate event.
- [ ] delayed event.
- [ ] partial success.
- [ ] process restart.
- [ ] pod kill.
- [ ] node failure حيث البيئة تسمح.
- [ ] corrupted/stale cache.
- [ ] expired credentials.

---

# 19. المرحلة N — Infrastructure

## Required

- [ ] Docker images.
- [ ] immutable build artifacts.
- [ ] image scanning.
- [ ] registry.
- [ ] Kubernetes/Terraform حسب التصميم.
- [ ] environment configuration.
- [ ] secrets management.
- [ ] service discovery.
- [ ] ingress/gateway.
- [ ] TLS.
- [ ] DNS.
- [ ] network policies.
- [ ] database hosting.
- [ ] storage.
- [ ] backup.
- [ ] monitoring.
- [ ] alerting.

## Environments

يجب أن توجد على الأقل:

```text
local
ci
development
staging
production
```

ويمكن إضافة:

```text
preview
load-test
disaster-recovery
```

حسب الحاجة.

---

# 20. المرحلة O — CI/CD Governance

## Required pipelines

- [ ] formatting.
- [ ] lint.
- [ ] typecheck.
- [ ] unit tests.
- [ ] integration tests.
- [ ] contract tests.
- [ ] schema drift.
- [ ] E2E.
- [ ] security scan.
- [ ] dependency scan.
- [ ] secrets scan.
- [ ] container scan.
- [ ] SBOM.
- [ ] migration validation.
- [ ] artifact build.
- [ ] deployment validation.
- [ ] smoke tests.

## Mandatory protected branches

- [ ] no direct production push.
- [ ] protected main/release branches.
- [ ] required approvals.
- [ ] CODEOWNERS.
- [ ] successful CI required.
- [ ] security gate required.
- [ ] roadmap update required.

---

# 21. المرحلة P — Test Program

## Pyramid

### Unit

- domain rules.
- state machines.
- invariants.
- parsers.
- policies.

### Integration

- Postgres.
- repository.
- transaction behavior.
- outbox.
- dependency adapters.

### Contract

- OpenAPI.
- events.
- schema.
- error catalogs.

### E2E

يجب أن تغطي workflows وليس مجرد endpoints منفردة.

### Security

- auth bypass.
- IDOR.
- privilege escalation.
- replay.
- brute force.
- rate limiting.
- token misuse.
- secret leakage.

### Performance

- baseline.
- load.
- stress.
- soak.
- spike.
- concurrency.

### Disaster Recovery

- backup restore.
- region/environment recovery حيث ينطبق.
- migration recovery.
- service restore.

---

# 22. المرحلة Q — Security Hardening

## Secure Development

- [ ] SAST.
- [ ] dependency scanning.
- [ ] container scanning.
- [ ] SBOM.
- [ ] secret scanning.
- [ ] DAST.
- [ ] threat modeling.
- [ ] security review.

## Runtime

- [ ] least privilege.
- [ ] non-root containers.
- [ ] read-only filesystem حيث يمكن.
- [ ] restricted network.
- [ ] secret rotation.
- [ ] TLS.
- [ ] audit.
- [ ] session invalidation.
- [ ] abuse protection.

## High-risk data

- [ ] PII inventory.
- [ ] retention.
- [ ] masking.
- [ ] encryption.
- [ ] logging policy.
- [ ] access audit.

---

# 23. المرحلة R — Saudi Launch Readiness

هذه المرحلة ليست مجرد ترجمة المنتج إلى العربية.

## Product

- [ ] Arabic UX.
- [ ] RTL.
- [ ] Saudi geography coverage.
- [ ] Saudi city/district/zone data verified.
- [ ] local user journeys.
- [ ] local notification/content rules.

## Operations

- [ ] support operation.
- [ ] incident response.
- [ ] escalation.
- [ ] on-call.
- [ ] emergency access.

## Compliance / Legal

- [ ] legal review.
- [ ] privacy policy.
- [ ] terms.
- [ ] consent flows.
- [ ] data retention.
- [ ] applicable Saudi regulatory obligations reviewed by qualified counsel/compliance owner.

## Payment / Business

- [ ] payment provider(s).
- [ ] invoicing.
- [ ] refunds.
- [ ] reconciliation.
- [ ] local finance requirements.

---

# 24. المرحلة S — AI / Agent Layer

> لا يتم إدخال AI إلى مسارات حرجة مباشرة قبل تثبيت الأمان والـpolicy layer.

## التصميم الإلزامي

AI لا يغير مباشرة:

- order
- driver eligibility
- reputation
- fraud state
- billing
- identity

بل يعمل بهذه السلسلة:

```text
AI Proposal
→ Policy Evaluation
→ Authorization
→ Human Approval (high-risk)
→ Deterministic Use Case
→ Audit Evidence
```

## Ports

- [ ] `AgentDecisionPort`
- [ ] `ToolAuthorizationPort`
- [ ] `PolicyEvaluationPort`
- [ ] `HumanApprovalPort`
- [ ] `AuditEvidencePort`

## Agent Tests

- [ ] hallucination resistance.
- [ ] unauthorized action resistance.
- [ ] prompt injection.
- [ ] tool misuse.
- [ ] policy bypass.
- [ ] evidence completeness.
- [ ] deterministic fallback.

---

# 25. المرحلة T — Performance & Scale Certification

يجب تحديد SLOs قبل اعتماد النتائج.

## لكل workflow حرجة

قياس:

- latency
- throughput
- error rate
- DB utilization
- CPU
- memory
- connection pools
- event lag
- outbox lag

## Workloads

- [ ] normal load.
- [ ] expected peak.
- [ ] 2x peak.
- [ ] stress.
- [ ] sustained load.
- [ ] recovery after overload.

## Critical workflows

- [ ] order intake.
- [ ] matching.
- [ ] dispatch tick.
- [ ] negotiation.
- [ ] reputation recompute.
- [ ] subscription tick.
- [ ] search.
- [ ] store order.
- [ ] delivery assignment.

---

# 26. المرحلة U — Runbooks & Operations

يجب إنشاء Runbook لكل فئة حادث:

- [ ] service down.
- [ ] database down.
- [ ] database corruption.
- [ ] elevated error rate.
- [ ] latency spike.
- [ ] queue/outbox stuck.
- [ ] auth outage.
- [ ] Telegram outage.
- [ ] payment outage.
- [ ] deployment rollback.
- [ ] security incident.
- [ ] data incident.
- [ ] backup restore.
- [ ] DR activation.

كل Runbook يجب أن يحتوي:

```text
Symptoms
Detection
Impact
Immediate Actions
Commands / Links
Validation
Rollback
Escalation
Communication
Postmortem Requirements
```

---

# 27. المرحلة V — Business Acceptance

قبل الـRC:

- [ ] Product owner signs off.
- [ ] Operations signs off.
- [ ] Security signs off.
- [ ] QA signs off.
- [ ] Infrastructure signs off.
- [ ] Data/DB owner signs off.
- [ ] Support signs off.
- [ ] Legal/compliance sign-off حيث ينطبق.

---

# 28. المرحلة W — Release Candidate

## RC-1

- [ ] branch cut.
- [ ] version locked.
- [ ] dependencies locked.
- [ ] migrations frozen except approved blockers.
- [ ] documentation frozen.
- [ ] all critical CI green.
- [ ] security scans green.
- [ ] performance baseline passed.

## RC-2

- [ ] defects from RC-1 closed.
- [ ] rerun complete suite.
- [ ] DR verification.
- [ ] restore verification.
- [ ] production smoke test.
- [ ] rollback rehearsal.

---

# 29. المرحلة X — Final Launch Gate

لا يسمح بالإطلاق إلا بعد أن تكون كل العناصر التالية TRUE.

## Product

- [ ] All committed launch features complete.
- [ ] No critical user journey incomplete.
- [ ] No P0/P1 unresolved defect.
- [ ] Arabic/RTL verified.
- [ ] Customer flow verified.
- [ ] Driver flow verified.
- [ ] Partner flow verified where applicable.
- [ ] Admin flow verified.
- [ ] Support flow verified.

## Security

- [ ] Authentication complete.
- [ ] Authorization complete.
- [ ] Internal service identity complete.
- [ ] Secrets management complete.
- [ ] SAST clean/accepted.
- [ ] DAST complete.
- [ ] Dependency risks reviewed.
- [ ] Container risks reviewed.
- [ ] No critical secret exposure.
- [ ] Security incident response ready.

## Database

- [ ] Migrations reproducible.
- [ ] Production upgrade tested.
- [ ] Rollback strategy tested.
- [ ] Backup verified.
- [ ] Restore verified.
- [ ] RPO accepted.
- [ ] RTO accepted.

## Infrastructure

- [ ] Production deployment reproducible.
- [ ] TLS.
- [ ] gateway.
- [ ] DNS.
- [ ] secrets.
- [ ] monitoring.
- [ ] alerting.
- [ ] autoscaling strategy.
- [ ] resource limits.
- [ ] health/readiness.
- [ ] graceful shutdown.

## Testing

- [ ] unit green.
- [ ] integration green.
- [ ] contract green.
- [ ] E2E green.
- [ ] security tests green.
- [ ] load test green.
- [ ] chaos/failure tests accepted.
- [ ] frontend E2E green.

## Operations

- [ ] on-call active.
- [ ] incident response active.
- [ ] runbooks published.
- [ ] dashboards published.
- [ ] alerts tested.
- [ ] escalation tree tested.

## Documentation

- [ ] architecture current.
- [ ] API docs current.
- [ ] data docs current.
- [ ] configuration docs current.
- [ ] runbooks current.
- [ ] roadmap current.
- [ ] release notes current.

---

# 30. المرحلة Y — Production Launch

## T-7 days

- [ ] Code freeze except release blockers.
- [ ] production DB rehearsal.
- [ ] backup verification.
- [ ] restore verification.
- [ ] credentials verification.
- [ ] DNS/TLS verification.
- [ ] monitoring verification.
- [ ] support readiness.
- [ ] incident call tree.

## T-24h

- [ ] final smoke test.
- [ ] final migration validation.
- [ ] final capacity check.
- [ ] final backup.
- [ ] deployment artifacts checksum.
- [ ] rollback artifact verified.

## T-0

- [ ] deployment.
- [ ] migration.
- [ ] smoke.
- [ ] core user journeys.
- [ ] telemetry verification.
- [ ] error-rate verification.
- [ ] latency verification.
- [ ] support readiness.

## T+1h

- [ ] operational metrics review.
- [ ] error budget check.
- [ ] queue/outbox check.
- [ ] DB health.
- [ ] auth health.
- [ ] user journeys.

## T+24h

- [ ] launch review.
- [ ] incidents review.
- [ ] data reconciliation.
- [ ] business KPI review.
- [ ] known issues classification.

---

# 31. Post-Launch 7 / 30 / 90 Days

## 7 Days

- [ ] stabilize incidents.
- [ ] fix launch regressions.
- [ ] review SLO.
- [ ] review customer feedback.
- [ ] review support tickets.
- [ ] review cost.

## 30 Days

- [ ] capacity recalibration.
- [ ] performance optimization.
- [ ] reliability review.
- [ ] security re-evaluation.
- [ ] technical debt review.
- [ ] roadmap reprioritization.

## 90 Days

- [ ] architecture review.
- [ ] scale review.
- [ ] disaster recovery rehearsal.
- [ ] dependency refresh.
- [ ] service extraction assessment.
- [ ] next product roadmap.

---

# 32. نظام التحقق من الاكتمال

## 32.1 لا تعتمد النسبة على تقدير شخصي

النسبة لكل Feature تحسب من:

```text
Implementation
+ Tests
+ Contract
+ Documentation
+ CI
+ Security
+ Operations
+ Production Evidence
```

مثال:

```text
Feature = 8 dimensions

Implementation       = 1
Tests                = 1
Contract             = 1
Documentation        = 1
CI                   = 1
Security             = 1
Operations           = 1
Production Evidence  = 1

Completion = completed / 8
```

ولكن أي **Critical Blocker** يجعل الـFeature غير قابلة للإعلان "Production Ready" حتى لو كانت النسبة الحسابية عالية.

---

# 33. قاعدة منع "Fake Completion"

يُمنع استخدام:

- TODO removed = complete
- test file exists = tested
- API exists = feature complete
- documentation exists = implemented
- local run passes = production ready
- unit tests pass = system ready

الإثبات يجب أن يطابق مستوى الادعاء.

---

# 34. Dependency Rules

قبل بدء أي Task:

```text
1. Read roadmap dependency
2. Read applicable ADR
3. Read contract
4. Read existing tests
5. Confirm owner
6. Confirm acceptance criteria
```

بعد التنفيذ:

```text
1. Code
2. Tests
3. Contract
4. Docs
5. CI
6. Roadmap
7. PR evidence
```

---

# 35. قاعدة تغييرات قاعدة البيانات

أي تعديل DB يتطلب:

- [ ] schema
- [ ] migration
- [ ] migration test
- [ ] backwards compatibility review
- [ ] rollback strategy
- [ ] data migration strategy إذا لزم
- [ ] performance review
- [ ] index review
- [ ] backup/restore impact
- [ ] documentation

لا يجوز تعديل `schema.sql` فقط وإعلان المهمة منتهية في Production.

---

# 36. قاعدة تغييرات الـAPI

أي API change يتطلب:

- [ ] OpenAPI update.
- [ ] generated contracts.
- [ ] request validation.
- [ ] response validation حيث يلزم.
- [ ] error catalog.
- [ ] auth policy.
- [ ] authorization policy.
- [ ] idempotency.
- [ ] integration tests.
- [ ] E2E impact.
- [ ] documentation.
- [ ] version/deprecation policy.

---

# 37. قاعدة التوثيق

التوثيق يجب أن يطابق الواقع.

إذا تغيّر:

- route
- schema
- event
- state
- environment variable
- service dependency
- workflow
- deployment

فيجب تحديث الوثائق ذات الصلة في نفس PR.

---

# 38. قاعدة Environment Variables

لكل variable:

```text
Name
Purpose
Required?
Default
Allowed Values
Secret?
Owner
Used By
Environment Scope
Failure Behavior
```

لا يُقبل:

- secret في source.
- production secret في sample file الحقيقي.
- default خطير.
- variable غير موثقة.

---

# 39. قاعدة الخدمات

كل Service Production يجب أن يملك:

```text
contracts/
src/
tests/
config/
health/
readiness/
metrics/
Dockerfile
deployment manifest
README
runbook
security notes
```

وأي استثناء يجب أن يكون ADR موثقًا.

---

# 40. قاعدة الاختبارات

كل Feature حرجة يجب أن يكون لها على الأقل:

```text
1. Unit
2. Integration
3. Contract
4. HTTP
5. E2E
6. Failure-path
7. Idempotency / replay
8. Authorization
```

بحسب طبيعة الميزة.

---

# 41. إدارة المشاكل المكتشفة في التدقيق

## P0 — Launch Blocker

أمثلة:

- unauthenticated production APIs
- destructive data corruption
- missing production DB recovery
- secret exposure
- broken production deployment

لا يسمح بالإطلاق مع P0.

## P1 — Critical

لا يسمح بفتح Production إلا بقبول صريح جدًا من أصحاب القرار مع خطة علاج موثقة.

## P2 — High

يمكن ترحيله فقط إذا لم يؤثر على Launch Gate.

## P3 — Medium/Low

يدخل backlog بعد الإطلاق إذا لم يؤثر على السلامة أو الموثوقية.

---

# 42. أهم Technical Debt يجب إغلاقه

بحسب التدقيق:

- توحيد service patterns أو توليدها بدل التكرار اليدوي.
- تقليل تكرار OpenAPI/request parser/domain mapper.
- توحيد environment configuration schemas.
- منع production من fallback إلى in-memory.
- تقوية readiness.
- graceful shutdown موحد.
- retry/backoff/circuit breaker.
- backup restore automation.
- real platform layer.
- metrics/health standardization.
- deployment artifact/container strategy.

---

# 43. أولويات التنفيذ الفعلية

## لا تبنوا كل الأشياء بالتوازي بلا ترتيب.

### الترتيب الإلزامي:

```text
1. Finish Phase 10
2. Auth + Authorization + Service Identity
3. DB Migration + Backup/Restore
4. Infrastructure + CI/CD foundation
5. Observability + Reliability
6. Marketplace
7. Search
8. Store Orders + Delivery
9. Partner / Enterprise
10. Admin
11. Support
12. Billing
13. Frontends / Mini Apps
14. Security Certification
15. Load / Chaos / DR
16. Saudi Launch Readiness
17. RC
18. Final Launch Gate
19. Production
```

### لماذا؟

لأن بناء features تجارية كثيرة قبل بناء platform/security سيخلق إعادة عمل كبيرة ويجعل الفريق يبني على حدود HTTP غير آمنة.

---

# 44. قاعدة التوازي

يمكن تنفيذ Workstreams بالتوازي فقط إذا لم يحدث تعارض في dependency.

## مسارات يمكن أن تسير بالتوازي نسبيًا

```text
Marketplace
Search
Frontend foundations
Admin UX
Observability
Infrastructure
Security architecture
DB migration work
Support design
```

لكن لا يجوز إعلان أي منها Production Ready قبل وجود:

```text
Auth
Authorization
DB lifecycle
Deployment
Observability
Tests
Runbooks
```

---

# 45. لوحة المشروع المطلوبة

يجب إنشاء Dashboard واحد يحوي:

| Field | Required |
|---|---|
| Task ID | نعم |
| Phase | نعم |
| Feature | نعم |
| Owner | نعم |
| Status | نعم |
| Priority | نعم |
| Dependency | نعم |
| PR | نعم |
| Commit | نعم |
| Tests | نعم |
| CI | نعم |
| Docs | نعم |
| Security Review | حسب النوع |
| Migration | حسب النوع |
| Release | نعم |
| Evidence | نعم |
| Risk | نعم |

---

# 46. الحالات القياسية في اللوحة

```text
PLANNED
READY
IN_PROGRESS
BLOCKED
IMPLEMENTED
TESTED
IN_REVIEW
CI_FAILED
CI_PASS
ACCEPTED
RELEASED
VERIFIED_IN_PRODUCTION
```

---

# 47. قاعدة "BLOCKED"

إذا أصبحت المهمة BLOCKED:

يجب تسجيل:

```text
Blocker
Owner
Dependency
Date Started
Expected Resolution Path
Impact
Affected Tasks
Workaround
```

لا يسمح بترك blocker بدون owner.

---

# 48. قاعدة "VERIFIED_IN_PRODUCTION"

هذه هي أعلى حالة.

لا تستخدم إلا بعد:

- deployment successful
- smoke successful
- telemetry verified
- business flow verified
- no immediate regression
- evidence stored

---

# 49. سجل التغييرات الإلزامي للـRoadmap

في نهاية الوثيقة، حافظوا على:

```markdown
## CHANGE LOG

| Date | PR | Commit | Owner | Change | Tasks | Evidence |
|---|---|---|---|---|---|---|
```

كل PR ناجح يضيف صفًا.

---

# 50. قالب تحديث خارطة الطريق في كل PR

```markdown
## Roadmap Update

### Completed
- WASLA-XXXX
- WASLA-XXXX

### In Progress
- WASLA-XXXX

### Newly Discovered
- WASLA-XXXX

### Blocked
- None

### Evidence
- CI pipeline:
- E2E:
- Security scan:
- Performance:

### Documentation
- Updated:
  - docs/...
  - roadmap/...

### Completion Impact
Before: XX%
After: YY%

### Risks
- None
```

---

# 51. منع ضياع العمل

أي عمل اكتشف أثناء التنفيذ ولم يكن في الخارطة:

**لا ينفذ بشكل صامت.**

يضاف كـTask جديد:

```text
DISCOVERED → TRIAGED → PRIORITIZED → SCHEDULED
```

حتى لو كان bug صغيرًا.

---

# 52. قاعدة الـScope Creep

أي طلب جديد:

- لا يدخل في منتصف Phase بلا تقييم.
- يضاف Task.
- يحدد impact.
- يراجع dependency.
- يحدد هل يؤخر launch أم لا.
- يحدد هل هو blocker أم post-launch.

---

# 53. قاعدة الـArchitecture Decision

أي تغيير يؤثر في:

- service boundary
- database ownership
- event contracts
- API ownership
- authorization model
- deployment topology
- AI autonomy
- data residency
- tenancy

يحتاج ADR.

---

# 54. قاعدة الـRelease

لا يحق لأي Release تجاوز:

```text
Security Gate
+
Test Gate
+
Migration Gate
+
Operational Gate
+
Roadmap Gate
```

---

# 55. Definition of Ready

المهمة تصبح READY عندما:

- [ ] scope واضح.
- [ ] acceptance criteria واضحة.
- [ ] dependencies معروفة.
- [ ] owner محدد.
- [ ] contract معروف.
- [ ] tests strategy معروفة.
- [ ] documentation impact معروف.

---

# 56. Definition of Done

المهمة تصبح DONE فقط عندما:

- [ ] implementation complete.
- [ ] negative paths tested.
- [ ] security impact reviewed.
- [ ] contract updated.
- [ ] database/migration handled.
- [ ] tests green.
- [ ] CI green.
- [ ] docs updated.
- [ ] roadmap updated.
- [ ] PR merged.
- [ ] evidence recorded.

---

# 57. Definition of Production Ready

Feature ليست Production Ready حتى:

- [ ] Auth.
- [ ] Authorization.
- [ ] Data safety.
- [ ] observability.
- [ ] alerts.
- [ ] failure behavior.
- [ ] rollback.
- [ ] performance.
- [ ] runbook.
- [ ] E2E.
- [ ] operational owner.

---

# 58. Definition of Launch Ready

المشروع Launch Ready عندما:

```text
All Critical Features
+
All Critical Platform
+
All Security Gates
+
All Recovery Gates
+
All Operational Gates
+
All Business Gates
+
All Release Gates
= PASS
```

ولا يوجد استثناء مخفي.

---

# 59. المؤشر النهائي للمشروع

## لا تستخدموا رقم 43.3% وحده

الـ43.3% هو تقدير roadmap-weighted مبني على اكتمال مراحل، وليس قياسًا مباشرًا لمدى نجاح الـProduct.

يجب متابعة 4 مؤشرات منفصلة:

### 1. Core Engineering Completion
مدى اكتمال الخدمات الأساسية.

### 2. Product Completion
مدى اكتمال تجربة المستخدم والخصائص التجارية.

### 3. Production Platform Completion
البنية الأمنية والتشغيلية والمراقبة والنشر والاستعادة.

### 4. Launch Gate Completion
هل جميع شروط الإطلاق مقبولة أم لا؟

**قرار الإطلاق يعتمد على Launch Gate، وليس على متوسط النسب.**

---

# 60. الوضع الحالي مقابل الهدف

| المجال | الوضع الحالي | الهدف |
|---|---:|---:|
| Core domains | مرتفع | 100% |
| Phase 10 | ~83.3% | 100% |
| Marketplace | 0% | 100% |
| Search | 0% | 100% |
| Store/Delivery | 0% | 100% |
| Partner/Enterprise | 0% | 100% |
| Admin | 0% | 100% |
| Support | 0% | 100% |
| Billing | 0% | 100% |
| Auth/Authorization | غير مكتمل | 100% |
| Infrastructure | Placeholder-heavy | 100% |
| Observability | غير مكتمل | 100% |
| DR/Restore | غير مكتمل | 100% |
| Frontend | Placeholder-heavy | 100% |
| Performance proof | غير مكتمل | 100% |
| Saudi Launch | غير مكتمل | 100% |
| Launch Gate | FAIL | PASS |

---

# 61. ترتيب الأولويات المختصر للإدارة

## P0 الآن

1. Phase 10 Exit Gate.
2. Authentication.
3. Authorization.
4. Service Identity.
5. Production DB migrations.
6. Backup/Restore.
7. Infrastructure.
8. CI/CD security gates.

## P1 بعدها

9. Observability.
10. Reliability.
11. Marketplace.
12. Search.
13. Store/Delivery.
14. Partner.
15. Admin.
16. Support.
17. Billing.
18. Frontends.

## P2 قبل الإطلاق

19. Load.
20. Chaos.
21. DR.
22. Security certification.
23. Saudi Launch.
24. Runbooks.
25. RC.
26. Launch.

---

# 62. بوابة الإيقاف الفوري

يجب إيقاف أي Release إذا ظهر أحد الآتي:

- P0 security issue.
- unauthenticated production boundary.
- migration غير قابلة للإعادة.
- backup غير قابل للاستعادة.
- data corruption.
- unknown authorization behavior.
- critical E2E failure.
- critical production observability failure.
- artifact غير قابل لإعادة البناء.
- rollback غير ممكن.

---

# 63. قاعدة المسؤولية

كل Task له **Owner واحد** فقط.

يمكن وجود عدة Contributors، لكن:

```text
One Task = One Accountable Owner
```

الـOwner مسؤول عن:

- التنفيذ.
- الاختبارات.
- التوثيق.
- الأدلة.
- تحديث Roadmap.
- التنسيق مع أصحاب المصلحة.
- عدم إعلان الإنجاز مبكرًا.

---

# 64. قاعدة المراجعة الأسبوعية

كل أسبوع يجب إنشاء تقرير:

```text
Completed
In Progress
Blocked
New Risks
New Bugs
Security Changes
DB Changes
API Changes
Infra Changes
Test Results
Completion Delta
Next Week
```

ويجب أن يكون مشتقًا مباشرة من Roadmap، وليس وثيقة منفصلة متناقضة معها.

---

# 65. قاعدة نهاية كل Phase

لا تغلق Phase إلا بعد:

```text
Implementation
→ Tests
→ Integration
→ Security
→ Docs
→ CI
→ Operational readiness
→ Exit Gate
→ Roadmap update
```

---

# 66. خطة التنفيذ التشغيلية المقترحة

## Sprint Group 1
**Foundation Closure**

- Phase 10
- Auth design
- Authorization design
- DB migration design
- CI gaps

## Sprint Group 2
**Security + Platform**

- Gateway
- Service Identity
- Auth
- Authorization
- Secrets
- deployment skeleton

## Sprint Group 3
**Database + Reliability**

- migrations
- backup
- restore
- readiness
- graceful shutdown
- retries
- resilience

## Sprint Group 4
**Marketplace + Search**

## Sprint Group 5
**Store + Delivery**

## Sprint Group 6
**Partner + Admin + Support**

## Sprint Group 7
**Billing + Frontends**

## Sprint Group 8
**Security Certification + Performance + DR**

## Sprint Group 9
**Saudi Launch + Operational Readiness**

## Sprint Group 10
**Release Candidate + Production Launch**

---

# 67. المخرجات الإلزامية النهائية

عند الإطلاق يجب أن يحتوي المستودع، أو مستودع docs المرتبط به، على:

- [ ] architecture documentation
- [ ] API specifications
- [ ] event contracts
- [ ] database schema
- [ ] migrations
- [ ] deployment manifests
- [ ] environment catalog
- [ ] secrets policy
- [ ] test strategy
- [ ] security assessment
- [ ] performance report
- [ ] DR test report
- [ ] backup/restore evidence
- [ ] runbooks
- [ ] incident response
- [ ] support playbooks
- [ ] release notes
- [ ] roadmap current snapshot
- [ ] launch sign-off
- [ ] production verification report

---

# 68. القرار الحاكم

**لا يوجد إطلاق لأن "معظم الكود مكتمل".**

يوجد إطلاق فقط عندما:

> **الكود + العقود + قاعدة البيانات + الأمن + البنية التحتية + الاختبارات + المراقبة + الاستعادة + التشغيل + التوثيق + Business Acceptance + Roadmap Evidence = كلها مكتملة ومثبتة.**

---

# 69. الحالة الابتدائية للـRoadmap

```text
ROADMAP STATUS: ACTIVE
PROJECT STATE: CORE IMPLEMENTED / PLATFORM INCOMPLETE
PRODUCTION READY: NO
ENTERPRISE READY: NO
CURRENT ROADMAP-WEIGHTED COMPLETION: ~43.3%
CURRENT CRITICAL BLOCKER: AUTHENTICATION / AUTHORIZATION / PRODUCTION PLATFORM
NEXT MANDATORY GATE: PHASE 10 EXIT GATE
```

---

# 70. قاعدة لا تتغير

**مع كل Push/Commit/PR: حدّث خارطة الطريق.**

يجب أن يعرف أي شخص يدخل المشروع بعد ساعة واحدة فقط:

1. ماذا تم؟
2. ماذا لم يتم؟
3. ماذا يعمل عليه الآخرون؟
4. ما الذي يمنعهم؟
5. ما الاختبارات التي أثبتت الإنجاز؟
6. ما الملفات والـAPIs وقاعدة البيانات التي تغيرت؟
7. ما المخاطر الجديدة؟
8. ما الخطوة التالية؟
9. ما الذي يحتاج مراجعة؟
10. ما الذي أصبح جاهزًا للإطلاق؟

إذا لم تستطع خارطة الطريق الإجابة عن هذه الأسئلة، فمعنى ذلك أن **عملية المشروع نفسها معطلة** ويجب إصلاحها قبل الاستمرار في إضافة Features.

---

# APPENDIX A — نموذج Task كامل

```markdown
# WASLA-XXXX

## Title
...

## Phase
...

## Owner
...

## Objective
...

## Scope
...

## Out of Scope
...

## Dependencies
...

## Acceptance Criteria
- [ ] ...
- [ ] ...

## Implementation
- [ ] ...

## Tests
- [ ] Unit
- [ ] Integration
- [ ] Contract
- [ ] E2E
- [ ] Security

## Documentation
- [ ] Architecture
- [ ] API
- [ ] ADR
- [ ] Runbook

## Database
- [ ] No change
- [ ] Schema
- [ ] Migration
- [ ] Rollback

## Security
- [ ] Auth
- [ ] Authorization
- [ ] Secrets
- [ ] Threat model

## Operational
- [ ] Metrics
- [ ] Logs
- [ ] Alerts
- [ ] Readiness
- [ ] Runbook

## Evidence
- PR:
- Commit:
- CI:
- Test Report:
- Screenshots/Logs:

## Risks
...

## Status
PLANNED
```

---

# APPENDIX B — نموذج Phase Exit Gate

```markdown
# PHASE XXXX EXIT GATE

## Scope
...

## Completed Tasks
...

## Open Tasks
...

## Critical Bugs
...

## Security
PASS / FAIL

## Database
PASS / FAIL

## API
PASS / FAIL

## Tests
PASS / FAIL

## E2E
PASS / FAIL

## CI
PASS / FAIL

## Documentation
PASS / FAIL

## Operations
PASS / FAIL

## Release Evidence
...

## Owner Sign-off
...

## Final Decision
PASS / BLOCKED
```

---

# APPENDIX C — Launch Board النهائي

```text
[ ] Phase 10
[ ] Authentication
[ ] Authorization
[ ] Service Identity
[ ] Gateway
[ ] Database migrations
[ ] Backup
[ ] Restore
[ ] Marketplace
[ ] Search
[ ] Store Orders
[ ] Delivery
[ ] Partner
[ ] Admin
[ ] Support
[ ] Billing
[ ] Frontends
[ ] Observability
[ ] Reliability
[ ] Security Certification
[ ] Load Test
[ ] Chaos Test
[ ] DR Test
[ ] Runbooks
[ ] Saudi Readiness
[ ] Business Acceptance
[ ] Release Candidate
[ ] Final Gate
[ ] Production Deployment
[ ] Post-Launch Verification
```

---

# APPENDIX D — قاعدة تحديث سنوية/مرحلية

لا يكفي تحديث الوثيقة عند الإطلاق.

بعد كل:

- Phase
- major feature
- security change
- schema change
- deployment architecture change
- significant incident

يجب إعادة تقييم:

- architecture
- completion
- dependencies
- risks
- launch gates
- technical debt
- roadmap

---

## الوثيقة الحاكمة

هذه الخارطة تصبح **مرجع التنفيذ الموحد**، ويجب ألا توجد خارطة محلية مختلفة للفريق إلا إذا كانت مشتقة منها وتحمل روابط إلى `Task IDs`.

**أي حالة غير موجودة في Roadmap تعتبر غير معروفة من منظور إدارة البرنامج.**
