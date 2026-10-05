#!/usr/bin/env bash
# validate-merged-branches.sh — merge closes the cycle (check 27 · CLM-0467 · M0-52 · ADR-061).
#
# Cycle: PR merged → verify merge → delete merged branch → verify deletion.
# This check is the "verify" half on every PR and every push to main. It fails when:
#   (a) a branch whose PR is MERGED still exists on GitHub with no new commits after the merge,
#       and it has no written reason in docs/16-progress/BRANCH_EVIDENCE.md;
#   (b) a claim in WORK_CLAIMS.md is still `Active`/`Paused` while its branch's PR is MERGED and no
#       PR for it is open — merged work recorded as in progress (the stale state a new agent
#       would otherwise read as "not done").
#
# The "delete" half is the repository setting `delete_branch_on_merge` plus
# .github/workflows/merged-branch-cleanup.yml.
#
#   bash scripts/checks/validate-merged-branches.sh
# Needs authenticated `gh`. In CI, an unreadable platform is a failure (fail-closed). Outside CI with
# no `gh`/network the check prints PARTIAL and is counted as skipped, not passed.
# Tests inject the platform state: WASLA_MERGED_STATE_FILE with TSV rows
#   branch \t exists(yes|no) \t branch_sha \t pr_number \t pr_state(OPEN|CLOSED|MERGED) \t pr_head_sha
# Rule: docs/00-rules/STATE_SYNC_RULE.md §7.
set -uo pipefail
cd "$(dirname "$0")/../.." || { echo "cannot reach the repository root" >&2; exit 1; }

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RST=$'\033[0m'
CLAIMS="${WASLA_CLAIMS_FILE:-docs/16-progress/WORK_CLAIMS.md}"
EVID="${WASLA_BRANCH_EVIDENCE_FILE:-docs/16-progress/BRANCH_EVIDENCE.md}"
FAIL=0
bad() { printf '  %s✗%s %s\n' "$RED" "$RST" "$1"; FAIL=1; }
ok()  { printf '  %s✓%s %s\n' "$GRN" "$RST" "$1"; }

# shellcheck source=lib/claims_rows.sh
source scripts/checks/lib/claims_rows.sh
mapfile -t ACTIVE < <(claims_active_rows "$CLAIMS" | awk -F'\t' '{print $1"\t"$4}')
EVIDENCE_BRANCHES="$(awk -F'|' '/^\| *[A-Za-z0-9._\/-]+ *\|/ {b=$2; gsub(/^ +| +$/,"",b); if (b!="الفرع" && b!="---") print b}' "$EVID" 2>/dev/null)"

STATE="$(mktemp)"; trap 'rm -f "$STATE"' EXIT
if [[ -n "${WASLA_MERGED_STATE_FILE:-}" ]]; then
  [[ -f "$WASLA_MERGED_STATE_FILE" ]] || { bad "WASLA_MERGED_STATE_FILE is not a file (fail-closed)"; exit 1; }
  cp "$WASLA_MERGED_STATE_FILE" "$STATE"
else
  REPO="${GITHUB_REPOSITORY:-}"
  if [[ -z "$REPO" ]]; then
    REPO="$(git remote get-url origin 2>/dev/null | sed -E 's#\.git$##; s#^.*[:/]([^/:]+/[^/:]+)$#\1#')"
  fi
  read_fail() {
    if [[ "${CI:-}" == "true" ]]; then bad "cannot read the platform ($1) — fail-closed in CI"; exit 1; fi
    printf '  %s⊘ PARTIAL:%s cannot read the platform (%s); merged-branch state not measured.\n' "$YLW" "$RST" "$1"
    exit 0
  }
  command -v gh >/dev/null 2>&1 || read_fail "gh not installed"
  [[ -n "$REPO" ]] || read_fail "repository unknown"
  OWNER="${REPO%%/*}"
  BR="$(gh api "repos/$REPO/branches" --paginate --jq '.[]|[.name,.commit.sha]|@tsv' 2>/dev/null)" || read_fail "branches"
  declare -A SHA=()
  while IFS=$'\t' read -r n s; do [[ -n "$n" ]] && SHA[$n]="$s"; done <<< "$BR"
  declare -A SEEN=()
  for n in "${!SHA[@]}"; do SEEN[$n]=1; done
  for row in "${ACTIVE[@]}"; do b="${row#*$'\t'}"; [[ -n "$b" ]] && SEEN[$b]=1; done
  for b in "${!SEEN[@]}"; do
    [[ "$b" == "main" ]] && continue
    ex=no; [[ -n "${SHA[$b]:-}" ]] && ex=yes
    PRS="$(gh api "repos/$REPO/pulls?head=$OWNER:$b&state=all&per_page=100" \
      --jq '.[]|[(.number|tostring),(if .merged_at then "MERGED" elif .state=="open" then "OPEN" else "CLOSED" end),.head.sha]|@tsv' 2>/dev/null)" \
      || read_fail "pulls for $b"
    if [[ -z "$PRS" ]]; then printf '%s\t%s\t%s\t\t\t\n' "$b" "$ex" "${SHA[$b]:-}" >> "$STATE"; fi
    while IFS=$'\t' read -r num st hs; do
      [[ -n "$num" ]] && printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$b" "$ex" "${SHA[$b]:-}" "$num" "$st" "$hs" >> "$STATE"
    done <<< "$PRS"
  done
fi

# Empty fields become "-": `read` with IFS=$'\t' collapses consecutive tabs (tab is IFS whitespace),
# so a deleted branch (empty sha) would shift every later field and hide (b). Measured in the
# mutation cases, not assumed.
sed -i -e ':a' -e 's/\t\t/\t-\t/g' -e 'ta' -e 's/\t$/\t-/' "$STATE"

# ── (a) merged branch still present ──
declare -A OPEN=() MERGED=()
while IFS=$'\t' read -r b ex bsha num st hs; do
  [[ -n "$b" ]] || continue
  [[ "$st" == "OPEN" ]] && OPEN[$b]=1
  [[ "$st" == "MERGED" ]] && MERGED[$b]="${MERGED[$b]:-}#$num "
done < "$STATE"
LEFT=0
while IFS=$'\t' read -r b ex bsha num st hs; do
  [[ -n "$b" && "$st" == "MERGED" && "$ex" == "yes" ]] || continue
  [[ -n "${OPEN[$b]:-}" ]] && continue
  [[ "$bsha" == "$hs" ]] || continue            # new commits after the merge: live work, not residue
  if grep -qxF "$b" <<< "$EVIDENCE_BRANCHES"; then continue; fi
  bad "merged branch still exists: $b (PR #$num merged). Delete it, or record the reason in $EVID."
  LEFT=1
done < "$STATE"
(( LEFT )) || ok "no merged branch left behind without a documented reason."

# ── (b) Active claim whose PR is already merged ──
STALE=0
for row in "${ACTIVE[@]}"; do
  cid="${row%%$'\t'*}"; b="${row#*$'\t'}"
  [[ -n "${MERGED[$b]:-}" && -z "${OPEN[$b]:-}" ]] || continue
  bad "$cid is still Active but its PR ${MERGED[$b]% } is merged — main says 'in progress' for finished work. Close the claim (Released) with what was delivered."
  STALE=1
done
(( STALE )) || ok "no Active claim for already-merged work."

if (( FAIL )); then
  printf '%s✗ merged-branch cleanup: FAILED%s (docs/00-rules/STATE_SYNC_RULE.md §7)\n' "$RED" "$RST"
  exit 1
fi
printf '%s✓ merged-branch cleanup: PASS%s\n' "$GRN" "$RST"
