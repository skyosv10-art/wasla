#!/usr/bin/env bash
# CLM-0676 — مراجعةُ RISK-0068 (دقائقُ بناءِ Render): قياسٌ قابلٌ لإعادةِ التشغيل — قراءةٌ فقط.
# لا يُشغِّلُ نشرًا ولا dispatch، ولا يقرأ أسرارًا، ولا يلمسُ Render API.
# الاستعمال من جذرِ المستودع: bash .../measure.sh [REV]   (يتطلّبُ gh للقسم B3)
set -uo pipefail
REV="${1:-origin/main}"; SHA=$(git rev-parse "$REV"); echo "rev=$SHA"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
echo "== B1 triggers of render-deploy.yml at REV"
git show "$SHA:.github/workflows/render-deploy.yml" > "$W/wf.yml"
python3 - "$W/wf.yml" <<'PY'
import sys, yaml
w = yaml.safe_load(open(sys.argv[1])); on = w.get(True, w.get('on'))
keys = list(on.keys()) if isinstance(on, dict) else on
print("  on:", keys, "· push trigger:", 'push' in keys, "· schedule:", 'schedule' in keys)
PY
echo "== B2 deploy target at REV (infra/render/deploy-target.json — read only)"
git show "$SHA:infra/render/deploy-target.json" | python3 -c "
import json,sys; t=json.load(sys.stdin)
print('  mode', t['mode'], '· environment', t['environment'], '· since', t['since'], '· isolation_evidence', t['isolation_evidence'])
print('  test_plan_items approved:', {k: v['approved'] for k, v in t['test_plan_items'].items()}, '· fleet_deploy approved:', t['fleet_deploy']['approved'])"
echo "  last commit touching deploy-target.json: $(git log -1 --format='%h %ad' --date=iso-strict "$SHA" -- infra/render/deploy-target.json)"
echo "== B3 render-deploy.yml runs (GitHub, read only)"
if command -v gh >/dev/null; then
  gh run list --repo skyosv10-art/wasla --workflow render-deploy.yml --limit 200 --json databaseId,event,conclusion,createdAt \
    -q '.[]|"\(.createdAt) \(.event) \(.conclusion) \(.databaseId)"' > "$W/runs"
  echo "  total runs: $(wc -l < "$W/runs") · latest: $(head -1 "$W/runs")"
  echo "  runs created after 2026-10-19T07:30Z (CLM-0632 freeze): $(awk '$1 > "2026-10-19T07:30"' "$W/runs" | wc -l)"
  echo "  by event: $(awk '{print $2}' "$W/runs" | sort | uniq -c | xargs)"
fi
echo "== B4 local guards at REV (self-tests; offline)"
G=$(mktemp -d); git worktree add -q --detach "$G/wt" "$SHA"
for s in validate-render-deploy-target.sh validate-render-deploy-plan.sh validate-render-config.sh validate-render-host-sources.sh; do
  (cd "$G/wt" && bash scripts/checks/$s >"$W/o" 2>&1); rc=$?
  echo "  $s rc=$rc · $(sed 's/\x1b\[[0-9;]*m//g' "$W/o" | grep -E 'self-test|✓|✗' | tail -1 | xargs | cut -c1-140)"
done
echo "== B5 negative control: a push trigger added to render-deploy.yml must be rejected by some guard"
python3 - "$G/wt/.github/workflows/render-deploy.yml" <<'PY'
import sys; p = sys.argv[1]; s = open(p).read(); o = s
s = s.replace("\non:\n", "\non:\n  push:\n    branches: [main]\n", 1); assert s != o, "NOT APPLIED"; open(p, 'w').write(s)
PY
for s in validate-render-deploy-target.sh validate-render-deploy-plan.sh validate-workflow-supply-chain.sh; do
  (cd "$G/wt" && bash scripts/checks/$s >"$W/o" 2>&1); rc=$?
  echo "  push-trigger mutant · $s rc=$rc $([[ $rc == 0 ]] && echo ACCEPTED || echo REJECTED) $(sed 's/\x1b\[[0-9;]*m//g' "$W/o" | grep -m1 '✗' | cut -c1-120)"
done
git worktree remove --force "$G/wt"; rm -rf "$G"
echo "== B6 not measurable here: Render pipeline-minutes balance / billing cycle (needs Render API credentials; not used)"
