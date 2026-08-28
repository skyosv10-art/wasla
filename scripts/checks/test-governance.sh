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

printf '\n\033[1m[ط] الأمرُ الموحَّدُ وCI مانعٌ لا مُجمِّل (M0-04)\033[0m\n'
# الحارسُ يقرأ `.gitlab-ci.yml` و`VERIFY_COMMAND.md` و`scripts/`، فتُبنى له **جذورٌ
# صناعيّةٌ** في /tmp ولا يُشوَّه ملفٌّ حقيقيٌّ أبداً: تشويهُ الحقيقيِّ يجعل الحالةَ
# تكذب متى أُصلح الملفُّ أو أُعيدت تسميةُ وظيفةٍ (سابقةُ M0-12).
CIM_SRC="$REPO_ROOT/scripts/checks/validate-ci-mandatory.sh"
RS_SRC="$REPO_ROOT/scripts/checks/validate-repo-structure.sh"

_ci_stage() { # _ci_stage <tag> <نمط> → يطبع مسارَ جذرٍ صناعيّ
  local tag="$1" mode="$2"
  local R="/tmp/gov_ci_$tag"
  rm -rf "$R"; mkdir -p "$R/docs/00-rules" "$R/scripts/checks/lib"
  # سكربتاتُ الفحصِ الحقيقيّةُ تُنسَخ (القائمةُ منها يقرؤها البابُ 4)، والوثيقةُ كذلك.
  cp "$REPO_ROOT"/scripts/checks/*.sh "$R/scripts/checks/" 2>/dev/null
  cp "$REPO_ROOT"/scripts/checks/lib/* "$R/scripts/checks/lib/" 2>/dev/null
  cp "$REPO_ROOT/docs/00-rules/VERIFY_COMMAND.md" "$R/docs/00-rules/"
  cp "$REPO_ROOT/scripts/verify.sh" "$R/scripts/verify.sh"
  # خطُّ CI صناعيٌّ صغيرٌ: وظيفةٌ تستدعي الأمرَ الموحَّد، وأخرى إرشاديّةٌ مُعلَنة.
  cat > "$R/.gitlab-ci.yml" <<'YAML'
stages:
  - validate

verify:
  stage: validate
  script:
    - bash scripts/verify.sh

markdown-lint:
  stage: validate
  allow_failure: true
  script:
    - echo lint
YAML
  case "$mode" in
    ok) : ;;
    no_verify)      # البابُ 1: لا وظيفةَ تستدعي الأمرَ الموحَّد
      sed -i 's|bash scripts/verify.sh|echo skipped|' "$R/.gitlab-ci.yml" ;;
    verify_soft)    # البابُ 1: تستدعيه لكنّها لا تُسقِط
      sed -i '/^verify:/,/bash scripts\/verify.sh/ s|^  stage: validate|  stage: validate\n  allow_failure: true|' \
        "$R/.gitlab-ci.yml" ;;
    inline_list)    # البابُ 2: رجوعُ قائمةِ الإلزامِ المضمَّنةِ إلى YAML
      printf '\nrepo-structure:\n  stage: validate\n  script:\n    - for f in README.md CODEOWNERS; do test -f "$f"; done\n' \
        >> "$R/.gitlab-ci.yml" ;;
    undeclared_af)  # البابُ 3: استثناءُ إخفاقٍ غيرُ مُعلَنٍ في الوثيقة
      printf '\nflaky-job:\n  stage: validate\n  allow_failure: true\n  script:\n    - echo maybe\n' \
        >> "$R/.gitlab-ci.yml" ;;
    orphan_guard)   # البابُ 4: حارسٌ لا يصل إليه الأمرُ الموحَّد ولا هو مُعلَن
      # اسمُ الملفِّ يُبنى في وقتِ التشغيلِ لا يُكتَب حرفيّاً: البابُ 4 يقيس الوصولَ
      # بالبحثِ النصّيِّ عن المسارِ في السكربتات، فلو كُتب المسارُ حرفيّاً هنا لَعَدَّه
      # الحارسُ «موصولاً» من حزمةِ الاختبارِ نفسِها — وهو ما وقع أوّلَ تشغيلٍ وكشفته
      # هذه الحالةُ (حدُّ الحارسِ المُعلَن: كلُّ ذكرٍ نصّيٍّ وصولٌ، تحفّظاً).
      local seg; seg="validate-$(printf orphan)-probe.sh"
      printf '#!/usr/bin/env bash\nexit 0\n' > "$R/scripts/checks/$seg" ;;
    no_anchor)      # الوثيقةُ بلا كتلةِ §4 → سقوطٌ صريحٌ لا مرورٌ بقائمةٍ فارغة
      sed -i 's|^## 4\. وظائفُ CI المسموحُ لها بالإخفاق|## 4. عنوانٌ مُغيَّرٌ|' \
        "$R/docs/00-rules/VERIFY_COMMAND.md" ;;
  esac
  printf '%s' "$R"
}

_cim() { # _cim <جذر> [سكربتٌ بديلٌ مُطفَّر]
  local root="$1" script="${2:-$CIM_SRC}"
  ( cd "$REPO_ROOT" && bash "$script" "$root" )
}

_cim_mutant() { # _cim_mutant <tag> <القديم> <الجديد> → مسارُ نسخةٍ مُطفَّرة
  local tag="$1" old="$2" new="$3"
  local M="/tmp/gov_cim_mut_$tag.sh"
  sed "s|$old|$new|" "$CIM_SRC" > "$M"
  cmp -s "$M" "$CIM_SRC" && { echo "✗ الطفرةُ $tag لم تُغيّر شيئاً — النمطُ غيرُ موجود" >&2; return 1; }
  printf '%s' "$M"
}

# (1) مرجعٌ موجبٌ — المستودعُ الحقيقيُّ نفسُه يجب أن يمرّ. ولولا هذه الحالةُ لما
# دلّت السلبيّاتُ بعدها على شيء: حارسٌ يرفض كلَّ شيءٍ «يكشف» كلَّ عيبٍ وكلَّ سليم.
cim_real() { _cim "$REPO_ROOT"; }
t "يمرّ على إعدادِ المستودعِ الحقيقيِّ كما هو" pass cim_real

# (2) جذرٌ صناعيٌّ سليمٌ يمرّ أيضاً — وإلّا كانت الحالاتُ بعدَه ترفض لأنّ الجذرَ
# صناعيٌّ لا لأنّ العيبَ فيه.
cim_ok() { _cim "$(_ci_stage ok ok)"; }
t "يمرّ على جذرٍ صناعيٍّ سليم" pass cim_ok

# (3) البابُ 1: خطٌّ لا يستدعي الأمرَ الموحَّدَ → يُرفَض. أمرٌ موحَّدٌ لا تُشغّله CI
# ليس بوّابةً بل ملفٌّ في المستودع.
cim_no_verify() { _cim "$(_ci_stage no_verify no_verify)"; }
t "يرفض خطّاً لا يستدعي الأمرَ الموحَّد" fail cim_no_verify

# (4) البابُ 1: يستدعيه في وظيفةٍ allow_failure → يُرفَض. الاستدعاءُ بلا إسقاطٍ زينة.
cim_soft() { _cim "$(_ci_stage verify_soft verify_soft)"; }
t "يرفض استدعاءَ الأمرِ الموحَّدِ في وظيفةٍ لا تُسقِط" fail cim_soft

# (5) البابُ 2: رجوعُ قائمةِ الإلزامِ المضمَّنةِ إلى YAML → يُرفَض. هذا **العيبُ
# الأصليُّ** الذي كان فرقُه 12 عنصراً عن قائمةِ البوّابة.
cim_inline() { _cim "$(_ci_stage inline_list inline_list)"; }
t "يرفض رجوعَ قائمةِ الإلزامِ المضمَّنةِ إلى YAML" fail cim_inline

# (6) البابُ 3: allow_failure غيرُ مُعلَنٍ في §4 → يُرفَض. والمُعلَنُ (markdown-lint)
# يمرُّ في الحالةِ (2) — فالفحصُ يفرّق بين استثناءٍ مقصودٍ وآخرَ صامت.
cim_undeclared() { _cim "$(_ci_stage undeclared_af undeclared_af)"; }
t "يرفض استثناءَ إخفاقٍ غيرَ مُعلَنٍ في الوثيقة" fail cim_undeclared

# (7) البابُ 4: حارسٌ يتيمٌ → يُرفَض. العيبُ المقيسُ: find-existing-work.sh لم
# تستدعِه وظيفةُ CI واحدةٌ — وهو اليومَ مُعلَنٌ في §5 لا مسكوتٌ عنه.
cim_orphan() { _cim "$(_ci_stage orphan_guard orphan_guard)"; }
t "يرفض حارساً لا يصل إليه الأمرُ الموحَّدُ ولا هو مُعلَن" fail cim_orphan

# (8) وثيقةٌ بلا كتلةِ §4 → سقوطٌ صريحٌ. ولولا هذه الحالةُ لأمكن للحارسِ أن يمرَّ
# بقائمةِ استثناءاتٍ فارغةٍ لأنّه لم يجد الكتلةَ — أخطرُ من رفضٍ خاطئٍ.
cim_no_anchor() { _cim "$(_ci_stage no_anchor no_anchor)"; }
t "يسقط صريحاً إن غابت كتلةُ §4 من الوثيقة" fail cim_no_anchor

# (9) بنيةُ المستودعِ: ملفُّ جذرٍ ناقصٌ → يُرفَض، والناقصُ كلُّه يُطبَع لا أوّلُه.
rs_missing() {
  local R="/tmp/gov_rs_missing"; rm -rf "$R"; mkdir -p "$R"
  local out rc; out="$( cd "$REPO_ROOT" && bash "$RS_SRC" "$R" 2>&1 )"; rc=$?
  (( rc != 0 )) || { echo "✗ مرَّ جذرٌ فارغٌ"; return 1; }
  grep -q 'README.md' <<< "$out" || { printf '%s\n' "$out"; echo "✗ لم يُسمِّ الناقصَ"; return 1; }
  grep -q 'TESTING_RULES.md' <<< "$out" || { printf '%s\n' "$out"; echo "✗ لم يُبلِّغ عن الوثائقِ كلِّها"; return 1; }
  return 0
}
t "بنيةُ المستودع: يرفض جذراً ناقصاً ويُسمّي كلَّ ناقصٍ" pass rs_missing

# (10) مصدرٌ واحدٌ فعلاً: عنصرٌ يُضاف إلى `required-artifacts.sh` يظهر في
# **الموضعَين** — البنيةِ والبوّابةِ — بلا تحريرِ أيٍّ منهما. وهذه الحالةُ هي التي
# تُثبت أنّ العلاجَ «مصدرٌ واحدٌ» لا «نسختانِ متطابقتانِ اليومَ».
rs_single_source() {
  local L="$REPO_ROOT/scripts/checks/lib/required-artifacts.sh"
  local M="/tmp/gov_rs_lib"; rm -rf "$M"; mkdir -p "$M/checks/lib"
  cp "$REPO_ROOT"/scripts/checks/*.sh "$M/checks/" 2>/dev/null
  cp "$REPO_ROOT"/scripts/checks/lib/* "$M/checks/lib/" 2>/dev/null
  sed -i 's|^REQUIRED_DOCS=(|REQUIRED_DOCS=(\n  "docs/00-rules/GHOST_RULE.md"|' "$M/checks/lib/required-artifacts.sh"
  local out1 out2
  out1="$( cd "$REPO_ROOT" && bash "$M/checks/validate-repo-structure.sh" "$REPO_ROOT" 2>&1 )" && {
    printf '%s\n' "$out1"; echo "✗ البنيةُ لم تر العنصرَ المُضافَ"; return 1; }
  grep -q 'GHOST_RULE.md' <<< "$out1" || { printf '%s\n' "$out1"; echo "✗ البنيةُ لم تُسمِّ العنصرَ المُضافَ"; return 1; }
  out2="$( cd "$REPO_ROOT" && bash "$M/checks/verify-governance.sh" 2>&1 )" && {
    echo "✗ البوّابةُ لم تر العنصرَ المُضافَ"; return 1; }
  grep -q 'GHOST_RULE.md' <<< "$out2" || { printf '%s\n' "$out2" | tail -5; echo "✗ البوّابةُ لم تُسمِّ العنصرَ المُضافَ"; return 1; }
  return 0
}
t "مصدرٌ واحدٌ: عنصرٌ يُضاف مرّةً يُلزِم البنيةَ والبوّابةَ معاً" pass rs_single_source

# ── اختباراتُ الطفرةِ: أربعةُ أبوابٍ، كلٌّ يُحيَّد وحدَه ───────────────────
# لا يكفي أن ترفضَ الحالاتُ: يجب أن يكون **كلُّ بابٍ** هو الذي رفض. فإن حُيِّد
# بابٌ ومرَّت حالتُه فالحالةُ كانت تحرس شيئاً آخر.
cim_mut_door1() {
  local m; m="$(_cim_mutant door1 'PROBLEMS+=("البابُ 1: لا وظيفةَ CI تستدعي' ': #')" || return 1
  _cim "$(_ci_stage no_verify no_verify)" "$m" >/dev/null 2>&1 && return 0 || return 1
}
t "البابُ 1 (مدخلٌ مُستدعىً) يكشف فعلاً" pass cim_mut_door1

cim_mut_door2() {
  local m; m="$(_cim_mutant door2 'PROBLEMS+=("البابُ 2:' ': #')" || return 1
  _cim "$(_ci_stage inline_list inline_list)" "$m" >/dev/null 2>&1 && return 0 || return 1
}
t "البابُ 2 (لا كتلةَ مضمَّنةً) يكشف فعلاً" pass cim_mut_door2

cim_mut_door3() {
  local m; m="$(_cim_mutant door3 'PROBLEMS+=("البابُ 3:' ': #')" || return 1
  _cim "$(_ci_stage undeclared_af undeclared_af)" "$m" >/dev/null 2>&1 && return 0 || return 1
}
t "البابُ 3 (لا استثناءَ صامتاً) يكشف فعلاً" pass cim_mut_door3

cim_mut_door4() {
  local m; m="$(_cim_mutant door4 'PROBLEMS+=("البابُ 4:' ': #')" || return 1
  _cim "$(_ci_stage orphan_guard orphan_guard)" "$m" >/dev/null 2>&1 && return 0 || return 1
}
t "البابُ 4 (لا حارسَ يتيماً) يكشف فعلاً" pass cim_mut_door4

printf '\n\033[1m[ي] تدقيقُ الاعتمادياتِ والثغرات (M0-06)\033[0m\n'
# الحارسُ يسأل مُسجَّلَ npm عبرَ الشبكةِ، ويقرأ `package.json` و`SECURITY_RULES.md`.
# فتُبنى له **جذورٌ صناعيّةٌ** في /tmp، ويُغذَّى **مخارجَ تدقيقٍ مُصطنَعةً** عبرَ
# `DEP_AUDIT_JSON` و`DEP_AUDIT_PROD_JSON` — فلا تُشوَّه وثيقةٌ حقيقيّةٌ، ولا تصير
# الحزمةُ رهينةَ الشبكةِ أو رهينةَ ثغرةٍ تُنشر غداً (سابقةُ M0-12).
DEP_SRC="$REPO_ROOT/scripts/checks/validate-dependency-audit.sh"

_dep_audit_fixture() { # _dep_audit_fixture <ملف> <عدد> [ghsa:module:severity ...]
  local out="$1" total="$2"; shift 2
  python3 - "$out" "$total" "$@" <<'PY'
import json, sys
out, total = sys.argv[1], int(sys.argv[2])
adv = {}
for i, spec in enumerate(sys.argv[3:], start=1):
    ghsa, module, sev = spec.split(":")
    adv[str(i)] = {"id": i, "module_name": module, "severity": sev,
                   "url": "https://github.com/advisories/" + ghsa,
                   "vulnerable_versions": "<9.9.9", "patched_versions": ">=9.9.9",
                   "title": "fixture"}
sev_count = {"info": 0, "low": 0, "moderate": 0, "high": 0, "critical": 0}
for a in adv.values():
    sev_count[a["severity"]] = sev_count.get(a["severity"], 0) + 1
if total and not adv:
    sev_count["high"] = total
json.dump({"actions": [], "advisories": adv, "muted": [],
           "metadata": {"vulnerabilities": sev_count, "dependencies": 1,
                        "devDependencies": 0, "optionalDependencies": 0,
                        "totalDependencies": 1}},
          open(out, "w", encoding="utf-8"))
PY
}

_dep_root() { # _dep_root <tag> <pm> <overrides-json> <سطورُ §11...>
  local tag="$1" pm="$2" ovr="$3"; shift 3
  local R="/tmp/gov_dep_$tag"
  rm -rf "$R"; mkdir -p "$R/docs/00-rules"
  python3 - "$R/package.json" "$pm" "$ovr" <<'PY'
import json, sys
path, pm, ovr = sys.argv[1], sys.argv[2], sys.argv[3]
d = {"name": "fixture", "private": True, "devDependencies": {}}
if pm:
    d["packageManager"] = pm
if ovr:
    d["pnpm"] = {"overrides": json.loads(ovr)}
json.dump(d, open(path, "w", encoding="utf-8"))
PY
  printf 'lockfileVersion: 9.0\n' > "$R/pnpm-lock.yaml"
  {
    printf '# قواعد الأمان — نسخةٌ صناعيّةٌ للاختبار\n\n'
    printf '## 11. اعتمادياتُ الطرفِ الثالثِ وتدقيقُ الثغرات\n\n'
    printf '```text\n'
    local line
    for line in "$@"; do printf '%s\n' "$line"; done
    printf '```\n'
  } > "$R/docs/00-rules/SECURITY_RULES.md"
  printf '%s\n' "$R"
}

_dep() { # _dep <جذر> <تدقيقُ الكل> <تدقيقُ الإنتاج> [سكربتٌ بديل]
  local root="$1" all="$2" prod="$3" script="${4:-$DEP_SRC}"
  DEP_AUDIT_JSON="$all" DEP_AUDIT_PROD_JSON="$prod" bash "$script" "$root"
}

# مخارجُ تدقيقٍ مُصطنَعةٌ: نظيفٌ · ثغرةٌ في الإنتاج · ثغرتانِ في أدواتِ التطوير.
_dep_audit_fixture /tmp/dep_clean.json 0
_dep_audit_fixture /tmp/dep_prod_vuln.json 0 "GHSA-prod-0001-aaaa:express:critical"
_dep_audit_fixture /tmp/dep_dev_vuln.json 0 "GHSA-dev-0001-bbbb:vitest:critical"

DEP_TOMORROW="$(date -u -d "$TODAY +30 days" +%Y-%m-%d)"
DEP_YESTERDAY="$(date -u -d "$TODAY -1 day" +%Y-%m-%d)"

# (1) الحالةُ الموجبةُ الكاملة: إنتاجٌ نظيفٌ · لا ثغرةَ · مديرٌ مثبَّتٌ · لا override.
R_OK="$(_dep_root ok 'pnpm@9.15.9' '' '# لا استثناءَ ولا تثبيتَ قسريّ')"
t "جذرٌ نظيفٌ يمرُّ (إنتاجٌ نقيٌّ · لا ثغرةَ · مديرٌ مثبَّتٌ)" pass \
  _dep "$R_OK" /tmp/dep_clean.json /tmp/dep_clean.json

# (2) البابُ 1: ثغرةٌ في شجرةِ الإنتاج تُسقِط ولو كانت مكتوبةً في §11 —
#     فالبابُ الأوّلُ لا استثناءَ فيه، وهذا ما يميّزه عن البابِ الثاني.
R_PROD="$(_dep_root prod 'pnpm@9.15.9' '' \
  "GHSA-prod-0001-aaaa | expires:$DEP_TOMORROW | owner:@tester | مكتوبٌ ومع ذلك يجب أن يُسقِط")"
t "ثغرةٌ في شجرةِ الإنتاجِ تُسقِط ولو كانت مُعلَنةً" fail \
  _dep "$R_PROD" /tmp/dep_prod_vuln.json /tmp/dep_prod_vuln.json

# (3) البابُ 2: ثغرةُ أداةِ تطويرٍ غيرُ مكتوبةٍ في §11 تُسقِط.
R_UNDECL="$(_dep_root undecl 'pnpm@9.15.9' '' '# لا استثناءَ')"
t "ثغرةُ تطويرٍ غيرُ مُعلَنةٍ في §11 تُسقِط" fail \
  _dep "$R_UNDECL" /tmp/dep_dev_vuln.json /tmp/dep_clean.json

# (4) البابُ 2: المكتوبةُ بمهلةٍ ساريةٍ تمرُّ — قبولُ الخطرِ آليّةٌ لا شعار.
R_DECL="$(_dep_root decl 'pnpm@9.15.9' '' \
  "GHSA-dev-0001-bbbb | expires:$DEP_TOMORROW | owner:@tester | أداةُ تطويرٍ لا تُشحَن")"
t "ثغرةُ تطويرٍ مُعلَنةٌ بمهلةٍ ساريةٍ تمرُّ" pass \
  _dep "$R_DECL" /tmp/dep_dev_vuln.json /tmp/dep_clean.json

# (5) البابُ 2: المهلةُ المنقضيةُ تُسقِط — وإلّا صار القبولُ أبديّاً بالنسيان.
R_EXP="$(_dep_root expired 'pnpm@9.15.9' '' \
  "GHSA-dev-0001-bbbb | expires:$DEP_YESTERDAY | owner:@tester | مهلةٌ انقضت أمس")"
t "قبولُ خطرٍ انقضت مهلتُه يُسقِط" fail \
  _dep "$R_EXP" /tmp/dep_dev_vuln.json /tmp/dep_clean.json

# (6) البابُ 3: مديرُ حزمٍ تقريبيٌّ يُسقِط — لأنّ كلَّ آلةٍ تحلُّ شجرةً أخرى.
R_PM="$(_dep_root pm '^pnpm@9.15.9' '' '# لا استثناءَ')"
t "packageManager غيرُ مثبَّتٍ يُسقِط" fail \
  _dep "$R_PM" /tmp/dep_clean.json /tmp/dep_clean.json

# (7) البابُ 3: غيابُ ملفِّ القفلِ يُسقِط.
R_NOLOCK="$(_dep_root nolock 'pnpm@9.15.9' '' '# لا استثناءَ')"; rm -f "$R_NOLOCK/pnpm-lock.yaml"
t "غيابُ pnpm-lock.yaml يُسقِط" fail \
  _dep "$R_NOLOCK" /tmp/dep_clean.json /tmp/dep_clean.json

# (8) البابُ 4: تثبيتٌ قسريٌّ بلا سببٍ مكتوبٍ يُسقِط ولو كان التدقيقُ نظيفاً —
#     فالنظافةُ اليومَ قد تكون بتجميدِ نسخةٍ تُثقَب غداً.
R_OVR="$(_dep_root ovr 'pnpm@9.15.9' '{"lodash":"4.17.21"}' '# لا سببَ مكتوباً')"
t "override بلا سببٍ مكتوبٍ يُسقِط ولو كان التدقيقُ نظيفاً" fail \
  _dep "$R_OVR" /tmp/dep_clean.json /tmp/dep_clean.json

# (9) البابُ 4: نفسُ التثبيتِ مع سببٍ مكتوبٍ يمرُّ.
R_OVR_OK="$(_dep_root ovrok 'pnpm@9.15.9' '{"lodash":"4.17.21"}' \
  "override:lodash | expires:$DEP_TOMORROW | owner:@tester | سببٌ مكتوبٌ ومُراجَعٌ بمهلة")"
t "override بسببٍ مكتوبٍ يمرُّ" pass \
  _dep "$R_OVR_OK" /tmp/dep_clean.json /tmp/dep_clean.json

# (10) الوثيقةُ بلا كتلةِ §11 تُسقِط — لا مرجعَ لقبولِ الخطرِ فلا حكمَ.
R_NOANCHOR="/tmp/gov_dep_noanchor"; rm -rf "$R_NOANCHOR"; mkdir -p "$R_NOANCHOR/docs/00-rules"
cp "$R_OK/package.json" "$R_NOANCHOR/package.json"; cp "$R_OK/pnpm-lock.yaml" "$R_NOANCHOR/pnpm-lock.yaml"
printf '# قواعد الأمان\n\nبلا كتلةِ §11 إطلاقاً.\n' > "$R_NOANCHOR/docs/00-rules/SECURITY_RULES.md"
t "غيابُ كتلةِ §11 من الوثيقةِ يُسقِط" fail \
  _dep "$R_NOANCHOR" /tmp/dep_clean.json /tmp/dep_clean.json

# (11) سجلٌّ بصيغةٍ خاطئةٍ في §11 يُسقِط — الصيغةُ عقدٌ يقرؤه الحارسُ حرفيّاً.
R_BAD="$(_dep_root badrow 'pnpm@9.15.9' '' 'GHSA-dev-0001-bbbb بلا مهلةٍ ولا مالكٍ')"
t "سجلُّ §11 بصيغةٍ خاطئةٍ يُسقِط" fail \
  _dep "$R_BAD" /tmp/dep_clean.json /tmp/dep_clean.json

# (12) التخطّي مُعلَنٌ بالرمزِ 2 حين لا pnpm ولا تدقيقَ جاهزاً — لا نجاحٌ كاذبٌ
#      ولا فشلٌ كاذبٌ. والفرقُ بين 0 و2 هو ما يمنع البوّابةَ من تجميلِ الجهل.
dep_skip_rc2() {
  local out rc
  out="$(env -u DEP_AUDIT_JSON -u DEP_AUDIT_PROD_JSON PATH=/usr/bin:/bin \
    bash "$DEP_SRC" "$R_OK" 2>&1)"; rc=$?
  (( rc == 2 )) || return 1
  [[ "$out" == *"لم يُسأل"* ]] || return 1
  return 0
}
t "غيابُ pnpm يُعلَن تخطّياً بالرمزِ 2 لا نجاحاً" pass dep_skip_rc2

# ── اختباراتُ الطفرةِ: أربعةُ أبوابٍ، كلٌّ يُحيَّد وحدَه ───────────────────
# لا يكفي أن ترفضَ الحالاتُ: يجب أن يكون **البابُ المقصودُ** هو الرافضَ.
_dep_mutant() { # _dep_mutant <وسم> <مرساة> <بديل> → يطبع مسارَ سكربتٍ مطفَّر
  local tag="$1" anchor="$2" repl="$3"
  local M="/tmp/gov_dep_mut_$tag.sh"
  python3 - "$DEP_SRC" "$M" "$anchor" "$repl" <<'PY'
import sys
src, dst, anchor, repl = sys.argv[1:5]
text = open(src, encoding="utf-8").read()
if anchor not in text:
    sys.exit("MISSING_ANCHOR")
open(dst, "w", encoding="utf-8").write(text.replace(anchor, repl, 1))
PY
  printf '%s\n' "$M"
}

dep_mut_door1() {
  local m; m="$(_dep_mutant door1 'PROBLEMS+=("البابُ 1:' ': #')" || return 1
  _dep "$R_PROD" /tmp/dep_prod_vuln.json /tmp/dep_prod_vuln.json "$m" >/dev/null 2>&1 && return 0 || return 1
}
t "البابُ 1 (نقاءُ الإنتاج) يكشف فعلاً" pass dep_mut_door1

dep_mut_door2() {
  local m; m="$(_dep_mutant door2 'PROBLEMS+=("البابُ 2: ثغرةٌ' ': #')" || return 1
  _dep "$R_UNDECL" /tmp/dep_dev_vuln.json /tmp/dep_clean.json "$m" >/dev/null 2>&1 && return 0 || return 1
}
t "البابُ 2 (كلُّ ثغرةٍ مُعلَنةٌ) يكشف فعلاً" pass dep_mut_door2

dep_mut_expiry() {
  local m; m="$(_dep_mutant expiry 'PROBLEMS+=("البابُ 2: قبولُ الخطرِ' ': #')" || return 1
  _dep "$R_EXP" /tmp/dep_dev_vuln.json /tmp/dep_clean.json "$m" >/dev/null 2>&1 && return 0 || return 1
}
t "شرطُ انقضاءِ المهلةِ يكشف فعلاً" pass dep_mut_expiry

dep_mut_door3() {
  local m; m="$(_dep_mutant door3 'PROBLEMS+=("البابُ 3: packageManager' ': #')" || return 1
  _dep "$R_PM" /tmp/dep_clean.json /tmp/dep_clean.json "$m" >/dev/null 2>&1 && return 0 || return 1
}
t "البابُ 3 (مديرُ حزمٍ مثبَّتٌ) يكشف فعلاً" pass dep_mut_door3

dep_mut_door4() {
  local m; m="$(_dep_mutant door4 'PROBLEMS+=("البابُ 4:' ': #')" || return 1
  _dep "$R_OVR" /tmp/dep_clean.json /tmp/dep_clean.json "$m" >/dev/null 2>&1 && return 0 || return 1
}
t "البابُ 4 (تثبيتٌ قسريٌّ مُبرَّرٌ) يكشف فعلاً" pass dep_mut_door4

printf '\n\033[1m[ك] سجلُّ المخاطرِ والاستثناءات (M0-07)\033[0m\n'
# الحارسُ يقرأ ثلاثَ وثائقَ (السجلُّ · `SECURITY_RULES.md` §11 · اللوحةُ) ويقارن
# تواريخَ بتاريخِ اليوم. فتُبنى له **جذورٌ صناعيّةٌ كاملةٌ** في /tmp ويُثبَّت «اليومُ»
# بـ`RISK_TODAY` — فلا تُشوَّه وثيقةٌ حقيقيّةٌ، ولا تصير الحالاتُ كاذبةً بمرورِ
# الوقتِ حينَ تنقضي مهلةُ مراجعةٍ حقيقيّةٍ (سابقةُ M0-12).
RISK_SRC="$REPO_ROOT/scripts/checks/validate-risk-register.sh"
RISK_ANCHOR='## 3. السجلُّ (كتلةٌ مقروءةٌ آليّاً — يقرؤها الحارسُ)'
SEC_ANCHOR='## 11. اعتمادياتُ الطرفِ الثالثِ وتدقيقُ الثغرات'

_risk_root() { # _risk_root <tag> <orphan:yes|no> <sec-lines-count> <سطورُ §11...> -- <سطورُ السجلّ...>
  local tag="$1" orphan="$2"; shift 2
  local R="/tmp/gov_risk_$tag"
  rm -rf "$R"; mkdir -p "$R/docs/00-rules" "$R/docs/07-security" "$R/docs/16-progress"
  local sec=() reg=() seen=0 a
  for a in "$@"; do
    if [[ "$a" == "--" ]]; then seen=1; continue; fi
    if (( seen )); then reg+=("$a"); else sec+=("$a"); fi
  done
  printf '# أمرُ التحقّقِ — نسخةٌ صناعيّةٌ\n' > "$R/docs/00-rules/VERIFY_COMMAND.md"
  {
    printf '# قواعدُ الأمان — نسخةٌ صناعيّةٌ\n\n'
    [[ "$orphan" == "no" ]] && printf 'انظر [RISK_REGISTER.md](../07-security/RISK_REGISTER.md).\n\n'
    printf '%s\n\n' "$SEC_ANCHOR"
    printf '```text\n'
    for a in "${sec[@]}"; do printf '%s\n' "$a"; done
    printf '```\n'
  } > "$R/docs/00-rules/SECURITY_RULES.md"
  {
    printf '# اللوحةُ — نسخةٌ صناعيّةٌ\n\n'
    [[ "$orphan" == "no" ]] && printf '| M0-07 | سجل المخاطر | انظر docs/07-security/RISK_REGISTER.md |\n'
  } > "$R/docs/16-progress/LAUNCH_EXECUTION_BOARD.md"
  {
    printf '# RISK_REGISTER — نسخةٌ صناعيّةٌ\n\n'
    printf '%s\n\n' "$RISK_ANCHOR"
    printf '```text\n'
    for a in "${reg[@]}"; do printf '%s\n' "$a"; done
    printf '```\n'
  } > "$R/docs/07-security/RISK_REGISTER.md"
  printf '%s\n' "$R"
}

_risk() { # _risk <جذر> [today] [سكربت]
  local root="$1" today="${2:-2026-08-27}" script="${3:-$RISK_SRC}"
  RISK_TODAY="$today" bash "$script" "$root"
}

GOOD_ROW='RISK-0001 | sev:high | owner:@uxxxu | opened:2026-08-27 | review:2026-09-30 | status:open | ref:docs/00-rules/VERIFY_COMMAND.md | خطرٌ صناعيٌّ للاختبار'
R_OK="$(_risk_root ok no -- "$GOOD_ROW")"
t "سجلٌّ سليمٌ بمالكٍ ومهلةٍ ساريةٍ يمرّ" pass _risk "$R_OK"

# ── البابُ 1: الصيغةُ والمرجعُ الحيُّ ────────────────────────────────────
R_NOFILE="$(_risk_root nofile no -- "$GOOD_ROW")"; rm -f "$R_NOFILE/docs/07-security/RISK_REGISTER.md"
t "غيابُ ملفِّ السجلِّ يُسقِط" fail _risk "$R_NOFILE"

R_NOANCH="$(_risk_root noanchor no -- "$GOOD_ROW")"
python3 -c 'import sys;p=sys.argv[1];t=open(p,encoding="utf-8").read();open(p,"w",encoding="utf-8").write(t.replace(sys.argv[2],"## 3. السجل"))' \
  "$R_NOANCH/docs/07-security/RISK_REGISTER.md" "$RISK_ANCHOR"
t "غيابُ المرساةِ الحرفيّةِ يُسقِط" fail _risk "$R_NOANCH"

R_EMPTY="$(_risk_root empty no -- '# لا صفوفَ هنا')"
t "كتلةٌ بلا سطرِ خطرٍ واحدٍ تُسقِط" fail _risk "$R_EMPTY"

R_BADID="$(_risk_root badid no -- 'RISK-1 | sev:high | owner:@u | opened:2026-08-27 | review:2026-09-30 | status:open | ref:docs/00-rules/VERIFY_COMMAND.md | عنوان')"
t "معرِّفٌ بغيرِ أربعةِ أرقامٍ يُسقِط" fail _risk "$R_BADID"

R_BADSEV="$(_risk_root badsev no -- 'RISK-0001 | sev:urgent | owner:@u | opened:2026-08-27 | review:2026-09-30 | status:open | ref:docs/00-rules/VERIFY_COMMAND.md | عنوان')"
t "شدّةٌ خارجَ المفرداتِ الأربعِ تُسقِط" fail _risk "$R_BADSEV"

R_NOOWN="$(_risk_root noowner no -- 'RISK-0001 | sev:high | owner:uxxxu | opened:2026-08-27 | review:2026-09-30 | status:open | ref:docs/00-rules/VERIFY_COMMAND.md | عنوان')"
t "مالكٌ بلا مقبضِ @ يُسقِط" fail _risk "$R_NOOWN"

R_BADOPEN="$(_risk_root badopen no -- 'RISK-0001 | sev:high | owner:@u | opened:27-08-2026 | review:2026-09-30 | status:open | ref:docs/00-rules/VERIFY_COMMAND.md | عنوان')"
t "تاريخُ فتحٍ بغيرِ YYYY-MM-DD يُسقِط" fail _risk "$R_BADOPEN"

R_BADREV="$(_risk_root badrev no -- 'RISK-0001 | sev:high | owner:@u | opened:2026-08-27 | review:soon | status:open | ref:docs/00-rules/VERIFY_COMMAND.md | عنوان')"
t "تاريخُ مراجعةٍ غيرُ تاريخٍ يُسقِط" fail _risk "$R_BADREV"

R_BADST="$(_risk_root badstatus no -- 'RISK-0001 | sev:high | owner:@u | opened:2026-08-27 | review:2026-09-30 | status:maybe | ref:docs/00-rules/VERIFY_COMMAND.md | عنوان')"
t "حالٌ خارجَ المفرداتِ الأربعِ تُسقِط" fail _risk "$R_BADST"

R_NOREF="$(_risk_root noref no -- 'RISK-0001 | sev:high | owner:@u | opened:2026-08-27 | review:2026-09-30 | status:open | ref: | عنوان')"
t "خطرٌ بلا مرجعٍ يُسقِط" fail _risk "$R_NOREF"

R_DEADREF="$(_risk_root deadref no -- 'RISK-0001 | sev:high | owner:@u | opened:2026-08-27 | review:2026-09-30 | status:open | ref:docs/00-rules/NOT_THERE.md | عنوان')"
t "مرجعٌ لا وجودَ له (حكايةٌ لا دليلٌ) يُسقِط" fail _risk "$R_DEADREF"

R_HTTPREF="$(_risk_root httpref no -- 'RISK-0001 | sev:high | owner:@u | opened:2026-08-27 | review:2026-09-30 | status:open | ref:https://gitlab.com/uxxxu/wasla/-/pipelines | عنوان')"
t "مرجعٌ رابطٌ صريحٌ مقبولٌ" pass _risk "$R_HTTPREF"

R_NOTITLE="$(_risk_root notitle no -- 'RISK-0001 | sev:high | owner:@u | opened:2026-08-27 | review:2026-09-30 | status:open | ref:docs/00-rules/VERIFY_COMMAND.md |')"
t "خطرٌ بلا عنوانٍ يشرحه يُسقِط" fail _risk "$R_NOTITLE"

R_DUP="$(_risk_root dup no -- "$GOOD_ROW" "$GOOD_ROW")"
t "معرِّفٌ مُكرَّرٌ يُسقِط" fail _risk "$R_DUP"

# ── البابُ 2: المهلةُ تنتهي ──────────────────────────────────────────────
t "مهلةُ مراجعةٍ منقضيةٌ تُسقِط" fail _risk "$R_OK" 2026-10-01
R_CLOSED="$(_risk_root closed no -- 'RISK-0001 | sev:high | owner:@u | opened:2026-01-01 | review:2026-02-01 | status:closed | ref:docs/00-rules/VERIFY_COMMAND.md | خطرٌ زالَ سببُه')"
t "خطرٌ مُغلَقٌ لا تُحاسَب مهلتُه" pass _risk "$R_CLOSED" 2026-10-01
t "مهلةٌ تنتهي اليومَ نفسَه ما زالت ساريةً" pass _risk "$R_OK" 2026-09-30

# ── البابُ 3: لا استثناءَ بلا خطرٍ مُسجَّلٍ ─────────────────────────────────
OVR='override:vitest | expires:2026-11-25 | owner:@uxxxu | سببٌ صناعيّ'
ACC_ROW='RISK-0004 | sev:medium | owner:@u | opened:2026-08-27 | review:2026-11-01 | status:mitigating | ref:docs/00-rules/SECURITY_RULES.md | تثبيتٌ قسريٌّ مؤقّت'
R_ORPHEXC="$(_risk_root orphexc no "$OVR" -- "$GOOD_ROW")"
t "استثناءٌ في §11 بلا خطرٍ مُسجَّلٍ يُسقِط" fail _risk "$R_ORPHEXC"

R_MATCHED="$(_risk_root matched no "$OVR" -- "$GOOD_ROW" "$ACC_ROW" 'exception:override:vitest | risk:RISK-0004')"
t "استثناءٌ مقابَلٌ بخطرٍ قائمٍ يمرّ" pass _risk "$R_MATCHED"

R_GHSA="$(_risk_root ghsa no 'GHSA-aaaa-bbbb-cccc | expires:2026-11-25 | owner:@u | سببٌ' -- "$GOOD_ROW" "$ACC_ROW" 'exception:GHSA-aaaa-bbbb-cccc | risk:RISK-0004')"
t "استثناءُ GHSA مقابَلٌ يمرّ" pass _risk "$R_GHSA"

R_GHOST="$(_risk_root ghost no "$OVR" -- "$GOOD_ROW" 'exception:override:vitest | risk:RISK-0099')"
t "مقابلةٌ إلى خطرٍ لا وجودَ له تُسقِط" fail _risk "$R_GHOST"

R_EXCCLOSED="$(_risk_root excclosed no "$OVR" -- "$GOOD_ROW" 'RISK-0004 | sev:medium | owner:@u | opened:2026-08-27 | review:2026-11-01 | status:closed | ref:docs/00-rules/SECURITY_RULES.md | أُغلِق' 'exception:override:vitest | risk:RISK-0004')"
t "استثناءٌ قائمٌ وخطرُه مُغلَقٌ يُسقِط" fail _risk "$R_EXCCLOSED"

R_LATE="$(_risk_root late no "$OVR" -- "$GOOD_ROW" 'RISK-0004 | sev:medium | owner:@u | opened:2026-08-27 | review:2026-12-01 | status:mitigating | ref:docs/00-rules/SECURITY_RULES.md | مراجعةٌ متأخّرةٌ' 'exception:override:vitest | risk:RISK-0004')"
t "مراجعةٌ بعدَ انتهاءِ الاستثناءِ تُسقِط" fail _risk "$R_LATE"

R_SAME="$(_risk_root sameday no "$OVR" -- "$GOOD_ROW" 'RISK-0004 | sev:medium | owner:@u | opened:2026-08-27 | review:2026-11-25 | status:mitigating | ref:docs/00-rules/SECURITY_RULES.md | مراجعةٌ يومَ الانتهاءِ' 'exception:override:vitest | risk:RISK-0004')"
t "مراجعةٌ يومَ انتهاءِ الاستثناءِ مقبولةٌ" pass _risk "$R_SAME"

R_BADEXC="$(_risk_root badexc no "$OVR" -- "$GOOD_ROW" "$ACC_ROW" 'exception:override:vitest | RISK-0004')"
t "سطرُ مقابلةٍ بصيغةٍ خاطئةٍ يُسقِط" fail _risk "$R_BADEXC"

# ── البابُ 4: لا سجلَّ يتيماً ─────────────────────────────────────────────
R_ORPHAN="$(_risk_root orphan yes -- "$GOOD_ROW")"
t "سجلٌّ لا يُحال إليه من اللوحةِ وقواعدِ الأمانِ يُسقِط" fail _risk "$R_ORPHAN"

# ── اختباراتُ الطفرةِ: كلُّ بابٍ يكشف بنفسِه ───────────────────────────────
_risk_mutant() { # _risk_mutant <وسم> <مرساة> <بديل> → مسارُ سكربتٍ مطفَّر
  local tag="$1" anchor="$2" repl="$3"
  local M="/tmp/gov_risk_mut_$tag.sh"
  python3 - "$RISK_SRC" "$M" "$anchor" "$repl" <<'PY'
import sys
src, dst, anchor, repl = sys.argv[1:5]
text = open(src, encoding="utf-8").read()
if anchor not in text:
    sys.exit("MISSING_ANCHOR")
open(dst, "w", encoding="utf-8").write(text.replace(anchor, repl, 1))
PY
  printf '%s\n' "$M"
}

risk_mut_door2() { # لو أُبطِل بابُ المهلةِ لمرَّ سجلٌّ منقضيةٌ مهلتُه
  local m; m="$(_risk_mutant door2 'PROBLEMS+=("البابُ 2:' ': #')" || return 1
  _risk "$R_OK" 2026-10-01 "$m" >/dev/null 2>&1 && return 0 || return 1
}
t "البابُ 2 (المهلةُ تنتهي) يكشف فعلاً" pass risk_mut_door2

risk_mut_door3() { # لو أُبطِل بابُ المقابلةِ لمرَّ استثناءٌ بلا خطرٍ مُسجَّل
  local m; m="$(_risk_mutant door3 'PROBLEMS+=("البابُ 3: الاستثناءُ' ': #')" || return 1
  _risk "$R_ORPHEXC" 2026-08-27 "$m" >/dev/null 2>&1 && return 0 || return 1
}
t "البابُ 3 (لا استثناءَ بلا خطرٍ) يكشف فعلاً" pass risk_mut_door3

risk_mut_door4() { # لو أُبطِل بابُ اليُتمِ لمرَّ سجلٌّ لا يُحال إليه
  local m; m="$(_risk_mutant door4 'PROBLEMS+=("البابُ 4:' ': #')" || return 1
  _risk "$R_ORPHAN" 2026-08-27 "$m" >/dev/null 2>&1 && return 0 || return 1
}
t "البابُ 4 (لا سجلَّ يتيماً) يكشف فعلاً" pass risk_mut_door4

# والسجلُّ الحقيقيُّ في المستودعِ يمرُّ حارسَه بلا تشويهٍ — فالحزمةُ تُثبِت
# الحارسَ على الصناعيِّ **وتُثبِت الحقيقيَّ على الحارس**.
t "السجلُّ الحقيقيُّ في المستودعِ يمرُّ" pass bash "$RISK_SRC" "$REPO_ROOT"

# ── إصلاحُ الإيجابيّةِ الكاذبةِ في فحصِ الأسرار (M0-07) ────────────────────
# النمطُ القديمُ `sk-[0-9A-Za-z]` بلا حدِّ كلمةٍ طابقَ `risk-register` فأسقطَ
# البوّابةَ على ملفٍّ سليمٍ. والحالتانِ أدناه تُثبِتان الحدَّين معاً: لا صراخَ على
# اسمٍ مشروعٍ، **ولا صمتَ** عن توقيعٍ حقيقيّ.
SEC_SCAN="$REPO_ROOT/scripts/checks/scan-secrets.sh"

_secret_root() { # _secret_root <tag> <سطرُ المحتوى>
  local tag="$1" body="$2"
  local R="/tmp/gov_secret_$tag"
  rm -rf "$R"; mkdir -p "$R"
  printf '%s\n' "$body" > "$R/file.md"
  ( cd "$R" && git init -q -b main && git config user.email t@t.t && git config user.name t \
    && git add -A && git commit -qm x ) >/dev/null 2>&1
  printf '%s\n' "$R"
}

_scan() { ( cd "$1" && bash "$SEC_SCAN" ); }

R_SEC_OK="$(_secret_root ok 'راجع scripts/checks/validate-risk-register.sh و docs/07-security/RISK_REGISTER.md')"
t "اسمٌ فيه risk- لا يُعَدُّ سرّاً (إيجابيّةٌ كاذبةٌ زالت)" pass _scan "$R_SEC_OK"

# تُركَّب التوقيعاتُ من شِقَّين كي لا يوجدَ توقيعٌ كاملٌ حرفيّاً في ملفٍّ متتبَّعٍ،
# فيصير الفحصُ السادسُ يُسقِط حزمةَ اختبارِه نفسَها (وهذا ما حدثَ فعلاً قبلَ التقسيم).
R_SEC_BAD="$(_secret_root bad "OPENAI=sk-$(printf 'abcdefghijklmnopqrstuvwxyz0123')")"
t "توقيعُ مفتاحٍ حقيقيِّ الطولِ ما زال يُكشَف" fail _scan "$R_SEC_BAD"

R_SEC_AWS="$(_secret_root aws "AWS=AKIA$(printf 'ABCDEFGHIJKLMNOP')")"
t "توقيعُ AKIA ما زال يُكشَف" fail _scan "$R_SEC_AWS"

R_SEC_PAT="$(_secret_root pat "TOKEN=glpat-$(printf 'abcdefghijklmnopqrst')")"
t "توقيعُ glpat ما زال يُكشَف" fail _scan "$R_SEC_PAT"

printf '\n\033[1m[ل] الأساسُ الآليُّ للبيئةِ والاختبارات (M0-08)\033[0m\n'
# الحارسُ يقيس الشجرةَ **حيّاً** ويقارنها بأساسٍ مُلتزَمٍ. فلا يكفي أن تُبنى له
# وثائقُ نصٍّ: يُبنى **مستودعٌ صناعيٌّ كاملٌ** في /tmp (git حقيقيٌّ لالتزامٍ من 40
# محرفاً · قفلٌ · حزمةٌ · CI · بوّابةٌ · سجلُّ مخاطرَ)، ثمَّ يُولَّد أساسُه بالمولِّدِ
# نفسِه فيصير الحيُّ مطابقاً بالبناءِ لا بالحظِّ — وبعدَها تُطفَّر الحالاتُ واحدةً
# واحدةً. والوقتُ مُثبَّتٌ بـ`BASELINE_STAMP` فلا تصير الحالةُ كاذبةً بمرورِ الأيّام.
BASE_SRC="$REPO_ROOT/scripts/checks/validate-baseline.sh"
BASE_GEN="$REPO_ROOT/scripts/baseline.sh"

_base_root() { # _base_root <tag> [orphan:yes|no]
  local tag="$1"
  local orphan="${2:-no}"
  local R="/tmp/gov_base_$tag"
  rm -rf "$R"
  mkdir -p "$R/docs/12-testing" "$R/docs/16-progress" "$R/docs/00-rules" \
           "$R/docs/07-security" "$R/scripts/checks/lib"
  cp "$REPO_ROOT/scripts/checks/lib/baseline_canon.py" "$R/scripts/checks/lib/"
  printf 'lockfileVersion: 9.0\nimporters:\n  .: {}\n' > "$R/pnpm-lock.yaml"
  printf '{"name":"synthetic","scripts":{"typecheck":"tsc","test":"vitest"}}\n' > "$R/package.json"
  printf 'stages:\n  - test\nunit:\n  script: echo 1\n' > "$R/.gitlab-ci.yml"
  printf '# بوّابةٌ صناعيّةٌ\n# ── 1) أوّلُ فحصٍ ───\n# ── 2) ثانيها ───\n' > "$R/scripts/checks/verify-governance.sh"
  printf 'RISK-0001 | sev:low | owner:@u | opened:2026-08-28 | review:2026-09-28 | status:open | ref:package.json | خطرٌ صناعيٌّ\n' > "$R/docs/07-security/RISK_REGISTER.md"
  printf '# صيغةُ الأساسِ — نسخةٌ صناعيّةٌ\n' > "$R/docs/12-testing/BASELINE_FORMAT.md"
  # الأساسُ المُلتزَمُ ومُخلَّفاتُ python تُستثنى في الجذرِ الصناعيِّ: تُنسَخُ **بعدَ**
  # الالتزامِ فتُقرأ الشجرةُ «مُعدَّلةً» فيُسقِطها البابُ الرابعُ بلا سببٍ مكتوبٍ.
  printf '__pycache__/\ndocs/12-testing/BASELINE.json\n' > "$R/.gitignore"
  if [[ "$orphan" == "no" ]]; then
    printf '| M0-08 | أساسٌ آليٌّ | انظر docs/12-testing/BASELINE.json |\n' > "$R/docs/16-progress/LAUNCH_EXECUTION_BOARD.md"
    printf 'مجموعةُ الأدوات: BASELINE.json\n' > "$R/docs/00-rules/VERIFY_COMMAND.md"
  else
    printf '| M0-08 | أساسٌ آليٌّ | لا إحالةَ |\n' > "$R/docs/16-progress/LAUNCH_EXECUTION_BOARD.md"
    printf 'مجموعةُ الأدوات: لا إحالةَ\n' > "$R/docs/00-rules/VERIFY_COMMAND.md"
  fi
  ( cd "$R" && git init -q . && git add -A >/dev/null 2>&1 \
    && git -c user.email=t@t -c user.name=t commit -q -m synthetic >/dev/null 2>&1 ) || true
  # السجلُّ **خارجَ** الجذرِ: ملفٌّ غيرُ مُتتبَّعٍ داخلَه يجعل الشجرةَ «مُعدَّلةً»
  # فيُسقِطها البابُ الرابعُ بلا سببٍ مكتوبٍ — وهو عيبٌ وقعَ في أوّلِ تشغيلٍ.
  local LOGF="/tmp/gov_base_${tag}.log"
  printf 'Test Files  7 passed (7)\nTests  99 passed (99)\nالنتيجة: 12 ناجح · 0 فاشل\n' > "$LOGF"
  printf 'التحقّقُ الموحَّد: كلُّ الفحوصِ المُنفَّذةِ نجحت\n' >> "$LOGF"
  PYTHONDONTWRITEBYTECODE=1 BASELINE_ROOT="$R" BASELINE_STAMP="2026-08-28T00:00:00Z" \
    bash "$BASE_GEN" --log "$LOGF" --stdout > "/tmp/gov_base_${tag}.json" 2>/dev/null
  cp "/tmp/gov_base_${tag}.json" "$R/docs/12-testing/BASELINE.json"
  printf '%s\n' "$R"
}

_base_mut() { # _base_mut <جذر> <تعبيرُ python على المتغيّر d>
  python3 - "$1/docs/12-testing/BASELINE.json" "$2" <<'PYX'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
exec(sys.argv[2])
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PYX
}

B_OK="$(_base_root ok)"
t "أساسٌ مُولَّدٌ من الشجرةِ نفسِها يمرّ" pass bash "$BASE_SRC" "$B_OK"

# ── البابُ 1: الصيغةُ والاتّساقُ الذاتيُّ ──────────────────────────────────
B_NOFILE="$(_base_root nofile)"; rm -f "$B_NOFILE/docs/12-testing/BASELINE.json"
t "غيابُ الأساسِ المُلتزَمِ يُسقِط" fail bash "$BASE_SRC" "$B_NOFILE"

B_BADJSON="$(_base_root badjson)"; printf 'ليس JSON\n' > "$B_BADJSON/docs/12-testing/BASELINE.json"
t "أساسٌ ليس JSON صالحاً يُسقِط" fail bash "$BASE_SRC" "$B_BADJSON"

B_SCHEMA="$(_base_root schema)"; _base_mut "$B_SCHEMA" 'd["schema"]="wasla.baseline/v99"'
t "مُعرِّفُ صيغةٍ مخالفٌ يُسقِط" fail bash "$BASE_SRC" "$B_SCHEMA"

B_MISS="$(_base_root misscounter)"; _base_mut "$B_MISS" 'd["static"].pop("ci_jobs")'
t "عدَّادٌ ساكنٌ محذوفٌ يُسقِط" fail bash "$BASE_SRC" "$B_MISS"

B_TYPE="$(_base_root badtype)"; _base_mut "$B_TYPE" 'd["static"]["packages"]="أربعون"'
t "عدَّادٌ ليس عدداً صحيحاً يُسقِط" fail bash "$BASE_SRC" "$B_TYPE"

B_NOENV="$(_base_root noenv)"; _base_mut "$B_NOENV" 'd["env"]["node"]=""'
t "بيئةٌ بلا إصدارِ node تُسقِط" fail bash "$BASE_SRC" "$B_NOENV"

B_HAND="$(_base_root handedited)"; _base_mut "$B_HAND" 'd["static"]["test_files_tracked"]=999'
t "عدَّادٌ حُرِّر بيدٍ بلا إعادةِ بصمٍ يُسقِط (البصمةُ تكشفه)" fail bash "$BASE_SRC" "$B_HAND"

B_FP="$(_base_root badfp)"; _base_mut "$B_FP" 'd["fingerprint"]="sha256:"+"0"*64'
t "بصمةٌ مُلفَّقةٌ تُسقِط" fail bash "$BASE_SRC" "$B_FP"

# ── البابُ 2: لا انحدارَ صامتاً ───────────────────────────────────────────
B_REG="$(_base_root regression)"; rm -f "$B_REG/package.json"
t "حذفُ حزمةٍ من الشجرةِ يُسقِط (انحدارٌ حيٌّ ضدّ الأساسِ)" fail bash "$BASE_SRC" "$B_REG"

B_ADD="$(_base_root added)"
mkdir -p "$B_ADD/svc" && printf 'export const x=1;\n' > "$B_ADD/svc/a.test.ts"
t "إضافةُ ملفِّ اختبارٍ بلا إعادةِ توليدٍ تُسقِط" fail bash "$BASE_SRC" "$B_ADD"

B_LOCK="$(_base_root lockchange)"; printf 'lockfileVersion: 9.0\n# تغيَّر\n' > "$B_LOCK/pnpm-lock.yaml"
t "تغيُّرُ بصمةِ ملفِّ القفلِ يُسقِط" fail bash "$BASE_SRC" "$B_LOCK"

# ── البابُ 3: التكرارُ يُثبَت لا يُدَّعى ────────────────────────────────────
B_VOL="$(_base_root volatile)"
_base_mut "$B_VOL" 'd["generated_at"]="1999-01-01T00:00:00Z"; d["env"]["python"]="0.0.0"'
t "تغيُّرُ الوقتِ والبيئةِ وحدَهما لا يُسقِط (وإلّا استحالَ التكرارُ)" pass bash "$BASE_SRC" "$B_VOL"

# ── البابُ 4: لا أساسَ يتيماً ولا مُجمِّلاً ─────────────────────────────────
B_NOFMT="$(_base_root nofmt)"; rm -f "$B_NOFMT/docs/12-testing/BASELINE_FORMAT.md"
t "أساسٌ بلا صيغةٍ موثَّقةٍ يُسقِط" fail bash "$BASE_SRC" "$B_NOFMT"

B_ORPH="$(_base_root orphan yes)"
t "أساسٌ لا تُحيل إليه اللوحةُ ولا أمرُ التحقّقِ يُسقِط" fail bash "$BASE_SRC" "$B_ORPH"

B_NODYN="$(_base_root nodyn)"
PYTHONDONTWRITEBYTECODE=1 BASELINE_ROOT="$B_NODYN" BASELINE_STAMP="2026-08-28T00:00:00Z" \
  bash "$BASE_GEN" --stdout > /tmp/gov_base_nodyn2.json 2>/dev/null
cp /tmp/gov_base_nodyn2.json "$B_NODYN/docs/12-testing/BASELINE.json"
t "أساسٌ بلا أرقامٍ حركيّةٍ مقيسةٍ يُسقِط (measured=false)" fail bash "$BASE_SRC" "$B_NODYN"

# حكمُ التحقّقِ يُشترط **تسجيلُه** لا خُضرتُه: شرطُ الخُضرةِ حلقةٌ مفرغةٌ لا
# تُكسَر إلّا بتلفيقٍ — وقعت فعلاً في M0-08 (انظر رأسَ الحارس).
B_FAILSUITE="$(_base_root failsuite)"; _base_mut "$B_FAILSUITE" 'd["dynamic"]["governance_suite_failed"]=1'
t "أساسٌ مُثبَّتٌ على حزمةٍ فيها إخفاقٌ مُسجَّلٌ يمرّ (لا حلقةَ مفرغةً)" pass bash "$BASE_SRC" "$B_FAILSUITE"

B_NOGSF="$(_base_root nogsf)"; _base_mut "$B_NOGSF" 'd["dynamic"]["governance_suite_failed"]=None'
t "عددُ إخفاقاتِ الحزمةِ غيرُ مُسجَّلٍ يُسقِط" fail bash "$BASE_SRC" "$B_NOGSF"

B_NOTPASS="$(_base_root notpassed)"; _base_mut "$B_NOTPASS" 'd["dynamic"]["verify_overall"]=None'
t "حكمُ التحقّقِ مجهولاً يُسقِط" fail bash "$BASE_SRC" "$B_NOTPASS"

B_DIRTY="$(_base_root dirtyreason)"
_base_mut "$B_DIRTY" 'd["repo"]["dirty"]=True; d["repo"]["dirty_files"]=3; d["repo"]["dirty_reason"]=""'
t "شجرةٌ مُعدَّلةٌ بلا سببٍ مكتوبٍ تُسقِط" fail bash "$BASE_SRC" "$B_DIRTY"

B_DIRTYOK="$(_base_root dirtyok)"
_base_mut "$B_DIRTYOK" 'd["repo"]["dirty"]=True; d["repo"]["dirty_files"]=3; d["repo"]["dirty_reason"]="نسخةُ اختبارٍ صناعيّةٌ"'
t "شجرةٌ مُعدَّلةٌ بسببٍ مُعلَنٍ تمرّ" pass bash "$BASE_SRC" "$B_DIRTYOK"

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
