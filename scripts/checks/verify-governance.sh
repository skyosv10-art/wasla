#!/usr/bin/env bash
# verify-governance.sh — المدخل الموحّد لكل فحوص الحوكمة. أمر واحد يُشغّله البشري والوكيل وCI.
#
#   bash scripts/checks/verify-governance.sh              # يقارن origin/main..HEAD
#   bash scripts/checks/verify-governance.sh OLD NEW      # نطاق صريح (CI)
#   GOVERNANCE_LEDGER_ONLY=1 bash scripts/checks/verify-governance.sh   # سلامة السجلات فقط، بلا git
#
# المرجع: docs/16-progress/README.md · docs/00-rules/WORK_CLAIM_RULE.md
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

OLD="${1:-origin/main}"
NEW="${2:-HEAD}"
LEDGER_ONLY="${GOVERNANCE_LEDGER_ONLY:-0}"

BOLD=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'

FAILED=()
PASSED=()
SKIPPED=()

hdr() { printf '\n%s──── %s ────%s\n' "$DIM" "$1" "$RST"; }

run_check() { # run_check <اسم> <أمر...>
  local name="$1"; shift
  hdr "$name"
  if "$@"; then
    PASSED+=("$name")
  else
    FAILED+=("$name")
  fi
}

printf '%s╔══════════════════════════════════════════════════════════╗%s\n' "$BOLD" "$RST"
printf '%s║  فحص حوكمة WASLA — بوابة واحدة لكل الفحوص                ║%s\n' "$BOLD" "$RST"
printf '%s╚══════════════════════════════════════════════════════════╝%s\n' "$BOLD" "$RST"

# ── 0) وجود الوثائق الحاكمة ─────────────────────────────────────────────
hdr "0) وجود الوثائق الحاكمة"
REQUIRED_DOCS=(
  "docs/16-progress/README.md"
  "docs/16-progress/LAUNCH_TO_100_ROADMAP.md"
  "docs/16-progress/LAUNCH_EXECUTION_BOARD.md"
  "docs/16-progress/ROADMAP_OPERATING_PROTOCOL.md"
  "docs/16-progress/WORK_CLAIMS.md"
  "docs/16-progress/WORK_INDEX.md"
  "docs/16-progress/TASK_LOG.md"
  "docs/00-rules/WORK_CLAIM_RULE.md"
  "docs/00-rules/PUSH_DOCUMENTATION_RULE.md"
  "docs/00-rules/DEFINITION_OF_DONE.md"
)
MISSING_DOCS=()
for d in "${REQUIRED_DOCS[@]}"; do
  if [[ -f "$d" ]]; then printf '  %s✓%s %s\n' "$GRN" "$RST" "$d"
  else printf '  %s✗%s %s\n' "$RED" "$RST" "$d"; MISSING_DOCS+=("$d"); fi
done
if (( ${#MISSING_DOCS[@]} )); then FAILED+=("وجود الوثائق الحاكمة"); else PASSED+=("وجود الوثائق الحاكمة"); fi

# ── 1) بنية اللوحة ──────────────────────────────────────────────────────
run_check "1) بنية لوحة التنفيذ" \
  bash scripts/checks/validate-launch-board.sh docs/16-progress/LAUNCH_EXECUTION_BOARD.md

# ── 2) حجوزات العمل ─────────────────────────────────────────────────────
IN_GIT=0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && IN_GIT=1

if (( IN_GIT )) && [[ "$LEDGER_ONLY" != "1" ]] && git rev-parse --verify "${OLD}^{commit}" >/dev/null 2>&1; then
  run_check "2) حجوزات العمل (سجل + ملفات مُعدّلة)" \
    bash scripts/checks/validate-work-claims.sh "$OLD" "$NEW"
else
  run_check "2) حجوزات العمل (سلامة السجل فقط)" \
    bash scripts/checks/validate-work-claims.sh
fi

# ── 3) قاعدة التوثيق مع الدفع ───────────────────────────────────────────
if (( IN_GIT )) && [[ "$LEDGER_ONLY" != "1" ]]; then
  if git rev-parse --verify "${OLD}^{commit}" >/dev/null 2>&1; then
    run_check "3) قاعدة التوثيق مع الدفع" \
      bash scripts/checks/require-doc-update.sh "$OLD" "$NEW"
  else
    hdr "3) قاعدة التوثيق مع الدفع"
    printf '  %s⊘ تخطٍّ:%s تعذّر حل «%s». نفّذ: git fetch origin main\n' "$YLW" "$RST" "$OLD"
    SKIPPED+=("3) قاعدة التوثيق مع الدفع — مرجع غير قابل للحل")
  fi
else
  hdr "3) قاعدة التوثيق مع الدفع"
  printf '  %s⊘ تخطٍّ:%s لا مستودع git، أو وضع «السجلات فقط».\n' "$YLW" "$RST"
  SKIPPED+=("3) قاعدة التوثيق مع الدفع — لا سياق git")
fi

# ── 4) الأسرار ──────────────────────────────────────────────────────────
if [[ -f scripts/checks/scan-secrets.sh ]]; then
  run_check "4) فحص الأسرار" bash scripts/checks/scan-secrets.sh
else
  SKIPPED+=("4) فحص الأسرار — السكربت غير موجود")
fi

# ── الخلاصة ─────────────────────────────────────────────────────────────
printf '\n%s╔══════════════════════════════════════════════════════════╗%s\n' "$BOLD" "$RST"
printf '%s║  الخلاصة                                                  ║%s\n' "$BOLD" "$RST"
printf '%s╚══════════════════════════════════════════════════════════╝%s\n' "$BOLD" "$RST"

for p in "${PASSED[@]:-}";  do [[ -n "$p" ]] && printf '  %s✓ نجح%s   %s\n' "$GRN" "$RST" "$p"; done
for s in "${SKIPPED[@]:-}"; do [[ -n "$s" ]] && printf '  %s⊘ تخطٍّ%s  %s\n' "$YLW" "$RST" "$s"; done
for f in "${FAILED[@]:-}";  do [[ -n "$f" ]] && printf '  %s✗ فشل%s   %s\n' "$RED" "$RST" "$f"; done

if (( ${#FAILED[@]} )); then
  printf '\n%s✗ الحوكمة: %d فحص فاشل. الدفع مرفوض.%s\n' "$RED" "${#FAILED[@]}" "$RST"
  printf '  اقرأ: docs/16-progress/README.md · docs/00-rules/WORK_CLAIM_RULE.md\n\n'
  exit 1
fi

printf '\n%s✓ الحوكمة: كل الفحوص المُنفَّذة نجحت.%s\n' "$GRN" "$RST"
if (( ${#SKIPPED[@]} )); then
  printf '  %sتنبيه: %d فحص تُخطّي — النجاح جزئي لا كامل.%s\n' "$YLW" "${#SKIPPED[@]}" "$RST"
fi
printf '\n'
