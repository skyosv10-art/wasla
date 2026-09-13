# دليلُ قياسٍ — لا حكمَ خطٍّ لفرضِ حدِّ السوقِ (M1-04 · المراجعةُ 29/N · `CLM-0150`)

> **الحالة:** `NOT VERIFIED — JOB DID NOT START` · **التاريخ:** 2026-09-13 ·
> **المصدرُ:** `GET /repos/skyosv10-art/wasla/actions/runs/34779214942` و`…/jobs?per_page=100`
> و`GET /repos/skyosv10-art/wasla/check-runs/<job>/annotations` و`GET /repos/skyosv10-art/wasla/branches/main`

## لماذا يوجد هذا الدليل

دُفِعَ فرعُ `feat/m1-04-enforce-marketplace-boundary` وفُتِحَ
[PR #137](https://github.com/skyosv10-art/wasla/pull/137)، فبدأَ التشغيلُ
`34779214942` وانتهى **في خمسِ ثوانٍ** بـ`conclusion: failure` لكلِّ وظيفةٍ.
و**هذا اللونُ لا يُقرأُ حكماً**: الحكمُ يقتضي أن تكونَ خطوةٌ واحدةٌ قد جرت،
والمقيسُ أنَّ **الوظائفَ الإحدى والثلاثينَ كلَّها بلا خطوةٍ واحدةٍ**. فالحالةُ
تُسجَّلُ `NOT VERIFIED — JOB DID NOT START` **لا `FAIL`**
([`STATUS_MODEL.md`](../../00-rules/STATUS_MODEL.md) القاعدةُ 3): «ما لم يبدأْ لا
يُكتَبُ لهُ حكمٌ» — ونسبةُ الأحمرِ إلى الشفرةِ هنا **كذبٌ في القياسِ** لا تشدُّدٌ
فيه.

## المُقاس (خامّاً لا مُستنتَجاً)

- التشغيلُ: `34779214942` · `event: pull_request` · `head_sha: 562eed74609153abdd84880a05b5a90c0a03fcca`.
- الزمنُ: `created_at 2026-09-13T19:56:35Z` ⇒ `updated_at 2026-09-13T19:56:40Z` — **خمسُ ثوانٍ**،
  وأطولُ وظيفةٍ **4 ثوانٍ**.
- الوظائفُ: **31 مجموعاً · 31 مُستحضَرةً · 31 بـ`steps` طولُها صفرٌ** (لا وظيفةَ واحدةَ استثناءً).
- التنبيهُ الرسميُّ على الوظيفةِ الأولى (`repo-structure`) حرفاً:
  «The job was not started because recent account payments have failed or your
  spending limit needs to be increased. Please check the 'Billing & plans'
  section in your settings» · `annotation_level: failure`.
- **والسببُ خارجُ المستودعِ:** لا علاقةَ لهُ بشفرةِ الدفعةِ ولا بإعدادِ الخطِّ —
  ولا يُعالِجُهُ إلّا مالكُ الحسابِ ([دليلُ التشغيلِ](../../14-runbooks/CI_RUNNER_UNBLOCK.md)).

## وما يُقاسُ في اللقطةِ نفسِها: `main` بلا حماية

`GET /repos/skyosv10-art/wasla/branches/main` ⇒ `"protected": false`
(محفوظٌ في `branch-main.json`). فحتّى لو جرى الخطُّ أخضرَ **لا شيءَ يمنعُ دمجاً
أحمرَ** — وهوَ `RISK-0036` المفتوحُ. ولذلكَ **لم يُدمَجْ هذا الفرعُ**: الدمجُ بلا
حكمِ خطٍّ وبلا حمايةٍ يجعلُ «الأخضرَ» عرفاً لا بوّابةً.

## ما لا يُدَّعى

- **لا يُدَّعى نجاحُ الخطِّ**، ولا يُدَّعى فشلُهُ: لم يبدأْ.
- **والأخضرُ المحلّيُّ ليسَ بديلاً:** `pnpm -r test` **4483/274** و
  `verify-governance` **12/0** و`test-governance` **201/0** — كلُّها قِيسَت على
  هذهِ الآلةِ، وهيَ الطبقةُ `LOCAL` وحدَها. فحالةُ `M1-04` **لا تُرقّى** بهذهِ
  الدفعةِ.
- خُضرةُ CI التاريخيّةُ للموجةِ الخامسةِ
  ([`34065473979`](https://github.com/skyosv10-art/wasla/actions/runs/34065473979)
  · 27/27 · 2026-09-07) **محفوظةٌ ولا تُمَدُّ إلى هذهِ الدفعةِ**.

## الملفات

- `run.json` — جوابُ التشغيلِ الخامُّ كما وصل.
- `jobs.json` — الوظائفُ الإحدى والثلاثونَ بخطواتِها (فارغةٌ كلُّها).
- `annotation.json` — تنبيهُ «لم تبدأِ الوظيفةُ» الرسميُّ.
- `branch-main.json` — لقطةُ `main` غيرِ المحميّةِ في الوقتِ نفسِه.
