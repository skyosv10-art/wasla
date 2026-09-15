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
# `M1-05B`: البابُ 7 يقرأُ شفرةَ الحدِّ نفسِها، فلا تُقاسُ عضّتُهُ بلا طفرةٍ فيها.
AZ_APP=services/orders/src/http/app.ts
# الموجةُ 2 (`CLM-0179`): حدٌّ ثانٍ يفرضُ المُنتَفِعَ، وببُعدٍ آخرَ (`tenant`
# لا `owner`). وحدٌّ واحدٌ في الطفراتِ كانَ سيُخفي أنَّ البابَ 7 قد يُقابِلَ
# صفوفَ السوقِ بمساعدِ الطلبيّاتِ — فيمرُّ الحارسُ على أثرٍ غيرِ موجودٍ.
AZ_MKT=services/marketplace/src/http/app.ts

if [[ ! -f "$AZ" ]]; then
  printf '  \033[31m✗\033[0m %s مفقودٌ — لا تُقاسُ عضّةُ حارسٍ غائبٍ\n' "$AZ"
  ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

AZ_BK=/tmp/authz_backup
rm -rf "$AZ_BK"; mkdir -p "$AZ_BK"
cp "$AZ_OPS" "$AZ_BK/ops"; cp "$AZ_GR" "$AZ_BK/gr"; cp "$AZ_BI" "$AZ_BK/bi"; cp "$AZ_DOC" "$AZ_BK/doc"
cp "$AZ_APP" "$AZ_BK/app"; cp "$AZ_MKT" "$AZ_BK/mkt"

_az_restore() {
  cp "$AZ_BK/ops" "$AZ_OPS"; cp "$AZ_BK/gr" "$AZ_GR"
  cp "$AZ_BK/bi" "$AZ_BI"; cp "$AZ_BK/doc" "$AZ_DOC"
  cp "$AZ_BK/app" "$AZ_APP"; cp "$AZ_BK/mkt" "$AZ_MKT"
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

# تصحيحٌ **بالإضافةِ** (`M1-05B`): كانَ هنا `sed` يستبدلُ
# `TOKEN_BOUND_OPERATION_COUNT = 0` — وكانَ صادقاً يومَ `M1-05`. ولمّا صارَ
# الرقمُ 2 صارَ الاستبدالُ **طفرةً صامتةً تمرُّ بلا أن تُغيِّرَ حرفاً**، فيُقرأُ
# إخفاقُها المفقودُ حراسةً. ولذلكَ لا يُكتَبُ الرقمُ حرفيّاً بعدَ اليومِ بل
# يُقرأُ من الوثيقةِ، و**يُثبَتُ أنَّ الطفرةَ طفرتْ فعلاً** قبلَ أن تُقاسَ.
python3 - "$AZ_DOC" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
m = re.search(r"TOKEN_BOUND_OPERATION_COUNT = (\d+)", s)
assert m, "لم يُوجَدْ قياسُ الربطِ بالرمزِ في الوثيقةِ — لا طفرةَ على غيابٍ"
inflated = int(m.group(1)) + 10
out = s.replace(m.group(0), f"TOKEN_BOUND_OPERATION_COUNT = {inflated}")
assert out != s, "الطفرةُ لم تُغيِّرْ حرفاً — والصامتةُ تُقرأُ حراسةً كاذبةً"
open(p, "w", encoding="utf-8").write(out)
MUT
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

# ── البابُ 7: الربطُ بالرمزِ مُثبَتٌ في الشفرةِ لا مُدَّعىً (`M1-05B`) ──────
#
# كلُّ طفرةٍ هنا **تُثبِتُ أنَّها طفرتْ** بـ`assert` قبلَ أن تُقاسَ. وهذا ليسَ
# احتياطاً نظريّاً: في `M1-05` مرَّتْ ثلاثُ طفراتٍ صامتةً وكُشِفَ عمىً حقيقيٌّ
# واحدٌ بهذهِ الطريقةِ بعينِها.

# (1) تفريغُ جسمِ المساعدِ من المطلبِ: الصفوفُ تُدَّعي الربطَ والشفرةُ لا تفرضُهُ.
python3 - "$AZ_APP" <<'MUT'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
old = '{ serviceIdentity: { scopes, beneficiary: "required" } }'
assert old in s, "لم يُوجَدْ مطلبُ المُنتَفِعِ في `ownerScoped` — لا طفرةَ على غيابٍ"
out = s.replace(old, "{ serviceIdentity: { scopes } }")
assert out != s, "الطفرةُ لم تُغيِّرْ حرفاً"
open(p, "w", encoding="utf-8").write(out)
MUT
t 'تفريغُ `ownerScoped` من مطلبِ المُنتَفِعِ يُسقِطُ الفحصَ' fail bash "$AZ"
_az_restore

# (2) نزعُ التصنيفِ عن مسارٍ واحدٍ بإرجاعِهِ إلى `scoped`: دعوى بلا إنفاذٍ.
python3 - "$AZ_APP" <<'MUT'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
old = "ownerScoped(ORDER_SCOPES.historyRead)"
assert old in s, "لم يُوجَدْ مسارُ السجلِّ مُصنَّفاً — لا طفرةَ على غيابٍ"
out = s.replace(old, "scoped(ORDER_SCOPES.historyRead)")
assert out != s, "الطفرةُ لم تُغيِّرْ حرفاً"
open(p, "w", encoding="utf-8").write(out)
MUT
t 'إرجاعُ مسارِ السجلِّ إلى `scoped` (دعوى بلا إنفاذٍ) يُسقِطُ الفحصَ' fail bash "$AZ"
_az_restore

# (3) الاتجاهُ المعاكسُ: الشفرةُ تفرضُ والمصفوفةُ تُخفي — إنفاذٌ يسقطُ من الإعلانِ.
python3 - "$AZ_BI" <<'MUT'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
old = 'strength: "token-bound"'
assert s.count(old) >= 1, "لا صفَّ مربوطاً بالرمزِ — لا طفرةَ على غيابٍ"
out = s.replace(old, 'strength: "caller-asserted"', 1)
assert out != s, "الطفرةُ لم تُغيِّرْ حرفاً"
open(p, "w", encoding="utf-8").write(out)
MUT
t 'إخفاءُ إنفاذٍ قائمٍ بإرجاعِ صفٍّ إلى `caller-asserted` يُسقِطُ الفحصَ' fail bash "$AZ"
_az_restore

# (4) تحويلُ العددِ المُشتَقِّ إلى رقمٍ مكتوبٍ باليدِ: مصفوفةٌ تُصدِّقُ نفسَها.
python3 - "$AZ_BI" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
pat = re.compile(r"export const TOKEN_BOUND_OPERATION_COUNT\s*:\s*number\s*=.*?;", re.S)
assert pat.search(s), "لم يُوجَدْ إعلانُ العددِ — لا طفرةَ على غيابٍ"
out = pat.sub("export const TOKEN_BOUND_OPERATION_COUNT: number = 2;", s)
assert out != s, "الطفرةُ لم تُغيِّرْ حرفاً"
open(p, "w", encoding="utf-8").write(out)
MUT
t 'تحويلُ عددِ الربطِ بالرمزِ إلى رقمٍ مكتوبٍ باليدِ يُسقِطُ الفحصَ' fail bash "$AZ"
_az_restore

# (5) الهويّةُ من ترويسةٍ وحدَها: يُنزَعُ قارئُ الرمزِ ويُترَكُ التصنيفُ قائماً.
python3 - "$AZ_APP" <<'MUT'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
assert "ownerPublicIdOf" in s, "لم يُوجَدْ قارئُ المالكِ من الرمزِ — لا طفرةَ على غيابٍ"
out = s.replace("ownerPublicIdOf", "callerAssertedOwnerOf")
assert out != s, "الطفرةُ لم تُغيِّرْ حرفاً"
open(p, "w", encoding="utf-8").write(out)
MUT
t 'نزعُ قارئِ المالكِ من الرمزِ مع بقاءِ التصنيفِ يُسقِطُ الفحصَ' fail bash "$AZ"
_az_restore

# ── طفراتُ الموجةِ 2: ربطُ المُستأجِرِ على حدِّ السوقِ (`CLM-0179`) ──────────
#
# الطفراتُ (1)–(5) كلُّها على حدِّ الطلبيّاتِ وببُعدِ المالكِ. ولو وقفَ الجردُ
# عندَها لبقيَ سؤالٌ بلا جوابٍ مقيسٍ: **هل يعضُّ البابُ 7 حدّاً ثانياً؟** فالمساعدُ
# هنا اسمُهُ `tenantScoped` لا `ownerScoped`، وخمسةُ صفوفٍ تتعلّقُ بهِ. وطفرةٌ
# تُسقِطُ الحارسَ على الطلبيّاتِ لا تقولُ شيئاً عنِ السوقِ.

# (6) تفريغُ `tenantScoped` منِ المطلبِ: خمسةُ صفوفٍ تُدَّعي الربطَ بلا شفرةٍ.
python3 - "$AZ_MKT" <<'MUT'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
old = '{ serviceIdentity: { scopes, beneficiary: "required" } }'
assert old in s, "لم يُوجَدْ مطلبُ المُنتَفِعِ في `tenantScoped` — لا طفرةَ على غيابٍ"
out = s.replace(old, "{ serviceIdentity: { scopes } }")
assert out != s, "الطفرةُ لم تُغيِّرْ حرفاً"
open(p, "w", encoding="utf-8").write(out)
MUT
t 'تفريغُ `tenantScoped` من مطلبِ المُنتَفِعِ يُسقِطُ الفحصَ' fail bash "$AZ"
_az_restore

# (7) نزعُ التصنيفِ عن مسارِ قراءةِ الطاقمِ وحدَهُ: أربعةٌ مربوطةٌ وواحدٌ عارٍ —
# فالجردُ لا يُقنَعُ بأغلبيّةٍ.
python3 - "$AZ_MKT" <<'MUT'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
old = "tenantScoped(MARKETPLACE_SCOPES.staffRead)"
assert old in s, "لم يُوجَدْ مسارُ قراءةِ الطاقمِ مُصنَّفاً — لا طفرةَ على غيابٍ"
out = s.replace(old, "scoped(MARKETPLACE_SCOPES.staffRead)")
assert out != s, "الطفرةُ لم تُغيِّرْ حرفاً"
open(p, "w", encoding="utf-8").write(out)
MUT
t 'إرجاعُ مسارِ قراءةِ الطاقمِ إلى `scoped` (دعوى بلا إنفاذٍ) يُسقِطُ الفحصَ' fail bash "$AZ"
_az_restore

# (8) الاتجاهُ المعاكسُ على حدِّ السوقِ: الشفرةُ تفرضُ والمصفوفةُ تُخفي. ويُقصَدُ
# صفُّ مسارٍ بعينِهِ لا أوّلُ `token-bound` عابرٍ، كي تُقاسَ المقابلةُ في بُعدِ
# المُستأجِرِ لا في بُعدِ المالكِ.
python3 - "$AZ_BI" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
pat = re.compile(
    r'(audience: "marketplace",\s*method: "POST",\s*'
    r'path: "/stores/:storeSlug/products",\s*dimension: "[^"]+",\s*strength: )"token-bound"'
)
assert pat.search(s), "لم يُوجَدْ صفُّ إنشاءِ المنتجِ مربوطاً بالرمزِ — لا طفرةَ على غيابٍ"
out = pat.sub(lambda m: m.group(1) + '"caller-asserted"', s, count=1)
assert out != s, "الطفرةُ لم تُغيِّرْ حرفاً"
open(p, "w", encoding="utf-8").write(out)
MUT
t 'إخفاءُ ربطِ إنشاءِ المنتجِ من المصفوفةِ مع بقائِهِ في الشفرةِ يُسقِطُ الفحصَ' fail bash "$AZ"
_az_restore

# (9) عددُ ربطِ المُستأجِرِ المُشتَقُّ يُستبدَلُ برقمٍ مكتوبٍ باليدِ — نظيرُ (4)
# على العددِ الذي أدخلَتْهُ هذهِ الموجةُ، فعددٌ جديدٌ بلا طفرةٍ عددٌ بلا حارسٍ.
python3 - "$AZ_BI" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
pat = re.compile(r"export const TENANT_BOUND_OPERATION_COUNT\s*:\s*number\s*=.*?;", re.S)
assert pat.search(s), "لم يُوجَدْ إعلانُ عددِ ربطِ المُستأجِرِ — لا طفرةَ على غيابٍ"
out = pat.sub("export const TENANT_BOUND_OPERATION_COUNT: number = 0;", s)
assert out != s, "الطفرةُ لم تُغيِّرْ حرفاً"
open(p, "w", encoding="utf-8").write(out)
MUT
t 'تحويلُ عددِ ربطِ المُستأجِرِ إلى رقمٍ مكتوبٍ باليدِ يُسقِطُ الفحصَ' fail bash "$AZ"
_az_restore

# (10) تعشيشُ المساعدِ **وحدَهُ** يجبُ أن يمرَّ: المسافةُ البادئةُ صيغةٌ لا
# دلالةٌ، ومساعدٌ مُعشَّشٌ يفرضُ المُنتَفِعَ إنفاذٌ قائمٌ. وصيغةٌ سابقةٌ للبابِ 7
# طلبَتِ القوسَ الخاتمَ في العمودِ صفرٍ فكانتْ تُسقِطُ الفحصَ على شفرةٍ سليمةٍ
# وتُعمى عن مساعدٍ مُعشَّشٍ — وهذهِ الحالةُ تُثبِتُ أنَّ العمقَ صارَ مقروءاً.
python3 - "$AZ_MKT" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
pat = re.compile(r"(?m)^function tenantScoped\((.*?)\n\}\n", re.S)
m = pat.search(s)
assert m, "لم يُوجَدْ `tenantScoped` دالّةً في المستوى الأعلى — لا طفرةَ على غيابٍ"
block = m.group(0)
nested = "".join(("  " + ln if ln.strip() else ln) for ln in block.splitlines(keepends=True))
out = s.replace(block, nested, 1)
assert out != s, "الطفرةُ لم تُغيِّرْ حرفاً"
assert "\n  function tenantScoped(" in out, "التعشيشُ لم يُزِحْ إعلانَ المساعدِ"
assert "\n  }" in out, "التعشيشُ لم يُزِحْ قوسَ الخِتامِ"
open(p, "w", encoding="utf-8").write(out)
MUT
t 'تعشيشُ `tenantScoped` وحدَهُ **يمرُّ** — العمقُ صيغةٌ لا دلالةٌ' pass bash "$AZ"
_az_restore

# (11) والتعشيشُ معَ تفريغِ المطلبِ يجبُ أن يسقطَ — وهذهِ هيَ الحالةُ التي
# تُثبِتُ أنَّ (10) مرَّتْ **قراءةً** لا **عمىً**: لو كانَ الجردُ أعمى عنِ
# المُعشَّشِ لمرَّتِ الحالتانِ كلتاهما، فصارَ الأخضرُ لا يُميِّزُ إنفاذاً من غيابِهِ.
python3 - "$AZ_MKT" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
pat = re.compile(r"(?m)^function tenantScoped\((.*?)\n\}\n", re.S)
m = pat.search(s)
assert m, "لم يُوجَدْ `tenantScoped` دالّةً في المستوى الأعلى — لا طفرةَ على غيابٍ"
block = m.group(0)
nested = "".join(("  " + ln if ln.strip() else ln) for ln in block.splitlines(keepends=True))
old = '{ serviceIdentity: { scopes, beneficiary: "required" } }'
assert old in nested, "لم يُوجَدْ مطلبُ المُنتَفِعِ في جسمِ المساعدِ"
nested = nested.replace(old, "{ serviceIdentity: { scopes } }")
out = s.replace(block, nested, 1)
assert out != s, "الطفرةُ لم تُغيِّرْ حرفاً"
assert "\n  function tenantScoped(" in out, "التعشيشُ لم يُزِحْ إعلانَ المساعدِ"
assert 'beneficiary: "required" } }\n' not in out.split("tenantActor")[0], "المطلبُ لم يُفرَّغْ"
open(p, "w", encoding="utf-8").write(out)
MUT
t 'تعشيشُ `tenantScoped` معَ تفريغِهِ من المطلبِ يُسقِطُ الفحصَ (فالجردُ يقرأُ المُعشَّشَ)' fail bash "$AZ"
_az_restore

# الأصلُ يمرُّ بعدَ كلِّ الطفراتِ — إثباتُ أنَّ الاستعادةَ تامّةٌ وأنَّ الحارسَ
# عاضٌّ لا ساقطٌ دائماً.
t "الأصلُ يمرُّ بعدَ كلِّ الطفراتِ (اكتمالُ الاستعادةِ)" pass bash "$AZ"
