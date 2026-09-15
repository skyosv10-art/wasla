# gov-cases-authz-policy.sh — حالاتُ طفرةٍ للفحصِ 16 (مصفوفةُ التفويضِ · M1-05).
#
# تُستدعى من `scripts/checks/test-governance.sh` وهيَ تعملُ في نسخةِ `/tmp`
# (المتغيّرُ `$T`) لا في المستودعِ الأصلي. وتعتمدُ على `t()` المُعرَّفةِ هناك.
#
# ── القاعدةُ التي تفرضُها هذهِ الحالاتُ ────────────────────────────────────
# حارسٌ لم تُثبَتْ **عضّتُهُ** ليسَ حارساً بل زينةٌ خضراءُ. فلكلِّ بابٍ من أبوابِ
# الفحصِ 16 السّتّةِ طفرةٌ واحدةٌ على الأقلِّ **يجبُ أن تُسقِطَهُ**، وطفرةٌ
# تُسقِطُهُ لا تكفي وحدَها: يُعادُ الأصلُ بعدَ كلِّ واحدةٍ ويُثبَتُ أنَّهُ يمرُّ —
# وإلّا فقد يكونُ الحارسُ ساقطاً دائماً لا عاضّاً.
#
# المرجع: ADR-027 · docs/07-security/AUTHORIZATION_POLICY_MATRIX.md

printf '\n\033[1m[ص] حارسُ مصفوفةِ سياساتِ التفويضِ (M1-05 · الفحصُ 16)\033[0m\n'

AZ=scripts/checks/validate-authz-policy.sh
AZ_OPS=packages/authz-policy/src/operations.ts
AZ_GR=packages/authz-policy/src/grants.ts
AZ_BI=packages/authz-policy/src/bindings.ts
AZ_DOC=docs/07-security/AUTHORIZATION_POLICY_MATRIX.md

if [[ ! -f "$AZ" ]]; then
  printf '  \033[31m✗\033[0m %s مفقودٌ — لا تُقاسُ عضّةُ حارسٍ غائبٍ\n' "$AZ"
  ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

AZ_BK=/tmp/authz_backup
rm -rf "$AZ_BK"; mkdir -p "$AZ_BK"
cp "$AZ_OPS" "$AZ_BK/ops"; cp "$AZ_GR" "$AZ_BK/gr"; cp "$AZ_BI" "$AZ_BK/bi"; cp "$AZ_DOC" "$AZ_BK/doc"

_az_restore() {
  cp "$AZ_BK/ops" "$AZ_OPS"; cp "$AZ_BK/gr" "$AZ_GR"
  cp "$AZ_BK/bi" "$AZ_BI"; cp "$AZ_BK/doc" "$AZ_DOC"
}

# الأصلُ يمرُّ — وبلا هذا لا معنى لأيِّ إخفاقٍ بعدَه.
t "الحالةُ الأصليّةُ تمرُّ (خطُّ الأساسِ)" pass bash "$AZ"

# ── البابُ 1: الحزمةُ والوثيقةُ وعلاماتُهما ────────────────────────────────
mv "$AZ_GR" /tmp/az_gr_moved
t 'حذفُ ملفِّ المنحِ (grants.ts) يُسقِطُ الفحصَ' fail bash "$AZ"
mv /tmp/az_gr_moved "$AZ_GR"

mv "$AZ_DOC" /tmp/az_doc_moved
t "حذفُ وثيقةِ المصفوفةِ يُسقِطُ الفحصَ" fail bash "$AZ"
mv /tmp/az_doc_moved "$AZ_DOC"

sed -i 's/<!-- authz-matrix:end -->//' "$AZ_DOC"
t "حذفُ علامةِ نهايةِ القياسِ من الوثيقةِ يُسقِطُ الفحصَ" fail bash "$AZ"
_az_restore

# ── البابُ 2: كلُّ عمليّةٍ مفروضةٍ مُعلَنةٌ بصلاحيّاتِها ─────────────────────
python3 - "$AZ_OPS" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
m = list(re.finditer(r"  \{\s*audience:.*?\},\n", s, re.S))[3]
open(p, "w", encoding="utf-8").write(s[: m.start()] + s[m.end() :])
PY
t "حذفُ عمليّةٍ مفروضةٍ من الإعلانِ يُسقِطُ الفحصَ" fail bash "$AZ"
_az_restore

sed -i '0,/"identity:user:read"/s//"identity:user:WRITE"/' "$AZ_OPS"
t "انحرافُ اسمِ صلاحيّةٍ عن الشفرةِ يُسقِطُ الفحصَ" fail bash "$AZ"
_az_restore

# ── البابُ 3: لا إعلانَ لمسارٍ لا وجودَ لهُ ─────────────────────────────────
python3 - "$AZ_OPS" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
ghost = (
    '  { audience: "orders", method: "GET", path: "/orders/ghost",'
    ' scopes: ["orders:order:read"] },\n'
)
i = s.index("] as const;")
open(p, "w", encoding="utf-8").write(s[:i] + ghost + s[i:])
PY
t "إعلانُ عمليّةٍ وهميّةٍ لا وجودَ لها في الشفرةِ يُسقِطُ الفحصَ" fail bash "$AZ"
_az_restore

# ── البابُ 4: سقفُ المنحِ ودليلُ ثابتِه ────────────────────────────────────
sed -i 's/evidence: \["DISPATCH_ORDERS_SCOPES"\]/evidence: ["SOME_OTHER_SCOPES"]/' "$AZ_GR"
t "ثابتُ إصدارٍ غيرُ مذكورٍ في دليلِ منحِهِ يُسقِطُ الفحصَ" fail bash "$AZ"
_az_restore

python3 - "$AZ_GR" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
# تضييقُ سقفِ منحٍ قائمٍ دونَ ما تطلبُهُ الشفرةُ فعلاً.
s = s.replace(
    '"orders:assignment:write", "orders:transition:write"',
    '"orders:assignment:write"',
)
open(p, "w", encoding="utf-8").write(s)
PY
t "صلاحيّةٌ تطلبُها الشفرةُ خارجَ سقفِ المنحِ تُسقِطُ الفحصَ" fail bash "$AZ"
_az_restore

python3 - "$AZ_GR" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = s.replace(
    '"geography:zone:read"', '"geography:zone:read", "geography:ghost:read"', 1
)
open(p, "w", encoding="utf-8").write(s)
PY
t "منحُ صلاحيّةٍ لا يفرضُها أيُّ مسارٍ يُسقِطُ الفحصَ" fail bash "$AZ"
_az_restore

# ── البابُ 5: عزلُ الأدوارِ ────────────────────────────────────────────────
python3 - "$AZ_GR" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
i = s.index('  "partner-bot": [')
j = s.index("  ],", i) + 5
open(p, "w", encoding="utf-8").write(s[:i] + s[j:])
PY
t "دورُ إنتاجٍ يُوقِّعُ بلا إعلانٍ في المصفوفةِ يُسقِطُ الفحصَ" fail bash "$AZ"
_az_restore

python3 - "$AZ_GR" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
# نقلُ دورٍ إنتاجيٍّ إلى جردِ أسطولِ الاختبارِ: الحارسُ يجبُ أن يقرأَهُ
# «دورُ اختبارٍ في ملفٍّ إنتاجيٍّ» لا أن يسكتَ عنه.
s = s.replace(
    "  attacker:", '  "dispatch": "دورُ إنتاجٍ مُقنَّعٌ (طفرةٌ)",\n  attacker:', 1
)
assert '"dispatch":' in s, "لم تُطبَّقِ الطفرةُ — تغيَّرَ شكلُ الجردِ"
open(p, "w", encoding="utf-8").write(s)
PY
t "دورُ أسطولِ اختبارٍ يظهرُ في جذرِ تركيبٍ إنتاجيٍّ يُسقِطُ الفحصَ" fail bash "$AZ"
_az_restore

python3 - "$AZ_GR" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
i = s.index("export const TEST_FLEET_ROLES")
j = s.index("} as const;", i) + len("} as const;")
open(p, "w", encoding="utf-8").write(
    s[:i]
    + "export const TEST_FLEET_ROLES: Readonly<Record<string, string>> = {} as const;"
    + s[j:]
)
PY
t "تفريغُ جردِ أدوارِ الاختبارِ (تعميةُ البابِ 5) يُسقِطُ الفحصَ" fail bash "$AZ"
_az_restore

# ── البابُ 6: حسابُ التصنيفِ وأرقامُ الوثيقةِ ───────────────────────────────
sed -i '0,/strength: "none"/s//strength: "token-bound"/' "$AZ_BI"
t "ادِّعاءُ ربطٍ بالرمزِ لا تُصرِّحُ بهِ الوثيقةُ يُسقِطُ الفحصَ" fail bash "$AZ"
_az_restore

python3 - "$AZ_BI" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
m = list(re.finditer(r"  \{\n    audience: \"marketplace\".*?\n  \},\n", s, re.S))[0]
open(p, "w", encoding="utf-8").write(s[: m.start()] + s[m.end() :])
PY
t "نقصُ صفِّ تصنيفٍ يُخالِفُ رقمَ الوثيقةِ فيُسقِطُ الفحصَ" fail bash "$AZ"
_az_restore

sed -i 's/ENFORCED_OPERATIONS = 80/ENFORCED_OPERATIONS = 107/' "$AZ_DOC"
t "رقمٌ في الوثيقةِ يُخالِفُ القياسَ يُسقِطُ الفحصَ" fail bash "$AZ"
_az_restore

sed -i 's/TOKEN_BOUND_OPERATION_COUNT = 0/TOKEN_BOUND_OPERATION_COUNT = 12/' "$AZ_DOC"
t "تضخيمُ دعوى الربطِ بالرمزِ في الوثيقةِ يُسقِطُ الفحصَ" fail bash "$AZ"
_az_restore

# ── تعميةُ الحارسِ نفسِه: قياسٌ متعذِّرٌ لا يُقرأُ نجاحاً ────────────────────
python3 - "$AZ_GR" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = s.replace("export const PRODUCTION_GRANTS", "export const GRANT_TABLE")
open(p, "w", encoding="utf-8").write(s)
PY
t "إعادةُ تسميةِ المصفوفةِ (تعميةُ القياسِ) تُسقِطُ الفحصَ لا تُمرِّرُه" fail bash "$AZ"
_az_restore

# ولاحقةٌ على الاسمِ نفسِه: كانتْ تمرُّ قبلَ تدقيقِ المِرساةِ لأنَّ `split` على
# بادئةِ اسمٍ يُطابِقُ الاسمَ المُلاحَقَ — فصارتْ حالةً دائمةً لا يُسكَتُ عنها.
python3 - "$AZ_GR" <<'PY2'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = s.replace("export const PRODUCTION_GRANTS", "export const PRODUCTION_GRANTS_V2")
open(p, "w", encoding="utf-8").write(s)
PY2
t "إعادةُ تسميةٍ بلاحقةٍ لا تُخدِعُ مِرساةَ القياسِ" fail bash "$AZ"
_az_restore

# الأصلُ يمرُّ بعدَ كلِّ الطفراتِ — إثباتُ أنَّ الاستعادةَ تامّةٌ وأنَّ الحارسَ
# عاضٌّ لا ساقطٌ دائماً.
t "الأصلُ يمرُّ بعدَ كلِّ الطفراتِ (اكتمالُ الاستعادةِ)" pass bash "$AZ"
