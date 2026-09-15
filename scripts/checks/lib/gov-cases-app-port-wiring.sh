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
s = s.replace("ROOT_WIRED_PORTS = 11", "ROOT_WIRED_PORTS = 10", 1)
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
sed -i 's/OPTIONAL_PORTS = 11/OPTIONAL_PORTS = 9/' "$PW_DOC"
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

# الأصلُ يمرُّ بعدَ كلِّ الطفراتِ — إثباتُ أنَّ الاستعادةَ تامّةٌ وأنَّ الحارسَ
# عاضٌّ لا ساقطٌ دائماً.
t "الأصلُ يمرُّ بعدَ كلِّ الطفراتِ (اكتمالُ الاستعادةِ)" pass bash "$PW"
