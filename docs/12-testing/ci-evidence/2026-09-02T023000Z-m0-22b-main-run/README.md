# `M0-22B` — دليلُ التشغيلِ على `main` بعدَ الدمج: 26/26

**التشغيل:** [`33569807797`](https://github.com/skyosv10-art/wasla/actions/runs/33569807797) · حدثُ `push` · فرعُ **`main`** · الالتزامُ `0a7524705bc06ac13b1a9077584bc369e6d3fa68` (دمجُ [PR #5](https://github.com/skyosv10-art/wasla/pull/5)) · `conclusion: success` · بدأ `2026-09-01T23:10:37Z` وانتهى `2026-09-01T23:13:24Z`.

**المقيسُ:** **26 وظيفةً · 26 `success` · 26 منها `started_at ≠ null` · صفرُ وظيفةٍ لم تبدأ.** والحسابُ من `jobs.json` المحفوظِ هنا لا من قراءةِ شاشةٍ.

> **ولمَ يُحفَظُ هذا الدليلُ وقد حُفظ دليلُ الطلبِ قبلَه:** دليلُ [`2026-09-02T000000Z-m0-22b-remaining-jobs/`](../2026-09-02T000000Z-m0-22b-remaining-jobs/README.md) قِيسَ على حدثِ `pull_request` على فرعٍ جانبيٍّ. و[`STATUS_MODEL.md` §2.8](../../00-rules/STATUS_MODEL.md) تنصُّ صريحاً أنّ «خطّاً أخضرَ على فرعٍ جانبيٍّ حين تنصُّ البوّابةُ على `main`» **لا يُحتسَبُ دليلاً**. فهذا الملفُّ يسدُّ ذلك الفرقَ بعينِه: التشغيلُ نفسُه على `main`.

---

## 1. الوظائفُ السّتُّ والعشرون واحدةً واحدةً

| الوظيفة | الساق | النتيجة | بدأت | الخطواتُ الناجحة | المدة |
|---|---|---|---|---|---|
| `doc-coverage` | — | ✅ success | ✓ | 5/5 | 8s |
| `governance-guard` | — | ✅ success | ✓ | 9/9 | 60s |
| `repo-structure` | — | ✅ success | ✓ | 8/8 | 9s |
| `test` | — | ✅ success | ✓ | 10/10 | 123s |
| `typecheck` | — | ✅ success | ✓ | 10/10 | 163s |
| `verify` | — | ✅ success | ✓ | 9/9 | 57s |
| `db-integration` | `channel` | ✅ success | ✓ | 10/10 | 36s |
| `db-integration` | `customer` | ✅ success | ✓ | 10/10 | 40s |
| `db-integration` | `dispatch` | ✅ success | ✓ | 10/10 | 44s |
| `db-integration` | `drivers` | ✅ success | ✓ | 10/10 | 43s |
| `db-integration` | `geography` | ✅ success | ✓ | 10/10 | 40s |
| `db-integration` | `identity` | ✅ success | ✓ | 10/10 | 39s |
| `db-integration` | `marketplace` | ✅ success | ✓ | 10/10 | 53s |
| `db-integration` | `matching` | ✅ success | ✓ | 10/10 | 40s |
| `db-integration` | `negotiations` | ✅ success | ✓ | 10/10 | 59s |
| `db-integration` | `order` | ✅ success | ✓ | 10/10 | 40s |
| `db-integration` | `reputation` | ✅ success | ✓ | 10/10 | 39s |
| `db-integration` | `subscriptions` | ✅ success | ✓ | 10/10 | 43s |
| `exit-gate-e2e` | `channel` | ✅ success | ✓ | 11/11 | 36s |
| `exit-gate-e2e` | `customer` | ✅ success | ✓ | 11/11 | 39s |
| `exit-gate-e2e` | `dispatch` | ✅ success | ✓ | 11/11 | 41s |
| `exit-gate-e2e` | `driver` | ✅ success | ✓ | 11/11 | 54s |
| `exit-gate-e2e` | `marketplace` | ✅ success | ✓ | 11/11 | 38s |
| `exit-gate-e2e` | `negotiation` | ✅ success | ✓ | 11/11 | 53s |
| `exit-gate-e2e` | `order` | ✅ success | ✓ | 11/11 | 52s |
| `exit-gate-e2e` | `subscription` | ✅ success | ✓ | 11/11 | 39s |

**الخطواتُ:** كلُّ خطوةٍ في كلِّ وظيفةٍ `success` — لا خطوةَ `skipped` ولا `cancelled` في التشغيلِ كلِّه.

## 2. ولمَ لا يُقبَلُ الأخضرُ على ظاهرِه

الوظيفةُ التي لا تجدُ ملفّاتِ اختبارٍ تمرُّ خضراءَ أيضاً. والسؤالُ الصحيحُ ليس «هل هي خضراءُ» بل «هل جرى فيها شيءٌ». وثلاثةُ أشياءَ تُجيبُ هنا:

1. **الحاوياتُ قامت فعلاً:** لكلِّ ساقٍ من العشرينَ خطوةُ `Initialize containers` ناجحةٌ، ثمّ خطوةُ `Stop containers` — أي أنّ خدمةَ `postgres` رُفعت لكلِّ ساقٍ وحدَها بقاعدةٍ مستقلّةِ الاسمِ (`wasla_marketplace_test` · `wasla_order_e2e` · … مقروءةً من أسماءِ الوظائفِ نفسِها في `jobs.json`).
2. **خطوةُ الاختبارِ موجودةٌ ومسمّاةٌ ومنفَّذةٌ:** في وظائفِ التكاملِ خطوةُ `<الساق> · test:integration`، وفي البوّاباتِ خطوةُ `<الساق> · exit gate` — كلُّها `success`.
3. **الأعدادُ مُقاسةٌ في تشغيلٍ على الشجرةِ نفسِها:** **51 ملفَّ اختبارٍ · 658 اختباراً · 0 فاشلاً · 0 متخطًّى صامتاً**، مقيسةً من سجلّاتِ التشغيلِ [`33566652310`](https://github.com/skyosv10-art/wasla/actions/runs/33566652310) المحفوظةِ خاماً في [`../2026-09-02T000000Z-m0-22b-remaining-jobs/job-logs/`](../2026-09-02T000000Z-m0-22b-remaining-jobs/). **والنقلُ مشروعٌ هنا لسببٍ مقيسٍ لا لتقاربٍ في الظنِّ:** `git diff --stat 9afd9d5 0a75247` أجابَ **صفرَ ملفّاتٍ** — فشجرةُ رأسِ الطلبِ وشجرةُ `main` بعدَ الدمجِ **واحدةٌ حرفاً**، فما جرى هناك هو ما جرى هنا على الشفرةِ نفسِها.

## 3. حدٌّ مُعلَنٌ في هذا الدليلِ لا يُطوى

**سجلّاتُ الوظائفِ الخامُ لهذا التشغيلِ غيرُ محفوظةٍ هنا، ولم تُحفَظ لأنّها لم تُتَح لا لأنّها لم تُطلَب.** واجهةُ `GET /actions/jobs/{id}/logs` تُجيبُ `302` إلى مضيفٍ خارجيٍّ (`productionresultssa9.blob.core.windows.net`) وهو **محجوبٌ في بيئةِ التنفيذِ** — أجابَ الوسيطُ `CONNECT tunnel failed, response 403` في كلِّ محاولةٍ. فالمحفوظُ هنا: `run.json` و`jobs.json` (وفيه كلُّ خطوةٍ بنتيجتِها وتوقيتِها) و`jobs-table.md`. **والسجلّاتُ الخامُ للشجرةِ نفسِها محفوظةٌ في دليلِ الطلبِ** (§2 البندُ 3) فلا يُدَّعى غيابُ ما هو موجودٌ، ولا يُدَّعى وجودُ ما هو غائبٌ.

## 4. وما لا يُغلِقُه هذا الأخضرُ

`RISK-0002` **مفتوحٌ**. فهذه السّتُّ والعشرونَ — كالسّتِّ قبلَها — **تُنفِّذُ وتحكمُ ولا يَنفُذُ حكمُها**: لا `required_status_checks` على `main` ولا حمايةَ فرعٍ، فدمجُ طلبٍ أحمرَ ما زال ممكناً بضغطةِ زرٍّ. ونتيجةُ هذا التشغيلِ **إخباريّةٌ لا مانعةٌ**، والمانعُ نطاقُ `M0-22A` وهو محجوبٌ بحاجزِ خطّةِ حسابٍ مقيسٍ (`403`) — [الدليلُ الخام](../2026-09-01T220000Z-m0-22a-branch-protection/README.md).
