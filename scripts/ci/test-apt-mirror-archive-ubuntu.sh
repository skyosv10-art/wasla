#!/usr/bin/env bash
# CLM-0671 — اختباراتُ سكربتِ تحويلِ مرآةِ apt (الخيارُ B؛ بلا شبكةٍ ولا sudo؛ على جذرٍ وهميٍّ APT_ROOT).
#   SWITCH=<path> — لتشغيلِ المجموعةِ على نسخةٍ مُطفَّرة (اختبارُ الطفرات).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SWITCH="${SWITCH:-$HERE/apt-mirror-archive-ubuntu.sh}"
pass=0; fail=0
ok()  { pass=$((pass + 1)); echo "  ✓ $1"; }
bad() { fail=$((fail + 1)); echo "  ✗ $1"; }
mk()  { local d; d="$(mktemp -d)"; mkdir -p "$d/etc/apt/sources.list.d"; echo "$d"; }
run() { APT_ROOT="$1" GITHUB_ENV="$1/env" bash "$SWITCH" >"$1/out" 2>&1 </dev/null; }  # stdin مغلقٌ: grep بلا ملفّاتٍ لا يتعلّق

echo "== switch: positive =="
# P1 — تخطيطُ صورةِ ubuntu-24.04 (deb822 + mirror+file)
d=$(mk)
printf 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\narchive.ubuntu.com/ubuntu/\tpriority:2\nsecurity.ubuntu.com/ubuntu/\tpriority:3\n' > "$d/etc/apt/apt-mirrors.txt"
printf 'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates\nComponents: main universe\n' > "$d/etc/apt/sources.list.d/ubuntu.sources"
run "$d"; rc=$?
if (( rc == 0 )) && ! grep -rq azure "$d/etc/apt" && grep -q '^https://archive.ubuntu.com/ubuntu/' "$d/etc/apt/apt-mirrors.txt" \
   && grep -q 'CLM0671-MIRROR switched=1 files=2' "$d/out" \
   && grep -q 'security.ubuntu.com' "$d/etc/apt/apt-mirrors.txt"; then ok "P1 deb822+mirror-file switched, security untouched"; else bad "P1 rc=$rc"; cat "$d/out"; fi
# P2 — sources.list تقليديّ
d=$(mk)
printf 'deb http://azure.archive.ubuntu.com/ubuntu noble main\ndeb https://azure.archive.ubuntu.com/ubuntu noble-updates main\n' > "$d/etc/apt/sources.list"
run "$d"; rc=$?
if (( rc == 0 )) && [[ "$(grep -c '^deb https://archive.ubuntu.com/ubuntu ' "$d/etc/apt/sources.list")" == 2 ]]; then ok "P2 legacy sources.list (http+https) switched"; else bad "P2 rc=$rc"; fi
# P3 — نظيفٌ أصلًا
d=$(mk); printf 'deb http://archive.ubuntu.com/ubuntu noble main\n' > "$d/etc/apt/sources.list"
run "$d"; rc=$?
if (( rc == 0 )) && grep -q 'switched=0' "$d/out"; then ok "P3 already clean → no-op, switched=0"; else bad "P3 rc=$rc"; fi
# P4 — deb822 بعنوانٍ مباشرٍ (URIs: http://azure…) لا عبرَ mirror+file
d=$(mk); printf 'Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu/\nSuites: noble\nComponents: main\n' > "$d/etc/apt/sources.list.d/ubuntu.sources"
run "$d"; rc=$?
if (( rc == 0 )) && grep -q '^URIs: https://archive.ubuntu.com/ubuntu/$' "$d/etc/apt/sources.list.d/ubuntu.sources" && grep -q 'switched=1 files=1' "$d/out"; then ok "P4 deb822 direct URIs switched"; else bad "P4 rc=$rc"; fi

echo "== switch: negative (fail-closed) =="
d=$(mk); run "$d"; rc=$?
if (( rc == 1 )) && grep -q 'no apt source files' "$d/out"; then ok "N1 no source files → exit 1"; else bad "N1 rc=$rc"; fi
d=$(mk); printf 'deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n' > "$d/etc/apt/sources.list.d/microsoft.list"
run "$d"; rc=$?
if (( rc == 1 )) && grep -q 'no apt source references archive.ubuntu.com' "$d/out"; then ok "N2 layout without ubuntu archive → exit 1"; else bad "N2 rc=$rc"; fi
d=$(mk); printf 'deb http://archive.ubuntu.com/ubuntu noble main\n# fallback azure.archive.ubuntu.com\n' > "$d/etc/apt/sources.list"
run "$d"; rc=$?
if (( rc == 1 )) && grep -q 'still referenced' "$d/out"; then ok "N3 residual azure reference (no scheme) → exit 1"; else bad "N3 rc=$rc"; fi
d=$(mk); printf 'deb http://myarchive.ubuntu.com.evil/ubuntu noble main\n' > "$d/etc/apt/sources.list"
run "$d"; rc=$?
if (( rc == 1 )) && grep -q 'no apt source references archive.ubuntu.com' "$d/out"; then ok "N4 look-alike host is not accepted as archive.ubuntu.com → exit 1"; else bad "N4 rc=$rc"; fi

echo "apt-mirror tests: $pass passed, $fail failed"
(( fail == 0 ))
