#!/usr/bin/env bash
# ingress_boundary_gate.sh — البابُ 10 من الفحصِ 12: **إقفالُ جردِ حدودِ الدخولِ**.
#
# ── العطبُ الذي أنشأَ هذا البابَ، مقيساً لا مُقدَّراً (2026-09-17 · `M1-04`
#    الموجةُ الثامنة · `CLM-0196`) ────────────────────────────────────────────────
# الأبوابُ 1–9 كلُّها تنطلقُ من **إعلانٍ**: البابُ 5 يقرأُ `enforced: <خدمة>` من
# السّجلِّ ثمَّ يسألُ الشفرةَ، والبابُ 9 يقرأُ الحدودَ المُعلَنةَ مفروضةً ثمَّ يسألُ
# عقودَها. فحدٌّ **لا يُعلِنُ شيئاً** لا يراهُ بابٌ واحدٌ منها: لا هوَ في
# `ENFORCED` فيُطالَبَ بإنفاذٍ، ولا في جردِ الدَّينِ فيُطالَبَ بمرجعٍ. أي أنَّ
# **السكوتَ كانَ مخرجاً صحيحاً** من كلِّ أبوابِ الحارسِ.
#
# والقياسُ على المستودعِ الحيِّ (2026-09-17) أعطى الرقمَ لا الظنَّ: **أربعةَ عشرَ**
# حدَّ دخولٍ في `services/*/src/http/app.ts` و`packages/*/src/http/app.ts`، منها
# **تسعةٌ** تُنادي `registerServiceIdentity` و**خمسةٌ لا تُناديها البتّةَ**
# (`customers` · `drivers` · `reputation` · `search` · `subscriptions`) بـ**ثلاثةٍ
# وخمسينَ مساراً**، وكلُّها خدماتٌ **إنتاجيّةٌ قابلةٌ للتشغيلِ** في جردِ الصورةِ
# (`scripts/checks/lib/container_image.py runnable`) ولها `app.listen` في
# `src/http/server.ts`. وعقودُها الخمسةُ المنشورةُ لا يذكرُ واحدٌ منها
# `securitySchemes` ولا `security:` ولا `401`/`403` — فلا هيَ مفروضةٌ ولا هيَ
# مُعلَنةٌ ولا هيَ محروسةٌ.
#
# **ولمَ هذا أخطرُ من دَينِ البابِ 9:** دَينُ البابِ 9 حدٌّ **يفرضُ** وعقدُهُ ساكتٌ
# (وعدٌ ناقصٌ لمُوَلِّدِ عميلٍ)، أمّا هذا فحدٌّ **لا يفرضُ**: مسارُ
# `/customers/:waslaPublicId/profile` يقرأُ هويّةَ صاحبِ المِلفِّ **من المسارِ**
# ويُجيبُ بلا ترويسةِ هويّةٍ واحدةٍ. فالفرقُ فرقُ **إفصاحٍ ناقصٍ** عن **غيابِ
# حاجزٍ**.
#
# ── وما يفعلُهُ هذا البابُ وما لا يفعلُهُ ───────────────────────────────────
# **لا يدَّعي الإصلاحَ**: إنفاذُ الهويّةِ على الحدودِ الخمسةِ عملُ موجاتٍ تالياتٍ
# في `M1-04` (عقدٌ وصلاحيّاتٌ واختباراتُ دخولٍ لكلِّ حدٍّ). ولو رفضَ فوراً لأخفقَ
# على الخمسةِ جميعاً في أوّلِ تشغيلٍ فصارَ الأحمرُ حالةَ المستودعِ الدائمةَ —
# وذاكَ ما تمنعُهُ قاعدةُ «لا تُفرِّغِ الأحمرَ من معناه».
#
# **ويفعلُ واحداً وهوَ المقصودُ: يمنعُ الحدَّ من أن يوجدَ بصمتٍ.** كلُّ حدِّ دخولٍ
# على القرصِ إمّا **مفروضٌ** في شفرتِهِ، أو **مُعلَنٌ صفّاً** في جردِ
# `<!-- unenforced-ingress:begin -->` بعددِ مساراتِهِ المقيسِ وبخطرٍ مفتوحٍ
# وبمرجعِ البوّابةِ المالكةِ — ولا ثالثَ. وأربعةُ اتّجاهاتِ رفضٍ:
#
#   10-أ) حدٌّ غيرُ مفروضٍ ولا صفَّ لهُ في الجردِ ⇒ **الدَّينُ لا ينمو بصمتٍ**:
#         خدمةٌ جديدةٌ بحدٍّ بلا هويّةٍ تُصطدمُ بالحارسِ قبلَ الدفعِ.
#   10-ب) صفٌّ في الجردِ لحدٍّ صارَ **مفروضاً** (أو لا ملفَّ حدٍّ لهُ) ⇒ **الجردُ
#         لا يتقادمُ**: أوّلُ حدٍّ يُعالَجُ **يجبُ** أن يُخرَجَ من الجدولِ.
#   10-ج) عددُ المساراتِ في الصفِّ لا يُطابِقُ المقيسَ من الشفرةِ ⇒ **الرقمُ
#         مُشتَقٌّ لا مكتوبٌ باليدِ**: مسارٌ سادسٌ يُضافُ إلى حدٍّ غيرِ مفروضٍ
#         يُسقِطُ الدفعةَ حتّى يُقاسَ ويُكتَبَ.
#   10-د) صفٌّ بلا خطرٍ مفتوحٍ في السّجلِّ أو بلا مرجعِ `M1-04` ⇒ **لا دَينَ بلا
#         مالكٍ**: خطرٌ `status:closed` أو معرِّفٌ لا سطرَ إعلانٍ لهُ يُرَدُّ.
#
# والمجموعُ محروسٌ كذلكَ: سطرُ `TOTAL_ROUTES:` في الجردِ يُقارَنُ بمجموعِ المقيسِ،
# فحذفُ صفٍّ لا يمرُّ بتصحيحِ سطرٍ واحدٍ.

# ingress_boundary_gate <ملفُّ السّجلِّ> <سجلُّ المخاطرِ>
# يعتمدُ على `ok`/`bad`/`has_exact` من الحارسِ المُضيفِ (مصدرُ حقيقةٍ واحدٌ
# للطباعةِ والعدِّ)، فلا يُعيدُ تعريفَها هنا.
ingress_boundary_gate() {
  local ledger="$1" risk_register="$2"
  local ub_begin="<!-- unenforced-ingress:begin -->"
  local ub_end="<!-- unenforced-ingress:end -->"

  local -a apps=()
  mapfile -t apps < <(ls services/*/src/http/app.ts packages/*/src/http/app.ts 2>/dev/null | sort)
  if (( ${#apps[@]} == 0 )); then
    bad "البابُ 10 لا يجدُ حدَّ دخولٍ واحداً — الحارسُ يفحصُ موضعاً مهجوراً: services/*/src/http/app.ts"
    return 0
  fi

  # ١) القياسُ من الشفرةِ: كلُّ حدٍّ، وهل يفرضُ، وكم مساراً يُسجِّلُ.
  local -a unenf_names=() unenf_routes=()
  local app name routes enforced_count=0 measured_total=0
  for app in "${apps[@]}"; do
    name="${app#services/}"; name="${name#packages/}"; name="${name%%/*}"
    routes="$(grep -cE '^[[:space:]]*app\.(get|post|put|patch|delete)\(' "$app" || true)"
    if grep -q "registerServiceIdentity" "$app"; then
      enforced_count=$(( enforced_count + 1 ))
      continue
    fi
    unenf_names+=("$name")
    unenf_routes+=("$routes")
    measured_total=$(( measured_total + routes ))
  done
  ok "البابُ 10: ${#apps[@]} حدَّ دخولٍ مقيساً · $enforced_count مفروضٌ · ${#unenf_names[@]} غيرُ مفروضٍ ($measured_total مساراً)"

  # ٢) الجردُ المُعلَنُ.
  if ! grep -qF "$ub_begin" "$ledger" || ! grep -qF "$ub_end" "$ledger"; then
    bad "كتلةُ جردِ حدودِ الدخولِ غيرِ المفروضةِ مفقودةٌ من السّجلِّ ($ub_begin)"
    return 0
  fi
  local block
  block="$(awk -v b="$ub_begin" -v e="$ub_end" 'index($0,b){f=1;next} index($0,e){f=0} f' "$ledger")"

  local -a row_names=()
  mapfile -t row_names < <(
    grep -E '^\|' <<<"$block" \
      | awk -F'|' 'NF>2 {gsub(/^[ \t]+|[ \t]+$/,"",$2); print $2}' \
      | grep -oE '^`[a-z-]+`$' | tr -d '`' | sort -u
  )

  # 10-أ) كلُّ حدٍّ غيرِ مفروضٍ لهُ صفٌّ، وعددُهُ مُشتَقٌّ، وخطرُهُ مفتوحٌ.
  local i row declared risk risk_line
  for i in "${!unenf_names[@]}"; do
    name="${unenf_names[$i]}"; routes="${unenf_routes[$i]}"
    if ! has_exact "$name" "${row_names[@]:-}"; then
      bad "حدُّ دخولٍ لا يفرضُ هويّةَ خدمةٍ ولا صفَّ لهُ في الجردِ (دَينٌ صامتٌ): $name ($routes مساراً)"
      printf '      أضِفْ صفّاً بينَ علامتَي %s بعددِ المساراتِ المقيسِ وخطرٍ مفتوحٍ ومرجعِ M1-04.\n' "$ub_begin"
      continue
    fi
    row="$(grep -E '^\|' <<<"$block" | grep -F "\`$name\`" | head -1)"
    # 10-ج) العددُ المُعلَنُ = العددُ المقيسُ (الخليّةُ الثانيةُ رقمٌ مجرَّدٌ)
    declared="$(awk -F'|' 'NF>2 {gsub(/[^0-9]/,"",$3); print $3}' <<<"$row")"
    if [[ "$declared" != "$routes" ]]; then
      bad "عددُ مساراتِ حدٍّ في الجردِ لا يُطابِقُ المقيسَ من الشفرةِ: $name (مُعلَنٌ «${declared:-فارغٌ}» · مقيسٌ $routes)"
    fi
    # 10-د) خطرٌ مفتوحٌ بسطرِ إعلانٍ + مرجعُ البوّابةِ المالكةِ
    risk="$(grep -oE 'RISK-[0-9]{4}' <<<"$row" | head -1)"
    if [[ -z "$risk" ]]; then
      bad "صفُّ حدٍّ في الجردِ بلا معرِّفِ خطرٍ: $name"
    else
      risk_line="$(grep -E "^${risk} *\|" "$risk_register" | head -1)"
      if [[ -z "$risk_line" ]]; then
        bad "صفُّ حدٍّ يُشيرُ إلى خطرٍ لا سطرَ إعلانٍ لهُ في السّجلِّ: $name → $risk"
      elif [[ "$risk_line" == *"status:closed"* ]]; then
        bad "صفُّ حدٍّ يُشيرُ إلى خطرٍ مُقفَلٍ (دَينٌ بلا مالكٍ): $name → $risk"
      fi
    fi
    [[ "$row" == *"M1-04"* ]] \
      || bad "صفُّ حدٍّ في الجردِ بلا مرجعِ البوّابةِ المالكةِ (M1-04): $name"
  done

  # 10-ب) صفٌّ لحدٍّ صارَ مفروضاً أو لا ملفَّ لهُ — جردٌ متقادمٌ يُوهِمُ بحراسةٍ
  local rname found
  for rname in "${row_names[@]:-}"; do
    [[ -n "$rname" ]] || continue
    if ! has_exact "$rname" "${unenf_names[@]:-}"; then
      found=""
      for app in "${apps[@]}"; do
        name="${app#services/}"; name="${name#packages/}"; name="${name%%/*}"
        [[ "$name" == "$rname" ]] && found="$app" && break
      done
      if [[ -z "$found" ]]; then
        bad "اسمٌ في جردِ حدودِ الدخولِ لا ملفَّ حدٍّ لهُ على القرصِ (جردٌ متقادمٌ): $rname"
      else
        bad "اسمٌ في جردِ حدودِ الدخولِ صارَ حدُّهُ مفروضاً — يجبُ إخراجُهُ (إعلانٌ ميتٌ): $rname"
      fi
    fi
  done

  # المجموعُ المُعلَنُ = المجموعُ المقيسُ
  local declared_total
  declared_total="$(grep -oE 'TOTAL_ROUTES: *[0-9]+' <<<"$block" | head -1 | grep -oE '[0-9]+')"
  if [[ -z "$declared_total" ]]; then
    bad "جردُ حدودِ الدخولِ بلا سطرِ مجموعٍ (TOTAL_ROUTES: N) — فحذفُ صفٍّ يمرُّ بلا أثرٍ"
  elif [[ "$declared_total" != "$measured_total" ]]; then
    bad "مجموعُ مساراتِ الجردِ لا يُطابِقُ المقيسَ: مُعلَنٌ $declared_total · مقيسٌ $measured_total"
  else
    ok "جردُ حدودِ الدخولِ مُغلَقٌ: ${#unenf_names[@]} حدّاً · $measured_total مساراً · كلُّ صفٍّ بخطرٍ مفتوحٍ ومالكٍ"
  fi
}
