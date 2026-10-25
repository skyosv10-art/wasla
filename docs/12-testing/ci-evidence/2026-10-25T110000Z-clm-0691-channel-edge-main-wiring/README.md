# CLM-0691 — وحدةُ D6: وصلُ `buildAppWithEdge` في مدخلِ بوتِ العميلِ + الحارسُ 29

**التاريخ:** 2026-10-25 · **البند:** M0-53 (G-S9.7 · ADR-025 §6.11 · T1) · **الفرع:** `fix/clm-0691-channel-edge-main-wiring` · **الأساس:** `main` عندَ `84ca39808d2b0f3f1a92a982367e60f4aeab708f`.

**التكليفُ الأصليُّ (خطةُ 2026-10-25):** «حدد بالضبط ما تعنيه T1 وما الذي ينقص لإثباتها… افحص هل توجد فجوة في الكود نفسه أم أن المطلوب قياس تشغيلي أو صلاحية خارجية. أصلح ما يمكن إصلاحه دون انتظار قرار غير ضروري.»

## ما تغيّر

| الوحدة | التغيير |
| --- | --- |
| `bots/customer-bot/src/main.ts` | المدخلُ يبني عبرَ `buildAppWithEdge` (من `./edge.js`) ويُمرِّرُهُ إلى `runBotApp` — لا `buildApp` مباشرةً (وحدةُ D6 من تدقيقِ CLM-0661). فشلٌ مغلقٌ لا يتغيّرُ: بلا `WASLA_EDGE_ENABLED` يعودُ التركيبُ مطابقًا لـ`buildApp` |
| `scripts/checks/validate-edge-wiring.sh` + `scripts/checks/lib/edge_wiring_guard.py` | **الحارسُ 29:** يقيسُ الاستيرادَ والتمريرَ، وحلَّ `allowlistUrl` من موقعِ الوحدةِ (`import.meta.url`) إلى ملفٍّ موجودٍ صالحِ JSON في البوتَين. لا شبكةَ ولا git — مرورٌ أو إخفاقٌ |
| `scripts/checks/lib/gov-cases-edge-wiring.sh` | 6 حالاتٍ: طفراتُ M1–M4 (مدخلٌ بلا حدٍّ · مسارُ قائمةٍ غائبٌ · JSON مكسورٌ · وحدةٌ مفقودةٌ) + ضابطٌ موجبٌ + عزلُ البابَينِ (M1 يُسقِطُ البابَينِ معًا) |
| `scripts/checks/test-governance.sh` · `scripts/checks/verify-governance.sh` | تسجيلُ الحارسِ 29 في المجموعةِ والبوّابةِ |
| `docs/08-infrastructure/RENDER_TEST_ENVIRONMENT_PLAN.md` · `docs/12-testing/T2_LOCAL_WEBHOOK_PROCEDURE.md` · `infra/render/deploy-target.json` (نصُّ `note` فقط) | تصحيحٌ مؤرَّخٌ: وثائقُ T1 قالت «`allowlistUrl` يحلُّ إلى ملفٍّ مفقودٍ» — **متحجِّرةٌ منذ CLM-0662 (#809 · `771beb7f`)** الذي أصلَحَ الحلَّ إلى `import.meta.url`. القياسُ الحيُّ (الحارسُ 29) يُثبتُ الحلولَ في البوتَينِ |
| ADR-025 §6.11 · TASK_LOG · ROADMAP · WORK_CLAIMS · `BASELINE.json`/`txt` | التوثيقُ وإعادةُ توليدِ الأساسِ بقرارٍ مكتوبٍ (`governance_checks` 28→29 — أثرُ الحارسِ الجديدِ لا نطاقٌ جديدٌ) |

## النتائجُ المحليّة (ليست CI — السجلّاتُ في `raw/`)

| الفحص | النتيجة | السجلّ |
| --- | --- | --- |
| وحداتُ بوتِ العميلِ (7 ملفاتٍ · منها edge-composition 2) | 58/58 | `raw/customer-bot-unit.log` |
| `tsc --noEmit` (customer-bot) | rc=0 | `raw/tsc-customer-bot.log` |
| الحارسُ 29 على الشجرةِ النظيفةِ | ✓ | `raw/edge-wiring-guard.txt` |
| طفراتُ M1–M4 + الضابطُ الموجبُ (مصدرٌ مستقلٌّ) | 6/6 | `raw/gov-cases-edge-wiring-local.log` |
| `test-governance.sh` كاملًا | يُحدَّثُ بعدَ التشغيلِ المحليِّ الكاملِ | `raw/test-governance-local.log` |
| `verify-governance.sh` | يُحدَّثُ بعدَ إعادةِ توليدِ الأساسِ | `raw/verify-governance-local.log` |
| `validate-render-deploy-target.sh` | 42/42 · `approved=false` + `approval=null` بلا تغييرٍ | `raw/render-deploy-target-guard.log` |

## ما لا يُثبِتُه هذا الدليل (حدودٌ مُعلَنة)

- **ليس تشغيلَ T1 ولا دليلَ D4.3:** الترطيبُ قياسٌ محليٌّ؛ D4.3 «غيرُ منفَّذٍ» حتى قياسٍ من البيئةِ الحيّةِ بإذنِ المالكِ — اختبارٌ محليٌّ ليسَ بديلًا.
- **مدخلُ بوتِ السائقِ** ما زالَ على `buildApp` (وحدةٌ لاحقةٌ عندَ اختبارِ مسارِهِ — T1 للعميلِ وحدَهُ).
- **`WASLA_EDGE_ENABLED`** غيرُ مسجَّلٍ في env-registry (فشلٌ مغلقٌ بقرارٍ) — تعطيلُ الحدِّ إنتاجيًّا متعذّرٌ بلا قرارِ مالكٍ.
- **CI على الرأسِ** يُوثَّقُ بعدَ الدمجِ (راجع القسمَ أدناه).

## بعدَ الدمجِ (يُحدَّثُ)

_يُستكمَلُ برأسِ الدمجِ ونتيجةِ CI على main._
