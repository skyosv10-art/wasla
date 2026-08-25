# وَصْلة — نظام حوكمة العمل (نقطة الدخول الإلزامية)

**الحالة:** إلزامي · **آخر تحديث:** `2026-08-25`

هذه أول وثيقة يقرؤها أي شخص أو وكيل قبل كتابة سطر واحد في هذا المستودع.
النظام كله يقوم على قاعدة واحدة:

> **لا يوجد عمل في وَصْلة خارج خارطة الطريق، ولا عمل بلا حجز نشط، ولا دمج بلا تحديث السجلات.**

---

## 1. ترتيب السلطة (Authority Order)

عند أي تعارض بين وثيقتين، الأعلى في القائمة يفوز، والأدنى يُصحَّح في نفس المراجعة:

| # | المرجع | سلطته |
|---|---|---|
| 1 | [`LAUNCH_TO_100_ROADMAP.md`](LAUNCH_TO_100_ROADMAP.md) | النطاق، البوابات، تعريف 100%، القانون الحاكم |
| 2 | [`LAUNCH_EXECUTION_BOARD.md`](LAUNCH_EXECUTION_BOARD.md) | حالة كل عنصر عمل الآن، ودليل إكماله |
| 3 | [`WORK_CLAIMS.md`](WORK_CLAIMS.md) | من يملك أي نطاق الآن (منع التكرار) |
| 4 | [`TASK_LOG.md`](TASK_LOG.md) | السجل الزمني لما حدث فعلًا |
| 5 | `docs/00-rules/*` | القواعد الهندسية الملزمة |
| 6 | `docs/15-decisions/ADR-*` | القرارات المعمارية |
| 7 | باقي `docs/**` و[`ROADMAP.md`](ROADMAP.md) و[`MASTER_PROGRESS.md`](MASTER_PROGRESS.md) | مراجع تابعة، لا تنشئ سلطة |

`HANDOFF_NEXT_STEPS.md` سجل تاريخي للتسليم: يُقرأ للسياق، **ولا يُستشهد به كحالة**.

---

## 2. خريطة السجلات — أي ملف يجيب أي سؤال

| السؤال | الملف |
|---|---|
| ما الذي يجب بناؤه، وبأي ترتيب، وما بوابة القبول؟ | [`LAUNCH_TO_100_ROADMAP.md`](LAUNCH_TO_100_ROADMAP.md) |
| ما حالة العنصر الآن، ومن يملكه، وما دليل إكماله؟ | [`LAUNCH_EXECUTION_BOARD.md`](LAUNCH_EXECUTION_BOARD.md) |
| **هل أحد يعمل على هذا الملف/النطاق الآن؟** | [`WORK_CLAIMS.md`](WORK_CLAIMS.md) |
| **من يملك هذه المنطقة من الكود عمومًا؟** | [`WORK_INDEX.md`](WORK_INDEX.md) |
| ماذا حدث في الدفعة السابقة وما الدليل؟ | [`TASK_LOG.md`](TASK_LOG.md) |
| ما إجراء يومي العمل خطوة بخطوة؟ | [`ROADMAP_OPERATING_PROTOCOL.md`](ROADMAP_OPERATING_PROTOCOL.md) |
| ما تسلسل المراحل Phase 00–24؟ | [`ROADMAP.md`](ROADMAP.md) |
| ما ملخص المراحل والبوابات؟ | [`MASTER_PROGRESS.md`](MASTER_PROGRESS.md) |

---

## 3. محورا الترقيم — لا تخلط بينهما

| المحور | يعني |
|---|---|
| **Phase 00 → 24** | تسلسل بناء المجال والمنتج (`ROADMAP.md`) |
| **M0 → M7** | معالم جاهزية الإطلاق (`LAUNCH_EXECUTION_BOARD.md`) |

المعرّف المستخدم في كل commit و MR وسجل هو **معرّف اللوحة `Mx-yy`**. جدول التطابق الكامل في القسم `0.14` من الخارطة. المعالم القديمة `M0–M5` في `ROADMAP.md` ملغاة كمعرّفات.

---

## 4. دورة العمل الإلزامية (7 خطوات)

```text
1) ابحث أولًا      bash scripts/checks/find-existing-work.sh "marketplace"
2) اختر عنصرًا     من اللوحة فقط — لا عمل بلا Mx-yy
3) احجز            سطر جديد في WORK_CLAIMS.md (نطاق بمسارات + فرع + تاريخ انتهاء)
4) اعمل            داخل النطاق المحجوز فقط
5) وثّق            TASK_LOG.md + تحديث حالة العنصر في اللوحة + دليل قابل للتحقق
6) تحقق            bash scripts/checks/verify-governance.sh
7) بعد الدمج       حرّر الحجز (Released) وحدّث WORK_INDEX.md
```

خطوة 1 غير قابلة للتفاوض: **هي التي تمنع أن تبني جهتان نفس الشيء.**

---

## 5. الفحوصات الآلية (تُرفض المخالفة، لا تُنبَّه)

| السكربت | يمنع |
|---|---|
| `scripts/checks/find-existing-work.sh` | بدء عمل موجود مسبقًا (أداة بحث إلزامية) |
| `scripts/checks/validate-work-claims.sh` | حجز مزدوج · تقاطع نطاقات · عمل خارج النطاق · حجز منتهٍ |
| `scripts/checks/validate-launch-board.sh` | حالة غير معتمدة · ID مكرر · `Completed` بلا دليل |
| `scripts/checks/require-doc-update.sh` | دفع كود بلا تحديث `TASK_LOG` واللوحة |
| `scripts/checks/scan-secrets.sh` | دخول أسرار إلى الشجرة |
| `scripts/checks/verify-governance.sh` | **المدخل الموحّد لكل ما سبق** |

تُنفَّذ في ثلاث طبقات: `scripts/hooks/pre-push` محليًا، ووظيفة `governance-guard` في `.gitlab-ci.yml`، ومراجعة `CODEOWNERS`.

```bash
pnpm run governance:verify      # الفحص الكامل
pnpm run work:find -- marketplace   # البحث قبل البدء
```

---

## 6. القواعد الملزمة ذات الصلة

- [`docs/00-rules/WORK_CLAIM_RULE.md`](../00-rules/WORK_CLAIM_RULE.md) — قاعدة الحجز ومنع التكرار
- [`docs/00-rules/PUSH_DOCUMENTATION_RULE.md`](../00-rules/PUSH_DOCUMENTATION_RULE.md) — لا دفع بلا توثيق
- [`docs/00-rules/DEFINITION_OF_DONE.md`](../00-rules/DEFINITION_OF_DONE.md) — لا Done بلا دليل
- [`docs/00-rules/ENGINEERING_DOCUMENTATION_LAW.md`](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md)
- [`docs/00-rules/GIT_RULES.md`](../00-rules/GIT_RULES.md) · [`docs/00-rules/SECURITY_RULES.md`](../00-rules/SECURITY_RULES.md)
- القرار المعماري المؤسِّس لهذا النظام: [`ADR-017`](../15-decisions/ADR-017-unified-roadmap-governance-and-work-claim-system.md)
