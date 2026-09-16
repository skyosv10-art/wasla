#!/usr/bin/env bash
# install-tool.sh — تنزيلُ أداةِ سلسلةِ توريدٍ بنسخةٍ مُثبَّتةٍ وبصمةٍ مُتحقَّقٍ منها. (M2-01)
#
#   bash scripts/container/install-tool.sh syft   /tmp/wasla-tools
#   bash scripts/container/install-tool.sh trivy  /tmp/wasla-tools
#
# لماذا لا `curl … | sh` ولا إجراءٌ من طرفٍ ثالثٍ:
#   • `install.sh` من الشبكةِ يعني أنَّ حارسَ الثغراتِ نفسَهُ بابُ إدخالٍ.
#   • إجراءاتُ GitHub الخارجيّةُ تُخالفُ `validate-workflow-supply-chain.sh`.
# فالنسخةُ والبصمةُ من `tool-pins.env` وحدَه، والفشلُ صريحٌ لا صامتٌ: لا بديلَ
# ولا «تخطٍّ» عندَ تعذُّرِ التنزيلِ، لأنَّ فحصاً لم يُشغَّلْ ليسَ فحصاً ناجحاً.
set -euo pipefail

TOOL="${1:?اسمُ الأداةِ مطلوبٌ: syft|trivy}"
DEST="${2:-/tmp/wasla-tools}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=tool-pins.env
source "$HERE/tool-pins.env"

case "$TOOL" in
  syft)
    VERSION="$SYFT_VERSION"; SHA="$SYFT_SHA256"
    URL="https://github.com/anchore/syft/releases/download/v${VERSION}/syft_${VERSION}_linux_amd64.tar.gz"
    ;;
  trivy)
    VERSION="$TRIVY_VERSION"; SHA="$TRIVY_SHA256"
    URL="https://github.com/aquasecurity/trivy/releases/download/v${VERSION}/trivy_${VERSION}_Linux-64bit.tar.gz"
    ;;
  *)
    echo "✗ أداةٌ غيرُ معروفةٍ: $TOOL (المعروفُ: syft|trivy)" >&2
    exit 64
    ;;
esac

mkdir -p "$DEST"
if [[ -x "$DEST/$TOOL" ]]; then
  echo "• $TOOL موجودٌ في $DEST — لا تنزيلَ"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "• تنزيلُ $TOOL v$VERSION"
curl -fsSL --retry 3 --retry-delay 2 -o "$TMP/pkg.tar.gz" "$URL"

ACTUAL="$(sha256sum "$TMP/pkg.tar.gz" | cut -d' ' -f1)"
if [[ "$ACTUAL" != "$SHA" ]]; then
  echo "✗ بصمةُ $TOOL لا تُطابقُ المُثبَّتَ في tool-pins.env" >&2
  echo "  المتوقَّعُ: $SHA" >&2
  echo "  الواقعُ  : $ACTUAL" >&2
  exit 1
fi

tar -xzf "$TMP/pkg.tar.gz" -C "$TMP" "$TOOL"
install -m 0755 "$TMP/$TOOL" "$DEST/$TOOL"
echo "✓ $TOOL v$VERSION مُثبَّتٌ ومُتحقَّقٌ منهُ → $DEST/$TOOL"
