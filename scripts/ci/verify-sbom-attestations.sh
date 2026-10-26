#!/usr/bin/env bash
# CLM-0576 · M6-19C · ADR-056 — تحقُّقٌ صارمٌ من إثباتِ أصلِ قوائمِ المواد.
#
# الاستعمال:
#   verify-sbom-attestations.sh <owner/repo> <workflow-path> <file> [<file> ...]
#   مثال: verify-sbom-attestations.sh skyosv10-art/wasla .github/workflows/ci.yml \
#           artifacts/sbom/pass1.cdx.json artifacts/sbom/pass2.cdx.json
#
# العقد — كلُّ فشلٍ يُخرِجُ رمزًا غيرَ صفريٍّ، ولا يتحوّلُ إلى نجاحٍ بطباعةِ تحذير:
#   2  غيابُ GH_TOKEN أو وسائطَ ناقصة
#   3  إصدارُ gh أقدمُ من الأدنى أو لا يدعمُ الأعلامَ المطلوبة (لا يُمرَّرُ بتحذير)
#   1  فشلُ التحقّقِ من ملفٍّ واحدٍ على الأقلّ (غيابُ الملف، غيابُ الإثبات،
#      فشلُ المصادقة، عدمُ تطابقِ المستودعِ أو سيرِ التوقيعِ أو نوعِ الإثبات،
#      أو مخرَجٌ لا يُثبتُ البصمةَ نفسَها)
#   0  كلُّ ملفٍّ تحقّقَ — ولا غير.
#
# لا يطبعُ قيمةَ GH_TOKEN أبدًا. لا `|| true` ولا `|| echo` ولا continue-on-error.
set -euo pipefail

PREDICATE_TYPE="https://slsa.dev/provenance/v1"
MIN_GH_VERSION="2.50.0"
# مجلدُ الأدلّةِ اختياريّ: يُحفظُ فيه مخرَجُ كلِّ ملفٍّ (لا أسرارَ فيه).
EVIDENCE_DIR="${ATTEST_EVIDENCE_DIR:-}"

die() { local rc="$1"; shift; printf '✗ %s\n' "$*" >&2; exit "$rc"; }

(( $# >= 3 )) || die 2 "الاستعمال: $0 <owner/repo> <workflow-path> <file>..."
REPO="$1"; WORKFLOW="$2"; shift 2
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die 2 "مستودعٌ غيرُ صالح: '$REPO'"
[[ "$WORKFLOW" =~ ^\.github/workflows/[A-Za-z0-9_.-]+\.ya?ml$ ]] || die 2 "مسارُ سيرِ التوقيعِ غيرُ صالح: '$WORKFLOW'"

# (1) الرمز — غيابُه فشلٌ صريحٌ قبلَ أيِّ نداء.
[[ -n "${GH_TOKEN:-}" ]] || die 2 "GH_TOKEN غائبٌ أو فارغ — التحقّقُ يتطلّبُ مصادقةً، ولا يُتجاوَز."

# (2) إصدارُ gh — أدنى صريح + دعمُ الأعلامِ المطلوبة. لا تحذيرَ يُمرِّر.
command -v gh >/dev/null 2>&1 || die 3 "gh غيرُ مثبّت."
GH_VER_LINE="$(gh --version 2>/dev/null | head -n1 || true)"
GH_VER="$(sed -nE 's/^gh version ([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' <<< "$GH_VER_LINE")"
[[ -n "$GH_VER" ]] || die 3 "تعذّرَ قراءةُ إصدارِ gh من: '$GH_VER_LINE'"
lowest="$(printf '%s\n%s\n' "$MIN_GH_VERSION" "$GH_VER" | sort -V | head -n1)"
[[ "$lowest" == "$MIN_GH_VERSION" ]] || die 3 "gh $GH_VER أقدمُ من $MIN_GH_VERSION — لا يُمرَّرُ التحقّق."
HELP="$(gh attestation verify --help 2>&1 || true)"
for flag in --repo --signer-workflow --predicate-type --format; do
  grep -q -- "$flag" <<< "$HELP" || die 3 "gh $GH_VER لا يدعمُ $flag في 'attestation verify'."
done
printf 'gh %s (≥ %s) · repo=%s · signer-workflow=%s/%s · predicate-type=%s\n' \
  "$GH_VER" "$MIN_GH_VERSION" "$REPO" "$REPO" "$WORKFLOW" "$PREDICATE_TYPE"

[[ -z "$EVIDENCE_DIR" ]] || mkdir -p "$EVIDENCE_DIR"

# (3) كلُّ ملفٍّ يُتحقَّقُ منه؛ فشلُ أيِّها يُفشِلُ الكلّ (يُكمَلُ الباقي لتقريرٍ كامل).
failed=0; ok=0; n=0
for f in "$@"; do
  n=$((n + 1))
  base="$(basename "$f")"
  out="$(mktemp)"; err="$(mktemp)"
  if [[ ! -f "$f" ]]; then
    printf '✗ %s: الملفُّ غائب.\n' "$f" >&2; failed=$((failed + 1)); continue
  fi
  digest="$(sha256sum "$f" | cut -d' ' -f1)"
  rc=0
  gh attestation verify "$f" \
    --repo "$REPO" \
    --signer-workflow "$REPO/$WORKFLOW" \
    --predicate-type "$PREDICATE_TYPE" \
    --format json >"$out" 2>"$err" || rc=$?
  if [[ -n "$EVIDENCE_DIR" ]]; then
    cp "$out" "$EVIDENCE_DIR/verify-$base.json"; cp "$err" "$EVIDENCE_DIR/verify-$base.stderr.txt"
  fi
  if (( rc != 0 )); then
    printf '✗ %s (sha256:%s): gh attestation verify خرجَ بـ%d:\n' "$f" "$digest" "$rc" >&2
    sed 's/^/    /' "$err" >&2
    failed=$((failed + 1)); continue
  fi
  # (4) خروجٌ صفريٌّ وحدَه لا يكفي: يُشترطُ أن يُثبتَ المخرَجُ البصمةَ نفسَها
  #     والنوعَ نفسَه وسيرَ التوقيعِ نفسَه — وإلا فهو تحذيرٌ لا تحقُّق.
  if ! python3 - "$out" "$digest" "$PREDICATE_TYPE" "$REPO" "$WORKFLOW" <<'PY'
import json, sys
path, digest, ptype, repo, wf = sys.argv[1:6]
try:
    data = json.load(open(path, encoding="utf-8"))
except Exception as e:
    print(f"    مخرَجٌ ليس JSON: {e}", file=sys.stderr); sys.exit(1)
if not isinstance(data, list) or not data:
    print("    لا نتائجَ تحقّقٍ في المخرَج.", file=sys.stderr); sys.exit(1)
want_signer = f"https://github.com/{repo}/{wf}@"
for item in data:
    vr = item.get("verificationResult") or {}
    st = vr.get("statement") or {}
    if st.get("predicateType") != ptype:
        continue
    if not any((s.get("digest") or {}).get("sha256") == digest for s in st.get("subject") or []):
        continue
    cert = (vr.get("signature") or {}).get("certificate") or {}
    if not str(cert.get("buildSignerURI", "")).startswith(want_signer):
        continue
    if cert.get("sourceRepositoryURI") != f"https://github.com/{repo}":
        continue
    print(f"    signer={cert.get('buildSignerURI')} run={cert.get('runInvocationURI')}")
    sys.exit(0)
print("    لا نتيجةَ تطابقُ البصمةَ والنوعَ وسيرَ التوقيعِ والمستودع.", file=sys.stderr)
sys.exit(1)
PY
  then
    printf '✗ %s (sha256:%s): المخرَجُ لا يُثبتُ التحقّق.\n' "$f" "$digest" >&2
    failed=$((failed + 1)); continue
  fi
  printf '✓ VERIFIED %s (sha256:%s)\n' "$f" "$digest"
  ok=$((ok + 1))
done

if (( failed > 0 || ok != n )); then
  printf '✗ تحقُّقُ الإثبات: %d/%d — فشلَ %d.\n' "$ok" "$n" "$failed" >&2
  exit 1
fi
printf '✓ تحقُّقُ الإثبات: %d/%d.\n' "$ok" "$n"
