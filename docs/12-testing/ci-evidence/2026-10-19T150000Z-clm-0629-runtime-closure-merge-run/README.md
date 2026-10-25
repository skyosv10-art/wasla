# CLM-0629 — تشغيلُ Render بعدَ دمجِ CLM-0628 (`0cc96428`)

**الحجزُ:** CLM-0629 · **العنصرُ:** M6-18B · توثيقٌ فقط. **RISK-0068 open.**

| البندُ | القيمةُ |
|---|---|
| PR | #776 مدموجٌ `0cc964287162b27c0dd28060ffeff5e0fe94be7e` عبرَ `merge-on-approved-head.sh` (42/42 نجاحًا على الرأسِ `5e7d7854`) |
| CI على main | WASLA CI 39203999652 — success |
| Render | run 39203999638 — **FAIL** ([log](raw/render-deploy-39203999638.log) · [render-sync.json](raw/render-sync-0cc96428.json)) |
| السياسةُ في الملفِّ | `runtime-input equivalence (CLM-0628); image bytes not compared` |
| السجلُّ | `runtime-read registry from target, audited on target` — أوّلُ تشغيلٍ بسجلِّ الهدفِ نفسِه |
| الخطّةُ | deploy 1/24 (`wasla-customer-app`، حيٌّ `811341de`) · 23 `runtime-equivalent` (كلُّها حيّةٌ `811341de`) |
| السببُ | حدثُ Render لـ`srv-db3mvn7lk1mc73c6jmv0` في 2026-10-19T05:20:23Z: `pipeline_minutes_exhausted` ثمَّ `deploy_ended failed` |

**الحكمُ:** FAIL صادقٌ — لم يُنشَرْ شيءٌ؛ الإنتاجُ كلُّه على `811341de`. CLM-0622 غيرُ منشورٍ. لا تغييرَ لحدودِ الإنفاقِ أو الخطّةِ (يتطلّبُ المالكَ). الاستعادةُ: عندَ تأكيدِ المالكِ `workflow_dispatch` بـ`sha=cd5a8648cdebbf071373f7a1ff7bf9b03c193cd4` و`full=false`. G-S9 مفتوحةٌ · M0-53 In Progress.
