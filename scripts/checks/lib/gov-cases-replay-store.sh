# gov-cases-replay-store.sh — حالاتُ طفرةٍ للفحصِ 20 (مخزنُ آثارِ الرموزِ · M1-03).
#
# تُستدعى من `scripts/checks/test-governance.sh` وهيَ تعملُ في نسخةِ `/tmp`
# (المتغيّرُ `$T`) لا في المستودعِ الأصلي. وتعتمدُ على `t()` المُعرَّفةِ هناك.
#
# ── القاعدةُ التي تفرضُها هذهِ الحالاتُ ────────────────────────────────────
# حارسٌ لم تُثبَتْ **عضّتُهُ** ليسَ حارساً بل زينةٌ خضراءُ. ولهذا الحارسِ أربعةُ
# أبوابٍ، ولكلِّ بابٍ هنا طفرةٌ **يجبُ أن تُسقِطَهُ**، ويُعادُ الأصلُ بعدَ كلِّ
# واحدةٍ ويُثبَتُ أنَّهُ يمرُّ — وإلّا فقد يكونُ الحارسُ ساقطاً دائماً لا عاضّاً.
#
# وكلُّ طفرةٍ **تُثبِتُ أنَّها طفرَت**: تُقارَنُ نسخةُ الملفِّ قبلَها وبعدَها،
# فإن لم يتغيّرْ بايتٌ أُسقِطَت الحالةُ (درسُ الطفرةِ الصامتةِ · 2026-09-15).
#
# المرجع: docs/15-decisions/ADR-035-distributed-service-token-replay-store.md
#         docs/07-security/RISK_REGISTER.md · RISK-0015 · M1-03

printf '\n\033[1m[غ] حارسُ مخزنِ آثارِ رموزِ الخدمةِ (M1-03 · الفحصُ 20)\033[0m\n'

RS=scripts/checks/validate-replay-store.sh
RS_WRAPPER=packages/service-auth/src/replay-store.ts
RS_ROOT=services/orders/src/http/server.ts
RS_PKG=packages/service-auth/package.json

if [[ ! -f "$RS" ]]; then
  printf '  \033[31m✗\033[0m %s مفقودٌ — لا تُقاسُ عضّةُ حارسٍ غائبٍ\n' "$RS"
  ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

RS_BK=/tmp/replaystore_backup
rm -rf "$RS_BK"; mkdir -p "$RS_BK"
cp "$RS_WRAPPER" "$RS_BK/wrapper"
cp "$RS_ROOT"    "$RS_BK/root"
cp "$RS_PKG"     "$RS_BK/pkg"

_rs_restore() {
  cp "$RS_BK/wrapper" "$RS_WRAPPER"
  cp "$RS_BK/root"    "$RS_ROOT"
  cp "$RS_BK/pkg"     "$RS_PKG"
}

_rs_mutated() { # _rs_mutated <ملفٌّ> <نسخةُ الأصلِ>
  if cmp -s "$1" "$2"; then
    printf '  \033[31m✗\033[0m طفرةٌ صامتةٌ: %s لم يتغيّرْ بايتٌ فيهِ\n' "$1"
    ((FAIL++))
    return 1
  fi
  return 0
}

# الأصلُ يمرُّ — وبلا هذا لا معنى لأيِّ إخفاقٍ بعدَه.
t "الحالةُ الأصليّةُ تمرُّ (خطُّ الأساسِ)" pass bash "$RS"

# ── البابُ 1: جذرٌ يعودُ فيختارُ مخزنَ الذاكرةِ بنفسِهِ ─────────────────────
# وهذهِ هيَ الطفرةُ التي وُضِعَ الحارسُ لها حرفاً: سطرٌ واحدٌ في جذرٍ إنتاجيٍّ.
perl -0pi -e 's/createServiceTokenReplayGuardFromEnv\(process\.env\)/new InMemoryServiceTokenReplayGuard()/' "$RS_ROOT"
if _rs_mutated "$RS_ROOT" "$RS_BK/root"; then
  t "البابُ 1: جذرٌ يبني مخزنَ الذاكرةِ بنفسِهِ يُسقِطُ الحارسَ" fail bash "$RS"
fi
_rs_restore
t "الأصلُ يمرُّ بعدَ الاستعادةِ (البابُ 1)" pass bash "$RS"

# ── البابُ 2: جذرٌ يُركِّبُ هويّةً وقد اختفى مِغلافُهُ ──────────────────────
# لا يكفي منعُ الصنفِ: جذرٌ يُركِّبُ `serviceIdentity` بحارسٍ جاءَ من مكانٍ
# مجهولٍ عطبٌ كذلكَ، فالبابُ يسألُ عن **مصدرِ** الحارسِ لا عن غيابِ اسمٍ.
perl -0pi -e 's/createServiceTokenReplayGuardFromEnv/someOtherGuardSource/g' "$RS_ROOT"
if _rs_mutated "$RS_ROOT" "$RS_BK/root"; then
  t "البابُ 2: جذرٌ بهويّةٍ بلا المِغلافِ المُعتمَدِ يُسقِطُ الحارسَ" fail bash "$RS"
fi
_rs_restore

# ── البابُ 3: التصديرُ الفرعيُّ يُنزَعُ من الحزمةِ ──────────────────────────
perl -0pi -e 's{"\./replay-store"}{"./replay-store-removed"}' "$RS_PKG"
if _rs_mutated "$RS_PKG" "$RS_BK/pkg"; then
  t "البابُ 3: نزعُ التصديرِ الفرعيِّ ./replay-store يُسقِطُ الحارسَ" fail bash "$RS"
fi
_rs_restore

# ── البابُ 4أ: الافتراضُ يُقلَبُ إلى الذاكرةِ ────────────────────────────────
# وهذا هوَ **الالتفافُ الأخطرُ**: لا سطرَ في جذرٍ، ولا نداءَ يتغيّرُ — يكفي أن
# يصيرَ افتراضُ المِغلافِ `memory` فيعودُ أربعةَ عشرَ جذراً إلى العطبِ صامتةً.
perl -0pi -e 's/return "postgres";/return "memory";/' "$RS_WRAPPER"
if _rs_mutated "$RS_WRAPPER" "$RS_BK/wrapper"; then
  t "البابُ 4: قلبُ الافتراضِ إلى الذاكرةِ يُسقِطُ الحارسَ" fail bash "$RS"
fi
_rs_restore

# ── البابُ 4ب: رفعُ رفضِ الذاكرةِ في الإنتاجِ ───────────────────────────────
perl -0pi -e 's/"production"/"not-production-anymore"/' "$RS_WRAPPER"
if _rs_mutated "$RS_WRAPPER" "$RS_BK/wrapper"; then
  t "البابُ 4: رفعُ رفضِ الذاكرةِ في production يُسقِطُ الحارسَ" fail bash "$RS"
fi
_rs_restore

t "الأصلُ يمرُّ بعدَ كلِّ الطفراتِ (لا أثرَ متبقٍّ)" pass bash "$RS"
