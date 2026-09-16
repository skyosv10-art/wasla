#!/usr/bin/env bash
# verify-image-contract.sh — عقدُ الصورةِ يُقاسُ **داخلَها** لا في وثيقةٍ. (M2-01)
#
#   bash scripts/container/verify-image-contract.sh wasla:local
#
# ثلاثةُ إثباتاتٍ لا ادّعاءاتٍ:
#   1) المستخدمُ الفعليُّ داخلَ الصورةِ ليسَ جِذراً (uid ≠ 0) — يُقاسُ بـ`id -u`
#      في حاويةٍ حقيقيّةٍ، لا بقراءةِ سطرِ `USER` في Dockerfile.
#   2) نسخةُ العقدةِ داخلَ الصورةِ = المُثبَّتةُ في Dockerfile حرفاً بحرفٍ.
#   3) كلُّ حزمةٍ لها `start` في الشجرةِ **تُحَلُّ داخلَ الصورةِ** وملفُّ مدخلِها
#      موجودٌ (`WASLA_ENTRYPOINT_DRYRUN=1`). وهذا ما كانَ يسقطُ في المحاولةِ
#      السابقةِ: صورةٌ تنسخُ `dist` غيرَ موجودٍ فلا مدخلَ لأيِّ خدمةٍ.
#
# الفشلُ يُجمَعُ ثمَّ يُطبَعُ كلُّهُ: مَن يُصلِحُ واحداً ثمَّ يُعيدُ التشغيلَ
# ستَّ عشرةَ مرّةً يكرهُ الحارسَ فيُعطِّلُهُ.
set -uo pipefail

TAG="${1:?وسمُ الصورةِ مطلوبٌ}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

GRN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RST=$'\033[0m'
FAILURES=()

# ── 1) غيرُ جِذرٍ ─────────────────────────────────────────────────────────
UID_IN_IMAGE="$(docker run --rm --entrypoint id "$TAG" -u | tr -d '\r')"
if [[ "$UID_IN_IMAGE" == "0" ]]; then
  FAILURES+=("الصورةُ تعملُ بـuid=0 (جِذرٌ) — USER في الطبقةِ الأخيرةِ لا يعملُ")
else
  printf '%s✓%s المستخدمُ داخلَ الصورةِ غيرُ جِذرٍ (uid=%s)\n' "$GRN" "$RST" "$UID_IN_IMAGE"
fi

# ── 2) نسخةُ العقدةِ ──────────────────────────────────────────────────────
EXPECTED_NODE="$(python3 -c '
import sys; sys.path.insert(0, "scripts/checks/lib")
from container_image import base_image
print(base_image()[1])')"
ACTUAL_NODE="$(docker run --rm --entrypoint node "$TAG" -e 'process.stdout.write(process.versions.node)')"
if [[ "$ACTUAL_NODE" != "$EXPECTED_NODE" ]]; then
  FAILURES+=("نسخةُ العقدةِ داخلَ الصورةِ $ACTUAL_NODE ≠ المُثبَّتةُ $EXPECTED_NODE")
else
  printf '%s✓%s نسخةُ العقدةِ داخلَ الصورةِ %s كما هيَ مُثبَّتةٌ\n' "$GRN" "$RST" "$ACTUAL_NODE"
fi

# ── 3) كلُّ حزمةٍ قابلةٍ للتشغيلِ تُحَلُّ ويوجدُ مدخلُها ─────────────────
mapfile -t PACKAGES < <(python3 scripts/checks/lib/container_image.py runnable | cut -f1)
if ((${#PACKAGES[@]} == 0)); then
  FAILURES+=("لم تُقَسْ أيُّ حزمةٍ قابلةٍ للتشغيلِ — القياسُ نفسُهُ معطوبٌ")
fi

for pkg in "${PACKAGES[@]}"; do
  if out="$(docker run --rm -e WASLA_ENTRYPOINT_DRYRUN=1 "$TAG" "$pkg" 2>&1)"; then
    printf '%s✓%s %s\n' "$GRN" "$RST" "$pkg"
  else
    FAILURES+=("$pkg: $(printf '%s' "$out" | tail -3 | tr '\n' ' ')")
  fi
done

# ── 4) المدخلُ يرفضُ الاستدعاءَ بلا حزمةٍ (لا إقلاعَ صامتٌ) ───────────────
if docker run --rm "$TAG" >/dev/null 2>&1; then
  FAILURES+=("المدخلُ قَبِلَ التشغيلَ بلا اسمِ حزمةٍ — يجبُ أن يفشلَ بـ64")
else
  printf '%s✓%s المدخلُ يرفضُ التشغيلَ بلا اسمِ حزمةٍ\n' "$GRN" "$RST"
fi

if ((${#FAILURES[@]})); then
  printf '\n%s✗ عقدُ الصورةِ مكسورٌ — %d إخفاقاً:%s\n' "$RED" "${#FAILURES[@]}" "$RST"
  for f in "${FAILURES[@]}"; do printf '  ✗ %s\n' "$f"; done
  printf '%s  العقدُ: docs/08-infrastructure/CONTAINER_IMAGES.md §3%s\n' "$DIM" "$RST"
  exit 1
fi

printf '\n%s✓ عقدُ الصورةِ سليمٌ:%s %d حزمةً قابلةً للتشغيلِ · غيرُ جِذرٍ · عقدةٌ مُثبَّتةٌ.\n' \
  "$GRN" "$RST" "${#PACKAGES[@]}"
