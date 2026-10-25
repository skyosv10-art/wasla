# CLM-0631 — تشغيلُ Render بعدَ دمجِ CLM-0630 (`96560124`)

**الحجزُ:** CLM-0631 · **العنصرُ:** M6-18B · توثيقٌ فقط. **RISK-0068 open.**

| البندُ | القيمةُ |
|---|---|
| PR | #778 مدموجٌ `96560124540aa8f93464bfcc5e1a5eeed8d9bc34` عبرَ `merge-on-approved-head.sh` (42/42 على الرأسِ `9a9f2a1f`) |
| CI على main | WASLA CI 39212686359 — success · Roadmap freshness 39212686311 — success |
| Render | run 39212686384 — **FAIL** ([log](raw/render-deploy-39212686384.log) · [render-sync.json](raw/render-sync-96560124.json)) |
| السياسةُ في الملفِّ | `runtime-input equivalence (CLM-0628/CLM-0630); image bytes not compared` |
| السجلُّ | `runtime-read registry from target, audited on target` — أوّلُ تشغيلٍ بالبصمةِ المربوطةِ بالهدفِ |
| الخطّةُ | deploy 1/24 (`wasla-customer-app`، حيٌّ `811341de`) · 23 `runtime-equivalent` (كلُّها حيّةٌ `811341de`) |
| السببُ | حدثُ Render لـ`srv-db3mvn7lk1mc73c6jmv0` في 2026-10-19T06:55:15Z: `pipeline_minutes_exhausted` ثمَّ `deploy_ended` |

**الحكمُ:** FAIL صادقٌ — لم يُنشَرْ شيءٌ؛ الإنتاجُ كلُّه على `811341de`. CLM-0622 غيرُ منشورٍ. لا تغييرَ لحدودِ الإنفاقِ أو الخطّةِ أو قائمةِ السماحِ. الاستعادةُ عندَ تأكيدِ المالكِ: إعادةُ فحصِ ما قبلَ التشغيلِ ([CLM-0630 §5](../2026-10-19T160000Z-clm-0630-runtime-reads-hardening/README.md)) ثمَّ `workflow_dispatch` بـ`sha=cd5a8648cdebbf071373f7a1ff7bf9b03c193cd4` و`full=false`. G-S9 مفتوحةٌ · M0-53 In Progress.
