# shellcheck shell=bash
# حالاتُ حوكمةِ حارسِ تدقيقِ أحكامِ CI (M0-40) — تُستدعى من test-governance.sh.
#
# ولماذا ملفٌّ مستقلٌّ؟ لأنَّ حالاتَهُ تحملُ **علاماتَ دعوى الجهلِ عيّنةً بقصدٍ**
# (`account_billing_blocked` وما شابهَها)، وهيَ نفسُها ما يبحثُ عنهُ الحارسُ في
# اللوحةِ. فحصرُها في ملفٍّ صغيرٍ مقروءٍ أوضحُ من نثرِها في السويداءِ.
#
# ومشهدُها **صناعيٌّ كاملٌ**: لوحةٌ وسجلٌّ ومكتبةٌ في `/tmp` — فلا تكذبُ الحالةُ
# متى تغيَّرَت أسطرُ اللوحةِ الحقيقيّةِ (درسُ M0-12).
#
# وأمّا المقابلةُ الحيّةُ بواجهةِ الأعمالِ فتُقاسُ **بحكمِ CI نفسِهِ** لا بحزمةٍ:
# فرعُ العملِ يشهدُ أنَّ الحارسَ أخضرُ حيّاً، والحزمةُ تشهدُ على منطقِ القرصِ
# ووجهِ «الجزئيِّ المُعلَنِ» — وهوَ ما يُقاسُ بلا شبكةٍ.
#
# المتغيّراتُ الموروثةُ: `t` · `REPO_ROOT` · `PASS`/`FAIL`.

printf '\n\033[1m[ش] تدقيقُ أحكامِ CI (M0-40)\033[0m\n'

AV_GUARD="$REPO_ROOT/scripts/checks/audit-ci-verdicts.sh"
AV_S=/tmp/gov_av
rm -rf "$AV_S"; mkdir -p "$AV_S"

# لوحةٌ صناعيّةٌ: سطرٌ يحملُ دعوى جهلٍ بحكمِ CI، وسطرٌ يحملُ «NOT VERIFIED» عن
# طبقةِ **الإنتاجِ** — والثاني لا يُلزَمُ بشيءٍ، وهوَ التمييزُ الذي بُنيَ عليهِ
# الحارسُ: الجملةُ الواحدةُ في هذا المستودعِ تحملُ معنيَينِ مختلفَينِ.
_av_board() { # _av_board <linked:1|0>
  local linked="$1" note=''
  [[ "$linked" == '1' ]] && note=' · **مُدقَّقٌ:** [`CI_VERDICT_AUDIT.md`](../12-testing/CI_VERDICT_AUDIT.md)'
  {
    printf '| العنصر | الوصف | المسار | التبعيات | الحالة | الدليل |\n'
    printf '|---|---|---|---|---|---|\n'
    printf '| M9-01 | بندُ حجبٍ | Delivery | — | Ready for Gate | CI: NOT VERIFIED · `account_billing_blocked`%s |\n' "$note"
    printf '| M9-02 | بندُ إنتاجٍ | Delivery | — | Ready for Gate | PRODUCTION: NOT VERIFIED — لا نشرَ يُقاسُ عليهِ |\n'
  } > "$AV_S/board.md"
}

_av_ledger() { # _av_ledger <rows...>  (كلُّ وسيطٍ سطرُ صفٍّ جاهزٌ)
  { printf '# سجلُّ تدقيقٍ صناعيٌّ\n\n| البصمةُ | البندُ | التصنيفُ | السيرُ | القياسُ |\n|---|---|---|---|---|\n'
    for r in "$@"; do printf '%s\n' "$r"; done; } > "$AV_S/audit.md"
}

# ولا شبكةَ في هذهِ الحالاتِ: `PATH` مُقلَّمٌ من `gh` قصداً، فيسلكُ الحارسُ وجهَ
# «الجزئيِّ المُعلَنِ» — يُدقِّقُ ما يُقرأُ من القرصِ ويُعلِنُ ما لم يَقِسْهُ.
_av_offline() { env PATH=/usr/bin:/bin bash "$AV_GUARD" "$@"; }

# (١) دعوى جهلٍ مُشيرةٌ إلى السجلِّ وسجلٌّ غيرُ فارغٍ ⇒ تمرُّ.
_av_board 1
_av_ledger '| `3cb44c35` | M9-01 | `blackout` | 1 | 31 وظيفةً · لا خطواتٍ |'
t "دعوى جهلٍ مُشيرةٌ إلى سجلِّ التدقيقِ تمرُّ (جزئيٌّ بلا شبكةٍ)" pass \
  _av_offline "$AV_S/board.md" "$AV_S/audit.md"

# (٢) والوجهُ الجزئيُّ **يُعلَنُ نصّاً** — فلا يُقرأُ نجاحٌ ناقصٌ نجاحاً كاملاً.
t "الوجهُ الجزئيُّ يُعلِنُ أنَّ المقابلةَ الحيّةَ لم تُجرَ" pass \
  bash -c 'out="$(env PATH=/usr/bin:/bin bash "$1" "$2" "$3")" && grep -q "جزئيٌّ" <<< "$out"' \
  _ "$AV_GUARD" "$AV_S/board.md" "$AV_S/audit.md"

# (٣) دعوى جهلٍ بلا إشارةٍ إلى السجلِّ ⇒ **تُرفَضُ**: هذا هوَ العطبُ المقصودُ —
#     حكمٌ «مجهولٌ» يبقى في زمنٍ صارَ العلمُ فيهِ متاحاً بلا مَن يُراجِعُهُ.
_av_board 0
t "دعوى جهلٍ بلا إشارةٍ إلى سجلِّ التدقيقِ تُرفَضُ" fail \
  _av_offline "$AV_S/board.md" "$AV_S/audit.md"

# (٤) و«NOT VERIFIED» عن طبقةِ الإنتاجِ **لا تُلزَمُ** بالإشارةِ: صفُّ M9-02 وحدَهُ
#     على اللوحةِ يمرُّ. ولو أُلزِمَت لصارَ الحارسُ يُطالِبُ بتدقيقِ حكمٍ لا وجودَ
#     لهُ — وهوَ إنذارٌ كاذبٌ يُدرَّبُ الناسُ على تجاهلِهِ.
{ printf '| العنصر | الوصف | المسار | التبعيات | الحالة | الدليل |\n|---|---|---|---|---|---|\n'
  printf '| M9-02 | بندُ إنتاجٍ | Delivery | — | Ready for Gate | PRODUCTION: NOT VERIFIED — لا نشرَ يُقاسُ عليهِ |\n'
} > "$AV_S/prod_only.md"
t "«NOT VERIFIED» عن طبقةِ الإنتاجِ لا تُلزَمُ بسجلِّ تدقيقِ CI" pass \
  _av_offline "$AV_S/prod_only.md" "$AV_S/audit.md"

# (٥) دعوى جهلٍ قائمةٌ وسجلٌّ **بلا صفٍّ واحدٍ** ⇒ تُرفَضُ: ملفٌّ فارغٌ ليسَ تدقيقاً.
_av_board 1
_av_ledger
t "سجلُّ تدقيقٍ بلا صفوفٍ معَ دعوى جهلٍ قائمةٍ يُرفَضُ" fail \
  _av_offline "$AV_S/board.md" "$AV_S/audit.md"

# (٦) fail-closed: غيابُ السجلِّ رفضٌ لا تخطٍّ — وغيابُ الدليلِ لا يُقرأُ براءةً.
_av_ledger '| `3cb44c35` | M9-01 | `blackout` | 1 | — |'
t "غيابُ ملفِّ سجلِّ التدقيقِ يُرفَضُ ولا يُتخطّى" fail \
  _av_offline "$AV_S/board.md" "$AV_S/ghost.md"
t "غيابُ اللوحةِ يُرفَضُ ولا يُتخطّى" fail \
  _av_offline "$AV_S/ghost_board.md" "$AV_S/audit.md"

# (٧) وحارسٌ بلا قارئِهِ يُرفَضُ: نسخةٌ من الحارسِ بلا `lib/` **لا تُخضَرُّ**.
mkdir -p "$AV_S/lonely/scripts/checks/lib" "$AV_S/lonely/docs"
cp "$AV_GUARD" "$AV_S/lonely/scripts/checks/"
t "حارسٌ بمكتبةِ قراءةٍ ناقصةٍ يُرفَضُ (fail-closed)" fail \
  bash -c 'cd "$1" && env PATH=/usr/bin:/bin bash scripts/checks/audit-ci-verdicts.sh "$2" "$3"' \
  _ "$AV_S/lonely" "$AV_S/board.md" "$AV_S/audit.md"

# (٨) وقارئُ الصفوفِ يفرزُ `real` الحاملَ نتيجةً من `real` الأصمِّ — وهذا الفرزُ
#     هوَ ما يُلزِمُ بنقلِ الحكمِ حينَ يكونُ موجوداً، فيُقاسُ مباشرةً.
_av_ledger '| `3cb44c35` | M9-01 | `real` | 1 | بدأَ فعلاً · `success` |' \
           '| `cafe123` | M9-03 | `real` | 2 | بدأَ فعلاً |'
t "قارئُ الصفوفِ يُميِّزُ صفَّ real الحاملَ نتيجةً عن الأصمِّ" pass \
  bash -c 'out="$(python3 "$1/scripts/checks/lib/audit_rows.py" "$2" real-with-conclusion)" \
    && grep -q 3cb44c35 <<< "$out" && ! grep -q cafe123 <<< "$out"' \
  _ "$REPO_ROOT" "$AV_S/audit.md"

# (٩) وقارئُ جوابِ الواجهةِ: «بدأَ فعلاً» معناهُ خطواتٌ أو عاملٌ حقيقيٌّ. وسيرُ
#     الحجبِ المقيسُ (34859900652) أعطى 31 وظيفةً كلُّها `failure` بـ`steps: []`
#     و`runner_id: 0` — فلو قُرِئَ ذلكَ «حكماً» لَخُضِّرَ حجبٌ لم يجرِ فيهِ شيءٌ.
# ولا أنبوبَ يُغذّي `grep -q` هنا: سباقُ SIGPIPE يُقرَأُ «لا تطابق» (RISK-0037)،
# فالجوابُ يُوضَعُ في متغيّرٍ ثمَّ يُقابَلُ نصّاً.
t "جوابُ حجبٍ (لا خطواتٍ ولا عاملَ) يُقرأُ blackout لا real" pass \
  bash -c 'out="$(python3 "$1/scripts/checks/lib/audit_runs.py" started <<< "$2")" && [[ "$out" == blackout ]]' \
  _ "$REPO_ROOT" '{"jobs":[{"conclusion":"failure","steps":[],"runner_id":0}]}'
t "جوابٌ بخطواتٍ مُنفَّذةٍ يُقرأُ real" pass \
  bash -c 'out="$(python3 "$1/scripts/checks/lib/audit_runs.py" started <<< "$2")" && [[ "$out" == real ]]' \
  _ "$REPO_ROOT" '{"jobs":[{"conclusion":"success","steps":[{"name":"x"}],"runner_id":0}]}'
t "جوابٌ بعاملٍ حقيقيٍّ بلا خطواتٍ مذكورةٍ يُقرأُ real" pass \
  bash -c 'out="$(python3 "$1/scripts/checks/lib/audit_runs.py" started <<< "$2")" && [[ "$out" == real ]]' \
  _ "$REPO_ROOT" '{"jobs":[{"conclusion":"success","steps":[],"runner_id":7}]}'

# (١٠) وانتقاءُ السيرِ يقتصرُ على `WASLA CI`: فـ`Roadmap freshness` سيرٌ آخرُ،
#      ولو قُبِلَ لَأثبتَ «حكماً» بوّابةً أخرى غيرَ البوّابةِ المقصودةِ.
t "انتقاءُ السيرِ يقتصرُ على WASLA CI ولا يقبلُ سيراً آخرَ" pass \
  bash -c 'out="$(python3 "$1/scripts/checks/lib/audit_runs.py" run-lookup "$3" <<< "$2")" && [[ "$out" == empty ]]' \
  _ "$REPO_ROOT" '{"workflow_runs":[{"name":"Roadmap freshness","id":1,"head_sha":"3cb44c35a7c1e6b8f0d2a4c6e8f0a1b2c3d4e5f6"}]}' 3cb44c35a7c1e6b8f0d2a4c6e8f0a1b2c3d4e5f6

# (١١) والبصمةُ المُسجَّلةُ يجبُ أن تكونَ التزاماً حقيقيّاً — وعلى اللوحةِ الحقيقيّةِ
#      رموزٌ عشريّةٌ من إحدَ عشرَ خانةً (`34065473979`) هيَ **معرِّفاتُ سيرٍ** لا
#      بصماتُ التزامٍ، وكلُّ خاناتِها في مجالِ السّتَّ عشريِّ فتمرُّ على أيِّ نمطٍ.
#      والحكمُ عليها يحتاجُ جهةً تعرفُ التزاماتِ المستودعِ: git أو الواجهةُ. فإنْ
#      حضرَتْ الواجهةُ **وجبَ الرفضُ**؛ وإنْ غابتْ **وجبَ إعلانُ الجهلِ** — ولا
#      يجوزُ في الحالَينِ أن يُقالَ «مُدقَّقٌ» عن بصمةٍ لم يُعرَفْ ما هيَ.
_av_board 1
_av_ledger '| `34065473979` | M9-04 | `real` | 1 | بدأَ فعلاً · `success` |'
if gh api "repos/${WASLA_REPO:-skyosv10-art/wasla}" --jq '.full_name' > /dev/null 2>&1; then
  printf '    \033[2m(الواجهةُ حاضرةٌ: تُقاسُ صيغةُ الرفضِ)\033[0m\n'
  t "صفٌّ ببصمةٍ ليستْ التزاماً (معرِّفُ سيرٍ) يُرفَضُ" fail \
    bash "$AV_GUARD" "$AV_S/board.md" "$AV_S/audit.md"
else
  printf '    \033[2m(لا واجهةَ: تُقاسُ صيغةُ إعلانِ الجهلِ)\033[0m\n'
  t "بصمةٌ لا تُحلُّ بلا واجهةٍ تُعلَنُ جهلاً ولا تُقرأُ براءةً" pass \
    bash -c 'out="$(bash "$1" "$2" "$3")" && grep -q "لم تُحلَّ في الشجرةِ الحاضرةِ" <<< "$out"' \
    _ "$AV_GUARD" "$AV_S/board.md" "$AV_S/audit.md"
fi

# (١٢) والبصمةُ المختصرةُ تُحلُّ إلى كاملةٍ قبلَ سؤالِ الواجهةِ: قِيسَ 2026-09-14
#      أنَّ `3cb44c35` مختصرةً تُجيبُ بصفرِ تشغيلاتٍ، وكاملةً تُجيبُ بالسيرِ
#      34877247715 وحكمِهِ `success`. فالحلُّ شرطُ صدقِ القياسِ لا تجميلٌ.
t "الحارسُ يحلُّ البصمةَ المختصرةَ إلى كاملةٍ قبلَ سؤالِ الواجهةِ" pass \
  bash -c 'grep -q "git rev-parse -q --verify" "$1" && grep -q "head_sha=\$FULL" "$1"' \
  _ "$AV_GUARD"

# (١٣) CLM-0560 — إخفاقُ الواجهةِ العابرُ يُعادُ بمحاولاتٍ محدودة، والإخفاقُ الدائمُ
#      يبقى إخفاقًا ويحملُ رسالةَ `gh`. الحادثة: السيرُ 38592494784 (PR #712،
#      2026-10-14T15:49:36Z) سقطَ بنداءٍ واحدٍ على `runs/35026500780/jobs` وخطؤه
#      مرميٌّ في /dev/null. والمشهدُ بلا شبكة: `gh` بديلٌ يُخفقُ N مرّةً ثمّ يجيب.
AV_GH="$AV_S/ghbin"; mkdir -p "$AV_GH"
AV_SHA=3cb44c35a7c1e6b8f0d2a4c6e8f0a1b2c3d4e5f6
cat > "$AV_GH/gh" <<'STUB'
#!/usr/bin/env bash
# gh بديل: repos/o/r · commits/* · actions/runs?head_sha · runs/9/jobs (يُخفقُ $AV_JOBS_FAILS مرّةً)
url="$2"
case "$url" in
  repos/o/r) echo o/r ;;
  repos/o/r/commits/*) echo "${url##*/}" ;;
  repos/o/r/actions/runs\?head_sha=*)
    if [[ "${AV_RUNS_FAIL:-0}" == 1 ]]; then echo 'HTTP 502: Bad Gateway (runs)' >&2; exit 1; fi
    # CLM-0663: الواجهةُ الحقيقيّةُ تحملُ `head_sha` في كلِّ سيرٍ، والحارسُ صارَ يشترطُ مطابقتَها.
    printf '{"workflow_runs":[{"name":"WASLA CI","id":9,"head_sha":"%s"}]}\n' "${url#*head_sha=}" | sed 's/&per_page=100//' ;;
  repos/o/r/actions/runs/9/jobs*)
    n=$(cat "$AV_COUNT" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$AV_COUNT"
    if (( n <= ${AV_JOBS_FAILS:-0} )); then echo 'HTTP 403: API rate limit exceeded (jobs)' >&2; exit 1; fi
    echo '{"jobs":[{"conclusion":"failure","steps":[],"runner_id":0}]}' ;;
  *) echo "stub: unexpected $url" >&2; exit 1 ;;
esac
STUB
chmod +x "$AV_GH/gh"
_av_board 1
_av_ledger "| \`$AV_SHA\` | M9-01 | \`blackout\` | 1 | 31 وظيفةً · لا خطواتٍ |"
_av_stub() { # _av_stub <jobs-fails> <attempts> [runs-fail]
  rm -f "$AV_S/count"
  env PATH="$AV_GH:/usr/bin:/bin" WASLA_REPO=o/r AV_COUNT="$AV_S/count" AV_JOBS_FAILS="$1" \
    AUDIT_GH_ATTEMPTS="$2" AUDIT_GH_BACKOFF=0 AV_RUNS_FAIL="${3:-0}" \
    bash "$AV_GUARD" "$AV_S/board.md" "$AV_S/audit.md"
}
t "إخفاقانِ عابرانِ في قراءةِ الوظائفِ ثمّ جوابٌ ⇒ يمرُّ بالمحاولاتِ (4)" pass _av_stub 2 4
t "الإخفاقُ نفسُه بمحاولةٍ واحدة ⇒ يسقطُ (المحاولاتُ هيَ ما أنقذَ الحالةَ السابقة)" fail _av_stub 1 1
t "إخفاقٌ دائمٌ في قراءةِ الوظائف ⇒ يبقى إخفاقًا لا تخطّيًا" fail _av_stub 99 4
_av_msg() { # _av_msg <نصٌّ متوقَّع> <وسائطُ _av_stub...> — يُخفقُ الحارسُ ويحملُ النصّ
  local want="$1" out; shift
  out="$(_av_stub "$@" 2>&1)" && return 1
  grep -qF -- "$want" <<< "$out"
}
t "الإخفاقُ الدائمُ يحملُ عددَ المحاولاتِ وأوّلَ سطرٍ من خطأِ gh" pass \
  _av_msg "بعدَ 4 محاولاتٍ: HTTP 403: API rate limit exceeded (jobs)" 99 4
t "إخفاقٌ دائمٌ في قراءةِ التشغيلات ⇒ إخفاقٌ يحملُ خطأَ gh" pass \
  _av_msg "HTTP 502: Bad Gateway (runs)" 0 3 1

# (١٤) CLM-0663 — الجوابُ الناجحُ بقائمةِ تشغيلاتٍ فارغةٍ **لقطةٌ لا حكمٌ**.
#      المقيسُ 2026-10-22T15:51Z: `actions/runs?head_sha=<FULL>` أجابَ HTTP 200 وJSON
#      صالحًا **بلا** سيرِ WASLA CI في 4 من 50 نداءً على التزاماتٍ لكلٍّ منها سيرٌ
#      موجودٌ (مثلًا `d2bf46f` ⇒ 34066178913 · فارغٌ في 1 من 8 نداءاتٍ متتالية).
#      والحارسُ القديمُ قرأَ أوّلَ جوابٍ فارغٍ «no_verdict» قاطعًا، فأسقطَ CI على
#      #809 (السيرُ 39805730912) والمحتوى ثابت. ومشهدُ الحالاتِ بلا شبكةٍ: `gh` بديلٌ
#      يُجيبُ قائمةَ التشغيلاتِ **بتسلسلٍ** مسمّى (`AV_SEQ`) — رمزٌ لكلِّ نداءٍ، والأخيرُ
#      يتكرّرُ — ويسجّلُ كلَّ مسارٍ سُئِلَ في `AV_LOG` ليُقاسَ ما مُرِّرَ إلى الواجهة:
#        empty   200 · `{"workflow_runs":[]}`
#        other   200 · سيرُ `Roadmap freshness` وحدَهُ للبصمةِ نفسِها
#        found   200 · سيرُ WASLA CI ‏9 للبصمةِ الكاملةِ نفسِها
#        wrongsha 200 · سيرُ WASLA CI لبصمةٍ أخرى (جوابٌ عن سؤالٍ آخر)
#        badjson 200 · نصٌّ ليسَ JSON
#        noruns  200 · JSON بلا مفتاحِ `workflow_runs`
#        blank   200 · stdout فارغٌ (ليسَ مجموعةً فارغة)
#        err     ≠0 · `HTTP 502` (خطأُ واجهة)
AV_GH2="$AV_S/ghseq"; mkdir -p "$AV_GH2"
cat > "$AV_GH2/gh" <<'STUB'
#!/usr/bin/env bash
url="$2"; printf '%s\n' "$url" >> "$AV_LOG"
case "$url" in
  repos/o/r) echo o/r ;;
  repos/o/r/commits/*) printf '%s\n' "${AV_COMMIT_SHA:-${url##*/}}" ;;
  repos/o/r/actions/runs\?head_sha=*)
    sha="${url#*head_sha=}"; sha="${sha%%&*}"
    n=$(cat "$AV_COUNT" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$AV_COUNT"
    IFS=, read -r -a seq <<< "$AV_SEQ"; k=$(( n <= ${#seq[@]} ? n-1 : ${#seq[@]}-1 ))
    case "${seq[$k]}" in
      empty)    echo '{"total_count":0,"workflow_runs":[]}' ;;
      other)    printf '{"total_count":1,"workflow_runs":[{"name":"Roadmap freshness","id":5,"head_sha":"%s"}]}\n' "$sha" ;;
      found)    printf '{"total_count":1,"workflow_runs":[{"name":"WASLA CI","id":9,"head_sha":"%s"}]}\n' "$sha" ;;
      wrongsha) echo '{"total_count":1,"workflow_runs":[{"name":"WASLA CI","id":9,"head_sha":"ffffffffffffffffffffffffffffffffffffffff"}]}' ;;
      badjson)  echo '<html>upstream</html>' ;;
      noruns)   echo '{"message":"ok"}' ;;
      blank)    : ;;
      err)      echo 'HTTP 502: Bad Gateway (runs)' >&2; exit 1 ;;
    esac ;;
  repos/o/r/actions/runs/9/jobs*)
    if [[ "${AV_JOBS:-blackout}" == real ]]; then echo '{"jobs":[{"conclusion":"success","steps":[{"name":"x"}],"runner_id":7}]}'
    else echo '{"jobs":[{"conclusion":"failure","steps":[],"runner_id":0}]}'; fi ;;
  *) echo "stub: unexpected $url" >&2; exit 1 ;;
esac
STUB
chmod +x "$AV_GH2/gh"
_av_seq() { # _av_seq <AV_SEQ> <تصنيفُ الصفّ> [AUDIT_EMPTY_ATTEMPTS=3] [AV_JOBS] [AV_COMMIT_SHA] [بصمةُ الصفّ]
  local row_sha="${6:-$AV_SHA}"
  _av_board 1
  _av_ledger "| \`$row_sha\` | M9-01 | \`$2\` | 1 | — |"
  rm -f "$AV_S/count" "$AV_S/log"; : > "$AV_S/log"
  env PATH="$AV_GH2:/usr/bin:/bin" WASLA_REPO=o/r AV_COUNT="$AV_S/count" AV_LOG="$AV_S/log" \
    AV_SEQ="$1" AV_JOBS="${4:-blackout}" AV_COMMIT_SHA="${5:-}" \
    AUDIT_GH_ATTEMPTS=2 AUDIT_GH_BACKOFF=0 AUDIT_EMPTY_ATTEMPTS="${3:-3}" AUDIT_EMPTY_WAIT=0 \
    bash "$AV_GUARD" "$AV_S/board.md" "$AV_S/audit.md"
}
_av_seq_msg() { # _av_seq_msg <pass|fail> <نصٌّ متوقَّع> <وسائطُ _av_seq...> — النتيجةُ والنصُّ معًا
  local want_rc="$1" want="$2" out rc; shift 2
  out="$(_av_seq "$@" 2>&1)"; rc=$?
  if [[ "$want_rc" == pass ]]; then (( rc == 0 )) || return 1; else (( rc != 0 )) || return 1; fi
  grep -qF -- "$want" <<< "$out"
}

# الحالةُ المولِّدةُ (تسقطُ على الحارسِ القديم): فارغٌ ثمّ السيرُ نفسُه ⇒ يُكتشَفُ ويُقاسُ.
t "CLM-0663: فارغٌ صالحٌ ثمّ سيرُ WASLA CI ⇒ يُكتشَفُ السيرُ (blackout يطابق)" pass _av_seq empty,found blackout
t "CLM-0663: فارغانِ ثمّ السيرُ ⇒ يُكتشَفُ داخلَ الحدّ (3)" pass _av_seq empty,empty,found blackout 3
t "CLM-0663: السيرُ بعدَ الحدِّ لا يُنتظَر ⇒ no_verdict بعدَ الاستنفادِ يُخالِفُ blackout فيسقط" fail _av_seq empty,empty,found blackout 2
t "CLM-0663: فارغٌ صالحٌ في كلِّ المحاولاتِ ⇒ no_verdict مقبولٌ بعدَ استنفادِها" pass _av_seq empty no_verdict 3
t "CLM-0663: no_verdict يُعلِنُ عددَ المحاولاتِ وأنّها كلَّها فارغةٌ صالحة" pass \
  _av_seq_msg pass "no_verdict بعدَ 3 محاولاتٍ كلُّها فارغةٌ صالحة" empty no_verdict 3
t "CLM-0663: فارغٌ صالحٌ دائمٌ وصفٌّ blackout ⇒ يسقطُ برسالةٍ تشخيصيّة" pass \
  _av_seq_msg fail "«no_verdict» — دعوى لم تُراجَعْ بعدَ أن صارَ العلمُ متاحاً · no_verdict بعدَ 3 محاولاتٍ كلُّها فارغةٌ صالحة (فارغٌ صالحٌ=3)" empty blackout 3
t "CLM-0663: خطأُ واجهةٍ ثمّ السيرُ ⇒ الدليلُ الإيجابيُّ لا يسقط" pass _av_seq err,found blackout
t "CLM-0663: السيرُ ثمّ فارغٌ ⇒ الفارغُ اللاحقُ لا يمحو الدليل" pass _av_seq found,empty blackout
t "CLM-0663: خطأُ واجهةٍ دائمٌ ⇒ غيرُ محسومٍ (إخفاقٌ) لا no_verdict" pass \
  _av_seq_msg fail "غيرُ محسوم" err no_verdict 3
t "CLM-0663: JSON غيرُ صالحٍ دائمًا ⇒ غيرُ محسومٍ لا no_verdict" pass \
  _av_seq_msg fail "غيرُ محسوم" badjson no_verdict 3
t "CLM-0663: JSON بلا workflow_runs ⇒ غيرُ محسومٍ لا no_verdict" fail _av_seq noruns no_verdict 3
t "CLM-0663: stdout فارغٌ ليسَ مجموعةً فارغة ⇒ غيرُ محسومٍ لا no_verdict" fail _av_seq blank no_verdict 3
t "CLM-0663: فارغٌ ثمّ JSON معطوبٌ ثمّ فارغ ⇒ اتّفاقُ الفارغِ لا يكفي (غيرُ محسوم)" fail _av_seq empty,badjson,empty no_verdict 3
t "CLM-0663: JSON معطوبٌ ثمّ السيرُ ⇒ يُكتشَفُ السير" pass _av_seq badjson,found blackout 3
t "CLM-0663: سيرٌ بدأَ فعلًا ⇒ real لا blackout (التعريفُ القائمُ)" fail _av_seq empty,found blackout 3 real
t "CLM-0663: سيرُ Roadmap freshness وحدَه ليسَ سيرَ WASLA CI ⇒ no_verdict بعدَ الاستنفاد" pass _av_seq other no_verdict 3
t "CLM-0663: سيرُ Roadmap freshness وحدَه لا يُثبتُ blackout" fail _av_seq other blackout 3
t "CLM-0663: سيرُ WASLA CI لبصمةٍ أخرى لا يُقبَلُ (غيرُ محسوم)" pass \
  _av_seq_msg fail "غيرُ محسوم" wrongsha blackout 3
_av_log_has() { # _av_log_has <سطرٌ متوقَّعٌ في سجلِّ النداءات> <وسائطُ _av_seq...> — يمرُّ والسطرُ مسؤول
  local want="$1"; shift
  _av_seq "$@" > /dev/null 2>&1 || return 1
  grep -qxF -- "$want" "$AV_S/log"
}
_av_no_runs_query() { # يسقطُ الحارسُ ولم يُسألْ عن قائمةِ تشغيلاتٍ قطّ
  _av_seq "$@" > /dev/null 2>&1 && return 1
  ! grep -q 'head_sha=' "$AV_S/log"
}
t "CLM-0663: معرِّفُ السيرِ المكتشَفِ هوَ ما تُسألُ وظائفُه" pass \
  _av_log_has "repos/o/r/actions/runs/9/jobs?per_page=100" empty,found blackout 3
t "CLM-0663: الاستعلامُ يحملُ البصمةَ الكاملةَ (40 خانة) لا سواها" pass \
  _av_log_has "repos/o/r/actions/runs?head_sha=$AV_SHA&per_page=100" empty,found blackout 3
# البصمةُ تُمرَّرُ كاملةً: الواجهةُ ترجعُ للمختصرةِ بصمةً مختصرةً ⇒ رفضٌ قبلَ سؤالِ الأعمال.
t "CLM-0663: بصمةٌ مختصرةٌ من الواجهةِ لا تُمرَّرُ إلى قائمةِ التشغيلات" pass \
  _av_no_runs_query found blackout 3 blackout abc1234 abc1234
t "CLM-0663: حدُّ محاولاتٍ غيرُ صالحٍ يعودُ إلى الافتراضيِّ (4) لا إلى صفر" pass \
  _av_seq_msg fail "no_verdict بعدَ 4 محاولاتٍ كلُّها فارغةٌ صالحة (فارغٌ صالحٌ=4)" empty blackout abc
# والقارئُ نفسُه يُقاسُ مباشرةً، لا عبرَ الحارسِ وحدَه: `_gh_read` يحجبُ عنهُ النصَّ الفارغَ
# اليومَ، فلو اعتُمِدَ على ذلكَ لعاشت طفرةُ «النصُّ الفارغُ مجموعةٌ فارغة» (M7) بلا كاشف.
_av_lookup_is() { # _av_lookup_is <المتوقَّعُ: empty|found|invalid> <json> [sha]
  local out; out="$(printf '%s' "$2" | python3 "$REPO_ROOT/scripts/checks/lib/audit_runs.py" run-lookup "${3:-$AV_SHA}")" || return 1
  [[ "${out%%$'\t'*}" == "$1" ]]
}
t "CLM-0663: القارئُ — نصٌّ فارغٌ ليسَ مجموعةً فارغة (invalid)" pass _av_lookup_is invalid ''
t "CLM-0663: القارئُ — مجموعةٌ فارغةٌ صالحةٌ (empty)" pass _av_lookup_is empty '{"workflow_runs":[]}'
t "CLM-0663: القارئُ — معرِّفُ سيرٍ غيرُ عدديٍّ (invalid)" pass _av_lookup_is invalid "{\"workflow_runs\":[{\"name\":\"WASLA CI\",\"id\":true,\"head_sha\":\"$AV_SHA\"}]}"
t "CLM-0663: القارئُ يرفضُ بصمةً مختصرةً وسيطًا" fail _av_lookup_is empty '{"workflow_runs":[]}' 3cb44c35
