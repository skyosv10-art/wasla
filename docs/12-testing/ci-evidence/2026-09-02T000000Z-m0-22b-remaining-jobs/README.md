# `M0-22B` — العشرون وظيفةً: تشغيلٌ حقيقيٌّ واحدٌ، أخضرُ من أوّلِ مرّة

**التشغيل:** [`33566652310`](https://github.com/skyosv10-art/wasla/actions/runs/33566652310) · حَدَثُ `pull_request` على [PR #5](https://github.com/skyosv10-art/wasla/pull/5) · **26 وظيفةً · 26 `success` · 26 منها `started_at ≠ null` · 0 لم تبدأ.**

> **⚠️ ويُقرأُ هذا الملفُّ بشرطِه لا بلونِه:** `RISK-0002` مفتوحٌ، فهذه العشرون — كالستِّ قبلَها — **تُنفِّذُ وتحكمُ ولا يَنفُذُ حكمُها**. نتيجتُها اليومَ **إخباريّةٌ**، ودمجُ طلبٍ أحمرَ ما زال ممكناً بضغطةِ زرٍّ. راجع [حاجزَ `M0-22A`](../2026-09-01T220000Z-m0-22a-branch-protection/README.md).

## 1. الوظائفُ العشرون واحدةً واحدةً

| الوظيفة | الساق | النتيجة | بدأت | ملفات | اختبارات | المدة |
|---|---|---|---|---|---|---|
| `db-integration` | `channel` | ✅ success | ✓ | 2 | 21 | 37s |
| `db-integration` | `customer` | ✅ success | ✓ | 2 | 43 | 40s |
| `db-integration` | `dispatch` | ✅ success | ✓ | 3 | 48 | 42s |
| `db-integration` | `drivers` | ✅ success | ✓ | 3 | 79 | 42s |
| `db-integration` | `geography` | ✅ success | ✓ | 2 | 7 | 48s |
| `db-integration` | `identity` | ✅ success | ✓ | 2 | 5 | 39s |
| `db-integration` | `marketplace` | ✅ success | ✓ | 10 | 118 | 71s |
| `db-integration` | `matching` | ✅ success | ✓ | 3 | 33 | 41s |
| `db-integration` | `negotiations` | ✅ success | ✓ | 3 | 62 | 36s |
| `db-integration` | `order` | ✅ success | ✓ | 3 | 32 | 41s |
| `db-integration` | `reputation` | ✅ success | ✓ | 3 | 52 | 42s |
| `db-integration` | `subscriptions` | ✅ success | ✓ | 5 | 62 | 44s |
| `exit-gate-e2e` | `channel` | ✅ success | ✓ | 2 | 25 | 36s |
| `exit-gate-e2e` | `customer` | ✅ success | ✓ | 1 | 11 | 40s |
| `exit-gate-e2e` | `dispatch` | ✅ success | ✓ | 2 | 13 | 38s |
| `exit-gate-e2e` | `driver` | ✅ success | ✓ | 1 | 14 | 57s |
| `exit-gate-e2e` | `marketplace` | ✅ success | ✓ | 1 | 6 | 40s |
| `exit-gate-e2e` | `negotiation` | ✅ success | ✓ | 1 | 8 | 42s |
| `exit-gate-e2e` | `order` | ✅ success | ✓ | 1 | 16 | 49s |
| `exit-gate-e2e` | `subscription` | ✅ success | ✓ | 1 | 3 | 37s |
**المجموع: 51 ملفَّ اختبارٍ · 658 اختباراً · 0 فاشلاً.**

## 2. ولمَ لا يُقبَلُ الأخضرُ على ظاهرِه

الوظائفُ انتهت في 36–71 ثانيةً، وهي سرعةٌ تُغري بالطمأنينةِ وتستحقُّ الشكَّ: **اختبارٌ لا يجدُ ملفّاتٍ يمرُّ أيضاً.** فسُئلت السجلّاتُ العشرون عن ثلاثةِ أشياءَ:

1. **هل جرت اختباراتٌ فعلاً؟** كلُّ ساقٍ طبعت `Test Files N passed` و`Tests M passed` بأعدادٍ **مختلفةٍ بينَها** — من 3 اختباراتٍ في `subscription-e2e` إلى 118 في `marketplace-db`. ولو كان الأخضرُ فارغاً لتشابهت الأصفار.
2. **هل تُخُطِّي شيءٌ صامتاً؟** بُحث في السجلّاتِ العشرين عن `skipped` و`in-memory` و`fallback`: **لا مطابقةَ واحدةً** غيرَ رسالةِ pnpm الروتينيّةِ `Lockfile is up to date, resolution step is skipped` (20 مرّةً). **صفرُ اختبارٍ متخطًّى.**
3. **هل قامت قاعدةُ البياناتِ حقّاً؟** كلُّ ساقٍ تُظهرُ `Starting postgres service container` ثمّ `docker pull postgres:15` ثمّ `Status: Downloaded newer image` — حاويةٌ حقيقيّةٌ لكلِّ ساقٍ بقاعدةٍ مستقلّةِ الاسم.

**وما لم يُثبَت هنا يُقالُ صراحةً:** لم يُفتَح اتّصالٌ مستقلٌّ للتحقُّقِ من أنّ كلَّ اختبارٍ كتبَ صفّاً في Postgres. المُعتمَدُ أنّ إعداداتِ `vitest.integration.config.ts` تُخفقُ عندَ تعذُّرِ الوصلِ — وهذا **استنتاجٌ من الإعدادِ لا قياسٌ مباشرٌ**.

## 3. التكافؤُ مع `.gitlab-ci.yml`

[`check-equivalence.py`](check-equivalence.py) يقرأُ الملفَّين ويقارنُ كلَّ وظيفةٍ بساقِها في خمسةِ حقولٍ: اسمُ القاعدةِ · صورةُ الخدمةِ · اسمُ متغيّرِ الوصلِ · سلسلةُ الوصلِ كاملةً · قائمةُ الأوامرِ. النتيجةُ في [`equivalence.txt`](equivalence.txt): **20/20 مطابقةٌ · 0 مختلفةٌ**. والمُدقِّقُ يُوقِفُ نفسَه إن اختلَّ الاقترانُ بينَ المجموعتَين، ويخرجُ برمزِ 1 عندَ أيِّ فرقٍ — فهو **قابلٌ لإعادةِ التشغيلِ لا لقطةٌ**. والفروقُ الثلاثةُ المنصوصةُ (الحاويةُ · `apk add git` · كتابةُ اسمِ المتغيّرِ إلى `$GITHUB_ENV`) مشروحةٌ بأسبابِها في [ADR-023 §7.4](../../../15-decisions/ADR-023-ci-migration-to-github-actions.md).

## 4. الحالُ الرسميّةُ — ولمَ ليست `COMPLETED`

```
Implementation        ✅ COMPLETE
Behavioral Equivalence ✅ VERIFIED (20/20 بمُدقِّقٍ آليٍّ)
GitHub CI             ✅ VERIFIED (26/26 · لا وظيفةَ لم تبدأ)
Local Verification    ⛔ NOT POSSIBLE — لا docker ولا psql في بيئةِ العمل
Enforcement           ⛔ NOT VERIFIED — RISK-0002 مفتوحٌ (حاجزُ M0-22A)
STATUS                🟡 IN PROGRESS
```

**وبقاعدةِ الأدلّةِ الثلاثةِ ([`STATUS_MODEL` §2.8](../../../00-rules/STATUS_MODEL.md)) لا تبلغُ `M0-22B` حالَ `COMPLETED`** ولو خضرَّت العشرون كلُّها: الدليلُ الثاني (تحقُّقٌ محلّيٌّ مستقلٌّ) **متعذِّرٌ لا مفقودٌ إهمالاً**، والثالثُ (بوّابةٌ نافذةٌ) محجوبٌ بحاجزِ `403`. **ونحن لا نطاردُ الأخضرَ، بل الدليل.**
