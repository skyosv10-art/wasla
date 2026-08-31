#!/usr/bin/env bash
# verify.sh — الأمرُ الموحَّد: كلُّ ما يُسقِط الدفعَ في مدخلٍ واحدٍ + أرتفاكت. (M0-04)
#
#   pnpm verify                       # أو: bash scripts/verify.sh
#   VERIFY_SKIP_NODE=1 bash scripts/verify.sh    # بلا typecheck/test (سريعٌ)
#   bash scripts/verify.sh OLD NEW    # يُمرَّر نطاقُ git إلى البوّابة (CI)
#
# ── المبدأ ──────────────────────────────────────────────────────────────
# ثلاثةُ مخارجَ لا مخرجانِ لكلِّ فحصٍ: **نجح · أخفق · تُخطّي بوسمٍ صريح**.
# والتخطّي لا يُجمَّل نجاحاً في الخلاصةِ ولا في الأرتفاكت — فبيئةٌ بلا
# اعتمادياتٍ لا تستطيع `typecheck`، وادّعاءُ نجاحِه كذبٌ ينفع مرَّةً ويضرُّ دائماً.
# والخروجُ ≠ 0 إن أخفقَ فحصٌ واحدٌ، و0 إن لم يُخفِق شيءٌ ولو تُخطّي بعضُه.
#
# المرجع: docs/00-rules/VERIFY_COMMAND.md · M0-04

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT" || exit 1

OLD="${1:-}"
NEW="${2:-}"
SKIP_NODE="${VERIFY_SKIP_NODE:-0}"
OUT_DIR="${VERIFY_OUT_DIR:-artifacts/verify}"

BOLD=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'

NAMES=(); STATUSES=(); CODES=()

record() { NAMES+=("$1"); STATUSES+=("$2"); CODES+=("$3"); }

run_step() { # run_step <اسم> <أمر...>
  local name="$1"; shift
  printf '\n%s── %s%s\n' "$BOLD" "$name" "$RST"
  if "$@"; then
    record "$name" passed 0
  else
    local rc=$?
    printf '%s  ✗ أخفق: %s (رمزُ %s)%s\n' "$RED" "$name" "$rc" "$RST"
    record "$name" failed "$rc"
  fi
}

skip_step() { # skip_step <اسم> <سبب>
  printf '\n%s── %s%s\n' "$BOLD" "$1" "$RST"
  printf '%s  ⊘ تُخطّي: %s%s\n' "$YLW" "$2" "$RST"
  record "$1" skipped 0
}

printf '%s╔══════════════════════════════════════════════════════════╗%s\n' "$BOLD" "$RST"
printf '%s║  التحقّقُ الموحَّد — WASLA (M0-04)                          ║%s\n' "$BOLD" "$RST"
printf '%s╚══════════════════════════════════════════════════════════╝%s\n' "$BOLD" "$RST"

# ── 1) بنيةُ المستودعِ والوثائقُ الحاكمة ──────────────────────────────────
run_step "بنيةُ المستودعِ والوثائقُ الحاكمة" \
  bash scripts/checks/validate-repo-structure.sh

# ── 2) اتّساقُ إعدادِ CI («مانعٌ لا مُجمِّل») ───────────────────────────────
run_step "اتّساقُ إعدادِ CI (مانعٌ لا مُجمِّل)" \
  bash scripts/checks/validate-ci-mandatory.sh

# ── 3) بوّابةُ الحوكمةِ (اثنا عشرَ فحصاً) ────────────────────────────────────
if [[ -n "$OLD" && -n "$NEW" ]]; then
  run_step "بوّابةُ الحوكمة (12 فحصاً)" bash scripts/checks/verify-governance.sh "$OLD" "$NEW"
else
  run_step "بوّابةُ الحوكمة (12 فحصاً)" bash scripts/checks/verify-governance.sh
fi

# ── 4) إثباتُ أنّ الحوكمةَ ترفض فعلاً ────────────────────────────────────
run_step "حزمةُ اختبارِ الحوكمة (ترفض فعلاً لا شكلاً)" \
  bash scripts/checks/test-governance.sh

# ── 5) الأنواعُ والاختبارات ───────────────────────────────────────────────
# تحتاج اعتمادياتٍ مثبَّتةً؛ وبلا `pnpm` أو بلا `node_modules` **يُعلَن التخطّي**.
if [[ "$SKIP_NODE" == "1" ]]; then
  skip_step "الأنواعُ (pnpm -r typecheck)" "VERIFY_SKIP_NODE=1 بطلبٍ صريح"
  skip_step "الاختبارات (pnpm -r test)" "VERIFY_SKIP_NODE=1 بطلبٍ صريح"
elif ! command -v pnpm >/dev/null 2>&1; then
  skip_step "الأنواعُ (pnpm -r typecheck)" "pnpm غيرُ متوفّرٍ في هذه البيئة"
  skip_step "الاختبارات (pnpm -r test)" "pnpm غيرُ متوفّرٍ في هذه البيئة"
elif [[ ! -d node_modules ]]; then
  skip_step "الأنواعُ (pnpm -r typecheck)" "الاعتمادياتُ غيرُ مثبَّتةٍ (لا node_modules)"
  skip_step "الاختبارات (pnpm -r test)" "الاعتمادياتُ غيرُ مثبَّتةٍ (لا node_modules)"
else
  run_step "الأنواعُ (pnpm -r typecheck)" pnpm -r typecheck
  run_step "الاختبارات (pnpm -r test)" pnpm -r test
fi

# ── الأرتفاكت ────────────────────────────────────────────────────────────
mkdir -p "$OUT_DIR"
SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
BRANCH="${CI_COMMIT_REF_NAME:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

N_FAIL=0; N_SKIP=0; N_PASS=0
for s in "${STATUSES[@]}"; do
  case "$s" in failed) ((N_FAIL++));; skipped) ((N_SKIP++));; passed) ((N_PASS++));; esac
done
OVERALL=passed; ((N_FAIL)) && OVERALL=failed

{
  printf 'تقريرُ التحقّقِ الموحَّد — WASLA\n'
  printf 'التاريخ (UTC): %s\nالالتزام: %s\nالفرع: %s\n\n' "$STAMP" "$SHA" "$BRANCH"
  for i in "${!NAMES[@]}"; do
    case "${STATUSES[$i]}" in
      passed)  printf '  [نجح ]  %s\n' "${NAMES[$i]}";;
      failed)  printf '  [أخفق]  %s  (رمزُ %s)\n' "${NAMES[$i]}" "${CODES[$i]}";;
      skipped) printf '  [تخطٍّ]  %s\n' "${NAMES[$i]}";;
    esac
  done
  printf '\nالخلاصة: %s — نجح %d · أخفق %d · تُخطّي %d\n' "$OVERALL" "$N_PASS" "$N_FAIL" "$N_SKIP"
  ((N_SKIP)) && printf 'تنبيه: التخطّي ليس نجاحاً — راجع docs/00-rules/VERIFY_COMMAND.md §6.\n'
} > "$OUT_DIR/verify-report.txt"

python3 - "$OUT_DIR/verify-report.json" "$STAMP" "$SHA" "$BRANCH" "$OVERALL" \
  "$(printf '%s\n' "${NAMES[@]}" | base64 -w0)" \
  "$(printf '%s\n' "${STATUSES[@]}" | base64 -w0)" \
  "$(printf '%s\n' "${CODES[@]}" | base64 -w0)" <<'PY'
import base64, json, sys
out, stamp, sha, branch, overall, b_names, b_stat, b_codes = sys.argv[1:9]
dec = lambda b: base64.b64decode(b).decode("utf-8").splitlines()
names, stats, codes = dec(b_names), dec(b_stat), dec(b_codes)
doc = {
    "generated_at": stamp, "commit": sha, "branch": branch, "overall": overall,
    "checks": [{"name": n, "status": s, "exit_code": int(c)}
               for n, s, c in zip(names, stats, codes)],
    "reference": "docs/00-rules/VERIFY_COMMAND.md",
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY

# ── الخلاصة ──────────────────────────────────────────────────────────────
printf '\n%s╔══════════════════════════════════════════════════════════╗%s\n' "$BOLD" "$RST"
printf '%s║  الخلاصة                                                  ║%s\n' "$BOLD" "$RST"
printf '%s╚══════════════════════════════════════════════════════════╝%s\n' "$BOLD" "$RST"
for i in "${!NAMES[@]}"; do
  case "${STATUSES[$i]}" in
    passed)  printf '  %s✓ نجح%s   %s\n' "$GRN" "$RST" "${NAMES[$i]}";;
    failed)  printf '  %s✗ أخفق%s  %s (رمزُ %s)\n' "$RED" "$RST" "${NAMES[$i]}" "${CODES[$i]}";;
    skipped) printf '  %s⊘ تخطٍّ%s  %s\n' "$YLW" "$RST" "${NAMES[$i]}";;
  esac
done
printf '\n%sالأرتفاكت:%s %s/verify-report.txt · %s/verify-report.json\n' \
  "$DIM" "$RST" "$OUT_DIR" "$OUT_DIR"

if ((N_FAIL)); then
  printf '\n%s✗ التحقّقُ الموحَّد: %d فحصاً أخفق.%s\n\n' "$RED" "$N_FAIL" "$RST"
  exit 1
fi
printf '\n%s✓ التحقّقُ الموحَّد: كلُّ الفحوصِ المُنفَّذةِ نجحت.%s\n' "$GRN" "$RST"
((N_SKIP)) && printf '  %sتنبيه: %d فحصاً تُخطّي — النجاحُ جزئيٌّ لا كامل.%s\n' "$YLW" "$N_SKIP" "$RST"
printf '\n'
exit 0
