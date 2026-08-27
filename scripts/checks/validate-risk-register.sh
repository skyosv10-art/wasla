#!/usr/bin/env bash
# validate-risk-register.sh — «لا خطرَ بلا مالكٍ ومهلةٍ، ولا استثناءَ بلا خطرٍ»: أربعةُ أبوابٍ. (M0-07)
#
# ── لماذا يوجد هذا الملف ───────────────────────────────────────────────
# قِيس قبلَ العمل (2026-08-27، بحثٌ نصّيٌّ في المستودعِ كلِّه): **لا ملفَّ سجلِّ
# مخاطرَ إطلاقاً**، والإشارةُ الوحيدةُ إلى «سجل المخاطر» كانت خانةَ `M0-07` في
# اللوحةِ — أي أنّ العنصرَ يشير إلى نفسِه. والمخاطرُ كانت موجودةً فعلاً لكنّها
# نثرٌ مبثوثٌ في خاناتِ اللوحةِ و`VERIFY_COMMAND.md` §7 و`SECURITY_RULES.md` §11.
#
# والنثرُ لا يُسأل عنه أحدٌ ولا تنقضي مهلتُه ولا يقرؤه سكربت. فما جعلَ قبولَ
# الخطرِ في `M0-06` **مؤقّتاً حقّاً** ليس نيّةَ كاتبِه بل حارساً يقرأ `expires:`
# ويُسقِط البوّابةَ بعدَها. هذا الحارسُ يُعمِّم ذلك على كلِّ خطرٍ في المستودع.
#
# ── الأبوابُ الأربعة ──────────────────────────────────────────────────
# 1) **الصيغةُ والمرجعُ:** الكتلةُ المقروءةُ آليّاً موجودةٌ، وكلُّ سطرٍ كاملُ
#    الحقولِ (`RISK-####` · `sev:` · `owner:@` · `opened:` · `review:` · `status:`
#    · `ref:` · عنوانٌ)، والمعرِّفُ فريدٌ، والحالُ من المفرداتِ الأربعِ، وكلُّ
#    `ref:` يشير إلى مسارٍ **موجودٍ فعلاً** (أو رابطٍ `http`). فمرجعٌ ميتٌ يجعل
#    السجلَّ حكايةً لا دليلاً.
# 2) **المهلةُ تنتهي:** أيُّ سطرٍ غيرِ `closed` انقضى `review:` يُسقِط البوّابةَ.
#    قبولُ الخطرِ بتاريخٍ أو ليس قبولاً بل نسياناً موثَّقاً.
# 3) **لا استثناءَ بلا خطرٍ مُسجَّلٍ:** كلُّ سجلٍّ في `SECURITY_RULES.md` §11
#    (`GHSA-…` أو `override:…`) له سطرُ `exception:` يقابله بخطرٍ قائمٍ غيرِ
#    مُغلَقٍ، **وتاريخُ مراجعةِ الخطرِ ليس متأخّراً عن `expires:` الاستثناء** —
#    وإلّا انقضى الاستثناءُ قبلَ أن ينظرَ فيه أحد.
# 4) **لا سجلَّ يتيماً:** الوثيقةُ مُشارٌ إليها من اللوحةِ ومن `SECURITY_RULES.md`.
#    سجلٌّ لا يُحال إليه لا يقرؤه أحدٌ — وهذه سابقةُ `M0-04` عينُها (لا حارسَ يتيماً).
#
# ── الحدُّ المُعلَن ────────────────────────────────────────────────────
# الحارسُ يحكم على **الصيغةِ والمواعيدِ والمقابلةِ**، ولا يحكم على **صوابِ تقديرِ
# الخطرِ** ولا على كفايةِ ضابطِه: تلك أحكامُ إنسانٍ تُكتب في §4 من السجلّ. ولا
# يقرأ كوداً ولا شبكةً، فهو نصّيٌّ بحتٌ ويجري دائماً بلا استثناءٍ ولا تخطٍّ.
#
#   bash scripts/checks/validate-risk-register.sh            # المستودعُ نفسُه
#   bash scripts/checks/validate-risk-register.sh /tmp/root  # جذرٌ صريحٌ (للاختبار)
#   RISK_TODAY=2027-01-01 bash …                             # تثبيتُ «اليومِ» (للاختبار)
#
# ووسيطُ الجذرِ ومتغيّرُ اليومِ موجودان ليُختبرَ الحارسُ على جذورٍ صناعيّةٍ، فلا
# يُشوَّهُ المستودعُ الحقيقيُّ في اختبارٍ أبداً ولا تتلف الحالاتُ بمرورِ الوقتِ
# (سابقةُ M0-12).
#
# المرجع: docs/07-security/RISK_REGISTER.md · docs/00-rules/SECURITY_RULES.md §11 · M0-07

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-$(cd "$HERE/../.." && pwd)}"
cd "$ROOT" || exit 1

REG="docs/07-security/RISK_REGISTER.md"
REG_ANCHOR="## 3. السجلُّ (كتلةٌ مقروءةٌ آليّاً — يقرؤها الحارسُ)"
SEC="docs/00-rules/SECURITY_RULES.md"
SEC_ANCHOR="## 11. اعتمادياتُ الطرفِ الثالثِ وتدقيقُ الثغرات"
BOARD="docs/16-progress/LAUNCH_EXECUTION_BOARD.md"
TODAY="${RISK_TODAY:-$(date -u +%Y-%m-%d)}"

GRN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RST=$'\033[0m'
PROBLEMS=()

# ── قراءةُ أوّلِ كتلةِ ```text``` تحتَ مرساةٍ عنوانيّةٍ ────────────────────
read_block() { # read_block <ملف> <مرساة>
  python3 - "$1" "$2" <<'PY'
import sys
doc, anchor = sys.argv[1], sys.argv[2]
try:
    text = open(doc, encoding="utf-8").read()
except OSError:
    sys.exit("MISSING_DOC")
i = text.find(anchor)
if i < 0:
    sys.exit("MISSING_ANCHOR")
rest = text[i + len(anchor):]
j = rest.find("```text")
if j < 0:
    sys.exit("MISSING_BLOCK")
rest = rest[j + len("```text"):]
k = rest.find("```")
if k < 0:
    sys.exit("UNCLOSED_BLOCK")
sys.stdout.write(rest[:k])
PY
}

# ── البابُ 1: الصيغةُ والمرجعُ ────────────────────────────────────────────
if [[ ! -f "$REG" ]]; then
  printf '%s✗ سجلُّ المخاطرِ مفقود:%s %s\n' "$RED" "$RST" "$REG"
  printf '  %sالمرجع: docs/07-security/RISK_REGISTER.md · العنصر M0-07%s\n' "$DIM" "$RST"
  exit 1
fi

REG_BLOCK="$(read_block "$REG" "$REG_ANCHOR")" || {
  printf '%s✗ تعذّرت قراءةُ كتلةِ السجلِّ:%s %s (%s)\n' "$RED" "$RST" "$REG" "$REG_BLOCK"
  printf '  %sالمرساةُ المطلوبةُ حرفيّاً: «%s» ثمَّ كتلةُ ```text```%s\n' "$DIM" "$REG_ANCHOR" "$RST"
  exit 1
}

declare -A RISK_STATUS=()
declare -A RISK_REVIEW=()
declare -a EXC_IDS=()
declare -A EXC_RISK=()
ROW_COUNT=0

while IFS= read -r line; do
  line="${line%%$'\r'}"
  [[ -z "${line// }" ]] && continue
  [[ "$line" == \#* ]] && continue

  if [[ "$line" == exception:* ]]; then
    # exception:<معرّف> | risk:RISK-####
    exc_id="$(printf '%s' "$line" | awk -F'|' '{print $1}' | sed 's/^exception://; s/[[:space:]]*$//')"
    exc_rk="$(printf '%s' "$line" | awk -F'|' '{print $2}' | sed 's/^[[:space:]]*risk://; s/[[:space:]]*$//; s/^[[:space:]]*//')"
    exc_raw="$(printf '%s' "$line" | awk -F'|' '{print $2}' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    if [[ -z "$exc_id" || "$exc_raw" != risk:* || ! "$exc_rk" == RISK-[0-9][0-9][0-9][0-9] ]]; then
      PROBLEMS+=("البابُ 1: سطرُ مقابلةٍ بصيغةٍ خاطئةٍ — «$line» (المطلوب: exception:<معرّف> | risk:RISK-####).")
      continue
    fi
    EXC_IDS+=("$exc_id"); EXC_RISK["$exc_id"]="$exc_rk"
    continue
  fi

  IFS='|' read -r c_id c_sev c_own c_open c_rev c_stat c_ref c_title <<< "$line"
  trim() { printf '%s' "$1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'; }
  c_id="$(trim "${c_id:-}")"; c_sev="$(trim "${c_sev:-}")"; c_own="$(trim "${c_own:-}")"
  c_open="$(trim "${c_open:-}")"; c_rev="$(trim "${c_rev:-}")"; c_stat="$(trim "${c_stat:-}")"
  c_ref="$(trim "${c_ref:-}")"; c_title="$(trim "${c_title:-}")"

  if [[ ! "$c_id" == RISK-[0-9][0-9][0-9][0-9] ]]; then
    PROBLEMS+=("البابُ 1: معرِّفٌ غيرُ صالحٍ — «$c_id» (المطلوب RISK-#### بأربعةِ أرقام).")
    continue
  fi
  ((ROW_COUNT++))
  [[ -n "${RISK_STATUS[$c_id]:-}" ]] && PROBLEMS+=("البابُ 1: $c_id مُعرَّفٌ مرّتَين في السجلّ.")

  sev="${c_sev#sev:}"
  case "$sev" in
    critical|high|medium|low) : ;;
    *) PROBLEMS+=("البابُ 1: $c_id شدّةٌ غيرُ صالحةٍ — «$c_sev» (critical|high|medium|low).") ;;
  esac
  own="${c_own#owner:}"
  [[ "$own" == @?* ]] || PROBLEMS+=("البابُ 1: $c_id بلا مالكٍ بمقبضٍ — «$c_own» (المطلوب owner:@من).")
  for pair in "opened:$c_open" "review:$c_rev"; do
    key="${pair%%:*}"; val="${pair#*:}"; val="${val#"$key":}"
    if [[ ! "$val" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
      PROBLEMS+=("البابُ 1: $c_id تاريخُ «$key» غيرُ صالحٍ — «$val» (YYYY-MM-DD).")
    fi
  done
  stat="${c_stat#status:}"
  case "$stat" in
    open|mitigating|accepted|closed) : ;;
    *) PROBLEMS+=("البابُ 1: $c_id حالٌ غيرُ صالحةٍ — «$c_stat» (open|mitigating|accepted|closed).") ;;
  esac
  ref="${c_ref#ref:}"
  if [[ -z "$ref" ]]; then
    PROBLEMS+=("البابُ 1: $c_id بلا مرجعٍ (ref:).")
  elif [[ "$ref" != http* ]]; then
    ref_path="${ref%% *}"   # يُقصُّ ما بعدَ المسارِ (مثل «§11»)
    [[ -e "$ref_path" ]] || PROBLEMS+=("البابُ 1: $c_id مرجعٌ لا وجودَ له — «$ref_path» (مرجعٌ ميتٌ يجعل السجلَّ حكايةً).")
  fi
  [[ -n "$c_title" ]] || PROBLEMS+=("البابُ 1: $c_id بلا عنوانٍ يشرح الخطرَ في سطر.")

  RISK_STATUS["$c_id"]="$stat"
  RISK_REVIEW["$c_id"]="${c_rev#review:}"
done <<< "$REG_BLOCK"

(( ROW_COUNT > 0 )) || PROBLEMS+=("البابُ 1: كتلةُ السجلِّ بلا سطرِ خطرٍ واحدٍ — سجلٌّ فارغٌ ليس سجلّاً.")

if (( ${#PROBLEMS[@]} == 0 )); then
  printf '  %s✓ البابُ 1:%s الصيغةُ صالحةٌ ومراجعُها موجودةٌ (%d خطراً · %d مقابلةً).\n' \
    "$GRN" "$RST" "$ROW_COUNT" "${#EXC_IDS[@]}"
fi

# ── البابُ 2: المهلةُ تنتهي ───────────────────────────────────────────────
EXPIRED=0
for rid in "${!RISK_STATUS[@]}"; do
  [[ "${RISK_STATUS[$rid]}" == "closed" ]] && continue
  rev="${RISK_REVIEW[$rid]}"
  [[ "$rev" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
  if [[ "$rev" < "$TODAY" ]]; then
    PROBLEMS+=("البابُ 2: $rid انقضى تاريخُ مراجعتِه ($rev < $TODAY) وحالُه «${RISK_STATUS[$rid]}» — يُراجَع أو تُمدَّ المهلةُ بقرارٍ مكتوب.")
    ((EXPIRED++))
  fi
done
(( EXPIRED == 0 )) && printf '  %s✓ البابُ 2:%s لا مهلةَ مراجعةٍ منقضيةً (اليومَ %s).\n' "$GRN" "$RST" "$TODAY"

# ── البابُ 3: لا استثناءَ بلا خطرٍ مُسجَّلٍ ─────────────────────────────────
if [[ -f "$SEC" ]]; then
  # كتلةٌ **فارغةٌ** مشروعةٌ (لا استثناءَ مُعلَناً اليومَ)، أمّا **تعذُّرُ القراءةِ**
  # (مرساةٌ مفقودةٌ أو كتلةٌ غيرُ مغلقةٍ) فعيبٌ يُسقِط — والفرقُ بينهما رمزُ الخروج.
  if SEC_BLOCK="$(read_block "$SEC" "$SEC_ANCHOR" 2>/dev/null)"; then
    UNMATCHED=0
    while IFS= read -r sline; do
      sline="${sline%%$'\r'}"
      [[ -z "${sline// }" ]] && continue
      [[ "$sline" == \#* ]] && continue
      sid="$(printf '%s' "$sline" | awk -F'|' '{print $1}' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
      [[ "$sid" == GHSA-* || "$sid" == override:* ]] || continue
      sexp="$(printf '%s' "$sline" | grep -oE 'expires:[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)"; sexp="${sexp#expires:}"
      linked="${EXC_RISK[$sid]:-}"
      if [[ -z "$linked" ]]; then
        PROBLEMS+=("البابُ 3: الاستثناءُ «$sid» في §11 بلا خطرٍ مُسجَّلٍ — يُضاف سطرُ exception:$sid | risk:RISK-#### في السجلّ.")
        ((UNMATCHED++)); continue
      fi
      st="${RISK_STATUS[$linked]:-}"
      if [[ -z "$st" ]]; then
        PROBLEMS+=("البابُ 3: «$sid» يشير إلى $linked ولا وجودَ لهذا الخطرِ في السجلّ.")
        ((UNMATCHED++)); continue
      fi
      if [[ "$st" == "closed" ]]; then
        PROBLEMS+=("البابُ 3: «$sid» ما زال مُعلَناً في §11 وخطرُه $linked مُغلَقٌ — إمّا يُرفَع الاستثناءُ وإمّا يُفتَح الخطر.")
        ((UNMATCHED++)); continue
      fi
      rev="${RISK_REVIEW[$linked]}"
      if [[ -n "$sexp" && "$rev" > "$sexp" ]]; then
        PROBLEMS+=("البابُ 3: مراجعةُ $linked ($rev) بعدَ انتهاءِ استثناءِ «$sid» ($sexp) — يُراجَع الخطرُ قبلَ أن ينقضي استثناؤه لا بعدَه.")
        ((UNMATCHED++))
      fi
    done <<< "$SEC_BLOCK"
    (( UNMATCHED == 0 )) && printf '  %s✓ البابُ 3:%s كلُّ استثناءٍ في §11 يقابله خطرٌ قائمٌ بمراجعةٍ سابقةٍ لانتهائه.\n' "$GRN" "$RST"
  fi
else
  PROBLEMS+=("البابُ 3: $SEC مفقودٌ — لا مصدرَ للاستثناءاتِ المُعلَنة.")
fi

# ── البابُ 4: لا سجلَّ يتيماً ──────────────────────────────────────────────
ORPHAN=0
for f in "$BOARD" "$SEC"; do
  [[ -f "$f" ]] || continue
  grep -q "RISK_REGISTER.md" "$f" || {
    PROBLEMS+=("البابُ 4: لا إحالةَ إلى RISK_REGISTER.md في $f — سجلٌّ لا يُحال إليه لا يقرؤه أحدٌ.")
    ((ORPHAN++))
  }
done
(( ORPHAN == 0 )) && printf '  %s✓ البابُ 4:%s السجلُّ مُحالٌ إليه من اللوحةِ ومن قواعدِ الأمان.\n' "$GRN" "$RST"

# ── الحكم ────────────────────────────────────────────────────────────────
if (( ${#PROBLEMS[@]} > 0 )); then
  printf '\n%s✗ سجلُّ المخاطر: %d مشكلةً.%s\n' "$RED" "${#PROBLEMS[@]}" "$RST"
  for p in "${PROBLEMS[@]}"; do printf '  %s- %s%s\n' "$RED" "$p" "$RST"; done
  printf '  %sالمرجع: %s · %s §11 · العنصر M0-07%s\n' "$DIM" "$REG" "$SEC" "$RST"
  exit 1
fi

printf '%s✓ سجلُّ المخاطر:%s %d خطراً بمالكٍ ومهلةٍ ساريةٍ · %d استثناءً مقابَلاً · لا سجلَّ يتيماً.\n' \
  "$GRN" "$RST" "$ROW_COUNT" "${#EXC_IDS[@]}"
exit 0
