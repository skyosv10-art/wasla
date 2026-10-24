#!/usr/bin/env bash
# CLM-0677 — مراجعةُ RISK-0069 (عزلُ بيئةِ Render الاختباريّةِ عن قاعدةِ الإنتاج): قياسٌ قابلٌ لإعادةِ التشغيل — قراءةٌ فقط.
# لا نشرَ ولا dispatch ولا Render API ولا استعلامَ على أيِّ قاعدةِ بيانات ولا قراءةَ أسرار. الطفراتُ في شجرةِ عملٍ مؤقّتة.
# الاستعمال من جذرِ المستودع: bash .../measure.sh [REV]
set -uo pipefail
REV="${1:-origin/main}"; SHA=$(git rev-parse "$REV"); echo "rev=$SHA"
W=$(mktemp -d); trap 'git worktree remove --force "$W/wt" >/dev/null 2>&1; rm -rf "$W"' EXIT
git worktree add -q --detach "$W/wt" "$SHA"; cd "$W/wt"
T=infra/render/deploy-target.json
echo "== C1 deploy target (read only)"
python3 -c "
import json; t=json.load(open('$T'))
print('  mode', t['mode'], '· owner_id', t['owner_id'], '· environment', t['environment'], '· isolation_evidence', t['isolation_evidence'], '· production_database_refs', t['production_database_refs'])"
echo "  commits touching $T after 2026-10-19T12:00Z: $(git log --since=2026-10-19T12:00Z --format=%h "$SHA" -- "$T" | wc -l)"
echo "== C2 isolation evidence E1–E4 in the tree (ADR-073 addendum)"
echo "  files mentioning 'isolation_evidence' outside guards/target/history: $(git grep -l 'isolation_evidence' -- ':!scripts/' ':!infra/render/deploy-target.json' ':!docs/16-progress/' ':!docs/07-security/RISK_REGISTER.md' ':!docs/12-testing/ci-evidence/' | xargs)"
echo "  evidence dirs after 2026-10-19 naming E2/pg_roles (restricted role): $(git grep -lE 'pg_roles|rolsuper' -- 'docs/12-testing/ci-evidence/2026-10-2*' | xargs)"
echo "== C3 guards (offline self-tests)"
bash scripts/checks/validate-render-deploy-target.sh >"$W/o" 2>&1; echo "  validate-render-deploy-target rc=$? · $(sed 's/\x1b\[[0-9;]*m//g' "$W/o" | grep -E 'self-test' | tail -1 | xargs)"
echo "== C4 negative controls on the target (fresh tree each)"
k() { python3 - "$T" "$2" <<'PY'
import json, sys
p = sys.argv[1]; t = json.load(open(p)); exec(sys.argv[2]); json.dump(t, open(p, 'w'), indent=2); open(p, 'a').write('\n')
PY
bash scripts/checks/validate-render-deploy-target.sh >"$W/o" 2>&1; rc=$?
echo "  $1: rc=$rc $([[ $rc == 0 ]] && echo ACCEPTED || echo REJECTED) $(sed 's/\x1b\[[0-9;]*m//g' "$W/o" | grep -vE '^\s*✓' | grep -m1 -E '✗' | xargs | cut -c1-140)"; git checkout -q -- "$T"; }
k "N1 unfreeze (mode=deploy + owner) without isolation_evidence" "t['mode']='deploy'; t['owner_id']=t['test_workspace']"
k "N2 unfreeze with isolation_evidence naming a missing file" "t['mode']='deploy'; t['owner_id']=t['test_workspace']; t['isolation_evidence']='docs/missing-isolation.md'"
k "N3 production_database_refs emptied" "t['production_database_refs']=[]"
k "N4 (limit) unfreeze with isolation_evidence naming an existing but unrelated file (README.md)" "t['mode']='deploy'; t['owner_id']=t['test_workspace']; t['isolation_evidence']='README.md'"
echo "== C5 not measurable here: E1 separate test project · E2 role privileges · E3 env-group links · E4 key reuse (need Render/Supabase API; not used in this session)"
