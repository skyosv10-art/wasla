#!/usr/bin/env bash
# validate-launch-board.sh — يتحقق من بنية لوحة تنفيذ الإطلاق وقواعد الدليل.
set -euo pipefail

BOARD="${1:-docs/16-progress/LAUNCH_EXECUTION_BOARD.md}"
if [ ! -f "$BOARD" ]; then
  echo "خطأ: لوحة التنفيذ غير موجودة: $BOARD" >&2
  exit 1
fi

required=(
  '# لوحة تنفيذ الإطلاق إلى 100%'
  '## حالة الإصدار'
  '## سجل عناصر التنفيذ'
  '| ID | عنصر العمل |'
)
for token in "${required[@]}"; do
  if ! grep -Fq "$token" "$BOARD"; then
    echo "خطأ: اللوحة تفتقد النص الإلزامي: $token" >&2
    exit 1
  fi
done

allowed='Not Started|In Progress|Blocked|Ready for Gate|Completed|Cancelled'
rows="$(grep -E '^\| M[0-9]+-[0-9A-Za-z]+ \|' "$BOARD" || true)"
if [ -z "$rows" ]; then
  echo 'خطأ: لا توجد عناصر عمل Mx-yy قابلة للتحقق في اللوحة.' >&2
  exit 1
fi

invalid="$(printf '%s\n' "$rows" | awk -F'|' -v allowed="$allowed" '
  {
    status=$6; gsub(/^ +| +$/, "", status)
    if (status !~ "^(" allowed ")$") print $0
  }
')"
if [ -n "$invalid" ]; then
  echo 'خطأ: توجد حالة غير معتمدة في لوحة التنفيذ:' >&2
  printf '%s\n' "$invalid" >&2
  exit 1
fi

completed_without_evidence="$(printf '%s\n' "$rows" | awk -F'|' '
  {
    status=$6; evidence=$7
    gsub(/^ +| +$/, "", status); gsub(/^ +| +$/, "", evidence)
    lower = tolower(evidence)
    if (status == "Completed" && (evidence == "" || evidence == "—" || lower ~ /pending/ || evidence ~ /قيد/ || evidence ~ /مطلوب/)) print $0
  }
')"
if [ -n "$completed_without_evidence" ]; then
  echo 'خطأ: عنصر Completed بلا دليل إغلاق صالح:' >&2
  printf '%s\n' "$completed_without_evidence" >&2
  exit 1
fi

# كل ID يجب أن يظهر مرة واحدة فقط لمنع وجود حقيقتين للحالة نفسها.
duplicates="$(printf '%s\n' "$rows" | awk -F'|' '{id=$2; gsub(/^ +| +$/, "", id); count[id]++} END {for (id in count) if (count[id]>1) print id}')"
if [ -n "$duplicates" ]; then
  echo 'خطأ: IDs مكررة في لوحة التنفيذ:' >&2
  printf '%s\n' "$duplicates" >&2
  exit 1
fi

echo "OK: لوحة التنفيذ سليمة ($(printf '%s\n' "$rows" | wc -l | tr -d ' ') عنصر/عناصر)."



# تحقق من أن Work Item(s) في TASK_LOG مرجعة إلى IDs موجودة في اللوحة.
TASK_LOG="docs/16-progress/TASK_LOG.md"
if [ -f "$TASK_LOG" ]; then
  board_ids="$(printf '%s\n' "$rows" | awk -F'|' '{id=$2; gsub(/^ +| +$/, "", id); print id}' | sort -u)"
  logged_ids="$(grep -E '^- \*\*Work Item\(s\):\*\* ' "$TASK_LOG" 2>/dev/null | sed -E 's/.*\*\*Work Item\(s\):\*\* ([^ ]+).*/\1/' | grep -Ev '^Mx-yy$' | sort -u || true)"
  # لا أنبوبَ قبل `grep -Fxq`: تحت `set -o pipefail` يخرج `grep -q` عند أوّلِ تطابقٍ
  # فيُغلقُ الأنبوب، فيموتُ `printf` بـSIGPIPE، فتصيرُ حالةُ الأنبوبِ 141 ويقرأها الشرطُ
  # «لا تطابق» — فيُرفَض معرِّفٌ موجودٌ على اللوحة. العيبُ احتماليٌّ (يعتمد على سبقِ
  # `printf` لخروجِ `grep`) فيظهر رفضاً عشوائيّاً لعملٍ صحيح، وهو أسوأُ من فشلٍ ثابت.
  # مُثبَتٌ تجريبيّاً: 66 نتيجةً خاطئةً من 300 على قائمةٍ كبيرة، و0 من 300 بعد العلاج.
  bad_log="$(while read -r id; do [ -z "$id" ] && continue; grep -Fxq "$id" <<< "$board_ids" || echo "$id"; done <<< "$logged_ids")"
  if [ -n "$bad_log" ]; then
    echo 'خطأ: TASK_LOG يحتوي Work Item غير موجود في لوحة التنفيذ:' >&2
    printf '%s\n' "$bad_log" >&2
    exit 1
  fi
fi

echo 'OK: Work Item references في TASK_LOG تطابق IDs اللوحة.'
