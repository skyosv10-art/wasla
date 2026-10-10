# gov-cases-edge-allowlist.sh — حالاتُ طفرةٍ للحارس 28 (edge-allowlist-guard · ADR-069 §2.8 · CLM-0521).
#
# تُستدعى من `scripts/checks/test-governance.sh` وتعملُ في نسخةِ `/tmp` (`$T`).
# لكلِّ بابٍ من أبوابِ الحارسِ طفرةٌ يجبُ أن تُسقِطَهُ **هوَ**، ويُستعادُ الأصلُ
# بعدَ كلِّ طفرةٍ ويُثبَتُ أنَّهُ يمرُّ. مطابقةُ النصِّ (البابِ) في المخرَجِ لا رمزَ
# الخروجِ وحدَه — فحارسٌ بلا أبوابٍ مُسقِطةٍ حارسٌ صامتٌ لا حارسٌ.
#
# المرجع: docs/12-testing/EDGE_ALLOWLIST.md · ADR-069 §2.8

printf '\n\033[1m[ح] قوائمُ سماحِ حدِّ القناةِ (ADR-069 §2.8 · CLM-0521 · الحارسُ 28)\033[0m\n'

EA=scripts/checks/validate-edge-allowlist.sh
EA_CUST="packages/channel-edge/allowlist/customer-mini-app.json"

if [[ ! -f "$EA" ]]; then
  printf '  \033[31m✗\033[0m %s مفقودٌ — لا تُقاسُ عضّةُ حارسٍ غائبٍ\n' "$EA"
  ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

EA_BK=/tmp/edge_allowlist_backup
rm -rf "$EA_BK"; mkdir -p "$EA_BK"
cp "$EA_CUST" "$EA_BK/cust.json"

_ea_restore() {
  cp "$EA_BK/cust.json" "$EA_CUST"
}

_ea_mutated() { # طفرةٌ صامتةٌ = إخفاقٌ في الاختبارِ نفسِهِ لا في الحارسِ
  if cmp -s "$EA_CUST" "$EA_BK/cust.json"; then
    printf '  \033[31m✗\033[0m طفرةٌ صامتةٌ: %s لم يتغيّرْ بايتٌ فيهِ\n' "$EA_CUST"
    ((FAIL++))
    return 1
  fi
  return 0
}

# الحالةُ الأساسُ: المستودعُ المنسوخُ يمرُّ — وإلّا فالحارسُ مكسورٌ على الحقيقةِ الحاليةِ.


# طفرةٌ (أ): فتحُ إنتاجٍ لفئةٍ N (route-transitions هي scoped)
python3 - "$EA_CUST" <<'MUT'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding='utf-8'))
e = next(x for x in d['entries'] if x['path'] == '/reputation/ratings' and x['method'] == 'GET')
e['production_open'] = True
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
MUT
_ea_mutated || { _ea_restore; return 0 2>/dev/null || exit 1; }
t "فتحُ إنتاجٍ لفئةٍ N يُسقِط (البابُ أ)" fail bash "$EA"
_ea_restore

# طفرةٌ (ب): ادعاءُ فئةٍ O لمسارٍ مقيسٍ N (scoping لا ownerScoped)
python3 - "$EA_CUST" <<'MUT'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding='utf-8'))
e = next(x for x in d['entries'] if x['path'] == '/reputation/ratings' and x['method'] == 'GET')
e['class'] = 'O'
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
MUT
_ea_mutated || { _ea_restore; return 0 2>/dev/null || exit 1; }
t "ادعاءُ O لمسارٍ مقيسٍ N يُسقِط (البابُ ب)" fail bash "$EA"
_ea_restore

# طفرةٌ (ج): دليلٌ يشيرُ إلى ملفٍّ غيرِ موجودٍ
python3 - "$EA_CUST" <<'MUT'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding='utf-8'))
e = next(x for x in d['entries'] if x['path'] == '/customers/:waslaPublicId/profile' and x['method'] == 'GET')
e['evidence_tests'] = [{'file': 'services/customers/src/__tests__/does-not-exist.test.ts', 'case': 'x'}]
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
MUT
_ea_mutated || { _ea_restore; return 0 2>/dev/null || exit 1; }
t "دليلٌ يشيرُ إلى ملفٍّ غيرِ موجودٍ يُسقِط (البابُ ج)" fail bash "$EA"
_ea_restore

# طفرةٌ (د): مسارٌ لا يناديه التطبيقُ (الفحصُ 24)
python3 - "$EA_CUST" <<'MUT'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding='utf-8'))
d['entries'].append({
  'method': 'GET', 'path': '/customers/:waslaPublicId/no-such-screen', 'service': 'customers',
  'class': 'O', 'required_scopes': ['customers:profile:read'], 'production_open': False,
  'evidence_tests': [],
  'blocked_until': 'طفرةُ اختبارٍ — مسارٌ لا يناديه التطبيق',
})
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
MUT
_ea_mutated || { _ea_restore; return 0 2>/dev/null || exit 1; }
t "مسارٌ لا يناديه التطبيقُ يُسقِط (البابُ د · الفحصُ 24)" fail bash "$EA"
_ea_restore

# طفرةٌ (ج2): حالةُ الدليلِ موجودةٌ في ملفٍّ موجودٍ لكنها غيرُ مكتوبةٍ فيهِ (دليلٌ يزعمُ
# حالةً لا وجودَ لها — لا يُقبلُ إلا وجودُ النصِّ نفسِهِ في الملفِّ، لأنَّ ``evidence_tests``
# وعدٌ باختبارٍ حقيقيٍّ قابلٍ للإعادةِ لا مجرّدِ إشارةٍ إلى ملفٍّ.
python3 - "$EA_CUST" <<'MUT'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding='utf-8'))
e = next(x for x in d['entries'] if x['path'] == '/customers/:waslaPublicId/profile' and x['method'] == 'GET')
e['evidence_tests'][0]['case'] = 'هذه الحالةُ غيرُ موجودةٍ في الملفِّ إطلاقًا'
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
MUT
_ea_mutated || { _ea_restore; return 0 2>/dev/null || exit 1; }
t "دليلٌ يشيرُ إلى حالةٍ غيرِ مكتوبةٍ في الملفِّ يُسقِط (البابُ ج · حالة)" fail bash "$EA"
_ea_restore

# طفرةٌ (ج2 · أقوى): مسارٌ production_open=false بلا دليلِ ملكيةٍ يُسقِط أيضًا —
# ``evidence_tests`` مطلوبةٌ على **كل** مسارٍ مصنَّفٍ O في القائمة (وليس المفتوحَ فقط):
# فتحُ قائمةٍ يزعمُ مساراً عالميَّ القراءةِ ولا اختبارَ يقيسُ حصرَ القراءةِ إلى مالكِهِ
# هوَ مسرِّحٌ كاملٌ لفئةِ P (النصُّ ``production_open=false`` يُعلِنُ عن انسدادِ الحدِّ
# لا عن غيابِ الدليلِ الذي يقيسُ الحصرَ). لا يُقبلُ بابٌ يحصرُ الدليلَ إلى المفتوحِ
# فقط: الطفرةُ إلى قائمةٍ مغلقةٍ بلا دليلٍ تُسقِطُ الحارسَ، وإلّا فالحارسُ يعدُّ
# الدليلَ **شرطَ حصرٍ** لا شرطَ فتحٍ — وهذا مخالفٌ لفحصِ E-23.
python3 - "$EA_CUST" <<'MUT'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding='utf-8'))
e = next(x for x in d['entries'] if x['path'] == '/customers/:waslaPublicId/profile' and x['method'] == 'GET')
e['evidence_tests'] = []
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
MUT
_ea_mutated || { _ea_restore; return 0 2>/dev/null || exit 1; }
t "مسارٌ مصنَّفٌ O بلا دليلِ ملكيةٍ يُسقِط (البابُ ج · شرطُ حصرٍ)" fail bash "$EA"
_ea_restore

# طفرةٌ (هـ): مدخلٌ خارجَ لقطةِ route-enforcement.json التاريخيةِ
python3 - "$EA_CUST" <<'MUT'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding='utf-8'))
d['entries'].append({
  'method': 'GET', 'path': '/subscriptions/plans', 'service': 'subscriptions',
  'class': 'O', 'required_scopes': ['subscriptions:plans:read'], 'production_open': False,
  'evidence_tests': [],
  'blocked_until': 'طفرةُ اختبارٍ — مدخلٌ خارجَ اللقطةِ',
})
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
MUT
_ea_mutated || { _ea_restore; return 0 2>/dev/null || exit 1; }
t "مدخلٌ خارجَ لقطةِ التصنيفِ التاريخيةِ يُسقِط (البابُ هـ)" fail bash "$EA"
_ea_restore

# استعادةُ الأصلِ وتمريرُهُ أخيرًا: البابُ يعملُ والطفرةُ لم تُخلِّف أثرًا
t "الأصلُ يمرُّ بعدَ كلِّ الطفراتِ (الاستعادةُ صادقة)" pass bash "$EA"
