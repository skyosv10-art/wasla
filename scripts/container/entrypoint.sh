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

if [ "${WASLA_ENTRYPOINT_DRYRUN:-0}" = "1" ]; then
  exec pnpm --filter "$SERVICE" exec node /app/scripts/container/entry-dryrun.mjs
fi

exec pnpm --filter "$SERVICE" run start
