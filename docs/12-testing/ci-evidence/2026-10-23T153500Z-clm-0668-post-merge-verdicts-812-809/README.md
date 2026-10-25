# CLM-0668 — دليلُ ما بعدَ الدمجِ لسلسلةِ #812 → #809 (توثيقٌ فقط)

- **Claim:** `CLM-0668` · **Branch:** `stage-zero/clm-0668-post-merge-verdicts-812-809` · **التاريخ:** 2026-10-23
- **Kind:** docs-only — أحكامُ CI على main لالتزامَي دمجِ #812 و#809؛ لا شيفرةَ ولا نشرَ ولا كتابةَ إنتاجٍ ولا اتصالٌ خارجيٌّ ولا تدويرُ مفاتيحَ.
- **ملاحظةُ حدودٍ:** توثيقُ قياسٍ لا قرارُ مالكٍ — لا يُغلقُ خطرًا ولا يرفعُ حالةَ عنصرٍ. سابقتا النموذجِ: CLM-0658 وCLM-0666. **لا يُعدِّلُ أيَّ قياسٍ سابقٍ** في دليلِ CLM-0666 ولا ينسبُهُ إلى SHA آخرَ.
- **مصدرُ كلِّ الأرقامِ:** واجهةُ GitHub مقروءةً مباشرةً 2026-10-23T15:32Z (الخامُ في [`raw/chain-verdicts.txt`](raw/chain-verdicts.txt) و[`raw/tree-diff.txt`](raw/tree-diff.txt)).

## 1. قياساتُ رؤوسِ PR (قبلَ الدمجِ — تخصُّ الرأسَ لا main)

| PR | المطالبة | الرأسُ المدمجُ | القاعدةُ لحظةَ الدمجِ | WASLA CI (الرأس) | Roadmap (الرأس) | check-runs لحظةَ الدمجِ | الموافقةُ المستقلةُ على الرأسِ نفسِهِ |
|---|---|---|---|---|---|---|---|
| [#812](https://github.com/skyosv10-art/wasla/pull/812) | CLM-0666 | `b3c59c19b6c034b5290a2713c4a38ac995974d67` | `ea98c4c8` (= main) | [39945474385](https://github.com/skyosv10-art/wasla/actions/runs/39945474385) success | [39945468190](https://github.com/skyosv10-art/wasla/actions/runs/39945468190) success | 42/42 success (14:02:20Z) | [5629308832](https://github.com/skyosv10-art/wasla/pull/812#pullrequestreview-5629308832) — xuuux-voox · 14:01:18Z · `commit_id` = `b3c59c19…` |
| [#809](https://github.com/skyosv10-art/wasla/pull/809) | CLM-0662 | `15a01e88c252a9deb03459d03973453e5bb17841` | `2bd8cdbf` (= main) | [39966772214](https://github.com/skyosv10-art/wasla/actions/runs/39966772214) success | [39966760328](https://github.com/skyosv10-art/wasla/actions/runs/39966760328) success | 42/42 success (15:17:30Z) | [5630404689](https://github.com/skyosv10-art/wasla/pull/809#pullrequestreview-5630404689) — xuuux-voox · 15:17:17Z · `commit_id` = `15a01e88…` |

- **موافقاتُ #809 التي لم تُعامَلْ موافقةً على الرأسِ المدمجِ:** `5622593119` على `5a659680` (00:36:47Z) و`5629314162` على `752da3ac` (14:01:44Z). الثانيةُ سقطت بإعادةِ التأسيسِ الثانيةِ بعدَ دمجِ #812 (الحمايةُ `strict`)، وطُلبتْ مراجعةٌ جديدةٌ على `15a01e88` ([التعليق](https://github.com/skyosv10-art/wasla/pull/809#issuecomment-6366784795)).
- الحمايةُ مقيسةٌ قبلَ كلِّ دمجٍ: `strict=true` · `enforce_admins=true` · 41 سياقًا مطلوبًا — كلُّها success على الرأسَينِ. `required_approving_review_count=0` (ADR-071)؛ فالموافقةُ المستقلةُ شرطُ التكليفِ لا شرطُ الحمايةِ، وتُحقِّقَ منها بـ`commit_id` لا بالتوقيتِ.
- الدمجُ بـ`scripts/ops/merge-on-approved-head.sh <PR> --squash` بعدَ `DRY_RUN=1` أخضرَ، بـ`--match-head-commit` وبلا `--admin`. خرجُ السكربتِ لكلَيهما: `changes_requested_on_head=no checks: success=42 skipped_or_neutral=0 failed=0 pending=0`.
- **الـcheck-run الثالثُ والأربعونَ** الظاهرُ الآنَ على كلِّ رأسٍ هوَ `cleanup` (سيرُ «Merged branch cleanup») وبدأ **بعدَ** الدمجِ — ليسَ شرطًا ولا جزءًا من قياسِ ما قبلَ الدمجِ.

## 2. قياساتُ main بعدَ الدمجِ (على SHA الدمجِ نفسِهِ — لا يُورَّثُ من الرأسِ)

| التزامُ الدمجِ | PR | Roadmap freshness | WASLA CI — المحاولة 1 | WASLA CI — المحاولة 2 | check-runs |
|---|---|---|---|---|---|
| `2bd8cdbfa19c43c7d34bbddb81a9bfe3be195177` (14:02:53Z) | #812 | [39966310495](https://github.com/skyosv10-art/wasla/actions/runs/39966310495) success | [39966310455](https://github.com/skyosv10-art/wasla/actions/runs/39966310455) **cancelled** — 40 success · 1 cancelled: `customer-mini-app-e2e` (120456977869) — «Install Playwright browsers» 14:03:14Z→14:13:13Z تجاوزَ `timeout-minutes: 10` | **success** — 41/41 (إعادةُ تشغيلِ الفاشلِ وحدَهُ بلا تغييرِ شيفرةٍ) | 42/42 success |
| `771beb7fc9fed84b5e3c7a7ff11d605718f4a2d4` (15:17:47Z) | #809 | [39977044737](https://github.com/skyosv10-art/wasla/actions/runs/39977044737) success | [39977044634](https://github.com/skyosv10-art/wasla/actions/runs/39977044634) **cancelled** — 39 success · 2 cancelled: `driver-mini-app-e2e` (120494253136 — التثبيتُ 15:18:06Z→15:28:02Z أُلغيَ) و`admin-portal-e2e` (120494253456 — التثبيتُ نجحَ في 9:27 ثمّ بلغت المهمةُ حدَّ العشرِ دقائقَ) | **success** — 41/41 | 42/42 success |

- **فرقُ الشجرةِ:** squash على قاعدةٍ محدَّثةٍ — `tree(b3c59c19)` = `tree(2bd8cdbf)` = `b15f747d…` و`tree(15a01e88)` = `tree(771beb7f)` = `20560094…`؛ والتاريخُ خطّيٌّ `ea98c4c8` ← `2bd8cdbf` ← `771beb7f`.
- **الحكمُ على main هوَ المحاولةُ 2 لا الأولى**؛ والأولى مُسجَّلةٌ بنتيجتِها الفعليةِ `cancelled` لا مُحوَّلةً إلى نجاحٍ.

## 3. خطرٌ تشغيليٌّ مقيسٌ (لا يُعالَجُ هنا)

تثبيتُ متصفّحاتِ Playwright قاربَ حدَّ `timeout-minutes: 10` أو تجاوزَهُ في **تشغيلَي main كلَيهما** في هذهِ السلسلةِ (ثلاثُ مهامّ e2e)، والإعادةُ أتمّت كلَّ مهمّةٍ في نحوِ دقيقةٍ. فالحكمُ الأولُ على main غيرُ موثوقٍ بطءً لا عيبًا. لم تُغيَّرِ المهلةُ ولا سيرُ العملِ — ذلكَ عملٌ مستقلٌّ بحجزٍ وقرارٍ.

## 4. ماذا يقيسُ وماذا لا يقيسُ

- **يقيسُ:** أنّ شجرتَي دمجِ #812 و#809 خضراوانِ على main نفسِهِ، وأنّ كلَّ دمجٍ جرى بموافقةٍ مستقلةٍ مربوطةٍ بـ`commit_id` الرأسِ المدمجِ حرفيًّا عبرَ الآليةِ المعتمدةِ.
- **لا يقيسُ:** رحلةَ customer-bot → search (محجوبةٌ: لا منحَ M1-05 لأيِّ دورٍ إنتاجيٍّ على `search` — قرارُ مالكٍ؛ D6 وحدةٌ لاحقةٌ؛ D7 قرارُ مالكٍ)، ولا صحّةَ الخدماتِ على بيئةٍ خارجيّةٍ، ولا إغلاقَ أيِّ خطرٍ.
- **النشرُ:** `render-deploy.yml` يدويُّ التشغيلِ فقط منذُ CLM-0632، ولا تشغيلَ لهُ على `2bd8cdbf` ولا `771beb7f` — لا نشرَ ولا اتصالَ خارجيًّا بهذهِ السلسلةِ.

## 5. الحواجزُ — بلا تغييرٍ

#730 / INC-0007 **HOLD** (لا دليلَ على تدويرِ مفتاحِ Render ولا إبطالِ القديمِ ولا تدويرِ توكناتِ البوتاتِ الثلاثةِ) · `production_open=false` · `deploy-target.json` لم يُمَسَّ · Launch **NO-GO** · M6-18B **Blocked** · RISK-0027 `open` · RISK-0070 `mitigating` · RISK-0071 `open` · RISK-0058/0066/0067 بحالاتِها.

## 6. شرطُ إغلاقِ CLM-0666

CLM-0666 لا يُعَدُّ مُغلقًا قبلَ دمجِ هذا الدليلِ والتحقّقِ من WASLA CI وRoadmap freshness على التزامِ دمجِهِ في main؛ ويُسجَّلُ ذلكَ القياسُ في Issue #797 لا هنا (لا يُدَّعى حكمٌ على SHA لم يوجدْ بعدُ).
