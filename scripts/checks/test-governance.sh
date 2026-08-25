#!/usr/bin/env bash
# test-governance.sh — إثبات أن آلية منع التكرار تعمل فعلاً، لا وصفاً.
# ينسخ المستودع إلى /tmp، يُنشئ git حقيقياً، ويجرّب حالات الفشل والنجاح المتوقعة.
# لا يلمس المستودع الأصلي. يُشغَّل يدوياً وفي وظيفة governance-guard.
#
#   bash scripts/checks/test-governance.sh
#
# المرجع: docs/00-rules/WORK_CLAIM_RULE.md
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

T=/tmp/gov_proof
rm -rf "$T"; mkdir -p "$T"
cp -r "$REPO_ROOT/." "$T/" 2>/dev/null
cd "$T" || exit 1

git init -q -b main
git config user.email t@t.t; git config user.name t
# خطّ أساس نظيف: كل شيء ما عدا وثائق الحوكمة الجديدة
git add -A >/dev/null 2>&1
git commit -qm "baseline" >/dev/null 2>&1
git branch -f origin-main >/dev/null 2>&1
git update-ref refs/remotes/origin/main HEAD

PASS=0; FAIL=0
t() { # t <وصف> <متوقع: pass|fail> <أمر...>
  local desc="$1" expect="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  local got=pass; (( rc != 0 )) && got=fail
  if [[ "$got" == "$expect" ]]; then
    printf '  \033[32m✓\033[0m %-58s (كما هو متوقع: %s)\n' "$desc" "$expect"; ((PASS++))
  else
    printf '  \033[31m✗\033[0m %-58s متوقع %s وجاء %s\n' "$desc" "$expect" "$got"
    printf '%s\n' "$out" | sed 's/^/      /' | tail -12
    ((FAIL++))
  fi
}

printf '\n\033[1m═══ إثبات آلية منع تكرار العمل ═══\033[0m\n\n'

CL=docs/16-progress/WORK_CLAIMS.md
cp "$CL" /tmp/CL.orig

printf '\033[1m[أ] سلامة السجل\033[0m\n'
t "السجل الأصلي سليم" pass bash scripts/checks/validate-work-claims.sh

# حالة 1: حجزان لنفس عنصر العمل
python3 - <<'PY'
import io
p='docs/16-progress/WORK_CLAIMS.md'; s=io.open(p,encoding='utf-8').read()
row=[l for l in s.split('\n') if l.startswith('| CLM-0001')][0]
dup=row.replace('CLM-0001','CLM-9001',1).replace('@uxxxu','@other',1).replace('chore/unified-roadmap-governance','feat/other',1)
io.open(p,'w',encoding='utf-8').write(s.replace(row, row+'\n'+dup,1))
PY
t "يرفض حجزين لنفس عنصر العمل" fail bash scripts/checks/validate-work-claims.sh
cp /tmp/CL.orig "$CL"

# حالة 2: تقاطع نطاقات بين مالكين مختلفين
python3 - <<'PY'
import io
p='docs/16-progress/WORK_CLAIMS.md'; s=io.open(p,encoding='utf-8').read()
row=[l for l in s.split('\n') if l.startswith('| CLM-0001')][0]
new="| CLM-9002 | M5-12 | @other | feat/search | docs/16-progress/,services/search/ | 2026-08-25 | 2026-09-05 | Active |"
io.open(p,'w',encoding='utf-8').write(s.replace(row, row+'\n'+new,1))
PY
t "يرفض تقاطع نطاق بين مالكين مختلفين" fail bash scripts/checks/validate-work-claims.sh
cp /tmp/CL.orig "$CL"

# حالة 3: نطاق منفصل تماماً = مسموح (لا منع زائد)
python3 - <<'PY'
import io
p='docs/16-progress/WORK_CLAIMS.md'; s=io.open(p,encoding='utf-8').read()
row=[l for l in s.split('\n') if l.startswith('| CLM-0001')][0]
new="| CLM-9003 | M5-12 | @other | feat/search | services/search/ | 2026-08-25 | 2026-09-05 | Active |"
io.open(p,'w',encoding='utf-8').write(s.replace(row, row+'\n'+new,1))
PY
t "يسمح بنطاق منفصل تماماً (لا منع زائد)" pass bash scripts/checks/validate-work-claims.sh
cp /tmp/CL.orig "$CL"

# حالة 4: حجز منتهٍ
python3 - <<'PY'
import io
p='docs/16-progress/WORK_CLAIMS.md'; s=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8').write(s.replace('| 2026-08-25 | 2026-09-08 | Active |','| 2026-07-01 | 2026-07-10 | Active |',1))
PY
t "يرفض حجزاً منتهي المهلة" fail bash scripts/checks/validate-work-claims.sh
cp /tmp/CL.orig "$CL"

# حالة 5: مهلة تتجاوز 14 يوماً
python3 - <<'PY'
import io
p='docs/16-progress/WORK_CLAIMS.md'; s=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8').write(s.replace('| 2026-08-25 | 2026-09-08 | Active |','| 2026-08-25 | 2026-12-08 | Active |',1))
PY
t "يرفض مهلة تتجاوز 14 يوماً" fail bash scripts/checks/validate-work-claims.sh
cp /tmp/CL.orig "$CL"

# حالة 6: عنصر عمل غير موجود في اللوحة
python3 - <<'PY'
import io
p='docs/16-progress/WORK_CLAIMS.md'; s=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8').write(s.replace('| CLM-0001 | M0-05 |','| CLM-0001 | M9-99 |',1))
PY
t "يرفض عنصر عمل غير موجود في اللوحة" fail bash scripts/checks/validate-work-claims.sh
cp /tmp/CL.orig "$CL"

# حالة 7: مالك فارغ
python3 - <<'PY'
import io
p='docs/16-progress/WORK_CLAIMS.md'; s=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8').write(s.replace('| @uxxxu | chore/unified-roadmap-governance |','| — | chore/unified-roadmap-governance |',1))
PY
t "يرفض حجزاً بلا مالك" fail bash scripts/checks/validate-work-claims.sh
cp /tmp/CL.orig "$CL"

printf '\n\033[1m[ب] احتواء الملفات المُعدّلة داخل النطاق المحجوز (git حقيقي)\033[0m\n'

git checkout -q -b chore/unified-roadmap-governance

# ملف داخل النطاق المحجوز (docs/16-progress/)
echo "x" >> docs/16-progress/WORK_INDEX.md
git add -A >/dev/null; git commit -qm "in scope" >/dev/null
t "يسمح بتعديل داخل النطاق المحجوز" pass bash scripts/checks/validate-work-claims.sh origin/main HEAD

# ملف خارج النطاق المحجوز
mkdir -p services/search/src && echo "export const x = 1" > services/search/src/index.ts
git add -A >/dev/null; git commit -qm "out of scope" >/dev/null
t "يرفض تعديل ملف خارج النطاق المحجوز" fail bash scripts/checks/validate-work-claims.sh origin/main HEAD
git reset -q --hard HEAD~1

# فرع بلا حجز
git checkout -q -b feat/unclaimed-work
mkdir -p services/billing/src && echo "export const y = 1" > services/billing/src/index.ts
git add -A >/dev/null; git commit -qm "no claim" >/dev/null
t "يرفض الدفع من فرع بلا حجز نشط" fail bash scripts/checks/validate-work-claims.sh origin/main HEAD
git checkout -q chore/unified-roadmap-governance
git branch -qD feat/unclaimed-work >/dev/null 2>&1

printf '\n\033[1m[ج] قاعدة التوثيق مع الدفع\033[0m\n'
git checkout -q -b test/doc-rule
mkdir -p services/search/src && echo "export const z = 1" > services/search/src/index.ts
git add -A >/dev/null; git commit -qm "code without ledger" >/dev/null
t "يرفض كوداً بلا تحديث السجل واللوحة" fail bash scripts/checks/require-doc-update.sh origin/main HEAD
git checkout -q chore/unified-roadmap-governance
git branch -qD test/doc-rule >/dev/null 2>&1

# حارس انحدار: `grep -q` بعد أنبوب مع pipefail يتلقّى git إشارة SIGPIPE فيُرفض عملٌ صحيح.
# TASK_LOG يتجاوز 650 KB فالعيب يقع دائماً لا نادراً. هذه الحالة تُثبت أنّه لا يعود.
# يُنفَّذ على الفرع المحجوز نفسه، فقاعدة التوثيق تستدعي فحص الحجز أيضاً.
printf '\n### [2026-01-01] حالة اختبار\n\n- **Work Item(s):** M0-05\n- **Why:** حارس انحدار\n' >> docs/16-progress/TASK_LOG.md
printf '\n<!-- حالة اختبار -->\n' >> docs/16-progress/LAUNCH_EXECUTION_BOARD.md
echo '# حالة اختبار' >> scripts/checks/verify-governance.sh
git add -A >/dev/null; git commit -qm "valid entry with large diff" >/dev/null
t "يقبل إدخالاً صحيحاً مع diff كبير (حارس SIGPIPE)" pass bash scripts/checks/require-doc-update.sh origin/main HEAD
git reset -q --hard HEAD~1

printf '\n\033[1m[د] المدخل الموحّد\033[0m\n'
t "verify-governance يعمل في سياق git" pass bash scripts/checks/verify-governance.sh origin/main HEAD

printf '\n\033[1m═══ النتيجة: %d ناجح · %d فاشل ═══\033[0m\n\n' "$PASS" "$FAIL"
(( FAIL == 0 )) || exit 1
