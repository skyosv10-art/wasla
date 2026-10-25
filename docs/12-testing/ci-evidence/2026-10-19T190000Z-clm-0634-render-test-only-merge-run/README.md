# CLM-0634 — دمجُ CLM-0632 (`46058120`): أوّلُ دمجٍ إلى main بلا نشرٍ إلى Render

**الحجزُ:** CLM-0634 · **العنصرُ:** M6-18B · توثيقٌ فقط · [ADR-073](../../../15-decisions/ADR-073-render-test-environment-only.md)

| البند | المقيس |
|---|---|
| PR | #780 مدموجٌ `46058120b3fd3a551c66aff388d6431aea4d7cdf` عبرَ `merge-on-approved-head.sh` (42/42 على الرأسِ `45837909`) |
| التشغيلاتُ على الدمج | [raw/runs-on-46058120.json](raw/runs-on-46058120.json): **WASLA CI 39225527915 success** · Roadmap freshness 39225528009 success — **لا تشغيلَ لـ`render-deploy.yml`** |
| Render بعدَ الدمج | [raw/render-latest-deploy-per-service.json](raw/render-latest-deploy-per-service.json): آخرُ نشرٍ في المساحةِ 2026-10-19T07:25:22Z (تشغيلُ `f64d4228` قبلَ التغيير) · 24/24 حيّةٌ على `811341de` · لا بناءَ ولا دقائقَ مستهلكةٌ |

**الحكم:** النشرُ التلقائيُّ متوقّفٌ فعلًا لا بالتصريحِ فقط. الهدفُ `frozen` (RISK-0069). الحالاتُ دونَ تغيير: G-S9 مفتوحةٌ · M0-53 In Progress · M6-18B Blocked · CLM-0622 غيرُ منشورٍ · RISK-0066/0068/0069 `open`.
