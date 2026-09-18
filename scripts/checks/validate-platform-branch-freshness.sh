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
# يتطلَّبُ ``gh`` متاحاً ومُصادَقاً. بلا شبكةٍ أو بلا ``gh``: تخطٍّ مُعلَنٌ
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
# نقرأُ أسماءَ الفروعِ من الحجوزاتِ النشطةِ في ``WORK_CLAIMS.md``.
CLAIMS_BRANCHES=$(python3 -c "
import re, sys
with open('docs/16-progress/WORK_CLAIMS.md') as f:
    content = f.read()
# ابحث عن قسمِ الحجوزاتِ النشطةِ (§2) حتى §3
active_match = re.search(r'## 2\..*?(?=\n## 3\.)', content, re.DOTALL)
if not active_match:
    sys.exit(0)
active = active_match.group(0)
for line in active.split('\n'):
    if line.strip().startswith('|') and not line.strip().startswith('|---'):
        parts = [p.strip() for p in line.split('|')]
        if len(parts) >= 8:
            branch = parts[4]  # عمودُ الفرعِ
            status = parts[7]  # عمودُ الحالةِ
            # فقط الحجوزاتُ النشطةُ — لا المُحرَّرة
            if branch and status == 'Active':
                print(branch)
" 2>/dev/null | sort -u)

# ── 4) قراءةُ الفروعِ من المنصّةِ ─────────────────────────────────────────────
# نستخدمُ ``gh`` لقراءةِ الفروعِ. بلا ``gh`` أو شبكةٍ: تخطٍّ مُعلَنٌ.
# 
# متغيّرُ البيئةِ ``WASLA_BRANCHES_FILE`` يُتيحُ قراءةَ الفروعِ من ملفٍ بدلاً من
# GitHub API — لاستعمالِهِ في حالاتِ الطفرةِ في ``/tmp``.
if [[ -n "${WASLA_BRANCHES_FILE:-}" && -f "$WASLA_BRANCHES_FILE" ]]; then
  BRANCHES_JSON="$(cat "$WASLA_BRANCHES_FILE")"
else
  if ! command -v gh &>/dev/null; then
    skip "``gh`` غيرُ متاحٍ — تخطّيٌ مُعلَنٌ (لا مرورَ صامتَ)"
    if (( FAIL )); then
      printf '\n%s✗ حارسُ نضارةِ الفروعِ: إخفاقٌ.%s\n' "$RED" "$RST"
      exit 1
    fi
    printf '\n%s✓ حارسُ نضارةِ الفروعِ: نجاحٌ (بتخطٍّ مُعلَنٍ).%s\n' "$GRN" "$RST"
    exit 0
  fi

  # نقرأُ الفروعَ من المنصّةِ.
  BRANCHES_JSON=$(gh api repos/skyosv10-art/wasla/branches --paginate --jq '.[].name' 2>/dev/null)
  if [[ $? -ne 0 || -z "$BRANCHES_JSON" ]]; then
    skip "تعذّرَ قراءةُ الفروعِ من المنصّةِ — تخطّيٌ مُعلَنٌ (لا مرورَ صامتَ)"
    if (( FAIL )); then
      printf '\n%s✗ حارسُ نضارةِ الفروعِ: إخفاقٌ.%s\n' "$RED" "$RST"
      exit 1
    fi
    printf '\n%s✓ حارسُ نضارةِ الفروعِ: نجاحٌ (بتخطٍّ مُعلَنٍ).%s\n' "$GRN" "$RST"
    exit 0
  fi
fi

# ── 5) قراءةُ طلباتِ الدمجِ المفتوحةِ ─────────────────────────────────────────
OPEN_PR_HEADS=$(gh pr list --state open --json headRefName --jq '.[].headRefName' 2>/dev/null | sort -u)

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
