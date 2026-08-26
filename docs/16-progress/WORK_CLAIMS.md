# سجل حجز العمل (Work Claims) — إلزامي

**الحالة:** إلزامي · مفروض آليًا · **آخر تحديث:** `2026-08-25`
**المرجع الحاكم:** [`LAUNCH_TO_100_ROADMAP.md`](LAUNCH_TO_100_ROADMAP.md) §0.11 · [`docs/00-rules/WORK_CLAIM_RULE.md`](../00-rules/WORK_CLAIM_RULE.md)

> **الغرض:** أن يكون لكل منطقة عمل مالك واحد معلوم في كل لحظة، فلا تبني جهتان نفس الشيء ولا تتصادم جهتان على نفس الملفات.
>
> **القاعدة:** لا `commit` على أي فرع قبل وجود سطر حجز نشط بالفرع نفسه في جدول «الحجوزات النشطة» أدناه. الدفع الذي يمس ملفًا خارج نطاق حجز فرعه **يُرفض آليًا**.

---

## 1. كيف تحجز

```bash
# 1) ابحث أولًا — إلزامي
bash scripts/checks/find-existing-work.sh "marketplace"

# 2) أضف سطرًا في «الحجوزات النشطة» بنفس ترتيب الأعمدة تمامًا
# 3) تحقق قبل الدفع
bash scripts/checks/verify-governance.sh
```

### قواعد تعبئة الأعمدة

| العمود | القاعدة |
|---|---|
| `Claim ID` | `CLM-NNNN` تسلسلي، لا يُعاد استخدامه أبدًا |
| `Work Item` | معرّف من [`LAUNCH_EXECUTION_BOARD.md`](LAUNCH_EXECUTION_BOARD.md) حصرًا بصيغة `Mx-yy` — لا عمل بلا عنصر |
| `Owner` | `@handle` مسؤول بشري واحد. الوكلاء الآليون: `@handle (agent:<name>)` — المسؤولية تبقى بشرية |
| `Branch` | اسم الفرع الفعلي الكامل. يجب أن يطابق الفرع المدفوع |
| `Scope Paths` | بادئات مسارات مفصولة بفواصل بلا مسافات. مسار المجلد ينتهي بـ `/`. **لا كلام وصفي** |
| `Started` | `YYYY-MM-DD` |
| `Expires` | `YYYY-MM-DD` — الحد الأقصى **14 يومًا** من `Started`. التجاوز يُبطل الحجز |
| `Status` | `Active` أو `Paused` فقط في هذا الجدول |

### مسارات مستثناة من فحص التقاطع

هذه سجلات مشتركة تُلزم القاعدة الجميع بتحديثها، فلا تُحتسب تقاطعًا:

```text
docs/16-progress/TASK_LOG.md
docs/16-progress/LAUNCH_EXECUTION_BOARD.md
docs/16-progress/WORK_CLAIMS.md
docs/16-progress/WORK_INDEX.md
docs/16-progress/MASTER_PROGRESS.md
```

> **القائمة الحاكمة واحدة:** هذه الخمسة **بالحرف** هي `SHARED_LEDGERS` في [`validate-work-claims.sh`](../../scripts/checks/validate-work-claims.sh) و`LEDGER_ONLY_PATHS` في [`require-doc-update.sh`](../../scripts/checks/require-doc-update.sh). أيُّ إضافةٍ هنا تُضاف في الموضعين معاً، وإلّا رُفض دفعُ مَن اتَّبع الوثيقة. (كانت الوثيقةُ تُعلن `MASTER_PROGRESS.md` ولا تُعلن `WORK_INDEX.md`، و`validate-work-claims.sh` يفعل العكس، و`require-doc-update.sh` يُعلن الخمسةَ — ثلاثةُ مواضعَ بثلاثِ قوائم. وُحِّدت في `M0-12` بقرارِ مالكِ البرنامج.)

أي مسار مشترك آخر يحتاجه حجزان في وقت واحد يُحل بتقسيم العنصر أو تسلسله بقرار Program Owner مسجَّل في اللوحة — **لا بتعطيل الفحص**.

---

## 2. الحجوزات النشطة

| Claim ID | Work Item | Owner | Branch | Scope Paths | Started | Expires | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CLM-0002 | M0-01 | @uxxxu | fix/m0-01-subscription-composition-guard | services/subscriptions/,docs/16-progress/ | 2026-08-25 | 2026-09-08 | Active |
| CLM-0004 | M0-02 | @uxxxu | fix/m0-02-drivers-conformance-zone-seed | services/drivers/,docs/16-progress/ | 2026-08-25 | 2026-09-08 | Active |
| CLM-0006 | M0-12 | @uxxxu (agent:computer) | fix/m0-12-governance-proof-isolation | scripts/checks/,docs/16-progress/TASK_LOG.md,docs/16-progress/LAUNCH_EXECUTION_BOARD.md,docs/16-progress/WORK_CLAIMS.md,docs/16-progress/WORK_INDEX.md | 2026-08-26 | 2026-09-08 | Active |

---

## 3. الحجوزات المحرَّرة (Released)

| Claim ID | Work Item | Owner | Branch | Released | سبب التحرير |
| --- | --- | --- | --- | --- | --- |
| CLM-0003 | M0-11 | @uxxxu | fix/m0-11-governance-gate-sigpipe | 2026-08-26 | حُرِّر بقرارِ مالكِ البرنامج (`M0-12`): عملُ `M0-11` مدفوعٌ ومدموجٌ في الالتزامِ `183a7369`، وبقاءُ الحجزِ نشطاً كان يمنع `M0-12` من العملِ على `scripts/checks/` وهو نطاقُه المُعلَنُ على اللوحة. `M0-11` نفسُه يبقى `Ready for Gate` لا `Completed`: دليلُ الإغلاقِ بوّابةٌ خضراءُ في CI، والحصّةُ منتهية. |
| CLM-0005 | M5-11 | @uxxxu (agent:computer) | feat/phase11-mr4-marketplace-http | 2026-08-26 | حُرِّر لأنّ الفرعَ دُمج في `main` عبر [MR !87](https://gitlab.com/uxxxu/wasla/-/merge_requests/87) (الالتزامُ `38c73e4c`، الدمجُ `8f16670e`). رُصد في `M0-12` كحجزٍ نشطٍ لفرعٍ مدموج. `M5-11` يبقى `In Progress` — MR 4/6. |
| CLM-0001 | M0-05 | @uxxxu | chore/unified-roadmap-governance | 2026-08-25 | دُمج في `main` عبر [MR !81](https://gitlab.com/uxxxu/wasla/-/merge_requests/81). وبقي `M0-05` نفسُه `Ready for Gate` لا `Completed`: دليلُ إغلاقه بوابةٌ خضراء، والبوابةُ لم تُنفَّذ لنقصِ رصيدِ CI. |

يُنقل السطر إلى هنا **بعد الدمج**، مع رابط دليل قابل للتحقق (MR أو pipeline).

| Claim ID | Work Item | Owner | Branch | Released | Evidence |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — |

---

## 4. ما يفرضه `validate-work-claims.sh`

| # | الفحص | سبب الرفض |
|---|---|---|
| 1 | بنية الجدول والأعمدة الثمانية | سجل غير قابل للقراءة آليًا = حوكمة معطّلة |
| 2 | `Claim ID` فريد في الملف كله (نشط ومحرَّر) | إعادة الاستخدام تخفي التاريخ |
| 3 | لا حجزان نشطان لنفس `Work Item` | جهتان تعملان على نفس العنصر |
| 4 | لا تقاطع بين نطاقات الحجوزات النشطة | جهتان تعملان على نفس الملفات |
| 5 | `Work Item` موجود في اللوحة | عمل خارج خارطة الطريق |
| 6 | `Expires` صالح ولم يمضِ ولا يتجاوز 14 يومًا | حجز مهجور يقفل النطاق على الآخرين |
| 7 | نطاق مكتوب بمسارات موجودة أو قابلة للإنشاء | نطاق فضفاض لا يمنع شيئًا |
| 8 | كل ملف مُغيَّر في الدفع داخل نطاق حجز الفرع | توسع صامت يصطدم بعمل الآخرين |

الفحص الثامن هو جوهر منع التكرار: **لا يكفي أن تعلن ما ستعمل عليه، بل لا تستطيع تقنيًا الدفع خارجه.**

---

## 5. حالات خاصة

- **عمل عاجل (Hotfix):** يُنشأ عنصر `M0-HF-<n>` في اللوحة وحجز مدته يومان، ويُوثَّق في `TASK_LOG` كباقي العمل. لا استثناء من الحجز.
- **حجز مهجور:** بعد `Expires` يجوز لأي منفّذ نقله إلى «محرَّرة» بحالة `Expired` وسبب مكتوب، ثم إنشاء حجز جديد.
- **تسليم بين جهتين:** يُحرَّر الحجز الأول ويُنشأ حجز جديد بمالك جديد. لا يُعدَّل حقل `Owner` لحجز نشط.
- **توسيع النطاق:** يُعدَّل `Scope Paths` **قبل** كتابة الكود، وبعد تشغيل `find-existing-work.sh` على المسار الجديد.
