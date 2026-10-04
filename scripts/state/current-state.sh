#!/usr/bin/env bash
# current-state.sh — where the project stands, read from main itself (M0-52 · STATE_SYNC_RULE.md §8).
#
# A new agent runs this first. It derives everything from the records in the repository, so it
# cannot drift: it stores nothing and writes nothing. Sources: WORK_CLAIMS.md · TASK_LOG.md ·
# LAUNCH_EXECUTION_BOARD.md · RISK_REGISTER.md · and, when `gh` is available, open PRs, branches
# and the latest main CI verdict.
#
#   bash scripts/state/current-state.sh          # or: pnpm run state:current
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
CL=docs/16-progress/WORK_CLAIMS.md
TL=docs/16-progress/TASK_LOG.md
BD=docs/16-progress/LAUNCH_EXECUTION_BOARD.md
RR=docs/07-security/RISK_REGISTER.md

echo "== main: $(git rev-parse --short HEAD 2>/dev/null) $(git log -1 --format='%cs %s' 2>/dev/null | cut -c1-100)"

echo; echo "== Claims still open (Active/Paused) — should be empty between agents"
# shellcheck source=../checks/lib/claims_rows.sh
source scripts/checks/lib/claims_rows.sh
open_claims="$(claims_active_rows "$CL" | awk -F'\t' '{print "  " $1 "  " $2 "  " $4 "  (" $8 ")"}')"
[[ -n "$open_claims" ]] && echo "$open_claims" || echo "  none"

echo; echo "== Latest TASK_LOG entries (by claim number)"
python3 - "$TL" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
parts = re.split(r"(?m)^(?=# 20\d\d-)", text)
entries = []
for p in parts:
    head = p.splitlines()[0] if p.strip() else ""
    ids = [int(x) for x in re.findall(r"CLM-(\d+)", head)]
    if not ids:
        continue
    st = re.search(r"\*\*Status:\*\*\s*(.+)", p)
    nx = re.search(r"(?i)\*\*Next[^*]*:\*\*\s*(.+)|Next:\s*(.+)", p)
    entries.append((max(ids), head[2:120], st.group(1)[:110] if st else "-", (nx.group(1) or nx.group(2))[:160] if nx else "-"))
for n, h, s, x in sorted(entries)[-5:]:
    print(f"  {h}\n      status: {s}\n      next:   {x}")
PY

echo; echo "== Board items not Completed (In Progress / Blocked / Ready for Gate)"
awk -F'|' '/^\| *M[0-9]+-[0-9A-Za-z]+ *\|/ {s=$6; gsub(/^ +| +$/,"",s); if (s=="In Progress"||s=="Blocked"||s=="Ready for Gate") {id=$2; t=$3; gsub(/^ +| +$/,"",id); gsub(/^ +| +$/,"",t); printf "  %-8s %-15s %s\n", id, s, substr(t,1,90)}}' "$BD"

echo; echo "== Risks not closed"
grep -E '^RISK-[0-9]{4} \|' "$RR" | grep -v 'status:closed' | awk -F'|' '{printf "  %s %s %s\n", $1, $6, $2}'

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo; echo "== Open PRs"
  gh pr list --state open --json number,headRefName,title --jq '.[]|"  #\(.number) \(.headRefName) — \(.title)"' 2>/dev/null || echo "  (unreadable)"
  echo; echo "== Branches other than main"
  gh api "repos/{owner}/{repo}/branches" --paginate --jq '.[].name' 2>/dev/null | grep -vx main | sed 's/^/  /' || true
  echo; echo "== Latest WASLA CI on main"
  gh run list --branch main --workflow "WASLA CI" --limit 1 --json headSha,conclusion,status --jq '.[]|"  \(.headSha[0:7]) \(.status) \(.conclusion)"' 2>/dev/null || true
else
  echo; echo "(gh unavailable: open PRs, branches and CI not shown)"
fi
echo; echo "Rule: docs/00-rules/STATE_SYNC_RULE.md"
