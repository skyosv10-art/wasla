# دليلٌ خامٌّ — إضافةُ السياقِ الحاجزِ `db-integration (service-auth, …)` (M1-03 · RISK-0015)

> **القياسُ:** 2026-09-17T14:45:00Z · **العنصرُ:** `M1-03` · **الحجزُ:** `CLM-0202`
> **الفاعلُ:** @uxxxu (agent:perplexity-computer) **بإذنٍ صريحٍ من مالكِ البرنامجِ في هذهِ العمليّةِ بعينِها** (2026-09-17)، لا بالتفويضِ العامِّ وحدَهُ — لأنَّ الكتابةَ هنا **خارجَ المستودعِ** على إعدادِ حمايةِ الفرعِ.

## ما جرى بالترتيب

1. أُضيفَت ساقُ `service-auth` إلى مصفوفةِ `db-integration` في
   [`.github/workflows/ci.yml`](../../../../.github/workflows/ci.yml)، تُشغِّلُ
   `pnpm --filter @wasla/service-auth test:integration` على `postgres:15`
   حقيقيٍّ بقاعدةِ `wasla_replay_test`.
2. وأخفقَ [`validate-merge-blocking.sh`](../../../../scripts/checks/validate-merge-blocking.sh)
   **كما يجبُ أن يُخفِقَ**: وظيفةٌ في الخطِّ ليست سياقاً حاجزاً. وهذهِ **عضّةٌ
   صحيحةٌ لا عائقٌ**: بابُهُ الثاني يُساوي سياقاتِ اللقطةِ بوظائفِ الخطِّ بعدَ
   فردِ المصفوفاتِ، فمَن أضافَ وظيفةً ولم يُسجِّلْها يُرفَضُ دفعُهُ.
3. فأُضيفَ السياقُ إلى الحمايةِ الحيّةِ لفرعِ `main`:
   `POST /repos/skyosv10-art/wasla/branches/main/protection/required_status_checks/contexts`
   بحمولةِ `contexts[]=db-integration (service-auth, @wasla/service-auth, wasla_replay_test)`.
4. **ثمَّ أُعيدَ القياسُ من الواجهةِ** — لا من ردِّ الكتابةِ ولا بتحريرِ رقمٍ في
   لقطةٍ: `GET /repos/skyosv10-art/wasla/branches/main/protection` ⇒
   [`api-responses/01-protection-after.raw.json`](api-responses/01-protection-after.raw.json).

## ما يُقرأُ من الملفَّينِ

| القياسُ | القيمةُ |
|---|---|
| عددُ السياقاتِ المطلوبةِ | **33** (كانت 32) |
| `db-integration (service-auth, @wasla/service-auth, wasla_replay_test)` حاضرٌ | نعم |
| `required_status_checks.strict` | `true` |
| `enforce_admins.enabled` | `true` |
| الفرعُ محميٌّ | `true` ([`02-branch-main.json`](api-responses/02-branch-main.json)) |

ومنهُ حُدِّثَت [`MERGE_BLOCKING.json`](../../MERGE_BLOCKING.json): سياقاتٌ
مُطابقةٌ لوظائفِ الخطِّ في الاتّجاهَينِ + مدخلُ `live_checks` جديدٌ يُحيلُ إلى
الملفِّ الخامِّ هنا.

## الحدُّ المُعلَنُ

**وجودُ السياقِ حاجزاً ليسَ إثباتَ خُضرةِ الوظيفةِ.** حتّى لحظةِ هذا القياسِ
لم تكنْ ساقُ `service-auth` قد شُغِّلَت مرّةً واحدةً في تاريخِ المستودعِ؛
وحكمُها الأوّلُ يُوثَّقُ برقمِ تشغيلٍ في [`TASK_LOG.md`](../../../16-progress/TASK_LOG.md)
وفي [`RISK_REGISTER.md`](../../../07-security/RISK_REGISTER.md) §4 — **ولا
يُفترَضُ ولا يُستنتَجُ من هذا الملفِّ**، ولا تُقلَبُ حالُ `RISK-0015` إلى
`closed` قبلَ صدورِهِ.

**ولا يُدَّعى أنَّ الحمايةَ كلَّها صحيحةٌ بهذا:** ما قِيسَ سياقاتٌ و`strict`
و`enforce_admins` و`protected` — لا غيرُها. و`RISK-0036` (سقوطُ الحمايةِ بسقوطِ
التخويلِ) يبقى مقروءاً بتاريخِهِ في `live_checks`.
