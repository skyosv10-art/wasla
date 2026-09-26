# gov-cases-app-port-wiring.sh — حالاتُ طفرةٍ للفحصِ 17 (تركيبُ المنافذِ · M0-41).
#
# تُستدعى من `scripts/checks/test-governance.sh` وهيَ تعملُ في نسخةِ `/tmp`
# (المتغيّرُ `$T`) لا في المستودعِ الأصلي. وتعتمدُ على `t()` المُعرَّفةِ هناك.
#
# ── القاعدةُ التي تفرضُها هذهِ الحالاتُ ────────────────────────────────────
# حارسٌ لم تُثبَتْ **عضّتُهُ** ليسَ حارساً بل زينةٌ خضراءُ. فلكلِّ بابٍ من أبوابِ
# الفحصِ 17 الخمسةِ طفرةٌ واحدةٌ على الأقلِّ **يجبُ أن تُسقِطَهُ**، ويُعادُ
# الأصلُ بعدَ كلِّ واحدةٍ ويُثبَتُ أنَّهُ يمرُّ — وإلّا فقد يكونُ الحارسُ ساقطاً
# دائماً لا عاضّاً.
#
# وكلُّ طفرةٍ **تُثبِتُ أنَّها طفرَت**: تُقارَنُ بصمةُ الملفِّ قبلَها وبعدَها،
# فإن لم يتغيّرْ بايتٌ أُسقِطَت الحالةُ. وهذا درسٌ مقيسٌ لا احتياطٌ: طفرةٌ
# صامتةٌ في `gov-cases-authz-policy.sh` (2026-09-15) كانت تُقرأُ «عضّةً» وهيَ
# لا تُغيّرُ حرفاً، فصارَ إثباتُ الطفرةِ شرطاً في كلِّ حالةٍ جديدةٍ.
#
# المرجع: docs/12-testing/APP_PORT_WIRING.md · RISK-0044 · M0-41

printf '\n\033[1m[ض] حارسُ تركيبِ المنافذِ في الجذرِ (M0-41 · الفحصُ 17)\033[0m\n'

PW=scripts/checks/validate-app-port-wiring.sh
PW_DOC=docs/12-testing/APP_PORT_WIRING.md
PW_SEARCH_ROOT=services/search/src/http/server.ts
PW_SEARCH_APP=services/search/src/http/app.ts
PW_DELIVERY_HARNESS=packages/delivery-e2e/src/harness.ts

if [[ ! -f "$PW" ]]; then
  printf '  \033[31m✗\033[0m %s مفقودٌ — لا تُقاسُ عضّةُ حارسٍ غائبٍ\n' "$PW"
  ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

PW_BK=/tmp/portwiring_backup
rm -rf "$PW_BK"; mkdir -p "$PW_BK"
cp "$PW_DOC" "$PW_BK/doc"
cp "$PW_SEARCH_ROOT" "$PW_BK/root"
cp "$PW_SEARCH_APP" "$PW_BK/app"
cp "$PW_DELIVERY_HARNESS" "$PW_BK/harness"

_pw_restore() {
  cp "$PW_BK/doc" "$PW_DOC"
  cp "$PW_BK/root" "$PW_SEARCH_ROOT"
  cp "$PW_BK/app" "$PW_SEARCH_APP"
  cp "$PW_BK/harness" "$PW_DELIVERY_HARNESS"
}

# طفرةٌ لا تُغيّرُ بايتاً ليست طفرةً — فالعضّةُ المقيسةُ عليها كذبٌ.
_pw_mutated() { # _pw_mutated <ملفٌّ> <نسخةُ الأصلِ>
  if cmp -s "$1" "$2"; then
    printf '  \033[31m✗\033[0m طفرةٌ صامتةٌ: %s لم يتغيّرْ بايتٌ فيهِ\n' "$1"
    ((FAIL++))
    return 1
  fi
  return 0
}

# الأصلُ يمرُّ — وبلا هذا لا معنى لأيِّ إخفاقٍ بعدَه.
t "الحالةُ الأصليّةُ تمرُّ (خطُّ الأساسِ)" pass bash "$PW"

# ── البابُ 1: لا صمتَ عن خدمةٍ ─────────────────────────────────────────────
mv "$PW_SEARCH_ROOT" /tmp/pw_root_moved
t 'غيابُ جذرِ تركيبٍ إنتاجيٍّ لمصنعِ تطبيقٍ يُسقِطُ الفحصَ' fail bash "$PW"
mv /tmp/pw_root_moved "$PW_SEARCH_ROOT"

sed -i 's/export function buildSearchHttpApp/export function assembleSearchTransport/' "$PW_SEARCH_APP"
if _pw_mutated "$PW_SEARCH_APP" "$PW_BK/app"; then
  t 'مصنعٌ باسمٍ لا يُقرأُ يُسقِطُ الفحصَ (لا يُتخطّى بصمتٍ)' fail bash "$PW"
fi
_pw_restore

# ── البابُ 2: المنفذُ الاختياريُّ مُركَّبٌ في الجذرِ ─────────────────────────
# وهذهِ هيَ عينُ العطبِ الذي وُلِدَ الحارسُ لأجلِهِ (`RISK-0044`): منفذٌ يقبلُهُ
# المصنعُ ولا يُركِّبُهُ الجذرُ، فالمسارُ يُجيبُ 500 والاختباراتُ خضراءُ.
python3 - "$PW_SEARCH_ROOT" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
open(p, "w", encoding="utf-8").write(re.sub(r"\n\s*indexHealthPort,", "", s, count=1))
MUT
if _pw_mutated "$PW_SEARCH_ROOT" "$PW_BK/root"; then
  t 'منفذٌ اختياريٌّ غيرُ مُركَّبٍ في الجذرِ بلا سببٍ يُسقِطُ الفحصَ' fail bash "$PW"

  # والسجلُّ ليسَ زينةً: السببُ المكتوبُ يُمرِّرُ الغيابَ المُعلَنَ — فالحارسُ
  # يُحرِّمُ الغيابَ **الصامتَ** لا الغيابَ المُعلَّلَ.
  python3 - "$PW_DOC" <<'MUT'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
row = (
    "search | indexHealthPort | scope:root | reason: طفرةُ اختبارِ الحوكمةِ "
    "وحدَها — سببٌ مكتوبٌ يُثبِتُ أنَّ السجلَّ يُمرِّرُ الغيابَ المُعلَنَ.\n"
)
s = s.replace("<!-- app-port-exemptions:start -->\n```\n", "<!-- app-port-exemptions:start -->\n```\n" + row, 1)
s = s.replace("EXEMPTIONS = 0", "EXEMPTIONS = 1", 1)
s = s.replace("ROOT_WIRED_PORTS = 15", "ROOT_WIRED_PORTS = 14", 1)
s = s.replace("HARNESSES_SCANNED = 10", "HARNESSES_SCANNED = 10", 1)
open(p, "w", encoding="utf-8").write(s)
MUT
  t 'الغيابُ نفسُهُ يمرُّ حينَ يُعلَّلُ في السجلِّ (السجلُّ يعملُ لا يُزيِّنُ)' pass bash "$PW"

  # ── البابُ 4: لا استثناءَ ميتاً ────────────────────────────────────────
  cp "$PW_BK/root" "$PW_SEARCH_ROOT"
  t 'استثناءٌ لمنفذٍ صارَ مُركَّباً (استثناءٌ ميتٌ) يُسقِطُ الفحصَ' fail bash "$PW"
fi
_pw_restore

# ── سببٌ أقصرُ من الحدِّ: استثناءٌ بلا تعليلٍ تعميةٌ بمظهرِ سجلٍّ ──────────
python3 - "$PW_DOC" <<'MUT'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = s.replace(
    "<!-- app-port-exemptions:start -->\n```\n",
    "<!-- app-port-exemptions:start -->\n```\nsearch | indexHealthPort | scope:root | reason: لاحقاً\n",
    1,
)
open(p, "w", encoding="utf-8").write(s)
MUT
if _pw_mutated "$PW_DOC" "$PW_BK/doc"; then
  t 'استثناءٌ بسببٍ أقصرَ من الحدِّ يُسقِطُ الفحصَ' fail bash "$PW"
fi
_pw_restore

# ── البابُ 3: مِعْوانُ بوّابةِ الخروجِ يُطابِقُ الجذرَ ──────────────────────
python3 - "$PW_DELIVERY_HARNESS" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
open(p, "w", encoding="utf-8").write(
    re.sub(r"\n\s*relayRequeuePort: new PostgresRelayRequeueStore\(pool\),", "", s, count=1)
)
MUT
if _pw_mutated "$PW_DELIVERY_HARNESS" "$PW_BK/harness"; then
  t 'منفذٌ مُركَّبٌ في الجذرِ وغائبٌ عن معوانِ بوّابةِ الخروجِ يُسقِطُ الفحصَ' fail bash "$PW"
fi
_pw_restore

# ── البابُ 5: الأرقامُ المنشورةُ تُطابِقُ القياسَ ───────────────────────────
sed -i 's/OPTIONAL_PORTS = 14/OPTIONAL_PORTS = 9/' "$PW_DOC"
if _pw_mutated "$PW_DOC" "$PW_BK/doc"; then
  t 'رقمٌ منشورٌ يُخالِفُ القياسَ يُسقِطُ الفحصَ' fail bash "$PW"
fi
_pw_restore

sed -i 's/<!-- app-port-counts:end -->//' "$PW_DOC"
if _pw_mutated "$PW_DOC" "$PW_BK/doc"; then
  t 'حذفُ علامةِ كتلةِ الأرقامِ من السجلِّ يُسقِطُ الفحصَ' fail bash "$PW"
fi
_pw_restore

mv "$PW_DOC" /tmp/pw_doc_moved
t 'حذفُ سجلِّ التركيبِ المُعلَنِ يُسقِطُ الفحصَ' fail bash "$PW"
mv /tmp/pw_doc_moved "$PW_DOC"

# ── العطبُ الذي أفلتَ من النسخةِ الأولى: الاسمُ في مُعينٍ لا في عقدِ النداءِ ──
# النسخةُ الأولى من هذا الحارسِ أثبتَتِ التركيبَ ببحثٍ نصيٍّ في **كاملِ**
# `server.ts`، فكانَ حذفُ المفتاحِ من عقدِ نداءِ المصنعِ يمرُّ أخضرَ ما دامَ
# الاسمُ باقياً في أيِّ موضعٍ آخرَ — مُعينٍ أو تعليقٍ أو نصٍّ. وهذهِ الحالاتُ
# تُثبِتُ موتَ ذاكَ الإيجابِ الكاذبِ: لا يُقرأُ تركيباً إلّا مفتاحٌ في العقدِ
# المُمرَّرِ فعلاً إلى المصنعِ.
PW_DELIVERY_ROOT=services/delivery/src/http/server.ts
cp "$PW_DELIVERY_ROOT" "$PW_BK/droot"
_pw_restore() {
  cp "$PW_BK/doc" "$PW_DOC"
  cp "$PW_BK/root" "$PW_SEARCH_ROOT"
  cp "$PW_BK/app" "$PW_SEARCH_APP"
  cp "$PW_BK/harness" "$PW_DELIVERY_HARNESS"
  cp "$PW_BK/droot" "$PW_DELIVERY_ROOT"
}

# (1) الحالةُ الحقيقيّةُ في الشجرةِ: `catalogPort` يُبنى في مُعينٍ
#     (`buildCatalogPort`) ويُمرَّرُ نشراً شرطيّاً. فحذفُ النشرِ من عقدِ النداءِ
#     وحدَهُ — والاسمُ باقٍ في المُعينِ — **يجبُ** أن يُسقِطَ الفحصَ.
python3 - "$PW_DELIVERY_ROOT" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
out = re.sub(
    r"\n\s*\.\.\.\(catalog\.catalogPort === undefined \? \{\} : \{ catalogPort: catalog\.catalogPort \}\),",
    "",
    s,
    count=1,
)
assert out != s, "لم يُطابِقْ نصُّ الطفرةِ شكلَ الملفِّ — الطفرةُ الصامتةُ تُكشَفُ بعدَها"
assert "buildCatalogPort" in out and "catalogPort" in out, "الاسمُ يجبُ أن يبقى في المُعينِ"
open(p, "w", encoding="utf-8").write(out)
MUT
if _pw_mutated "$PW_DELIVERY_ROOT" "$PW_BK/droot"; then
  t 'حذفُ منفذٍ من عقدِ نداءِ المصنعِ وبقاءُ اسمِهِ في مُعينٍ يُسقِطُ الفحصَ (موتُ الإيجابِ الكاذبِ)' fail bash "$PW"
fi
_pw_restore

# (2) الحالةُ نفسُها مُصطنعةً: يُحذَفُ المفتاحُ من العقدِ ويُزرَعُ الاسمُ في
#     مُعينٍ جديدٍ في الملفِّ نفسِهِ — البحثُ النصيُّ يمرُّ والبنيويُّ يعضُّ.
python3 - "$PW_SEARCH_ROOT" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
out = re.sub(r"\n\s*indexHealthPort,", "", s, count=1)
assert out != s, "لم يُحذَفِ المفتاحُ من عقدِ النداءِ"
helper = (
    "\nfunction buildIndexHealthWiring(pool: Pool) {\n"
    "  // مُعينٌ يذكرُ الاسمَ ولا يُركِّبُهُ: عينُ الإيجابِ الكاذبِ المُختبَرُ.\n"
    "  return { indexHealthPort: new SearchIndexHealthProbe(pool) };\n"
    "}\n"
)
out = out + helper
assert out.count("indexHealthPort") >= 2, "يجبُ بقاءُ الاسمِ مرّتينِ خارجَ العقدِ"
open(p, "w", encoding="utf-8").write(out)
MUT
if _pw_mutated "$PW_SEARCH_ROOT" "$PW_BK/root"; then
  t 'منفذٌ يُذكَرُ في مُعينٍ مزروعٍ ولا يُمرَّرُ في العقدِ يُسقِطُ الفحصَ' fail bash "$PW"
fi
_pw_restore

# (3) ولا يُقرأُ تركيباً ذكرُ الاسمِ في تعليقٍ أو نصٍّ — وهذا يفرقُ الحارسَ
#     البنيويَّ عن `grep`.
python3 - "$PW_SEARCH_ROOT" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
out = re.sub(
    r"\n(\s*)indexHealthPort,",
    r"\n\1// indexHealthPort, <- تعليقٌ لا تركيبٌ\n\1// \"indexHealthPort\" في نصٍّ كذلكَ",
    s,
    count=1,
)
assert out != s, "لم تُطبَّقِ الطفرةُ"
open(p, "w", encoding="utf-8").write(out)
MUT
if _pw_mutated "$PW_SEARCH_ROOT" "$PW_BK/root"; then
  t 'منفذٌ مذكورٌ في تعليقٍ أو نصٍّ لا في العقدِ يُسقِطُ الفحصَ' fail bash "$PW"
fi
_pw_restore

# (4) ولا يُقرأُ تركيباً مفتاحٌ في عقدٍ **متداخلٍ**: القياسُ على الطبقةِ الأولى
#     من العقدِ المُمرَّرِ، فمفتاحٌ في جوفِ عقدٍ آخرَ ليسَ وسيطاً للمصنعِ.
python3 - "$PW_SEARCH_ROOT" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
out = re.sub(r"\n(\s*)indexHealthPort,", r"\n\1nested: { indexHealthPort },", s, count=1)
assert out != s, "لم تُطبَّقِ الطفرةُ"
open(p, "w", encoding="utf-8").write(out)
MUT
if _pw_mutated "$PW_SEARCH_ROOT" "$PW_BK/root"; then
  t 'مفتاحٌ في عقدٍ متداخلٍ لا في الطبقةِ الأولى يُسقِطُ الفحصَ' fail bash "$PW"
fi
_pw_restore

# (5) نشرٌ مُبهَمٌ لا يُحَلُّ إلى عقدٍ مقروءٍ **يُسقِطُ** الفحصَ — العجزُ يُعلَنُ
#     ولا يُقرأُ مروراً (وهذا الفرقُ بينَ حارسٍ صادقٍ وحارسٍ متسامحٍ).
python3 - "$PW_SEARCH_ROOT" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
out = re.sub(r"\n(\s*)indexHealthPort,", r"\n\1...buildOpaqueDeps(pool),", s, count=1)
assert out != s, "لم تُطبَّقِ الطفرةُ"
open(p, "w", encoding="utf-8").write(out)
MUT
if _pw_mutated "$PW_SEARCH_ROOT" "$PW_BK/root"; then
  t 'نشرٌ مُبهَمٌ في عقدِ النداءِ يُسقِطُ الفحصَ (العجزُ يُعلَنُ لا يُمرَّرُ)' fail bash "$PW"
fi
_pw_restore

# (6) ووسيطٌ ليسَ عقداً حرفيّاً يُسقِطُ الفحصَ كذلكَ: ما لا يُقاسُ لا يُبارَكُ.
python3 - "$PW_SEARCH_ROOT" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
out = re.sub(
    r"buildSearchHttpApp\(\{\n(?:.*\n)*?  \}\);",
    "buildSearchHttpApp(assembleDeps(pool));",
    s,
    count=1,
)
assert out != s, "لم تُطبَّقِ الطفرةُ"
open(p, "w", encoding="utf-8").write(out)
MUT
if _pw_mutated "$PW_SEARCH_ROOT" "$PW_BK/root"; then
  t 'نداءُ مصنعٍ بوسيطٍ ليسَ عقداً حرفيّاً يُسقِطُ الفحصَ' fail bash "$PW"
fi
_pw_restore

# (7) نداءٌ ثانٍ للمصنعِ في الملفِّ نفسِهِ ينقصُهُ المنفذُ: **كلُّ** موضعِ نداءٍ
#     يُقاسُ لا أوّلُهُ — وإلّا لأفلَتَ جذرٌ ثانٍ ناقصٌ.
python3 - "$PW_SEARCH_ROOT" <<'MUT'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
out = s.replace(
    "await main();",
    "export function startFallback(readPort: SearchIndexReader) {\n"
    "  // نداءٌ ثانٍ ناقصُ المنفذِ — يجبُ أن يُقاسَ هوَ أيضاً.\n"
    "  return buildSearchHttpApp({ searchReadPort: readPort });\n"
    "}\n\nawait main();",
    1,
)
assert out != s, "لم تُطبَّقِ الطفرةُ"
open(p, "w", encoding="utf-8").write(out)
MUT
if _pw_mutated "$PW_SEARCH_ROOT" "$PW_BK/root"; then
  t 'نداءٌ ثانٍ للمصنعِ في الملفِّ نفسِهِ ينقصُهُ المنفذُ يُسقِطُ الفحصَ' fail bash "$PW"
fi
_pw_restore

# ── ولا إخفاقَ كاذبٌ: أشكالُ تركيبٍ سليمةٌ يجبُ أن تمرَّ ────────────────────
# حارسٌ يُسقِطُ الشفرةَ السليمةَ يُبطَّلُ بيدِ أوّلِ مُطوِّرٍ — والصلابةُ أن
# يعضَّ العطبَ ويسكتَ عن الصوابِ في أشكالِهِ الطبيعيّةِ.

# (8) مفتاحٌ مكتوبٌ نصّاً: `"indexHealthPort": …` تركيبٌ صحيحٌ.
python3 - "$PW_SEARCH_ROOT" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
out = re.sub(r"\n(\s*)indexHealthPort,", r'\n\1"indexHealthPort": indexHealthPort,', s, count=1)
assert out != s, "لم تُطبَّقِ الطفرةُ"
open(p, "w", encoding="utf-8").write(out)
MUT
if _pw_mutated "$PW_SEARCH_ROOT" "$PW_BK/root"; then
  t 'مفتاحٌ مكتوبٌ نصّاً في العقدِ يمرُّ (لا إخفاقَ كاذبٌ)' pass bash "$PW"
fi
_pw_restore

# (9) نشرُ عقدٍ مُعرَّفٍ في الملفِّ نفسِهِ: تركيبٌ صحيحٌ يُحَلُّ ويمرُّ.
python3 - "$PW_SEARCH_ROOT" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
out = re.sub(
    r"\n(\s*)indexHealthPort,",
    r"\n\1...extraWiring,",
    s,
    count=1,
)
out = out.replace(
    "  const { fastify, close } = buildSearchHttpApp({",
    "  const extraWiring = { indexHealthPort };\n  const { fastify, close } = buildSearchHttpApp({",
    1,
)
assert out != s, "لم تُطبَّقِ الطفرةُ"
open(p, "w", encoding="utf-8").write(out)
MUT
if _pw_mutated "$PW_SEARCH_ROOT" "$PW_BK/root"; then
  t 'نشرُ عقدٍ مُعرَّفٍ في الملفِّ نفسِهِ يُحَلُّ ويمرُّ' pass bash "$PW"
fi
_pw_restore

# (10) واسمُ مصنعٍ مُستعارٌ عندَ الاستيرادِ يُتتبَّعُ — لا يُفلِتُ جذرٌ بتسميةٍ.
python3 - "$PW_SEARCH_ROOT" <<'MUT'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
out = s.replace(
    'import { buildSearchHttpApp } from "./app.js";',
    'import { buildSearchHttpApp as buildApp } from "./app.js";',
    1,
).replace("buildSearchHttpApp({", "buildApp({", 1)
assert out != s, "لم تُطبَّقِ الطفرةُ"
open(p, "w", encoding="utf-8").write(out)
MUT
if _pw_mutated "$PW_SEARCH_ROOT" "$PW_BK/root"; then
  t 'اسمُ مصنعٍ مُستعارٌ عندَ الاستيرادِ يُتتبَّعُ ويمرُّ' pass bash "$PW"
fi
_pw_restore

# (11) والاستعارةُ نفسُها لا تُخفي نقصاً: مُستعارٌ وناقصُ المنفذِ يُسقِطُ الفحصَ.
python3 - "$PW_SEARCH_ROOT" <<'MUT'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
out = s.replace(
    'import { buildSearchHttpApp } from "./app.js";',
    'import { buildSearchHttpApp as buildApp } from "./app.js";',
    1,
).replace("buildSearchHttpApp({", "buildApp({", 1)
out = re.sub(r"\n\s*indexHealthPort,", "", out, count=1)
assert out != s, "لم تُطبَّقِ الطفرةُ"
open(p, "w", encoding="utf-8").write(out)
MUT
if _pw_mutated "$PW_SEARCH_ROOT" "$PW_BK/root"; then
  t 'مصنعٌ مُستعارٌ وعقدٌ ناقصُ المنفذِ يُسقِطُ الفحصَ' fail bash "$PW"
fi
_pw_restore

# الأصلُ يمرُّ بعدَ كلِّ الطفراتِ — إثباتُ أنَّ الاستعادةَ تامّةٌ وأنَّ الحارسَ
# عاضٌّ لا ساقطٌ دائماً.
t "الأصلُ يمرُّ بعدَ كلِّ الطفراتِ (اكتمالُ الاستعادةِ)" pass bash "$PW"
