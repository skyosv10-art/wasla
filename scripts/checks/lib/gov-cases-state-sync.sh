# gov-cases-state-sync.sh — mutation cases for checks 26 and 27 (STATE-SYNC · M0-52 · ADR-061).
#
# Sourced by scripts/checks/test-governance.sh. Uses its PASS/FAIL counters and $REPO_ROOT.
# Every case builds a fresh synthetic git repository in mktemp. The real guard and map are copied
# in; nothing touches the working repository. Each case states the verdict it expects and also the
# reason line that must produce it, so a BLOCK for the wrong reason fails the case. Each mutation
# proves it changed the file it claims to change.
#
# Required by the Program Owner decision (2026-10-04):
#   A code + state → PASS · B code without state → BLOCK · C security fix without risk sync → BLOCK
#   D valid docs-only → PASS · E docs that do not reflect the change → BLOCK
#   F merged PR whose branch remains → failure signal
# Rule: docs/00-rules/STATE_SYNC_RULE.md

printf '\n\033[1m[STATE-SYNC] project state travels with the change (M0-52 · checks 26/27)\033[0m\n'

SS_SRC="$REPO_ROOT/scripts/checks"
if [[ ! -f "$SS_SRC/lib/state_sync.py" || ! -f "$SS_SRC/lib/state-sync-map.json" || ! -f "$SS_SRC/validate-merged-branches.sh" ]]; then
  printf '  \033[31m✗\033[0m STATE-SYNC guard files missing — cannot measure an absent guard\n'; ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

SS_BR=feat/clm-9001-demo

# _ss_base — a fresh repository with main holding consistent records. Prints its path.
_ss_base() {
  local d; d="$(mktemp -d)"
  (
    cd "$d" || exit 1
    git init -q -b main . && git config user.email t@t && git config user.name t
    mkdir -p scripts/checks/lib docs/16-progress docs/07-security docs/00-rules docs/15-decisions \
             services/demo/src/__tests__ docs/05-guides
    cp "$SS_SRC/lib/state_sync.py" "$SS_SRC/lib/state-sync-map.json" scripts/checks/lib/
    cp "$SS_SRC/lib/claims_rows.sh" scripts/checks/lib/
    cp "$SS_SRC/validate-merged-branches.sh" "$SS_SRC/validate-work-claims.sh" scripts/checks/
    cp "$SS_SRC/lib/meaningful-paths.sh" scripts/checks/lib/
    printf '# rules\nvalidate-merged-branches.sh\n' > docs/00-rules/STATE_SYNC_RULE.md
    cat > docs/16-progress/WORK_CLAIMS.md <<'EOF'
| Claim ID | Work Item | Owner | Branch | Scope | Started | Expires | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| CLM-9000 | M9-01 | @a | feat/old | services/demo/ | 2026-01-01 | 2026-01-02 | Released | the old work was merged and released |
EOF
    printf '# TASK_LOG\n\n# 2026-01-01 — CLM-9000 — M9-01: old\n- **Status:** Completed\n' > docs/16-progress/TASK_LOG.md
    printf '| ID | Title | Team | Dep | Status | Notes |\n|---|---|---|---|---|---|\n| M9-01 | demo | T | - | In Progress | old |\n' > docs/16-progress/LAUNCH_EXECUTION_BOARD.md
    printf '# Roadmap\nLast updated: 2026-01-01 (CLM-9000)\n' > ROADMAP.md
    printf 'RISK-0001 | sev:high | owner:@a | opened:2026-01-01 | review:2026-12-01 | status:open | ref:x | demo risk\n' > docs/07-security/RISK_REGISTER.md
    printf 'export const a = 1;\n' > services/demo/src/a.ts
    printf 'test("a", () => {});\n' > services/demo/src/__tests__/a.test.ts
    printf '# guide\n' > docs/05-guides/GUIDE.md
    git add -A && git commit -qm base && git checkout -qb "$SS_BR"
  ) >/dev/null 2>&1
  printf '%s' "$d"
}

# _ss_state <dir> [claim_status] [status_text] [extra entry lines...] — writes a full, honest state update.
_ss_state() {
  local d="$1" cst="${2:-Released}" stx="${3:-Completed}"; shift 3 2>/dev/null || shift $#
  (
    cd "$d" || exit 1
    printf '| CLM-9001 | M9-01 | @a | %s | services/demo/ | 2026-10-04 | 2026-10-05 | %s | demo change delivered with tests in this PR |\n' "$SS_BR" "$cst" >> docs/16-progress/WORK_CLAIMS.md
    {
      printf '\n# 2026-10-04 — CLM-9001 — M9-01: demo change in services/demo\n'
      printf -- '- **Work Item(s):** M9-01\n- **Status:** %s\n' "$stx"
      for l in "$@"; do printf '%s\n' "$l"; done
    } >> docs/16-progress/TASK_LOG.md
    sed -i 's/^| M9-01 | demo | T | - | In Progress | old |$/| M9-01 | demo | T | - | Ready for Gate | CLM-9001 demo delivered |/' docs/16-progress/LAUNCH_EXECUTION_BOARD.md
    printf 'Last updated: 2026-10-04 (CLM-9001)\n' >> ROADMAP.md
  )
}

_ss_code()  { ( cd "$1" && printf 'export const a = 2;\n' > services/demo/src/a.ts ); }
_ss_test()  { ( cd "$1" && printf 'test("a2", () => {});\n' > services/demo/src/__tests__/a.test.ts ); }
_ss_commit(){ ( cd "$1" && git add -A && git commit -qm change ) >/dev/null 2>&1; }

# _ss_mutated <dir> — the change actually happened (no silent mutation).
_ss_mutated() {
  if [[ -z "$(cd "$1" && git diff --name-only main..HEAD)" ]]; then
    printf '  \033[31m✗\033[0m silent mutation: nothing changed on the branch\n'; ((FAIL++)); return 1
  fi
}

# _ss_expect <dir> <pass|block> <desc> [expected reason text]
_ss_expect() {
  local d="$1" want="$2" desc="$3" why="${4:-}" out rc
  _ss_mutated "$d" || { rm -rf "$d"; return; }
  out="$(cd "$d" && WASLA_STATE_SYNC_BRANCH="$SS_BR" python3 scripts/checks/lib/state_sync.py main HEAD 2>&1)"; rc=$?
  local good=0
  if [[ "$want" == pass ]]; then
    (( rc == 0 )) && grep -qF "PASS — project state synchronized" <<<"$out" && good=1
  else
    (( rc != 0 )) && grep -qF "BLOCKED — project state synchronization required" <<<"$out" \
      && { [[ -z "$why" ]] || grep -qF -- "$why" <<<"$out"; } && good=1
  fi
  if (( good )); then
    printf '  \033[32m✓\033[0m %-66s (%s)\n' "$desc" "$want"; ((PASS++))
  else
    printf '  \033[31m✗\033[0m %-66s expected %s%s, got rc=%s\n' "$desc" "$want" "${why:+ «$why»}" "$rc"
    printf '%s\n' "$out" | sed 's/^/      /' | tail -12; ((FAIL++))
  fi
  rm -rf "$d"
}

# ── A) code + tests + state → PASS
d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_state "$d" Released Completed; _ss_commit "$d"
_ss_expect "$d" pass "A: code + tests + full state → PASS"

# ── B) code without state → BLOCK (and prints the required records + reason)
d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_commit "$d"
_ss_expect "$d" block "B: code without project state → BLOCK" "BLOCKED: implementation changed but project-state documentation was not synchronized."
d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_commit "$d"
_ss_expect "$d" block "B: the block names the stale reason" "project state is stale"

# ── C) security fix without risk sync → BLOCK
d="$(_ss_base)"
( cd "$d" && mkdir -p packages/authz-policy/src/__tests__ && printf 'export const p=1;\n' > packages/authz-policy/src/p.ts \
  && printf 'test("p",()=>{});\n' > packages/authz-policy/src/__tests__/p.test.ts && git add -A && git commit -qm pre ) >/dev/null 2>&1
( cd "$d" && git branch -f main HEAD ) >/dev/null 2>&1
( cd "$d" && printf 'export const p=2;\n' > packages/authz-policy/src/p.ts && printf 'test("p2",()=>{});\n' > packages/authz-policy/src/__tests__/p.test.ts )
_ss_state "$d" Released Completed "- authz-policy tightened"; _ss_commit "$d"
_ss_expect "$d" block "C: security fix without **Risk(s):** → BLOCK" "add **Risk(s):**"
d="$(_ss_base)"
( cd "$d" && mkdir -p packages/authz-policy/src && printf 'export const p=1;\n' > packages/authz-policy/src/p.ts && git add -A && git commit -qm pre && git branch -f main HEAD ) >/dev/null 2>&1
( cd "$d" && printf 'export const p=2;\n' > packages/authz-policy/src/p.ts ); _ss_test "$d"
_ss_state "$d" Released Completed "- authz-policy p.ts tightened" "- **Risk(s):** RISK-0001 → closed"; _ss_commit "$d"
_ss_expect "$d" block "C: entry says closed, register says open → BLOCK" "the entry says 'closed', the register says 'open'"
d="$(_ss_base)"
( cd "$d" && mkdir -p packages/authz-policy/src && printf 'export const p=1;\n' > packages/authz-policy/src/p.ts && git add -A && git commit -qm pre && git branch -f main HEAD ) >/dev/null 2>&1
( cd "$d" && printf 'export const p=2;\n' > packages/authz-policy/src/p.ts \
  && sed -i 's/status:open/status:closed/' docs/07-security/RISK_REGISTER.md ); _ss_test "$d"
_ss_state "$d" Released Completed "- authz-policy p.ts tightened" "- **Risk(s):** RISK-0001 → closed"; _ss_commit "$d"
_ss_expect "$d" pass "C': security fix with the register synchronized → PASS"

# ── D) valid docs-only → PASS
d="$(_ss_base)"; ( cd "$d" && printf 'more\n' >> docs/05-guides/GUIDE.md )
( cd "$d" && printf '| CLM-9001 | M9-01 | @a | %s | docs/05-guides/ | 2026-10-04 | 2026-10-05 | Released | guide clarified for operators in this PR |\n' "$SS_BR" >> docs/16-progress/WORK_CLAIMS.md \
  && printf '\n# 2026-10-04 — CLM-9001 — M9-01: GUIDE clarified\n- **Work Item(s):** M9-01\n- **Status:** Completed\n' >> docs/16-progress/TASK_LOG.md \
  && sed -i 's/| In Progress | old |$/| Ready for Gate | CLM-9001 guide |/' docs/16-progress/LAUNCH_EXECUTION_BOARD.md )
_ss_commit "$d"; _ss_expect "$d" pass "D: valid docs-only change with its records → PASS"

# ── E) docs that do not reflect the change → BLOCK
d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_state "$d" Released Completed; _ss_commit "$d"
( cd "$d" && sed -i 's/ — CLM-9001 — M9-01: demo change in services\/demo/ — CLM-9999 — M9-01: unrelated note/' docs/16-progress/TASK_LOG.md && git commit -qam e ) >/dev/null 2>&1
_ss_expect "$d" block "E: entry names another claim and not the unit → BLOCK" "the new entry does not name CLM-9001"
d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_state "$d" Released Completed; _ss_commit "$d"
( cd "$d" && sed -i 's/: demo change in services\/demo/: unrelated note/' docs/16-progress/TASK_LOG.md && git commit -qam e ) >/dev/null 2>&1
_ss_expect "$d" block "E: entry does not mention the changed unit → BLOCK" "does not mention the changed unit \`services/demo\`"
d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_state "$d" Released Completed "- **Evidence:** \`docs/16-progress/NOPE.md\`"; _ss_commit "$d"
_ss_expect "$d" block "E: cites an evidence path that does not exist → BLOCK" "evidence path \`docs/16-progress/NOPE.md\` does not exist"

d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_state "$d" Released Completed "- deleted the merged branch \`docs/old-branch\` after merge"; _ss_commit "$d"
_ss_expect "$d" pass "E': a branch name (branch \`docs/x\`) is a ref, not an evidence path → PASS"

# ── stale "in progress" state for finished work
d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_state "$d" Active Completed; _ss_commit "$d"
_ss_expect "$d" block "claim left Active in the PR → BLOCK (merge is the release)" "status is 'Active'"
d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_state "$d" Released "In Progress — PR pending"; _ss_commit "$d"
_ss_expect "$d" block "**Status:** 'PR pending' → BLOCK (stale on merge)" "would be stale on main"
d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_state "$d" Released "In Progress — PR pending → Completed"; _ss_commit "$d"
_ss_expect "$d" pass "status history '<old> → <new>': judged on the last segment → PASS"
d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_state "$d" Released "قيد التنفيذ — بانتظار الدمج"; _ss_commit "$d"
_ss_expect "$d" block "Arabic stale status (بانتظار الدمج) → BLOCK" "would be stale on main"

# ── missing pieces
d="$(_ss_base)"; _ss_code "$d"; _ss_state "$d" Released Completed; _ss_commit "$d"
_ss_expect "$d" block "code without tests and without No-Test-Reason → BLOCK" "implementation changed with no test change"
d="$(_ss_base)"; _ss_code "$d"; _ss_state "$d" Released Completed "- **No-Test-Reason:** constant rename only, no behaviour change at all"; _ss_commit "$d"
_ss_expect "$d" pass "code without tests but with a stated No-Test-Reason → PASS"
d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_state "$d" Released Completed
( cd "$d" && git checkout -q main -- docs/16-progress/LAUNCH_EXECUTION_BOARD.md ); _ss_commit "$d"
_ss_expect "$d" block "board row not updated → BLOCK" "row M9-01 is not updated"
d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_state "$d" Released Completed
( cd "$d" && git checkout -q main -- ROADMAP.md ); _ss_commit "$d"
_ss_expect "$d" block "roadmap line not updated → BLOCK" "ROADMAP.md"
d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_state "$d" Released Completed
( cd "$d" && git checkout -q main -- docs/16-progress/TASK_LOG.md && printf '\n   \n' >> docs/16-progress/TASK_LOG.md ); _ss_commit "$d"
_ss_expect "$d" block "whitespace-only TASK_LOG change → BLOCK" "whitespace only"

# ── unmapped, deleted-but-referenced, new guard undocumented, deployment evidence
d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_state "$d" Released Completed; ( cd "$d" && printf 'x\n' > weird.bin ); _ss_commit "$d"
_ss_expect "$d" block "unmapped path → BLOCK (REVIEW REQUIRED, never PASS)" "REVIEW REQUIRED"
d="$(_ss_base)"; ( cd "$d" && printf 'bash scripts/checks/old-guard.sh\n' > scripts/checks/run.sh && printf 'echo\n' > scripts/checks/old-guard.sh \
  && printf 'old-guard.sh run.sh\n' >> docs/00-rules/STATE_SYNC_RULE.md && git add -A && git commit -qm pre && git branch -f main HEAD && git rm -q scripts/checks/old-guard.sh ) >/dev/null 2>&1
_ss_state "$d" Released Completed "- removed scripts/checks/old-guard.sh"; _ss_commit "$d"
_ss_expect "$d" block "deleted file still referenced by scripts → BLOCK" "was deleted/renamed but is still referenced"
d="$(_ss_base)"; ( cd "$d" && printf 'echo\n' > scripts/checks/new-guard.sh ); _ss_state "$d" Released Completed "- added new-guard.sh"; _ss_commit "$d"
_ss_expect "$d" block "new guard not referenced by any rule/ADR → BLOCK" "is not referenced by any rule or ADR"
d="$(_ss_base)"; ( cd "$d" && mkdir -p infra/demo && printf 'a: 1\n' > infra/demo/x.yaml ); _ss_state "$d" Released Completed "- infra/demo x.yaml"; _ss_commit "$d"
_ss_expect "$d" block "deployment change without Evidence/Deployment → BLOCK" "**Evidence:**"

# ── no documentation catch-up PR
d="$(_ss_base)"
( cd "$d" && sed -i 's/| Released | the old work was merged and released |/| Active | the old work |/' docs/16-progress/WORK_CLAIMS.md && git commit -qam pre && git branch -f main HEAD \
  && sed -i 's/| Active | the old work |/| Released | the old work, released after merge |/' docs/16-progress/WORK_CLAIMS.md \
  && printf '\n# 2026-10-04 — release CLM-9000\n- **Status:** Completed\n' >> docs/16-progress/TASK_LOG.md ) >/dev/null 2>&1
_ss_commit "$d"; _ss_expect "$d" block "catch-up release PR after merge → BLOCK" "the release belongs in the implementation PR"
d="$(_ss_base)"
( cd "$d" && printf '\n# 2026-10-04 — correction\n- **Kind:** state-correction — TASK_LOG said PR pending for merged PR #1, measured on GitHub\n- **Status:** Completed\n' >> docs/16-progress/TASK_LOG.md )
_ss_commit "$d"; _ss_expect "$d" pass "state-only correction with a reasoned **Kind:** → PASS"
d="$(_ss_base)"
( cd "$d" && printf '\n# 2026-10-04 — correction\n- **Kind:** state-correction — fix\n' >> docs/16-progress/TASK_LOG.md )
_ss_commit "$d"; _ss_expect "$d" block "state-only change with a too-short reason → BLOCK" "needs a reason of at least"

# ── the real repository satisfies the guard on its own PR range is proven by check 26 in CI.

# ── F) merged PR whose branch remains → failure signal (check 27)
_ss_mb() { # _ss_mb <desc> <want rc 0|1> <expected text> <state tsv> [claims rows] [evidence rows]
  local desc="$1" want="$2" why="$3" tsv="$4" crow="${5:-}" erow="${6:-}" d out rc
  d="$(_ss_base)"
  printf '%b' "$tsv" > "$d/state.tsv"
  printf '| Claim ID | Work Item | Owner | Branch | Scope | Started | Expires | Status | Notes |\n|---|---|---|---|---|---|---|---|---|\n%b' "$crow" > "$d/claims.md"
  printf '| الفرع | السبب |\n|---|---|\n%b' "$erow" > "$d/evid.md"
  out="$(cd "$d" && WASLA_MERGED_STATE_FILE="$d/state.tsv" WASLA_CLAIMS_FILE="$d/claims.md" WASLA_BRANCH_EVIDENCE_FILE="$d/evid.md" bash scripts/checks/validate-merged-branches.sh 2>&1)"; rc=$?
  if (( (rc != 0) == want )) && grep -qF -- "$why" <<<"$out"; then
    printf '  \033[32m✓\033[0m %-66s (rc=%s)\n' "$desc" "$rc"; ((PASS++))
  else
    printf '  \033[31m✗\033[0m %-66s expected rc≠0=%s «%s», got rc=%s\n' "$desc" "$want" "$why" "$rc"
    printf '%s\n' "$out" | sed 's/^/      /' | tail -6; ((FAIL++))
  fi
  rm -rf "$d"
}
_ss_mb "F: merged PR whose branch remains → FAIL" 1 "merged branch still exists: docs/x" 'docs/x\tyes\tabc\t610\tMERGED\tabc\n'
_ss_mb "F: same, but documented in BRANCH_EVIDENCE → PASS" 0 "merged-branch cleanup: PASS" 'docs/x\tyes\tabc\t610\tMERGED\tabc\n' '' '| docs/x | kept as evidence of the DR run |\n'
_ss_mb "F: branch deleted after merge → PASS" 0 "merged-branch cleanup: PASS" 'docs/x\tno\t\t610\tMERGED\tabc\n'
_ss_mb "F: branch has new commits after merge (live work) → PASS" 0 "merged-branch cleanup: PASS" 'docs/x\tyes\tdef\t610\tMERGED\tabc\n'
_ss_mb "F: Active claim for merged work → FAIL" 1 "CLM-0461 is still Active but its PR #610" 'docs/x\tno\t\t610\tMERGED\tabc\n' \
  '| CLM-0461 | M0-49 | @a | docs/x | docs/ | 2026-10-04 | 2026-10-05 | Active | wave 3 |\n'
_ss_mb "F: Active claim with a reopened PR still open → PASS" 0 "merged-branch cleanup: PASS" 'docs/x\tyes\tdef\t610\tMERGED\tabc\ndocs/x\tyes\tdef\t625\tOPEN\tdef\n' \
  '| CLM-0461 | M0-49 | @a | docs/x | docs/ | 2026-10-04 | 2026-10-05 | Active | wave 3 |\n'
d="$(_ss_base)"; out="$(cd "$d" && env -u WASLA_MERGED_STATE_FILE CI=true PATH=/usr/bin:/bin GH_TOKEN= bash -c 'command -v gh >/dev/null && exit 99; bash scripts/checks/validate-merged-branches.sh' 2>&1)"; rc=$?
if (( rc == 99 )); then printf '  \033[33m⊘\033[0m F: fail-closed in CI without gh — gh is on /usr/bin here, not measured\n'
elif (( rc != 0 )) && grep -qF "fail-closed in CI" <<<"$out"; then printf '  \033[32m✓\033[0m %-66s (rc=%s)\n' "F: unreadable platform in CI → FAIL (fail-closed)" "$rc"; ((PASS++))
else printf '  \033[31m✗\033[0m F: unreadable platform in CI must fail, got rc=%s\n' "$rc"; printf '%s\n' "$out" | tail -4; ((FAIL++)); fi
rm -rf "$d"

# ── work-claims containment accepts a claim closed in the same range, and only that (check 2 · §4-2)
_ss_wc() { # _ss_wc <dir> <want 0|1> <desc> <expected text>
  local d="$1" want="$2" desc="$3" why="$4" out rc
  out="$(cd "$d" && bash scripts/checks/validate-work-claims.sh main HEAD 2>&1)"; rc=$?
  if (( (rc != 0) == want )) && grep -qF -- "$why" <<<"$out"; then
    printf '  \033[32m✓\033[0m %-66s (rc=%s)\n' "$desc" "$rc"; ((PASS++))
  else
    printf '  \033[31m✗\033[0m %-66s expected rc≠0=%s «%s», got rc=%s\n' "$desc" "$want" "$why" "$rc"
    printf '%s\n' "$out" | sed 's/^/      /' | tail -6; ((FAIL++))
  fi
  rm -rf "$d"
}
d="$(_ss_base)"; _ss_code "$d"; _ss_test "$d"; _ss_state "$d" Released Completed; _ss_commit "$d"
_ss_wc "$d" 0 "check 2: claim closed (Released) in the same PR covers its scope → PASS" "مُقفَلٌ في هذا النطاق"
d="$(_ss_base)"
( cd "$d" && printf '| CLM-9001 | M9-01 | @a | %s | services/demo/ | 2026-10-01 | 2026-10-02 | Released | an earlier PR on this branch, already released |\n' "$SS_BR" >> docs/16-progress/WORK_CLAIMS.md \
  && git commit -qam pre && git branch -f main HEAD ) >/dev/null 2>&1
_ss_code "$d"; _ss_commit "$d"
_ss_wc "$d" 1 "check 2: an old Released row does not cover new work → FAIL" "رفض"
