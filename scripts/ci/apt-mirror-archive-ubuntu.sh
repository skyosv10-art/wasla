#!/usr/bin/env bash
# CLM-0671 — الخيارُ B من CLM-0670 (اعتمادٌ بقرارِ المالكِ 2026-10-24 — معالجةٌ بقياسٍ محدود،
# راجع docs/12-testing/ci-evidence/2026-10-24T010000Z-clm-0671-apt-mirror-option-b/README.md):
# مصادرُ apt تُحوَّلُ من azure.archive.ubuntu.com
# إلى https://archive.ubuntu.com قبلَ `playwright install --with-deps`.
#
# لماذا: CLM-0670 قاسَ أنّ إلغاءاتِ e2e بمهلةِ العشرِ دقائقَ سببُها جلبُ حزمِ .deb
# من azure.archive.ubuntu.com بنحوِ 50 kB/s (مقابلَ وسيطِ 18 MB/s)، وأنّ apt لا يتخلّى
# عن نقلٍ يتقطّرُ (actions/runner-images#14823). المهلةُ لا تُمَسّ.
#
# ما يفعلُهُ:
#   1. يطبعُ مصادرَ apt قبلَ التعديلِ (للسجلّ).
#   2. يستبدلُ `http(s)://azure.archive.ubuntu.com` بـ `https://archive.ubuntu.com` في:
#      /etc/apt/apt-mirrors.txt · /etc/apt/sources.list · /etc/apt/sources.list.d/*.list|*.sources
#   3. يفشلُ مغلقًا (exit 1) إن:
#      - بقيَ أيُّ ذكرٍ لـ azure.archive.ubuntu.com في تلكَ الملفّات؛ أو
#      - لم يذكرْ أيُّ ملفٍّ archive.ubuntu.com بعدَ التعديلِ (تغيّرَ تخطيطُ الصورةِ ⇒ لا يُدَّعى التحويل).
#   4. يطبعُ المصادرَ بعدَ التعديلِ وسطرَ `CLM0671-MIRROR switched=<n>`.
#
# الحزمُ موقَّعةٌ والتحقّقُ من التوقيعِ بـ apt لم يتغيّر؛ المضيفُ وحدَهُ تغيّر.
#
# الاستعمال: bash scripts/ci/apt-mirror-archive-ubuntu.sh
#   APT_ROOT=<dir> — جذرٌ بديلٌ لـ /etc/apt (للاختبارات؛ بلا sudo).
set -euo pipefail

ROOT="${APT_ROOT:-}"
ETC="$ROOT/etc/apt"
SUDO=""
if [[ -z "$ROOT" && "$(id -u)" != 0 ]]; then SUDO="sudo"; fi

shopt -s nullglob
FILES=()
for f in "$ETC/apt-mirrors.txt" "$ETC/sources.list" "$ETC"/sources.list.d/*.list "$ETC"/sources.list.d/*.sources; do
  [[ -f "$f" ]] && FILES+=("$f")
done
shopt -u nullglob

if (( ${#FILES[@]} == 0 )); then
  echo "error: no apt source files under $ETC — refusing to claim a mirror switch." >&2
  exit 1
fi

echo "== apt sources before (CLM-0671) =="
for f in "${FILES[@]}"; do echo "--- $f"; cat "$f"; done

switched=0
for f in "${FILES[@]}"; do
  if grep -qE 'https?://azure\.archive\.ubuntu\.com' "$f"; then
    $SUDO sed -i -E 's#https?://azure\.archive\.ubuntu\.com#https://archive.ubuntu.com#g' "$f"
    switched=$((switched + 1))
  fi
done

if grep -lE 'azure\.archive\.ubuntu\.com' "${FILES[@]}" >/dev/null 2>&1; then
  echo "error: azure.archive.ubuntu.com still referenced after the switch:" >&2
  grep -nE 'azure\.archive\.ubuntu\.com' "${FILES[@]}" >&2 || true
  exit 1
fi
if ! grep -lE '(^|[^.a-z])archive\.ubuntu\.com' "${FILES[@]}" >/dev/null 2>&1; then
  echo "error: no apt source references archive.ubuntu.com — image layout changed; not claiming the switch." >&2
  exit 1
fi

echo "== apt sources after (CLM-0671) =="
for f in "${FILES[@]}"; do echo "--- $f"; cat "$f"; done
echo "CLM0671-MIRROR switched=$switched files=${#FILES[@]}"
