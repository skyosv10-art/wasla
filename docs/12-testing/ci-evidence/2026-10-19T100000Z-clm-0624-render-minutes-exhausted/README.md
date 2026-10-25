# CLM-0624 — Render: نفادُ دقائقِ البناءِ (RISK-0068) · تصحيحُ G-S9.1 غيرُ منشورٍ

**الحجزُ:** CLM-0624 · **العناصرُ:** M0-53 · **الأساسُ:** main `c386a98e` (دمجُ [#772](https://github.com/skyosv10-art/wasla/pull/772) — CLM-0622/CLM-0623). قراءةٌ فقط من Render API (GET) — لا شراءَ ولا تغييرَ خطّةٍ ولا إعادةَ نشرٍ.

## §1 حكمُ main `c386a98e`

| الفحصُ | الدعوةُ | الحكمُ |
|---|---|---|
| WASLA CI | [39186018083](https://github.com/skyosv10-art/wasla/actions/runs/39186018083) | **success** |
| Roadmap freshness | [39186018067](https://github.com/skyosv10-art/wasla/actions/runs/39186018067) | **success** |
| Render deploy | [39186018063](https://github.com/skyosv10-art/wasla/actions/runs/39186018063) | **FAIL** — 24/24 `triggered=build_failed` · `live=811341d` لكلِّ خدمةٍ ([raw](raw/render-deploy-39186018063-verdict.txt)) |

## §2 السببُ الجذريُّ (مقيسٌ لا مُستنتَجٌ)

سجلُّ بناءِ `wasla-prometheus` (`dep-dban7rrbc2fs73c1vrag`) — خدمةٌ لا تمسُّها شفرةُ #772 ([raw](raw/render-build-log-wasla-prometheus.txt)):

> `==> Build canceled: your workspace has run out of build pipeline minutes for the current billing period.`

- كلُّ الخدماتِ الـ24 فشلت في الثانيةِ نفسِها تقريبًا، ومنها `alertmanager`/`prometheus`/`otel-collector` التي لا تعتمدُ على `apps/customer-mini-app` ← **الشفرةُ مستبعَدةٌ**.
- عمليّاتُ النشرِ في مساحةِ `tea-db0vtkpsrm7s739dm5c0` منذ 2026-10-01: 897 (`deactivated` 832 · `live` 24 · `update_failed` 17 · `build_failed` 24)؛ أوّلُ `build_failed` في 2026-10-19T01:35:11Z ([raw](raw/render-deploys-since-2026-10-01.txt)).
- الإنتاجُ مجمَّدٌ على `811341de` (CLM-0618)؛ #770/#771 وثائقُ فلم تُطلقا نشرًا.
- **سابقةٌ:** RISK-0063 (المساحةُ القديمةُ، مُغلقٌ في CLM-0505) — الحالةُ نفسُها تتكرّرُ على المساحةِ الجديدةِ؛ RISK-0063 لا يُعادُ فتحُه (حكمُه صحيحٌ لمساحتِه) ويُفتحُ **RISK-0068**.

## §3 أثرُه على G-S9.1 (CLM-0622)

تصحيحُ G-S9.1 في main ومُثبتٌ بـCI، لكنّه **غيرُ منشورٍ**: لا يُعدُّ «حيًّا» ولا يُستندُ إليه دليلًا إنتاجيًّا. الحكمُ: **CI ✓ · النشرُ محجوبٌ بـRISK-0068**. (الحدُّ مغلقٌ أصلًا، فلا مستخدمَ يرى الفرقَ.)

## §4 قرارُ المالكِ (لا يتّخذُه الوكيلُ)

حاجزُ فوترةٍ — ثلاثةُ مساراتٍ كما في حزمةِ CLM-0497 §5: (أ) رفعُ حدِّ إنفاقِ البناءِ · (ب) ترقيةُ خطّةِ المساحةِ · (ج) انتظارُ تجدّدِ الحصّةِ مع بدايةِ فترةِ الفوترةِ التاليةِ. **توصيةٌ تقنيّةٌ للتحقّقِ بعدَها:** كلُّ دفعٍ غيرِ وثائقيٍّ إلى main يعيدُ نشرَ الخدماتِ الـ24 (`render-deploy.yml`) — 37 جولةً كاملةً تقريبًا هذه الفترةَ؛ تقييدُ النشرِ بالخدماتِ المتأثّرةِ يُحسَمُ بقرارٍ/ADR لاحقٍ لا في هذا الحجزِ. بعدَ استعادةِ البناءِ: تشغيلُ `render-deploy.yml` على main وتسجيلُ `live=` لإغلاقِ نشرِ CLM-0622.

## §5 قرارٌ مكتوبٌ: إعادةُ توليدِ الأساسِ (M0-08)

فتحُ RISK-0068 غيّرَ `risks_not_closed` من 23 إلى 24، فأخفقَ الفحصُ 11 («الحيُّ يخالفُ المُلتزَمَ»). القرارُ: إعادةُ توليدِ `docs/12-testing/BASELINE.json/txt` وفقَ BASELINE_FORMAT §4، لأنَّ الزيادةَ خطرٌ حقيقيٌّ مُسجَّلٌ لا انحدارٌ: `verify.sh` ← [raw](raw/verify-log-stale-baseline-only.txt) (إخفاقُه الوحيدُ هذا الفرقُ نفسُه) ← `baseline.sh --log` على شجرةٍ نظيفةٍ ← `validate-baseline.sh` ✓ (`dirty=false` · tests_passed 6158).

**G-S9 الأمُّ مفتوحةٌ. لا نسبةَ اكتمالٍ لـM0-53.**
