#!/usr/bin/env bash
# CLM-0671 — اختبارُ الطفراتِ لسكربتَي الخيارِ B: كلُّ طفرةٍ تُطبَّقُ على نسخةٍ في دليلٍ مؤقّتٍ
# (استبدالٌ واحدٌ متحقَّقٌ من عددِهِ)، ويُتوقَّعُ أن تفشلَ مجموعةُ الاختبارِ عليها (KILLED).
# الاستعمال من جذرِ المستودع: bash docs/12-testing/ci-evidence/2026-10-24T010000Z-clm-0671-apt-mirror-option-b/mutants.sh
set -uo pipefail
S=scripts/ci/apt-mirror-archive-ubuntu.sh; P=scripts/ci/apt-mirror-probe.sh; T=scripts/ci/test-apt-mirror-archive-ubuntu.sh
M=$(mktemp -d); trap 'rm -rf "$M"' EXIT
survived=0
mut() {
  local f="$M/$1.sh"
  python3 - "$2" "$f" "$3" "$4" <<'PY' || { echo "$1: MUTATION NOT APPLIED"; survived=$((survived + 1)); return; }
import sys
src, dst, a, b = sys.argv[1:]
s = open(src).read()
assert s.count(a) == 1, f"expected exactly 1 occurrence, got {s.count(a)}"
open(dst, "w").write(s.replace(a, b))
PY
  local r rc
  if [[ "$2" == "$S" ]]; then r=$(SWITCH="$f" bash "$T" 2>/dev/null); else r=$(PROBE="$f" bash "$T" 2>/dev/null); fi
  rc=$?
  if (( rc != 0 )); then echo "$1: KILLED by $(grep -o '✗ [A-Z][0-9]' <<<"$r" | tr '\n' ' ')"; else echo "$1: SURVIVED"; survived=$((survived + 1)); fi
}
mut M1-no-sed "$S" '    $SUDO sed -i -E' '    : $SUDO sed -i -E'
mut M2-no-residual-check "$S" "if grep -lE 'azure\.archive\.ubuntu\.com' \"\${FILES[@]}\" >/dev/null 2>&1; then" 'if false; then'
mut M3-no-archive-check "$S" "if ! grep -lE '(^|[^.a-z])archive\.ubuntu\.com' \"\${FILES[@]}\" >/dev/null 2>&1; then" 'if false; then'
mut M4-loose-archive-regex "$S" "'(^|[^.a-z])archive\.ubuntu\.com'" "'archive\.ubuntu\.com'"
mut M5-http-target "$S" "#https://archive.ubuntu.com#g" "#http://archive.ubuntu.com#g"
mut M6-no-T0 "$S" 'echo "CLM0671_JOB_T0=$(date +%s)" >> "$GITHUB_ENV"' ':'
mut M7-probe-first-install "$P" "grep '^Install: ' \"\$HIST\" | tail -1" "grep '^Install: ' \"\$HIST\" | head -1"
mut M8-probe-no-budget "$P" '  (( PROBE_SECONDS < 10 )) && emit' '  false && emit'
mut M9-probe-drop-version "$P" 'print(f"{name}={m.group(3)}")' 'print(f"{name}")'
echo "mutants: 9 · survived: $survived"
(( survived == 0 ))
