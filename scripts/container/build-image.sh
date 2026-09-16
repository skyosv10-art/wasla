#!/usr/bin/env bash
# build-image.sh — بناءُ صورةِ WASLA من مصدرٍ واحدٍ محلّيّاً وفي CI. (M2-01)
#
#   bash scripts/container/build-image.sh wasla:local
#   bash scripts/container/build-image.sh wasla:ci-2 --no-cache
#
# لا خياراتَ بناءٍ مكتوبةً في YAML: أمرُ البناءِ واحدٌ، فما يفشلُ في CI يفشلُ
# على المكتبِ بالحرفِ نفسِهِ. و`SOURCE_DATE_EPOCH` يُثبَّتُ من زمنِ الالتزامِ
# لا من ساعةِ الجدارِ، فمقارنةُ بناءَينِ تقيسُ الإعادةَ لا الوقتَ.
set -euo pipefail

TAG="${1:?وسمُ الصورةِ مطلوبٌ}"
shift || true
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SOURCE_DATE_EPOCH="$(git log -1 --pretty=%ct 2>/dev/null || echo 0)"
export SOURCE_DATE_EPOCH

echo "• بناءُ $TAG (SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH)"
docker build \
  --progress plain \
  --build-arg "SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH" \
  --tag "$TAG" \
  "$@" \
  .

echo "✓ $TAG مبنيّةٌ"
docker image inspect "$TAG" --format '  المستخدمُ: {{.Config.User}} · الحجمُ: {{.Size}} بايت'
