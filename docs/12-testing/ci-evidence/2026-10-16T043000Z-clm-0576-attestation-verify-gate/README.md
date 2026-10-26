# CLM-0576 — إصلاحُ بوّابةِ التحقّقِ من Artifact Attestation في `image-supply-chain`

**التاريخ:** 2026-10-16 · **البند:** M6-18B (سلسلةُ التوريد M6-19C · ADR-056) · **الحجز:** CLM-0576 (صفُّه التُزمَ `8a92d8a0` ودُفعَ قبلَ أيِّ ملفٍّ آخر) · **الفرع:** `fix/clm-0576-attestation-verify-gate` من `main` `a5b36cf0`.

> **حاجزُ دمج — لا دمجَ حتى يؤكّدَ المالك:** (1) تدويرَ مفتاحِ Render API · (2) تحديثَ سرِّ `RENDER_API_KEY` في GitHub · (3) التحقّقَ من صلاحيةِ الاعتمادِ الجديدِ بقراءةٍ غيرِ مُغيِّرة · (4) إبطالَ المفتاحِ القديم. السببُ: هذا التغييرُ يمسُّ `.github/workflows/ci.yml` و`scripts/**` — خارجَ `paths-ignore` في `render-deploy.yml` (`docs/**`، `**/*.md`) — **فالدمجُ إلى `main` يُطلقُ نشرَ Render المعتادَ لـ 24 موردًا `wasla-*` (21 web_service + 3 static_site)** — كما قِيسَ في النشرِ الأخير [38843128137](../2026-10-16T031500Z-clm-0574-clm-0573-post-merge-verification/README.md) بالسرِّ `RENDER_API_KEY` الذي يُعامَلُ مكشوفًا (INC-0007). لا تُستخدَمُ القيمةُ القديمةُ في أيِّ أمرٍ أو اختبار، ولا يُطلَبُ المفتاحُ في المحادثة.

## 1. العيب — مفتوحٌ اكتُشفَ بعدَ الدمجِ في CLM-0575

سُجّلَ في [CLM-0575 §2](../2026-10-16T034500Z-clm-0575-supply-chain-retry-and-728-verification/README.md) (لم يُعدَّل): خطوةُ «تحقُّقٌ من الإثباتِ» كانت:

```yaml
gh attestation verify artifacts/sbom/pass1.cdx.json \
  --repo ${{ github.repository }} || echo "WARN: attestation verify requires gh CLI 2.50+"
```

- `gh` بلا `GH_TOKEN` ⇒ خطأُ مصادقة ⇒ `|| echo` يُحوّلُه نجاحًا. **الخطوةُ خضراءُ بلا تحقّق** في كلِّ تشغيلٍ سابق.
- الملفُّ الثاني `pass2.cdx.json` لم يُتحقَّق منه أصلًا، ولا قيدَ على سيرِ التوقيع.
- الحارسُ `validate-workflow-supply-chain.sh` (البابُ 7) كان يكتفي بوجودِ النصِّ `gh attestation verify`.

## 2. الإصلاح

| الملفّ | التغيير |
|---|---|
| `scripts/ci/verify-sbom-attestations.sh` (جديد) | `set -euo pipefail` · `GH_TOKEN` غائبٌ/فارغ ⇒ **2** · `gh` أقدمُ من **2.50.0** أو بلا `--repo`/`--signer-workflow`/`--predicate-type`/`--format` ⇒ **3** (لا تحذيرَ يُمرِّر) · لكلِّ ملفّ: `gh attestation verify <f> --repo <repo> --signer-workflow <repo>/.github/workflows/ci.yml --predicate-type https://slsa.dev/provenance/v1 --format json` · **الخروجُ الصفريُّ وحدَه لا يكفي**: يُشترطُ أن يحويَ المخرَجُ نتيجةً بـ`predicateType` نفسِه وبصمةِ `sha256` الملفِّ نفسِه و`buildSignerURI` يبدأ بـ`https://github.com/<repo>/.github/workflows/ci.yml@` و`sourceRepositoryURI` المستودعِ نفسِه · فشلُ أيِّ ملفٍّ ⇒ **1** للكلّ. لا يطبعُ الرمز. |
| `.github/workflows/ci.yml` · `image-supply-chain` | خطوةُ التحقّق: `shell: bash` + `set -euo pipefail` + `env: GH_TOKEN: ${{ github.token }}` (**لهذه الخطوةِ والتي تليها فقط**) · تستدعي البوّابةَ للملفَّين `pass1` و`pass2` · **حُذفَ `|| echo "WARN…"`**. أُضيفت: خطوةُ اختباراتِ الوحدة (قبلَ البناء، بلا رمز)، وخطوةُ الحالاتِ الحيّة (بعدَ التحقّق)، ورفعُ أدلّتِها `image-supply-chain-attestation-verify-evidence` (`if: always()`، `if-no-files-found: error`). `gh --version` في «بيئةُ القياس». **الصلاحيّاتُ بلا تغيير:** `contents: read` · `id-token: write` · `attestations: write` (لازمةٌ للإنشاء؛ القراءةُ مشمولة). |
| `scripts/ci/test-verify-sbom-attestations.sh` (جديد) | 16 حالةَ وحدةٍ بـ`gh` مُصطنَع (§3.1). |
| `scripts/ci/test-verify-sbom-attestations-live.sh` (جديد) | 10 حالاتٍ حيّةٍ بـ`gh` الحقيقيِّ والإثباتِ الحقيقيِّ في التشغيلِ نفسِه (§3.2). |
| `scripts/checks/validate-workflow-supply-chain.sh` (البابُ 7) | يُلزِم: استدعاءَ البوّابةِ بالملفَّين و`.github/workflows/ci.yml` · `GH_TOKEN: ${{ github.token }}` · ويرفض: أيَّ `||` بعدَ التحقّق (مع ضمِّ الأسطرِ المستمرّة) · نصَّ `WARN: attestation verify` · `continue-on-error: true` في الوظيفة. |
| `scripts/checks/test-governance.sh` | الحالةُ 16 تتبعُ الخطوةَ الجديدة؛ وأُضيفت (17)–(22): قناعُ `|| echo WARN` · قناعُ `|| true` · الملفُّ الأوّلُ وحدَه · غيابُ `GH_TOKEN` · `continue-on-error` · سيرُ توقيعٍ غيرُ `ci.yml` — كلُّها تُرفَض. |

لا تخفيفَ لأيِّ فحصٍ آخر. لا وظيفةَ جديدة (`ci_jobs` بلا تغيير) ولا ملفَّ اختبارٍ `*.test.*` (`test_files_tracked` بلا تغيير) ولا `continue-on-error`.

## 2b. تصحيحٌ بعدَ مراجعةِ المالك — الرمزُ يُقاسُ في الخطوةِ الموجبةِ نفسِها (2026-10-16)

**الثغرة:** فحصُ البابِ 7 للرمزِ كان يبحثُ عن `GH_TOKEN: ${{ github.token }}` في **ملفِّ `ci.yml` كلِّه**؛ والنصُّ موجودٌ في خطوةِ الحالاتِ الحيّةِ وفي وظيفتَين أُخرَيَين (السطرانِ 158 و203). فحذفُه من خطوةِ التحقّقِ الموجبةِ وحدَها كان يمرُّ.
**الإصلاح:** `validate-workflow-supply-chain.sh` يقسمُ وظيفةَ `image-supply-chain` إلى خطواتٍ (`^      - `)، ويشترطُ أن تحملَ **كلُّ خطوةٍ تستدعي `scripts/ci/verify-sbom-attestations.sh`** سطرَ `GH_TOKEN: ${{ github.token }}` في `env` الخاصِّ بها (ولا يُحتسَبُ سطرٌ مُعلَّق)، وأن توجدَ خطوةٌ كهذه.
**اختبارُ الطفرة** — [`guard-positive-step-token-mutation.txt`](guard-positive-step-token-mutation.txt): يحذفُ السطرَ 984 وحدَه (الرمزُ في الخطوةِ الموجبة)، ويبقى 3 أسطرٍ (الخطوةُ الحيّة + وظيفتان أُخريان):
- الحارسُ الجديد ⇒ **exit 1** بسببٍ واحدٍ: «`GH_TOKEN: ${{ github.token }}` غائبٌ عن خطوةِ التحقّقِ الموجبةِ نفسِها (verify-sbom-attestations.sh) — وجودُه في خطوةٍ أخرى لا يُغني».
- الحارسُ السابق (`28e802b8`) ⇒ **exit 0** — أي أنّ الثغرةَ كانت حقيقيّة.
**في حزمةِ الحوكمة** (`test-governance.sh`، الحالتان 23–24): `_live_step_has_token` يُثبتُ أنّ الطفرةَ تُبقي الرمزَ في الخطوةِ الحيّة، و`_wf_why` يُثبتُ أنّ الطفرةَ غيّرت الملفَّ، وأنّ الحارسَ رفضَها، وأنّ السببَ المطبوعَ هو هذا بعينِه، وأنّه **لا رفضَ آخرَ** لـ`ci.yml`. النتيجة [`governance-tests-after-positive-step-fix.txt`](governance-tests-after-positive-step-fix.txt): **699 ناجح · 0 فاشل**؛ والحارسُ على الشجرة [`guard-supply-chain-tree.txt`](guard-supply-chain-tree.txt) ✓. حكمُ CI على الرأسِ الجديدِ يُسجَّلُ في §4b.

## 2c. تصحيحٌ ثانٍ بعدَ مراجعةِ المالك — الاستدعاءُ التنفيذيُّ يُقاس، لا ظهورُ الاسم (2026-10-16)

**الثغرة:** الحارسُ (حتى `62745cb9`) كان يعُدُّ أيَّ سطرٍ غيرِ مُعلَّقٍ يذكرُ `scripts/ci/verify-sbom-attestations.sh` «استدعاءً». قِيسَ على الحارسِ السابق: تحويلُ الاستدعاءِ إلى `echo scripts/ci/verify-sbom-attestations.sh …` ⇒ **exit 0**، وإلى `true  # bash scripts/ci/verify-sbom-attestations.sh …` ⇒ **exit 0**. والتعليقُ الكاملُ (`# bash …`) رُفضَ لكن **بثلاثةِ أسبابٍ متشابكة** (منها سببُ رمزٍ مضلِّلٌ والرمزُ حاضر).
**الإصلاح:** `scripts/checks/lib/attest_verify_step.py` (جديد) يقرأُ كتلةَ `run:` لكلِّ خطوةٍ في `image-supply-chain`، ويحذفُ تعليقاتِ YAML وتعليقاتِ shell (الكاملةَ واللاحقةَ خارجَ الاقتباس)، ويضمُّ الأسطرَ المستمرّةَ بـ`\`، ويعُدُّ الخطوةَ موجبةً فقط إن كان فيها **أمرٌ** يبدأُ بـ`[bash ]scripts/ci/verify-sbom-attestations.sh` (في أوّلِ السطرِ المنطقيِّ أو بعدَ `;`/`&&`). ثمّ يقيسُ في تلك الخطوةِ نفسِها `GH_TOKEN: ${{ github.token }}` في `env:` والملفَّينِ و`.github/workflows/ci.yml` في الأمرِ نفسِه. البابُ 7 في `validate-workflow-supply-chain.sh` صارَ يستعملُه، ويُصدرُ عندَ غيابِ الاستدعاءِ **سببًا واحدًا**: «لا استدعاءَ تنفيذيَّ لـ scripts/ci/verify-sbom-attestations.sh داخلَ run: في خطوةٍ من image-supply-chain».
**الدليل** — [`guard-executable-call-mutation.txt`](guard-executable-call-mutation.txt):
- **النسخةُ السليمة** ⇒ المحلّل `STEP 12 token=1 args=- · CALLS 1` · الحارس **exit 0**.
- **الاستدعاءُ المعلَّق** (`# bash scripts/ci/…`، و`GH_TOKEN` باقٍ في الخطوةِ الموجبة: سطرٌ واحد) ⇒ `CALLS 0` · الحارسُ الجديد **exit 1 بسببٍ واحد** (غيابُ الاستدعاءِ التنفيذيّ) · الحارسُ السابق exit 1 بثلاثةِ أسباب.
- صيغتا `echo` و`true # …` ⇒ الجديد exit 1 بالسببِ نفسِه وحدَه · السابق **exit 0**.
**في حزمةِ الحوكمة** (`test-governance.sh`): (25) `_pos_step_has_token` — الطفرةُ تُبقي الرمزَ في الخطوةِ الموجبة · (26) `_wf_why` — الاستدعاءُ المعلَّقُ يُرفَضُ لغيابِ الاستدعاءِ التنفيذيِّ **وحدَه** · (27) صيغةُ `echo` · (28) التعليقُ اللاحق. (23)–(24) باقيتان. النتيجة [`governance-tests-after-executable-call-fix.txt`](governance-tests-after-executable-call-fix.txt): **703 ناجح · 0 فاشل**؛ وتسعُ طفراتٍ للبابِ 7 (تعليق · حذف · echo · تعليقٌ لاحق · رمزُ الخطوةِ الموجبة · الملفُّ الأوّلُ وحدَه · سيرُ توقيعٍ آخر · `|| true` · كلُّ الرموز) كلٌّ منها يُرفَضُ بسببٍ واحدٍ صحيح. الحارسُ على الشجرة [`guard-supply-chain-tree.txt`](guard-supply-chain-tree.txt) ✓.

## 2d. تصحيحٌ ثالثٌ بعدَ مراجعةِ المالك — صيغةٌ ضيّقةٌ معلَنة، وقرارٌ fail-closed (2026-10-16)

**الثغرة:** محلّلُ `4bb60023` كان يقبلُ الاستدعاءَ بعدَ `;` أو `&&`، ويطبعُ `mask` دونَ أن يفرضَه الحارس. فقِيسَ على الحارسِ السابقِ **11 تجاوزًا مقبولًا (exit 0)**، منها الحالتانِ المطلوبتان: `true && bash scripts/ci/verify-sbom-attestations.sh …; true` و`bash scripts/ci/verify-sbom-attestations.sh … && true; true`، وكذلك `…; true`، وسطرُ `exit 0` بعدَ الاستدعاء، و`set -eu` بلا pipefail، و`set +e`، و`if: false` على الخطوة، و`BASH_ENV`، و`shell: sh`، و`if: false` على الوظيفة.
**الإصلاح — لا تفسيرَ لتراكيبِ Bash، بل صيغةٌ واحدةٌ معلَنة** (`scripts/checks/lib/attest_verify_step.py`):
- الخطوةُ مفاتيحُها `name` · `shell` · `env` · `run` فقط (لا `if` ولا `continue-on-error` ولا `working-directory`) · `shell: bash` حرفيًّا · `env` فيه `GH_TOKEN: ${{ github.token }}` إلزاميًّا و`ATTEST_EVIDENCE_DIR` اختياريًّا فقط.
- `run:` أسطرُه المنطقيّةُ (بلا تعليقات، مع ضمِّ `\`): `set -euo pipefail` أوّلًا · `mkdir -p artifacts/attestation-verify` اختياريًّا · ثمّ **سطرُ الاستدعاءِ حرفيًّا**: `bash scripts/ci/verify-sbom-attestations.sh "${{ github.repository }}" .github/workflows/ci.yml artifacts/sbom/pass1.cdx.json artifacts/sbom/pass2.cdx.json [2>&1 | tee artifacts/attestation-verify/<ملف>.txt]` — ولا شيءَ بعدَه. `| tee` مقبولٌ لأنّ pipefail إلزاميٌّ قبلَه.
- أيُّ ذكرٍ تنفيذيٍّ للمسارِ في أيِّ خطوةٍ من الوظيفةِ لا يطابقُ السطرَ المعلَنَ حرفيًّا ⇒ «صيغةٌ غيرُ مدعومة … قد يحوّلُ فشلَ التحقّقِ نجاحًا نهائيًّا». وأيُّ `if:` على مستوى الوظيفةِ ⇒ رفض.
- **fail-closed:** الحارسُ لا يقبلُ إلا سطرَ `OK step=<n>` بلا أيِّ `REASON`؛ وخطأُ المحلّلِ أو مخرَجٌ غيرُ متوقَّعٍ ⇒ رفض. حُذفَ `mask` من المخرَج (لا طباعةَ بلا فرض)، وقُصِرَ فحصُ `||` النصّيُّ على `gh attestation verify` الخامِ لأنّ الاستدعاءَ نفسَه يُقاسُ بالصيغة.
**الدليل** — [`guard-declared-form-mutation-matrix.txt`](guard-declared-form-mutation-matrix.txt): النسخةُ السليمة ⇒ `OK step=12` · الحارس **exit 0**. مصفوفةُ 20 طفرة: **الجديدُ يرفضُها كلَّها**، كلٌّ بسببِه (19 بسببٍ واحد؛ `continue-on-error` على الخطوةِ بسببَين صحيحَين: مفتاحٌ غيرُ مدعوم + البابُ الوظيفيّ). **السابقُ قبِلَ 11 منها.**
**في حزمةِ الحوكمة** (29)–(41): النسخةُ السليمةُ تُقبَل (المحلّلُ `OK`) · `true && bash …; true` · `bash … && true; true` (كلاهما بسببِ «قد يحوّلُ فشلَ التحقّقِ نجاحًا نهائيًّا») · `|| true` · `; true` · `if …; then :; fi` · `exit 0` بعدَ الاستدعاء · `set -eu` · `set +e` · `if:` على الخطوة · `BASH_ENV` · `shell: sh` · `if:` على الوظيفة — كلُّها بـ`_wf_why` (رفضٌ بسببٍ واحدٍ بعينِه، والطفرةُ غيرُ فارغة). **عُدِّلَ توقُّعُ (27)** (`echo …`) من «لا استدعاء» إلى «صيغةٌ غيرُ مدعومة» — رفضٌ أدقّ. (23)–(26) و(28) باقية. وعلى الحارسِ السابقِ تفشلُ 13 حالةً من هذه — فهي تُميِّز. النتيجة [`governance-tests-after-declared-form-fix.txt`](governance-tests-after-declared-form-fix.txt): **716 ناجح · 0 فاشل** (التشغيلُ الأوّلُ كشفَ عندي أنبوبًا إلى `grep -q` في الحالةِ الموجبة — حارسُ RISK-0037 — فاستُبدِلَ بالتقاطٍ ثمّ مطابقة). أدلّةُ CLM-0575 بلا تغيير.

## 2e. تصحيحٌ رابعٌ بعدَ مراجعةِ المالك — مفاتيحُ YAML المكرَّرة (2026-10-16)

**الثغرة:** المحلّلُ في `52b1a712` كان يُدخِلُ مفاتيحَ الخطوةِ في قاموسٍ فيستبدلُ المكرَّرَ بصمت، ويجمعُ أسطرَ كتلِ `run:` المكرَّرة. لكنّ YAML يأخذُ **آخرَ** قيمةٍ للمفتاحِ المكرَّر، فقد يُنفِّذُ Actions غيرَ ما قاسَه الحارس. قِيسَ على الحارسِ السابق:
- `env:` مكرَّرٌ و`shell:` مكرَّرٌ ⇒ **exit 0** (قبول).
- `run:` مكرَّرٌ (كتلةٌ أولى فيها `set -euo pipefail` ثمّ `run:` فيه الاستدعاء) ⇒ رُفِضَ **عَرَضًا** بسببِ «سطرٍ غيرِ مدعومٍ قبلَ الاستدعاء» لأنّ الكتلتَين جُمِعتا، لا بسببِ التكرار.
- `GH_TOKEN` مكرَّرٌ داخلَ `env` ⇒ رُفِضَ عَرَضًا بسببِ «غيابِ الرمز».
- `run: true` بعدَ كتلةِ الاستدعاء ⇒ رُفِضَ عَرَضًا بسببِ «سطرٍ بعدَ الاستدعاء».
**الإصلاح** (`scripts/checks/lib/attest_verify_step.py`): `parse_step` يتعقّبُ كلَّ مفتاحِ خطوةٍ **قبلَ** إدخالِه، وكلَّ متغيّرٍ داخلَ `env` كذلك. أيُّ تكرارٍ (`run` · `env` · `shell` · `name` · `if` … أو `env.<VAR>`) يُسجَّل، والخطوةُ التي تذكرُ مسارَ التحقّقِ وفيها تكرارٌ تُرفَضُ بسببٍ واحد: «مفتاحُ YAML مكرَّرٌ في خطوةِ التحقّق <n>: <المفاتيح> — YAML يأخذُ الأخيرَ ويُسقطُ السابقَ، فيُنفَّذُ غيرُ ما يُقاس». لا تُقاسُ بعدَها (fail-closed)، ولا قبولَ مع أيِّ تكرار.
**الدليل** — [`guard-duplicate-yaml-keys-mutation.txt`](guard-duplicate-yaml-keys-mutation.txt): النسخةُ السليمة ⇒ `OK step=12` والحارس exit 0. الطفراتُ الخمسُ ⇒ الجديدُ exit 1 بسببٍ واحدٍ هو التكرار، مع الفرقِ ومخرَجِ المحلّلِ وحكمِ الحارسِ السابق.
**في حزمةِ الحوكمة** (42)–(47):
- (42) شرطٌ مسبق: طفرةُ `run:` المكرَّرِ تُبقي `GH_TOKEN` وسطرَ الاستدعاءِ ووسائطَه، فلا يمكنُ أن يكونَ الرفضُ لفقدانِ الرمزِ أو حجّة.
- (43) `run:` مكرَّر · (44) `env:` مكرَّر · (45) `shell:` مكرَّر · (46) `GH_TOKEN` مكرَّرٌ داخلَ `env` · (47) `run: true` بعدَ الكتلة.
- كلُّها بـ`_wf_why`: رفضٌ بسببِ «مفتاحُ YAML مكرَّرٌ» وحدَه.
- على الحارسِ السابقِ تفشلُ (43)–(47)، أي أنّها تُميِّز.
اختباراتُ الوحدة 16/16 · الحوكمة **722 ناجح · 0 فاشل**. النتيجة [`governance-tests-after-dup-key-fix.txt`](governance-tests-after-dup-key-fix.txt). أدلّةُ CLM-0575 بلا تغيير.

## 3. الاختبارات

### 3.1 وحدة (CI: خطوةُ «اختباراتُ وحدةٍ لبوّابةِ تحقُّقِ الإثبات»)

موجبة: الملفُّ الأوّل · الثاني · كلاهما ⇒ 0. سالبة: غيابُ `GH_TOKEN` (2) · فارغ (2) · مصادقةٌ غيرُ صالحة (1) · **`gh` يخرجُ 0 بتحذيرِ WARN فقط (1)** · بصمةٌ أخرى/ملفٌّ معدَّل (1) · سيرُ توقيعٍ آخر (1) · نوعٌ غيرُ SLSA v1 (1) · غيابُ إثباتِ الثاني (1) · غيابُ إثباتِ الأوّل (1) · ملفٌّ غائب (1) · `gh 2.49.2` (3) · `gh` بلا `--signer-workflow` (3) · وسائطُ ناقصة (2).
محليًّا: [`local-unit-tests.txt`](local-unit-tests.txt) — 16/16. **اختبارُ الطفرات** [`local-mutation-tests.txt`](local-mutation-tests.txt): أربعُ طفراتٍ تُضعفُ البوّابةَ (`exit 0` في النهاية · تعطيلُ فحصِ المخرَج · `die`→`echo` للرمز · `die`→`echo` للإصدار) — **كلُّها تكشفُها الحزمة** (8 · 4 · 2 · 1 حالاتٍ تفشل).

### 3.2 حيّة (CI: خطوةُ «تحقُّقُ الإثباتِ — حالاتٌ موجبةٌ وسالبةٌ حيّة»)

موجبة ⇒ 0: `positive-pass1` · `positive-pass2` (وخطوةُ التحقّقِ نفسُها للملفَّين معًا). سالبة ⇒ غيرُ 0 بلا سطرِ نجاح: `negative-tampered-pass1` · `negative-tampered-pass2` (نسخةٌ + بايتٌ بعدَ إنشاءِ الإثبات) · `negative-one-of-two-bad` · `negative-no-gh-token` · `negative-invalid-gh-token` · `negative-wrong-signer-workflow` (`render-deploy.yml`) · `negative-wrong-repo` · `negative-raw-gh-no-token` (`gh` الخامُ بلا رمز). مخالفةُ أيِّ حالةٍ تُفشِلُ الوظيفة. مخرَجُ كلِّ حالةٍ في الأرتفاكت.

### 3.3 الحارسُ الثابت

[`local-governance-cases.txt`](local-governance-cases.txt): الحالاتُ (15)–(22) ✓. والحارسُ يمرُّ على الشجرة.

**محليًّا ليس بديلًا عن CI:** التحقّقُ الموجبُ محليًّا يتعذّرُ بلا رمزٍ حقيقيٍّ (والرمزُ لا يُمرَّرُ هنا)، فحكمُه لوظيفةِ CI وحدَها (§4). محليًّا ثبتَ السالب فقط: رمزٌ مُصطنَع ⇒ `HTTP 401` ⇒ 1 · بلا رمز ⇒ 2 · ملفٌّ صحيحٌ + معدَّل ⇒ 1.

## 4. حكمُ CI على فرعِ الإصلاح

**التشغيلُ الأوّلُ على الفرع:** WASLA CI [38853825282](https://github.com/skyosv10-art/wasla/actions/runs/38853825282) (`pull_request`، رأسُ `b165f9dd`، المحاولة 1) — **success** · فحوصُ PR #730: **43/43 pass**. الوظيفة `image-supply-chain` [116820736773](https://github.com/skyosv10-art/wasla/actions/runs/38853825282/job/116820736773) success (05:03:55Z → 05:06:01Z)؛ كلُّ خطواتِها success: 4 «اختباراتُ وحدة…» · 13 «إثباتُ أصلِ قوائمِ الموادِ» · 14 «تحقُّقٌ من الإثبات» · 15 «حالاتٌ موجبةٌ وسالبةٌ حيّة» · 16 رفعُ الأدلّة. الأرتفاكت `image-supply-chain-attestation-verify-evidence` (12026840388) منسوخٌ كما هو في [`ci-run-38853825282/`](ci-run-38853825282/):

| الحالة | exit | السبب في المخرَج |
|---|---|---|
| تحقُّقُ الخطوة 14 — الملفّان ([`positive-both.txt`](ci-run-38853825282/positive-both.txt)) | 0 | `gh 2.102.0 (≥ 2.50.0)` · `✓ VERIFIED pass1 (sha256:929b96eb…)` · `✓ VERIFIED pass2 (sha256:c91ce259…)` · الموقّع `…/.github/workflows/ci.yml@refs/pull/730/merge` · `runs/38853825282/attempts/1` · **2/2** |
| `positive-pass1` · `positive-pass2` | 0 · 0 | VERIFIED |
| `negative-tampered-pass1` · `negative-tampered-pass2` | 1 · 1 | `HTTP 404` — لا إثباتَ لبصمةِ الملفِّ المعدَّل |
| `negative-one-of-two-bad` | 1 | `1/2 — فشلَ 1` ⇒ فشلُ الكلّ |
| `negative-no-gh-token` | 2 | «GH_TOKEN غائبٌ أو فارغ» |
| `negative-invalid-gh-token` | 1 | `HTTP 401: Bad credentials` |
| `negative-wrong-signer-workflow` | 1 | رفضُ سياسةِ سيرِ التوقيع (`render-deploy.yml`) |
| `negative-wrong-repo` | 1 | `no attestations found` |
| `negative-raw-gh-no-token` | 4 | `gh` الخامُ بلا رمز يفشل |
| [`summary.txt`](ci-run-38853825282/live/summary.txt) | — | **10 مطابقة · 0 مخالفة** |
| [`unit-tests.txt`](ci-run-38853825282/unit-tests.txt) | 0 | **16 نجح · 0 فشل** |

لا رمزَ في الأدلّة (`ghs_`/`gho_`/`ghp_` غائبة). **حدودُ الإثبات:** فشلُ الوظيفةِ بأكملِها عندَ فشلِ ملفٍّ يقومُ على: البوّابةُ تخرجُ غيرَ صفرٍ (مُثبَتٌ حيًّا) + الخطوةُ `bash -euo pipefail` بلا قناعٍ ولا `continue-on-error` (يفرضُه البابُ 7 والحالاتُ 17–22). لم يُشغَّل تشغيلٌ أحمرُ متعمَّدٌ للوظيفةِ كاملةً على الفرع. التشغيلُ على الرأسِ النهائيِّ (بعدَ إضافةِ هذه الأدلّة) يُقرأ قبلَ الدمج.

## 4b. حكمُ CI على `24396487` (تصحيحُ §2b)

- WASLA CI [38860082552](https://github.com/skyosv10-art/wasla/actions/runs/38860082552) **success · 41/41** (منها `governance-guard` و`verify` success) · `image-supply-chain` 116840139046 success (06:14:27Z → 06:16:28Z) · الأرتفاكت 12028203408: تحقّقٌ **2/2** · حيّة **10 مطابقة · 0 مخالفة** · وحدة **16/0**.
- **إخفاقٌ مسجَّل:** Roadmap freshness [38860078047](https://github.com/skyosv10-art/wasla/actions/runs/38860078047) (الوظيفة 116840124320) **failure** — «ROADMAP.md was not updated alongside implementation changes: `scripts/checks/test-governance.sh`, `scripts/checks/validate-workflow-supply-chain.sh`» (`BASE_SHA 28e802b8` → `HEAD_SHA 24396487`). **السببُ الجذريّ:** الدفعةُ عدّلت كودًا دونَ سطرٍ في `ROADMAP.md` في الدورةِ نفسِها (قاعدةٌ صلبة). **المعالجة:** سطرٌ في `ROADMAP.md` في الدفعةِ التالية — لا تعطيلَ للفحصِ ولا إعادةَ تشغيلٍ لإخفائه؛ يبقى التشغيلُ الفاشلُ سجلًّا على `24396487`. الحكمُ المعتمدُ للدمجِ هو فحوصُ الرأسِ النهائي.

## 5. ما بعدَ الدمج (بعدَ رفعِ الحاجزِ فقط)

إعادةُ قراءةِ الرأسِ والموافقةِ والفحوصِ مباشرةً ثمّ `scripts/ops/merge-on-approved-head.sh <pr> --squash` وحدَه · WASLA CI (41/41) · Roadmap freshness · Render deploy: `render-sync.json` يجبُ أن يُظهرَ **24/24** موردًا `matches_target` على SHA الدمج — وإلا فالنشرُ غيرُ مكتمل ويُسجَّلُ الإخفاق.

## 6. الحالات

INC-0007 `Open` (تدويرُ مفتاحِ Render **وتوكناتِ البوتات** وإثباتُ صلاحيتِها بعدَ التحديث — لم يحدث) · RISK-0067 `mitigating` · RISK-0066 `open` · M6-18B `Blocked` · NO-GO · R-02 · R-07 · P-03 · P-04 · P-05 — **بلا تغيير**. لا معايرةَ DR، ولا حمل، ولا RISK-0058، ولا `workflow_dispatch`.
