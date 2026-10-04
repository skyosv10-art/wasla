# قاعدة تزامن حالة المشروع — STATE-SYNC (إلزامية)

> **الحالة:** مُلزِمة · مفروضة آليًا · **سارية من:** 2026-10-04 · **القرار:** [ADR-061](../15-decisions/ADR-061-state-sync-invariant.md) · **عنصر العمل:** `M0-52` · **الحجز:** `CLM-0467`
> **الحارسان:** `scripts/checks/validate-state-sync.sh` (الفحص 26) · `scripts/checks/validate-merged-branches.sh` (الفحص 27)
> **الخريطة:** [`scripts/checks/lib/state-sync-map.json`](../../scripts/checks/lib/state-sync-map.json) · **المنطق:** [`scripts/checks/lib/state_sync.py`](../../scripts/checks/lib/state_sync.py)
> **أين يعملان:** `scripts/hooks/pre-push` محليًا · `verify-governance.sh` ومنه وظيفتا CI الإلزاميتان `governance-guard` و`verify` · سير العمل `merged-branch-cleanup.yml`

هذه الوثيقة هي **المرجع الأول والإلزامي لأي وكيل أو مساهم يدخل المشروع**. من لم يقرأها لا يبدأ عملًا.

---

## 1. المشكلة التي أنشأت هذه القاعدة (مقيسة لا مفترضة)

نعمل بالتسلسل: يعمل وكيل A، ثم ينتهي (أحيانًا بنفاد رصيده)، فيستلم وكيل B. وكان B يجد في `main` كودًا جديدًا وحالةً قديمة، فيعيد عملًا منجزًا أو يتركه ناقصًا. وهذا ما وُجد على `main` في 2026-10-04 (`4cafdc6`) قبل هذه القاعدة:

| العَرَض | المقيس |
|---|---|
| إدخالاتٌ في `TASK_LOG.md` تقول «PR pending» عن عملٍ مدموج | **20 إدخالًا** (منها `CLM-0462`…`CLM-0466` من اليوم نفسه) |
| حجزٌ `Active` لعملٍ مدموج | `CLM-0461`: PR #610 مدموج والحجز ما زال `Active` |
| فرعٌ مدموجٌ لم يُحذف | `docs/clm-0461-risk-0042-wave3` |
| «طلبُ تحريرٍ» منفصلٌ بعد كل دمج | نمطٌ ثابت: #612 #614 #616 #618 #620 — والدمجُ الأول يُحمِّر `main` كل مرة (الفحص 4) حتى يأتي الثاني |

**السبب الجذري:** كانت الحالة تُكتب **قبل** الدمج بصيغة «سيحدث» (`Active` · «PR pending»)، ثم يُنتظر طلبٌ ثانٍ ليُصحِّحها. فإن انقطع الوكيل بين الطلبين بقيت الحالة كاذبة إلى الأبد. والفحوص القائمة كانت تسأل «هل لُمِس السجل؟» لا «هل يصف السجلُّ ما سيكون صحيحًا لحظةَ الدمج؟».

## 2. الثابت (Invariant)

```text
NO STATE-SYNC → NO PUSH/MERGE

IMPLEMENTATION + TESTS + EVIDENCE + PROJECT-STATE = ONE COMPLETE CHANGE
MERGE → DELETE MERGED BRANCH
```

**قاعدة المشروع الأساسية:** أي تغيير ذي معنى في المستودع يجب أن يصل إلى المستودع ومعه، في نفس عملية الدفع/PR والدمج، جميع تحديثات الحالة والتقدم والحوكمة والوثائق التي تعكس ما تم إنجازه. ممنوع دفع الكود وحده ثم تسجيل التقدم لاحقًا.

**ثابت التسليم (Handoff invariant):** لا يكتمل العمل عند انتهاء الكود. يكتمل فقط حين تكون `implementation + tests + evidence + project state` متزامنةً وموجودةً في **نفس المسار المراجَع** (نفس PR). وكل ما في الـPR يُكتب **بصيغة ما سيكون صحيحًا لحظة دمجه**، لأن الـPR لا يبلغ `main` إلا بالدمج.

**المستودع هو المصدر الوحيد للحقيقة:** الوكيل الجديد يعرف آخر حالة من `main` نفسه (§8)، لا من ذاكرة وكيل سابق ولا محادثة ولا تقرير خارجي ولا رسالة من المالك.

## 3. دورة العمل الإلزامية

```text
BEFORE WORK → WORK → UPDATE PROJECT STATE → VERIFY → PUSH/PR → MERGE → DELETE MERGED BRANCH
```

| المرحلة | ما يُفعل | الأمر |
|---|---|---|
| **BEFORE WORK** | اقرأ الحالة من `main`: حجوزات مفتوحة؟ فروع/PRs مفتوحة؟ آخر الإدخالات والخطوة التالية؟ ابحث عن عمل موجود. أنشئ فرعًا من `main`. | `bash scripts/state/current-state.sh` · `bash scripts/checks/find-existing-work.sh "<المجال>"` |
| **WORK** | اكتب الكود والاختبارات. أضف صف الحجز لفرعك (`Active` أثناء العمل المحلي). | — |
| **UPDATE PROJECT STATE** | حدّث كل سجل تأثر (§5): أغلق صف الحجز (`Released` مع ما أُنجز) · إدخال `TASK_LOG` · صف اللوحة · سطر `ROADMAP.md` · سجل المخاطر · `BASELINE.json` · ADR/الأدلة. **بصيغة ما بعد الدمج.** | — |
| **VERIFY** | شغّل الحارس ثم البوابة كلها. | `bash scripts/checks/validate-state-sync.sh` ثم `bash scripts/checks/verify-governance.sh` |
| **PUSH/PR** | ادفع وافتح PR فورًا (مسودة مقبولة). الدفع الأول يحمل الحالة كاملة. | `git push` (يشغّل `pre-push`) · `gh pr create` |
| **MERGE** | فقط حين CI أخضر بالكامل ومراجعة CODEOWNERS موافقة. | `gh pr merge <N> --squash --delete-branch` |
| **DELETE MERGED BRANCH** | يُحذف آليًا (`delete_branch_on_merge` + `merged-branch-cleanup.yml`)، ثم تحقّق. | §7 |

## 4. الحجز في النموذج التسلسلي

الحجوزات هنا **ليست قفلًا لمنع التوازي** — نحن لا نعمل بالتوازي. الحجز يعلن نطاق الـPR ويربط الكود بعنصر العمل. لذلك:

1. يُضاف صف الحجز **في الـPR نفسه**، ويُغلَق **في الـPR نفسه**: الحالة `Released` وعمود الملاحظات يقول ما أنجزه هذا الـPR. الدمج هو التحرير. **لا طلب تحريرٍ بعد الدمج** (يُلغي §8.1 القديم في `ROADMAP_OPERATING_PROTOCOL.md` بالإضافة لا بالمحو).
2. `validate-work-claims.sh` (الفحص 2) يقبل صف الفرع المُغلَق **إن كان سطره مضافًا أو معدّلًا في نطاق الـPR نفسه**، ويقيس احتواء الملفات على نطاقه كما كان. صفٌّ `Released` قديم لا يغطي شيئًا.
3. العمل الذي يحتاج أكثر من PR: كل PR يُغلق حجزه، والإدخال يقول `**Status:** In Progress` مع `**Next:**` صريح. هذه حالة صادقة على `main` (العنصر جارٍ، والجزء المدموج منجز)، وليست حالة بائتة.
4. إن توقف الوكيل قبل الدفع: لا شيء على `main` تغيّر، والحقيقة سليمة. وإن توقف بعد فتح PR: الـPR المفتوح وفرعه ظاهران للوكيل التالي (`current-state.sh` يعرضهما، والفحص 23 يحرسهما)، ولا يُدمج حتى تكتمل حالته.

## 5. الخريطة: نوع التغيير ← السجلات الحاكمة الواجب تحديثها

المصدر الوحيد: [`state-sync-map.json`](../../scripts/checks/lib/state-sync-map.json). كل مسار مُعدّل يجب أن يطابق فئةً واحدةً على الأقل. ويمكن أن يطابق أكثر من فئة، فتُجمع متطلباتها (`packages/authz-policy/` تنفيذٌ **وأمن**).

**مسارٌ لا يطابق أي فئة ⇒ `BLOCKED — REVIEW REQUIRED`، لا `PASS`.** إضافة فئة تكون بتعديل الخريطة مع حالة طفرة في `gov-cases-state-sync.sh` وسطر في هذا الجدول.

| الفئة | المسارات (ملخص) | المتطلبات |
|---|---|---|
| `implementation` | `services/ packages/ apps/ bots/` · `package.json` · `pnpm-lock.yaml` · `tsconfig.json` · `.env.example` | claim · task_log · board · roadmap · units · **tests** |
| `security` | `packages/service-auth/` · `packages/authz-policy/` · `services/*/src/http/service-identity*.ts` · `infra/secrets/` · `docs/07-security/` · `SECURITY.md` · `CODEOWNERS` · حراس الأسرار والتفويض | claim · task_log · board · **risk_sync** |
| `governance` | `scripts/checks/` · `scripts/hooks/` · `.github/` · `.gitlab*` · `docs/00-rules/` · `docs/15-decisions/` · `CODEOWNERS` | claim · task_log · board · roadmap · units · **guard_documented** |
| `deployment` | `infra/` · `Dockerfile` · `render.yaml` · سكربتات النشر · سير عمل النشر/النسخ/الاستعادة | claim · task_log · board · roadmap · units · **evidence_field** |
| `scripts` | باقي `scripts/` | claim · task_log · board · roadmap · units |
| `documentation` | `docs/` (غير السجلات) · `README.md` · `CONTRIBUTING.md` | claim · task_log · board |
| `repo-meta` | `.gitignore` · `.editorconfig` · … | claim · task_log |
| `ledger` | `TASK_LOG` · `LAUNCH_EXECUTION_BOARD` · `WORK_CLAIMS` · `WORK_INDEX` · `MASTER_PROGRESS` · `ROADMAP.md` | تغييرٌ من هذه وحدها = تغيير حالة فقط (§9) |

**تعريف كل متطلب (ما يقيسه الحارس فعلًا، لا مجرد لمس الملف):**

| المتطلب | يمرّ فقط إذا |
|---|---|
| `claim` | يوجد صف حجز لفرع الدفع، **وسطره معدّلٌ في الـPR**، **وحالته `Released`/`Cancelled`** (لا `Active`)، وملاحظته ≥ 20 حرفًا. |
| `task_log` | أُضيف إدخال يذكر **معرّف الحجز**، و`**Work Item(s):**` يحوي عنصر الحجز، و`**Status:**` موجود و**ليس بائتًا** (`PR pending`، `in review`، `بانتظار الدمج`…)، وكل مسار دليل بين علامتي `` ` `` موجود فعلًا في رأس الـPR. |
| `units` | الإدخال يسمّي **كل وحدة معدّلة** (`services/dispatch` أو `dispatch` أو اسم الملف المعدّل). |
| `board` | سطر صف العنصر (`\| M0-52 \|`) معدّلٌ في الـPR. |
| `roadmap` | سطر مضاف في `ROADMAP.md` يذكر معرّف الحجز. |
| `tests` | تغيّر ملف اختبار، أو الإدخال يحمل `**No-Test-Reason:**` مسببًا (يراه مراجع CODEOWNERS). |
| `risk_sync` | الإدخال يحمل `**Risk(s):** RISK-NNNN → <status>` و**كل حالة مذكورة تساوي حالة الخطر في `RISK_REGISTER.md` عند رأس الـPR**، أو `**Risk(s):** none — <سبب>`. فإصلاح أمني يقول `closed` والسجل يقول `open` ⇒ **BLOCKED**. |
| `evidence_field` | `**Evidence:**` (تشغيل/رابط/أثر) و`**Deployment:**` (الأثر الحي أو «none — لماذا»). |
| `guard_documented` | كل حارس **جديد** في `scripts/checks/` مذكورٌ باسمه في وثيقة من `docs/00-rules/` أو `docs/15-decisions/`. |
| (دائمًا) | ملفٌّ حُذف أو أُعيدت تسميته لا يزال مذكورًا في `scripts/` أو `.github/` أو `docs/00-rules/` أو `CODEOWNERS` أو `package.json` ⇒ **BLOCKED**. |

## 6. قائمة إلزامية قبل PUSH/PR

```text
[ ] implementation completed
[ ] tests completed
[ ] evidence captured where required
[ ] all affected project-state files updated
[ ] claims/status/tasks synchronized
[ ] risks synchronized
[ ] roadmap/status synchronized where affected
[ ] no stale "in progress" state remains for completed work
[ ] no completed work is missing from project records
[ ] final diff reviewed            (git diff origin/main...HEAD --stat ثم المحتوى)
[ ] governance guard PASS         (bash scripts/checks/validate-state-sync.sh → PASS — project state synchronized)
```

ثم فقط: **PUSH / PR**.

## 7. بعد الدمج

```text
[ ] merge confirmed                 (gh pr view <N> --json state,mergeCommit)
[ ] main CI PASS                    (gh run list --branch main --limit 1)
[ ] merged branch deleted           (delete_branch_on_merge · merged-branch-cleanup.yml)
[ ] stale branch check PASS         (bash scripts/checks/validate-merged-branches.sh)
[ ] project state on main matches implementation   (bash scripts/state/current-state.sh)
```

**آلية حذف الفروع:** `PR merged → verify merge → delete merged branch → verify deletion`

1. **إعداد المستودع** `delete_branch_on_merge = true`: يحذف GitHub فرع الرأس لحظة الدمج.
2. **سير العمل** `.github/workflows/merged-branch-cleanup.yml`: عند إغلاق PR مدموج يتحقق من الدمج عبر الـAPI، ويحذف الفرع إن بقي (إلا إن وُجد في `BRANCH_EVIDENCE.md` بسبب مكتوب)، ثم **يتحقق من الحذف**، ثم يشغّل الفحص 27. ويعمل يوميًا كمسح شامل.
3. **الفحص 27** (`validate-merged-branches.sh`) في كل PR وكل دفع إلى `main`: يفشل إن بقي **فرع مدموج بلا تعديل بعد الدمج** وبلا سبب موثق، أو إن بقي **حجز `Active` لفرع دُمج طلبه** ولا طلب مفتوح له. وفي CI تعذُّر قراءة المنصة إخفاق لا تخطٍّ.
4. **الاستثناء الوحيد** لبقاء فرع مدموج: صفٌّ في [`BRANCH_EVIDENCE.md`](../16-progress/BRANCH_EVIDENCE.md) بالفرع والسبب والتاريخ.

## 8. كيف يعرف الوكيل الجديد الحالة

بالترتيب، ومن `main` وحده:

1. `bash scripts/state/current-state.sh`: يشتق من السجلات (لا يخزّن شيئًا فلا يبيت): الحجوزات المفتوحة (يجب أن تكون صفرًا بين وكيلين)، وآخر الإدخالات بحالتها و`Next`، وعناصر اللوحة غير المكتملة، والمخاطر غير المغلقة، والـPRs والفروع المفتوحة، وآخر حكم CI على `main`.
2. إن وُجد PR مفتوح أو فرع: هو عمل غير مكتمل، ويُستأنف منه ولا يُعاد من الصفر.
3. ثم [`LAUNCH_EXECUTION_BOARD.md`](../16-progress/LAUNCH_EXECUTION_BOARD.md) و`ROADMAP.md` و[`ROADMAP_OPERATING_PROTOCOL.md`](../16-progress/ROADMAP_OPERATING_PROTOCOL.md).

## 9. ممنوع: طلب «تدارك التوثيق» المنفصل

```text
PR #A implementation   ← ممنوع إن لم يحمل حالته
PR #B later docs fix   ← ممنوع
```

- الحارس على PR #A يمنعه من الدمج بلا حالته، فلا يبقى ما يُتدارك.
- **تغيير يمس السجلات وحدها** (فئة `ledger`) يُمنع افتراضيًا بـ: `BLOCKED: state-only change without a declared, reasoned kind`. وإن كان «إفراجًا» عن حجز بعد دمجه يقول الحارس صراحةً إن الإفراج مكانه طلب التنفيذ.
- يُقبل فقط إن صرّح الإدخال الجديد بنوعه وسببه (≥ 20 حرفًا): `**Kind:** state-correction — <ما الخطأ المقيس وأي سجل يصحّح>` أو `**Kind:** owner-decision — <القرار ومرجعه>`. والتصريح يراه مراجع CODEOWNERS.
- والطلب الذي يغيّر الكود ولا يغيّر الحالة إطلاقًا **لا يوجد**: كل فئات الكود تتطلب `claim` و`task_log` على الأقل.

## 10. حقول الإدخال التي يقرؤها الحارس

```md
# YYYY-MM-DD — CLM-NNNN — Mx-yy: <عنوان>

- **Work Item(s):** Mx-yy
- **Status:** Completed | In Progress | Ready for Gate | Blocked   (بصيغة ما بعد الدمج؛ التاريخ يُحفظ هكذا: <قديم> → <جديد>)
- **Risk(s):** RISK-0042 → open            (للتغييرات الأمنية؛ أو: none — <سبب>)
- **Evidence:** <run/URL/artifact>         (إلزامي للنشر والبنية)
- **Deployment:** <الأثر الحي أو none — لماذا>
- **No-Test-Reason:** <سبب>               (فقط إن تغير كود بلا اختبار)
- **Kind:** state-correction — <سبب>       (فقط لتغيير السجلات وحدها)
- **Next:** <الخطوة التالية>
```

حقل `Status` يُقرأ على **آخر مقطع بعد `→`**، فيُحفظ تاريخ السطر ولا يُمحى (التصحيح بالإضافة).

## 11. طبقات الإنفاذ

| الطبقة | ماذا | قابل للتجاوز؟ |
|---|---|---|
| `scripts/hooks/pre-push` | `validate-state-sync.sh origin/main <local>` لكل دفع إلى غير `main` | نعم (`--no-verify`)، وهذه الطبقة للتنبيه المبكر فقط |
| `verify-governance.sh` الفحص 26 و27 | يعمل في `governance-guard` و`verify`، **وكلاهما سياق إلزامي في حماية `main`** | لا: `enforce_admins: true` + CODEOWNERS |
| `merged-branch-cleanup.yml` | حذف وتحقق ومسح يومي | — |
| `test-governance.sh` ← `gov-cases-state-sync.sh` | يثبت أن الحارس **يرفض فعلًا** (حالات A–F وما بعدها) | — |

ولا يُضعف شيء من هذا حارسًا قائمًا: الفحص 3 (`require-doc-update.sh`) و«Roadmap freshness» باقيان كما هما، والفحص 26 يضيف عليهما قياس **المعنى**.

## 12. حدود الإنفاذ الآلي (بصراحة)

- **صدق المحتوى لا يُقاس آليًا.** الحارس يقيس الترابط: الحجز نفسه، والعنصر نفسه، والوحدات مسمّاة، والحالة ليست بائتة، والمخاطر مطابقة، والأدلة موجودة. ولا يستطيع أن يحكم بأن ما كُتب صحيح هندسيًا. ذلك لمراجع CODEOWNERS.
- **`Kind: state-correction` و`No-Test-Reason` و`Risk(s): none`** منافذ مُعلَنة لا صامتة: تمر بسبب مكتوب، والحكم على السبب بشري.
- **الدمج دون PR** ممنوع بحماية الفرع لا بهذا الحارس، وهذا الحارس لا يملك منع ما تسمح به إعدادات المنصة.
- **الفحص 27 يحتاج قراءة المنصة.** محليًا بلا `gh` يعلن `PARTIAL` (تخطٍّ لا نجاح)، وفي CI يفشل.
- **انقطاع الوكيل بعد الدفع وقبل الدمج** لا يُفسد `main`، لكن الـPR المعلّق يحتاج من يكمله. يظهر في `current-state.sh` والفحص 23 ولا يختفي.

## 13. ما تغيّر في الحوكمة القائمة (تصحيح بالإضافة)

- [`ROADMAP_OPERATING_PROTOCOL.md`](../16-progress/ROADMAP_OPERATING_PROTOCOL.md) §8.1 «بعد الدمج — إقفال الدورة»: صار الإقفال **داخل** طلب التنفيذ، ولا طلب تحرير بعده.
- [`WORK_CLAIM_RULE.md`](WORK_CLAIM_RULE.md) §5: دورة الحياة نفسها، والتحرير في الـPR.
- [`WORK_CLAIMS.md`](../16-progress/WORK_CLAIMS.md) §1: عمود الحالة يقبل `Released` لصف أُغلق في الـPR نفسه.
- `validate-work-claims.sh`: يقبل صف الفرع المُغلق في النطاق نفسه (§4-2).
