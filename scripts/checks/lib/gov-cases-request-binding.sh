# gov-cases-request-binding.sh — حالاتُ طفرةٍ للفحصِ 21 (ربطُ الطلبِ بالاستعلامِ · M1-03).
#
# تُستدعى من `scripts/checks/test-governance.sh` وهيَ تعملُ في نسخةِ `/tmp`
# (المتغيّرُ `$T`) لا في المستودعِ الأصلي. وتعتمدُ على `t()` المُعرَّفةِ هناك.
#
# ── القاعدةُ التي تفرضُها هذهِ الحالاتُ ────────────────────────────────────
# حارسٌ لم تُثبَتْ **عضّتُهُ** ليسَ حارساً بل زينةٌ خضراءُ. ولهذا الحارسِ خمسةُ
# أبوابٍ، ولكلِّ بابٍ هنا طفرةٌ **يجبُ أن تُسقِطَهُ**، ويُعادُ الأصلُ بعدَ كلِّ
# واحدةٍ ويُثبَتُ أنَّهُ يمرُّ — وإلّا فقد يكونُ الحارسُ ساقطاً دائماً لا عاضّاً.
#
# وكلُّ طفرةٍ **تُثبِتُ أنَّها طفرَت**: تُقارَنُ نسخةُ الملفِّ قبلَها وبعدَها،
# فإن لم يتغيّرْ بايتٌ أُسقِطَت الحالةُ (درسُ الطفرةِ الصامتةِ · 2026-09-15).
#
# وطفرةُ البابِ 5 **لا تُشوِّهُ ملفّاً قائماً** بل تُنشِئُ مساعدَ توقيعٍ صناعيّاً
# يقطعُ الاستعلامَ ثمَّ يُوقِّعُ — لأنَّ العطبَ المقيسَ يومَ الإغلاقِ كانَ ملفّاً
# جديداً يُكتَبُ بحُسنِ نيّةٍ، لا سطراً يُبدَّلُ في ملفٍّ مراجَعٍ.
#
# المرجع: docs/15-decisions/ADR-036-request-binding-includes-query.md
#         docs/07-security/RISK_REGISTER.md · RISK-0026 · M1-03

printf '\n\033[1m[ف] حارسُ ربطِ الطلبِ بسلسلةِ الاستعلامِ (M1-03 · الفحصُ 21)\033[0m\n'

RB=scripts/checks/validate-request-binding.sh
RB_TOKEN=packages/service-auth/src/token.ts
RB_EDGE=packages/service-auth/src/fastify.ts
RB_PLANT=services/orders/src/__tests__/http/gov-case-planted-signer.ts

if [[ ! -f "$RB" ]]; then
  printf '  \033[31m✗\033[0m %s مفقودٌ — لا تُقاسُ عضّةُ حارسٍ غائبٍ\n' "$RB"
  ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

RB_BK=/tmp/requestbinding_backup
rm -rf "$RB_BK"; mkdir -p "$RB_BK"
cp "$RB_TOKEN" "$RB_BK/token"
cp "$RB_EDGE"  "$RB_BK/edge"

_rb_restore() {
  cp "$RB_BK/token" "$RB_TOKEN"
  cp "$RB_BK/edge"  "$RB_EDGE"
  rm -f "$RB_PLANT"
}

_rb_mutated() { # _rb_mutated <ملفٌّ> <نسخةُ الأصلِ>
  if cmp -s "$1" "$2"; then
    printf '  \033[31m✗\033[0m طفرةٌ صامتةٌ: %s لم يتغيّرْ بايتٌ فيهِ\n' "$1"
    ((FAIL++))
    return 1
  fi
  return 0
}

# الأصلُ يمرُّ — وبلا هذا لا معنى لأيِّ إخفاقٍ بعدَه.
t "الحالةُ الأصليّةُ تمرُّ (خطُّ الأساسِ)" pass bash "$RB"

# ── البابُ 1: عودةُ القطعِ إلى دالّةِ التطبيعِ نفسِها ───────────────────────
# وهيَ الطفرةُ التي وُضِعَ الحارسُ لها حرفاً: `RISK-0026` يعودُ بسطرٍ واحدٍ.
perl -0pi -e 's/function canonicalQuery/function unusedLegacyQueryNormalizer/' "$RB_TOKEN"
if _rb_mutated "$RB_TOKEN" "$RB_BK/token"; then
  t "البابُ 1: اختفاءُ تطبيعِ الاستعلامِ يُسقِطُ الحارسَ" fail bash "$RB"
fi
_rb_restore
t "الأصلُ يمرُّ بعدَ الاستعادةِ (البابُ 1)" pass bash "$RB"

# ── البابُ 2: ضمُّ الاستعلامِ بلا ترتيبٍ ────────────────────────────────────
# لا يكفي أن يُضَمَّ: ضمٌّ حرفيٌّ بلا ترتيبٍ يُنتِجُ رفضاً كاذباً على أوّلِ وسيطٍ
# يُعيدُ ترتيبَ المعاملاتِ — ورفضٌ كاذبٌ في الأمنِ يُشترى بتعطيلِ الحارسِ.
perl -0pi -e 's/pairs\.sort/pairs\.slice/' "$RB_TOKEN"
if _rb_mutated "$RB_TOKEN" "$RB_BK/token"; then
  t "البابُ 2: ضمُّ الاستعلامِ بلا ترتيبٍ يُسقِطُ الحارسَ" fail bash "$RB"
fi
_rb_restore
t "الأصلُ يمرُّ بعدَ الاستعادةِ (البابُ 2)" pass bash "$RB"

# ── البابُ 3: الحدُّ يقطعُ الهدفَ قبلَ المقارنةِ ────────────────────────────
# وهذا العطبُ **أخبثُ من الأوّلِ**: الدالّةُ سليمةٌ والاختباراتُ المُوحِّدةُ
# خضراءُ، والقطعُ في سطرٍ واحدٍ عندَ الحدِّ يُعيدُ الخطرَ كلَّهُ صامتاً.
perl -0pi -e 's/function bindingTargetOf\(request: FastifyRequest\): string \{\n  return request\.url;/function bindingTargetOf(request: FastifyRequest): string {\n  return request.url.split("?")[0] ?? request.url;/' "$RB_EDGE"
if _rb_mutated "$RB_EDGE" "$RB_BK/edge"; then
  t "البابُ 3: قطعُ الهدفِ عندَ الحدِّ يُسقِطُ الحارسَ" fail bash "$RB"
fi
_rb_restore
t "الأصلُ يمرُّ بعدَ الاستعادةِ (البابُ 3)" pass bash "$RB"

# ── البابُ 4: البادئةُ الحاليّةُ تُدرَجُ في المُبطَلاتِ ──────────────────────
# طفرةٌ تبدو تنظيفاً وهيَ عطلٌ تامٌّ: كلُّ رمزٍ يُنتَجُ يُرفَضُ عندَ التحقُّقِ.
perl -0pi -e 's/\["wsvc1", "wsvc2"\]/["wsvc1", "wsvc2", "wsvc3"]/' "$RB_TOKEN"
if _rb_mutated "$RB_TOKEN" "$RB_BK/token"; then
  t "البابُ 4: إدراجُ البادئةِ الحاليّةِ في المُبطَلاتِ يُسقِطُ الحارسَ" fail bash "$RB"
fi
_rb_restore
t "الأصلُ يمرُّ بعدَ الاستعادةِ (البابُ 4)" pass bash "$RB"

# ── البابُ 5: مساعدُ توقيعٍ جديدٌ يقطعُ قبلَ أن يُوقِّعَ ──────────────────────
cat > "$RB_PLANT" <<'PLANT'
// ملفٌّ مزروعٌ لحالةِ طفرةٍ — يُحذَفُ بعدَها. يقطعُ الاستعلامَ ثمَّ يُوقِّعُ.
export function plantedSigner(url: string): string {
  const signedTarget = url.split("?")[0] ?? url;
  return serviceAuthHeaders(signedTarget);
}
declare function serviceAuthHeaders(target: string): string;
PLANT
if [[ -f "$RB_PLANT" ]]; then
  t "البابُ 5: مساعدُ توقيعٍ يقطعُ قبلَ التوقيعِ يُسقِطُ الحارسَ" fail bash "$RB"
else
  printf '  \033[31m✗\033[0m طفرةٌ صامتةٌ: تعذّرَ زرعُ %s\n' "$RB_PLANT"
  ((FAIL++))
fi
_rb_restore
t "الأصلُ يمرُّ بعدَ الاستعادةِ (البابُ 5)" pass bash "$RB"

# ── ونقيضُ البابِ 5: القطعُ في **مقارنةٍ** لا يُدانُ ────────────────────────
# حارسٌ يُدينُ المشروعَ يُشترى صمتُهُ بتعطيلِهِ. فمساعدٌ يقطعُ ليُقارِنَ مساراً
# بمسارٍ — وهوَ ما تفعلُهُ ثلاثةُ مساعداتٍ قائمةٍ — يجبُ أن يمرَّ.
cat > "$RB_PLANT" <<'PLANT'
// ملفٌّ مزروعٌ لحالةِ طفرةٍ — يُحذَفُ بعدَها. يقطعُ ليُقارِنَ لا ليُوقِّعَ.
export function plantedComparer(url: string, method: string): boolean {
  if (method === "POST" && (url.split("?")[0] ?? url) === "/drivers") return true;
  return serviceAuthHeaders(url).length > 0;
}
declare function serviceAuthHeaders(target: string): string;
PLANT
t "نقيضُ البابِ 5: القطعُ في مقارنةٍ لا يُسقِطُ الحارسَ" pass bash "$RB"
_rb_restore
t "الأصلُ يمرُّ بعدَ الاستعادةِ (نقيضُ البابِ 5)" pass bash "$RB"
