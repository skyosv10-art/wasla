# `M1-01` و`M1-02` — قياسُ بوّابتَينِ بالطفرةِ على شجرةٍ نظيفةٍ

> **الخلاصة:** إحدى عشرةَ طفرةً على شفرةِ الإنتاجِ، كلٌّ منها تكسرُ خاصّيّةً واحدةً مُعلَنةً، ثمّ تُستردُّ الشفرةُ. **وكلُّ طفرةٍ أسقطت الحالاتِ المقصودةَ وحدَها** — فالاختباراتُ تشخيصيّةٌ لا تجميليّةٌ. **وبابٌ واحدٌ لم يُقَس محلّيّاً**: منعُ الإعادةِ، لأنّه قيدُ محرّكِ Postgres ولا محرّكَ في هذه البيئةِ.

## 1. لمَ الطفرةُ لا القراءةُ

`M1-01` و`M1-02` دُمجا على GitLab بالطلبَينِ `!114` و`!115` **في زمنِ `ci_quota_exceeded`**: وظائفُهما `started_at: null`. **و«لم تبدأ» ليست «نجحت»**، فلا يوجدُ دليلٌ تاريخيٌّ يُصادَقُ عليه. والبديلُ ليس قراءةَ الاختباراتِ والحكمَ بأنّها «تبدو كافيةً» — بل **كسرُ ما تدّعي حراستَه والنظرُ أيّها يسقط**.

## 2. كيف قيسَ

[`local-measurements/measure.sh`](local-measurements/measure.sh) — ولها ثلاثةُ قيودٍ مبنيّةٌ فيها:

1. **التفرُّدُ شرطُ تشغيلٍ**: كلُّ سلسلةٍ تُستهدَفُ يُتحقَّقُ أنّها **فريدةٌ** في ملفِّها قبلَ الاستبدالِ، وإلّا خرجت الأداةُ بخطأٍ — فلا طفرةَ تُصيبُ موضعاً غيرَ مقصودٍ.
2. **الاستردادُ بعدَ كلِّ جولةٍ**: `git checkout -- <file>` مباشرةً بعدَ التشغيلِ.
3. **الشجرةُ تُفحَصُ طرفَيها**: `git diff --stat` قبلَ الجولاتِ و`git diff --stat -- packages services` بعدَها. **وكلاهما فارغٌ** ([`tree-before.raw.txt`](local-measurements/tree-before.raw.txt) · [`tree-after.raw.txt`](local-measurements/tree-after.raw.txt)) — فلا طفرةَ تسرَّبت إلى التزامٍ.

**الأساسُ** ([`base.raw.txt`](local-measurements/base.raw.txt)): `auth-sdk` **68 · 0** · `telegram-adapter` **132 · 0** · `identity` **52 · 0** = **252 حالةً في 17 ملفّاً، صفرُ إخفاقٍ**.

## 3. الجولاتُ الإحدى عشرةَ ونتائجُها

| المُعرِّف | الطفرة | الملفّ | الساقط | الحالةُ الساقطةُ |
|---|---|---|---|---|
| [`mut-m1-01a`](local-measurements/mut-m1-01a.raw.txt) | `<` → `<=` في `isExpired` | `auth-sdk/src/authorize.ts` | **1 · 67** | «عندَ لحظةِ الانتهاءِ نفسِها: ما زال سارياً (حدٌّ حصريٌّ مقصود)» |
| [`mut-m1-01b`](local-measurements/mut-m1-01b.raw.txt) | تسريبُ `internalUuid` | `auth-sdk/src/describe.ts` | **1 · 67** | «لا يُخرِج المعرِّفَ الداخليَّ ولا معرِّفَ الجلسةِ الخام» |
| [`mut-m1-01c`](local-measurements/mut-m1-01c.raw.txt) | تعطيلُ فحصِ سببِ المجهوليّةِ | `auth-sdk/src/parse.ts` | **2 · 66** | «يرفض: سببُ مجهوليّةٍ غيرُ معروف» · «يرفض: مجهولٌ بلا سبب» |
| [`mut-m1-01d`](local-measurements/mut-m1-01d.raw.txt) | تعطيلُ فرعِ المجهولِ في `assertScopes` | `auth-sdk/src/authorize.ts` | **1 · 67** | «المجهولُ يُرفَض بـUNAUTHENTICATED لا بـFORBIDDEN» |
| [`mut-m1-02a`](local-measurements/mut-m1-02a.raw.txt) | `timingSafeEqual` → `true` | `telegram-adapter/src/init-data.ts` | **4 · 128** | حرفٌ مختلفٌ · حقلٌ عُدِّل · رمزُ روبوتٍ آخرُ · «يفحص التوقيعَ قبلَ العمرِ» |
| [`mut-m1-02b`](local-measurements/mut-m1-02b.raw.txt) | `>` → `>=` في حدِّ العمرِ | `telegram-adapter/src/init-data.ts` | **1 · 131** | «يقبل عمراً يساوي الحدَّ بالضبط (الحدُّ شاملٌ بقرار)» |
| [`mut-m1-02c`](local-measurements/mut-m1-02c.raw.txt) | حذفُ فحصِ المستقبلِ | `telegram-adapter/src/init-data.ts` | **1 · 131** | «يرفض auth_date من المستقبلِ البعيد» |
| [`mut-m1-02d`](local-measurements/mut-m1-02d.raw.txt) | السماحُ بمفتاحٍ مكرَّرٍ | `telegram-adapter/src/init-data.ts` | **1 · 131** | «يرفض حقلاً مكرَّراً — بابَ تلبيسِ المُعامِلات» |
| [`mut-m1-02e`](local-measurements/mut-m1-02e.raw.txt) | قلبُ ترتيبِ السحبِ/الانتهاءِ | `identity/src/domain/session.ts` | **1 · 51** | «السحبُ يسبق الانتهاءَ في الحكمِ حين يقع الاثنان» |
| [`mut-m1-02f`](local-measurements/mut-m1-02f.raw.txt) | `>=` → `>` في حدِّ الجلسةِ | `identity/src/domain/session.ts` | **2 · 50** | «يرفض **عندَ** لحظةِ الانتهاءِ بالضبط» · «`isSessionValid` يتّفق مع الحدِّ غيرِ الشامل» |
| [`mut-m1-02g`](local-measurements/mut-m1-02g.raw.txt) | حذفُ حارسِ صيغةِ البصمةِ | `identity/src/use-cases/session.ts` | **1 · 51** | «يرفض بصمةً ليست sha256 — خطأُ توصيلٍ لا مُدخَلُ مستخدم» |

**والقُطريّةُ تامّةٌ**: لا جولةَ أسقطت حالةً خارجَ بابِها. والجولاتُ ذاتُ الحالتَينِ أو الأربعِ (`01c` · `02a` · `02f`) **وجوهٌ لفحصٍ واحدٍ** لا تسرُّبٌ: في `02a` مثلاً كلُّ الساقطِ في بابِ التوقيعِ، ومنه ترتيبُ «التوقيعُ قبلَ العمرِ» وهو نتيجةٌ مباشرةٌ لإلغاءِ المقارنةِ.

## 4. ما **لم** يُقَس — ويُقالُ صراحةً

**منعُ الإعادةِ (`replay`) لم يُقَس محلّيّاً.** الحارسُ فهرسٌ فريدٌ جزئيٌّ في مخطَّطِ Postgres لا شرطٌ في التطبيقِ، والمجموعةُ الطرفيّةُ تُغلَّفُ بـ`describe.skipIf(!DATABASE_URL)`. **والتخطّي قيسَ لا افتُرِض** ([`local-measurements/channel-e2e-no-db.raw.txt`](local-measurements/channel-e2e-no-db.raw.txt)):

```
✓ src/__tests__/m1-02-session-gate.e2e.test.ts (17 tests | 10 skipped)
      Tests  14 passed | 11 skipped (25)
```

**فعشرُ حالاتٍ من سبعَ عشرةَ لم تعمل، والملفُّ يُطبَعُ بعلامةِ ✓ خضراءَ.** ومَن قرأ اللونَ دونَ عمودِ `skipped` قرأ خضرةً كاذبةً.

## 5. ما يُبلِغُ به CI — واستدلالُه لا رصدُه

[`jobs-33578061424.json`](jobs-33578061424.json) — التشغيلُ [`33578061424`](https://github.com/skyosv10-art/wasla/actions/runs/33578061424) على `main@44ab8bff`، وهي **الشجرةُ التي تسكنُها شفرةُ العنصرَين**:

| العدّ | القيمة |
|---|---|
| مجموعُ الوظائفِ | **26** |
| بدأت (`started_at` غيرُ فارغٍ) | **26** |
| `success` | **26** |
| لم تبدأ / أخفقت | **0 / 0** |

والوظيفةُ المعنيّةُ بـ`replay`: `exit-gate-e2e (channel, @wasla/channel-e2e, wasla_channel_e2e, DATABASE_URL)` · `started_at: 2026-09-02T01:06:40Z` · `success`، وخطواتُها: 2 `Initialize containers` ✅ · 7 (تصديرُ الوصلِ) ✅ · 8 `channel · exit gate` ✅.

**وهذا استدلالٌ من التهيئةِ لا رصدٌ لعشرِ حالاتٍ نُفِّذت.** والسببُ بيئيٌّ ويُعلَنُ:

| ما طُلب | الجواب |
|---|---|
| `GET /repos/skyosv10-art/wasla/actions/jobs/100139614498/logs` | `curl: (7) CONNECT tunnel failed, response 403` — السجلُّ يُقدَّمُ من `*.blob.core.windows.net` وهو محجوبٌ عن هذه البيئةِ |
| تنزيلُ لاحقةِ `test-log` (`…/artifacts/<id>/zip`) | `HTTP 000` · الحجبُ نفسُه |

**ووظائفُ `exit-gate-e2e` لا ترفعُ لاحقةً أصلاً** — فحتّى برفعِ الحجبِ لا سجلَّ لها في اللواحقِ. **ورفعُ عدِّ الحالاتِ من تلك الوظائفِ عملٌ مستقلٌّ لم يُفتَح له عنصرٌ**، وقرارُ فتحِه لمالكِ البرنامجِ.

## 6. أينَ يُقرأُ الحكمُ

- [`../../M1-01_GATE.md`](../../M1-01_GATE.md) — عشرةُ بنودٍ ✅
- [`../../M1-02_GATE.md`](../../M1-02_GATE.md) — اثنا عشرَ بنداً ✅ وبندُ `replay` ⚠️ جزئيٌّ

**ولا تُنقَلُ حالةُ أيٍّ منهما إلى `Completed` بهذا المستندِ**؛ تلك سلطةُ مالكِ البرنامجِ وحدَه بنصِّ [`STATUS_MODEL.md`](../../../00-rules/STATUS_MODEL.md).

## 7. البيئةُ

Node v20.20.1 · pnpm 9.15.9 · Linux x86_64 · `nproc=2` · **لا Postgres ولا Docker ولا صلاحيّةُ جذرٍ** · الشجرةُ المحلّيّةُ مطابقةٌ لـ`main@44ab8bff` (1203 كائناً تُحقِّق كلٌّ منها بصمةَ SHA-1 المُعلَنةَ في شجرةِ Git).

## 8. مُلحَقٌ خارجَ نطاقِ البوّابتَينِ — `dependency-audit/` (`M0-06` · `CLM-0055`)

**هذا المجلَّدُ الفرعيُّ ليس دليلاً لـ`M1-01` ولا لـ`M1-02`**، ويُقرأُ منفصلاً عمّا فوقَه؛ وإنّما سكنَ هنا لأنّه وقعَ في **الدفعةِ نفسِها** وأثَّرَ في `pnpm-lock.yaml` الذي تُبصِّمُه هذه الدفعةُ في `BASELINE.json`.

**ما جرى بترتيبِه:** بعدَ اكتمالِ وثيقتَي البوّابةِ، شُغِّلت بوّابةُ الحوكمةِ قبلَ الدفعِ فأخفقَ **الفحصُ 9** بثمانِ ثغراتٍ في شجرةِ **الإنتاجِ** — أربعُ استشاراتٍ (high) في `fast-uri` على خطَّيه، تأتي غيرَ مباشرةٍ تحتَ `fastify@5.12.1`. **والشجرةُ نفسُها كانت خضراءَ** في [`33578061424`](https://github.com/skyosv10-art/wasla/actions/runs/33578061424) قبلَ ذلك بساعاتٍ بلا اختلافِ سطرٍ: الاستشاراتُ نُشِرت بينَهما.

| الملفُّ | ما فيه |
|---|---|
| [`dependency-audit/audit-before.raw.txt`](dependency-audit/audit-before.raw.txt) | نصُّ الإخفاقِ ملتقَطاً ساعتَه — **وحدُّه مكتوبٌ في رأسِه**: لا يُعادُ إنتاجُه بعدَ الرفعِ |
| [`dependency-audit/why-fast-uri.raw.txt`](dependency-audit/why-fast-uri.raw.txt) | `pnpm why fast-uri -r --prod` — سلسلةُ الاعتماديّةِ مقروءةً لا مُخمَّنةً |
| [`dependency-audit/lock-fast-uri.raw.txt`](dependency-audit/lock-fast-uri.raw.txt) | أسطرُ `fast-uri` في القفلِ بعدَ الرفعِ: `3.1.7` و`4.1.4` |
| [`dependency-audit/audit-after.raw.txt`](dependency-audit/audit-after.raw.txt) | `pnpm audit` و`pnpm audit --prod` = `No known vulnerabilities found` |
| [`dependency-audit/verify-after.raw.txt`](dependency-audit/verify-after.raw.txt) | خلاصةُ `scripts/verify.sh` بعدَ الرفعِ: **ستّةٌ من ستّةٍ** |

**وما لم يُفعَل:** لم يُعطَّل الفحصُ، ولم يُنقَل إلى `continue-on-error`، ولم يُكتَب استثناءٌ في §11 لتمريرِه — **والبابُ الأوّلُ لا يقبلُ استثناءً بنصِّه أصلاً** ما دامت الثغرةُ تُشحَنُ. والتفصيلُ في [`TASK_LOG.md`](../../../16-progress/TASK_LOG.md) وفي `RISK-0004` من [`RISK_REGISTER.md`](../../../07-security/RISK_REGISTER.md).
