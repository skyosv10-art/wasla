#!/usr/bin/env bash
# CLM-0674 — مراجعةُ RISK-0011 (الأساسُ يبيتُ بيدٍ): قياسٌ قابلٌ لإعادةِ التشغيل، قراءةٌ فقط على المستودع.
# التجاربُ السلوكيّةُ تجري في شجرةِ عملٍ مؤقّتةٍ منفصلةٍ تُحذَفُ في النهاية؛ لا يتغيّرُ شيءٌ في الشجرةِ الحاليّة.
# الاستعمال من جذرِ المستودع:
#   bash docs/12-testing/ci-evidence/2026-10-24T090000Z-clm-0674-risk-0011-review/measure.sh [REV] [CI_TEST_JOB_ID]
#   REV افتراضيًّا origin/main · CI_TEST_JOB_ID (اختياريّ): مهمّةُ `test` في WASLA CI على REV لقياسِ الانحرافِ الحاليّ (يتطلّبُ gh).
set -uo pipefail
REV="${1:-origin/main}"; JOB="${2:-}"
SHA=$(git rev-parse "$REV"); echo "rev=$SHA"
W=$(mktemp -d); trap 'git worktree remove --force "$W/wt" >/dev/null 2>&1; rm -rf "$W"' EXIT
git worktree add -q --detach "$W/wt" "$SHA"
cd "$W/wt"
B=docs/12-testing/BASELINE.json
val() { bash scripts/checks/validate-baseline.sh >"$W/out" 2>&1; local rc=$?; sed -i 's/\x1b\[[0-9;]*m//g' "$W/out"; echo "$rc"; }
edit() { python3 - "$B" "$1" <<'PY'
import json, sys
p, expr = sys.argv[1], sys.argv[2]
b = json.load(open(p)); exec(expr); json.dump(b, open(p, "w"), ensure_ascii=False, indent=2); open(p, "a").write("\n")
PY
}
reset() { git checkout -q -- docs/12-testing/; }

echo "== G0 baseline as committed"
python3 -c "import json;b=json.load(open('$B'));d=b['dynamic'];print('  generated_at',b['generated_at'],'· repo.commit',b['repo']['commit'][:12],'· tests_passed',d['tests_passed'],'· test_files',d['test_files_executed'],'· gov_cases',d['governance_suite_cases'],'· source',d.get('source'))"
echo "  validate-baseline rc=$(val)"

echo "== G1 tamper control (RISK-0028): hand-edited tests_passed must be rejected"
reset; edit "b['dynamic']['tests_passed'] += 1000"; rc=$(val); echo "  rc=$rc · $(grep -m1 -E '^\s+- ' "$W/out" | cut -c1-160)"; reset

echo "== G2 staleness control: a baseline claiming to be a month old (real old commit + old date)"
OLD=$(git log --format=%H --since=2026-09-20 --until=2026-09-25 -1 -- "$B" "$SHA"); echo "  old baseline commit: ${OLD:0:12} ($(git log -1 --format=%ad --date=short "$OLD"))"
edit "b['repo']['commit']='$OLD'; b['generated_at']='$(git log -1 --format=%aI "$OLD" | sed 's/+00:00/Z/')'"
rc=$(val); echo "  rc=$rc · $(tail -1 "$W/out" | cut -c1-120)"; reset
edit "b['generated_at']='1999-01-01T00:00:00Z'"; rc=$(val); echo "  generated_at=1999 → rc=$rc"; reset

echo "== G3 automation: workflows that run baseline.sh / a schedule that regenerates it"
n=$(git grep -l 'baseline\.sh' -- '.github/workflows/*.yml' | wc -l); echo "  workflows invoking baseline.sh: $n"
git grep -n 'cron:' -- '.github/workflows/*.yml' | sed 's/^/  cron: /'
echo "  age rule in validate-baseline.sh (compares generated_at/commit date with now): $(grep -cE 'datetime\.now|date \+%s|utcnow|time\.time\(\)' scripts/checks/validate-baseline.sh)"

echo "== G4 history (last 30 days before REV): regenerations, gaps, dynamic jumps"
for c in $(git log --since="$(date -u -d "$(git log -1 --format=%aI "$SHA") -30 days" +%F)" --format=%H "$SHA" -- "$B" | tac); do
  git show "$c:$B" | python3 -c "import json,sys;b=json.load(sys.stdin);d=b.get('dynamic',{});print('$c'[:8],b.get('generated_at'),d.get('tests_passed'))"
done > "$W/hist"
python3 - "$W/hist" <<'PY'
import sys
from datetime import datetime as D
r = [l.split() for l in open(sys.argv[1]) if l.split()[2] != 'None']
t = [(D.fromisoformat(a[1].replace('Z', '+00:00')), int(a[2]), a[0]) for a in r]
g = [((b[0]-a[0]).total_seconds()/3600, a[2], b[2]) for a, b in zip(t, t[1:])]
j = [(b[1]-a[1], a[2], b[2], a[1], b[1]) for a, b in zip(t, t[1:])]
g.sort(); print(f"  regenerations: {len(t)} · gap hours median {g[len(g)//2][0]:.1f} · max {g[-1][0]:.1f} ({g[-1][1]}→{g[-1][2]})")
print(f"  consecutive pairs with tests_passed unchanged: {sum(1 for x in j if x[0]==0)}/{len(j)}")
for x in sorted(j, key=lambda x: -abs(x[0]))[:3]: print(f"  largest jump {x[0]:+d}: {x[1]} ({x[3]}) → {x[2]} ({x[4]})")
PY

if [[ -n "$JOB" ]]; then
  echo "== G5 current drift: BASELINE vs WASLA CI job $JOB (same regexes as baseline.sh)"
  gh run view --repo skyosv10-art/wasla --job "$JOB" --log > "$W/ci.log" 2>/dev/null
  python3 - "$W/ci.log" "$B" <<'PY'
import json, re, sys
t = re.sub(r'(\x1b|\^\[)\[[0-9;]*m', '', open(sys.argv[1], encoding='utf-8', errors='replace').read())
tp = sum(int(m) for m in re.findall(r"Tests\s+(\d+) passed", t)); tf = sum(int(m) for m in re.findall(r"Test Files\s+(\d+) passed", t))
d = json.load(open(sys.argv[2]))['dynamic']
print(f"  CI: tests_passed={tp} test_files={tf} · BASELINE: {d['tests_passed']} / {d['test_files_executed']} · drift {tp-d['tests_passed']:+d} / {tf-d['test_files_executed']:+d}")
PY
fi
