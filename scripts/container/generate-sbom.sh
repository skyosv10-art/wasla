#!/usr/bin/env bash
# generate-sbom.sh — قائمةُ موادِ البرمجيّاتِ (CycloneDX) للصورةِ المبنيّةِ. (M2-01)
#
#   bash scripts/container/generate-sbom.sh wasla:local artifacts/sbom/local.cdx.json
#
# قواعدُ صريحةٌ:
#   • لا بديلَ صامتٌ: إن غابَ `syft` أو فشلَ فالأمرُ يفشلُ. قائمةُ موادٍ
#     مُولَّدةٌ بـ«أفضلِ مجهودٍ» تُقرأُ كإثباتٍ وهيَ لا شيءَ.
#   • العتبةُ تُقاسُ لا تُكتَبُ: عددُ المكوِّناتِ يُطبَعُ ويُقارَنُ بحدٍّ أدنى
#     يُحرَسُ (`SBOM_MIN_COMPONENTS`)، فقائمةٌ بمكوِّنٍ واحدٍ لا تمرُّ خضراءَ.
set -euo pipefail

TAG="${1:?وسمُ الصورةِ مطلوبٌ}"
OUT="${2:?مسارُ المخرَجِ مطلوبٌ}"
SBOM_MIN_COMPONENTS="${SBOM_MIN_COMPONENTS:-300}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

TOOLS="${WASLA_TOOLS_DIR:-/tmp/wasla-tools}"
bash scripts/container/install-tool.sh syft "$TOOLS"

mkdir -p "$(dirname "$OUT")"
echo "• توليدُ قائمةِ الموادِ لـ$TAG"
"$TOOLS/syft" scan "docker:$TAG" -o "cyclonedx-json=$OUT" -q

COUNT="$(python3 -c '
import json, sys
doc = json.load(open(sys.argv[1], encoding="utf-8"))
print(len(doc.get("components") or []))
' "$OUT")"

echo "• المكوِّناتُ المقيسةُ: $COUNT (الحدُّ الأدنى المحروسُ: $SBOM_MIN_COMPONENTS)"
if (( COUNT < SBOM_MIN_COMPONENTS )); then
  echo "✗ قائمةُ الموادِ ناقصةٌ — $COUNT مكوِّناً فقط. توليدٌ فاشلٌ لا صورةٌ نحيفةٌ." >&2
  exit 1
fi

echo "✓ قائمةُ الموادِ: $OUT · $COUNT مكوِّناً"
