# CLM-0671 — قياسُ الخيارِ B (مرآةُ apt) لمهامِّ e2e — قيدَ القياس

- **Claim:** `CLM-0671` · **Branch:** `ops/clm-0671-apt-mirror-option-b` · **قرارُ المالك (2026-10-24):** «ابدأ CLM-0671 لقياس الخيار B مع إبقاء المهلة 10 دقائق».
- **الحالة:** فرعُ قياسٍ في PR مسودّةٍ. **لا دمجَ** بهذا الشكلِ: خطوةُ `Probe azure…` قياسٌ فقط وتُحذَفُ قبلَ أيِّ اقتراحِ دمجٍ، والدمجُ نفسُهُ قرارٌ منفصلٌ للمالكِ بعدَ النتائج.
- **`timeout-minutes: 10` للمهامِّ الثلاثِ بلا تغيير** (مقيسٌ في الفرق: لا سطرَ `timeout-minutes: 10` مُضافٌ أو محذوف).

## التغيير (في المهامِّ الثلاث `customer-mini-app-e2e` · `driver-mini-app-e2e` · `admin-portal-e2e`)

1. `Test apt mirror scripts (CLM-0671)` — [`scripts/ci/test-apt-mirror-archive-ubuntu.sh`](../../../../scripts/ci/test-apt-mirror-archive-ubuntu.sh) على المشغّلِ نفسِهِ (بلا شبكةٍ ولا sudo).
2. `Switch apt mirror to archive.ubuntu.com (CLM-0671)` — [`scripts/ci/apt-mirror-archive-ubuntu.sh`](../../../../scripts/ci/apt-mirror-archive-ubuntu.sh): يطبعُ المصادرَ قبلُ وبعدُ، يستبدلُ `http(s)://azure.archive.ubuntu.com` بـ `https://archive.ubuntu.com`، ويفشلُ مغلقًا إن بقيَ ذكرٌ لـ azure أو لم يبقَ مصدرٌ لـ archive.ubuntu.com.
3. `Install Playwright browsers` — **بلا تغيير** (`npx playwright install --with-deps chromium`).
4. `Probe azure.archive.ubuntu.com (CLM-0671, measurement-only)` — [`scripts/ci/apt-mirror-probe.sh`](../../../../scripts/ci/apt-mirror-probe.sh)، **بعدَ** الاختباراتِ ورفعِ التقرير، `if: always()` و`timeout-minutes: 3` للخطوة، **بلا `continue-on-error`** (بوابةُ الحوكمةِ 8/11 ترفضُهُ تقنيعًا، والسكربتُ يخرجُ 0 دائمًا بتصميمِهِ فلا يحتاجُه): ينزِّلُ الحزمَ نفسَها بإصداراتِها نفسِها (آخرُ سطرِ `Install:` في `/var/log/apt/history.log`) من azure على المشغّلِ نفسِهِ، بفهارسَ وذاكرةٍ معزولةٍ، بميزانيةٍ ≤ 90 ث لا تتجاوزُ T0+480 ث، ويطبعُ `CLM0671-PROBE … kBps=… complete=…`. الغرضُ: معرفةُ هل كانت azure بطيئةً لحظةَ كلِّ تشغيلٍ (مقارنةٌ مزدوجةٌ على المشغّلِ نفسِه).

## الاختباراتُ المحلّيّة (قيست على هذا الفرع)

`bash scripts/ci/test-apt-mirror-archive-ubuntu.sh` → **10/10**: موجبةٌ P1 (deb822 + `mirror+file`، `security.ubuntu.com` لا يُمَسّ، T0 مُصدَّر) · P2 (`sources.list` بـ http وhttps) · P3 (نظيفٌ ⇒ no-op)؛ سالبةٌ N1 (لا ملفّات) · N2 (لا أرشيفَ Ubuntu) · N3 (بقيّةُ ذكرٍ لـ azure بلا مخطّط) · N4 (مضيفٌ شبيهٌ `myarchive.ubuntu.com.evil`)؛ القياسُ R1 (لا سجلّ) · R2 (تحليلُ آخرِ `Install:` مع الإصدارات) · R3 (قربَ حدِّ المهمّةِ ⇒ تخطٍّ قبلَ أيِّ شبكة).

`bash docs/12-testing/ci-evidence/2026-10-24T010000Z-clm-0671-apt-mirror-option-b/mutants.sh` → **9/9 مقتولةٌ** (M1 بلا `sed` · M2 بلا فحصِ البقايا · M3 بلا فحصِ الأرشيف · M4 تعبيرٌ مُرخًى · M5 هدفُ http · M6 بلا T0 · M7 أوّلُ `Install:` · M8 بلا ميزانيّة · M9 بلا إصدار).

## خطّةُ القياس

- كلُّ جولةٍ = إعادةُ تشغيلِ المهامِّ الثلاثِ وحدَها دونَ تغييرٍ على الرأسِ نفسِه (لا يُعادُ سيرُ العملِ كلُّه).
- يُجمَعُ لكلِّ محاولةٍ: مدّةُ التثبيت، `Fetched … (rate)` لحزمِ `.deb` من archive.ubuntu.com، المضيف، نتيجةُ الاختبار، وسطرُ `CLM0671-PROBE` لـ azure.
- **معيارُ الحكمِ المعلَنُ مسبقًا:** B يُعَدُّ فعّالًا فقط إن (1) لم تُلغَ أيُّ محاولةٍ بالمهلة، (2) ورُصِدَت azure بطيئةً (< 300 kB/s أو `complete=no`) في محاولةٍ واحدةٍ على الأقلِّ بينما نجحَ B في المحاولةِ نفسِها. إن لم تُرصَدْ azure بطيئةً قطُّ، فالنتيجةُ «غيرُ حاسمةٍ» لا «نجاح».

النتائجُ تُضافُ هنا بعدَ القياس.
