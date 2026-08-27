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
git reset -q --hard HEAD~1

git checkout -q test/alpha
git branch -qD test/unclaimed >/dev/null 2>&1

# حالتا M0-14: `docs/` داخلَ الحماية، والسجلاتُ الخمسةُ خارجَها.
#
# الحالتانِ متلازمتانِ بقصد: الأولى وحدَها يُرضيها توسيعٌ يشمل كلَّ شيءٍ —
# فيصير كلُّ توثيقٍ مستحيلاً بلا حجزٍ سابق، والقاعدةُ تُلزم **كلَّ** دافعٍ
# بتحديثِ السجلاتِ الخمسة. والثانيةُ هي التي تمنع ذلك.
#
# وكلتاهما تنشأانِ من `origin/main` لا من `test/alpha`: لو فُرِعتا من فرعٍ يحمل
# تعديلَ كودٍ لكان ذلك الكودُ في الفرقِ فيُوجِب حجزاً وحدَه — فتمرُّ الأولى
# وتفشل الثانيةُ لسببٍ من صنعِ الحزمةِ لا من عيبٍ في البوّابة، وهو عينُ ما عولِج في M0-12.
# والسجلُ هنا هو السجلُ الحقيقيُّ: لا حجزَ فيه لفروعِ الاختبار، وهو المطلوب.
git checkout -q -b test/unclaimed-docs origin/main
printf '\n<!-- حالة اختبار M0-14 -->\n' >> docs/00-rules/WORK_CLAIM_RULE.md
git add -A >/dev/null; git commit -qm "docs change, no claim" >/dev/null
t "يرفض تعديل وثيقة غير السجلات من فرع بلا حجز" fail bash scripts/checks/validate-work-claims.sh origin/main HEAD

git checkout -q -b test/unclaimed-ledgers origin/main
for f in TASK_LOG LAUNCH_EXECUTION_BOARD WORK_CLAIMS WORK_INDEX MASTER_PROGRESS; do
  [[ -f "docs/16-progress/$f.md" ]] && printf '\n<!-- حالة اختبار M0-14 -->\n' >> "docs/16-progress/$f.md"
done
git add -A >/dev/null; git commit -qm "shared ledgers only, no claim" >/dev/null
t "يسمح بالسجلات الخمسة من فرع بلا حجز" pass bash scripts/checks/validate-work-claims.sh origin/main HEAD

git checkout -q -f test/alpha
git branch -qD test/unclaimed-docs test/unclaimed-ledgers >/dev/null 2>&1
cp /tmp/CL.fixture "$CL"

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

printf '\n\033[1m[هث] مرشِّحُ التغييراتِ ذاتِ المعنى — مصدرٌ واحدٌ لا نسختان (M0-15)\033[0m\n'

# لا تُقارَن هنا **نصوصُ** المرشِّحَين — فمقارنةُ النصِّ تمرُّ والسلوكُ مختلفٌ
# (ترتيبٌ أو هروبٌ أو مجموعةٌ إضافيةٌ)، وتفشل والسلوكُ واحدٌ. يُقارَن **الحكمُ**:
# لكلِّ بادئةٍ في المصدرِ الواحدِ يُبنى فرعٌ حقيقيٌّ بملفٍ تحتَها، ثمّ يُسأل المدقِّقان:
# أمرَّ أحدُهما ورفضَ الآخر؟ فذلك انحرافٌ حيٌّ مهما تشابه النصّان.
parity_check() {
  local lib="$T/scripts/checks/lib/meaningful-paths.sh"
  [[ -f "$lib" ]] || { echo "✗ المصدرُ الواحدُ غيرُ موجود: lib/meaningful-paths.sh"; return 1; }
  # shellcheck source=/dev/null
  source "$lib"
  local raw="${MEANINGFUL_PATHS#^(}"; raw="${raw%)}"
  local disagreements=0 tested=0
  local tok path rc_claim rc_doc
  while IFS= read -r tok; do
    [[ -n "$tok" ]] || continue
    if [[ "$tok" == */ ]]; then path="${tok}m0_15_probe.txt"; else path="${tok//\\/}"; path="${path%$}"; fi
    git checkout -q -f -B test/parity origin-main
    mkdir -p "$(dirname "$path")" 2>/dev/null
    printf 'probe\n' >> "$path"
    git add -A >/dev/null; git commit -qm "parity probe $path" >/dev/null
    bash scripts/checks/validate-work-claims.sh origin/main HEAD >/dev/null 2>&1; rc_claim=$?
    bash scripts/checks/require-doc-update.sh  origin/main HEAD >/dev/null 2>&1; rc_doc=$?
    (( tested++ ))
    # المرجوّ: كلاهما يرفض (تغييرٌ ذو معنى بلا حجزٍ وبلا توثيق)
    if (( rc_claim == 0 || rc_doc == 0 )); then
      echo "✗ اختلافٌ على «$path»: validate-work-claims=$rc_claim · require-doc-update=$rc_doc"
      (( disagreements++ ))
    fi
  done <<< "${raw//|/$'\n'}"
  git checkout -q -f test/alpha
  git branch -qD test/parity >/dev/null 2>&1
  (( tested >= 8 )) || { echo "✗ لم يُقرأ المرشِّحُ أصلاً: جُرِّبت $tested بادئةً فقط"; return 1; }
  (( disagreements == 0 ))
}
t "المدقّقان يحكمان الحكمَ نفسه على كل بادئة" pass parity_check

# والحالةُ الثانية: إعادةُ كتابةِ المرشِّحِ حرفيّاً في أحدِ الملفَّينِ — وهو ما وقع فعلاً
# قبلَ M0-14 — تُكشَف. ولو كان العلاجُ حارسَ تطابقٍ نصِّيٍّ لما كشف هذا: النّصّانِ
# متطابقانِ والسلوكُ مختلفٌ لأنّ أحدَهما توقّف عن قراءةِ المصدرِ الواحد.
# والطفرةُ تُدفَن في **أساسِ** الفروعِ (`origin/main` الصناعيَّ) لا في شجرةِ العمل:
#   • لو وُضِعت في شجرةِ العملِ لمحاها أوّلُ `git checkout -f` داخلَ parity_check.
#   • ولو وُضِعت في فرعٍ يتفرّع منه المسبرُ لظهر `scripts/` في الفرقِ نفسِه،
#     فيُرفَض كلُّ مسبرٍ لأنّ فيه كوداً لا لأجلِ ما يُختبَر — وهو عينُ الخطأِ الذي
#     وقعت فيه حالتا M0-14 أوّلًا فمرّتا للسببِ الخطأ.
parity_regression() {
  local base_sha; base_sha="$(git rev-parse origin-main)"
  local rc=0
  git checkout -q -f -B test/mut origin-main
  python3 - "$T/scripts/checks/validate-work-claims.sh" <<'MUT'
import sys
p=sys.argv[1]; s=open(p).read()
old='MEANINGFUL="$MEANINGFUL_PATHS"'
assert old in s, "لم أجد سطرَ الإسنادِ من المصدرِ الواحد"
open(p,'w').write(s.replace(old, "MEANINGFUL='^(apps/|bots/|services/|packages/|infra/|scripts/)'",1))
MUT
  git add -A >/dev/null; git commit -qm "mutation: إعادة كتابة المرشّح محليّاً" >/dev/null
  git update-ref refs/remotes/origin/main HEAD
  git branch -f origin-main HEAD >/dev/null 2>&1
  parity_check >/dev/null 2>&1 || rc=1
  # إرجاعُ الأساسِ والشجرةِ إلى ما كانا عليه قبلَ الطفرة
  git update-ref refs/remotes/origin/main "$base_sha"
  git branch -f origin-main "$base_sha" >/dev/null 2>&1
  git checkout -q -f test/alpha
  git branch -qD test/mut >/dev/null 2>&1
  (( rc == 1 ))
}
t "إعادة كتابة المرشّح محليّاً تُكشَف" pass parity_regression

printf '\n\033[1m[هج] بياتُ الحجوزات — فرعٌ محذوفٌ وحجزٌ نشط (M0-16)\033[0m\n'

# هذه الحالاتُ **لا تستعمل git المشتركَ في $T**: الفحصُ يسأل `origin` عن وجودِ
# فرعٍ، فيُحتاج مستودعاً بعيداً حقيقيّاً (bare) ودفعاً وحذفاً. ولو أُضيف `origin`
# إلى $T لانقلب معنى `origin/main` عندَ بقيّةِ الحالات — فتمرُّ أو تفشل لسببٍ من
# صنعِ الحزمةِ لا من عيبٍ في البوّابة (عينُ ما عولِج في M0-12). فلكلِّ حالةٍ مسرحٌ معزول.
FRESH="$REPO_ROOT/scripts/checks/validate-claim-freshness.sh"

_fresh_stage() { # _fresh_stage <اسم> <أُضيف origin؟ 0|1> → يطبع مسارَ المسرح
  local name="$1" with_origin="$2"
  local S="/tmp/gov_fresh_$name"
  rm -rf "$S" "$S.origin"
  mkdir -p "$S/scripts/checks" "$S/docs/16-progress"
  cp "$FRESH" "$S/scripts/checks/"
  (
    cd "$S" || exit 1
    git init -q -b main; git config user.email t@t.t; git config user.name t
    printf 'seed\n' > seed.txt; git add -A >/dev/null; git commit -qm seed >/dev/null
    if (( with_origin )); then
      git init -q --bare "$S.origin"
      git remote add origin "$S.origin"
      git push -q origin main >/dev/null 2>&1
    fi
  )
  printf '%s' "$S"
}

_fresh_claims() { # _fresh_claims <مسرح> <فرعُ الحجزِ النشط> [فرعُ حجزٍ محرّر]
  local S="$1" active_branch="$2" released_branch="${3:-}"
  {
    printf '# حجوزاتُ عملٍ صناعيةٌ للاختبار\n\n## 2. الحجوزات النشطة\n\n'
    printf '| Claim ID | Work Item | Owner | Branch | Scope Paths | Started | Expires | Status |\n'
    printf '| --- | --- | --- | --- | --- | --- | --- | --- |\n'
    printf '| CLM-9001 | M0-99 | @t | %s | scripts/ | 2026-08-01 | 2026-12-31 | Active |\n' "$active_branch"
    printf '\n## 3. الحجوزات المحرّرة\n\n'
    printf '| Claim ID | Work Item | Owner | Branch | Released | سبب التحرير |\n'
    printf '| --- | --- | --- | --- | --- | --- |\n'
    [[ -n "$released_branch" ]] && printf '| CLM-9002 | M0-98 | @t | %s | 2026-08-02 | دُمج وحُذف الفرع |\n' "$released_branch"
  } > "$S/docs/16-progress/WORK_CLAIMS.md"
}

# (1) فرعٌ قائمٌ في origin → يمرُّ
fresh_live_branch() {
  local S; S="$(_fresh_stage live 1)"
  ( cd "$S" && git checkout -q -b feat/alive && git push -q origin feat/alive >/dev/null 2>&1 && git checkout -q main && git branch -qD feat/alive )
  _fresh_claims "$S" "feat/alive"
  ( cd "$S" && bash scripts/checks/validate-claim-freshness.sh )
}
t "يمرّ حجزاً نشطاً فرعُه قائم في origin" pass fresh_live_branch

# (2) فرعٌ دُفع ثمّ حُذف من origin والحجزُ لما يزل Active → يُرفَض
# (وهذا عينُ ما وقع حقيقةً في CLM-0002 · CLM-0008 · CLM-0009 · CLM-0010.)
fresh_deleted_branch() {
  local S; S="$(_fresh_stage dead 1)"
  ( cd "$S" && git checkout -q -b feat/dead && git push -q origin feat/dead >/dev/null 2>&1 \
      && git push -q origin --delete feat/dead >/dev/null 2>&1 \
      && git checkout -q main && git branch -qD feat/dead && git update-ref -d refs/remotes/origin/feat/dead )
  _fresh_claims "$S" "feat/dead"
  ( cd "$S" && bash scripts/checks/validate-claim-freshness.sh )
}
t "يرفض حجزاً نشطاً فرعُه محذوف" fail fresh_deleted_branch

# (3) وصفوفُ «المحرّرة» لا تُحتسب — وإلّا لرُفض كلُّ مستودعٍ إلى الأبد:
# كلُّ حجزٍ محرّرٍ فرعُه محذوفٌ بطبيعةِ الحال. (وهو الخطأُ الذي وقع في M0-12.)
fresh_ignores_released() {
  local S; S="$(_fresh_stage rel 1)"
  ( cd "$S" && git checkout -q -b feat/alive2 && git push -q origin feat/alive2 >/dev/null 2>&1 && git checkout -q main && git branch -qD feat/alive2 )
  _fresh_claims "$S" "feat/alive2" "feat/long-gone"
  ( cd "$S" && bash scripts/checks/validate-claim-freshness.sh )
}
t "يهمل صفوف «المحرّرة» ولا يرفضها" pass fresh_ignores_released

# (4) وعندَ الجهل **يُعلِن التخطّي ولا يدّعي النجاحَ الكامل**: لا origin ولا مرجعٌ
# محليّ. ولا يُرفَض الدفعُ لأنّ الجهلَ ليس دليلَ بيات. ويُشترط أمرانِ معاً:
# رمزُ خروجٍ 0، **ووجودُ إعلانِ التخطّي في المخرج** — وإلّا كان فحصاً يصمت عندَ الجهل.
fresh_declares_skip() {
  local S; S="$(_fresh_stage blind 0)"
  _fresh_claims "$S" "feat/unknowable"
  local out rc
  out="$( cd "$S" && bash scripts/checks/validate-claim-freshness.sh 2>&1 )"; rc=$?
  (( rc == 0 )) || { printf '%s\n' "$out"; echo "✗ رُفض الدفعُ على جهلٍ لا على دليلِ بيات"; return 1; }
  grep -q 'تخط' <<< "$out" || { printf '%s\n' "$out"; echo "✗ تُخطّي ولم يُعلِن التخطّي"; return 1; }
  grep -q 'جزئي' <<< "$out" || { printf '%s\n' "$out"; echo "✗ ادّعى نجاحاً كاملاً وهو لم يفحص"; return 1; }
  return 0
}
t "عند الجهل يُعلن التخطّي ولا يدّعي نجاحاً كاملاً" pass fresh_declares_skip

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
