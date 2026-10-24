# CLM-0672 — إغلاقُ أربعِ ثغراتِ `fast-uri` (2026-10-23) في شجرةِ الإنتاج

- **Claim:** `CLM-0672` · **Branch:** `security/clm-0672-fast-uri-ghsa-2026-10-23` · **الأساس:** main `6131411629877b855a931bdccc285fdf8ae54886`
- **قرارُ المالك (2026-10-24):** «وافق على CLM-0672» — يشملُ القفزةَ الثانويّةَ `4.1.5 → 4.2.3` بعدَ مراجعةِ فرقِها (خلافًا للقيدِ «ترقيعٌ فقط» المسجَّلِ في CLM-0414، لأنّه لا إصدارَ مُصلِحًا في 4.1.x).
- **التغيير:** `package.json` → `pnpm.overrides`: `fast-uri@3` من `^3.1.8` إلى **`^3.1.9`**، و`fast-uri@4` من `~4.1.5` إلى **`~4.2.3`** (يبقى `~`)؛ وتحديثُ `pnpm-lock.yaml` (أسطرُ `fast-uri` وحدَها). لا تغييرَ في أيِّ شيفرة.

## 1. ما الذي اكتُشف ومتى ([`raw/advisories.tsv`](raw/advisories.tsv))

| GHSA | الخطورة | نُشر (UTC) | المُصلَح |
|---|---|---|---|
| [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp) — scheme injection عبرَ نقطتَين غيرِ مُهرَّبتَين | low | 2026-10-23T21:36:40Z | 3.1.9 · 4.2.3 |
| [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr) — host confusion في توحيدِ WHATWG | medium | 2026-10-23T21:37:59Z | 3.1.9 · 4.2.3 |
| [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h) — تكافؤُ مساراتٍ في توحيدِ المراجعِ النسبيّة | low | 2026-10-23T21:39:34Z | 3.1.9 · 4.2.3 |
| [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) — scheme spoofing عبرَ فكِّ ترميزِ النسبة | medium | 2026-10-23T21:41:36Z | 3.1.9 · 4.2.3 |

- **الأثرُ على CI:** أوّلُ تشغيلٍ بعدَها (#817، WASLA CI 40039556210) أسقطَ `verify` المطلوبَ: الفحصُ 9 داخلَ `test-governance` في 23:37Z بينما نجحَ الفحصُ نفسُهُ مباشرةً في 23:28Z من التشغيلِ ذاتِه — أي أنّ قاعدةَ التنبيهاتِ تغيّرت أثناءَ التشغيل. سيسقطُ كلُّ تشغيلٍ جديدٍ على main وكلُّ PR حتى الدمج.
- **التدقيقُ قبلُ** ([`raw/audit-before-main-61314116.txt`](raw/audit-before-main-61314116.txt)) على main `61314116`: «البابُ 1: شجرةُ الإنتاجِ فيها **8 ثغرةً** — ولا استثناءَ في هذا البابِ. الحزمُ: fast-uri».
- **المسار:** `fastify 5.12.7` ← `@fastify/ajv-compiler 4.0.6` / `@fastify/fast-json-stringify-compiler 5.1.0` ← `ajv 8.20.0` (`fast-uri 3.1.8`) و`fast-uri 4.1.5` مباشرةً؛ في 17 خدمةً و5 حزمٍ مشتركة.

## 2. مراجعةُ الفرق ([`raw/fast-uri-source-diff.txt`](raw/fast-uri-source-diff.txt))

من حِزَمِ السجلِّ العامِّ (`npm pack`)؛ قيمُ `integrity` في الملفِّ تطابقُ `pnpm-lock.yaml` حرفيًّا.

- **لا اعتماديّاتِ تشغيلٍ** في أيٍّ من الإصدارات الأربعة؛ `main: index.js` بلا `exports` في الجميع.
- **الواجهةُ المُصدَّرةُ متطابقة** في 3.1.8 · 3.1.9 · 4.1.5 · 4.2.3: `SCHEMES, default, equal, fastUri, normalize, parse, resolve, resolveComponent, serialize`.
- **الأنواع (4.x):** إضافةٌ واحدةٌ اختياريّةٌ `ipv6Zone?: string` في `URIComponent` — لا حذفَ ولا تغييرَ توقيع.
- **شيفرةُ التشغيل (4.1.5→4.2.3):** `index.js` 203 سطرًا مُغيَّرًا · `lib/utils.js` 159 · `lib/schemes.js` 33 — كلُّها تشديدٌ لتحليلِ حالاتٍ حدّيّة: فكُّ ترميزِ المخطّط والتحقّقُ منه (`decodeValidScheme` → `validateScheme`)، توحيدُ المضيفِ ورفضُ مضيفاتِ النطاقِ الممنوعة (`hasForbiddenDomainHost`)، مناطقُ IPv6 (`copyHost`، `ipv6Zone`)، وتوحيدُ المراجعِ النسبيّة. `package.json`: الإصدارُ وأداةُ تطويرٍ (`playwright-test`) فقط.
- **عيّنةُ سلوكٍ شائع:** 9 مدخلاتٍ نموذجيّةٍ (`$ref` نسبيٌّ وجذريّ، http/https بمنفذٍ ومستخدم، URN، mailto، IPv6، مسارٌ عربيٌّ مُرمَّز) × `normalize`/`serialize∘parse`/`resolve` = 27 مقارنةً: **0 فرق** بين 4.1.5 و4.2.3.

## 3. القياسات

| | main `61314116` (قبل) | هذا الفرع (بعد) |
|---|---|---|
| `validate-dependency-audit.sh` | ✗ — البابُ 1: 8 ثغراتٍ في شجرةِ الإنتاج + 8 مشكلاتٍ في البابِ 2 (4 ثغراتٍ × خطّا 3.x و4.x) · رمزُ الخروجِ 1 | ✓ (رمزُ الخروجِ 0) — «شجرةُ الإنتاجِ نظيفةٌ (صفرُ ثغراتٍ)» · «الشجرةُ كاملةً بلا ثغرةٍ معروفة» ([`raw/audit-after.txt`](raw/audit-after.txt)) |
| `pnpm audit --prod` | — | info 0 · low 0 · moderate 0 · high 0 · critical 0 |
| `pnpm test` (`scripts/run-tests.sh`) | 58 حزمةً · **5968 ناجحًا** · 59 متخطًّى · 0 فاشل | 58 حزمةً · **5968 ناجحًا** · 59 متخطًّى · 0 فاشل |

ملخّصاتُ الاختبارِ لكلِّ حزمةٍ **متطابقةٌ سطرًا بسطر** بينَ الجانبَين ([`raw/pnpm-test-main-61314116-summary.txt`](raw/pnpm-test-main-61314116-summary.txt) · [`raw/pnpm-test-branch-summary.txt`](raw/pnpm-test-branch-summary.txt)) — البيئة: Node v20.20.2 · pnpm 9.15.9.

**اختباراتُ الأمانِ من المشرفين — القديمُ مقابلَ الجديد** ([`upstream-security-tests.sh`](upstream-security-tests.sh) → [`raw/upstream-security-tests-old-vs-new.txt`](raw/upstream-security-tests-old-vs-new.txt)): ملفّاتُ الاختبارِ من الإصدارِ المُصلِحِ تُشغَّلُ على القديمِ والجديد.

| الملفّ | 3.1.8 | 3.1.9 | 4.1.5 | 4.2.3 |
|---|---|---|---|---|
| `host-delimiter-security` | 230/463 (**233 فشلًا**) | 463/463 | 230/463 (**233**) | 463/463 |
| `relative-normalization-security` | 35/4113 (**4078**) | 98/98 | 35/4131 (**4096**) | 98/98 |
| `c0-reference-security` | — | — | 208/541 (**333**) | 541/541 |
| `host-encoding` | — | — | 3/105 (**102**) | 105/105 |
| `mailto-authority-security` | — | — | 9/44 (**35**) | 44/44 |
| `security` | 98/98 | 98/98 | 97/98 (**1**) | 98/98 |
| `security-normalization` · `security-utf8-encoding` · `mailto-field-name-security` | ناجحةٌ على الجانبَين | | ناجحةٌ على الجانبَين | |

(عددُ الحالاتِ في `relative-normalization` على القديمِ أكبرُ لأنّ الاختبارَ يولِّدُ حالاتٍ من مخرجاتِ المكتبةِ نفسِها.) هذا **موجبٌ وسالبٌ معًا**: الاختباراتُ نفسُها تكشفُ العيبَ في القديمِ وتنجحُ على الجديد.

## 4. ما قيسَ · ما استُنتج · ما لم يُثبَت

- **مقيسٌ:** الثغراتُ الأربعُ في شجرةِ الإنتاجِ على main؛ الترقيةُ تُزيلُها من التدقيق؛ واجهةُ المكتبةِ لم تفقدْ شيئًا؛ اختباراتُ المستودعِ متطابقةُ العددِ والنتيجة؛ اختباراتُ المشرفين الأمنيّةُ تفشلُ على القديمِ وتنجحُ على الجديد.
- **مستنتَجٌ:** القفزةُ الثانويّةُ 4.1.5→4.2.3 آمنةٌ لاستعمالِ Wasla لأنّ المستهلكَ الوحيدَ هوَ ajv/fast-json-stringify لحلِّ `$id`/`$ref`، والواجهةُ والسلوكُ الشائعُ لم يتغيّرا، واختباراتُ الخدماتِ الـ17 كاملةٌ.
- **لم يُثبَت:** **قابليّةُ استغلالِ هذه الثغراتِ في Wasla نفسِها** (هل يصلُ مُدخَلُ مستخدمٍ إلى `fast-uri` عبرَ مخطّطاتٍ تقبلُ `$ref` خارجيًّا أو صيغةَ `uri`) — لم يُدرَس؛ الإغلاقُ هنا بالترقيةِ لا بالتحليل. ولا سلوكُ 4.2.3 في حالاتٍ حدّيّةٍ خارجَ عيّنةِ المقارنةِ واختباراتِ المشرفين.

## 5. السجلّات

- `docs/00-rules/SECURITY_RULES.md` §11: سطرا `override:fast-uri@3` و`override:fast-uri@4` بإضافةِ CLM-0672 (الإصداراتُ الجديدةُ والثغراتُ الأربعُ وقرارُ المالكِ بالقفزةِ الثانويّة)؛ `expires:` بلا تغيير.
- `docs/07-security/RISK_REGISTER.md`: `RISK-0004` بلا تغييرِ حالة (`mitigating`) — التثبيتاتُ القسريّةُ ما زالت مؤقّتةً، والعددُ 7 لم يتغيّر.

**لم يتغيّر:** شيفرةُ أيِّ خدمة · `.github/workflows/*` · #730/INC-0007 HOLD · deploy-target.json · production_open=false · NO-GO · M6-18B Blocked.
