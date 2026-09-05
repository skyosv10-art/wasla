#!/usr/bin/env bash
# قياساتُ الدفعةِ الخامسة (M0-15 · M0-16 · M0-17 · M0-19) — تُطبَّق طفرةٌ واحدةٌ في
# كلِّ جولةٍ ثمّ تُستعاد الشفرةُ فوراً. لا تُودَع طفرةٌ قطُّ.
set -uo pipefail
cd /home/user/workspace/wasla
OUT=/tmp/b5
mkdir -p "$OUT"

VWC=scripts/checks/validate-work-claims.sh
MP=scripts/checks/lib/meaningful-paths.sh
FRESH=scripts/checks/validate-claim-freshness.sh
MRT=scripts/checks/validate-mr-target.sh

cp "$VWC" /tmp/b5.vwc.bak; cp "$MP" /tmp/b5.mp.bak; cp "$FRESH" /tmp/b5.fresh.bak; cp "$MRT" /tmp/b5.mrt.bak
restore() { cp /tmp/b5.vwc.bak "$VWC"; cp /tmp/b5.mp.bak "$MP"; cp /tmp/b5.fresh.bak "$FRESH"; cp /tmp/b5.mrt.bak "$MRT"; }

mutate() { # mutate <file> <old> <new>
  python3 - "$1" "$2" "$3" <<'PY'
import sys
f,old,new=sys.argv[1:4]
s=open(f,encoding='utf-8').read()
assert old in s, "لم أجد الموضع: "+old[:60]
open(f,'w',encoding='utf-8').write(s.replace(old,new,1))
print("MUTATED OK")
PY
}

run() { # run <tag>
  echo "### $1 started $(date -u +%H:%M:%S)" >> "$OUT/progress.txt"
  bash scripts/checks/test-governance.sh > "$OUT/$1.raw.txt" 2>&1
  sed 's/\x1b\[[0-9;]*m//g' "$OUT/$1.raw.txt" | grep -aE "^✗|النتيجة:" >> "$OUT/progress.txt"
  restore
}

restore
run base

mutate "$VWC" 'MEANINGFUL="$MEANINGFUL_PATHS"' "MEANINGFUL='^(apps/|bots/|services/|packages/|infra/|scripts/)'" && run mut-m0-15a
restore
mutate "$MP" 'packages/|infra/' 'infra/' && run mut-m0-15b
restore
mutate "$FRESH" '  printf '"'"'  والحجزُ النشطُ يمنع غيرَه من نطاقِه (الشرطُ 4) — فالبائتُ يُقفل نطاقاً على لا أحد.\n'"'"' >&2
  exit 1' '  printf '"'"'  والحجزُ النشطُ يمنع غيرَه من نطاقِه (الشرطُ 4) — فالبائتُ يُقفل نطاقاً على لا أحد.\n'"'"' >&2
  exit 0' && run mut-m0-16a
restore
mutate "$FRESH" "NF==10 && \$9 ~ /Active/ && \$2 ~ /CLM-/" "(NF==10 || NF==8) && \$2 ~ /CLM-/" && run mut-m0-16b
restore
mutate "$FRESH" 'والنجاحُ جزئيٌّ لا كامل' 'والنجاحُ تامٌّ' && run mut-m0-16c
restore
mutate "$MRT" 'if git merge-base --is-ancestor "$T_SHA" "$D_SHA" 2>/dev/null; then' 'if false; then' && run mut-m0-17a
restore
mutate "$MRT" 'if (( T_RC == 2 )); then' 'if false; then' && run mut-m0-17b
restore
mutate "$VWC" 'MY_SCOPES="${MY_SCOPES:+$MY_SCOPES,}$scope"
done < "$ACTIVE_TSV"' 'MY_SCOPES="${MY_SCOPES:+$MY_SCOPES,}$scope"
  break
done < "$ACTIVE_TSV"' && run mut-m0-19
restore

git diff --stat scripts/ > "$OUT/final-diff.txt" 2>&1
echo "ALL DONE $(date -u +%H:%M:%S)" >> "$OUT/progress.txt"
