#!/usr/bin/env bash
# CLM-0675 — مراجعةُ RISK-0041 (العقودُ المنشورةُ تجاهَ المُصادقةِ المفروضة): قياسٌ قابلٌ لإعادةِ التشغيل.
# قراءةٌ فقط على المستودع: كلُّ طفرةٍ تجري في شجرةِ عملٍ مؤقّتةٍ تُحذَفُ في النهاية.
# الاستعمال من جذرِ مستودعٍ مثبَّتةٍ اعتمادياتُه (pnpm install):
#   bash docs/12-testing/ci-evidence/2026-10-24T100000Z-clm-0675-risk-0041-review/measure.sh [REV] [--with-suites]
#   --with-suites: يشغّلُ أيضًا مجموعتَي اختبارِ delivery على الطفرةِ D1 (بضعُ دقائق).
set -uo pipefail
REV="${1:-origin/main}"; SUITES="${2:-}"
ROOT=$(git rev-parse --show-toplevel); SHA=$(git rev-parse "$REV"); echo "rev=$SHA"
W=$(mktemp -d); trap 'git -C "$ROOT" worktree remove --force "$W/wt" >/dev/null 2>&1; rm -rf "$W"' EXIT
git worktree add -q --detach "$W/wt" "$SHA"; cd "$W/wt"
# اعتمادياتُ المستودعِ الأصليِّ بروابطَ رمزيّةٍ (قراءةٌ فقط؛ لا تُلتزَم: الشجرةُ مؤقّتة)
find "$ROOT" -maxdepth 4 -name node_modules -type d -not -path '*/node_modules/*' | while read -r d; do rel=${d#"$ROOT"/}; [[ -e "$rel" ]] || ln -s "$d" "$rel"; done
gate() { bash scripts/checks/validate-service-auth-coverage.sh >"$W/g" 2>&1; local rc=$?; sed -i 's/\x1b\[[0-9;]*m//g' "$W/g"; echo $rc; }
mut() { python3 - "$1" "$2" <<'PY'
import re, sys
p, code = sys.argv[1], sys.argv[2]; s = open(p, encoding='utf-8').read(); o = s
exec(code)
assert s != o, "MUTATION NOT APPLIED"
open(p, 'w', encoding='utf-8').write(s)
PY
}
reset() { git checkout -q -- services packages; }

echo "== A1 gate (validate-service-auth-coverage.sh) on REV"
rc=$(gate); echo "  rc=$rc"
grep -cE '✓ الحدُّ مفروضٌ في الشفرة' "$W/g" | sed 's/^/  boundaries enforced in code: /'
grep -cE '✓ العقدُ المنشورُ يُعلِنُ المُصادقةَ المفروضةَ' "$W/g" | sed 's/^/  contracts declaring the enforced auth (gate 9): /'
grep -E 'جردُ حدودِ الدخولِ|البابُ 10' "$W/g" | sed 's/^/  /'

echo "== A2 per-contract disclosure (ops · ops with security · '401' · '403')"
for f in services/*/contracts/api.openapi.yml packages/channel-core/contracts/api.openapi.yml; do
  python3 - "$f" <<'PY'
import sys, yaml
p = sys.argv[1]; d = yaml.safe_load(open(p, encoding='utf-8'))
glob = d.get('security'); ops = sec = pub = r401 = r403 = 0
for path, item in (d.get('paths') or {}).items():
    for m, op in item.items():
        if m not in ('get', 'post', 'put', 'patch', 'delete'): continue
        ops += 1; s = op.get('security', glob)
        if s == []: pub += 1
        elif s: sec += 1
        rs = {str(k) for k in (op.get('responses') or {})}
        r401 += '401' in rs; r403 += '403' in rs
schemes = list(((d.get('components') or {}).get('securitySchemes') or {}).keys())
print(f"  {p.split('/')[1] if p.startswith('services') else 'channel-core'}: ops={ops} secured={sec} public={pub} with401={r401} with403={r403} schemes={schemes}")
PY
done

echo "== A3 drift-test coverage: which service contracts are regenerated and diffed by a packages/contracts/*/api-types-drift test"
for d in packages/contracts/*/; do
  g=$(node -p "(require('./$d/package.json').scripts||{}).generate||''" 2>/dev/null)
  [[ -f "$d/src/__tests__/api-types-drift.test.ts" ]] && grep -oE 'services/[a-z-]+/contracts/api\.openapi\.yml' <<<"$g"
done | sed -E 's#services/([a-z-]+)/.*#\1#' | sort -u > "$W/drift"
echo "  guarded: $(tr '\n' ' ' < "$W/drift")"
grep -oE '✓ الحدُّ مفروضٌ في الشفرة: services/[a-z-]+' "$W/g" | sed -E 's#.*services/##' | sort -u > "$W/enf"
echo "  enforced but NOT drift-guarded: $(comm -23 "$W/enf" "$W/drift" | tr '\n' ' ')"

echo "== A4 negative controls against gate 9 (each on a fresh tree)"
k() { local name="$1"; mut "$2" "$3" || { echo "  $name: NOT APPLIED"; reset; return; }; rc=$(gate); echo "  $name: rc=$rc $([[ $rc == 0 ]] && echo ACCEPTED || echo REJECTED) $(grep -m1 '✗' "$W/g" | cut -c1-120)"; reset; }
k "K1 billing: securitySchemes key removed" services/billing/contracts/api.openapi.yml "s=s.replace('  securitySchemes:','  xSecuritySchemes:',1)"
k "K2 delivery: first secured op → security: []" services/delivery/contracts/api.openapi.yml "s=re.sub(r'(\n      security:\n(        - .*\n)+)', '\n      security: []\n', s, count=1)"
k "K3 delivery: every '401' response removed" services/delivery/contracts/api.openapi.yml "s=re.sub(r\"\n        '401':\n(          .*\n)+\", '\n', s)"
k "K4 delivery: header name changed" services/delivery/contracts/api.openapi.yml "s=s.replace('x-wasla-service-auth','x-other-auth')"

echo "== A5 the same K2/K3 against a drift-guarded contract (dispatch) — api-types-drift test"
dt() { (cd packages/contracts/dispatch && timeout 300 npx vitest run src/__tests__/api-types-drift.test.ts >"$W/t" 2>&1); local rc=$?; echo "  $1: rc=$rc $(sed 's/\x1b\[[0-9;]*m//g' "$W/t" | grep -E '^\s+Tests ' | tail -1 | xargs)"; }
dt "T0 unchanged"
mut services/dispatch/contracts/api.openapi.yml "s=re.sub(r\"\n        '401':\n(          .*\n)+\", '\n', s)"; dt "T1 K3 on dispatch"; reset
mut services/dispatch/contracts/api.openapi.yml "s=re.sub(r'(\n      security:\n(        - .*\n)+)', '\n      security: []\n', s, count=1)"; dt "T2 K2 on dispatch"; reset

if [[ "$SUITES" == "--with-suites" ]]; then
  echo "== A6 K2+K3 on delivery (not drift-guarded): gate 9 + full test suites of packages/contracts/delivery and services/delivery"
  su() { local r=""; for p in packages/contracts/delivery services/delivery; do (cd "$p" && timeout 900 npx vitest run >"$W/s" 2>&1); r="$r $p:rc=$?[$(sed 's/\x1b\[[0-9;]*m//g' "$W/s" | grep -E '^\s+Tests ' | tail -1 | xargs)]"; done; echo "  $1:$r"; }
  su "D0 unchanged"
  mut services/delivery/contracts/api.openapi.yml "s=re.sub(r\"\n        '401':\n(          .*\n)+\", '\n', s); s=re.sub(r'(\n      security:\n(        - .*\n)+)', '\n      security: []\n', s, count=1)"
  echo "  D1 gate 9: rc=$(gate)"; su "D1 K2+K3"; reset
fi
