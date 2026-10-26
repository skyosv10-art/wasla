#!/usr/bin/env bash
# CLM-0576 — اختباراتٌ حيّةٌ لبوّابةِ تحقُّقِ الإثبات داخلَ وظيفةِ image-supply-chain:
# gh الحقيقيّ + الإثباتُ الذي أنشأته الخطوةُ السابقةُ في التشغيلِ نفسِه.
#
# الاستعمال: test-verify-sbom-attestations-live.sh <owner/repo> <workflow-path> <pass1> <pass2> <evidence-dir>
#
# كلُّ حالةٍ موجبةٍ يجبُ أن تخرجَ 0، وكلُّ حالةٍ سالبةٍ يجبُ أن تخرجَ غيرَ 0 بلا
# سطرِ نجاح. أيُّ مخالفةٍ تُفشِلُ الخطوةَ ومن ثَمَّ الوظيفة. مخرَجُ كلِّ حالةٍ يُحفَظُ
# دليلًا. لا تُطبَعُ قيمةُ GH_TOKEN، والرمزُ «غيرُ الصالح» ثابتٌ مُصطنَعٌ لا سرّ.
set -euo pipefail

(( $# == 5 )) || { echo "الاستعمال: $0 <owner/repo> <workflow-path> <pass1> <pass2> <evidence-dir>" >&2; exit 2; }
REPO="$1"; WF="$2"; P1="$3"; P2="$4"; EV="$5"
[[ -n "${GH_TOKEN:-}" ]] || { echo "✗ GH_TOKEN غائب — الحالاتُ الموجبةُ تتطلّبُه." >&2; exit 2; }
for f in "$P1" "$P2"; do [[ -f "$f" ]] || { echo "✗ $f غائب." >&2; exit 2; }; done

HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/verify-sbom-attestations.sh"
mkdir -p "$EV"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# ملفّاتٌ معدَّلةٌ بعدَ إنشاءِ الإثبات: نسخةٌ + بايتٌ واحدٌ ⇒ بصمةٌ بلا إثبات.
cp "$P1" "$TMP/pass1.cdx.json"; printf ' ' >> "$TMP/pass1.cdx.json"
cp "$P2" "$TMP/pass2.cdx.json"; printf ' ' >> "$TMP/pass2.cdx.json"
TP1="$TMP/pass1.cdx.json"; TP2="$TMP/pass2.cdx.json"

pass=0; fail=0
# run <id> <want: pass|fail> <cmd...>
run() {
  local id="$1" want="$2"; shift 2
  local rc=0
  "$@" >"$EV/$id.txt" 2>&1 || rc=$?
  printf '\n# exit=%d · expected=%s\n' "$rc" "$want" >> "$EV/$id.txt"
  local ok=no
  if [[ "$want" == pass ]]; then
    [[ $rc -eq 0 ]] && grep -q "✓ تحقُّقُ الإثبات" "$EV/$id.txt" && ok=yes
  else
    [[ $rc -ne 0 ]] && ! grep -q "✓ تحقُّقُ الإثبات" "$EV/$id.txt" && ok=yes
  fi
  if [[ $ok == yes ]]; then pass=$((pass+1)); printf '  ✓ %-34s exit=%d (متوقّع %s)\n' "$id" "$rc" "$want"
  else fail=$((fail+1)); printf '  ✗ %-34s exit=%d (متوقّع %s)\n' "$id" "$rc" "$want"; sed 's/^/      /' "$EV/$id.txt"; fi
}

echo "حالاتٌ موجبة:"
run positive-pass1                pass bash "$SUT" "$REPO" "$WF" "$P1"
run positive-pass2                pass bash "$SUT" "$REPO" "$WF" "$P2"

echo "حالاتٌ سالبة:"
run negative-tampered-pass1       fail bash "$SUT" "$REPO" "$WF" "$TP1"
run negative-tampered-pass2       fail bash "$SUT" "$REPO" "$WF" "$TP2"
run negative-one-of-two-bad       fail bash "$SUT" "$REPO" "$WF" "$P1" "$TP2"
run negative-no-gh-token          fail env -u GH_TOKEN bash "$SUT" "$REPO" "$WF" "$P1" "$P2"
run negative-invalid-gh-token     fail env GH_TOKEN=invalid-token-clm-0576 bash "$SUT" "$REPO" "$WF" "$P1" "$P2"
run negative-wrong-signer-workflow fail bash "$SUT" "$REPO" .github/workflows/render-deploy.yml "$P1"
run negative-wrong-repo           fail bash "$SUT" "cli/cli" "$WF" "$P1"
# gh الخامُ نفسُه بلا رمز: يُثبتُ أنّ أصلَ العيبِ (غيابُ GH_TOKEN) فشلٌ لا نجاح.
run negative-raw-gh-no-token      fail env -u GH_TOKEN gh attestation verify "$P1" --repo "$REPO"

printf '\nالحالاتُ الحيّة: %d مطابقة · %d مخالفة\n' "$pass" "$fail" | tee "$EV/summary.txt"
(( fail == 0 ))
