#!/usr/bin/env bash
# CLM-0672 — يشغّلُ اختباراتِ الأمانِ التي أضافَها مشرفو fast-uri في الإصدارِ المُصلِحِ على الإصدارِ القديمِ والجديد.
# يعملُ في دليلٍ مؤقّتٍ خارجَ المستودع (npm pack من السجلِّ العامّ + tape@5)؛ لا يلمسُ المستودعَ ولا node_modules فيه.
# المتوقَّع: كلُّ ملفٍّ أمنيٍّ جديدٍ يفشلُ على القديمِ في بعضِ حالاتِه وينجحُ كلُّهُ على الجديد.
# الاستعمال: bash upstream-security-tests.sh
set -euo pipefail
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT; cd "$W"
npm init -y >/dev/null; npm i tape@5 --silent >/dev/null 2>&1
for v in 3.1.8 3.1.9 4.1.5 4.2.3; do mkdir -p "$v"; npm pack "fast-uri@$v" --silent >/dev/null; tar xzf "fast-uri-$v.tgz" -C "$v"; echo "integrity $v $(npm view "fast-uri@$v" dist.integrity)"; done
for pair in "3.1.8 3.1.9" "4.1.5 4.2.3"; do
  set -- $pair
  for t in $(cd "$2/package/test" && ls ./*security*.test.js host-encoding.test.js 2>/dev/null | sed 's#^\./##'); do
    for v in "$1" "$2"; do
      rm -rf run && cp -r "$v/package" run && cp "$2/package/test/$t" run/test/
      rm -rf run/test/fixtures && cp -r "$2/package/test/fixtures" run/test/ 2>/dev/null || true
      r=$(cd run && timeout 60 node "test/$t" 2>&1 | grep -E "^# (tests|pass|fail)" | tr '\n' ' ' || true)
      echo "$t on $v: ${r:-NO-TAP-SUMMARY}"
    done
  done
done
