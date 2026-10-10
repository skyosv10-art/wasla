# gov-cases-edge-allowlist.sh — حالاتُ طفرةٍ للحارس 28 (edge-allowlist-guard · ADR-069 §2.8 · CLM-0521).
#
# تُستدعى من `scripts/checks/test-governance.sh` وتعملُ في نسخةِ `/tmp` (`$T`).
#
# عقدُ كلِّ طفرةٍ (`_ea_door`): الحارسُ 28 نفسُه يُستدعى مباشرةً، ويجبُ أن:
#   1. يخرجَ برمزٍ غيرِ صفريٍّ،
#   2. ويطبعَ سطرَ إخفاقِه هوَ (`✗ edge-allowlist-guard`)،
#   3. ويطبعَ رمزَ البابِ المستهدَفِ بعينِه (`[EA-…]`)،
#   4. ولا يطبعَ رمزَ البابِ المستبعَدِ إن سُمّيَ (عزلُ السببِ: الطفرةُ تُسقِطُ
#      البابَ المقصودَ لا بابًا مجاورًا مصادفةً).
# فإسقاطُ اختبارٍ آخرَ أو رمزُ خروجٍ وحدَه لا يكفي.
#
# وتجاورُها ضوابطُ موجبةٌ (`_ea_pass`): الدليلُ والقرارُ الكاملانِ يُمرّانِ البابَ —
# كي لا يكونَ البابُ جدارًا أعمى يرفضُ كلَّ شيءٍ فيبدو صارمًا وهو لا يقيس.
# الأدلةُ والمنحُ الاصطناعيةُ تُكتبُ في نسخةِ `/tmp` وحدَها وتُمحى بعدَ كلِّ حالةٍ؛
# المستودعُ الحقيقيُّ لا يُفتَحُ فيه مدخلٌ (production_open=false على الـ29).
#
# المرجع: docs/12-testing/EDGE_ALLOWLIST.md · ADR-069 §2.8 · §7.2 (E-18/E-19/E-20)

printf '\n\033[1m[ح] قوائمُ سماحِ حدِّ القناةِ (ADR-069 §2.8 · CLM-0521 · الحارسُ 28)\033[0m\n'

EA=scripts/checks/validate-edge-allowlist.sh
EA_CUST="packages/channel-edge/allowlist/customer-mini-app.json"
EA_DRV="packages/channel-edge/allowlist/driver-mini-app.json"
EA_GRANTS="packages/authz-policy/src/grants.ts"
EA_CUST_APP="services/customers/src/http/app.ts"
EA_DRV_APP="services/drivers/src/http/app.ts"
EA_E18="services/customers/src/__tests__/zz-ea-synthetic-owner.test.ts"
EA_E20="services/search/src/__tests__/zz-ea-synthetic-public.test.ts"

if [[ ! -f "$EA" ]]; then
  printf '  \033[31m✗\033[0m %s مفقودٌ — لا تُقاسُ عضّةُ حارسٍ غائبٍ\n' "$EA"
  ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

EA_BK=/tmp/edge_allowlist_backup
rm -rf "$EA_BK"; mkdir -p "$EA_BK"
for _f in "$EA_CUST" "$EA_DRV" "$EA_GRANTS" "$EA_CUST_APP" "$EA_DRV_APP"; do
  cp "$_f" "$EA_BK/$(echo "$_f" | tr / _)"
done

_ea_restore() {
  for _f in "$EA_CUST" "$EA_DRV" "$EA_GRANTS" "$EA_CUST_APP" "$EA_DRV_APP"; do
    cp "$EA_BK/$(echo "$_f" | tr / _)" "$_f"
  done
  rm -f "$EA_E18" "$EA_E20"
}

# _ea_mut <python> — يعدّلُ ملفّاتِ /tmp ويتحقّقُ أنَّ الطفرةَ غيّرتْ بايتًا فعلًا.
# مساعدات: load(p) · save(p,d) · entry(d,method,path) · ins_grant(role,aud,scopes)
_ea_mut() {
  local before after
  before="$(cat "$EA_CUST" "$EA_DRV" "$EA_GRANTS" "$EA_CUST_APP" "$EA_DRV_APP" 2>/dev/null | sha256sum)"
  python3 - "$EA_CUST" "$EA_DRV" "$EA_GRANTS" "$1" <<'PY'
import json, re, sys
CUST, DRV, GRANTS, code = sys.argv[1:5]
def load(p): return json.load(open(p, encoding='utf-8'))
def save(p, d): json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
def entry(d, m, p): return next(x for x in d['entries'] if x['method'] == m and x['path'] == p)
def ins_grant(role, aud, scopes):
    s = open(GRANTS, encoding='utf-8').read()
    k = f'"{role}": ['
    assert k in s, k
    g = '\n    { audience: "%s", scopes: [%s], reason: "طفرة اختبار", evidence: [] },' % (
        aud, ", ".join('"%s"' % x for x in scopes))
    open(GRANTS, 'w', encoding='utf-8').write(s.replace(k, k + g, 1))
exec(code)
PY
  after="$(cat "$EA_CUST" "$EA_DRV" "$EA_GRANTS" "$EA_CUST_APP" "$EA_DRV_APP" 2>/dev/null | sha256sum)"
  if [[ "$before" == "$after" ]]; then
    printf '  \033[31m✗\033[0m طفرةٌ صامتةٌ: لم يتغيّرْ بايتٌ في ملفّاتِ الحالة\n'
    ((FAIL++)); return 1
  fi
  return 0
}

# _ea_door <وصف> <رمز-الباب> [رمز-يجب-غيابه]
_ea_door() {
  local desc="$1" code="$2" absent="${3:-}" out rc ok=1
  out="$(bash "$EA" 2>&1)"; rc=$?
  (( rc != 0 )) || ok=0
  grep -qF "✗ edge-allowlist-guard" <<<"$out" || ok=0
  grep -qF "[$code]" <<<"$out" || ok=0
  if [[ -n "$absent" ]] && grep -qF "[$absent]" <<<"$out"; then ok=0; fi
  if (( ok )); then
    printf '  \033[32m✓\033[0m %-62s (الحارسُ 28 أسقطَ بالبابِ %s)\n' "$desc" "$code"; ((PASS++))
  else
    printf '  \033[31m✗\033[0m %-62s متوقعٌ إسقاطُ الحارسِ 28 بالبابِ [%s]%s (rc=%d)\n' \
      "$desc" "$code" "${absent:+ دون [$absent]}" "$rc"
    printf '%s\n' "$out" | sed 's/^/      /' | tail -8
    ((FAIL++))
  fi
}

_ea_pass() { t "$1" pass bash "$EA"; }

# كتابةُ دليلٍ اصطناعيٍّ في /tmp. $1=ملف $2=محتوى
_ea_write() { mkdir -p "$(dirname "$1")"; printf '%s\n' "$2" > "$1"; }

E18_SRC='import { describe, expect, it } from "vitest";
process.env.WASLA_USER_ASSERTION_MODE = "off";
describe("synthetic owner-scope evidence (governance mutation only)", () => {
  it("E-18 synthetic: session A reading B profile → 404", async () => {
    const res = await app.inject({ method: "GET", url: `/customers/${B}/profile` });
    expect(res.statusCode).toBe(404);
  });
  it("E-19 synthetic: body field naming B → 403", async () => {
    const res = await app.inject({ method: "PUT", url: `/customers/${A}/profile`, payload: { waslaPublicId: B } });
    expect(res.statusCode).toBe(403);
  });
  it.skip("E-18 skipped synthetic: session A reading B profile → 404", async () => {
    await app.inject({ method: "GET", url: `/customers/${B}/profile` });
  });
});'

E20_SRC='import { describe, expect, it } from "vitest";
describe("synthetic public-read evidence (governance mutation only)", () => {
  it("E-20 synthetic: edge rejects state/moderation_state/visible_only/owner_public_id → 400", async () => {
    for (const q of ["state=draft", "moderation_state=pending", "visible_only=false", "owner_public_id=x"]) {
      const res = await edge.inject({ method: "GET", url: `/search/products?${q}` });
      expect(res.statusCode).toBe(400);
    }
  });
  it("E-20 synthetic: response holds published visible rows only", async () => {
    const res = await edge.inject({ method: "GET", url: `/search/products` });
    expect(res.json().items.every((p) => p.state === "published")).toBe(true);
  });
});'

E18_CASE='E-18 synthetic: session A reading B profile → 404'
E19_CASE='E-19 synthetic: body field naming B → 403'
E20P_CASE='E-20 synthetic: edge rejects state/moderation_state/visible_only/owner_public_id → 400'
E20R_CASE='E-20 synthetic: response holds published visible rows only'
export EA_E18 EA_E20 E18_CASE E19_CASE E20P_CASE E20R_CASE

# الحالةُ الأساسُ: القائمتانِ الحقيقيتانِ تمرّانِ (29 مدخلًا، كلُّها مغلقة).
_ea_pass "الأساسُ: القائمتانِ الحقيقيتانِ تمرّانِ قبلَ الطفرات"

# ═══ حالةُ الفتح والفئة ═══════════════════════════════════════════════════
_ea_mut "d=load(CUST); entry(d,'GET','/reputation/ratings')['production_open']=True; save(CUST,d)" \
  && _ea_door "فتحُ مدخلٍ N" EA-OPEN-CLASS; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/stores')['production_open']=True; save(CUST,d)" \
  && _ea_door "فتحُ مدخلٍ W (قبلَ G-ENF)" EA-OPEN-CLASS; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/profile')['production_open']='true'; save(CUST,d)" \
  && _ea_door "production_open نصٌّ \"true\" لا قيمةٌ منطقية" EA-OPEN-TYPE; _ea_restore
_ea_mut "d=load(CUST); del entry(d,'GET','/customers/:waslaPublicId/profile')['production_open']; save(CUST,d)" \
  && _ea_door "حقلُ production_open محذوف" EA-FIELD; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/reputation/ratings')['class']='O'; save(CUST,d)" \
  && _ea_door "ادعاءُ O لمسارٍ مقيسٍ N" EA-CLASS-CODE; _ea_restore
_ea_mut "d=load(CUST); e=entry(d,'GET','/customers/:waslaPublicId/profile'); e['class']='P'; e['blocked_until']='x'; save(CUST,d)" \
  && _ea_door "إعادةُ وسمِ O إلى P هربًا من E-18" EA-CLASS-CODE; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/stores')['class']='ADM'; save(CUST,d)" \
  && _ea_door "فئةُ ADM في قائمةِ Mini App" EA-ADM; _ea_restore

# ═══ الفئةُ O: E-18 / E-19 / المستقبلُ off / المنح ════════════════════════
_O_OPEN_E18="e=entry(d,'GET','/customers/:waslaPublicId/profile'); e['production_open']=True; "
_O_OPEN_E18+="e['evidence_tests'].append({'file':'$EA_E18','case':'$E18_CASE','proves':['E-18'],'route':'GET /customers/:waslaPublicId/profile','receiver_mode':'off'})"

_ea_mut "d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/profile')['production_open']=True; save(CUST,d)" \
  && _ea_door "فتحُ O بلا دليلِ E-18" EA-O-E18; _ea_restore

_ea_write "$EA_E18" "$E18_SRC"
_ea_mut "d=load(CUST); $_O_OPEN_E18; save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:read'])" \
  && _ea_pass "ضابطٌ موجب: فتحُ O (GET) بدليلِ E-18 كاملٍ ومنحٍ صريحٍ يمرّ"; _ea_restore

_ea_write "$EA_E18" "$E18_SRC"
_ea_mut "d=load(CUST); $_O_OPEN_E18; save(CUST,d)" \
  && _ea_door "فتحُ O بدليلٍ كاملٍ لكن بلا منحٍ للدورِ customer-bot" EA-SCOPE-GRANT EA-O-E18; _ea_restore

_ea_write "$EA_E18" "$E18_SRC"
_ea_mut "d=load(CUST); $_O_OPEN_E18; entry(d,'GET','/customers/:waslaPublicId/profile')['evidence_tests'][-1]['receiver_mode']='enforce'; save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:read'])" \
  && _ea_door "دليلُ E-18 والمستقبلُ enforce لا off" EA-O-E18; _ea_restore

_ea_write "$EA_E18" "${E18_SRC//WASLA_USER_ASSERTION_MODE = \"off\"/WASLA_USER_ASSERTION_MODE = \"enforce\"}"
_ea_mut "d=load(CUST); $_O_OPEN_E18; save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:read'])" \
  && _ea_door "ملفُّ E-18 لا يضبطُ WASLA_USER_ASSERTION_MODE=off" EA-O-E18; _ea_restore

_ea_write "$EA_E18" "$E18_SRC"
_ea_mut "d=load(CUST); $_O_OPEN_E18; entry(d,'GET','/customers/:waslaPublicId/profile')['evidence_tests'][-1]['route']='GET /customers/:waslaPublicId/addresses'; save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:read'])" \
  && _ea_door "دليلُ E-18 معلنٌ لمسارٍ آخر" EA-O-E18; _ea_restore

_ea_write "$EA_E18" "${E18_SRC//\/profile\`/\/addresses\`}"
_ea_mut "d=load(CUST); $_O_OPEN_E18; save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:read'])" \
  && _ea_door "ملفُّ E-18 لا ينادي المسارَ نفسَه" EA-O-E18; _ea_restore

_ea_write "$EA_E18" "$E18_SRC"
_ea_mut "d=load(CUST); $_O_OPEN_E18; entry(d,'GET','/customers/:waslaPublicId/profile')['evidence_tests'][-1]['case']='E-18 skipped synthetic: session A reading B profile → 404'; save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:read'])" \
  && _ea_door "دليلُ E-18 حالةُ it.skip" EA-O-E18; _ea_restore

_O_PUT="e=entry(d,'PUT','/customers/:waslaPublicId/profile'); e['production_open']=True; "
_O_PUT+="e['evidence_tests'].append({'file':'$EA_E18','case':'$E18_CASE','proves':['E-18'],'route':'GET /customers/:waslaPublicId/profile','receiver_mode':'off'}); "
_O_PUT+="e['evidence_tests'][-1]['route']='PUT /customers/:waslaPublicId/profile'"
_ea_write "$EA_E18" "$E18_SRC"
_ea_mut "d=load(CUST); $_O_PUT; save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:write'])" \
  && _ea_door "فتحُ O يقبلُ جسمًا (PUT) بـE-18 وبلا E-19" EA-O-E19 EA-O-E18; _ea_restore

_ea_write "$EA_E18" "$E18_SRC"
_ea_mut "d=load(CUST); $_O_PUT; e['evidence_tests'].append({'file':'$EA_E18','case':'$E19_CASE','proves':['E-19'],'route':'PUT /customers/:waslaPublicId/profile','receiver_mode':'off'}); save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:write'])" \
  && _ea_pass "ضابطٌ موجب: فتحُ O (PUT) بـE-18 وE-19 ومنحٍ يمرّ"; _ea_restore

# ═══ الفئةُ P: E-20 بشقّيه ═══════════════════════════════════════════════
_P_PARAMS="{'file':'$EA_E20','case':'$E20P_CASE','proves':['E-20:params'],'route':'GET /search/products'}"
_P_PUB="{'file':'$EA_E20','case':'$E20R_CASE','proves':['E-20:published-only'],'route':'GET /search/products'}"

_ea_mut "d=load(CUST); entry(d,'GET','/search/products')['production_open']=True; save(CUST,d); ins_grant('customer-bot','search',['search:products:read'])" \
  && _ea_door "فتحُ P بلا دليلِ E-20" EA-P-E20; _ea_restore

_ea_write "$EA_E20" "$E20_SRC"
_ea_mut "d=load(CUST); e=entry(d,'GET','/search/products'); e['production_open']=True; e['evidence_tests']=[$_P_PARAMS]; save(CUST,d); ins_grant('customer-bot','search',['search:products:read'])" \
  && _ea_door "فتحُ P بتقييدِ المعاملاتِ وحدَه بلا «المنشور فقط»" EA-P-E20; _ea_restore

_ea_write "$EA_E20" "$E20_SRC"
_ea_mut "d=load(CUST); e=entry(d,'GET','/search/products'); e['production_open']=True; e['evidence_tests']=[$_P_PUB]; save(CUST,d); ins_grant('customer-bot','search',['search:products:read'])" \
  && _ea_door "فتحُ P بـ«المنشور فقط» وحدَه بلا تقييدِ المعاملات" EA-P-E20; _ea_restore

_ea_write "$EA_E20" "${E20_SRC//visible_only/vis_only}"
_ea_mut "d=load(CUST); e=entry(d,'GET','/search/products'); e['production_open']=True; e['evidence_tests']=[$_P_PARAMS,$_P_PUB]; save(CUST,d); ins_grant('customer-bot','search',['search:products:read'])" \
  && _ea_door "دليلُ E-20 لا يختبرُ رفضَ visible_only" EA-P-E20; _ea_restore

_ea_write "$EA_E20" "$E20_SRC"
_ea_mut "d=load(CUST); e=entry(d,'GET','/search/products'); e['production_open']=True; e['evidence_tests']=[$_P_PARAMS,$_P_PUB]; save(CUST,d); ins_grant('customer-bot','search',['search:products:read'])" \
  && _ea_pass "ضابطٌ موجب: فتحُ P بشقّي E-20 ومنحٍ يمرّ"; _ea_restore

# ═══ الصلاحيات ════════════════════════════════════════════════════════════
_ea_mut "d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/profile')['required_scopes']=['customers:profile:write']; save(CUST,d)" \
  && _ea_door "customers:profile:read → customers:profile:write" EA-SCOPE-CODE EA-SCOPE-UNKNOWN; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/profile')['required_scopes']=[]; save(CUST,d)" \
  && _ea_door "required_scopes فارغة" EA-SCOPE-EMPTY; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/profile')['required_scopes']='customers:profile:read'; save(CUST,d)" \
  && _ea_door "required_scopes نصٌّ لا قائمة" EA-SCOPE-EMPTY; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/profile')['required_scopes']=['customers:profile:admin']; save(CUST,d)" \
  && _ea_door "صلاحيةٌ خارجَ كتالوجِ الخدمةِ المعتمد" EA-SCOPE-UNKNOWN; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/profile')['required_scopes'].append('customers:profile:write'); save(CUST,d)" \
  && _ea_door "صلاحيةٌ زائدةٌ على صلاحيةِ المسار" EA-SCOPE-CODE; _ea_restore
# تغييرُ الإذنِ في الشفرةِ والقائمةِ معًا (متطابقانِ) — اللقطةُ التاريخيةُ تطلبُ قرارًا.
_ea_mut "import pathlib; p=pathlib.Path('$EA_CUST_APP'); s=p.read_text(encoding='utf-8'); k='\"/customers/:waslaPublicId/profile\",\n    { config: ownerScoped(CUSTOMER_SCOPES.profileRead) }'; assert k in s; p.write_text(s.replace(k,k.replace('profileRead','profileWrite'),1),encoding='utf-8'); d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/profile')['required_scopes']=['customers:profile:write']; save(CUST,d)" \
  && _ea_door "تغييرُ الإذنِ في الشفرةِ والقائمةِ معًا بلا قرار" EA-SCOPE-SNAPSHOT EA-SCOPE-CODE; _ea_restore

# ═══ وجهةُ الخدمة ═════════════════════════════════════════════════════════
# مسارٌ مطابقٌ وفئةٌ مقيسةٌ مطابقةٌ (ownerScoped ⇒ O) تُزرعُ في خدمةِ drivers —
# فلا يبقى إلّا بابُ الوجهةِ يفصلُ بينَهما.
_ea_mut "import pathlib; p=pathlib.Path('$EA_DRV_APP'); p.write_text(p.read_text(encoding='utf-8')+'\napp.get(\n    \"/customers/:waslaPublicId/profile\",\n    { config: ownerScoped(\"customers:profile:read\") },\n    async () => ({}));\n',encoding='utf-8'); d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/profile')['service']='drivers'; save(CUST,d)" \
  && _ea_door "تحويلُ الوجهةِ إلى drivers ومسارٌ وفئةٌ متشابهانِ هناك" EA-SVC-SNAPSHOT EA-SVC-ROUTE; _ea_restore
_ea_mut "d=load(DRV); entry(d,'GET','/dispatch/jobs/:job_id')['service']='orders'; save(DRV,d)" \
  && _ea_door "تحويلُ وجهةِ مسارِ السائقِ إلى orders" EA-SVC-SNAPSHOT; _ea_restore

# ═══ الأدلةُ والنداءُ واللقطة ═══════════════════════════════════════════
_ea_mut "d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/profile')['evidence_tests']=[{'file':'services/customers/src/__tests__/does-not-exist.test.ts','case':'x'}]; save(CUST,d)" \
  && _ea_door "دليلٌ يشيرُ إلى ملفٍّ غيرِ موجود" EA-EVID-FILE; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/profile')['evidence_tests'][0]['case']='هذه الحالةُ غيرُ موجودةٍ في الملفِّ إطلاقًا'; save(CUST,d)" \
  && _ea_door "دليلٌ يشيرُ إلى حالةٍ غيرِ مكتوبة" EA-EVID-CASE; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/profile')['evidence_tests']=[]; save(CUST,d)" \
  && _ea_door "مدخلُ O مغلقٌ بلا دليلِ ملكية (E-23)" EA-EVID-O; _ea_restore
_ea_mut "d=load(CUST); d['entries'].append({'method':'GET','path':'/customers/:waslaPublicId/no-such-screen','service':'customers','class':'O','required_scopes':['customers:profile:read'],'production_open':False,'evidence_tests':[]}); save(CUST,d)" \
  && _ea_door "مسارٌ لا يناديه التطبيق (الفحص 24)" EA-CALL; _ea_restore
_ea_mut "d=load(CUST); d['entries'].append({'method':'GET','path':'/subscriptions/plans','service':'subscriptions','class':'N','required_scopes':['subscriptions:plans:read'],'production_open':False,'evidence_tests':[],'blocked_until':'x'}); save(CUST,d)" \
  && _ea_door "مدخلٌ خارجَ اللقطةِ التاريخية" EA-SNAPSHOT-NEW; _ea_restore

# الاستعادةُ صادقة: الأصلُ يمرُّ ولا أثرَ اصطناعيًّا باقٍ.
t "الأصلُ يمرُّ بعدَ كلِّ الطفراتِ (الاستعادةُ صادقة)" pass bash "$EA"
t "لا دليلَ اصطناعيًّا باقٍ في النسخة" fail test -e "$EA_E18" -o -e "$EA_E20"
