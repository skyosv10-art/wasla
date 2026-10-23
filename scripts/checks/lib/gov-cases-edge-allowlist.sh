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

# الأدلة الاصطناعية: كل ادعاء داخل حالته نفسها (المحلل يقرأ جسم الحالة وحده — CLM-0523).
# المتغيّرات المسمّاة «hollow/unrelated/mention/…» حالاتٌ حيّةٌ في الملف نفسه لا تُثبت ادعاءها.
E18_SRC='import { describe, expect, it } from "vitest";
const A = "cust-session-a";
const B = "cust-resource-b";
// it("E-18 commented synthetic: session A reading B profile → 404", async () => {});
const decoy = `it("E-18 string synthetic: session A reading B profile → 404", async () => {})`;
describe("synthetic owner-scope evidence (governance mutation only)", () => {
  it("E-18 synthetic: session A reading B profile → 404", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    const res = await app.inject({ method: "GET", url: `/customers/${B}/profile`, headers: { obo: A } });
    expect(res.statusCode).toBe(404);
  });
  it("E-18 PUT synthetic: session A writing B profile → 404", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    const res = await app.inject({ method: "PUT", url: `/customers/${B}/profile`, headers: { obo: A }, payload: { display_name: "x" } });
    expect(res.statusCode).toBe(404);
  });
  it("E-18 hollow synthetic: titled right, no request and no 404", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    expect(true).toBe(true);
  });
  it("E-18 same-identity synthetic: session B reading B profile → 404", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    const res = await app.inject({ method: "GET", url: `/customers/${B}/profile`, headers: { obo: B } });
    expect(res.statusCode).toBe(404);
  });
  it("E-18 other-request synthetic: 404 asserted on a different response", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    const res = await app.inject({ method: "GET", url: `/customers/${B}/profile`, headers: { obo: A } });
    const other = await app.inject({ method: "GET", url: `/health`, headers: { obo: A } });
    expect(res.statusCode).toBe(200);
    expect(other.statusCode).toBe(404);
  });
  it("E-19 synthetic: body field naming B → 403", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    const res = await app.inject({ method: "PUT", url: `/customers/${A}/profile`, headers: { obo: A }, payload: { wasla_public_id: B } });
    expect(res.statusCode).toBe(403);
  });
  it("E-19 stored synthetic: body field naming B is not stored", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    const res = await app.inject({ method: "PUT", url: `/customers/${A}/profile`, headers: { obo: A }, payload: { wasla_public_id: B } });
    const stored = res.json();
    expect(stored.waslaPublicId).toBe(A);
  });
  it("E-19 mention synthetic: names wasla_public_id but never sends it", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    const field = "wasla_public_id";
    const res = await app.inject({ method: "PUT", url: `/customers/${A}/profile`, headers: { obo: A }, payload: { display_name: field } });
    expect(res.statusCode).toBe(403);
  });
  it("E-19 unchecked synthetic: sends B but asserts nothing about it", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    const res = await app.inject({ method: "PUT", url: `/customers/${A}/profile`, headers: { obo: A }, payload: { wasla_public_id: B } });
    expect(res.statusCode).toBe(200);
  });
  it("E-19 GET synthetic: GET body field naming B → 403", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    const res = await app.inject({ method: "GET", url: `/customers/${A}/profile`, headers: { obo: A }, payload: { wasla_public_id: B } });
    expect(res.statusCode).toBe(403);
  });
  it("E-18 if-false synthetic: request and 404 inside if (false)", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    if (false) {
      const res = await app.inject({ method: "GET", url: `/customers/${B}/profile`, headers: { obo: A } });
      expect(res.statusCode).toBe(404);
    }
  });
  it("E-18 off-after synthetic: receiver set to off after the request", async () => {
    const res = await app.inject({ method: "GET", url: `/customers/${B}/profile`, headers: { obo: A } });
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    expect(res.statusCode).toBe(404);
  });
  it("E-18 off-branch synthetic: receiver set to off only under a flag", async () => {
    if (process.env.CI) process.env.WASLA_USER_ASSERTION_MODE = "off";
    const res = await app.inject({ method: "GET", url: `/customers/${B}/profile`, headers: { obo: A } });
    expect(res.statusCode).toBe(404);
  });
  it("E-18 reset synthetic: receiver reset to enforce before the request", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    process.env.WASLA_USER_ASSERTION_MODE = "enforce";
    const res = await app.inject({ method: "GET", url: `/customers/${B}/profile`, headers: { obo: A } });
    expect(res.statusCode).toBe(404);
  });
  it("E-18 early-return synthetic: returns before the request", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    if (!app) return;
    const res = await app.inject({ method: "GET", url: `/customers/${B}/profile`, headers: { obo: A } });
    expect(res.statusCode).toBe(404);
  });
  it("E-18 ternary synthetic: 404 asserted only inside ?:", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    const res = await app.inject({ method: "GET", url: `/customers/${B}/profile`, headers: { obo: A } });
    res.statusCode === 404 ? expect(res.statusCode).toBe(404) : undefined;
  });
  it("E-18 callback synthetic: 404 asserted inside a callback", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    const res = await app.inject({ method: "GET", url: `/customers/${B}/profile`, headers: { obo: A } });
    setTimeout(() => { expect(res.statusCode).toBe(404); }, 0);
  });
  it("E-18 if-true synthetic: guarded by a literal if (true)", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    if (true) {
      const res = await app.inject({ method: "GET", url: `/customers/${B}/profile`, headers: { obo: A } });
      expect(res.statusCode).toBe(404);
    }
  });
  it("E-19 branch synthetic: rejection asserted only under a condition", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    const res = await app.inject({ method: "PUT", url: `/customers/${A}/profile`, headers: { obo: A }, payload: { wasla_public_id: B } });
    if (res.statusCode !== 200) expect(res.statusCode).toBe(403);
  });
  it("E-19 short-circuit synthetic: stored value asserted behind &&", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    const res = await app.inject({ method: "PUT", url: `/customers/${A}/profile`, headers: { obo: A }, payload: { wasla_public_id: B } });
    const stored = res.json();
    stored.ok && expect(stored.waslaPublicId).toBe(A);
  });
  it.skip("E-18 skipped synthetic: session A reading B profile → 404", async () => {
    process.env.WASLA_USER_ASSERTION_MODE = "off";
    const res = await app.inject({ method: "GET", url: `/customers/${B}/profile`, headers: { obo: A } });
    expect(res.statusCode).toBe(404);
  });
  it.todo("E-18 todo synthetic: session A reading B profile → 404");
});'

E20_SRC='import { describe, expect, it } from "vitest";
describe("synthetic public-read evidence (governance mutation only)", () => {
  it("E-20 synthetic: edge rejects state/moderation_state/visible_only/owner_public_id → 400", async () => {
    for (const q of ["state=draft", "moderation_state=pending", "visible_only=false", "owner_public_id=x"]) {
      const res = await edge.inject({ method: "GET", url: `/search/products?${q}` });
      expect(res.statusCode).toBe(400);
    }
  });
  it("E-20 partial synthetic: only three of the four parameters → 400", async () => {
    for (const q of ["state=draft", "moderation_state=pending", "visible_only=false"]) {
      const res = await edge.inject({ method: "GET", url: `/search/products?${q}` });
      expect(res.statusCode).toBe(400);
    }
    const note = "owner_public_id 400";
  });
  it("E-20 not-400 synthetic: all four parameters but asserts 200", async () => {
    for (const q of ["state=draft", "moderation_state=pending", "visible_only=false", "owner_public_id=x"]) {
      const res = await edge.inject({ method: "GET", url: `/search/products?${q}` });
      expect(res.statusCode).toBe(200);
    }
  });
  it("E-20 synthetic: response holds published visible rows only", async () => {
    const res = await edge.inject({ method: "GET", url: `/search/products` });
    const items = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p) => p.state === "published" && p.visible === true)).toBe(true);
  });
  it("E-20 status-only synthetic: published visible (named, not checked)", async () => {
    const res = await edge.inject({ method: "GET", url: `/search/products` });
    // every row is published and visible
    expect(res.statusCode).toBe(200);
  });
  it("E-20 published-not-visible synthetic: checks state only", async () => {
    const res = await edge.inject({ method: "GET", url: `/search/products` });
    const items = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p) => p.state === "published")).toBe(true);
  });
  it("E-20 branch-params synthetic: 400 asserted only under a flag", async () => {
    for (const q of ["state=draft", "moderation_state=pending", "visible_only=false", "owner_public_id=x"]) {
      const res = await edge.inject({ method: "GET", url: `/search/products?${q}` });
      if (process.env.STRICT) expect(res.statusCode).toBe(400);
    }
  });
  it("E-20 computed-loop synthetic: parameters from a computed list", async () => {
    const qs = ["state=draft", "moderation_state=pending", "visible_only=false", "owner_public_id=x"].map((x) => x);
    for (const q of qs) {
      const res = await edge.inject({ method: "GET", url: `/search/products?${q}` });
      expect(res.statusCode).toBe(400);
    }
  });
  it("E-20 unrolled synthetic: one request per parameter → 400", async () => {
    const r1 = await edge.inject({ method: "GET", url: "/search/products?state=draft" });
    expect(r1.statusCode).toBe(400);
    const r2 = await edge.inject({ method: "GET", url: "/search/products?moderation_state=pending" });
    expect(r2.statusCode).toBe(400);
    const r3 = await edge.inject({ method: "GET", url: "/search/products?visible_only=false" });
    expect(r3.statusCode).toBe(400);
    const r4 = await edge.inject({ method: "GET", url: "/search/products?owner_public_id=x" });
    expect(r4.statusCode).toBe(400);
  });
  it("E-20 inverted synthetic: every row unpublished and invisible", async () => {
    const res = await edge.inject({ method: "GET", url: `/search/products` });
    const items = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p) => p.state !== "published" && p.visible === false)).toBe(true);
  });
  it("E-20 false-matcher synthetic: published and visible asserted false", async () => {
    const res = await edge.inject({ method: "GET", url: `/search/products` });
    const items = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p) => p.state === "published" && p.visible === true)).toBe(false);
  });
  it("E-20 negated synthetic: not.toBe(true) on published and visible", async () => {
    const res = await edge.inject({ method: "GET", url: `/search/products` });
    const items = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p) => p.state === "published" && p.visible === true)).not.toBe(true);
  });
  it("E-20 mention synthetic: both properties named, no condition on rows", async () => {
    const res = await edge.inject({ method: "GET", url: `/search/products` });
    const items = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty("state", "published");
    expect(items[0]).toHaveProperty("visible");
  });
  it("E-20 disjunction synthetic: published or visible", async () => {
    const res = await edge.inject({ method: "GET", url: `/search/products` });
    const items = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p) => p.state === "published" || p.visible)).toBe(true);
  });
  it("E-20 weak-violation synthetic: no row with visible === false", async () => {
    const res = await edge.inject({ method: "GET", url: `/search/products` });
    const items = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((p) => p.state !== "published" || p.visible === false)).toBe(false);
  });
  it("E-20 branch-published synthetic: checked only when rows exist", async () => {
    const res = await edge.inject({ method: "GET", url: `/search/products` });
    const items = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    if (items.length) expect(items.every((p) => p.state === "published" && p.visible === true)).toBe(true);
  });
  it("E-20 vacuous synthetic: every row published and visible, list may be empty", async () => {
    const res = await edge.inject({ method: "GET", url: `/search/products` });
    const items = res.json().items;
    expect(items.every((p) => p.state === "published" && p.visible === true)).toBe(true);
  });
  it("E-20 fixture synthetic: condition checked on a fixture, not on the response", async () => {
    const res = await edge.inject({ method: "GET", url: `/search/products` });
    expect(res.statusCode).toBe(200);
    const rows = [{ state: "published", visible: true }];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((p) => p.state === "published" && p.visible === true)).toBe(true);
  });
  it("E-20 none-violate synthetic: no row unpublished or hidden", async () => {
    const res = await edge.inject({ method: "GET", url: `/search/products` });
    const items = res.json().items;
    expect(items).not.toHaveLength(0);
    expect(items.some((p) => p.state !== "published" || !p.visible)).toBe(false);
  });
  it("E-20 filter synthetic: filtering violators leaves nothing", async () => {
    const res = await edge.inject({ method: "GET", url: `/search/products` });
    const items = res.json().items;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.filter(({ state, visible }) => !(state === "published" && visible === true))).toHaveLength(0);
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

# ═══ عقدُ الاستعلامِ (D3 · E-20 · CLM-0662) ═════════════════════════════
_ea_mut "d=load(CUST); entry(d,'GET','/search/stores')['query']={'allowed':['q','state']}; save(CUST,d)" \
  && _ea_door "معاملُ E-20 (state) داخلَ المسموحِ" EA-QUERY-E20; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/search/stores')['query']={'allowed':'q'}; save(CUST,d)" \
  && _ea_door "allowed نصٌّ لا قائمةٌ" EA-QUERY-ALLOW; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/stores/:storeSlug/products')['query']={'allowed':['cursor'],'pinned':{'cursor':'x'}}; save(CUST,d)" \
  && _ea_door "معاملٌ مثبَّتٌ ومسموحٌ معًا" EA-QUERY-PIN-OVERLAP; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/search/stores')['query']={'allowed':['q'],'pinned':{'sort':'relevance'}}; save(CUST,d)" \
  && _ea_door "تثبيتُ معاملٍ خارجَ سياسةِ E-20 (sort)" EA-QUERY-PIN-VALUE; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/order-requests')['query']={'allowed':['limit'],'pinned':{'visible_only':'true'}}; save(CUST,d)" \
  && _ea_door "تثبيتٌ على فئةِ O لا P" EA-QUERY-PIN-CLASS; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/search/stores')['query']={'allowed':['q'],'deny':['state']}; save(CUST,d)" \
  && _ea_door "مفتاحٌ غيرُ معروفٍ في query" EA-QUERY-FIELD; _ea_restore
_ea_mut "d=load(CUST); entry(d,'POST','/customers/:waslaPublicId/order-requests')['query']={'allowed':['limit']}; save(CUST,d)" \
  && _ea_door "عقدُ query لغيرِ GET (توسيعٌ غيرُ مقيسٍ)" EA-QUERY-METHOD; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/stores/:storeSlug/products')['query']['pinned']={'visible_only':'false'}; save(CUST,d)" \
  && _ea_door "قيمةُ تثبيتٍ تنحرفُ عن سياسةِ E-20 (false)" EA-QUERY-PIN-VALUE; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/stores/:storeSlug/products')['query']['pinned']={'state':'submitted'}; save(CUST,d)" \
  && _ea_door "تثبيتُ معاملٍ محظورٍ (state) بدلَ رفضِهِ" EA-QUERY-PIN-VALUE; _ea_restore

# ═══ الفئةُ O: E-18 / E-19 / المستقبلُ off / المنح ════════════════════════
_O_OPEN_E18="e=entry(d,'GET','/customers/:waslaPublicId/profile'); e['production_open']=True; "
_O_OPEN_E18+="e['evidence_tests'].append({'file':'$EA_E18','case':'$E18_CASE','proves':['E-18'],'route':'GET /customers/:waslaPublicId/profile','receiver_mode':'off'})"

_ea_mut "d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/profile')['production_open']=True; save(CUST,d)" \
  && _ea_door "فتحُ O بلا دليلِ E-18" EA-O-E18; _ea_restore

_ea_write "$EA_E18" "$E18_SRC"
_ea_mut "d=load(CUST); $_O_OPEN_E18; save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:read'])" \
  && _ea_pass "ضابطٌ موجب: GET بلا جسمٍ يُفتحُ بـE-18 وحدَه (لا E-19 لمجردِ أنه O)"; _ea_restore

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

# ═══ ربطُ الدليلِ بجسمِ الحالةِ نفسِها (محلل TypeScript · CLM-0523) ═══════════
# كلُّ طفرةٍ تشيرُ إلى حالةٍ في الملفِّ نفسِه الذي يحوي حالةً مستوفيةً — فلا تكفي
# العناصرُ المتفرّقةُ في الملفّ، ولا عنوانٌ صحيحٌ بلا جسمٍ يُثبت.
_ea_e18_case() { # <وصف> <عنوان الحالة> [pass]
  _ea_write "$EA_E18" "$E18_SRC"
  if _ea_mut "d=load(CUST); $_O_OPEN_E18; entry(d,'GET','/customers/:waslaPublicId/profile')['evidence_tests'][-1]['case']='$2'; save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:read'])"; then
    if [[ "${3:-door}" == pass ]]; then _ea_pass "$1"; else _ea_door "$1" EA-O-E18; fi
  fi
  _ea_restore
}
_ea_e18_case "E-18 حيٌّ بعنوانٍ صحيحٍ بلا طلبٍ ولا 404 (والملفُّ فيه حالةٌ مستوفية)" "E-18 hollow synthetic: titled right, no request and no 404"
_ea_e18_case "E-18 والجلسةُ هي المورد (B على B)" "E-18 same-identity synthetic: session B reading B profile → 404"
_ea_e18_case "E-18 و404 على طلبٍ آخرَ لا على طلبِ المسار" "E-18 other-request synthetic: 404 asserted on a different response"
_ea_e18_case "حالةٌ مزعومةٌ في تعليق" "E-18 commented synthetic: session A reading B profile → 404"
_ea_e18_case "حالةٌ مزعومةٌ داخلَ سلسلةٍ نصية" "E-18 string synthetic: session A reading B profile → 404"
_ea_e18_case "حالةُ it.todo" "E-18 todo synthetic: session A reading B profile → 404"
# ── الدلالاتُ التنفيذية (CLM-0523 · أ): الطلبُ والتحققُ وضبطُ off مضمونةُ التنفيذ ومرتّبة.
_ea_e18_case "E-18 الطلبُ و404 داخلَ if (false)" "E-18 if-false synthetic: request and 404 inside if (false)"
_ea_e18_case "E-18 والمستقبلُ off بعدَ الطلبِ لا قبلَه" "E-18 off-after synthetic: receiver set to off after the request"
_ea_e18_case "E-18 والمستقبلُ off داخلَ فرعٍ شرطيّ" "E-18 off-branch synthetic: receiver set to off only under a flag"
_ea_e18_case "E-18 والمستقبلُ يُعادُ إلى enforce قبلَ الطلب" "E-18 reset synthetic: receiver reset to enforce before the request"
_ea_e18_case "E-18 و return مشروطٌ يسبقُ الطلب" "E-18 early-return synthetic: returns before the request"
_ea_e18_case "E-18 و404 داخلَ ?: وحدَه" "E-18 ternary synthetic: 404 asserted only inside ?:"
_ea_e18_case "E-18 و404 داخلَ دالةٍ متداخلة (callback)" "E-18 callback synthetic: 404 asserted inside a callback"
_ea_e18_case "ضابطٌ موجب: E-18 داخلَ if (true) الحرفيِّ يُثبَتُ تنفيذُه" "E-18 if-true synthetic: guarded by a literal if (true)" pass
# المستقبلُ off في مستوى الوحدةِ لا في الحالة: لا يُقبل.
_ea_write "$EA_E18" "${E18_SRC/describe(\"synthetic/process.env.WASLA_USER_ASSERTION_MODE = \"off\";
describe(\"synthetic}"
_EA_TMP="$(sed '/^    process.env.WASLA_USER_ASSERTION_MODE = "off";$/d' "$EA_E18")"; _ea_write "$EA_E18" "$_EA_TMP"
_ea_mut "d=load(CUST); $_O_OPEN_E18; save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:read'])" \
  && _ea_door "المستقبلُ off في مستوى الوحدةِ لا داخلَ الحالة" EA-O-E18; _ea_restore

_O_PUT="e=entry(d,'PUT','/customers/:waslaPublicId/profile'); e['production_open']=True; "
_O_PUT+="e['evidence_tests'].append({'file':'$EA_E18','case':'$E18_CASE','proves':['E-18'],'route':'GET /customers/:waslaPublicId/profile','receiver_mode':'off'}); "
_O_PUT+="e['evidence_tests'][-1]['route']='PUT /customers/:waslaPublicId/profile'; e['evidence_tests'][-1]['case']='E-18 PUT synthetic: session A writing B profile → 404'"
_ea_write "$EA_E18" "$E18_SRC"
_ea_mut "d=load(CUST); $_O_PUT; save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:write'])" \
  && _ea_door "فتحُ O يقبلُ عقدُه جسمًا (PUT) بـE-18 وبلا E-19" EA-O-E19 EA-O-E18; _ea_restore

_ea_write "$EA_E18" "$E18_SRC"
_ea_mut "d=load(CUST); $_O_PUT; e['evidence_tests'].append({'file':'$EA_E18','case':'$E19_CASE','proves':['E-19'],'route':'PUT /customers/:waslaPublicId/profile','receiver_mode':'off'}); save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:write'])" \
  && _ea_pass "ضابطٌ موجب: فتحُ O (PUT) بـE-18 وE-19 ومنحٍ يمرّ"; _ea_restore

# ═══ عقدُ قبولِ الجسم: E-19 يتبعُ العقدَ المقيسَ لا الطريقة (ADR-069 §2.8) ═══
# حقنُ قراءةِ جسمٍ في معالجِ GET (نسخة /tmp وحدَها) — مسارٌ يقبلُ عقدُه جسمًا وليس POST/PUT/PATCH.
_GET_BODY="import pathlib; p=pathlib.Path('$EA_CUST_APP'); s=p.read_text(encoding='utf-8'); k='    const profile = await getCustomerProfile'; assert s.count(k)==1; p.write_text(s.replace(k,'    const extra = request.body as { wasla_public_id?: string };\n'+k),encoding='utf-8')"
_DEL_CALL="import pathlib; p=pathlib.Path('$EA_CUST_APP'); s=p.read_text(encoding='utf-8'); k='      const { placeId } = request.params as { placeId: string };'; assert s.count(k)==1; p.write_text(s.replace(k,k+'\n      parseExtras(request);'),encoding='utf-8')"
_DEL_LOCAL="import pathlib; p=pathlib.Path('$EA_CUST_APP'); s=p.read_text(encoding='utf-8'); k='      const { placeId } = request.params as { placeId: string };'; assert s.count(k)==1; s=s.replace(k,k+'\n      readExtras(request);'); p.write_text(s+'\nfunction readExtras(r: FastifyRequest): unknown {\n  return (r as { body?: unknown }).body;\n}\n',encoding='utf-8')"

_ea_write "$EA_E18" "$E18_SRC"
_ea_mut "$_GET_BODY; d=load(CUST); $_O_OPEN_E18; e['accepts_body']=True; save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:read'])" \
  && _ea_door "فتحُ GET يقرأُ معالجُه جسمًا بـE-18 وبلا E-19" EA-O-E19 EA-O-E18; _ea_restore

_ea_write "$EA_E18" "$E18_SRC"
_ea_mut "$_GET_BODY; d=load(CUST); $_O_OPEN_E18; e['accepts_body']=True; e['evidence_tests'].append({'file':'$EA_E18','case':'E-19 GET synthetic: GET body field naming B → 403','proves':['E-19'],'route':'GET /customers/:waslaPublicId/profile','receiver_mode':'off'}); save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:read'])" \
  && _ea_pass "ضابطٌ موجب: GET يقبلُ عقدُه جسمًا يُفتحُ بـE-18 وE-19"; _ea_restore

_ea_mut "$_GET_BODY" \
  && _ea_door "GET يقرأُ جسمًا ويعلنُ accepts_body=false" EA-BODY-CONTRACT; _ea_restore
_ea_mut "$_DEL_CALL" \
  && _ea_door "DELETE يمرّرُ request لدالةٍ غيرِ معرّفةٍ محليًا (فشلٌ مغلق)" EA-BODY-CONTRACT; _ea_restore
_ea_mut "$_DEL_LOCAL" \
  && _ea_door "DELETE يمرّرُ request لدالةٍ محليةٍ تقرأُ body" EA-BODY-CONTRACT; _ea_restore
_ea_mut "d=load(CUST); entry(d,'PUT','/customers/:waslaPublicId/profile')['accepts_body']=False; save(CUST,d)" \
  && _ea_door "PUT يعلنُ accepts_body=false" EA-BODY-CONTRACT; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/profile')['accepts_body']=True; save(CUST,d)" \
  && _ea_door "GET بلا جسمٍ يعلنُ accepts_body=true (انحرافُ عقد)" EA-BODY-CONTRACT; _ea_restore
_ea_mut "d=load(CUST); entry(d,'GET','/customers/:waslaPublicId/profile')['accepts_body']='false'; save(CUST,d)" \
  && _ea_door "accepts_body نصٌّ لا قيمةٌ منطقية" EA-BODY-CONTRACT; _ea_restore
_ea_mut "d=load(CUST); del entry(d,'GET','/customers/:waslaPublicId/profile')['accepts_body']; save(CUST,d)" \
  && _ea_door "حقلُ accepts_body محذوف" EA-FIELD; _ea_restore

_ea_write "$EA_E18" "$E18_SRC"
_ea_mut "d=load(CUST); $_O_PUT; e['accepts_body']=False; save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:write'])" \
  && _ea_door "فتحُ PUT بإعلانِ accepts_body=false هربًا من E-19" EA-O-E19 EA-O-E18; _ea_restore

_ea_write "$EA_E18" "${E18_SRC//wasla_public_id: B/note: B}"
_ea_mut "d=load(CUST); $_O_PUT; e['evidence_tests'].append({'file':'$EA_E18','case':'$E19_CASE','proves':['E-19'],'route':'PUT /customers/:waslaPublicId/profile','receiver_mode':'off'}); save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:write'])" \
  && _ea_door "دليلُ E-19 لا يرسلُ أيَّ حقلِ هويةٍ من §7.2" EA-O-E19 EA-O-E18; _ea_restore

_ea_e19_case() { # <وصف> <عنوان الحالة> <pass|door>
  _ea_write "$EA_E18" "$E18_SRC"
  if _ea_mut "d=load(CUST); $_O_PUT; e['evidence_tests'].append({'file':'$EA_E18','case':'$2','proves':['E-19'],'route':'PUT /customers/:waslaPublicId/profile','receiver_mode':'off'}); save(CUST,d); ins_grant('customer-bot','customers',['customers:profile:write'])"; then
    if [[ "$3" == pass ]]; then _ea_pass "$1"; else _ea_door "$1" EA-O-E19 EA-O-E18; fi
  fi
  _ea_restore
}
_ea_e19_case "E-19 يذكرُ حقلَ الهويةِ ولا يرسلُه في الجسم" "E-19 mention synthetic: names wasla_public_id but never sends it" door
_ea_e19_case "E-19 يرسلُ هويةً أخرى ولا يتحققُ من رفضٍ ولا من المحفوظ" "E-19 unchecked synthetic: sends B but asserts nothing about it" door
_ea_e19_case "ضابطٌ موجب: E-19 بقيمةٍ محفوظةٍ = هويةُ الجلسة لا الجسم" "E-19 stored synthetic: body field naming B is not stored" pass
_ea_e19_case "E-19 والرفضُ لا يُتحقَّقُ منه إلا داخلَ if" "E-19 branch synthetic: rejection asserted only under a condition" door
_ea_e19_case "E-19 والقيمةُ المحفوظةُ خلفَ && قصيرِ الدائرة" "E-19 short-circuit synthetic: stored value asserted behind &&" door

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

_ea_e20_case() { # <وصف> <عنوان المعاملات> <عنوان المنشور> [pass]
  _ea_write "$EA_E20" "$E20_SRC"
  if _ea_mut "d=load(CUST); e=entry(d,'GET','/search/products'); e['production_open']=True; e['evidence_tests']=[{'file':'$EA_E20','case':'$2','proves':['E-20:params'],'route':'GET /search/products'},{'file':'$EA_E20','case':'$3','proves':['E-20:published-only'],'route':'GET /search/products'}]; save(CUST,d); ins_grant('customer-bot','search',['search:products:read'])"; then
    if [[ "${4:-door}" == pass ]]; then _ea_pass "$1"; else _ea_door "$1" EA-P-E20; fi
  fi
  _ea_restore
}
_ea_e20_case "E-20 يتحققُ من 400 لثلاثةِ معاملاتٍ من أربعة" "E-20 partial synthetic: only three of the four parameters → 400" "$E20R_CASE"
_ea_e20_case "E-20 يرسلُ المعاملاتِ الأربعةَ ويتحققُ من 200 لا 400" "E-20 not-400 synthetic: all four parameters but asserts 200" "$E20R_CASE"
_ea_e20_case "«المنشور فقط» مذكورٌ في تعليقٍ والتحققُ من الرمزِ وحدَه" "$E20P_CASE" "E-20 status-only synthetic: published visible (named, not checked)"
_ea_e20_case "«المنشور فقط» بلا تحققٍ من الظهور" "$E20P_CASE" "E-20 published-not-visible synthetic: checks state only"
# ── الدلالاتُ التنفيذية (CLM-0523 · أ)
_ea_e20_case "E-20 و400 لا يُتحقَّقُ منه إلا داخلَ if" "E-20 branch-params synthetic: 400 asserted only under a flag" "$E20R_CASE"
_ea_e20_case "E-20 والمعاملاتُ من قائمةٍ محسوبةٍ لا حرفية" "E-20 computed-loop synthetic: parameters from a computed list" "$E20R_CASE"
_ea_e20_case "«المنشور فقط» لا يُتحقَّقُ منه إلا داخلَ if" "$E20P_CASE" "E-20 branch-published synthetic: checked only when rows exist"
_ea_e20_case "ضابطٌ موجب: E-20 بطلبٍ لكلِّ معاملٍ بلا حلقة" "E-20 unrolled synthetic: one request per parameter → 400" "$E20R_CASE" pass
# ── معنى «المنشور فقط» (CLM-0523 · ب): شرطٌ إيجابيٌّ على كلِّ عنصرٍ معاد
_ea_e20_case "«المنشور فقط» بشرطٍ معكوس (state !== published ∧ visible === false)" "$E20P_CASE" "E-20 inverted synthetic: every row unpublished and invisible"
_ea_e20_case "«المنشور فقط» بـtoBe(false)" "$E20P_CASE" "E-20 false-matcher synthetic: published and visible asserted false"
_ea_e20_case "«المنشور فقط» بتوقعٍ منفيٍّ not.toBe(true)" "$E20P_CASE" "E-20 negated synthetic: not.toBe(true) on published and visible"
_ea_e20_case "«المنشور فقط» يذكرُ الخاصيتينِ بلا شرطٍ على العناصر" "$E20P_CASE" "E-20 mention synthetic: both properties named, no condition on rows"
_ea_e20_case "«المنشور فقط» بالفصلِ (published ∨ visible)" "$E20P_CASE" "E-20 disjunction synthetic: published or visible"
_ea_e20_case "«لا مخالف» بـvisible === false (لا يغطي غيرَ المعرَّف)" "$E20P_CASE" "E-20 weak-violation synthetic: no row with visible === false"
_ea_e20_case "«المنشور فقط» بلا إثباتِ أنَّ القائمةَ غيرُ فارغة" "$E20P_CASE" "E-20 vacuous synthetic: every row published and visible, list may be empty"
_ea_e20_case "«المنشور فقط» على مصفوفةٍ ثابتةٍ لا على نتيجةِ الطلب" "$E20P_CASE" "E-20 fixture synthetic: condition checked on a fixture, not on the response"
_ea_e20_case "ضابطٌ موجب: «لا عنصرَ مخالف» بـsome(…) = false" "$E20P_CASE" "E-20 none-violate synthetic: no row unpublished or hidden" pass
_ea_e20_case "ضابطٌ موجب: filter(¬(منشور ∧ مرئي)) فارغةٌ بمعاملٍ مفكوك" "$E20P_CASE" "E-20 filter synthetic: filtering violators leaves nothing" pass

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
_ea_mut "d=load(CUST); d['entries'].append({'method':'GET','path':'/customers/:waslaPublicId/no-such-screen','service':'customers','class':'O','required_scopes':['customers:profile:read'],'accepts_body':False,'production_open':False,'evidence_tests':[]}); save(CUST,d)" \
  && _ea_door "مسارٌ لا يناديه التطبيق (الفحص 24)" EA-CALL; _ea_restore
_ea_mut "d=load(CUST); d['entries'].append({'method':'GET','path':'/subscriptions/plans','service':'subscriptions','class':'N','required_scopes':['subscriptions:plans:read'],'accepts_body':False,'production_open':False,'evidence_tests':[],'blocked_until':'x'}); save(CUST,d)" \
  && _ea_door "مدخلٌ خارجَ اللقطةِ التاريخية" EA-SNAPSHOT-NEW; _ea_restore

# ═══ المحلّلُ غائبٌ ⇒ فشلٌ مغلق (لا رجوعَ إلى مطابقةٍ نصيّة) ═══════════════
_EA_FAKE=/tmp/ea_fake_node; rm -rf "$_EA_FAKE"; mkdir -p "$_EA_FAKE"
printf '#!/bin/sh\nexit 127\n' > "$_EA_FAKE/node"; chmod +x "$_EA_FAKE/node"
_ea_door_env() { local d="$1" c="$2"; local out rc ok=1
  out="$(PATH="$_EA_FAKE:$PATH" bash "$EA" 2>&1)"; rc=$?
  (( rc != 0 )) && grep -qF "✗ edge-allowlist-guard" <<<"$out" && grep -qF "[$c]" <<<"$out" && grep -qF "فشل مغلق" <<<"$out" || ok=0
  if (( ok )); then printf '  \033[32m✓\033[0m %-62s (الحارسُ 28 أسقطَ بالبابِ %s)\n' "$d" "$c"; ((PASS++))
  else printf '  \033[31m✗\033[0m %-62s متوقعٌ فشلٌ مغلقٌ بالبابِ [%s] (rc=%d)\n' "$d" "$c" "$rc"; printf '%s\n' "$out" | tail -4 | sed 's/^/      /'; ((FAIL++)); fi; }
_ea_door_env "node غائبٌ ⇒ كلُّ دليلٍ يفشلُ مغلقًا" EA-EVID-CASE
printf '#!/bin/sh\nprintf %%s %s\n' "'{\"ok\":false,\"error\":\"typescript غير متاح\"}'" > "$_EA_FAKE/node"
_ea_door_env "typescript غائبٌ ⇒ كلُّ دليلٍ يفشلُ مغلقًا" EA-EVID-CASE
rm -rf "$_EA_FAKE"

# الاستعادةُ صادقة: الأصلُ يمرُّ ولا أثرَ اصطناعيًّا باقٍ.
t "الأصلُ يمرُّ بعدَ كلِّ الطفراتِ (الاستعادةُ صادقة)" pass bash "$EA"
t "لا دليلَ اصطناعيًّا باقٍ في النسخة" fail test -e "$EA_E18" -o -e "$EA_E20"
