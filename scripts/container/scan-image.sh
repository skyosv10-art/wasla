#!/usr/bin/env bash
# scan-image.sh — فحصُ ثغراتِ الصورةِ، بوّابةٌ تعضُّ لا تقريرٌ يُقرأُ. (M2-01)
#
#   bash scripts/container/scan-image.sh wasla:local
#
# الحدودُ المُعلَنةُ صريحةً (لا يُقالُ «الصورةُ آمنةٌ»، بل «لا ثغرةَ عاليةً أو
# حرِجةً **لها إصلاحٌ منشورٌ**»):
#   • `--severity HIGH,CRITICAL` — المتوسّطُ والمنخفضُ يُسجَّلانِ ولا يَحجزانِ.
#   • `--ignore-unfixed` — ثغرةٌ بلا إصلاحٍ منشورٍ لا تُوقِفُ الدمجَ، وإلّا
#     عُطِّلَتِ البوّابةُ بعدَ أسبوعٍ لأنّها تكذبُ حمراءَ بلا علاجٍ.
#   • `--exit-code 1` — الفشلُ فشلٌ.
#   • ملفُّ استثناءاتٍ **واحدٌ محروسٌ**: `docs/07-security/IMAGE_VULN_EXCEPTIONS.yaml`.
#     استثناءٌ بلا سببٍ مُسجَّلٍ إسكاتٌ، فلذلكَ يفرضُ البابُ 10 من الفحصِ 19 على
#     كلِّ مُدخَلٍ: مساراً محدّداً · مهلةً ≤ 90 يوماً غيرَ منقضيةٍ · رقمَ خطرٍ
#     قائماً في RISK_REGISTER.md. والتقريرُ الكاملُ أعلاهُ يُولَّدُ **بلا** هذا
#     الملفِّ: ما يُستثنى يبقى مقيساً ومنشوراً، والاستثناءُ من الحَجزِ لا من القياسِ.
set -euo pipefail

TAG="${1:?وسمُ الصورةِ مطلوبٌ}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

TOOLS="${WASLA_TOOLS_DIR:-/tmp/wasla-tools}"
bash scripts/container/install-tool.sh trivy "$TOOLS"

REPORT="${WASLA_TRIVY_REPORT:-artifacts/security/trivy-image.json}"
mkdir -p "$(dirname "$REPORT")"

echo "• تقريرٌ كاملٌ (كلُّ الدرجاتِ) للأرشيفِ — لا يَحجزُ"
"$TOOLS/trivy" image --scanners vuln --format json --output "$REPORT" --quiet "$TAG"

python3 - "$REPORT" <<'PY'
import collections, json, sys
doc = json.load(open(sys.argv[1], encoding="utf-8"))
counts = collections.Counter()
for result in doc.get("Results") or []:
    for vuln in result.get("Vulnerabilities") or []:
        counts[vuln.get("Severity", "UNKNOWN")] += 1
total = sum(counts.values())
order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]
line = " · ".join(f"{key}={counts.get(key, 0)}" for key in order)
print(f"• المقيسُ: {total} ثغرةً — {line}")
PY

IGNORES="docs/07-security/IMAGE_VULN_EXCEPTIONS.yaml"
[ -f "$IGNORES" ] || { echo "✗ ملفُّ الاستثناءاتِ المُعلَنُ مفقودٌ: $IGNORES" >&2; exit 1; }
python3 scripts/checks/lib/image_vuln_exceptions.py --report

echo "• البوّابةُ: HIGH,CRITICAL القابلةُ للإصلاحِ"
"$TOOLS/trivy" image \
  --ignorefile "$IGNORES" \
  --scanners vuln \
  --severity HIGH,CRITICAL \
  --ignore-unfixed \
  --exit-code 1 \
  --quiet \
  "$TAG"

echo "✓ لا ثغرةَ عاليةً أو حرِجةً لها إصلاحٌ منشورٌ في $TAG"
