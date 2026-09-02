# دليلُ CI لبوّاباتِ `M0-01` و`M0-02` و`M0-03` — أربعةُ تشغيلاتٍ مستقلّةٍ على شجرةٍ واحدةٍ

> **قاعدةُ هذا المجلَّد:** كلُّ رقمٍ مقروءٌ من واجهةِ GitHub أو من سجلٍّ مُلتزَمٍ في
> المستودعِ، لا من ذاكرةٍ ولا من وصفٍ. **ولا يُكرَّرُ ملفٌّ خامٌ محفوظٌ في مجلَّدٍ
> آخرَ** — يُحالُ إليه بالمسار.

## 1. الأربعةُ المقيسةُ

| التشغيل | الحدث · الفرع | الالتزام | الوظائف | بدأت | النتيجة |
|---|---|---|---|---|---|
| [`33566652310`](https://github.com/skyosv10-art/wasla/actions/runs/33566652310) | `pull_request` · `feat/m0-22b-remaining-jobs` | `7b258647` | 26 | **26** | `success` 26 |
| [`33567256847`](https://github.com/skyosv10-art/wasla/actions/runs/33567256847) | `pull_request` · `feat/m0-22b-remaining-jobs` | `9afd9d52` | 26 | **26** | `success` 26 |
| [`33569807797`](https://github.com/skyosv10-art/wasla/actions/runs/33569807797) | `push` · **`main`** | `0a752470` | 26 | **26** | `success` 26 |
| [`33573216083`](https://github.com/skyosv10-art/wasla/actions/runs/33573216083) | `pull_request` · `chore/m0-22b-gate-closeout` | `1375ce2e` | 26 | **26** | `success` 26 |

الحقولُ الخامُ لكلِّ تشغيلٍ في `jobs-<run_id>.json`، والمحصّلةُ في `verdict.json`.
**وصفرُ وظيفةٍ بـ`started_at = null` في الأربعةِ** — وهو الفرقُ الذي دامَ ثمانيةَ
خطوطٍ على GitLab.

## 2. ولمَ تُقرأُ الأربعةُ معاً — لأنّ الشفرةَ واحدةٌ، مقيسةً

`git diff --name-only <sha> 0a752470 -- packages services scripts` أجابَ **صفرَ
ملفّاتٍ** في الأربعةِ جميعاً. فالفرقُ بينَ هذه الالتزاماتِ **وثائقُ وملفّا إعدادِ
خطٍّ** لا شفرةٌ ولا نصوصُ فحصٍ.

**وأثرُ ذلكَ على الحكمِ:** معيارُ `M0-02` يطلبُ «أخضرَ **مرّتَينِ**»، وهذا **أربعُ
تنفيذاتٍ مستقلّةٍ** لنفسِ الشفرةِ في أربعِ بيئاتٍ نظيفةٍ مختلفةٍ — لا تشغيلٌ واحدٌ
قُرئ أربعَ مرّاتٍ. **وما لا يُدَّعى:** ليست الأربعةُ اختباراً لتقلُّبٍ نادرٍ يظهرُ
في واحدٍ من عشرةٍ (انظر بوّابةَ `M0-03`).

## 3. الأدلّةُ السطريّةُ — وأينَ تُقرأُ

| البند | السجلُّ المُلتزَمُ | ما فيه حرفيّاً |
|---|---|---|
| `M0-01` · حارسُ التركيبِ | [`test.raw.txt`](../2026-09-01T104148Z-m0-21-github-actions/ci-artifacts/test-log/test.raw.txt) | `services/subscriptions test: ✓ src/__tests__/composition.test.ts (10 tests)` · `Test Files 12 passed` · `Tests 215 passed (215)` |
| `M0-01` · الأنواعُ | [`typecheck.raw.txt`](../2026-09-01T104148Z-m0-21-github-actions/ci-artifacts/typecheck-log/typecheck.raw.txt) | `services/subscriptions typecheck$ tsc -p tsconfig.json --noEmit` · `Done` |
| `M0-02` · مطابقةُ المنفذِ | [`drivers-db.raw.txt`](../2026-09-02T000000Z-m0-22b-remaining-jobs/job-logs/drivers-db.raw.txt) | `✓ src/__tests__/port-conformance.integration.test.ts (23 tests)` · `Tests 79 passed (79)` |
| `M0-03` · مستودعُ الهويّةِ | [`identity-db.raw.txt`](../2026-09-02T000000Z-m0-22b-remaining-jobs/job-logs/identity-db.raw.txt) | `✓ src/__tests__/postgres-repository.integration.test.ts (3 tests)` · `Tests 5 passed (5)` |

## 4. حدودٌ مُعلَنةٌ لا تُطوى

1. **سجلّاتُ هذه التشغيلاتِ الأربعةِ الخامُ ليست محفوظةً هنا** — لا لأنّها لم تُطلَب بل لأنّ مضيفَ التنزيلِ (`productionresultssa9.blob.core.windows.net`) **محجوبٌ في بيئةِ التنفيذِ** (`CONNECT tunnel failed, 403`). والأدلّةُ السطريّةُ في §3 من **سجلّاتٍ مُلتزَمةٍ في المستودعِ** لتشغيلَينِ أسبقَ (`33566652310` و`33498726052`)، وجسرُهما إلى `main` قياسٌ (§2) لا ظنٌّ.
2. **الأربعةُ لا تُثبِتُ غيابَ تقلُّبٍ نادرٍ.** أربعُ تنفيذاتٍ ناجحةٍ ليست عشراً، ولا هي تشغيلٌ متتابعٌ على قاعدةٍ واحدةٍ. وهذا يمسُّ `M0-03` و`M0-18` صريحاً ومكتوبٌ في بوّابتَيهما.
3. **الخطُّ يُنفِّذُ ولا يَمنعُ** — `required_status_checks` غيرُ مُسجَّلٍ (`M0-22A` محجوبٌ · `RISK-0002` مفتوحٌ). فنتائجُ الأربعةِ **إخباريّةٌ لا مانعةٌ**.
4. **`PRODUCTION` ما زالت `NOT VERIFIED`** لكلِّ عنصرٍ من الثلاثةِ — لا طبقةَ نشرٍ في المستودعِ (`infra/*` فيها `.gitkeep` وحدَها).
