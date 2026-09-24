#!/usr/bin/env bash
# validate-runbook-reason-codes.sh — الفحصُ 25: أسماءُ الأسبابِ والحالاتِ في دليلِ التدويرِ تطابقُ الشفرة (M3-07).
#
# لماذا: تمرينُ M3-07 على wasla-audit المنشورة (2026-09-24) قرأَ سجلَّ الخدمةِ فوجدَ
# السببَ `unknown_key`، بينما الدليلُ يأمرُ المشغِّلَ بالبحثِ عن `unknown_kid` في ثلاثةِ
# مواضع. مشغِّلٌ يبحثُ في السجلِّ بالاسمِ المكتوبِ لا يجدُ شيئًا فيقرأُ «لا أخطاء» —
# خضرةٌ كاذبةٌ في أحرجِ لحظةٍ (نشرُ تدوير). والاختباراتُ لا تلتقطُ هذا لأنّ الوثيقةَ لا تُنفَّذ.
#
# القاعدة: كلُّ رمزٍ بين علامتَي `…` في الدليلِ على هيئةِ snake_case صغيرةٍ (سببٌ تشخيصيٌّ أو
# حالُ مفتاح) يجبُ أن يظهرَ **نصًّا مقتبسًا** ("…") في شفرةِ packages/service-auth/src
# الإنتاجيّةِ (بلا الاختبارات). قراءةُ قرصٍ محضةٌ — مرورٌ أو إخفاق.
set -euo pipefail

RUNBOOKS=("${WASLA_RUNBOOK_REASON_DOCS:-docs/14-runbooks/SERVICE_AUTH_KEY_ROTATION.md}")
SRC="${WASLA_RUNBOOK_REASON_SRC:-packages/service-auth/src}"

[[ -d "$SRC" ]] || { echo "✗ مصدرُ الشفرةِ غائب: $SRC"; exit 1; }

missing=0
checked=0
for doc in "${RUNBOOKS[@]}"; do
  [[ -f "$doc" ]] || { echo "✗ الدليلُ غائب: $doc"; exit 1; }
  while IFS= read -r tok; do
    [[ -z "$tok" ]] && continue
    checked=$((checked + 1))
    if ! grep -rqF --include='*.ts' --exclude-dir='__tests__' "\"$tok\"" "$SRC"; then
      lines=$(grep -nF "\`$tok\`" "$doc" | cut -d: -f1 | paste -sd, -)
      echo "✗ $doc:$lines — \`$tok\` غيرُ موجودٍ في $SRC؛ مشغِّلٌ يبحثُ به في السجلِّ لن يجدَ شيئًا."
      missing=$((missing + 1))
    fi
  done < <(grep -o '`[a-z][a-z0-9]*\(_[a-z0-9]\+\)\+`' "$doc" | tr -d '`' | sort -u)
done

if (( checked == 0 )); then
  echo "✗ لم يُعثَر على أيِّ رمزٍ في الدليل — فحصٌ بلا مادّةٍ لا يُعَدُّ مرورًا."
  exit 1
fi
if (( missing )); then
  echo "✗ أسماءُ الدليلِ: $missing من $checked لا تطابقُ الشفرة."
  exit 1
fi
echo "✓ أسماءُ الدليلِ: $checked رمزًا كلُّها موجودةٌ في الشفرة."
