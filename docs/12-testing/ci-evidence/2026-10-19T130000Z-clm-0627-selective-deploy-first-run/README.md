# CLM-0627 — أوّلُ تشغيلٍ انتقائيٍّ على main (#774)

**الحجزُ:** CLM-0627 · **العنصرُ:** M6-18B · **الأساسُ:** main `787c2b9b` (دمجُ [#774](https://github.com/skyosv10-art/wasla/pull/774) — CLM-0626). وثائقُ فقط.

## §1 الحكمُ على main `787c2b9b`

| الفحصُ | الدعوةُ | الحكمُ |
|---|---|---|
| WASLA CI | [39197470531](https://github.com/skyosv10-art/wasla/actions/runs/39197470531) | **success** |
| Roadmap freshness | [39197470434](https://github.com/skyosv10-art/wasla/actions/runs/39197470434) | **success** |
| Render deploy | [39197470468](https://github.com/skyosv10-art/wasla/actions/runs/39197470468) | **FAIL** (صادقٌ) |

## §2 ما قاسَه تشغيلُ Render

- `plan: deploy 1/24 (target 787c2b9b)` — `wasla-customer-app` (`live=811341d`، «6 input file(s) changed» = ملفّاتُ #772). الهدفُ يحملُ تغييرَ `scripts/deploy/` (#774) ولم يُطلقْ بناءَ أيِّ صورةٍ: ليسَ مدخلًا لأيِّ خدمةٍ.
- طلبُ نشرٍ واحدٌ `dep-dbapcinbtjjs7382s2qg` بدلَ 24 ← `build_failed`؛ سجلُّ Render: «Build canceled: your workspace has run out of build pipeline minutes» ([raw](raw/render-build-log-wasla-customer-app.txt)).
- الـ23 الباقيةُ `equivalent` بـ`✓`؛ الحكمُ `FAIL` لأنَّ الخدمةَ الوحيدةَ المطلوبةَ لم تصلْ إلى المستهدَفِ — لا نجاحَ جزئيٌّ يُعلَنُ نجاحًا.

## §3 الحالةُ

- **سببُ التكرارِ عولِجَ ومقيسٌ على main** (1 بدلَ 24).
- **RISK-0068 open:** الاستعادةُ لم تُثبَتْ — تنتظرُ قرارَ المالكِ ثمَّ تشغيلًا PASS على main.
- **CLM-0622 (G-S9.1) غيرُ منشورٍ**؛ مساراتُ المتاجرِ محجوبةٌ في الحدِّ — لا ميزةَ متاحةً تُعلَنُ.
- هذا الدمجُ الوثائقيُّ نفسُه سيُشغِّلُ `render-deploy.yml` (بلا `paths-ignore`) فيعيدُ المحاولةَ لـ`wasla-customer-app` وحدَه — ويفشلُ للسببِ نفسِه حتى الاستعادةِ.
- **G-S9 الأمُّ مفتوحةٌ. لا نسبةَ اكتمالٍ لـM0-53.**
