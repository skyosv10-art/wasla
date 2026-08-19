#!/usr/bin/env bash
# require-doc-update.sh — فحص القاعدة الملزمة: كل دفع يمس الكود يجب أن يرافقه تحديث توثيق.
#
# يُستخدم من مكانين:
#   1. scripts/hooks/pre-push      (إلزام محلي قبل الدفع)
#   2. .gitlab-ci.yml :: doc-coverage  (إلزام خادمي على كل Merge Request)
#
# الاستخدام:
#   require-doc-update.sh [OLD_SHA] [NEW_SHA]
#   - بدون وسائط: يقارن الفرع الحالي ضد origin/main.
#   - بوسيطين: يقارن النطاق OLD_SHA..NEW_SHA.
set -euo pipefail

CODE_PATHS='^apps/|^bots/|^services/|^packages/|^infra/|^scripts/'
DOC_PATHS='^docs/'

OLD="${1:-origin/main}"
NEW="${2:-HEAD}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "تخطّي الفحص: لسنا داخل مستودع git." >&2
  exit 0
fi

# التحقق من وجود النقطة المرجعية القديمة.
# سياسة fail-closed: إذا تعذّر حل القاعدة، نرفض الدفع بدل المقارنة ضد شجرة فارغة
# (التي قد تُسقط كل ملفات docs/ القديمة كـ"مغيّرة" فتسبب نجاحاً كاذباً).
if ! git rev-parse --verify "${OLD}^{commit}" >/dev/null 2>&1; then
  echo "خطأ: تعذّر حل النقطة المرجعية '$OLD'." >&2
  echo "       نفّذ: git fetch origin main  (أو حدّد قاعدة صحيحة)." >&2
  echo "       لا يمكن التحقق من قاعدة التوثيق → رفض (fail-closed)." >&2
  exit 1
fi

if ! git rev-parse --verify "${NEW}^{commit}" >/dev/null 2>&1; then
  NEW="HEAD"
fi

FILES="$(git diff --name-only "${OLD}..${NEW}" 2>/dev/null || true)"

if [ -z "$FILES" ]; then
  echo "OK: لا توجد تغييرات في النطاق المحدد."
  exit 0
fi

CODE_CHANGES="$(printf '%s\n' "$FILES" | grep -E "$CODE_PATHS" || true)"
DOC_CHANGES="$(printf '%s\n' "$FILES" | grep -E "$DOC_PATHS" || true)"

if [ -z "$CODE_CHANGES" ]; then
  echo "OK: التغييرات لا تمس مسارات الكود (توثيق/إعداد فقط)."
  exit 0
fi

if [ -n "$DOC_CHANGES" ]; then
  echo "OK: تم تحديث التوثيق مع تغييرات الكود."
  exit 0
fi

cat >&2 <<'MSG'
==================================================================
خطأ: قاعدة التوثيق مع الدفع غير محققة (PUSH_DOCUMENTATION_RULE).
==================================================================
عدّلت ملفات ضمن مسارات الكود:
  apps/ bots/ services/ packages/ infra/ scripts/

لكنك لم تُعدّل أي ملف ضمن docs/.
القاعدة الملزمة: كل دفع يمس الكود يجب أن يرافقه تحديث توثيق ضمن docs/
(الحد الأدنى: إضافة إدخال في docs/16-progress/TASK_LOG.md يصف ما فعلته ولماذا).

الحل:
  1. أضف/عدّل ملفاً ضمن docs/ يوثّق التغيير (يُفضّل TASK_LOG.md).
  2. أعد الدفع.

المرجع: docs/00-rules/PUSH_DOCUMENTATION_RULE.md
==================================================================
MSG
exit 1
