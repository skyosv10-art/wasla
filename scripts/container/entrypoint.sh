#!/bin/sh
# entrypoint.sh — مدخلُ الصورةِ الواحدُ: يختارُ الحزمةَ القابلةَ للتشغيلِ. (M2-01)
#
#   docker run wasla:local @wasla/orders-service
#   docker run -e WASLA_SERVICE=@wasla/driver-bot wasla:local
#
# `WASLA_ENTRYPOINT_DRYRUN=1` يُثبِتُ **حلَّ الحزمةِ داخلَ الصورةِ** ووجودَ ملفِّ
# مدخلِها دونَ إقلاعِ خدمةٍ ولا قاعدةِ بياناتٍ — وهوَ ما يعضُّ على العيبِ الذي
# مرَّ سابقاً: بيانٌ ناقصٌ أو مصدرٌ استبعدَهُ `.dockerignore` فلا يظهرُ إلّا في
# الإنتاجِ. الجفافُ لا يُغني عن التشغيلِ، ولا يُسمّى في الوثائقِ إثباتَ إقلاعٍ.
set -eu

SERVICE="${1:-${WASLA_SERVICE:-}}"

if [ -z "$SERVICE" ]; then
  echo "entrypoint: اسمُ الحزمةِ مطلوبٌ — وسيطاً أوّلَ أو WASLA_SERVICE" >&2
  echo "            مثالٌ: @wasla/orders-service" >&2
  exit 64
fi

# الحلُّ بـ`node` وحدَهُ: لا مديرَ حِزَمٍ في طبقةِ التشغيلِ (انظر
# `resolve-package.mjs` — 49 ثغرةً قابلةً للإصلاحِ كانَ مصدرُها ذاكرةَ corepack).
RESOLVED="$(node /app/scripts/container/resolve-package.mjs "$SERVICE")" || exit $?
DIR="$(printf '%s' "$RESOLVED" | cut -f1)"
START="$(printf '%s' "$RESOLVED" | cut -f2-)"

cd "$DIR" || exit 66
# `.bin` الجذرُ والمحلّيُّ في المسارِ لأنَّ `pnpm run` كانَ هوَ ما يضيفُهُما.
PATH="$DIR/node_modules/.bin:/app/node_modules/.bin:$PATH"
export PATH

if [ "${WASLA_ENTRYPOINT_DRYRUN:-0}" = "1" ]; then
  exec node /app/scripts/container/entry-dryrun.mjs
fi

exec sh -c "$START"
