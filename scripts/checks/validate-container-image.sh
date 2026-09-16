#!/usr/bin/env bash
# validate-container-image.sh — حارسُ صورةِ الحاويةِ وسلسلةِ توريدِها. (M2-01 · الفحصُ 19)
#
# مِغلافٌ رقيقٌ: المنطقُ كلُّهُ في `lib/container_image_gates.py` لأنَّ القياسَ
# يقرأُ بياناتَ ستَّ عشرةَ حزمةً وJSON وYAML — وbash يجعلُ ذلكَ هشّاً. ويبقى
# المِغلافُ ليكونَ الحارسُ مربوطاً في `verify-governance.sh` بالصيغةِ نفسِها
# التي تربطُ إخوتَهُ، فلا يصيرَ حارساً يتيماً يرفضُهُ `validate-ci-mandatory.sh`.
#
#   bash scripts/checks/validate-container-image.sh
#
# حدُّهُ المُعلَنُ: **لا يبني صورةً ولا يشغّلُ حاويةً**. البناءُ والعقدُ داخلَ
# الصورةِ والثغراتُ حكمُها وظيفةُ `image-supply-chain` في CI، ولا يُعوِّضُ
# أحدُهما الآخرَ: أخضرُ الحارسِ يقولُ «الإعدادُ متّسقٌ» لا «الصورةُ تُبنى».
#
# المرجع: docs/08-infrastructure/CONTAINER_IMAGES.md · ADR-033 · docs/12-testing/M2-01_GATE.md
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1

RED=$'\033[31m'; RST=$'\033[0m'

if ! command -v python3 >/dev/null 2>&1; then
  printf '%s✗ python3 غيرُ متوفّرٍ — الفحصُ 19 لا يُقاسُ. UNKNOWN ≠ PASSED.%s\n' "$RED" "$RST"
  exit 1
fi

exec python3 scripts/checks/lib/container_image_gates.py
