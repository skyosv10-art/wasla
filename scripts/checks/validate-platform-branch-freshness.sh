#!/usr/bin/env bash
# validate-platform-branch-freshness.sh — حارسُ نضارةِ الفروعِ على المنصّةِ (M0-44 · الفحصُ 23).
#
# السّؤالُ الذي يجيبُ عنهُ هذا الفحصُ واحدٌ ومحدودٌ:
#
#   هل كلُّ فرعٍ على المنصّةِ (غيرِ ``main``) إمّا:
#     (أ) له حجزٌ نشطٌ في ``WORK_CLAIMS.md``، أو
#     (ب) له طلبُ دمجٍ مفتوحٌ، أو
#     (ج) مُعلَنٌ كدليلٍ محفوظٍ في ``BRANCH_EVIDENCE.md`` بسببٍ مكتوبٍ؟
#
# وليسَ السّؤالُ «هل الفروعُ محدّثةٌ؟» — فالفروعُ المتباعدةُ قد تكونُ أدلّةً
# مقصودةً (فروعُ ``probe/*``). والحارسُ يمنعُ صنفاً واحداً: فرعٌ بلا حجزٍ ولا
# PR مفتوحٍ ولا إعلانِ دليلٍ — أيُّ فرعٍ غيرِ مُملوكٍ وغيرِ مُعلَنٍ.
#
# ولِمَ لا يكفي الفحصُ 4 (بياتُ الحجوزاتِ): ذاكَ يقيسُ **الحجوزاتِ** ويتحقَّقُ
# من أنَّ فرعَها موجودٌ. وهذا الحارسُ يقيسُ **الفروعَ** ويتحقَّقُ من أنَّ كلَّ
# فرعٍ مملوكٌ أو مُعلَنٌ. والاتّجاهانِ مختلفانِ: الفحصُ 4 يبدأُ من الحجزِ
# ويسألُ عنِ الفرعِ، وهذا يبدأُ من الفرعِ ويسألُ عنِ الملكيّةِ.
#
# المرجع: docs/07-security/RISK_REGISTER.md (RISK-0045).
#
#   bash scripts/checks/validate-platform-branch-freshness.sh
#
# يتطلَّبُ ``gh`` متاحاً ومُصادَقاً. في CI: تعذُّرُ القراءةِ إخفاقٌ (CLM-0392).
# خارجَ CI بلا شبكةٍ أو بلا ``gh``: تخطٍّ مُعلَنٌ
# لا مرورٌ صامتٌ — فالحارسُ الذي يمرُّ بلا شبكةٍ أخطرُ من غيابِه.
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RST=$'\033[0m'

ok()  { printf '  %s✓%s %s\n' "$GRN" "$RST" "$1"; }
bad() { printf '  %s✗%s %s\n' "$RED" "$RST" "$1"; FAIL=1; }
skip() { printf '  %s⊘%s %s\n' "$YLW" "$RST" "$1"; SKIP=1; }

FAIL=0
SKIP=0

# ── 1) وجودُ قارئِ الأدلّةِ ─────────────────────────────────────────────────
# الحارسُ يعتمدُ على ``BRANCH_EVIDENCE.md`` لقراءةِ الفروعِ المُعلَنةِ كأدلّةٍ.
EVIDENCE_FILE=docs/16-progress/BRANCH_EVIDENCE.md
if [[ ! -f "$EVIDENCE_FILE" ]]; then
  bad "ملفُّ أدلّةِ الفروعِ مفقودٌ: $EVIDENCE_FILE"
  printf '\n%s✗ حارسُ نضارةِ الفروعِ: إخفاقٌ.%s\n' "$RED" "$RST"
  exit 1
fi
ok "ملفُّ أدلّةِ الفروعِ موجودٌ: $EVIDENCE_FILE"

# ── 2) قراءةُ الفروعِ المُعلَنةِ كأدلّةِ ─────────────────────────────────────
# الفروعُ في ``BRANCH_EVIDENCE.md`` بصيغةِ صفٍّ في جدولٍ: ``| branch-name | reason |``.
# نستخرجُ أسماءَ الفروعِ من الصفوفِ التي تبدأُ بـ``|`` وتحتوي على ``probe/`` أو
# أيِّ فرعٍ مُعلَنٍ.
EVIDENCE_BRANCHES=$(python3 -c "
import re, sys
with open('$EVIDENCE_FILE') as f:
    for line in f:
        m = re.match(r'^\|\s*([^|]+?)\s*\|', line)
        if m:
            name = m.group(1).strip()
            if name and not name.startswith('---') and name not in ('الفرع', 'Branch'):
                print(name)
" 2>/dev/null | sort -u)

# ── 3) قراءةُ الحجوزاتِ النشطةِ ───────────────────────────────────────────────
# (CLM-0392 · إصلاحُ عطبٍ مقيسٍ) كانَ هذا البابُ يقرأُ الحالةَ من ``parts[7]``
# وهوَ عمودُ **الانتهاءِ** (Expires) لا الحالةِ، فلا يطابقُ ``Active`` أبداً
# ولا يُعَدُّ أيُّ حجزٍ نشطٍ مالكاً لفرعِهِ. والإصلاحُ ليسَ نقلَ الفهرسِ إلى ``[8]``
# بل **حذفُ القارئِ الثاني**: السجلُّ الواحدُ يقرؤهُ قارئٌ واحدٌ
# (``lib/claims_rows.sh`` · M0-38) — وهوَ نفسُهُ ما يقرأُ بهِ الفحصُ 4.
# الحالةُ ``Active`` أو ``Paused`` مطابقةً تامّةً؛ والفرعُ هوَ العمودُ الرابعُ.
CLAIMS_FILE="${WASLA_CLAIMS_FILE:-docs/16-progress/WORK_CLAIMS.md}"
_ROWS_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/claims_rows.sh"
if [[ ! -r "$_ROWS_LIB" ]]; then
  bad "قارئُ صفوفِ الحجوزاتِ غيرُ موجودٍ: $_ROWS_LIB (fail-closed)"
  printf '\n%s✗ حارسُ نضارةِ الفروعِ: إخفاقٌ.%s\n' "$RED" "$RST"
  exit 1
fi
# shellcheck source=lib/claims_rows.sh
source "$_ROWS_LIB"
if [[ ! -f "$CLAIMS_FILE" ]]; then
  bad "سجلُّ الحجوزاتِ مفقودٌ: $CLAIMS_FILE"
  printf '\n%s✗ حارسُ نضارةِ الفروعِ: إخفاقٌ.%s\n' "$RED" "$RST"
  exit 1
fi
CLAIMS_BRANCHES=$(claims_active_rows "$CLAIMS_FILE" | cut -f4 | sed '/^$/d' | sort -u)

# ── 4) قراءةُ الفروعِ وطلباتِ الدمجِ من المنصّةِ ──────────────────────────────
# (CLM-0392 · إصلاحُ عطبٍ مقيسٍ) كانَ هذا البابُ يتخطّى «بإعلانٍ» ويخرجُ 0
# كلّما تعذّرتِ القراءةُ — ووظيفةُ CI لا تُمرِّرُ رمزاً لـ``gh`` فكانَ التخطّي
# **دائماً** في CI: حارسٌ لا يعضُّ أبداً في المكانِ الوحيدِ الذي يحكمُ.
# القاعدةُ الآنَ:
#   · في CI (``CI=true`` أو ``GITHUB_ACTIONS=true``): تعذُّرُ القراءةِ **إخفاقٌ**.
#   · خارجَ CI (جهازٌ محلّيٌّ بلا ``gh``/شبكةٍ): تخطٍّ مُعلَنٌ كما كانَ —
#     فالحكمُ لـCI لا للأخضرِ المحلّيِّ.
# الحقنُ للاختبارِ: ``WASLA_BRANCHES_FILE`` (الفروعُ) و``WASLA_PRS_FILE``
# (رؤوسُ PRs المفتوحةِ؛ غيابُهُ مع الحقنِ = لا PRs مفتوحةٌ). ولا يُنادى ``gh``
# في وضعِ الحقنِ أصلاً — فلا تتوقّفُ نتيجةُ الاختبارِ على الشبكةِ.
GH_BIN="${WASLA_GH_BIN:-gh}"
REPO_SLUG="${WASLA_REPO_SLUG:-skyosv10-art/wasla}"
IN_CI=0
[[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]] && IN_CI=1

_unreadable() {
  if (( IN_CI )); then
    bad "$1 — في CI تعذُّرُ القراءةِ إخفاقٌ لا تخطٍّ (fail-closed)"
    printf '\n%s✗ حارسُ نضارةِ الفروعِ: إخفاقٌ.%s\n' "$RED" "$RST"
    exit 1
  fi
  skip "$1 — تخطٍّ مُعلَنٌ خارجَ CI (لا مرورَ صامتَ؛ الحكمُ لـCI)"
  if (( FAIL )); then
    printf '\n%s✗ حارسُ نضارةِ الفروعِ: إخفاقٌ.%s\n' "$RED" "$RST"
    exit 1
  fi
  printf '\n%s✓ حارسُ نضارةِ الفروعِ: نجاحٌ (بتخطٍّ مُعلَنٍ).%s\n' "$GRN" "$RST"
  exit 0
}

if [[ -n "${WASLA_BRANCHES_FILE:-}" ]]; then
  [[ -f "$WASLA_BRANCHES_FILE" ]] || { bad "ملفُّ الفروعِ المحقونُ مفقودٌ: $WASLA_BRANCHES_FILE"; exit 1; }
  BRANCHES_JSON="$(cat "$WASLA_BRANCHES_FILE")"
  if [[ -n "${WASLA_PRS_FILE:-}" ]]; then
    [[ -f "$WASLA_PRS_FILE" ]] || { bad "ملفُّ PRs المحقونُ مفقودٌ: $WASLA_PRS_FILE"; exit 1; }
    OPEN_PR_HEADS="$(sort -u "$WASLA_PRS_FILE")"
  else
    OPEN_PR_HEADS=""
  fi
else
  command -v "$GH_BIN" &>/dev/null || _unreadable "\`gh\` غيرُ متاحٍ"
  if ! BRANCHES_JSON=$("$GH_BIN" api "repos/$REPO_SLUG/branches" --paginate --jq '.[].name' 2>/dev/null) \
     || [[ -z "$BRANCHES_JSON" ]]; then
    _unreadable "تعذّرَ قراءةُ الفروعِ من المنصّةِ"
  fi
  # ── 5) طلباتُ الدمجِ المفتوحةُ — تعذُّرُها كانَ يُبتلَعُ صامتاً؛ صارَ كتعذُّرِ الفروعِ.
  if ! OPEN_PR_HEADS=$("$GH_BIN" api "repos/$REPO_SLUG/pulls?state=open&per_page=100" --paginate --jq '.[].head.ref' 2>/dev/null); then
    _unreadable "تعذّرَ قراءةُ طلباتِ الدمجِ المفتوحةِ من المنصّةِ"
  fi
  OPEN_PR_HEADS="$(sort -u <<< "$OPEN_PR_HEADS")"
fi

# ── 6) التصنيفُ ────────────────────────────────────────────────────────────────
printf '\n  الفروعُ المُعلَنةُ كأدلّةٍ: %d\n' $(echo "$EVIDENCE_BRANCHES" | wc -l)
printf '  الفروعُ ذاتُ الحجوزاتِ النشطةِ: %d\n' $(echo "$CLAIMS_BRANCHES" | grep -c . 2>/dev/null || echo 0)
printf '  طلباتُ الدمجِ المفتوحةُ: %d\n' $(echo "$OPEN_PR_HEADS" | grep -c . 2>/dev/null || echo 0)
printf '  الفروعُ على المنصّةِ: %d\n\n' $(echo "$BRANCHES_JSON" | grep -c . 2>/dev/null || echo 0)

STALE_COUNT=0
TOTAL=0

while IFS= read -r branch; do
  [[ -z "$branch" || "$branch" == "main" ]] && continue
  ((TOTAL++))

  # هل له حجزٌ نشطٌ؟
  if grep -qxF "$branch" <<< "$CLAIMS_BRANCHES" 2>/dev/null; then
    continue
  fi

  # هل له طلبُ دمجٍ مفتوحٌ؟
  if grep -qxF "$branch" <<< "$OPEN_PR_HEADS" 2>/dev/null; then
    continue
  fi

  # هل هو مُعلَنٌ كدليلٍ؟
  if grep -qxF "$branch" <<< "$EVIDENCE_BRANCHES" 2>/dev/null; then
    continue
  fi

  # بائتٌ — لا حجزَ ولا PR ولا إعلانُ دليلٍ.
  bad "فرعٌ بائتٌ: $branch"
  ((STALE_COUNT++))
done <<< "$BRANCHES_JSON"

printf '\n  الفروعُ المُفحوصةُ: %d\n' "$TOTAL"
printf '  البائتةُ: %d\n' "$STALE_COUNT"

if (( STALE_COUNT > 0 )); then
  printf '\n  %s✗%s %d فرعٌ بائتٌ — لا حجزَ ولا PR ولا إعلانُ دليلٍ.\n' "$RED" "$RST" "$STALE_COUNT"
  printf '  اقرأ: %s · docs/16-progress/WORK_CLAIMS.md\n\n' "$EVIDENCE_FILE"
  exit 1
fi

ok "كلُّ الفروعِ مملوكةٌ أو مُعلَنةٌ — لا فروعَ بائتةَ"

if (( FAIL )); then
  printf '\n%s✗ حارسُ نضارةِ الفروعِ: إخفاقٌ.%s\n' "$RED" "$RST"
  exit 1
fi

printf '\n%s✓ حارسُ نضارةِ الفروعِ: نجاحٌ.%s\n' "$GRN" "$RST"
exit 0
