# gov-cases-container-image.sh — حالاتُ طفرةٍ للفحصِ 19 (صورةُ الحاويةِ · M2-01).
#
# تُستدعى من `scripts/checks/test-governance.sh` وتعملُ في نسخةِ `/tmp` (المتغيّرُ
# `$T`) لا في المستودعِ الأصلي، وتعتمدُ على `t()` المُعرَّفةِ هناك.
#
# ── القاعدةُ التي تفرضُها هذهِ الحالاتُ ────────────────────────────────────
# حارسٌ لم تُثبَتْ **عضّتُهُ** ليسَ حارساً بل زينةٌ خضراءُ. فلكلِّ بابٍ من أبوابِ
# الفحصِ 19 التسعةِ طفرةٌ **يجبُ أن تُسقِطَهُ**، ويُعادُ الأصلُ بعدَ كلِّ واحدةٍ
# ويُثبَتُ أنَّهُ يمرُّ — وإلّا فقد يكونُ الحارسُ ساقطاً دائماً لا عاضّاً.
#
# وكلُّ طفرةٍ **تُثبِتُ أنَّها طفرَت** بمقارنةِ البايتاتِ قبلَها وبعدَها: طفرةٌ
# صامتةٌ تُقرأُ «عضّةً» وهيَ لا تُغيّرُ حرفاً (سابقةُ `gov-cases-authz-policy.sh`).
#
# المرجع: docs/08-infrastructure/CONTAINER_IMAGES.md · ADR-033 · docs/12-testing/M2-01_GATE.md

printf '\n\033[1m[ط] حارسُ صورةِ الحاويةِ وسلسلةِ توريدِها (M2-01 · الفحصُ 19)\033[0m\n'

CI_G=scripts/checks/validate-container-image.sh
CI_DF=Dockerfile
CI_DI=.dockerignore
CI_WF=.github/workflows/ci.yml
CI_DOC=docs/08-infrastructure/CONTAINER_IMAGES.md
CI_MB=docs/12-testing/MERGE_BLOCKING.json
CI_PINS=scripts/container/tool-pins.env
CI_SBOM=scripts/container/generate-sbom.sh

if [[ ! -f "$CI_G" ]]; then
  printf '  \033[31m✗\033[0m %s مفقودٌ — لا تُقاسُ عضّةُ حارسٍ غائبٍ\n' "$CI_G"
  ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

CI_BK=/tmp/containerimage_backup
rm -rf "$CI_BK"; mkdir -p "$CI_BK"
cp "$CI_DF"   "$CI_BK/dockerfile"
cp "$CI_DI"   "$CI_BK/dockerignore"
cp "$CI_WF"   "$CI_BK/workflow"
cp "$CI_DOC"  "$CI_BK/doc"
cp "$CI_MB"   "$CI_BK/mergeblocking"
cp "$CI_PINS" "$CI_BK/pins"
cp "$CI_SBOM" "$CI_BK/sbom"

_ci_restore() {
  cp "$CI_BK/dockerfile"    "$CI_DF"
  cp "$CI_BK/dockerignore"  "$CI_DI"
  cp "$CI_BK/workflow"      "$CI_WF"
  cp "$CI_BK/doc"           "$CI_DOC"
  cp "$CI_BK/mergeblocking" "$CI_MB"
  cp "$CI_BK/pins"          "$CI_PINS"
  cp "$CI_BK/sbom"          "$CI_SBOM"
  chmod +x scripts/container/*.sh
}

# طفرةٌ لا تُغيّرُ بايتاً ليست طفرةً — فالعضّةُ المقيسةُ عليها كذبٌ.
_ci_mutated() { # _ci_mutated <ملفٌّ> <نسخةُ الأصلِ>
  if cmp -s "$1" "$2"; then
    printf '  \033[31m✗\033[0m طفرةٌ صامتةٌ: %s لم يتغيّرْ بايتٌ فيهِ\n' "$1"
    ((FAIL++))
    return 1
  fi
  return 0
}

# الأصلُ يمرُّ — وبلا هذا لا معنى لأيِّ إخفاقٍ بعدَه.
t "الحالةُ الأصليّةُ تمرُّ (خطُّ الأساسِ)" pass bash "$CI_G"

# ── البابُ 1: الأساسُ مُثبَّتٌ بالبصمةِ ────────────────────────────────────
# وسمٌ متحرّكٌ يجعلُ «نفسَ البناءِ» نواتَينِ مختلفتَينِ بينَ يومَينِ.
sed -i '0,/^FROM node:/s|^FROM node:[^ ]*|FROM node:20.20.1-alpine|' "$CI_DF"
if _ci_mutated "$CI_DF" "$CI_BK/dockerfile"; then
  t "أساسٌ بوسمٍ بلا بصمةٍ يُسقِطُ الفحصَ" fail bash "$CI_G"
fi
_ci_restore

# ── البابُ 2: نسخةُ العقدةِ = نسخةُ CI ────────────────────────────────────
# ما يُختبَرُ يجبُ أن يكونَ ما يُشحَنُ؛ وفرقُ نسخةٍ صامتٌ يُكتشَفُ في الإنتاجِ.
sed -i '0,/^FROM node:/s|^FROM node:[0-9.]*|FROM node:22.11.0|' "$CI_DF"
if _ci_mutated "$CI_DF" "$CI_BK/dockerfile"; then
  t "نسخةُ عقدةٍ تخالفُ NODE_VERSION في ci.yml تُسقِطُ الفحصَ" fail bash "$CI_G"
fi
_ci_restore

# ── البابُ 1ب: الوثيقةُ تُعلِنُ بصمةً غيرَ المُستعمَلةِ ───────────────────
sed -i 's/sha256:b8833/sha256:c8833/' "$CI_DOC"
if _ci_mutated "$CI_DOC" "$CI_BK/doc"; then
  t "بصمةٌ في الوثيقةِ تخالفُ Dockerfile تُسقِطُ الفحصَ" fail bash "$CI_G"
fi
_ci_restore

# ── البابُ 3: الطبقةُ الأخيرةُ غيرُ جِذرٍ ────────────────────────────────
sed -i 's/^USER node$/USER root/' "$CI_DF"
if _ci_mutated "$CI_DF" "$CI_BK/dockerfile"; then
  t "طبقةٌ أخيرةٌ تعملُ جِذراً تُسقِطُ الفحصَ" fail bash "$CI_G"
fi
_ci_restore

# ── البابُ 4: لا نسخةَ pnpm مكتوبةً في Dockerfile ────────────────────────
# مصدرانِ لنسخةِ مديرِ الحِزَمِ يفترقانِ بصمتٍ، فيُبنى بغيرِ ما يُختبَرُ بهِ.
#
# الطفرةُ **مُثبَّتةٌ على بادئةِ السطرِ لا على السطرِ كلِّهِ**: النسخةُ الأولى
# طابقتْ `^RUN corepack enable$` حرفاً بحرفٍ، ثمَّ صارَ السطرُ في Dockerfile
# `RUN corepack enable && mkdir -p /corepack` فلم تُطابِقْ الطفرةُ شيئاً —
# ومرَّتْ الحالةُ محلّياً لأنَّها لم تعُدْ تُطفِّرُ أصلاً، حتّى فضحَها حاجزُ
# «الطفرةِ الصامتةِ» في CI (الشوطُ 35145160740). العِبرةُ مُسجَّلةٌ لا مُلطَّفةٌ:
# حاجزُ `_ci_mutated` هوَ ما منعَ تحوُّلَ الحالةِ إلى نجاحٍ كاذبٍ.
sed -i 's|^RUN corepack enable|RUN corepack prepare pnpm@9.0.0 --activate \&\& corepack enable|' "$CI_DF"
if _ci_mutated "$CI_DF" "$CI_BK/dockerfile"; then
  t "نسخةُ pnpm مكتوبةٌ في Dockerfile تُسقِطُ الفحصَ" fail bash "$CI_G"
fi
_ci_restore

# ── البابُ 5: المُدخَلاتُ الإلزاميّةُ في .dockerignore ───────────────────
sed -i '/^node_modules$/d' "$CI_DI"
if _ci_mutated "$CI_DI" "$CI_BK/dockerignore"; then
  t "حذفُ node_modules من .dockerignore يُسقِطُ الفحصَ" fail bash "$CI_G"
fi
_ci_restore

# ── البابُ 6أ: مَحوُ وظيفةِ CI ────────────────────────────────────────────
sed -i 's|^  image-supply-chain:$|  image-supply-chain-disabled:|' "$CI_WF"
if _ci_mutated "$CI_WF" "$CI_BK/workflow"; then
  t "مَحوُ وظيفةِ image-supply-chain من ci.yml يُسقِطُ الفحصَ" fail bash "$CI_G"
fi
_ci_restore

# ── البابُ 6ب: سكربتٌ غيرُ مُستدعىً من الوظيفةِ ─────────────────────────
sed -i '/scripts\/container\/scan-image.sh/d' "$CI_WF"
if _ci_mutated "$CI_WF" "$CI_BK/workflow"; then
  t "إسقاطُ خطوةِ فحصِ الثغراتِ من الوظيفةِ يُسقِطُ الفحصَ" fail bash "$CI_G"
fi
_ci_restore

# ── البابُ 6ج: سكربتٌ غيرُ قابلٍ للتنفيذِ ────────────────────────────────
chmod -x scripts/container/build-image.sh
t "سكربتُ بناءٍ غيرُ قابلٍ للتنفيذِ يُسقِطُ الفحصَ" fail bash "$CI_G"
_ci_restore

# ── البابُ 7: السياقُ الحاجزُ مَمحوٌّ من اللقطةِ ──────────────────────────
python3 - "$CI_MB" <<'MUT'
import json, sys
path = sys.argv[1]
data = json.load(open(path, encoding="utf-8"))
checks = data["protection"]["required_status_checks"]
checks["contexts"] = [c for c in checks["contexts"] if c != "image-supply-chain"]
json.dump(data, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
MUT
if _ci_mutated "$CI_MB" "$CI_BK/mergeblocking"; then
  t "مَحوُ السياقِ الحاجزِ من MERGE_BLOCKING يُسقِطُ الفحصَ" fail bash "$CI_G"
fi
_ci_restore

# ── البابُ 8أ: حزمةٌ قابلةٌ للتشغيلِ غيرُ مُعلَنةٍ ───────────────────────
sed -i '/`@wasla\/orders-service`/d' "$CI_DOC"
if _ci_mutated "$CI_DOC" "$CI_BK/doc"; then
  t "حزمةٌ قابلةٌ للتشغيلِ بلا صفٍّ في العقدِ تُسقِطُ الفحصَ" fail bash "$CI_G"
fi
_ci_restore

# ── البابُ 8ب: صفٌّ ميتٌ في العقدِ ───────────────────────────────────────
printf '| `@wasla/ghost-service` | `services/ghost` | `src/http/server.ts` |\n' >> "$CI_DOC"
if _ci_mutated "$CI_DOC" "$CI_BK/doc"; then
  t "صفٌّ ميتٌ لا يُطابقُ الشجرةَ يُسقِطُ الفحصَ" fail bash "$CI_G"
fi
_ci_restore

# ── البابُ 8ج: رقمٌ منشورٌ يُكتَبُ ولا يُقاسُ ────────────────────────────
sed -i 's/RUNNABLE_PACKAGE_COUNT: [0-9]*/RUNNABLE_PACKAGE_COUNT: 99/' "$CI_DOC"
if _ci_mutated "$CI_DOC" "$CI_BK/doc"; then
  t "عددٌ منشورٌ يخالفُ القياسَ يُسقِطُ الفحصَ" fail bash "$CI_G"
fi
_ci_restore

# ── البابُ 9أ: بصمةُ أداةٍ معطوبةٌ ───────────────────────────────────────
sed -i 's/^SYFT_SHA256=.*/SYFT_SHA256=deadbeef/' "$CI_PINS"
if _ci_mutated "$CI_PINS" "$CI_BK/pins"; then
  t "بصمةُ أداةٍ ليست sha256 تُسقِطُ الفحصَ" fail bash "$CI_G"
fi
_ci_restore

# ── البابُ 9ب: نسخةُ أداةٍ مكتوبةٌ في موضعٍ ثانٍ ─────────────────────────
printf 'TRIVY_FALLBACK_URL="https://example.invalid/trivy_0.74.0_Linux-64bit.tar.gz"\n' >> "$CI_SBOM"
if _ci_mutated "$CI_SBOM" "$CI_BK/sbom"; then
  t "نسخةُ أداةٍ مكتوبةٌ خارجَ tool-pins.env تُسقِطُ الفحصَ" fail bash "$CI_G"
fi
_ci_restore

# ── البابُ 9ج: بديلٌ صامتٌ في توليدِ قائمةِ الموادِ ──────────────────────
# `|| true` يجعلُ فشلَ التوليدِ يُقرأُ نجاحاً — وهوَ عينُ عطبِ PR #205.
sed -i 's|^"$TOOLS/syft" scan.*|& \|\| true|' "$CI_SBOM"
if _ci_mutated "$CI_SBOM" "$CI_BK/sbom"; then
  t "بديلٌ صامتٌ في generate-sbom.sh يُسقِطُ الفحصَ" fail bash "$CI_G"
fi
_ci_restore

# ── والأصلُ يمرُّ بعدَ كلِّ الاستعاداتِ — وإلّا فالحزمةُ لوّثت النسخةَ ───
t "الأصلُ يمرُّ بعدَ استعادةِ كلِّ الطفراتِ" pass bash "$CI_G"
