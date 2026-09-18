# gov-cases-branch-freshness.sh — حالاتُ طفرةٍ للفحصِ 23 (نضارةُ الفروعِ على المنصّةِ · M0-44).
#
# تُستدعى من `scripts/checks/test-governance.sh` وهيَ تعملُ في نسخةِ `/tmp`
# (المتغيّرُ `$T`) لا في المستودعِ الأصلي. وتعتمدُ على `t()` المُعرَّفةِ هناك.
#
# ── القاعدةُ التي تفرضُها هذهِ الحالاتُ ────────────────────────────────────
# حارسٌ لم تُثبَتْ **عضّتُهُ** ليسَ حارساً بل زينةٌ خضراءُ. فلكلِّ بابٍ من أبوابِ
# هذا الفحصِ طفرةٌ واحدةٌ على الأقلِّ **يجبُ أن تُسقِطَهُ**، وطفرةٌ تُسقِطُهُ
# لا تكفي وحدَها: يُعادُ الأصلُ بعدَ كلِّ واحدةٍ ويُثبَتُ أنَّهُ يمرُّ — وإلّا
# فقد يكونُ الحارسُ ساقطاً دائماً لا عاضّاً.
#
# والقاعدةُ نفسُها لها **وجهٌ سالبٌ**: الفروعُ المُعلَنةُ كأدلّةٍ يجبُ أن تمرَّ
# — وإلّا كانَ الحارسُ يُدينُ المشروعَ فيُشترى صمتُهُ بتعطيلِهِ.
#
# المرجع: docs/07-security/RISK_REGISTER.md (RISK-0045)

printf '\n\033[1m[ق] حارسُ نضارةِ الفروعِ على المنصّةِ (M0-44 · الفحصُ 23)\033[0m\n'

BFG=scripts/checks/validate-platform-branch-freshness.sh
BFG_EVIDENCE=docs/16-progress/BRANCH_EVIDENCE.md

if [[ ! -f "$BFG" ]]; then
  printf '  \033[31m✗\033[0m %s مفقودٌ — لا تُقاسُ عضّةُ حارسٍ غائبٍ\n' "$BFG"
  ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

if [[ ! -f "$BFG_EVIDENCE" ]]; then
  printf '  \033[31m✗\033[0m %s مفقودٌ — لا يُقاسُ الحارسُ بلا سجلِّ أدلّةٍ\n' "$BFG_EVIDENCE"
  ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

# نُنشئ ملفَ فروعٍ وهميًّا لاختبارِ الحارسِ في /tmp — فالحارسُ يقرأُ الفروعَ من
# المنصّةِ أو من ``WASLA_BRANCHES_FILE``.
BFG_BRANCHES_FILE=/tmp/bfg_branches.txt
BFG_BACKUP=/tmp/bfg_backup
rm -rf "$BFG_BACKUP"; mkdir -p "$BFG_BACKUP"
cp "$BFG_EVIDENCE" "$BFG_BACKUP/evidence"

_bfg_restore() {
  cp "$BFG_BACKUP/evidence" "$BFG_EVIDENCE"
}

# فروعٌ وهميّةٌ: ``main`` + ثلاثةٌ مُعلَنةٌ في الأدلّةِ + فرعٌ بائتٌ.
# نُضيفُ الفرعَ البائتَ إلى الأدلّةِ أوّلًا ليكونَ الخطُّ الأساسيُّ أخضرَ.
cat > "$BFG_BRANCHES_FILE" <<'EOF'
main
probe/m0-22a-red-merge-attempt
probe/m0-22e-required-checks-red
probe/risk-0022-red-proof
feat/fake-stale-branch
EOF

# نُضيفُ الفرعَ البائتَ إلى الأدلّةِ ليجتازَ الخطُّ الأساسيُّ.
printf '| feat/fake-stale-branch | فرعٌ وهميٌّ لاختبارِ الطفرةِ | 2026-09-18 |\n' >> "$BFG_EVIDENCE"

# ── الأصلُ يمرُّ — وبلا هذا لا معنى لأيِّ إخفاقٍ بعدَهُ.
t "الحالةُ الأصليّةُ تمرُّ (خطُّ الأساسِ)" pass \
  env WASLA_BRANCHES_FILE="$BFG_BRANCHES_FILE" bash "$BFG"

# ── البابُ 1: حذفُ الفرعِ من الأدلّةِ مع وجودِهِ على المنصّةِ يُسقِطُ الحارسَ ──
# ``feat/fake-stale-branch`` موجودٌ في الفروعِ لكن نحذفُهُ من الأدلّةِ — يجبُ أن
# يُسقِطَ الحارسَ.
python3 -c "
with open('$BFG_EVIDENCE') as f:
    lines = f.readlines()
with open('$BFG_EVIDENCE', 'w') as f:
    for line in lines:
        if 'feat/fake-stale-branch' not in line:
            f.write(line)
"
t "فرعٌ بائتٌ غيرُ مُعلَنٍ يُسقِطُ الحارسَ" fail \
  env WASLA_BRANCHES_FILE="$BFG_BRANCHES_FILE" bash "$BFG"
_bfg_restore

# ── البابُ 2: إعلانُ الفرعِ البائتِ كدليلٍ يُمرِّرُ الحارسَ ─────────────────
# ``feat/fake-stale-branch`` في الفروعِ وفي الأدلّةِ — يجبُ أن يمرَّ.
printf '| feat/fake-stale-branch | فرعٌ وهميٌّ لاختبارِ الطفرةِ | 2026-09-18 |\n' >> "$BFG_EVIDENCE"
t "إعلانُ الفرعِ البائتِ كدليلٍ يُمرِّرُ الحارسَ" pass \
  env WASLA_BRANCHES_FILE="$BFG_BRANCHES_FILE" bash "$BFG"
_bfg_restore

# ── البابُ 3: حذفُ ملفِّ الأدلّةِ يُسقِطُ الحارسَ ─────────────────────────────
# الحارسُ يعتمدُ على ``BRANCH_EVIDENCE.md``. فلو حُذِفَ انكسرَ.
mv "$BFG_EVIDENCE" /tmp/bfg_evidence_moved
t "حذفُ ملفِّ الأدلّةِ (BRANCH_EVIDENCE.md) يُسقِطُ الحارسَ" fail \
  env WASLA_BRANCHES_FILE="$BFG_BRANCHES_FILE" bash "$BFG"
mv /tmp/bfg_evidence_moved "$BFG_EVIDENCE"

# ── البابُ 4: الفرعُ الرئيسيُّ (main) لا يُفحَصُ ──────────────────────────────
# ``main`` يجبُ أن يُستثنى من الفحصِ — هو المرجعُ لا فرعٌ منضبطٌ.
# نُثبِتُ ذلك بملفِ فروعٍ يحوي ``main`` فقط — يجبُ أن يمرَّ بلا أدلّةٍ.
echo "main" > /tmp/bfg_main_only.txt
t "الفرعُ الرئيسيُّ (main) لا يُفحَصُ — يمرُّ بلا أدلّةٍ" pass \
  env WASLA_BRANCHES_FILE=/tmp/bfg_main_only.txt bash "$BFG"

# ── البابُ 5: حذفُ فرعٍ مُعلَنٍ من الأدلّةِ مع وجودِهِ على المنصّةِ يُسقِطُ الحارسَ ──
# ``probe/m0-22a-red-merge-attempt`` مُعلَنٌ في الأدلّةِ ويوجدُ في الفروعِ — يجبُ
# أن يمرَّ. لو حُذِفَ من الأدلّةِ مع وجودِهِ في الفروعِ يجبُ أن يُسقِطَ الحارسَ.
python3 -c "
with open('$BFG_EVIDENCE') as f:
    lines = f.readlines()
with open('$BFG_EVIDENCE', 'w') as f:
    for line in lines:
        if 'probe/m0-22a-red-merge-attempt' not in line:
            f.write(line)
"
t "حذفُ فرعٍ مُعلَنٍ من الأدلّةِ مع وجودِهِ على المنصّةِ يُسقِطُ الحارسَ" fail \
  env WASLA_BRANCHES_FILE="$BFG_BRANCHES_FILE" bash "$BFG"
_bfg_restore

# ── البابُ 6: فرعٌ مُعلَنٌ في الأدلّةِ غيرُ موجودٍ على المنصّةِ لا يُسقِطُ الحارسَ ──
# الحارسُ يبدأُ من الفروعِ على المنصّةِ لا من الأدلّةِ. ففرعٌ مُعلَنٌ في الأدلّةِ
# لكن غيرُ موجودٍ على المنصّةِ لا يُسقِطُ — لأنَّ الحارسَ لا يرى الفروعَ الغائبةَ.
# نُنشئ ملفَ فروعٍ يحوي ``main`` فقط — والأدلّةُ تحوي الفروعَ الوهميّةَ كلَّها.
# يجبُ أن يمرَّ — لأنَّ الحارسَ لا يرى فرعاً بائتاً.
echo "main" > /tmp/bfg_main_only2.txt
t "فرعٌ مُعلَنٌ في الأدلّةِ غيرُ موجودٍ على المنصّةِ لا يُسقِطُ الحارسَ" pass \
  env WASLA_BRANCHES_FILE=/tmp/bfg_main_only2.txt bash "$BFG"

# التنظيفُ
rm -f "$BFG_BRANCHES_FILE" /tmp/bfg_main_only.txt /tmp/bfg_main_only2.txt
