#!/usr/bin/env bash
# CLM-0671 — اختبارُ الطفراتِ للنسخةِ المعتمَدة (بعدَ حذفِ المسبار): سكربتُ التحويلِ وحدَه.
# كلُّ طفرةٍ استبدالٌ واحدٌ متحقَّقٌ من عددِه على نسخةٍ في دليلٍ مؤقّت، ويُتوقَّعُ أن تفشلَ المجموعةُ عليها (KILLED).
# (mutants.sh المجاورُ تاريخيٌّ: كتبَ لرأسِ القياسِ ذي المسبار، ولا يعملُ بعدَ حذفِه.)
# الاستعمال من جذرِ المستودع: bash docs/12-testing/ci-evidence/2026-10-24T010000Z-clm-0671-apt-mirror-option-b/mutants-final.sh
set -uo pipefail
S=scripts/ci/apt-mirror-archive-ubuntu.sh; T=scripts/ci/test-apt-mirror-archive-ubuntu.sh
M=$(mktemp -d); trap 'rm -rf "$M"' EXIT
survived=0; total=0
mut() {
  total=$((total + 1)); local f="$M/$1.sh"
  python3 - "$S" "$f" "$2" "$3" <<'PY' || { echo "$1: MUTATION NOT APPLIED"; survived=$((survived + 1)); return; }
import sys
src, dst, a, b = sys.argv[1:]
s = open(src).read()
assert s.count(a) == 1, f"expected exactly 1 occurrence, got {s.count(a)}"
open(dst, "w").write(s.replace(a, b))
PY
  local r rc; r=$(SWITCH="$f" timeout 60 bash "$T" 2>/dev/null </dev/null); rc=$?
  if (( rc != 0 )); then echo "$1: KILLED by $(grep -o '✗ [A-Z][0-9]' <<<"$r" | tr '\n' ' ')"; else echo "$1: SURVIVED"; survived=$((survived + 1)); fi
}
mut M1-no-sed '    $SUDO sed -i -E' '    : $SUDO sed -i -E'
mut M2-no-residual-check "if grep -lE 'azure\.archive\.ubuntu\.com' \"\${FILES[@]}\" >/dev/null 2>&1; then" 'if false; then'
mut M3-no-archive-check "if ! grep -lE '(^|[^.a-z])archive\.ubuntu\.com' \"\${FILES[@]}\" >/dev/null 2>&1; then" 'if false; then'
mut M4-loose-archive-regex "'(^|[^.a-z])archive\.ubuntu\.com'" "'archive\.ubuntu\.com'"
mut M5-http-target "#https://archive.ubuntu.com#g" "#http://archive.ubuntu.com#g"
mut M6-no-empty-files-check 'if (( ${#FILES[@]} == 0 )); then' 'if false; then'
mut M7-http-only-scheme "s#https?://azure" "s#http://azure"
mut M8-drop-deb822-glob ' "$ETC"/sources.list.d/*.sources; do' '; do'
mut M9-residual-exit-0 '  grep -nE '"'"'azure\.archive\.ubuntu\.com'"'"' "${FILES[@]}" >&2 || true
  exit 1' '  grep -nE '"'"'azure\.archive\.ubuntu\.com'"'"' "${FILES[@]}" >&2 || true
  exit 0'
echo "mutants: $total · survived: $survived"
(( survived == 0 ))
