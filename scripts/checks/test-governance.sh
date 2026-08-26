#!/usr/bin/env bash
# test-governance.sh — إثبات أن آلية منع التكرار تعمل فعلاً، لا وصفاً.
# ينسخ المستودع إلى /tmp، يُنشئ git حقيقياً، ويجرّب حالات الفشل والنجاح المتوقعة.
# لا يلمس المستودع الأصلي. يُشغَّل يدوياً وفي وظيفة governance-guard.
#
#   bash scripts/checks/test-governance.sh
#
# ── لماذا أُعيدت كتابة هذه الحزمة (M0-12) ────────────────────────────────
# كانت الحزمةُ تُشوِّه **صفّاً بعينِه بالاسم** (`CLM-0001`) وتعمل على **فرعٍ بعينِه**
# (`chore/unified-roadmap-governance`)، وكلاهما انتقلَ إلى قسم «المحرَّرة» عند دمج MR !81.
# فصارت أربعُ حالاتٍ تكذب:
#   • ثلاثُ سلبيّاتٍ (حجزان لنفس العنصر · عنصرٌ غير موجود · حجزٌ بلا مالك) تُشوِّه صفّاً
#     في جدولِ «المحرَّرة» ذي الستّةِ أعمدة، والمدقِّقُ يُسقِط أيَّ صفٍّ `NF < 9` قبل النظر
#     فيه — فكانت تُدقّق سطراً ميتاً وتأتي `pass` بدل `fail`.
#   • حالةُ حارسِ SIGPIPE تُشغَّل على فرعٍ بلا حجزٍ نشط، فتفشل بـ«لا حجز نشط للفرع»
#     **قبل أن تصل إلى ما تحرسه** — أي أنّ حارسَ انحدارِ M0-11 لم يكن يحرس شيئاً.
#   • وحالتا المهلةِ كانتا تُصادفان صفّاً حيّاً بترتيبِ الصفوف لا بتصميم.
# العلاج: الحزمةُ **تبني سجلَّ حجزٍ صناعيّاً كاملاً** في نسخةِ /tmp لكلِّ حالة، ولا تقرأ
# ولا تُشوِّه أيَّ صفٍّ حقيقي. ومعرِّفاتُ عناصرِ العملِ تُقرأ من اللوحةِ وقتَ التشغيل،
# والتواريخُ تُحسب من تاريخِ اليوم — فلا تتلف الحزمةُ بمرورِ الوقتِ ولا بتحريرِ حجز.
#
# المرجع: docs/00-rules/WORK_CLAIM_RULE.md · اللوحة: M0-11 (SIGPIPE) · M0-12 (هذه)
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

T=/tmp/gov_proof
rm -rf "$T"; mkdir -p "$T"
cp -r "$REPO_ROOT/." "$T/" 2>/dev/null
cd "$T" || exit 1
rm -rf .git

git init -q -b main
git config user.email t@t.t; git config user.name t
git add -A >/dev/null 2>&1
git commit -qm "baseline" >/dev/null 2>&1
git update-ref refs/remotes/origin/main HEAD
git branch -f origin-main >/dev/null 2>&1

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

CL=docs/16-progress/WORK_CLAIMS.md
BOARD=docs/16-progress/LAUNCH_EXECUTION_BOARD.md

# ── معطياتٌ تُقرأ وقتَ التشغيل، فلا يُثبَّت في الحزمة معرِّفٌ ولا تاريخ ─────────
mapfile -t ITEMS < <(grep -oE '^\| *M[0-9]+-[0-9A-Za-z]+ *\|' "$BOARD" | tr -d '| ' | head -2)
ITEM_A="${ITEMS[0]:-}"; ITEM_B="${ITEMS[1]:-}"
if [[ -z "$ITEM_A" || -z "$ITEM_B" ]]; then
  printf '\033[31m✗ تعذّر قراءة معرّفَي عنصرِ عملٍ من اللوحة — الحزمة لا تستطيع بناء سجلٍّ صالحاً.\033[0m\n'
  exit 1
fi
TODAY="$(date -u +%Y-%m-%d)"
D_OK="$(date -u -d "$TODAY +10 days" +%Y-%m-%d)"    # مهلةٌ صالحة
D_LONG="$(date -u -d "$TODAY +120 days" +%Y-%m-%d)" # تتجاوز 14 يوماً
D_PAST_S="$(date -u -d "$TODAY -40 days" +%Y-%m-%d)"
D_PAST_E="$(date -u -d "$TODAY -30 days" +%Y-%m-%d)" # منتهية

# ledger <صفوف نشطة على stdin> — يبني سجلَّ حجزٍ صناعيّاً كاملاً يقرؤه المدقِّق.
# الصفُّ المحرَّرُ في القسم 3 مقصودٌ: يُثبت أنّ صفوفَ «المحرَّرة» تُهمَل ولا تُحتسب.
ledger() {
  local rows; rows="$(cat)"
  {
    printf '# سجل حجز العمل (Work Claims) — سجلٌّ صناعيٌّ لاختبار الحوكمة\n\n'
    printf '## 2. الحجوزات النشطة\n\n'
    printf '| Claim ID | Work Item | Owner | Branch | Scope Paths | Started | Expires | Status |\n'
    printf '| --- | --- | --- | --- | --- | --- | --- | --- |\n'
    printf '%s\n' "$rows"
    printf '\n## 3. الحجوزات المحرَّرة (Released)\n\n'
    printf '| Claim ID | Work Item | Owner | Branch | Released | سبب التحرير |\n'
    printf '| --- | --- | --- | --- | --- | --- |\n'
    printf '| CLM-7000 | %s | @gamma | test/released | %s | دُمج — يجب أن يُهمَل هذا الصف تماماً |\n' "$ITEM_A" "$TODAY"
  } > "$CL"
}
row() { # row <cid> <item> <owner> <branch> <scope> [started] [expires]
  printf '| %s | %s | %s | %s | %s | %s | %s | Active |\n' \
    "$1" "$2" "$3" "$4" "$5" "${6:-$TODAY}" "${7:-$D_OK}"
}

printf '\n\033[1m═══ إثبات آلية منع تكرار العمل ═══\033[0m\n'
printf '\033[2m  عناصر العمل المقروءة من اللوحة: %s · %s   |   اليوم: %s\033[0m\n\n' "$ITEM_A" "$ITEM_B" "$TODAY"

printf '\033[1m[أ] سلامة السجل الحقيقي\033[0m\n'
t "السجل الحقيقي في المستودع سليم" pass bash scripts/checks/validate-work-claims.sh

printf '\n\033[1m[ب] سلامة السجل — على سجلٍّ صناعيٍّ لا يعتمد على صفٍّ حقيقي\033[0m\n'

# مرجعٌ موجب: السجلُّ الصناعيُّ الأساسُ يجب أن يكون سليماً، وإلّا فكلُّ سلبيّةٍ بعده كاذبة.
ledger <<ROWS
$(row CLM-8001 "$ITEM_A" @alpha test/alpha "services/alpha/,scripts/")
$(row CLM-8002 "$ITEM_B" @beta test/beta "services/beta/")
ROWS
t "السجل الصناعي الأساس سليم (مرجع موجب)" pass bash scripts/checks/validate-work-claims.sh

# حالة 1: حجزان لنفس عنصر العمل — صفّان نشطان، مالكان مختلفان
ledger <<ROWS
$(row CLM-8001 "$ITEM_A" @alpha test/alpha "services/alpha/")
$(row CLM-8002 "$ITEM_A" @beta test/beta "services/beta/")
ROWS
t "يرفض حجزين لنفس عنصر العمل" fail bash scripts/checks/validate-work-claims.sh

# حالة 2: تقاطع نطاقات بين مالكين مختلفين (أحد المسارين يحتوي الآخر)
ledger <<ROWS
$(row CLM-8001 "$ITEM_A" @alpha test/alpha "services/alpha/")
$(row CLM-8002 "$ITEM_B" @beta test/beta "services/alpha/nested/")
ROWS
t "يرفض تقاطع نطاق بين مالكين مختلفين" fail bash scripts/checks/validate-work-claims.sh

# حالة 3: نطاق منفصل تماماً = مسموح (لا منع زائد)
ledger <<ROWS
$(row CLM-8001 "$ITEM_A" @alpha test/alpha "services/alpha/")
$(row CLM-8002 "$ITEM_B" @beta test/beta "services/beta/")
ROWS
t "يسمح بنطاق منفصل تماماً (لا منع زائد)" pass bash scripts/checks/validate-work-claims.sh

# حالة 4: تقاطعٌ على سجلٍّ مشترك = مسموح (القاعدة تُلزم الجميعَ بتحديثه)
ledger <<ROWS
$(row CLM-8001 "$ITEM_A" @alpha test/alpha "services/alpha/,docs/16-progress/TASK_LOG.md")
$(row CLM-8002 "$ITEM_B" @beta test/beta "services/beta/,docs/16-progress/TASK_LOG.md")
ROWS
t "يسمح بتقاطع على سجلٍّ مشترك مستثنى" pass bash scripts/checks/validate-work-claims.sh

# حالة 5: نفس المالك على نفس المسار = مسؤوليته لا تقاطع
ledger <<ROWS
$(row CLM-8001 "$ITEM_A" @alpha test/alpha "services/alpha/")
$(row CLM-8002 "$ITEM_B" @alpha test/beta "services/alpha/")
ROWS
t "يسمح بتقاطع نطاق لنفس المالك" pass bash scripts/checks/validate-work-claims.sh

# حالتا M0-13: الوكيلُ وصاحبُه **جهةٌ واحدة**، ومالكانِ مختلفانِ **جهتان**.
# الحالتانِ متلازمتانِ بقصد: الأولى وحدَها تُرضيها دالةٌ تُرجِع صفراً دائماً
# — أي تعطيلٌ كاملٌ لفحصِ التقاطعِ في ثوبِ تطبيع. والثانيةُ هي التي تمنع ذلك.
ledger <<ROWS
$(row CLM-8001 "$ITEM_A" "@alpha" test/alpha "services/alpha/")
$(row CLM-8002 "$ITEM_B" "@alpha (agent:computer)" test/beta "services/alpha/")
ROWS
t "يسمح بتقاطع الوكيل مع صاحبِه (جهة واحدة)" pass bash scripts/checks/validate-work-claims.sh

# وكيلانِ لصاحبَينِ مختلفَين: جهتانِ وإن تشابهت اللاحقةُ — يُرفض.
ledger <<ROWS
$(row CLM-8001 "$ITEM_A" "@alpha (agent:computer)" test/alpha "services/alpha/")
$(row CLM-8002 "$ITEM_B" "@beta (agent:computer)" test/beta "services/alpha/nested/")
ROWS
t "يرفض تقاطع وكيلَينِ لصاحبَينِ مختلفَين" fail bash scripts/checks/validate-work-claims.sh

# حالة 6: حجز منتهي المهلة
ledger <<ROWS
$(row CLM-8001 "$ITEM_A" @alpha test/alpha "services/alpha/" "$D_PAST_S" "$D_PAST_E")
ROWS
t "يرفض حجزاً منتهي المهلة" fail bash scripts/checks/validate-work-claims.sh

# حالة 7: مهلة تتجاوز 14 يوماً
ledger <<ROWS
$(row CLM-8001 "$ITEM_A" @alpha test/alpha "services/alpha/" "$TODAY" "$D_LONG")
ROWS
t "يرفض مهلة تتجاوز 14 يوماً" fail bash scripts/checks/validate-work-claims.sh

# حالة 8: عنصر عمل غير موجود في اللوحة
ledger <<ROWS
$(row CLM-8001 M9-99 @alpha test/alpha "services/alpha/")
ROWS
t "يرفض عنصر عمل غير موجود في اللوحة" fail bash scripts/checks/validate-work-claims.sh

# حالة 9: مالك فارغ
ledger <<ROWS
$(row CLM-8001 "$ITEM_A" "—" test/alpha "services/alpha/")
ROWS
t "يرفض حجزاً بلا مالك" fail bash scripts/checks/validate-work-claims.sh

# حالة 10: مالك بلا @
ledger <<ROWS
$(row CLM-8001 "$ITEM_A" alpha test/alpha "services/alpha/")
ROWS
t "يرفض مالكاً لا يبدأ بـ@" fail bash scripts/checks/validate-work-claims.sh

# حالة 11: نطاق فارغ
ledger <<ROWS
$(row CLM-8001 "$ITEM_A" @alpha test/alpha "—")
ROWS
t "يرفض حجزاً بنطاق فارغ" fail bash scripts/checks/validate-work-claims.sh

# حالة 12: صيغة الوكيل '@handle (agent:<name>)' مقبولة
ledger <<ROWS
$(row CLM-8001 "$ITEM_A" "@alpha (agent:computer)" test/alpha "services/alpha/")
ROWS
t "يقبل مالكاً بصيغة الوكيل @handle (agent:x)" pass bash scripts/checks/validate-work-claims.sh

# حالة 13: حارسُ العطبِ الذي أنتج M0-12 — صفوفُ «المحرَّرة» يجب أن تُهمَل تماماً.
# لو عادَ المدقِّقُ يقرأ الصفوفَ الناقصةَ الأعمدةِ لَصار CLM-7000 حجزاً ثانياً لـITEM_A
# ولانقلبت هذه الحالةُ إلى fail — وهو بالضبط ما يجب أن تكشفه.
ledger <<ROWS
$(row CLM-8001 "$ITEM_A" @alpha test/alpha "services/alpha/")
ROWS
t "يهمل صفوف «المحرَّرة» ولا يحتسبها حجزاً (حارس M0-12)" pass bash scripts/checks/validate-work-claims.sh

printf '\n\033[1m[ج] احتواء الملفات المُعدّلة داخل النطاق المحجوز (git حقيقي)\033[0m\n'

ledger <<ROWS
$(row CLM-8001 "$ITEM_A" @alpha test/alpha "services/alpha/,scripts/")
$(row CLM-8002 "$ITEM_B" @beta test/beta "services/beta/")
ROWS
cp "$CL" /tmp/CL.fixture
git add -A >/dev/null; git commit -qm "fixture ledger" >/dev/null
git checkout -q -b test/alpha

# ملف داخل النطاق المحجوز
mkdir -p services/alpha/src && echo "export const a = 1" > services/alpha/src/index.ts
git add -A >/dev/null; git commit -qm "in scope" >/dev/null
t "يسمح بتعديل داخل النطاق المحجوز" pass bash scripts/checks/validate-work-claims.sh origin/main HEAD

# ملف خارج النطاق المحجوز
mkdir -p services/beta/src && echo "export const b = 1" > services/beta/src/index.ts
git add -A >/dev/null; git commit -qm "out of scope" >/dev/null
t "يرفض تعديل ملف خارج النطاق المحجوز" fail bash scripts/checks/validate-work-claims.sh origin/main HEAD
git reset -q --hard HEAD~1

# السجلات المشتركة الخمسة: مسموحةٌ وإن لم تُذكر في النطاق
for f in TASK_LOG LAUNCH_EXECUTION_BOARD WORK_CLAIMS WORK_INDEX MASTER_PROGRESS; do
  [[ -f "docs/16-progress/$f.md" ]] && printf '\n<!-- حالة اختبار -->\n' >> "docs/16-progress/$f.md"
done
git add -A >/dev/null; git commit -qm "shared ledgers only" >/dev/null
t "يسمح بتعديل السجلات المشتركة الخمسة خارج النطاق" pass bash scripts/checks/validate-work-claims.sh origin/main HEAD
git reset -q --hard HEAD~1
cp /tmp/CL.fixture "$CL"

# فرع بلا حجز
git checkout -q -b test/unclaimed
mkdir -p services/gamma/src && echo "export const g = 1" > services/gamma/src/index.ts
git add -A >/dev/null; git commit -qm "no claim" >/dev/null
t "يرفض الدفع من فرع بلا حجز نشط" fail bash scripts/checks/validate-work-claims.sh origin/main HEAD
git checkout -q test/alpha
git branch -qD test/unclaimed >/dev/null 2>&1

printf '\n\033[1m[د] قاعدة التوثيق مع الدفع\033[0m\n'

# كودٌ بلا تحديثِ السجلِّ واللوحة — على فرعٍ **له حجزٌ نشط**، فالرفضُ يقع على قاعدةِ
# التوثيقِ وحدَها ولا يُشوَّش بغيابِ حجز.
mkdir -p services/alpha/src && echo "export const c = 1" > services/alpha/src/extra.ts
git add -A >/dev/null; git commit -qm "code without ledger" >/dev/null
t "يرفض كوداً بلا تحديث السجل واللوحة" fail bash scripts/checks/require-doc-update.sh origin/main HEAD
git reset -q --hard HEAD~1

# لمسُ السجلِّ بلا إدخالٍ يحمل Work Item(s) لا يكفي
echo "export const d = 1" > services/alpha/src/extra.ts
printf '\n<!-- لمسة بلا إدخال -->\n' >> docs/16-progress/TASK_LOG.md
printf '\n<!-- لمسة بلا إدخال -->\n' >> "$BOARD"
git add -A >/dev/null; git commit -qm "ledger touched without entry" >/dev/null
t "يرفض لمسَ السجل بلا إدخال يحمل Work Item(s)" fail bash scripts/checks/require-doc-update.sh origin/main HEAD
git reset -q --hard HEAD~1

# حارس انحدار M0-11: `grep -q` بعد أنبوب مع pipefail يتلقّى git إشارة SIGPIPE فيُرفض
# عملٌ صحيح. TASK_LOG يتجاوز 650 KB فالعيب يقع دائماً لا نادراً.
# يُنفَّذ على فرعٍ **له حجزٌ نشط ونطاقُه يشمل scripts/**، وإلّا فشلت الحالةُ لغيابِ
# الحجزِ قبل أن تصل إلى ما تحرسه — وهو ما كان يحدث قبل M0-12.
printf '\n### [2026-01-01] حالة اختبار\n\n- **Work Item(s):** %s\n- **Why:** حارس انحدار\n' "$ITEM_A" >> docs/16-progress/TASK_LOG.md
printf '\n<!-- حالة اختبار -->\n' >> "$BOARD"
echo '# حالة اختبار' >> scripts/checks/verify-governance.sh
git add -A >/dev/null; git commit -qm "valid entry with large diff" >/dev/null
t "يقبل إدخالاً صحيحاً مع diff كبير (حارس SIGPIPE)" pass bash scripts/checks/require-doc-update.sh origin/main HEAD

# حارس انحدار 3 (M0-12): مصيدةُ SIGPIPE كانت **باقيةً** في `require-doc-update.sh`
# عند فحصِ وجودِ TASK_LOG واللوحةِ في قائمةِ الملفّات (`printf | grep -Fxq`)، ولم يُعالَج
# في M0-11 إلّا موضعٌ واحدٌ في الملفِ نفسِه. والقائمةُ صغيرةٌ فالعيبُ احتماليٌّ: حالةٌ
# واحدةٌ تمرُّ غالباً، فيُشترط تكرارٌ مثلما في حارسِ اللوحة.
doc_stable=1
for _ in $(seq 1 40); do
  bash scripts/checks/require-doc-update.sh origin/main HEAD >/dev/null 2>&1 || doc_stable=0
done
t "قاعدة التوثيق تقبل حالةً صحيحةً في 40 تشغيلاً بلا تقلّب" pass test "$doc_stable" = "1"
git reset -q --hard HEAD~1

# حارس انحدار 2: نفسُ مصيدةِ SIGPIPE في `validate-launch-board.sh` (فحصُ مراجع
# TASK_LOG مقابل اللوحة). العيبُ احتماليٌّ لا حتميّ، فحالةٌ واحدةٌ لا تكفي: تُشغَّل
# البوّابةُ 40 مرّةً على لوحةٍ وسجلٍّ صحيحين، ويجب أن تنجح **كلَّها**.
printf '\n\033[1m[د2] ثباتُ مدقّقِ اللوحة (حارس SIGPIPE الثاني)\033[0m\n'
board_stable=1
for _ in $(seq 1 40); do
  bash scripts/checks/validate-launch-board.sh "$BOARD" >/dev/null 2>&1 || board_stable=0
done
t "مدقّق اللوحة يقبل لوحةً صحيحةً في 40 تشغيلاً بلا تقلّب" pass test "$board_stable" = "1"

printf '\n\033[1m[هـ] تطابقُ قائمةِ السجلات المشتركة في مواضعها الثلاثة\033[0m\n'
# انحرافٌ حقيقيٌّ رُصد في M0-12: ثلاثةُ مواضعَ تُعلن ثلاثَ قوائم، فمَن اتَّبع الوثيقةَ
# رُفض دفعُه. هذه الحالةُ تمنع عودتَه.
t "القائمة واحدة في السكربتين والوثيقة" pass python3 "$REPO_ROOT/scripts/checks/lib/check-shared-ledgers.py" "$REPO_ROOT"

printf '\n\033[1m[و] المدخل الموحّد\033[0m\n'
# حالةٌ موجبةٌ كاملة: فرعٌ محجوز، وتغييرٌ داخل النطاق، وإدخالٌ في السجلِّ
# يحمل Work Item(s)، ولمسةٌ في اللوحة — يجب أن تمرَّ البوّابةُ كلُّها خضراء.
# لا يُعاد السجلُّ الحقيقيُّ هنا: لا حجزَ فيه لفروعِ الاختبار، فتفشل الحالةُ
# لسببٍ من صنعِ الحزمةِ لا من عيبٍ في البوّابة — وهو عينُ ما عولِج في M0-12.
cp /tmp/CL.fixture "$CL"
printf '\n### [2026-01-01] حالة اختبار — المدخل الموحّد\n\n- **Work Item(s):** %s\n- **Why:** حالة موجبة كاملة\n' "$ITEM_A" >> docs/16-progress/TASK_LOG.md
printf '\n<!-- حالة اختبار -->\n' >> "$BOARD"
git add -A >/dev/null; git commit -qm "valid full state" >/dev/null
t "verify-governance يعمل في سياق git" pass bash scripts/checks/verify-governance.sh origin/main HEAD

printf '\n\033[1m═══ النتيجة: %d ناجح · %d فاشل ═══\033[0m\n\n' "$PASS" "$FAIL"
(( FAIL == 0 )) || exit 1
