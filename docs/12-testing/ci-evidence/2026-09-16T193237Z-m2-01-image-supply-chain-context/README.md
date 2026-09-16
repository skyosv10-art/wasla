# دليلٌ خامٌّ — إضافةُ السياقِ الحاجزِ `image-supply-chain` (M2-01)

> **القياسُ:** 2026-09-16T19:32:37Z · **العنصرُ:** `M2-01` · **الحجزُ:** `CLM-0195`
> **الفاعلُ:** @uxxxu (agent:perplexity-computer) بتفويضٍ تنفيذيٍّ صريحٍ من مالكِ البرنامجِ (2026-09-16)

## ما جرى بالترتيب

1. أُضيفَت وظيفةُ `image-supply-chain` إلى [`.github/workflows/ci.yml`](../../../../.github/workflows/ci.yml).
2. أُضيفَ سياقُها إلى الحمايةِ الحيّةِ لفرعِ `main`:
   `POST /repos/skyosv10-art/wasla/branches/main/protection/required_status_checks/contexts`
   بحمولةِ `contexts[]=image-supply-chain`.
3. **ثمَّ أُعيدَ القياسُ من الواجهةِ** — لا من ردِّ الكتابةِ ولا بتحريرِ رقمٍ في
   لقطةٍ: `GET /repos/skyosv10-art/wasla/branches/main/protection` ⇒
   [`api-responses/01-protection-after.raw.json`](api-responses/01-protection-after.raw.json).

## ما يُقرأُ من الملفَّينِ

| القياسُ | القيمةُ |
|---|---|
| عددُ السياقاتِ المطلوبةِ | **32** (كانت 31) |
| `image-supply-chain` حاضرٌ | نعم |
| `required_status_checks.strict` | `true` |
| `enforce_admins.enabled` | `true` |
| الفرعُ محميٌّ | `true` ([`02-branch-main.json`](api-responses/02-branch-main.json)) |

ومنهُ حُدِّثَت [`MERGE_BLOCKING.json`](../../MERGE_BLOCKING.json): سياقاتٌ
مُطابقةٌ لوظائفِ الخطِّ في الاتّجاهَينِ + مدخلُ `live_checks` جديدٌ يُحيلُ إلى
الملفِّ الخامِّ هنا.

## الحدُّ المُعلَنُ

**وجودُ السياقِ حاجزاً ليسَ إثباتَ خُضرةِ الوظيفةِ.** حتّى لحظةِ هذا القياسِ
لم تكنْ وظيفةُ `image-supply-chain` قد شُغِّلَت مرّةً واحدةً في تاريخِ
المستودعِ؛ وحكمُها الأوّلُ يُوثَّقُ في [`M2-01_GATE.md`](../../M2-01_GATE.md)
البندِ 13 برقمِ تشغيلٍ — **ولا يُفترَضُ ولا يُستنتَجُ من هذا الملفِّ.**
