#!/usr/bin/env bash
# CLM-0673 — مراجعةُ RISK-0034: قياسٌ قابلٌ لإعادةِ التشغيلِ على الملفّاتِ المتتبَّعةِ (git grep؛ قراءةٌ فقط).
# الاستعمال من جذرِ المستودع: bash docs/12-testing/ci-evidence/2026-10-24T070000Z-clm-0673-risk-0034-review/measure.sh [REV]
# REV افتراضيًّا HEAD. يطبعُ كلَّ حقيقةٍ وسطرَ حكمٍ؛ لا يغيّرُ شيئًا.
set -uo pipefail
REV="${1:-HEAD}"
echo "rev=$(git rev-parse "$REV")"
g() { git grep -nE "$1" "$REV" -- "${@:2}" | sed "s#^$REV:##"; }

echo "== F1 dispatch still requires ORD-########## (model · validation · DB CHECK)"
g 'ORDER_PUBLIC_ID_PATTERN = |ORD-########## \(10 digits\)|orderPublicId\} ~ .\^ORD-' 'services/dispatch/src/*.ts' ':!*__tests__*'

echo "== F2 implementations of DispatchJobRequester (non-test vs test)"
echo "  non-test 'implements DispatchJobRequester':"; g 'implements DispatchJobRequester' 'services/*.ts' 'packages/*.ts' ':!*__tests__*' || echo "  (none)"
echo "  test 'implements DispatchJobRequester':"; g 'implements DispatchJobRequester' '*__tests__*'

echo "== F3 non-test callers of delegateToDispatch (outside its own module)"
g 'delegateToDispatch\(' 'services/*.ts' 'packages/*.ts' ':!*__tests__*' ':!services/delivery/src/use-cases/delegate-to-dispatch.ts' || echo "  (none)"

echo "  positive control — the same pattern finds test callers: $(git grep -cE 'delegateToDispatch\(' "$REV" -- '*__tests__*' | awk -F: '{s+=$NF} END {print s+0}')"

echo "== F4 HTTP client to POST /dispatch/jobs: in services/delivery (WS- path) vs services/customers (ORD- path), non-test"
echo "  services/delivery:"; g 'DISPATCH_JOBS_PATH|"/dispatch/jobs"|fetch\(.*dispatch' 'services/delivery/src/*.ts' ':!*__tests__*' || echo "  (none)"
echo "  services/customers (existing ORD- adapter, for contrast):"; g 'DISPATCH_JOBS_PATH = ' 'services/customers/src/*.ts' ':!*__tests__*' || echo "  (none)"

echo "== F5 ADR-026 bridge status lines + last commit touching it"
g 'ما بقيَ مؤجّلاً \(يُرفعُ بقرارِ المالكِ\): جسرُ ORD-/WS-' docs/15-decisions/ADR-026-store-orders-and-delivery-boundary.md | cut -c1-160
git log -1 --format='  last ADR-026 commit: %h %ad %s' --date=short "$REV" -- docs/15-decisions/ADR-026-store-orders-and-delivery-boundary.md

echo "== F6 any later ADR deciding the bridge (mentions ORD-/WS- bridge decision)"
g 'جسر.{0,6}ORD-.{0,4}/.{0,2}WS-' 'docs/15-decisions/*.md' ':!docs/15-decisions/ADR-026-store-orders-and-delivery-boundary.md' || echo "  (none)"

echo "== F7 launch gates (state, not changed here)"
echo "  production_open=true count in channel-edge allowlists: $(git grep -c '"production_open": true' "$REV" -- 'packages/channel-edge/allowlist/*.json' | awk -F: '{s+=$NF} END {print s+0}')"
echo "  production_open=false count: $(git grep -c '"production_open": false' "$REV" -- 'packages/channel-edge/allowlist/*.json' | awk -F: '{s+=$NF} END {print s+0}')"
