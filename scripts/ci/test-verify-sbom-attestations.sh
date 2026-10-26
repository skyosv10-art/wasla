#!/usr/bin/env bash
# CLM-0576 — اختباراتُ وحدةٍ لـ verify-sbom-attestations.sh بـ gh مُصطنَع (بلا شبكة).
# تُثبتُ أنّ الفشلَ لا يصيرُ أخضرَ: خروجُ gh صفرًا مع تحذيرٍ، أو بمخرَجٍ لا يُثبتُ
# البصمةَ نفسَها، أو بإصدارٍ قديم، أو بغيابِ الرمز — كلُّها فشل.
# الاختباراتُ الحقيقيّةُ (gh الحقيقيّ + الإثباتُ الحقيقيّ) تجري في وظيفةِ CI نفسِها.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SUT="$ROOT/scripts/ci/verify-sbom-attestations.sh"
REPO="skyosv10-art/wasla"; WF=".github/workflows/ci.yml"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin"
printf '{"a":1}\n' > "$W/pass1.cdx.json"
printf '{"b":2}\n' > "$W/pass2.cdx.json"

# gh مُصطنَع: سلوكُه من متغيّراتِ البيئة.
#   STUB_VERSION · STUB_HELP_FLAGS · STUB_MODE (good|warn0|exit1|wrongdigest|wrongsigner|wrongtype|badfor:<name>)
cat > "$W/bin/gh" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == "--version" ]]; then echo "gh version ${STUB_VERSION:-2.99.0} (stub)"; exit 0; fi
if [[ "$1 $2" == "attestation verify" && "${3:-}" == "--help" ]]; then
  for f in ${STUB_HELP_FLAGS:---repo --signer-workflow --predicate-type --format}; do echo "      $f string"; done; exit 0
fi
[[ "$1 $2" == "attestation verify" ]] || { echo "stub: unexpected $*" >&2; exit 99; }
file="$3"; name="$(basename "$file")"
repo=""; wf=""; pt=""
shift 3
while (( $# )); do case "$1" in
  --repo) repo="$2"; shift 2;; --signer-workflow) wf="$2"; shift 2;;
  --predicate-type) pt="$2"; shift 2;; --format) shift 2;; *) shift;; esac; done
mode="${STUB_MODE:-good}"
[[ "$mode" == badfor:* && "$name" == "${mode#badfor:}" ]] && { echo "Error: HTTP 404: Not Found" >&2; exit 1; }
[[ "$mode" == badfor:* ]] && mode=good
case "$mode" in
  warn0) echo "WARN: attestation verify requires gh CLI 2.50+"; exit 0;;
  exit1) echo "Error: HTTP 401: Bad credentials" >&2; exit 1;;
esac
d="$(sha256sum "$file" | cut -d' ' -f1)"
signer="https://github.com/${wf}@refs/heads/main"
[[ "$mode" == wrongdigest ]] && d="0000000000000000000000000000000000000000000000000000000000000000"
[[ "$mode" == wrongsigner ]] && signer="https://github.com/${repo}/.github/workflows/other.yml@refs/heads/main"
[[ "$mode" == wrongtype ]] && pt="https://in-toto.io/attestation/release/v0.1"
cat <<JSON
[{"verificationResult":{"statement":{"predicateType":"$pt","subject":[{"name":"$name","digest":{"sha256":"$d"}}]},
 "signature":{"certificate":{"buildSignerURI":"$signer","sourceRepositoryURI":"https://github.com/$repo","runInvocationURI":"stub"}}}}]
JSON
STUB
chmod +x "$W/bin/gh"

pass=0; fail=0
# t <وصف> <الرمزُ المتوقّع: 0 | nonzero | رقم> <env...> -- <ملفّات...>
t() {
  local desc="$1" want="$2"; shift 2
  local envs=(); while [[ "$1" != "--" ]]; do envs+=("$1"); shift; done; shift
  local rc=0 out
  out="$(env -u GH_TOKEN PATH="$W/bin:$PATH" "${envs[@]}" bash "$SUT" "$REPO" "$WF" "$@" 2>&1)" || rc=$?
  local ok=no
  case "$want" in
    0) [[ $rc -eq 0 ]] && grep -q "✓ تحقُّقُ الإثبات" <<< "$out" && ok=yes;;
    nonzero) [[ $rc -ne 0 ]] && ! grep -q "✓ تحقُّقُ الإثبات" <<< "$out" && ok=yes;;
    *) [[ $rc -eq $want ]] && ! grep -q "✓ تحقُّقُ الإثبات" <<< "$out" && ok=yes;;
  esac
  if [[ $ok == yes ]]; then pass=$((pass+1)); printf '  ✓ %s (rc=%d)\n' "$desc" "$rc"
  else fail=$((fail+1)); printf '  ✗ %s (rc=%d، متوقّع %s)\n%s\n' "$desc" "$rc" "$want" "$out"; fi
}
P1="$W/pass1.cdx.json"; P2="$W/pass2.cdx.json"; T=GH_TOKEN=stub-token

t "إثباتٌ صحيحٌ للملفِّ الأوّل يمرّ"                  0 "$T" -- "$P1"
t "إثباتٌ صحيحٌ للملفِّ الثاني يمرّ"                  0 "$T" -- "$P2"
t "الملفّانِ معًا يمرّان"                            0 "$T" -- "$P1" "$P2"
t "غيابُ GH_TOKEN يفشل (2)"                          2 -- "$P1" "$P2"
t "GH_TOKEN فارغٌ يفشل (2)"                          2 GH_TOKEN= -- "$P1"
t "مصادقةٌ غيرُ صالحةٍ (gh يخرجُ 1) تفشل"            1 "$T" STUB_MODE=exit1 -- "$P1"
t "gh يخرجُ 0 بتحذيرٍ فقط لا يصيرُ نجاحًا"           1 "$T" STUB_MODE=warn0 -- "$P1" "$P2"
t "مخرَجٌ ببصمةٍ أخرى (ملفٌّ معدَّل) يُرفض"          1 "$T" STUB_MODE=wrongdigest -- "$P1"
t "سيرُ توقيعٍ آخرُ غيرُ ci.yml يُرفض"               1 "$T" STUB_MODE=wrongsigner -- "$P1"
t "نوعُ إثباتٍ غيرُ SLSA provenance v1 يُرفض"        1 "$T" STUB_MODE=wrongtype -- "$P1"
t "غيابُ إثباتِ الملفِّ الثاني يُفشِلُ الكلّ"         1 "$T" STUB_MODE=badfor:pass2.cdx.json -- "$P1" "$P2"
t "غيابُ إثباتِ الملفِّ الأوّل يُفشِلُ الكلّ"         1 "$T" STUB_MODE=badfor:pass1.cdx.json -- "$P1" "$P2"
t "ملفٌّ غائبٌ يُفشِلُ الكلّ"                         1 "$T" -- "$P1" "$W/missing.cdx.json"
t "gh أقدمُ من 2.50.0 يفشل (3) لا يُمرَّرُ بتحذير"   3 "$T" STUB_VERSION=2.49.2 -- "$P1"
t "gh بلا --signer-workflow يفشل (3)"               3 "$T" "STUB_HELP_FLAGS=--repo --predicate-type --format" -- "$P1"
t "وسائطُ ناقصةٌ تفشل (2)"                           2 "$T" --

printf '\nاختباراتُ verify-sbom-attestations: %d نجح · %d فشل\n' "$pass" "$fail"
(( fail == 0 ))
