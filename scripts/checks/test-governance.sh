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

printf '\n\033[1m[ز] هدفُ طلبِ الدمج — فرعٌ مدموجٌ أو محذوفٌ يُعلِق العمل (M0-17)\033[0m\n'

# مسرحٌ معزولٌ لكلِّ حالةٍ للسببِ عينِه المُعلَنِ في القسمِ [هج]: الفحصُ يسأل `origin`
# ويقارن أسلافاً، فلو أُضيف `origin` إلى $T لانقلب معنى `origin/main` عندَ بقيّةِ
# الحالات. ويُنزع متغيّرا CI من البيئةِ في كلِّ تشغيل، وإلّا لأفسدت وظيفةُ
# `governance-guard` حالةَ «لا هدفَ معلوم» — أي لفشلت الحزمةُ لسببٍ من صنعِ البيئةِ لا من عيب.
MRT_SRC="$REPO_ROOT/scripts/checks/validate-mr-target.sh"

_mrt_stage() { # _mrt_stage <اسم> <أُضيف origin؟ 0|1> [سكربتٌ بديل] → يطبع مسارَ المسرح
  local name="$1" with_origin="$2" script="${3:-$MRT_SRC}"
  local S="/tmp/gov_mrt_$name"
  rm -rf "$S" "$S.origin"
  mkdir -p "$S/scripts/checks"
  cp "$script" "$S/scripts/checks/validate-mr-target.sh"
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

_mrt() { # _mrt <مسرح> [وسائط...] — يُشغّل الفحصَ ببيئةٍ منزوعةِ متغيّراتِ CI
  local S="$1"; shift
  ( cd "$S" && env -u CI_MERGE_REQUEST_TARGET_BRANCH_NAME -u CI_DEFAULT_BRANCH \
      bash scripts/checks/validate-mr-target.sh "$@" )
}

# (1) الهدفُ هو الفرعُ الافتراضيُّ — الحالةُ السويّةُ وأكثرُها وقوعاً → يمرّ
mrt_default_target() { local S; S="$(_mrt_stage def 1)"; _mrt "$S" main main; }
t "يمرّ طلباً يستهدف الفرعَ الافتراضيّ" pass mrt_default_target

# (2) هدفٌ غيرُ افتراضيٍّ متقدّمٌ بالتزام — طلبٌ مكدّسٌ مشروعٌ → يمرّ (بتنبيه)
# مرجعٌ موجبٌ لازمٌ: لولاه لما دلّت السلبيّةُ بعده على شيء — فقد يكون الفحصُ
# يرفض كلّ هدفٍ غيرِ الافتراضيّ، وذلك تعطيلٌ للتكديسِ لا حراسةٌ للعمل.
mrt_stacked_ok() {
  local S; S="$(_mrt_stage stacked 1)"
  ( cd "$S" && git checkout -q -b feat/base && printf 'a\n' > a.txt && git add -A >/dev/null \
      && git commit -qm "التزامٌ ليس في main" >/dev/null && git push -q origin feat/base >/dev/null 2>&1 \
      && git checkout -q main )
  _mrt "$S" feat/base main
}
t "يمرّ هدفاً متقدّماً (طلبٌ مكدّسٌ مشروع)" pass mrt_stacked_ok

# (3) هدفٌ **مدموجٌ أصلاً** في الافتراضيّ → يُرفَض. وهذا عينُ ما وقع في MR !96:
# دُمج !95 إلى main أوّلاً، ثمّ دُمج !96 إلى فرعِ !95 بعدَه — فبقي عملُ M0-16 خارجَ main.
mrt_merged_target() {
  local S; S="$(_mrt_stage merged 1)"
  ( cd "$S" && git checkout -q -b chore/closeout && printf 'c\n' > c.txt && git add -A >/dev/null \
      && git commit -qm "عملُ فرعِ الإقفال" >/dev/null && git push -q origin chore/closeout >/dev/null 2>&1 \
      && git checkout -q main && git merge -q --no-ff -m "دمجُ الهدفِ في main" chore/closeout >/dev/null \
      && git push -q origin main >/dev/null 2>&1 )
  _mrt "$S" chore/closeout main
}
t "يرفض هدفاً مدموجاً أصلاً في الافتراضيّ" fail mrt_merged_target

# (4) هدفٌ **محذوفٌ** من المستودع → يُرفَض: لا فرعَ يُدمج إليه.
mrt_deleted_target() {
  local S; S="$(_mrt_stage gone 1)"
  ( cd "$S" && git checkout -q -b chore/gone && printf 'g\n' > g.txt && git add -A >/dev/null \
      && git commit -qm g >/dev/null && git push -q origin chore/gone >/dev/null 2>&1 \
      && git push -q origin --delete chore/gone >/dev/null 2>&1 \
      && git checkout -q main && git branch -qD chore/gone \
      && git update-ref -d refs/remotes/origin/chore/gone 2>/dev/null; true )
  _mrt "$S" chore/gone main
}
t "يرفض هدفاً محذوفاً من المستودع" fail mrt_deleted_target

# (5) لا موضوعَ للحكم (لا وسيطٌ ولا متغيّرُ CI) → «لا ينطبق» ولا يدّعي جزئيّةً.
# والتفريقُ مقصودٌ: لو قيل «جزئي» هنا لصار كلُّ خطٍّ على main يُعلِن نقصاً لا وجودَ له.
mrt_not_applicable() {
  local S out rc; S="$(_mrt_stage na 1)"
  out="$(_mrt "$S" 2>&1)"; rc=$?
  (( rc == 0 )) || { printf '%s\n' "$out"; echo "✗ رُفض الدفعُ ولا طلبَ دمجٍ أصلاً"; return 1; }
  grep -q 'لا ينطبق' <<< "$out" || { printf '%s\n' "$out"; echo "✗ لم يُعلِن «لا ينطبق»"; return 1; }
  grep -q 'جزئي' <<< "$out" && { printf '%s\n' "$out"; echo "✗ خلط عدمَ الانطباقِ بالجهلِ فأعلن نقصاً لا وجودَ له"; return 1; }
  return 0
}
t "بلا طلبٍ يقول «لا ينطبق» ولا يدّعي جزئيّة" pass mrt_not_applicable

# (6) وعندَ الجهل (هدفٌ معلومُ الاسمِ ولا مرجعٌ ولا وصولَ إلى origin) → تخطٍّ
# مُعلَنٌ بوسمِ «جزئي»، ولا يُرفَض الدفعُ لأنّ الجهلَ ليس دليلَ عَلَق.
mrt_declares_skip() {
  local S out rc; S="$(_mrt_stage blind 0)"
  out="$(_mrt "$S" feat/unknowable main 2>&1)"; rc=$?
  (( rc == 0 )) || { printf '%s\n' "$out"; echo "✗ رُفض على جهلٍ لا على دليل"; return 1; }
  grep -q 'تخط' <<< "$out" || { printf '%s\n' "$out"; echo "✗ تُخطّي ولم يُعلِن التخطّي"; return 1; }
  grep -q 'جزئي' <<< "$out" || { printf '%s\n' "$out"; echo "✗ ادّعى نجاحاً كاملاً وهو لم يفحص"; return 1; }
  return 0
}
t "عند الجهل يُعلن التخطّي ويوسمُه جزئيّاً" pass mrt_declares_skip

# ── اختباراتُ طفرةٍ: كلُّ حالةٍ يجب أن تكشف عيباً يُسقِطُها وحدَها ───────────
# حالةٌ تمرّ ولا تكشف عيباً ليست حراسةً بل زينةٌ. وكلُّ طفرةٍ تُسقِط **ما تقصده
# وحدَه** — فلو أسقطت أكثرَ لدلّ ذلك على حالاتٍ متداخلةٍ لا على دقّة.
_mrt_mutant() { # _mrt_mutant <python-expr-ملف> → يطبع مسارَ نسخةٍ مُطفَرة
  local tag="$1" old="$2" new="$3"
  local M="/tmp/gov_mrt_mutant_$tag.sh"
  python3 - "$MRT_SRC" "$M" "$old" "$new" <<'PY'
import sys
src,dst,old,new = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
assert old in s, "لم أجد الموضعَ المقصودَ للطفرة: " + old
open(dst,'w',encoding='utf-8').write(s.replace(old,new,1))
PY
  printf '%s' "$M"
}

# طفرة 1: تحييدُ حكمِ «مدموجٌ أصلاً» — يجب أن تسقط الحالةُ (3) وحدَها.
mrt_mutation_merged() {
  local M rc=0; M="$(_mrt_mutant merged \
    'if git merge-base --is-ancestor "$T_SHA" "$D_SHA" 2>/dev/null; then' \
    'if false; then')"
  local S; S="$(_mrt_stage mut_merged 1 "$M")"
  ( cd "$S" && git checkout -q -b chore/closeout && printf 'c\n' > c.txt && git add -A >/dev/null \
      && git commit -qm c >/dev/null && git push -q origin chore/closeout >/dev/null 2>&1 \
      && git checkout -q main && git merge -q --no-ff -m m chore/closeout >/dev/null \
      && git push -q origin main >/dev/null 2>&1 )
  _mrt "$S" chore/closeout main >/dev/null 2>&1 && rc=1   # مرّ وكان يجب أن يُرفَض
  (( rc == 1 ))
}
t "حالةُ «الهدفُ مدموج» تكشف فعلاً (اختبارُ طفرة)" pass mrt_mutation_merged

# طفرة 2: تحييدُ رفضِ الهدفِ المحذوف — يجب أن تسقط الحالةُ (4) وحدَها.
mrt_mutation_deleted() {
  local M rc=0; M="$(_mrt_mutant deleted 'if (( T_RC == 2 )); then' 'if false; then')"
  local S; S="$(_mrt_stage mut_gone 1 "$M")"
  ( cd "$S" && git checkout -q -b chore/gone && printf 'g\n' > g.txt && git add -A >/dev/null \
      && git commit -qm g >/dev/null && git push -q origin chore/gone >/dev/null 2>&1 \
      && git push -q origin --delete chore/gone >/dev/null 2>&1 \
      && git checkout -q main && git branch -qD chore/gone \
      && git update-ref -d refs/remotes/origin/chore/gone 2>/dev/null; true )
  _mrt "$S" chore/gone main >/dev/null 2>&1 && rc=1
  (( rc == 1 ))
}
t "حالةُ «الهدفُ محذوف» تكشف فعلاً (اختبارُ طفرة)" pass mrt_mutation_deleted

# طفرة 3: خلطُ «لا ينطبق» بالجهلِ — يجب أن تسقط الحالةُ (5) وحدَها.
mrt_mutation_conflate() {
  local M rc=0; M="$(_mrt_mutant conflate \
    'not_applicable "ليس سياقَ طلبِ دمج' \
    'skip "ليس سياقَ طلبِ دمج')"
  local S out; S="$(_mrt_stage mut_na 1 "$M")"
  out="$(_mrt "$S" 2>&1)"
  grep -q 'جزئي' <<< "$out" && rc=1   # أعلن نقصاً لا وجودَ له
  (( rc == 1 ))
}
t "حالةُ تمييزِ «لا ينطبق» من الجهلِ تكشف فعلاً (اختبارُ طفرة)" pass mrt_mutation_conflate

printf '\n\033[1m[ح] عزلُ DDL في اختباراتِ التكامل (M0-03)\033[0m\n'
# الحارسُ يقرأ **إعداداتَ** الخدماتِ من القرص، فتُبنى له خدماتٌ صناعيّةٌ في /tmp
# ولا يُشوَّه إعدادُ خدمةٍ حقيقيّةٍ أبداً: تشويهُ الحقيقيِّ يجعل الحالةَ تكذب متى
# أُصلحت الخدمةُ أو أُعيدت تسميتُها — وهو عينُ الخلل الذي عولج في M0-12.
ISO_SRC="$REPO_ROOT/scripts/checks/validate-integration-isolation.sh"

_iso_stage() { # _iso_stage <tag> <عددُ الملفّات> <نمطُ الإعداد> [استثناءٌ افتراضيّ:1|0] → يطبع مسارَ مجلَّدِ خدمات
  local tag="$1" nfiles="$2" mode="$3" excl="${4:-1}"
  local S="/tmp/gov_iso_$tag"
  rm -rf "$S"; mkdir -p "$S/svc/src/__tests__"
  local i
  for (( i = 1; i <= nfiles; i++ )); do
    printf 'import { it } from "vitest";\nit("x", () => {});\n' > "$S/svc/src/__tests__/f$i.integration.test.ts"
  done
  if (( excl )); then
    printf 'export default { test: { exclude: ["**/__tests__/*.{integration,e2e}.test.ts"] } };\n' \
      > "$S/svc/vitest.config.ts"
  else
    printf 'export default { test: { exclude: ["**/node_modules/**"] } };\n' > "$S/svc/vitest.config.ts"
  fi
  case "$mode" in
    serial) printf 'export default { test: { fileParallelism: false } };\n' > "$S/svc/vitest.integration.config.ts" ;;
    loose)  printf 'export default { test: { include: ["src/__tests__/*.integration.test.ts"] } };\n' > "$S/svc/vitest.integration.config.ts" ;;
    perworker) printf '// GOV-ISOLATION: schema-per-worker\nexport default { test: {} };\n' > "$S/svc/vitest.integration.config.ts" ;;
    none)   : ;;   # لا إعدادَ تكاملٍ أصلاً
  esac
  printf '%s' "$S"
}

_iso() { # _iso <مجلَّدُ الخدمات> [سكربتٌ بديلٌ مُطفَّر]
  local dir="$1" script="${2:-$ISO_SRC}"
  ( cd "$REPO_ROOT" && bash "$script" "$dir" )
}

# (1) مرجعٌ موجبٌ — المستودعُ الحقيقيُّ نفسُه يجب أن يمرّ. ولولا هذه الحالةُ لما
# دلّت السلبيّاتُ بعدها على شيء: حارسٌ يرفض كلَّ شيءٍ «يكشف» كلَّ عيبٍ وكلَّ سليم.
t "يمرّ على خدماتِ المستودعِ الحقيقيّةِ كما هي" pass _iso "$REPO_ROOT/services"

# (2) ملفّانِ يُسقطان الجداولَ وإعدادٌ بلا تسلسل → يُرفَض. وهذه حالةُ identity
# قبلَ M0-03 حرفاً بحرف: فشلت حزمتُها 10/10 بأربعةِ عوامل على Postgres حقيقيّة.
iso_loose() { _iso "$(_iso_stage loose 2 loose)"; }
t "يرفض إعدادَ تكاملٍ بلا fileParallelism وله ملفّان" fail iso_loose

# (3) ملفّانِ ولا إعدادَ تكاملٍ أصلاً → يُرفَض: الغيابُ ليس عزلاً.
iso_missing() { _iso "$(_iso_stage missing 2 none)"; }
t "يرفض غيابَ إعدادِ التكاملِ مع ملفَّين" fail iso_missing

# (4) ملفٌّ واحدٌ بلا تسلسل → يمرّ، ويقول ذلك صريحاً. والتفريقُ مقصود: لو طُولب
# صاحبُ الملفِّ الواحدِ بالتسلسلِ لصار الحارسُ يفرض طقساً لا يمنع سباقاً.
iso_single() {
  local out rc; out="$(_iso "$(_iso_stage single 1 loose)" 2>&1)"; rc=$?
  (( rc == 0 )) || { printf '%s\n' "$out"; echo "✗ رُفض ملفٌّ واحدٌ لا يُسابق نفسَه"; return 1; }
  grep -q 'لا يُطالَب بالتسلسل' <<< "$out" || { printf '%s\n' "$out"; echo "✗ مرّ بلا بيانِ سببِ المرور"; return 1; }
  return 0
}
t "يمرّ ملفّاً واحداً ويُعلن أنّه لا يُسابق نفسَه" pass iso_single

# (5) البديلُ الذي أجازته الخارطةُ (مخطّطٌ لكلِّ عامل) بوسمٍ مُعلَنٍ → يمرّ.
iso_perworker() {
  local out rc; out="$(_iso "$(_iso_stage perworker 3 perworker)" 2>&1)"; rc=$?
  (( rc == 0 )) || { printf '%s\n' "$out"; echo "✗ رفض بديلاً أجازته خارطةُ الطريق"; return 1; }
  grep -q 'لكلِّ عامل' <<< "$out" || { printf '%s\n' "$out"; echo "✗ لم يُعلِن أنّ العزلَ بالبديل"; return 1; }
  return 0
}
t "يقبل «schema-per-worker» بوسمٍ مُعلَنٍ بدلَ التسلسل" pass iso_perworker

# (6) البابُ الثاني: إعدادٌ افتراضيٌّ لا يستثني ملفّاتِ التكاملِ → يُرفَض حتّى لو
# كان إعدادُ التكاملِ متسلسلاً؛ إذ تجري الملفّاتُ في «pnpm -r test» بتوازٍ كامل.
iso_default_leak() { _iso "$(_iso_stage leak 2 serial 0)"; }
t "يرفض إعداداً افتراضيّاً لا يستثني ملفّاتِ التكامل" fail iso_default_leak

# ── اختباراتُ طفرةٍ: ثلاثُ طفراتٍ قُطريّةٌ، كلٌّ تُسقط حالتَها وحدَها ─────────
_iso_mutant() { # _iso_mutant <tag> <القديم> <الجديد> → مسارُ نسخةٍ مُطفَّرة
  local tag="$1" old="$2" new="$3"
  local M="/tmp/gov_iso_mutant_$tag.sh"
  python3 - "$ISO_SRC" "$M" "$old" "$new" <<'PY'
import sys
src, dst, old, new = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
assert old in s, "لم أجد الموضعَ المقصودَ للطفرة: " + old
open(dst, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
  printf '%s' "$M"
}

# طفرة 1: قبولُ أيِّ إعدادِ تكاملٍ — يجب أن تسقط الحالةُ (2) وحدَها.
iso_mutation_serial() {
  local M rc=0; M="$(_iso_mutant serial \
    "if grep -Eq 'fileParallelism:[[:space:]]*false' \"\$icfg\"; then" \
    'if true; then')"
  _iso "$(_iso_stage mut_serial 2 loose)" "$M" >/dev/null 2>&1 && rc=1
  (( rc == 1 ))
}
t "حالةُ «بلا تسلسل» تكشف فعلاً (اختبارُ طفرة)" pass iso_mutation_serial

# طفرة 2: تحييدُ حراسةِ البابِ الثاني — يجب أن تسقط الحالةُ (6) وحدَها.
iso_mutation_default() {
  local M rc=0; M="$(_iso_mutant default \
    "if [[ -f \"\$dcfg\" ]] && ! grep -q 'integration,e2e\\|\\.integration\\.test\\.ts' \"\$dcfg\"; then" \
    'if false; then')"
  _iso "$(_iso_stage mut_leak 2 serial 0)" "$M" >/dev/null 2>&1 && rc=1
  (( rc == 1 ))
}
t "حالةُ «الإعدادُ الافتراضيُّ يُسرّب» تكشف فعلاً (اختبارُ طفرة)" pass iso_mutation_default

# طفرة 3: مطالبةُ الملفِّ الواحدِ بالتسلسل — يجب أن تسقط الحالةُ (4) وحدَها.
iso_mutation_single() {
  local M rc=0; M="$(_iso_mutant single 'if (( count < 2 )); then' 'if (( count < 1 )); then')"
  _iso "$(_iso_stage mut_single 1 loose)" "$M" >/dev/null 2>&1 || rc=1
  (( rc == 1 ))
}
t "حدُّ «ملفٌّ واحدٌ لا يُسابق نفسَه» مقصودٌ لا عرَضٌ (اختبارُ طفرة)" pass iso_mutation_single

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
