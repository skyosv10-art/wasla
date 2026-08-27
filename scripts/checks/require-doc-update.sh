#!/usr/bin/env bash
# require-doc-update.sh — قاعدة حاكمة: كل تغيير ذي معنى يحدّث سجل العمل ولوحة الإطلاق.
#
# الاستخدام: require-doc-update.sh [OLD_SHA] [NEW_SHA]
# بدون وسائط: يقارن origin/main مع HEAD. في CI يمرر نطاق MR صراحة.
set -euo pipefail

# مرشِّحُ الكودِ والإعداداتِ — **مصدرُه واحدٌ** في lib/meaningful-paths.sh (M0-15):
# كان مكتوباً هنا وفي validate-work-claims.sh حرفيّاً بلا حارسِ تطابقٍ، فانحرف فعلاً
# (`docs/` في أحدِهما لا في الآخر — عيبُ M0-14). الحارسُ يكشف الانحرافَ والمصدرُ
# الواحدُ يمنعه.
# shellcheck source=lib/meaningful-paths.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/meaningful-paths.sh"
# سجلات مشتركة يكتب فيها الجميع بحكم القاعدة: تعديلها وحدها ليس «تغييراً ذا معنى».
# WORK_CLAIMS.md مُدرَجة لأن حجز النطاق خطوة إلزامية تسبق أي كود، فلا يصح أن تُطالب بإدخال TASK_LOG قبل وجود عمل.
LEDGER_ONLY_PATHS='^docs/16-progress/(TASK_LOG\.md|LAUNCH_EXECUTION_BOARD\.md|MASTER_PROGRESS\.md|WORK_CLAIMS\.md|WORK_INDEX\.md)$'
TASK_LOG='docs/16-progress/TASK_LOG.md'
BOARD='docs/16-progress/LAUNCH_EXECUTION_BOARD.md'
OLD="${1:-origin/main}"
NEW="${2:-HEAD}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo 'تخطي الفحص: لسنا داخل مستودع git.' >&2
  exit 0
fi
if ! git rev-parse --verify "${OLD}^{commit}" >/dev/null 2>&1; then
  echo "خطأ: تعذر حل النقطة المرجعية '$OLD' — الرفض fail-closed." >&2
  exit 1
fi
if ! git rev-parse --verify "${NEW}^{commit}" >/dev/null 2>&1; then NEW='HEAD'; fi

FILES="$(git -c color.ui=false diff --name-only "${OLD}..${NEW}" 2>/dev/null || true)"
if [ -z "$FILES" ]; then
  echo 'OK: لا توجد تغييرات في النطاق المحدد.'
  exit 0
fi

CODE_OR_CONFIG="$(printf '%s\n' "$FILES" | grep -E "$CODE_OR_CONFIG_PATHS" || true)"
NON_LEDGER_DOCS="$(printf '%s\n' "$FILES" | grep -E '^docs/' | grep -Ev "$LEDGER_ONLY_PATHS" || true)"
MEANINGFUL="$(printf '%s\n%s\n' "$CODE_OR_CONFIG" "$NON_LEDGER_DOCS" | sed '/^$/d' | sort -u)"
if [ -z "$MEANINGFUL" ]; then
  echo 'OK: التغيير محصور في سجلات التقدم أو metadata غير ذات معنى.'
  exit 0
fi

# لا أنبوبَ قبل `grep -Fxq` — نفسُ مصيدةِ SIGPIPE التي عولِجت في M0-11 أسفلَ هذا الملف
# وفي validate-launch-board.sh، وكانت **باقيةً هنا**: `grep -q` يخرج عند أوّلِ تطابقٍ
# فيُغلق الأنبوب، فيموتُ `printf` بـSIGPIPE، فتصير حالةُ الأنبوبِ 141 وتحت `pipefail`
# تُقرأ «لا تطابق» — فيُرفض عملٌ صحيحٌ يحمل تحديثَ السجلِّ واللوحةِ فعلاً.
# هنا `$FILES` صغيرٌ عادةً فالعيبُ **احتماليٌّ لا حتميّ**: يقع حين يسبق خروجُ grep
# فراغَ printf من الكتابة. رُصد في M0-12 كتقلّبٍ في حزمةِ الإثبات (24/25 ثمّ 25/25)،
# ويحرسه الآن «قاعدة التوثيق تقبل حالةً صحيحةً في 40 تشغيلاً بلا تقلّب».
missing=()
grep -Fxq "$TASK_LOG" <<< "$FILES" || missing+=("$TASK_LOG")
grep -Fxq "$BOARD" <<< "$FILES" || missing+=("$BOARD")
if [ "${#missing[@]}" -ne 0 ]; then
  cat >&2 <<MSG
==================================================================
خطأ: قاعدة خارطة الطريق مع كل دفع غير محققة.
==================================================================
توجد تغييرات ذات معنى في:
$(printf '  - %s\n' "$MEANINGFUL")

يجب أن يتغير في النطاق نفسه:
$(printf '  - %s\n' "${missing[@]}")

الحل:
  1. أضف إدخالاً جديداً في TASK_LOG يذكر Work Item(s) والاختبارات والدليل والخطوة التالية.
  2. حدّث صف/صفوف لوحة التنفيذ: الحالة أو الدليل أو العائق أو الخطوة التالية.
  3. شغّل scripts/checks/validate-launch-board.sh ثم أعد الدفع.

المرجع: docs/16-progress/ROADMAP_OPERATING_PROTOCOL.md
==================================================================
MSG
  exit 1
fi

# لا يكفي لمس السجل؛ يلزم إدخال يتضمن Work Item(s) في diff نفسه.
# لا يُستخدم أنبوب هنا: `grep -q` يُغلق الأنبوب عند أول تطابق فيتلقّى git إشارة SIGPIPE،
# و`set -o pipefail` يُحوّل ذلك إلى فشلٍ في الأنبوب كلّه — فيُرفض عملٌ صحيحٌ كلّما كبر الـdiff.
# TASK_LOG يتجاوز 650 KB، فهذا العيب يقع دائماً لا نادراً. الحل: التقاط الـdiff أوّلاً ثم البحث بلا أنبوب.
TASK_LOG_DIFF="$(git -c color.ui=false diff --unified=0 "${OLD}..${NEW}" -- "$TASK_LOG" 2>/dev/null || true)"
if ! grep -Eq '^\+.*\*\*Work Item\(s\):\*\* [A-Z][0-9A-Za-z-]+' <<< "$TASK_LOG_DIFF"; then
  echo 'خطأ: TASK_LOG لم يحو إدخالاً مضافاً بصيغة **Work Item(s):** <ID> في هذا النطاق.' >&2
  exit 1
fi

bash scripts/checks/validate-launch-board.sh "$BOARD"

# منع تكرار العمل بين جهتين: يجب أن يكون النطاق محجوزاً وغير متقاطع.
# المرجع: docs/00-rules/WORK_CLAIM_RULE.md
bash scripts/checks/validate-work-claims.sh "$OLD" "$NEW"

echo 'OK: سجل العمل ولوحة الإطلاق وحجز النطاق محدَّثة مع التغيير ذي المعنى.'
