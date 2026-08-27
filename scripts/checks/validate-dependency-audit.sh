#!/usr/bin/env bash
# validate-dependency-audit.sh — «الاعتماديةُ المعروفةُ الثغرةِ لا تمرُّ صامتةً»: أربعةُ أبوابٍ. (M0-06)
#
# ── لماذا يوجد هذا الملف ───────────────────────────────────────────────
# قِيس قبلَ العمل (2026-08-27، `pnpm audit` على `pnpm-lock.yaml` الحقيقيّ):
# **ستُّ ثغراتٍ** — واحدةٌ حرِجةٌ (`vitest` < 3.2.6، CVE-2026-47429، CVSS 9.8)،
# وواحدةٌ عاليةٌ (`vite`، CVE-2026-53571)، وأربعٌ متوسّطةٌ (`vite` ×2، `esbuild`
# في سلسلتَين). ولا سطرَ واحدٌ في المستودعِ كان يمنع دفعَ اعتماديةٍ مثقوبةٍ ولا
# يُلزم بتوثيقِ قبولِ الخطر: `.gitlab-ci.yml` لا يشغّل `pnpm audit` إطلاقاً.
#
# والدرسُ المتكرِّرُ في هذا المستودعِ (M0-12/M0-13/M0-15): **الإصلاحُ وحدَه لا
# يكفي، لأنّ غيابَ سطرٍ لا يُسقِط اختباراً في مراجعة**. فبعدَ رفعِ النسخِ يبقى
# البابُ مفتوحاً لثغرةٍ تُنشر غداً، أو لاستثناءٍ يُقبَل شفهيّاً ولا يُوثَّق، أو
# لِـ`overrides` يُدسُّ بلا سببٍ مكتوب.
#
# ── الأبوابُ الأربعة ──────────────────────────────────────────────────
# 1) **شجرةُ الإنتاجِ نظيفةٌ إلزاماً:** `pnpm audit --prod` = صفرُ ثغراتٍ. وهذا
#    البابُ لا يُقبَل فيه استثناءٌ: ما يُشحَن للمستخدمِ لا يُساوَم عليه.
# 2) **كلُّ ثغرةٍ في شجرةِ التطوير مُعلَنةٌ بمهلةٍ:** أيُّ ثغرةٍ يراها
#    `pnpm audit` (الشجرةُ كاملةً) يجب أن يكون معرِّفُها (GHSA) مكتوباً في
#    كتلةِ §11 من `docs/00-rules/SECURITY_RULES.md` بمالكٍ وتاريخِ انتهاءٍ.
#    وغيرُ المكتوبِ يُسقِط البوّابةَ، والمكتوبُ الذي انقضت مهلتُه يُسقِطها أيضاً —
#    فقبولُ الخطرِ **يَنتهي بتاريخٍ** ولا يصير أبديّاً بالنسيان.
# 3) **مديرُ الحزمِ مثبَّتٌ لا تقريبيٌّ:** `packageManager` في `package.json`
#    الجذرِ بنسخةٍ صريحةٍ (لا `^` ولا `~`)، و`pnpm-lock.yaml` موجودٌ. فبغيرِ
#    ذلك يجري كلُّ عاملٍ شجرةً مختلفةً ويصير التدقيقُ خبراً عن آلةٍ لا عن مستودع.
# 4) **لا `pnpm.overrides` بلا سببٍ مكتوبٍ:** كلُّ مفتاحٍ في `overrides` يجب أن
#    يكون مذكوراً في كتلةِ §11 نفسِها. فالتثبيتُ القسريُّ سلاحٌ: يُغلق ثغرةً
#    اليومَ ويُجمِّد نسخةً مثقوبةً غداً إن لم يُراجَعه أحد.
#
# ── الحدُّ المُعلَن ────────────────────────────────────────────────────
# البابانِ 1 و2 يسألان مُسجَّلَ npm عبرَ الشبكة. فإن غابَ `pnpm` أو غابت الشبكةُ
# **يُعلَن التخطّي صراحةً بالرمزِ 2** (لا نجاحٌ كاذبٌ ولا فشلٌ كاذبٌ)، ويبقى
# البابانِ 3 و4 نصّيَّين يجريان دائماً. والفحصُ لا يقرأ كوداً ولا يحكم على
# **قابليّةِ استغلالِ** ثغرةٍ في هذا المستودع — ذلك حكمُ إنسانٍ يُكتب في §11.
#
#   bash scripts/checks/validate-dependency-audit.sh            # المستودعُ نفسُه
#   bash scripts/checks/validate-dependency-audit.sh /tmp/root  # جذرٌ صريحٌ (للاختبار)
#   DEP_AUDIT_JSON=/tmp/a.json  bash …                          # تدقيقٌ جاهزٌ (للاختبار، الشجرةُ كاملةً)
#   DEP_AUDIT_PROD_JSON=/tmp/p.json bash …                      # تدقيقُ الإنتاجِ جاهزٌ (للاختبار)
#
# ووسيطُ الجذرِ ومتغيّرا البيئةِ موجودان ليُختبرَ الحارسُ على جذورٍ صناعيّةٍ وعلى
# مخارجِ تدقيقٍ مُصطنَعةٍ، فلا يُشوَّهُ المستودعُ الحقيقيُّ في اختبارٍ أبداً ولا
# يصير الاختبارُ رهينَ الشبكة (سابقةُ M0-12).
#
# المرجع: docs/00-rules/SECURITY_RULES.md §11 · docs/00-rules/VERIFY_COMMAND.md §2 · M0-06

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-$(cd "$HERE/../.." && pwd)}"
cd "$ROOT" || exit 1

DOC="docs/00-rules/SECURITY_RULES.md"
ANCHOR="## 11. اعتمادياتُ الطرفِ الثالثِ وتدقيقُ الثغرات"
PKG="package.json"
LOCK="pnpm-lock.yaml"

GRN=$'\033[32m'; RED=$'\033[31m'; YLW=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'
PROBLEMS=()
SKIPS=()

# ── قراءةُ كتلةِ §11 المُعلَنة ────────────────────────────────────────────
# الصيغةُ سطرٌ لكلِّ سجلٍّ: <معرّف> | expires:YYYY-MM-DD | owner:@من | سبب
# والمعرّفُ إمّا GHSA-… (استثناءُ ثغرةٍ) وإمّا override:<اسمُ الحزمة>.
read_block() {
  python3 - "$DOC" "$ANCHOR" <<'PY'
import sys, re
doc, anchor = sys.argv[1], sys.argv[2]
try:
    text = open(doc, encoding="utf-8").read()
except OSError:
    sys.exit("MISSING_DOC")
i = text.find(anchor)
if i < 0:
    sys.exit("MISSING_ANCHOR")
m = re.search(r"```text\n(.*?)```", text[i:], re.S)
if not m:
    sys.exit("MISSING_BLOCK")
for line in m.group(1).splitlines():
    line = line.strip()
    if line and not line.startswith("#"):
        print(line)
PY
}

if ! DECLARED="$(read_block)"; then
  printf '%s✗ لم أجد كتلةَ §11 المُعلَنةَ في %s — لا مرجعَ لقبولِ الخطر.%s\n' "$RED" "$DOC" "$RST"
  exit 1
fi

declare -A EXC_EXPIRY=() EXC_OWNER=() OVERRIDE_OK=()
BAD_ROWS=()
while IFS= read -r row; do
  [[ -z "$row" ]] && continue
  id="$(cut -d'|' -f1 <<< "$row" | xargs)"
  exp="$(cut -d'|' -f2 <<< "$row" | xargs)"
  own="$(cut -d'|' -f3 <<< "$row" | xargs)"
  if [[ "$id" == override:* ]]; then
    OVERRIDE_OK["${id#override:}"]=1
    continue
  fi
  if [[ ! "$id" =~ ^GHSA-[0-9a-z-]+$ ]] || [[ ! "$exp" =~ ^expires:[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || [[ ! "$own" =~ ^owner:@ ]]; then
    BAD_ROWS+=("$row")
    continue
  fi
  EXC_EXPIRY["$id"]="${exp#expires:}"
  EXC_OWNER["$id"]="${own#owner:}"
done <<< "$DECLARED"

for r in "${BAD_ROWS[@]:-}"; do
  [[ -n "$r" ]] && PROBLEMS+=("سجلٌّ غيرُ صالحٍ في §11 (المطلوب «GHSA-… | expires:YYYY-MM-DD | owner:@من | سبب» أو «override:<حزمة> | … »): $r")
done

# ── جمعُ التدقيقِ (أو إعلانُ التخطّي) ─────────────────────────────────────
audit_json() { # audit_json <ملفُّ الخرج> [--prod]
  local out="$1"; shift
  if [[ -n "${DEP_AUDIT_JSON:-}" && "$*" != *--prod* ]]; then cp "$DEP_AUDIT_JSON" "$out"; return 0; fi
  if [[ -n "${DEP_AUDIT_PROD_JSON:-}" && "$*" == *--prod* ]]; then cp "$DEP_AUDIT_PROD_JSON" "$out"; return 0; fi
  command -v pnpm >/dev/null 2>&1 || return 2
  pnpm audit --json "$@" > "$out" 2>/dev/null
  python3 -c "import json,sys;json.load(open(sys.argv[1]))" "$out" >/dev/null 2>&1 || return 2
  return 0
}

TMP_PROD="$(mktemp)"; TMP_ALL="$(mktemp)"
trap 'rm -f "$TMP_PROD" "$TMP_ALL"' EXIT

# البابُ 1 — شجرةُ الإنتاج.
if audit_json "$TMP_PROD" --prod; then
  PROD_SUM="$(python3 - "$TMP_PROD" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
v = d.get("metadata", {}).get("vulnerabilities", {})
total = sum(int(n) for n in v.values())
mods = sorted({a.get("module_name", "?") for a in d.get("advisories", {}).values()})
print("%d|%s|%s" % (total, json.dumps(v), ",".join(mods)))
PY
)"
  P_TOTAL="${PROD_SUM%%|*}"
  if (( P_TOTAL > 0 )); then
    PROBLEMS+=("البابُ 1: شجرةُ الإنتاجِ فيها $P_TOTAL ثغرةً — ولا استثناءَ في هذا البابِ. الحزمُ: $(cut -d'|' -f3 <<< "$PROD_SUM")")
  else
    printf '  %s✓ البابُ 1:%s شجرةُ الإنتاجِ نظيفةٌ (صفرُ ثغراتٍ).\n' "$GRN" "$RST"
  fi
else
  SKIPS+=("البابُ 1: لم يُسأل المُسجَّلُ عن شجرةِ الإنتاج (لا pnpm أو لا شبكة).")
fi

# البابُ 2 — شجرةُ التطوير: كلُّ ثغرةٍ مُعلَنةٌ بمهلةٍ سارية.
TODAY="$(date -u +%F)"
if audit_json "$TMP_ALL"; then
  ADV="$(python3 - "$TMP_ALL" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
for a in d.get("advisories", {}).values():
    ghsa = ""
    url = a.get("url", "") or ""
    if "GHSA-" in url:
        ghsa = "GHSA-" + url.split("GHSA-")[1].strip().strip("/")
    print("%s\t%s\t%s\t%s" % (ghsa or "?", a.get("severity", "?"), a.get("module_name", "?"),
                              (a.get("patched_versions") or "?")))
PY
)"
  N_ADV="$(grep -c . <<< "$ADV" || true)"
  if (( N_ADV == 0 )); then
    printf '  %s✓ البابُ 2:%s الشجرةُ كاملةً بلا ثغرةٍ معروفةٍ — لا حاجةَ لاستثناءٍ أصلاً.\n' "$GRN" "$RST"
  else
    while IFS=$'\t' read -r ghsa sev mod patched; do
      [[ -z "$ghsa" ]] && continue
      if [[ -z "${EXC_EXPIRY[$ghsa]:-}" ]]; then
        PROBLEMS+=("البابُ 2: ثغرةٌ ($sev) في «$mod» غيرُ مُعلَنةٍ في $DOC §11: $ghsa (المُصلَح: $patched).")
      elif [[ "${EXC_EXPIRY[$ghsa]}" < "$TODAY" ]]; then
        PROBLEMS+=("البابُ 2: قبولُ الخطرِ لـ$ghsa («$mod») انقضى في ${EXC_EXPIRY[$ghsa]} (اليومَ $TODAY) — مالكُه ${EXC_OWNER[$ghsa]}.")
      else
        printf '  %s⊘ البابُ 2:%s %s (%s، «%s») مقبولٌ حتى %s بمالكٍ %s.\n' \
          "$YLW" "$RST" "$ghsa" "$sev" "$mod" "${EXC_EXPIRY[$ghsa]}" "${EXC_OWNER[$ghsa]}"
      fi
    done <<< "$ADV"
  fi
else
  SKIPS+=("البابُ 2: لم يُسأل المُسجَّلُ عن الشجرةِ كاملةً (لا pnpm أو لا شبكة).")
fi

# ── البابُ 3: مديرُ الحزمِ مثبَّتٌ + ملفُّ قفلٍ موجودٌ ──────────────────────
if [[ ! -f "$PKG" ]]; then
  PROBLEMS+=("البابُ 3: لا $PKG في الجذر.")
else
  PM="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf-8')).get('packageManager',''))" "$PKG" 2>/dev/null)"
  if [[ -z "$PM" ]]; then
    PROBLEMS+=("البابُ 3: لا حقلَ packageManager في $PKG — كلُّ آلةٍ تحلُّ شجرةً مختلفةً.")
  elif [[ "$PM" == *'^'* || "$PM" == *'~'* || "$PM" == *'*'* || "$PM" == *'x'* || ! "$PM" =~ ^[a-z]+@[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    PROBLEMS+=("البابُ 3: packageManager غيرُ مثبَّتٍ بنسخةٍ صريحةٍ: «$PM».")
  fi
  [[ -f "$LOCK" ]] || PROBLEMS+=("البابُ 3: لا $LOCK — لا شجرةَ قابلةَ للتكرار فلا تدقيقَ ذا معنى.")
fi

# ── البابُ 4: كلُّ override مُبرَّرٌ في §11 ───────────────────────────────
if [[ -f "$PKG" ]]; then
  OVERRIDES="$(python3 -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
for k in (d.get('pnpm',{}).get('overrides') or {}):
    print(k)
" "$PKG" 2>/dev/null)"
  while IFS= read -r ov; do
    [[ -z "$ov" ]] && continue
    if [[ -z "${OVERRIDE_OK[$ov]:-}" ]]; then
      PROBLEMS+=("البابُ 4: التثبيتُ القسريُّ «$ov» في pnpm.overrides بلا سببٍ مكتوبٍ في $DOC §11 (المطلوب سطرٌ «override:$ov | expires:… | owner:@… | سبب»).")
    fi
  done <<< "$OVERRIDES"
  N_OV="$(grep -c . <<< "$OVERRIDES" || true)"
fi

# ── الحصاد ──────────────────────────────────────────────────────────────
if ((${#PROBLEMS[@]})); then
  printf '%s✗ تدقيقُ الاعتماديات — %d مشكلةً:%s\n' "$RED" "${#PROBLEMS[@]}" "$RST"
  for p in "${PROBLEMS[@]}"; do printf '  ✗ %s\n' "$p"; done
  printf '%s  المرجع: %s §11 (M0-06)%s\n' "$DIM" "$DOC" "$RST"
  exit 1
fi

printf '%s✓ تدقيقُ الاعتماديات:%s شجرةُ الإنتاجِ نظيفةٌ · كلُّ ثغرةٍ مُعلَنةٌ بمهلةٍ سارية · مديرُ الحزمِ مثبَّتٌ · %s تثبيتاً قسريّاً مُبرَّراً.\n' \
  "$GRN" "$RST" "${N_OV:-0}"
if ((${#SKIPS[@]})); then
  for s in "${SKIPS[@]}"; do printf '%s  ⊘ %s%s\n' "$YLW" "$s" "$RST"; done
  exit 2
fi
exit 0
