# gov-cases-config-schema.sh — حالاتُ طفرةٍ للفحصِ 18 (مخطَّطُ الإعدادِ · M2-04).
#
# تُستدعى من `scripts/checks/test-governance.sh` وهيَ تعملُ في نسخةِ `/tmp`
# (المتغيّرُ `$T`) لا في المستودعِ الأصلي. وتعتمدُ على `t()` المُعرَّفةِ هناك.
#
# ── القاعدةُ التي تفرضُها هذهِ الحالاتُ ────────────────────────────────────
# حارسٌ لم تُثبَتْ **عضّتُهُ** ليسَ حارساً بل زينةٌ خضراءُ. فلكلِّ بابٍ من أبوابِ
# الفحصِ 18 الثمانيةِ طفرةٌ واحدةٌ **يجبُ أن تُسقِطَهُ**، ويُعادُ الأصلُ بعدَ كلِّ
# واحدةٍ ويُثبَتُ أنَّهُ يمرُّ — وإلّا فقد يكونُ الحارسُ ساقطاً دائماً لا عاضّاً.
#
# وكلُّ طفرةٍ **تُثبِتُ أنَّها طفرَت** بمقارنةِ البايتاتِ قبلَها وبعدَها: طفرةٌ
# صامتةٌ في `gov-cases-authz-policy.sh` (2026-09-15) كانت تُقرأُ «عضّةً» وهيَ لا
# تُغيّرُ حرفاً.
#
# المرجع: docs/08-infrastructure/CONFIG_SCHEMA.md · ADR-032 · docs/12-testing/M2-04_GATE.md

printf '\n\033[1m[ض] حارسُ مخطَّطِ الإعدادِ ومصدرِ حقيقتِهِ (M2-04 · الفحصُ 18)\033[0m\n'

CS=scripts/checks/validate-config-schema.sh
CS_REG=packages/config/env-registry.json
CS_ENV=.env.example
CS_GEN=packages/config/src/registry.generated.ts
CS_DISPATCH=services/dispatch/src/config/runtime-config.ts
CS_KEYS=packages/service-auth/src/keys.ts

if [[ ! -f "$CS" ]]; then
  printf '  \033[31m✗\033[0m %s مفقودٌ — لا تُقاسُ عضّةُ حارسٍ غائبٍ\n' "$CS"
  ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

CS_BK=/tmp/configschema_backup
rm -rf "$CS_BK"; mkdir -p "$CS_BK"
cp "$CS_REG" "$CS_BK/registry"
cp "$CS_ENV" "$CS_BK/env"
cp "$CS_GEN" "$CS_BK/generated"
cp "$CS_DISPATCH" "$CS_BK/dispatch"
cp "$CS_KEYS" "$CS_BK/keys"
cp scripts/checks/lib/config_render.py "$CS_BK/render"

_cs_restore() {
  cp "$CS_BK/registry" "$CS_REG"
  cp "$CS_BK/env" "$CS_ENV"
  cp "$CS_BK/generated" "$CS_GEN"
  cp "$CS_BK/dispatch" "$CS_DISPATCH"
  cp "$CS_BK/keys" "$CS_KEYS"
  cp "$CS_BK/render" scripts/checks/lib/config_render.py
}

# طفرةٌ لا تُغيّرُ بايتاً ليست طفرةً — فالعضّةُ المقيسةُ عليها كذبٌ.
_cs_mutated() { # _cs_mutated <ملفٌّ> <نسخةُ الأصلِ>
  if cmp -s "$1" "$2"; then
    printf '  \033[31m✗\033[0m طفرةٌ صامتةٌ: %s لم يتغيّرْ بايتٌ فيهِ\n' "$1"
    ((FAIL++))
    return 1
  fi
  return 0
}

# يحذفُ متغيّراً بالاسمِ من السجلِّ (لا `sed` على JSON: القوسُ يُفسِدُهُ).
_cs_drop_var() { # _cs_drop_var <الاسمُ>
  python3 - "$CS_REG" "$1" <<'MUT'
import json, sys
path, name = sys.argv[1], sys.argv[2]
data = json.load(open(path, encoding="utf-8"))
data["variables"] = [v for v in data["variables"] if v["name"] != name]
json.dump(data, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
MUT
}

# يُبدِّلُ حقلاً في متغيّرٍ مُسمّىً.
_cs_set_field() { # _cs_set_field <الاسمُ> <الحقلُ> <القيمةُ JSON>
  python3 - "$CS_REG" "$1" "$2" "$3" <<'MUT'
import json, sys
path, name, field, raw = sys.argv[1:5]
data = json.load(open(path, encoding="utf-8"))
for var in data["variables"]:
    if var["name"] == name:
        var[field] = json.loads(raw)
json.dump(data, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
MUT
}

# الأصلُ يمرُّ — وبلا هذا لا معنى لأيِّ إخفاقٍ بعدَه.
t "الحالةُ الأصليّةُ تمرُّ (خطُّ الأساسِ)" pass bash "$CS"

# ── البابُ 1: لا قراءةَ غيرَ مُسجَّلةٍ ──────────────────────────────────────
# وهوَ البابُ الذي يمنعُ عودةَ الحالِ الأولى: متغيّرٌ يُقرأُ في نشرةٍ ولا يعرفُهُ
# أحدٌ، فيُكتَشَفُ غيابُهُ بسقوطِ خدمةٍ لا بقراءةِ ملفٍّ.
_cs_drop_var DISPATCH_WAVE_SIZE
if _cs_mutated "$CS_REG" "$CS_BK/registry"; then
  t 'قراءةٌ حيّةٌ حُذِفَ سجلُّها تُسقِطُ الفحصَ' fail bash "$CS"
fi
_cs_restore

# ── البابُ 2: لا إعلانَ ميّتاً ─────────────────────────────────────────────
# إعلانٌ لمتغيّرٍ لم يبقَ لهُ قارئٌ يُنتِجُ `.env.example` يُوصي بضبطِ ما لا يُقرأُ —
# وهذا مصدرُ حقيقةٍ ثانٍ يكذبُ على المُشغِّلِ.
python3 - "$CS_DISPATCH" <<'MUT'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
open(p, "w", encoding="utf-8").write(s.replace('"DISPATCH_MAX_WAVES"', '"DISPATCH_MAX_WAVES_RENAMED"', 1))
MUT
if _cs_mutated "$CS_DISPATCH" "$CS_BK/dispatch"; then
  t 'قارئٌ مُعلَنٌ فقدَ اسمَهُ في ملفِّهِ يُسقِطُ الفحصَ (إعلانٌ ميّتٌ)' fail bash "$CS"
fi
_cs_restore

# ── البابُ 3: المُشتَقُّ = إعادةُ توليدِهِ بايتاً بايتاً ──────────────────────
# وهذا هوَ البابُ الذي يجعلُ السجلَّ **مصدرَ الحقيقةِ** لا ملفّاً ثالثاً: تحريرُ
# المُشتَقِّ بيدٍ يُسقِطُ الفحصَ ولو كانَ التحريرُ صحيحاً في نفسِهِ.
printf '\nWASLA_HAND_EDITED=1\n' >> "$CS_ENV"
if _cs_mutated "$CS_ENV" "$CS_BK/env"; then
  t 'سطرٌ مكتوبٌ بيدٍ في .env.example يُسقِطُ الفحصَ' fail bash "$CS"
fi
_cs_restore

python3 - "$CS_GEN" <<'MUT'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
open(p, "w", encoding="utf-8").write(s.replace('readerCount: 1,', 'readerCount: 99,', 1))
MUT
if _cs_mutated "$CS_GEN" "$CS_BK/generated"; then
  t 'عددٌ مُحرَّرٌ بيدٍ في registry.generated.ts يُسقِطُ الفحصَ' fail bash "$CS"
fi
_cs_restore

# ── البابُ 4: سلامةُ السجلِّ بنيويّاً ───────────────────────────────────────
# سرٌّ لهُ قيمةٌ افتراضيّةٌ ليسَ سرّاً: الافتراضيُّ يُلتزَمُ في المستودعِ بحكمِ
# البابِ 3، فيصيرُ السرُّ منشوراً.
_cs_set_field CUSTOMER_BOT_TOKEN default '"1234:abcd"'
if _cs_mutated "$CS_REG" "$CS_BK/registry"; then
  t 'سرٌّ لهُ قيمةٌ افتراضيّةٌ يُسقِطُ الفحصَ' fail bash "$CS"
fi
_cs_restore

# ── البابُ 5: الاسمُ يُلزِمُ نوعَهُ ──────────────────────────────────────────
# `*_PORT` نصّاً حرّاً يُلغي فحصَ المدى (1..65535)، فيصيرُ الاستماعُ على منفذٍ
# لا يعرفُهُ أحدٌ ممكناً مرّةً أخرى.
_cs_set_field MARKETPLACE_SERVICE_PORT type '"string"'
if _cs_mutated "$CS_REG" "$CS_BK/registry"; then
  t 'متغيّرٌ ينتهي بـ_PORT ونوعُهُ نصٌّ يُسقِطُ الفحصَ' fail bash "$CS"
fi
_cs_restore

# ── البابُ 6: لا تحليلَ رقميّاً عارياً ─────────────────────────────────────
# وهوَ عينُ `RISK-0046`: `Number(process.env.X)` لا يُلقي، فيمرُّ `NaN` إلى قرارٍ.
python3 - "$CS_DISPATCH" <<'MUT'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = s.replace(
    'waveSize: readIntEnv(env, "DISPATCH_WAVE_SIZE", {\n      min: 1,\n      fallback: DISPATCH_RULE_DEFAULTS.waveSize,\n    }),',
    'waveSize: Number(process.env.DISPATCH_WAVE_SIZE ?? 2),',
    1,
)
open(p, "w", encoding="utf-8").write(s)
MUT
if _cs_mutated "$CS_DISPATCH" "$CS_BK/dispatch"; then
  t 'عودةُ Number(process.env.X) إلى شيفرةِ الإنتاجِ تُسقِطُ الفحصَ' fail bash "$CS"
fi
_cs_restore

# ── البابُ 7: كلُّ سرٍّ نائبٌ في المثالِ ────────────────────────────────────
# ولِمَ بابٌ منفصلٌ عن 3: البابُ 3 يقولُ «مُشتَقٌّ»، وهذا يقولُ «ولا قيمةَ سرٍّ
# فيهِ» — فلو غُيِّرَ **المُولِّدُ** ليكتبَ السرَّ لصارَ المُشتَقُّ مطابقاً وفيهِ سرٌّ.
python3 - scripts/checks/lib/config_render.py <<'MUT'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
open(p, "w", encoding="utf-8").write(s.replace('SECRET_PLACEHOLDER = "__SET_ME__"', 'SECRET_PLACEHOLDER = "s3cr3t-value"', 1))
MUT
python3 scripts/config/render-config-artifacts.py >/dev/null 2>&1 || true
t 'مُولِّدٌ يكتبُ قيمةَ سرٍّ بدلَ النائبِ يُسقِطُ الفحصَ' fail bash "$CS"
_cs_restore

# ── البابُ 8: القارئُ غيرُ المباشرِ مُعلَنٌ ومربوطٌ حرفاً ────────────────────
# `keyRegistryFromEnv` يقرأُ مادّةَ المفاتيحِ من **قيمةٍ افتراضيّةٍ في دالّةٍ**، فلا
# يراها الماسحُ. ولولا هذا البابُ لكانَ أخطرُ سرٍّ في النظامِ خارجَ السجلِّ كلِّهِ.
_cs_drop_var WASLA_SERVICE_AUTH_KEYS
if _cs_mutated "$CS_REG" "$CS_BK/registry"; then
  t 'سقوطُ مادّةِ مفاتيحِ الخدمةِ من السجلِّ يُسقِطُ الفحصَ' fail bash "$CS"
fi
_cs_restore

# الأصلُ يمرُّ بعدَ كلِّ الطفراتِ — وبلا هذا فالإخفاقاتُ أعلاهُ قد تكونُ عطباً دائماً.
t "الأصلُ يمرُّ بعدَ استعادةِ كلِّ الطفراتِ" pass bash "$CS"

rm -rf "$CS_BK"
