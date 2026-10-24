# CLM-0671 — الخيارُ B (مرآةُ apt) لمهامِّ e2e — معتمَدٌ بقرارِ المالك: معالجةٌ مدعومةٌ بقياسٍ محدود

- **Claim:** `CLM-0671` · **Branch:** `ops/clm-0671-apt-mirror-option-b` · **PR:** #817 · **الأساس:** main `7b7afa45348d654595145fc5c9b62e2f351c4af4` (أُعيدَ الأساسُ عليه 2026-10-24؛ الفروقُ لكلِّ ملفٍّ مطابقةٌ لما قبلَ إعادةِ الأساس).
- **قرارا المالك:** (1) 2026-10-24 «ابدأ CLM-0671 لقياس الخيار B مع إبقاء المهلة 10 دقائق»؛ (2) **2026-10-24 — اعتمادُ الخيارِ B باعتبارِه معالجةً مدعومةً بقياسٍ محدود**، معَ القيدَين الصريحَين أدناه.
- **`timeout-minutes: 10` للمهامِّ الثلاثِ بلا تغيير** (مقيسٌ آليًّا: [`check-ci-scope.py`](check-ci-scope.py)).

## القرارُ وحدودُه (مُسجَّلٌ بنصِّ المالك)

الخيارُ B **معالجةٌ مدعومةٌ بقياسٍ محدود، لا إصلاحٌ مُثبَتٌ على المدى الطويل**. القيدان:
1. **حدثا بطءِ azure وقعا في المهمّةِ نفسِها** (`customer-mini-app-e2e`، المحاولتان 1 و2، خلالَ 15 دقيقة) — لا تنوّعَ في المهامِّ ولا في الزمن.
2. **انقطاعُ `archive.ubuntu.com` لم يُختبَرْ فعليًّا** — سلوكُ الفشلِ المغلقِ مُختبَرٌ على جذرٍ وهميٍّ فقط (N1–N4 وطفراتُه)، لا في CI ولا ضدَّ مضيفٍ حقيقيٍّ معطَّل.

الأثرُ إن انقطعَ `archive.ubuntu.com`: يفشلُ التثبيتُ أو يبطؤ كما كانَ مع azure (المضيفُ الآخرُ ليس احتياطًا تلقائيًّا)، والمهلةُ 10 دقائقَ تبقى الحدّ. لا يُدَّعى أنّ إلغاءاتِ المهلةِ انتهت.

## التغييرُ المعتمَد (المهامُّ الثلاثُ وحدَها)

1. `Test apt mirror scripts (CLM-0671)` — [`scripts/ci/test-apt-mirror-archive-ubuntu.sh`](../../../../scripts/ci/test-apt-mirror-archive-ubuntu.sh) على المشغّلِ نفسِه (بلا شبكةٍ ولا sudo).
2. `Switch apt mirror to archive.ubuntu.com (CLM-0671)` — [`scripts/ci/apt-mirror-archive-ubuntu.sh`](../../../../scripts/ci/apt-mirror-archive-ubuntu.sh): يستبدلُ `http(s)://azure.archive.ubuntu.com` بـ `https://archive.ubuntu.com` ويفشلُ مغلقًا (exit 1 ⇒ تفشلُ المهمّة) إن لم توجدْ ملفّاتُ مصادر، أو بقيَ ذكرٌ لـ azure، أو لم يبقَ مصدرٌ لـ `archive.ubuntu.com` (والمضيفُ الشبيهُ مرفوض).
3. `Install Playwright browsers` — **بلا تغيير**.

**حُذف قبلَ الدمج:** خطوةُ `Probe azure.archive.ubuntu.com` من المهامِّ الثلاث، و`scripts/ci/apt-mirror-probe.sh`، وتصديرُ `CLM0671_JOB_T0` (لم يكن يستعملُهُ غيرُ المسبار).

## التحقّقُ على النسخةِ المعتمَدة (أوامرُ إعادةِ الإنتاج من جذرِ المستودع)

| الأمر | النتيجة |
|---|---|
| `bash scripts/ci/test-apt-mirror-archive-ubuntu.sh` | **8/8** — موجبةٌ P1 (deb822 + `mirror+file`، `security.ubuntu.com` لا يُمَسّ) · P2 (`sources.list` http+https) · P3 (نظيفٌ ⇒ no-op) · **P4 (deb822 بعنوانٍ مباشر، جديد)**؛ سالبةٌ N1–N4 |
| `bash docs/12-testing/ci-evidence/2026-10-24T010000Z-clm-0671-apt-mirror-option-b/mutants-final.sh` | **9/9 مقتولة** ([`raw/mutants-final.txt`](raw/mutants-final.txt)) — منها M6 (حذفُ فحصِ «لا ملفّات») التي كشفت أنّ الأداةَ القديمةَ كانت **تتعلّقُ** بدلَ أن تفشل (grep بلا ملفّاتٍ يقرأُ stdin)؛ أُصلحت الأداةُ بـ `</dev/null` |
| `python3 docs/12-testing/ci-evidence/2026-10-24T010000Z-clm-0671-apt-mirror-option-b/check-ci-scope.py origin/main` | **0 مخالفات** ([`raw/check-ci-scope.txt`](raw/check-ci-scope.txt)): خطوتا المرآةِ في المهامِّ الثلاثِ وحدَها · كلُّ المهامِّ الأخرى مطابقةٌ للأساس · `timeout-minutes: 10` على الجانبَين · مفاتيحُ المهمّةِ بلا تغيير · خطواتُ الأساسِ كلُّها باقيةٌ بلا تغييرٍ وبالترتيبِ نفسِه · Test < Switch < Install · الخطوتان المضافتان بلا `if`/`continue-on-error`/`timeout`/`env` · لا مسبار |
| ضوابطُ سالبةٌ للفاحص ([`raw/check-ci-scope-negative-controls.txt`](raw/check-ci-scope-negative-controls.txt)) | **3/3 مرفوضة**: المهلةُ 10→15 · `continue-on-error` على Switch · خطوةُ Switch في مهمّةٍ رابعة |

## خطّةُ القياس

- كلُّ جولةٍ = إعادةُ تشغيلِ المهامِّ الثلاثِ وحدَها دونَ تغييرٍ على الرأسِ نفسِه (لا يُعادُ سيرُ العملِ كلُّه).
- يُجمَعُ لكلِّ محاولةٍ: مدّةُ التثبيت، `Fetched … (rate)` لحزمِ `.deb` من archive.ubuntu.com، المضيف، نتيجةُ الاختبار، وسطرُ `CLM0671-PROBE` لـ azure.
- **معيارُ الحكمِ المعلَنُ مسبقًا:** B يُعَدُّ فعّالًا فقط إن (1) لم تُلغَ أيُّ محاولةٍ بالمهلة، (2) ورُصِدَت azure بطيئةً (< 300 kB/s أو `complete=no`) في محاولةٍ واحدةٍ على الأقلِّ بينما نجحَ B في المحاولةِ نفسِها. إن لم تُرصَدْ azure بطيئةً قطُّ، فالنتيجةُ «غيرُ حاسمةٍ» لا «نجاح».

## النتائج (WASLA CI `40039556210` على الرأس `58658d6f` · 2026-10-23T23:25Z → 2026-10-24T06:50Z)

قابلٌ لإعادةِ الفحص: `python3 analyse.py raw/rounds.tsv` → [`raw/analysis.txt`](raw/analysis.txt).

| المقياس | القيمة |
|---|---|
| محاولاتُ مهامّ (بعدَ إزالةِ التكرار على `job, started`) | **30** — 10 لكلٍّ من customer · driver · admin |
| النتيجة | **30/30 success** · خطوةُ `Test` ناجحةٌ 30/30 |
| إلغاءٌ بالمهلة (10 دقائق، بلا تغيير) | **0** |
| تنزيلُ `.deb` عبرَ B (archive.ubuntu.com) | الأدنى **3756 kB/s** · الوسيط 5518 kB/s |
| مسبارُ azure في المحاولاتِ نفسِها | الأدنى **109 kB/s** · الوسيط 6598 kB/s |
| مدّةُ خطوةِ التثبيت | الوسيط 28 ث · الأدنى 24 · الأقصى 56 |

**المحاولتان اللتان رُصِدت فيهما azure بطيئةً** (المعيار 2):

| المحاولة | المهمّة | البدء | azure | B في المحاولةِ نفسِها | النتيجة |
|---|---|---|---|---|---|
| 1 | customer-mini-app-e2e | 2026-10-23T23:25:09Z | 109 kB/s · `complete=no` | 4703 kB/s | success |
| 2 | customer-mini-app-e2e | 2026-10-23T23:39:14Z | 141 kB/s · `complete=no` | 4830 kB/s | success |

### الحكمُ بالمعيارِ المعلَنِ مسبقًا: **فعّال**
(1) لا إلغاءَ بالمهلة ✓ · (2) azure بطيئةٌ في محاولتَين نجحَ B فيهما بأكثرَ من 4.7 MB/s ✓.

### حدودُ الحكم (ما لم يُثبَت)
- **العيّنةُ صغيرة:** حدثا بطءٍ فقط، كلاهما في المهمّةِ نفسِها وخلالَ 15 دقيقة؛ بعدَهما كانت azure سريعةً في 28 محاولة. لا يُقاسُ هنا معدّلُ الإلغاءِ على المدى الطويل.
- **أعطالُ B نفسِه لم تُرصَد:** لم يقع انقطاعٌ أو بطءٌ في archive.ubuntu.com؛ سلوكُ `fail-closed` مُختبَرٌ محليًّا فقط (N1–N4 · R1–R3)، لا في CI.
- **مدّةُ التثبيت:** الوسيطُ 28 ث هنا مقابلَ 23 ث في قياسِ CLM-0670 (#816، فترةٌ مختلفة) — فرقٌ غيرُ مُفسَّرٍ سببيًّا؛ قد يكونُ كلفةَ `apt-get update` على المصدرِ الجديد، ولم يُعزَل.
- **ليس هذا إصلاحًا لـ azure:** B يتجاوزُ المضيفَ البطيءَ لا يُصلحُه؛ [actions/runner-images#14823](https://github.com/actions/runner-images/issues/14823) يبقى المرجعَ الخارجيّ.

### ما تلا القياس
- **قرارُ المالكِ 2026-10-24:** اعتمادُ B معالجةً مدعومةً بقياسٍ محدود (القيدان في رأسِ هذا الملف).
- **نُفِّذ في #817 نفسِه:** حذفُ المسبارِ وسكربتِه وتصديرِ T0، وإضافةُ P4، وإصلاحُ تعلّقِ أداةِ الاختبار، وطفراتٌ نهائيّةٌ وفحصٌ بنيويٌّ بضوابطَ سالبة. المهلةُ 10 دقائقَ بلا تغيير.
- **ما بعدَ الدمج:** نتائجُ WASLA CI وRoadmap freshness على SHA الدمجِ في [`post-merge.md`](post-merge.md) (يُضافُ في PR سجلٍّ لاحقٍ بمراجعةٍ مستقلّة، لأنّ SHA الدمجِ لا يُعرَفُ قبلَه).

## ملحقٌ تاريخيّ — مرحلةُ القياس (الرأس `58658d6f`، بعدَ إعادةِ الأساس `5cd22d8a`)

> هذا وصفُ فرعِ القياسِ **كما قِيس**، ويُحفظُ دليلًا. خطوةُ `Probe` و`scripts/ci/apt-mirror-probe.sh` وطفراتُ M6–M9 في `mutants.sh` **حُذفت/لا تنطبقُ** على النسخةِ المعتمَدة؛ لإعادةِ تشغيلِها: `git worktree add /tmp/m 58658d6fe979b5c5c53f925e12c39f23fe5f13a8` ثمّ `bash docs/12-testing/ci-evidence/2026-10-24T010000Z-clm-0671-apt-mirror-option-b/mutants.sh` هناك.

### التغييرُ في مرحلةِ القياس (المهامُّ الثلاث `customer-mini-app-e2e` · `driver-mini-app-e2e` · `admin-portal-e2e`)

1. `Test apt mirror scripts (CLM-0671)` — [`scripts/ci/test-apt-mirror-archive-ubuntu.sh`](../../../../scripts/ci/test-apt-mirror-archive-ubuntu.sh) على المشغّلِ نفسِهِ (بلا شبكةٍ ولا sudo).
2. `Switch apt mirror to archive.ubuntu.com (CLM-0671)` — [`scripts/ci/apt-mirror-archive-ubuntu.sh`](../../../../scripts/ci/apt-mirror-archive-ubuntu.sh): يطبعُ المصادرَ قبلُ وبعدُ، يستبدلُ `http(s)://azure.archive.ubuntu.com` بـ `https://archive.ubuntu.com`، ويفشلُ مغلقًا إن بقيَ ذكرٌ لـ azure أو لم يبقَ مصدرٌ لـ archive.ubuntu.com.
3. `Install Playwright browsers` — **بلا تغيير** (`npx playwright install --with-deps chromium`).
4. `Probe azure.archive.ubuntu.com (CLM-0671, measurement-only)` — [`scripts/ci/apt-mirror-probe.sh`](https://github.com/skyosv10-art/wasla/blob/58658d6fe979b5c5c53f925e12c39f23fe5f13a8/scripts/ci/apt-mirror-probe.sh) (محذوفٌ الآن؛ الرابطُ إلى رأسِ القياس)، **بعدَ** الاختباراتِ ورفعِ التقرير، `if: always()` و`timeout-minutes: 3` للخطوة، **بلا `continue-on-error`** (بوابةُ الحوكمةِ 8/11 ترفضُهُ تقنيعًا، والسكربتُ يخرجُ 0 دائمًا بتصميمِهِ فلا يحتاجُه): ينزِّلُ الحزمَ نفسَها بإصداراتِها نفسِها (آخرُ سطرِ `Install:` في `/var/log/apt/history.log`) من azure على المشغّلِ نفسِهِ، بفهارسَ وذاكرةٍ معزولةٍ، بميزانيةٍ ≤ 90 ث لا تتجاوزُ T0+480 ث، ويطبعُ `CLM0671-PROBE … kBps=… complete=…`. الغرضُ: معرفةُ هل كانت azure بطيئةً لحظةَ كلِّ تشغيلٍ (مقارنةٌ مزدوجةٌ على المشغّلِ نفسِه).

### الاختباراتُ المحلّيّةُ في مرحلةِ القياس

`bash scripts/ci/test-apt-mirror-archive-ubuntu.sh` → **10/10**: موجبةٌ P1 (deb822 + `mirror+file`، `security.ubuntu.com` لا يُمَسّ، T0 مُصدَّر) · P2 (`sources.list` بـ http وhttps) · P3 (نظيفٌ ⇒ no-op)؛ سالبةٌ N1 (لا ملفّات) · N2 (لا أرشيفَ Ubuntu) · N3 (بقيّةُ ذكرٍ لـ azure بلا مخطّط) · N4 (مضيفٌ شبيهٌ `myarchive.ubuntu.com.evil`)؛ القياسُ R1 (لا سجلّ) · R2 (تحليلُ آخرِ `Install:` مع الإصدارات) · R3 (قربَ حدِّ المهمّةِ ⇒ تخطٍّ قبلَ أيِّ شبكة).

`bash docs/12-testing/ci-evidence/2026-10-24T010000Z-clm-0671-apt-mirror-option-b/mutants.sh` → **9/9 مقتولةٌ** (M1 بلا `sed` · M2 بلا فحصِ البقايا · M3 بلا فحصِ الأرشيف · M4 تعبيرٌ مُرخًى · M5 هدفُ http · M6 بلا T0 · M7 أوّلُ `Install:` · M8 بلا ميزانيّة · M9 بلا إصدار).
